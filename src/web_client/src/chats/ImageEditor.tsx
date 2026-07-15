import { useEffect, useRef, useState } from 'react';
import { prepareImage, type PreparedImage } from '../util/image';

// Простой редактор изображения перед отправкой (v1): превью, поворот на 90°
// и подпись. Кроп/разметка — позже. На выходе — подготовленный PreparedImage
// (полноразмерный блоб + thumbnail) и подпись; загрузку блоба и отправку делает
// вызывающий (см. Conversation).
//
// Источник — data-URL через FileReader (без object URL: его revoke в cleanup
// конфликтует с двойным прогоном эффектов в StrictMode). Размеры берём с уже
// отрисованного <img>, поворот применяется при кодировании в canvas.
export function ImageEditor({
  file,
  onCancel,
  onSend,
  onClose,
}: {
  file: File;
  onCancel: () => void;
  onSend: (prepared: PreparedImage, caption: string) => void;
  onClose?: () => void;
}): JSX.Element {
  const [src, setSrc] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [rotation, setRotation] = useState(0);
  const [caption, setCaption] = useState('');
  const imgRef = useRef<HTMLImageElement>(null);
  const captionRef = useRef<HTMLInputElement>(null);

  // Фокус на поле подписи при открытии (#57)
  useEffect(() => {
    captionRef.current?.focus();
  }, []);

  // Возврат фокуса при закрытии (#57)
  useEffect(() => {
    return () => { onClose?.(); };
  }, [onClose]);

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

  async function send(): Promise<void> {
    const el = imgRef.current;
    if (!el || busy) return;
    setBusy(true);
    try {
      const prepared = await prepareImage(el, rotation);
      onSend(prepared, caption.trim());
    } catch {
      setBusy(false); // дать повторить; модалку не закрываем
    }
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
            disabled={busy}
            onClick={() => setRotation((r) => (r + 90) % 360)}
          >
            Повернуть
          </button>
          <input
            ref={captionRef}
            data-testid="image-caption"
            aria-label="Подпись к изображению"
            placeholder="Подпись…"
            value={caption}
            onChange={(e) => setCaption(e.target.value)}
          />
          <button type="button" disabled={busy} onClick={onCancel}>
            Отмена
          </button>
          <button
            type="button"
            data-testid="image-send"
            disabled={!ready || busy}
            onClick={() => void send()}
          >
            Отправить
          </button>
        </div>
      </div>
    </div>
  );
}
