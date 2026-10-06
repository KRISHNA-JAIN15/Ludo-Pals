import { useId, type CSSProperties, type ReactNode } from 'react';
import { CHARACTERS } from '../../shared/characters';
import type { CharacterId } from '../../shared/types';

export type Mood = 'idle' | 'happy' | 'joy' | 'sad' | 'shock' | 'smug' | 'think';
export type Look = 'center' | 'left' | 'right' | 'up' | 'down';

const INK = '#1C1813';
const SHOE = '#4A3A8F';

type ShapeProps = { fill: string; stroke?: string; strokeWidth?: number; strokeLinejoin?: 'round' };

interface Shape {
  body: (p: ShapeProps) => ReactNode;
  /** Bits drawn behind the body (stems, sprouts). */
  back?: (c: { color: string; dark: string }, outline: boolean) => ReactNode;
  face: [number, number];
}

const SHAPES: Record<CharacterId, Shape> = {
  cherry: {
    body: (p) => <circle cx={60} cy={70} r={44} {...p} />,
    back: (_c, outline) => (
      <g>
        <path d="M60 32 C59 20 64 11 75 6" stroke="#4A2E1F" strokeWidth={6} fill="none" strokeLinecap="round" />
        <path
          d="M72 13 C81 2 98 4 104 11 C96 21 80 21 72 13 Z"
          fill="#47A97F"
          stroke={outline ? INK : 'none'}
          strokeWidth={outline ? 4 : 0}
          strokeLinejoin="round"
        />
      </g>
    ),
    face: [60, 74],
  },
  sunny: {
    body: (p) => <path d="M14 30 Q14 16 26 21 L60 39 L94 21 Q106 16 106 30 L106 100 Q106 113 93 113 L27 113 Q14 113 14 100 Z" {...p} />,
    face: [60, 77],
  },
  splash: {
    body: (p) => <path d="M60 5 C67 22 104 50 104 78 C104 100 85 115 60 115 C35 115 16 100 16 78 C16 50 53 22 60 5 Z" {...p} />,
    face: [60, 83],
  },
  mossy: {
    body: (p) => (
      <g>
        <circle cx={33} cy={58} r={22} {...p} />
        <circle cx={60} cy={45} r={28} {...p} />
        <circle cx={87} cy={58} r={22} {...p} />
        <rect x={11} y={56} width={98} height={58} rx={28} {...p} />
      </g>
    ),
    back: (c) => (
      <g>
        <path d="M61 20 C60 13 62 8 66 4" stroke={c.dark} strokeWidth={5} fill="none" strokeLinecap="round" />
        <path d="M65 8 C71 0 82 1 86 5 C80 12 71 13 65 8 Z" fill={c.dark} />
      </g>
    ),
    face: [60, 82],
  },
  boo: {
    body: (p) => (
      <path
        d="M16 62 C16 34 36 12 60 12 C84 12 104 34 104 62 L104 108 Q97 100 90 108 Q83 116 75 108 Q68 100 60 108 Q52 116 45 108 Q38 100 30 108 Q23 116 16 108 Z"
        {...p}
      />
    ),
    face: [60, 64],
  },
  blaze: {
    body: (p) => (
      <path
        d="M64 4 C72 24 100 42 102 74 C104 100 84 116 60 116 C36 116 16 100 18 76 C19 60 28 50 36 42 C38 52 43 58 49 60 C47 40 54 22 64 4 Z"
        {...p}
      />
    ),
    face: [60, 85],
  },
};

const LOOK: Record<Look, [number, number]> = {
  center: [0, 0],
  left: [-3, 0],
  right: [3, 0],
  up: [0, -3.2],
  down: [0, 2.6],
};

function Eye({ x, y, mood, look, side, lite }: { x: number; y: number; mood: Mood; look: Look; side: -1 | 1; lite: boolean }) {
  if (mood === 'joy') {
    return <path d={`M${x - 8} ${y + 3} Q${x} ${y - 8} ${x + 8} ${y + 3}`} stroke={INK} strokeWidth={4.2} fill="none" strokeLinecap="round" />;
  }
  if (mood === 'smug' && side === 1) {
    return <path d={`M${x - 8} ${y + 1} Q${x} ${y + 5} ${x + 8} ${y + 1}`} stroke={INK} strokeWidth={4.2} fill="none" strokeLinecap="round" />;
  }
  const l = mood === 'sad' ? LOOK.up : mood === 'think' ? ([-2.6, -2.8] as [number, number]) : LOOK[look];
  const pr = mood === 'shock' ? 5 : 7;
  const px = x + l[0];
  const py = y + l[1];
  return (
    <g className="m-eye">
      <ellipse cx={x} cy={y} rx={10} ry={11} fill="#fff" />
      <ellipse cx={px} cy={py + 0.5} rx={pr} ry={pr + 1} fill={INK} />
      {!lite && <circle cx={px + 2.6} cy={py - 2.8} r={2.6} fill="#fff" />}
      {!lite && <circle cx={px - 2.4} cy={py + 3} r={1.2} fill="#fff" />}
    </g>
  );
}

function Brow({ x, y, mood, side }: { x: number; y: number; mood: Mood; side: -1 | 1 }) {
  const s = side; // -1 = left eye, +1 = right eye; "inner" is towards the face centre (-s)
  let d: string;
  switch (mood) {
    case 'sad':
      d = `M${x + 8 * s} ${y - 15} L${x - 6 * s} ${y - 21}`;
      break;
    case 'shock':
      d = `M${x - 7} ${y - 20} Q${x} ${y - 26} ${x + 7} ${y - 20}`;
      break;
    case 'happy':
    case 'joy':
      d = `M${x - 7} ${y - 18} Q${x} ${y - 23} ${x + 7} ${y - 18}`;
      break;
    case 'smug':
    case 'think':
      d = s === 1 ? `M${x - 7} ${y - 20} Q${x} ${y - 25} ${x + 7} ${y - 19}` : `M${x - 7} ${y - 16} L${x + 7} ${y - 16}`;
      break;
    default:
      d = `M${x - 7} ${y - 17} Q${x} ${y - 21} ${x + 7} ${y - 17}`;
  }
  return <path d={d} stroke={INK} strokeWidth={3.4} fill="none" strokeLinecap="round" />;
}

function Mouth({ x, y, mood }: { x: number; y: number; mood: Mood }) {
  switch (mood) {
    case 'happy':
    case 'joy': {
      const w = mood === 'joy' ? 12 : 10;
      const h = mood === 'joy' ? 30 : 26;
      return (
        <g>
          <path d={`M${x - w} ${y + 8} Q${x} ${y + h} ${x + w} ${y + 8} Z`} fill="#2B1A12" stroke="#2B1A12" strokeWidth={2} strokeLinejoin="round" />
          <ellipse cx={x} cy={y + 14.5 + (mood === 'joy' ? 1.5 : 0)} rx={5} ry={2.6} fill="#F2617A" />
        </g>
      );
    }
    case 'sad':
      return <path d={`M${x - 7} ${y + 16} Q${x} ${y + 8} ${x + 7} ${y + 16}`} stroke={INK} strokeWidth={3.4} fill="none" strokeLinecap="round" />;
    case 'shock':
      return (
        <g>
          <ellipse cx={x} cy={y + 14} rx={5.5} ry={7} fill="#2B1A12" />
          <ellipse cx={x} cy={y + 17.5} rx={3.2} ry={2} fill="#F2617A" />
        </g>
      );
    case 'smug':
      return (
        <path d={`M${x - 7} ${y + 12} Q${x + 2} ${y + 17} ${x + 9} ${y + 8}`} stroke={INK} strokeWidth={3.4} fill="none" strokeLinecap="round" />
      );
    case 'think':
      return (
        <path d={`M${x - 5} ${y + 13} Q${x + 1} ${y + 11} ${x + 6} ${y + 13}`} stroke={INK} strokeWidth={3.2} fill="none" strokeLinecap="round" />
      );
    default:
      return <path d={`M${x - 7} ${y + 9} Q${x} ${y + 16} ${x + 7} ${y + 9}`} stroke={INK} strokeWidth={3.4} fill="none" strokeLinecap="round" />;
  }
}

function Blush({ x, y, lite, color }: { x: number; y: number; lite: boolean; color: string }) {
  return (
    <g>
      <ellipse cx={x} cy={y} rx={8} ry={5} fill={color} opacity={0.85} />
      {!lite &&
        [0, 1, 2].map((i) => (
          <line key={i} x1={x - 5 + i * 3.6} y1={y + 2.6} x2={x - 3 + i * 3.6} y2={y - 2.6} stroke="#fff" strokeWidth={1.4} strokeLinecap="round" />
        ))}
    </g>
  );
}

export interface MascotProps {
  id: CharacterId;
  mood?: Mood;
  look?: Look;
  size?: number | string;
  limbs?: boolean;
  outline?: boolean;
  /** Lighter drawing for small sizes (tokens). */
  lite?: boolean;
  /** Zoom into the face for avatars. */
  crop?: 'face';
  blink?: boolean;
  wave?: boolean;
  className?: string;
  style?: CSSProperties;
  title?: string;
}

export function Mascot({
  id,
  mood = 'idle',
  look = 'center',
  size = 96,
  limbs = false,
  outline = false,
  lite = false,
  crop,
  blink = true,
  wave = false,
  className,
  style,
  title,
}: MascotProps) {
  const meta = CHARACTERS[id];
  const shape = SHAPES[id];
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const [fx, fy] = shape.face;
  const blushColor = id === 'cherry' ? '#FFC2CF' : '#FF8FB0';
  const viewBox = crop === 'face' ? `${fx - 47} ${fy - 50} 94 94` : limbs ? '-12 -6 144 146' : outline ? '6 -2 108 124' : '0 0 120 120';
  const outlineProps: ShapeProps = { fill: INK, stroke: INK, strokeWidth: 9, strokeLinejoin: 'round' };

  return (
    <svg
      className={['mascot', blink ? 'mascot--blink' : '', className].filter(Boolean).join(' ')}
      viewBox={viewBox}
      width={size}
      height={size}
      style={style}
      role={title ? 'img' : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
    >
      <defs>
        <clipPath id={`clip-${uid}`}>{shape.body({ fill: '#000' })}</clipPath>
      </defs>

      {limbs && (
        <g className="m-legs">
          {[44, 76].map((x) => (
            <g key={x}>
              <rect x={x - 4} y={104} width={8} height={22} rx={4} fill={meta.dark} />
              <ellipse cx={x + (x < 60 ? -3 : 3)} cy={128} rx={11} ry={6.5} fill={SHOE} />
              <path d={`M${x - 3} ${123} l-4 -4 m4 4 l4 -4`} stroke="#fff" strokeWidth={2} strokeLinecap="round" />
            </g>
          ))}
        </g>
      )}
      {limbs && (
        <g>
          <path d="M18 80 Q4 88 2 104" stroke={meta.dark} strokeWidth={7} fill="none" strokeLinecap="round" />
          <circle cx={2} cy={106} r={6} fill={meta.dark} />
          <g className={wave ? 'm-wave' : undefined} style={{ transformOrigin: '102px 74px' }}>
            <path d="M102 74 Q118 64 120 40" stroke={meta.dark} strokeWidth={7} fill="none" strokeLinecap="round" />
            <g transform="translate(120 30) rotate(14)">
              <rect x={-11} y={-11} width={22} height={22} rx={6} fill="#fff" stroke={INK} strokeWidth={2.5} />
              <circle cx={-4.5} cy={-4.5} r={2.2} fill={INK} />
              <circle cx={0} cy={0} r={2.2} fill={meta.color} />
              <circle cx={4.5} cy={4.5} r={2.2} fill={INK} />
            </g>
          </g>
        </g>
      )}

      {shape.back?.({ color: meta.color, dark: meta.dark }, outline)}
      {outline && shape.body(outlineProps)}
      {shape.body({ fill: meta.color })}

      {!lite && (
        <g clipPath={`url(#clip-${uid})`}>
          <ellipse cx={fx + 48} cy={fy + 4} rx={36} ry={80} fill={meta.dark} opacity={0.22} />
          <ellipse cx={38} cy={fy - 30} rx={12} ry={7} fill="#fff" opacity={0.28} transform={`rotate(-30 38 ${fy - 30})`} />
        </g>
      )}

      <g className="m-face" transform={`translate(${fx} ${fy}) scale(${lite ? 1.22 : 1.14}) translate(${-fx} ${-fy})`}>
        <Blush x={fx - 25} y={fy + 9} lite={lite} color={blushColor} />
        <Blush x={fx + 25} y={fy + 9} lite={lite} color={blushColor} />
        {!lite && <Brow x={fx - 15} y={fy - 4} mood={mood} side={-1} />}
        {!lite && <Brow x={fx + 15} y={fy - 4} mood={mood} side={1} />}
        <g className="m-eyes" style={{ transformOrigin: `${fx}px ${fy - 4}px` }}>
          <Eye x={fx - 15} y={fy - 4} mood={mood} look={look} side={-1} lite={lite} />
          <Eye x={fx + 15} y={fy - 4} mood={mood} look={look} side={1} lite={lite} />
        </g>
        <Mouth x={fx} y={fy} mood={mood} />
        {mood === 'sad' && !lite && <path d={`M${fx - 22} ${fy + 4} q-3 6 0 8 q3 -2 0 -8 Z`} fill="#7CC8F2" stroke="#4BA3D6" strokeWidth={1} />}
      </g>
    </svg>
  );
}
