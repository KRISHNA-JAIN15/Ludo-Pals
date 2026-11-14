import { ConvexClient } from 'convex/browser';
import { ConvexError } from 'convex/values';
import { create } from 'zustand';
import { api } from '../../convex/_generated/api';
import type { Id } from '../../convex/_generated/dataModel';
import type { ChatMessage, RoomState, VoiceSignal } from '../../shared/protocol';
import type { BotLevel, CharacterId, DiceMode, GameState, ModeId } from '../../shared/types';
import { sound } from '../audio/sound';
import { HOST_FEE, tabSecret, useApp } from '../store/app';
import { clearInvite, invitedRoom } from './invite';
import { VoiceChat, type LinkState } from './voice';

export interface FloatingEmote {
  key: number | string;
  from: string;
  emoji: string;
}

export type NetStatus = 'idle' | 'connecting' | 'online' | 'offline' | 'unconfigured';

interface OnlineStore {
  status: NetStatus;
  /** Our player id in the current room ('' when not in one). */
  myId: string;
  room: RoomState | null;
  game: GameState | null;
  chat: ChatMessage[];
  unread: number;
  chatOpen: boolean;
  /** The latest thing each player said, shown as a speech bubble by their chip for a few seconds. */
  bubbles: Record<string, { id: string; text: string }>;
  emotes: FloatingEmote[];
  voiceOn: boolean;
  voiceBusy: boolean;
  muted: boolean;
  deafened: boolean;
  speaking: Record<string, boolean>;
  /** How our audio link to each other player in voice is doing. */
  voiceLinks: Record<string, LinkState>;
  /** Whether voice has a relay (TURN) server to fall back on; null until we know. */
  voiceRelay: boolean | null;
  /** Our microphone is in voice but records nothing: another app has it (a call, WhatsApp) or the device muted it. */
  micBlocked: boolean;
  /** Why the last attempt to join a room failed (shown on the invite screen). */
  joinError: string | null;
  connect: () => void;
  create: (p: { maxPlayers: number; mode: ModeId; turnSeconds: number; dice: DiceMode }) => Promise<boolean>;
  /** `quiet`: the caller shows `joinError` itself, so no toast. */
  join: (code: string, quiet?: boolean) => Promise<boolean>;
  /** Go to whatever screen the room we're in calls for (after an invite was given up on). */
  resume: () => void;
  leave: () => void;
  update: (p: { name?: string; character?: CharacterId; ready?: boolean }) => void;
  settings: (p: { maxPlayers?: number; mode?: ModeId; turnSeconds?: number; botLevel?: BotLevel; dice?: DiceMode }) => void;
  addBot: () => void;
  removeSeat: (id: string) => void;
  start: () => Promise<void>;
  rematch: () => void;
  roll: () => void;
  move: (token: number) => void;
  takeover: () => void;
  emote: (emoji: string) => void;
  say: (text: string) => void;
  setChatOpen: (open: boolean) => void;
  /** The chat is on screen: nothing is unread. */
  markChatRead: () => void;
  /** `startMuted`: join with the microphone off. */
  joinVoice: (startMuted?: boolean) => Promise<void>;
  leaveVoice: () => void;
  toggleMute: () => void;
  toggleDeafen: () => void;
}

const ROOM_KEY = 'ludo-pals:room';
const VOICE_KEY = 'ludo-pals:voice'; // this tab was in voice (so a refresh can put it back)
const CONVEX_URL: string | undefined = import.meta.env.VITE_CONVEX_URL || undefined;
/** Where Convex HTTP actions live: https://x.convex.cloud → https://x.convex.site (local dev sets it explicitly). */
const SITE_URL: string | undefined =
  import.meta.env.VITE_CONVEX_SITE_URL || (CONVEX_URL?.includes('.convex.cloud') ? CONVEX_URL.replace('.convex.cloud', '.convex.site') : undefined);
const HEARTBEAT_MS = 10_000;
/** Sent with room queries so the server knows this build understands everything it can say (see rooms.get). */
const APP_VERSION = 2;
/** ICE candidates found within this window travel to the other player in one message. */
const SIGNAL_BATCH_MS = 70;

const secret = tabSecret();
let client: ConvexClient | null = null;
let roomSubs: (() => void)[] = [];
let inboxSub: (() => void) | null = null;
let currentCode: string | null = null;
let leaving = false;
let voice: VoiceChat | null = null;
let voiceRejoining = false;
let clearingStaleVoice = false;
/** Voice was already put back once after this page load (don't loop if it fails). */
let voiceResumed = false;
/** Players we already said we can't reach by voice. */
const warnedLinks = new Set<string>();
/** When we last tried to slip back into a lobby we were dropped from (avoid retry loops). */
let lastAutoRejoin = 0;
/** The room's status the last time it showed us seated (and not left): what we were doing before losing the seat. */
let seatedStatus: RoomStatus = 'lobby';
let emotesPrimed = false;
/** The room's chat history has arrived (what comes after it is new). */
let chatPrimed = false;
const seenEmotes = new Set<string>();
const handledSignals = new Set<string>();
let emoteKey = 0;

type RoomStatus = RoomState['status'];

/** What this identity was last doing online, kept per identity so a new tab can pick it up. */
interface RoomMemory {
  code: string;
  /** Our seat's public id. */
  id: string;
  /** The room's status the last time we had a seat in it. */
  status: RoomStatus;
  /** When a tab last confirmed it. */
  at: number;
  /** The tab was closed (or navigated away) rather than killed by the browser. */
  closed?: boolean;
}

/** A new tab slips back into a lobby it lost only this soon after the old tab went quiet. */
const LOBBY_RETURN_MS = 5 * 60_000;

const roomKey = () => `${ROOM_KEY}:${secret}`;

function rememberRoom(m: RoomMemory | null) {
  try {
    if (m) localStorage.setItem(roomKey(), JSON.stringify(m));
    else localStorage.removeItem(roomKey());
  } catch {
    /* ignore */
  }
}

function rememberedRoom(): RoomMemory | null {
  try {
    const m = JSON.parse(localStorage.getItem(roomKey()) ?? 'null') as RoomMemory | null;
    return m && typeof m.code === 'string' ? m : null;
  } catch {
    return null;
  }
}

export function hadRoom(): boolean {
  return !!rememberedRoom();
}

function rememberVoice(v: { code: string; muted: boolean } | null) {
  try {
    if (v) sessionStorage.setItem(VOICE_KEY, JSON.stringify(v));
    else sessionStorage.removeItem(VOICE_KEY);
  } catch {
    /* ignore */
  }
}

/** This tab was in voice in that room before it reloaded. */
function rememberedVoice(code: string): { muted: boolean } | null {
  try {
    const v = JSON.parse(sessionStorage.getItem(VOICE_KEY) ?? 'null') as { code?: string; muted?: boolean } | null;
    return v && v.code === code ? { muted: !!v.muted } : null;
  } catch {
    return null;
  }
}

/** This page load is a refresh (or the browser reloading a tab it put to sleep), not a new tab. */
function reloaded(): boolean {
  try {
    return (performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined)?.type === 'reload';
  } catch {
    return false;
  }
}

/** Why we lost our seat, for a toast; null when there is nothing worth saying. */
function goneReason(room: RoomState | null, was: RoomStatus | undefined, myId: string): string | null {
  if (!room) return 'The room was closed.';
  // Our seat stays in a running game (marked as left) while a bot plays it.
  if (myId && room.seats.some((s) => s.id === myId)) return 'You were away too long, so a bot is finishing your game.';
  if (was === 'playing') return 'The game finished while you were away.';
  if (room.status === 'playing' && was === 'lobby') return 'The game started without you.';
  if (room.status === 'lobby' && was === 'lobby') return 'You were removed from the room.';
  return null;
}

/** Hosting costs coins: say so and return true when this player can't cover a match. */
function cantHost(): boolean {
  const { profile, toast } = useApp.getState();
  if (profile.coins >= HOST_FEE) return false;
  toast(
    `Hosting costs ${HOST_FEE} coins a match and you have ${profile.coins}. Join a friend's room for free, or win offline games to earn more!`,
    'info',
  );
  return true;
}

function errorMessage(e: unknown): string {
  if (e instanceof ConvexError) return typeof e.data === 'string' ? e.data : 'Something went wrong.';
  return 'Could not reach the game server. Check your connection.';
}

/** A server call that gives up after 10s offline. */
const withTimeout = <T>(p: Promise<T>): Promise<T> =>
  Promise.race([p, new Promise<never>((_, rej) => setTimeout(() => rej(new Error('timeout')), 10_000))]);

/** Run a server call; friendly toast on failure. Resolves null on error or after 10s offline. */
async function call<T>(p: Promise<T>): Promise<T | null> {
  try {
    return await withTimeout(p);
  } catch (e) {
    useApp.getState().toast(errorMessage(e), 'error');
    return null;
  }
}

/** Fire-and-forget server call (errors still toast). */
const fire = (p: Promise<unknown> | undefined) => void (p && call(p));

export const useOnline = create<OnlineStore>((set, get) => {
  const app = () => useApp.getState();

  /** Note what we're doing, so a new tab (after a closed tab or a killed browser) can pick it up. */
  const noteRoom = (closed?: boolean) => {
    if (currentCode) rememberRoom({ code: currentCode, id: get().myId, status: seatedStatus, at: Date.now(), closed });
  };

  const beat = () => {
    if (!client || !currentCode) return;
    noteRoom();
    client.mutation(api.rooms.heartbeat, { secret }).catch(() => {});
  };

  const teardownVoice = () => {
    inboxSub?.();
    inboxSub = null;
    voice?.leave();
    voice = null;
    handledSignals.clear();
    outboxTimers.forEach((t) => clearTimeout(t));
    outboxTimers.clear();
    outbox.clear();
    warnedLinks.clear();
    rememberVoice(null);
    set({ voiceOn: false, muted: false, deafened: false, speaking: {}, voiceLinks: {}, voiceRelay: null, micBlocked: false });
  };

  /** Say so (once per player) when our audio can't reach someone, and why if we know. */
  const onVoiceLinks = (voiceLinks: Record<string, LinkState>) => {
    const before = get().voiceLinks;
    set({ voiceLinks });
    for (const [id, state] of Object.entries(voiceLinks)) {
      if (state !== 'failed' || before[id] === 'failed' || warnedLinks.has(id)) continue;
      warnedLinks.add(id);
      const name = get().room?.seats.find((s) => s.id === id)?.name ?? 'a player';
      app().toast(
        get().voiceRelay === false
          ? `Voice can't reach ${name}: one of your networks blocks direct calls, and this game has no voice relay set up yet.`
          : `Still trying to connect your voice with ${name}…`,
        'info',
      );
    }
  };

  const unsubscribeRoom = () => {
    roomSubs.forEach((u) => u());
    roomSubs = [];
    currentCode = null;
  };

  const clearRoom = () => {
    teardownVoice();
    unsubscribeRoom();
    rememberRoom(null);
    set({ room: null, game: null, chat: [], unread: 0, emotes: [], bubbles: {}, myId: '' });
  };

  const onRoomGone = (reason: string | null) => {
    clearRoom();
    if (reason) app().toast(reason, 'info');
    const { screen, go } = app();
    if (screen === 'lobby' || screen === 'game') go('online');
  };

  const onRoom = (room: RoomState | null) => {
    if (!room) return; // the membership subscription reports why
    const prev = get().room;
    set({ room });
    if (prev && room.seats.length > prev.seats.length) sound.play('join');

    const mine = room.seats.find((s) => s.id === get().myId);
    if (mine && !mine.left && room.status !== seatedStatus) {
      seatedStatus = room.status;
      noteRoom();
    }
    if (voice) {
      // Keep a link to everyone in voice (and hang up on anyone who left it).
      voice.setExpected(room.seats.filter((s) => s.inVoice && s.connected).map((s) => s.id));
      // The server dropped us from voice (tab slept, network blip): announce ourselves again.
      if (mine && !mine.inVoice && get().voiceOn && !voiceRejoining) {
        voiceRejoining = true;
        void voice.rejoin().finally(() => (voiceRejoining = false));
      }
    } else if (mine && !mine.left && !get().voiceBusy && client) {
      // (Not while an invite is taking this tab to another room.)
      const invited = invitedRoom();
      const before = voiceResumed || (invited && invited !== room.code) ? null : rememberedVoice(room.code);
      if (before) {
        // This tab was in voice before it reloaded: put it back, as muted as it was.
        voiceResumed = true;
        void get().joinVoice(before.muted);
      } else if (mine.inVoice && !clearingStaleVoice) {
        // We were in voice before a refresh; that call is gone, so stop showing us as in it.
        clearingStaleVoice = true;
        void client
          .mutation(api.voice.leave, { secret })
          .catch(() => {})
          .finally(() => (clearingStaleVoice = false));
      }
    }

    route(room);
  };

  /** Show the screen the room calls for. */
  const route = (room: RoomState) => {
    // Arrived through an invite to another room: that join is on its way, so don't flash the old room first.
    const invited = invitedRoom();
    if (invited && invited !== room.code) return;
    if (invited) clearInvite(); // we are in the invited room: the invite is used up, however slowly the join came through
    const { screen, go } = app();
    if (room.status === 'lobby' && screen !== 'lobby') {
      set({ game: null });
      go('lobby');
    } else if (room.status === 'playing' && screen !== 'game') {
      go('game');
    } else if (room.status === 'ended' && get().game && screen !== 'game' && screen !== 'results') {
      go('game'); // the game view forwards straight to the results
    }
  };

  const onGame = (game: GameState | null) => {
    set({ game });
    const me = game ? game.players.findIndex((p) => p.id === get().myId) : -1;
    if (game && me >= 0 && !game.players[me].left) {
      if (game.hostId === get().myId) app().payHostFee(game.id, game.phase !== 'over');
      // Bank the prize as soon as it's decided: a quick rematch can swap the board out before the results show.
      if (game.phase === 'over') app().bankResult(game, me);
    }
    const invited = invitedRoom();
    if (game && game.phase !== 'over' && app().screen !== 'game' && get().room?.status === 'playing' && (!invited || invited === get().room?.code))
      app().go('game');
  };

  const onChat = (rows: ChatMessage[]) => {
    const known = new Set(get().chat.map((m) => m.id));
    const added = chatPrimed ? rows.filter((m) => !known.has(m.id) && !m.system) : [];
    chatPrimed = true;
    const fresh = added.filter((m) => m.from !== get().myId);
    set({ chat: rows, unread: get().chatOpen ? 0 : get().unread + fresh.length });
    if (fresh.length) sound.play('pop');
    if (!added.length) return;
    // Pop what was just said next to the speaker's chip (the last line each, for a few seconds).
    const bubbles = { ...get().bubbles };
    for (const m of added) bubbles[m.from] = { id: m.id, text: m.text };
    set({ bubbles });
    const ids = new Set(added.map((m) => m.id));
    setTimeout(() => {
      const left = Object.fromEntries(Object.entries(get().bubbles).filter(([, b]) => !ids.has(b.id)));
      if (Object.keys(left).length !== Object.keys(get().bubbles).length) set({ bubbles: left });
    }, 4200);
  };

  const onEmotes = (rows: { id: string; from: string; emoji: string }[]) => {
    if (!emotesPrimed) {
      rows.forEach((r) => seenEmotes.add(r.id)); // don't replay old reactions when joining
      emotesPrimed = true;
      return;
    }
    const fresh = rows.filter((r) => !seenEmotes.has(r.id)).reverse();
    if (!fresh.length) return;
    fresh.forEach((r) => seenEmotes.add(r.id));
    const added: FloatingEmote[] = fresh.map((r) => ({ key: `${r.id}-${++emoteKey}`, from: r.from, emoji: r.emoji }));
    set({ emotes: [...get().emotes, ...added].slice(-12) });
    sound.play('pop');
    setTimeout(() => set({ emotes: get().emotes.filter((e) => !added.includes(e)) }), 2600);
  };

  const subscribeRoom = (code: string) => {
    if (voice) teardownVoice(); // a call belongs to the room (and the seat) it was made in
    unsubscribeRoom();
    leaving = false;
    currentCode = code;
    seatedStatus = 'lobby';
    voiceResumed = false;
    emotesPrimed = false;
    chatPrimed = false;
    seenEmotes.clear();
    beat();
    const c = client!;
    roomSubs = [
      c.onUpdate(api.rooms.get, { code, v: APP_VERSION }, (r) => onRoom(r as RoomState | null)),
      c.onUpdate(api.game.get, { code }, (g) => onGame(g as GameState | null)),
      c.onUpdate(api.social.chat, { code }, onChat),
      c.onUpdate(api.social.emotes, { code }, onEmotes),
    ];
  };

  const onMembership = (me: { code: string; playerId: string } | null) => {
    if (me) {
      set({ myId: me.playerId });
      if (me.code !== currentCode) subscribeRoom(me.code);
      return;
    }
    if (leaving) {
      leaving = false;
      clearRoom();
      return;
    }
    // We lost our seat without leaving: away too long, kicked, or the room closed. A tab that
    // slept through it explains what happened; a new tab (the old one was closed or killed)
    // has no room yet, so it goes by what this identity was last doing.
    const memory = currentCode ? null : rememberedRoom();
    const code = currentCode ?? memory?.code;
    if (!code) return;
    const was = memory ? memory.status : seatedStatus;
    const myId = get().myId || memory?.id || '';
    // A tab closed on purpose said goodbye to its lobby (a refresh isn't a goodbye); one the browser
    // killed gets a few minutes to come back. An invite link wins: the Online screen joins that room.
    const mayRejoin = memory
      ? was === 'lobby' && (!memory.closed || reloaded()) && Date.now() - memory.at < LOBBY_RETURN_MS && !invitedRoom()
      : was !== 'playing';
    if (memory && !mayRejoin && was !== 'playing') {
      clearRoom(); // nothing worth saying about a lobby or finished game we walked away from
      return;
    }
    void client!
      .query(api.rooms.get, { code, v: APP_VERSION })
      .then(async (room) => {
        if (room?.status === 'lobby' && mayRejoin && Date.now() - lastAutoRejoin > 30_000) {
          // Back from being away: slip straight back into the lobby (the server refuses kicked players).
          lastAutoRejoin = Date.now();
          clearRoom();
          if (await get().join(code)) {
            app().toast("Welcome back! You're in the lobby again.", 'success');
            return;
          }
          if (app().screen === 'lobby' || app().screen === 'game') app().go('online');
          return;
        }
        onRoomGone(goneReason(room as RoomState | null, was, myId));
      })
      .catch(() => onRoomGone('You left the room.'));
  };

  /**
   * Signals to one player are sent together: an offer or answer goes out at once, the ICE candidates
   * that trickle in after it a few at a time. A batch the server didn't take is tried again, since a
   * lost offer or answer would leave that pair waiting for the next redial.
   */
  const outbox = new Map<string, VoiceSignal[]>();
  const outboxTimers = new Map<string, ReturnType<typeof setTimeout>>();

  const deliver = (to: string, batch: VoiceSignal[], attempt = 0) => {
    if (!client) return;
    client.mutation(api.voice.signals, { secret, to, batch }).catch(() => {
      if (!voice || !client) return;
      if (attempt < 2) setTimeout(() => deliver(to, batch, attempt + 1), 400 * (attempt + 1));
      // Last resort (also covers a server that predates batches): one message at a time.
      else for (const data of batch) client.mutation(api.voice.signal, { secret, to, data }).catch(() => {});
    });
  };

  const flushSignals = (to: string) => {
    const timer = outboxTimers.get(to);
    if (timer) clearTimeout(timer);
    outboxTimers.delete(to);
    const batch = outbox.get(to);
    outbox.delete(to);
    if (batch?.length) deliver(to, batch);
  };

  const sendSignal = (to: string, data: VoiceSignal) => {
    const queue = outbox.get(to) ?? [];
    queue.push(data);
    outbox.set(to, queue);
    if (data.kind !== 'ice' || queue.length >= 20) flushSignals(to);
    else if (!outboxTimers.has(to))
      outboxTimers.set(
        to,
        setTimeout(() => flushSignals(to), SIGNAL_BATCH_MS),
      );
  };

  const voiceTransport = {
    join: async () => (await client!.mutation(api.voice.join, { secret })).peers,
    leave: () => void client?.mutation(api.voice.leave, { secret }).catch(() => {}),
    mute: (muted: boolean) => void client?.mutation(api.voice.mute, { secret, muted }).catch(() => {}),
    send: sendSignal,
    iceServers: async () => (await client!.action(api.voice.iceServers, { secret })) as RTCIceServer[],
  };

  const onSignals = (rows: { id: Id<'signals'>; from: string; data: VoiceSignal }[]) => {
    const fresh = rows.filter((r) => !handledSignals.has(r.id));
    if (!fresh.length || !voice) return;
    for (const r of fresh) {
      handledSignals.add(r.id);
      void voice.receive(r.from, r.data);
    }
    void client!.mutation(api.voice.ack, { secret, ids: fresh.map((r) => r.id) }).catch(() => {});
  };

  return {
    status: 'idle',
    myId: '',
    room: null,
    game: null,
    chat: [],
    unread: 0,
    chatOpen: false,
    bubbles: {},
    emotes: [],
    voiceOn: false,
    voiceBusy: false,
    muted: false,
    deafened: false,
    speaking: {},
    voiceLinks: {},
    voiceRelay: null,
    micBlocked: false,
    joinError: null,

    connect: () => {
      if (client) return;
      if (!CONVEX_URL) {
        set({ status: 'unconfigured' });
        return;
      }
      client = new ConvexClient(CONVEX_URL);
      set({ status: 'connecting' });
      client.subscribeToConnectionState((s) =>
        set({ status: s.isWebSocketConnected ? 'online' : s.hasEverConnected || s.connectionRetries > 2 ? 'offline' : 'connecting' }),
      );
      // Back from a refresh: say we're here before anything else, cancelling the goodbye beacon.
      if (hadRoom()) client.mutation(api.rooms.heartbeat, { secret }).catch(() => {});
      client.onUpdate(api.rooms.me, { secret }, onMembership, () => {});
      setInterval(beat, HEARTBEAT_MS);
      document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && beat());
      // Closing the tab: tell the server right away so others see it within seconds.
      // (If this is only a refresh, the reloaded page's heartbeat cancels it.)
      window.addEventListener('pagehide', () => {
        if (!currentCode) return;
        noteRoom(true);
        if (!SITE_URL) return;
        try {
          navigator.sendBeacon(`${SITE_URL}/bye`, secret);
        } catch {
          /* best effort */
        }
      });
    },

    create: async (p) => {
      if (cantHost()) return false;
      get().connect();
      if (!client) return false;
      const { profile } = app();
      const res = await call(client.mutation(api.rooms.create, { secret, ...p, name: profile.name, character: profile.character }));
      return !!res;
    },

    join: async (code, quiet) => {
      get().connect();
      if (!client) {
        set({ joinError: "Online play isn't set up for this build." });
        return false;
      }
      set({ joinError: null });
      const { profile } = app();
      try {
        await withTimeout(client.mutation(api.rooms.join, { secret, code, name: profile.name, character: profile.character }));
        return true;
      } catch (e) {
        const joinError = errorMessage(e);
        set({ joinError });
        if (!quiet) app().toast(joinError, 'error');
        return false;
      }
    },

    resume: () => {
      const room = get().room;
      if (room) route(room);
    },

    leave: () => {
      if (!client || !currentCode) return;
      leaving = true;
      teardownVoice(); // hang up while still a member, then leave
      fire(client.mutation(api.rooms.leave, { secret }));
      clearRoom();
    },

    update: (p) => fire(client?.mutation(api.rooms.update, { secret, ...p })),
    settings: (p) => fire(client?.mutation(api.rooms.settings, { secret, ...p })),
    addBot: () => fire(client?.mutation(api.rooms.addBot, { secret })),
    removeSeat: (id) => fire(client?.mutation(api.rooms.removeSeat, { secret, id })),
    start: async () => {
      if (client) await call(client.mutation(api.rooms.start, { secret }));
    },
    rematch: () => fire(client?.mutation(api.rooms.rematch, { secret })),
    roll: () => fire(client?.mutation(api.game.roll, { secret })),
    move: (token) => fire(client?.mutation(api.game.move, { secret, token })),
    takeover: () => fire(client?.mutation(api.game.takeover, { secret })),
    emote: (emoji) => fire(client?.mutation(api.social.emote, { secret, emoji })),
    say: (text) => fire(client?.mutation(api.social.say, { secret, text })),
    setChatOpen: (open) => set({ chatOpen: open, unread: open ? 0 : get().unread }),
    markChatRead: () => {
      if (get().unread) set({ unread: 0 });
    },

    joinVoice: async (startMuted = false) => {
      if (!client || voice || get().voiceBusy) return;
      set({ voiceBusy: true });
      handledSignals.clear();
      const v = new VoiceChat(voiceTransport, get().myId, {
        onSpeaking: (speaking) => set({ speaking }),
        onLinks: onVoiceLinks,
        onRelay: (voiceRelay) => voice === v && set({ voiceRelay }),
        onMic: (state) => {
          if (voice !== v) return;
          const micBlocked = state === 'blocked';
          if (micBlocked === get().micBlocked) return;
          set({ micBlocked });
          app().toast(
            micBlocked
              ? "Your mic isn't picking anything up, so nobody can hear you. Another app (a phone or WhatsApp call) may be using it: close it and your voice comes back."
              : 'Your mic is working again.',
            micBlocked ? 'error' : 'success',
          );
        },
      });
      voice = v; // incoming offers may arrive while we are still joining
      // For troubleshooting a call from the browser console: __voice() lists every link's state.
      (window as unknown as { __voice?: () => unknown }).__voice = () => v.debug();
      inboxSub = client.onUpdate(
        api.voice.inbox,
        { secret },
        (rows) => onSignals(rows as never),
        () => {},
      );
      try {
        await v.join(startMuted);
        if (voice !== v) return; // hung up (or left the room) while joining
        set({ voiceOn: true, muted: startMuted });
        if (currentCode) rememberVoice({ code: currentCode, muted: startMuted });
        sound.play('join');
      } catch (err) {
        if (voice !== v) return;
        voice = null;
        inboxSub?.();
        inboxSub = null;
        v.leave();
        rememberVoice(null);
        const msg =
          err instanceof DOMException && err.name === 'NotAllowedError'
            ? 'Microphone permission was blocked.'
            : err instanceof Error
              ? err.message
              : 'Could not start voice chat.';
        app().toast(msg, 'error');
      } finally {
        set({ voiceBusy: false });
      }
    },
    leaveVoice: () => teardownVoice(),
    toggleMute: () => {
      const muted = !get().muted;
      voice?.setMuted(muted);
      set({ muted });
      if (voice && currentCode) rememberVoice({ code: currentCode, muted });
    },
    toggleDeafen: () => {
      const deafened = !get().deafened;
      voice?.setDeafened(deafened);
      set({ deafened });
    },
  };
});
