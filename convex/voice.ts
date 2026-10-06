import { v } from 'convex/values';
import { mutation, query, type QueryCtx } from './_generated/server';
import { deleteSignalsTo, memberBySecret, requireMember, roomByCode } from './lib';

/**
 * Voice chat is peer-to-peer WebRTC; Convex only relays the signaling (offers, answers, ICE).
 * Whoever joins voice last calls everyone already in it, so each pair has exactly one caller.
 */
export const join = mutation({
  args: { secret: v.string() },
  handler: async (ctx, { secret }) => {
    const { member, room } = await requireMember(ctx, secret);
    const peers = room.seats.filter((s) => s.inVoice && s.connected && s.id !== member.playerId).map((s) => s.id);
    await deleteSignalsTo(ctx, member.playerId);
    await ctx.db.patch(room._id, {
      seats: room.seats.map((s) => (s.id === member.playerId ? { ...s, inVoice: true, muted: false } : s)),
    });
    return { peers };
  },
});

/** Leaving voice also happens on the way out of a room, so a missing membership is fine here. */
async function membership(ctx: QueryCtx, secret: string) {
  const member = await memberBySecret(ctx, secret);
  const room = member ? await roomByCode(ctx, member.roomCode) : null;
  return member && room ? { member, room } : null;
}

export const leave = mutation({
  args: { secret: v.string() },
  handler: async (ctx, { secret }) => {
    const found = await membership(ctx, secret);
    if (!found) return;
    const { member, room } = found;
    await deleteSignalsTo(ctx, member.playerId);
    await ctx.db.patch(room._id, {
      seats: room.seats.map((s) => (s.id === member.playerId ? { ...s, inVoice: false, muted: false } : s)),
    });
  },
});

export const mute = mutation({
  args: { secret: v.string(), muted: v.boolean() },
  handler: async (ctx, { secret, muted }) => {
    const found = await membership(ctx, secret);
    if (!found) return;
    const { member, room } = found;
    await ctx.db.patch(room._id, { seats: room.seats.map((s) => (s.id === member.playerId ? { ...s, muted } : s)) });
  },
});

export const signal = mutation({
  args: { secret: v.string(), to: v.string(), data: v.any() },
  handler: async (ctx, { secret, to, data }) => {
    const { member, room } = await requireMember(ctx, secret);
    if (!room.seats.some((s) => s.id === to && s.kind === 'human')) return;
    await ctx.db.insert('signals', { roomCode: room.code, to, from: member.playerId, data });
  },
});

/** Signals waiting for the caller, oldest first. */
export const inbox = query({
  args: { secret: v.string() },
  handler: async (ctx, { secret }) => {
    const m = await memberBySecret(ctx, secret);
    if (!m) return [];
    const rows = await ctx.db
      .query('signals')
      .withIndex('by_to', (q) => q.eq('to', m.playerId))
      .take(100);
    return rows.map((r) => ({ id: r._id, from: r.from, data: r.data }));
  },
});

export const ack = mutation({
  args: { secret: v.string(), ids: v.array(v.id('signals')) },
  handler: async (ctx, { secret, ids }) => {
    const m = await memberBySecret(ctx, secret);
    if (!m) return;
    for (const id of ids) {
      const row = await ctx.db.get(id);
      if (row && row.to === m.playerId) await ctx.db.delete(id);
    }
  },
});
