import type { VoiceSignal } from '../../shared/protocol';

const env = import.meta.env;
const STUN: RTCIceServer = { urls: ['stun:stun.l.google.com:19302', 'stun:stun.cloudflare.com:3478'] };
/** A TURN server baked into the build. Optional: relays handed out by the game server are preferred. */
const BUILD_TURN: RTCIceServer[] = env.VITE_TURN_URL
  ? [{ urls: String(env.VITE_TURN_URL).split(','), username: env.VITE_TURN_USER, credential: env.VITE_TURN_PASS }]
  : [];

/** How our audio link to another player is doing. */
export type LinkState = 'connecting' | 'connected' | 'failed';

/** How voice talks to the game server: membership plus a relay for signaling messages. */
export interface VoiceTransport {
  /** Mark us as in voice; resolves with the players already in voice. */
  join(): Promise<string[]>;
  leave(): void;
  mute(muted: boolean): void;
  send(to: string, data: VoiceSignal): void;
  /** Relay (TURN) servers for this session, if the game server has any. */
  iceServers(): Promise<RTCIceServer[]>;
}

interface Peer {
  /** This connection's id: signals carrying any other id belong to a replaced connection. */
  cid: string;
  pc: RTCPeerConnection;
  audio: HTMLAudioElement;
  pending: RTCIceCandidateInit[];
  createdAt: number;
  /** When the link last dropped to "disconnected" (it often recovers by itself). */
  disconnectedAt: number | null;
}

interface Dial {
  attempts: number;
  /** Earliest time to try again. */
  next: number;
  /** Since when this link has been wanted but not working. */
  since: number;
}

/** A new connection gets this long to come up before it's redialled. */
const CONNECT_TIMEOUT_MS = 15_000;
/** A "disconnected" link gets this long to recover by itself. */
const DISCONNECT_GRACE_MS = 6_000;
/** Not working for this long: show the link as failed (we keep retrying). */
const FAILED_AFTER_MS = 20_000;
const WATCHDOG_MS = 2_000;

const newCid = () => Math.random().toString(36).slice(2, 10);

function stateOf(pc: RTCPeerConnection): RTCPeerConnectionState {
  if (pc.connectionState) return pc.connectionState;
  // Older browsers only report the ICE state.
  const ice = pc.iceConnectionState;
  return ice === 'checking' ? 'connecting' : ice === 'completed' ? 'connected' : (ice as RTCPeerConnectionState);
}

/**
 * Peer-to-peer voice (a full mesh, fine for up to 6 players), relayed through TURN when a
 * network won't allow a direct path.
 *
 * Every pair has one fixed caller, the player with the smaller id, so two people can never call
 * each other at the same moment; the other side asks to be called with a "hello". A watchdog
 * keeps every pair working: a link that drops (network switch, patchy signal) or never comes up
 * is redialled, so nobody silently ends up hearing only some of the others.
 */
export class VoiceChat {
  private local: MediaStream | null = null;
  private peers = new Map<string, Peer>();
  /** Everyone else in voice: we should have a working link to each of them. */
  private expected = new Set<string>();
  private dials = new Map<string, Dial>();
  private links: Record<string, LinkState> = {};
  private iceServers: RTCIceServer[] = [STUN, ...BUILD_TURN];
  private ctx: AudioContext | null = null;
  private meters = new Map<string, { an: AnalyserNode; buf: Float32Array<ArrayBuffer>; src: MediaStreamAudioSourceNode }>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private watchdog: ReturnType<typeof setInterval> | null = null;
  private speaking: Record<string, boolean> = {};
  private muted = false;
  private deafened = false;
  private chain: Promise<void> = Promise.resolve();

  constructor(
    private transport: VoiceTransport,
    private myId: string,
    private onSpeaking: (s: Record<string, boolean>) => void,
    private onLinks: (l: Record<string, LinkState>) => void,
  ) {}

  async join() {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('Voice chat needs HTTPS (or localhost) and a microphone.');
    const relays = this.transport.iceServers().catch(() => [] as RTCIceServer[]);
    this.local = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      video: false,
    });
    this.iceServers = [STUN, ...(await relays), ...BUILD_TURN];
    try {
      this.ctx = new AudioContext();
      void this.ctx.resume();
    } catch {
      this.ctx = null;
    }
    this.meter(this.myId, this.local);
    this.timer = setInterval(this.measure, 140);
    this.watchdog = setInterval(this.reconcile, WATCHDOG_MS);
    this.setExpected(await this.transport.join());
  }

  leave() {
    this.transport.leave();
    this.expected.clear();
    for (const id of [...this.peers.keys()]) this.drop(id);
    this.local?.getTracks().forEach((t) => t.stop());
    this.local = null;
    if (this.timer) clearInterval(this.timer);
    if (this.watchdog) clearInterval(this.watchdog);
    this.timer = this.watchdog = null;
    this.meters.clear();
    void this.ctx?.close().catch(() => {});
    this.ctx = null;
    this.speaking = {};
    this.onSpeaking({});
    this.dials.clear();
    this.links = {};
    this.onLinks({});
  }

  /** Re-announce ourselves (after the server dropped us, e.g. the tab slept) and reconnect to everyone. */
  async rejoin() {
    if (!this.local) return;
    for (const id of [...this.peers.keys()]) this.drop(id);
    this.dials.clear();
    const peers = await this.transport.join();
    if (this.muted) this.transport.mute(true);
    this.setExpected(peers);
  }

  /** Who else is in voice right now (from the room). Links to anyone else are hung up. */
  setExpected(ids: string[]) {
    this.expected = new Set(ids.filter((id) => id !== this.myId));
    for (const id of [...this.peers.keys()]) if (!this.expected.has(id)) this.drop(id);
    for (const id of [...this.dials.keys()]) if (!this.expected.has(id)) this.dials.delete(id);
    this.reconcile();
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

  /** Handle a signaling message from another player (processed strictly in arrival order). */
  receive(from: string, data: VoiceSignal) {
    return this.enqueue(() => this.handle(from, data));
  }

  // ---------------------------------------------------------------------------

  /** All connection changes run one at a time, so a signal never lands on a half-built connection. */
  private enqueue(job: () => Promise<void>) {
    this.chain = this.chain.then(job).catch((err) => console.warn('[voice] signal error', err));
    return this.chain;
  }

  /** The player with the smaller id calls; the other answers. */
  private iCall(id: string) {
    return this.myId < id;
  }

  /** Bring every wanted link up, redial broken ones (with backoff), and report how each link is doing. */
  private reconcile = () => {
    if (!this.local) return;
    const now = Date.now();
    for (const id of this.expected) {
      const p = this.peers.get(id);
      const state = p ? stateOf(p.pc) : null;
      if (state === 'connected') {
        this.dials.delete(id);
        continue;
      }
      const dial = this.dials.get(id) ?? { attempts: 0, next: 0, since: now };
      this.dials.set(id, dial);
      const coming =
        p &&
        (((state === 'new' || state === 'connecting') && now - p.createdAt < CONNECT_TIMEOUT_MS) ||
          (state === 'disconnected' && now - (p.disconnectedAt ?? now) < DISCONNECT_GRACE_MS));
      if (coming || now < dial.next) continue;
      dial.attempts++;
      dial.next = now + Math.min(30_000, 2_000 * 2 ** Math.min(dial.attempts - 1, 4));
      if (this.iCall(id)) void this.enqueue(() => this.call(id));
      else {
        if (p && state !== 'new' && state !== 'connecting') this.drop(id); // dead: wait for a fresh call
        this.transport.send(id, { kind: 'hello' });
      }
    }
    this.publishLinks(now);
  };

  private publishLinks(now: number) {
    const next: Record<string, LinkState> = {};
    for (const id of this.expected) {
      const dial = this.dials.get(id);
      next[id] = !dial ? 'connected' : now - dial.since > FAILED_AFTER_MS ? 'failed' : 'connecting';
    }
    const changed = Object.keys(next).length !== Object.keys(this.links).length || Object.keys(next).some((id) => next[id] !== this.links[id]);
    if (changed) {
      this.links = next;
      this.onLinks(next);
    }
  }

  private async call(id: string) {
    if (!this.local || !this.expected.has(id)) return;
    this.drop(id);
    const p = this.peer(id, newCid());
    const offer = await p.pc.createOffer();
    await p.pc.setLocalDescription(offer);
    this.transport.send(id, { kind: 'offer', sdp: offer.sdp ?? '', cid: p.cid });
  }

  private async handle(from: string, data: VoiceSignal) {
    if (!this.local) return;
    const p = this.peers.get(from);
    // Messages from before this change carry no connection id: treat them as current.
    const cid = 'cid' in data ? data.cid : undefined;
    if (data.kind === 'hello') {
      if (!this.iCall(from) || !this.expected.has(from)) return;
      // They just called for help while our fresh call is still on its way: don't dial twice.
      if (p && Date.now() - p.createdAt < 3_000 && stateOf(p.pc) !== 'failed') return;
      await this.call(from);
    } else if (data.kind === 'offer') {
      if (p && cid && p.cid === cid) return; // a duplicate
      this.drop(from);
      const fresh = this.peer(from, cid ?? newCid());
      await fresh.pc.setRemoteDescription({ type: 'offer', sdp: data.sdp });
      await this.flush(fresh);
      const answer = await fresh.pc.createAnswer();
      await fresh.pc.setLocalDescription(answer);
      this.transport.send(from, { kind: 'answer', sdp: answer.sdp ?? '', cid: fresh.cid });
    } else if (data.kind === 'answer') {
      if (!p || (cid && cid !== p.cid) || p.pc.signalingState !== 'have-local-offer') return;
      await p.pc.setRemoteDescription({ type: 'answer', sdp: data.sdp });
      await this.flush(p);
    } else if (data.kind === 'ice') {
      if (!p || (cid && cid !== p.cid)) return; // for a connection that's gone
      if (p.pc.remoteDescription) await p.pc.addIceCandidate(data.candidate).catch(() => {});
      else p.pending.push(data.candidate);
    }
  }

  private async flush(p: Peer) {
    const list = p.pending.splice(0);
    for (const c of list) await p.pc.addIceCandidate(c).catch(() => {});
  }

  private peer(id: string, cid: string): Peer {
    const pc = new RTCPeerConnection({ iceServers: this.iceServers });
    this.local?.getTracks().forEach((t) => pc.addTrack(t, this.local!));
    const audio = document.createElement('audio');
    audio.autoplay = true;
    audio.setAttribute('playsinline', '');
    audio.muted = this.deafened;
    audio.style.display = 'none';
    document.body.appendChild(audio);
    const peer: Peer = { cid, pc, audio, pending: [], createdAt: Date.now(), disconnectedAt: null };
    const current = () => this.peers.get(id) === peer;
    pc.onicecandidate = (e) => {
      if (e.candidate && current())
        this.transport.send(id, { kind: 'ice', cid, candidate: e.candidate.toJSON() as Extract<VoiceSignal, { kind: 'ice' }>['candidate'] });
    };
    pc.ontrack = (e) => {
      const stream = e.streams[0] ?? new MediaStream([e.track]);
      audio.srcObject = stream;
      void audio.play().catch(() => {});
      this.meter(id, stream);
    };
    pc.onconnectionstatechange = pc.oniceconnectionstatechange = () => {
      if (!current()) return;
      const state = stateOf(pc);
      peer.disconnectedAt = state === 'disconnected' ? (peer.disconnectedAt ?? Date.now()) : null;
      if (state === 'connected' || state === 'failed' || state === 'closed') this.reconcile();
    };
    this.peers.set(id, peer);
    return peer;
  }

  private drop(id: string) {
    const p = this.peers.get(id);
    if (!p) return;
    this.peers.delete(id);
    p.pc.onicecandidate = null;
    p.pc.ontrack = null;
    p.pc.onconnectionstatechange = p.pc.oniceconnectionstatechange = null;
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
