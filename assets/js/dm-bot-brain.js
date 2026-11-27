// Deathmatch bot brain — pure logic, no THREE, no DOM. Shared by the
// arena pages (solo vs AI bots run in the page) and the relay worker
// (co-op bots run in the Durable Object). Both import this one file so
// the bot behaviour is identical wherever it runs.
//
// The brain is the courtyard guard AI with the stealth/detection half
// removed: a bot patrols waypoints, chases the nearest living target it
// can see, and shoots with the game's real weapon stats. Difficulty
// numbers are grounded in the guard's own parameters (patrol 2 m/s,
// alert chase 4.5 m/s, shot every 900 ms, vision 19 m) — easy is slower
// and less accurate than a guard, normal matches a guard, hard is a
// guard at its fastest with better aim. Bots never pretend to be
// people: their names are always "BOT <n>".

export const BOT_MIN_COUNT = 1;
export const BOT_MAX_COUNT = 4;
export const BOT_DEFAULT_COUNT = 2;
export const BOT_SCORE_TARGET = 10; // first team to 10 takedowns, same as 1v1
export const BOT_DIFFICULTIES = ['easy', 'normal', 'hard'];
// Default bot characters: the five real terrorist files. Any roster
// character may be used instead — the lobby / room only ever passes a
// real roster filename.
export const BOT_DEFAULT_CHARACTERS = ['enemy-terror1.fbx', 'enemy-terror2.fbx', 'enemy-terror3.fbx', 'enemy-terror4.fbx', 'enemy-terror5.fbx'];

// Weapon table — the same stats as the relay's WEAPONS table in
// workers/deathmatch/src/index.ts and the game's WEAPON_CYCLE. The
// bot's fire cadence is max(weapon rate, difficulty shot interval):
// the weapon sets the fastest it can fire, the difficulty sets how
// often it chooses to. Reload is 1400 ms for every weapon, as for humans.
// kind / range: 'hitscan' is the ray the relay already resolves;
// 'thrown' is a thrown blade (ray, 30 m); 'melee' is the knife (no
// ammo, 2.2 m) and the katana (no ammo, 2.5 m — the duel sword, 1
// damage per hit for the 3-hit duel); 'blast' (grenade) and 'mine'
// (claymore) are NOT bot weapons — a bot has no throw or place
// behaviour, so cleanBotWeapon rejects them (the relay answers 400).
// The sniper is a long ray (80 m) but the brain's 22 m shooting gate
// still caps it.
export const BOT_WEAPONS = {
  Glock: { dmg: 34, rate: 270, cap: 12, kind: 'hitscan', range: 60 },
  Walther: { dmg: 34, rate: 270, cap: 12, kind: 'hitscan', range: 60 },
  Makarov: { dmg: 34, rate: 270, cap: 12, kind: 'hitscan', range: 60 },
  Revolver: { dmg: 40, rate: 340, cap: 6, kind: 'hitscan', range: 60 },
  MP5K: { dmg: 50, rate: 105, cap: 30, kind: 'hitscan', range: 60 },
  AKS74U: { dmg: 50, rate: 105, cap: 30, kind: 'hitscan', range: 60 },
  Shotgun: { dmg: 70, rate: 600, cap: 5, kind: 'hitscan', range: 60 },
  RPG7: { dmg: 50, rate: 105, cap: 30, kind: 'hitscan', range: 60 },
  Knife: { dmg: 50, rate: 490, cap: 0, kind: 'melee', range: 2.2 },
  ThrowingKnife: { dmg: 40, rate: 690, cap: 2, kind: 'thrown', range: 30 },
  Grenade: { dmg: 90, rate: 990, cap: 1, kind: 'blast', range: 25, blast: 5 },
  Claymore: { dmg: 100, rate: 990, cap: 1, kind: 'mine', range: 6, blast: 6 },
  SniperRifle: { dmg: 100, rate: 1190, cap: 5, kind: 'hitscan', range: 80 },
  Katana: { dmg: 1, rate: 490, cap: 0, kind: 'melee', range: 2.5 },
};
export const BOT_RELOAD_MS = 1400;
export const BOT_RESPAWN_MS = 2500;

// Difficulty — grounded in the courtyard guard's parameters.
export const BOT_DIFFICULTY = {
  // Slower than a guard on patrol and in chase, shoots less often and
  // hits about a third of the time, takes almost a second to react.
  easy: { patrolSpeed: 1.6, chaseSpeed: 3.0, shotIntervalMs: 1400, hitChance: 0.35, reactionMs: 900, sightRange: 16 },
  // A guard, near enough: patrol 2, chase 4, a shot about every second,
  // a bit over half the shots on target, ~0.6 s to react.
  normal: { patrolSpeed: 2.0, chaseSpeed: 4.0, shotIntervalMs: 1000, hitChance: 0.55, reactionMs: 600, sightRange: 19 },
  // A guard at its fastest chase, shooting every 0.8 s, three shots in
  // four on target, reacting in about a third of a second.
  hard: { patrolSpeed: 2.4, chaseSpeed: 4.5, shotIntervalMs: 800, hitChance: 0.75, reactionMs: 350, sightRange: 22 },
};

export function cleanBotCount(v) {
  const n = typeof v === 'number' ? v : parseInt(v, 10);
  if (!Number.isFinite(n)) return BOT_DEFAULT_COUNT;
  return Math.max(BOT_MIN_COUNT, Math.min(BOT_MAX_COUNT, Math.floor(n)));
}
export function cleanDifficulty(v) {
  return typeof v === 'string' && v in BOT_DIFFICULTY ? v : 'normal';
}
export function cleanBotWeapon(v) {
  // Only weapons a bot can actually shoot: hitscan, a thrown blade
  // (ray) or the knife (melee, range-gated below). A grenade needs a
  // throw + fuse and a claymore needs placing — the brain has neither
  // behaviour, so those fall back to the Glock.
  return isBotWeapon(v) ? v : 'Glock';
}
// True when the value names a weapon a bot can shoot (see above).
// The relay uses this for its botWeapon validation (400, not a clamp).
export function isBotWeapon(v) {
  return typeof v === 'string' && v in BOT_WEAPONS &&
    (BOT_WEAPONS[v].kind === 'hitscan' || BOT_WEAPONS[v].kind === 'thrown' || BOT_WEAPONS[v].kind === 'melee');
}
// A bot character is a plain .fbx/.glb filename, same rule as the relay's
// cleanCharacter. Returns null when the filename is not acceptable.
export function cleanBotCharacter(v) {
  return typeof v === 'string' && /^[A-Za-z0-9_.\-]+\.(fbx|glb)$/.test(v) && !v.includes('..') ? v : null;
}

export function createBot({ id, name, character, weapon, loadout, difficulty, x, z, yaw, waypoints }) {
  const diff = cleanDifficulty(difficulty);
  const w = cleanBotWeapon(weapon);
  return {
    id: id || 'bot-0',
    name: name || 'BOT 1',
    character: cleanBotCharacter(character) || BOT_DEFAULT_CHARACTERS[0],
    weapon: w,
    loadout: loadout === 'white' ? 'white' : 'black',
    difficulty: diff,
    x: x || 0, z: z || 0, yaw: yaw || 0,
    health: 100, score: 0, ammo: BOT_WEAPONS[w].cap,
    state: 'PATROL', wp: 0,
    waypoints: Array.isArray(waypoints) && waypoints.length ? waypoints : null,
    lastShot: 0, reloadUntil: 0, respawnAt: 0, dead: false,
    seenAt: 0, lastKnown: null, lostAt: 0, stuckAt: 0, stuckX: 0, stuckZ: 0,
  };
}

// One tick of bot AI. Mutates the bot in place and returns the events
// the caller must render/apply (shots). Movement is applied directly
// to bot.x / bot.z / bot.yaw.
//
// env:
//   now      — ms timestamp (performance.now() in the page, Date.now() in the worker)
//   dt       — seconds since the last tick
//   targets  — [{id, x, z, alive}] — the humans this bot hunts
//   bounds   — {x, z} half-extents of the arena
//   canMove(x, z) — false when the point is inside a wall/obstacle (or
//     outside the arena); the brain also clamps to bounds itself
//   hasLOS(x1, z1, x2, z2) — true when nothing blocks the shot between
//     the two ground points (eye height is the caller's business; the
//     pages pass their hasLOS at ~1.5 m, the worker passes range-only
//     because the relay holds no obstacle map — see the README)
//   random   — optional () => [0,1), defaults to Math.random (tests
//     inject a fixed one)
export function updateBot(bot, env, dt) {
  const events = [];
  if (bot.dead || dt <= 0) return events;
  const now = env.now;
  const diff = BOT_DIFFICULTY[bot.difficulty];
  const rand = env.random || Math.random;
  const w = BOT_WEAPONS[bot.weapon];

  // Reload: an empty mag refills after BOT_RELOAD_MS, same as humans.
  if (bot.reloadUntil && now >= bot.reloadUntil) { bot.ammo = w.cap; bot.reloadUntil = 0; }

  // Nearest living target.
  let target = null, targetDist = Infinity;
  for (const t of env.targets || []) {
    if (!t || t.alive === false) continue;
    const d = Math.hypot(t.x - bot.x, t.z - bot.z);
    if (d < targetDist) { target = t; targetDist = d; }
  }
  const seesTarget = !!target && targetDist <= diff.sightRange &&
    env.hasLOS(bot.x, bot.z, target.x, target.z);
  if (seesTarget) {
    // seenAt marks the FIRST sighting: the reaction gate below compares
    // now - seenAt against reactionMs, so it must not be re-stamped on
    // every tick while the target stays visible — re-stamping it made
    // the gate 0 >= reactionMs, i.e. bots could never shoot at all.
    if (bot.state !== 'CHASE') bot.seenAt = now;
    bot.lastKnown = { x: target.x, z: target.z };
    bot.lostAt = 0;
  } else if (bot.lastKnown && !bot.lostAt) {
    bot.lostAt = now;
  }

  let speed = 0, desiredYaw = bot.yaw;
  if (seesTarget) {
    bot.state = 'CHASE';
    desiredYaw = Math.atan2(target.x - bot.x, target.z - bot.z);
    if (targetDist > 2) speed = diff.chaseSpeed;
  } else if (bot.lastKnown && now - (bot.lostAt || now) < 4000) {
    // Lost sight recently: push on to where the target was last seen.
    bot.state = 'SEARCH';
    const dx = bot.lastKnown.x - bot.x, dz = bot.lastKnown.z - bot.z;
    const d = Math.hypot(dx, dz);
    if (d > 1) { desiredYaw = Math.atan2(dx, dz); speed = diff.chaseSpeed * 0.75; }
    else { bot.lastKnown = null; bot.state = 'PATROL'; }
  } else {
    bot.state = 'PATROL';
    bot.lastKnown = null;
    // Patrol: follow the waypoint loop; without one, wander to random
    // points inside the bounds (the pages pass real patrol loops).
    let wp = bot.waypoints ? bot.waypoints[bot.wp] : null;
    if (!wp) {
      if (!bot._wander || Math.hypot(bot._wander[0] - bot.x, bot._wander[1] - bot.z) < 1) {
        bot._wander = [(rand() * 2 - 1) * env.bounds.x * 0.8, (rand() * 2 - 1) * env.bounds.z * 0.8];
      }
      wp = bot._wander;
    }
    const dx = wp[0] - bot.x, dz = wp[1] - bot.z, d = Math.hypot(dx, dz);
    if (d < 1) {
      if (bot.waypoints) bot.wp = (bot.wp + 1) % bot.waypoints.length;
      else bot._wander = null;
    } else { desiredYaw = Math.atan2(dx, dz); speed = diff.patrolSpeed; }
  }

  // Smooth turn (same 6/s turn rate as the guards), then move with
  // collision. If the bot makes no progress for 1.5 s it is stuck on
  // something — skip to the next waypoint.
  let dy = desiredYaw - bot.yaw;
  while (dy > Math.PI) dy -= Math.PI * 2;
  while (dy < -Math.PI) dy += Math.PI * 2;
  bot.yaw += dy * Math.min(1, dt * 6);
  if (speed > 0) {
    const nx = bot.x + Math.sin(bot.yaw) * speed * dt;
    const nz = bot.z + Math.cos(bot.yaw) * speed * dt;
    const cx = Math.max(-env.bounds.x, Math.min(env.bounds.x, nx));
    const cz = Math.max(-env.bounds.z, Math.min(env.bounds.z, nz));
    if (env.canMove(cx, cz)) { bot.x = cx; bot.z = cz; }
    if (Math.hypot(bot.x - bot.stuckX, bot.z - bot.stuckZ) < 0.05) {
      if (!bot.stuckAt) bot.stuckAt = now;
      else if (now - bot.stuckAt > 1500) {
        if (bot.waypoints) bot.wp = (bot.wp + 1) % bot.waypoints.length;
        else bot._wander = null;
        bot.stuckAt = 0;
      }
    } else { bot.stuckX = bot.x; bot.stuckZ = bot.z; bot.stuckAt = 0; }
  }

  // Shoot: in range, line of sight, reacted, cadence met, ammo to spend.
  // The hit is a difficulty roll — the caller applies damage on a hit
  // and renders the tracer either way, so a miss still reads as a shot.
  // Range is the weapon's own (a knife only slashes inside 2.2 m, a
  // katana inside 2.5 m, a sniper's 80 m is still capped by the brain's
  // 22 m shooting gate). A weapon with no magazine (the knife, the
  // katana, cap 0) never reloads.
  const shootRange = Math.min(22, w.range ?? 22), usesAmmo = w.cap > 0;
  if (seesTarget && targetDist <= shootRange && now - bot.seenAt >= diff.reactionMs &&
      !bot.reloadUntil && now - bot.lastShot >= Math.max(w.rate, diff.shotIntervalMs)) {
    bot.lastShot = now;
    if (usesAmmo) { bot.ammo--; if (bot.ammo <= 0) bot.reloadUntil = now + BOT_RELOAD_MS; }
    events.push({ type: 'shoot', botId: bot.id, targetId: target.id, hit: rand() < diff.hitChance, damage: w.dmg, weapon: bot.weapon });
  }
  return events;
}

// Reset a dead bot onto a spawn: full health, full mag, patrolling.
export function respawnBot(bot, spawn) {
  bot.x = spawn.x; bot.z = spawn.z; bot.yaw = spawn.yaw || 0;
  bot.health = 100; bot.ammo = BOT_WEAPONS[bot.weapon].cap;
  bot.dead = false; bot.respawnAt = 0; bot.reloadUntil = 0;
  bot.state = 'PATROL'; bot.lastKnown = null; bot.lostAt = 0; bot.seenAt = 0;
}
