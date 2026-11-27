# Deathmatch relay

The static game uses this Cloudflare Worker as its private-room WebSocket relay. Each six-character room maps to one Durable Object. The relay owns score, health, ammo cadence, reloads, hit checks, respawns, and the 30-second disconnect-forfeit timer. Rooms expire after two hours.

## Deploy

```sh
npm install
npm test
npx wrangler deploy
```

After deployment, set `DEATHMATCH_RELAY_URL` in `assets/js/deathmatch-config.js` to the Worker origin (for example, `https://double-agent-deathmatch.<account>.workers.dev`). Redeploy the static site after setting it. The room setup page explains this configuration while the URL is blank.

The local test suite covers room creation, one opponent reservation, full rooms, malformed codes, and unknown codes. Cloudflare's current Vitest integration does not support Durable Object WebSockets with per-test storage isolation, so live two-browser relay play still needs a deployed or local `wrangler dev` session.
