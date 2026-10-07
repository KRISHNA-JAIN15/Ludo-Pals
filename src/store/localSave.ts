import type { GameState, MatchConfig } from '../../shared/types';

/** A local (same-device) game saved so a refresh or a closed tab doesn't lose it. */
export interface SavedGame {
  v: 1;
  cfg: MatchConfig;
  state: GameState;
  seed: number;
  savedAt: number;
}

const KEY = 'ludo-pals:local-game';

export function saveLocalGame(game: Omit<SavedGame, 'v'>) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ v: 1, ...game }));
  } catch {
    /* storage full or unavailable: the game just won't be resumable */
  }
}

export function loadLocalGame(): SavedGame | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const g = JSON.parse(raw) as SavedGame;
    // Ignore finished games and saves from before seeded games existed.
    if (g?.v !== 1 || !g.state || g.state.phase === 'over' || typeof g.seed !== 'number') return null;
    return g;
  } catch {
    return null;
  }
}

export function clearLocalGame() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
