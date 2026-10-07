import { createGame, humanMove, humanRoll, runPending, setAuto, setConnected, shiftClock, startGame, type StepCtx } from './rules';
import { newSeed } from './random';
import type { GameState, MatchConfig } from './types';

export { TIMING, moveDuration } from './rules';

export interface MatchHooks {
  onState: (state: GameState) => void;
  /** Fixed seed (tests, replays); a fresh one otherwise. */
  seed?: number;
  now?: () => number;
  /** End the game once only bots are left racing (default true). */
  endWhenOnlyBots?: boolean;
}

/** Runs a match in-process (local games): fires `state.pending` with setTimeout and supports pausing. */
export class Match {
  state: GameState;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private paused = false;
  private pausedAt = 0;
  private destroyed = false;
  private seed: number;
  private now: () => number;
  private hooks: MatchHooks;

  constructor(cfg: MatchConfig, hooks: MatchHooks) {
    this.hooks = hooks;
    this.seed = hooks.seed ?? newSeed();
    this.now = hooks.now ?? Date.now;
    this.state = createGame(cfg, Math.random().toString(36).slice(2, 10), this.now());
  }

  start(firstPlayer?: number) {
    startGame(this.state, this.ctx(), firstPlayer);
    this.commit();
  }

  /** The game's seed (needed to save and resume it). */
  get gameSeed() {
    return this.seed;
  }

  /**
   * Continue a saved game (construct with the saved seed first). Time spent away doesn't
   * count against turn timers or pending transitions.
   */
  resumeFrom(saved: GameState, savedAt: number) {
    this.state = structuredClone(saved);
    if (!shiftClock(this.state, this.ctx(), Math.max(0, this.now() - savedAt))) this.state.now = this.now();
    this.commit();
  }

  destroy() {
    this.destroyed = true;
    this.clearTimer();
  }

  get isPaused() {
    return this.paused;
  }

  /** Freeze the match: pending transitions and the turn clock stop. */
  pause() {
    if (this.paused || this.destroyed) return;
    this.paused = true;
    this.pausedAt = this.now();
    this.clearTimer();
  }

  resume() {
    if (!this.paused || this.destroyed) return;
    this.paused = false;
    if (shiftClock(this.state, this.ctx(), this.now() - this.pausedAt)) this.commit();
    else this.arm();
  }

  roll(playerId: string): boolean {
    return this.step(() => humanRoll(this.state, this.ctx(), playerId));
  }

  move(playerId: string, token: number): boolean {
    return this.step(() => humanMove(this.state, this.ctx(), playerId, token));
  }

  setAuto(playerId: string, auto: boolean) {
    this.step(() => setAuto(this.state, this.ctx(), playerId, auto), true);
  }

  setConnected(playerId: string, connected: boolean) {
    this.step(() => setConnected(this.state, this.ctx(), playerId, connected), true);
  }

  // ---------------------------------------------------------------------------

  private ctx(): StepCtx {
    return { now: this.now(), seed: this.seed, endWhenOnlyBots: this.hooks.endWhenOnlyBots };
  }

  private step(fn: () => boolean, evenWhenPaused = false): boolean {
    if (this.destroyed || (this.paused && !evenWhenPaused)) return false;
    const changed = fn();
    if (changed) this.commit();
    return changed;
  }

  private commit() {
    if (this.destroyed) return;
    this.hooks.onState(structuredClone(this.state));
    this.arm();
  }

  private clearTimer() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  private arm() {
    this.clearTimer();
    const p = this.state.pending;
    if (!p || this.paused || this.destroyed) return;
    this.timer = setTimeout(
      () => {
        this.timer = null;
        if (runPending(this.state, this.ctx())) this.commit();
      },
      Math.max(0, p.at - this.now()),
    );
  }
}
