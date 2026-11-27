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

## Deploy

```sh
npm install
npm test
npx wrangler deploy
```

After deployment, set `DEATHMATCH_RELAY_URL` in `assets/js/deathmatch-config.js` to the Worker origin (for example, `https://double-agent-deathmatch.<account>.workers.dev`). Redeploy the static site after setting it. The room setup page explains this configuration while the URL is blank. The relay URL is still blank in source — it is set only after the Worker is deployed (which needs Kyle's Cloudflare sign-in).

The local test suite covers room creation, one opponent reservation, full rooms, malformed codes, unknown codes, the map + character fields (a room created on the mall with a character, a join on the room's map, and rejection of an unknown map and a path-traversal character), and the loadout + starting weapon (a room created with a white loadout and a Shotgun, and rejection of an unknown weapon and an unknown loadout). Cloudflare's current Vitest integration does not support Durable Object WebSockets with per-test storage isolation, so live two-browser relay play still needs a deployed or local `wrangler dev` session.
