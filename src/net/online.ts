import { ConvexClient } from 'convex/browser';
import { ConvexError } from 'convex/values';
import { create } from 'zustand';
import { api } from '../../convex/_generated/api';
import type { Id } from '../../convex/_generated/dataModel';
import type { ChatMessage, RoomState, VoiceSignal } from '../../shared/protocol';
import type { BotLevel, CharacterId, GameState, ModeId } from '../../shared/types';
import { sound } from '../audio/sound';
import { tabSecret, useApp } from '../store/app';
import { VoiceChat } from './voice';

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
  emotes: FloatingEmote[];
  voiceOn: boolean;
  voiceBusy: boolean;
  muted: boolean;
  deafened: boolean;
  speaking: Record<string, boolean>;
  connect: () => void;
  create: (p: { maxPlayers: number; mode: ModeId; turnSeconds: number }) => Promise<boolean>;
  join: (code: string) => Promise<boolean>;
  leave: () => void;
  update: (p: { name?: string; character?: CharacterId; ready?: boolean }) => void;
  settings: (p: { maxPlayers?: number; mode?: ModeId; turnSeconds?: number; botLevel?: BotLevel }) => void;
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
  joinVoice: () => Promise<void>;
  leaveVoice: () => void;
  toggleMute: () => void;
  toggleDeafen: () => void;
}

const ROOM_KEY = 'ludo-pals:room';
const CONVEX_URL: string | undefined = import.meta.env.VITE_CONVEX_URL || undefined;
const HEARTBEAT_MS = 10_000;

const secret = tabSecret();
let client: ConvexClient | null = null;
let roomSubs: (() => void)[] = [];
let inboxSub: (() => void) | null = null;
let currentCode: string | null = null;
let leaving = false;
let voice: VoiceChat | null = null;
let voiceRejoining = false;
let emotesPrimed = false;
const seenEmotes = new Set<string>();
const handledSignals = new Set<string>();
let emoteKey = 0;

function rememberRoom(code: string | null) {
  try {
    if (code) sessionStorage.setItem(ROOM_KEY, code);
    else sessionStorage.removeItem(ROOM_KEY);
  } catch {
    /* ignore */
  }
}

export function hadRoom(): boolean {
  try {
    return !!sessionStorage.getItem(ROOM_KEY);
  } catch {
    return false;
  }
}

function errorMessage(e: unknown): string {
  if (e instanceof ConvexError) return typeof e.data === 'string' ? e.data : 'Something went wrong.';
  return 'Could not reach the game server. Check your connection.';
}

/** Run a server call; friendly toast on failure. Resolves null on error or after 10s offline. */
async function call<T>(p: Promise<T>): Promise<T | null> {
  try {
    return await Promise.race([p, new Promise<never>((_, rej) => setTimeout(() => rej(new Error('timeout')), 10_000))]);
  } catch (e) {
    useApp.getState().toast(errorMessage(e), 'error');
    return null;
  }
}

/** Fire-and-forget server call (errors still toast). */
const fire = (p: Promise<unknown> | undefined) => void (p && call(p));

export const useOnline = create<OnlineStore>((set, get) => {
  const app = () => useApp.getState();

  const beat = () => {
    if (client && currentCode) client.mutation(api.rooms.heartbeat, { secret }).catch(() => {});
  };

  const teardownVoice = () => {
    inboxSub?.();
    inboxSub = null;
    voice?.leave();
    voice = null;
    handledSignals.clear();
    set({ voiceOn: false, muted: false, deafened: false, speaking: {} });
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
    set({ room: null, game: null, chat: [], unread: 0, emotes: [], myId: '' });
  };

  const onRoomGone = (reason: string) => {
    clearRoom();
    app().toast(reason, 'info');
    const { screen, go } = app();
    if (screen === 'lobby' || screen === 'game') go('online');
  };

  const onRoom = (room: RoomState | null) => {
    if (!room) return; // the membership subscription reports why
    const prev = get().room;
    set({ room });
    if (prev && room.seats.length > prev.seats.length) sound.play('join');

    if (voice) {
      // Peers who left voice (or the room) hang up.
      for (const s of prev?.seats ?? []) {
        const now = room.seats.find((x) => x.id === s.id);
        if (s.inVoice && (!now || !now.inVoice) && s.id !== get().myId) voice.drop(s.id);
      }
      // The server dropped us from voice (tab slept, network blip): announce ourselves again.
      const mine = room.seats.find((s) => s.id === get().myId);
      if (mine && !mine.inVoice && get().voiceOn && !voiceRejoining) {
        voiceRejoining = true;
        void voice.rejoin().finally(() => (voiceRejoining = false));
      }
    }

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
    if (game && game.phase !== 'over' && app().screen !== 'game' && get().room?.status === 'playing') app().go('game');
  };

  const onChat = (rows: ChatMessage[]) => {
    const known = new Set(get().chat.map((m) => m.id));
    const fresh = get().chat.length ? rows.filter((m) => !known.has(m.id) && m.from !== get().myId && !m.system) : [];
    set({ chat: rows, unread: get().chatOpen ? 0 : get().unread + fresh.length });
    if (fresh.length) sound.play('pop');
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
    unsubscribeRoom();
    leaving = false;
    currentCode = code;
    rememberRoom(code);
    emotesPrimed = false;
    seenEmotes.clear();
    beat();
    const c = client!;
    roomSubs = [
      c.onUpdate(api.rooms.get, { code }, (r) => onRoom(r as RoomState | null)),
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
    if (!currentCode) return;
    const code = currentCode;
    if (leaving) {
      leaving = false;
      clearRoom();
      return;
    }
    // We were removed: tell the player whether the room still exists.
    void client!
      .query(api.rooms.get, { code })
      .then((r) => onRoomGone(r ? 'You were removed from the room.' : 'The room was closed.'))
      .catch(() => onRoomGone('You left the room.'));
  };

  const voiceTransport = {
    join: async () => (await client!.mutation(api.voice.join, { secret })).peers,
    leave: () => void client?.mutation(api.voice.leave, { secret }).catch(() => {}),
    mute: (muted: boolean) => void client?.mutation(api.voice.mute, { secret, muted }).catch(() => {}),
    send: (to: string, data: VoiceSignal) => void client?.mutation(api.voice.signal, { secret, to, data }).catch(() => {}),
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
    emotes: [],
    voiceOn: false,
    voiceBusy: false,
    muted: false,
    deafened: false,
    speaking: {},

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
      client.onUpdate(api.rooms.me, { secret }, onMembership, () => {});
      setInterval(beat, HEARTBEAT_MS);
      document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && beat());
    },

    create: async (p) => {
      get().connect();
      if (!client) return false;
      const { profile } = app();
      const res = await call(client.mutation(api.rooms.create, { secret, ...p, name: profile.name, character: profile.character }));
      return !!res;
    },

    join: async (code) => {
      get().connect();
      if (!client) return false;
      const { profile } = app();
      const res = await call(client.mutation(api.rooms.join, { secret, code, name: profile.name, character: profile.character }));
      return !!res;
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

    joinVoice: async () => {
      if (!client || voice || get().voiceBusy) return;
      set({ voiceBusy: true });
      handledSignals.clear();
      const v = new VoiceChat(voiceTransport, get().myId, (speaking) => set({ speaking }));
      voice = v; // incoming offers may arrive while we are still joining
      inboxSub = client.onUpdate(
        api.voice.inbox,
        { secret },
        (rows) => onSignals(rows as never),
        () => {},
      );
      try {
        await v.join();
        set({ voiceOn: true, muted: false });
        sound.play('join');
      } catch (err) {
        voice = null;
        inboxSub?.();
        inboxSub = null;
        v.leave();
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
    },
    toggleDeafen: () => {
      const deafened = !get().deafened;
      voice?.setDeafened(deafened);
      set({ deafened });
    },
  };
});
