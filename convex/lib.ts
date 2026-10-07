import { ConvexError } from 'convex/values';
import { CHARACTERS, CHARACTER_ORDER, pickBotName } from '../shared/characters';
import { MAX_PLAYERS, MIN_PLAYERS, type RoomSeat, type RoomState } from '../shared/protocol';
import { botReactions } from '../shared/reactions';
import { markLeft, setConnected, type StepCtx } from '../shared/rules';
import type { BotLevel, CharacterId, GameState, ModeId } from '../shared/types';
import { internal } from './_generated/api';
import type { Doc, Id } from './_generated/dataModel';
import type { MutationCtx, QueryCtx } from './_generated/server';

/** No heartbeat for this long: shown as away (in a game, a bot plays for them). */
export const HEARTBEAT_STALE_MS = 30_000;
/**
 * Silent this long: removed from a lobby / finished room. Long on purpose: phones pause
 * background tabs, and a host sharing the code in another app must not lose the room.
 * Closing the tab is detected much faster through the goodbye beacon (GONE_GRACE_MS).
 */
export const LOBBY_DROP_MS = 5 * 60_000;
export const ENDED_DROP_MS = 2 * 60_000;
/** After the page-close beacon, wait this long for a heartbeat (a refresh) before treating them as gone. */
export const GONE_GRACE_MS = 12_000;
/** A closed tab can never reclaim its seat (its identity lived in that tab), so mid-game it becomes "left". */
export const GONE_LEFT_MS = 45_000;
export const EMPTY_ROOM_TTL_MS = 10 * 60_000;
export const SWEEP_EVERY_MS = 10_000;

type Seat = Doc<'rooms'>['seats'][number];

/** Errors with a message the player should see. */
export function fail(message: string): never {
  throw new ConvexError(message);
}

export const stepCtx = (): StepCtx => ({ now: Date.now(), rng: Math.random });

export function newId(len = 12): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let s = '';
  for (let i = 0; i < len; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

export const cleanName = (n: unknown) =>
  String(n ?? '')
    .replace(/[\u0000-\u001f<>]/g, '')
    .trim()
    .slice(0, 16) || 'Player';

export const isCharacter = (c: unknown): c is CharacterId => typeof c === 'string' && c in CHARACTERS;
export const isMode = (m: unknown): m is ModeId => m === 'classic' || m === 'quick';
export const isLevel = (l: unknown): l is BotLevel => l === 'easy' || l === 'normal' || l === 'hard';
export const clampPlayers = (n: unknown) => Math.min(MAX_PLAYERS, Math.max(MIN_PLAYERS, Math.round(Number(n) || 4)));

export function toRoomState(room: Doc<'rooms'>): RoomState {
  return {
    code: room.code,
    hostId: room.hostId,
    maxPlayers: room.maxPlayers,
    mode: room.mode as ModeId,
    turnSeconds: room.turnSeconds,
    botLevel: room.botLevel as BotLevel,
    status: room.status,
    seats: room.seats as RoomSeat[],
  };
}

// ---------------------------------------------------------------- lookups

export async function memberBySecret(ctx: QueryCtx, secret: string) {
  return ctx.db
    .query('members')
    .withIndex('by_secret', (q) => q.eq('secret', secret))
    .first();
}

export async function roomByCode(ctx: QueryCtx, code: string) {
  return ctx.db
    .query('rooms')
    .withIndex('by_code', (q) => q.eq('code', code))
    .first();
}

export async function membersOf(ctx: QueryCtx, code: string) {
  return ctx.db
    .query('members')
    .withIndex('by_room', (q) => q.eq('roomCode', code))
    .collect();
}

export async function presenceOf(ctx: QueryCtx, playerId: string) {
  return ctx.db
    .query('presence')
    .withIndex('by_player', (q) => q.eq('playerId', playerId))
    .first();
}

export async function gameFor(ctx: QueryCtx, code: string) {
  return ctx.db
    .query('games')
    .withIndex('by_room', (q) => q.eq('roomCode', code))
    .first();
}

/** The caller's membership and room, or a friendly error. */
export async function requireMember(ctx: QueryCtx, secret: string) {
  const member = await memberBySecret(ctx, secret);
  if (!member) fail("You're not in a room.");
  const room = await roomByCode(ctx, member.roomCode);
  if (!room) fail('That room no longer exists.');
  return { member, room };
}

export async function requireHost(ctx: QueryCtx, secret: string) {
  const { member, room } = await requireMember(ctx, secret);
  if (room.hostId !== member.playerId) fail('Only the host can do that.');
  return { member, room };
}

// ---------------------------------------------------------------- seats

export function freeCharacter(seats: Seat[], wanted: CharacterId): CharacterId {
  const taken = new Set(seats.map((s) => s.character));
  if (!taken.has(wanted)) return wanted;
  return CHARACTER_ORDER.find((c) => !taken.has(c)) ?? wanted;
}

export function humanSeat(id: string, name: string, character: CharacterId, ready: boolean): Seat {
  return { id, name, character, kind: 'human', ready, connected: true, inVoice: false, muted: false };
}

export function botSeat(seats: Seat[], level: string): Seat {
  return {
    id: `bot-${newId(8)}`,
    name: pickBotName(seats.map((s) => s.name)),
    character: freeCharacter(seats, CHARACTER_ORDER[seats.length % CHARACTER_ORDER.length]),
    kind: 'bot',
    botLevel: level,
    ready: true,
    connected: true,
    inVoice: false,
    muted: false,
  };
}

// ---------------------------------------------------------------- chat helpers

const CHAT_KEEP = 60;

export async function postChat(
  ctx: MutationCtx,
  code: string,
  msg: { from: string; name: string; character: string | null; text: string; system: boolean },
) {
  await ctx.db.insert('chat', { roomCode: code, ...msg });
  const all = await ctx.db
    .query('chat')
    .withIndex('by_room', (q) => q.eq('roomCode', code))
    .order('desc')
    .collect();
  for (const old of all.slice(CHAT_KEEP)) await ctx.db.delete(old._id);
}

export const system = (ctx: MutationCtx, code: string, text: string) =>
  postChat(ctx, code, { from: 'system', name: 'Ludo Pals', character: null, text, system: true });

// ---------------------------------------------------------------- game

/** Persist a game step, schedule its next transition and fire bot reactions. */
export async function saveGame(ctx: MutationCtx, gameId: Id<'games'>, room: Doc<'rooms'>, st: GameState) {
  await ctx.db.patch(gameId, { state: st });
  if (st.pending) await ctx.scheduler.runAt(st.pending.at, internal.game.advance, { gameId, seq: st.seq });
  if (st.phase === 'over' && room.status === 'playing') {
    // The match is over: people who left during it are gone from the room now too.
    const fresh = await ctx.db.get(room._id);
    if (fresh) await ctx.db.patch(room._id, { status: 'ended', seats: fresh.seats.filter((s) => !s.left) });
  }
  for (const r of botReactions(st)) {
    await ctx.scheduler.runAfter(r.delay, internal.social.botEmote, { code: room.code, from: st.players[r.player].id, emoji: r.emoji });
  }
}

export async function setPlayerConnected(ctx: MutationCtx, room: Doc<'rooms'>, playerId: string, connected: boolean) {
  if (room.status !== 'playing') return;
  const game = await gameFor(ctx, room.code);
  if (!game) return;
  const st = game.state as GameState;
  if (setConnected(st, stepCtx(), playerId, connected)) await saveGame(ctx, game._id, room, st);
}

async function setPlayerLeft(ctx: MutationCtx, room: Doc<'rooms'>, playerId: string) {
  if (room.status !== 'playing') return;
  const game = await gameFor(ctx, room.code);
  if (!game) return;
  const st = game.state as GameState;
  if (markLeft(st, stepCtx(), playerId)) await saveGame(ctx, game._id, room, st);
}

// ---------------------------------------------------------------- leaving & cleanup

/** Remove a member from their room (leave, kick or timeout). Closes the room when no humans remain. */
/**
 * Remove a member from their room: leave button, kick, closed tab or long silence.
 * In a running game the seat stays (marked `left`, a bot plays it); anywhere else it is removed.
 * Hands the host role on, and closes the room when no humans remain.
 */
export async function leaveRoom(ctx: MutationCtx, member: Doc<'members'>, how: 'left' | 'removed' | 'timedOut' = 'left') {
  if (!(await ctx.db.get(member._id))) return; // already gone (e.g. the room closed earlier in this sweep)
  await ctx.db.delete(member._id);
  const ping = await presenceOf(ctx, member.playerId);
  if (ping) await ctx.db.delete(ping._id);
  await deleteSignalsTo(ctx, member.playerId);
  const room = await roomByCode(ctx, member.roomCode);
  if (!room) return;

  const seat = room.seats.find((s) => s.id === member.playerId);
  const remaining = await membersOf(ctx, room.code);
  if (!remaining.length) {
    await closeRoom(ctx, room.code);
    return;
  }

  if (room.status === 'playing' && seat) {
    // Mark the game first: it may end right here if only bots are left racing.
    await setPlayerLeft(ctx, room, member.playerId);
  }
  // Re-read: the game may have just ended (status 'ended', departed seats already dropped).
  const fresh = (await ctx.db.get(room._id))!;
  let seats =
    fresh.status === 'playing'
      ? fresh.seats.map((s) => (s.id === member.playerId ? { ...s, connected: false, left: true, inVoice: false, muted: false } : s))
      : fresh.seats.filter((s) => s.id !== member.playerId);
  if (seat) {
    const verb = how === 'removed' ? 'was removed' : how === 'timedOut' ? 'disconnected and left' : 'left';
    await system(ctx, room.code, `${seat.name} ${verb}${fresh.status === 'playing' ? ' — a bot will finish their game' : ''}`);
  }

  let hostId = fresh.hostId;
  if (hostId === member.playerId) {
    const next = remaining.find((m) => m.connected) ?? remaining[0];
    hostId = next.playerId;
    seats = seats.map((s) => (s.id === hostId ? { ...s, ready: true } : s));
    const nextSeat = seats.find((s) => s.id === hostId);
    if (nextSeat) await system(ctx, room.code, `${nextSeat.name} is now the host`);
  }
  await ctx.db.patch(room._id, { seats, hostId });
}

export async function deleteSignalsTo(ctx: MutationCtx, playerId: string) {
  const rows = await ctx.db
    .query('signals')
    .withIndex('by_to', (q) => q.eq('to', playerId))
    .collect();
  for (const r of rows) await ctx.db.delete(r._id);
}

export async function closeRoom(ctx: MutationCtx, code: string) {
  const room = await roomByCode(ctx, code);
  if (room) await ctx.db.delete(room._id);
  for (const m of await membersOf(ctx, code)) await ctx.db.delete(m._id);
  for (const table of ['games', 'chat', 'emotes', 'signals', 'presence'] as const) {
    const rows = await ctx.db
      .query(table)
      .withIndex('by_room', (q) => q.eq('roomCode', code))
      .collect();
    for (const r of rows) await ctx.db.delete(r._id);
  }
}
