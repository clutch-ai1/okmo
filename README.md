# Pokémon MMO Catcher

A multiplayer Pokémon-catching idle game. Every 2 minutes a Pokémon spawns globally — every connected player sees the same species but rolls their own IVs. You can either let your default AFK ball fly automatically, or click **Catch!** during the 60-second window to pick a specific ball. The result reveals at the end of the window. Global chat, leaderboards, and offline AFK rewards are included.

> **Private learning project.** Pokémon names, sprites, and ball icons belong to Nintendo / Game Freak / The Pokémon Company. Do not host this publicly.

## Quick start (local)

```bash
cd C:\okmo
npm install
npm start
```

Then open `http://localhost:3000` in your browser. Register a trainer name, log in, and the game starts. Open a second browser window (or another device on your network) to play with another account.

## Architecture

```
.
├── package.json
├── index.html
├── css/style.css
├── js/                       # client
│   ├── data.js               # 151 Pokémon, areas, balls, achievements
│   ├── sprites.js            # PokeAPI sprite loader (lazy)
│   ├── net.js                # auth + WebSocket
│   ├── spawn.js              # main spawn-view canvas
│   ├── chat.js               # chat panel
│   ├── ui.js                 # modals (Box, Pokedex, Leaderboards, Settings)
│   └── main.js               # boot + event wiring
└── server/                   # backend
    ├── server.js             # Express + WS entry, routes, dispatch
    ├── auth.js               # bcrypt + JWT + OAuth stubs
    ├── db.js                 # SQLite schema + prepared queries
    ├── data.js               # server-side Pokémon data
    ├── game.js               # spawn loop + catch resolution + offline AFK
    ├── chat.js               # chat handler with /show command
    └── leaderboard.js        # leaderboard queries
```

The server is **authoritative**: spawns, IV rolls, catch RNG, ball deduction, chat rate-limiting all run on the server. Clients are pure renderers + intent senders.

## Game loop

| Time   | Event                                                      |
| ------ | ---------------------------------------------------------- |
| T = 0  | Server picks a Pokémon, broadcasts spawn to all connected. |
| 0–60s  | Each player gets their own IV roll. Default AFK ball is pre-loaded. Players can click **Catch!** to swap to a different ball. |
| T = 60s| Server resolves all attempts, broadcasts personal results. |
| T = 120s| New spawn.                                                 |

Areas rotate so all 8 zones (Pallet Meadow → Safari Zone) get spawns over time, with rare zones appearing less frequently.

## Persistence

- **SQLite database** (`data.sqlite` in project root by default). Override with `DB_PATH` env var.
- Tables: `users`, `caught_pokemon`, `chat_messages`, `spawns`, `spawn_attempts`.
- WAL journal mode is **disabled** for compatibility with WSL/network filesystems. Standard rollback journal is used.

## Authentication

### Username + password (built-in)

Default and recommended. Passwords are bcrypt-hashed (cost factor 10). Login issues a JWT signed with `JWT_SECRET` env var.

### Discord / Google OAuth (opt-in)

To enable Discord:
1. Create an app at https://discord.com/developers/applications.
2. Under OAuth2 → Redirects, add: `https://your-server-url/auth/discord/callback`.
3. Set environment variables:
   ```
   DISCORD_CLIENT_ID=<client id>
   DISCORD_CLIENT_SECRET=<client secret>
   PUBLIC_URL=https://your-server-url
   ```

For Google: same flow at https://console.cloud.google.com/. Set `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`.

When OAuth env vars are missing, the buttons exist on the login page but the routes return a polite error.

## Deployment to Render.com

1. Push this folder to a GitHub repo.
2. On https://render.com, **New → Web Service** → connect the repo.
3. Settings:
   - Build Command: `npm install`
   - Start Command: `npm start`
   - Environment variables:
     - `JWT_SECRET` — random 32+ char string
     - `PUBLIC_URL` — your Render URL (e.g., `https://my-pokemon-mmo.onrender.com`)
     - `DB_PATH` — `/var/data/data.sqlite` (with persistent disk attached)
     - `DISCORD_CLIENT_ID` / `DISCORD_CLIENT_SECRET` (optional)
     - `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` (optional)
4. Add a **Persistent Disk** at `/var/data` (1 GB is plenty).
5. Deploy. Render handles WebSocket upgrades automatically.

Railway and Fly.io work similarly with their respective CLI tools.

## Chat commands

- Plain text: posts a chat message.
- `/show <caught_id>`: shares one of your caught Pokémon as a card with sprite, IVs, and tier.

## Leaderboards

Three boards, queried fresh each time the modal opens:
- **Most Catches** — total count.
- **Best IVs** — top single IV-total per player.
- **Pokédex** — distinct species discovered.

## Offline AFK rewards

When a player reconnects, the server replays any spawns that happened since their `last_seen` timestamp. For each missed spawn, their default AFK ball is consumed (if available) and a catch attempt is rolled. Up to 30 missed spawns are processed per reconnect to prevent abuse. The "While you were away…" modal shows the summary.

## Known limits

- **Single-server only.** No horizontal scaling — one Node process holds the spawn timer in memory.
- **No anti-cheat** beyond server-side authority. No client-side action is trusted.
- **No password reset flow** — if you forget your password you need DB access.
- **No images stored locally** — Pokémon and ball sprites are hot-linked from PokeAPI's GitHub mirror and Pokémon Showdown's CDN. If those services go down, sprites disappear and the game falls back to emoji placeholders.

## Development tips

- Reset the world: `rm data.sqlite` and restart the server. All accounts wiped.
- See live spawns: tail the server output. Clients reflect the same data via the chat system messages.
- Adjust spawn timing: edit `SPAWN_INTERVAL_MS` and `CATCH_WINDOW_MS` in `server/game.js`.
- Adjust ball regen: not implemented — players currently start with 20 Pokéballs / 5 Great Balls / 1 Ultra Ball. Add a daily-login bonus or passive regen if you want.
