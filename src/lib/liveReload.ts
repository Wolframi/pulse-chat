import { hasLiveMediaSession } from "@/lib/mediaResume";

const BOOT_KEY = "pulse-boot-id";
const PENDING_KEY = "pulse-boot-pending";
const BOOT_QUERY = "_b";

function storedBootId() {
  try {
    return sessionStorage.getItem(BOOT_KEY) || "";
  } catch {
    return "";
  }
}

function writeBootId(bootId: string) {
  try {
    sessionStorage.setItem(BOOT_KEY, bootId);
  } catch {
    /* ignore */
  }
}

function pendingBootId() {
  try {
    return sessionStorage.getItem(PENDING_KEY) || "";
  } catch {
    return "";
  }
}

function writePendingBootId(bootId: string) {
  try {
    sessionStorage.setItem(PENDING_KEY, bootId);
  } catch {
    /* ignore */
  }
}

function clearPendingBootId() {
  try {
    sessionStorage.removeItem(PENDING_KEY);
  } catch {
    /* ignore */
  }
}

function stripBootQuery() {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  if (!url.searchParams.has(BOOT_QUERY)) return;
  url.searchParams.delete(BOOT_QUERY);
  const search = url.searchParams.toString();
  window.history.replaceState(
    null,
    "",
    `${url.pathname}${search ? `?${search}` : ""}${url.hash}`,
  );
}

function reloadNow(bootId: string) {
  writeBootId(bootId);
  clearPendingBootId();
  const url = new URL(window.location.href);
  url.searchParams.set(BOOT_QUERY, bootId.replace(/[^a-zA-Z0-9-]/g, "").slice(-12));
  window.location.replace(`${url.pathname}${url.search}${url.hash}`);
}

/** Reload after a deploy. During a live call wait — WebRTC stays up, then reload. */
export function applyBootId(bootId: string) {
  if (!bootId || typeof window === "undefined") return;
  const prev = storedBootId();
  if (!prev) {
    writeBootId(bootId);
    return;
  }
  if (prev === bootId) {
    clearPendingBootId();
    return;
  }
  if (hasLiveMediaSession()) {
    writePendingBootId(bootId);
    return;
  }
  reloadNow(bootId);
}

/** Call when a call/voice session ends so a postponed deploy reload can run. */
export function flushPendingBootReload() {
  if (typeof window === "undefined") return;
  if (hasLiveMediaSession()) return;
  const pending = pendingBootId();
  if (!pending) return;
  if (pending === storedBootId()) {
    clearPendingBootId();
    return;
  }
  reloadNow(pending);
}

type BootSocket = {
  on: (event: "app:boot" | "connect", fn: (payload?: { bootId?: string }) => void) => void;
  off: (event: "app:boot" | "connect", fn: (payload?: { bootId?: string }) => void) => void;
};

export function watchAppBoot(socket: BootSocket | null) {
  stripBootQuery();

  const onBoot = (payload: { bootId?: string } | undefined) => {
    if (payload?.bootId) applyBootId(payload.bootId);
  };

  const poll = async () => {
    try {
      const res = await fetch("/api/health", { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as { bootId?: string };
      if (data?.bootId) applyBootId(data.bootId);
      if (!hasLiveMediaSession()) flushPendingBootReload();
    } catch {
      /* server is bouncing */
    }
  };

  socket?.on("app:boot", onBoot);
  socket?.on("connect", poll);

  const onVisible = () => {
    if (typeof document !== "undefined" && document.hidden) return;
    void poll();
  };
  document.addEventListener("visibilitychange", onVisible);
  window.addEventListener("online", onVisible);
  window.addEventListener("focus", onVisible);

  void poll();
  const timer = window.setInterval(() => {
    void poll();
  }, 2_000);

  return () => {
    window.clearInterval(timer);
    socket?.off("app:boot", onBoot);
    socket?.off("connect", poll);
    document.removeEventListener("visibilitychange", onVisible);
    window.removeEventListener("online", onVisible);
    window.removeEventListener("focus", onVisible);
  };
}
