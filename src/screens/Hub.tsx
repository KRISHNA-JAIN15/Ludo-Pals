import { BarChart3, Check, Gamepad2, Globe, HelpCircle, Settings as SettingsIcon, Smile, Trash2, Trophy } from 'lucide-react';
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { CHARACTERS, CHARACTER_ORDER } from '../../shared/characters';
import type { CharacterId, ModeId } from '../../shared/types';
import { sound } from '../audio/sound';
import { Mascot } from '../components/Mascot';
import { Avatar, Btn, Coin, IconBtn, Segmented, Sheet, Toggle, Topo } from '../components/ui';
import { useApp, type HubTab } from '../store/app';

export function Hub() {
  const tab = useApp((s) => s.tab);
  const setTab = useApp((s) => s.setTab);
  const profile = useApp((s) => s.profile);
  const [help, setHelp] = useState(false);

  useEffect(() => sound.wantMusic(true), []);

  return (
    <div className="screen hub">
      <header className="hub-head">
        <button type="button" className="profile-chip" onClick={() => setTab('settings')}>
          <Avatar id={profile.character} size={40} />
          <span>{profile.name}</span>
        </button>
        <div className="coins-pill" title="Coins — earn more by winning">
          <span>{profile.coins.toLocaleString()}</span>
          <Coin size={26} />
        </div>
      </header>

      <div className="hub-body" key={tab}>
        {tab === 'play' && <PlayTab onHelp={() => setHelp(true)} />}
        {tab === 'pals' && <PalsTab />}
        {tab === 'stats' && <StatsTab />}
        {tab === 'settings' && <SettingsTab onHelp={() => setHelp(true)} />}
      </div>

      <nav className="bottom-nav" aria-label="Main">
        <NavItem tab="play" current={tab} onClick={setTab} icon={<Gamepad2 size={20} />} label="Play" />
        <NavItem tab="pals" current={tab} onClick={setTab} icon={<Smile size={20} />} label="Pals" />
        <NavItem tab="stats" current={tab} onClick={setTab} icon={<Trophy size={20} />} label="Trophies" />
        <NavItem tab="settings" current={tab} onClick={setTab} icon={<SettingsIcon size={20} />} label="Settings" />
      </nav>

      <HowToPlay open={help} onClose={() => setHelp(false)} />
    </div>
  );
}

function NavItem({
  tab,
  current,
  onClick,
  icon,
  label,
}: {
  tab: HubTab;
  current: HubTab;
  onClick: (t: HubTab) => void;
  icon: ReactNode;
  label: string;
}) {
  const on = tab === current;
  return (
    <button
      type="button"
      className={on ? 'nav-item is-on' : 'nav-item'}
      onClick={() => {
        if (!on) sound.play('pop');
        onClick(tab);
      }}
      aria-current={on ? 'page' : undefined}
      aria-label={label}
    >
      {icon}
      {on && <span>{label}</span>}
    </button>
  );
}

// ---------------------------------------------------------------------------

interface ModeCard {
  key: string;
  title: [string, string];
  sub: string;
  color: string;
  pal: CharacterId;
  cta: string;
  mode?: ModeId;
  online?: boolean;
  badge?: string;
}

const CARDS: ModeCard[] = [
  { key: 'classic', title: ['Classic', 'Ludo'], sub: '2–6 players · bots', color: '#EDA04C', pal: 'cherry', cta: 'Play Game', mode: 'classic' },
  {
    key: 'online',
    title: ['Online', 'Party'],
    sub: 'Rooms · voice chat',
    color: '#F6C443',
    pal: 'splash',
    cta: 'Play Online',
    online: true,
    badge: 'LIVE',
  },
  { key: 'quick', title: ['Quick', 'Ludo'], sub: '2 tokens · 10 min games', color: '#7DC3EE', pal: 'boo', cta: 'Play Game', mode: 'quick' },
];

function PlayTab({ onHelp }: { onHelp: () => void }) {
  const go = useApp((s) => s.go);
  const [active, setActive] = useState(0);
  const track = useRef<HTMLDivElement>(null);

  const onScroll = () => {
    const el = track.current;
    if (!el) return;
    const card = el.firstElementChild as HTMLElement | null;
    if (!card) return;
    const i = Math.round(el.scrollLeft / (card.offsetWidth + 16));
    if (i !== active) setActive(Math.max(0, Math.min(CARDS.length - 1, i)));
  };

  const scrollTo = (i: number) => {
    const el = track.current;
    const card = el?.children[i] as HTMLElement | undefined;
    if (el && card) el.scrollTo({ left: card.offsetLeft - el.offsetLeft - 4, behavior: 'smooth' });
  };

  const open = (c: ModeCard) => {
    if (c.online) go('online');
    else {
      sessionStorage.setItem('ludo-pals:mode', c.mode ?? 'classic');
      go('setup');
    }
  };

  return (
    <div className="play-tab">
      <div className="title-row">
        <h1 className="title-xl">
          Pick Game
          <br />
          To Play
        </h1>
        <div className="title-side">
          <IconBtn icon={<HelpCircle size={20} />} label="How to play" onClick={onHelp} />
          <IconBtn icon={<Globe size={20} />} label="Play online" onClick={() => go('online')} />
        </div>
      </div>

      <div className="carousel" ref={track} onScroll={onScroll}>
        {CARDS.map((c, i) => (
          <article
            key={c.key}
            className={`mode-card ${i === active ? 'is-active' : ''}`}
            style={{ '--card': c.color } as CSSProperties}
            onClick={() => (i === active ? undefined : scrollTo(i))}
          >
            <Topo className="topo--light" />
            {c.badge && <span className="mode-badge">{c.badge}</span>}
            <h2 className="bubble-title">
              <span>{c.title[0]}</span>
              <span>{c.title[1]}</span>
            </h2>
            <p className="mode-sub">
              <i className="live-dot" />
              {c.sub}
            </p>
            <div className="mode-art">
              <span className="sparkle" style={{ left: '6%', top: '12%' }}>
                ✦
              </span>
              <span className="sparkle sparkle--sm" style={{ left: '84%', top: '4%', animationDelay: '.7s' }}>
                ✦
              </span>
              <Mascot id={c.pal} limbs mood={i === active ? 'happy' : 'idle'} size="100%" wave={i === active} />
            </div>
            <Btn variant="black" size="lg" className="mode-cta" iconRight={<Gamepad2 size={18} />} onClick={() => open(c)}>
              {c.cta}
            </Btn>
          </article>
        ))}
      </div>
      <div className="dots" role="tablist">
        {CARDS.map((c, i) => (
          <button
            key={c.key}
            type="button"
            className={i === active ? 'dot is-on' : 'dot'}
            onClick={() => scrollTo(i)}
            aria-label={`${c.title.join(' ')}`}
          />
        ))}
      </div>
    </div>
  );
}

function PalsTab() {
  const profile = useApp((s) => s.profile);
  const updateProfile = useApp((s) => s.updateProfile);
  return (
    <div className="pals-tab">
      <h1 className="title-lg">Meet the Pals</h1>
      <p className="muted">Pick your favourite — it becomes your avatar and your token colour.</p>
      <div className="pals-grid">
        {CHARACTER_ORDER.map((id) => {
          const c = CHARACTERS[id];
          const mine = profile.character === id;
          return (
            <article
              key={id}
              className={`pal-card ${mine ? 'is-mine' : ''}`}
              style={{ '--c': c.color, '--cl': c.light, '--cd': c.dark } as CSSProperties}
            >
              <div className="pal-art">
                <Topo className="topo--light" />
                <Mascot id={id} limbs mood={mine ? 'joy' : 'happy'} size="100%" wave={mine} />
              </div>
              <div className="pal-info">
                <h3>{c.name}</h3>
                <p className="pal-tag">{c.tagline}</p>
                <p className="pal-bio">{c.bio}</p>
                <p className="pal-quote">“{c.catchphrase}”</p>
                {mine ? (
                  <span className="pal-picked">
                    <Check size={16} /> Your pal
                  </span>
                ) : (
                  <Btn size="sm" variant="white" onClick={() => updateProfile({ character: id })}>
                    Pick {c.name}
                  </Btn>
                )}
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}

function StatsTab() {
  const p = useApp((s) => s.profile);
  const rate = p.games ? Math.round((p.wins / p.games) * 100) : 0;
  const trophies = [
    { icon: '🏆', name: 'First Win', got: p.wins >= 1, hint: 'Win a game' },
    { icon: '🥇', name: 'Champion', got: p.wins >= 10, hint: 'Win 10 games' },
    { icon: '💥', name: 'Bonk Master', got: p.captures >= 25, hint: 'Capture 25 tokens' },
    { icon: '🍀', name: 'Lucky Sixes', got: p.sixes >= 50, hint: 'Roll 50 sixes' },
    { icon: '🏠', name: 'Homebody', got: p.homeRuns >= 40, hint: 'Bring 40 pals home' },
    { icon: '🎖️', name: 'Podium Regular', got: p.podiums >= 15, hint: 'Finish top 3 fifteen times' },
  ];
  return (
    <div className="stats-tab">
      <h1 className="title-lg">Your Trophies</h1>
      <div className="stat-grid">
        <Stat big label="Wins" value={p.wins} tone="yellow" />
        <Stat big label="Win rate" value={`${rate}%`} tone="teal" />
        <Stat label="Games" value={p.games} />
        <Stat label="Captures" value={p.captures} />
        <Stat label="Sixes" value={p.sixes} />
        <Stat label="Pals home" value={p.homeRuns} />
      </div>
      <h2 className="section-title">Trophy shelf</h2>
      <div className="trophy-grid">
        {trophies.map((t) => (
          <div key={t.name} className={`trophy ${t.got ? 'is-got' : ''}`}>
            <span className="trophy-icon">{t.icon}</span>
            <b>{t.name}</b>
            <span>{t.got ? 'Unlocked!' : t.hint}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function Stat({ label, value, big, tone }: { label: string; value: ReactNode; big?: boolean; tone?: 'yellow' | 'teal' }) {
  return (
    <div className={`stat ${big ? 'stat--big' : ''} ${tone ? `stat--${tone}` : ''}`}>
      <span className="stat-value">{value}</span>
      <span className="stat-label">{label}</span>
    </div>
  );
}

function SettingsTab({ onHelp }: { onHelp: () => void }) {
  const profile = useApp((s) => s.profile);
  const settings = useApp((s) => s.settings);
  const updateProfile = useApp((s) => s.updateProfile);
  const updateSettings = useApp((s) => s.updateSettings);
  const toast = useApp((s) => s.toast);
  const [name, setName] = useState(profile.name);
  const [confirm, setConfirm] = useState(false);

  return (
    <div className="settings-tab">
      <h1 className="title-lg">Settings</h1>
      <section className="card">
        <label className="field">
          <span className="field-label">Your name</span>
          <input
            className="input"
            value={name}
            maxLength={16}
            onChange={(e) => setName(e.target.value)}
            onBlur={() => {
              const n = name.trim() || profile.name;
              setName(n);
              updateProfile({ name: n });
            }}
          />
        </label>
        <div className="field">
          <span className="field-label">Your pal</span>
          <div className="pal-picker">
            {CHARACTER_ORDER.map((id) => (
              <button
                key={id}
                type="button"
                className={profile.character === id ? 'pal-pick is-on' : 'pal-pick'}
                onClick={() => {
                  sound.play('pop');
                  updateProfile({ character: id });
                }}
                aria-label={CHARACTERS[id].name}
              >
                <Avatar id={id} size={46} />
              </button>
            ))}
          </div>
        </div>
      </section>

      <section className="card">
        <Toggle checked={settings.sound} onChange={(v) => updateSettings({ sound: v })} label="Sound effects" hint="Dice, hops, bonks and fanfares" />
        <Toggle checked={settings.music} onChange={(v) => updateSettings({ music: v })} label="Music" hint="A chill little loop" />
        <Toggle
          checked={settings.vibration}
          onChange={(v) => updateSettings({ vibration: v })}
          label="Vibration"
          hint="Haptic taps on supported phones"
        />
        <Toggle
          checked={settings.autoMove}
          onChange={(v) => updateSettings({ autoMove: v })}
          label="Auto-move"
          hint="Move automatically when there is only one choice"
        />
        <div className="field field--row">
          <span className="field-label">Game speed</span>
          <Segmented
            size="sm"
            value={settings.speed}
            onChange={(v) => updateSettings({ speed: v })}
            options={[
              { value: 'normal', label: 'Normal' },
              { value: 'fast', label: 'Fast' },
            ]}
          />
        </div>
      </section>

      <section className="card card--flat stack">
        <Btn variant="white" full icon={<HelpCircle size={18} />} onClick={onHelp}>
          How to play
        </Btn>
        <Btn variant="ghost" full icon={<Trash2 size={18} />} onClick={() => setConfirm(true)}>
          Reset stats &amp; coins
        </Btn>
      </section>
      <p className="muted center small">Ludo Pals · made with 🎲 and a lot of bonks</p>

      <Sheet open={confirm} onClose={() => setConfirm(false)} title="Reset everything?">
        <p className="muted">Your wins, trophies and coins go back to zero. Your name and pal stay.</p>
        <div className="row-btns">
          <Btn variant="white" onClick={() => setConfirm(false)}>
            Cancel
          </Btn>
          <Btn
            variant="danger"
            onClick={() => {
              updateProfile({ coins: 250, games: 0, wins: 0, podiums: 0, captures: 0, sixes: 0, homeRuns: 0 });
              setConfirm(false);
              toast('Stats reset', 'success');
            }}
          >
            Reset
          </Btn>
        </div>
      </Sheet>
    </div>
  );
}

export function HowToPlay({ open, onClose }: { open: boolean; onClose: () => void }) {
  const rules: [string, string, string][] = [
    ['🎲', 'Roll a 6 to start', 'Tokens wait in their yard until you roll a 6 (Quick mode: a 1 or a 6).'],
    ['🏃', 'Race clockwise', 'Move around the board and up your coloured lane to the centre.'],
    ['💥', 'Bonk!', 'Land on an opponent to send them back to their yard — and earn a bonus roll.'],
    ['⭐', 'Safe squares', 'Starred squares and start squares are safe. Nobody can bonk you there.'],
    ['🔁', 'Bonus rolls', 'Rolling a 6, bonking someone or reaching home gives you another roll.'],
    ['🔥', 'Three sixes', 'Roll three 6s in a row and your turn is burned. Greedy!'],
    ['🎯', 'Exact finish', 'You need the exact number to land in the centre.'],
    ['🏆', 'Win', 'First to get all their pals home wins. The race continues for the podium!'],
  ];
  return (
    <Sheet open={open} onClose={onClose} title="How to play">
      <div className="rules">
        {rules.map(([icon, title, text]) => (
          <div key={title} className="rule">
            <span className="rule-icon">{icon}</span>
            <div>
              <b>{title}</b>
              <p>{text}</p>
            </div>
          </div>
        ))}
      </div>
      <p className="muted small">
        <BarChart3 size={14} style={{ verticalAlign: '-2px' }} /> Tip: on a computer press <kbd>Space</kbd> to roll and <kbd>1</kbd>–<kbd>4</kbd> to
        pick a token.
      </p>
    </Sheet>
  );
}
