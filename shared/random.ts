/**
 * Deterministic randomness. Every game has a 32-bit seed; dice, bot choices and who goes
 * first are all derived from it, so a game replays identically from (seed + player actions)
 * on any machine, browser or server.
 */

/** Mix integers into one well-distributed 32-bit value (MurmurHash3-style). */
export function hashSeed(...parts: number[]): number {
  let h = 0x9e3779b9 ^ parts.length;
  for (const part of parts) {
    let k = Math.imul(part | 0, 0xcc9e2d51);
    k = (k << 15) | (k >>> 17);
    k = Math.imul(k, 0x1b873593);
    h ^= k;
    h = (h << 13) | (h >>> 19);
    h = (Math.imul(h, 5) + 0xe6546b64) | 0;
  }
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/** mulberry32: a tiny, fast PRNG with good statistical quality for games. Returns [0, 1). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A fresh 32-bit game seed. */
export function newSeed(): number {
  return Math.floor(Math.random() * 0x100000000) >>> 0;
}

/**
 * Fair dice: a player's rolls come in "bags" of six, and each bag holds every face once in a
 * seeded random order. Over any six rolls everyone sees 1–6 exactly once, so nobody waits
 * forever for a six and luck evens out between players, like the balanced dice used by online
 * Ludo apps. Each player has their own sequence, so you can't read your next roll off someone else's.
 */
export function fairDie(seed: number, player: number, roll: number): number {
  const bag = Math.floor(roll / 6);
  const rng = mulberry32(hashSeed(seed, player, bag, 0x5eed));
  const faces = [1, 2, 3, 4, 5, 6];
  for (let i = 5; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [faces[i], faces[j]] = [faces[j], faces[i]];
  }
  return faces[roll % 6];
}
