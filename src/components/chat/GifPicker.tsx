"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { AnimatePresence, motion } from "motion/react";
import { IconSearch, IconClose } from "@/lib/icons";

type GifResult = {
  id: string;
  title: string;
  url: string;
  preview: string;
  width: number;
  height: number;
};

type GifPickerProps = {
  onSelect: (url: string) => void;
  onClose: () => void;
  open: boolean;
};

export function GifPicker({ onSelect, onClose, open }: GifPickerProps) {
  const [query, setQuery] = useState<string>("");
  const [gifs, setGifs] = useState<GifResult[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [nextPos, setNextPos] = useState<string>("");
  const [hasMore, setHasMore] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const observerRef = useRef<IntersectionObserver | null>(null);
  const searchTimeout = useRef<NodeJS.Timeout | undefined>(undefined);

  const loadGifs = useCallback(async (reset: boolean = false) => {
    if (loading || (!reset && !hasMore)) return;

    setLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams();
      if (query.trim()) {
        params.set('q', query.trim());
      }
      if (!reset && nextPos) {
        params.set('pos', nextPos);
      }
      params.set('limit', '20');

      const res = await fetch(`/api/gif?${params.toString()}`);
      const data = await res.json();

      if (!res.ok) throw new Error(data.error || 'Failed to load GIFs');

      const newGifs = data.results || [];

      if (reset) {
        setGifs(newGifs);
      } else {
        setGifs((prev: GifResult[]) => [...prev, ...newGifs]);
      }

      setNextPos(data.next || '');
      setHasMore(Boolean(data.next) && newGifs.length > 0);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка загрузки GIF');
    } finally {
      setLoading(false);
    }
  }, [query, nextPos, hasMore, loading]);

  // Загружаем трендовые GIF при открытии
  useEffect(() => {
    if (open) {
      setGifs([]);
      setNextPos('');
      setHasMore(true);
      loadGifs(true);
    }
  }, [open]);

  // Поиск с debounce
  useEffect(() => {
    if (searchTimeout.current) {
      clearTimeout(searchTimeout.current);
    }
    if (query.trim() && query.length > 1) {
      searchTimeout.current = setTimeout(() => {
        setGifs([]);
        setNextPos('');
        setHasMore(true);
        loadGifs(true);
      }, 400);
    } else if (!query.trim()) {
      setGifs([]);
      setNextPos('');
      setHasMore(true);
      loadGifs(true);
    }
    return () => {
      if (searchTimeout.current) {
        clearTimeout(searchTimeout.current);
      }
    };
  }, [query]);

  // Intersection Observer для бесконечной загрузки
  useEffect(() => {
    if (observerRef.current) {
      observerRef.current.disconnect();
    }

    observerRef.current = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && !loading && hasMore && gifs.length > 0) {
          loadGifs(false);
        }
      },
      { 
        threshold: 0.1,
        root: gridRef.current,
        rootMargin: '100px',
      }
    );

    return () => {
      if (observerRef.current) {
        observerRef.current.disconnect();
      }
    };
  }, [loading, hasMore, loadGifs, gifs.length]);

  // Наблюдатель за последним элементом
  useEffect(() => {
    if (!observerRef.current || !gridRef.current) return;
    
    // Находим последний элемент в сетке
    const lastChild = gridRef.current.lastElementChild as HTMLElement;
    if (lastChild && !lastChild.classList.contains('gif-picker__loader')) {
      observerRef.current.observe(lastChild);
    }

    return () => {
      if (observerRef.current) {
        observerRef.current.disconnect();
      }
    };
  }, [gifs]);

  const handleSelect = useCallback((url: string) => {
    onSelect(url);
    onClose();
  }, [onSelect, onClose]);

  if (!open) return null;

  return (
    <motion.div
      className="gif-picker"
      initial={{ opacity: 0, y: 10, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 10, scale: 0.95 }}
      transition={{ duration: 0.2 }}
    >
      <div className="gif-picker__header">
        <div className="gif-picker__search">
          <IconSearch size={18} />
          <input
            type="text"
            placeholder="Поиск GIF..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoFocus
          />
          {query && (
            <button onClick={() => setQuery("")}>
              <IconClose size={16} />
            </button>
          )}
        </div>
        <button className="gif-picker__close" onClick={onClose}>
          <IconClose size={20} />
        </button>
      </div>

      {error ? (
        <div className="gif-picker__error">{error}</div>
      ) : (
        <div ref={gridRef} className="gif-picker__grid">
          {gifs.map((gif, index) => (
            <button
              key={`${gif.id}-${index}`}
              className="gif-picker__item"
              onClick={() => handleSelect(gif.url)}
              style={{ 
                aspectRatio: `${gif.width}/${gif.height}`,
                position: 'relative',
              }}
            >
              <img 
                src={gif.preview} 
                alt={gif.title || 'GIF'} 
                loading="lazy"
                className="gif-picker__item-image"
              />
            </button>
          ))}
          {loading && (
            <div className="gif-picker__loader">
              <span className="gif-picker__spinner" />
            </div>
          )}
          {!loading && gifs.length === 0 && (
            <div className="gif-picker__empty">
              {query ? 'Ничего не найдено' : 'Нет GIF'}
            </div>
          )}
        </div>
      )}
    </motion.div>
  );
}