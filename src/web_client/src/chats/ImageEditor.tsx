import { useEffect, useRef, useState } from 'react';
import type { ImageContent } from '../util/content';
import { produceImageContent } from '../util/image';

// Простой редактор изображения перед отправкой (v1): превью, поворот на 90°
// и подпись. Кроп/разметка — позже. На выходе — ужатый под потолок ImageContent.
//
// Источник — data-URL через FileReader (без object URL: его revoke в cleanup
// конфликтует с двойным прогоном эффектов в StrictMode). Размеры берём с уже
// отрисованного <img>, поворот применяется при кодировании в canvas.
export function ImageEditor({
  file,
  onCancel,
  onSend,
}: {
  file: File;
  onCancel: () => void;
  onSend: (content: ImageContent) => void;
}): JSX.Element {
  const [src, setSrc] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [rotation, setRotation] = useState(0);
  const [caption, setCaption] = useState('');
  const imgRef = useRef<HTMLImageElement>(null);

  useEffect(() => {
    let alive = true;
    const reader = new FileReader();
    reader.onload = () => {
      if (alive && typeof reader.result === 'string') setSrc(reader.result);
    };
    reader.onerror = () => onCancel();
    reader.readAsDataURL(file);
    return () => {
      alive = false;
    };
    // onCancel стабилен на время жизни модалки
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file]);

  function send(): void {
    const el = imgRef.current;
    if (!el) return;
    onSend(produceImageContent(el, rotation, caption.trim()));
  }

  return (
    <div className="img-editor-backdrop" data-testid="image-editor">
      <div className="img-editor">
        <div className="img-editor-preview">
          {src && (
            <img
              ref={imgRef}
              src={src}
              alt="Предпросмотр"
              onLoad={() => setReady(true)}
              style={{ transform: `rotate(${rotation}deg)` }}
            />
          )}
        </div>
        <div className="img-editor-controls">
          <button
            type="button"
            data-testid="image-rotate"
            onClick={() => setRotation((r) => (r + 90) % 360)}
          >
            Повернуть
          </button>
          <input
            data-testid="image-caption"
            aria-label="Подпись к изображению"
            placeholder="Подпись…"
            value={caption}
            onChange={(e) => setCaption(e.target.value)}
          />
          <button type="button" onClick={onCancel}>
            Отмена
          </button>
          <button
            type="button"
            data-testid="image-send"
            disabled={!ready}
            onClick={send}
          >
            Отправить
          </button>
        </div>
      </div>
    </div>
  );
}
