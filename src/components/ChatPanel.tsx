import { Send } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { QUICK_CHAT } from '../../shared/protocol';
import { useOnline } from '../net/online';
import { Avatar } from './ui';

export function ChatPanel({ compact }: { compact?: boolean }) {
  const chat = useOnline((s) => s.chat);
  const myId = useOnline((s) => s.myId);
  const say = useOnline((s) => s.say);
  const [text, setText] = useState('');
  const list = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = list.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  }, [chat.length]);

  return (
    <div className={`chat ${compact ? 'chat--compact' : ''}`}>
      <div className="chat-list" ref={list}>
        {chat.length === 0 && <p className="chat-empty">No messages yet. Say hi 👋</p>}
        {chat.map((m) =>
          m.system ? (
            <div key={m.id} className="chat-sys">
              {m.text}
            </div>
          ) : (
            <div key={m.id} className={`chat-msg ${m.from === myId ? 'is-me' : ''}`}>
              {m.character && <Avatar id={m.character} size={28} />}
              <div className="chat-bubble">
                <b>{m.from === myId ? 'You' : m.name}</b>
                <span>{m.text}</span>
              </div>
            </div>
          ),
        )}
      </div>
      <div className="chat-quick">
        {QUICK_CHAT.map((q) => (
          <button key={q} type="button" onClick={() => say(q)}>
            {q}
          </button>
        ))}
      </div>
      <form
        className="chat-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (!text.trim()) return;
          say(text);
          setText('');
        }}
      >
        <input value={text} onChange={(e) => setText(e.target.value)} maxLength={140} placeholder="Say something nice…" aria-label="Chat message" />
        <button type="submit" aria-label="Send" disabled={!text.trim()}>
          <Send size={18} />
        </button>
      </form>
    </div>
  );
}
