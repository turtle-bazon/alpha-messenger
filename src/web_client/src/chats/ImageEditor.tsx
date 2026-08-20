import { useEffect, useRef, useState } from 'react';
import { prepareImage, type PreparedImage, type Stroke } from '../util/image';

// Simple image editor before sending: preview, 90° rotation, freehand
// annotation (pen with palette + undo, #83) and caption. Output: a prepared
// PreparedImage (full-size blob + thumbnail) and the caption; blob upload and
// sending are done by the caller (see Conversation).
//
// The source is a data-URL via FileReader (no object URL: revoking it in cleanup
// conflicts with the double effect run in StrictMode). Strokes are stored in
// normalized coordinates of the rotated view — they map 1:1 onto the encoded
// canvas at any resolution.

const PEN_COLORS = ['#ffffff', '#000000', '#e53935', '#fdd835', '#43a047', '#1e88e5'];
const PREVIEW_MAX_W = 520;
const PREVIEW_MAX_H = 340;

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
  // Annotation state (#83): committed strokes + the one being drawn.
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const [liveStroke, setLiveStroke] = useState<Stroke | null>(null);
  const [penColor, setPenColor] = useState(PEN_COLORS[2]);
  const imgRef = useRef<HTMLImageElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const captionRef = useRef<HTMLInputElement>(null);
  const [dispSize, setDispSize] = useState<{ w: number; h: number }>({ w: 0, h: 0 });

  // Focus the caption field on open (#57)
  useEffect(() => {
    captionRef.current?.focus();
  }, []);

  // Return focus on close (#57).
  // Keep the current reference in a ref so cleanup doesn't re-run
  // on every parent rerender caused by the inline onClose.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    return () => { onCloseRef.current?.(); };
  }, []);

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
    // onCancel is stable for the modal's lifetime
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file]);

  // Displayed size: natural dims swapped for 90/270, fitted into the preview box.
  useEffect(() => {
    const el = imgRef.current;
    if (!el || !el.naturalWidth) return;
    const swap = rotation === 90 || rotation === 270;
    const nw = swap ? el.naturalHeight : el.naturalWidth;
    const nh = swap ? el.naturalWidth : el.naturalHeight;
    const scale = Math.min(1, PREVIEW_MAX_W / nw, PREVIEW_MAX_H / nh);
    setDispSize({ w: Math.round(nw * scale), h: Math.round(nh * scale) });
  }, [ready, rotation, src]);

  // Redraw the overlay canvas whenever strokes or geometry change.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || dispSize.w === 0) return;
    const dpr = window.devicePixelRatio || 1;
    if (canvas.width !== dispSize.w * dpr) {
      canvas.width = dispSize.w * dpr;
      canvas.height = dispSize.h * dpr;
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.scale(dpr, dpr);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const s of [...strokes, ...(liveStroke ? [liveStroke] : [])]) {
      if (s.points.length < 2) continue;
      ctx.strokeStyle = s.color;
      ctx.lineWidth = Math.max(2, s.width * dispSize.w);
      ctx.beginPath();
      ctx.moveTo(s.points[0].x * dispSize.w, s.points[0].y * dispSize.h);
      for (let i = 1; i < s.points.length; i++) {
        ctx.lineTo(s.points[i].x * dispSize.w, s.points[i].y * dispSize.h);
      }
      ctx.stroke();
    }
  }, [strokes, liveStroke, dispSize]);

  function normPoint(e: React.PointerEvent<HTMLCanvasElement>): { x: number; y: number } {
    const rect = e.currentTarget.getBoundingClientRect();
    return {
      x: Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width)),
      y: Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height)),
    };
  }

  function onPenDown(e: React.PointerEvent<HTMLCanvasElement>): void {
    e.currentTarget.setPointerCapture(e.pointerId);
    setLiveStroke({ color: penColor, width: 0.012, points: [normPoint(e)] });
  }

  function onPenMove(e: React.PointerEvent<HTMLCanvasElement>): void {
    setLiveStroke((s) => (s ? { ...s, points: [...s.points, normPoint(e)] } : s));
  }

  function onPenUp(): void {
    setLiveStroke((s) => {
      if (s && s.points.length >= 2) setStrokes((prev) => [...prev, s]);
      return null;
    });
  }

  async function send(): Promise<void> {
    const el = imgRef.current;
    if (!el || busy) return;
    setBusy(true);
    try {
      const prepared = await prepareImage(el, rotation, strokes);
      onSend(prepared, caption.trim());
    } catch {
      setBusy(false); // let the user retry; keep the modal open
    }
  }

  return (
    <div
      className="img-editor-backdrop"
      data-testid="image-editor"
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation();
          onCancel();
        }
      }}
    >
      <div className="img-editor">
        <div className="img-editor-preview">
          {src && (
            <div className="img-editor-stage" style={{ width: dispSize.w, height: dispSize.h }}>
              <img
                ref={imgRef}
                src={src}
                alt="Предпросмотр"
                onLoad={() => setReady(true)}
                style={{
                  width: dispSize.w,
                  height: dispSize.h,
                  transform: `rotate(${rotation}deg)`,
                }}
              />
              <canvas
                ref={canvasRef}
                className="img-editor-canvas"
                data-testid="image-annot-canvas"
                style={{ width: dispSize.w, height: dispSize.h }}
                onPointerDown={onPenDown}
                onPointerMove={onPenMove}
                onPointerUp={onPenUp}
              />
            </div>
          )}
        </div>
        <div className="img-editor-tools" data-testid="image-annot-tools">
          <span className="img-editor-tool-label">Рисовать:</span>
          {PEN_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              className={'img-editor-color' + (c === penColor ? ' active' : '')}
              style={{ background: c }}
              aria-label={`Цвет ${c}`}
              data-testid={`image-color-${c.slice(1)}`}
              onClick={() => setPenColor(c)}
            />
          ))}
          <button
            type="button"
            data-testid="image-undo"
            disabled={strokes.length === 0 || busy}
            onClick={() => setStrokes((prev) => prev.slice(0, -1))}
          >
            Отменить штрих
          </button>
          <button
            type="button"
            data-testid="image-clear-strokes"
            disabled={strokes.length === 0 || busy}
            onClick={() => setStrokes([])}
          >
            Стереть всё
          </button>
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
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                if (ready && !busy) void send();
              }
            }}
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
