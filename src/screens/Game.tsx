import {
  Bot,
  Crown,
  Headphones,
  HeadphoneOff,
  HelpCircle,
  LogOut,
  MessageCircle,
  Mic,
  MicOff,
  Music,
  Pause,
  Play,
  RotateCcw,
  Smile,
  Volume2,
  VolumeX,
  WifiOff,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { finishAt, geom } from '../../shared/board';
import { CHARACTERS, MODES } from '../../shared/characters';
import { Match } from '../../shared/match';
import { EMOTES } from '../../shared/protocol';
import { botReactions } from '../../shared/reactions';
import type { GameState, MatchConfig, PlayerState } from '../../shared/types';
import { sound } from '../audio/sound';
import { Board, yardScreenPositions } from '../components/Board';
import { ChatPanel } from '../components/ChatPanel';
import { Dice } from '../components/Dice';
import { Mascot, type Mood } from '../components/Mascot';
import { Avatar, Btn, IconBtn, Sheet, Toggle } from '../components/ui';
import { useBoardAnimation } from '../game/useBoardAnimation';
import { ordinal, useGameFeed, type Banner } from '../game/useGameFeed';
import { useOnline, type FloatingEmote } from '../net/online';
import { HowToPlay } from './Hub';
import { useApp } from '../store/app';

export interface GameCtl {
  state: GameState | null;
  online: boolean;
  /** This device may act for that player. */
  controls: (player: number) => boolean;
  /** Player index of the device owner (board is rotated so their yard is at the bottom). */
  me: number | null;
  passAndPlay: boolean;
  roll: () => void;
  move: (token: number) => void;
  emote: (emoji: string) => void;
  emotes: FloatingEmote[];
  leave: () => void;
  takeover?: () => void;
  paused?: boolean;
  pause?: () => void;
  resume?: () => void;
  restart?: () => void;
  config?: MatchConfig | null;
}

// ---------------------------------------------------------------------------
// Controllers

function useLocalCtl(cfg: MatchConfig | null): GameCtl {
  const [state, setState] = useState<GameState | null>(null);
  const [paused, setPaused] = useState(false);
  const [gen, setGen] = useState(0);
  const [emotes, setEmotes] = useState<FloatingEmote[]>([]);
  const match = useRef<Match | null>(null);
  const emoteKey = useRef(0);

  const pushEmote = useCallback((from: string, emoji: string) => {
    const key = ++emoteKey.current;
    setEmotes((e) => [...e, { key, from, emoji }].slice(-10));
    setTimeout(() => setEmotes((e) => e.filter((x) => x.key !== key)), 2600);
  }, []);

  useEffect(() => {
    if (!cfg) return;
    const m = new Match(cfg, {
      onState: (s) => {
        setState(s);
        for (const r of botReactions(s)) {
          setTimeout(
            () => {
              if (match.current !== m) return;
              pushEmote(s.players[r.player].id, r.emoji);
              sound.play('pop');
            },
            r.delay * (s.speed || 1),
          );
        }
      },
    });
    match.current = m;
    setPaused(false);
    setState(null);
    m.start();
    return () => {
      m.destroy();
      if (match.current === m) match.current = null;
    };
  }, [cfg, gen, pushEmote]);

  const humans = state ? state.players.filter((p) => p.kind === 'human').length : 1;
  const live = () => match.current?.state;

  return {
    state,
    online: false,
    controls: (i) => state?.players[i]?.kind === 'human',
    me: 0,
    passAndPlay: humans > 1,
    roll: () => {
      const s = live();
      if (s) match.current!.roll(s.players[s.turn].id);
    },
    move: (t) => {
      const s = live();
      if (s) match.current!.move(s.players[s.turn].id, t);
    },
    emote: (emoji) => {
      const s = live();
      if (!s) return;
      const cur = s.players[s.turn];
      pushEmote(cur.kind === 'human' ? cur.id : s.players[0].id, emoji);
      sound.play('pop');
    },
    emotes,
    leave: () => useApp.getState().go('hub'),
    // Turn-timer timeouts can hand a local human to the bot; this hands every local human back.
    takeover: () => {
      const s = live();
      s?.players.forEach((p) => p.kind === 'human' && p.auto && match.current!.setAuto(p.id, false));
    },
    paused,
    pause: () => {
      match.current?.pause();
      setPaused(true);
    },
    resume: () => {
      match.current?.resume();
      setPaused(false);
    },
    restart: () => setGen((g) => g + 1),
    config: cfg,
  };
}

function useOnlineCtl(): GameCtl {
  const game = useOnline((s) => s.game);
  const myId = useOnline((s) => s.myId);
  const emotes = useOnline((s) => s.emotes);
  const actions = useOnline.getState();
  const me = game ? game.players.findIndex((p) => p.id === myId) : -1;
  return {
    state: game,
    online: true,
    controls: (i) => i === me,
    me: me >= 0 ? me : null,
    passAndPlay: false,
    roll: actions.roll,
    move: actions.move,
    emote: actions.emote,
    emotes,
    takeover: actions.takeover,
    leave: () => {
      actions.leave();
      useApp.getState().go('hub');
    },
  };
}

export function LocalGame() {
  const cfg = useApp((s) => s.localConfig);
  const ctl = useLocalCtl(cfg);
  return <GameView ctl={ctl} />;
}

export function OnlineGame() {
  const ctl = useOnlineCtl();
  return <GameView ctl={ctl} />;
}

// ---------------------------------------------------------------------------
// View

function useLocalDeadline(state: GameState | null): number | null {
  const ref = useRef<{ seq: number; at: number | null }>({ seq: -1, at: null });
  if (state && ref.current.seq !== state.seq) {
    ref.current = { seq: state.seq, at: state.deadline ? Date.now() + (state.deadline - state.now) : null };
  }
  return state ? ref.current.at : null;
}

function GameView({ ctl }: { ctl: GameCtl }) {
  const { state } = ctl;
  const settings = useApp((s) => s.settings);
  const updateSettings = useApp((s) => s.updateSettings);
  const finishGame = useApp((s) => s.finishGame);
  const room = useOnline((s) => s.room);
  const net = useOnline((s) => s.status);
  const unread = useOnline((s) => s.unread);
  const chatOpen = useOnline((s) => s.chatOpen);
  const setChatOpen = useOnline((s) => s.setChatOpen);
  const voiceOn = useOnline((s) => s.voiceOn);
  const voiceBusy = useOnline((s) => s.voiceBusy);
  const muted = useOnline((s) => s.muted);
  const deafened = useOnline((s) => s.deafened);
  const speaking = useOnline((s) => s.speaking);
  const [pending, setPending] = useState(false);
  const [tray, setTray] = useState(false);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [help, setHelp] = useState(false);

  const ctlRef = useRef(ctl);
  ctlRef.current = ctl;

  const isMine = useCallback((p: number) => ctlRef.current.controls(p), []);
  const anim = useBoardAnimation(state, isMine);
  const onOver = useCallback(
    (s: GameState) => finishGame({ state: s, me: ctlRef.current.me, online: ctlRef.current.online, config: ctlRef.current.config ?? null }),
    [finishGame],
  );
  const feed = useGameFeed(state, { isMine, passAndPlay: ctl.passAndPlay, onOver });
  const deadline = useLocalDeadline(state);

  useEffect(() => {
    sound.wantMusic(true);
  }, []);

  useEffect(() => setPending(false), [state?.rollCount, state?.turn, state?.phase]);

  const cur: PlayerState | undefined = state?.players[state.turn];
  const myTurn = !!state && !!cur && ctl.controls(state.turn) && cur.kind === 'human' && !cur.auto && state.phase !== 'over';
  const canRoll = myTurn && state!.phase === 'roll' && !ctl.paused && !pending;
  const movable = myTurn && state!.phase === 'move' && !ctl.paused ? state!.movable : [];

  const roll = useCallback(() => {
    if (!canRoll) return;
    sound.unlock();
    setPending(true);
    ctl.roll();
  }, [canRoll, ctl]);

  const pick = useCallback(
    (t: number) => {
      sound.play('click');
      ctl.move(t);
    },
    [ctl],
  );

  // Keyboard: space/enter rolls, 1-4 picks a token.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest('input, textarea')) return;
      if ((e.key === ' ' || e.key === 'Enter') && canRoll) {
        e.preventDefault();
        roll();
      }
      const n = Number(e.key);
      if (n >= 1 && n <= 4 && movable.includes(n - 1)) pick(n - 1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [canRoll, roll, movable, pick]);

  // Last-seconds ticking on my turn.
  useEffect(() => {
    if (!deadline || !myTurn) return;
    const id = setInterval(() => {
      const left = deadline - Date.now();
      if (left > 0 && left < 5200) sound.play('tick');
    }, 1000);
    return () => clearInterval(id);
  }, [deadline, myTurn]);

  const viewArm = ctl.me !== null && state ? state.players[ctl.me].arm : 0;
  // Chips sit above/below the board next to their own yard.
  const slots = state
    ? yardScreenPositions(state.arms, viewArm).map((p, arm) => ({ arm, x: p[0], y: p[1], player: state.players.findIndex((pl) => pl.arm === arm) }))
    : [];
  const rows = {
    top: slots.filter((s) => s.y < 0).sort((a, b) => a.x - b.x),
    bottom: slots.filter((s) => s.y > 0).sort((a, b) => a.x - b.x),
  };

  if (!state || !cur) {
    return (
      <div className="game game--loading">
        <div className="loader">
          <Dice value={5} rollKey={0} accent="#F2617A" />
          <p>Setting up the board…</p>
        </div>
      </div>
    );
  }

  const curMeta = CHARACTERS[cur.character];
  const speed = state.speed;
  const status = statusLine(state, cur, myTurn, ctl, feed.quip, movable.length);
  const meAuto = state.phase !== 'over' && state.players.some((p, i) => ctl.controls(i) && p.kind === 'human' && p.auto);
  const modeLabel = `${MODES[state.rules.mode].label} · ${state.players.length}P`;
  const seatOf = (id: string) => room?.seats.find((s) => s.id === id);

  const renderRow = (row: typeof rows.top, where: 'top' | 'bottom') => (
    <div className={`seat-row seat-row--${where} seat-row--n${row.length}`}>
      {row.map((slot) => {
        if (slot.player < 0) return <div key={slot.arm} className="chip chip--empty" />;
        const pl = state.players[slot.player];
        const seat = seatOf(pl.id);
        return (
          <PlayerChip
            key={slot.arm}
            player={pl}
            index={slot.player}
            state={state}
            active={slot.player === state.turn && state.phase !== 'over'}
            isMe={ctl.online ? slot.player === ctl.me : false}
            mood={feed.moods[slot.player]}
            deadline={slot.player === state.turn ? deadline : null}
            speaking={!!speaking[pl.id]}
            voice={seat ? { inVoice: seat.inVoice, muted: seat.muted } : null}
            emotes={ctl.emotes.filter((e) => e.from === pl.id)}
            where={where}
          />
        );
      })}
    </div>
  );

  return (
    <div
      className={`game ${ctl.online ? 'game--online' : ''}`}
      style={{ '--cur': curMeta.color, '--cur-light': curMeta.light, '--cur-dark': curMeta.dark } as CSSProperties}
    >
      <header className="game-head">
        {ctl.online ? (
          <IconBtn icon={<LogOut size={18} />} label="Leave game" onClick={() => setConfirmLeave(true)} />
        ) : (
          <IconBtn icon={<Pause size={18} />} label="Pause" onClick={() => ctl.pause?.()} />
        )}
        <div className="game-title">
          <span className="game-title-main">{ctl.online && room ? `Room ${room.code}` : 'Ludo Pals'}</span>
          <span className="game-title-sub">
            {modeLabel}
            {ctl.online && net !== 'online' && (
              <span className="net-warn">
                <WifiOff size={12} /> reconnecting…
              </span>
            )}
          </span>
        </div>
        <div className="game-head-actions">
          <IconBtn
            icon={settings.sound ? <Volume2 size={18} /> : <VolumeX size={18} />}
            label={settings.sound ? 'Mute sounds' : 'Unmute sounds'}
            onClick={() => updateSettings({ sound: !settings.sound })}
            active={!settings.sound}
          />
          {!ctl.online && (
            <IconBtn
              icon={<Music size={18} />}
              label={settings.music ? 'Music off' : 'Music on'}
              onClick={() => updateSettings({ music: !settings.music })}
              active={!settings.music}
              className={settings.music ? '' : 'is-struck'}
            />
          )}
          {ctl.online && (
            <>
              <IconBtn icon={<MessageCircle size={18} />} label="Chat" badge={unread || null} onClick={() => setChatOpen(true)} />
              <VoiceButton voiceOn={voiceOn} busy={voiceBusy} muted={muted} />
            </>
          )}
        </div>
      </header>

      <main className="table">
        <div className="board-wrap" style={{ '--ar': geom(state.arms).bounds.w / geom(state.arms).bounds.h } as CSSProperties}>
          <div className="board-stack">
            {renderRow(rows.top, 'top')}
            <div className="board-fit">
              <Board
                state={state}
                viewArm={viewArm}
                display={anim.display}
                hops={anim.hops}
                returning={anim.returning}
                movable={movable}
                onPick={pick}
                fx={anim.fx}
                shake={anim.shake}
                moods={feed.moods}
              />
              <BannerView banner={feed.banner} />
            </div>
            {renderRow(rows.bottom, 'bottom')}
          </div>
        </div>
      </main>

      <section className="side">
        {meAuto && ctl.takeover && (
          <div className="takeover">
            <Bot size={18} />
            <span>A bot is playing for you</span>
            <Btn size="sm" variant="teal" onClick={ctl.takeover}>
              Take over
            </Btn>
          </div>
        )}

        <div className={`dock ${canRoll ? 'dock--ready' : ''}`}>
          <div className="dock-mascot" key={cur.id}>
            <Mascot id={cur.character} mood={feed.moods[state.turn] ?? (myTurn ? 'happy' : 'idle')} size="100%" look="right" />
          </div>
          <div className="dock-bubble">
            <span className="dock-name">
              {cur.name}
              {cur.kind === 'bot' && <span className="tag tag--bot">BOT</span>}
              {cur.auto && <span className="tag tag--bot">AUTO</span>}
            </span>
            <span className="dock-status">{status}</span>
          </div>
          <div className="dock-dice">
            <Dice
              value={state.dice}
              rollKey={state.rollCount}
              pending={pending}
              accent={curMeta.color}
              durationMs={760 * speed}
              glow={canRoll}
              disabled={!canRoll}
              onRoll={roll}
              size={64}
              label={canRoll ? 'Roll the dice' : undefined}
            />
          </div>
          <button className={`emote-toggle ${tray ? 'is-on' : ''}`} onClick={() => setTray((t) => !t)} aria-label="Send a reaction" type="button">
            <Smile size={20} />
          </button>
          {tray && (
            <div className="emote-tray" role="menu">
              {EMOTES.map((e) => (
                <button
                  key={e}
                  type="button"
                  className="emote-btn"
                  onClick={() => {
                    ctl.emote(e);
                    setTray(false);
                  }}
                >
                  {e}
                </button>
              ))}
            </div>
          )}
        </div>

        {ctl.online && (
          <div className="side-chat">
            <ChatPanel compact />
          </div>
        )}
      </section>

      {/* Pause menu (local) */}
      <Sheet open={!!ctl.paused} onClose={() => ctl.resume?.()} title="Paused">
        <div className="pause-mascots">
          {state.players.map((p) => (
            <Mascot key={p.id} id={p.character} size={52} mood="think" />
          ))}
        </div>
        <div className="stack">
          <Btn variant="black" size="lg" full icon={<Play size={18} />} onClick={() => ctl.resume?.()}>
            Resume
          </Btn>
          <Btn variant="white" size="lg" full icon={<RotateCcw size={18} />} onClick={() => ctl.restart?.()}>
            Restart game
          </Btn>
          <div className="card card--flat">
            <Toggle checked={settings.sound} onChange={(v) => updateSettings({ sound: v })} label="Sound effects" />
            <Toggle checked={settings.music} onChange={(v) => updateSettings({ music: v })} label="Music" />
            <Toggle checked={settings.vibration} onChange={(v) => updateSettings({ vibration: v })} label="Vibration" />
          </div>
          <Btn variant="ghost" full icon={<HelpCircle size={18} />} onClick={() => setHelp(true)}>
            How to play
          </Btn>
          <Btn variant="ghost" full icon={<LogOut size={18} />} onClick={ctl.leave}>
            Quit to menu
          </Btn>
        </div>
      </Sheet>

      <HowToPlay open={help} onClose={() => setHelp(false)} />

      {/* Leave confirm (online) */}
      <Sheet open={confirmLeave} onClose={() => setConfirmLeave(false)} title="Leave the game?">
        <p className="muted">A bot will take over your pals so the others can keep playing.</p>
        <div className="row-btns">
          <Btn variant="white" onClick={() => setConfirmLeave(false)}>
            Stay
          </Btn>
          <Btn variant="danger" icon={<LogOut size={16} />} onClick={ctl.leave}>
            Leave
          </Btn>
        </div>
      </Sheet>

      {ctl.online && (
        <Sheet open={chatOpen} onClose={() => setChatOpen(false)} title="Room chat">
          <ChatPanel />
          {voiceOn && (
            <div className="voice-row">
              <Btn
                size="sm"
                variant="white"
                icon={deafened ? <HeadphoneOff size={16} /> : <Headphones size={16} />}
                onClick={() => useOnline.getState().toggleDeafen()}
              >
                {deafened ? 'Unmute speakers' : 'Mute speakers'}
              </Btn>
              <Btn size="sm" variant="ghost" onClick={() => useOnline.getState().leaveVoice()}>
                Leave voice
              </Btn>
            </div>
          )}
        </Sheet>
      )}
    </div>
  );
}

function statusLine(state: GameState, cur: PlayerState, myTurn: boolean, ctl: GameCtl, quip: string, movableCount: number): string {
  if (state.phase === 'over') return 'Game over!';
  if (ctl.paused) return 'Paused';
  if (myTurn) {
    if (state.phase === 'roll') return ctl.passAndPlay ? 'Your turn — tap the dice!' : 'Your turn! Tap the dice 🎲';
    if (state.phase === 'rolling') return 'Rolling…';
    if (state.phase === 'move') return movableCount > 1 ? 'Pick a pal to move' : 'Moving…';
    return 'Nice!';
  }
  if (cur.kind === 'bot' || cur.auto) return quip || 'Thinking…';
  if (!cur.connected) return 'Reconnecting…';
  if (state.phase === 'move') return 'Choosing a move…';
  if (state.phase === 'rolling') return 'Rolling…';
  return 'Getting ready to roll…';
}

function VoiceButton({ voiceOn, busy, muted }: { voiceOn: boolean; busy: boolean; muted: boolean }) {
  const o = useOnline.getState();
  if (!voiceOn) {
    return (
      <IconBtn
        icon={<MicOff size={18} />}
        label={busy ? 'Joining voice…' : 'Join voice chat'}
        onClick={() => void o.joinVoice()}
        className="voice-off"
      />
    );
  }
  return (
    <IconBtn
      icon={muted ? <MicOff size={18} /> : <Mic size={18} />}
      label={muted ? 'Unmute mic' : 'Mute mic'}
      onClick={() => o.toggleMute()}
      variant={muted ? 'white' : 'teal'}
      className="voice-on"
    />
  );
}

function PlayerChip({
  player,
  index,
  state,
  active,
  isMe,
  mood,
  deadline,
  speaking,
  voice,
  emotes,
  where,
}: {
  player: PlayerState;
  index: number;
  state: GameState;
  active: boolean;
  isMe: boolean;
  mood?: Mood;
  deadline: number | null;
  speaking: boolean;
  voice: { inVoice: boolean; muted: boolean } | null;
  emotes: FloatingEmote[];
  where: 'top' | 'bottom';
}) {
  const meta = CHARACTERS[player.character];
  const fin = finishAt(state.arms);
  const left = deadline ? Math.max(0, deadline - Date.now()) : 0;
  const frac = state.turnMs ? Math.min(1, left / state.turnMs) : 0;
  const R = 24;
  const len = 2 * Math.PI * R;
  return (
    <div
      className={[
        'chip',
        active ? 'chip--active' : '',
        player.rank ? 'chip--done' : '',
        !player.connected ? 'chip--away' : '',
        player.left ? 'chip--left' : '',
        `chip--${where}`,
      ].join(' ')}
      style={{ '--c': meta.color, '--cl': meta.light, '--cd': meta.dark } as CSSProperties}
    >
      <div className={`chip-avatar ${speaking ? 'is-speaking' : ''}`}>
        <Avatar id={player.character} size={40} mood={mood} />
        {deadline && left > 0 && (
          <svg className="chip-timer" viewBox="0 0 56 56" key={deadline}>
            <circle
              cx="28"
              cy="28"
              r={R}
              style={
                {
                  strokeDasharray: len,
                  '--from': `${len * (1 - frac)}`,
                  '--to': `${len}`,
                  animationDuration: `${left}ms`,
                } as CSSProperties
              }
            />
          </svg>
        )}
        {player.rank > 0 && <span className={`chip-rank chip-rank--${player.rank}`}>{player.rank === 1 ? <Crown size={11} /> : player.rank}</span>}
      </div>
      <div className="chip-info">
        <span className="chip-name">
          <span className="chip-name-text">{player.name}</span>
          {isMe && <span className="tag">YOU</span>}
          {player.left ? (
            <span className="tag tag--left" title="Left the game — a bot is finishing for them">
              LEFT
            </span>
          ) : (
            !player.connected &&
            player.kind === 'human' && (
              <span className="tag tag--away" title="Reconnecting — a bot is playing for them">
                AWAY
              </span>
            )
          )}
          {player.kind === 'bot' && <Bot size={12} className="chip-bot" />}
          {voice?.inVoice && (voice.muted ? <MicOff size={11} className="chip-mic is-muted" /> : <Mic size={11} className="chip-mic" />)}
        </span>
        <span className="chip-tokens" aria-label={`${player.tokens.filter((t) => t === fin).length} of ${player.tokens.length} home`}>
          {player.rank > 0 ? (
            <span className="chip-finished">{ordinal(player.rank)}</span>
          ) : (
            player.tokens.map((t, i) => <i key={i} className={t === fin ? 'is-home' : t >= 0 ? 'is-out' : ''} />)
          )}
        </span>
      </div>
      <div className="chip-emotes">
        {emotes.map((e) => (
          <span key={e.key} className="chip-emote">
            {e.emoji}
          </span>
        ))}
      </div>
      {index === state.turn && active && <span className="chip-turn-dot" />}
    </div>
  );
}

function BannerView({ banner }: { banner: Banner | null }) {
  if (!banner) return null;
  const meta = banner.character ? CHARACTERS[banner.character] : null;
  return (
    <div
      className={`banner banner--${banner.tone}`}
      key={banner.id}
      style={meta ? ({ '--c': meta.color, '--cl': meta.light } as CSSProperties) : undefined}
    >
      {meta && (
        <Mascot id={meta.id} size={54} mood={banner.tone === 'bad' ? 'shock' : banner.tone === 'bonk' ? 'smug' : 'joy'} className="banner-mascot" />
      )}
      <div className="banner-text">
        <strong>{banner.title}</strong>
        {banner.sub && <span>{banner.sub}</span>}
      </div>
    </div>
  );
}
