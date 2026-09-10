"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { motion } from "motion/react";
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
  /** Скрыть кнопку закрытия и внешние рамки (для встраивания) */
  embedded?: boolean;
};

export function GifPicker({ onSelect, onClose, open, embedded = false }: GifPickerProps) {
  const [query, setQuery] = useState<string>("");
  const [gifs, setGifs] = useState<GifResult[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [nextPos, setNextPos] = useState<string>("");
  const [hasMore, setHasMore] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const gridRef = useRef<HTMLDivElement>(null);
  const observerRef = useRef<IntersectionObserver | null>(null);
  const searchTimeout = useRef<NodeJS.Timeout | undefined>(undefined);
  const loadingRef = useRef<boolean>(false);
  const lastQueryRef = useRef<string>("");

  const loadGifs = useCallback(
    async (reset: boolean = false, currentQuery: string = "") => {
      if (loadingRef.current) return;
      if (!reset && !hasMore) return;

      loadingRef.current = true;
      setLoading(true);
      setError(null);

      try {
        const params = new URLSearchParams();
        if (currentQuery.trim()) params.set("q", currentQuery.trim());
        if (!reset && nextPos) params.set("pos", nextPos);
        params.set("limit", "20");

        const res = await fetch(`/api/gif?${params.toString()}`);

        if (!res.ok) {
          throw new Error(`Ошибка ${res.status}`);
        }

        const data = await res.json();
        const newGifs: GifResult[] = data.results || [];

        if (reset) {
          setGifs(newGifs);
        } else {
          setGifs((prev) => [...prev, ...newGifs]);
        }
        setNextPos(data.next || "");
        setHasMore(Boolean(data.next) && newGifs.length > 0);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Не удалось загрузить");
      } finally {
        setLoading(false);
        loadingRef.current = false;
      }
    },
    [nextPos, hasMore]
  );

  // Первичная загрузка при открытии
  useEffect(() => {
    if (open) {
      setGifs([]);
      setNextPos("");
      setHasMore(true);
      lastQueryRef.current = "";
      loadGifs(true, "");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Поиск с debounce
  useEffect(() => {
    if (!open) return;
    if (query === lastQueryRef.current) return;

    if (searchTimeout.current) clearTimeout(searchTimeout.current);

    searchTimeout.current = setTimeout(() => {
      lastQueryRef.current = query;
      setGifs([]);
      setNextPos("");
      setHasMore(true);
      loadGifs(true, query);
    }, 500);

    return () => {
      if (searchTimeout.current) clearTimeout(searchTimeout.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, open]);

  // Бесконечная загрузка
  useEffect(() => {
    if (!open || !gridRef.current) return;
    if (observerRef.current) observerRef.current.disconnect();

    observerRef.current = new IntersectionObserver(
      (entries) => {
        if (
          entries[0]?.isIntersecting &&
          !loadingRef.current &&
          hasMore &&
          gifs.length > 0
        ) {
          loadGifs(false, lastQueryRef.current);
        }
      },
      { threshold: 0.1, rootMargin: "200px", root: gridRef.current }
    );

    const lastChild = gridRef.current.lastElementChild;
    if (lastChild) observerRef.current.observe(lastChild);

    return () => observerRef.current?.disconnect();
  }, [open, gifs, loading, hasMore, loadGifs]);

  const handleSelect = useCallback(
    (url: string) => {
      onSelect(url);
      onClose();
    },
    [onSelect, onClose]
  );

  if (!open) return null;

  return (
    <motion.div
      className={`gif-picker ${embedded ? "gif-picker--embedded" : ""}`}
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
            placeholder="Поиск GIF"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoFocus
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery("")}
              aria-label="Очистить"
            >
              <IconClose size={16} />
            </button>
          )}
        </div>
        {!embedded && (
          <button
            className="gif-picker__close"
            onClick={onClose}
            aria-label="Закрыть"
          >
            <IconClose size={20} />
          </button>
        )}
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
              title={gif.title}
            >
              <img
                src={gif.preview}
                alt={gif.title || "GIF"}
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
              {query ? "Ничего не найдено" : "Нет GIF"}
            </div>
          )}
        </div>
      )}
    </motion.div>
  );
}