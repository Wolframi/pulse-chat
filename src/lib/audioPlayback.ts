"use client";

import type { ChatMessage } from "@/lib/types";
import {
  audioDisplayName,
  bareMediaUrl,
  isAudioAttachment,
  isLocalMediaUrl,
  isVoiceNote,
  messageAttachments,
  signedMediaSrc,
  mediaSrc,
} from "@/lib/files";

export const PLAYBACK_RATES = [1, 1.5, 2, 0.5] as const;
export type PlaybackRate = (typeof PLAYBACK_RATES)[number];

export type AudioKind = "voice" | "audio";

export type AudioTrack = {
  id: string;
  messageId: string;
  roomId: string;
  src: string;
  kind: AudioKind;
  title: string;
  author: string;
  createdAt: number;
};

export type AudioPlaybackState = {
  current: AudioTrack | null;
  playing: boolean;
  currentTime: number;
  duration: number;
  playbackRate: number;
  volume: number;
  visible: boolean;
  /** Playback is wanted but the element is waiting for data (seek into unloaded range, slow network). */
  buffering: boolean;
};

const RATE_KEY = "pulse-audio-rate";
/** v2: v1 could hold a bogus 0 persisted by the old null → 0 read. */
const VOLUME_KEY = "pulse-audio-volume-v2";

const listeners = new Set<() => void>();
const roomTracks = new Map<string, AudioTrack[]>();
const failedSrcs = new Set<string>();
const FAILED_SRCS_MAX = 300;
const warmedSrcs = new Set<string>();
const prefetching = new Set<string>();
const prefetchQueue: string[] = [];
const warmers = new Map<string, HTMLAudioElement>();
const MAX_PREFETCH = 1;

let audioEl: HTMLAudioElement | null = null;
let playbackCtx: AudioContext | null = null;
let mediaSource: MediaElementAudioSourceNode | null = null;
let voiceGain: GainNode | null = null;
let musicGain: GainNode | null = null;
let pendingSeek: number | null = null;
let lastTimeEmit = 0;
let bound = false;
let closing = false;
let lastAudibleVolume = 1;
let durationSource: "none" | "media" | "decoded" = "none";
let clockWall = 0;
let clockMedia = 0;
let clockRate = 1;

/** No forward progress for this long while playback is wanted → reload the source. */
const STALL_MS = 7000;
const MAX_RECOVERIES = 3;
/** From this attempt on, fetch the whole file into a blob (fixes seeking in cue-less WebM voice notes). */
const BLOB_FALLBACK_ATTEMPT = 2;
const BLOB_FALLBACK_MAX_BYTES = 40 * 1024 * 1024;

let wantPlay = false;
let recovering = false;
let recoveries = 0;
let autoAdvanced = false;
let watchdog = 0;
let lastProgressAt = 0;
let lastProgressTime = -1;
let blobSrc: string | null = null;

function readStoredRate(): number {
  if (typeof window === "undefined") return 1;
  try {
    const raw = Number(localStorage.getItem(RATE_KEY));
    return PLAYBACK_RATES.includes(raw as PlaybackRate) ? raw : 1;
  } catch {
    return 1;
  }
}

function readStoredVolume(): number {
  if (typeof window === "undefined") return 1;
  try {
    const stored = localStorage.getItem(VOLUME_KEY);
    // Number(null) === 0 — a first visit must not start muted.
    if (stored == null || stored.trim() === "") return 1;
    const raw = Number(stored);
    if (!Number.isFinite(raw)) return 1;
    return Math.min(1, Math.max(0, raw));
  } catch {
    return 1;
  }
}

let state: AudioPlaybackState = {
  current: null,
  playing: false,
  currentTime: 0,
  duration: 0,
  playbackRate: 1,
  volume: 1,
  visible: false,
  buffering: false,
};

function emit() {
  listeners.forEach((listener) => listener());
}

function patch(partial: Partial<AudioPlaybackState>) {
  state = { ...state, ...partial };
  emit();
}

function persistPrefs() {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(RATE_KEY, String(state.playbackRate));
    localStorage.setItem(VOLUME_KEY, String(state.volume));
  } catch {
    /* ignore */
  }
}

export function audioTrackId(messageId: string, url: string) {
  return `${messageId}:${bareMediaUrl(url)}`;
}

export function collectRoomAudioTracks(messages: ChatMessage[]): AudioTrack[] {
  const tracks: AudioTrack[] = [];
  for (const message of messages) {
    if (message.kind === "system" || message.kind === "call") continue;
    for (const file of messageAttachments(message)) {
      if (!isAudioAttachment(file) || !file.url) continue;
      const src = signedMediaSrc(file.url) || mediaSrc(file.url);
      if (!src) continue;
      tracks.push({
        id: audioTrackId(message.clientKey || message.id, file.url),
        messageId: message.id,
        roomId: message.room,
        src,
        kind: isVoiceNote(file) ? "voice" : "audio",
        title: audioDisplayName(file),
        author: message.author,
        createdAt: message.createdAt,
      });
    }
  }
  return tracks;
}

export function resolvePlayableSrc(src: string) {
  return src;
}

function readMediaDuration(audio: HTMLAudioElement) {
  const reported = audio.duration;
  if (Number.isFinite(reported) && reported > 0) return reported;
  try {
    if (audio.seekable.length > 0) {
      const end = audio.seekable.end(audio.seekable.length - 1);
      if (Number.isFinite(end) && end > 0) return end;
    }
  } catch {
    /* ignore */
  }
  return 0;
}

function adoptDuration(next: number, source: "media" | "decoded" = "media") {
  if (!Number.isFinite(next) || next <= 0) return;
  const prev = state.duration;
  const time = audioEl && !closing ? audioEl.currentTime : state.currentTime;
  if (!prev) {
    durationSource = source;
    patch({ duration: next });
    return;
  }
  if (source === "decoded") {
    if (time > next + 0.35) return;
    if (durationSource === "decoded") {
      if (Math.abs(next - prev) < 0.05) return;
      if (next > prev + 0.15) return;
    }
    durationSource = "decoded";
    patch({ duration: next });
    return;
  }
  if (durationSource === "decoded") return;
  if (time > 0.35) return;
  if (Math.abs(next - prev) / prev > 0.04) return;
  if (Math.abs(next - prev) < 0.02) return;
  patch({ duration: next });
}

export function lockPlaybackDuration(seconds: number) {
  adoptDuration(seconds, "decoded");
}

function nowMs() {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

export function resetPlaybackClock(time?: number) {
  clockWall = nowMs();
  clockMedia = time ?? (audioEl && !closing ? audioEl.currentTime : state.currentTime);
  clockRate = audioEl?.playbackRate || state.playbackRate || 1;
}

export function getLivePlaybackTime() {
  const audio = audioEl;
  if (audio && state.current && !closing && audio.src) {
    return {
      currentTime: pendingSeek ?? audio.currentTime,
      duration: state.duration,
      playing:
        !audio.paused &&
        !audio.ended &&
        !audio.seeking &&
        audio.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA,
      rate: audio.playbackRate || 1,
    };
  }
  return {
    currentTime: state.currentTime,
    duration: state.duration,
    playing: state.playing,
    rate: state.playbackRate || 1,
  };
}

export function getSmoothPlaybackTime() {
  const live = getLivePlaybackTime();
  const duration = state.duration;
  const rate = live.rate || 1;
  const wall = nowMs();

  if (!live.playing) {
    const seeking = Boolean(audioEl && !closing && audioEl.seeking);
    if (seeking && clockWall) {
      return { currentTime: clockMedia, duration, playing: false, rate };
    }
    clockMedia = live.currentTime;
    clockWall = wall;
    clockRate = rate;
    return { currentTime: live.currentTime, duration, playing: false, rate };
  }

  if (!clockWall || Math.abs(clockRate - rate) > 0.001) {
    clockMedia = live.currentTime;
    clockWall = wall;
    clockRate = rate;
  }

  let time = clockMedia + ((wall - clockWall) / 1000) * clockRate;
  if (duration > 0 && time > duration) time = duration;
  if (time < 0) time = 0;
  return { currentTime: time, duration, playing: true, rate };
}

function releaseWarmer(src: string) {
  const el = warmers.get(src);
  if (!el) return;
  warmers.delete(src);
  try {
    el.removeAttribute("src");
    el.load();
  } catch {
    /* ignore */
  }
}

function finishPrefetch(src: string) {
  if (!prefetching.has(src)) return;
  prefetching.delete(src);
  warmedSrcs.add(src);
  window.setTimeout(() => releaseWarmer(src), 400);
  const next = prefetchQueue.shift();
  if (next) prefetchAudioSrc(next);
}

export function prefetchAudioSrc(src: string) {
  if (typeof window === "undefined" || !src || failedSrcs.has(src)) return;
  if (warmedSrcs.has(src) || prefetching.has(src) || warmers.has(src)) return;
  if (state.current && sameTrackSrc(state.current.src, src) && audioEl?.src) {
    warmedSrcs.add(src);
    return;
  }
  if (prefetching.size >= MAX_PREFETCH) {
    if (!prefetchQueue.includes(src)) prefetchQueue.push(src);
    return;
  }
  prefetching.add(src);
  const el = new Audio();
  el.preload = "auto";
  el.muted = true;
  el.src = src;
  warmers.set(src, el);
  const done = () => finishPrefetch(src);
  el.addEventListener("canplaythrough", done, { once: true });
  el.addEventListener("error", done, { once: true });
  window.setTimeout(done, 5000);
}

function sameTrackSrc(a: string, b: string) {
  return a === b || bareMediaUrl(a) === bareMediaUrl(b);
}

export function setRoomAudioTracks(roomId: string, tracks: AudioTrack[]) {
  if (!roomId) return;
  roomTracks.set(roomId, tracks);
  if (state.current?.roomId === roomId) emit();
  if (state.playing) return;
  const last = tracks[tracks.length - 1];
  if (last) prefetchAudioSrc(last.src);
}

function sameTrack(a: AudioTrack, b: AudioTrack) {
  return a.id === b.id || (a.roomId === b.roomId && a.src === b.src);
}

function playlistFor(track: AudioTrack) {
  return (roomTracks.get(track.roomId) || []).filter((item) => item.kind === track.kind);
}

function indexInPlaylist(track: AudioTrack) {
  const list = playlistFor(track);
  return list.findIndex((item) => sameTrack(item, track));
}

export function peekAdjacentTrack(direction: 1 | -1, from = state.current) {
  if (!from) return null;
  const list = playlistFor(from);
  const index = indexInPlaylist(from);
  if (index < 0) return direction === 1 ? list[0] || null : null;
  return list[index + direction] || null;
}

function applyPendingSeek(audio: HTMLAudioElement) {
  if (pendingSeek == null) return;
  // Before metadata some browsers silently drop the seek; loadedmetadata retries it.
  if (audio.readyState < HTMLMediaElement.HAVE_METADATA) return;
  const duration = Number.isFinite(audio.duration) ? audio.duration : 0;
  const time = duration > 0 ? Math.min(Math.max(pendingSeek, 0), duration) : Math.max(pendingSeek, 0);
  try {
    audio.currentTime = time;
  } catch {
    /* not seekable yet */
    return;
  }
  pendingSeek = null;
  adoptDuration(readMediaDuration(audio));
  patch({ currentTime: time });
  resetPlaybackClock(time);
}

function audioContextCtor() {
  return window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
}

function ensurePlaybackGraph(audio: HTMLAudioElement) {
  if (mediaSource || typeof window === "undefined") return;
  const Ctor = audioContextCtor();
  if (!Ctor) return;
  try {
    const ctx = new Ctor();
    const source = ctx.createMediaElementSource(audio);
    const splitter = ctx.createChannelSplitter(2);
    const merger = ctx.createChannelMerger(2);
    const voice = ctx.createGain();
    const music = ctx.createGain();
    voice.gain.value = 0;
    music.gain.value = 1;
    source.connect(music);
    music.connect(ctx.destination);
    source.connect(splitter);
    splitter.connect(merger, 0, 0);
    splitter.connect(merger, 0, 1);
    splitter.connect(merger, 1, 0);
    splitter.connect(merger, 1, 1);
    merger.connect(voice);
    voice.connect(ctx.destination);
    playbackCtx = ctx;
    mediaSource = source;
    voiceGain = voice;
    musicGain = music;
  } catch {
    playbackCtx = null;
    mediaSource = null;
    voiceGain = null;
    musicGain = null;
  }
}

function setVoiceBothEars(on: boolean) {
  if (voiceGain) voiceGain.gain.value = on ? 1 : 0;
  if (musicGain) musicGain.gain.value = on ? 0 : 1;
  if (on && playbackCtx?.state === "suspended") {
    void playbackCtx.resume().catch(() => undefined);
  }
}

function setBuffering(on: boolean) {
  if (state.buffering !== on) patch({ buffering: on });
}

function releaseBlobSrc() {
  if (!blobSrc) return;
  const url = blobSrc;
  blobSrc = null;
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function markProgress(audio: HTMLAudioElement) {
  const time = audio.currentTime;
  if (Math.abs(time - lastProgressTime) < 0.01) return;
  const advancing = !audio.paused && !audio.seeking && lastProgressTime >= 0 && time > lastProgressTime;
  lastProgressTime = time;
  lastProgressAt = nowMs();
  if (advancing) {
    recoveries = 0;
    setBuffering(false);
  }
}

function touchProgress() {
  lastProgressAt = nowMs();
  lastProgressTime = audioEl?.currentTime ?? -1;
}

function stopWatchdog() {
  if (!watchdog) return;
  window.clearInterval(watchdog);
  watchdog = 0;
}

function startWatchdog() {
  touchProgress();
  if (watchdog || typeof window === "undefined") return;
  watchdog = window.setInterval(checkStall, 1000);
}

function handlePlayError(error: unknown) {
  // AbortError = src changed / load() interrupted play — a newer play() is in flight.
  // NotSupportedError comes with a media `error` event, which drives recovery itself.
  const name = (error as DOMException | null)?.name;
  if (name === "AbortError" || name === "NotSupportedError") return;
  wantPlay = false;
  stopWatchdog();
  patch({ playing: false, buffering: false });
}

function checkStall() {
  const audio = audioEl;
  if (!audio || closing || !wantPlay || !state.current) {
    stopWatchdog();
    return;
  }
  if (recovering || audio.ended) return;
  markProgress(audio);
  const stuckFor = nowMs() - lastProgressAt;
  const starving =
    audio.paused || audio.seeking || audio.readyState < HTMLMediaElement.HAVE_FUTURE_DATA;
  if (starving && stuckFor > 600) setBuffering(true);
  if (audio.paused && !audio.seeking && audio.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA) {
    void audio.play().catch(handlePlayError);
    return;
  }
  if (stuckFor > STALL_MS) void recoverPlayback();
}

async function fetchAsObjectUrl(src: string) {
  try {
    const response = await fetch(src, { cache: "no-store" });
    if (!response.ok) return null;
    const length = Number(response.headers.get("content-length") || 0);
    if (length > BLOB_FALLBACK_MAX_BYTES) {
      void response.body?.cancel().catch(() => undefined);
      return null;
    }
    const blob = await response.blob();
    if (!blob.size || blob.size > BLOB_FALLBACK_MAX_BYTES) return null;
    return URL.createObjectURL(blob);
  } catch {
    return null;
  }
}

function giveUpOnTrack(track: AudioTrack) {
  failedSrcs.add(track.src);
  if (failedSrcs.size > FAILED_SRCS_MAX) {
    // Evict the oldest failure so the set never grows unbounded.
    const oldest = failedSrcs.values().next().value;
    if (oldest) failedSrcs.delete(oldest);
  }
  wantPlay = false;
  stopWatchdog();
  patch({ playing: false, buffering: false });
  if (!autoAdvanced) return;
  const next = peekAdjacentTrack(1, track);
  if (next && next.src !== track.src && !failedSrcs.has(next.src)) {
    void playAudioTrack(next, { auto: true });
  }
}

/** Reload the current source at the current position (network hiccup, stalled seek, expired buffer). */
async function recoverPlayback() {
  const audio = audioEl;
  const track = state.current;
  if (!audio || !track || closing || recovering) return;
  if (recoveries >= MAX_RECOVERIES) {
    giveUpOnTrack(track);
    return;
  }
  recoveries += 1;
  recovering = true;
  const time = pendingSeek ?? (audio.currentTime > 0 ? audio.currentTime : state.currentTime);
  if (wantPlay) setBuffering(true);
  try {
    let src = blobSrc || track.src;
    if (!blobSrc && recoveries >= BLOB_FALLBACK_ATTEMPT && !isLocalMediaUrl(track.src)) {
      const objectUrl = await fetchAsObjectUrl(track.src);
      if (state.current !== track || closing) {
        if (objectUrl) URL.revokeObjectURL(objectUrl);
        return;
      }
      if (objectUrl) {
        blobSrc = objectUrl;
        src = objectUrl;
      }
    }
    pendingSeek = time > 0 ? time : null;
    audio.src = src;
    audio.defaultPlaybackRate = state.playbackRate;
    audio.playbackRate = state.playbackRate;
    audio.volume = state.volume;
    touchProgress();
    if (wantPlay) await audio.play().catch(handlePlayError);
  } finally {
    recovering = false;
  }
}

function bindAudio(audio: HTMLAudioElement) {
  if (bound) return;
  bound = true;
  audio.preload = "auto";
  audio.preservesPitch = true;
  audio.addEventListener("loadedmetadata", () => {
    if (closing) return;
    applyPendingSeek(audio);
    adoptDuration(readMediaDuration(audio));
  });
  audio.addEventListener("waiting", () => {
    if (closing || !wantPlay) return;
    setBuffering(true);
    startWatchdog();
  });
  audio.addEventListener("stalled", () => {
    if (closing || !wantPlay) return;
    startWatchdog();
  });
  audio.addEventListener("seeking", () => {
    if (closing) return;
    touchProgress();
  });
  audio.addEventListener("seeked", () => {
    if (closing) return;
    resetPlaybackClock();
    touchProgress();
    if (wantPlay && audio.paused && !audio.ended) {
      void audio.play().catch(handlePlayError);
    }
  });
  audio.addEventListener("canplay", () => {
    if (closing) return;
    applyPendingSeek(audio);
    if (wantPlay && audio.paused && !audio.seeking && !recovering) {
      void audio.play().catch(handlePlayError);
    }
  });
  audio.addEventListener("playing", () => {
    if (closing) return;
    resetPlaybackClock();
    touchProgress();
    setBuffering(false);
  });
  audio.addEventListener("durationchange", () => {
    if (closing) return;
    adoptDuration(readMediaDuration(audio));
  });
  audio.addEventListener("timeupdate", () => {
    if (closing) return;
    markProgress(audio);
    if (pendingSeek != null) return;
    const now = typeof performance !== "undefined" ? performance.now() : Date.now();
    const minGap = audio.playbackRate > 1.2 ? 220 : 160;
    if (now - lastTimeEmit < minGap && !audio.paused) return;
    lastTimeEmit = now;
    adoptDuration(readMediaDuration(audio));
    patch({
      currentTime: audio.currentTime,
      duration: state.duration || readMediaDuration(audio),
    });
  });
  audio.addEventListener("play", () => {
    if (closing) return;
    if (playbackCtx?.state === "suspended") {
      void playbackCtx.resume().catch(() => undefined);
    }
    wantPlay = true;
    startWatchdog();
    resetPlaybackClock();
    patch({ playing: true, visible: true });
  });
  audio.addEventListener("pause", () => {
    if (closing || audio.ended) return;
    if (recovering) return;
    wantPlay = false;
    stopWatchdog();
    patch({
      playing: false,
      buffering: false,
      currentTime: pendingSeek ?? audio.currentTime,
    });
  });
  audio.addEventListener("ended", () => {
    if (closing) return;
    wantPlay = false;
    stopWatchdog();
    const next = peekAdjacentTrack(1);
    if (next) {
      void playAudioTrack(next, { auto: true });
      return;
    }
    patch({ playing: false, buffering: false, currentTime: 0 });
    try {
      audio.currentTime = 0;
    } catch {
      /* ignore */
    }
  });
  audio.addEventListener("error", () => {
    if (closing || !state.current || !audio.getAttribute("src")) return;
    if (recovering) {
      window.setTimeout(() => void recoverPlayback(), 400);
      return;
    }
    void recoverPlayback();
  });
}

function getAudio() {
  if (typeof window === "undefined") return null;
  if (!audioEl) {
    audioEl = new Audio();
    bindAudio(audioEl);
    ensurePlaybackGraph(audioEl);
    audioEl.playbackRate = state.playbackRate;
    audioEl.volume = state.volume;
  }
  return audioEl;
}

function hydratePrefs() {
  if (typeof window === "undefined") return;
  const playbackRate = readStoredRate();
  const volume = readStoredVolume();
  if (playbackRate !== state.playbackRate || volume !== state.volume) {
    state = { ...state, playbackRate, volume };
  }
  const audio = getAudio();
  if (audio) {
    audio.playbackRate = playbackRate;
    audio.volume = volume;
  }
}

if (typeof window !== "undefined") hydratePrefs();

export function subscribeAudioPlayback(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getAudioPlaybackState() {
  return state;
}

export function getAudioPlaybackServerState(): AudioPlaybackState {
  return {
    current: null,
    playing: false,
    currentTime: 0,
    duration: 0,
    playbackRate: 1,
    volume: 1,
    visible: false,
    buffering: false,
  };
}

function probeExactDuration(src: string) {
  if (typeof window === "undefined" || !src) return;
  const probe = new Audio();
  probe.preload = "auto";
  let settled = false;
  const finish = (seconds: number) => {
    if (settled) return;
    settled = true;
    try {
      probe.removeAttribute("src");
      probe.load();
    } catch {
      /* ignore */
    }
    if (seconds > 0.05 && seconds < 7200 && state.current?.src === src) {
      adoptDuration(seconds, "decoded");
    }
  };
  probe.addEventListener("loadedmetadata", () => {
    try {
      probe.currentTime = 1e10;
    } catch {
      finish(readMediaDuration(probe));
    }
  });
  probe.addEventListener("seeked", () => finish(probe.currentTime));
  probe.addEventListener("error", () => finish(0));
  window.setTimeout(() => finish(readMediaDuration(probe)), 6000);
  probe.src = src;
}

export async function playAudioTrack(
  track: AudioTrack,
  opts?: { time?: number; auto?: boolean },
) {
  closing = false;
  const audio = getAudio();
  if (!audio) return;
  ensurePlaybackGraph(audio);
  setVoiceBothEars(track.kind === "voice");
  if (playbackCtx?.state === "suspended") {
    void playbackCtx.resume().catch(() => undefined);
  }
  // An explicit tap always gets a fresh chance, even if this file failed earlier.
  if (!opts?.auto) failedSrcs.delete(track.src);

  const same =
    state.current &&
    sameTrack(state.current, track) &&
    audio.src &&
    !audio.error;

  if (opts?.time != null) pendingSeek = opts.time;
  wantPlay = true;
  startWatchdog();

  if (same) {
    if (!opts?.auto) recoveries = 0;
    applyPendingSeek(audio);
    if (audio.paused) await audio.play().catch(handlePlayError);
    return;
  }

  const list = playlistFor(track);
  const fresh = list.find((item) => sameTrack(item, track)) || track;

  autoAdvanced = Boolean(opts?.auto);
  recoveries = 0;
  durationSource = "none";
  resetPlaybackClock(opts?.time ?? 0);
  patch({
    current: fresh,
    visible: true,
    playing: false,
    buffering: true,
    currentTime: opts?.time ?? 0,
    duration: 0,
  });

  audio.pause();
  audio.preload = "auto";
  audio.preservesPitch = true;
  releaseWarmer(fresh.src);
  audio.src = fresh.src;
  releaseBlobSrc();
  audio.defaultPlaybackRate = state.playbackRate;
  audio.playbackRate = state.playbackRate;
  audio.volume = state.volume;
  applyPendingSeek(audio);
  if (fresh.kind === "voice") probeExactDuration(fresh.src);
  const upcoming = peekAdjacentTrack(1, fresh);
  if (upcoming) prefetchAudioSrc(upcoming.src);

  await audio.play().catch(handlePlayError);
}

export function toggleAudioPlayback() {
  const audio = getAudio();
  if (!audio || !state.current) return;
  if (audio.paused) {
    wantPlay = true;
    startWatchdog();
    if (audio.error || !audio.currentSrc || audio.networkState === HTMLMediaElement.NETWORK_NO_SOURCE) {
      failedSrcs.delete(state.current.src);
      recoveries = 0;
      void recoverPlayback();
      return;
    }
    void audio.play().catch(handlePlayError);
    return;
  }
  wantPlay = false;
  stopWatchdog();
  audio.pause();
}

export function seekAudioPlayback(time: number) {
  const audio = getAudio();
  pendingSeek = Math.max(time, 0);
  resetPlaybackClock(pendingSeek);
  patch({ currentTime: pendingSeek });
  if (!audio?.src) return;
  if (audio.error) {
    recoveries = 0;
    void recoverPlayback();
    return;
  }
  // Seeking into an unloaded range can hang; give the watchdog a fresh window.
  if (wantPlay) startWatchdog();
  applyPendingSeek(audio);
}

export function setAudioPlaybackRate(rate: number) {
  const next = PLAYBACK_RATES.includes(rate as PlaybackRate) ? rate : 1;
  const audio = getAudio();
  if (audio) {
    audio.preservesPitch = true;
    audio.playbackRate = next;
  }
  resetPlaybackClock();
  patch({ playbackRate: next });
  persistPrefs();
}

export function cycleAudioPlaybackRate() {
  const idx = PLAYBACK_RATES.indexOf(state.playbackRate as PlaybackRate);
  const next = PLAYBACK_RATES[(idx + 1) % PLAYBACK_RATES.length];
  setAudioPlaybackRate(next);
}

export function setAudioVolume(volume: number) {
  const next = Math.min(1, Math.max(0, Number(volume.toFixed(2))));
  if (next > 0) lastAudibleVolume = next;
  const audio = getAudio();
  if (audio) audio.volume = next;
  patch({ volume: next });
  persistPrefs();
}

export function toggleAudioMute() {
  if (state.volume > 0) {
    lastAudibleVolume = state.volume;
    setAudioVolume(0);
    return;
  }
  setAudioVolume(lastAudibleVolume > 0 ? lastAudibleVolume : 1);
}

export function skipAudioPlayback(direction: 1 | -1) {
  const next = peekAdjacentTrack(direction);
  if (!next) return;
  void playAudioTrack(next);
}

export function stopAudioPlayback() {
  closing = true;
  wantPlay = false;
  autoAdvanced = false;
  recoveries = 0;
  stopWatchdog();
  pendingSeek = null;
  durationSource = "none";
  resetPlaybackClock(0);
  const audio = getAudio();
  if (audio) {
    audio.pause();
    audio.removeAttribute("src");
    audio.load();
  }
  releaseBlobSrc();
  patch({
    current: null,
    playing: false,
    buffering: false,
    currentTime: 0,
    duration: 0,
    visible: false,
  });
}

export function formatPlaybackTime(seconds: number) {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const total = Math.floor(seconds);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}
