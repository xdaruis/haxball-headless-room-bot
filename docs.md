# HaxBall headless server — docs

Lightweight general-purpose headless HaxBall server/bot — aimed to run on a Pi, VPS, or laptop. Core behaviour matches the [original fork](https://github.com/Wazarr94/haxball_bot_headless) (public room flow, choose mode, stats, webhooks, etc.). **Included maps are futsal** (1v1, 2v2, 3v3 + training); replace or extend them under `stadiums/`.

Forked and reworked from [Wazarr94/haxball_bot_headless](https://github.com/Wazarr94/haxball_bot_headless).

---

## What changed from the original

The [original project](https://github.com/Wazarr94/haxball_bot_headless) was a paste-into-browser-console script (`HaxBot_public.js` / `HaxBot_private.js`) with all options hardcoded at the top of one large file. It targeted general public/private rooms and was often run via [haxroomie](https://morko.github.io/haxroomie/tutorial-haxroomie-cli-config.html) on a VPS.

This version is a **standalone Node-style app**: **`pnpm install`**, then **`pnpm start`**. Scripts use Bun as the runtime under the hood.

| Before | Now |
|--------|-----|
| Single JS file pasted in browser devtools | `pnpm start` — no browser tab needed |
| Options inline in `room.js` | `config.json` + `.env` for secrets |
| Stadiums embedded in code | `.hbs` files in `stadiums/` (default set: futsal maps) |
| Browser `localStorage` for stats | SQLite (`data/stats.db`) |
| Manual stadium edits in code | `!map` command + drop new maps in `stadiums/` |

**Old tagline:** *Ready-to-go scripts and functions for the HaxBall Headless API !*

**New goal:** same general-purpose public-room bot as upstream, in a smaller deployable package (config files, SQLite, map folder) — easy to leave running 24/7 on low-power hardware.

Core gameplay features from the original bot (stats, Discord webhooks, team chat, admin system, choose mode, captain pick, etc.) are preserved in `room.js`. This fork also adds **per-format Elo ranks**, voteban, physics overlays, and stronger lobby/moderation guards. **Only the default map pack and `stadiumKeys` values are futsal-oriented** — swap them for any format you want.

---

## Requirements

- **[pnpm](https://pnpm.io)** — install dependencies and run scripts (`pnpm start`, `pnpm init-db`)
- **[Bun](https://bun.sh)** — runtime used by those scripts (installed separately)
- A [HaxBall headless token](https://www.haxball.com/headlesstoken) (39 characters) — recommended for production; set as `HAXBALL_TOKEN` in `.env`

Optional:

- Discord webhooks for room logs and match summaries

---

## Install

```bash
git clone <your-repo-url>
cd haxball_bot_headless
pnpm install
```

This installs [`haxball.js`](https://www.npmjs.com/package/haxball.js) (WebRTC headless host). It depends on a native module (`node-datachannel`), so it must be installed locally — a CDN import is not possible for this setup.

> **Note — pnpm for install & scripts, Bun for runtime**
>
> Dependencies are installed with **`pnpm install`**, not `bun install`. On some setups (especially ARM / Raspberry Pi), Bun’s package manager had trouble building or linking **`node-datachannel`** (the WebRTC native addon used by `haxball.js`). Using pnpm avoids those issues.
>
> Day-to-day commands are **`pnpm start`** and **`pnpm init-db`**. Those npm scripts call **`bun index.js`** / **`bun scripts/init-db.js`** — you still need Bun installed, but you don’t run it directly.

### Initialize the stats database (optional)

Runs automatically on first start, but you can create the DB explicitly:

```bash
pnpm init-db
```

Creates `data/stats.db` with a `player_stats` table.

---

## Configuration

### 1. `config.json`

Copy the example and edit:

```bash
cp config.example.json config.json
```

| Field | Description |
|-------|-------------|
| `roomName` | Name shown in the HaxBall room list |
| `maxPlayers` | Max slots in the room |
| `public` | `true` = listed publicly |
| `geo` | Optional `{ code, lat, lon }` for the public room list location |
| `timeLimit` | Default match time (minutes). Overridden per map if the stadium defines `timeLimit` |
| `scoreLimit` | Default score cap. Overridden per map if the stadium defines `scoreLimit` |
| `drawTimeLimit` | Golden-goal OT minutes after regulation tie; `0` = instant draw at full time |
| `fetchRecording` | Upload `.hbr2` replays to Discord when a game ends |
| `teamSize` | Target players per team for auto-balance (e.g. `3` for 3v3; works for any format you configure) |
| `chooseTimeSeconds` | Captain pick timeout (seconds) before kick for not picking |
| `maxAdmins` | Max player-admins in the room |
| `disableBans` | Disable ban command when `true` |
| `debugMode` | Disables in-match idle AFK kick when `true` |
| `kickoffAfkWarnSeconds` | Seconds before kickoff-AFK warning |
| `kickoffAfkForfeitSeconds` | Seconds after kickoff freeze before forfeit/kick |
| `kickoffAfkWindowSeconds` | Kickoff AFK watch window length |
| `forfeitGraceSeconds` | Leave/AFK forfeit only after this many match seconds |
| `afkInactivitySeconds` | In-match idle time before AFK warn/kick (move or chat resets) |
| `afkMinDurationMinutes` | Minimum `!afk` duration |
| `afkMaxDurationMinutes` | Auto-clear `!afk` after this many minutes once the room is busy |
| `afkCooldownMinutes` | Minutes between `!afk` uses |
| `physicsFile` | Path to ball/player physics overlay JSON (default `physics.json`) |
| `physicsStadiumPattern` | Regex of stadium filenames that receive the physics merge (default `^Futsal`) |
| `stadiumKeys` | Which map to auto-load per player-count scenario — **defaults point at included futsal maps** (see below) |
| `masters` | Array of player auth strings with full control |
| `admins` | Array of `[auth, nickname]` pairs for permanent admins |

**`stadiumKeys`** — keys must match a filename in `stadiums/` (without `.hbs`). Defaults below target the **included futsal maps**; point them at any other `.hbs` in the folder for a different setup.

```json
"stadiumKeys": {
  "solo": "FutsalTraining",
  "duel": "Futsal1x1",
  "small": "Futsal2x2",
  "full": "Futsal3x3"
}
```

| Key | Used when |
|-----|-----------|
| `solo` | Room startup + 1 player (training / solo on red) |
| `duel` | 2 players (1v1) |
| `small` | 5 players with `teamSize > 2` (2v2) |
| `full` | 6 players in choose mode with `teamSize > 2` (3v3) |

With the **default futsal `stadiumKeys`** and `teamSize: 3`, auto-balance tends to load:

- **1 player** → `solo` (training), solo on red
- **2 players** → `duel` (1v1), when balancing from specs
- **5 players** → `small` (2v2), when `teamSize > 2`
- **6 players in choose mode** → `full` (3v3), when `teamSize > 2`

These rules are **general balance logic** in `room.js`, not futsal-specific. Point `stadiumKeys` at custom maps for a different room style.

### 2. `.env`

Copy and fill in secrets (not committed to git):

```bash
cp .env.example .env
```

| Variable | Description |
|----------|-------------|
| `HAXBALL_TOKEN` | Token from [haxball.com/headlesstoken](https://www.haxball.com/headlesstoken) |
| `ROOM_WEBHOOK` | Discord webhook for join/leave/kick logs (optional) |
| `GAME_WEBHOOK` | Discord webhook for match summaries (optional) |

If `config.json` is missing, the bot falls back to `config.example.json` and logs a warning.

Bun loads `.env` automatically when you run `pnpm start`.

---

## Run

```bash
pnpm start
```

On success you should see:

- Player count from SQLite
- Room link + master password in the console

Keep the process running (e.g. `tmux`, `systemd`, or `screen` on a Pi).

---

## Ranked Elo

Stats and Elo are stored per format: **`1x1`**, **`2x2`**, **`3x3`**. A match only counts for the format that was live on kickoff (e.g. a 3v3 game updates `3x3` Elo only).

| Rule | Detail |
|------|--------|
| Default Elo | `1000` for new players |
| Placement | First **10** games in a format use **2×** Elo swing |
| Elo leaderboard | Needs **10+** games in that format |
| Ranks | Compact ladder (Silver → … → Challenger / Grandmaster). Same thresholds per format — see `!ranks` |
| Forfeit | Leave or AFK **after** `forfeitGraceSeconds` → ranked forfeit (leaver takes a heavier loss) |
| Early leave | Leave **inside** the grace window → player is removed from the Elo roster for that match (no ranked penalty, match can continue) |
| Draw / OT expire | Golden-goal OT times out → draw announcement; **Elo unchanged** |
| Streak rebalance | Every **3** wins in a row on a full even lobby → next match teams are snake-drafted by Elo (winner-stay skipped once) |

Chat filters like `!elo 2x2`, `!wins 3x3`, `!stats 1x1` select the format. Omit the format to use the current lobby/live format.

---

## Match flow

Lobby roster changes are debounced through a small queue so bulk joins/leaves do not race the balance logic.

Typical public-room loop:

1. **Winner-stay** — winning side keeps red slots (blue winners move to red).
2. **Captain pick** — when extras sit in spec (e.g. 7 players for 3v3), each side starts with one captain and picks until teams are full.
3. **Kickoff** — ranked announcement shows the live format.

### Captain pick

- Both red and blue captains pick (whichever side is short).
- Spec list shows Elo rank per player for the lobby format.
- Captains type a number, or keywords: `elo` / `auto` (highest Elo), `random`, `bottom`, `top`.
- Timeout from `chooseTimeSeconds` — warn at half time, then kick for “Pick timeout”.
- Slow mode is raised while picking.

### Overtime

After regulation ends tied, `drawTimeLimit` minutes of golden-goal OT run (default `1`). Next goal wins. If OT expires, the match is a draw (Elo unchanged). Set `drawTimeLimit` to `0` for an instant draw at full time.

### AFK during matches

- In-match idle AFK uses `afkInactivitySeconds` (admins are excluded).
- `!afk` on a team is **queued** until the match ends; in spec it applies immediately.
- While the room is under **50%** capacity, AFK can sit indefinitely; once the room fills past half, `afkMaxDurationMinutes` applies.
- Kickoff freeze has its own warn / forfeit timers (`kickoffAfk*`).

---

## Commands

Type `!help` in the room for the live list; `!help <command>` for details. Compact summary by role:

### Player

| Command | Action |
|---------|--------|
| `!help` | List commands |
| `!afk` / `!afks` | Go AFK / list AFK players |
| `!ignore #ID` / `!unignore` / `!ignored` | Hide player chat / restore it / list ignored players |
| `!bb` | Leave the room |
| `!me` / `!stats` | Your stats (optional `1x1` / `2x2` / `3x3`) |
| `!rename` | Change leaderboard display name |
| `!games` `!wins` `!goals` `!assists` `!cs` `!playtime` | Top-5 boards (optional format) |
| `!elo` / `!rank` | Top-5 Elo (optional format) |
| `!ranks` | Elo tier thresholds |
| `!top` | Leaderboard overview |
| `!voteban` / `!vb` | Start a vote ban (`!voteban #ID`) |
| `!yes` | Vote yes on a running voteban |
| `t …` | Team chat |
| `@@name …` | Private player chat |

### Personal ignores

Ignores are stored by HaxBall auth, so they survive reconnects, renames, and bot restarts.

- `!ignore #ID` hides that player's public chat, team chat, and private messages.
- `!ignored` lists all ignored players; online entries include their current `#ID`.
- `!unignore #ID` restores an online player; `!unignore <number>` also works with the numbered `!ignored` list.
- Gameplay, join/leave, moderation, command output, and other bot announcements remain visible.

### Admin (temp or perm)

| Command | Action |
|---------|--------|
| `!map` / `!map <n>` | List maps / load map #n (game stopped) |
| `!rr` | Restart game |
| `!rrs` | Swap teams and restart |
| `!swap` | Swap red/blue (game stopped) |
| `!kickred` `!kickblue` `!kickspec` | Kick a whole side |
| `!mute` / `!unmute` / `!mutes` | Chat mute tools |

### Master

| Command | Action |
|---------|--------|
| `!setadmin` | Give temporary admin |
| `!setpermadmin` | Permanent admin (saved to `config.json`) |
| `!removeadmin` | Remove permanent admin (saved to config) |
| `!admins` | List permanent admins |
| `!bans` / `!clearbans` | Ban list / clear bans |
| `!password` | Set or clear room password |
| `!whois #ID` | Alt lookup — shared WiFi, multi-IP, ranks |
| `!claim` | Claim master with the console password |

---

## Moderation

| Guard | Behaviour |
|-------|-----------|
| **Voteban** | Needs **4+** players on different networks. Target: `!voteban #ID`. Others type `!yes` within **45s**. Success → **5 min** ban. **3 min** cooldown between votes. Same-network alts count as one vote. AFK players do not count toward the quorum. |
| **Rejoin abuse** | Leave **twice within 3 minutes** → **3 min** temp ban (stops lobby flicker from rage-rejoin). |
| **IP cap** | Max **4** connections from the same IP; extras are kicked. |
| **Whois** | Masters can inspect alts / shared conn / ranks with `!whois #ID`. |
| **Perm admins** | `!setpermadmin` / `!removeadmin` write the `admins` array in `config.json`. |

---

## Maps (`stadiums/`)

The bot is **map-agnostic** — any HaxBall stadium JSON works. This repo **ships with a futsal pack** and points `stadiumKeys` at those files; use `!map` or edit `stadiumKeys` / add files for other formats.

Each map is a **JSON stadium** saved as `stadiums/<name>.hbs`. Files are loaded at startup and sorted alphabetically by filename — that order defines the map numbers used by `!map`.

### Included maps (default pack)

| File | Purpose |
|------|---------|
| `FutsalTraining.hbs` | Futsal training / solo (wired as `solo`) |
| `Futsal1x1.hbs` | Futsal 1v1 (wired as `duel`) |
| `Futsal2x2.hbs` | Futsal 2v2 (wired as `small`) |
| `Futsal3x3.hbs` | Futsal 3v3 (wired as `full`) |
| `training.hbs`, `winky.hbs`, `hi.hbs`, Havana / Merlin / HaxMap variants | Extra maps available via `!map` or by changing `stadiumKeys` |

Only the four **Futsal\*** keys above are wired into default `stadiumKeys`. Upstream `classic` / `big` maps are no longer shipped.

### Physics overlay

`physics.json` can override `playerPhysics` / `ballPhysics` on stadiums whose **filename** matches `physicsStadiumPattern` (default: names starting with `Futsal`). Edit the JSON or point `physicsFile` elsewhere; restart the bot to reload.

### Adding a map

1. Export or copy stadium JSON from the [HaxBall map editor](https://html5.haxball.com/mapeditor/).
2. Save as `stadiums/MyMap.hbs`.
3. Restart the bot (catalog is loaded at boot).

### Stadium metadata

Besides normal HaxBall stadium fields (`name`, `width`, `vertexes`, …), you can add **bot-only** keys at the root of the JSON:

| Key | Type | Effect |
|-----|------|--------|
| `scoreLimit` | number | Applied when this map is loaded. `0` = unlimited |
| `timeLimit` | number | Match duration in minutes when this map is loaded. `0` = unlimited |

These keys are **stripped** before the stadium is sent to HaxBall — they are not valid map editor fields, only config for this bot.

**Example** (endless training map):

```json
{
  "name": "My Training Map",
  "width": 420,
  "...": "...",
  "scoreLimit": 0,
  "timeLimit": 0
}
```

**Example** (3 goals, 3 minutes — any map format):

```json
{
  "name": "My 3v3 Map",
  "...": "...",
  "scoreLimit": 3,
  "timeLimit": 3
}
```

If a map omits these keys, the bot uses `scoreLimit` / `timeLimit` from `config.json`.

---

## In-game: `!map`

| Command | Action |
|---------|--------|
| `!map` | List all maps with number, name, and goal limit |
| `!map <number>` | Load map by number (game must be **stopped**) |

Players cannot change the stadium from the HaxBall UI — the bot resets manual changes and tells them to use `!map`.

Map numbers match **filename sort order**. Run `!map` in-game for the live numbered list.

---

## Project layout

```
index.js              Entry point — loads config, DB, stadium catalog, then room.js
room.js               Room logic, commands, events (fork of Wazarr94 HaxBot)
config.js             Loads config.json + .env
config.json           Your room settings (gitignored)
rosterQueue.js        Debounced roster reconcile queue
storage.js            SQLite-backed localStorage for player stats
stadiums.js           Loads .hbs maps + merges physics overlay
stadiums/             Map files (.hbs)
physics.json          Ball/player physics overlay for matching stadiums
scripts/init-db.js    Create stats database
scripts/backup-prod.sh  Optional prod DB/config backup helper
data/stats.db         Player statistics (gitignored)
```

---

## Raspberry Pi notes

- Prefer **Ethernet** for stable WebRTC if Wi‑Fi is flaky.
- Use **`pnpm install`** once for dependencies — `bun install` may hang or fail on ARM when building `node-datachannel`.
- Use **`pnpm start`** to run the room; **`pnpm init-db`** to init stats DB.
- `pnpm install` may take a while on first run while the native addon builds.
- Run inside **tmux** or a **systemd** unit so the room survives SSH disconnects.
- ~60°C under load is normal for a Pi in a case with no active cooling.

---

## Discord setup

Same idea as the [original README](https://github.com/Wazarr94/haxball_bot_headless):

1. Create log + game channels on your server.
2. Create a [webhook](https://support.discord.com/hc/en-us/articles/228383668-Intro-to-Webhooks) for each.
3. Put URLs in `.env` as `ROOM_WEBHOOK` and `GAME_WEBHOOK`.

---

## License

MIT — inherited from the [original project](https://github.com/Wazarr94/haxball_bot_headless/blob/master/LICENSE).
