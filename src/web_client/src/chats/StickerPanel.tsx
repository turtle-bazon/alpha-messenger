import { useEffect, useRef, useState } from 'react';
import {
  getMyStickerPacks,
  getStickerPackItems,
  fetchBlob,
  searchStickerPacks,
  createStickerPack,
  addStickerItem,
  uploadBlob,
} from '../api/rest';
import type { StickerPack, StickerItem } from '../api/types';

interface StickerPanelProps {
  onSelectSticker: (blobId: string) => void;
  onClose: () => void;
  textareaRef?: React.RefObject<HTMLDivElement>;
}

export function StickerPanel({ onSelectSticker, onClose, textareaRef }: StickerPanelProps): JSX.Element {
  const [packs, setPacks] = useState<StickerPack[]>([]);
  const [selectedPack, setSelectedPack] = useState<string | null>(null);
  const [items, setItems] = useState<StickerItem[]>([]);
  const [search, setSearch] = useState('');
  const [searchResults, setSearchResults] = useState<StickerPack[]>([]);
  const [loading, setLoading] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Загрузка моих паков
  useEffect(() => {
    getMyStickerPacks().then((res) => setPacks(res.packs)).catch(() => {});
  }, []);

  // Закрытие при клике вне
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

  // Загрузка стикеров выбранного пака
  useEffect(() => {
    if (selectedPack) {
      setLoading(true);
      getStickerPackItems(selectedPack)
        .then((res) => setItems(res.items))
        .catch(() => {})
        .finally(() => setLoading(false));
    }
  }, [selectedPack]);

  // Поиск паков
  useEffect(() => {
    if (search.trim().length > 0) {
      const timer = setTimeout(() => {
        searchStickerPacks(search).then((res) => setSearchResults(res.packs)).catch(() => {});
      }, 300);
      return () => clearTimeout(timer);
    } else {
      setSearchResults([]);
    }
  }, [search]);

  function handleSelect(blobId: string): void {
    onSelectSticker(blobId);
    onClose();
  }

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = e.target.files?.[0];
    if (!file || !selectedPack) return;

    const blob = new Blob([await file.arrayBuffer()], { type: file.type });
    const result = await uploadBlob(blob);
    await addStickerItem(selectedPack, result.blobId);
    const res = await getStickerPackItems(selectedPack);
    setItems(res.items);
    e.target.value = '';
  }

  async function handleCreatePack(): Promise<void> {
    const title = prompt('Название пака:');
    if (!title) return;
    const pack = await createStickerPack(title);
    setPacks((prev) => [pack, ...prev]);
    setSelectedPack(pack.packId);
  }

  return (
    <div className="sticker-panel" ref={ref} data-testid="sticker-panel">
      <div className="sticker-panel-tabs">
        <button
          type="button"
          className="sticker-tab active"
          disabled
        >
          Стикеры
        </button>
        <button
          type="button"
          className="sticker-tab"
          onClick={() => {}}
          disabled
        >
          GIF
        </button>
      </div>

      <div className="sticker-panel-search">
        <input
          type="text"
          placeholder="Найти пак…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {!selectedPack ? (
        <div className="sticker-packs-grid">
          {searchResults.length > 0 ? (
            searchResults.map((pack) => (
              <button
                key={pack.packId}
                type="button"
                className="sticker-pack-item"
                onClick={() => setSelectedPack(pack.packId)}
              >
                {pack.coverBlobId ? (
                  <StickerThumb blobId={pack.coverBlobId} />
                ) : (
                  <div className="sticker-pack-placeholder">📦</div>
                )}
                <span className="sticker-pack-title">{pack.title}</span>
                <span className="sticker-pack-count">{pack.itemCount}</span>
              </button>
            ))
          ) : (
            packs.map((pack) => (
              <button
                key={pack.packId}
                type="button"
                className="sticker-pack-item"
                onClick={() => setSelectedPack(pack.packId)}
              >
                {pack.coverBlobId ? (
                  <StickerThumb blobId={pack.coverBlobId} />
                ) : (
                  <div className="sticker-pack-placeholder">📦</div>
                )}
                <span className="sticker-pack-title">{pack.title}</span>
                <span className="sticker-pack-count">{pack.itemCount}</span>
              </button>
            ))
          )}

          <button
            type="button"
            className="sticker-pack-item sticker-pack-add"
            onClick={handleCreatePack}
          >
            <div className="sticker-pack-placeholder">+</div>
            <span className="sticker-pack-title">Новый пак</span>
          </button>
        </div>
      ) : (
        <div className="sticker-items-view">
          <div className="sticker-items-header">
            <button
              type="button"
              className="sticker-back-btn"
              onClick={() => { setSelectedPack(null); setItems([]); }}
            >
              ← Назад
            </button>
            <button
              type="button"
              className="sticker-add-btn"
              onClick={() => fileInputRef.current?.click()}
            >
              + Добавить стикер
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/webp,image/png,image/gif"
              style={{ display: 'none' }}
              onChange={handleUpload}
            />
          </div>
          {loading ? (
            <div className="sticker-loading">Загрузка…</div>
          ) : (
            <div className="sticker-items-grid">
              {items.map((item) => (
                <button
                  key={item.itemId}
                  type="button"
                  className="sticker-item-btn"
                  onClick={() => handleSelect(item.blobId)}
                >
                  <StickerThumb blobId={item.blobId} />
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// Превью стикера по blobId
function StickerThumb({ blobId }: { blobId: string }): JSX.Element {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchBlob(blobId).then((blob) => {
      if (!cancelled) setUrl(URL.createObjectURL(blob));
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [blobId]);

  if (!url) return <div className="sticker-thumb-loading" />;
  return <img src={url} className="sticker-thumb" alt="" />;
}
