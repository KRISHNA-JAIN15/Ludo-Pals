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

/**
 * Whether our own microphone is delivering sound. "blocked": the device has taken it away or it
 * records pure silence, typically because another app (a phone or WhatsApp call) is using it.
 */
export type MicState = 'ok' | 'blocked';

export interface VoiceEvents {
  onSpeaking(speaking: Record<string, boolean>): void;
  onLinks(links: Record<string, LinkState>): void;
  /** Whether a relay (TURN) server is available: without one, some networks can't reach each other. */
  onRelay(available: boolean): void;
  /** Our own microphone stopped (or started again) delivering sound. */
  onMic(state: MicState): void;
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
  /** Audio packets received at the last check, and when that count last grew. */
  packets: number;
  flowAt: number;
  /** Whether the audio travels through the relay (for diagnostics). */
  relayed: boolean;
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
/** A link that says it is connected but delivers no audio packets for this long gets one redial. */
const STALL_MS = 15_000;
const WATCHDOG_MS = 2_000;
/** How long joining waits for relay credentials before starting without them (they are applied when they arrive). */
const RELAY_WAIT_MS = 2_500;
const RELAY_TIMEOUT_MS = 8_000;
/** Relay credentials are short-lived: fetch fresh ones for connections made after this long. */
const RELAY_REFRESH_MS = 6 * 60 * 60_000;
/** A live, unmuted microphone that records nothing but digital silence for this long is taken to be held by another app. */
const MIC_SILENT_MS = 8_000;
const MIC: MediaStreamConstraints = { audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false };

const newCid = () => Math.random().toString(36).slice(2, 10);
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

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
 * keeps every pair working: a link that drops (network switch, patchy signal), never comes up,
 * or goes silent is redialled, so nobody ends up hearing only some of the others. The microphone
 * is picked up again when the phone takes it away (a call, another app), and relay credentials
 * that weren't ready when joining are applied as soon as they arrive.
 */
export class VoiceChat {
  private active = false;
  private local: MediaStream | null = null;
  private peers = new Map<string, Peer>();
  /** Everyone else in voice: we should have a working link to each of them. */
  private expected = new Set<string>();
  private dials = new Map<string, Dial>();
  /** Links redialled for going silent that haven't delivered audio since (one redial each, no loops). */
  private stalled = new Set<string>();
  /** ICE candidates that overtook the offer they belong to (a resent message can arrive late): caller -> connection id -> candidates. */
  private early = new Map<string, Map<string, RTCIceCandidateInit[]>>();
  private links: Record<string, LinkState> = {};
  private relays: RTCIceServer[] = [];
  private relaysAt = 0;
  private relayLoading: Promise<boolean> | null = null;
  private relayRetry: ReturnType<typeof setTimeout> | null = null;
  private relayTries = 0;
  private ctx: AudioContext | null = null;
  private meters = new Map<string, { an: AnalyserNode; buf: Float32Array<ArrayBuffer>; src: MediaStreamAudioSourceNode }>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private watchdog: ReturnType<typeof setInterval> | null = null;
  private speaking: Record<string, boolean> = {};
  private muted = false;
  private deafened = false;
  private chain: Promise<void> = Promise.resolve();
  private reacquiring = false;
  private micRetry: ReturnType<typeof setTimeout> | null = null;
  private micTries = 0;
  private micState: MicState = 'ok';
  /** Since when our microphone has recorded pure silence (null while it picks anything up). */
  private silentSince: number | null = null;
  /** The server has us down as in voice. Until then nothing is dialled: joining clears our inbox, and a reply could be in it. */
  private announced = false;
  private ready: Promise<void>;
  private markReady: () => void = () => {};
  private lastCheck = 0;
  private waitingForTap = false;

  constructor(
    private transport: VoiceTransport,
    private myId: string,
    private events: VoiceEvents,
  ) {
    this.ready = new Promise((resolve) => (this.markReady = resolve));
  }

  /** `muted`: start with the microphone off (a player who was muted before a reload stays muted throughout). */
  async join(muted = false) {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('Voice chat needs HTTPS (or localhost) and a microphone.');
    this.active = true;
    this.muted = muted;
    const relays = this.loadRelays();
    try {
      this.local = await navigator.mediaDevices.getUserMedia(MIC);
    } catch (err) {
      this.active = false;
      throw err;
    }
    if (!this.active) {
      // Hung up while the permission prompt was open.
      this.local.getTracks().forEach((t) => t.stop());
      this.local = null;
      return;
    }
    this.local.getAudioTracks().forEach((t) => (t.enabled = !this.muted));
    this.watchMic(this.local);
    // Don't hold the call up for slow relay credentials: connections made before they arrive are redialled.
    await Promise.race([relays, sleep(RELAY_WAIT_MS)]);
    if (!this.active) return; // hung up meanwhile: leave() already cleaned up
    try {
      this.ctx = new AudioContext();
      void this.ctx.resume();
    } catch {
      this.ctx = null;
    }
    this.meter(this.myId, this.local);
    this.timer = setInterval(this.measure, 140);
    this.lastCheck = Date.now();
    this.watchdog = setInterval(this.reconcile, WATCHDOG_MS);
    document.addEventListener('visibilitychange', this.onVisible);
    window.addEventListener('online', this.onVisible);
    navigator.mediaDevices.addEventListener?.('devicechange', this.onDevices);
    const peers = await this.transport.join();
    if (!this.active) {
      this.transport.leave(); // hung up while announcing ourselves: take the announcement back
      return;
    }
    if (this.muted || this.micState === 'blocked') this.transport.mute(true);
    this.announced = true;
    this.markReady();
    this.setExpected(peers);
  }

  leave() {
    const wasActive = this.active;
    this.active = false;
    this.announced = false;
    this.markReady(); // signals still waiting for the announcement are let go (and ignored)
    if (wasActive) this.transport.leave();
    this.expected.clear();
    for (const id of [...this.peers.keys()]) this.drop(id);
    this.local?.getTracks().forEach((t) => {
      t.onended = t.onmute = t.onunmute = null;
      t.stop();
    });
    this.local = null;
    if (this.timer) clearInterval(this.timer);
    if (this.watchdog) clearInterval(this.watchdog);
    if (this.relayRetry) clearTimeout(this.relayRetry);
    if (this.micRetry) clearTimeout(this.micRetry);
    this.timer = this.watchdog = this.relayRetry = this.micRetry = null;
    document.removeEventListener('visibilitychange', this.onVisible);
    window.removeEventListener('online', this.onVisible);
    navigator.mediaDevices?.removeEventListener?.('devicechange', this.onDevices);
    this.stopWaitingForTap();
    this.meters.forEach((m) => m.src.disconnect());
    this.meters.clear();
    void this.ctx?.close().catch(() => {});
    this.ctx = null;
    this.speaking = {};
    this.events.onSpeaking({});
    this.dials.clear();
    this.stalled.clear();
    this.early.clear();
    this.links = {};
    this.events.onLinks({});
  }

  /** Re-announce ourselves (after the server dropped us, e.g. the tab slept) and reconnect to everyone. */
  async rejoin() {
    if (!this.active) return;
    for (const id of [...this.peers.keys()]) this.drop(id);
    this.dials.clear();
    this.stalled.clear();
    const peers = await this.transport.join();
    if (!this.active) return;
    if (this.muted || this.micState === 'blocked') this.transport.mute(true);
    this.setExpected(peers);
  }

  /** Who else is in voice right now (from the room). Links to anyone else are hung up. */
  setExpected(ids: string[]) {
    this.expected = new Set(ids.filter((id) => id !== this.myId));
    for (const id of [...this.peers.keys()]) if (!this.expected.has(id)) this.drop(id);
    for (const id of [...this.dials.keys()]) if (!this.expected.has(id)) this.dials.delete(id);
    for (const id of [...this.stalled]) if (!this.expected.has(id)) this.stalled.delete(id);
    this.reconcile();
  }

  setMuted(muted: boolean) {
    this.muted = muted;
    this.silentSince = null;
    this.local?.getAudioTracks().forEach((t) => (t.enabled = !muted));
    this.transport.mute(muted || this.micState === 'blocked');
  }

  setDeafened(deafened: boolean) {
    this.deafened = deafened;
    this.peers.forEach((p) => (p.audio.muted = deafened));
  }

  /** Handle a signaling message from another player (processed strictly in arrival order). */
  receive(from: string, data: VoiceSignal) {
    return this.enqueue(async () => {
      await this.ready; // answer only once we are announced, in the order things arrived
      await this.handle(from, data);
    });
  }

  /** What each link is doing right now (for troubleshooting from the browser console). */
  debug() {
    return {
      relay: this.hasRelay(),
      micState: this.micState,
      mic: this.local?.getAudioTracks().map((t) => `${t.readyState}${t.muted ? ' (silenced by the device)' : ''}`) ?? [],
      links: [...this.expected].map((id) => {
        const p = this.peers.get(id);
        return {
          id,
          state: p ? stateOf(p.pc) : 'none',
          ice: p?.pc.iceConnectionState,
          relayed: p?.relayed,
          packets: p?.packets,
          shown: this.links[id],
        };
      }),
    };
  }

  // --------------------------------------------------------------------------- relay

  private hasRelay() {
    return this.relays.length > 0 || BUILD_TURN.length > 0;
  }

  private iceServers(): RTCIceServer[] {
    return [STUN, ...this.relays, ...BUILD_TURN];
  }

  /**
   * Fetch relay credentials from the game server. A slow or failed request is retried in the
   * background, and links that are still struggling when a relay arrives are redialled through it.
   */
  private loadRelays(): Promise<boolean> {
    if (this.relayLoading) return this.relayLoading;
    const had = this.relays.length > 0;
    const attempt = (async () => {
      try {
        const list = await Promise.race([
          this.transport.iceServers(),
          sleep(RELAY_TIMEOUT_MS).then(() => {
            throw new Error('relay request timed out');
          }),
        ]);
        if (!this.active) return false;
        if (Array.isArray(list) && list.length) {
          this.relays = list;
          this.relaysAt = Date.now();
          this.relayTries = 0;
          return true;
        }
      } catch (err) {
        console.warn('[voice] could not get relay servers', err);
      }
      return false;
    })();
    this.relayLoading = attempt;
    void attempt.then((ok) => {
      this.relayLoading = null;
      if (!this.active) return;
      this.events.onRelay(this.hasRelay());
      if (ok && !had) this.redialStruggling();
      else if (!ok && !this.hasRelay() && this.relayTries < 6) {
        // Maybe a hiccup: try again a few times, further and further apart.
        const wait = Math.min(120_000, 5_000 * 2 ** this.relayTries++);
        if (this.relayRetry) clearTimeout(this.relayRetry);
        this.relayRetry = setTimeout(() => void this.loadRelays(), wait);
      }
    });
    return attempt;
  }

  /** A relay just became available: links that aren't up yet start over so they can use it. */
  private redialStruggling() {
    for (const id of this.expected) {
      const p = this.peers.get(id);
      if (p && stateOf(p.pc) === 'connected') continue;
      const dial = this.dials.get(id);
      if (dial) dial.next = 0;
      if (p) p.createdAt = 0; // counts as timed out
    }
    this.reconcile();
  }

  // --------------------------------------------------------------------------- microphone

  /** Phones take the microphone away for calls and other apps: pick it up again when it ends. */
  private watchMic(stream: MediaStream) {
    for (const track of stream.getAudioTracks()) {
      track.onended = () => void this.reacquire();
      // The device silences the track while something else has the microphone (a call, another app).
      track.onmute = () => this.setMic('blocked');
      track.onunmute = () => {
        this.silentSince = null;
        this.setMic('ok');
      };
      if (track.muted) this.setMic('blocked');
    }
  }

  /** Tell the player, and show them as muted to the others for as long as nobody can hear them anyway. */
  private setMic(state: MicState) {
    if (!this.active || state === this.micState) return;
    this.micState = state;
    if (this.announced && !this.muted) this.transport.mute(state === 'blocked');
    this.events.onMic(state);
  }

  private micLive() {
    return !!this.local?.getAudioTracks().some((t) => t.readyState === 'live');
  }

  private async reacquire() {
    if (!this.active || this.reacquiring) return;
    this.reacquiring = true;
    try {
      const stream = await navigator.mediaDevices.getUserMedia(MIC);
      if (!this.active) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      const track = stream.getAudioTracks()[0];
      track.enabled = !this.muted;
      const old = this.local;
      this.local = stream;
      this.watchMic(stream);
      await Promise.all(
        [...this.peers.values()].map((p) => {
          const sender = p.pc.getSenders().find((s) => !s.track || s.track.kind === 'audio');
          return sender ? sender.replaceTrack(track).catch(() => {}) : Promise.resolve();
        }),
      );
      old?.getTracks().forEach((t) => {
        t.onended = t.onmute = t.onunmute = null;
        t.stop();
      });
      this.meters.get(this.myId)?.src.disconnect();
      this.meters.delete(this.myId);
      this.meter(this.myId, stream);
      this.micTries = 0;
      this.silentSince = null;
      if (!track.muted) this.setMic('ok');
    } catch (err) {
      console.warn('[voice] could not get the microphone back', err);
      if (!this.micLive()) this.setMic('blocked');
      if (this.micRetry) clearTimeout(this.micRetry);
      // Keep trying for a minute; after that, coming back to the tab (or plugging a mic in) tries again.
      if (++this.micTries <= 12) this.micRetry = setTimeout(() => void this.reacquire(), 5_000);
    } finally {
      this.reacquiring = false;
    }
  }

  private onDevices = () => {
    if (!this.active || this.micLive()) return;
    this.micTries = 0;
    void this.reacquire();
  };

  /** Back in the foreground (or back online): check everything right away instead of waiting for the watchdog. */
  private onVisible = () => {
    if (!this.active || document.visibilityState !== 'visible') return;
    void this.ctx?.resume().catch(() => {});
    if (!this.micLive() || this.micState === 'blocked') {
      // Back from another app: it may have let go of the microphone, so ask for it afresh.
      this.micTries = 0;
      void this.reacquire();
    }
    this.peers.forEach((p) => this.play(p.audio));
    this.reconcile();
  };

  // --------------------------------------------------------------------------- playback

  /** Browsers may refuse to start audio until the user touches the page: start it on the next tap. */
  private play(audio: HTMLAudioElement) {
    if (!audio.srcObject) return;
    void audio.play().catch((err: unknown) => {
      // Only an autoplay block needs a tap (a play() cut short by a new stream just gets replaced).
      if (!this.active || this.waitingForTap || (err as { name?: string } | null)?.name !== 'NotAllowedError') return;
      this.waitingForTap = true;
      window.addEventListener('pointerdown', this.onTap, true);
      window.addEventListener('keydown', this.onTap, true);
    });
  }

  private onTap = () => {
    this.stopWaitingForTap();
    void this.ctx?.resume().catch(() => {});
    this.peers.forEach((p) => this.play(p.audio));
  };

  private stopWaitingForTap() {
    this.waitingForTap = false;
    window.removeEventListener('pointerdown', this.onTap, true);
    window.removeEventListener('keydown', this.onTap, true);
  }

  // --------------------------------------------------------------------------- links

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
    if (!this.active || !this.local || !this.announced) return;
    const now = Date.now();
    // The page was asleep (phone locked, another app in front): silence since then proves nothing about a link.
    if (now - this.lastCheck > 3 * WATCHDOG_MS) this.peers.forEach((p) => (p.flowAt = now));
    this.lastCheck = now;
    for (const id of this.expected) {
      const p = this.peers.get(id);
      const state = p ? stateOf(p.pc) : null;
      if (p && state === 'connected') {
        this.dials.delete(id);
        void this.checkFlow(id, p);
        // Connected on paper but no audio is arriving: start over once (again only after audio has flowed).
        if (now - p.flowAt < STALL_MS || this.stalled.has(id)) continue;
        this.stalled.add(id);
        console.warn('[voice] link went silent, redialling', id);
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
      if (now - this.relaysAt > RELAY_REFRESH_MS && this.relaysAt) void this.loadRelays();
      if (this.iCall(id)) void this.enqueue(() => this.call(id));
      else {
        if (p && state !== 'new' && state !== 'connecting')
          this.drop(id); // dead: wait for a fresh call
        else if (p && now - p.createdAt >= CONNECT_TIMEOUT_MS) this.drop(id); // never came up
        this.transport.send(id, { kind: 'hello' });
      }
    }
    this.publishLinks(now);
  };

  /** Count the audio packets a connected link has delivered (and note whether it runs through the relay). */
  private async checkFlow(id: string, p: Peer) {
    try {
      const stats = await p.pc.getStats();
      if (this.peers.get(id) !== p) return;
      let packets = 0;
      let pairId: string | undefined;
      const byId = new Map<string, Record<string, unknown>>();
      stats.forEach((s: Record<string, unknown>) => {
        byId.set(s.id as string, s);
        if (s.type === 'inbound-rtp' && (s.kind ?? s.mediaType) === 'audio') packets += Number(s.packetsReceived ?? 0);
        if (s.type === 'transport' && s.selectedCandidatePairId) pairId = s.selectedCandidatePairId as string;
      });
      const local = pairId ? byId.get(byId.get(pairId)?.localCandidateId as string) : undefined;
      const remote = pairId ? byId.get(byId.get(pairId)?.remoteCandidateId as string) : undefined;
      p.relayed = local?.candidateType === 'relay' || remote?.candidateType === 'relay';
      if (packets > p.packets) {
        p.packets = packets;
        p.flowAt = Date.now();
        this.stalled.delete(id);
      }
    } catch {
      /* stats are best effort */
    }
  }

  private publishLinks(now: number) {
    const next: Record<string, LinkState> = {};
    for (const id of this.expected) {
      const dial = this.dials.get(id);
      next[id] = !dial ? 'connected' : now - dial.since > FAILED_AFTER_MS ? 'failed' : 'connecting';
    }
    const changed = Object.keys(next).length !== Object.keys(this.links).length || Object.keys(next).some((id) => next[id] !== this.links[id]);
    if (changed) {
      this.links = next;
      this.events.onLinks(next);
    }
  }

  private async call(id: string) {
    if (!this.active || !this.local || !this.expected.has(id)) return;
    this.drop(id);
    const p = this.peer(id, newCid());
    const offer = await p.pc.createOffer();
    await p.pc.setLocalDescription(offer);
    this.transport.send(id, { kind: 'offer', sdp: offer.sdp ?? '', cid: p.cid });
  }

  private async handle(from: string, data: VoiceSignal) {
    if (!this.active || !this.local) return;
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
      fresh.pending.push(...(this.early.get(from)?.get(fresh.cid) ?? []));
      this.early.delete(from);
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
      if (p && (!cid || cid === p.cid)) {
        if (p.pc.remoteDescription) await p.pc.addIceCandidate(data.candidate).catch(() => {});
        else p.pending.push(data.candidate);
      } else if (cid && !this.iCall(from)) {
        // For a call whose offer hasn't reached us yet (or for one that's gone): keep it for that offer.
        const calls = this.early.get(from) ?? new Map<string, RTCIceCandidateInit[]>();
        this.early.set(from, calls);
        const list = calls.get(cid) ?? [];
        if (list.length < 60) list.push(data.candidate);
        calls.set(cid, list);
        if (calls.size > 3) calls.delete(calls.keys().next().value!); // only the latest few calls matter
      }
    }
  }

  private async flush(p: Peer) {
    const list = p.pending.splice(0);
    for (const c of list) await p.pc.addIceCandidate(c).catch(() => {});
  }

  private peer(id: string, cid: string): Peer {
    const pc = new RTCPeerConnection({ iceServers: this.iceServers() });
    this.local?.getTracks().forEach((t) => pc.addTrack(t, this.local!));
    const audio = document.createElement('audio');
    audio.autoplay = true;
    audio.setAttribute('playsinline', '');
    audio.muted = this.deafened;
    audio.style.display = 'none';
    document.body.appendChild(audio);
    const now = Date.now();
    const peer: Peer = { cid, pc, audio, pending: [], createdAt: now, disconnectedAt: null, packets: 0, flowAt: now, relayed: false };
    const current = () => this.peers.get(id) === peer;
    pc.onicecandidate = (e) => {
      if (e.candidate && current())
        this.transport.send(id, { kind: 'ice', cid, candidate: e.candidate.toJSON() as Extract<VoiceSignal, { kind: 'ice' }>['candidate'] });
    };
    pc.ontrack = (e) => {
      const stream = e.streams[0] ?? new MediaStream([e.track]);
      audio.srcObject = stream;
      this.play(audio);
      this.meter(id, stream);
    };
    pc.onconnectionstatechange = pc.oniceconnectionstatechange = () => {
      if (!current()) return;
      const state = stateOf(pc);
      peer.disconnectedAt = state === 'disconnected' ? (peer.disconnectedAt ?? Date.now()) : null;
      if (state === 'connected') {
        peer.flowAt = Date.now(); // the silence clock starts once the link is up
        this.play(audio);
      }
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
      this.events.onSpeaking(this.speaking);
    }
  }

  private meter(id: string, stream: MediaStream) {
    if (!this.ctx) return;
    try {
      this.meters.get(id)?.src.disconnect();
      const src = this.ctx.createMediaStreamSource(stream);
      const an = this.ctx.createAnalyser();
      an.fftSize = 512;
      src.connect(an);
      this.meters.set(id, { an, src, buf: new Float32Array(an.fftSize) });
    } catch {
      /* some browsers refuse remote streams here; speaking rings just stay off */
    }
  }

  /**
   * A working microphone always has some noise in it. Exact zeros for seconds on end mean the
   * device is feeding us silence: on phones that is what happens while another app holds the mic.
   */
  private watchSilence(silent: boolean) {
    // Our own mute switch (and a paused audio engine) read as silence too: that proves nothing.
    if (!silent || this.muted || this.ctx?.state !== 'running' || !this.micLive()) {
      this.silentSince = null;
      if (!silent && this.micState === 'blocked' && this.micLive() && !this.local?.getAudioTracks().some((t) => t.muted)) this.setMic('ok');
      return;
    }
    const now = Date.now();
    this.silentSince ??= now;
    if (now - this.silentSince > MIC_SILENT_MS) this.setMic('blocked');
  }

  private measure = () => {
    let changed = false;
    const next: Record<string, boolean> = { ...this.speaking };
    this.meters.forEach(({ an, buf }, id) => {
      an.getFloatTimeDomainData(buf);
      let sum = 0;
      for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
      const rms = Math.sqrt(sum / buf.length);
      if (id === this.myId) this.watchSilence(sum === 0);
      const on = rms > 0.035 && !(id === this.myId && this.muted);
      if (!!next[id] !== on) {
        next[id] = on;
        changed = true;
      }
    });
    if (changed) {
      this.speaking = next;
      this.events.onSpeaking(next);
    }
  };
}
