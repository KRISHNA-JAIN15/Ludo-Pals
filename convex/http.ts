import { httpRouter } from 'convex/server';
import { internal } from './_generated/api';
import { httpAction } from './_generated/server';

const http = httpRouter();

/**
 * Goodbye beacon: the browser calls this with navigator.sendBeacon when the page is closed,
 * so other players see the departure within seconds instead of after a timeout.
 * The body is the tab's secret as plain text.
 */
http.route({
  path: '/bye',
  method: 'POST',
  handler: httpAction(async (ctx, req) => {
    const secret = (await req.text()).trim().slice(0, 200);
    if (secret) await ctx.runMutation(internal.rooms.bye, { secret });
    return new Response(null, { status: 204, headers: { 'Access-Control-Allow-Origin': '*' } });
  }),
});

export default http;
