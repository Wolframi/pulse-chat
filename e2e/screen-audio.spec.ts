import { expect, test } from "@playwright/test";
import { build } from "esbuild";

declare global {
  interface Window {
    screenAudioTest: typeof import("../src/lib/webrtcMedia");
  }
}

let bundle: string;
test.use({ channel: "msedge" });

test.beforeAll(async () => {
  const result = await build({
    entryPoints: ["src/lib/webrtcMedia.ts"],
    bundle: true,
    write: false,
    format: "iife",
    globalName: "screenAudioTest",
    platform: "browser",
  });
  bundle = result.outputFiles[0].text;
});

test.beforeEach(async ({ page }) => {
  await page.route("**/screen-audio-test", (route) =>
    route.fulfill({ contentType: "text/html", body: "<title>Screen audio test</title>" }),
  );
  await page.goto("http://127.0.0.1:3000/screen-audio-test");
  await page.addScriptTag({ content: bundle });
});

const cases = [
  { name: "keeps isolated system audio", surface: "monitor", supported: true, initial: true, result: "ignored", keep: true },
  { name: "waits for system audio isolation before returning the stream", surface: "monitor", supported: true, initial: false, result: "applied", keep: true },
  { name: "drops system audio when isolation rejects", surface: "monitor", supported: true, initial: false, result: "rejected", keep: false },
  { name: "drops system audio when the browser ignores isolation", surface: "monitor", supported: true, initial: false, result: "ignored", keep: false },
  { name: "drops window loopback when isolation is unavailable", surface: "window", supported: false, initial: false, result: "ignored", keep: false },
  { name: "keeps another tab's content audio on older browsers", surface: "browser", supported: false, initial: false, result: "ignored", keep: true },
  { name: "does not trust an unknown capture source", surface: undefined, supported: false, initial: false, result: "ignored", keep: false },
  { name: "sanitizes audio returned by the compatibility fallback", surface: "monitor", supported: true, initial: false, result: "ignored", keep: false, fallback: true },
] as const;

for (const scenario of cases) {
  test(scenario.name, async ({ page }) => {
    const result = await page.evaluate(async (scenario) => {
      const ctx = new AudioContext();
      const audio = ctx.createMediaStreamDestination().stream.getAudioTracks()[0];
      const video = document.createElement("canvas").captureStream().getVideoTracks()[0];
      const stream = new MediaStream([video, audio]);
      let restricted = scenario.initial;
      let applied = false;
      const requests: (DisplayMediaStreamOptions & {
        systemAudio?: string;
        selfBrowserSurface?: string;
      })[] = [];
      Object.defineProperty(video, "getSettings", {
        value: () => ({ displaySurface: scenario.surface }),
      });
      Object.defineProperty(audio, "getSettings", {
        value: () => ({ restrictOwnAudio: restricted }),
      });
      Object.defineProperty(audio, "applyConstraints", {
        value: async () => {
          await new Promise((resolve) => setTimeout(resolve, 30));
          applied = true;
          if (scenario.result === "rejected") {
            throw new DOMException("Cannot isolate", "OverconstrainedError");
          }
          if (scenario.result === "applied") restricted = true;
        },
      });
      Object.defineProperty(navigator.mediaDevices, "getSupportedConstraints", {
        value: () => ({ restrictOwnAudio: scenario.supported }),
      });
      Object.defineProperty(navigator.mediaDevices, "getDisplayMedia", {
        value: async (options: DisplayMediaStreamOptions) => {
          requests.push(options);
          if ("fallback" in scenario && scenario.fallback && requests.length === 1) {
            throw new TypeError("Unsupported audio options");
          }
          return stream;
        },
      });
      try {
        const captured = await window.screenAudioTest.captureScreenShare();
        return {
          audioCount: captured.getAudioTracks().length,
          audioState: audio.readyState,
          videoState: video.readyState,
          applied,
          requests,
        };
      } finally {
        stream.getTracks().forEach((track) => track.stop());
        await ctx.close();
      }
    }, scenario);

    expect(result.audioCount).toBe(scenario.keep ? 1 : 0);
    expect(result.audioState).toBe(scenario.keep ? "live" : "ended");
    expect(result.videoState).toBe("live");
    expect(result.applied).toBe(scenario.surface !== "browser" && !scenario.initial);
    expect(result.requests).toHaveLength("fallback" in scenario ? 2 : 1);
    for (const request of result.requests) {
      expect(request.systemAudio).toBe(scenario.supported ? "include" : "exclude");
      expect(request.selfBrowserSurface).toBe("exclude");
    }
  });
}

test("does not reopen the picker after cancellation", async ({ page }) => {
  const result = await page.evaluate(async () => {
    let requests = 0;
    Object.defineProperty(navigator.mediaDevices, "getDisplayMedia", {
      value: async () => {
        requests++;
        throw new DOMException("Cancelled", "NotAllowedError");
      },
    });
    try {
      await window.screenAudioTest.captureScreenShare();
      return { requests, error: null };
    } catch (error) {
      return { requests, error: (error as DOMException).name };
    }
  });
  expect(result).toEqual({ requests: 1, error: "NotAllowedError" });
});
