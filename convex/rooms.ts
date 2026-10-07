import { v } from 'convex/values';
import { MODES } from '../shared/characters';
import { MIN_PLAYERS, ROOM_CODE_LENGTH, TURN_OPTIONS } from '../shared/protocol';
import { createGame, startGame } from '../shared/rules';
import type { BotLevel, CharacterId } from '../shared/types';
import { internal } from './_generated/api';
import type { MutationCtx } from './_generated/server';
import { internalMutation, mutation, query } from './_generated/server';
import {
  EMPTY_ROOM_TTL_MS,
  ENDED_DROP_MS,
  GONE_GRACE_MS,
  GONE_LEFT_MS,
  HEARTBEAT_STALE_MS,
  LOBBY_DROP_MS,
  SWEEP_EVERY_MS,
  botSeat,
  clampPlayers,
  cleanName,
  closeRoom,
  deleteSignalsTo,
  fail,
  freeCharacter,
  gameFor,
  humanSeat,
  isCharacter,
  isLevel,
  isMode,
  leaveRoom,
  memberBySecret,
  membersOf,
  newId,
  presenceOf,
  requireHost,
  requireMember,
  roomByCode,
  saveGame,
  setPlayerConnected,
  stepCtx,
  system,
  toRoomState,
} from './lib';

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

async function newCode(ctx: MutationCtx) {
  for (;;) {
    let code = '';
    for (let i = 0; i < ROOM_CODE_LENGTH; i++) code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
    if (!(await roomByCode(ctx, code))) return code;
  }
}

async function addMember(ctx: MutationCtx, secret: string, code: string, playerId: string) {
  await ctx.db.insert('members', { secret, roomCode: code, playerId, connected: true, lastChatAt: 0, lastEmoteAt: 0 });
  await ctx.db.insert('presence', { playerId, roomCode: code, lastSeen: Date.now() });
}

// ---------------------------------------------------------------- queries

/** Which room (if any) this browser tab belongs to. Drives resume-after-refresh. */
export const me = query({
  args: { secret: v.string() },
  handler: async (ctx, { secret }) => {
    const m = await memberBySecret(ctx, secret);
    return m ? { code: m.roomCode, playerId: m.playerId } : null;
  },
});

export const get = query({
  args: { code: v.string() },
  handler: async (ctx, { code }) => {
    const room = await roomByCode(ctx, code);
    return room ? toRoomState(room) : null;
  },
});

// ---------------------------------------------------------------- lobby

export const create = mutation({
  args: { secret: v.string(), name: v.string(), character: v.string(), maxPlayers: v.number(), mode: v.string(), turnSeconds: v.number() },
  handler: async (ctx, a) => {
    if (!isCharacter(a.character) || !isMode(a.mode)) fail('Invalid room settings.');
    const prev = await memberBySecret(ctx, a.secret);
    if (prev) await leaveRoom(ctx, prev);
    const code = await newCode(ctx);
    const playerId = newId();
    const name = cleanName(a.name);
    await ctx.db.insert('rooms', {
      code,
      hostId: playerId,
      maxPlayers: clampPlayers(a.maxPlayers),
      mode: a.mode,
      turnSeconds: TURN_OPTIONS.includes(a.turnSeconds) ? a.turnSeconds : 20,
      botLevel: 'normal',
      status: 'lobby',
      seats: [humanSeat(playerId, name, a.character, true)],
      emptySince: null,
    });
    await addMember(ctx, a.secret, code, playerId);
    await system(ctx, code, `${name} created the room`);
    await ctx.scheduler.runAfter(SWEEP_EVERY_MS, internal.rooms.sweep, { code });
    return { code };
  },
});

export const join = mutation({
  args: { secret: v.string(), code: v.string(), name: v.string(), character: v.string() },
  handler: async (ctx, a) => {
    const code = a.code.toUpperCase().replace(/[^A-Z0-9]/g, '');
    const room = await roomByCode(ctx, code);
    if (!room) fail('Room not found. Check the code and try again.');
    const prev = await memberBySecret(ctx, a.secret);
    if (prev?.roomCode === code) return { code }; // already in: just resume
    if (room.status !== 'lobby') fail('That game has already started.');

    const seats = [...room.seats];
    if (seats.length >= room.maxPlayers) {
      const botIdx = seats.map((s) => s.kind).lastIndexOf('bot');
      if (botIdx < 0) fail('Room is full.');
      seats.splice(botIdx, 1); // a human takes a bot's seat
    }
    if (prev) await leaveRoom(ctx, prev);

    const name = cleanName(a.name);
    const playerId = newId();
    seats.push(humanSeat(playerId, name, freeCharacter(seats, isCharacter(a.character) ? a.character : 'cherry'), false));
    await ctx.db.patch(room._id, { seats, emptySince: null });
    await addMember(ctx, a.secret, code, playerId);
    await system(ctx, code, `${name} joined`);
    return { code };
  },
});

export const leave = mutation({
  args: { secret: v.string() },
  handler: async (ctx, { secret }) => {
    const m = await memberBySecret(ctx, secret);
    if (m) await leaveRoom(ctx, m);
  },
});

export const update = mutation({
  args: { secret: v.string(), name: v.optional(v.string()), character: v.optional(v.string()), ready: v.optional(v.boolean()) },
  handler: async (ctx, a) => {
    const { member, room } = await requireMember(ctx, a.secret);
    if (room.status !== 'lobby') return;
    const seats = room.seats.map((s) => {
      if (s.id !== member.playerId) return s;
      const next = { ...s };
      if (a.name !== undefined) next.name = cleanName(a.name);
      if (isCharacter(a.character) && !room.seats.some((o) => o.id !== s.id && o.character === a.character)) next.character = a.character;
      if (a.ready !== undefined && s.id !== room.hostId) next.ready = a.ready;
      return next;
    });
    await ctx.db.patch(room._id, { seats });
  },
});

export const settings = mutation({
  args: {
    secret: v.string(),
    maxPlayers: v.optional(v.number()),
    mode: v.optional(v.string()),
    turnSeconds: v.optional(v.number()),
    botLevel: v.optional(v.string()),
  },
  handler: async (ctx, a) => {
    const { room } = await requireHost(ctx, a.secret);
    if (room.status !== 'lobby') return;
    const patch: Partial<typeof room> = {};
    let seats = [...room.seats];
    if (a.maxPlayers !== undefined) {
      const max = clampPlayers(a.maxPlayers);
      while (seats.length > max) {
        const botIdx = seats.map((s) => s.kind).lastIndexOf('bot');
        if (botIdx < 0) break;
        seats.splice(botIdx, 1);
      }
      patch.maxPlayers = Math.max(max, seats.length);
    }
    if (isMode(a.mode)) patch.mode = a.mode;
    if (a.turnSeconds !== undefined && TURN_OPTIONS.includes(a.turnSeconds)) patch.turnSeconds = a.turnSeconds;
    if (isLevel(a.botLevel)) {
      patch.botLevel = a.botLevel;
      seats = seats.map((s) => (s.kind === 'bot' ? { ...s, botLevel: a.botLevel } : s));
    }
    await ctx.db.patch(room._id, { ...patch, seats });
  },
});

export const addBot = mutation({
  args: { secret: v.string() },
  handler: async (ctx, { secret }) => {
    const { room } = await requireHost(ctx, secret);
    if (room.status !== 'lobby' || room.seats.length >= room.maxPlayers) return;
    await ctx.db.patch(room._id, { seats: [...room.seats, botSeat(room.seats, room.botLevel)] });
  },
});

export const removeSeat = mutation({
  args: { secret: v.string(), id: v.string() },
  handler: async (ctx, { secret, id }) => {
    const { member, room } = await requireHost(ctx, secret);
    if (room.status !== 'lobby' || id === member.playerId) return;
    const seat = room.seats.find((s) => s.id === id);
    if (!seat) return;
    if (seat.kind === 'bot') {
      await ctx.db.patch(room._id, { seats: room.seats.filter((s) => s.id !== id) });
      return;
    }
    const target = (await membersOf(ctx, room.code)).find((m) => m.playerId === id);
    if (target) await leaveRoom(ctx, target, 'removed');
  },
});

export const start = mutation({
  args: { secret: v.string() },
  handler: async (ctx, { secret }) => {
    const { room } = await requireHost(ctx, secret);
    if (room.status !== 'lobby') fail('The game has already started.');
    if (room.seats.length < MIN_PLAYERS) fail('Need at least 2 players (add a bot!).');
    const waiting = room.seats.filter((s) => s.kind === 'human' && s.connected && !s.ready);
    if (waiting.length) fail(`Waiting for ${waiting.map((s) => s.name).join(', ')} to get ready.`);

    const ctxStep = stepCtx();
    const st = createGame(
      {
        seats: room.seats.map((s) => ({
          id: s.id,
          name: s.name,
          character: s.character as CharacterId,
          kind: s.kind,
          botLevel: (s.botLevel ?? room.botLevel) as BotLevel,
        })),
        rules: { ...MODES[room.mode as 'classic' | 'quick'].rules, turnSeconds: room.turnSeconds },
      },
      newId(10),
      ctxStep.now,
    );
    // Anyone who dropped out of the lobby starts with a bot playing for them.
    for (const p of st.players) {
      const seat = room.seats.find((s) => s.id === p.id);
      if (seat?.kind === 'human' && !seat.connected) {
        p.connected = false;
        p.auto = true;
      }
    }
    startGame(st, ctxStep);

    const old = await gameFor(ctx, room.code);
    if (old) await ctx.db.delete(old._id);
    const gameId = await ctx.db.insert('games', { roomCode: room.code, state: st });
    await ctx.db.patch(room._id, { status: 'playing' });
    const fresh = (await ctx.db.get(room._id))!;
    await saveGame(ctx, gameId, fresh, st);
    await system(ctx, room.code, 'Game on! Good luck everyone 🎲');
  },
});

export const rematch = mutation({
  args: { secret: v.string() },
  handler: async (ctx, { secret }) => {
    const { room } = await requireHost(ctx, secret);
    if (room.status !== 'ended') return;
    const game = await gameFor(ctx, room.code);
    if (game) await ctx.db.delete(game._id);
    // Only people who are actually here come along to the rematch lobby.
    const members = await membersOf(ctx, room.code);
    const present = new Set<string>();
    for (const m of members) {
      if (m.connected) {
        present.add(m.playerId);
        continue;
      }
      await ctx.db.delete(m._id);
      const ping = await presenceOf(ctx, m.playerId);
      if (ping) await ctx.db.delete(ping._id);
      await deleteSignalsTo(ctx, m.playerId);
    }
    const seats = room.seats
      .filter((s) => s.kind === 'bot' || (present.has(s.id) && !s.left))
      .map((s) => ({ ...s, ready: s.kind === 'bot' || s.id === room.hostId, inVoice: s.inVoice && present.has(s.id) }));
    await ctx.db.patch(room._id, { status: 'lobby', seats });
    await system(ctx, room.code, 'Back in the lobby. Rematch?');
  },
});

// ---------------------------------------------------------------- presence

/** Called by every client every few seconds while it is in a room. */
export const heartbeat = mutation({
  args: { secret: v.string() },
  handler: async (ctx, { secret }) => {
    const m = await memberBySecret(ctx, secret);
    if (!m) return;
    const now = Date.now();
    const ping = await presenceOf(ctx, m.playerId);
    if (ping) await ctx.db.patch(ping._id, { lastSeen: now, goneAt: undefined });
    else await ctx.db.insert('presence', { playerId: m.playerId, roomCode: m.roomCode, lastSeen: now });
    if (m.connected) return;
    // Back after a drop-out: restore the seat and take the game back from the bot.
    await ctx.db.patch(m._id, { connected: true });
    const room = await roomByCode(ctx, m.roomCode);
    if (!room) return;
    await ctx.db.patch(room._id, {
      emptySince: null,
      seats: room.seats.map((s) => (s.id === m.playerId ? { ...s, connected: true } : s)),
    });
    await setPlayerConnected(ctx, room, m.playerId, true);
  },
});

/**
 * The page-close beacon (see http.ts). The player isn't removed yet: if this was a refresh,
 * the reloaded page heartbeats within a second or two and cancels it.
 */
export const bye = internalMutation({
  args: { secret: v.string() },
  handler: async (ctx, { secret }) => {
    const m = await memberBySecret(ctx, secret);
    if (!m) return;
    const ping = await presenceOf(ctx, m.playerId);
    if (ping) await ctx.db.patch(ping._id, { goneAt: Date.now() });
    await ctx.scheduler.runAfter(GONE_GRACE_MS + 500, internal.rooms.sweep, { code: m.roomCode, once: true });
  },
});

/**
 * Runs every few seconds per room (plus once right after a goodbye beacon):
 * - closed the tab (beacon, no refresh) → removed from lobbies and finished rooms, marked away in games
 * - silent for a while → shown as away (a bot plays for them in a game)
 * - silent for long → removed from lobbies and finished rooms
 * - nobody left for 10 minutes → the room is deleted
 */
export const sweep = internalMutation({
  args: { code: v.string(), once: v.optional(v.boolean()) },
  handler: async (ctx, { code, once }) => {
    let room = await roomByCode(ctx, code);
    if (!room) return;
    const now = Date.now();
    const pings = new Map(
      (
        await ctx.db
          .query('presence')
          .withIndex('by_room', (q) => q.eq('roomCode', code))
          .collect()
      ).map((p) => [p.playerId, p]),
    );
    const idle = (playerId: string) => now - (pings.get(playerId)?.lastSeen ?? 0);
    /** How long ago they closed the page without coming back (null if they didn't). */
    const goneFor = (playerId: string) => {
      const p = pings.get(playerId);
      return p?.goneAt && p.lastSeen <= p.goneAt ? now - p.goneAt : null;
    };
    const gone = (playerId: string, after = GONE_GRACE_MS) => (goneFor(playerId) ?? -1) >= after;
    let members = await membersOf(ctx, code);

    // Lobbies and finished rooms only hold people who are actually around; in a running game
    // a closed tab becomes a departed player (the seat stays, a bot finishes it).
    const limit = room.status === 'lobby' ? LOBBY_DROP_MS : room.status === 'ended' ? ENDED_DROP_MS : Infinity;
    let dropped = false;
    for (const m of members) {
      const closedTab = gone(m.playerId, room.status === 'playing' ? GONE_LEFT_MS : GONE_GRACE_MS);
      if (closedTab || idle(m.playerId) > limit) {
        await leaveRoom(ctx, m, closedTab ? 'left' : 'timedOut');
        dropped = true;
      }
    }
    if (dropped) {
      room = await roomByCode(ctx, code);
      if (!room) return;
      members = await membersOf(ctx, code);
    }

    let seats = room.seats;
    for (const m of members) {
      if (m.connected && (gone(m.playerId) || idle(m.playerId) > HEARTBEAT_STALE_MS)) {
        await ctx.db.patch(m._id, { connected: false });
        seats = seats.map((s) => (s.id === m.playerId ? { ...s, connected: false, inVoice: false, muted: false } : s));
        await setPlayerConnected(ctx, room, m.playerId, false);
      }
    }

    const anyoneHere = members.some((m) => idle(m.playerId) <= HEARTBEAT_STALE_MS && !gone(m.playerId));
    const emptySince = anyoneHere ? null : (room.emptySince ?? now);
    if (emptySince !== null && now - emptySince > EMPTY_ROOM_TTL_MS) {
      await closeRoom(ctx, code);
      return;
    }
    // Only write when something changed: every write re-sends the room to all players.
    if (seats !== room.seats || emptySince !== room.emptySince) {
      const fresh = await ctx.db.get(room._id);
      if (fresh) {
        const away = new Set(seats.filter((s) => !s.connected).map((s) => s.id));
        await ctx.db.patch(room._id, {
          emptySince,
          seats: fresh.seats.map((s) => (away.has(s.id) ? { ...s, connected: false, inVoice: false, muted: false } : s)),
        });
      }
    }
    if (!once) await ctx.scheduler.runAfter(SWEEP_EVERY_MS, internal.rooms.sweep, { code });
  },
});
