/** Real S3 integration check. Requires S3_CONFIG_FILE; all objects use a unique test prefix. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { DeleteObjectCommand, ListObjectsV2Command } from "@aws-sdk/client-s3";

async function main() {
  if (!process.env.S3_CONFIG_FILE) throw new Error("Set S3_CONFIG_FILE explicitly for this integration test");
  process.env.S3_CONFIG_FILE = path.resolve(process.env.S3_CONFIG_FILE);
  process.env.MEDIA_STORAGE = "s3";
  process.env.S3_PREFIX = `integration-tests/${randomUUID()}`;
  const originalCwd = process.cwd();
  const dir = mkdtempSync(path.join(tmpdir(), "pulse-s3-test-"));
  process.chdir(dir);
  const storage = await import("../src/server/objectStorage");
  const uploads = await import("../src/server/uploads");
  const auth = await import("../src/server/auth");
  const server = createServer((req, res) => {
    if (req.url?.startsWith("/api/upload")) uploads.handleUpload(req, res);
    else if (!uploads.tryServeUpload(req, res)) { res.statusCode = 404; res.end(); }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const account = auth.registerUser("s3_test", randomUUID());
  assert(account.ok);
  async function upload(name: string, body: Buffer, type: string, kind = "") {
    const form = new FormData();
    form.set("file", new Blob([new Uint8Array(body)], { type }), name);
    return fetch(`${origin}/api/upload${kind ? `?kind=${kind}` : ""}`, {
      method: "POST", body: form,
      headers: { origin, "x-pulse-token": account.ok ? account.account.token || "" : "" },
    });
  }
  try {
    const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZlSAAAAAASUVORK5CYII=", "base64");
    const response = await upload("avatar.png", png, "image/png", "avatar");
    assert.equal(response.status, 200);
    const { file } = await response.json() as { file: { url: string } };
    assert(await uploads.isValidStoredAvatar(file.url));
    const info = await uploads.getUploadInfo(file.url);
    assert.equal(info?.size, png.length);
    assert(!existsSync(path.join(dir, "uploads", info!.fileName)), "upload must not depend on a local original");
    const image = await fetch(`${origin}${file.url}`);
    assert.equal(image.status, 200);
    assert.deepEqual(Buffer.from(await image.arrayBuffer()), png);
    const head = await fetch(`${origin}${file.url}`, { method: "HEAD" });
    assert.equal(head.headers.get("content-length"), String(png.length));
    assert.equal((await head.arrayBuffer()).byteLength, 0);
    const conditional = await fetch(`${origin}${file.url}`, { headers: { "if-none-match": head.headers.get("etag")! } });
    assert.equal(conditional.status, 304);
    for (const [range, expected] of [["bytes=0-7", png.subarray(0, 8)], ["bytes=-5", png.subarray(-5)]] as const) {
      const partial = await fetch(`${origin}${file.url}`, { headers: { range } });
      assert.equal(partial.status, 206);
      assert.deepEqual(Buffer.from(await partial.arrayBuffer()), expected);
    }
    const invalidRange = await fetch(`${origin}${file.url}`, { headers: { range: "bytes=99999-" } });
    assert.equal(invalidRange.status, 416);
    await uploads.withUploadFile(file.url, (filename) => assert(existsSync(filename)));
    assert.equal(readdirSync(path.join(dir, "data", "media-tmp")).length, 0);

    const jpegPath = path.join(dir, "test.jpg");
    const jpegResult = spawnSync("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "testsrc2=size=1920x1080,noise=alls=30:allf=t", "-frames:v", "1", "-q:v", "2", jpegPath], { windowsHide: true });
    assert.equal(jpegResult.status, 0, "ffmpeg is required for thumbnail integration checks");
    const jpeg = readFileSync(jpegPath);
    assert(jpeg.length > 120_000);
    const photoResponse = await upload("photo.jpg", jpeg, "image/jpeg");
    assert.equal(photoResponse.status, 200);
    const photo = await photoResponse.json() as { file: { url: string } };
    const thumb = await fetch(`${origin}${photo.file.url}&w=320`);
    assert.equal(thumb.status, 200);
    assert.equal(thumb.headers.get("content-type"), "image/jpeg");
    const thumbBytes = Buffer.from(await thumb.arrayBuffer());
    assert(thumbBytes.length > 0 && thumbBytes.length < jpeg.length);
    const thumbHead = await fetch(`${origin}${photo.file.url}&w=320`, { method: "HEAD" });
    assert.equal(Number(thumbHead.headers.get("content-length")), thumbBytes.length);
    assert.equal(readdirSync(path.join(dir, "uploads", "thumbs")).length, 0);

    const videoPath = path.join(dir, "test.mov");
    const videoResult = spawnSync("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "testsrc2=size=160x90:rate=10", "-t", "0.3", "-c:v", "mpeg4", videoPath], { windowsHide: true });
    assert.equal(videoResult.status, 0);
    const movieResponse = await upload("movie.mov", readFileSync(videoPath), "video/quicktime");
    assert.equal(movieResponse.status, 200);
    const movie = await movieResponse.json() as { file: { url: string } };
    assert.match(uploads.bareUploadUrl(movie.file.url), /\.mp4$/);
    const movieName = uploads.uploadNameFromUrl(movie.file.url)!;
    for (let i = 0; i < 100 && existsSync(path.join(dir, "uploads", movieName)); i++) await new Promise((resolve) => setTimeout(resolve, 100));
    assert(!existsSync(path.join(dir, "uploads", movieName)), "video must be cleaned after background conversion");
    await uploads.withUploadFile(movie.file.url, (filename) => {
      const probe = spawnSync("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=codec_name", "-of", "default=nw=1:nk=1", filename], { encoding: "utf8", windowsHide: true });
      assert.equal(probe.stdout.trim(), "h264");
    });

    const pdf = Buffer.from("%PDF-1.4\nS3 integration test document\n");
    const document = await upload("document.pdf", pdf, "application/pdf");
    assert.equal(document.status, 200);
    const doc = await document.json() as { file: { url: string } };
    assert.equal((await fetch(`${origin}${uploads.bareUploadUrl(doc.file.url)}`)).status, 403);
    const download = await fetch(`${origin}${doc.file.url}&download=1`);
    assert.match(download.headers.get("content-disposition") || "", /^attachment/);
    assert.deepEqual(Buffer.from(await download.arrayBuffer()), pdf);
    assert.equal((await upload("fake.png", Buffer.from("not an image"), "image/png", "avatar")).status, 400);
    assert.equal((await upload("bad.html", Buffer.from("<script/>"), "text/html")).status, 400);
    for (const bad of ["/uploads/%2e%2e%2fdata%2fusers.json", "/uploads/%5cdata", "/uploads/%ZZ", `/uploads/${randomUUID()}.png`]) {
      assert.equal((await fetch(`${origin}${bad}`)).status, 404);
    }
    assert.equal((await fetch(`${origin}${file.url}`, { method: "POST" })).status, 405);

    const audio = Buffer.from("test ringtone bytes");
    await storage.putObjectBuffer("ringtones/audio/check.mp3", audio, "audio/mpeg");
    assert.deepEqual(await storage.readObjectBuffer("ringtones/audio/check.mp3"), audio);
    // A simulated PUT failure must never acknowledge an upload as successful.
    storage.s3Client!.middlewareStack.add(() => async () => { throw new Error("simulated S3 outage"); }, { step: "initialize", name: "testFailure" });
    try {
      const failed = await upload("failed.png", png, "image/png");
      assert.notEqual(failed.status, 200);
      assert.equal((await failed.json() as { ok: boolean }).ok, false);
    } finally { storage.s3Client!.middlewareStack.remove("testFailure"); }
    assert.equal(readdirSync(path.join(dir, "uploads")).filter((name) => name !== "thumbs").length, 0);
    console.log("PASS: S3 upload/read, avatars, thumbnails, background video conversion, HEAD, ETag, ranges, private documents, invalid uploads/paths, temporary cleanup, ringtone buffers, S3 failure handling");
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    const location = storage.objectLocation("cleanup");
    const prefix = location.Key.slice(0, -"cleanup".length);
    const objects = await storage.s3Client!.send(new ListObjectsV2Command({ Bucket: location.Bucket, Prefix: prefix }));
    for (const object of objects.Contents || []) {
      assert(object.Key?.startsWith(prefix));
      await storage.s3Client!.send(new DeleteObjectCommand({ Bucket: location.Bucket, Key: object.Key }));
    }
    storage.s3Client!.destroy();
    process.chdir(originalCwd);
    // Only the freshly generated test directory is removed.
    assert(path.dirname(dir) === path.resolve(tmpdir()) && path.basename(dir).startsWith("pulse-s3-test-"));
    try { rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); }
    catch (error) {
      if (process.platform !== "win32") throw error;
      console.warn(`Windows loader still holds temporary directory: ${dir}`);
    }
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
