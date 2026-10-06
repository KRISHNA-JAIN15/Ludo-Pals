import type { CharacterId, ModeId, Rules } from './types';

export interface CharacterMeta {
  id: CharacterId;
  name: string;
  color: string;
  dark: string;
  light: string;
  tagline: string;
  bio: string;
  catchphrase: string;
}

export const CHARACTERS: Record<CharacterId, CharacterMeta> = {
  cherry: {
    id: 'cherry',
    name: 'Cherry',
    color: '#F2617A',
    dark: '#C63E59',
    light: '#FCD5DC',
    tagline: 'Sweet face, savage moves',
    bio: 'Grew up on a fruit stand and never lost a game of tag. Will bonk you and say sorry after.',
    catchphrase: 'Oopsie, was that your token?',
  },
  mossy: {
    id: 'mossy',
    name: 'Mossy',
    color: '#3FA27C',
    dark: '#2A7A5B',
    light: '#C9E9DB',
    tagline: 'Slow and steady wins',
    bio: 'A sleepy little bush who has been walking home since 1987. Somehow always gets there.',
    catchphrase: 'No rush. I am basically a plant.',
  },
  sunny: {
    id: 'sunny',
    name: 'Sunny',
    color: '#F6C443',
    dark: '#D49D1B',
    light: '#FCEDB9',
    tagline: 'Rolls with a smile',
    bio: 'A box-shaped cat with a sunny attitude. Believes every roll is a six if you smile hard enough.',
    catchphrase: 'Six! Six! Six! ...five is fine too.',
  },
  splash: {
    id: 'splash',
    name: 'Splash',
    color: '#58B4E8',
    dark: '#2F8BC2',
    light: '#D0EAF9',
    tagline: 'Cool, calm, unstoppable',
    bio: 'A raindrop who fell from the sky straight onto a Ludo board and decided to stay.',
    catchphrase: 'Stay hydrated. Stay safe squares.',
  },
  boo: {
    id: 'boo',
    name: 'Boo',
    color: '#8462D3',
    dark: '#5D3FAA',
    light: '#DED4F5',
    tagline: 'Sneaks up from behind',
    bio: 'A friendly ghost who loves surprises, especially landing right on top of you.',
    catchphrase: 'Boo! Back to base you go.',
  },
  blaze: {
    id: 'blaze',
    name: 'Blaze',
    color: '#F28A36',
    dark: '#C9661A',
    light: '#FCDDC0',
    tagline: 'Hot-headed hopper',
    bio: 'A tiny flame with a big temper. Moves fast, thinks later, wins often anyway.',
    catchphrase: 'Too hot to handle!',
  },
};

/** Clockwise seat order, matching the classic red / green / yellow / blue board. */
export const CHARACTER_ORDER: CharacterId[] = ['cherry', 'mossy', 'sunny', 'splash', 'boo', 'blaze'];

export const BOT_NAMES = [
  'Rollo',
  'Dicey',
  'Pip',
  'Captain Six',
  'Bonkers',
  'Tumble',
  'Lucky Lu',
  'Sir Hops',
  'Noodle',
  'Zippy',
  'Biscuit',
  'Marbles',
  'Wobbles',
  'Pickle',
];

export interface ModeMeta {
  id: ModeId;
  label: string;
  blurb: string;
  rules: Rules;
}

const base = {
  extraOnSix: true,
  extraOnCapture: true,
  extraOnHome: true,
  threeSixes: true,
  turnSeconds: 0,
  autoMove: true,
};

export const MODES: Record<ModeId, ModeMeta> = {
  classic: {
    id: 'classic',
    label: 'Classic',
    blurb: '4 tokens each. Roll a 6 to leave the yard.',
    rules: { ...base, mode: 'classic', tokens: 4, releaseOn: [6] },
  },
  quick: {
    id: 'quick',
    label: 'Quick',
    blurb: '2 tokens each. Roll a 1 or 6 to leave the yard.',
    rules: { ...base, mode: 'quick', tokens: 2, releaseOn: [1, 6] },
  },
};

export function pickBotName(taken: string[], seed = Math.random()): string {
  const free = BOT_NAMES.filter((n) => !taken.includes(n));
  const pool = free.length ? free : BOT_NAMES;
  return pool[Math.floor(seed * pool.length) % pool.length];
}
