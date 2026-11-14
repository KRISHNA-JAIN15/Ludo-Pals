import {
  Bot,
  Check,
  Copy,
  Crown,
  Headphones,
  HeadphoneOff,
  Link2,
  MessageCircle,
  Mic,
  MicOff,
  Phone,
  PhoneOff,
  Plus,
  Share2,
  UserPlus,
  UserX,
  WifiOff,
  X,
} from 'lucide-react';
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { CHARACTERS, CHARACTER_ORDER, DICE_MODES, DICE_ORDER, MODES, diceInfo } from '../../shared/characters';
import type { RoomSeat } from '../../shared/protocol';
import { sound } from '../audio/sound';
import { ChatPanel } from '../components/ChatPanel';
import { Mascot } from '../components/Mascot';
import { Avatar, Btn, Coin, IconBtn, Segmented, VoiceMic } from '../components/ui';
import { copyText, inviteLink, inviteMessage, whatsAppLink } from '../net/invite';
import type { LinkState } from '../net/voice';
import { useOnline } from '../net/online';
import { HOST_FEE, useApp } from '../store/app';

export function Lobby() {
  const room = useOnline((s) => s.room);
  const myId = useOnline((s) => s.myId);
  const voiceOn = useOnline((s) => s.voiceOn);
  const voiceBusy = useOnline((s) => s.voiceBusy);
  const muted = useOnline((s) => s.muted);
  const deafened = useOnline((s) => s.deafened);
  const speaking = useOnline((s) => s.speaking);
  const voiceLinks = useOnline((s) => s.voiceLinks);
  const voiceRelay = useOnline((s) => s.voiceRelay);
  const micBlocked = useOnline((s) => s.micBlocked);
  const status = useOnline((s) => s.status);
  const o = useOnline.getState();
  const go = useApp((s) => s.go);
  const toast = useApp((s) => s.toast);
  const updateProfile = useApp((s) => s.updateProfile);
  const profileName = useApp((s) => s.profile.name);
  const coins = useApp((s) => s.profile.coins);
  const [starting, setStarting] = useState(false);
  const startingRef = useRef(false); // synchronous guard: two taps can land before a re-render
  const [copied, setCopied] = useState<'code' | 'link' | null>(null);
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const me = room?.seats.find((s) => s.id === myId);
  const [name, setName] = useState(me?.name ?? profileName);
  const typing = useRef(false);

  useEffect(() => sound.wantMusic(true), []);
  useEffect(
    () => () => {
      if (copiedTimer.current) clearTimeout(copiedTimer.current);
    },
    [],
  );

  // Show the name the room has for us, unless we are in the middle of typing a new one.
  useEffect(() => {
    if (!typing.current && me?.name) setName(me.name);
  }, [me?.name]);

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

  const isHost = room.hostId === myId;
  const slots: (RoomSeat | null)[] = Array.from({ length: room.maxPlayers }, (_, i) => room.seats[i] ?? null);
  const taken = new Map(room.seats.map((s) => [s.character, s]));
  const link = inviteLink(room.code);
  const notReady = room.seats.filter((s) => s.kind === 'human' && s.connected && !s.ready);
  const unreachable = voiceOn ? room.seats.filter((s) => voiceLinks[s.id] === 'failed').map((s) => s.name) : [];
  const canStart = room.seats.length >= 2 && notReady.length === 0;
  const canPay = coins >= HOST_FEE; // the host pays for each match

  const flash = (what: 'code' | 'link') => {
    setCopied(what);
    if (copiedTimer.current) clearTimeout(copiedTimer.current);
    copiedTimer.current = setTimeout(() => setCopied(null), 1800);
  };

  const copyLink = async () => {
    sound.play('click');
    if (await copyText(link)) {
      flash('link');
      toast('Invite link copied! Anyone who opens it joins this room.', 'success');
    } else toast(`Share this link: ${link}`);
  };

  const copyCode = async () => {
    sound.play('click');
    if (await copyText(room.code)) {
      flash('code');
      toast('Room code copied', 'success');
    } else toast(`Room code: ${room.code}`);
  };

  const share = async () => {
    sound.play('click');
    if (navigator.share) {
      try {
        await navigator.share({ title: 'Ludo Pals', text: `Join my Ludo Pals game! 🎲 Room code ${room.code}`, url: link });
      } catch {
        /* cancelled */
      }
      return;
    }
    if (await copyText(inviteMessage(room.code))) toast('Invite copied! Paste it to your friends.', 'success');
    else toast(`Share this link: ${link}`);
  };

  const saveName = () => {
    typing.current = false;
    const n = name.trim().slice(0, 16);
    if (!n) {
      setName(me?.name ?? profileName);
      return;
    }
    setName(n);
    if (n !== me?.name) o.update({ name: n });
    if (n !== profileName) updateProfile({ name: n });
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
          <span className={copied === 'code' ? 'code-copy is-done' : 'code-copy'}>
            {copied === 'code' ? <Check size={16} /> : <Copy size={16} />}
          </span>
        </button>
        <span className="room-meta">
          {MODES[room.mode].label} · {diceInfo(room.dice).label} dice · {room.turnSeconds ? `${room.turnSeconds}s turns` : 'no timer'} ·{' '}
          {room.seats.length}/{room.maxPlayers} players
        </span>
        <div className="invite-row">
          <button
            type="button"
            className={copied === 'link' ? 'invite-btn invite-btn--link is-done' : 'invite-btn invite-btn--link'}
            onClick={copyLink}
          >
            {copied === 'link' ? <Check size={17} /> : <Link2 size={17} />}
            <span>{copied === 'link' ? 'Copied!' : 'Copy link'}</span>
          </button>
          <a
            className="invite-btn invite-btn--wa"
            href={whatsAppLink(room.code)}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => sound.play('click')}
            aria-label="Invite on WhatsApp"
          >
            <span className="wa-icon" aria-hidden>
              <MessageCircle size={19} />
              <Phone size={8} strokeWidth={3.2} />
            </span>
            <span>WhatsApp</span>
          </a>
        </div>
        <span className="invite-hint">Friends who open the link land right in this room.</span>
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
              link={voiceOn && s.id !== myId ? voiceLinks[s.id] : undefined}
              onKick={() => o.removeSeat(s.id)}
            />
          ) : (
            <div key={`empty-${i}`} className="seat-tile seat-tile--empty">
              <span className="seat-empty-ring" />
              <span className="seat-empty-text">
                Waiting
                <i className="dots3" aria-hidden>
                  <b />
                  <b />
                  <b />
                </i>
              </span>
              <div className="seat-empty-actions">
                <Btn size="sm" variant="white" icon={<UserPlus size={14} />} onClick={() => void copyLink()} silent>
                  Invite
                </Btn>
                {isHost && (
                  <Btn size="sm" variant="white" icon={<Bot size={14} />} onClick={() => o.addBot()}>
                    Bot
                  </Btn>
                )}
              </div>
            </div>
          ),
        )}
      </section>

      <section className="card">
        <h2 className="card-title">You</h2>
        <label className="field">
          <span className="field-label">Name</span>
          <input
            className="input"
            value={name}
            maxLength={16}
            onChange={(e) => {
              typing.current = true;
              setName(e.target.value);
            }}
            onBlur={saveName}
            onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
            enterKeyHint="done"
            autoComplete="off"
            aria-label="Your name"
          />
        </label>
        <div className="field">
          <span className="field-label">Pal</span>
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
                  aria-label={blocked ? `${CHARACTERS[id].name} (taken by ${owner!.name})` : CHARACTERS[id].name}
                >
                  <Avatar id={id} size={46} />
                </button>
              );
            })}
          </div>
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
        {voiceOn && micBlocked && (
          <p className="voice-warn">
            Your mic isn&apos;t picking anything up, so nobody can hear you. Another app (a phone or WhatsApp call) may be using it, or it is muted on
            your device.
          </p>
        )}
        {voiceOn && voiceRelay === false && isHost && unreachable.length === 0 && (
          <p className="hint">
            No voice relay is set up for this game, so players on strict networks (often mobile data) may not hear everyone. The README&apos;s
            &ldquo;Voice relay&rdquo; section fixes that in two minutes.
          </p>
        )}
        {unreachable.length > 0 && (
          <p className="voice-warn">
            Can&apos;t connect audio with {unreachable.join(', ')} yet.{' '}
            {voiceRelay === false
              ? 'One of your networks blocks direct calls and this game has no voice relay set up, so this pair may not connect.'
              : 'Still retrying.'}
          </p>
        )}
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
              value={room.dice}
              onChange={(v) => o.settings({ dice: v })}
              options={DICE_ORDER.map((d) => ({ value: d, label: DICE_MODES[d].label }))}
            />
            <span className="hint">{diceInfo(room.dice).blurb}</span>
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
            <Btn
              variant="black"
              size="lg"
              full
              className={canStart && canPay && !starting ? 'btn--pulse' : ''}
              onClick={() => {
                if (startingRef.current) return;
                startingRef.current = true;
                setStarting(true);
                void o.start().finally(() => {
                  startingRef.current = false;
                  setStarting(false);
                });
              }}
              disabled={room.seats.length < 2 || starting || !canPay}
            >
              {!canPay
                ? `Need ${HOST_FEE} coins to start`
                : starting
                  ? 'Starting…'
                  : canStart
                    ? `Start game (${room.seats.length} players)`
                    : room.seats.length < 2
                      ? 'Need 2+ players'
                      : `Waiting for ${notReady.length} to get ready`}
            </Btn>
            {room.seats.length < 2 && <p className="hint center">Invite a friend or add a bot to start.</p>}
          </>
        ) : (
          <Btn
            variant={me?.ready ? 'teal' : 'black'}
            size="lg"
            full
            className={me?.ready ? '' : 'btn--pulse'}
            icon={me?.ready ? <Check size={20} /> : undefined}
            onClick={() => o.update({ ready: !me?.ready })}
          >
            {me?.ready ? 'Ready! Waiting for host…' : "I'm ready"}
          </Btn>
        )}
        {(!isHost || room.seats.length >= 2) && (
          <p className="hint center">
            {isHost ? (
              <>
                Each match costs you {HOST_FEE} <Coin size={15} /> as host · you have {coins.toLocaleString()}
              </>
            ) : (
              <>
                Free for you: the host pays {HOST_FEE} <Coin size={15} /> a match
              </>
            )}
          </p>
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
  link,
  onKick,
}: {
  seat: RoomSeat;
  isMe: boolean;
  isHost: boolean;
  canKick: boolean;
  speaking: boolean;
  link?: LinkState;
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
        <span className="seat-tile-name-text">{seat.name}</span>
      </span>
      <span className="seat-tile-tags">
        {isMe && <span className="tag">YOU</span>}
        {seat.kind === 'bot' && (
          <span className="tag tag--bot">
            <Bot size={11} /> BOT
          </span>
        )}
        {seat.inVoice && <VoiceMic muted={seat.muted} link={link} size={13} />}
        {!seat.connected && <WifiOff size={13} />}
      </span>
      <span className={`seat-ready ${seat.ready ? 'is-ready' : ''} ${seat.connected ? '' : 'is-away'}`}>
        {!seat.connected ? 'Away…' : seat.ready ? 'Ready' : 'Not ready'}
      </span>
    </div>
  );
}
