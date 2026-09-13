"use client";

import { useState, type ReactNode } from "react";
import type { ChatMessage } from "@/lib/types";
import { IconChevronDown, IconFileText } from "@/lib/icons";

type VoiceTranscriptProps = {
  message: ChatMessage;
  mine?: boolean;
  clock?: ReactNode;
  onTranscribe?: (messageId: string) => void;
};

export function VoiceTranscript({
  message,
  mine = false,
  clock,
  onTranscribe,
}: VoiceTranscriptProps) {
  const [open, setOpen] = useState(false);
  const text = (message.transcription || "").trim();
  const status = message.transcriptionStatus;
  const pending = status === "pending";
  const error = status === "error";
  const ready = status === "ready";
  const failedSend = message.status === "pending" || message.status === "failed";

  if (failedSend) {
    return clock ? (
      <div className="voice-transcript__bar voice-transcript__bar--clock-only">
        {clock}
      </div>
    ) : null;
  }

  const label = pending
    ? "Расшифровываю…"
    : open
      ? "Скрыть текст"
      : error
        ? "Повторить расшифровку"
        : ready || text
          ? "Расшифровка"
          : "Расшифровать";

  function toggle() {
    if (open) {
      setOpen(false);
      return;
    }
    setOpen(true);
    if (!text && !pending && message.id) {
      onTranscribe?.(message.id);
    }
  }

  function retry() {
    setOpen(true);
    onTranscribe?.(message.id);
  }

  return (
    <div
      className={`voice-transcript ${mine ? "voice-transcript--mine" : ""} ${
        open ? "is-open" : ""
      }`}
      onClick={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
    >
      <button
        type="button"
        className="voice-transcript__toggle"
        onClick={toggle}
        aria-expanded={open}
      >
        <IconFileText size={14} />
        <span>{label}</span>
        <IconChevronDown size={14} />
      </button>

      <div className="voice-transcript__panel" aria-hidden={!open}>
        <div className="voice-transcript__panel-inner">
          {pending && !text ? (
            <p className="voice-transcript__hint">Распознаю речь…</p>
          ) : null}
          {error && !pending ? (
            <div className="voice-transcript__error">
              <p>Не получилось расшифровать</p>
              <button type="button" onClick={retry}>
                Ещё раз
              </button>
            </div>
          ) : null}
          {ready && !text ? (
            <p className="voice-transcript__hint">Речь не распознана</p>
          ) : null}
          {text ? <p className="voice-transcript__text">{text}</p> : null}
        </div>
      </div>

      {clock ? <div className="voice-transcript__clock">{clock}</div> : null}
    </div>
  );
}
