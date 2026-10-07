/**
 * Plays many bot-only matches at speed 0 and checks engine invariants:
 * - no two players ever share an unsafe square (captures always resolve)
 * - every game finishes with a full ranking
 * - fair dice: each player's rolls come in bags holding 1–6 exactly once
 * - determinism: the same seed replays to the identical game
 * Usage: npm run sim [-- games]
 */
import { finishAt, globalIndex, isSafe, lastTrack } from '../shared/board';
import { CHARACTER_ORDER, MODES } from '../shared/characters';
import { Match } from '../shared/match';
import type { BotLevel, DiceMode, GameState, ModeId } from '../shared/types';

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
}

function play(players: number, mode: ModeId, dice: DiceMode, levels: BotLevel[], seed?: number): Promise<Result> {
  return new Promise((resolve) => {
    const errors: string[] = [];
    const rolls: number[][] = Array.from({ length: players }, () => []);
    let turns = 0;
    const m = new Match(
      {
        seats: Array.from({ length: players }, (_, i) => ({
          id: `b${i}`,
          name: `Bot ${i}`,
          character: CHARACTER_ORDER[i],
          kind: 'bot' as const,
          botLevel: levels[i % levels.length],
        })),
        rules: { ...MODES[mode].rules, dice },
        speed: 0,
      },
      {
        seed,
        now: () => 0, // a fixed clock keeps replays byte-identical
        endWhenOnlyBots: false,
        onState: (s) => {
          for (const e of s.events) {
            if (e.type === 'turn') turns++;
            if (e.type === 'roll') rolls[e.player].push(e.value);
          }
          check(s, errors);
          if (turns > 6000) {
            errors.push('game did not finish');
            m.destroy();
            resolve({ state: s, errors, turns, rolls });
          }
          if (s.phase === 'over') {
            if (new Set(s.ranking).size !== players) errors.push(`bad ranking ${s.ranking}`);
            resolve({ state: s, errors, turns, rolls });
          }
        },
      },
    );
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

// 1) Bulk games across sizes, modes and both dice types.
const jobs: Promise<void>[] = [];
for (let g = 0; g < GAMES; g++) {
  const players = 2 + (g % 5);
  const mode: ModeId = g % 3 === 0 ? 'quick' : 'classic';
  const dice: DiceMode = g % 2 ? 'fair' : 'classic';
  const pairing: BotLevel[] = (
    [
      ['hard', 'easy'],
      ['hard', 'normal'],
      ['normal', 'easy'],
    ] as BotLevel[][]
  )[g % 3];
  const levels = g % 2 ? pairing : [...pairing].reverse();
  jobs.push(
    play(players, mode, dice, levels).then((r) => {
      errors.push(...r.errors);
      if (dice === 'fair') errors.push(...fairBagErrors(r.rolls));
      const key = `${players}p ${mode.padEnd(7)} ${dice}`;
      stats.set(key, [...(stats.get(key) ?? []), r.turns]);
      const w = r.state.players[r.state.ranking[0]];
      const matchup = [...new Set(levels)].sort().join(' vs ');
      wins[`${matchup}: ${w.botLevel}`] = (wins[`${matchup}: ${w.botLevel}`] ?? 0) + 1;
    }),
  );
}
await Promise.all(jobs);

// 2) Determinism: same seed => identical game.
const seed = 123456789;
const [a, b] = await Promise.all([play(4, 'classic', 'fair', ['hard', 'normal', 'easy']), play(4, 'classic', 'fair', ['hard', 'normal', 'easy'])]);
const [c, d] = await Promise.all([
  play(4, 'classic', 'fair', ['hard', 'normal', 'easy'], seed),
  play(4, 'classic', 'fair', ['hard', 'normal', 'easy'], seed),
]);
const fingerprint = (r: Result) => JSON.stringify([r.state.ranking, r.state.players.map((p) => [p.tokens, p.stats]), r.rolls]);
if (fingerprint(c) !== fingerprint(d)) errors.push('same seed produced different games');
const differentSeedsDiffer = fingerprint(a) !== fingerprint(b);

for (const [k, v] of [...stats].sort()) {
  console.log(`${k.padEnd(22)} games=${String(v.length).padStart(3)} avgTurns=${Math.round(v.reduce((x, y) => x + y, 0) / v.length)}`);
}
console.log('winners by matchup:', wins);
console.log(`determinism: same seed identical = ${fingerprint(c) === fingerprint(d)}, random seeds differ = ${differentSeedsDiffer}`);
console.log(
  errors.length
    ? `❌ ${errors.length} errors, e.g. ${[...new Set(errors)].slice(0, 5).join(' | ')}`
    : '✅ no invariant violations, fair-dice bags all balanced',
);
process.exit(errors.length ? 1 : 0);
