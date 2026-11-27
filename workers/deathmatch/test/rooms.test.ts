import { env, exports } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';

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
