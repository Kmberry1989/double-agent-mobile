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
});
