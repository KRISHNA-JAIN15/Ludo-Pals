# Ludo Pals 🎲

A cute, chaotic, phone-first Ludo for 2–6 players: six mascot characters, bots that fill empty seats, synthesized sound effects and music, online rooms, and peer-to-peer voice chat.

## Features

- **2–6 players.** 2–4 players use the classic cross board; 5–6 players get a six-armed hex board.
- **Action dice.** By default the dice read the table, the way popular Ludo apps keep a match lively: a six shows up within a couple of turns when you're stuck in the yard, chases end in a bonk more often, whoever is behind gets a little extra luck, and nobody is hit twice in a row. See [Dice](#dice). Prefer it plain? Pick **Fair** dice (each number exactly once in every six rolls) or **Lucky** dice (pure chance). Every game has a seed: dice, bot choices and who goes first all derive from it, so a game replays identically from its seed.
- **Bots.** Pick how many humans are playing and bots fill the table up to 4 (adjustable, up to 6). Three skill levels: Chill, Normal, Savage. Normal and Savage play deterministically (same position and roll, same move).
- **Pass & play.** Several humans can share one device; humans are seated apart and the game announces whose turn it is. Local games save automatically, so a refresh or a closed tab can be picked up again with "Continue your game".
- **Online rooms.** Create a room and invite friends with one tap: **Copy link** or **WhatsApp** sends a link that drops whoever opens it straight into the room (the 5-letter code works too). Add bots to empty seats, ready up, play. Turn timers keep things moving, and a rematch only includes people who are actually there. See [Leaving and coming back](#leaving-and-coming-back).
- **Voice chat.** WebRTC peer-to-peer audio with mute, speaker mute, and a "speaking" ring on avatars. Links that drop, never come up or go silent are redialled by themselves, the microphone is picked up again after a phone call, voice comes back after a refresh, and a TURN relay covers strict networks (see [Voice relay](#voice-relay-turn-needed-for-mobile-data)).
- **Chat, stickers and emotes.** Messages in each player's colour, stickers of your own pal pulling a face, an emoji picker, one-tap phrases, and floating emoji reactions. During a game, what someone says pops up as a speech bubble next to their name. Bots react too 😎.
- **Six Pals.** Cherry, Mossy, Sunny, Splash, Boo and Blaze. Each has a bio and catchphrase, and their faces change mood when they roll a six, get bonked, or win.
- **Juice.** 3D dice, hop-by-hop token movement, BONK bursts and screen shake, home-run sparkles, confetti, haptics on Android, synthesized SFX and a music loop.
- **Progress.** Coins, wins, win rate, captures and a trophy shelf. Every game pays coins; hosting an online match costs 100. See [Coins](#coins).

Rules: roll a 6 to leave the yard (Quick mode: 1 or 6). Rolling a 6, capturing, or reaching home gives a bonus roll. Three 6s in a row burns the turn. Start squares and ★ squares are safe. You need the exact roll to finish. Quick mode uses 2 tokens per player.

## Dice

Three kinds, chosen when setting up a game or by the host in the lobby:

| Dice                 | How it rolls                                                                                                                            |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| **Action** (default) | Every face is weighted by what it would do on the board right now (`shared/dice.ts`).                                                   |
| **Fair**             | Each player rolls from their own shuffled bag: every number exactly once in every six rolls.                                            |
| **Lucky**            | Six equal faces, every roll independent. Long waits for a six do happen: 40 rolls in a row without one shows up in a few hundred games. |

What Action dice do:

- **Nobody sits stuck.** With nothing to move, the faces that would move something get likelier with every dead roll, and the fifth roll in a row always moves. A whole yard waiting for a six gets one after about two rolls, and nobody goes more than nine rolls without a usable six.
- **More bonks.** A face that lands on an opponent is likelier, more so on a quiet board, when it is payback (you get a **REVENGE!** banner), and when the roller is behind.
- **No pile-ons.** A player who was just sent home is hard to hit again for a couple of rounds.
- **Comebacks.** The boosts grow for whoever trails and shrink for a runaway leader.
- **The race keeps moving.** Big numbers and the exact roll that brings a token home come up a bit more; a third six in a row (which burns the turn) is rare.

Everyone gets the same treatment (bots and humans, host and guests), and skill still decides: in the simulation a Savage bot beats three Chill bots about three games in four. Compared with Lucky dice over a few hundred simulated 4-player games, Action dice give the same game length, about 50% more bonks, 40% more sixes, a first token out after 2 rolls instead of 6, and 3% dead rolls instead of 14%. `npm run sim` prints these numbers; the knobs are the `TUNE` object in `shared/dice.ts`.

## Coins

Everyone starts with 250 coins.

- **Every game pays out** by finishing place: 100 / 60 / 35 / 20 / 12 / 8 coins for 1st to 6th, plus 5 per capture. Games on your own device (against bots, or pass-and-play) are free.
- **Hosting an online match costs 100 coins.** The host pays when the match starts, and again for every rematch. Joining a friend's room is free.
- **Under 100 coins?** You can still join rooms, but you can't host until you've won a few more coins. If the host leaves, whoever takes over pays for the next match.

Coins live on your device (see [Where data lives](#where-data-lives)), so this is a friendly game economy, not a secure one: someone determined could edit their own balance.

## Leaving and coming back

Each browser tab heartbeats every 10 seconds and sends a goodbye signal when it closes. A player's identity survives refreshes and closing the tab, so on the same device they can get back to their game; two tabs open at the same time are still two different players.

| Situation                                                    | Lobby                                                                                                                                                           | In a game                                                                                                       |
| ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Tab closed                                                   | Shown as away immediately and removed after ~8 s. Closing the tab counts as leaving, so opening the site again doesn't put them back (a refresh keeps the seat) | **AWAY** after ~8 s: a bot plays for them                                                                       |
| Gone quiet (phone in the background, browser killed the tab) | Away after 30 s; guests removed after 1 min, the host keeps the room for 5 min                                                                                  | **AWAY** after 30 s: a bot plays for them                                                                       |
| Comes back (same device)                                     | A phone that wakes up, or a tab the browser reloads within 5 minutes, re-joins the lobby automatically, unless the host removed them                            | Within 3 minutes, even from a new tab: gets their seat back, the bot stops, and everyone sees "_name_ is back!" |
| Away for 3 minutes                                           |                                                                                                                                                                 | Counted as **LEFT**; the bot finishes their game, and they're told so when they come back                       |
| Presses Leave                                                | Removed                                                                                                                                                         | **LEFT** right away                                                                                             |

If only bots and departed players are still racing, the game ends straight away for anyone watching. Finished rooms drop players who closed the tab (after ~8 s) or went quiet for 2 minutes.

## How it's built

| Piece                                           | Runs on                          | Notes                                                                                                      |
| ----------------------------------------------- | -------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| The app (React + Vite)                          | **Vercel**, as a static site     | Served from Vercel's CDN, so there's no server to cold-start.                                              |
| Online rooms, game logic, timers, chat, signals | **[Convex](https://convex.dev)** | A realtime backend that runs `convex/` functions next to its database and pushes changes over a WebSocket. |
| Voice audio                                     | Players' browsers (WebRTC)       | Convex only relays the connection setup; audio flows directly between players.                             |
| Profiles, coins, trophies, settings             | Each player's browser            | `localStorage`, see [Where data lives](#where-data-lives).                                                 |

Why not a server on Vercel? Vercel Functions can now hold WebSockets (beta), but each connection is cut at the function's max duration (5 minutes on Hobby), different players can land on different instances, and there's no built-in timer to run bot turns. A Ludo game needs one authoritative game state, timers and broadcast, which Convex provides. Vercel lists it among its recommended realtime backends.

Online games keep their seed on the server, outside the state sent to players, so nobody can work out upcoming rolls.

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

### Voice relay (TURN), needed for mobile data

Voice is peer-to-peer: every pair of players connects directly. Many networks, especially mobile data and some offices, don't allow that, so **without a relay a group of four can end up split in two pairs that only hear each other** (players on the same Wi-Fi or carrier connect, the rest don't). No amount of retrying fixes that: those pairs need a TURN relay to carry their audio (the others stay direct). Until one is set up, the host sees a note in the lobby's voice card, and players get a message naming who they can't reach.

The easy option is Cloudflare's TURN service. The first 1,000 GB a month are free, and a relayed pair of players uses roughly 40 MB an hour.

1. In the [Cloudflare dashboard](https://dash.cloudflare.com/?to=/:account/calls), open **Realtime → TURN Server** and create a TURN key. Copy its **key ID** and **API token**.
2. In the [Convex dashboard](https://dashboard.convex.dev), open the **Production** deployment → **Settings → Environment Variables** and add `CLOUDFLARE_TURN_KEY_ID` and `CLOUDFLARE_TURN_API_TOKEN`.

That's all; no redeploy is needed. Players in a room get short-lived relay credentials from the server when they join voice.

Using another TURN provider instead? Set `TURN_URLS` (comma-separated), `TURN_USERNAME` and `TURN_CREDENTIAL` in the Convex environment variables. (`VITE_TURN_URL`, `VITE_TURN_USER` and `VITE_TURN_PASS` in Vercel still work too, but they put the credentials in the public app bundle.)

Each player's mic icon shows whether your audio link to them is working: it pulses while connecting and turns red if it can't connect, and the app keeps retrying in the background.

If a player's microphone goes quiet because another app has it (a phone call, a WhatsApp call) or the device muted it, that player gets a message, a warning stays on their mic button, and the others see them as muted until it comes back; coming back to the tab picks the microphone up again. That is a different problem from the split above: with a blocked mic nobody hears that one player, while they still hear everyone.

To look into a call that misbehaves, run `__voice()` in the browser console of a player who is in voice: it lists every link's state, whether it runs through the relay, the audio packets received, and the state of the microphone.

### Capacity and cost

Vercel's Hobby plan serves the static app for free. Convex's free plan includes 1M function calls and 1 GB of database I/O per month. A 30-minute, 4-player game uses very roughly 3–8k function calls (every roll, move, bot turn and 10-second presence ping is one), so the free plan covers on the order of a hundred-plus games a month. Past that, Convex's pay-as-you-go plan charges about $2.20 per extra million calls. Many rooms can run at the same time; each room is independent.

## Where data lives

- **Your name, chosen Pal, coins, wins, trophies and settings** are stored in your browser's `localStorage` (key `ludo-pals:v1`). Every player's device keeps its own, so any number of people can play at once without clashing, and deploying a new version doesn't touch it. It doesn't follow you to another browser or phone, and clearing site data resets it.
- **A local game in progress** is saved in `localStorage` (`ludo-pals:local-game`) so it survives a refresh; finished games are cleared. The ids of games already counted towards your coins, and of online matches you already paid to host, are kept too, so a refresh can't pay out or charge twice.
- **Rooms, seats, the live game, chat and emotes** live in Convex while a room is open. Rooms are deleted automatically about 10 minutes after the last player leaves. Nothing about finished games is kept.
- **Which room this tab is in** is a random per-tab secret in `sessionStorage`, which is how a refresh rejoins your game.

## Scripts

| Command              | What it does                                                                                                               |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `npm run dev`        | Vite + Convex dev backend with hot reload                                                                                  |
| `npm run build`      | Type-check and build the app into `dist/`                                                                                  |
| `npm run typecheck`  | TypeScript check (app, shared engine and Convex functions)                                                                 |
| `npm run sim -- 200` | Plays hundreds of headless bot games: rule invariants, dice guarantees, same-seed replays, and how each kind of dice plays |
| `npm run format`     | Prettier                                                                                                                   |
| `npm run gen:topo`   | Regenerates the topographic background pattern                                                                             |

## Project layout

```
shared/        Game logic shared by the browser and Convex
  board.ts       Radial board geometry (4-arm cross and 6-arm hex)
  engine.ts      Move rules, captures, threat detection
  bot.ts         Bot move scoring (easy / normal / hard)
  dice.ts        Action dice: faces weighted by what they would do on the board
  random.ts      Seeded PRNG and fair-dice bags
  rules.ts       Turn state machine (pure: bonuses, timers, auto-play) with scheduled "pending" transitions
  match.ts       Runs rules.ts in the browser for local games (setTimeout + pause)
convex/        Online backend: schema, rooms & lobby, game actions + scheduler, chat/emotes, voice signaling
src/
  components/    Mascot (SVG characters), Board, Dice, chat (panel, stickers, emoji), UI kit
  game/          Animation + event-feed hooks, confetti
  net/           Convex-backed online store, WebRTC voice mesh, invite links
  audio/         Web Audio synthesizer (all SFX and music, no audio files)
  screens/       Splash, Hub, Setup, Online, Lobby, Game, Results
```
