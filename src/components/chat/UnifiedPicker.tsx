"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { motion, AnimatePresence } from "motion/react";
import dynamic from "next/dynamic";
import { IconSmile } from "@/lib/icons";
import { GifPicker } from "@/components/chat/GifPicker";
import { StickerPicker } from "@/components/chat/StickerPicker";
import type { StickerPack } from "@/lib/types";

const EmojiPanel = dynamic(
  () => import("@/components/chat/EmojiPanel").then((mod) => mod.EmojiPanel),
  { ssr: false }
);

type PickerTab = "emoji" | "stickers" | "gif";

type UnifiedPickerProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onEmojiPick: (emoji: string) => void;
  onGifPick: (url: string) => void;
  onStickerPick: (packId: string, stickerId: string) => void;
  userId?: string;
  token?: string;
  stickerPacks: StickerPack[];
  refreshStickerPacks: () => Promise<StickerPack[]>;
  onCreateStickerPack: (title: string) => Promise<{ ok: boolean; pack?: StickerPack; error?: string }>;
  onDeleteStickerPack: (packId: string) => Promise<boolean>;
  onRenameStickerPack: (packId: string, title: string) => Promise<boolean>;
  onAddSticker: (
    packId: string,
    file: File,
    extra?: { emoji?: string; width?: number; height?: number; animated?: boolean },
  ) => Promise<{ ok: boolean; error?: string }>;
  onRemoveSticker: (packId: string, stickerId: string) => Promise<boolean>;
};

export function UnifiedPicker({
  open,
  onOpenChange,
  onEmojiPick,
  onGifPick,
  onStickerPick,
  userId = "",
  token = "",
  stickerPacks,
  refreshStickerPacks,
  onCreateStickerPack,
  onDeleteStickerPack,
  onRenameStickerPack,
  onAddSticker,
  onRemoveSticker,
}: UnifiedPickerProps) {
  const [tab, setTab] = useState<PickerTab>("emoji");
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        onOpenChange(false);
      }
    }

    function onDoc(e: MouseEvent) {
      const target = e.target;
      if (!(target instanceof Node)) return;
      if (rootRef.current?.contains(target)) return;
      onOpenChange(false);
    }

    window.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDoc);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDoc);
    };
  }, [open, onOpenChange]);

  const handleEmojiPick = useCallback(
    (emoji: string) => {
      onEmojiPick(emoji);
    },
    [onEmojiPick],
  );

  const handleGifPick = useCallback(
    (url: string) => {
      onGifPick(url);
      onOpenChange(false);
    },
    [onGifPick, onOpenChange],
  );

  const handleStickerSend = useCallback(
    (packId: string, stickerId: string) => {
      onStickerPick(packId, stickerId);
      onOpenChange(false);
    },
    [onStickerPick, onOpenChange],
  );

  return (
    <>
      <button
        type="button"
        className={`composer__emoji-trigger ${open ? "is-open" : ""}`}
        onClick={() => onOpenChange(!open)}
        aria-label={open ? "Закрыть панель" : "Открыть эмодзи, стикеры, GIF"}
        aria-expanded={open}
        title="Эмодзи, стикеры, GIF"
      >
        <IconSmile size={22} />
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            ref={rootRef}
            className="unified-picker"
            initial={{ opacity: 0, y: 10, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.95 }}
            transition={{ duration: 0.2 }}
          >
            <div className="unified-picker__tabs" role="tablist">
              <button
                type="button"
                role="tab"
                aria-selected={tab === "emoji"}
                className={`unified-picker__tab ${tab === "emoji" ? "is-active" : ""}`}
                onClick={() => setTab("emoji")}
              >
                Эмодзи
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={tab === "stickers"}
                className={`unified-picker__tab ${tab === "stickers" ? "is-active" : ""}`}
                onClick={() => setTab("stickers")}
              >
                Стикеры
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={tab === "gif"}
                className={`unified-picker__tab ${tab === "gif" ? "is-active" : ""}`}
                onClick={() => setTab("gif")}
              >
                GIF
              </button>
            </div>

            <div className="unified-picker__content">
              {tab === "emoji" && (
                <div className="unified-picker__pane unified-picker__pane--emoji">
                  <EmojiPanel
                    open={true}
                    closeOnSelect={false}
                    showTrigger={false}
                    emojiSize={28}
                    onPick={handleEmojiPick}
                    onOpenChange={() => {}}
                  />
                </div>
              )}

              {tab === "stickers" && (
                <div className="unified-picker__pane unified-picker__pane--stickers">
                  {userId && token ? (
                    <StickerPicker
                      open={true}
                      onClose={() => onOpenChange(false)}
                      onSend={handleStickerSend}
                      packs={stickerPacks}
                      refreshPacks={refreshStickerPacks}
                      onCreatePack={onCreateStickerPack}
                      onDeletePack={onDeleteStickerPack}
                      onRenamePack={onRenameStickerPack}
                      onAddSticker={onAddSticker}
                      onRemoveSticker={onRemoveSticker}
                    />
                  ) : (
                    <div className="unified-picker__empty">
                      Войдите, чтобы использовать стикеры
                    </div>
                  )}
                </div>
              )}

              {tab === "gif" && (
                <div className="unified-picker__pane unified-picker__pane--gif">
                  <GifPicker
                    open={true}
                    onSelect={handleGifPick}
                    onClose={() => onOpenChange(false)}
                  />
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}