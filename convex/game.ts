import { v } from 'convex/values';
import { humanMove, humanRoll, runPending, setAuto } from '../shared/rules';
import type { GameState } from '../shared/types';
import { internal } from './_generated/api';
import { internalMutation, mutation, query, type MutationCtx } from './_generated/server';
import { gameFor, requireMember, roomByCode, saveGame, seedOf, stepCtx } from './lib';

export const get = query({
  args: { code: v.string() },
  handler: async (ctx, { code }) => ((await gameFor(ctx, code))?.state as GameState | undefined) ?? null,
});

/** Load the caller's game, apply a player action and save it if it was legal. */
async function act(ctx: MutationCtx, secret: string, apply: (st: GameState, playerId: string, seed: number) => boolean) {
  const { member, room } = await requireMember(ctx, secret);
  const game = await gameFor(ctx, room.code);
  if (!game) return false;
  const st = game.state as GameState;
  if (!apply(st, member.playerId, seedOf(game))) return false;
  await saveGame(ctx, game._id, room, st);
  return true;
}

export const roll = mutation({
  args: { secret: v.string() },
  handler: (ctx, { secret }) => act(ctx, secret, (st, id, seed) => humanRoll(st, stepCtx(seed), id)),
});

export const move = mutation({
  args: { secret: v.string(), token: v.number() },
  handler: (ctx, { secret, token }) => act(ctx, secret, (st, id, seed) => humanMove(st, stepCtx(seed), id, token)),
});

/** Hand control back from the auto-play bot. */
export const takeover = mutation({
  args: { secret: v.string() },
  handler: (ctx, { secret }) => act(ctx, secret, (st, id, seed) => setAuto(st, stepCtx(seed), id, false)),
});

/** Fires the game's pending transition (bot turn, dice settling, turn timer…). Scheduled by saveGame. */
export const advance = internalMutation({
  args: { gameId: v.id('games'), seq: v.number() },
  handler: async (ctx, { gameId, seq }) => {
    const game = await ctx.db.get(gameId);
    if (!game) return;
    const st = game.state as GameState;
    if (st.seq !== seq || !st.pending) return; // something else already moved the game on
    if (st.pending.at > Date.now() + 25) {
      await ctx.scheduler.runAt(st.pending.at, internal.game.advance, { gameId, seq });
      return;
    }
    const room = await roomByCode(ctx, game.roomCode);
    if (!room) return;
    if (runPending(st, stepCtx(seedOf(game)))) await saveGame(ctx, gameId, room, st);
  },
});
