import { defineSchema, defineTable } from 'convex/server';
import { v } from 'convex/values';

export const seatValidator = v.object({
  id: v.string(),
  name: v.string(),
  character: v.string(),
  kind: v.union(v.literal('human'), v.literal('bot')),
  botLevel: v.optional(v.string()),
  ready: v.boolean(),
  connected: v.boolean(),
  inVoice: v.boolean(),
  muted: v.boolean(),
  /** Left mid-game: the seat stays in the running game (a bot plays it) but the person is gone. */
  left: v.optional(v.boolean()),
});

export default defineSchema({
  /** One lobby / table. Looked up by its 5-letter code. */
  rooms: defineTable({
    code: v.string(),
    hostId: v.string(),
    maxPlayers: v.number(),
    mode: v.string(),
    turnSeconds: v.number(),
    botLevel: v.string(),
    /** 'smart' (Action, the default), 'fair' or 'classic' dice: see shared/dice.ts and shared/random.ts. */
    dice: v.optional(v.string()),
    status: v.union(v.literal('lobby'), v.literal('playing'), v.literal('ended')),
    seats: v.array(seatValidator),
    /** When the last human went quiet; the room is deleted after a while. */
    emptySince: v.union(v.number(), v.null()),
    /** Secrets of players the host removed, so they can't walk straight back in. Never sent to clients. */
    kicked: v.optional(v.array(v.string())),
  }).index('by_code', ['code']),

  /**
   * A browser tab's membership in a room. `secret` never leaves the server, so a player id
   * seen in the room can't be used to act for that player.
   */
  members: defineTable({
    secret: v.string(),
    roomCode: v.string(),
    playerId: v.string(),
    /** Flips only when the player drops out or comes back (see presence). */
    connected: v.boolean(),
    lastChatAt: v.number(),
    lastEmoteAt: v.number(),
  })
    .index('by_secret', ['secret'])
    .index('by_room', ['roomCode']),

  /**
   * Heartbeats live apart from members so the 10-second pings don't re-run anyone's
   * live queries (only the room sweep reads this table).
   */
  presence: defineTable({
    playerId: v.string(),
    roomCode: v.string(),
    lastSeen: v.number(),
    /** Set by the page-close beacon; cleared by the next heartbeat (e.g. after a refresh). */
    goneAt: v.optional(v.number()),
  })
    .index('by_player', ['playerId'])
    .index('by_room', ['roomCode']),

  /** The authoritative GameState (see shared/types.ts) for a room's current match. */
  games: defineTable({
    roomCode: v.string(),
    state: v.any(),
    /** Seed for dice and bot choices. Kept out of `state` so players can't predict rolls. */
    seed: v.optional(v.number()),
  }).index('by_room', ['roomCode']),

  chat: defineTable({
    roomCode: v.string(),
    from: v.string(),
    name: v.string(),
    character: v.union(v.string(), v.null()),
    text: v.string(),
    system: v.boolean(),
  }).index('by_room', ['roomCode']),

  emotes: defineTable({
    roomCode: v.string(),
    from: v.string(),
    emoji: v.string(),
  }).index('by_room', ['roomCode']),

  /** WebRTC signaling messages waiting to be picked up by `to`. */
  signals: defineTable({
    roomCode: v.string(),
    to: v.string(),
    from: v.string(),
    data: v.any(),
  })
    .index('by_to', ['to'])
    .index('by_room', ['roomCode']),
});
