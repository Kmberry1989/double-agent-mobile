import { env, exports } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { createBotsForRoom, tickBots, resolveHumanShot, applyGrenadeBlasts, checkMines, placeMine, grenadeDamageAt, GRENADE_FUSE_MS } from '../src/index.ts';
import type { RoomState } from '../src/index.ts';

// A fabricated co-op room for the pure-helper tests (no DO websockets:
// Cloudflare's Vitest integration cannot test Durable Object sockets).
function coopState(overrides: Partial<RoomState> = {}): RoomState {
  const bots = createBotsForRoom('courtyard', 1, 'hard', 'Glock');
  const state: RoomState = {
    map: 'courtyard',
    players: [
      { token: 'human-0', name: 'Host', character: 'Agent_Kyle.fbx', loadout: 'black', slot: 0, x: 0, z: 0, yaw: 0, health: 100, score: 0, ammo: 12, weapon: 'Glock', lastMove: 0, lastShot: 0, reloadAt: 0, disconnectedAt: null, respawnAt: 0, counts: {} },
      null,
    ],
    startedAt: 1000,
    createdAt: 0,
    finished: false,
    winner: null,
    finishReason: null,
    mode: 'coop',
    bots,
    difficulty: 'hard',
    teamScore: { humans: 0, bots: 0 },
    winnerTeam: null,
    lastBotTick: 1000,
    grenades: [],
    mines: [],
    events: [],
  };
  return { ...state, ...overrides };
}

describe('deathmatch room service', () => {
  it('creates a private six-character room and reserves one opponent slot', async () => {
    const created = await exports.default.fetch(new Request('https://relay/api/rooms/create', { method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({name:'Host'}) }),env);
    const room = await created.json() as {code:string;token:string};
    expect(created.status).toBe(200);
    expect(room.code).toMatch(/^[A-HJ-NP-Z2-9]{6}$/);
    const joined = await exports.default.fetch(new Request('https://relay/api/rooms/join', { method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({name:'Guest',code:room.code}) }),env);
    expect(joined.status).toBe(200);
    const overflow = await exports.default.fetch(new Request('https://relay/api/rooms/join', { method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({name:'Third',code:room.code}) }),env);
    expect(overflow.status).toBe(409);
  });

  it('rejects malformed room codes and unknown room codes', async () => {
    const malformed = await exports.default.fetch(new Request('https://relay/api/rooms/join', { method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({code:'!bad!'}) }),env);
    const unknown = await exports.default.fetch(new Request('https://relay/api/rooms/join', { method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({code:'AAAAAA'}) }),env);
    expect(malformed.status).toBe(400);
    expect(unknown.status).toBe(404);
  });

  it('carries the map and character, and rejects an unknown map or a path-traversal character', async () => {
    const created = await exports.default.fetch(new Request('https://relay/api/rooms/create', { method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({name:'Host',map:'mall',character:'Rochelle_combat.fbx'}) }),env);
    const room = await created.json() as {code:string;token:string;map:string};
    expect(created.status).toBe(200);
    expect(room.map).toBe('mall');
    const joined = await exports.default.fetch(new Request('https://relay/api/rooms/join', { method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({name:'Guest',code:room.code,character:'Kyle_combat.fbx'}) }),env);
    const joinedRoom = await joined.json() as {code:string;token:string;map:string};
    expect(joined.status).toBe(200);
    expect(joinedRoom.map).toBe('mall');
    const badMap = await exports.default.fetch(new Request('https://relay/api/rooms/create', { method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({name:'Host',map:'bogus'}) }),env);
    expect(badMap.status).toBe(400);
    const badCharacter = await exports.default.fetch(new Request('https://relay/api/rooms/create', { method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({name:'Host',character:'../../evil.fbx'}) }),env);
    expect(badCharacter.status).toBe(400);
  });

  it('carries the loadout and starting weapon, and rejects an unknown weapon or loadout', async () => {
    const created = await exports.default.fetch(new Request('https://relay/api/rooms/create', { method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({name:'Host',loadout:'white',weapon:'Shotgun'}) }),env);
    expect(created.status).toBe(200);
    const badWeapon = await exports.default.fetch(new Request('https://relay/api/rooms/create', { method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({name:'Host',weapon:'Blaster'}) }),env);
    expect(badWeapon.status).toBe(400);
    const badLoadout = await exports.default.fetch(new Request('https://relay/api/rooms/create', { method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({name:'Host',loadout:'gold'}) }),env);
    expect(badLoadout.status).toBe(400);
  });

  it('accepts the five new weapons as a starting weapon', async () => {
    for (const weapon of ['Knife', 'ThrowingKnife', 'Grenade', 'Claymore', 'SniperRifle']) {
      const created = await exports.default.fetch(new Request('https://relay/api/rooms/create', { method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({name:'Host',weapon}) }),env);
      expect(created.status).toBe(200);
    }
  });
});

describe('new weapons', () => {
  it('knife: hits inside 2.2 m in front, misses beyond range or behind', () => {
    const state = coopState();
    const human = state.players[0]!;
    const bot = state.bots[0];
    // Human faces +z (yaw 0): a bot 2 m ahead is in range.
    bot.x = 0; bot.z = 2;
    const swing = resolveHumanShot(state, 0, { type: 'shoot', weapon: 'Knife' }, 5000);
    expect(swing.fired).toBe(true);
    expect(swing.hit).toBe(true);
    expect(bot.health).toBe(100 - 50);
    // Beyond 2.2 m: a whiff (fired, no hit).
    bot.x = 0; bot.z = 3; bot.health = 100; human.lastShot = 0;
    const far = resolveHumanShot(state, 0, { type: 'shoot', weapon: 'Knife' }, 6000);
    expect(far.fired).toBe(true);
    expect(far.hit).toBe(false);
    expect(bot.health).toBe(100);
    // Behind the shooter: also a whiff.
    bot.x = 0; bot.z = -2; human.lastShot = 0;
    const behind = resolveHumanShot(state, 0, { type: 'shoot', weapon: 'Knife' }, 7000);
    expect(behind.hit).toBe(false);
    expect(bot.health).toBe(100);
  });

  it('throwing knife: a ray that reaches 30 m but not 40 m', () => {
    const state = coopState();
    const human = state.players[0]!;
    const bot = state.bots[0];
    bot.x = 0; bot.z = -25;
    const packet = { type: 'shoot', weapon: 'ThrowingKnife', origin: { x: 0, y: 1.5, z: 0 }, dir: { x: 0, y: 0, z: -1 } };
    const hit = resolveHumanShot(state, 0, packet, 5000);
    expect(hit.fired).toBe(true);
    expect(hit.hit).toBe(true);
    expect(bot.health).toBe(100 - 40);
    expect(human.ammo).toBe(5); // one of six thrown
    bot.x = 0; bot.z = -40; bot.health = 100; human.lastShot = 0;
    const far = resolveHumanShot(state, 0, packet, 6000);
    expect(far.fired).toBe(true);
    expect(far.hit).toBe(false);
    expect(bot.health).toBe(100);
  });

  it('grenade: the throw stores a pending blast, the fuse applies falloff damage', () => {
    const state = coopState();
    const human = state.players[0]!;
    const bot = state.bots[0];
    bot.x = 0; bot.z = -10;
    const packet = { type: 'shoot', weapon: 'Grenade', origin: { x: 0, y: 1.5, z: 0 }, dir: { x: 0, y: 0, z: -1 }, point: { x: 0, z: -10 } };
    const thrown = resolveHumanShot(state, 0, packet, 5000);
    expect(thrown.fired).toBe(true);
    expect(state.grenades.length).toBe(1);
    expect(state.grenades[0].detonateAt).toBe(5000 + GRENADE_FUSE_MS);
    expect(human.ammo).toBe(2); // one of three thrown
    // Before the fuse, nothing has happened.
    expect(applyGrenadeBlasts(state, 6000)).toBe(false);
    expect(bot.health).toBe(100);
    // At the fuse: the bot is at the blast centre, full 90 damage.
    expect(applyGrenadeBlasts(state, 7000)).toBe(true);
    expect(state.grenades.length).toBe(0);
    expect(bot.health).toBe(100 - 90);
    // Falloff: 4 m from the blast is the 20-damage floor.
    expect(grenadeDamageAt(90, 0, 5)).toBe(90);
    expect(grenadeDamageAt(90, 2.5, 5)).toBe(45);
    expect(grenadeDamageAt(90, 4, 5)).toBe(20);
    expect(grenadeDamageAt(90, 5, 5)).toBe(20);
    // A point beyond throw range is rejected, no grenade stored.
    const state2 = coopState();
    const far = resolveHumanShot(state2, 0, { type: 'shoot', weapon: 'Grenade', point: { x: 0, z: -30 } }, 5000);
    expect(far.fired).toBe(false);
    expect(state2.grenades.length).toBe(0);
  });

  it('claymore: places, arms, trips on an enemy in the front arc only', () => {
    const state = coopState();
    const human = state.players[0]!;
    const bot = state.bots[0];
    // Human at (0,0) facing +z; the mine goes 1 m ahead, facing +z.
    expect(placeMine(state, 0, { type: 'place', weapon: 'Claymore', x: 0, z: 1, yaw: 0 }, 5000)).toBe(true);
    expect(state.mines.length).toBe(1);
    expect(human.ammo).toBe(1); // one of two placed
    // Before it arms, a bot in the arc does not trip it.
    bot.x = 0; bot.z = 5;
    expect(checkMines(state, 5500)).toBe(false);
    expect(bot.health).toBe(100);
    // After arming (1 s), the bot 4 m ahead in the arc trips it: 100 damage.
    expect(checkMines(state, 6500)).toBe(true);
    expect(state.mines.length).toBe(0);
    expect(bot.health).toBe(0);
    expect(bot.dead).toBe(true);
    expect(state.teamScore.humans).toBe(1);
    // Behind the mine: no trip.
    const state2 = coopState();
    placeMine(state2, 0, { type: 'place', weapon: 'Claymore', x: 0, z: 1, yaw: 0 }, 5000);
    const bot2 = state2.bots[0];
    bot2.x = 0; bot2.z = -4; // behind the mine's facing
    expect(checkMines(state2, 6500)).toBe(false);
    expect(bot2.health).toBe(100);
    expect(state2.mines.length).toBe(1);
    // A point beyond 3 m of the placer is rejected.
    expect(placeMine(state2, 0, { type: 'place', weapon: 'Claymore', x: 0, z: 10, yaw: 0 }, 7000)).toBe(false);
    expect(state2.mines.length).toBe(1);
  });

  it('sniper: a ray that reaches 70 m, past the old 60 m cap', () => {
    const state = coopState();
    const human = state.players[0]!;
    const bot = state.bots[0];
    bot.x = 0; bot.z = -70;
    const packet = { type: 'shoot', weapon: 'SniperRifle', origin: { x: 0, y: 1.5, z: 0 }, dir: { x: 0, y: 0, z: -1 } };
    const hit = resolveHumanShot(state, 0, packet, 5000);
    expect(hit.fired).toBe(true);
    expect(hit.hit).toBe(true);
    expect(bot.health).toBe(0); // 100 damage, one-shot kill
    expect(bot.dead).toBe(true);
  });

  it('consumables are spent for the life: no reload refills a grenade', () => {
    const state = coopState();
    const human = state.players[0]!;
    const packet = { type: 'shoot', weapon: 'Grenade', point: { x: 0, z: -5 } };
    // Throw all three.
    for (let i = 0; i < 3; i++) { human.lastShot = 0; resolveHumanShot(state, 0, packet, 5000 + i * 2000); }
    expect(human.ammo).toBe(0);
    expect(human.counts.Grenade).toBe(0);
    // A fourth throw is refused, and no reload starts.
    human.lastShot = 0;
    const spent = resolveHumanShot(state, 0, packet, 12000);
    expect(spent.fired).toBe(false);
    expect(human.reloadAt).toBe(0);
    expect(state.grenades.length).toBe(3);
  });

  it('bot weapons: a grenade bot is rejected, a sniper bot hits for 100', () => {
    const bad = createBotsForRoom('courtyard', 1, 'hard', 'Grenade');
    expect(bad[0].weapon).toBe('Glock'); // the brain falls back, never a grenade bot
    const snipers = createBotsForRoom('courtyard', 1, 'hard', 'SniperRifle');
    expect(snipers[0].weapon).toBe('SniperRifle');
    const state = coopState();
    state.bots = snipers;
    const human = state.players[0]!;
    const bot = state.bots[0];
    bot.x = 5; bot.z = 0;
    state.lastBotTick = 1000; tickBots(state, 1500, () => 0);
    expect(human.health).toBe(100);
    state.lastBotTick = 1500; tickBots(state, 2000, () => 0);
    expect(human.health).toBe(0); // sniper damage 100, one-shot
    expect(state.teamScore.bots).toBe(1);
  });
});

describe('co-op vs bots', () => {
  it('creates a co-op room with bots and rejects a bad bot count, weapon or difficulty', async () => {
    const created = await exports.default.fetch(new Request('https://relay/api/rooms/create', { method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({name:'Host',mode:'coop',botCount:2,difficulty:'hard',botWeapon:'MP5K'}) }),env);
    const room = await created.json() as {code:string;token:string;map:string;mode:string;botCount:number;difficulty:string};
    expect(created.status).toBe(200);
    expect(room.mode).toBe('coop');
    expect(room.botCount).toBe(2);
    expect(room.difficulty).toBe('hard');
    const joined = await exports.default.fetch(new Request('https://relay/api/rooms/join', { method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({name:'Guest',code:room.code}) }),env);
    const joinedRoom = await joined.json() as {mode:string;botCount:number;difficulty:string;map:string};
    expect(joined.status).toBe(200);
    expect(joinedRoom.mode).toBe('coop');
    expect(joinedRoom.botCount).toBe(2);
    expect(joinedRoom.difficulty).toBe('hard');
    expect(joinedRoom.map).toBe('courtyard');
    for (const badCount of [0, 5, 'three']) {
      const bad = await exports.default.fetch(new Request('https://relay/api/rooms/create', { method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({name:'Host',mode:'coop',botCount:badCount}) }),env);
      expect(bad.status).toBe(400);
    }
    const badWeapon = await exports.default.fetch(new Request('https://relay/api/rooms/create', { method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({name:'Host',mode:'coop',botWeapon:'Blaster'}) }),env);
    expect(badWeapon.status).toBe(400);
    const badDifficulty = await exports.default.fetch(new Request('https://relay/api/rooms/create', { method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({name:'Host',mode:'coop',difficulty:'impossible'}) }),env);
    expect(badDifficulty.status).toBe(400);
  });

  it('bot shoot: a ticked bot hits the human, and a low-health human dies and respawns for the bots', () => {
    const state = coopState();
    const human = state.players[0]!;
    const bot = state.bots[0];
    // Park the bot 5 m from the human, inside hard sight range (22 m).
    bot.x = 5; bot.z = 0;
    // Tick 1 sights the human (reaction gate not yet met); tick 2 fires.
    // Fixed random () => 0 always beats hard hitChance 0.75, so it hits.
    state.lastBotTick = 1000; tickBots(state, 1500, () => 0);
    expect(human.health).toBe(100);
    state.lastBotTick = 1500; tickBots(state, 2000, () => 0);
    expect(human.health).toBe(100 - 34); // Glock damage
    expect(bot.lastShotAt).toBe(2000);
    // Low-health kill: the bot's cadence gate needs 800 ms since its last shot.
    human.health = 30;
    state.lastBotTick = 2000; tickBots(state, 3000, () => 0);
    expect(human.health).toBe(0);
    expect(state.teamScore.bots).toBe(1);
    expect(human.respawnAt).toBe(3000 + 2500);
  });

  it('human shot: the ray hits a bot, a low-health bot dies for the humans, and 10 wins the match', () => {
    const state = coopState();
    const human = state.players[0]!;
    const bot = state.bots[0];
    bot.x = 0; bot.z = -10; // straight ahead of the human, down -z
    const packet = { type: 'shoot', weapon: 'Glock', origin: { x: 0, y: 1.5, z: 0 }, dir: { x: 0, y: 0, z: -1 } };
    const hit = resolveHumanShot(state, 0, packet, 5000);
    expect(hit.fired).toBe(true);
    expect(hit.hit).toBe(true);
    expect(bot.health).toBe(100 - 34);
    expect(state.teamScore.humans).toBe(0);
    // Low-health kill.
    bot.health = 20;
    human.lastShot = 0;
    const kill = resolveHumanShot(state, 0, packet, 6000);
    expect(kill.hit).toBe(true);
    expect(bot.dead).toBe(true);
    expect(bot.respawnAt).toBe(6000 + 2500);
    expect(human.score).toBe(1);
    expect(state.teamScore.humans).toBe(1);
    // Win case: the humans are one takedown from 10.
    state.teamScore.humans = 9;
    bot.dead = false; bot.health = 20; bot.respawnAt = 0;
    human.lastShot = 0;
    resolveHumanShot(state, 0, packet, 7000);
    expect(state.teamScore.humans).toBe(10);
    expect(state.finished).toBe(true);
    expect(state.winnerTeam).toBe('humans');
    expect(state.finishReason).toBe('score');
  });
});

describe('shot events', () => {
  it('a ray hit appends a shot event with the hit point on the victim', () => {
    const state = coopState();
    const human = state.players[0]!;
    const bot = state.bots[0];
    bot.x = 0; bot.z = -10;
    const packet = { type: 'shoot', weapon: 'Glock', origin: { x: 0, y: 1.5, z: 0 }, dir: { x: 0, y: 0, z: -1 } };
    const hit = resolveHumanShot(state, 0, packet, 5000);
    expect(hit.fired).toBe(true);
    expect(hit.hit).toBe(true);
    expect(state.events.length).toBe(1);
    const ev = state.events[0];
    expect(ev.type).toBe('shot');
    expect(ev.slot).toBe(0);
    expect(ev.weapon).toBe('Glock');
    expect(ev.hit).toBe(true);
    expect(ev.origin).toEqual({ x: 0, y: 1.5, z: 0 });
    expect(ev.dir).toEqual({ x: 0, y: 0, z: -1 });
    // The hit point is on the ray at the bot's chest (z ≈ -10, y ≈ 1.5).
    expect(ev.point).toBeDefined();
    expect(Math.abs(ev.point!.z + 10)).toBeLessThan(0.5);
    expect(Math.abs(ev.point!.y - 1.5)).toBeLessThan(0.5);
  });

  it('a ray miss appends a shot event with no hit point', () => {
    const state = coopState();
    const bot = state.bots[0];
    bot.x = 5; bot.z = -10; // off-axis: the ray passes more than 0.78 m wide
    const packet = { type: 'shoot', weapon: 'Glock', origin: { x: 0, y: 1.5, z: 0 }, dir: { x: 0, y: 0, z: -1 } };
    const miss = resolveHumanShot(state, 0, packet, 5000);
    expect(miss.fired).toBe(true);
    expect(miss.hit).toBe(false);
    expect(state.events.length).toBe(1);
    expect(state.events[0].hit).toBe(false);
    expect(state.events[0].point).toBeUndefined();
  });

  it('a knife swing appends a shot event with the victim chest point on a hit', () => {
    const state = coopState();
    const human = state.players[0]!;
    const bot = state.bots[0];
    bot.x = 0; bot.z = 2; // 2 m ahead, inside 2.2 m, human faces +z
    const swing = resolveHumanShot(state, 0, { type: 'shoot', weapon: 'Knife' }, 5000);
    expect(swing.fired).toBe(true);
    expect(swing.hit).toBe(true);
    expect(state.events.length).toBe(1);
    const ev = state.events[0];
    expect(ev.weapon).toBe('Knife');
    expect(ev.hit).toBe(true);
    expect(ev.point).toEqual({ x: 0, y: 1.4, z: 2 });
    // A whiff still appends an event (the clients render the swing's miss).
    bot.x = 0; bot.z = 3; bot.health = 100; human.lastShot = 0;
    const whiff = resolveHumanShot(state, 0, { type: 'shoot', weapon: 'Knife' }, 6000);
    expect(whiff.hit).toBe(false);
    expect(state.events.length).toBe(2);
    expect(state.events[1].hit).toBe(false);
    expect(state.events[1].point).toBeUndefined();
  });

  it('a grenade throw appends no shot event (the pending blast is the signal)', () => {
    const state = coopState();
    const packet = { type: 'shoot', weapon: 'Grenade', origin: { x: 0, y: 1.5, z: 0 }, dir: { x: 0, y: 0, z: -1 }, point: { x: 0, z: -10 } };
    const thrown = resolveHumanShot(state, 0, packet, 5000);
    expect(thrown.fired).toBe(true);
    expect(state.grenades.length).toBe(1);
    expect(state.events.length).toBe(0);
  });
});
