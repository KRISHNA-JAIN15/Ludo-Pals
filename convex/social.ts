import { v } from 'convex/values';
import { EMOTES, type ChatMessage } from '../shared/protocol';
import type { CharacterId } from '../shared/types';
import { internalMutation, mutation, query, type MutationCtx } from './_generated/server';
import { postChat, requireMember } from './lib';

const EMOTE_TTL_MS = 20_000;

export const chat = query({
  args: { code: v.string() },
  handler: async (ctx, { code }): Promise<ChatMessage[]> => {
    const rows = await ctx.db
      .query('chat')
      .withIndex('by_room', (q) => q.eq('roomCode', code))
      .order('desc')
      .take(60);
    return rows.reverse().map((r) => ({
      id: r._id,
      from: r.from,
      name: r.name,
      character: r.character as CharacterId | null,
      text: r.text,
      at: r._creationTime,
      system: r.system,
    }));
  },
});

export const say = mutation({
  args: { secret: v.string(), text: v.string() },
  handler: async (ctx, a) => {
    const { member, room } = await requireMember(ctx, a.secret);
    const seat = room.seats.find((s) => s.id === member.playerId);
    const text = a.text
      .replace(/[\u0000-\u001f]/g, '')
      .trim()
      .slice(0, 140);
    const now = Date.now();
    if (!seat || !text || now - member.lastChatAt < 500) return;
    await ctx.db.patch(member._id, { lastChatAt: now });
    await postChat(ctx, room.code, { from: member.playerId, name: seat.name, character: seat.character, text, system: false });
  },
});

export const emotes = query({
  args: { code: v.string() },
  handler: async (ctx, { code }) => {
    const rows = await ctx.db
      .query('emotes')
      .withIndex('by_room', (q) => q.eq('roomCode', code))
      .order('desc')
      .take(12);
    return rows.map((r) => ({ id: r._id, from: r.from, emoji: r.emoji }));
  },
});

async function pushEmote(ctx: MutationCtx, code: string, from: string, emoji: string) {
  await ctx.db.insert('emotes', { roomCode: code, from, emoji });
  const stale = await ctx.db
    .query('emotes')
    .withIndex('by_room', (q) => q.eq('roomCode', code))
    .filter((q) => q.lt(q.field('_creationTime'), Date.now() - EMOTE_TTL_MS))
    .collect();
  for (const s of stale) await ctx.db.delete(s._id);
}

export const emote = mutation({
  args: { secret: v.string(), emoji: v.string() },
  handler: async (ctx, a) => {
    const { member, room } = await requireMember(ctx, a.secret);
    const now = Date.now();
    if (!EMOTES.includes(a.emoji) || now - member.lastEmoteAt < 600) return;
    await ctx.db.patch(member._id, { lastEmoteAt: now });
    await pushEmote(ctx, room.code, member.playerId, a.emoji);
  },
});

/** Bots react to bonks and wins (scheduled from saveGame). */
export const botEmote = internalMutation({
  args: { code: v.string(), from: v.string(), emoji: v.string() },
  handler: async (ctx, a) => pushEmote(ctx, a.code, a.from, a.emoji),
});
