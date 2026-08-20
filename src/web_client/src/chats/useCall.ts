import { useCallback, useEffect, useRef, useState } from 'react';
import type { WsClient } from '../api/ws';

// Call manager (#81). WebRTC P2P + signaling over WS transient events.
//
// Flow: caller startCall() → getUserMedia → createOffer → signal {kind:'offer'}
// → callee shows incoming UI → accept() → getUserMedia → setRemote(offer) →
// createAnswer → signal {kind:'answer'} → ICE exchange ({kind:'ice'}) →
// pc connected → phase 'active'. Either side hangup() / reject() / busy.
//
// One active call per client; a second incoming call during an active one gets
// an automatic {kind:'busy'}. Outgoing ring times out after RING_TIMEOUT.

const RING_TIMEOUT = 45_000;

export type CallPhase = 'idle' | 'outgoing' | 'incoming' | 'connecting' | 'active';

export interface CallInfo {
  phase: CallPhase;
  peerId: string;
  video: boolean;
  muted: boolean;
  cameraOff: boolean;
}

interface SignalData {
  kind: 'offer' | 'answer' | 'ice' | 'hangup' | 'reject' | 'busy';
  sdp?: RTCSessionDescriptionInit;
  candidate?: RTCIceCandidateInit;
  video?: boolean;
}

function peerConnection(): RTCPeerConnection {
  return new RTCPeerConnection({
    iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
  });
}

export function useCall(ws: WsClient) {
  const [call, setCall] = useState<CallInfo>({
    phase: 'idle',
    peerId: '',
    video: false,
    muted: false,
    cameraOff: false,
  });
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const localRef = useRef<MediaStream | null>(null);
  const pendingOfferRef = useRef<RTCSessionDescriptionInit | null>(null);
  const ringTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const phaseRef = useRef<CallPhase>('idle');
  const peerRef = useRef('');

  const setPhase = (p: CallPhase): void => {
    phaseRef.current = p;
    setCall((c) => ({ ...c, phase: p }));
  };

  // Tears down media + connection. Does not change phase by itself.
  const teardown = useCallback((): void => {
    if (ringTimerRef.current) clearTimeout(ringTimerRef.current);
    ringTimerRef.current = null;
    pcRef.current?.close();
    pcRef.current = null;
    localRef.current?.getTracks().forEach((t) => t.stop());
    localRef.current = null;
    pendingOfferRef.current = null;
    setLocalStream(null);
    setRemoteStream(null);
    setCall({ phase: 'idle', peerId: '', video: false, muted: false, cameraOff: false });
    setPhase('idle');
  }, []);

  const signal = useCallback(
    (to: string, data: SignalData): void => {
      ws.sendCallSignal(to, data as unknown as Record<string, unknown>);
    },
    [ws],
  );

  // Common part: create pc, attach local tracks, wire events.
  async function setupPeer(peerId: string, video: boolean): Promise<void> {
    const pc = peerConnection();
    pcRef.current = pc;
    try {
      localRef.current = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: video ? { facingMode: 'user' } : false,
      });
    } catch {
      // No media access — fail the call gracefully.
      signal(peerId, { kind: 'hangup' });
      teardown();
      return;
    }
    setLocalStream(localRef.current);
    for (const track of localRef.current.getTracks()) pc.addTrack(track, localRef.current);
    pc.onicecandidate = (e) => {
      if (e.candidate) signal(peerId, { kind: 'ice', candidate: e.candidate.toJSON() });
    };
    pc.ontrack = (e) => setRemoteStream(e.streams[0] ?? null);
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'connected') setPhase('active');
      else if (
        pc.connectionState === 'failed' ||
        pc.connectionState === 'closed'
      ) {
        if (phaseRef.current !== 'idle') teardown();
      }
    };
  }

  // Outgoing call.
  const startCall = useCallback(
    async (peerId: string, video: boolean): Promise<void> => {
      if (phaseRef.current !== 'idle') return;
      peerRef.current = peerId;
      setCall({ phase: 'outgoing', peerId, video, muted: false, cameraOff: false });
      setPhase('outgoing');
      await setupPeer(peerId, video);
      const pc = pcRef.current;
      if (!pc) return;
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      signal(peerId, { kind: 'offer', sdp: offer, video });
      // Ring timeout: no answer → cancel silently.
      ringTimerRef.current = setTimeout(() => {
        if (phaseRef.current === 'outgoing') {
          signal(peerId, { kind: 'hangup' });
          teardown();
        }
      }, RING_TIMEOUT);
    },
    [signal, teardown],
  );

  // Incoming call accepted (video=true upgrades to video).
  const accept = useCallback(
    async (withVideo: boolean): Promise<void> => {
      const offer = pendingOfferRef.current;
      const peerId = peerRef.current;
      if (!offer || !peerId || phaseRef.current !== 'incoming') return;
      setPhase('connecting');
      await setupPeer(peerId, withVideo);
      const pc = pcRef.current;
      if (!pc) return;
      await pc.setRemoteDescription(offer);
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      signal(peerId, { kind: 'answer', sdp: answer });
    },
    [signal, teardown],
  );

  const reject = useCallback((): void => {
    if (phaseRef.current !== 'incoming') return;
    signal(peerRef.current, { kind: 'reject' });
    teardown();
  }, [signal, teardown]);

  const hangup = useCallback((): void => {
    if (phaseRef.current === 'idle') return;
    signal(peerRef.current, { kind: 'hangup' });
    teardown();
  }, [signal, teardown]);

  const toggleMute = useCallback((): void => {
    const track = localRef.current?.getAudioTracks()[0];
    if (!track) return;
    track.enabled = !track.enabled;
    setCall((c) => ({ ...c, muted: !track.enabled }));
  }, []);

  const toggleCamera = useCallback((): void => {
    const track = localRef.current?.getVideoTracks()[0];
    if (!track) return;
    track.enabled = !track.enabled;
    setCall((c) => ({ ...c, cameraOff: !track.enabled }));
  }, []);

  // Incoming signaling.
  useEffect(() => {
    const off = ws.on('call', (ev: { payload?: { from?: string; data?: SignalData } }) => {
      const from = ev.payload?.from;
      const data = ev.payload?.data;
      if (!from || !data) return;

      if (data.kind === 'offer') {
        if (phaseRef.current !== 'idle') {
          // Busy: decline automatically when already in a call.
          ws.sendCallSignal(from, { kind: 'busy' } as unknown as Record<string, unknown>);
          return;
        }
        peerRef.current = from;
        pendingOfferRef.current = data.sdp ?? null;
        setCall({ phase: 'incoming', peerId: from, video: !!data.video, muted: false, cameraOff: false });
        setPhase('incoming');
        return;
      }
      // Everything below applies only to the current call's peer.
      if (from !== peerRef.current) return;
      const pc = pcRef.current;
      if (data.kind === 'answer' && pc && data.sdp) {
        void pc.setRemoteDescription(data.sdp).catch(() => {});
      } else if (data.kind === 'ice' && pc && data.candidate) {
        void pc.addIceCandidate(data.candidate).catch(() => {});
      } else if (data.kind === 'hangup' || data.kind === 'reject' || data.kind === 'busy') {
        teardown();
      }
    });
    return off;
  }, [ws, teardown]);

  // Unmount cleanup.
  useEffect(() => teardown, [teardown]);

  return { call, remoteStream, localStream, startCall, accept, reject, hangup, toggleMute, toggleCamera };
}
