# HaxBall headless server — docs

Lightweight headless HaxBall server/bot aimed to run on anything — a Raspberry Pi, a VPS, or your laptop. Focused on **futsal 1v1, 2v2, 3v3**, plus a **training map**.

Forked and reworked from [Wazarr94/haxball_bot_headless](https://github.com/Wazarr94/haxball_bot_headless).

---

## What changed from the original

The [original project](https://github.com/Wazarr94/haxball_bot_headless) was a paste-into-browser-console script (`HaxBot_public.js` / `HaxBot_private.js`) with all options hardcoded at the top of one large file. It targeted general public/private rooms and was often run via [haxroomie](https://morko.github.io/haxroomie/tutorial-haxroomie-cli-config.html) on a VPS.

This version is a **standalone Node-style app**: **`pnpm install`**, then **`pnpm start`**. Scripts use Bun as the runtime under the hood.

| Before | Now |
|--------|-----|
| Single JS file pasted in browser devtools | `pnpm start` — no browser tab needed |
| Options inline in `room.js` | `config.json` + `.env` for secrets |
| Stadiums embedded in code | `.hbs` files in `stadiums/` |
| Browser `localStorage` for stats | SQLite (`data/stats.db`) |
| General-purpose maps | Futsal 1v1 / 2v2 / 3v3 + training, auto-selected by player count |
| Manual stadium edits in code | `!map` command in-game |

**Old tagline:** *Ready-to-go scripts and functions for the HaxBall Headless API !*

**New goal:** a small, maintainable headless server you can leave running 24/7 on low-power hardware.

Core gameplay features from the original bot (stats, Discord webhooks, team chat, admin system, choose mode, etc.) are largely preserved in `room.js`.

---

## Requirements

- **[pnpm](https://pnpm.io)** — install dependencies and run scripts (`pnpm start`, `pnpm init-db`)
- **[Bun](https://bun.sh)** — runtime used by those scripts (installed separately)
- A [HaxBall headless token](https://www.haxball.com/headlesstoken) (39 characters)

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
| `teamSize` | Target players per team for auto-balance (e.g. `3` for 3v3) |
| `maxAdmins` | Max player-admins in the room |
| `disableBans` | Disable ban command when `true` |
| `debugMode` | Relaxed AFK limits for testing |
| `stadiumKeys` | Which map file to load for each auto-balance scenario (see below) |
| `masters` | Array of player auth strings with full control |
| `admins` | Array of `[auth, nickname]` pairs for permanent admins |

**`stadiumKeys`** — keys must match a filename in `stadiums/` (without `.hbs`):

```json
"stadiumKeys": {
  "default": "FutsalTraining",
  "solo": "FutsalTraining",
  "duel": "Futsal1x1",
  "small": "Futsal2x2",
  "full": "Futsal3x3"
}
```

The bot picks the map automatically when players join/leave:

- **1 player** → `default` / training, solo on red
- **2 players** → `duel` (1v1)
- **5 players** (with `teamSize: 3`) → `small` (2v2)
- **6 players** → `full` (3v3)

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

Each map is a **JSON stadium** saved as `stadiums/<name>.hbs`. Files are loaded at startup and sorted alphabetically by filename — that order defines the map numbers used by `!map`.

### Included maps

| File | Purpose |
|------|---------|
| `FutsalTraining.hbs` | Training / solo practice (no score/time limit) |
| `Futsal1x1.hbs` | 1v1 futsal |
| `Futsal2x2.hbs` | 2v2 futsal |
| `Futsal3x3.hbs` | 3v3 futsal |
| `classic.hbs`, `big.hbs`, `training.hbs` | Legacy maps from the original bot |

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

**Example** (training — endless session):

```json
{
  "name": "Futsal Training",
  "width": 420,
  "...": "...",
  "scoreLimit": 0,
  "timeLimit": 0
}
```

**Example** (ranked 3v3 — 3 goals, 3 minutes):

```json
{
  "name": "Futsal 3v3",
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

Map numbers match the alphabetical list printed by `!map` (e.g. `#1`, `#2`, …).

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
