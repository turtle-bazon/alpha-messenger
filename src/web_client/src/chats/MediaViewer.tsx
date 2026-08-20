import { useEffect, useState } from 'react';
import { blobObjectUrl } from '../util/blobUrl';
import { IconX } from '../util/icons';

// Fullscreen image/video viewer (#34). Fetches the full blob by blobId
// through the object-URL cache; shows a spinner until loaded, a message on error.
// Close via backdrop click, Escape, or the button. Video uses <video controls autoplay>.
export function MediaViewer({
  blobId,
  caption,
  kind = 'image',
  onClose,
}: {
  blobId: string;
  caption?: string;
  kind?: 'image' | 'video';
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
        <IconX />
      </button>
      {error ? (
        <div className="media-viewer-msg">Не удалось загрузить медиа</div>
      ) : url && kind === 'video' ? (
        <figure className="media-viewer-fig" onClick={(e) => e.stopPropagation()}>
          <video
            className="media-viewer-video"
            data-testid="media-viewer-video"
            src={url}
            controls
            autoPlay
          />
          {caption && <figcaption>{caption}</figcaption>}
        </figure>
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
