/**
 * The turn state machine as pure functions over a GameState.
 *
 * Nothing here owns a timer. Each step mutates the state, appends one snapshot (seq + 1)
 * and records the next time-driven transition in `state.pending`. Whoever hosts the match
 * calls `runPending` once `pending.at` arrives: the browser for local games (`Match`) and
 * the Convex scheduler for online games.
 */
import { finishAt, globalIndex, isSafe, lastTrack, layoutFor } from './board';
import { chooseMove } from './bot';
import { actionDie, luckOf } from './dice';
import { capturesAt, movableTokens, targetOf, totalProgress } from './engine';
import { fairDie, hashSeed, mulberry32 } from './random';
import type { GameEvent, GameState, MatchConfig, PendingKind, PlayerState } from './types';

/** Base timings in ms (multiplied by the match speed). Clients use the same numbers to animate. */
export const TIMING = {
  roll: 820,
  step: 165,
  moveBase: 280,
  capture: 750,
  home: 500,
  noMove: 1150,
  botRoll: 700,
  botMove: 560,
  autoMove: 360,
};

export function moveDuration(from: number, to: number, captured: boolean, home: boolean, speed: number): number {
  const steps = from < 0 ? 1 : to - from;
  return (steps * TIMING.step + TIMING.moveBase + (captured ? TIMING.capture : 0) + (home ? TIMING.home : 0)) * speed;
}

export interface StepCtx {
  now: number;
  /** The game's seed: dice, bot choices and who goes first all derive from it. */
  seed: number;
  /** End the game once only bots are left racing (default true). */
  endWhenOnlyBots?: boolean;
}

/** A step's context plus its random stream, derived from (seed, step number): fully reproducible. */
interface Ctx extends StepCtx {
  rng: () => number;
}

const withRng = (st: GameState, ctx: StepCtx): Ctx => ({ ...ctx, rng: mulberry32(hashSeed(ctx.seed, st.seq, 0x51ed)) });

export function createGame(cfg: MatchConfig, id: string, now: number): GameState {
  const { arms, seats } = layoutFor(cfg.seats.length);
  const players: PlayerState[] = cfg.seats.map((s, i) => ({
    id: s.id,
    name: s.name,
    character: s.character,
    kind: s.kind,
    botLevel: s.botLevel ?? 'normal',
    arm: seats[i],
    tokens: Array(cfg.rules.tokens).fill(-1),
    rank: 0,
    auto: false,
    connected: true,
    left: false,
    timeouts: 0,
    stats: { captures: 0, captured: 0, sixes: 0, moves: 0, rolls: 0 },
    luck: { dry: 0, sinceSix: 0, hitAt: -1000, hitBy: -1 },
  }));
  return {
    id,
    arms,
    rules: cfg.rules,
    players,
    turn: 0,
    phase: 'roll',
    dice: null,
    rollCount: 0,
    movable: [],
    sixStreak: 0,
    deadline: null,
    now,
    turnMs: cfg.rules.turnSeconds * 1000,
    ranking: [],
    pending: null,
    seq: 0,
    events: [],
    speed: cfg.speed ?? 1,
    startedAt: now,
  };
}

export function startGame(st: GameState, ctx: StepCtx, firstPlayer?: number) {
  const first = firstPlayer ?? Math.floor(withRng(st, ctx).rng() * st.players.length);
  beginTurn(st, ctx, first, false, [{ type: 'start' }]);
}

/** A human asks to roll. Returns false (and changes nothing) if that isn't allowed now. */
export function humanRoll(st: GameState, ctx: StepCtx, playerId: string): boolean {
  const pl = st.players[st.turn];
  if (st.phase !== 'roll' || pl.id !== playerId || pl.kind === 'bot') return false;
  doRoll(st, withRng(st, ctx), reclaim(st, pl));
  return true;
}

/** A human picks a token to move. */
export function humanMove(st: GameState, ctx: StepCtx, playerId: string, token: number): boolean {
  const pl = st.players[st.turn];
  if (st.phase !== 'move' || pl.id !== playerId || pl.kind === 'bot' || !st.movable.includes(token)) return false;
  doMove(st, ctx, token, reclaim(st, pl));
  return true;
}

/** Let a bot play for a human (disconnect / AFK) or hand control back. */
export function setAuto(st: GameState, ctx: StepCtx, playerId: string, auto: boolean): boolean {
  const idx = st.players.findIndex((p) => p.id === playerId);
  if (idx < 0) return false;
  const pl = st.players[idx];
  if (pl.kind === 'bot' || pl.auto === auto) return false;
  toggleAuto(st, ctx, idx, auto);
  emit(st, ctx, [{ type: 'auto', player: idx, auto }]);
  return true;
}

export function setConnected(st: GameState, ctx: StepCtx, playerId: string, connected: boolean): boolean {
  const idx = st.players.findIndex((p) => p.id === playerId);
  if (idx < 0) return false;
  const pl = st.players[idx];
  if (pl.left || (pl.connected === connected && pl.auto === !connected)) return false;
  pl.connected = connected;
  const events: GameEvent[] = [];
  if (pl.kind === 'human' && pl.auto !== !connected) {
    toggleAuto(st, ctx, idx, !connected);
    events.push({ type: 'auto', player: idx, auto: !connected });
  }
  emit(st, ctx, events);
  return true;
}

/**
 * A player left the room for good. A bot finishes their pieces, and they stop counting as a
 * human racer: if only bots and departed players are still racing, the game ends right away.
 */
export function markLeft(st: GameState, ctx: StepCtx, playerId: string): boolean {
  const idx = st.players.findIndex((p) => p.id === playerId);
  if (idx < 0 || st.players[idx].left) return false;
  const pl = st.players[idx];
  pl.left = true;
  pl.connected = false;
  const events: GameEvent[] = [{ type: 'left', player: idx }];
  if (st.phase === 'over') {
    emit(st, ctx, events);
    return true;
  }
  if (pl.kind === 'human' && !pl.auto) toggleAuto(st, ctx, idx, true);
  if (checkOver(st, ctx)) {
    st.phase = 'over';
    st.pending = null;
    st.deadline = null;
    st.movable = [];
    events.push({ type: 'over', ranking: [...st.ranking] });
  }
  emit(st, ctx, events);
  return true;
}

/** Fire the pending transition. Returns true if the state changed. */
export function runPending(st: GameState, stepCtx: StepCtx): boolean {
  const p = st.pending;
  if (!p) return false;
  const ctx = withRng(st, stepCtx);
  st.pending = null;
  const cur = st.players[st.turn];
  switch (p.kind) {
    case 'botRoll':
      if (st.phase !== 'roll') return false;
      doRoll(st, ctx);
      return true;
    case 'botMove':
      if (st.phase !== 'move') return false;
      doMove(st, ctx, chooseMove(st, st.turn, st.dice!, st.movable, cur.kind === 'bot' ? cur.botLevel : 'normal', ctx.rng));
      return true;
    case 'autoMove':
      if (st.phase !== 'move') return false;
      doMove(st, ctx, st.movable[0]);
      return true;
    case 'timeout':
      if (st.phase !== 'roll' && st.phase !== 'move') return false;
      timeout(st, ctx);
      return true;
    case 'afterRoll':
      if (st.phase !== 'rolling') return false;
      afterRoll(st, ctx);
      return true;
    case 'nextTurn':
      if (st.phase !== 'rolling' && st.phase !== 'moving') return false;
      nextTurn(st, ctx);
      return true;
    case 'bonusTurn':
      if (st.phase !== 'rolling' && st.phase !== 'moving') return false;
      beginTurn(st, ctx, st.turn, true);
      return true;
    case 'gameOver':
      if (st.phase !== 'moving') return false;
      st.phase = 'over';
      emit(st, ctx, [{ type: 'over', ranking: [...st.ranking] }]);
      return true;
  }
}

/** Push the clock forward after a pause (local games). Returns true if a snapshot was emitted. */
export function shiftClock(st: GameState, ctx: StepCtx, delta: number): boolean {
  if (st.pending) st.pending.at += delta;
  if (!st.deadline) return false;
  st.deadline += delta;
  emit(st, ctx, []);
  return true;
}

// ---------------------------------------------------------------------------

function emit(st: GameState, ctx: StepCtx, events: GameEvent[]) {
  st.seq++;
  st.events = events;
  st.now = ctx.now;
}

function pend(st: GameState, ctx: StepCtx, kind: PendingKind, delay: number) {
  st.pending = { kind, at: ctx.now + Math.max(0, delay) };
}

const ms = (st: GameState, base: number) => base * st.speed;

function botControlled(st: GameState, i: number) {
  const pl = st.players[i];
  return pl.kind === 'bot' || pl.auto;
}

function reclaim(st: GameState, pl: PlayerState): GameEvent[] {
  pl.timeouts = 0;
  if (!pl.auto) return [];
  pl.auto = false;
  return [{ type: 'auto', player: st.turn, auto: false }];
}

function toggleAuto(st: GameState, ctx: StepCtx, idx: number, auto: boolean) {
  st.players[idx].auto = auto;
  st.players[idx].timeouts = 0;
  if (idx === st.turn && (st.phase === 'roll' || st.phase === 'move')) {
    st.deadline = !auto && st.turnMs ? ctx.now + st.turnMs : null;
    schedulePhase(st, ctx);
  }
}

/** Decide what the current phase is waiting on. */
function schedulePhase(st: GameState, ctx: StepCtx) {
  const p = st.turn;
  const pl = st.players[p];
  st.pending = null;
  if (st.phase === 'roll') {
    if (botControlled(st, p)) pend(st, ctx, 'botRoll', ms(st, TIMING.botRoll));
    else if (st.deadline) pend(st, ctx, 'timeout', st.deadline - ctx.now);
  } else if (st.phase === 'move') {
    const spots = new Set(st.movable.map((t) => pl.tokens[t]));
    if (botControlled(st, p)) pend(st, ctx, 'botMove', ms(st, TIMING.botMove));
    else if (st.rules.autoMove && spots.size === 1) pend(st, ctx, 'autoMove', ms(st, TIMING.autoMove));
    else if (st.deadline) pend(st, ctx, 'timeout', st.deadline - ctx.now);
  }
}

function timeout(st: GameState, ctx: Ctx) {
  const pl = st.players[st.turn];
  pl.timeouts++;
  const pre: GameEvent[] = [];
  if (pl.timeouts >= 2 && !pl.auto) {
    pl.auto = true;
    pre.push({ type: 'auto', player: st.turn, auto: true });
  }
  if (st.phase === 'roll') doRoll(st, ctx, pre);
  else doMove(st, ctx, chooseMove(st, st.turn, st.dice!, st.movable, 'normal', ctx.rng), pre);
}

function beginTurn(st: GameState, ctx: StepCtx, p: number, bonus: boolean, pre: GameEvent[] = []) {
  st.turn = p;
  st.phase = 'roll';
  st.movable = [];
  if (!bonus) st.sixStreak = 0;
  st.deadline = st.turnMs && !botControlled(st, p) ? ctx.now + st.turnMs : null;
  emit(st, ctx, [...pre, { type: 'turn', player: p, bonus }]);
  schedulePhase(st, ctx);
}

function nextTurn(st: GameState, ctx: StepCtx) {
  const n = st.players.length;
  for (let i = 1; i <= n; i++) {
    const q = (st.turn + i) % n;
    if (!st.players[q].rank) return beginTurn(st, ctx, q, false);
  }
}

function doRoll(st: GameState, ctx: Ctx, pre: GameEvent[] = []) {
  const p = st.turn;
  const pl = st.players[p];
  const rolls = pl.stats.rolls ?? 0;
  const value =
    st.rules.dice === 'smart' ? actionDie(st, p, ctx.rng) : st.rules.dice === 'fair' ? fairDie(ctx.seed, p, rolls) : 1 + Math.floor(ctx.rng() * 6);
  pl.stats.rolls = rolls + 1;
  const luck = luckOf(pl);
  luck.sinceSix = value === 6 ? 0 : luck.sinceSix + 1;
  st.sixStreak = value === 6 ? st.sixStreak + 1 : 0;
  if (value === 6) st.players[p].stats.sixes++;
  st.dice = value;
  st.rollCount++;
  st.phase = 'rolling';
  st.deadline = null;
  st.movable = [];
  emit(st, ctx, [...pre, { type: 'roll', player: p, value }]);
  pend(st, ctx, 'afterRoll', ms(st, TIMING.roll));
}

function afterRoll(st: GameState, ctx: StepCtx) {
  const p = st.turn;
  const value = st.dice!;
  if (value === 6 && st.rules.threeSixes && st.sixStreak >= 3) {
    st.sixStreak = 0;
    luckOf(st.players[p]).dry++; // nothing moved
    emit(st, ctx, [{ type: 'threeSixes', player: p }]);
    pend(st, ctx, 'nextTurn', ms(st, TIMING.noMove));
    return;
  }
  const movable = movableTokens(st, p, value);
  if (!movable.length) {
    luckOf(st.players[p]).dry++;
    emit(st, ctx, [{ type: 'noMove', player: p, value }]);
    pend(st, ctx, value === 6 && st.rules.extraOnSix ? 'bonusTurn' : 'nextTurn', ms(st, TIMING.noMove));
    return;
  }
  st.movable = movable;
  st.phase = 'move';
  st.deadline = st.turnMs && !botControlled(st, p) ? ctx.now + st.turnMs : null;
  emit(st, ctx, []);
  schedulePhase(st, ctx);
}

function doMove(st: GameState, ctx: StepCtx, token: number, pre: GameEvent[] = []) {
  const p = st.turn;
  const pl = st.players[p];
  const dice = st.dice!;
  const from = pl.tokens[token];
  const to = targetOf(st, p, token, dice);
  if (to === null) return;

  const captures = capturesAt(st, p, to);
  const luck = luckOf(pl);
  // Payback: hitting whoever last sent one of our tokens home (while it still stings).
  const revenge = captures.some((c) => c.player === luck.hitBy) && st.rollCount - luck.hitAt <= 6 * st.players.length;
  pl.tokens[token] = to;
  pl.stats.moves++;
  luck.dry = 0;
  for (const c of captures) {
    const victim = st.players[c.player];
    victim.tokens[c.token] = -1;
    victim.stats.captured++;
    Object.assign(luckOf(victim), { hitAt: st.rollCount, hitBy: p });
  }
  pl.stats.captures += captures.length;
  if (revenge) luck.hitBy = -1; // the score is settled

  const fin = finishAt(st.arms);
  const home = to === fin;
  const safe = to <= lastTrack(st.arms) && isSafe(st.arms, globalIndex(st.arms, pl.arm, to));
  const moveEvent: Extract<GameEvent, { type: 'move' }> = { type: 'move', player: p, token, from, to, captures, home, safe, extra: false };
  if (revenge) moveEvent.revenge = true;
  const events: GameEvent[] = [...pre, moveEvent];

  let finished = false;
  if (pl.tokens.every((t) => t === fin)) {
    st.ranking.push(p);
    pl.rank = st.ranking.length;
    events.push({ type: 'finish', player: p, rank: pl.rank });
    finished = true;
  }

  const over = checkOver(st, ctx);
  moveEvent.extra =
    !finished && !over && ((dice === 6 && st.rules.extraOnSix) || (captures.length > 0 && st.rules.extraOnCapture) || (home && st.rules.extraOnHome));

  st.phase = 'moving';
  st.movable = [];
  st.deadline = null;
  emit(st, ctx, events);
  pend(st, ctx, over ? 'gameOver' : moveEvent.extra ? 'bonusTurn' : 'nextTurn', moveDuration(from, to, captures.length > 0, home, st.speed));
}

/** Assigns the remaining ranks if the game is decided. */
function checkOver(st: GameState, ctx: StepCtx): boolean {
  const racing = st.players.map((_, i) => i).filter((i) => !st.players[i].rank);
  // Players who left the room count as bots: nobody is waiting on their result.
  const onlyBots = racing.every((i) => st.players[i].kind === 'bot' || st.players[i].left);
  if (racing.length > 1 && !(onlyBots && (ctx.endWhenOnlyBots ?? true))) return false;
  racing
    .sort((a, b) => totalProgress(st, b) - totalProgress(st, a))
    .forEach((i) => {
      st.ranking.push(i);
      st.players[i].rank = st.ranking.length;
    });
  return true;
}
