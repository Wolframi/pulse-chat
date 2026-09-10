"use client";

import { useState, useEffect, useCallback } from "react";
import { motion } from "motion/react";
import { IconPlus, IconTrash } from "@/lib/icons";

type Sticker = {
  id: string;
  url: string;
  emoji?: string;
};

type StickerPack = {
  id: string;
  name: string;
  stickers: Sticker[];
};

type StickerPickerProps = {
  onSelect: (url: string) => void;
  onClose: () => void;
  open: boolean;
  userId?: string;
  token?: string;
  /** Встроенный режим (без внешней рамки и кнопки закрытия) */
  embedded?: boolean;
};

const MAX_STICKERS_PER_PACK = 15;
const STORAGE_KEY = "pulse-sticker-packs";

// ============================================
// Встроенные паки стикеров (большие эмодзи)
// ============================================
const EMOJI_STICKERS: string[][] = [
  // Реакции
  ["😀", "😂", "🤣", "😊", "😍", "🥰", "😎", "🤩", "😇", "🥳", "😭", "😡", "🤔", "😴", "🤯"],
  // Жесты
  ["👍", "👎", "👏", "🙌", "🤝", "✌️", "🤞", "👌", "🤙", "💪", "🙏", "👋", "🤚", "✋", "🖐️"],
  // Сердца и символы
  ["❤️", "🧡", "💛", "💚", "💙", "💜", "🖤", "🤍", "💔", "💯", "🔥", "⭐", "✨", "💫", "⚡"],
  // Животные
  ["🐶", "🐱", "🐭", "🐹", "🐰", "🦊", "🐻", "🐼", "🐨", "🐯", "🦁", "🐮", "🐷", "🐸", "🐵"],
];

const DEFAULT_PACKS: StickerPack[] = [
  {
    id: "reactions",
    name: "Реакции",
    stickers: EMOJI_STICKERS[0].map((emoji, i) => ({
      id: `r-${i}`,
      url: emoji,
      emoji,
    })),
  },
  {
    id: "gestures",
    name: "Жесты",
    stickers: EMOJI_STICKERS[1].map((emoji, i) => ({
      id: `g-${i}`,
      url: emoji,
      emoji,
    })),
  },
  {
    id: "hearts",
    name: "Символы",
    stickers: EMOJI_STICKERS[2].map((emoji, i) => ({
      id: `h-${i}`,
      url: emoji,
      emoji,
    })),
  },
  {
    id: "animals",
    name: "Животные",
    stickers: EMOJI_STICKERS[3].map((emoji, i) => ({
      id: `a-${i}`,
      url: emoji,
      emoji,
    })),
  },
];

// ============================================
// Утилиты для localStorage
// ============================================
function loadLocalPacks(): StickerPack[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const data = JSON.parse(raw) as StickerPack[];
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

function saveLocalPacks(packs: StickerPack[]) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(packs));
  } catch {
    /* ignore */
  }
}

// ============================================
// Компонент
// ============================================
export function StickerPicker({
  onSelect,
  onClose,
  open,
  embedded = false,
}: StickerPickerProps) {
  const [packs, setPacks] = useState<StickerPack[]>(DEFAULT_PACKS);
  const [localPacks, setLocalPacks] = useState<StickerPack[]>([]);
  const [selectedPack, setSelectedPack] = useState<string>(DEFAULT_PACKS[0].id);
  const [creating, setCreating] = useState(false);
  const [packName, setPackName] = useState("");

  // Загружаем локальные паки при открытии
  useEffect(() => {
    if (!open) return;
    const stored = loadLocalPacks();
    setLocalPacks(stored);
    if (stored.length > 0 && !stored.some((p) => p.id === selectedPack)) {
      setSelectedPack(stored[0].id);
    }
  }, [open]);

  const allPacks = [...DEFAULT_PACKS, ...localPacks];
  const currentPack = allPacks.find((p) => p.id === selectedPack);

  const createPack = useCallback(() => {
    if (!packName.trim()) return;
    const newPack: StickerPack = {
      id: `user-${Date.now()}`,
      name: packName.trim().slice(0, 20),
      stickers: [],
    };
    const next = [...localPacks, newPack];
    setLocalPacks(next);
    saveLocalPacks(next);
    setSelectedPack(newPack.id);
    setPackName("");
    setCreating(false);
  }, [packName, localPacks]);

  const deletePack = useCallback(
    (packId: string) => {
      if (!confirm("Удалить пак?")) return;
      const next = localPacks.filter((p) => p.id !== packId);
      setLocalPacks(next);
      saveLocalPacks(next);
      if (selectedPack === packId) {
        setSelectedPack(DEFAULT_PACKS[0].id);
      }
    },
    [localPacks, selectedPack]
  );

  const addStickerToPack = useCallback(
    (packId: string, emoji: string) => {
      const pack = localPacks.find((p) => p.id === packId);
      if (!pack) return;
      if (pack.stickers.length >= MAX_STICKERS_PER_PACK) {
        alert(`Максимум ${MAX_STICKERS_PER_PACK} стикеров`);
        return;
      }
      const sticker: Sticker = {
        id: `s-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        url: emoji,
        emoji,
      };
      const next = localPacks.map((p) =>
        p.id === packId ? { ...p, stickers: [...p.stickers, sticker] } : p
      );
      setLocalPacks(next);
      saveLocalPacks(next);
    },
    [localPacks]
  );

  const removeSticker = useCallback(
    (packId: string, stickerId: string) => {
      const next = localPacks.map((p) =>
        p.id === packId
          ? { ...p, stickers: p.stickers.filter((s) => s.id !== stickerId) }
          : p
      );
      setLocalPacks(next);
      saveLocalPacks(next);
    },
    [localPacks]
  );

  const handlePick = useCallback(
    (sticker: Sticker) => {
      onSelect(sticker.url);
      onClose();
    },
    [onSelect, onClose]
  );

  if (!open) return null;

  return (
    <motion.div
      className={`sticker-picker ${embedded ? "sticker-picker--embedded" : ""}`}
      initial={{ opacity: 0, y: 10, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 10, scale: 0.95 }}
      transition={{ duration: 0.2 }}
    >
      {/* Паки — сверху */}
      <div className="sticker-picker__packs">
        {allPacks.map((pack) => (
          <button
            key={pack.id}
            type="button"
            className={`sticker-picker__pack ${
              selectedPack === pack.id ? "is-active" : ""
            }`}
            onClick={() => setSelectedPack(pack.id)}
            title={pack.name}
          >
            {pack.stickers.length > 0 ? (
              <span className="sticker-picker__pack-icon">
                {pack.stickers[0].emoji || "🎨"}
              </span>
            ) : (
              <span className="sticker-picker__pack-icon">📦</span>
            )}
          </button>
        ))}
        <button
          type="button"
          className="sticker-picker__pack sticker-picker__pack--add"
          onClick={() => setCreating(true)}
          title="Создать пак"
        >
          <IconPlus size={18} />
        </button>
      </div>

      {/* Создание пака */}
      {creating && (
        <div className="sticker-picker__create">
          <input
            type="text"
            value={packName}
            onChange={(e) => setPackName(e.target.value)}
            placeholder="Название пака"
            maxLength={20}
            autoFocus
            onKeyDown={(e) => {
              if (e.key === "Enter") createPack();
              if (e.key === "Escape") setCreating(false);
            }}
          />
          <button
            type="button"
            onClick={createPack}
            disabled={!packName.trim()}
          >
            Создать
          </button>
          <button type="button" onClick={() => setCreating(false)}>
            Отмена
          </button>
        </div>
      )}

      {/* Инфо о паке */}
      {currentPack && !creating && (
        <div className="sticker-picker__info">
          <span className="sticker-picker__name">{currentPack.name}</span>
          {localPacks.some((p) => p.id === currentPack.id) && (
            <button
              type="button"
              className="sticker-picker__delete-pack"
              onClick={() => deletePack(currentPack.id)}
              title="Удалить пак"
            >
              <IconTrash size={14} />
            </button>
          )}
        </div>
      )}

      {/* Сетка стикеров */}
      <div className="sticker-picker__grid">
        {currentPack?.stickers.map((sticker) => (
          <button
            key={sticker.id}
            type="button"
            className="sticker-picker__item"
            onClick={() => handlePick(sticker)}
            onContextMenu={(e) => {
              e.preventDefault();
              if (localPacks.some((p) => p.id === currentPack.id)) {
                removeSticker(currentPack.id, sticker.id);
              }
            }}
            title="Клик — отправить"
          >
            {sticker.emoji ? (
              <span className="sticker-picker__emoji">{sticker.emoji}</span>
            ) : (
              <img src={sticker.url} alt="sticker" />
            )}
          </button>
        ))}

        {currentPack && currentPack.stickers.length === 0 && (
          <div className="sticker-picker__empty">
            Пак пуст. Добавьте стикеры через ПКМ по эмодзи в этом пане
            или используйте встроенные.
          </div>
        )}
      </div>
    </motion.div>
  );
}