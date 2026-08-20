import { useEffect, useRef, useState } from 'react';
import { getChatMedia, type MediaItem } from '../api/rest';
import { IconX } from '../util/icons';

// Chat media gallery (#82): grid of photo/video tiles from message history.
// Tiles render from inline thumbs (no blob requests); click opens the full
// media via onOpen (MediaViewer in the parent). Lazy pagination on scroll.

export function MediaGallery({
  chatId,
  onClose,
  onOpen,
}: {
  chatId: string;
  onClose: () => void;
  // Opens the full viewer for a media item (blobId + kind).
  onOpen: (item: MediaItem) => void;
}) {
  const [items, setItems] = useState<MediaItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [hasMore, setHasMore] = useState(false);
  const nextBeforeRef = useRef<string | null>(null);
  const loadingMoreRef = useRef(false);
  const gridRef = useRef<HTMLDivElement>(null);

  async function load(first: boolean): Promise<void> {
    if (loadingMoreRef.current) return;
    loadingMoreRef.current = true;
    try {
      const page = await getChatMedia(chatId, {
        before: first ? undefined : (nextBeforeRef.current ?? undefined),
        limit: 60,
      });
      setItems((prev) => (first ? page.items : [...prev, ...page.items]));
      nextBeforeRef.current = page.nextBefore;
      setHasMore(page.hasMore);
    } catch {
      // Leave what we have.
    } finally {
      setLoading(false);
      loadingMoreRef.current = false;
    }
  }

  useEffect(() => {
    void load(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatId]);

  // Close on Escape.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  function onScroll(): void {
    const el = gridRef.current;
    if (!el || !hasMore || loadingMoreRef.current) return;
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 200) {
      void load(false);
    }
  }

  return (
    <div className="img-editor-backdrop gallery-backdrop" data-testid="media-gallery">
      <div className="gallery-dialog">
        <header className="gallery-header">
          <span className="gallery-title">Медиа</span>
          <button
            type="button"
            className="gallery-close"
            aria-label="Закрыть"
            onClick={onClose}
          >
            <IconX />
          </button>
        </header>
        {loading ? (
          <div className="gallery-empty">Загрузка…</div>
        ) : items.length === 0 ? (
          <div className="gallery-empty">Пока нет фото и видео</div>
        ) : (
          <div className="gallery-grid" ref={gridRef} onScroll={onScroll}>
            {items.map((it) => {
              const att = it.att as {
                k?: string;
                thumb?: string;
                mime?: string;
                blob?: string;
                dur?: number;
              };
              const isVideo = att.k === 'video';
              return (
                <button
                  key={`${it.messageId}-${att.blob}`}
                  type="button"
                  className="gallery-tile"
                  data-testid={isVideo ? 'gallery-video' : 'gallery-image'}
                  onClick={() => onOpen(it)}
                >
                  {att.thumb ? (
                    <img src={`data:image/jpeg;base64,${att.thumb}`} alt="" loading="lazy" />
                  ) : (
                    <span className="gallery-tile-empty" />
                  )}
                  {isVideo && typeof att.dur === 'number' && (
                    <span className="gallery-dur">{fmtDur(att.dur)}</span>
                  )}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function fmtDur(sec: number): string {
  const s = Math.round(sec);
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}
