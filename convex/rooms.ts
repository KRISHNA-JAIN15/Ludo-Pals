import { v } from 'convex/values';
import { MODES } from '../shared/characters';
import { MIN_PLAYERS, ROOM_CODE_LENGTH, TURN_OPTIONS } from '../shared/protocol';
import { newSeed } from '../shared/random';
import { createGame, startGame } from '../shared/rules';
import type { BotLevel, CharacterId } from '../shared/types';
import { internal } from './_generated/api';
import type { MutationCtx } from './_generated/server';
import { internalMutation, mutation, query } from './_generated/server';
import {
  EMPTY_ROOM_TTL_MS,
  AWAY_LEFT_MS,
  ENDED_DROP_MS,
  GONE_GRACE_MS,
  HEARTBEAT_STALE_MS,
  LOBBY_GUEST_DROP_MS,
  LOBBY_HOST_DROP_MS,
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
  isDice,
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
  args: {
    secret: v.string(),
    name: v.string(),
    character: v.string(),
    maxPlayers: v.number(),
    mode: v.string(),
    turnSeconds: v.number(),
    dice: v.optional(v.string()),
  },
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
      dice: isDice(a.dice) ? a.dice : 'fair',
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
    if (room.kicked?.includes(a.secret)) fail('The host removed you from this room.');
    if (room.status === 'ended') fail('That game just finished. Ask the host to start a rematch, then join.');
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
    dice: v.optional(v.string()),
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
    if (isDice(a.dice)) patch.dice = a.dice;
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
    if (!target) return;
    await ctx.db.patch(room._id, { kicked: [...(room.kicked ?? []), target.secret].slice(-20) });
    await leaveRoom(ctx, target, 'removed');
  },
});

export const start = mutation({
  args: { secret: v.string() },
  handler: async (ctx, { secret }) => {
    const { room } = await requireHost(ctx, secret);
    if (room.status === 'playing') return; // a second tap on Start: nothing to do
    if (room.status !== 'lobby') fail('Start a rematch from the results screen first.');
    if (room.seats.length < MIN_PLAYERS) fail('Need at least 2 players (add a bot!).');
    const waiting = room.seats.filter((s) => s.kind === 'human' && s.connected && !s.ready);
    if (waiting.length) fail(`Waiting for ${waiting.map((s) => s.name).join(', ')} to get ready.`);

    const seed = newSeed();
    const ctxStep = stepCtx(seed);
    const st = createGame(
      {
        seats: room.seats.map((s) => ({
          id: s.id,
          name: s.name,
          character: s.character as CharacterId,
          kind: s.kind,
          botLevel: (s.botLevel ?? room.botLevel) as BotLevel,
        })),
        rules: { ...MODES[room.mode as 'classic' | 'quick'].rules, turnSeconds: room.turnSeconds, dice: isDice(room.dice) ? room.dice : 'fair' },
      },
      newId(10),
      ctxStep.now,
    );
    st.hostId = room.hostId; // the host pays for the match (client-side coins)
    // Anyone who dropped out of the lobby (or somehow has no membership) starts with a bot playing for them.
    const memberIds = new Set((await membersOf(ctx, room.code)).map((m) => m.playerId));
    for (const p of st.players) {
      const seat = room.seats.find((s) => s.id === p.id);
      if (seat?.kind === 'human' && (!seat.connected || !memberIds.has(seat.id))) {
        p.connected = false;
        p.auto = true;
      }
    }
    startGame(st, ctxStep);

    const old = await gameFor(ctx, room.code);
    if (old) await ctx.db.delete(old._id);
    const gameId = await ctx.db.insert('games', { roomCode: room.code, state: st, seed });
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
 * The page-close beacon (see http.ts). Shows the player as away straight away so nobody stares
 * at a ghost; if this was only a refresh, the reloaded page heartbeats within a second or two
 * and undoes it. Otherwise the sweep removes them (lobby/finished room) or hands their pieces
 * to a bot (game) once GONE_GRACE_MS has passed.
 */
export const bye = internalMutation({
  args: { secret: v.string() },
  handler: async (ctx, { secret }) => {
    const m = await memberBySecret(ctx, secret);
    if (!m) return;
    const now = Date.now();
    const ping = await presenceOf(ctx, m.playerId);
    if (ping) await ctx.db.patch(ping._id, { goneAt: now });
    else await ctx.db.insert('presence', { playerId: m.playerId, roomCode: m.roomCode, lastSeen: 0, goneAt: now });
    if (m.connected) {
      await ctx.db.patch(m._id, { connected: false });
      const room = await roomByCode(ctx, m.roomCode);
      if (room) {
        await ctx.db.patch(room._id, {
          seats: room.seats.map((s) => (s.id === m.playerId ? { ...s, connected: false, inVoice: false, muted: false } : s)),
        });
      }
    }
    await ctx.scheduler.runAfter(GONE_GRACE_MS + 500, internal.rooms.sweep, { code: m.roomCode, once: true });
  },
});

/**
 * Runs every few seconds per room (plus once right after a goodbye beacon) and applies the
 * presence rules described in lib.ts. Also deletes the room once nobody has been around for a while.
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
    const silentFor = (playerId: string) => now - (pings.get(playerId)?.lastSeen ?? 0);
    /** Closed the page this long ago without coming back (-1 if they didn't). */
    const goneFor = (playerId: string) => {
      const p = pings.get(playerId);
      return p?.goneAt && p.lastSeen <= p.goneAt ? now - p.goneAt : -1;
    };
    let members = await membersOf(ctx, code);

    // 1) People who are gone for good leave the room.
    let dropped = false;
    for (const m of members) {
      let how: 'left' | 'timedOut' | null = null;
      if (room.status === 'playing') {
        // In a game the seat stays reclaimable for a while; after that a bot finishes it.
        if (silentFor(m.playerId) >= AWAY_LEFT_MS) how = goneFor(m.playerId) >= 0 ? 'left' : 'timedOut';
      } else {
        const limit = room.status === 'ended' ? ENDED_DROP_MS : m.playerId === room.hostId ? LOBBY_HOST_DROP_MS : LOBBY_GUEST_DROP_MS;
        if (goneFor(m.playerId) >= GONE_GRACE_MS) how = 'left';
        else if (silentFor(m.playerId) > limit) how = 'timedOut';
      }
      if (how) {
        await leaveRoom(ctx, m, how);
        dropped = true;
      }
    }
    if (dropped) {
      room = await roomByCode(ctx, code);
      if (!room) return;
      members = await membersOf(ctx, code);
    }

    // 2) Everyone else who has gone quiet is shown as away (in a game a bot plays for them).
    const away = new Set<string>();
    for (const m of members) {
      if (goneFor(m.playerId) < GONE_GRACE_MS && silentFor(m.playerId) <= HEARTBEAT_STALE_MS) continue;
      away.add(m.playerId);
      if (m.connected) await ctx.db.patch(m._id, { connected: false });
      await setPlayerConnected(ctx, room, m.playerId, false); // no-op unless a game is running
    }

    const anyoneHere = members.some((m) => silentFor(m.playerId) <= HEARTBEAT_STALE_MS && goneFor(m.playerId) < 0);
    const emptySince = anyoneHere ? null : (room.emptySince ?? now);
    if (emptySince !== null && now - emptySince > EMPTY_ROOM_TTL_MS) {
      await closeRoom(ctx, code);
      return;
    }
    // Only write when something changed: every write re-sends the room to all players.
    const fresh = await ctx.db.get(room._id);
    if (fresh) {
      const seats = fresh.seats.map((s) =>
        away.has(s.id) && (s.connected || s.inVoice) ? { ...s, connected: false, inVoice: false, muted: false } : s,
      );
      const changed = seats.some((s, i) => s !== fresh.seats[i]);
      if (changed || emptySince !== fresh.emptySince) await ctx.db.patch(room._id, { seats, emptySince });
    }
    if (!once) await ctx.scheduler.runAfter(SWEEP_EVERY_MS, internal.rooms.sweep, { code });
  },
});
