import { useEffect, useState } from 'react';
import { colorFor, initialFor } from './avatar';
import type { CallInfo } from './useCall';

// Full-screen call overlay (#81) — Telegram Desktop style.
// Incoming: name + accept/decline. Outgoing: "Calling…". Active: timer,
// remote video (or avatar for audio), local PiP, mute/camera/hangup controls.

export function CallOverlay({
  call,
  peerName,
  remoteStream,
  localStream,
  onAccept,
  onReject,
  onHangup,
  onToggleMute,
  onToggleCamera,
}: {
  call: CallInfo;
  peerName: string;
  remoteStream: MediaStream | null;
  localStream: MediaStream | null;
  onAccept: (withVideo: boolean) => void;
  onReject: () => void;
  onHangup: () => void;
  onToggleMute: () => void;
  onToggleCamera: () => void;
}) {
  const [elapsed, setElapsed] = useState(0);

  // Timer counts from the moment the phase becomes 'active'.
  useEffect(() => {
    if (call.phase !== 'active') {
      setElapsed(0);
      return;
    }
    const started = Date.now();
    const t = setInterval(() => setElapsed(Math.floor((Date.now() - started) / 1000)), 500);
    return () => clearInterval(t);
  }, [call.phase]);

  // Remote video element needs the stream attached imperatively.
  const remoteVideoRef = (el: HTMLVideoElement | null): void => {
    if (el && remoteStream && el.srcObject !== remoteStream) el.srcObject = remoteStream;
  };
  const localVideoRef = (el: HTMLVideoElement | null): void => {
    if (el && localStream && el.srcObject !== localStream) el.srcObject = localStream;
  };

  const statusText =
    call.phase === 'incoming'
      ? call.video
        ? 'Входящий видеозвонок…'
        : 'Входящий звонок…'
      : call.phase === 'outgoing'
        ? 'Вызов…'
        : call.phase === 'connecting'
          ? 'Соединение…'
          : fmtSec(elapsed);

  return (
    <div className="call-overlay" data-testid="call-overlay" data-phase={call.phase}>
      {call.video && call.phase !== 'incoming' && (
        <video
          ref={remoteVideoRef}
          className="call-remote-video"
          data-testid="call-remote-video"
          autoPlay
          playsInline
        />
      )}
      <div className="call-center">
        <span
          className="call-avatar"
          style={{ background: colorFor(peerName || '?') }}
        >
          {initialFor(peerName || '?')}
        </span>
        <div className="call-name" data-testid="call-peer-name">
          {peerName || '—'}
        </div>
        <div className="call-status" data-testid="call-status">
          {statusText}
        </div>
      </div>

      {/* Local PiP preview in an active video call. */}
      {call.video && call.phase === 'active' && localStream && (
        <video
          ref={localVideoRef}
          className={'call-local-video' + (call.cameraOff ? ' off' : '')}
          autoPlay
          muted
          playsInline
        />
      )}

      <div className="call-controls">
        {call.phase === 'incoming' ? (
          <>
            <button
              type="button"
              className="call-btn decline"
              aria-label="Отклонить"
              data-testid="call-decline"
              onClick={onReject}
            >
              ✕
            </button>
            <button
              type="button"
              className="call-btn accept"
              aria-label="Принять"
              data-testid="call-accept"
              onClick={() => onAccept(false)}
            >
              🎙
            </button>
            <button
              type="button"
              className="call-btn accept"
              aria-label="Принять с видео"
              data-testid="call-accept-video"
              onClick={() => onAccept(true)}
            >
              🎥
            </button>
          </>
        ) : (
          <>
            {call.phase === 'active' && (
              <>
                <button
                  type="button"
                  className={'call-btn small' + (call.muted ? ' toggled' : '')}
                  aria-label={call.muted ? 'Включить микрофон' : 'Выключить микрофон'}
                  data-testid="call-mute"
                  onClick={onToggleMute}
                >
                  {call.muted ? '🔇' : '🎙'}
                </button>
                {call.video && (
                  <button
                    type="button"
                    className={'call-btn small' + (call.cameraOff ? ' toggled' : '')}
                    aria-label={call.cameraOff ? 'Включить камеру' : 'Выключить камеру'}
                    data-testid="call-camera"
                    onClick={onToggleCamera}
                  >
                    📷
                  </button>
                )}
              </>
            )}
            <button
              type="button"
              className="call-btn decline"
              aria-label="Завершить"
              data-testid="call-hangup"
              onClick={onHangup}
            >
              ✕
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function fmtSec(total: number): string {
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}
