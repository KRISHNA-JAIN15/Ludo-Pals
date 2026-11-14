/**
 * Action dice: a small "game director". Instead of six equal faces, every face is weighted by
 * what it would do on the board right now, the way popular Ludo apps keep a match lively:
 *
 * - Nobody sits stuck. With nothing to move, the faces that would move something get likelier
 *   with every dead roll, and the fifth roll in a row always moves. A whole yard waiting for a
 *   six gets it within a couple of turns, and nobody goes more than SIX_DROUGHT_MAX rolls without one.
 * - More chases end in a bonk. A face that lands on an opponent is likelier: more so on a quiet
 *   board, when it is payback, and when the roller is behind; a little less for a token that
 *   has nearly made it round.
 * - No pile-ons. A player who was just sent home is hard to hit again for a couple of rounds.
 * - The race keeps moving: big numbers and the roll that brings a token home come up a bit more.
 * - Comebacks. The boosts are stronger for whoever trails and fade for a runaway leader.
 * - A third six in a row (which burns the turn) is rare.
 *
 * The weights depend only on the game state and the roll comes from the game's seeded stream,
 * so a game still replays identically from its seed. Everyone gets the same treatment: bots and
 * humans, host and guests.
 */
import { finishAt, lastTrack } from './board';
import { capturesAt, movableTokens, targetOf, totalProgress } from './engine';
import type { GameState, Luck, PlayerState } from './types';

/**
 * The knobs. `npm run sim` prints how they play out over a few hundred games; these settings
 * keep a match as long as with plain random dice while giving about 50% more bonks, 40% more
 * sixes, a first token out after two rolls instead of six, and almost no dead rolls.
 */
export const TUNE = {
  /** How likely a dead face (nothing to move) stays, by how many dead rolls came just before it. */
  dead: [0.9, 0.6, 0.35, 0.15, 0],
  /** Whole yard waiting: the release faces start this much likelier, plus `stuckStep` per dead roll. */
  stuck: 1.6,
  stuckStep: 0.7,
  /** Tokens already out: each token still in the yard makes a release face this much likelier. */
  yard: 0.1,
  /**
   * A face that lands on an opponent is this much likelier. `bonkFar` is added for a token about
   * to turn home: negative, so long journeys are not the ones that usually get cut short.
   */
  bonk: 0.6,
  bonkFar: -0.3,
  /** Busy boards bonk plenty by themselves: the bonk boost is scaled by (3 / opponents) ^ crowd, at most `crowdMax`. */
  crowd: 1.5,
  crowdMax: 2.4,
  /** Extra when the victim is whoever last sent the roller home. */
  payback: 1.3,
  /** How much boosts grow for a player a full lap behind, and shrink for one a full lap ahead. */
  trail: 0.3,
  lead: 0.5,
  /** A face that would hit a player who was just sent home is this unlikely instead. */
  breather: 0.55,
  /** A face that brings a token home. */
  finish: 1.6,
  /** Keeps the race moving: a playable six is weighted 1 + pace / 2 and a playable one 1 - pace / 2 (faces between scale evenly). */
  pace: 0.45,
  /** From this many rolls without a six, a six gets `droughtStep` likelier per roll. */
  droughtFrom: 5,
  droughtStep: 0.3,
  /** A third six in a row burns the turn, so it is rare. */
  thirdSix: 0.3,
  /** No single face is ever weighted beyond this (unless it is the only one left). */
  max: 4.5,
};
/** The most dead rolls a player can have in a row. */
export const DRY_MAX = TUNE.dead.length - 1;
/** The most rolls a player can go without a six (while a six would be a legal move). */
export const SIX_DROUGHT_MAX = 9;

export const luckOf = (pl: PlayerState): Luck => (pl.luck ??= { dry: 0, sinceSix: 0, hitAt: -1000, hitBy: -1 });

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** How far player p trails the players still racing: +1 = a full lap behind, -1 = a runaway leader. */
export function lagOf(st: GameState, p: number): number {
  const others = st.players.map((_, i) => i).filter((i) => i !== p && !st.players[i].rank);
  if (!others.length) return 0;
  const span = (finishAt(st.arms) + 1) * st.rules.tokens;
  const avg = others.reduce((s, i) => s + totalProgress(st, i), 0) / others.length;
  return clamp((avg - totalProgress(st, p)) / (span * 0.25), -1, 1);
}

/** Relative chance of each face (index 0 = a one) for player p's next roll. */
export function actionWeights(st: GameState, p: number): number[] {
  const pl = st.players[p];
  const luck = luckOf(pl);
  const fin = finishAt(st.arms);
  const last = lastTrack(st.arms);
  const n = st.players.length;
  const faces = [1, 2, 3, 4, 5, 6];
  const thirdSix = st.rules.threeSixes && st.sixStreak >= 2;
  // A third six in a row burns the turn whatever could have moved: for the dice it is a dead face.
  const legal = faces.map((f) => (f === 6 && thirdSix ? [] : movableTokens(st, p, f)));
  const anyLegal = legal.some((l) => l.length > 0);
  const inYard = pl.tokens.filter((t) => t < 0).length;
  const onBoard = pl.tokens.some((t) => t >= 0 && t < fin);
  const sixLegal = legal[5].length > 0;

  if (sixLegal && luck.sinceSix >= SIX_DROUGHT_MAX) return [0, 0, 0, 0, 0, 1];

  const lag = lagOf(st, p);
  // Luck leans towards whoever is behind: boosts grow for a trailing player and shrink for a runaway leader.
  const swing = lag >= 0 ? 1 + TUNE.trail * lag : 1 + TUNE.lead * lag;
  const dry = Math.min(luck.dry, DRY_MAX);
  const crowd = Math.min(TUNE.crowdMax, Math.pow(3 / Math.max(1, n - 1), TUNE.crowd));

  return faces.map((f, i) => {
    const moves = legal[i];
    let w = 1;
    if (!moves.length) {
      w = anyLegal ? TUNE.dead[dry] : 1;
    } else {
      const releases = inYard > 0 && st.rules.releaseOn.includes(f);
      if (releases && !onBoard) w *= TUNE.stuck + TUNE.stuckStep * dry;
      else if (releases) w *= 1 + TUNE.yard * inYard * Math.max(1, swing);

      // The best bonk this face offers (the player picks one token to move).
      let bonk = 0;
      let spares = false;
      let finishes = false;
      for (const t of moves) {
        const to = targetOf(st, p, t, f)!;
        if (to === fin) finishes = true;
        let value = 0;
        let breather = false;
        for (const c of capturesAt(st, p, to)) {
          // Just sent home: they get a couple of rounds before anyone is likely to hit them again.
          if (st.rollCount - luckOf(st.players[c.player]).hitAt <= 2 * n + 2) breather = true;
          const payback = luck.hitBy === c.player && st.rollCount - luck.hitAt <= 6 * n;
          value += (TUNE.bonk + TUNE.bonkFar * (c.from / last)) * (payback ? TUNE.payback : 1) * swing * crowd;
        }
        if (breather) spares = true;
        else bonk = Math.max(bonk, value);
      }
      w *= bonk > 0 ? 1 + bonk : spares ? TUNE.breather : 1;
      if (finishes) w *= TUNE.finish;
      w *= 1 + (TUNE.pace * (f - 3.5)) / 5;
      if (f === 6 && luck.sinceSix >= TUNE.droughtFrom) w *= 1 + TUNE.droughtStep * (luck.sinceSix - TUNE.droughtFrom + 1);
    }
    if (f === 6 && thirdSix) w *= TUNE.thirdSix;
    return Math.min(TUNE.max, w);
  });
}

/** Roll for player p with Action dice. `rng` is the game's seeded stream. */
export function actionDie(st: GameState, p: number, rng: () => number): number {
  const weights = actionWeights(st, p);
  const total = weights.reduce((s, w) => s + w, 0);
  if (!(total > 0)) return 1 + Math.floor(rng() * 6);
  let r = rng() * total;
  let face = 6;
  for (let i = 0; i < 6; i++) {
    if (weights[i] <= 0) continue;
    face = i + 1;
    r -= weights[i];
    if (r < 0) break;
  }
  return face;
}
