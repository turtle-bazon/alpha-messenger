import { useEffect, useState } from 'react';
import { blobObjectUrl } from '../util/blobUrl';

// Полноэкранный просмотр изображения (lightbox). Тянет полный блоб по blobId через
// кеш object-URL; до загрузки — индикатор, при ошибке — сообщение. Закрытие по
// клику на фон, по Escape или по кнопке.
export function MediaViewer({
  blobId,
  caption,
  onClose,
}: {
  blobId: string;
  caption?: string;
  onClose: () => void;
}): JSX.Element {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let alive = true;
    setUrl(null);
    setError(false);
    blobObjectUrl(blobId)
      .then((u) => alive && setUrl(u))
      .catch(() => alive && setError(true));
    return () => {
      alive = false;
    };
  }, [blobId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="media-viewer-backdrop"
      data-testid="media-viewer"
      onClick={onClose}
    >
      <button
        type="button"
        className="media-viewer-close"
        aria-label="Закрыть"
        onClick={onClose}
      >
        ✕
      </button>
      {error ? (
        <div className="media-viewer-msg">Не удалось загрузить изображение</div>
      ) : url ? (
        <figure className="media-viewer-fig" onClick={(e) => e.stopPropagation()}>
          <img
            className="media-viewer-img"
            data-testid="media-viewer-img"
            src={url}
            alt={caption || 'изображение'}
          />
          {caption && <figcaption>{caption}</figcaption>}
        </figure>
      ) : (
        <div className="media-viewer-msg">Загрузка…</div>
      )}
    </div>
  );
}
