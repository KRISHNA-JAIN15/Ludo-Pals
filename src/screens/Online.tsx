import { ArrowLeft, LogIn, Plus, Wifi, WifiOff } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { CHARACTERS, CHARACTER_ORDER } from '../../shared/characters';
import { ROOM_CODE_LENGTH } from '../../shared/protocol';
import type { ModeId } from '../../shared/types';
import { sound } from '../audio/sound';
import { Mascot } from '../components/Mascot';
import { Avatar, Btn, IconBtn, Segmented, Topo } from '../components/ui';
import { useOnline } from '../net/online';
import { useApp } from '../store/app';

function urlRoom(): string {
  try {
    return (new URLSearchParams(location.search).get('room') ?? '').toUpperCase().slice(0, ROOM_CODE_LENGTH);
  } catch {
    return '';
  }
}

export function Online() {
  const go = useApp((s) => s.go);
  const profile = useApp((s) => s.profile);
  const updateProfile = useApp((s) => s.updateProfile);
  const status = useOnline((s) => s.status);
  const { connect, create, join } = useOnline.getState();
  const [maxPlayers, setMax] = useState(4);
  const [mode, setMode] = useState<ModeId>('classic');
  const [timer, setTimer] = useState(20);
  const [code, setCode] = useState(urlRoom);
  const [name, setName] = useState(profile.name);
  const [busy, setBusy] = useState<'create' | 'join' | null>(null);
  const autoJoined = useRef(false);

  useEffect(() => {
    connect();
  }, [connect]);

  const saveName = () => {
    const n = name.trim() || profile.name;
    setName(n);
    if (n !== profile.name) updateProfile({ name: n });
  };

  const doJoin = async (c = code) => {
    if (c.length !== ROOM_CODE_LENGTH || busy) return;
    saveName();
    sound.unlock();
    setBusy('join');
    const ok = await join(c);
    setBusy(null);
    if (ok) history.replaceState(null, '', location.pathname);
  };

  // Invite links (?room=CODE) join automatically once connected.
  useEffect(() => {
    if (autoJoined.current || status !== 'online') return;
    const c = urlRoom();
    if (c.length === ROOM_CODE_LENGTH) {
      autoJoined.current = true;
      void doJoin(c);
    }
  });

  const doCreate = async () => {
    if (busy) return;
    saveName();
    sound.unlock();
    setBusy('create');
    await create({ maxPlayers, mode, turnSeconds: timer });
    setBusy(null);
  };

  const cycle = () => {
    const i = CHARACTER_ORDER.indexOf(profile.character);
    updateProfile({ character: CHARACTER_ORDER[(i + 1) % CHARACTER_ORDER.length] });
    sound.play('pop');
  };

  return (
    <div className="screen online">
      <header className="screen-head">
        <IconBtn icon={<ArrowLeft size={20} />} label="Back" onClick={() => go('hub')} />
        <h1 className="title-md">Online Party</h1>
        <span className={`net-pill net-pill--${status}`}>
          {status === 'online' ? <Wifi size={14} /> : <WifiOff size={14} />}
          {status === 'online'
            ? 'Online'
            : status === 'connecting' || status === 'idle'
              ? 'Connecting…'
              : status === 'unconfigured'
                ? 'Not set up'
                : 'Offline'}
        </span>
      </header>

      <div className="online-hero">
        <Topo className="topo--light" />
        <div className="online-hero-pals">
          {(['splash', 'cherry', 'boo'] as const).map((id, i) => (
            <Mascot key={id} id={id} limbs size="100%" mood={i === 1 ? 'joy' : 'happy'} wave={i === 1} />
          ))}
        </div>
        <p>
          Play with up to <b>6 friends</b> anywhere.
          <br />
          Voice chat included 🎙️
        </p>
      </div>

      <section className="card you-card">
        <button type="button" className="seat-avatar" onClick={cycle} aria-label="Change your pal">
          <Avatar id={profile.character} size={56} />
        </button>
        <div className="seat-main">
          <span className="field-label">Playing as</span>
          <input
            className="seat-name"
            value={name}
            maxLength={16}
            onChange={(e) => setName(e.target.value)}
            onBlur={saveName}
            aria-label="Your name"
          />
          <span className="seat-pal">{CHARACTERS[profile.character].name} · tap the avatar to switch</span>
        </div>
      </section>

      <section className="card">
        <h2 className="card-title">Join a room</h2>
        <form
          className="join-row"
          onSubmit={(e) => {
            e.preventDefault();
            void doJoin();
          }}
        >
          <input
            className="code-input"
            value={code}
            onChange={(e) =>
              setCode(
                e.target.value
                  .toUpperCase()
                  .replace(/[^A-Z0-9]/g, '')
                  .slice(0, ROOM_CODE_LENGTH),
              )
            }
            placeholder="CODE"
            inputMode="text"
            autoCapitalize="characters"
            autoComplete="off"
            spellCheck={false}
            aria-label="Room code"
          />
          <Btn type="submit" variant="black" icon={<LogIn size={18} />} disabled={code.length !== ROOM_CODE_LENGTH || status !== 'online' || !!busy}>
            {busy === 'join' ? 'Joining…' : 'Join'}
          </Btn>
        </form>
      </section>

      <section className="card">
        <h2 className="card-title">Create a room</h2>
        <div className="field">
          <span className="field-label">Players</span>
          <Segmented value={maxPlayers} onChange={setMax} options={[2, 3, 4, 5, 6].map((n) => ({ value: n, label: n }))} />
        </div>
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
        </div>
        <div className="field">
          <span className="field-label">Turn timer</span>
          <Segmented value={timer} onChange={setTimer} options={[10, 15, 20, 30].map((n) => ({ value: n, label: `${n}s` }))} />
        </div>
        <Btn variant="teal" size="lg" full icon={<Plus size={20} />} onClick={doCreate} disabled={status !== 'online' || !!busy}>
          {busy === 'create' ? 'Creating…' : 'Create Room'}
        </Btn>
        <p className="hint center">Empty seats? Add bots in the lobby.</p>
      </section>

      {status === 'offline' && <p className="muted center small">Can&apos;t reach the game server right now. Check your internet connection.</p>}
      {status === 'unconfigured' && (
        <p className="muted center small">
          Online play isn&apos;t configured for this build. Run <code>npx convex dev</code> (it sets <code>VITE_CONVEX_URL</code>) and restart the
          app.
        </p>
      )}
    </div>
  );
}
