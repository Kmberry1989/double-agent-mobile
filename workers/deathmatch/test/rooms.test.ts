import { env, exports } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { createBotsForRoom, tickBots, resolveHumanShot } from '../src/index.ts';
import type { RoomState } from '../src/index.ts';

// A fabricated co-op room for the pure-helper tests (no DO websockets:
// Cloudflare's Vitest integration cannot test Durable Object sockets).
function coopState(overrides: Partial<RoomState> = {}): RoomState {
  const bots = createBotsForRoom('courtyard', 1, 'hard', 'Glock');
  const state: RoomState = {
    map: 'courtyard',
    players: [
      { token: 'human-0', name: 'Host', character: 'Agent_Kyle.fbx', loadout: 'black', slot: 0, x: 0, z: 0, yaw: 0, health: 100, score: 0, ammo: 12, weapon: 'Glock', lastMove: 0, lastShot: 0, reloadAt: 0, disconnectedAt: null, respawnAt: 0 },
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
