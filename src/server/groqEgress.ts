import { spawn } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { FormData as UndiciFormData, ProxyAgent, fetch as undiciFetch } from "undici";

const LIST_URL =
  "https://raw.githubusercontent.com/TheSpeedX/SOCKS-List/master/http.txt";
const GROQ_MODELS = "https://api.groq.com/openai/v1/models";
const CACHE_FILE = ".groq-egress-proxy";
const SCAN_MS = 40_000;
const WORKERS = 28;
const MAX_CANDIDATES = 400;
const KEEP_SPARE = 3;

const dead = new Set<string>();
const spare: string[] = [];
let cached = "";
let picking: Promise<string> | null = null;
let lastOkAt = 0;

function cachePath() {
  return path.join(process.cwd(), CACHE_FILE);
}

function normalizeProxy(value: string) {
  const line = value.trim();
  if (/^https?:\/\/\d{1,3}(?:\.\d{1,3}){3}:\d{2,5}$/i.test(line)) return line;
  if (/^\d{1,3}(?:\.\d{1,3}){3}:\d{2,5}$/.test(line)) return `http://${line}`;
  return "";
}

function readCached() {
  if (cached) return cached;
  try {
    const fromFile = normalizeProxy(readFileSync(cachePath(), "utf8"));
    if (fromFile && !dead.has(fromFile)) cached = fromFile;
  } catch {
    /* no cache */
  }
  const fromEnv = normalizeProxy(String(process.env.GROQ_EGRESS_PROXY || ""));
  if (!cached && fromEnv && !dead.has(fromEnv)) cached = fromEnv;
  return cached;
}

function persist(proxy: string) {
  cached = proxy;
  try {
    writeFileSync(cachePath(), `${proxy}\n`, { encoding: "utf8", mode: 0o600 });
  } catch {
    /* ignore */
  }
}

function shuffle<T>(items: T[]) {
  for (let i = items.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    const swap = items[i];
    items[i] = items[j]!;
    items[j] = swap!;
  }
  return items;
}

export async function groqFetch(
  url: string,
  init: {
    method?: string;
    headers?: Record<string, string>;
    body?: UndiciFormData;
  },
  proxy: string,
) {
  return undiciFetch(url, {
    method: init.method || "GET",
    headers: init.headers,
    body: init.body,
    dispatcher: new ProxyAgent(proxy),
    signal: AbortSignal.timeout(60_000),
  } as Parameters<typeof undiciFetch>[1]);
}

export function probeGroqProxy(proxy: string) {
  return new Promise<boolean>((resolve) => {
    const child = spawn(
      "curl",
      [
        "-sS",
        "-o",
        "/dev/null",
        "-w",
        "%{http_code}",
        "--connect-timeout",
        "4",
        "--max-time",
        "7",
        "-x",
        proxy,
        GROQ_MODELS,
      ],
      { windowsHide: true, stdio: ["ignore", "pipe", "ignore"] },
    );
    let out = "";
    const timer = setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch {
        /* ignore */
      }
    }, 8_000);
    child.stdout?.on("data", (chunk) => {
      out += String(chunk);
    });
    child.on("error", () => {
      clearTimeout(timer);
      resolve(false);
    });
    child.on("close", () => {
      clearTimeout(timer);
      const code = out.trim();
      resolve(code === "401" || code === "200");
    });
  });
}

async function loadList() {
  const response = await fetch(LIST_URL, {
    headers: { "User-Agent": "pulse-groq-egress" },
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) {
    throw new Error(`Список прокси ${response.status}`);
  }
  const text = await response.text();
  const proxies = new Set<string>();
  for (const line of text.split(/\r?\n/)) {
    const proxy = normalizeProxy(line);
    if (proxy && !dead.has(proxy)) proxies.add(proxy);
  }
  return shuffle([...proxies]).slice(0, MAX_CANDIDATES);
}

async function pickFromList() {
  const candidates = await loadList();
  if (!candidates.length) {
    throw new Error("Список HTTP-прокси пуст");
  }
  const found: string[] = [];
  let next = 0;
  const started = Date.now();

  async function worker() {
    while (found.length < KEEP_SPARE && Date.now() - started < SCAN_MS) {
      const index = next;
      next += 1;
      const proxy = candidates[index];
      if (!proxy) return;
      if (await probeGroqProxy(proxy)) {
        found.push(proxy);
        continue;
      }
      dead.add(proxy);
    }
  }

  await Promise.all(Array.from({ length: WORKERS }, () => worker()));
  const [first, ...rest] = found;
  if (!first) {
    throw new Error("Не нашёлся живой HTTP-прокси до Groq");
  }
  spare.length = 0;
  spare.push(...rest);
  persist(first);
  console.log(`[groq-egress] picked ${first} (+${rest.length} spare)`);
  return first;
}

export function invalidateGroqEgress(proxy?: string) {
  const gone = normalizeProxy(proxy || cached);
  if (gone) dead.add(gone);
  if (cached === gone) cached = "";
  lastOkAt = 0;
}

export function markGroqEgressOk(proxy: string) {
  persist(proxy);
  lastOkAt = Date.now();
}

export async function resolveGroqEgress(refresh = false) {
  if (refresh) {
    const next = spare.shift();
    if (next) {
      persist(next);
      return next;
    }
  } else {
    const current = readCached();
    if (current && Date.now() - lastOkAt < 10 * 60_000) return current;
    if (current) {
      if (await probeGroqProxy(current)) {
        lastOkAt = Date.now();
        return current;
      }
      invalidateGroqEgress(current);
    }
    const next = spare.shift();
    if (next) {
      persist(next);
      return next;
    }
  }
  if (picking) return picking;
  picking = pickFromList().finally(() => {
    picking = null;
  });
  return picking;
}
