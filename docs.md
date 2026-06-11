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

Core gameplay features from the original bot (stats, Discord webhooks, team chat, admin system, choose mode, captain pick, etc.) are preserved in `room.js`. **Only the default map pack and `stadiumKeys` values are futsal-oriented** — swap them for any format you want.

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
| `timeLimit` | Default match time (minutes). Overridden per map if the stadium defines `timeLimit` |
| `scoreLimit` | Default score cap. Overridden per map if the stadium defines `scoreLimit` |
| `fetchRecording` | Upload `.hbr2` replays to Discord when a game ends |
| `teamSize` | Target players per team for auto-balance (e.g. `3` for 3v3; works for any format you configure) |
| `maxAdmins` | Max player-admins in the room |
| `disableBans` | Disable ban command when `true` |
| `debugMode` | Disables in-match idle AFK kick when `true` |
| `kickoffAfkWarnSeconds` | Seconds before kickoff-AFK warning |
| `kickoffAfkForfeitSeconds` | Seconds after kickoff freeze before forfeit/kick |
| `kickoffAfkWindowSeconds` | Kickoff AFK watch window length |
| `forfeitGraceSeconds` | Leave/AFK forfeit only after this many match seconds |
| `afkInactivitySeconds` | In-match idle time before AFK warn/kick (move or chat resets) |
| `afkMinDurationMinutes` | Minimum `!afk` duration |
| `afkMaxDurationMinutes` | Auto-clear `!afk` after this many minutes |
| `afkCooldownMinutes` | Minutes between `!afk` uses |
| `stadiumKeys` | Which map to auto-load per player-count scenario — **defaults point at included futsal maps** (see below) |
| `masters` | Array of player auth strings with full control |
| `admins` | Array of `[auth, nickname]` pairs for permanent admins |

**`stadiumKeys`** — keys must match a filename in `stadiums/` (without `.hbs`). Defaults below target the **included futsal maps**; point them at `classic`, `big`, or your own files for a different setup.

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

These rules are **general balance logic** in `room.js`, not futsal-specific. Point `stadiumKeys` at `classic`, `big`, or custom maps for a different room style.

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

## Maps (`stadiums/`)

The bot is **map-agnostic** — any HaxBall stadium JSON works. This repo **ships with futsal maps** out of the box and points `stadiumKeys` at them for auto-balance; use `!map` or edit `stadiumKeys` / add files for other formats.

Each map is a **JSON stadium** saved as `stadiums/<name>.hbs`. Files are loaded at startup and sorted alphabetically by filename — that order defines the map numbers used by `!map`.

### Included maps (default pack)

Shipped maps — **futsal set + legacy general maps** from upstream:

| File | Purpose |
|------|---------|
| `FutsalTraining.hbs` | Futsal training / solo (no score/time limit) |
| `Futsal1x1.hbs` | Futsal 1v1 |
| `Futsal2x2.hbs` | Futsal 2v2 |
| `Futsal3x3.hbs` | Futsal 3v3 |
| `classic.hbs`, `big.hbs`, `training.hbs` | Legacy general maps from the original bot |

Only the **Futsal\*** files are wired into default `stadiumKeys`. Legacy maps are available via `!map` or by changing config.

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

Map numbers match **filename sort order** (not “futsal first”). With the current pack, `#1` is `big`, then `classic`, then the `Futsal*` files — run `!map` in-game for the live list.

Use `!help` in the room for all commands (`!help <command>` for details).

---

## Project layout

```
index.js          Entry point — loads config, DB, stadium catalog, then room.js
room.js           Room logic, commands, events (fork of Wazarr94 HaxBot)
config.js         Loads config.json + .env
config.json       Your room settings (gitignored)
storage.js        SQLite-backed localStorage for player stats
stadiums.js       Loads and parses .hbs map files
stadiums/         Map files (.hbs)
scripts/init-db.js  Create stats database
data/stats.db     Player statistics (gitignored)
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
