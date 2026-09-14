"use client";

/** Громкость звука демонстраций экрана (единая ручка в стейдже). */

const SCREEN_VOLUME_KEY = "pulse-screen-volume";

let screenVolume = 1;
let loaded = false;
const registered = new Set<HTMLAudioElement>();

function clamp(value: number) {
  return Math.min(1, Math.max(0, value));
}

export function getScreenAudioVolume(): number {
  if (!loaded) {
    loaded = true;
    try {
      const raw = Number(localStorage.getItem(SCREEN_VOLUME_KEY));
      if (Number.isFinite(raw)) screenVolume = clamp(raw);
    } catch {
      /* ignore */
    }
  }
  return screenVolume;
}

export function setScreenAudioVolume(volume: number) {
  screenVolume = clamp(volume);
  try {
    localStorage.setItem(SCREEN_VOLUME_KEY, String(screenVolume));
  } catch {
    /* ignore */
  }
  for (const element of registered) {
    element.volume = screenVolume;
  }
}

/** Регистрирует аудиоэлемент звука демонстрации (сразу применяет громкость). */
export function registerScreenAudio(element: HTMLAudioElement) {
  registered.add(element);
  element.volume = getScreenAudioVolume();
}

export function unregisterScreenAudio(element: HTMLAudioElement) {
  registered.delete(element);
}
