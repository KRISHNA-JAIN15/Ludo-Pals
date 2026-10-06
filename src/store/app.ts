import { create } from 'zustand';
import { setHaptics, sound } from '../audio/sound';
import { finishAt } from '../../shared/board';
import type { CharacterId, GameState, MatchConfig } from '../../shared/types';

export type Screen = 'splash' | 'hub' | 'setup' | 'online' | 'lobby' | 'game' | 'results';
export type HubTab = 'play' | 'pals' | 'stats' | 'settings';

export interface Profile {
  name: string;
  character: CharacterId;
  coins: number;
  games: number;
  wins: number;
  podiums: number;
  captures: number;
  sixes: number;
  homeRuns: number;
}

export interface Settings {
  sound: boolean;
  music: boolean;
  vibration: boolean;
  speed: 'normal' | 'fast';
  autoMove: boolean;
}

export interface ResultSummary {
  state: GameState;
  /** Player index of this device's owner, if they played. */
  me: number | null;
  online: boolean;
  coins: number;
  config: MatchConfig | null;
}

export interface Toast {
  id: number;
  text: string;
  tone: 'info' | 'error' | 'success';
}

interface AppStore {
  screen: Screen;
  tab: HubTab;
  profile: Profile;
  settings: Settings;
  localConfig: MatchConfig | null;
  result: ResultSummary | null;
  toasts: Toast[];
  go: (screen: Screen) => void;
  setTab: (tab: HubTab) => void;
  updateProfile: (p: Partial<Profile>) => void;
  updateSettings: (s: Partial<Settings>) => void;
  startLocal: (cfg: MatchConfig) => void;
  finishGame: (r: Omit<ResultSummary, 'coins'>) => void;
  toast: (text: string, tone?: Toast['tone']) => void;
  dismissToast: (id: number) => void;
}

const KEY = 'ludo-pals:v1';
const recorded = new Set<string>();

const defaults = (): { profile: Profile; settings: Settings } => ({
  profile: {
    name: `Pal ${100 + Math.floor(Math.random() * 900)}`,
    character: 'cherry',
    coins: 250,
    games: 0,
    wins: 0,
    podiums: 0,
    captures: 0,
    sixes: 0,
    homeRuns: 0,
  },
  settings: { sound: true, music: true, vibration: true, speed: 'normal', autoMove: true },
});

function load() {
  const d = defaults();
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return d;
    const parsed = JSON.parse(raw);
    return { profile: { ...d.profile, ...parsed.profile }, settings: { ...d.settings, ...parsed.settings } };
  } catch {
    return d;
  }
}

function save(profile: Profile, settings: Settings) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ profile, settings }));
  } catch {
    /* private mode */
  }
}

export const COIN_TABLE = [100, 60, 35, 20, 12, 8];

export function coinsFor(state: GameState, me: number): number {
  const p = state.players[me];
  if (!p?.rank) return 0;
  return (COIN_TABLE[p.rank - 1] ?? 5) + p.stats.captures * 5;
}

const initial = load();
sound.setSfx(initial.settings.sound);
sound.setMusic(initial.settings.music);
setHaptics(initial.settings.vibration);

function initialScreen(): Screen {
  try {
    if (new URLSearchParams(location.search).get('room')) return 'online';
  } catch {
    /* ignore */
  }
  return 'splash';
}

let toastId = 0;

export const useApp = create<AppStore>((set, get) => ({
  screen: initialScreen(),
  tab: 'play',
  profile: initial.profile,
  settings: initial.settings,
  localConfig: null,
  result: null,
  toasts: [],
  go: (screen) => {
    set({ screen });
    window.scrollTo(0, 0);
  },
  setTab: (tab) => set({ tab }),
  updateProfile: (p) => {
    const profile = { ...get().profile, ...p };
    set({ profile });
    save(profile, get().settings);
  },
  updateSettings: (s) => {
    const settings = { ...get().settings, ...s };
    set({ settings });
    sound.setSfx(settings.sound);
    sound.setMusic(settings.music);
    setHaptics(settings.vibration);
    save(get().profile, settings);
  },
  startLocal: (cfg) => set({ localConfig: cfg, screen: 'game', result: null }),
  finishGame: (r) => {
    const { state, me } = r;
    let coins = 0;
    if (me !== null && !recorded.has(state.id)) {
      recorded.add(state.id);
      const p = state.players[me];
      coins = coinsFor(state, me);
      const prof = get().profile;
      get().updateProfile({
        coins: prof.coins + coins,
        games: prof.games + 1,
        wins: prof.wins + (p.rank === 1 ? 1 : 0),
        podiums: prof.podiums + (p.rank > 0 && p.rank <= 3 ? 1 : 0),
        captures: prof.captures + p.stats.captures,
        sixes: prof.sixes + p.stats.sixes,
        homeRuns: prof.homeRuns + p.tokens.filter((t) => t === finishAt(state.arms)).length,
      });
    }
    set({ result: { ...r, coins }, screen: 'results' });
  },
  toast: (text, tone = 'info') => {
    const id = ++toastId;
    set({ toasts: [...get().toasts, { id, text, tone }].slice(-3) });
    setTimeout(() => get().dismissToast(id), 3200);
  },
  dismissToast: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) }),
}));

/**
 * A random secret identifying this browser tab to the game server. It never appears in room
 * data (players are shown by a separate public id), so nobody can act on your behalf.
 */
export function tabSecret(): string {
  const k = 'ludo-pals:secret';
  try {
    let id = sessionStorage.getItem(k);
    if (!id) {
      id = crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
      sessionStorage.setItem(k, id);
    }
    return id;
  } catch {
    return `anon-${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`;
  }
}
