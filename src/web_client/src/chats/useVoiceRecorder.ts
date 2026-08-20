import { useCallback, useEffect, useRef, useState } from 'react';

// Voice message recording (#34). MediaRecorder (webm/opus) + AnalyserNode
// to sample loudness peaks: ~20 samples/sec, aggregated into a wave of WAVE_BARS
// values 0..1 (averaged per segment) — the wave is stored with the message and
// rendered without decoding audio.
//
// Auto-stop at the MAX_SECONDS limit. stop() finishes recording and returns a Blob;
// cancel() silently discards the result. The microphone stream is always released.

export const WAVE_BARS = 48;
export const MAX_SECONDS = 300; // voice limit — 5 minutes

export interface VoiceRecording {
  blob: Blob;
  mime: string;
  duration: number;
  wave: number[];
}

type RecorderState = 'idle' | 'starting' | 'recording';

export function useVoiceRecorder(onAutoStop?: () => void): {
  state: RecorderState;
  seconds: number;
  levels: number[]; // live bars while recording
  start: () => Promise<void>;
  stop: () => Promise<VoiceRecording | null>;
  cancel: () => void;
} {
  const [state, setState] = useState<RecorderState>('idle');
  const [seconds, setSeconds] = useState(0);
  const [levels, setLevels] = useState<number[]>(() => new Array(WAVE_BARS).fill(0));

  const recRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const waveRef = useRef<number[]>([]);
  const segSumRef = useRef(0);
  const segCountRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const rafRef = useRef(0);
  const startedAtRef = useRef(0);
  const autoStoppedRef = useRef(false);
  // Fresh onAutoStop without restarting effects.
  const autoStopCbRef = useRef(onAutoStop);
  autoStopCbRef.current = onAutoStop;

  const cleanup = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = 0;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    void ctxRef.current?.close().catch(() => {});
    ctxRef.current = null;
    recRef.current = null;
  }, []);

  useEffect(() => cleanup, [cleanup]);

  const start = useCallback(async () => {
    if (recRef.current) return;
    setState('starting');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      // Loudness analyser: sampled in requestAnimationFrame, aggregated per ~50ms.
      const Ctx = window.AudioContext;
      const ctx = new Ctx();
      ctxRef.current = ctx;
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      source.connect(analyser);
      const buf = new Uint8Array(analyser.frequencyBinCount);

      chunksRef.current = [];
      waveRef.current = [];
      segSumRef.current = 0;
      segCountRef.current = 0;
      autoStoppedRef.current = false;
      setSeconds(0);
      setLevels(new Array(WAVE_BARS).fill(0));

      let lastSeg = performance.now();
      const tick = (): void => {
        analyser.getByteTimeDomainData(buf);
        // RMS of the current window → normalized to 0..1 (with slight gain).
        let sum = 0;
        for (let i = 0; i < buf.length; i++) {
          const v = (buf[i] - 128) / 128;
          sum += v * v;
        }
        const rms = Math.sqrt(sum / buf.length);
        segSumRef.current += rms;
        segCountRef.current += 1;
        const now = performance.now();
        if (now - lastSeg >= 50) {
          lastSeg = now;
          const avg = segSumRef.current / Math.max(1, segCountRef.current);
          segSumRef.current = 0;
          segCountRef.current = 0;
          const level = Math.min(1, avg * 4);
          waveRef.current.push(level);
          setLevels((prev) => [...prev.slice(1), level]);
        }
        rafRef.current = requestAnimationFrame(tick);
      };
      rafRef.current = requestAnimationFrame(tick);

      const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : MediaRecorder.isTypeSupported('audio/webm')
          ? 'audio/webm'
          : '';
      const rec = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
      recRef.current = rec;
      rec.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      rec.start(250);
      startedAtRef.current = Date.now();
      setState('recording');
      timerRef.current = setInterval(() => {
        const s = Math.floor((Date.now() - startedAtRef.current) / 1000);
        setSeconds(s);
        if (s >= MAX_SECONDS && !autoStoppedRef.current) {
          autoStoppedRef.current = true;
          autoStopCbRef.current?.();
        }
      }, 250);
    } catch {
      // No microphone access — fall back to idle.
      cleanup();
      setState('idle');
    }
  }, [cleanup]);

  const finish = useCallback(
    (discard: boolean): Promise<VoiceRecording | null> => {
      const rec = recRef.current;
      if (!rec) return Promise.resolve(null);
      return new Promise((resolve) => {
        rec.onstop = () => {
          const duration = (Date.now() - startedAtRef.current) / 1000;
          const mime = rec.mimeType || 'audio/webm';
          const blob = new Blob(chunksRef.current, { type: mime });
          cleanup();
          setState('idle');
          setSeconds(0);
          setLevels(new Array(WAVE_BARS).fill(0));
          resolve(discard || blob.size === 0 ? null : { blob, mime, duration, wave: waveRef.current });
        };
        rec.stop();
      });
    },
    [cleanup],
  );

  const stop = useCallback(() => finish(false), [finish]);
  const cancel = useCallback(() => {
    void finish(true);
  }, [finish]);

  return { state, seconds, levels, start, stop, cancel };
}
