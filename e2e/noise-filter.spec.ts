import { test, expect } from "@playwright/test";
import { build } from "esbuild";
import { readFile } from "node:fs/promises";
import path from "node:path";

type NoiseApi = typeof import("../src/lib/noiseFilter") & typeof import("livekit-client");
declare global { interface Window { noiseTest: NoiseApi } }

let bundle: string;
test.use({ launchOptions: { channel: "msedge", args: ["--autoplay-policy=no-user-gesture-required"] } });
test.beforeAll(async () => {
  const result = await build({
    stdin: {
      contents: 'export * from "./src/lib/noiseFilter"; export { LocalAudioTrack } from "livekit-client";',
      resolveDir: process.cwd(),
    },
    bundle: true, write: false, format: "iife", globalName: "noiseTest", platform: "browser",
  });
  bundle = result.outputFiles[0].text;
});

test.beforeEach(async ({ page }) => {
  await page.route("**/dtln-test", (route) => route.fulfill({ contentType: "text/html", body: "<title>DTLN audio test</title>" }));
  await page.context().route("**/audio/dtln-0.1.1/*", async (route) => {
    const name = new URL(route.request().url()).pathname.split("/").pop()!;
    await route.fulfill({
      contentType: name.endsWith("wasm") ? "application/wasm" : "text/javascript",
      body: await readFile(path.join(process.cwd(), "public/audio/dtln-0.1.1", name)),
    });
  });
  await page.goto("http://127.0.0.1:3000/dtln-test");
  await page.addScriptTag({ content: bundle });
});

test("DTLN loads real models, suppresses noise and toggles without replacing capture", async ({ page }) => {
  const result = await page.evaluate(async () => {
    const api = window.noiseTest;
    api.setBrowserNsStrength(0, false);
    const ctx = new AudioContext({ sampleRate: 16000 });
    await ctx.resume();
    const input = ctx.createMediaStreamDestination();
    const buffer = ctx.createBuffer(1, 16000, 16000);
    let seed = 42;
    const samples = buffer.getChannelData(0);
    for (let i = 0; i < samples.length; i++) {
      seed = (1664525 * seed + 1013904223) >>> 0;
      samples[i] = (seed / 4294967296 - 0.5) * 0.15;
    }
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    source.connect(input);
    source.start();
    const raw = input.stream.getAudioTracks()[0];
    const session = await api.startNoiseFilter(raw, "high");
    const trackId = session.outputTrack.id;
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 2048;
    ctx.createMediaStreamSource(new MediaStream([session.outputTrack])).connect(analyser);
    const data = new Float32Array(analyser.fftSize);
    const rms = async () => {
      await new Promise((r) => setTimeout(r, 800));
      analyser.getFloatTimeDomainData(data);
      return Math.sqrt(data.reduce((sum, value) => sum + value * value, 0) / data.length);
    };
    const wet = await rms();
    await session.setEnabled(false);
    const dry = await rms();
    await Promise.all([session.setEnabled(true), session.setEnabled(false), session.setEnabled(true)]);
    const enabled = session.enabled;
    const kind = session.kind;
    const sameTrack = session.outputTrack.id === trackId;
    const rawLive = raw.readyState;
    await api.stopNoiseFilter(session);
    await api.stopNoiseFilter(session);
    source.stop();
    await ctx.close();
    return { wet, dry, enabled, kind, sameTrack, rawLive, stopped: raw.readyState, outputStopped: session.outputTrack.readyState };
  });
  console.log("DTLN signal:", result);
  expect(result.kind).toBe("dtln");
  expect(result.dry).toBeGreaterThan(0.02);
  expect(result.wet).toBeLessThan(result.dry * 0.5);
  expect(result.enabled).toBe(true);
  expect(result.sameTrack).toBe(true);
  expect(result.rawLive).toBe("live");
  expect(result.stopped).toBe("ended");
  expect(result.outputStopped).toBe("ended");
});

test("missing model runtime falls back without ending the microphone", async ({ page }) => {
  await page.context().route("**/runtime.wasm", (route) => route.fulfill({ status: 503, body: "unavailable" }));
  const result = await page.evaluate(async () => {
    const ctx = new AudioContext();
    const raw = ctx.createMediaStreamDestination().stream.getAudioTracks()[0];
    const session = await window.noiseTest.startNoiseFilter(raw, "high");
    const result = { kind: session.kind, enabled: session.enabled, state: raw.readyState };
    await window.noiseTest.stopNoiseFilter(session);
    await ctx.close();
    return result;
  });
  expect(result).toEqual({ kind: "browser", enabled: true, state: "live" });
});

test("off mode stays off and does not load DTLN until enabled", async ({ page }) => {
  const requests: string[] = [];
  page.on("request", (request) => { if (request.url().includes("/audio/")) requests.push(request.url()); });
  const result = await page.evaluate(async () => {
    const ctx = new AudioContext();
    const raw = ctx.createMediaStreamDestination().stream.getAudioTracks()[0];
    raw.enabled = false;
    const session = await window.noiseTest.startNoiseFilter(raw, "off");
    const result = { enabled: session.enabled, muted: !session.outputTrack.enabled };
    await window.noiseTest.stopNoiseFilter(session);
    await ctx.close();
    return result;
  });
  expect(result).toEqual({ enabled: false, muted: true });
  expect(requests.every((url) => url.endsWith("/output.js"))).toBe(true);
});

test("LiveKit fallback teardown does not stop its original capture track", async ({ page }) => {
  const result = await page.evaluate(async () => {
    const api = window.noiseTest;
    const ctx = new AudioContext();
    const workletPrototype = Object.getPrototypeOf(ctx.audioWorklet);
    const addModule = workletPrototype.addModule;
    workletPrototype.addModule = async () => { throw new Error("AudioWorklet unavailable"); };
    const raw = ctx.createMediaStreamDestination().stream.getAudioTracks()[0];
    const track = new api.LocalAudioTrack(raw, undefined, true, ctx);
    const session = await api.attachNoiseFilterToLiveKitTrack(track, "high");
    workletPrototype.addModule = addModule;
    await api.stopNoiseFilter(session);
    const result = { kind: session.kind, rawState: raw.readyState, restored: track.mediaStreamTrack === raw };
    track.stop();
    await ctx.close();
    return result;
  });
  expect(result).toEqual({ kind: "browser", rawState: "live", restored: true });
});

test("LiveKit processor preserves disabled state and updates raw source after restart", async ({ page }) => {
  const result = await page.evaluate(async () => {
    const api = window.noiseTest;
    api.setBrowserNsStrength(0, false);
    const ctx = new AudioContext({ sampleRate: 48000 });
    const raw = ctx.createMediaStreamDestination().stream.getAudioTracks()[0];
    const replacement = ctx.createMediaStreamDestination().stream.getAudioTracks()[0];
    const track = new api.LocalAudioTrack(raw, undefined, true, ctx);
    const pc = new RTCPeerConnection();
    track.sender = pc.addTrack(raw);
    const session = await api.attachNoiseFilterToLiveKitTrack(track, "high");
    await session.setEnabled(false);
    const previousOutput = session.outputTrack;
    await track.replaceTrack(replacement, true);
    const result = {
      kind: session.kind, enabled: session.enabled,
      rawUpdated: session.sourceTrack === replacement,
      outputUpdated: session.outputTrack === track.mediaStreamTrack && previousOutput !== session.outputTrack,
      previousStopped: previousOutput.readyState,
    };
    await api.stopNoiseFilter(session);
    const stillLive = replacement.readyState;
    raw.stop();
    replacement.stop();
    track.stop();
    pc.close();
    await ctx.close();
    return { ...result, stillLive };
  });
  expect(result).toEqual({ kind: "dtln", enabled: false, rawUpdated: true, outputUpdated: true, previousStopped: "ended", stillLive: "live" });
});

test("audio remains continuous during toggles and a busy UI thread", async ({ page }) => {
  const result = await page.evaluate(async () => {
    const api = window.noiseTest;
    api.setBrowserNsStrength(0, false);
    const ctx = new AudioContext({ sampleRate: 16000 });
    await ctx.resume();
    const input = ctx.createMediaStreamDestination();
    const tone = ctx.createOscillator();
    tone.frequency.value = 220;
    const gain = ctx.createGain();
    gain.gain.value = 0.1;
    tone.connect(gain).connect(input);
    tone.start();
    // Observe the filter's render output directly. A second MediaStream bridge
    // adds its own clock correction and would confound the DSP continuity check.
    const NativeWorkletNode = window.AudioWorkletNode;
    let renderNode: AudioWorkletNode | undefined;
    window.AudioWorkletNode = class extends NativeWorkletNode {
      constructor(context: BaseAudioContext, name: string, options?: AudioWorkletNodeOptions) {
        super(context, name, options);
        // Capture the native node for a direct render-thread measurement.
        // eslint-disable-next-line @typescript-eslint/no-this-alias
        if (name === "pulse-dtln-output") renderNode = this;
      }
    };
    const session = await api.startNoiseFilter(input.stream.getAudioTracks()[0], "high");
    window.AudioWorkletNode = NativeWorkletNode;
    if (!renderNode || session.kind !== "dtln") throw new Error("DTLN did not start");
    const renderContext = renderNode.context as AudioContext;
    const moduleUrl = URL.createObjectURL(new Blob([`
      class Capture extends AudioWorkletProcessor {
        samples = new Float32Array(48000); offset = 0;
        process(inputs) {
          const input = inputs[0]?.[0];
          if (!input) return true;
          const size = Math.min(input.length, this.samples.length - this.offset);
          this.samples.set(input.subarray(0, size), this.offset);
          this.offset += size;
          if (this.offset === this.samples.length) {
            this.port.postMessage(this.samples, [this.samples.buffer]);
            return false;
          }
          return true;
        }
      }
      registerProcessor('capture-test', Capture);
    `], { type: "text/javascript" }));
    await renderContext.audioWorklet.addModule(moduleUrl);
    URL.revokeObjectURL(moduleUrl);
    const tap = new AudioWorkletNode(renderContext, "capture-test");
    const capture = new Promise<Float32Array>((resolve) => { tap.port.onmessage = (event) => resolve(event.data); });
    renderNode.connect(tap).connect(renderContext.destination);
    const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
    await wait(600);
    for (const enabled of [false, true, false, true]) {
      await session.setEnabled(enabled);
      await wait(180);
    }
    const blockedUntil = performance.now() + 300;
    while (performance.now() < blockedUntil) { /* Simulate an expensive UI render. */ }
    const samples = await capture;
    let maxJump = 0;
    let jumpIndex = 0;
    let zeroRun = 0;
    let longestZeroRun = 0;
    let finite = true;
    for (let i = 8000; i < samples.length; i++) {
      finite &&= Number.isFinite(samples[i]);
      const jump = Math.abs(samples[i] - samples[i - 1]);
      if (jump > maxJump) { maxJump = jump; jumpIndex = i; }
      zeroRun = samples[i] === 0 ? zeroRun + 1 : 0;
      longestZeroRun = Math.max(longestZeroRun, zeroRun);
    }
    await api.stopNoiseFilter(session);
    tone.stop();
    tap.disconnect();
    await ctx.close();
    return { maxJump, jumpIndex, nearJump: Array.from(samples.slice(jumpIndex - 4, jumpIndex + 5)), longestZeroRun, finite };
  });
  console.log("DTLN continuity:", result);
  expect(result.finite).toBe(true);
  expect(result.maxJump).toBeLessThan(0.03);
  expect(result.longestZeroRun).toBeLessThan(128);
});
