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

## Deploy

```sh
npm install
npm test
npx wrangler deploy
```

After deployment, set `DEATHMATCH_RELAY_URL` in `assets/js/deathmatch-config.js` to the Worker origin (for example, `https://double-agent-deathmatch.<account>.workers.dev`). Redeploy the static site after setting it. The room setup page explains this configuration while the URL is blank. The relay URL is still blank in source — it is set only after the Worker is deployed (which needs Kyle's Cloudflare sign-in).

The local test suite covers room creation, one opponent reservation, full rooms, malformed codes, unknown codes, and the map + character fields (a room created on the mall with a character, a join on the room's map, and rejection of an unknown map and a path-traversal character). Cloudflare's current Vitest integration does not support Durable Object WebSockets with per-test storage isolation, so live two-browser relay play still needs a deployed or local `wrangler dev` session.
