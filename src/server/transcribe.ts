import { spawn } from "node:child_process";
import { existsSync, readFileSync, unlinkSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { ProxyAgent, fetch as undiciFetch } from "undici";

const GROQ_URL = "https://api.groq.com/openai/v1/audio/transcriptions";
const MAX_BYTES = 25 * 1024 * 1024;
const inflight = new Map<string, Promise<string>>();

function readSecretFile(filename: string) {
  try {
    return readFileSync(path.join(process.cwd(), filename), "utf8")
      .replace(/\r/g, "")
      .trim();
  } catch {
    return "";
  }
}

function groqApiKey() {
  const fromFile = readSecretFile(".groq-api-key");
  if (fromFile) return fromFile;
  const fromEnv = String(process.env.GROQ_API_KEY || "").trim();
  if (fromEnv) return fromEnv;
  const envFile = readSecretFile(".env");
  const match = envFile.match(/^GROQ_API_KEY\s*=\s*(.+)$/m);
  if (!match) return "";
  return match[1].trim().replace(/^["']|["']$/g, "");
}

function groqProxyUrl() {
  return (
    readSecretFile(".groq-proxy-url") ||
    String(process.env.GROQ_PROXY_URL || "").trim()
  );
}

function groqEgressProxy() {
  const raw =
    readSecretFile(".groq-egress-proxy") ||
    String(process.env.GROQ_EGRESS_PROXY || "").trim();
  const first = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);
  return first && /^https?:\/\//i.test(first) ? first : "";
}

function groqBridgeSecret() {
  return (
    readSecretFile(".groq-bridge-secret") ||
    String(process.env.GROQ_BRIDGE_SECRET || "").trim()
  );
}

function transcriptionEndpoint() {
  if (groqEgressProxy()) return GROQ_URL;
  const proxy = groqProxyUrl();
  if (!proxy) return GROQ_URL;
  if (/\/openai\//.test(proxy) || /\/transcribe\/?$/.test(proxy)) return proxy;
  return `${proxy.replace(/\/$/, "")}/openai/v1/audio/transcriptions`;
}

export function hasGroqKey() {
  const proxy = groqProxyUrl();
  const secret = groqBridgeSecret();
  if (proxy && secret) return true;
  return Boolean(groqApiKey());
}

function ffmpegToWav(input: string) {
  const out = `${input}.whisper.wav`;
  return new Promise<string | null>((resolve) => {
    const child = spawn(
      "ffmpeg",
      ["-y", "-i", input, "-ac", "1", "-ar", "16000", "-f", "wav", out],
      { stdio: ["ignore", "ignore", "pipe"], windowsHide: true },
    );
    const timer = setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch {
        /* ignore */
      }
    }, 30_000);
    child.on("error", () => {
      clearTimeout(timer);
      resolve(null);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve(code === 0 && existsSync(out) ? out : null);
    });
  });
}

function uploadName(fileName: string, filePath: string, mime?: string) {
  const fromName = path.extname(fileName);
  const fromPath = path.extname(filePath);
  const ext =
    fromName ||
    fromPath ||
    (String(mime || "").includes("mp4") || String(mime || "").includes("m4a")
      ? ".m4a"
      : String(mime || "").includes("ogg")
        ? ".ogg"
        : String(mime || "").includes("mpeg")
          ? ".mp3"
          : String(mime || "").includes("wav")
            ? ".wav"
            : ".webm");
  return `voice${ext}`;
}

export async function transcribeAudioFile(
  filePath: string,
  fileName: string,
  mime?: string,
) {
  const proxy = groqProxyUrl();
  const bridgeSecret = groqBridgeSecret();
  const key = groqApiKey();
  const endpoint = transcriptionEndpoint();
  const useVercelBridge = Boolean(proxy && bridgeSecret && !key);
  if (!useVercelBridge && !key) {
    throw new Error("GROQ_API_KEY не задан");
  }
  if (!existsSync(filePath)) {
    throw new Error("Файл не найден");
  }

  const ext = path.extname(filePath).toLowerCase();
  const converted =
    ext === ".webm" || ext === ".weba" || ext === ".ogg"
      ? await ffmpegToWav(filePath)
      : null;
  const sendPath = converted || filePath;
  const sendName = converted ? "voice.wav" : uploadName(fileName, filePath, mime);
  const sendMime = converted
    ? "audio/wav"
    : String(mime || "audio/webm").split(";")[0].trim() || "audio/webm";

  try {
    const bytes = await readFile(sendPath);
    if (!bytes.byteLength || bytes.byteLength > MAX_BYTES) {
      throw new Error("Файл слишком большой для расшифровки");
    }

    const form = new FormData();
    form.append(
      "file",
      new Blob([new Uint8Array(bytes)], { type: sendMime }),
      sendName,
    );
    form.append("model", "whisper-large-v3");
    form.append("temperature", "0");
    form.append("response_format", "json");

    const egress = groqEgressProxy();
    const headers = useVercelBridge
      ? { "x-bridge-secret": bridgeSecret }
      : { Authorization: `Bearer ${key}` };
    const response = egress
      ? await undiciFetch(endpoint, {
          method: "POST",
          headers,
          body: form,
          dispatcher: new ProxyAgent(egress),
        })
      : await fetch(endpoint, {
          method: "POST",
          headers,
          body: form,
        });
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      if (/audio_too_short|too short/i.test(detail)) {
        return "";
      }
      throw new Error(
        `Groq ${response.status}${detail ? `: ${detail.slice(0, 180)}` : ""}`,
      );
    }
    const data = (await response.json()) as { text?: string };
    const text = String(data.text || "").trim();
    if (!text || /^[\s.,!?…;:\-–—]+$/.test(text)) return "";
    return text;
  } finally {
    if (converted) {
      try {
        unlinkSync(converted);
      } catch {
        /* ignore */
      }
    }
  }
}

export function queueTranscription(
  messageId: string,
  run: () => Promise<string>,
) {
  const existing = inflight.get(messageId);
  if (existing) return existing;
  const pending = run().finally(() => inflight.delete(messageId));
  inflight.set(messageId, pending);
  return pending;
}
