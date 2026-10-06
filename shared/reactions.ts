import type { GameState } from './types';

const BRAG = ['😎', '🔥', '😂', '💀', '👏'];
const SULK = ['😭', '😡', '🤯', '🙏'];

/** Emotes bots fire off in response to what just happened (makes them feel alive). */
export function botReactions(state: GameState, rng: () => number = Math.random): { player: number; emoji: string; delay: number }[] {
  const out: { player: number; emoji: string; delay: number }[] = [];
  const isBot = (i: number) => state.players[i]?.kind === 'bot';
  const pick = (list: string[]) => list[Math.floor(rng() * list.length)];
  for (const e of state.events) {
    if (e.type === 'move' && e.captures.length) {
      if (isBot(e.player) && rng() < 0.55) out.push({ player: e.player, emoji: pick(BRAG), delay: 700 });
      for (const c of e.captures) {
        if (isBot(c.player) && rng() < 0.6) out.push({ player: c.player, emoji: pick(SULK), delay: 1100 });
      }
    } else if (e.type === 'finish' && isBot(e.player) && rng() < 0.7) {
      out.push({ player: e.player, emoji: e.rank === 1 ? '😎' : '👏', delay: 600 });
    } else if (e.type === 'threeSixes' && isBot(e.player) && rng() < 0.6) {
      out.push({ player: e.player, emoji: '🤯', delay: 500 });
    }
  }
  return out;
}
