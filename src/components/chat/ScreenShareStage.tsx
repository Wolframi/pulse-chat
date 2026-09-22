"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  IconChevronLeft,
  IconChevronRight,
  IconExpand,
  IconVolume,
  IconVolumeOff,
} from "@/lib/icons";
import { MediaVideo } from "@/components/chat/MediaVideo";
import {
  getScreenAudioVolume,
  setScreenAudioVolume,
} from "@/lib/screenAudio";

export type ScreenSource = {
  id: string;
  label: string;
  stream: MediaStream;
};

function ScreenPane({
  source,
  hideBadge = false,
}: {
  source: ScreenSource;
  hideBadge?: boolean;
}) {
  const paneRef = useRef<HTMLDivElement>(null);

  const toggleFullscreen = () => {
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => undefined);
    } else {
      paneRef.current?.requestFullscreen().catch(() => undefined);
    }
  };

  return (
    <div
      ref={paneRef}
      className="call__screen-pane"
      onDoubleClick={toggleFullscreen}
      title="Двойное нажатие — на весь экран"
    >
      <MediaVideo stream={source.stream} className="call__main is-screen" />
      {hideBadge ? null : (
        <em className="call__stage-badge">{source.label}</em>
      )}
      <button
        type="button"
        className="call__screen-fs"
        aria-label={`${source.label} на весь экран`}
        title="Во весь экран"
        onClick={toggleFullscreen}
      >
        <IconExpand size={16} />
      </button>
      <div className="call__screen-vol">
        <ScreenVolumeKnob owner={source.id} label={source.label} />
      </div>
    </div>
  );
}

function sourceHasLiveVideo(source: ScreenSource) {
  return source.stream
    .getVideoTracks()
    .some((track) => track.readyState === "live");
}

/** Ручка громкости демонстрации — своя на каждую демонстрацию. */
export function ScreenVolumeKnob({
  owner,
  label,
}: {
  owner?: string;
  label?: string;
}) {
  const [volume, setVolume] = useState(() => getScreenAudioVolume(owner));
  const [open, setOpen] = useState(false);
  const dragRef = useRef(false);
  const leaveTimerRef = useRef<number | null>(null);
  const lastVolumeRef = useRef(getScreenAudioVolume(owner) || 1);

  const apply = useCallback(
    (value: number) => {
      const next = Math.min(1, Math.max(0, Number(value.toFixed(2))));
      setVolume(next);
      setScreenAudioVolume(next, owner);
    },
    [owner],
  );

  const seekFromClientY = useCallback(
    (clientY: number, target: HTMLElement) => {
      const rect = target.getBoundingClientRect();
      const ratio = 1 - (clientY - rect.top) / Math.max(1, rect.height);
      apply(ratio);
    },
    [apply],
  );

  const muted = volume <= 0;
  const percent = Math.round(volume * 100);
  const name = label ? ` демонстрации «${label}»` : " демонстрации";

  return (
    <div
      className={`screen-vol ${open ? "is-open" : ""}`}
      onPointerEnter={() => {
        if (leaveTimerRef.current) window.clearTimeout(leaveTimerRef.current);
        setOpen(true);
      }}
      onPointerLeave={() => {
        if (dragRef.current) return;
        leaveTimerRef.current = window.setTimeout(() => setOpen(false), 140);
      }}
    >
      <button
        type="button"
        className="screen-vol__icon"
        aria-label={`Громкость${name}`}
        title={`Громкость${name}`}
        onClick={() => {
          if (muted) {
            apply(lastVolumeRef.current > 0 ? lastVolumeRef.current : 1);
          } else {
            lastVolumeRef.current = volume;
            apply(0);
          }
        }}
      >
        {muted ? <IconVolumeOff size={16} /> : <IconVolume size={16} />}
      </button>
      <div className="screen-vol__pop">
        <span>{percent}</span>
        <div
          className="screen-vol__track"
          role="slider"
          aria-label={`Громкость${name}`}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percent}
          aria-orientation="vertical"
          onPointerDown={(event) => {
            dragRef.current = true;
            event.currentTarget.setPointerCapture(event.pointerId);
            seekFromClientY(event.clientY, event.currentTarget);
          }}
          onPointerMove={(event) => {
            if (!dragRef.current) return;
            seekFromClientY(event.clientY, event.currentTarget);
          }}
          onPointerUp={() => {
            dragRef.current = false;
          }}
          onPointerCancel={() => {
            dragRef.current = false;
          }}
        >
          <i style={{ height: `${percent}%` }} />
        </div>
      </div>
    </div>
  );
}

/** Hidden sinks so screen tracks keep decoding while the stage is unmounted. */
export function ScreenShareKeepalive({ sources }: { sources: ScreenSource[] }) {
  const live = sources.filter(sourceHasLiveVideo);
  if (!live.length) return null;
  return (
    <div className="call__screen-keepalive" aria-hidden>
      {live.map((source) => (
        <MediaVideo key={source.id} stream={source.stream} />
      ))}
    </div>
  );
}

export function ScreenShareStage({ sources }: { sources: ScreenSource[] }) {
  const liveSources = sources.filter(sourceHasLiveVideo);
  const [index, setIndex] = useState(0);
  const count = liveSources.length;
  const safeIndex = count === 0 ? 0 : Math.min(index, count - 1);
  const current = liveSources[safeIndex];

  useEffect(() => {
    if (index > 0 && index >= count) setIndex(Math.max(0, count - 1));
  }, [count, index]);

  if (!current) return null;

  const multi = count > 1;

  return (
    <div className="call__screens">
      {multi ? (
        <div
          className="call__screens-switcher"
          role="navigation"
          aria-label="Демонстрации экрана"
        >
          <button
            type="button"
            className="call__screens-arrow"
            aria-label="Предыдущая демонстрация"
            onClick={() => setIndex((value) => (value - 1 + count) % count)}
          >
            <IconChevronLeft size={18} />
          </button>
          <span className="call__screens-label">
            {current.label}
            <em>
              {safeIndex + 1}/{count}
            </em>
          </span>
          <button
            type="button"
            className="call__screens-arrow"
            aria-label="Следующая демонстрация"
            onClick={() => setIndex((value) => (value + 1) % count)}
          >
            <IconChevronRight size={18} />
          </button>
        </div>
      ) : null}
      <ScreenPane source={current} hideBadge={multi} />
    </div>
  );
}
