import { DurableObject } from 'cloudflare:workers';
import { BOT_DEFAULT_CHARACTERS, BOT_DIFFICULTIES, BOT_MAX_COUNT, BOT_MIN_COUNT, BOT_SCORE_TARGET, BOT_RESPAWN_MS, cleanBotCount, cleanDifficulty, cleanBotWeapon, isBotWeapon, createBot, updateBot, respawnBot } from '../../../assets/js/dm-bot-brain.js';

export interface Env { ROOMS: DurableObjectNamespace<DeathmatchRoom> }
type Player = { token: string; name: string; character: string; loadout: 'white'|'black'; slot: number; x: number; z: number; yaw: number; health: number; score: number; ammo: number; weapon: string; lastMove: number; lastShot: number; reloadAt: number; disconnectedAt: number|null; respawnAt: number; counts: Record<string, number> };
// A pending grenade: thrown at the point, it detonates at detonateAt
// (2 s fuse) and the blast is applied by the alarm, not by the throw
// packet — so the damage lands when the grenade lands, on every client.
// A placed claymore: armed at armedAt (1 s), it detonates when an
// ENEMY crosses its front 60° arc within 6 m (never its owner).
export type Grenade = { x: number; z: number; detonateAt: number; owner: number };
export type Mine = { owner: number; x: number; z: number; yaw: number; armedAt: number };
// A bot is the brain's createBot() shape (see assets/js/dm-bot-brain.js)
// plus lastShotAt, the ms timestamp of its last shot, so clients can
// draw the bot's tracer. The brain keeps lastShot (cadence) separately.
export type Bot = { id: string; name: string; character: string; weapon: string; loadout: 'white'|'black'; difficulty: string; x: number; z: number; yaw: number; health: number; score: number; ammo: number; dead: boolean; respawnAt: number; lastShot: number; lastShotAt: number; reloadUntil: number; [key: string]: any };
export type RoomMode = 'pvp'|'coop'|'duel';
// A katana duel is a single fight to 3 hits (not first-to-10): each
// duelist has DUEL_HITS health and the katana deals 1 per hit. The
// first kill ends the match — no respawn, no score target.
export const DUEL_HITS = 3;
export type Difficulty = 'easy'|'normal'|'hard';
// A shot event: the relay's hit resolution, broadcast so every client
// can render the same effects (blood + a bullet hole on the victim's
// model on a hit, a surface bullet hole + sparks on a miss, the
// opponent's tracer, a thrown knife that sticks, an RPG7 explosion).
// origin/dir are the validated shoot packet's ray (for a melee swing
// they are the shooter's chest + facing). point is the hit point on
// the victim (ray origin + dir * along) when hit, absent on a miss —
// the client raycasts the miss against its own surfaces. The event is
// transient: the broadcast carries it once and clears it (see
// broadcast), so a later state never re-renders it. Grenades and
// claymores need no event — their pending entries already broadcast,
// and an entry disappearing is the detonation (both arenas render the
// explosion from that).
export type ShotEvent = { type: 'shot'; slot: number; weapon: string; origin: { x: number; y: number; z: number }; dir: { x: number; y: number; z: number }; hit: boolean; point?: { x: number; y: number; z: number } };
export type DmEvent = ShotEvent;
export type RoomState = { map: MapId; players: (Player|null)[]; startedAt: number|null; createdAt: number; finished: boolean; winner: number|null; finishReason: 'score'|'forfeit'|'expired'|null; mode: RoomMode; bots: Bot[]; difficulty: Difficulty; teamScore: { humans: number; bots: number }; winnerTeam: 'humans'|'bots'|null; lastBotTick: number; grenades: Grenade[]; mines: Mine[]; events: DmEvent[] };
// Per-map arena bounds (x/z half-extents) and diagonal-opposite spawns,
// mirroring the courtyard's pattern. The lobby only offers the maps whose
// pages wire deathmatch mode (courtyard, mall); ballroom and theater are
// defined here for when their pages gain a gun system.
const MAPS = {
  courtyard: { bounds: { x: 39, z: 39 }, spawns: [{ x: -14, z: 20, yaw: -0.61 }, { x: 14, z: -20, yaw: 2.53 }] },
  ballroom: { bounds: { x: 19, z: 13 }, spawns: [{ x: -14, z: 9, yaw: -0.61 }, { x: 14, z: -9, yaw: 2.53 }] },
  // The theater is the katana-duel arena: the fight is on the stage
  // (x -12..12, z -6..6), so the spawns face each other across it and
  // the bounds cover the stage + house (z to 29.5) while the client
  // clamps the player to the theater's own walls.
  theater: { bounds: { x: 13, z: 29 }, spawns: [{ x: -6, z: 2, yaw: -1.25 }, { x: 6, z: -2, yaw: 1.89 }] },
  mall: { bounds: { x: 19, z: 29 }, spawns: [{ x: -14, z: 24, yaw: -0.61 }, { x: 14, z: -24, yaw: 2.53 }] },
} as const;
type MapId = keyof typeof MAPS;
const cleanMap = (v: unknown): MapId => (typeof v === 'string' && v in MAPS ? (v as MapId) : 'courtyard');
// A character is a plain .fbx/.glb filename (no directories, no '..') —
// the game page validates it against the real roster before loading.
const cleanCharacter = (v: unknown): string => (typeof v === 'string' && /^[A-Za-z0-9_.\-]+\.(fbx|glb)$/.test(v) && !v.includes('..') ? v : 'Agent_Kyle.fbx');
// Weapon table — mirrors the game's WEAPON_CYCLE stats in index.html
// (damage / rate / magazine). The worker's rate is the client's rate
// minus ~10 ms, the same tolerance the old pistol/rifle table used
// (pistol 280→270, rifle 110→105). The Shotgun's rate IS its pump gate
// (PUMP_T 600 ms in index.html) — the pump is the shotgun's real fire
// cadence, so the relay enforces it server-side. The RPG7 is a
// rifle-class visual variant (no launcher / AoE), so it takes rifle stats.
// kind / range: 'hitscan' and 'thrown' resolve on the ray (range is the
// ray's max reach — the sniper's 80 m beats the old 60 m); 'melee' is
// the knife (no ammo, cap 0 — it never reloads, and its hit is a
// distance + front-arc check, not a ray); 'blast' is the grenade (the
// throw packet carries the landing point, the blast is applied on the
// fuse by the alarm, damage falling off to 20 at the 5 m edge);
// 'mine' is the claymore (placed by a 'place' packet, never shot).
// 'melee' is the knife (no ammo, cap 0 — it never reloads, and its hit is a
// distance + front-arc check, not a ray) and the katana (same melee
// resolution, 2.5 m reach, 1 damage — the duel's 3-hit fight).
// A weapon reloads only when it is a hitscan gun — consumables
// (throwing knife, grenade, claymore) are spent for the life, and the
// per-weapon counts on the Player track them across switches.
const WEAPONS = {
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
} as const;
type WeaponId = keyof typeof WEAPONS;
// A weapon reloads only when it is a hitscan gun (the 8 + the sniper).
// Anything else is a consumable or has no magazine at all.
const isReloadable = (w: (typeof WEAPONS)[WeaponId]) => w.kind === 'hitscan';
const usesAmmo = (w: (typeof WEAPONS)[WeaponId]) => w.cap > 0;
export const GRENADE_FUSE_MS = 2000;
export const GRENADE_BLAST_M = 5;
export const MINE_ARM_MS = 1000;
export const MINE_RANGE_M = 6;
// Grenade falloff: full damage at the centre, 20 at the blast edge.
export function grenadeDamageAt(dmg: number, dist: number, blast: number) {
  return Math.max(20, Math.round(dmg * (1 - dist / blast)));
}
const cleanWeapon = (v: unknown): WeaponId => (typeof v === 'string' && v in WEAPONS ? (v as WeaponId) : 'Glock');
const cleanLoadout = (v: unknown): 'white'|'black' => (v === 'white' ? 'white' : 'black');
const ROOM_TTL_MS=2*60*60*1000;
const BOT_TICK_MS=500;
const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const randomId = (length:number) => Array.from(crypto.getRandomValues(new Uint8Array(length)), n => alphabet[n % alphabet.length]).join('');
const json = (body:unknown,status=200) => new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json; charset=utf-8','access-control-allow-origin':'*','access-control-allow-headers':'content-type','access-control-allow-methods':'GET,POST,OPTIONS'}});

// A bot count is only valid as a plain 1..4 integer (a JSON number, or a
// digit string). Anything else — 0, 5, 'three', a float — is rejected
// with a 400 at room creation, never silently clamped.
const isValidBotCount = (v: unknown): boolean => {
  if (typeof v === 'number') return Number.isInteger(v) && v >= BOT_MIN_COUNT && v <= BOT_MAX_COUNT;
  if (typeof v === 'string' && /^\d+$/.test(v.trim())) { const n = parseInt(v, 10); return n >= BOT_MIN_COUNT && n <= BOT_MAX_COUNT; }
  return false;
};
// Bot spawn for slot i: the human-opposite spawn (MAPS[map].spawns[1]),
// jittered per bot so the squad does not stack, clamped inside bounds.
function botSpawn(map: MapId, index: number) {
  const base = MAPS[map].spawns[1], bounds = MAPS[map].bounds;
  const offsets = [[0, 0], [2, 1.5], [-2, 1.5], [0, 3]][index % 4];
  return { x: Math.max(-bounds.x, Math.min(bounds.x, base.x + offsets[0])), z: Math.max(-bounds.z, Math.min(bounds.z, base.z + offsets[1])), yaw: base.yaw };
}

// Build the bot squad for a co-op room: names always "BOT 1".."BOT N"
// (bots never pretend to be people), characters cycling the five real
// terrorist files, every bot on the given weapon, black loadout.
export function createBotsForRoom(map: MapId, count: number, difficulty: string, weapon?: string): Bot[] {
  const n = cleanBotCount(count), diff = cleanDifficulty(difficulty) as Difficulty, w = cleanBotWeapon(weapon);
  return Array.from({ length: n }, (_, i) => {
    const spawn = botSpawn(map, i);
    const bot = createBot({ id: `bot-${i + 1}`, name: `BOT ${i + 1}`, character: BOT_DEFAULT_CHARACTERS[i % BOT_DEFAULT_CHARACTERS.length], weapon: w, loadout: 'black', difficulty: diff, x: spawn.x, z: spawn.z, yaw: spawn.yaw, waypoints: null }) as Bot;
    bot.lastShotAt = 0;
    return bot;
  });
}

// One 500 ms relay bot tick over a co-op room: each living bot runs the
// shared brain (updateBot) against the living humans, its shots are
// applied (a kill scores for the bots and respawns the human after
// BOT_RESPAWN_MS), and dead bots whose respawn time has come are put
// back on a bot spawn. Bots only tick while the match has started and
// at least one human is connected. The relay holds no obstacle map, so
// canMove is bounds-only and hasLOS is range-only — the brain's
// sightRange plus its 22 m shooting gate does the rest (see README).
// Returns the bot shoot events (hit or miss) for the caller to render.
export function tickBots(state: RoomState, now: number, random?: () => number) {
  const events: any[] = [];
  if (state.mode !== 'coop' || state.finished || !state.startedAt) return events;
  const humans = state.players.filter((p): p is Player => !!p && p.disconnectedAt === null);
  if (humans.length === 0) return events;
  const dt = state.lastBotTick ? Math.min(Math.max((now - state.lastBotTick) / 1000, 0), 1) : 0.5;
  const bounds = MAPS[state.map].bounds;
  const targets = humans.map(p => ({ id: `player-${p.slot}`, x: p.x, z: p.z, alive: p.health > 0 }));
  for (let i = 0; i < state.bots.length; i++) {
    if (state.finished) break;
    const bot = state.bots[i];
    if (bot.dead) { if (bot.respawnAt && bot.respawnAt <= now) respawnBot(bot, botSpawn(state.map, i)); continue; }
    const botEvents = updateBot(bot, { now, dt, targets, bounds, canMove: (x: number, z: number) => x >= -bounds.x && x <= bounds.x && z >= -bounds.z && z <= bounds.z, hasLOS: () => true, random }, dt);
    for (const ev of botEvents) {
      if (ev.type !== 'shoot') continue;
      bot.lastShotAt = now;
      events.push(ev);
      if (!ev.hit) continue;
      const target = humans.find(p => `player-${p.slot}` === ev.targetId);
      if (!target || target.health <= 0) continue;
      target.health = Math.max(0, target.health - ev.damage);
      if (target.health === 0) {
        bot.score++;
        state.teamScore.bots++;
        target.respawnAt = now + BOT_RESPAWN_MS;
        if (state.teamScore.bots >= BOT_SCORE_TARGET) { state.finished = true; state.winnerTeam = 'bots'; state.finishReason = 'score'; }
      }
    }
  }
  state.lastBotTick = now;
  return events;
}

// Append a shot event to the room's transient event list (created on
// demand, so fabricated test states without one still work).
function pushShotEvent(state: RoomState, slot: number, weapon: string, origin: { x: number; y: number; z: number }, dir: { x: number; y: number; z: number }, hit: boolean, point?: { x: number; y: number; z: number }) {
  if (!state.events) state.events = [];
  state.events.push(point ? { type: 'shot', slot, weapon, origin, dir, hit, point } : { type: 'shot', slot, weapon, origin, dir, hit });
}

// The shoot packet's hit resolution, shared by the DO handler and the
// tests. The ray weapons (hitscan + the thrown knife) use the same ray
// math as the PvP path (target point at 1.25 m height, 0.78 m hit
// radius, the weapon's own range — the sniper's 80 m beats the old
// 60 m), tested against the opponent and against each living bot, and
// applied to the nearest target the ray actually crosses. The knife
// is a distance + front-arc check, not a ray (2.2 m, 45° either side
// of the shooter's facing). The grenade carries its landing point in
// the packet — the relay validates it (within throw range and inside
// the arena) and stores the pending blast; the fuse is applied by the
// alarm (applyGrenadeBlasts), so the damage lands when the grenade
// lands, on every client. The claymore never comes through 'shoot'
// (it uses the 'place' packet — see placeMine). A bot kill scores for
// the shooter and for the humans' team; the humans win the match at
// BOT_SCORE_TARGET (10). A spent consumable never reloads — the
// per-weapon counts on the shooter track what is left across switches.
// Returns {fired, hit, changed} — changed is true whenever the helper
// mutated state (a shot fired, or an empty mag starting its reload),
// so the caller knows whether to save/broadcast.
export function resolveHumanShot(state: RoomState, shooterSlot: number, packet: any, now: number) {
  const result = { fired: false, hit: false, changed: false };
  const shooter = state.players[shooterSlot];
  if (!shooter || state.finished || !state.startedAt) return result;
  if (typeof packet.weapon !== 'string' || !(packet.weapon in WEAPONS)) return result;
  const w = WEAPONS[packet.weapon as WeaponId], rate = w.rate, capacity = w.cap, damage = w.dmg;
  if (w.kind === 'mine') return result; // a claymore is placed, never shot
  if (now < shooter.reloadAt || now - shooter.lastShot < rate) return result;
  if (shooter.weapon !== packet.weapon) {
    shooter.weapon = packet.weapon;
    shooter.ammo = isReloadable(w) ? capacity : (shooter.counts[packet.weapon] ?? capacity);
    shooter.reloadAt = 0; result.changed = true; // the switch itself is a state change
  }
  if (usesAmmo(w)) {
    if (shooter.ammo <= 0) {
      if (!isReloadable(w)) return result; // consumable spent — switch weapons
      shooter.reloadAt = now + 1400; result.changed = true; return result;
    }
  }
  const other = state.players[1 - shooterSlot];
  // Shared kill handling: a bot death scores for the shooter and the
  // humans' team; an opponent death scores for the shooter (PvP only —
  // co-op has no friendly fire, so the opponent is never a target).
  const killBot = (bot: Bot) => {
    bot.dead = true; bot.respawnAt = now + BOT_RESPAWN_MS;
    shooter.score++; state.teamScore.humans++;
    if (state.teamScore.humans >= BOT_SCORE_TARGET) { state.finished = true; state.winnerTeam = 'humans'; state.finishReason = 'score'; }
  };
  const killOpponent = () => {
    if (!other) return;
    // A katana duel ends on the first kill (3 hits, no respawn, no
    // score target) — the winner is the duelist who landed the third hit.
    if (state.mode === 'duel') {
      shooter.score++;
      state.finished = true; state.winner = shooterSlot; state.finishReason = 'score';
      return;
    }
    other.respawnAt = now + 2500; shooter.score++;
    if (shooter.score >= 10) { state.finished = true; state.winner = shooterSlot; if (state.mode === 'coop') state.winnerTeam = 'humans'; state.finishReason = 'score'; }
  };
  // Grenade: validate the landing point, spend one, store the pending
  // blast. The fuse is the alarm's job (applyGrenadeBlasts).
  if (w.kind === 'blast') {
    const pt = packet.point || {}, px = Number(pt.x), pz = Number(pt.z), bounds = MAPS[state.map].bounds;
    if (!Number.isFinite(px) || !Number.isFinite(pz) || Math.hypot(px - shooter.x, pz - shooter.z) > w.range || Math.abs(px) > bounds.x || Math.abs(pz) > bounds.z) return result;
    shooter.lastShot = now; shooter.ammo--; shooter.counts[packet.weapon] = shooter.ammo;
    state.grenades.push({ x: px, z: pz, detonateAt: now + GRENADE_FUSE_MS, owner: shooterSlot });
    result.fired = true; result.changed = true; return result;
  }
  // Knife: nearest living target inside 2.2 m and in front of the shooter.
  if (w.kind === 'melee') {
    shooter.lastShot = now; result.fired = true; result.changed = true;
    const fx = Math.sin(shooter.yaw), fz = Math.cos(shooter.yaw);
    let best: { dist: number; tx: number; tz: number; apply: () => void } | null = null;
    const considerMelee = (tx: number, tz: number, apply: () => void) => {
      const dx = tx - shooter.x, dz = tz - shooter.z, dist = Math.hypot(dx, dz);
      if (dist > w.range || dist <= 0) return;
      if ((dx * fx + dz * fz) / dist < 0.707) return; // outside the front 45°
      if (!best || dist < best.dist) best = { dist, tx, tz, apply };
    };
    if (state.mode !== 'coop' && other && other.health > 0) considerMelee(other.x, other.z, () => {
      other.health = Math.max(0, other.health - damage);
      if (other.health === 0) killOpponent();
    });
    for (const bot of state.bots) {
      if (bot.dead || bot.health <= 0) continue;
      considerMelee(bot.x, bot.z, () => {
        bot.health = Math.max(0, bot.health - damage);
        if (bot.health === 0) killBot(bot);
      });
    }
    // The swing has no ray in the packet: the event carries the
    // shooter's chest + facing, and the victim's chest on a hit.
    if (best) { best.apply(); result.hit = true; pushShotEvent(state, shooterSlot, packet.weapon, { x: shooter.x, y: 1.4, z: shooter.z }, { x: fx, y: 0, z: fz }, true, { x: best.tx, y: 1.4, z: best.tz }); }
    else pushShotEvent(state, shooterSlot, packet.weapon, { x: shooter.x, y: 1.4, z: shooter.z }, { x: fx, y: 0, z: fz }, false);
    return result;
  }
  // Ray weapons (hitscan + thrown knife): the ray must be a unit
  // direction from near the shooter's position, as before.
  const d = packet.dir || {}, o = packet.origin || {}, dx = Number(d.x), dy = Number(d.y), dz = Number(d.z), ox = Number(o.x), oy = Number(o.y), oz = Number(o.z), len = Math.hypot(dx, dy, dz);
  if (!Number.isFinite(len) || len < 0.9 || len > 1.1 || ![ox, oy, oz].every(Number.isFinite) || Math.hypot(ox - shooter.x, oz - shooter.z) > 5 || oy < 1.1 || oy > 4.5) return result;
  shooter.lastShot = now;
  if (usesAmmo(w)) { shooter.ammo--; if (!isReloadable(w)) shooter.counts[packet.weapon] = shooter.ammo; }
  result.fired = true; result.changed = true;
  const dir = new Vec3(dx / len, dy / len, dz / len);
  // Nearest target the ray crosses: the opponent, then each living bot.
  let best: { along: number; apply: () => void } | null = null;
  const consider = (tx: number, tz: number, apply: () => void) => {
    const target = new Vec3(tx - ox, 1.25 - oy, tz - oz), along = target.dot(dir), miss = Math.sqrt(Math.max(0, target.lengthSq() - along * along));
    if (along > 0 && along <= w.range && miss <= 0.78 && (!best || along < best.along)) best = { along, apply };
  };
  // Co-op: humans are one team — a teammate is never a target, so a
  // shot passes through them to the bot behind (no friendly fire).
  if (state.mode !== 'coop' && other && other.health > 0) consider(other.x, other.z, () => {
    other.health = Math.max(0, other.health - damage);
    if (other.health === 0) killOpponent();
  });
  for (const bot of state.bots) {
    if (bot.dead || bot.health <= 0) continue;
    consider(bot.x, bot.z, () => {
      bot.health = Math.max(0, bot.health - damage);
      if (bot.health === 0) killBot(bot);
    });
  }
  if (best) { best.apply(); result.hit = true; }
  // The shot event carries the ray and, on a hit, the hit point on the
  // victim (ray origin + dir * along) — the clients render blood, the
  // model bullet hole and the opponent's tracer from it; on a miss they
  // raycast the same ray against their own surfaces for the wall hole.
  const hitPoint = result.hit && best ? { x: ox + (dx / len) * best.along, y: oy + (dy / len) * best.along, z: oz + (dz / len) * best.along } : undefined;
  pushShotEvent(state, shooterSlot, packet.weapon, { x: ox, y: oy, z: oz }, { x: dx / len, y: dy / len, z: dz / len }, result.hit, hitPoint);
  if (usesAmmo(w) && shooter.ammo === 0 && isReloadable(w)) shooter.reloadAt = now + 1400;
  return result;
}

// Apply every grenade whose fuse has run out: falloff damage to each
// enemy inside the blast, and to the thrower too (a grenade at your own
// feet hurts — a self-kill scores for nobody, it just respawns you).
// Returns true when a grenade detonated (state changed).
export function applyGrenadeBlasts(state: RoomState, now: number) {
  if (state.finished || state.grenades.length === 0) return false;
  let changed = false;
  const due = state.grenades.filter(g => g.detonateAt <= now);
  if (due.length === 0) return false;
  state.grenades = state.grenades.filter(g => g.detonateAt > now);
  for (const g of due) {
    changed = true;
    const w = WEAPONS.Grenade, blast = w.blast ?? GRENADE_BLAST_M;
    const hitTarget = (tx: number, tz: number) => {
      const dist = Math.hypot(tx - g.x, tz - g.z);
      return dist <= blast ? grenadeDamageAt(w.dmg, dist, blast) : 0;
    };
    const owner = state.players[g.owner];
    // Enemies: the opponent in PvP, the bots in co-op.
    if (state.mode !== 'coop') {
      const other = state.players[1 - g.owner];
      if (other && other.health > 0) {
        const dmg = hitTarget(other.x, other.z);
        if (dmg > 0) {
          other.health = Math.max(0, other.health - dmg);
          if (other.health === 0 && owner) {
            owner.score++; other.respawnAt = now + 2500;
            if (owner.score >= 10) { state.finished = true; state.winner = g.owner; state.finishReason = 'score'; }
          }
        }
      }
    } else {
      for (const bot of state.bots) {
        if (bot.dead || bot.health <= 0) continue;
        const dmg = hitTarget(bot.x, bot.z);
        if (dmg <= 0) continue;
        bot.health = Math.max(0, bot.health - dmg);
        if (bot.health === 0 && owner) {
          bot.dead = true; bot.respawnAt = now + BOT_RESPAWN_MS;
          owner.score++; state.teamScore.humans++;
          if (state.teamScore.humans >= BOT_SCORE_TARGET) { state.finished = true; state.winnerTeam = 'humans'; state.finishReason = 'score'; }
        }
      }
    }
    // Self-damage: the thrower takes the blast too, but a self-kill
    // scores for nobody.
    if (owner && owner.health > 0) {
      const dmg = hitTarget(owner.x, owner.z);
      if (dmg > 0) {
        owner.health = Math.max(0, owner.health - dmg);
        if (owner.health === 0) owner.respawnAt = now + 2500;
      }
    }
    if (state.finished) break;
  }
  return changed;
}

// Detonate every armed claymore an enemy has crossed into: flat damage
// to each enemy inside the mine's front 60° arc within 6 m. A mine
// never triggers on its owner. Returns true when a mine detonated.
export function checkMines(state: RoomState, now: number) {
  if (state.finished || state.mines.length === 0) return false;
  let changed = false;
  const armed = state.mines.filter(m => m.armedAt <= now);
  if (armed.length === 0) return false;
  for (const m of armed) {
    const fx = Math.sin(m.yaw), fz = Math.cos(m.yaw);
    const inArc = (tx: number, tz: number) => {
      const dx = tx - m.x, dz = tz - m.z, dist = Math.hypot(dx, dz);
      if (dist > MINE_RANGE_M || dist <= 0) return false;
      return (dx * fx + dz * fz) / dist >= 0.866; // inside the front 30° half-angle
    };
    const owner = state.players[m.owner];
    let tripped = false;
    const victims: { apply: () => void }[] = [];
    if (state.mode !== 'coop') {
      const other = state.players[1 - m.owner];
      if (other && other.health > 0 && inArc(other.x, other.z)) {
        tripped = true;
        victims.push({ apply: () => {
          other.health = Math.max(0, other.health - WEAPONS.Claymore.dmg);
          if (other.health === 0 && owner) {
            owner.score++; other.respawnAt = now + 2500;
            if (owner.score >= 10) { state.finished = true; state.winner = m.owner; state.finishReason = 'score'; }
          }
        }});
      }
    } else {
      for (const bot of state.bots) {
        if (bot.dead || bot.health <= 0 || !inArc(bot.x, bot.z)) continue;
        tripped = true;
        victims.push({ apply: () => {
          bot.health = Math.max(0, bot.health - WEAPONS.Claymore.dmg);
          if (bot.health === 0 && owner) {
            bot.dead = true; bot.respawnAt = now + BOT_RESPAWN_MS;
            owner.score++; state.teamScore.humans++;
            if (state.teamScore.humans >= BOT_SCORE_TARGET) { state.finished = true; state.winnerTeam = 'humans'; state.finishReason = 'score'; }
          }
        }});
      }
    }
    if (!tripped) continue;
    changed = true;
    state.mines = state.mines.filter(x => x !== m);
    for (const v of victims) v.apply();
    if (state.finished) break;
  }
  return changed;
}

// Place a claymore: the 'place' packet's validation + storage, shared
// by the DO handler and the tests. The mine goes 1 m in front of the
// player only when the packet's point is within 3 m of them (and inside
// the arena), they have a claymore left, and the rate gate is met.
// Returns true when a mine was placed (state changed).
export function placeMine(state: RoomState, slot: number, packet: any, now: number) {
  const p = state.players[slot];
  if (!p || state.finished || !state.startedAt) return false;
  if (packet.weapon !== 'Claymore' || !(packet.weapon in WEAPONS)) return false;
  const w = WEAPONS.Claymore;
  if (now - p.lastShot < w.rate) return false;
  const left = p.counts.Claymore ?? w.cap;
  if (left <= 0) return false;
  const x = Number(packet.x), z = Number(packet.z), yaw = Number(packet.yaw), bounds = MAPS[state.map].bounds;
  if (![x, z, yaw].every(Number.isFinite) || Math.hypot(x - p.x, z - p.z) > 3 || Math.abs(x) > bounds.x || Math.abs(z) > bounds.z) return false;
  p.lastShot = now; p.ammo = left - 1; p.counts.Claymore = p.ammo;
  state.mines.push({ owner: slot, x, z, yaw, armedAt: now + MINE_ARM_MS });
  return true;
}

export default {
  async fetch(request:Request, env:Env):Promise<Response> {
    const url = new URL(request.url);
    if (request.method === 'OPTIONS') return new Response(null,{status:204,headers:{'access-control-allow-origin':'*','access-control-allow-headers':'content-type','access-control-allow-methods':'GET,POST,OPTIONS'}});
    const roomMatch=url.pathname.match(/^\/room\/([A-HJ-NP-Z2-9]{6})$/);
    if(roomMatch&&request.headers.get('upgrade')==='websocket'){
      const room=env.ROOMS.get(env.ROOMS.idFromName(roomMatch[1]));
      return room.fetch(new Request('https://room/room'+url.search,{method:'GET',headers:request.headers}));
    }
    if (request.method !== 'POST') return json({error:'Not found'},404);
    let body:any; try { body = await request.json(); } catch { return json({error:'Invalid JSON'},400); }
    if (url.pathname === '/api/rooms/create') {
      const code = randomId(6), token = randomId(32);
      if (body.map !== undefined && !(typeof body.map === 'string' && body.map in MAPS)) return json({error:'Unknown map.'},400);
      if (body.character !== undefined && cleanCharacter(body.character) !== body.character) return json({error:'Unknown character.'},400);
      if (body.weapon !== undefined && !(typeof body.weapon === 'string' && body.weapon in WEAPONS)) return json({error:'Unknown weapon.'},400);
      if (body.loadout !== undefined && body.loadout !== 'white' && body.loadout !== 'black') return json({error:'Unknown loadout.'},400);
      if (body.mode !== undefined && body.mode !== 'pvp' && body.mode !== 'coop' && body.mode !== 'duel') return json({error:'Unknown mode.'},400);
      if (body.botCount !== undefined && !isValidBotCount(body.botCount)) return json({error:'Bot count must be an integer from 1 to 4.'},400);
      if (body.difficulty !== undefined && !(typeof body.difficulty === 'string' && (BOT_DIFFICULTIES as readonly string[]).includes(body.difficulty))) return json({error:'Unknown difficulty.'},400);
      if (body.botWeapon !== undefined && !isBotWeapon(body.botWeapon)) return json({error:'Unknown bot weapon.'},400);
      const mode: RoomMode = body.mode === 'coop' ? 'coop' : body.mode === 'duel' ? 'duel' : 'pvp';
      const botCount = mode === 'coop' ? cleanBotCount(body.botCount) : 0;
      const difficulty = cleanDifficulty(body.difficulty) as Difficulty;
      const room = env.ROOMS.get(env.ROOMS.idFromName(code));
      const response = await room.fetch('https://room/reserve',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({token,name:cleanName(body.name),slot:0,map:cleanMap(body.map),character:cleanCharacter(body.character),weapon:cleanWeapon(body.weapon),loadout:cleanLoadout(body.loadout),mode,botCount,difficulty,botWeapon:cleanBotWeapon(body.botWeapon)})});
      if (!response.ok) return json({error:'Could not create room'},500);
      return json({code,token,map:cleanMap(body.map),mode,botCount,difficulty});
    }
    if (url.pathname === '/api/rooms/join') {
      const code = String(body.code||'').toUpperCase();
      if (!/^[A-HJ-NP-Z2-9]{6}$/.test(code)) return json({error:'Enter a valid six-character room code.'},400);
      if (body.character !== undefined && cleanCharacter(body.character) !== body.character) return json({error:'Unknown character.'},400);
      if (body.weapon !== undefined && !(typeof body.weapon === 'string' && body.weapon in WEAPONS)) return json({error:'Unknown weapon.'},400);
      if (body.loadout !== undefined && body.loadout !== 'white' && body.loadout !== 'black') return json({error:'Unknown loadout.'},400);
      const token = randomId(32), room = env.ROOMS.get(env.ROOMS.idFromName(code));
      const response = await room.fetch('https://room/reserve',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({token,name:cleanName(body.name),slot:1,character:cleanCharacter(body.character),weapon:cleanWeapon(body.weapon),loadout:cleanLoadout(body.loadout)})});
      if (!response.ok) return json({error:(await response.json() as any).error||'Room is unavailable.'},response.status);
      const reserved = await response.json() as any;
      return json({code,token,map:reserved.map||'courtyard',mode:reserved.mode||'pvp',botCount:reserved.botCount??0,difficulty:reserved.difficulty||'normal'});
    }
    return json({error:'Not found'},404);
  }
} satisfies ExportedHandler<Env>;

function cleanName(value:unknown){return String(value||'Agent').replace(/[<>\u0000-\u001f]/g,'').trim().slice(0,18)||'Agent';}
function blankPlayer(token:string,name:string,slot:number,map:MapId,character:string,weapon:WeaponId,loadout:'white'|'black',health=100):Player{const spawn=MAPS[map].spawns[slot];return {token,name,character,loadout,slot,x:spawn.x,z:spawn.z,yaw:spawn.yaw,health,score:0,ammo:WEAPONS[weapon].cap,weapon,lastMove:0,lastShot:0,reloadAt:0,disconnectedAt:null,respawnAt:0,counts:{}};}
function blankState():RoomState{return {map:'courtyard',players:[null,null],startedAt:null,createdAt:Date.now(),finished:false,winner:null,finishReason:null,mode:'pvp',bots:[],difficulty:'normal',teamScore:{humans:0,bots:0},winnerTeam:null,lastBotTick:0,grenades:[],mines:[],events:[]};}

// When a match may start. Co-op starts with one human online (bots fill the
// other side), but a PvP/duel match must not start while the guest is still
// loading: both reserved slots need a live socket, or the host can shoot an
// unattended character and the absent player's 30 s forfeit timer never runs
// (their disconnectedAt stays null until they first connect).
export function shouldStartMatch(mode: RoomMode, players: (Player|null)[], online: Set<string>): boolean {
  if (mode === 'coop') return online.size >= 1;
  return players.every(p => !!p && online.has(p.token));
}

export class DeathmatchRoom extends DurableObject<Env> {
  private statePromise:Promise<RoomState>;
  constructor(ctx:DurableObjectState,env:Env){super(ctx,env);this.statePromise=ctx.blockConcurrencyWhile(async()=>{let state=await ctx.storage.get<RoomState>('room');if(!state){state=blankState();await ctx.storage.put('room',state);}return state;});}
  private async load(){await this.statePromise;return (await this.ctx.storage.get<RoomState>('room'))!;}
  private async save(state:RoomState){await this.ctx.storage.put('room',state);}
  private async scheduleAlarm(state:RoomState){const times:number[]=[state.createdAt+ROOM_TTL_MS];for(const p of state.players){if(!p)continue;if(p.reloadAt>0)times.push(p.reloadAt);if(p.respawnAt>0)times.push(p.respawnAt);if(p.disconnectedAt&&!state.finished)times.push(p.disconnectedAt+30_000);}for(const g of state.grenades)times.push(g.detonateAt);for(const m of state.mines)times.push(m.armedAt);if(state.mode==='coop'&&state.startedAt&&!state.finished&&state.players.some(p=>p&&!p.disconnectedAt))times.push((state.lastBotTick||Date.now())+BOT_TICK_MS);await this.ctx.storage.setAlarm(Math.min(...times));}
  private onlineTokens(exclude?:WebSocket){return new Set(this.ctx.getWebSockets().filter(ws=>ws!==exclude).map(ws=>{try{return (ws.deserializeAttachment() as any).token;}catch{return '';}}));}
  private publicState(state:RoomState){const online=this.onlineTokens();const anyConnected=state.players.some(p=>p&&!p.disconnectedAt);return {type:'state',map:state.map,mode:state.mode,started:state.startedAt!==null&&!state.finished,finished:state.finished,reason:state.finishReason,paused:state.mode==='coop'?!anyConnected:state.players.some(p=>!!p?.disconnectedAt),winner:state.winner,winnerTeam:state.winnerTeam,teamScore:state.teamScore,events:state.events||[],grenades:state.grenades.map(g=>({x:g.x,z:g.z,detonateAt:g.detonateAt,owner:g.owner})),mines:state.mines.map(m=>({owner:m.owner,x:m.x,z:m.z,yaw:m.yaw,armedAt:m.armedAt})),bots:state.bots.map(b=>({id:b.id,name:b.name,character:b.character,loadout:b.loadout,weapon:b.weapon,x:b.x,z:b.z,yaw:b.yaw,health:b.health,score:b.score,ammo:b.ammo,dead:b.dead,respawnAt:b.respawnAt,lastShotAt:b.lastShotAt||0})),players:state.players.map(p=>p?{slot:p.slot,name:p.name,character:p.character,loadout:p.loadout,x:p.x,z:p.z,yaw:p.yaw,health:p.health,score:p.score,ammo:p.ammo,weapon:p.weapon,counts:p.counts||{},respawnAt:p.respawnAt,connected:online.has(p.token)}:null)};}
  private async broadcast(state:RoomState){const message=JSON.stringify(this.publicState(state));const hadEvents=(state.events||[]).length>0;if(hadEvents){state.events=[];await this.save(state);}for(const ws of this.ctx.getWebSockets())try{ws.send(message);}catch{}}
  async fetch(request:Request):Promise<Response>{
    const url=new URL(request.url);
    if(url.pathname==='/reserve'&&request.method==='POST'){
      const input:any=await request.json(), state=await this.load();
      if(state.finished)return json({error:'This match has ended.'},410);
      const existing=state.players.find(p=>p?.token===input.token);
      if(existing)return json({slot:existing.slot,map:state.map});
      if(input.slot===1&&state.players[0]===null)return json({error:'Room code was not found.'},404);
      if(state.players[input.slot])return json({error:'Room already has two agents.'},409);
      if(input.slot===0){state.map=cleanMap(input.map);state.mode=input.mode==='coop'?'coop':input.mode==='duel'?'duel':'pvp';state.difficulty=cleanDifficulty(input.difficulty) as Difficulty;state.bots=state.mode==='coop'?createBotsForRoom(state.map,cleanBotCount(input.botCount),state.difficulty,cleanBotWeapon(input.botWeapon)):[];state.teamScore={humans:0,bots:0};state.winnerTeam=null;state.lastBotTick=0;}
      state.players[input.slot]=blankPlayer(input.token,cleanName(input.name),input.slot,state.map,cleanCharacter(input.character),cleanWeapon(input.weapon),cleanLoadout(input.loadout),state.mode==='duel'?DUEL_HITS:100);await this.save(state);await this.scheduleAlarm(state);return json({slot:input.slot,map:state.map,mode:state.mode,botCount:state.bots.length,difficulty:state.difficulty});
    }
    if(url.pathname==='/room'&&request.headers.get('upgrade')==='websocket'){
      const token=url.searchParams.get('token')||'',state=await this.load(),player=state.players.find(p=>p?.token===token);
      if(!player)return json({error:'Invalid room token.'},403);
      for(const ws of this.ctx.getWebSockets())try{if((ws.deserializeAttachment() as any).token===token)ws.close(4001,'Reconnected');}catch{}
      const pair=new WebSocketPair(),client=pair[0],server=pair[1];server.serializeAttachment({token,slot:player.slot});this.ctx.acceptWebSocket(server);
      player.disconnectedAt=null;
      if(state.startedAt===null&&shouldStartMatch(state.mode,state.players,this.onlineTokens())){state.startedAt=Date.now();state.lastBotTick=Date.now();}
      await this.save(state);server.send(JSON.stringify({type:'welcome',slot:player.slot,code:(await this.ctx.storage.get('code'))||'',reconnectSeconds:30}));
      await this.broadcast(state);return new Response(null,{status:101,webSocket:client});
    }
    return json({error:'Not found'},404);
  }
  async webSocketMessage(ws:WebSocket,message:string|ArrayBuffer){
    const attachment:any=ws.deserializeAttachment(),state=await this.load(),p=state.players[attachment?.slot];if(!p||p.token!==attachment.token)return;
    let packet:any;try{packet=JSON.parse(typeof message==='string'?message:new TextDecoder().decode(message));}catch{return;}
    const now=Date.now(), other=state.players[1-p.slot];
    if(packet.type==='move'&&!state.finished){
      // PvP blocks on ANY disconnected player; co-op blocks only when NO
      // human is connected, so a lone human keeps playing with a partner down.
      const blocked=state.mode==='coop'?!state.players.some(pl=>pl&&!pl.disconnectedAt):state.players.some(pl=>pl?.disconnectedAt);
      if(blocked)return;
      const x=Number(packet.x),z=Number(packet.z),yaw=Number(packet.yaw);if(!Number.isFinite(x)||!Number.isFinite(z)||!Number.isFinite(yaw))return;
      const bounds=MAPS[state.map].bounds;
      const nextX=Math.max(-bounds.x,Math.min(bounds.x,x)),nextZ=Math.max(-bounds.z,Math.min(bounds.z,z)),elapsed=Math.max(0.05,(now-(p.lastMove||now))/1000),distance=Math.hypot(nextX-p.x,nextZ-p.z);
      if(distance>Math.min(8*elapsed+1.5,5))return;
      p.x=nextX;p.z=nextZ;p.yaw=((yaw+Math.PI)%(Math.PI*2)+Math.PI*2)%(Math.PI*2)-Math.PI;p.lastMove=now;
      if(!state.startedAt&&shouldStartMatch(state.mode,state.players,this.onlineTokens())){state.startedAt=now;state.lastBotTick=now;}
      checkMines(state,now); // walking into an enemy mine's arc detonates it
      await this.save(state);await this.broadcast(state);return;
    }
    if(packet.type==='place'&&!state.finished&&state.startedAt){
      // Claymore placement: the client sends the point + facing; the
      // relay validates it (see placeMine) and stores the mine.
      if(placeMine(state,p.slot,packet,now)){await this.save(state);await this.scheduleAlarm(state);await this.broadcast(state);}
      return;
    }
    if(packet.type==='shoot'&&!state.finished&&state.startedAt){
      // PvP needs a living opponent and no disconnected player, as before.
      // Co-op needs a living target (opponent or bot) and at least one
      // connected human; a lone human + bots is a valid match.
      if(state.mode==='coop'){
        if(!(other&&other.health>0)&&!state.bots.some(b=>!b.dead))return;
        if(!state.players.some(pl=>pl&&!pl.disconnectedAt))return;
      } else if(!other||other.health<=0||state.players.some(pl=>pl?.disconnectedAt))return;
      const result=resolveHumanShot(state,p.slot,packet,now);
      if(!result.changed)return;
      await this.save(state);await this.scheduleAlarm(state);await this.broadcast(state);return;
    }
    if(packet.type==='weapon'&&!state.finished){
      if(typeof packet.weapon!=='string'||!(packet.weapon in WEAPONS))return;
      if(p.weapon!==packet.weapon){p.weapon=packet.weapon;const w=WEAPONS[packet.weapon as WeaponId];p.ammo=isReloadable(w)?w.cap:(p.counts[packet.weapon]??w.cap);p.reloadAt=0;await this.save(state);await this.broadcast(state);}
      return;
    }
    if(packet.type==='reload'&&!state.finished){p.reloadAt=now+1400;await this.save(state);await this.scheduleAlarm(state);}
  }
  async webSocketClose(ws:WebSocket){const a:any=ws.deserializeAttachment();if(!a||this.onlineTokens(ws).has(a.token))return;const state=await this.load(),p=state.players[a.slot];if(!p||p.token!==a.token)return;p.disconnectedAt=Date.now();await this.save(state);await this.scheduleAlarm(state);await this.broadcast(state);}
  async webSocketError(ws:WebSocket){await this.webSocketClose(ws);}
  async alarm(){const state=await this.load(),now=Date.now();if(now>=state.createdAt+ROOM_TTL_MS){state.finished=true;state.finishReason='expired';await this.save(state);await this.broadcast(state);for(const ws of this.ctx.getWebSockets())try{ws.close(1000,'Room expired');}catch{}await this.ctx.storage.deleteAll();return;}for(const p of state.players){if(!p)continue;if(p.reloadAt&&p.reloadAt<=now){const w=WEAPONS[p.weapon as WeaponId];if(isReloadable(w))p.ammo=w.cap;p.reloadAt=0;}if(p.respawnAt&&p.respawnAt<=now){const spawn=MAPS[state.map].spawns[p.slot];p.x=spawn.x;p.z=spawn.z;p.yaw=spawn.yaw;p.health=100;p.ammo=WEAPONS[p.weapon as WeaponId].cap;p.counts={};p.respawnAt=0;}if(p.disconnectedAt&&now-p.disconnectedAt>=30_000&&!state.finished&&state.mode!=='coop'){state.finished=true;state.winner=1-p.slot;state.finishReason='forfeit';}}
    if(state.mode==='coop'&&!state.finished){const humans=state.players.filter((p):p is Player=>!!p);if(humans.length&&humans.every(p=>p.disconnectedAt)&&now-Math.max(...humans.map(p=>p.disconnectedAt!))>=30_000){state.finished=true;state.winnerTeam='bots';state.finishReason='forfeit';}}
    if(state.mode==='coop'&&!state.finished)tickBots(state,now);
    if(!state.finished){applyGrenadeBlasts(state,now);checkMines(state,now);}
    await this.save(state);await this.scheduleAlarm(state);await this.broadcast(state);
  }
}
class Vec3 {constructor(public x:number,public y:number,public z:number){} dot(v:Vec3){return this.x*v.x+this.y*v.y+this.z*v.z;}lengthSq(){return this.x*this.x+this.y*this.y+this.z*this.z;}}
