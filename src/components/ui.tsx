import { Mic, MicOff, X } from 'lucide-react';
import { useEffect, type CSSProperties, type ReactNode } from 'react';
import { CHARACTERS } from '../../shared/characters';
import type { CharacterId } from '../../shared/types';
import { sound } from '../audio/sound';
import type { LinkState } from '../net/voice';
import { Mascot, type Mood } from './Mascot';

type BtnVariant = 'black' | 'teal' | 'white' | 'ghost' | 'yellow' | 'danger';

export function Btn({
  children,
  variant = 'black',
  size = 'md',
  icon,
  iconRight,
  full,
  disabled,
  onClick,
  className,
  type = 'button',
  silent,
  style,
}: {
  children?: ReactNode;
  variant?: BtnVariant;
  size?: 'sm' | 'md' | 'lg';
  icon?: ReactNode;
  iconRight?: ReactNode;
  full?: boolean;
  disabled?: boolean;
  onClick?: () => void;
  className?: string;
  type?: 'button' | 'submit';
  silent?: boolean;
  style?: CSSProperties;
}) {
  return (
    <button
      type={type}
      className={['btn', `btn--${variant}`, `btn--${size}`, full ? 'btn--full' : '', className].filter(Boolean).join(' ')}
      disabled={disabled}
      style={style}
      onClick={() => {
        if (!silent) sound.play('click');
        onClick?.();
      }}
    >
      {icon && <span className="btn-icon">{icon}</span>}
      {children && <span className="btn-label">{children}</span>}
      {iconRight && <span className="btn-icon">{iconRight}</span>}
    </button>
  );
}

export function IconBtn({
  icon,
  label,
  onClick,
  active,
  badge,
  variant = 'white',
  className,
  size = 'md',
}: {
  icon: ReactNode;
  label: string;
  onClick?: () => void;
  active?: boolean;
  badge?: number | string | null;
  variant?: 'white' | 'black' | 'clear' | 'teal';
  className?: string;
  size?: 'sm' | 'md' | 'lg';
}) {
  return (
    <button
      type="button"
      className={['icon-btn', `icon-btn--${variant}`, `icon-btn--${size}`, active ? 'is-active' : '', className].filter(Boolean).join(' ')}
      onClick={() => {
        sound.play('click');
        onClick?.();
      }}
      aria-label={label}
      title={label}
    >
      {icon}
      {badge ? <span className="badge">{badge}</span> : null}
    </button>
  );
}

export function Segmented<T extends string | number>({
  options,
  value,
  onChange,
  disabled,
  size = 'md',
}: {
  options: { value: T; label: ReactNode; hint?: string }[];
  value: T;
  onChange: (v: T) => void;
  disabled?: boolean;
  size?: 'sm' | 'md';
}) {
  return (
    <div className={`seg seg--${size} ${disabled ? 'seg--disabled' : ''}`} role="radiogroup">
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          className={o.value === value ? 'seg-item is-on' : 'seg-item'}
          disabled={disabled}
          title={o.hint}
          onClick={() => {
            if (o.value === value) return;
            sound.play('pop');
            onChange(o.value);
          }}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Toggle({ checked, onChange, label, hint }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode; hint?: ReactNode }) {
  return (
    <label className="toggle-row">
      <span className="toggle-text">
        <span className="toggle-label">{label}</span>
        {hint && <span className="toggle-hint">{hint}</span>}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        className={checked ? 'toggle is-on' : 'toggle'}
        onClick={() => {
          sound.play('pop');
          onChange(!checked);
        }}
      >
        <span className="toggle-knob" />
      </button>
    </label>
  );
}

export function Sheet({
  open,
  onClose,
  title,
  children,
  wide,
  className,
}: {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  children: ReactNode;
  wide?: boolean;
  className?: string;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="sheet-wrap" role="dialog" aria-modal="true">
      <div className="sheet-backdrop" onClick={onClose} />
      <div className={['sheet', wide ? 'sheet--wide' : '', className].filter(Boolean).join(' ')}>
        <div className="sheet-grip" />
        {title && (
          <div className="sheet-head">
            <h2>{title}</h2>
            <IconBtn icon={<X size={18} />} label="Close" onClick={onClose} size="sm" />
          </div>
        )}
        <div className="sheet-body">{children}</div>
      </div>
    </div>
  );
}

export function Avatar({
  id,
  size = 44,
  mood,
  ring,
  className,
  style,
}: {
  id: CharacterId;
  size?: number;
  mood?: Mood;
  ring?: boolean;
  className?: string;
  style?: CSSProperties;
}) {
  const meta = CHARACTERS[id];
  return (
    <span
      className={['avatar', ring ? 'avatar--ring' : '', className].filter(Boolean).join(' ')}
      style={{ width: size, height: size, background: meta.light, '--c': meta.color, ...style } as CSSProperties}
    >
      <Mascot id={id} crop="face" size="100%" mood={mood} />
    </span>
  );
}

export function Coin({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden className="coin">
      <circle cx="12" cy="12" r="11" fill="#F0A92E" />
      <circle cx="12" cy="12" r="8.6" fill="#F7C64B" stroke="#E39A1E" strokeWidth="1.2" />
      <path
        d="M12 7.2v9.6M14.6 9.2c-.4-.9-1.4-1.4-2.6-1.4-1.6 0-2.6.8-2.6 1.9 0 2.6 5.4 1.4 5.4 4.2 0 1.2-1.1 2-2.8 2-1.3 0-2.4-.6-2.8-1.6"
        stroke="#B66D0A"
        strokeWidth="1.5"
        fill="none"
        strokeLinecap="round"
      />
      <ellipse cx="8.6" cy="7.6" rx="2.2" ry="1.2" fill="#fff" opacity=".55" transform="rotate(-35 8.6 7.6)" />
    </svg>
  );
}

export function DiceGlyph({ size = 20, pips = 5, color = 'currentColor' }: { size?: number; pips?: number; color?: string }) {
  const P: Record<number, [number, number][]> = {
    1: [[12, 12]],
    2: [
      [8, 8],
      [16, 16],
    ],
    3: [
      [7.5, 7.5],
      [12, 12],
      [16.5, 16.5],
    ],
    4: [
      [8, 8],
      [16, 8],
      [8, 16],
      [16, 16],
    ],
    5: [
      [7.5, 7.5],
      [16.5, 7.5],
      [12, 12],
      [7.5, 16.5],
      [16.5, 16.5],
    ],
    6: [
      [8, 7],
      [16, 7],
      [8, 12],
      [16, 12],
      [8, 17],
      [16, 17],
    ],
  };
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden>
      <rect x="2.5" y="2.5" width="19" height="19" rx="5" fill="none" stroke={color} strokeWidth="2.2" />
      {P[pips].map(([x, y], i) => (
        <circle key={i} cx={x} cy={y} r="1.9" fill={color} />
      ))}
    </svg>
  );
}

export function Topo({ className }: { className?: string }) {
  return <span className={['topo', className].filter(Boolean).join(' ')} aria-hidden />;
}

/** A player's voice status: in voice, muted, and (for others) whether our audio link to them works. */
export function VoiceMic({ muted, link, size }: { muted: boolean; link?: LinkState; size: number }) {
  if (link === 'failed') {
    return (
      <span
        className="chip-mic is-broken"
        title="No audio connection yet. Their network may be blocking it; still retrying."
        role="img"
        aria-label="No audio connection"
      >
        <MicOff size={size} />
      </span>
    );
  }
  const cls = `chip-mic ${muted ? 'is-muted' : ''} ${link === 'connecting' ? 'is-linking' : ''}`;
  return (
    <span
      className={cls}
      title={link === 'connecting' ? 'Connecting audio…' : muted ? 'Muted' : 'In voice'}
      role="img"
      aria-label={muted ? 'Muted' : 'In voice'}
    >
      {muted ? <MicOff size={size} /> : <Mic size={size} />}
    </span>
  );
}
