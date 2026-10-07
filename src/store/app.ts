import { create } from 'zustand';
import { setHaptics, sound } from '../audio/sound';
import { finishAt } from '../../shared/board';
import type { CharacterId, GameState, MatchConfig } from '../../shared/types';
import type { SavedGame } from './localSave';

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
  /** A saved local game to continue instead of starting fresh. */
  localResume: SavedGame | null;
  result: ResultSummary | null;
  toasts: Toast[];
  go: (screen: Screen) => void;
  setTab: (tab: HubTab) => void;
  updateProfile: (p: Partial<Profile>) => void;
  updateSettings: (s: Partial<Settings>) => void;
  startLocal: (cfg: MatchConfig, resume?: SavedGame) => void;
  finishGame: (r: Omit<ResultSummary, 'coins'>) => void;
  toast: (text: string, tone?: Toast['tone']) => void;
  dismissToast: (id: number) => void;
}

const KEY = 'ludo-pals:v1';
const RECORDED_KEY = 'ludo-pals:recorded';

/** Games already counted towards stats/coins. Persisted so a refresh on the results screen can't pay out twice. */
function alreadyRecorded(gameId: string): boolean {
  try {
    const ids: string[] = JSON.parse(localStorage.getItem(RECORDED_KEY) ?? '[]');
    if (ids.includes(gameId)) return true;
    localStorage.setItem(RECORDED_KEY, JSON.stringify([...ids, gameId].slice(-50)));
    return false;
  } catch {
    return false;
  }
}

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

function applySettings(s: Settings) {
  sound.setSfx(s.sound);
  sound.setMusic(s.music);
  setHaptics(s.vibration);
}

const initial = load();
// Save straight away: a first-time player keeps the name made up for them instead of getting a new one each visit.
save(initial.profile, initial.settings);
applySettings(initial.settings);

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
  localResume: null,
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
    applySettings(settings);
    save(get().profile, settings);
  },
  startLocal: (cfg, resume) => set({ localConfig: cfg, localResume: resume ?? null, screen: 'game', result: null }),
  finishGame: (r) => {
    const { state, me } = r;
    let coins = 0;
    if (me !== null && !alreadyRecorded(state.id)) {
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

// Another tab renamed you or banked coins: pick that up, so this tab never saves stale data over it.
window.addEventListener('storage', (e) => {
  if (e.key !== KEY || !e.newValue) return;
  const { profile, settings } = load();
  useApp.setState({ profile, settings });
  applySettings(settings);
});

const SECRET_KEY = 'ludo-pals:secret'; // this tab's identity (survives refreshes)
const LAST_SECRET_KEY = 'ludo-pals:last-secret'; // the device's most recent identity
const aliveKey = (secret: string) => `ludo-pals:alive:${secret}`; // "a tab is using this right now"
const ALIVE_EVERY_MS = 5_000;
// Background tabs may only get timers once a minute, so allow a generous margin before calling it dead.
const ALIVE_STALE_MS = 75_000;

function newSecret() {
  return crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
}

let cachedSecret: string | null = null;

/**
 * The secret identifying this player to the game server. It never appears in room data
 * (players are shown by a separate public id), so nobody can act on your behalf.
 *
 * It survives refreshes, and closing the tab too: a new tab adopts the device's last identity
 * when no other open tab is using it, so someone who closed the tab (or whose phone killed the
 * browser) can get back to their game. Two tabs open at the same time still get separate
 * identities, which keeps two-player testing on one machine possible.
 */
export function tabSecret(): string {
  if (cachedSecret) return cachedSecret;
  try {
    let secret = sessionStorage.getItem(SECRET_KEY);
    if (!secret) {
      const last = localStorage.getItem(LAST_SECRET_KEY);
      const aliveAt = last ? Number(localStorage.getItem(aliveKey(last)) ?? 0) : 0;
      secret = last && Date.now() - aliveAt > ALIVE_STALE_MS ? last : newSecret();
      sessionStorage.setItem(SECRET_KEY, secret);
    }
    const mine = secret;
    const markAlive = () => {
      try {
        localStorage.setItem(aliveKey(mine), String(Date.now()));
        localStorage.setItem(LAST_SECRET_KEY, mine);
      } catch {
        /* ignore */
      }
    };
    markAlive();
    setInterval(markAlive, ALIVE_EVERY_MS);
    // Closing (or refreshing) frees the identity at once; a refresh simply picks it up again.
    window.addEventListener('pagehide', () => {
      try {
        localStorage.removeItem(aliveKey(mine));
      } catch {
        /* ignore */
      }
    });
    window.addEventListener('pageshow', markAlive);
    cachedSecret = mine;
  } catch {
    cachedSecret = `anon-${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`;
  }
  return cachedSecret;
}
