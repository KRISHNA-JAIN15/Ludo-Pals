# Ludo Pals 🎲

A cute, chaotic, phone-first Ludo for 2–6 players: six mascot characters, bots that fill empty seats, synthesized sound effects and music, online rooms, and peer-to-peer voice chat.

## Features

- **2–6 players.** 2–4 players use the classic cross board; 5–6 players get a six-armed hex board.
- **Bots.** Pick how many humans are playing and bots fill the table up to 4 (adjustable, up to 6). Three skill levels: Chill, Normal, Savage.
- **Pass & play.** Several humans can share one device; humans are seated apart and the game announces whose turn it is.
- **Online rooms.** Create a room, share the 5-letter code or invite link, add bots to empty seats, ready up, play. Turn timers keep things moving, and if someone disconnects, goes idle or closes their tab, a bot plays their pals until they come back. Refreshing the page rejoins the game.
- **Voice chat.** WebRTC peer-to-peer audio with mute, speaker mute, and a "speaking" ring on avatars.
- **Chat and emotes.** Quick-chat phrases, free text, and floating emoji reactions. Bots react too 😎.
- **Six Pals.** Cherry, Mossy, Sunny, Splash, Boo and Blaze. Each has a bio and catchphrase, and their faces change mood when they roll a six, get bonked, or win.
- **Juice.** 3D dice, hop-by-hop token movement, BONK bursts and screen shake, home-run sparkles, confetti, haptics on Android, synthesized SFX and a music loop.
- **Progress.** Coins, wins, win rate, captures and a trophy shelf.

Rules: roll a 6 to leave the yard (Quick mode: 1 or 6). Rolling a 6, capturing, or reaching home gives a bonus roll. Three 6s in a row burns the turn. Start squares and ★ squares are safe. You need the exact roll to finish. Quick mode uses 2 tokens per player.

## How it's built

| Piece                                           | Runs on                          | Notes                                                                                                      |
| ----------------------------------------------- | -------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| The app (React + Vite)                          | **Vercel**, as a static site     | Served from Vercel's CDN, so there's no server to cold-start.                                              |
| Online rooms, game logic, timers, chat, signals | **[Convex](https://convex.dev)** | A realtime backend that runs `convex/` functions next to its database and pushes changes over a WebSocket. |
| Voice audio                                     | Players' browsers (WebRTC)       | Convex only relays the connection setup; audio flows directly between players.                             |
| Profiles, coins, trophies, settings             | Each player's browser            | `localStorage`, see [Where data lives](#where-data-lives).                                                 |

Why not a server on Vercel? Vercel Functions can now hold WebSockets (beta), but each connection is cut at the function's max duration (5 minutes on Hobby), different players can land on different instances, and there's no built-in timer to run bot turns. A Ludo game needs one authoritative game state, timers and broadcast, which Convex provides. Vercel lists it among its recommended realtime backends.

The rules engine (`shared/rules.ts`) is a pure state machine. Local games run it in the browser (`shared/match.ts`); online games run the same code inside Convex mutations, with Convex's scheduler firing bot turns and turn timers. Local and online play follow identical rules, and online play is server-authoritative: dice are rolled on the server.

## Run it locally

Requires Node 20+.

```bash
npm install
npm run dev
```

`npm run dev` starts Vite and `convex dev` together. The first time, `convex dev` asks you to log in or to run a local backend without an account. Either works for development; it writes `VITE_CONVEX_URL` to `.env.local`. Then open http://localhost:5173.

**On your phone (same Wi-Fi):** open the `Network:` URL that Vite prints (e.g. `http://192.168.1.20:5173`). Local games work there. Online play from the phone needs the phone to reach the Convex backend too, so use a cloud Convex deployment (run `npx convex login`) rather than the local one.

> **Voice chat needs HTTPS.** Browsers only allow microphone access on `https://` or `localhost`, so voice won't start on a plain `http://192.168.x.x` address. Once deployed to Vercel (HTTPS), it works everywhere.

## Deploy to Vercel

1. **Create the Convex project.** Run `npx convex login` (this links the project you've been running locally to your account), then `npx convex dev` once so the functions exist in the cloud.
2. **Get a deploy key.** In the [Convex dashboard](https://dashboard.convex.dev), open the project, switch to the **Production** deployment, go to **Settings**, and generate a **Production deploy key**.
3. **Import the app into Vercel.** Push this folder to a GitHub repo and import it at [vercel.com/new](https://vercel.com/new), or run `npx vercel` in this folder.
4. **Add the key.** In the Vercel project, under **Settings → Environment Variables**, add `CONVEX_DEPLOY_KEY` with the key from step 2, scoped to **Production**.
5. **Deploy.** `vercel.json` already sets the build command: `npx convex deploy --cmd 'npm run build' --cmd-url-env-var-name VITE_CONVEX_URL`. Each deploy pushes the Convex functions first and then builds the app pointed at your production backend.

For preview deployments, generate a **Preview** deploy key in Convex and add it as `CONVEX_DEPLOY_KEY` scoped to **Preview**; each branch then gets its own isolated backend.

Optional: on strict networks (some mobile carriers) peer-to-peer voice can fail without a relay. Set `VITE_TURN_URL`, `VITE_TURN_USER` and `VITE_TURN_PASS` in Vercel to use a TURN server. Public STUN is used by default, which covers most home Wi-Fi.

### Capacity and cost

Vercel's Hobby plan serves the static app for free. Convex's free plan includes 1M function calls and 1 GB of database I/O per month. A 30-minute, 4-player game uses very roughly 3–8k function calls (every roll, move, bot turn and 10-second presence ping is one), so the free plan covers on the order of a hundred-plus games a month. Past that, Convex's pay-as-you-go plan charges about $2.20 per extra million calls. Many rooms can run at the same time; each room is independent.

## Where data lives

- **Your name, chosen Pal, coins, wins, trophies and settings** are stored in your browser's `localStorage` (key `ludo-pals:v1`). Every player's device keeps its own, so any number of people can play at once without clashing, and deploying a new version doesn't touch it. It doesn't follow you to another browser or phone, and clearing site data resets it.
- **Rooms, seats, the live game, chat and emotes** live in Convex while a room is open. Rooms are deleted automatically about 10 minutes after the last player leaves. Nothing about finished games is kept.
- **Which room this tab is in** is a random per-tab secret in `sessionStorage`, which is how a refresh rejoins your game.

## Scripts

| Command              | What it does                                               |
| -------------------- | ---------------------------------------------------------- |
| `npm run dev`        | Vite + Convex dev backend with hot reload                  |
| `npm run build`      | Type-check and build the app into `dist/`                  |
| `npm run typecheck`  | TypeScript check (app, shared engine and Convex functions) |
| `npm run sim -- 200` | Plays 200 headless bot games and checks rule invariants    |
| `npm run format`     | Prettier                                                   |
| `npm run gen:topo`   | Regenerates the topographic background pattern             |

## Project layout

```
shared/        Game logic shared by the browser and Convex
  board.ts       Radial board geometry (4-arm cross and 6-arm hex)
  engine.ts      Move rules, captures, threat detection
  bot.ts         Bot move scoring (easy / normal / hard)
  rules.ts       Turn state machine (pure: bonuses, timers, auto-play) with scheduled "pending" transitions
  match.ts       Runs rules.ts in the browser for local games (setTimeout + pause)
convex/        Online backend: schema, rooms & lobby, game actions + scheduler, chat/emotes, voice signaling
src/
  components/    Mascot (SVG characters), Board, Dice, chat, UI kit
  game/          Animation + event-feed hooks, confetti
  net/           Convex-backed online store and WebRTC voice mesh
  audio/         Web Audio synthesizer (all SFX and music, no audio files)
  screens/       Splash, Hub, Setup, Online, Lobby, Game, Results
```
