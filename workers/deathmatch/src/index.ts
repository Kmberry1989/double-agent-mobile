import { DurableObject } from 'cloudflare:workers';

export interface Env { ROOMS: DurableObjectNamespace<DeathmatchRoom> }
type Player = { token: string; name: string; character: string; slot: number; x: number; z: number; yaw: number; health: number; score: number; ammo: number; weapon: 'pistol'|'rifle'; lastMove: number; lastShot: number; reloadAt: number; disconnectedAt: number|null; respawnAt: number };
type RoomState = { map: MapId; players: (Player|null)[]; startedAt: number|null; createdAt: number; finished: boolean; winner: number|null; finishReason: 'score'|'forfeit'|'expired'|null };
// Per-map arena bounds (x/z half-extents) and diagonal-opposite spawns,
// mirroring the courtyard's pattern. The lobby only offers the maps whose
// pages wire deathmatch mode (courtyard, mall); ballroom and theater are
// defined here for when their pages gain a gun system.
const MAPS = {
  courtyard: { bounds: { x: 39, z: 39 }, spawns: [{ x: -14, z: 20, yaw: -0.61 }, { x: 14, z: -20, yaw: 2.53 }] },
  ballroom: { bounds: { x: 19, z: 13 }, spawns: [{ x: -14, z: 9, yaw: -0.61 }, { x: 14, z: -9, yaw: 2.53 }] },
  theater: { bounds: { x: 14, z: 20 }, spawns: [{ x: -10, z: 16, yaw: -0.61 }, { x: 10, z: -16, yaw: 2.53 }] },
  mall: { bounds: { x: 19, z: 29 }, spawns: [{ x: -14, z: 24, yaw: -0.61 }, { x: 14, z: -24, yaw: 2.53 }] },
} as const;
type MapId = keyof typeof MAPS;
const cleanMap = (v: unknown): MapId => (typeof v === 'string' && v in MAPS ? (v as MapId) : 'courtyard');
// A character is a plain .fbx/.glb filename (no directories, no '..') —
// the game page validates it against the real roster before loading.
const cleanCharacter = (v: unknown): string => (typeof v === 'string' && /^[A-Za-z0-9_.\-]+\.(fbx|glb)$/.test(v) && !v.includes('..') ? v : 'Agent_Kyle.fbx');
const ROOM_TTL_MS=2*60*60*1000;
const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const randomId = (length:number) => Array.from(crypto.getRandomValues(new Uint8Array(length)), n => alphabet[n % alphabet.length]).join('');
const json = (body:unknown,status=200) => new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json; charset=utf-8','access-control-allow-origin':'*','access-control-allow-headers':'content-type','access-control-allow-methods':'GET,POST,OPTIONS'}});

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
      const room = env.ROOMS.get(env.ROOMS.idFromName(code));
      const response = await room.fetch('https://room/reserve',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({token,name:cleanName(body.name),slot:0,map:cleanMap(body.map),character:cleanCharacter(body.character)})});
      if (!response.ok) return json({error:'Could not create room'},500);
      return json({code,token,map:cleanMap(body.map)});
    }
    if (url.pathname === '/api/rooms/join') {
      const code = String(body.code||'').toUpperCase();
      if (!/^[A-HJ-NP-Z2-9]{6}$/.test(code)) return json({error:'Enter a valid six-character room code.'},400);
      if (body.character !== undefined && cleanCharacter(body.character) !== body.character) return json({error:'Unknown character.'},400);
      const token = randomId(32), room = env.ROOMS.get(env.ROOMS.idFromName(code));
      const response = await room.fetch('https://room/reserve',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({token,name:cleanName(body.name),slot:1,character:cleanCharacter(body.character)})});
      if (!response.ok) return json({error:(await response.json() as any).error||'Room is unavailable.'},response.status);
      return json({code,token,map:((await response.json()) as any).map||'courtyard'});
    }
    return json({error:'Not found'},404);
  }
} satisfies ExportedHandler<Env>;

function cleanName(value:unknown){return String(value||'Agent').replace(/[<>\u0000-\u001f]/g,'').trim().slice(0,18)||'Agent';}
function blankPlayer(token:string,name:string,slot:number,map:MapId,character:string):Player{const spawn=MAPS[map].spawns[slot];return {token,name,character,slot,x:spawn.x,z:spawn.z,yaw:spawn.yaw,health:100,score:0,ammo:12,weapon:'pistol',lastMove:0,lastShot:0,reloadAt:0,disconnectedAt:null,respawnAt:0};}

export class DeathmatchRoom extends DurableObject<Env> {
  private statePromise:Promise<RoomState>;
  constructor(ctx:DurableObjectState,env:Env){super(ctx,env);this.statePromise=ctx.blockConcurrencyWhile(async()=>{let state=await ctx.storage.get<RoomState>('room');if(!state){state={map:'courtyard',players:[null,null],startedAt:null,createdAt:Date.now(),finished:false,winner:null,finishReason:null};await ctx.storage.put('room',state);}return state;});}
  private async load(){await this.statePromise;return (await this.ctx.storage.get<RoomState>('room'))!;}
  private async save(state:RoomState){await this.ctx.storage.put('room',state);}
  private async scheduleAlarm(state:RoomState){const times:number[]=[state.createdAt+ROOM_TTL_MS];for(const p of state.players){if(!p)continue;if(p.reloadAt>0)times.push(p.reloadAt);if(p.respawnAt>0)times.push(p.respawnAt);if(p.disconnectedAt&&!state.finished)times.push(p.disconnectedAt+30_000);}await this.ctx.storage.setAlarm(Math.min(...times));}
  private onlineTokens(exclude?:WebSocket){return new Set(this.ctx.getWebSockets().filter(ws=>ws!==exclude).map(ws=>{try{return (ws.deserializeAttachment() as any).token;}catch{return '';}}));}
  private publicState(state:RoomState){const online=this.onlineTokens();return {type:'state',map:state.map,started:state.startedAt!==null&&!state.finished,finished:state.finished,reason:state.finishReason,paused:state.players.some(p=>!!p?.disconnectedAt),winner:state.winner,players:state.players.map(p=>p?{slot:p.slot,name:p.name,character:p.character,x:p.x,z:p.z,yaw:p.yaw,health:p.health,score:p.score,ammo:p.ammo,weapon:p.weapon,respawnAt:p.respawnAt,connected:online.has(p.token)}:null)};}
  private async broadcast(state:RoomState){const message=JSON.stringify(this.publicState(state));for(const ws of this.ctx.getWebSockets())try{ws.send(message);}catch{}}
  async fetch(request:Request):Promise<Response>{
    const url=new URL(request.url);
    if(url.pathname==='/reserve'&&request.method==='POST'){
      const input:any=await request.json(), state=await this.load();
      if(state.finished)return json({error:'This match has ended.'},410);
      const existing=state.players.find(p=>p?.token===input.token);
      if(existing)return json({slot:existing.slot,map:state.map});
      if(input.slot===1&&state.players[0]===null)return json({error:'Room code was not found.'},404);
      if(state.players[input.slot])return json({error:'Room already has two agents.'},409);
      if(input.slot===0)state.map=cleanMap(input.map);
      state.players[input.slot]=blankPlayer(input.token,cleanName(input.name),input.slot,state.map,cleanCharacter(input.character));await this.save(state);await this.scheduleAlarm(state);return json({slot:input.slot,map:state.map});
    }
    if(url.pathname==='/room'&&request.headers.get('upgrade')==='websocket'){
      const token=url.searchParams.get('token')||'',state=await this.load(),player=state.players.find(p=>p?.token===token);
      if(!player)return json({error:'Invalid room token.'},403);
      for(const ws of this.ctx.getWebSockets())try{if((ws.deserializeAttachment() as any).token===token)ws.close(4001,'Reconnected');}catch{}
      const pair=new WebSocketPair(),client=pair[0],server=pair[1];server.serializeAttachment({token,slot:player.slot});this.ctx.acceptWebSocket(server);
      player.disconnectedAt=null;
      if(state.players.every(Boolean)&&this.onlineTokens().size>=1&&state.startedAt===null)state.startedAt=Date.now();
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
      if(state.players.some(pl=>pl?.disconnectedAt))return;
      const x=Number(packet.x),z=Number(packet.z),yaw=Number(packet.yaw);if(!Number.isFinite(x)||!Number.isFinite(z)||!Number.isFinite(yaw))return;
      const bounds=MAPS[state.map].bounds;
      const nextX=Math.max(-bounds.x,Math.min(bounds.x,x)),nextZ=Math.max(-bounds.z,Math.min(bounds.z,z)),elapsed=Math.max(0.05,(now-(p.lastMove||now))/1000),distance=Math.hypot(nextX-p.x,nextZ-p.z);
      if(distance>Math.min(8*elapsed+1.5,5))return;
      p.x=nextX;p.z=nextZ;p.yaw=((yaw+Math.PI)%(Math.PI*2)+Math.PI*2)%(Math.PI*2)-Math.PI;p.lastMove=now;
      if(state.players.every(Boolean)&&!state.startedAt)state.startedAt=now;
      await this.save(state);await this.broadcast(state);return;
    }
    if(packet.type==='shoot'&&!state.finished&&state.startedAt&&other&&other.health>0&&!state.players.some(pl=>pl?.disconnectedAt)){
      const weapon=packet.weapon==='rifle'?'rifle':'pistol',rate=weapon==='rifle'?105:270,capacity=weapon==='rifle'?30:12,damage=weapon==='rifle'?50:34;
      if(now<p.reloadAt||now-p.lastShot<rate)return;
      if(p.weapon!==weapon){p.weapon=weapon;p.ammo=capacity;p.reloadAt=0;}
      if(p.ammo<=0){p.reloadAt=now+1400;await this.save(state);await this.scheduleAlarm(state);await this.broadcast(state);return;}
      const d=packet.dir||{},o=packet.origin||{},dx=Number(d.x),dy=Number(d.y),dz=Number(d.z),ox=Number(o.x),oy=Number(o.y),oz=Number(o.z),len=Math.hypot(dx,dy,dz);
      if(!Number.isFinite(len)||len<0.9||len>1.1||![ox,oy,oz].every(Number.isFinite)||Math.hypot(ox-p.x,oz-p.z)>5||oy<1.1||oy>4.5)return;
      p.lastShot=now;p.ammo--;const target=new Vec3(other.x-ox,1.25-oy,other.z-oz),dir=new Vec3(dx/len,dy/len,dz/len),along=target.dot(dir),miss=Math.sqrt(Math.max(0,target.lengthSq()-along*along));
      if(along>0&&along<=60&&miss<=0.78){other.health=Math.max(0,other.health-damage);if(other.health===0){p.score++;other.respawnAt=now+2500;this.ctx.storage.setAlarm(now+2500);if(p.score>=10){state.finished=true;state.winner=p.slot;state.finishReason='score';}}}
      if(p.ammo===0)p.reloadAt=now+1400;
      await this.save(state);if(p.reloadAt)await this.scheduleAlarm(state);await this.broadcast(state);return;
    }
    if(packet.type==='reload'&&!state.finished){p.reloadAt=now+1400;await this.save(state);await this.scheduleAlarm(state);}
  }
  async webSocketClose(ws:WebSocket){const a:any=ws.deserializeAttachment();if(!a||this.onlineTokens(ws).has(a.token))return;const state=await this.load(),p=state.players[a.slot];if(!p||p.token!==a.token)return;p.disconnectedAt=Date.now();await this.save(state);await this.scheduleAlarm(state);await this.broadcast(state);}
  async webSocketError(ws:WebSocket){await this.webSocketClose(ws);}
  async alarm(){const state=await this.load(),now=Date.now();if(now>=state.createdAt+ROOM_TTL_MS){state.finished=true;state.finishReason='expired';await this.save(state);await this.broadcast(state);for(const ws of this.ctx.getWebSockets())try{ws.close(1000,'Room expired');}catch{}await this.ctx.storage.deleteAll();return;}for(const p of state.players){if(!p)continue;if(p.reloadAt&&p.reloadAt<=now){p.ammo=p.weapon==='rifle'?30:12;p.reloadAt=0;}if(p.respawnAt&&p.respawnAt<=now){const spawn=MAPS[state.map].spawns[p.slot];p.x=spawn.x;p.z=spawn.z;p.yaw=spawn.yaw;p.health=100;p.ammo=p.weapon==='rifle'?30:12;p.respawnAt=0;}if(p.disconnectedAt&&now-p.disconnectedAt>=30_000&&!state.finished){state.finished=true;state.winner=1-p.slot;state.finishReason='forfeit';}}
    await this.save(state);await this.scheduleAlarm(state);await this.broadcast(state);
  }
}
class Vec3 {constructor(public x:number,public y:number,public z:number){} dot(v:Vec3){return this.x*v.x+this.y*v.y+this.z*v.z;}lengthSq(){return this.x*this.x+this.y*this.y+this.z*this.z;}}
