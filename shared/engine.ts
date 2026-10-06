import { finishAt, globalIndex, isSafe, lastTrack, startIndex, trackLength } from './board';
import type { Capture, GameState } from './types';

/** Progress a token would reach with this roll, or null if it cannot move. */
export function targetOf(state: GameState, p: number, t: number, dice: number): number | null {
  const pl = state.players[p];
  const from = pl.tokens[t];
  const fin = finishAt(state.arms);
  if (pl.rank || from === fin) return null;
  if (from < 0) return state.rules.releaseOn.includes(dice) ? 0 : null;
  const to = from + dice;
  return to <= fin ? to : null;
}

export function movableTokens(state: GameState, p: number, dice: number): number[] {
  const out: number[] = [];
  state.players[p].tokens.forEach((_, t) => {
    if (targetOf(state, p, t, dice) !== null) out.push(t);
  });
  return out;
}

export function onTrack(arms: number, progress: number): boolean {
  return progress >= 0 && progress <= lastTrack(arms);
}

/** Opponent tokens that would be sent home if player p lands on `to`. */
export function capturesAt(state: GameState, p: number, to: number): Capture[] {
  const { arms } = state;
  if (!onTrack(arms, to)) return [];
  const gi = globalIndex(arms, state.players[p].arm, to);
  if (isSafe(arms, gi)) return [];
  const caps: Capture[] = [];
  state.players.forEach((q, qi) => {
    if (qi === p) return;
    q.tokens.forEach((tp, ti) => {
      if (onTrack(arms, tp) && globalIndex(arms, q.arm, tp) === gi) caps.push({ player: qi, token: ti, from: tp });
    });
  });
  return caps;
}

/** How many opponent tokens could land on player p's token at `progress` with one roll. */
export function threatAt(state: GameState, p: number, progress: number): number {
  const { arms } = state;
  if (!onTrack(arms, progress)) return 0;
  const T = trackLength(arms);
  const gi = globalIndex(arms, state.players[p].arm, progress);
  if (isSafe(arms, gi)) return 0;
  const last = lastTrack(arms);
  let n = 0;
  state.players.forEach((q, qi) => {
    if (qi === p || q.rank) return;
    q.tokens.forEach((tp) => {
      if (onTrack(arms, tp)) {
        const dist = (gi - globalIndex(arms, q.arm, tp) + T) % T;
        if (dist >= 1 && dist <= 6 && tp + dist <= last) n++;
      } else if (tp < 0) {
        // A yard token could pop out and chase on a later turn; count it lightly.
        const dist = (gi - startIndex(q.arm) + T) % T;
        if (dist >= 1 && dist <= 5) n += 0.25;
      }
    });
  });
  return n;
}

/** Opponent tokens within striking range ahead of `progress` (targets to hunt next turn). */
export function preyAhead(state: GameState, p: number, progress: number): number {
  const { arms } = state;
  if (!onTrack(arms, progress)) return 0;
  const T = trackLength(arms);
  const gi = globalIndex(arms, state.players[p].arm, progress);
  let n = 0;
  state.players.forEach((q, qi) => {
    if (qi === p) return;
    q.tokens.forEach((tp) => {
      if (!onTrack(arms, tp)) return;
      const og = globalIndex(arms, q.arm, tp);
      if (isSafe(arms, og)) return;
      const dist = (og - gi + T) % T;
      if (dist >= 1 && dist <= 6 && progress + dist <= lastTrack(arms)) n++;
    });
  });
  return n;
}

export function totalProgress(state: GameState, p: number): number {
  return state.players[p].tokens.reduce((s, t) => s + Math.max(0, t + 1), 0);
}

export function tokensHome(state: GameState, p: number): number {
  const fin = finishAt(state.arms);
  return state.players[p].tokens.filter((t) => t === fin).length;
}
