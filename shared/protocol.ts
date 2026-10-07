import type { BotLevel, CharacterId, DiceMode, ModeId, SeatKind } from './types';

export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 6;
export const ROOM_CODE_LENGTH = 5;
export const TURN_OPTIONS = [10, 15, 20, 30];

export interface RoomSeat {
  id: string;
  name: string;
  character: CharacterId;
  kind: SeatKind;
  botLevel?: BotLevel;
  ready: boolean;
  connected: boolean;
  inVoice: boolean;
  muted: boolean;
  /** Left mid-game: the seat stays in the running game (a bot plays it) but the person is gone. */
  left?: boolean;
}

export interface RoomState {
  code: string;
  hostId: string;
  maxPlayers: number;
  mode: ModeId;
  turnSeconds: number;
  botLevel: BotLevel;
  dice: DiceMode;
  status: 'lobby' | 'playing' | 'ended';
  seats: RoomSeat[];
}

export interface ChatMessage {
  id: string;
  from: string;
  name: string;
  character: CharacterId | null;
  text: string;
  at: number;
  system?: boolean;
}

/**
 * Voice signaling between two players. `cid` identifies one peer connection, so messages left
 * over from a connection that was replaced are ignored. `hello` asks the other side to call.
 */
export type VoiceSignal =
  | { kind: 'hello' }
  | { kind: 'offer'; sdp: string; cid: string }
  | { kind: 'answer'; sdp: string; cid: string }
  | { kind: 'ice'; cid: string; candidate: { candidate: string; sdpMid: string | null; sdpMLineIndex: number | null } };

export const EMOTES = ['😂', '😡', '😭', '🔥', '👏', '😎', '🤯', '🙏', '💀', '❤️'];
export const QUICK_CHAT = ['Nice move!', 'Hurry up! ⏱️', 'Oops 😅', 'Good game!', 'Not again 😩', 'Revenge time 😈', 'Lucky roll!', 'Well played 👏'];
