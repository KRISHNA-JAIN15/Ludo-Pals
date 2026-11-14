import type { ChatMessage } from '../../shared/protocol';
import type { Mood } from './Mascot';

/**
 * Stickers are the sender's own pal pulling a face. They travel as ordinary chat text
 * ("::gg::"), so the server needs to know nothing about them.
 */
export interface Sticker {
  id: string;
  label: string;
  mood: Mood;
  /** A small emoji pinned to the corner. */
  badge: string;
  wave?: boolean;
}

export const STICKERS: Sticker[] = [
  { id: 'hi', label: 'Hi!', mood: 'happy', badge: '👋', wave: true },
  { id: 'gg', label: 'GG!', mood: 'joy', badge: '🏆' },
  { id: 'lol', label: 'LOL', mood: 'joy', badge: '😂' },
  { id: 'nice', label: 'Nice move!', mood: 'happy', badge: '👏' },
  { id: 'oops', label: 'Oops!', mood: 'shock', badge: '😅' },
  { id: 'nooo', label: 'Nooo!', mood: 'sad', badge: '💔' },
  { id: 'hurry', label: 'Hurry up!', mood: 'think', badge: '⏱️' },
  { id: 'six', label: 'Need a six!', mood: 'think', badge: '🎲' },
  { id: 'bonk', label: 'BONK!', mood: 'smug', badge: '💥' },
  { id: 'revenge', label: 'Revenge!', mood: 'smug', badge: '😈' },
  { id: 'lucky', label: 'So lucky!', mood: 'shock', badge: '🍀' },
  { id: 'thanks', label: 'Thanks!', mood: 'happy', badge: '🙏' },
];

const STICKER_BY_ID = new Map(STICKERS.map((s) => [s.id, s]));

export const stickerText = (id: string) => `::${id}::`;

export function stickerOf(text: string): Sticker | null {
  const m = /^::([a-z]+)::$/.exec(text.trim());
  return (m && STICKER_BY_ID.get(m[1])) || null;
}

const segmenter = typeof Intl !== 'undefined' && 'Segmenter' in Intl ? new Intl.Segmenter(undefined, { granularity: 'grapheme' }) : null;
const EMOJI = /\p{Extended_Pictographic}|\p{Regional_Indicator}/u;

/** 1–3 emoji and nothing else: shown big, without a bubble. */
export function jumboEmoji(text: string): boolean {
  const t = text.trim();
  if (!t || t.length > 40 || /[\p{L}\p{N}]/u.test(t)) return false;
  const parts = segmenter ? [...segmenter.segment(t)].map((s) => s.segment).filter((s) => s.trim()) : [...t.replace(/\s/g, '')];
  return parts.length >= 1 && parts.length <= (segmenter ? 3 : 8) && parts.every((p) => EMOJI.test(p));
}

/** What a message looks like in one short line (speech bubbles next to a player's chip). */
export function previewOf(text: string): string {
  const s = stickerOf(text);
  if (s) return `${s.badge} ${s.label}`;
  const t = text.trim();
  return t.length > 64 ? `${t.slice(0, 61).trimEnd()}…` : t;
}

export const EMOJI_GROUPS: { id: string; icon: string; label: string; emoji: string[] }[] = [
  {
    id: 'smileys',
    icon: '😀',
    label: 'Smileys',
    emoji: (
      '😀 😄 😁 😆 😂 🤣 😊 😇 🙂 😉 😍 🥰 😘 😋 😜 🤪 😎 🤩 🥳 😏 😒 😞 😔 😢 😭 😤 😠 ' +
      '😡 🤬 🤯 😳 🥵 🥶 😱 😨 😰 🤗 🤔 🤭 🤫 🙄 😬 😴 🤤 🤑 🤠 😈 👻 💀 🤡 💩 🙈 🙉 🙊'
    ).split(' '),
  },
  {
    id: 'hands',
    icon: '👍',
    label: 'Hands',
    emoji: '👍 👎 👏 🙌 🙏 🤝 💪 ✌️ 🤞 🤟 🤘 👌 🤌 👋 🤙 👊 ✊ 🫶 🫡 🤷 🤦 🙋 💃 🕺'.split(' '),
  },
  {
    id: 'hearts',
    icon: '❤️',
    label: 'Hearts',
    emoji: '❤️ 🧡 💛 💚 💙 💜 🖤 🤍 💔 💖 💯 🔥 ✨ ⭐ 🌟 💥 💫 🎉 🎊 ⚡ 💤 ❗ ❓ ✅ ❌'.split(' '),
  },
  {
    id: 'game',
    icon: '🎲',
    label: 'Game',
    emoji: '🎲 🏆 🥇 🥈 🥉 🎯 🎮 👑 🪙 💰 🍀 🚀 ⏱️ ⏳ 🏠 🏁 ⚔️ 🛡️ 🎁 🍿 🍕 🍔 ☕ 🍰 🐶 🐱 🦁 🐵 🐢 🦄'.split(' '),
  },
];

const RECENT_KEY = 'ludo-pals:emoji';
const DEFAULT_RECENT = ['😂', '🔥', '👏', '😭', '😎', '🙏', '❤️', '😡'];

export function recentEmoji(): string[] {
  try {
    const list = JSON.parse(localStorage.getItem(RECENT_KEY) ?? 'null') as unknown;
    if (Array.isArray(list) && list.every((e) => typeof e === 'string') && list.length) return list.slice(0, 16);
  } catch {
    /* fall through */
  }
  return DEFAULT_RECENT;
}

export function rememberEmoji(emoji: string): string[] {
  const next = [emoji, ...recentEmoji().filter((e) => e !== emoji)].slice(0, 16);
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    /* private mode */
  }
  return next;
}

export type ChatItem =
  | { kind: 'system'; key: string; msg: ChatMessage }
  | { kind: 'group'; key: string; from: string; name: string; character: ChatMessage['character']; msgs: ChatMessage[] };

/** Consecutive messages from one player (sent close together) share a name and an avatar. */
export function groupChat(chat: ChatMessage[]): ChatItem[] {
  const items: ChatItem[] = [];
  for (const m of chat) {
    if (m.system) {
      items.push({ kind: 'system', key: m.id, msg: m });
      continue;
    }
    const last = items[items.length - 1];
    if (last?.kind === 'group' && last.from === m.from && m.at - last.msgs[last.msgs.length - 1].at < 3 * 60_000) last.msgs.push(m);
    else items.push({ kind: 'group', key: m.id, from: m.from, name: m.name, character: m.character, msgs: [m] });
  }
  return items;
}

export function clock(at: number): string {
  try {
    return new Date(at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  } catch {
    return '';
  }
}
