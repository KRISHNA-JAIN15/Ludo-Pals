import { finishAt, globalIndex, homeStart, isSafe } from './board';
import { capturesAt, onTrack, preyAhead, targetOf, threatAt } from './engine';
import type { BotLevel, GameState } from './types';

/** Heuristic score for moving token t of player p by `dice`. Higher is better. */
export function scoreMove(state: GameState, p: number, t: number, dice: number): number {
  const { arms } = state;
  const from = state.players[p].tokens[t];
  const to = targetOf(state, p, t, dice);
  if (to === null) return -Infinity;
  const fin = finishAt(arms);
  const home0 = homeStart(arms);
  let s = 0;

  if (from < 0) s += 55;
  if (to === fin) s += 130;
  else if (to >= home0 && from < home0) s += 65;

  const caps = capturesAt(state, p, to);
  for (const c of caps) s += 95 + c.from * 1.3;

  if (onTrack(arms, to) && isSafe(arms, globalIndex(arms, state.players[p].arm, to))) s += 28;

  const before = from >= 0 ? threatAt(state, p, from) : 0;
  const after = caps.length ? threatAt(state, p, to) * 0.8 : threatAt(state, p, to);
  s += before * (28 + from * 0.7);
  s -= after * (38 + to * 0.7);

  s += preyAhead(state, p, to) * 9;
  s += to * 0.18;
  // Leaving tokens bunched in the home column is fine, but prefer finishing exactly.
  if (to > home0 && to < fin) s -= 4;
  return s;
}

export function chooseMove(state: GameState, p: number, dice: number, movable: number[], level: BotLevel, rng: () => number = Math.random): number {
  if (movable.length === 1) return movable[0];
  if (level === 'easy' && rng() < 0.55) return movable[Math.floor(rng() * movable.length)];
  const noise = level === 'easy' ? 40 : level === 'normal' ? 14 : 0;
  let best = movable[0];
  let bestScore = -Infinity;
  for (const t of movable) {
    const sc = scoreMove(state, p, t, dice) + (rng() - 0.5) * noise;
    if (sc > bestScore) {
      bestScore = sc;
      best = t;
    }
  }
  return best;
}
