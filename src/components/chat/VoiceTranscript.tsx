"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import type { ReactNode } from "react";
import type { ChatMessage } from "@/lib/types";
import { easeOut } from "@/lib/motion";
import { IconFileText } from "@/lib/icons";

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
  const reduceMotion = useReducedMotion();
  const text = (message.transcription || "").trim();
  const status = message.transcriptionStatus;
  const pending = status === "pending";
  const error = status === "error";
  const empty = status === "ready" && !text;
  const failedSend = message.status === "pending" || message.status === "failed";

  if (failedSend || empty) {
    return clock ? (
      <div className="voice-transcript__bar voice-transcript__bar--clock-only">
        {clock}
      </div>
    ) : null;
  }

  const label = pending
    ? "Расшифровываю…"
    : error
      ? "Повторить расшифровку"
      : "Расшифровать";

  return (
    <div
      className={`voice-transcript ${mine ? "voice-transcript--mine" : ""} ${
        text ? "voice-transcript--text" : ""
      }`}
      onClick={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
    >
      {text ? null : (
        <button
          type="button"
          className="voice-transcript__toggle"
          disabled={pending}
          onClick={() => onTranscribe?.(message.id)}
        >
          <IconFileText size={14} />
          <span>{label}</span>
        </button>
      )}

      <AnimatePresence initial={false}>
        {text ? (
          <motion.div
            key="transcript"
            className="voice-transcript__panel"
            initial={reduceMotion ? false : { height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={
              reduceMotion ? { duration: 0 } : { duration: 0.36, ease: easeOut }
            }
          >
            <p className="voice-transcript__text">{text}</p>
          </motion.div>
        ) : null}
      </AnimatePresence>

      {error && !pending && !text ? (
        <div className="voice-transcript__error">
          <p>Не получилось расшифровать</p>
          <button type="button" onClick={() => onTranscribe?.(message.id)}>
            Ещё раз
          </button>
        </div>
      ) : null}

      {clock ? <div className="voice-transcript__clock">{clock}</div> : null}
    </div>
  );
}
