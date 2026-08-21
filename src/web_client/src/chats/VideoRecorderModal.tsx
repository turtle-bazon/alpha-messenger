import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

// Video recording modal (#34): mirrored camera preview, recording starts
// immediately on open, timer, auto-stop at the 60s limit. After stopping —
// a preview of the recording with Send / Re-record buttons. The stream is
// released on close/re-record.

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
  const { t } = useTranslation();
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

  // Stop recording: assembles the blob and switches to preview. Lives at the
  // component level (not inside an effect) — available to the Stop button and the limit auto-stop.
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

  // Re-record: reset the result; the parent remounts the modal (key++) —
  // recording starts over.
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
        <button type="button" className="video-rec-close" aria-label={t('common.close')} onClick={onClose}>
          ×
        </button>
        {error ? (
          <div className="video-rec-error" data-testid="video-rec-error">
            {t('videoRec.noCamera')}
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
                {t('videoRec.stop')}
              </button>
            </>
          )}
          {phase === 'preview' && (
            <>
              <button type="button" className="btn" onClick={reRecord}>
                {t('videoRec.rerecord')}
              </button>
              <button
                type="button"
                className="btn btn-primary"
                data-testid="video-rec-send"
                onClick={send}
              >
                {t('conv.send')}
              </button>
            </>
          )}
          {phase === 'starting' && !error && <span>{t('videoRec.starting')}</span>}
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
