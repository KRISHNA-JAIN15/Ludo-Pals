import { useEffect, useRef, useState } from 'react';
import { CHARACTERS } from '../../shared/characters';
import { TIMING } from '../../shared/rules';
import type { CharacterId, GameState } from '../../shared/types';
import { haptic, sound } from '../audio/sound';
import type { Mood } from '../components/Mascot';
import { burst, celebrate } from './confetti';

export interface Banner {
  id: number;
  title: string;
  sub?: string;
  tone: 'six' | 'bonk' | 'home' | 'turn' | 'info' | 'win' | 'bad';
  character?: CharacterId;
}

export const ordinal = (n: number) => {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
};

const BOT_QUIPS = ['Hmm… 🤔', 'Here goes!', 'Come on, six!', 'Watch this.', 'Easy peasy.', 'Feeling lucky 🍀', 'Big brain time.', 'Rolling rolling…'];

interface FeedOpts {
  isMine: (player: number) => boolean;
  /** More than one human shares this device (pass & play). */
  passAndPlay: boolean;
  onOver: (state: GameState) => void;
}

export function useGameFeed(state: GameState | null, { isMine, passAndPlay, onOver }: FeedOpts) {
  const [banner, setBanner] = useState<Banner | null>(null);
  const [moods, setMoods] = useState<Record<number, Mood>>({});
  const [quip, setQuip] = useState<string>('');
  const lastKey = useRef('');
  const bannerId = useRef(0);
  const bannerTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const moodTimers = useRef<Record<number, ReturnType<typeof setTimeout>>>({});
  /** Delayed effects (dice landing, banners, the jump to results). Cancelled if the screen goes away. */
  const later = useRef(new Set<ReturnType<typeof setTimeout>>());
  const opts = useRef({ isMine, passAndPlay, onOver });
  opts.current = { isMine, passAndPlay, onOver };

  useEffect(
    () => () => {
      if (bannerTimer.current) clearTimeout(bannerTimer.current);
      Object.values(moodTimers.current).forEach(clearTimeout);
      later.current.forEach(clearTimeout);
    },
    [],
  );

  useEffect(() => {
    if (!state) return;
    const key = `${state.id}:${state.seq}`;
    if (key === lastKey.current) return;
    const fresh = !lastKey.current.startsWith(`${state.id}:`);
    lastKey.current = key;
    if (fresh && !state.events.some((e) => e.type === 'start')) {
      // Joined (or rejoined) mid-game: don't replay old events, but don't strand them on a finished board.
      if (state.phase === 'over') later.current.add(setTimeout(() => opts.current.onOver(state), 600));
      return;
    }

    const { isMine: mine, passAndPlay: pnp, onOver: over } = opts.current;
    const after = (fn: () => void, ms: number) => {
      const id = setTimeout(() => {
        later.current.delete(id);
        fn();
      }, ms);
      later.current.add(id);
    };
    const name = (i: number) => state.players[i]?.name ?? '';
    const char = (i: number) => state.players[i]?.character;
    const speed = state.speed;

    const show = (b: Omit<Banner, 'id'>, ms = 1500) => {
      const id = ++bannerId.current;
      setBanner({ ...b, id });
      if (bannerTimer.current) clearTimeout(bannerTimer.current);
      bannerTimer.current = setTimeout(() => setBanner((cur) => (cur?.id === id ? null : cur)), ms);
    };
    const mood = (i: number, m: Mood, ms = 1800) => {
      setMoods((cur) => ({ ...cur, [i]: m }));
      clearTimeout(moodTimers.current[i]);
      moodTimers.current[i] = setTimeout(() => setMoods((cur) => ({ ...cur, [i]: 'idle' })), ms);
    };

    for (const e of state.events) {
      switch (e.type) {
        case 'start':
          sound.play('start');
          show({ title: `${name(state.turn)} goes first!`, sub: 'Let the games begin', tone: 'info', character: char(state.turn) }, 1800);
          break;
        case 'turn': {
          const pl = state.players[e.player];
          if (pl.kind === 'bot' || pl.auto) {
            setQuip(BOT_QUIPS[Math.floor(Math.random() * BOT_QUIPS.length)]);
            mood(e.player, 'think', 900 * speed);
          } else {
            setQuip('');
          }
          if (mine(e.player) && pl.kind === 'human' && !pl.auto) {
            sound.play('turn');
            haptic(25);
            if (pnp && !e.bonus) show({ title: `${pl.name}'s turn!`, sub: 'Pass the phone 📱', tone: 'turn', character: pl.character }, 1300);
          }
          break;
        }
        case 'roll': {
          sound.play('diceShake', { speed });
          const land = TIMING.roll * speed * 0.72;
          after(() => {
            sound.play('diceLand');
            if (e.value === 6) {
              sound.play('six');
              mood(e.player, 'happy');
              show(
                { title: 'SIX!', sub: state.rules.extraOnSix ? 'Roll again after moving' : undefined, tone: 'six', character: char(e.player) },
                1100,
              );
            }
          }, land);
          break;
        }
        case 'noMove':
          sound.play('noMove');
          mood(e.player, 'sad', 1400);
          if (mine(e.player)) show({ title: 'No moves', sub: `Rolled a ${e.value}`, tone: 'bad' }, 1100);
          break;
        case 'threeSixes':
          sound.play('error');
          mood(e.player, 'shock', 1800);
          show({ title: 'Three sixes!', sub: `${name(e.player)}'s turn is burned 🔥`, tone: 'bad', character: char(e.player) }, 1600);
          break;
        case 'move': {
          const hopTime = (e.from < 0 ? 1 : e.to - e.from) * TIMING.step * speed;
          if (e.captures.length) {
            after(() => {
              mood(e.player, 'smug', 2400);
              e.captures.forEach((c) => mood(c.player, 'sad', 2600));
              const victims = [...new Set(e.captures.map((c) => name(c.player)))].join(' & ');
              show({ title: 'BONK!', sub: `${name(e.player)} sent ${victims} home`, tone: 'bonk', character: char(e.player) }, 1700);
            }, hopTime);
          } else if (e.home) {
            after(() => {
              mood(e.player, 'joy', 2000);
              show({ title: 'Home run!', sub: `${name(e.player)} got a pal home 🏠`, tone: 'home', character: char(e.player) }, 1400);
            }, hopTime);
          }
          break;
        }
        case 'finish': {
          const pl = state.players[e.player];
          const meta = CHARACTERS[pl.character];
          after(() => {
            mood(e.player, 'joy', 4000);
            show(
              {
                title: `${pl.name} finished ${ordinal(e.rank)}!`,
                sub: e.rank === 1 ? 'What a legend 👑' : 'All pals home',
                tone: 'win',
                character: pl.character,
              },
              2200,
            );
            burst([meta.color, meta.light, '#ffffff', '#1C1813']);
            if (mine(e.player)) sound.play('win');
          }, 600);
          break;
        }
        case 'auto':
          if (mine(e.player) && e.auto) show({ title: 'Auto-play on', sub: 'A bot is playing for you', tone: 'info' }, 1600);
          break;
        case 'left':
          if (!mine(e.player)) {
            sound.play('noMove');
            mood(e.player, 'sad', 2400);
            show({ title: `${name(e.player)} left`, sub: 'A bot will finish their game', tone: 'info', character: char(e.player) }, 1800);
          }
          break;
        case 'over': {
          const myWin = state.ranking.length > 0 && mine(state.ranking[0]) && state.players[state.ranking[0]].kind === 'human';
          if (myWin) celebrate(Object.values(CHARACTERS).map((c) => c.color));
          else sound.play(state.players.some((p, i) => mine(i) && p.kind === 'human') ? 'lose' : 'win');
          after(() => over(state), 2300);
          break;
        }
      }
    }
  }, [state]);

  return { banner, moods, quip };
}
