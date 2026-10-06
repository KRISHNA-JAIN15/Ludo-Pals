/**
 * Board geometry for a radial Ludo board with N arms (4 = classic cross, 6 = hex star).
 *
 * Each arm is a 3x6 strip of cells radiating out of a central N-gon. Locally an arm
 * points "down" (+y); lateral x is -1 / 0 / +1 and row r counts 0..5 outward.
 * Arm k is rotated by k * 360/N degrees (clockwise on screen), so play moves clockwise.
 *
 * Per arm the shared track has 13 cells: outward on x=+1, the tip (x=0, r=5),
 * then inward on x=-1. Player k starts on (x=-1, r=4) of arm k and walks
 * 13N-1 track cells before turning into the home column (x=0, r=4..0).
 */

export type Pt = [number, number];

export const ARM_TRACK = 13;
export const SIDE = 3;

export const trackLength = (arms: number) => ARM_TRACK * arms;
/** Last progress value that is still on the shared track. */
export const lastTrack = (arms: number) => ARM_TRACK * arms - 2;
/** First progress value inside the home column. */
export const homeStart = (arms: number) => ARM_TRACK * arms - 1;
/** Progress value of a token that reached home. */
export const finishAt = (arms: number) => ARM_TRACK * arms + 4;
export const startIndex = (arm: number) => ARM_TRACK * arm + 8;
export const starIndex = (arm: number) => ARM_TRACK * arm + 3;

export function layoutFor(players: number): { arms: 4 | 6; seats: number[] } {
  switch (players) {
    case 2:
      return { arms: 4, seats: [0, 2] };
    case 3:
      return { arms: 4, seats: [0, 1, 2] };
    case 4:
      return { arms: 4, seats: [0, 1, 2, 3] };
    case 5:
      return { arms: 6, seats: [0, 1, 2, 3, 4] };
    default:
      return { arms: 6, seats: [0, 1, 2, 3, 4, 5] };
  }
}

export function globalIndex(arms: number, arm: number, progress: number): number {
  return (startIndex(arm) + progress) % trackLength(arms);
}

export function isSafe(arms: number, gi: number): boolean {
  const i = gi % ARM_TRACK;
  return gi >= 0 && gi < trackLength(arms) && (i === 8 || i === 3);
}

export function rotate([x, y]: Pt, deg: number): Pt {
  const a = (deg * Math.PI) / 180;
  const c = Math.cos(a);
  const s = Math.sin(a);
  return [x * c - y * s, x * s + y * c];
}

export interface Geom {
  arms: number;
  apothem: number;
  circum: number;
  armDeg: number;
  yardDist: number;
  yardSize: number;
  /** Default view rotation (degrees) that puts arm 0's yard at the bottom. */
  baseView: number;
  /** Bounds of the board once rotated by baseView (any arm-aligned view has the same bounds). */
  bounds: { x: number; y: number; w: number; h: number };
}

const geomCache = new Map<number, Geom>();

export function geom(arms: number): Geom {
  const hit = geomCache.get(arms);
  if (hit) return hit;
  const half = Math.PI / arms;
  const apothem = SIDE / (2 * Math.tan(half));
  const circum = SIDE / (2 * Math.sin(half));
  const armDeg = 360 / arms;
  let yardDist: number;
  let yardSize: number;
  if (arms === 4) {
    yardDist = 4.5 * Math.SQRT2;
    yardSize = 6;
  } else {
    // The gap between two neighbouring arms is a wedge of 360/N degrees starting at a
    // polygon vertex. A circle tangent to both arm edges sits at d = rho / sin(wedge / 2).
    const rho = 2.3;
    const d = rho / Math.sin(half);
    yardDist = circum + d;
    yardSize = rho * 2;
  }
  const baseView = arms === 4 ? 0 : -armDeg / 2;

  const pts: Pt[] = [];
  for (let k = 0; k < arms; k++) {
    const deg = k * armDeg;
    pts.push(rotate([-1.5, apothem + 6], deg + baseView), rotate([1.5, apothem + 6], deg + baseView));
    const c = rotate([0, yardDist], deg + armDeg / 2 + baseView);
    const h = yardSize / 2;
    pts.push([c[0] - h, c[1] - h], [c[0] + h, c[1] + h]);
  }
  const pad = 0.35;
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const x = Math.min(...xs) - pad;
  const y = Math.min(...ys) - pad;
  const g: Geom = {
    arms,
    apothem,
    circum,
    armDeg,
    yardDist,
    yardSize,
    baseView,
    bounds: { x, y, w: Math.max(...xs) + pad - x, h: Math.max(...ys) + pad - y },
  };
  geomCache.set(arms, g);
  return g;
}

/** Local arm cell (lateral, row) of track cell i (0..12) within an arm. */
export function trackCellLocal(i: number): { lx: number; r: number } {
  if (i <= 5) return { lx: 1, r: i };
  if (i === 6) return { lx: 0, r: 5 };
  return { lx: -1, r: 12 - i };
}

export function armPoint(g: Geom, arm: number, lx: number, r: number): Pt {
  return rotate([lx, g.apothem + r + 0.5], arm * g.armDeg);
}

export function trackPoint(g: Geom, gi: number): Pt {
  const arm = Math.floor(gi / ARM_TRACK);
  const { lx, r } = trackCellLocal(gi % ARM_TRACK);
  return armPoint(g, arm, lx, r);
}

export function yardCenter(g: Geom, arm: number): Pt {
  return rotate([0, g.yardDist], arm * g.armDeg + g.armDeg / 2);
}

export function yardSlot(g: Geom, arm: number, slot: number, tokens: number): Pt {
  const c = yardCenter(g, arm);
  const d = g.arms === 4 ? 1.15 : 0.8;
  const layouts: Record<number, Pt[]> = {
    1: [[0, 0]],
    2: [
      [-d, -d],
      [d, d],
    ],
    3: [
      [-d, -d],
      [d, -d],
      [0, d],
    ],
    4: [
      [-d, -d],
      [d, -d],
      [-d, d],
      [d, d],
    ],
  };
  const off = (layouts[tokens] ?? layouts[4])[slot] ?? [0, 0];
  const deg = g.arms === 4 ? 0 : arm * g.armDeg + g.armDeg / 2;
  const o = rotate(off, deg);
  return [c[0] + o[0], c[1] + o[1]];
}

export function finishPoint(g: Geom, arm: number): Pt {
  return rotate([0, (g.apothem * 2) / 3], arm * g.armDeg);
}

export type CellRef =
  | { kind: 'yard'; arm: number; slot: number }
  | { kind: 'track'; gi: number }
  | { kind: 'home'; arm: number; r: number }
  | { kind: 'finish'; arm: number };

export function cellOf(arms: number, arm: number, progress: number, token: number): CellRef {
  if (progress < 0) return { kind: 'yard', arm, slot: token };
  if (progress <= lastTrack(arms)) return { kind: 'track', gi: globalIndex(arms, arm, progress) };
  if (progress >= finishAt(arms)) return { kind: 'finish', arm };
  return { kind: 'home', arm, r: 4 - (progress - homeStart(arms)) };
}

export function cellKey(c: CellRef): string {
  switch (c.kind) {
    case 'yard':
      return `y${c.arm}.${c.slot}`;
    case 'track':
      return `t${c.gi}`;
    case 'home':
      return `h${c.arm}.${c.r}`;
    case 'finish':
      return `f${c.arm}`;
  }
}

export function cellPoint(g: Geom, c: CellRef, tokensPerPlayer: number): Pt {
  switch (c.kind) {
    case 'yard':
      return yardSlot(g, c.arm, c.slot, tokensPerPlayer);
    case 'track':
      return trackPoint(g, c.gi);
    case 'home':
      return armPoint(g, c.arm, 0, c.r);
    case 'finish':
      return finishPoint(g, c.arm);
  }
}
