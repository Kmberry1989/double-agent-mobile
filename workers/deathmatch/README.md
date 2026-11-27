# Deathmatch relay

The static game uses this Cloudflare Worker as its private-room WebSocket relay. Each six-character room maps to one Durable Object. The relay owns score, health, ammo cadence, reloads, hit checks, respawns, and the 30-second disconnect-forfeit timer. Rooms expire after two hours.

## Rooms, maps, characters

A room is created on one arena map and keeps that map for the whole match. The lobby (`deathmatch.html`) offers the arenas whose pages wire deathmatch mode — Courtyard and Mall. The relay also defines Ballroom (40×28) and Theater (30×42) bounds and spawns, for when those pages gain a gun system; the lobby does not offer them yet. The creator picks the arena; a joiner plays on the room's arena (their own arena pick is ignored).

Each player picks a character in the lobby (the full roster from `assets/characters/` — agents, guests, terrorists, Halloween, shoppers). The relay stores each player's `character` filename (a plain `.fbx`/`.glb` filename only — anything else is rejected) and broadcasts it in the room state, so each client renders the opponent's picked model. The game page validates the filename against the roster before loading it.

Per-map arena bounds and diagonal-opposite spawns (mirroring the courtyard):

| Map | Bounds (x / z) | Spawns |
|---|---|---|
| Courtyard | ±39 / ±39 | (−14, 20) / (14, −20) |
| Ballroom | ±19 / ±13 | (−14, 9) / (14, −9) |
| Theater | ±14 / ±20 | (−10, 16) / (10, −16) |
| Mall | ±19 / ±29 | (−14, 24) / (14, −24) |

## Loadout

Each player picks a loadout in the lobby: a finish (Black or White — the `white_` / `black_` weapon sets) and a starting weapon (any of the 8 in the game's `WEAPON_CYCLE`). The relay stores each player's `loadout` and `weapon` (variant name) and broadcasts both in the room state, so each client knows the opponent's finish and weapon. The full cycle is available in-match on the Courtyard — Tab cycles weapons, 1–8 select one directly, D-pad Up cycles on a controller — and the client tells the relay the new weapon at once (`weapon` packet), so its damage / rate / magazine follow the pick even before the next shot. The Mall has no weapon models and no in-match switch, so there the lobby's starting weapon sets the match's weapon (rate / magazine) while the shot stays the simple pistol tracer.

The relay's weapon table mirrors the game's stats (`index.html`):

| Weapon | Damage | Rate (ms) | Magazine |
|---|---|---|---|
| Glock | 34 | 270 | 12 |
| Walther | 34 | 270 | 12 |
| Makarov | 34 | 270 | 12 |
| Revolver | 40 | 340 | 6 |
| MP5K | 50 | 105 | 30 |
| AKS74U | 50 | 105 | 30 |
| Shotgun | 70 | 600 | 5 |
| RPG7 | 50 | 105 | 30 |

The rate is the client's rate minus ~10 ms (pistol 280→270, rifle 110→105). The Shotgun's rate is its pump gate (600 ms) — the pump is the shotgun's real fire cadence, so the relay enforces it server-side. The RPG7 is a rifle-class visual variant (no launcher / AoE), so it takes rifle stats. An unknown weapon or loadout is rejected at room create/join (400), and an unknown weapon in a shoot or weapon packet is ignored. Reload is 1400 ms for every weapon, as before; respawn refills to the current weapon's magazine.

## Co-op vs bots

A room can also be a co-op match — one or two humans against a squad of AI bots. The lobby creates one with `mode: 'coop'` plus `botCount` (1–4) and `difficulty` (`easy`, `normal` or `hard`), and an optional `botWeapon` (any of the 8 weapons, default `Glock`). Validation is strict: a bot count outside 1–4 — including `0`, `5`, or a non-number like `'three'` — is a 400, not a silent clamp, and an unknown bot weapon or difficulty is a 400 too. The create response returns `mode`, `botCount` and `difficulty` alongside the room code, token and map, and a join on the room returns the same fields so the lobby can redirect correctly. A plain `pvp` room behaves exactly as before (no bots, `mode: 'pvp'`).

The bots are created at room creation: names are always `BOT 1` … `BOT N` (bots never pretend to be people), characters cycle the five real terrorist files (`enemy-terror1.fbx` … `enemy-terror5.fbx`), every bot carries the room's bot weapon on the black loadout, and they spawn on the opposite side of the arena from the human spawn, jittered per bot and clamped inside the map bounds. Their brains live in `assets/js/dm-bot-brain.js`, the single shared bot brain — the arena pages import the same file for solo vs AI, so difficulty numbers, weapon stats, reload (1400 ms) and respawn (2500 ms) are identical wherever the bots run. The relay reuses the brain's `createBot`, `updateBot` and `respawnBot` plus its `cleanBotCount` / `cleanDifficulty` / `cleanBotWeapon` validators.

While a co-op match runs, the Durable Object ticks the bots every 500 ms (a bot-tick alarm merged into the existing alarm schedule, alongside TTL / reload / respawn / disconnect times). Each tick runs `updateBot` per living bot against the living humans and applies its shots: a hit damages the human, a kill scores one for the bots and respawns the human after 2500 ms. Dead bots respawn on a bot spawn after 2500 ms. Each bot's `lastShotAt` is broadcast in the room state so clients can draw the bot's tracer. The relay holds no obstacle map, so relay bots move in the open arena (`canMove` is bounds-only) and use range as their line of sight (`hasLOS` always returns true) — the brain's `sightRange` per difficulty plus its 22 m shooting gate does the rest. This matches how the relay already resolves human shots without obstacle data.

Scoring is by team, first to 10: `teamScore.humans` counts bot takedowns (a human shooting a bot uses the same ray math as a PvP shot — target point at 1.25 m height, 0.78 m hit radius, nearest target the ray crosses), `teamScore.bots` counts human deaths. At 10 the match ends with `winnerTeam: 'humans'` or `'bots'` and `finishReason: 'score'`, both broadcast in the room state alongside the per-bot list (`id`, `name`, `character`, `loadout`, `weapon`, `x`, `z`, `yaw`, `health`, `score`, `ammo`, `dead`, `respawnAt`, `lastShotAt`) and `teamScore`.

Start, pause and forfeit differ from PvP in one way: a co-op match starts when the FIRST human connects, not when both slots fill — a lone human plus bots is a valid match. While it runs, move/shoot are blocked only when NO human is connected (PvP still blocks when ANY player is disconnected). If all humans are disconnected for 30 s, the match ends with `winnerTeam: 'bots'` and `finishReason: 'forfeit'`. PvP forfeit behaviour is unchanged.

The testable logic is factored into exported pure helpers in `src/index.ts` so the Vitest suite (which cannot do Durable Object websockets) can cover it: `createBotsForRoom(map, count, difficulty, weapon)`, `tickBots(state, now, random?)` (one bot tick over `state.bots` vs `state.players`, applying bot shots, respawns, team score and the win), and `resolveHumanShot(state, shooterSlot, packet, now)` (the shoot-packet hit resolution against the opponent and the bots). The Durable Object methods call these helpers; there is no duplicated shot or tick logic.

## Deploy

```sh
npm install
npm test
npx wrangler deploy
```

After deployment, set `DEATHMATCH_RELAY_URL` in `assets/js/deathmatch-config.js` to the Worker origin (for example, `https://double-agent-deathmatch.<account>.workers.dev`). Redeploy the static site after setting it. The room setup page explains this configuration while the URL is blank. The relay URL is still blank in source — it is set only after the Worker is deployed (which needs Kyle's Cloudflare sign-in).

The local test suite covers room creation, one opponent reservation, full rooms, malformed codes, unknown codes, the map + character fields (a room created on the mall with a character, a join on the room's map, and rejection of an unknown map and a path-traversal character), the loadout + starting weapon (a room created with a white loadout and a Shotgun, and rejection of an unknown weapon and an unknown loadout), and co-op vs bots (a co-op room created with a bot count and difficulty, a join returning the room's mode / bot count / difficulty / map, and rejection of a bad bot count, bot weapon and difficulty; a bot tick that hits a human for the bot weapon's damage and a low-health kill that scores for the bots and sets the human respawning; a human shot that damages a bot, a low-health bot kill that scores for the humans, and the humans reaching 10 to win the match). The bot tests call the exported pure helpers (`createBotsForRoom`, `tickBots`, `resolveHumanShot`) on fabricated room state. Cloudflare's current Vitest integration does not support Durable Object WebSockets with per-test storage isolation, so live two-browser relay play still needs a deployed or local `wrangler dev` session.
