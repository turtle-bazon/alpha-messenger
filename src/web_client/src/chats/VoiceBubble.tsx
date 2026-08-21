import { useTranslation } from 'react-i18next';
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react';
import { blobObjectUrl } from '../util/blobUrl';
import { IconPause, IconPlay } from '../util/icons';
import type { AudioAttachment } from '../util/content';

// Voice message bubble (#34): play/pause, waveform from wave[] with
// progress fill (click to seek), duration, speed 1x→1.5x→2x.
// Only one playback at a time (module-level activeVoice singleton).
// Playlist: on ended, onEnded fires — the parent starts the next voice message.

// The single active voice message: starting a new one stops the previous.
const activeVoice: { id: string | null; pause: (() => void) | null } = {
  id: null,
  pause: null,
};

export interface VoiceBubbleHandle {
  play: () => void;
}

export const VoiceBubble = forwardRef<
  VoiceBubbleHandle,
  {
    messageId: string;
    att: AudioAttachment;
    own: boolean;
    onEnded?: () => void;
  }
>(function VoiceBubble({ messageId, att, own, onEnded }, ref) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const urlRef = useRef<string | null>(null);
  const { t } = useTranslation();
  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(0); // 0..1
  const [speed, setSpeed] = useState(1);
  const waveRef = useRef<HTMLDivElement>(null);

  function ensureAudio(): HTMLAudioElement {
    if (audioRef.current) return audioRef.current;
    const a = new Audio();
    a.preload = 'metadata';
    a.onplay = () => setPlaying(true);
    a.onpause = () => setPlaying(false);
    a.ontimeupdate = () => {
      const dur = a.duration;
      if (Number.isFinite(dur) && dur > 0) setProgress(a.currentTime / dur);
      else if (att.duration > 0) setProgress(a.currentTime / att.duration);
    };
    a.onended = () => {
      setProgress(0);
      setPlaying(false);
      if (activeVoice.id === messageId) {
        activeVoice.id = null;
        activeVoice.pause = null;
      }
      onEnded?.();
    };
    audioRef.current = a;
    return a;
  }

  async function play(): Promise<void> {
    // Stop any other playback.
    if (activeVoice.id !== messageId) activeVoice.pause?.();
    const a = ensureAudio();
    if (!urlRef.current) {
      try {
        setLoading(true);
        urlRef.current = await blobObjectUrl(att.blobId);
        a.src = urlRef.current;
      } catch {
        setLoading(false);
        return;
      }
      setLoading(false);
    }
    a.playbackRate = speed;
    activeVoice.id = messageId;
    activeVoice.pause = () => a.pause();
    void a.play().catch(() => {});
  }

  useImperativeHandle(ref, () => ({ play }), [speed]);

  // Release the object URL on unmount.
  useEffect(() => {
    return () => {
      audioRef.current?.pause();
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
      if (activeVoice.id === messageId) {
        activeVoice.id = null;
        activeVoice.pause = null;
      }
    };
  }, [messageId]);

  function toggle(): void {
    if (playing) {
      audioRef.current?.pause();
      return;
    }
    void play();
  }

  function cycleSpeed(): void {
    const next = speed === 1 ? 1.5 : speed === 1.5 ? 2 : 1;
    setSpeed(next);
    if (audioRef.current) audioRef.current.playbackRate = next;
  }

  // Click on the wave — seek by width fraction.
  function seek(e: React.MouseEvent<HTMLDivElement>): void {
    const el = waveRef.current;
    const a = audioRef.current;
    if (!el || !a || !urlRef.current) return;
    const rect = el.getBoundingClientRect();
    const frac = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    const dur = Number.isFinite(a.duration) && a.duration > 0 ? a.duration : att.duration;
    a.currentTime = frac * dur;
    setProgress(frac);
  }

  return (
    <div className={'voice-bubble' + (own ? ' own' : '')} data-testid="voice-bubble">
      <button
        type="button"
        className="voice-play"
        aria-label={playing ? t('voice.pause') : t('voice.play')}
        data-testid="voice-play"
        onClick={toggle}
      >
        {loading ? <span className="voice-loading" /> : playing ? <IconPause /> : <IconPlay />}
      </button>
      <div className="voice-wave" ref={waveRef} onClick={seek}>
        {att.wave.map((v, i) => {
          const filled = i / att.wave.length <= progress;
          return (
            <span
              key={i}
              className={'voice-bar' + (filled ? ' filled' : '')}
              style={{ height: `${Math.max(3, Math.round(v * 24))}px` }}
            />
          );
        })}
      </div>
      <span className="voice-duration">{fmtDur(att.duration)}</span>
      <button
        type="button"
        className="voice-speed"
        onClick={cycleSpeed}
        aria-label={t('voice.speed')}
      >
        {speed}x
      </button>
    </div>
  );
});

function fmtDur(sec: number): string {
  const s = Math.round(sec);
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}
