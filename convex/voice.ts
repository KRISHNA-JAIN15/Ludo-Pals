import { v } from 'convex/values';
import { internal } from './_generated/api';
import { action, internalQuery, mutation, query, type MutationCtx, type QueryCtx } from './_generated/server';
import { deleteSignalsTo, memberBySecret, membersOf, requireMember, roomByCode } from './lib';

/**
 * Voice chat is peer-to-peer WebRTC; Convex only relays the signaling (offers, answers, ICE)
 * and hands out relay (TURN) credentials. In each pair the player with the smaller id calls.
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

/**
 * Queue signaling messages for another player in the caller's room. Membership is checked against
 * the `members` table rather than the room document: that one is rewritten whenever anyone mutes
 * or readies up, and a burst of signals must not be retried (or lost) over that.
 */
async function relay(ctx: MutationCtx, secret: string, to: string, batch: unknown[]) {
  const member = await memberBySecret(ctx, secret);
  if (!member || to === member.playerId || batch.length > MAX_SIGNAL_BATCH) return;
  if (!(await membersOf(ctx, member.roomCode)).some((m) => m.playerId === to)) return;
  // A player's unread pile is capped, so nobody can bury someone who isn't picking signals up
  // (the room's cleanup reads that pile in one go).
  const waiting = await ctx.db
    .query('signals')
    .withIndex('by_to', (q) => q.eq('to', to))
    .take(MAX_PENDING_SIGNALS + 1);
  let room = MAX_PENDING_SIGNALS - waiting.length;
  for (const data of batch) {
    if (room <= 0) break;
    if (!validSignal(data)) continue;
    await ctx.db.insert('signals', { roomCode: member.roomCode, to, from: member.playerId, data });
    room--;
  }
}

const MAX_SIGNAL_BATCH = 40;
/** Unread signals one player can have waiting: a live call needs a few dozen at the very most. */
const MAX_PENDING_SIGNALS = 80;

/** Only well-formed signaling messages of a sane size are passed on (see VoiceSignal in shared/protocol.ts). */
function validSignal(data: unknown): boolean {
  if (!data || typeof data !== 'object') return false;
  const d = data as Record<string, unknown>;
  const size = JSON.stringify(d).length;
  const cidOk = d.cid === undefined || (typeof d.cid === 'string' && d.cid.length <= 32);
  switch (d.kind) {
    case 'hello':
      return size <= 100;
    case 'offer':
    case 'answer':
      return typeof d.sdp === 'string' && cidOk && size <= 12_000; // audio-only descriptions are a few KB
    case 'ice':
      return !!d.candidate && typeof d.candidate === 'object' && cidOk && size <= 2_000;
    default:
      return false;
  }
}

export const signal = mutation({
  args: { secret: v.string(), to: v.string(), data: v.any() },
  handler: (ctx, { secret, to, data }) => relay(ctx, secret, to, [data]),
});

/** Several signals for one player at once (an offer or answer together with its ICE candidates), kept in order. */
export const signals = mutation({
  args: { secret: v.string(), to: v.string(), batch: v.array(v.any()) },
  handler: (ctx, { secret, to, batch }) => relay(ctx, secret, to, batch),
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

export const isMember = internalQuery({
  args: { secret: v.string() },
  handler: async (ctx, { secret }): Promise<boolean> => !!(await memberBySecret(ctx, secret)),
});

interface IceServer {
  urls: string[];
  username?: string;
  credential?: string;
}

/** Keep only well-formed servers, minus port 53, which browsers block (it only slows connecting). */
function cleanIceServers(raw: unknown): IceServer[] {
  const list = Array.isArray(raw) ? raw : raw && typeof raw === 'object' ? [raw] : [];
  const out: IceServer[] = [];
  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    const { urls, username, credential } = item as Record<string, unknown>;
    const all = (Array.isArray(urls) ? urls : [urls]).filter((u): u is string => typeof u === 'string');
    const kept = all.filter((u) => !/:53(\?|$)/.test(u));
    if (!kept.length) continue;
    out.push({
      urls: kept,
      ...(typeof username === 'string' ? { username } : {}),
      ...(typeof credential === 'string' ? { credential } : {}),
    });
  }
  return out;
}

/**
 * Relay (TURN) servers for voice. Without one, players on strict networks (many mobile carriers,
 * some offices) can't reach each other directly, so a group ends up hearing only some players.
 * Set one of these in the Convex deployment's environment variables:
 * - CLOUDFLARE_TURN_KEY_ID and CLOUDFLARE_TURN_API_TOKEN: short-lived Cloudflare credentials (recommended)
 * - TURN_URLS (comma-separated), TURN_USERNAME and TURN_CREDENTIAL: any other TURN server
 * Only room members get credentials. Returns [] when nothing is configured (direct calls only).
 */
export const iceServers = action({
  args: { secret: v.string() },
  handler: async (ctx, { secret }): Promise<IceServer[]> => {
    const member: boolean = await ctx.runQuery(internal.voice.isMember, { secret });
    if (!member) return [];
    const keyId = process.env.CLOUDFLARE_TURN_KEY_ID;
    const token = process.env.CLOUDFLARE_TURN_API_TOKEN;
    if (keyId && token) {
      try {
        const res = await fetch(`https://rtc.live.cloudflare.com/v1/turn/keys/${encodeURIComponent(keyId)}/credentials/generate-ice-servers`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ ttl: 86_400 }),
        });
        if (res.ok) {
          const body: unknown = await res.json();
          const servers = cleanIceServers(body && typeof body === 'object' ? (body as { iceServers?: unknown }).iceServers : null);
          if (servers.length) return servers;
        }
        console.error(`Cloudflare TURN credentials request failed: HTTP ${res.status}`);
      } catch (err) {
        console.error('Cloudflare TURN credentials request failed', err);
      }
    }
    const urls = process.env.TURN_URLS;
    if (urls) {
      return cleanIceServers({
        urls: urls
          .split(',')
          .map((u: string) => u.trim())
          .filter(Boolean),
        username: process.env.TURN_USERNAME,
        credential: process.env.TURN_CREDENTIAL,
      });
    }
    return [];
  },
});
