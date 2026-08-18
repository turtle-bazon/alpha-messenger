import { useEffect, useRef, useState } from 'react';
import { EmojiPicker } from './EmojiPicker';
import { StickerPanel } from './StickerPanel';
import { searchGifs, uploadBlob } from '../api/rest';
import type { GifResult } from '../api/rest';

type Tab = 'emoji' | 'stickers' | 'gifs';

interface MediaPanelProps {
  onSelectEmoji: (emoji: string) => void;
  onSelectSticker: (blobId: string) => void;
  onClose: () => void;
  textareaRef?: React.RefObject<HTMLDivElement>;
}

export function MediaPanel({
  onSelectEmoji,
  onSelectSticker,
  onClose,
  textareaRef,
}: MediaPanelProps): JSX.Element {
  const [tab, setTab] = useState<Tab>('emoji');
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent): void {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
        textareaRef?.current?.focus();
      }
    }
    function handleKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') {
        onClose();
        textareaRef?.current?.focus();
      }
    }
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleKey);
    };
  }, [onClose, textareaRef]);

  return (
    <div className="media-panel" ref={ref} data-testid="media-panel">
      <div className="media-panel-tabs">
        <button
          type="button"
          className={'media-tab' + (tab === 'emoji' ? ' active' : '')}
          onClick={() => setTab('emoji')}
        >
          😊
        </button>
        <button
          type="button"
          className={'media-tab' + (tab === 'stickers' ? ' active' : '')}
          onClick={() => setTab('stickers')}
        >
          Стикеры
        </button>
        <button
          type="button"
          className={'media-tab' + (tab === 'gifs' ? ' active' : '')}
          onClick={() => setTab('gifs')}
        >
          GIF
        </button>
      </div>

      <div className="media-panel-content">
        {tab === 'emoji' && (
          <EmojiPicker
            onSelect={onSelectEmoji}
            onClose={onClose}
            textareaRef={textareaRef}
            standalone={false}
          />
        )}
        {tab === 'stickers' && (
          <StickerPanel
            onSelectSticker={onSelectSticker}
            onClose={onClose}
            textareaRef={textareaRef}
            standalone={false}
          />
        )}
        {tab === 'gifs' && (
          <GifPicker
            onSelect={onSelectSticker}
            onClose={onClose}
          />
        )}
      </div>
    </div>
  );
}

interface GifPickerProps {
  onSelect: (blobId: string) => void;
  onClose: () => void;
}

function GifPicker({ onSelect }: GifPickerProps): JSX.Element {
  const [query, setQuery] = useState('');
  const [gifs, setGifs] = useState<GifResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [nextPos, setNextPos] = useState<string | null>(null);
  const abortRef = useRef(0);

  useEffect(() => {
    if (query.trim().length === 0) {
      setGifs([]);
      setNextPos(null);
      return;
    }
    const reqId = ++abortRef.current;
    setLoading(true);
    const timer = setTimeout(() => {
      searchGifs(query, { limit: 20 })
        .then((res) => {
          if (reqId !== abortRef.current) return;
          setGifs(res.gifs);
          setNextPos(res.next);
        })
        .catch(() => {})
        .finally(() => {
          if (reqId === abortRef.current) setLoading(false);
        });
    }, 400);
    return () => clearTimeout(timer);
  }, [query]);

  async function loadMore(): Promise<void> {
    if (!nextPos || loading) return;
    setLoading(true);
    try {
      const res = await searchGifs(query, { limit: 20, pos: nextPos });
      setGifs((prev) => [...prev, ...res.gifs]);
      setNextPos(res.next);
    } catch {}
    setLoading(false);
  }

  async function handleSelect(gif: GifResult): Promise<void> {
    try {
      const res = await fetch(gif.fullUrl);
      const blob = await res.blob();
      const uploaded = await uploadBlob(blob);
      onSelect(uploaded.blobId);
    } catch {}
  }

  return (
    <div className="gif-picker">
      <div className="gif-search">
        <input
          type="text"
          placeholder="Поиск GIF…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          autoFocus
        />
      </div>
      <div className="gif-grid">
        {gifs.length === 0 && !loading && (
          <div className="gif-empty">
            {query ? 'Ничего не найдено' : 'Введите запрос'}
          </div>
        )}
        {gifs.map((gif) => (
          <button
            key={gif.id}
            type="button"
            className="gif-item"
            onClick={() => handleSelect(gif)}
          >
            <img src={gif.url} alt={gif.title} loading="lazy" />
          </button>
        ))}
      </div>
      {nextPos && (
        <button
          type="button"
          className="gif-load-more"
          onClick={loadMore}
          disabled={loading}
        >
          {loading ? 'Загрузка…' : 'Ещё'}
        </button>
      )}
    </div>
  );
}
