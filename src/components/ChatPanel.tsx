import { ArrowDown, ArrowUp, Clock3, Keyboard, Smile } from 'lucide-react';
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { CHARACTERS } from '../../shared/characters';
import { QUICK_CHAT, type ChatMessage } from '../../shared/protocol';
import type { CharacterId } from '../../shared/types';
import { sound } from '../audio/sound';
import { useOnline } from '../net/online';
import { useApp } from '../store/app';
import { EMOJI_GROUPS, STICKERS, clock, groupChat, jumboEmoji, recentEmoji, rememberEmoji, stickerOf, stickerText, type Sticker } from './chatKit';
import { Mascot } from './Mascot';
import { Avatar } from './ui';

const MAX_LEN = 140;
/** The server drops messages that arrive less than half a second apart, so quick taps are spaced out (with room for network jitter) instead of lost. */
const SEND_GAP_MS = 750;

const palStyle = (id: CharacterId | null): CSSProperties | undefined => {
  const meta = id && CHARACTERS[id];
  return meta ? ({ '--c': meta.color, '--cl': meta.light, '--cd': meta.dark } as CSSProperties) : undefined;
};

export function StickerView({ sticker, character, size = 84 }: { sticker: Sticker; character: CharacterId; size?: number }) {
  return (
    <span className="sticker-art" style={{ ...palStyle(character), width: size } as CSSProperties}>
      <Mascot id={character} mood={sticker.mood} wave={sticker.wave} limbs size="100%" />
      <span className="sticker-badge">{sticker.badge}</span>
      <span className="sticker-label">{sticker.label}</span>
    </span>
  );
}

function MessageBody({ msg, character }: { msg: ChatMessage; character: CharacterId }) {
  const sticker = stickerOf(msg.text);
  if (sticker) {
    return (
      <div className="chat-sticker">
        <StickerView sticker={sticker} character={character} />
      </div>
    );
  }
  if (jumboEmoji(msg.text)) return <div className="chat-jumbo">{msg.text}</div>;
  return <div className="chat-bubble">{msg.text}</div>;
}

/**
 * The room chat: messages grouped by speaker in their pal's colour, pal stickers, an emoji
 * picker and one-tap phrases. `compact` is the side panel on wide screens; `fill` makes the
 * list take whatever height its container has (the chat sheet).
 */
export function ChatPanel({ compact, fill }: { compact?: boolean; fill?: boolean }) {
  const chat = useOnline((s) => s.chat);
  const myId = useOnline((s) => s.myId);
  const seats = useOnline((s) => s.room?.seats);
  const say = useOnline((s) => s.say);
  const markRead = useOnline((s) => s.markChatRead);
  const profilePal = useApp((s) => s.profile.character);
  const [text, setText] = useState('');
  const [tray, setTray] = useState<'stickers' | 'emoji' | null>(null);
  const [group, setGroup] = useState('recent');
  const [recent, setRecent] = useState(recentEmoji);
  /** Messages that arrived while the player was scrolled up reading. */
  const [behind, setBehind] = useState(0);
  const list = useRef<HTMLDivElement>(null);
  const atBottom = useRef(true);
  const lastId = useRef<string | null>(null);
  const lastSent = useRef(0);
  /** Messages waiting for their turn to be sent: dropped if the chat goes away first (e.g. on leaving the room). */
  const queued = useRef(new Set<ReturnType<typeof setTimeout>>());

  useEffect(() => {
    const timers = queued.current;
    return () => timers.forEach(clearTimeout);
  }, []);

  const myPal = (seats?.find((s) => s.id === myId)?.character as CharacterId | undefined) ?? profilePal;
  const items = useMemo(() => groupChat(chat), [chat]);

  const toBottom = (smooth = true) => {
    const el = list.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
    atBottom.current = true;
    setBehind(0);
  };

  // Follow the conversation, unless the player has scrolled up to read (then just count what's new).
  useLayoutEffect(() => {
    const el = list.current;
    const last = chat[chat.length - 1];
    if (!el || !last) return;
    if (el.offsetParent !== null) markRead(); // on screen right now
    if (last.id === lastId.current) return;
    const first = lastId.current === null;
    lastId.current = last.id;
    if (first || atBottom.current || last.from === myId) toBottom(!first);
    else if (!last.system) setBehind((n) => n + 1);
  }, [chat, myId, markRead]);

  // The list changes height when the tray opens: stay at the latest message.
  useEffect(() => {
    if (atBottom.current) toBottom(false);
  }, [tray]);

  const send = (raw: string) => {
    const clean = raw.trim().slice(0, MAX_LEN);
    if (!clean) return;
    const wait = Math.max(0, lastSent.current + SEND_GAP_MS - Date.now());
    lastSent.current = Date.now() + wait;
    if (wait) {
      const id = setTimeout(() => {
        queued.current.delete(id);
        say(clean);
      }, wait);
      queued.current.add(id);
    } else say(clean);
    atBottom.current = true;
  };

  const pickEmoji = (emoji: string) => {
    sound.play('pop');
    setText((t) => (t + emoji).slice(0, MAX_LEN));
    setRecent(rememberEmoji(emoji));
  };

  const shown = group === 'recent' ? recent : (EMOJI_GROUPS.find((g) => g.id === group)?.emoji ?? recent);

  return (
    <div className={['chat', compact ? 'chat--compact' : '', fill ? 'chat--fill' : '', tray ? 'chat--tray' : ''].filter(Boolean).join(' ')}>
      <div className="chat-scroll">
        <div
          className="chat-list"
          ref={list}
          onScroll={(e) => {
            const el = e.currentTarget;
            atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
            if (atBottom.current && behind) setBehind(0);
          }}
        >
          {/* system lines first, then the "say hi" nudge while nobody has spoken */}
          {items.map((it) => {
            if (it.kind === 'system') {
              return (
                <div key={it.key} className="chat-sys">
                  <span>{it.msg.text}</span>
                </div>
              );
            }
            const mine = it.from === myId;
            const pal = it.character ?? 'cherry';
            return (
              <div key={it.key} className={mine ? 'chat-group is-me' : 'chat-group'} style={palStyle(pal)}>
                {!mine && <Avatar id={pal} size={30} className="chat-ava" />}
                <div className="chat-stack">
                  {!mine && <span className="chat-name">{it.name}</span>}
                  {it.msgs.map((m) => (
                    <MessageBody key={m.id} msg={m} character={pal} />
                  ))}
                  <span className="chat-time">{clock(it.msgs[it.msgs.length - 1].at)}</span>
                </div>
              </div>
            );
          })}
          {!chat.some((m) => !m.system) && (
            <div className="chat-empty">
              <Mascot id={myPal} mood="happy" limbs wave size={72} />
              <p>It&apos;s quiet in here…</p>
              <button type="button" className="chat-hello" onClick={() => send(stickerText('hi'))}>
                Say hi 👋
              </button>
            </div>
          )}
        </div>
        {behind > 0 && (
          <button type="button" className="chat-new" onClick={() => toBottom()}>
            <ArrowDown size={14} /> {behind} new {behind === 1 ? 'message' : 'messages'}
          </button>
        )}
      </div>

      <div className="chat-quick" role="group" aria-label="Quick replies">
        {QUICK_CHAT.map((q) => (
          <button
            key={q}
            type="button"
            onClick={() => {
              sound.play('pop');
              send(q);
            }}
          >
            {q}
          </button>
        ))}
      </div>

      <form
        className="chat-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (!text.trim()) return;
          send(text);
          setText('');
        }}
      >
        <button
          type="button"
          className={tray ? 'chat-tool is-on' : 'chat-tool'}
          onClick={() => {
            sound.play('click');
            setTray((t) => (t ? null : 'stickers'));
          }}
          aria-label={tray ? 'Hide stickers and emoji' : 'Stickers and emoji'}
          aria-expanded={!!tray}
        >
          {tray ? <Keyboard size={20} /> : <Smile size={20} />}
        </button>
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          maxLength={MAX_LEN}
          placeholder="Message the table…"
          aria-label="Chat message"
          enterKeyHint="send"
          autoComplete="off"
        />
        <button type="submit" className="chat-send" aria-label="Send" disabled={!text.trim()}>
          <ArrowUp size={20} strokeWidth={2.6} />
        </button>
      </form>

      {tray && (
        <div className="chat-tray">
          <div className="chat-tabs" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={tray === 'stickers'}
              className={tray === 'stickers' ? 'is-on' : ''}
              onClick={() => setTray('stickers')}
            >
              Stickers
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tray === 'emoji'}
              className={tray === 'emoji' ? 'is-on' : ''}
              onClick={() => setTray('emoji')}
            >
              Emoji
            </button>
          </div>
          {tray === 'stickers' ? (
            <div className="sticker-grid">
              {STICKERS.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  className="sticker-pick"
                  onClick={() => {
                    sound.play('pop');
                    send(stickerText(s.id));
                    setTray(null);
                  }}
                  aria-label={`Send sticker: ${s.label}`}
                >
                  <StickerView sticker={s} character={myPal} size={62} />
                </button>
              ))}
            </div>
          ) : (
            <>
              <div className="emoji-groups" role="tablist">
                <button type="button" className={group === 'recent' ? 'is-on' : ''} onClick={() => setGroup('recent')} aria-label="Recently used">
                  <Clock3 size={17} />
                </button>
                {EMOJI_GROUPS.map((g) => (
                  <button key={g.id} type="button" className={group === g.id ? 'is-on' : ''} onClick={() => setGroup(g.id)} aria-label={g.label}>
                    {g.icon}
                  </button>
                ))}
              </div>
              <div className="emoji-grid">
                {shown.map((e) => (
                  <button key={e} type="button" onClick={() => pickEmoji(e)}>
                    {e}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
