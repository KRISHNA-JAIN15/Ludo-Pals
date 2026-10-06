import { memo, type CSSProperties } from 'react';
import { cellKey, cellOf, cellPoint, geom, rotate, yardCenter, yardSlot, type Geom, type Pt } from '../../shared/board';
import { CHARACTERS } from '../../shared/characters';
import { targetOf } from '../../shared/engine';
import type { CharacterId, GameState } from '../../shared/types';
import type { Fx } from '../game/useBoardAnimation';
import { Mascot, type Mood } from './Mascot';

const PAPER = '#FFFDF7';
const EDGE = '#E4DBC6';
const CELL_LINE = '#E8E0CD';
const NEUTRAL = { color: '#D9D2C3', dark: '#BDB4A2', light: '#EEEAE0' };

const STAR = (() => {
  const pts: string[] = [];
  for (let i = 0; i < 10; i++) {
    const r = i % 2 ? 0.45 : 1;
    const a = (Math.PI / 5) * i - Math.PI / 2;
    pts.push(`${(r * Math.cos(a)).toFixed(3)} ${(r * Math.sin(a)).toFixed(3)}`);
  }
  return `M${pts.join('L')}Z`;
})();

type ArmPalette = { color: string; dark: string; light: string };

function palette(owner: CharacterId | null): ArmPalette {
  return owner ? CHARACTERS[owner] : NEUTRAL;
}

/** Everything that never moves: base, yards, cells and centre. */
const BoardSurface = memo(
  function BoardSurface({
    arms,
    owners,
    viewDeg,
    activeArm,
    tokens,
  }: {
    arms: 4 | 6;
    owners: (CharacterId | null)[];
    viewDeg: number;
    activeArm: number | null;
    tokens: number;
  }) {
    const g = geom(arms);
    const { x, y, w, h } = g.bounds;
    const a = g.apothem;
    // Each polygon vertex is the +x base corner of one arm.
    const centerPts = Array.from({ length: arms }, (_, k) => rotate([1.5, a], k * g.armDeg).join(',')).join(' ');

    const yardShape = (k: number, inset: number, props: Record<string, unknown>, key: string) => {
      const c = yardCenter(g, k);
      if (arms === 4) {
        const half = g.yardSize / 2 - inset;
        return <rect key={key} x={c[0] - half} y={c[1] - half} width={half * 2} height={half * 2} rx={Math.max(0.3, 0.9 - inset * 0.2)} {...props} />;
      }
      return <circle key={key} cx={c[0]} cy={c[1]} r={g.yardSize / 2 - inset} {...props} />;
    };

    const baseShapes = (props: Record<string, unknown>) => (
      <>
        <polygon points={centerPts} {...props} />
        {Array.from({ length: arms }, (_, k) => (
          <rect key={`a${k}`} x={-1.5} y={0} width={3} height={a + 6} transform={`rotate(${k * g.armDeg})`} {...props} />
        ))}
        {Array.from({ length: arms }, (_, k) => yardShape(k, 0, props, `y${k}`))}
        {/* fill the notch between two arms and their yard so the base reads as one shape */}
        {Array.from({ length: arms }, (_, k) => {
          const v = rotate([-1.5, a], k * g.armDeg);
          const p1 = rotate([-1.5, a + 3], k * g.armDeg);
          const p2 = rotate([1.5, a + 3], (k + 1) * g.armDeg);
          const c = yardCenter(g, k);
          return <polygon key={`n${k}`} points={[v, p1, c, p2].map((p) => p.join(',')).join(' ')} {...props} />;
        })}
      </>
    );

    return (
      <svg className="board-svg" viewBox={`${x} ${y} ${w} ${h}`} aria-hidden>
        <defs>
          <filter id="lp-board-shadow" x="-10%" y="-10%" width="120%" height="125%">
            <feDropShadow dx="0" dy="0.32" stdDeviation="0.38" floodColor="#5B4A22" floodOpacity="0.22" />
          </filter>
          <path id="lp-star" d={STAR} />
        </defs>

        <g filter="url(#lp-board-shadow)">
          <g transform={`rotate(${viewDeg})`}>
            {baseShapes({ fill: EDGE, stroke: EDGE, strokeWidth: 1.25, strokeLinejoin: 'round' })}
            {baseShapes({ fill: PAPER, stroke: PAPER, strokeWidth: 1.0, strokeLinejoin: 'round' })}
          </g>
        </g>

        <g transform={`rotate(${viewDeg})`}>
          {/* yards */}
          {owners.map((owner, k) => {
            const pal = palette(owner);
            const active = activeArm === k;
            return (
              <g key={`y${k}`} className={active ? 'yard yard--active' : 'yard'}>
                {active && yardShape(k, -0.18, { className: 'yard-glow', fill: 'none', stroke: pal.color, strokeWidth: 0.22 }, 'glow')}
                {yardShape(k, 0.12, { fill: pal.color }, 'outer')}
                {yardShape(k, arms === 4 ? 0.85 : 0.42, { fill: PAPER }, 'inner')}
                {Array.from({ length: tokens }, (_, s) => {
                  const p = yardSlot(g, k, s, tokens);
                  return (
                    <g key={`slot${s}`}>
                      <circle cx={p[0]} cy={p[1]} r={arms === 4 ? 0.62 : 0.5} fill={pal.light} />
                      <circle
                        cx={p[0]}
                        cy={p[1] + 0.06}
                        r={arms === 4 ? 0.46 : 0.37}
                        fill="none"
                        stroke={pal.color}
                        strokeOpacity={0.35}
                        strokeWidth={0.07}
                      />
                    </g>
                  );
                })}
              </g>
            );
          })}

          {/* arms */}
          {owners.map((owner, k) => {
            const pal = palette(owner);
            const cells = [];
            for (const lx of [-1, 0, 1]) {
              for (let r = 0; r < 6; r++) {
                const home = lx === 0 && r <= 4;
                const start = lx === -1 && r === 4;
                const fill = home || start ? pal.color : '#FFFFFF';
                cells.push(
                  <rect
                    key={`${lx}.${r}`}
                    x={lx - 0.5 + 0.045}
                    y={a + r + 0.045}
                    width={0.91}
                    height={0.91}
                    rx={0.17}
                    fill={fill}
                    stroke={home || start ? 'none' : CELL_LINE}
                    strokeWidth={0.045}
                  />,
                );
              }
            }
            return (
              <g key={`a${k}`} transform={`rotate(${k * g.armDeg})`}>
                {cells}
                {/* start cell: safe, marked with a white star */}
                <use href="#lp-star" transform={`translate(-1 ${a + 4.5}) scale(0.3)`} fill="#fff" opacity={0.95} />
                {/* star safe cell */}
                <use
                  href="#lp-star"
                  transform={`translate(1 ${a + 3.5}) scale(0.3)`}
                  fill="none"
                  stroke="#C9BFA8"
                  strokeWidth={0.22}
                  strokeLinejoin="round"
                />
                {/* home entry chevron on the tip */}
                <path
                  d={`M-0.24 ${a + 5.62} L0 ${a + 5.36} L0.24 ${a + 5.62}`}
                  fill="none"
                  stroke={pal.color}
                  strokeWidth={0.13}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                {/* home column chevrons */}
                {[3.5, 1.5].map((r) => (
                  <path
                    key={r}
                    d={`M-0.18 ${a + r + 0.1} L0 ${a + r - 0.08} L0.18 ${a + r + 0.1}`}
                    fill="none"
                    stroke="#fff"
                    strokeOpacity={0.6}
                    strokeWidth={0.09}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                ))}
              </g>
            );
          })}

          {/* centre */}
          {owners.map((owner, k) => {
            const pal = palette(owner);
            const p1 = rotate([-1.5, a], k * g.armDeg);
            const p2 = rotate([1.5, a], k * g.armDeg);
            return (
              <polygon
                key={`c${k}`}
                points={`0,0 ${p1.join(',')} ${p2.join(',')}`}
                fill={pal.color}
                stroke={PAPER}
                strokeWidth={0.08}
                strokeLinejoin="round"
              />
            );
          })}
          <circle r={arms === 4 ? 0.62 : 0.85} fill={PAPER} stroke="#1C1813" strokeWidth={0.07} />
          <use
            href="#lp-star"
            transform={`scale(${arms === 4 ? 0.38 : 0.5})`}
            fill="#F6C443"
            stroke="#1C1813"
            strokeWidth={0.18}
            strokeLinejoin="round"
          />
        </g>
      </svg>
    );
  },
  (a, b) =>
    a.arms === b.arms && a.viewDeg === b.viewDeg && a.activeArm === b.activeArm && a.tokens === b.tokens && a.owners.join() === b.owners.join(),
);

function stackOffsets(n: number): { off: Pt[]; scale: number } {
  if (n <= 1) return { off: [[0, 0]], scale: 1 };
  if (n === 2)
    return {
      off: [
        [-0.2, 0],
        [0.2, 0],
      ],
      scale: 0.78,
    };
  if (n === 3)
    return {
      off: [
        [-0.2, -0.13],
        [0.2, -0.13],
        [0, 0.18],
      ],
      scale: 0.7,
    };
  const off: Pt[] = [];
  for (let i = 0; i < n; i++) off.push([i % 2 ? 0.2 : -0.2, Math.floor(i / 2) % 2 ? 0.2 : -0.2]);
  return { off, scale: 0.64 };
}

export interface BoardProps {
  state: GameState;
  viewArm: number;
  display: number[][];
  hops: Record<string, number>;
  returning: Set<string>;
  /** Tokens of the current player this device may move right now. */
  movable: number[];
  onPick: (token: number) => void;
  fx: Fx[];
  shake: number;
  moods: Record<number, Mood>;
}

export function Board({ state, viewArm, display, hops, returning, movable, onPick, fx, shake, moods }: BoardProps) {
  const g: Geom = geom(state.arms);
  const viewDeg = g.baseView - viewArm * g.armDeg;
  const { x: bx, y: by, w, h } = g.bounds;
  const owners: (CharacterId | null)[] = Array.from({ length: state.arms }, (_, k) => state.players.find((p) => p.arm === k)?.character ?? null);
  const active = state.players[state.turn];
  const activeArm = state.phase === 'over' ? null : (active?.arm ?? null);
  const step = 165 * state.speed;

  const pct = (p: Pt) => {
    const r = rotate(p, viewDeg);
    return { left: `${((r[0] - bx) / w) * 100}%`, top: `${((r[1] - by) / h) * 100}%` };
  };

  // Group tokens by cell so stacked tokens fan out.
  type Item = { pi: number; ti: number; progress: number; key: string; cell: string };
  const items: Item[] = [];
  state.players.forEach((pl, pi) => {
    (display[pi] ?? pl.tokens).forEach((progress, ti) => {
      const c = cellOf(state.arms, pl.arm, progress, ti);
      items.push({ pi, ti, progress, key: `${pi}-${ti}`, cell: cellKey(c) });
    });
  });
  const groups = new Map<string, Item[]>();
  for (const it of items) groups.set(it.cell, [...(groups.get(it.cell) ?? []), it]);

  const tokenSize = 0.92;
  const sizePct = (tokenSize / w) * 100;
  const movableSet = new Set(movable);

  const targets =
    movable.length > 0
      ? movable
          .map((t) => {
            const to = targetOf(state, state.turn, t, state.dice ?? 0);
            if (to === null) return null;
            return cellPoint(g, cellOf(state.arms, active.arm, to, t), state.rules.tokens);
          })
          .filter((p): p is Pt => !!p)
      : [];
  const uniqTargets = [...new Map(targets.map((p) => [p.map((n) => n.toFixed(2)).join(','), p])).values()];

  return (
    <div
      className={`board ${shake ? (shake % 2 ? 'board--shake-a' : 'board--shake-b') : ''}`}
      style={{ aspectRatio: `${w} / ${h}`, '--step': `${step}ms` } as CSSProperties}
    >
      <BoardSurface arms={state.arms} owners={owners} viewDeg={viewDeg} activeArm={activeArm} tokens={state.rules.tokens} />

      {uniqTargets.map((p, i) => (
        <span
          key={`t${i}`}
          className="target-hint"
          style={{ ...pct(p), width: `${sizePct * 1.08}%`, '--c': CHARACTERS[active.character].color } as CSSProperties}
        />
      ))}

      {items.map((it) => {
        const pl = state.players[it.pi];
        const group = groups.get(it.cell)!;
        const idx = group.indexOf(it);
        const { off, scale } = stackOffsets(group.length);
        const c = cellOf(state.arms, pl.arm, it.progress, it.ti);
        const base = cellPoint(g, c, state.rules.tokens);
        // stack offsets are screen-aligned, so apply them after rotating the cell point
        const r = rotate(base, viewDeg);
        const o = off[idx] ?? [0, 0];
        const left = `${((r[0] + o[0] - bx) / w) * 100}%`;
        const top = `${((r[1] + o[1] - by) / h) * 100}%`;
        const canMove = it.pi === state.turn && movableSet.has(it.ti);
        const finished = c.kind === 'finish';
        const z = canMove ? 50 : Math.round((r[1] + o[1] - by) * 2) + (finished ? 0 : 10);
        return (
          <button
            key={it.key}
            type="button"
            className={[
              'token',
              canMove ? 'token--movable' : '',
              returning.has(it.key) ? 'token--returning' : '',
              finished ? 'token--home' : '',
              it.pi === state.turn && state.phase !== 'over' ? 'token--turn' : '',
            ].join(' ')}
            style={{ left, top, width: `${sizePct}%`, zIndex: z, '--scale': scale * (finished ? 0.8 : 1) } as CSSProperties}
            onClick={canMove ? () => onPick(it.ti) : undefined}
            tabIndex={canMove ? 0 : -1}
            aria-label={`${pl.name} token ${it.ti + 1}${canMove ? ' — tap to move' : ''}`}
          >
            <span className="token-shadow" />
            <span className={`token-hop ${(hops[it.key] ?? 0) % 2 ? 'hop-a' : hops[it.key] ? 'hop-b' : ''}`}>
              <Mascot id={pl.character} outline lite blink={false} size="100%" mood={moods[it.pi] ?? 'idle'} />
            </span>
          </button>
        );
      })}

      {fx.map((f) => (
        <span key={f.id} className={`fx fx--${f.kind}`} style={{ ...pct(f.pt), '--c': f.color } as CSSProperties}>
          {f.kind === 'bonk' && (
            <>
              <span className="fx-burst" />
              <b>BONK!</b>
              {Array.from({ length: 10 }, (_, i) => (
                <i key={i} style={{ '--a': `${i * 36}deg` } as CSSProperties} />
              ))}
            </>
          )}
          {f.kind === 'home' && (
            <>
              <span className="fx-ring" />
              <b>HOME!</b>
              {Array.from({ length: 8 }, (_, i) => (
                <i key={i} style={{ '--a': `${i * 45 + 20}deg` } as CSSProperties} />
              ))}
            </>
          )}
          {f.kind === 'release' && (
            <>
              <span className="fx-ring" />
              {Array.from({ length: 6 }, (_, i) => (
                <i key={i} style={{ '--a': `${i * 60}deg` } as CSSProperties} />
              ))}
            </>
          )}
          {f.kind === 'safe' && <span className="fx-ring" />}
        </span>
      ))}
    </div>
  );
}

/** Screen-space position of each arm's yard for the given view (used to place player chips). */
export function yardScreenPositions(arms: 4 | 6, viewArm: number): Pt[] {
  const g = geom(arms);
  const viewDeg = g.baseView - viewArm * g.armDeg;
  return Array.from({ length: arms }, (_, k) => rotate(yardCenter(g, k), viewDeg));
}
