import { Bot, Check, Copy, Crown, Headphones, HeadphoneOff, Mic, MicOff, Phone, PhoneOff, Plus, Share2, UserX, WifiOff, X } from 'lucide-react';
import { useEffect, type CSSProperties } from 'react';
import { CHARACTERS, CHARACTER_ORDER, DICE_MODES, MODES } from '../../shared/characters';
import type { RoomSeat } from '../../shared/protocol';
import { sound } from '../audio/sound';
import { ChatPanel } from '../components/ChatPanel';
import { Mascot } from '../components/Mascot';
import { Avatar, Btn, IconBtn, Segmented } from '../components/ui';
import { useOnline } from '../net/online';
import { useApp } from '../store/app';

export function Lobby() {
  const room = useOnline((s) => s.room);
  const myId = useOnline((s) => s.myId);
  const voiceOn = useOnline((s) => s.voiceOn);
  const voiceBusy = useOnline((s) => s.voiceBusy);
  const muted = useOnline((s) => s.muted);
  const deafened = useOnline((s) => s.deafened);
  const speaking = useOnline((s) => s.speaking);
  const status = useOnline((s) => s.status);
  const o = useOnline.getState();
  const go = useApp((s) => s.go);
  const toast = useApp((s) => s.toast);
  const updateProfile = useApp((s) => s.updateProfile);

  useEffect(() => sound.wantMusic(true), []);

  if (!room) {
    return (
      <div className="screen lobby">
        <div className="loader">
          <p>Connecting to the room…</p>
          <Btn variant="white" onClick={() => go('online')}>
            Back
          </Btn>
        </div>
      </div>
    );
  }

  const me = room.seats.find((s) => s.id === myId);
  const isHost = room.hostId === myId;
  const slots: (RoomSeat | null)[] = Array.from({ length: room.maxPlayers }, (_, i) => room.seats[i] ?? null);
  const taken = new Map(room.seats.map((s) => [s.character, s]));
  const link = `${location.origin}${location.pathname}?room=${room.code}`;
  const notReady = room.seats.filter((s) => s.kind === 'human' && s.connected && !s.ready);
  const canStart = room.seats.length >= 2 && notReady.length === 0;

  const share = async () => {
    sound.play('click');
    const text = `Join my Ludo Pals room! Code: ${room.code}`;
    try {
      if (navigator.share) {
        await navigator.share({ title: 'Ludo Pals', text, url: link });
        return;
      }
    } catch {
      /* cancelled */
    }
    try {
      await navigator.clipboard.writeText(link);
      toast('Invite link copied!', 'success');
    } catch {
      toast(`Room code: ${room.code}`);
    }
  };

  const copyCode = async () => {
    try {
      await navigator.clipboard.writeText(room.code);
      toast('Room code copied', 'success');
    } catch {
      toast(`Room code: ${room.code}`);
    }
  };

  const leave = () => {
    o.leave();
    go('online');
  };

  return (
    <div className="screen lobby">
      <header className="screen-head">
        <IconBtn icon={<X size={20} />} label="Leave room" onClick={leave} />
        <h1 className="title-md">Lobby</h1>
        <IconBtn icon={<Share2 size={18} />} label="Invite friends" onClick={share} />
      </header>

      {status !== 'online' && (
        <p className="net-banner">
          <WifiOff size={14} /> Reconnecting…
        </p>
      )}

      <section className="room-code-card">
        <span className="room-code-label">ROOM CODE</span>
        <button type="button" className="room-code" onClick={copyCode} aria-label={`Copy room code ${room.code}`}>
          {room.code.split('').map((ch, i) => (
            <span key={i} className="code-tile" style={{ '--i': i } as CSSProperties}>
              {ch}
            </span>
          ))}
          <span className="code-copy">
            <Copy size={16} />
          </span>
        </button>
        <span className="room-meta">
          {MODES[room.mode].label} · {DICE_MODES[room.dice ?? 'fair'].label} dice · {room.turnSeconds ? `${room.turnSeconds}s turns` : 'no timer'} ·{' '}
          {room.seats.length}/{room.maxPlayers} players
        </span>
      </section>

      <section className="lobby-seats" style={{ '--n': room.maxPlayers } as CSSProperties}>
        {slots.map((s, i) =>
          s ? (
            <SeatTile
              key={s.id}
              seat={s}
              isMe={s.id === myId}
              isHost={s.id === room.hostId}
              canKick={isHost && s.id !== myId}
              speaking={!!speaking[s.id]}
              onKick={() => o.removeSeat(s.id)}
            />
          ) : (
            <div key={`empty-${i}`} className="seat-tile seat-tile--empty">
              <span className="seat-empty-ring" />
              <span className="seat-empty-text">Waiting…</span>
              {isHost && (
                <Btn size="sm" variant="white" icon={<Bot size={14} />} onClick={() => o.addBot()}>
                  Add bot
                </Btn>
              )}
            </div>
          ),
        )}
      </section>

      <section className="card">
        <h2 className="card-title">Your pal</h2>
        <div className="pal-picker">
          {CHARACTER_ORDER.map((id) => {
            const owner = taken.get(id);
            const mine = me?.character === id;
            const blocked = !!owner && !mine;
            return (
              <button
                key={id}
                type="button"
                className={['pal-pick', mine ? 'is-on' : '', blocked ? 'is-taken' : ''].join(' ')}
                disabled={blocked}
                onClick={() => {
                  sound.play('pop');
                  o.update({ character: id });
                  updateProfile({ character: id });
                }}
                title={blocked ? `${owner!.name} has ${CHARACTERS[id].name}` : CHARACTERS[id].name}
              >
                <Avatar id={id} size={46} />
              </button>
            );
          })}
        </div>
      </section>

      <section className="card voice-card">
        <div className="voice-head">
          <div>
            <h2 className="card-title">Voice chat</h2>
            <p className="hint">{voiceOn ? `${room.seats.filter((s) => s.inVoice).length} in voice` : 'Talk trash in real time 🎙️'}</p>
          </div>
          {voiceOn ? (
            <div className="voice-actions">
              <IconBtn
                icon={muted ? <MicOff size={18} /> : <Mic size={18} />}
                label={muted ? 'Unmute mic' : 'Mute mic'}
                onClick={o.toggleMute}
                variant={muted ? 'white' : 'teal'}
              />
              <IconBtn
                icon={deafened ? <HeadphoneOff size={18} /> : <Headphones size={18} />}
                label={deafened ? 'Unmute speakers' : 'Mute speakers'}
                onClick={o.toggleDeafen}
                active={deafened}
              />
              <IconBtn icon={<PhoneOff size={18} />} label="Leave voice" onClick={o.leaveVoice} variant="black" />
            </div>
          ) : (
            <Btn variant="teal" icon={<Phone size={16} />} onClick={() => void o.joinVoice()} disabled={voiceBusy}>
              {voiceBusy ? 'Joining…' : 'Join voice'}
            </Btn>
          )}
        </div>
      </section>

      {isHost && (
        <section className="card">
          <h2 className="card-title">Room settings</h2>
          <div className="field">
            <span className="field-label">Max players</span>
            <Segmented
              value={room.maxPlayers}
              onChange={(v) => o.settings({ maxPlayers: v })}
              options={[2, 3, 4, 5, 6].map((n) => ({ value: n, label: n }))}
            />
          </div>
          <div className="field">
            <span className="field-label">Mode</span>
            <Segmented
              value={room.mode}
              onChange={(v) => o.settings({ mode: v })}
              options={[
                { value: 'classic', label: 'Classic' },
                { value: 'quick', label: 'Quick' },
              ]}
            />
          </div>
          <div className="field">
            <span className="field-label">Turn timer</span>
            <Segmented
              value={room.turnSeconds}
              onChange={(v) => o.settings({ turnSeconds: v })}
              options={[10, 15, 20, 30].map((n) => ({ value: n, label: `${n}s` }))}
            />
          </div>
          <div className="field">
            <span className="field-label">Dice</span>
            <Segmented
              value={room.dice ?? 'fair'}
              onChange={(v) => o.settings({ dice: v })}
              options={(['fair', 'classic'] as const).map((d) => ({ value: d, label: DICE_MODES[d].label }))}
            />
            <span className="hint">{DICE_MODES[room.dice ?? 'fair'].blurb}</span>
          </div>
          <div className="field">
            <span className="field-label">Bot skill</span>
            <Segmented
              value={room.botLevel}
              onChange={(v) => o.settings({ botLevel: v })}
              options={[
                { value: 'easy', label: 'Chill' },
                { value: 'normal', label: 'Normal' },
                { value: 'hard', label: 'Savage' },
              ]}
            />
          </div>
          {room.seats.length < room.maxPlayers && (
            <Btn
              variant="white"
              full
              icon={<Plus size={16} />}
              onClick={() => {
                for (let i = room.seats.length; i < room.maxPlayers; i++) o.addBot();
              }}
            >
              Fill empty seats with bots
            </Btn>
          )}
        </section>
      )}

      <section className="card chat-card">
        <h2 className="card-title">Chat</h2>
        <ChatPanel />
      </section>

      <div className="sticky-cta">
        {isHost ? (
          <>
            <Btn variant="black" size="lg" full onClick={() => void o.start()} disabled={room.seats.length < 2}>
              {canStart
                ? `Start game (${room.seats.length} players)`
                : room.seats.length < 2
                  ? 'Need 2+ players'
                  : `Waiting for ${notReady.length} to get ready`}
            </Btn>
            {room.seats.length < 2 && <p className="hint center">Share the code or add a bot to start.</p>}
          </>
        ) : (
          <Btn
            variant={me?.ready ? 'teal' : 'black'}
            size="lg"
            full
            icon={me?.ready ? <Check size={20} /> : undefined}
            onClick={() => o.update({ ready: !me?.ready })}
          >
            {me?.ready ? 'Ready! Waiting for host…' : "I'm ready"}
          </Btn>
        )}
      </div>
    </div>
  );
}

function SeatTile({
  seat,
  isMe,
  isHost,
  canKick,
  speaking,
  onKick,
}: {
  seat: RoomSeat;
  isMe: boolean;
  isHost: boolean;
  canKick: boolean;
  speaking: boolean;
  onKick: () => void;
}) {
  const meta = CHARACTERS[seat.character];
  return (
    <div
      className={['seat-tile', isMe ? 'is-me' : '', !seat.connected ? 'is-away' : '', speaking ? 'is-speaking' : ''].join(' ')}
      style={{ '--c': meta.color, '--cl': meta.light } as CSSProperties}
    >
      {canKick && (
        <button type="button" className="seat-kick" onClick={onKick} aria-label={seat.kind === 'bot' ? 'Remove bot' : `Remove ${seat.name}`}>
          {seat.kind === 'bot' ? <X size={14} /> : <UserX size={14} />}
        </button>
      )}
      <div className="seat-tile-art">
        <Mascot id={seat.character} size="100%" mood={seat.ready ? 'happy' : 'think'} />
      </div>
      <span className="seat-tile-name">
        {isHost && <Crown size={13} className="crown" />}
        {seat.name}
      </span>
      <span className="seat-tile-tags">
        {isMe && <span className="tag">YOU</span>}
        {seat.kind === 'bot' && (
          <span className="tag tag--bot">
            <Bot size={11} /> BOT
          </span>
        )}
        {seat.inVoice && (seat.muted ? <MicOff size={13} className="chip-mic is-muted" /> : <Mic size={13} className="chip-mic" />)}
        {!seat.connected && <WifiOff size={13} />}
      </span>
      <span className={`seat-ready ${seat.ready ? 'is-ready' : ''} ${seat.connected ? '' : 'is-away'}`}>
        {!seat.connected ? 'Away…' : seat.ready ? 'Ready' : 'Not ready'}
      </span>
    </div>
  );
}
