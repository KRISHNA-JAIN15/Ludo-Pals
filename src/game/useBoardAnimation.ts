import { useEffect, useRef, useState } from 'react';
import { cellOf, cellPoint, geom, type Pt } from '../../shared/board';
import { CHARACTERS } from '../../shared/characters';
import { TIMING } from '../../shared/rules';
import type { GameState } from '../../shared/types';
import { haptic, sound } from '../audio/sound';

export interface Fx {
  id: number;
  kind: 'bonk' | 'home' | 'release' | 'safe';
  pt: Pt;
  color: string;
}

const tokensOf = (s: GameState) => s.players.map((p) => [...p.tokens]);

/**
 * Turns engine snapshots into a smooth show: the moving token hops cell by cell,
 * captured tokens wait until they are hit and then fly back to their yard.
 */
export function useBoardAnimation(state: GameState | null, isMine: (player: number) => boolean) {
  const [display, setDisplay] = useState<number[][]>(() => (state ? tokensOf(state) : []));
  const [hops, setHops] = useState<Record<string, number>>({});
  const [returning, setReturning] = useState<Set<string>>(new Set());
  const [fx, setFx] = useState<Fx[]>([]);
  const [shake, setShake] = useState(0);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const lastKey = useRef('');
  const animating = useRef(false);
  const latest = useRef<GameState | null>(state);
  const fxId = useRef(0);
  const mineRef = useRef(isMine);
  mineRef.current = isMine;

  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  useEffect(() => {
    if (!state) return;
    latest.current = state;
    const key = `${state.id}:${state.seq}`;
    if (key === lastKey.current) return;
    const fresh = !lastKey.current.startsWith(`${state.id}:`);
    lastKey.current = key;

    const later = (ms: number, fn: () => void) => timers.current.push(setTimeout(fn, ms));
    const clear = () => {
      timers.current.forEach(clearTimeout);
      timers.current = [];
    };
    const addFx = (kind: Fx['kind'], pt: Pt, color: string) => {
      const id = ++fxId.current;
      setFx((f) => [...f, { id, kind, pt, color }]);
      setTimeout(() => setFx((f) => f.filter((x) => x.id !== id)), 1400);
    };

    if (fresh) {
      clear();
      animating.current = false;
      setDisplay(tokensOf(state));
      return;
    }

    const mv = state.events.find((e) => e.type === 'move');
    if (!mv || mv.type !== 'move') {
      if (!animating.current) setDisplay(tokensOf(state));
      return;
    }

    clear();
    animating.current = true;
    const step = TIMING.step * state.speed;
    const start = tokensOf(state).map((arr, pi) =>
      arr.map((t, ti) => {
        if (pi === mv.player && ti === mv.token) return mv.from;
        const c = mv.captures.find((c) => c.player === pi && c.token === ti);
        return c ? c.from : t;
      }),
    );
    setDisplay(start);

    const path: number[] = [];
    if (mv.from < 0) path.push(0);
    else for (let v = mv.from + 1; v <= mv.to; v++) path.push(v);

    const tokenKey = `${mv.player}-${mv.token}`;
    path.forEach((v, i) =>
      later(40 + i * step, () => {
        setDisplay((d) => d.map((arr, pi) => (pi !== mv.player ? arr : arr.map((t, ti) => (ti === mv.token ? v : t)))));
        setHops((h) => ({ ...h, [tokenKey]: (h[tokenKey] ?? 0) + 1 }));
        sound.play('hop', { step: i });
      }),
    );

    const g = geom(state.arms);
    const pl = state.players[mv.player];
    const color = CHARACTERS[pl.character].color;
    const landPt = cellPoint(g, cellOf(state.arms, pl.arm, mv.to, mv.token), state.rules.tokens);
    const arrive = 40 + (path.length - 1) * step + step * 0.85;

    if (mv.from < 0) later(60, () => addFx('release', landPt, color));

    later(arrive, () => {
      if (mv.captures.length) {
        const keys = new Set(mv.captures.map((c) => `${c.player}-${c.token}`));
        setReturning(keys);
        setDisplay((d) => d.map((arr, pi) => arr.map((t, ti) => (keys.has(`${pi}-${ti}`) ? -1 : t))));
        addFx('bonk', landPt, color);
        setShake((s) => s + 1);
        sound.play('capture');
        haptic([30, 40, 70]);
        if (mv.captures.some((c) => mineRef.current(c.player)) && !mineRef.current(mv.player)) {
          later(380, () => sound.play('captured'));
        }
        later(900, () => setReturning(new Set()));
      } else if (mv.home) {
        addFx('home', landPt, color);
        sound.play('home');
        haptic(40);
      } else if (mv.safe) {
        addFx('safe', landPt, color);
        sound.play('safe');
      }
    });

    later(arrive + (mv.captures.length ? 700 : 80), () => {
      animating.current = false;
      if (latest.current) setDisplay(tokensOf(latest.current));
    });
  }, [state]);

  const shown = display.length === (state?.players.length ?? 0) ? display : state ? tokensOf(state) : [];
  return { display: shown, hops, returning, fx, shake };
}
