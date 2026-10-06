/**
 * Generates public/topo.svg: a seamlessly tiling topographic contour pattern.
 * A periodic field (sum of integer-frequency waves) is traced with marching squares.
 * Usage: npx tsx scripts/gen-topo.ts
 */
import { writeFileSync } from 'node:fs';

const SIZE = 480;
const N = 160; // grid cells per side
const LEVELS = [-1.35, -0.95, -0.55, -0.15, 0.25, 0.65, 1.05, 1.45];

let seed = 7;
const rand = () => {
  seed = (seed * 16807) % 2147483647;
  return seed / 2147483647;
};

const waves = Array.from({ length: 9 }, (_, i) => {
  const k = 1 + Math.floor(rand() * 3);
  const l = Math.floor(rand() * 4) - 1;
  return { k: i % 2 ? k : l, l: i % 2 ? l : k, a: 0.9 / (1 + i * 0.35), p: rand() * Math.PI * 2 };
});

const field = (u: number, v: number) => {
  let s = 0;
  for (const w of waves) s += w.a * Math.sin(2 * Math.PI * (w.k * u + w.l * v) + w.p);
  // a gentle second octave for organic wobble, still periodic
  s += 0.18 * Math.sin(2 * Math.PI * (5 * u + 3 * v) + 1.3) + 0.12 * Math.sin(2 * Math.PI * (4 * u - 6 * v) + 0.4);
  return s;
};

const vals: number[][] = [];
for (let j = 0; j <= N; j++) {
  vals.push([]);
  for (let i = 0; i <= N; i++) vals[j].push(field(i / N, j / N));
}

type P = [number, number];
const key = (p: P) => `${p[0].toFixed(2)},${p[1].toFixed(2)}`;
const paths: string[] = [];

for (const level of LEVELS) {
  const segs: [P, P][] = [];
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const a = vals[j][i];
      const b = vals[j][i + 1];
      const c = vals[j + 1][i + 1];
      const d = vals[j + 1][i];
      const idx = (a > level ? 8 : 0) | (b > level ? 4 : 0) | (c > level ? 2 : 0) | (d > level ? 1 : 0);
      if (idx === 0 || idx === 15) continue;
      const lerp = (v1: number, v2: number) => (level - v1) / (v2 - v1);
      const s = SIZE / N;
      const top: P = [(i + lerp(a, b)) * s, j * s];
      const right: P = [(i + 1) * s, (j + lerp(b, c)) * s];
      const bottom: P = [(i + lerp(d, c)) * s, (j + 1) * s];
      const left: P = [i * s, (j + lerp(a, d)) * s];
      const table: Record<number, [P, P][]> = {
        1: [[left, bottom]],
        2: [[bottom, right]],
        3: [[left, right]],
        4: [[top, right]],
        5: [
          [left, top],
          [bottom, right],
        ],
        6: [[top, bottom]],
        7: [[left, top]],
        8: [[left, top]],
        9: [[top, bottom]],
        10: [
          [left, bottom],
          [top, right],
        ],
        11: [[top, right]],
        12: [[left, right]],
        13: [[bottom, right]],
        14: [[left, bottom]],
      };
      segs.push(...table[idx]);
    }
  }

  // Chain segments into polylines.
  const ends = new Map<string, number[]>();
  segs.forEach(([p, q], n) => {
    for (const k of [key(p), key(q)]) ends.set(k, [...(ends.get(k) ?? []), n]);
  });
  const used = new Set<number>();
  for (let n = 0; n < segs.length; n++) {
    if (used.has(n)) continue;
    used.add(n);
    const line: P[] = [segs[n][0], segs[n][1]];
    for (const dir of [1, -1]) {
      for (;;) {
        const tip = dir === 1 ? line[line.length - 1] : line[0];
        const next = (ends.get(key(tip)) ?? []).find((m) => !used.has(m));
        if (next === undefined) break;
        used.add(next);
        const [p, q] = segs[next];
        const other = key(p) === key(tip) ? q : p;
        if (dir === 1) line.push(other);
        else line.unshift(other);
      }
    }
    if (line.length < 3) continue;
    // Thin the polyline a little to keep the file small.
    const pts = line.filter((_, i) => i % 2 === 0 || i === line.length - 1);
    paths.push('M' + pts.map((p) => `${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join('L'));
  }
}

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}"><path d="${paths.join('')}" fill="none" stroke="#000" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round"/></svg>`;
writeFileSync(new URL('../public/topo.svg', import.meta.url), svg);
console.log(`topo.svg: ${paths.length} contours, ${(svg.length / 1024).toFixed(1)} KB`);
