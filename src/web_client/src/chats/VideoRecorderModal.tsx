import { useEffect, useRef, useState } from 'react';

// Модалка записи видео (#34): зеркальный preview камеры, запись стартует сразу
// по открытию, таймер, автостоп по лимиту 60с. После остановки — превью
// записанного с кнопками «Отправить» / «Перезаписать». Поток освобождается
// при закрытии/перезаписи.

export const VIDEO_MAX_SECONDS = 60;

export interface VideoRecording {
  blob: Blob;
  mime: string;
  duration: number;
  width: number;
  height: number;
}

export function VideoRecorderModal({
  onSend,
  onClose,
  onReRecord,
}: {
  onSend: (rec: VideoRecording) => void;
  onClose: () => void;
  onReRecord: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const previewRef = useRef<HTMLVideoElement>(null);
  const recRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startedAtRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [phase, setPhase] = useState<'starting' | 'recording' | 'preview'>('starting');
  const [seconds, setSeconds] = useState(0);
  const [result, setResult] = useState<{ url: string; rec: VideoRecording } | null>(null);
  const [error, setError] = useState(false);

  const releaseStream = (): void => {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  };

  useEffect(() => {
    let cancelled = false;
    let rec: MediaRecorder | null = null;

    async function begin(): Promise<void> {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: true,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          void videoRef.current.play().catch(() => {});
        }
        const mime = MediaRecorder.isTypeSupported('video/webm;codecs=vp8,opus')
          ? 'video/webm;codecs=vp8,opus'
          : MediaRecorder.isTypeSupported('video/webm')
            ? 'video/webm'
            : '';
        rec = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
        recRef.current = rec;
        chunksRef.current = [];
        rec.ondataavailable = (e) => {
          if (e.data.size > 0) chunksRef.current.push(e.data);
        };
        rec.start(250);
        startedAtRef.current = Date.now();
        setPhase('recording');
        setSeconds(0);
        timerRef.current = setInterval(() => {
          const s = Math.floor((Date.now() - startedAtRef.current) / 1000);
          setSeconds(s);
          if (s >= VIDEO_MAX_SECONDS) stopRecording();
        }, 250);
      } catch {
        if (!cancelled) setError(true);
      }
    }

    void begin();
    return () => {
      cancelled = true;
      releaseStream();
      if (rec && rec.state !== 'inactive') rec.stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Стоп записи: собирает блоб и переключает в превью. Компонентный уровень
  // (не внутри эффекта) — доступен кнопке «Стоп» и автостопу по лимиту.
  function stopRecording(): void {
    const r = recRef.current;
    if (!r || r.state === 'inactive') return;
    r.onstop = () => {
      const duration = (Date.now() - startedAtRef.current) / 1000;
      const mime = r.mimeType || 'video/webm';
      const blob = new Blob(chunksRef.current, { type: mime });
      const track = streamRef.current?.getVideoTracks()[0];
      const settings = track?.getSettings();
      const rec: VideoRecording = {
        blob,
        mime,
        duration,
        width: settings?.width ?? 0,
        height: settings?.height ?? 0,
      };
      releaseStream();
      setResult({ url: URL.createObjectURL(blob), rec });
      setPhase('preview');
    };
    r.stop();
  }

  // Перезапись: сброс результата; родитель перемонтирует модалку (key++) —
  // запись начнётся заново.
  function reRecord(): void {
    if (result) URL.revokeObjectURL(result.url);
    onReRecord();
  }

  function send(): void {
    if (!result) return;
    onSend(result.rec);
  }

  return (
    <div className="img-editor-backdrop video-rec-backdrop" data-testid="video-recorder">
      <div className="video-rec">
        <button type="button" className="video-rec-close" aria-label="Закрыть" onClick={onClose}>
          ×
        </button>
        {error ? (
          <div className="video-rec-error" data-testid="video-rec-error">
            Нет доступа к камере
          </div>
        ) : phase === 'preview' && result ? (
          <video
            ref={previewRef}
            className="video-rec-preview"
            data-testid="video-rec-preview"
            src={result.url}
            controls
            autoPlay
            loop
          />
        ) : (
          <video ref={videoRef} className="video-rec-live" autoPlay muted playsInline />
        )}
        <div className="video-rec-controls">
          {phase === 'recording' && (
            <>
              <span className="video-rec-dot" />
              <span className="video-rec-timer" data-testid="video-rec-timer">
                {formatTime(seconds)}
              </span>
              <span className="video-rec-limit">/ {formatTime(VIDEO_MAX_SECONDS)}</span>
              <button
                type="button"
                className="btn btn-primary"
                data-testid="video-rec-stop"
                onClick={stopRecording}
              >
                Стоп
              </button>
            </>
          )}
          {phase === 'preview' && (
            <>
              <button type="button" className="btn" onClick={reRecord}>
                Перезаписать
              </button>
              <button
                type="button"
                className="btn btn-primary"
                data-testid="video-rec-send"
                onClick={send}
              >
                Отправить
              </button>
            </>
          )}
          {phase === 'starting' && !error && <span>Включаем камеру…</span>}
        </div>
      </div>
    </div>
  );
}

function formatTime(s: number): string {
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${String(sec).padStart(2, '0')}`;
}
