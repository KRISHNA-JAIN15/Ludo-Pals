/**
 * Plays many bot-only matches at speed 0 and checks engine invariants.
 * Usage: npm run sim [-- games]
 */
import { finishAt, globalIndex, isSafe, lastTrack } from '../shared/board';
import { CHARACTER_ORDER, MODES } from '../shared/characters';
import { Match } from '../shared/match';
import type { BotLevel, GameState, ModeId } from '../shared/types';

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
        if (other !== undefined && other !== pi && !isSafe(s.arms, gi)) {
          errors.push(`players ${other} and ${pi} share unsafe cell ${gi}`);
        }
        occupied.set(gi, pi);
      }
    }
  });
}

function play(players: number, mode: ModeId, levels: BotLevel[]): Promise<{ state: GameState; errors: string[]; turns: number }> {
  return new Promise((resolve) => {
    const errors: string[] = [];
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
        rules: MODES[mode].rules,
        speed: 0,
      },
      {
        endWhenOnlyBots: false,
        onState: (s) => {
          if (s.events.some((e) => e.type === 'turn')) turns++;
          check(s, errors);
          if (turns > 5000) {
            errors.push('game did not finish');
            m.destroy();
            resolve({ state: s, errors, turns });
          }
          if (s.phase === 'over') {
            if (new Set(s.ranking).size !== players) errors.push(`bad ranking ${s.ranking}`);
            resolve({ state: s, errors, turns });
          }
        },
      },
    );
    m.start(0);
  });
}

const jobs: Promise<{ key: string; state: GameState; errors: string[]; turns: number }>[] = [];
for (let g = 0; g < GAMES; g++) {
  const players = 2 + (g % 5);
  const mode: ModeId = g % 3 === 0 ? 'quick' : 'classic';
  const levels: BotLevel[] = g % 2 ? ['hard', 'easy'] : ['easy', 'hard'];
  jobs.push(play(players, mode, levels).then((r) => ({ key: `${players}p-${mode}`, ...r })));
}

const results = await Promise.all(jobs);
const errors = results.flatMap((r) => r.errors);
const byKey = new Map<string, number[]>();
let hardWins = 0;
let easyWins = 0;
for (const r of results) {
  byKey.set(r.key, [...(byKey.get(r.key) ?? []), r.turns]);
  const winner = r.state.players[r.state.ranking[0]];
  if (winner.botLevel === 'hard') hardWins++;
  else easyWins++;
}
for (const [k, v] of [...byKey].sort()) {
  console.log(`${k.padEnd(12)} games=${v.length} avgTurns=${Math.round(v.reduce((a, b) => a + b, 0) / v.length)}`);
}
console.log(`winner level: hard=${hardWins} easy=${easyWins}`);
console.log(errors.length ? `❌ ${errors.length} errors, e.g. ${[...new Set(errors)].slice(0, 5).join(' | ')}` : '✅ no invariant violations');
process.exit(errors.length ? 1 : 0);
