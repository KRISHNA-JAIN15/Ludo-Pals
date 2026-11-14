export type CharacterId = 'cherry' | 'sunny' | 'splash' | 'mossy' | 'boo' | 'blaze';
export type BotLevel = 'easy' | 'normal' | 'hard';
export type SeatKind = 'human' | 'bot';
export type ModeId = 'classic' | 'quick';
/**
 * smart: "Action" dice weighted by what is happening on the board (see shared/dice.ts);
 * fair: balanced, seeded dice (each face once every six rolls); classic: independent random rolls.
 */
export type DiceMode = 'smart' | 'fair' | 'classic';
export type Mood = 'idle' | 'happy' | 'sad' | 'shock' | 'smug' | 'think';

export interface Rules {
  mode: ModeId;
  dice: DiceMode;
  /** Tokens per player (2-4). */
  tokens: number;
  /** Dice values that release a token from the yard. */
  releaseOn: number[];
  extraOnSix: boolean;
  extraOnCapture: boolean;
  extraOnHome: boolean;
  /** Three sixes in a row forfeits the turn. */
  threeSixes: boolean;
  /** Seconds per turn; 0 disables the timer. */
  turnSeconds: number;
  /** Move automatically when only one choice exists. */
  autoMove: boolean;
}

export interface SeatConfig {
  id: string;
  name: string;
  character: CharacterId;
  kind: SeatKind;
  botLevel?: BotLevel;
}

export interface MatchConfig {
  seats: SeatConfig[];
  rules: Rules;
  /** Animation speed multiplier (1 = normal, 0.6 = fast). */
  speed?: number;
}

export interface PlayerStats {
  captures: number;
  captured: number;
  sixes: number;
  moves: number;
  /** Rolls made so far (fair dice reads the player's sequence at this index). */
  rolls: number;
}

/** What the Action dice remember about a player's recent luck. */
export interface Luck {
  /** Rolls in a row that left this player with nothing to move. */
  dry: number;
  /** Rolls since this player's last six. */
  sinceSix: number;
  /** `rollCount` when one of their tokens was last sent home (-1000 = never). */
  hitAt: number;
  /** Who sent it home (player index, -1 = nobody). */
  hitBy: number;
}

export interface PlayerState {
  id: string;
  name: string;
  character: CharacterId;
  kind: SeatKind;
  botLevel: BotLevel;
  /** Which board arm this player owns. */
  arm: number;
  /** Token progress: -1 = yard, 0..LAST = track, HOME0.. = home column, FINISH = home. */
  tokens: number[];
  /** 0 = still playing, otherwise finishing position (1 = winner). */
  rank: number;
  /** A bot is playing on this player's behalf (timeout / disconnect). */
  auto: boolean;
  connected: boolean;
  /** Left the room for good (a bot finishes for them; they no longer hold the game open). */
  left: boolean;
  timeouts: number;
  stats: PlayerStats;
  /** Missing on games saved before Action dice existed (read it through `luckOf`). */
  luck?: Luck;
}

export type Phase = 'roll' | 'rolling' | 'move' | 'moving' | 'over';

/** The next time-driven transition. Whoever hosts the match (browser or server) fires it at `at`. */
export type PendingKind = 'botRoll' | 'botMove' | 'autoMove' | 'timeout' | 'afterRoll' | 'nextTurn' | 'bonusTurn' | 'gameOver';

export interface Pending {
  kind: PendingKind;
  at: number;
}

export interface Capture {
  player: number;
  token: number;
  from: number;
}

export type GameEvent =
  | { type: 'start' }
  | { type: 'turn'; player: number; bonus: boolean }
  | { type: 'roll'; player: number; value: number }
  | { type: 'noMove'; player: number; value: number }
  | { type: 'threeSixes'; player: number }
  | {
      type: 'move';
      player: number;
      token: number;
      from: number;
      to: number;
      captures: Capture[];
      home: boolean;
      safe: boolean;
      extra: boolean;
      /** The mover just sent home a token of the player who last sent one of theirs home. */
      revenge?: boolean;
    }
  | { type: 'finish'; player: number; rank: number }
  | { type: 'auto'; player: number; auto: boolean }
  | { type: 'left'; player: number }
  | { type: 'over'; ranking: number[] };

export interface GameState {
  id: string;
  arms: 4 | 6;
  rules: Rules;
  players: PlayerState[];
  turn: number;
  phase: Phase;
  dice: number | null;
  /** Number of dice rolls made so far (lets clients replay the dice animation). */
  rollCount: number;
  movable: number[];
  sixStreak: number;
  /** Epoch ms when the current turn times out, or null. */
  deadline: number | null;
  /** Clock of the match host when this snapshot was emitted (lets clients correct for skew). */
  now: number;
  turnMs: number;
  ranking: number[];
  pending: Pending | null;
  seq: number;
  events: GameEvent[];
  speed: number;
  startedAt: number;
  /** Online only: the host who started this match, and so paid for it. */
  hostId?: string;
}
