import { useEffect, useRef, useState, type CSSProperties } from 'react';

/** Cube rotation [x, y] (deg) that brings each value's face to the front. */
const FACE_ROT: Record<number, [number, number]> = {
  1: [0, 0],
  6: [0, 180],
  3: [0, -90],
  4: [0, 90],
  2: [-90, 0],
  5: [90, 0],
};

const PIPS: Record<number, number[]> = {
  1: [4],
  2: [0, 8],
  3: [0, 4, 8],
  4: [0, 2, 6, 8],
  5: [0, 2, 4, 6, 8],
  6: [0, 2, 3, 5, 6, 8],
};

const FACES: { v: number; t: string }[] = [
  { v: 1, t: 'translateZ(var(--h))' },
  { v: 6, t: 'rotateY(180deg) translateZ(var(--h))' },
  { v: 3, t: 'rotateY(90deg) translateZ(var(--h))' },
  { v: 4, t: 'rotateY(-90deg) translateZ(var(--h))' },
  { v: 2, t: 'rotateX(90deg) translateZ(var(--h))' },
  { v: 5, t: 'rotateX(-90deg) translateZ(var(--h))' },
];

function spinTo(cur: number, target: number, spins: number) {
  return target + 360 * Math.ceil((cur + 360 * spins - target) / 360);
}

export interface DiceProps {
  value: number | null;
  /** Changes on every roll; triggers the spin. */
  rollKey: number;
  /** Waiting for the result (e.g. network round trip): wobble in place. */
  pending?: boolean;
  accent: string;
  size?: number;
  durationMs?: number;
  glow?: boolean;
  disabled?: boolean;
  onRoll?: () => void;
  label?: string;
}

export function Dice({ value, rollKey, pending, accent, size = 68, durationMs = 760, glow, disabled, onRoll, label }: DiceProps) {
  const [rot, setRot] = useState<[number, number]>(() => FACE_ROT[value ?? 5] ?? [0, 0]);
  const [bounce, setBounce] = useState(0);
  const first = useRef(true);

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    if (!value) return;
    const [tx, ty] = FACE_ROT[value];
    const extra = Math.random() < 0.5 ? 2 : 3;
    setRot(([x, y]) => [spinTo(x, tx, extra), spinTo(y, ty, extra + 1)]);
    setBounce((b) => b + 1);
  }, [rollKey]);

  const style = {
    '--s': `${size}px`,
    '--accent': accent,
    '--dur': `${durationMs}ms`,
  } as CSSProperties;

  return (
    <button
      type="button"
      className={['dice', glow ? 'dice--glow' : '', pending ? 'dice--pending' : '', disabled ? 'dice--disabled' : ''].join(' ')}
      style={style}
      onClick={disabled ? undefined : onRoll}
      aria-disabled={disabled}
      aria-label={label ?? (value ? `Dice showing ${value}` : 'Roll the dice')}
    >
      <span className={bounce ? `dice-shadow ${bounce % 2 ? 'shadow-a' : 'shadow-b'}` : 'dice-shadow'} />
      {/* alternating animation names restart the jump without remounting the cube (which would skip its spin) */}
      <span className={bounce ? `dice-jump ${bounce % 2 ? 'jump-a' : 'jump-b'}` : 'dice-jump'}>
        <span className="dice-tilt">
          <span className="dice-cube" style={{ transform: `rotateX(${rot[0]}deg) rotateY(${rot[1]}deg)` }}>
            <span className="dice-core dice-core--x" />
            <span className="dice-core dice-core--y" />
            <span className="dice-core dice-core--z" />
            {FACES.map((f) => (
              <span key={f.v} className="dice-face" style={{ transform: f.t }}>
                {Array.from({ length: 9 }, (_, i) => (
                  <i key={i} className={PIPS[f.v].includes(i) ? (f.v === 1 ? 'pip pip--one' : 'pip') : 'pip pip--off'} />
                ))}
              </span>
            ))}
          </span>
        </span>
      </span>
    </button>
  );
}
