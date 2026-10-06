import type { VoiceSignal } from '../../shared/protocol';

const env = import.meta.env;
const ICE_SERVERS: RTCIceServer[] = [
  { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
  ...(env.VITE_TURN_URL ? [{ urls: String(env.VITE_TURN_URL).split(','), username: env.VITE_TURN_USER, credential: env.VITE_TURN_PASS }] : []),
];

/** How voice talks to the game server: membership plus a relay for signaling messages. */
export interface VoiceTransport {
  /** Mark us as in voice; resolves with the players already in voice (we call them). */
  join(): Promise<string[]>;
  leave(): void;
  mute(muted: boolean): void;
  send(to: string, data: VoiceSignal): void;
}

interface Peer {
  pc: RTCPeerConnection;
  audio: HTMLAudioElement;
  pending: RTCIceCandidateInit[];
}

/**
 * Peer-to-peer voice (full mesh, fine for up to 6 players).
 * Whoever joins voice last sends offers to everyone already in, so each pair has exactly one offerer.
 */
export class VoiceChat {
  private local: MediaStream | null = null;
  private peers = new Map<string, Peer>();
  private ctx: AudioContext | null = null;
  private meters = new Map<string, { an: AnalyserNode; buf: Float32Array<ArrayBuffer>; src: MediaStreamAudioSourceNode }>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private speaking: Record<string, boolean> = {};
  private muted = false;
  private deafened = false;
  private chain: Promise<void> = Promise.resolve();

  constructor(
    private transport: VoiceTransport,
    private myId: string,
    private onSpeaking: (s: Record<string, boolean>) => void,
  ) {}

  async join() {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('Voice chat needs HTTPS (or localhost) and a microphone.');
    this.local = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      video: false,
    });
    try {
      this.ctx = new AudioContext();
      void this.ctx.resume();
    } catch {
      this.ctx = null;
    }
    this.meter(this.myId, this.local);
    this.timer = setInterval(this.measure, 140);
    const peers = await this.transport.join();
    peers.forEach((id) => void this.call(id));
  }

  leave() {
    this.transport.leave();
    for (const id of [...this.peers.keys()]) this.drop(id);
    this.local?.getTracks().forEach((t) => t.stop());
    this.local = null;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.meters.clear();
    void this.ctx?.close().catch(() => {});
    this.ctx = null;
    this.speaking = {};
    this.onSpeaking({});
  }

  /** Re-announce ourselves (after the server dropped us, e.g. the tab slept) and call everyone again. */
  async rejoin() {
    if (!this.local) return;
    for (const id of [...this.peers.keys()]) this.drop(id);
    const peers = await this.transport.join();
    if (this.muted) this.transport.mute(true);
    peers.forEach((id) => void this.call(id));
  }

  setMuted(muted: boolean) {
    this.muted = muted;
    this.local?.getAudioTracks().forEach((t) => (t.enabled = !muted));
    this.transport.mute(muted);
  }

  setDeafened(deafened: boolean) {
    this.deafened = deafened;
    this.peers.forEach((p) => (p.audio.muted = deafened));
  }

  hasPeer(id: string) {
    return this.peers.has(id);
  }

  /** Handle a signaling message from another player (processed strictly in arrival order). */
  receive(from: string, data: VoiceSignal) {
    this.chain = this.chain.then(() => this.handle(from, data)).catch((err) => console.warn('[voice] signal error', err));
    return this.chain;
  }

  drop(id: string) {
    const p = this.peers.get(id);
    if (!p) return;
    this.peers.delete(id);
    p.pc.onicecandidate = null;
    p.pc.ontrack = null;
    p.pc.close();
    p.audio.srcObject = null;
    p.audio.remove();
    this.meters.get(id)?.src.disconnect();
    this.meters.delete(id);
    if (this.speaking[id]) {
      this.speaking = { ...this.speaking, [id]: false };
      this.onSpeaking(this.speaking);
    }
  }

  // ---------------------------------------------------------------------------

  private async call(id: string) {
    const p = this.peer(id);
    const offer = await p.pc.createOffer();
    await p.pc.setLocalDescription(offer);
    this.transport.send(id, { kind: 'offer', sdp: offer.sdp ?? '' });
  }

  private async handle(from: string, data: VoiceSignal) {
    if (!this.local) return;
    if (data.kind === 'offer') {
      // A fresh offer from someone we already know means they rejoined: start clean.
      if (this.peers.get(from)?.pc.remoteDescription) this.drop(from);
      const p = this.peer(from);
      await p.pc.setRemoteDescription({ type: 'offer', sdp: data.sdp });
      await this.flush(p);
      const answer = await p.pc.createAnswer();
      await p.pc.setLocalDescription(answer);
      this.transport.send(from, { kind: 'answer', sdp: answer.sdp ?? '' });
    } else if (data.kind === 'answer') {
      const p = this.peers.get(from);
      if (p && p.pc.signalingState === 'have-local-offer') {
        await p.pc.setRemoteDescription({ type: 'answer', sdp: data.sdp });
        await this.flush(p);
      }
    } else if (data.kind === 'ice') {
      const p = this.peers.get(from) ?? this.peer(from);
      if (p.pc.remoteDescription) await p.pc.addIceCandidate(data.candidate).catch(() => {});
      else p.pending.push(data.candidate);
    }
  }

  private async flush(p: Peer) {
    const list = p.pending.splice(0);
    for (const c of list) await p.pc.addIceCandidate(c).catch(() => {});
  }

  private peer(id: string): Peer {
    const existing = this.peers.get(id);
    if (existing) return existing;
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    this.local?.getTracks().forEach((t) => pc.addTrack(t, this.local!));
    const audio = document.createElement('audio');
    audio.autoplay = true;
    audio.setAttribute('playsinline', '');
    audio.muted = this.deafened;
    audio.style.display = 'none';
    document.body.appendChild(audio);
    const peer: Peer = { pc, audio, pending: [] };
    pc.onicecandidate = (e) => {
      if (e.candidate)
        this.transport.send(id, { kind: 'ice', candidate: e.candidate.toJSON() as Extract<VoiceSignal, { kind: 'ice' }>['candidate'] });
    };
    pc.ontrack = (e) => {
      const stream = e.streams[0] ?? new MediaStream([e.track]);
      audio.srcObject = stream;
      void audio.play().catch(() => {});
      this.meter(id, stream);
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed') this.drop(id);
    };
    this.peers.set(id, peer);
    return peer;
  }

  private meter(id: string, stream: MediaStream) {
    if (!this.ctx) return;
    try {
      const src = this.ctx.createMediaStreamSource(stream);
      const an = this.ctx.createAnalyser();
      an.fftSize = 512;
      src.connect(an);
      this.meters.set(id, { an, src, buf: new Float32Array(an.fftSize) });
    } catch {
      /* some browsers refuse remote streams here; speaking rings just stay off */
    }
  }

  private measure = () => {
    let changed = false;
    const next: Record<string, boolean> = { ...this.speaking };
    this.meters.forEach(({ an, buf }, id) => {
      an.getFloatTimeDomainData(buf);
      let sum = 0;
      for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
      const rms = Math.sqrt(sum / buf.length);
      const on = rms > 0.035 && !(id === this.myId && this.muted);
      if (!!next[id] !== on) {
        next[id] = on;
        changed = true;
      }
    });
    if (changed) {
      this.speaking = next;
      this.onSpeaking(next);
    }
  };
}
