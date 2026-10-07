import { ArrowLeft, Bot, Dices, RefreshCw, User } from 'lucide-react';
import { useMemo, useState, type CSSProperties } from 'react';
import { BOT_NAMES, CHARACTERS, CHARACTER_ORDER, DICE_MODES, MODES } from '../../shared/characters';
import type { BotLevel, CharacterId, DiceMode, MatchConfig, ModeId, SeatKind } from '../../shared/types';
import { sound } from '../audio/sound';
import { Mascot } from '../components/Mascot';
import { Avatar, Btn, IconBtn, Segmented } from '../components/ui';
import { useApp, type Profile } from '../store/app';

interface SeatDraft {
  id: string;
  name: string;
  character: CharacterId;
  kind: SeatKind;
}

/** Spread humans evenly around the board so pass-and-play friends sit apart. */
function humanSlots(humans: number, total: number): Set<number> {
  const slots = new Set<number>();
  for (let i = 0; i < humans; i++) slots.add(Math.min(total - 1, Math.round((i * total) / humans)));
  // collisions (rare rounding cases): fill the first free positions
  for (let i = 0; slots.size < humans && i < total; i++) slots.add(i);
  return slots;
}

function buildSeats(prev: SeatDraft[], humans: number, bots: number, profile: Profile): SeatDraft[] {
  const total = humans + bots;
  const prevHumans = prev.filter((s) => s.kind === 'human');
  const prevBots = prev.filter((s) => s.kind === 'bot');
  const used = new Set<CharacterId>();
  const take = (want?: CharacterId): CharacterId => {
    const c = want && !used.has(want) ? want : CHARACTER_ORDER.find((x) => !used.has(x))!;
    used.add(c);
    return c;
  };
  const hs: SeatDraft[] = [];
  for (let i = 0; i < humans; i++) {
    const p = prevHumans[i];
    hs.push({
      id: p?.id ?? `human-${i}-${Math.random().toString(36).slice(2, 7)}`,
      name: p?.name ?? (i === 0 ? profile.name : `Player ${i + 1}`),
      character: take(i === 0 ? profile.character : p?.character),
      kind: 'human',
    });
  }
  const names = new Set(hs.map((h) => h.name));
  const bs: SeatDraft[] = [];
  for (let i = 0; i < bots; i++) {
    const p = prevBots[i];
    const name = p?.name ?? BOT_NAMES.find((n) => !names.has(n)) ?? `Bot ${i + 1}`;
    names.add(name);
    bs.push({ id: p?.id ?? `bot-${i}-${Math.random().toString(36).slice(2, 7)}`, name, character: take(p?.character), kind: 'bot' });
  }
  const slots = humanSlots(humans, total);
  const out: SeatDraft[] = [];
  for (let i = 0; i < total; i++) out.push(slots.has(i) ? hs.shift()! : bs.shift()!);
  return out;
}

export function Setup() {
  const go = useApp((s) => s.go);
  const profile = useApp((s) => s.profile);
  const settings = useApp((s) => s.settings);
  const startLocal = useApp((s) => s.startLocal);
  const [mode, setMode] = useState<ModeId>(() => (sessionStorage.getItem('ludo-pals:mode') as ModeId) || 'classic');
  const [humans, setHumans] = useState(1);
  const [bots, setBots] = useState(3);
  const [level, setLevel] = useState<BotLevel>('normal');
  const [timer, setTimer] = useState(0);
  const [dice, setDice] = useState<DiceMode>('fair');
  const [seats, setSeats] = useState<SeatDraft[]>(() => buildSeats([], 1, 3, profile));

  const total = humans + bots;
  const maxBots = 6 - humans;
  const minBots = humans === 1 ? 1 : 0;

  const changeHumans = (h: number) => {
    // Fewer than 4 players? Fill the table up to 4 with bots.
    const b = Math.max(h === 1 ? 1 : 0, Math.min(6 - h, Math.max(0, 4 - h)));
    setHumans(h);
    setBots(b);
    setSeats((prev) => buildSeats(prev, h, b, profile));
  };
  const changeBots = (b: number) => {
    setBots(b);
    setSeats((prev) => buildSeats(prev, humans, b, profile));
  };

  const cycle = (i: number) => {
    sound.play('pop');
    setSeats((prev) => {
      const used = new Set(prev.filter((_, j) => j !== i).map((s) => s.character));
      const cur = CHARACTER_ORDER.indexOf(prev[i].character);
      for (let k = 1; k <= 6; k++) {
        const c = CHARACTER_ORDER[(cur + k) % 6];
        if (!used.has(c)) return prev.map((s, j) => (j === i ? { ...s, character: c } : s));
      }
      return prev;
    });
  };

  const rename = (i: number, name: string) => setSeats((prev) => prev.map((s, j) => (j === i ? { ...s, name } : s)));

  const boardLabel = total <= 4 ? 'Classic board' : 'Party hex board';
  const preview = useMemo(() => seats.map((s) => s.character), [seats]);

  const start = () => {
    sound.unlock();
    const cfg: MatchConfig = {
      seats: seats.map((s, i) => ({
        id: s.id,
        name: s.name.trim() || (s.kind === 'bot' ? 'Bot' : `Player ${i + 1}`),
        character: s.character,
        kind: s.kind,
        botLevel: level,
      })),
      rules: { ...MODES[mode].rules, autoMove: settings.autoMove, turnSeconds: timer, dice },
      speed: settings.speed === 'fast' ? 0.6 : 1,
    };
    startLocal(cfg);
  };

  let humanNo = 0;

  return (
    <div className="screen setup">
      <header className="screen-head">
        <IconBtn icon={<ArrowLeft size={20} />} label="Back" onClick={() => go('hub')} />
        <h1 className="title-md">New Game</h1>
        <span className="head-spacer" />
      </header>

      <div className="setup-hero">
        {preview.map((c, i) => (
          <div key={`${c}-${i}`} className="setup-hero-pal" style={{ '--i': i } as CSSProperties}>
            <Mascot id={c} size="100%" mood={seats[i]?.kind === 'bot' ? 'smug' : 'happy'} />
          </div>
        ))}
      </div>

      <section className="card">
        <h2 className="card-title">Who&apos;s playing?</h2>
        <div className="field">
          <span className="field-label">
            <User size={15} /> Humans on this device
          </span>
          <Segmented value={humans} onChange={changeHumans} options={[1, 2, 3, 4, 5, 6].map((n) => ({ value: n, label: n }))} />
        </div>
        <div className="field">
          <span className="field-label">
            <Bot size={15} /> Bots
          </span>
          <Segmented
            value={bots}
            onChange={changeBots}
            options={Array.from({ length: maxBots - minBots + 1 }, (_, i) => ({ value: i + minBots, label: i + minBots }))}
          />
        </div>
        <p className="hint">
          <Dices size={15} /> {total} players · {boardLabel}
          {humans < 4 && bots > 0 && ' · bots fill the empty seats'}
        </p>
      </section>

      <section className="seat-list">
        {seats.map((s, i) => {
          const meta = CHARACTERS[s.character];
          const tag = s.kind === 'bot' ? 'BOT' : humanNo++ === 0 ? 'YOU' : `P${humanNo}`;
          return (
            <div key={s.id} className="seat-card" style={{ '--c': meta.color, '--cl': meta.light } as CSSProperties}>
              <button type="button" className="seat-avatar" onClick={() => cycle(i)} aria-label={`Change character (now ${meta.name})`}>
                <Avatar id={s.character} size={48} />
                <span className="seat-swap">
                  <RefreshCw size={11} />
                </span>
              </button>
              <div className="seat-main">
                <input className="seat-name" value={s.name} maxLength={16} onChange={(e) => rename(i, e.target.value)} aria-label="Player name" />
                <span className="seat-pal">
                  {meta.name} · {meta.tagline}
                </span>
              </div>
              <span className={`tag ${s.kind === 'bot' ? 'tag--bot' : ''}`}>
                {s.kind === 'bot' ? <Bot size={12} /> : null}
                {tag}
              </span>
            </div>
          );
        })}
      </section>

      <section className="card">
        <h2 className="card-title">Rules</h2>
        <div className="field">
          <span className="field-label">Mode</span>
          <Segmented
            value={mode}
            onChange={setMode}
            options={[
              { value: 'classic', label: 'Classic' },
              { value: 'quick', label: 'Quick' },
            ]}
          />
          <span className="hint">{MODES[mode].blurb}</span>
        </div>
        {bots > 0 && (
          <div className="field">
            <span className="field-label">Bot skill</span>
            <Segmented
              value={level}
              onChange={setLevel}
              options={[
                { value: 'easy', label: 'Chill' },
                { value: 'normal', label: 'Normal' },
                { value: 'hard', label: 'Savage' },
              ]}
            />
          </div>
        )}
        <div className="field">
          <span className="field-label">Dice</span>
          <Segmented
            value={dice}
            onChange={setDice}
            options={(['fair', 'classic'] as const).map((d) => ({ value: d, label: DICE_MODES[d].label }))}
          />
          <span className="hint">{DICE_MODES[dice].blurb}</span>
        </div>
        <div className="field">
          <span className="field-label">Turn timer</span>
          <Segmented
            value={timer}
            onChange={setTimer}
            options={[
              { value: 0, label: 'Off' },
              { value: 15, label: '15s' },
              { value: 30, label: '30s' },
            ]}
          />
        </div>
      </section>

      <div className="sticky-cta">
        <Btn variant="black" size="lg" full iconRight={<Dices size={20} />} onClick={start} silent>
          Let&apos;s Roll!
        </Btn>
      </div>
    </div>
  );
}
