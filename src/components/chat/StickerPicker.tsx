"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { AnimatePresence, motion } from "motion/react";
import { IconPlus, IconTrash, IconClose, IconUpload } from "@/lib/icons";
import { toast } from "sonner";

const MAX_STICKERS_PER_PACK = 15;

type Sticker = {
  id: string;
  url: string;
  emoji?: string;
};

type StickerPack = {
  id: string;
  name: string;
  ownerId: string;
  stickers: Sticker[];
  createdAt: number;
};

type StickerPickerProps = {
  onSelect: (url: string) => void;
  onClose: () => void;
  open: boolean;
  userId: string;
  token: string;
};

export function StickerPicker({ onSelect, onClose, open, userId, token }: StickerPickerProps) {
  const [packs, setPacks] = useState<StickerPack[]>([]);
  const [selectedPack, setSelectedPack] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [packName, setPackName] = useState("");
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const loadPacks = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/stickers', {
        headers: { 'x-pulse-token': token },
      });
      const data = await res.json();
      if (data.ok) {
        setPacks(data.packs || []);
        if (data.packs?.length > 0 && !selectedPack) {
          setSelectedPack(data.packs[0].id);
        }
      } else {
        setError(data.error || 'Ошибка загрузки стикеров');
      }
    } catch {
      setError('Не удалось загрузить стикеры');
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    if (open) loadPacks();
  }, [open, loadPacks]);

  const createPack = useCallback(async () => {
    if (!packName.trim() || creating) return;
    setCreating(true);
    setError(null);
    try {
      const res = await fetch('/api/stickers', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-pulse-token': token,
        },
        body: JSON.stringify({ name: packName.trim() }),
      });
      const data = await res.json();
      if (data.ok) {
        setPacks(prev => [...prev, data.pack]);
        setSelectedPack(data.pack.id);
        setPackName("");
        setCreating(false);
        toast.success('Пак создан');
      } else {
        setError(data.error || 'Ошибка создания');
        setCreating(false);
      }
    } catch {
      setError('Ошибка создания пака');
      setCreating(false);
    }
  }, [packName, creating, token]);

  const uploadSticker = useCallback(async (file: File) => {
    if (!selectedPack || uploading) return;

    // Проверка: только изображения
    if (!file.type.startsWith('image/')) {
      toast.error('Только изображения');
      return;
    }
    if (file.size > 512 * 1024) {
      toast.error('Стикер не больше 512 КБ');
      return;
    }

    setUploading(true);
    setError(null);
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('packId', selectedPack);

      const res = await fetch('/api/stickers/upload', {
        method: 'POST',
        headers: { 'x-pulse-token': token },
        body: formData,
      });
      const data = await res.json();
      if (data.ok) {
        setPacks(prev => prev.map(pack =>
          pack.id === selectedPack
            ? { ...pack, stickers: [...pack.stickers, data.sticker] }
            : pack
        ));
        toast.success('Стикер добавлен');
      } else {
        setError(data.error || 'Ошибка загрузки');
      }
    } catch {
      setError('Ошибка загрузки стикера');
    } finally {
      setUploading(false);
    }
  }, [selectedPack, uploading, token]);

  const deleteSticker = useCallback(async (packId: string, stickerId: string) => {
    try {
      const res = await fetch(`/api/stickers/${packId}/${stickerId}`, {
        method: 'DELETE',
        headers: { 'x-pulse-token': token },
      });
      const data = await res.json();
      if (data.ok) {
        setPacks(prev => prev.map(pack =>
          pack.id === packId
            ? { ...pack, stickers: pack.stickers.filter(s => s.id !== stickerId) }
            : pack
        ));
        toast.success('Стикер удалён');
      }
    } catch {
      toast.error('Ошибка удаления');
    }
  }, [token]);

  const deletePack = useCallback(async (packId: string) => {
    if (!confirm('Удалить пак стикеров?')) return;
    try {
      const res = await fetch(`/api/stickers/${packId}`, {
        method: 'DELETE',
        headers: { 'x-pulse-token': token },
      });
      const data = await res.json();
      if (data.ok) {
        setPacks(prev => prev.filter(pack => pack.id !== packId));
        if (selectedPack === packId) {
          setSelectedPack(packs.length > 1 ? packs[0]?.id || null : null);
        }
        toast.success('Пак удалён');
      }
    } catch {
      toast.error('Ошибка удаления пака');
    }
  }, [token, selectedPack, packs]);

  const currentPack = packs.find(p => p.id === selectedPack);

  if (!open) return null;

  return (
    <motion.div
      className="sticker-picker"
      initial={{ opacity: 0, y: 10, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 10, scale: 0.95 }}
      transition={{ duration: 0.2 }}
    >
      <div className="sticker-picker__header">
        <div className="sticker-picker__packs">
          {packs.map(pack => (
            <button
              key={pack.id}
              className={`sticker-picker__pack-btn ${selectedPack === pack.id ? 'is-active' : ''}`}
              onClick={() => setSelectedPack(pack.id)}
              title={pack.name}
            >
              {pack.stickers.length > 0 ? (
                <img src={pack.stickers[0].url} alt={pack.name} />
              ) : (
                <span>{pack.name[0].toUpperCase()}</span>
              )}
            </button>
          ))}
          <button
            className="sticker-picker__pack-btn sticker-picker__pack-btn--add"
            onClick={() => setCreating(true)}
            title="Создать пак"
          >
            <IconPlus size={16} />
          </button>
        </div>
        <button className="sticker-picker__close" onClick={onClose}>
          <IconClose size={20} />
        </button>
      </div>

      {creating && (
        <div className="sticker-picker__create-pack">
          <input
            type="text"
            value={packName}
            onChange={(e) => setPackName(e.target.value)}
            placeholder="Название пака"
            maxLength={40}
            autoFocus
            onKeyDown={(e) => {
              if (e.key === 'Enter') createPack();
              if (e.key === 'Escape') setCreating(false);
            }}
          />
          <button onClick={createPack} disabled={creating || !packName.trim()}>
            {creating ? '…' : 'Создать'}
          </button>
          <button onClick={() => setCreating(false)}>Отмена</button>
        </div>
      )}

      {error && (
        <div className="sticker-picker__error">{error}</div>
      )}

      {currentPack && (
        <>
          <div className="sticker-picker__pack-info">
            <span>{currentPack.name}</span>
            <span>{currentPack.stickers.length}/{MAX_STICKERS_PER_PACK}</span>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              style={{ display: 'none' }}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) uploadSticker(file);
                e.target.value = '';
              }}
            />
            <button 
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading || currentPack.stickers.length >= MAX_STICKERS_PER_PACK}
              title="Добавить стикер"
            >
              <IconUpload size={14} />
            </button>
            <button onClick={() => deletePack(currentPack.id)} title="Удалить пак">
              <IconTrash size={14} />
            </button>
          </div>

          <div className="sticker-picker__grid">
            {currentPack.stickers.map(sticker => (
              <button
                key={sticker.id}
                className="sticker-picker__item"
                onClick={() => onSelect(sticker.url)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  deleteSticker(currentPack.id, sticker.id);
                }}
                title="Клик — отправить, ПКМ — удалить"
              >
                <img src={sticker.url} alt="sticker" />
                {sticker.emoji && <span className="sticker-picker__emoji">{sticker.emoji}</span>}
              </button>
            ))}
            {currentPack.stickers.length === 0 && (
              <div className="sticker-picker__empty">
                Нет стикеров. Нажмите + для добавления.
              </div>
            )}
          </div>
        </>
      )}

      {loading && (
        <div className="sticker-picker__loader">
          <span className="sticker-picker__spinner" />
        </div>
      )}
    </motion.div>
  );
}