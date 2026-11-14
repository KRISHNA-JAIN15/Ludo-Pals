/**
 * Plays many bot-only matches at speed 0 and checks engine invariants:
 * - no two players ever share an unsafe square (captures always resolve)
 * - every game finishes with a full ranking
 * - fair dice: each player's rolls come in bags holding 1–6 exactly once
 * - Action dice: nobody has more than DRY_MAX dead rolls in a row, or waits longer than
 *   SIX_DROUGHT_MAX rolls for a six they could use
 * - determinism: the same seed replays to the identical game, with every kind of dice
 * Then prints how each kind of dice plays (game length, dead rolls, bonks, waits, comebacks).
 * Usage: npm run sim [-- games]
 */
import { finishAt, globalIndex, isSafe, lastTrack } from '../shared/board';
import { CHARACTER_ORDER, DICE_MODES, DICE_ORDER, MODES } from '../shared/characters';
import { DRY_MAX, SIX_DROUGHT_MAX } from '../shared/dice';
import { movableTokens, totalProgress } from '../shared/engine';
import { Match } from '../shared/match';
import { newSeed } from '../shared/random';
import { createGame, runPending, startGame } from '../shared/rules';
import type { BotLevel, DiceMode, GameState, MatchConfig, ModeId } from '../shared/types';

const GAMES = Number(process.argv[2] ?? 120);

function check(s: GameState, errors: string[]) {
  const fin = finishAt(s.arms);
  const occupied = new Map<number, number>();
  s.players.forEach((p, pi) => {
    for (const t of p.tokens) {
      if (t < -1 || t > fin) errors.push(`token out of range ${t}`);
      if (t >= 0 && t <= lastTrack(s.arms)) {
        const gi = globalIndex(s.arms, p.arm, t);
        const other = occupied.get(gi);
        if (other !== undefined && other !== pi && !isSafe(s.arms, gi)) errors.push(`players ${other} and ${pi} share unsafe cell ${gi}`);
        occupied.set(gi, pi);
      }
    }
  });
}

interface Result {
  state: GameState;
  errors: string[];
  turns: number;
  rolls: number[][];
  /** Rolls that left the roller with nothing to move. */
  dead: number;
  /** Longest run of dead rolls any player had. */
  maxDry: number;
  /** Longest wait for a six (in a player's own rolls). */
  maxSixWait: number;
  /** Each player's rolls before their first token left the yard. */
  firstOut: number[];
  bonks: number;
  revenges: number;
  /** Who led at the halfway point (by progress), or -1. */
  halfwayLeader: number;
}

/** Reads one snapshot into the running tally. */
function observe(r: Result, s: GameState, dice: DiceMode, sixWait: number[]) {
  r.state = s;
  for (const e of s.events) {
    if (e.type === 'turn') r.turns++;
    if (e.type === 'roll') {
      r.rolls[e.player].push(e.value);
      sixWait[e.player] = e.value === 6 ? 0 : sixWait[e.player] + 1;
      r.maxSixWait = Math.max(r.maxSixWait, sixWait[e.player]);
      const luck = s.players[e.player].luck!;
      if (dice === 'smart' && luck.sinceSix > SIX_DROUGHT_MAX && movableTokens(s, e.player, 6).length)
        r.errors.push(`player ${e.player} waited ${luck.sinceSix} rolls for a usable six`);
    }
    if (e.type === 'noMove' || e.type === 'threeSixes') {
      if (e.type === 'noMove') r.dead++;
      const dry = s.players[e.player].luck!.dry;
      r.maxDry = Math.max(r.maxDry, dry);
      if (dice === 'smart' && dry > DRY_MAX) r.errors.push(`player ${e.player} had ${dry} dead rolls in a row`);
    }
    if (e.type === 'move') {
      if (e.from < 0 && r.firstOut[e.player] < 0) r.firstOut[e.player] = r.rolls[e.player].length;
      r.bonks += e.captures.length;
      if (e.revenge) r.revenges++;
    }
  }
  if (r.halfwayLeader < 0) {
    const span = (finishAt(s.arms) + 1) * s.rules.tokens;
    const prog = s.players.map((_, i) => totalProgress(s, i));
    const best = Math.max(...prog);
    if (best >= span / 2) r.halfwayLeader = prog.indexOf(best);
  }
  check(s, r.errors);
  if (s.phase === 'over' && new Set(s.ranking).size !== s.players.length) r.errors.push(`bad ranking ${s.ranking}`);
}

const blank = (players: number): Result => ({
  state: null as unknown as GameState,
  errors: [],
  turns: 0,
  rolls: Array.from({ length: players }, () => []),
  dead: 0,
  maxDry: 0,
  maxSixWait: 0,
  firstOut: Array(players).fill(-1),
  bonks: 0,
  revenges: 0,
  halfwayLeader: -1,
});

const config = (players: number, mode: ModeId, dice: DiceMode, levels: BotLevel[]): MatchConfig => ({
  seats: Array.from({ length: players }, (_, i) => ({
    id: `b${i}`,
    name: `Bot ${i}`,
    character: CHARACTER_ORDER[i],
    kind: 'bot' as const,
    botLevel: levels[i % levels.length],
  })),
  rules: { ...MODES[mode].rules, dice },
  speed: 0,
});

/** Plays a bot game straight through the rules engine (no timers), which is what makes thousands of games quick. */
function play(players: number, mode: ModeId, dice: DiceMode, levels: BotLevel[], seed = newSeed()): Result {
  const r = blank(players);
  const sixWait = Array(players).fill(0);
  const ctx = { now: 0, seed, endWhenOnlyBots: false }; // a fixed clock keeps replays byte-identical
  const st = createGame(config(players, mode, dice, levels), 'sim', 0);
  startGame(st, ctx, 0);
  observe(r, st, dice, sixWait);
  while (st.phase !== 'over') {
    if (r.turns > 8000 || !runPending(st, ctx)) {
      r.errors.push(r.turns > 8000 ? 'game did not finish' : `game stalled in phase ${st.phase}`);
      break;
    }
    observe(r, st, dice, sixWait);
  }
  return r;
}

/** The same game through `Match`, the timer-driven host that local games use in the browser. */
function playViaMatch(players: number, mode: ModeId, dice: DiceMode, levels: BotLevel[], seed: number): Promise<Result> {
  return new Promise((resolve) => {
    const r = blank(players);
    const sixWait = Array(players).fill(0);
    const m = new Match(config(players, mode, dice, levels), {
      seed,
      now: () => 0,
      endWhenOnlyBots: false,
      onState: (s) => {
        observe(r, s, dice, sixWait);
        if (r.turns > 8000) {
          r.errors.push('game did not finish');
          m.destroy();
          resolve(r);
        } else if (s.phase === 'over') resolve(r);
      },
    });
    m.start(0);
  });
}

function fairBagErrors(rolls: number[][]): string[] {
  const errs: string[] = [];
  rolls.forEach((seq, p) => {
    for (let i = 0; i + 6 <= seq.length; i += 6) {
      const bag = seq
        .slice(i, i + 6)
        .sort()
        .join('');
      if (bag !== '123456') errs.push(`player ${p} bag at roll ${i} was ${bag}`);
    }
  });
  return errs;
}

const errors: string[] = [];
const stats = new Map<string, number[]>();
const wins: Record<string, number> = {};
const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

// 1) Bulk games across sizes, modes and every kind of dice.
for (let g = 0; g < GAMES; g++) {
  const players = 2 + (g % 5);
  const mode: ModeId = g % 4 === 0 ? 'quick' : 'classic';
  const dice = DICE_ORDER[g % DICE_ORDER.length];
  const pairing: BotLevel[] = (
    [
      ['hard', 'easy'],
      ['hard', 'normal'],
      ['normal', 'easy'],
    ] as BotLevel[][]
  )[g % 3];
  const levels = g % 2 ? pairing : [...pairing].reverse();
  const r = play(players, mode, dice, levels);
  errors.push(...r.errors);
  if (dice === 'fair') errors.push(...fairBagErrors(r.rolls));
  const key = `${players}p ${mode.padEnd(7)} ${dice}`;
  stats.set(key, [...(stats.get(key) ?? []), r.turns]);
  const w = r.state.players[r.state.ranking[0]];
  const matchup = [...new Set(levels)].sort().join(' vs ');
  wins[`${matchup}: ${w.botLevel}`] = (wins[`${matchup}: ${w.botLevel}`] ?? 0) + 1;
}

// 2) Determinism: same seed => identical game, whatever the dice and whoever hosts it (engine loop or Match).
const seed = 123456789;
const fingerprint = (r: Result) => JSON.stringify([r.state.ranking, r.state.players.map((p) => [p.tokens, p.stats]), r.rolls]);
const levels3: BotLevel[] = ['hard', 'normal', 'easy'];
let sameSeedIdentical = true;
let randomSeedsDiffer = true;
for (const dice of DICE_ORDER) {
  const [a, b, c] = [play(4, 'classic', dice, levels3), play(4, 'classic', dice, levels3), play(4, 'classic', dice, levels3, seed)];
  const d = await playViaMatch(4, 'classic', dice, levels3, seed);
  errors.push(...d.errors);
  if (fingerprint(c) !== fingerprint(d)) {
    sameSeedIdentical = false;
    errors.push(`same seed produced different games with ${dice} dice`);
  }
  if (fingerprint(a) === fingerprint(b)) randomSeedsDiffer = false;
}

// 3) How each kind of dice plays: 4 evenly matched players, classic rules.
const FEEL_GAMES = Math.max(200, GAMES * 2);
const feel: string[] = [];
for (const dice of DICE_ORDER) {
  const rs = Array.from({ length: FEEL_GAMES }, () => play(4, 'classic', dice, ['normal']));
  for (const r of rs) errors.push(...r.errors);
  const rolls = rs.map((r) => r.rolls.flat().length);
  const sixes = rs.map((r) => r.rolls.flat().filter((v) => v === 6).length);
  const leaderWon = rs.filter((r) => r.halfwayLeader === r.state.ranking[0]).length;
  feel.push(
    [
      DICE_MODES[dice].label.padEnd(7),
      `rolls per game ${String(Math.round(avg(rolls))).padStart(4)}`,
      `dead ${((100 * avg(rs.map((r) => r.dead))) / avg(rolls)).toFixed(0).padStart(2)}%`,
      `sixes ${((100 * avg(sixes)) / avg(rolls)).toFixed(0)}%`,
      `first token out after ${avg(rs.flatMap((r) => r.firstOut.filter((n) => n >= 0))).toFixed(1)} rolls`,
      `longest dead run ${Math.max(...rs.map((r) => r.maxDry))}`,
      `longest wait for a six ${Math.max(...rs.map((r) => r.maxSixWait))}`,
      `bonks ${avg(rs.map((r) => r.bonks)).toFixed(1)} (${avg(rs.map((r) => r.revenges)).toFixed(1)} payback)`,
      `halfway leader wins ${Math.round((100 * leaderWon) / rs.length)}%`,
    ].join(' · '),
  );
}

// 4) Skill still matters with Action dice: one Savage bot against three Chill ones.
const skillGames = Array.from({ length: FEEL_GAMES }, () => play(4, 'classic', 'smart', ['hard', 'easy', 'easy', 'easy']));
const savageWins = skillGames.filter((r) => r.state.ranking[0] === 0).length;

for (const [k, v] of [...stats].sort()) {
  console.log(`${k.padEnd(22)} games=${String(v.length).padStart(3)} avgTurns=${Math.round(avg(v))}`);
}
console.log('winners by matchup:', wins);
console.log(`determinism: same seed identical = ${sameSeedIdentical}, random seeds differ = ${randomSeedsDiffer}`);
console.log(`\nhow the dice play (4 Normal bots, classic rules, ${FEEL_GAMES} games each):`);
for (const line of feel) console.log('  ' + line);
console.log(
  `Action dice, 1 Savage vs 3 Chill bots: Savage wins ${Math.round((100 * savageWins) / skillGames.length)}% (25% would be no skill at all)`,
);
console.log(
  errors.length
    ? `❌ ${errors.length} errors, e.g. ${[...new Set(errors)].slice(0, 5).join(' | ')}`
    : '✅ no invariant violations: fair-dice bags balanced, Action dice never leave anyone stuck',
);
process.exit(errors.length ? 1 : 0);
