// vs-server/server.js — Star-Pou VS (Realtime)
// Run: npm i && node server.js   (port 3001 default, WS at /ws)
// Deploy di VPS 103.147.32.29 via pm2: pm2 start server.js --name sev7en-vs

import http from 'http';
import { WebSocketServer } from 'ws';

const PORT = parseInt(process.env.PORT || '3001', 10);
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'sev7en-admin';
const MAX_TEAMS = 10;
const ROOM_TTL_MS = 2 * 60 * 60 * 1000; // 2 jam auto-cleanup
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no I/O/0/1

function genCode(n=6){ let s=''; for(let i=0;i<n;i++) s+=CODE_CHARS[Math.floor(Math.random()*CODE_CHARS.length)]; return s; }

const rooms = new Map(); // code -> {code, materi, duration, status, hostId, createdAt, teams: Map(id->{id,name,score,floor,streak,ws}), startedAt}

function roomPublic(r){
  return {
    code: r.code, materi: r.materi, duration: r.duration, status: r.status,
    teams: [...r.teams.values()].map(t=>({id:t.id,name:t.name,score:t.score,floor:t.floor,streak:t.streak})),
  };
}

function broadcast(r, msg, except=null){
  const s = JSON.stringify(msg);
  for(const t of r.teams.values()){
    if(t.ws && t.ws.readyState===1 && t!==except) try{ t.ws.send(s); }catch{}
  }
  if(r.hostWs && r.hostWs.readyState===1 && r.hostWs!==except?.ws) try{ r.hostWs.send(s);}catch{}
}

function cleanup(){
  const now=Date.now();
  for(const [code,r] of rooms){
    if(now - r.createdAt > ROOM_TTL_MS){ rooms.delete(code); }
  }
}
setInterval(cleanup, 10*60*1000);

const server = http.createServer((req,res)=>{
  if(req.url==='/health'){ res.writeHead(200,{'Content-Type':'application/json'}); res.end(JSON.stringify({ok:true, rooms:rooms.size})); return; }
  res.writeHead(200,{'Content-Type':'text/plain'}); res.end('sev7en-vs ws at /ws');
});

const wss = new WebSocketServer({ server, path: '/ws' });

wss.on('connection', (ws)=>{
  ws._id = Math.random().toString(36).slice(2,9);
  ws._room = null; ws._teamId = null; ws._isHost = false;

  ws.on('message', (buf)=>{
    let msg; try{ msg=JSON.parse(buf.toString()); }catch{ return; }
    const t = msg.type;

    if(t==='create_room'){
      const isAdmin = msg.adminPassword === ADMIN_PASSWORD;
      if(!isAdmin){ ws.send(JSON.stringify({type:'error', message:'Password admin salah'})); return; }
      let code; do{ code=genCode(6); }while(rooms.has(code));
      const r = { code, materi: msg.materi||'all', duration: parseInt(msg.duration||180,10), status:'lobby', hostId: ws._id, hostWs: ws, createdAt: Date.now(), teams: new Map() };
      rooms.set(code, r);
      ws._room = code; ws._isHost = true;
      ws.send(JSON.stringify({type:'room_created', code, room: roomPublic(r)}));
      return;
    }

    if(t==='join_room'){
      const code = String(msg.code||'').toUpperCase().trim();
      const name = String(msg.teamName||'').trim().slice(0,24);
      if(!code || !name){ ws.send(JSON.stringify({type:'error', message:'Kode & nama tim wajib'})); return; }
      const r = rooms.get(code);
      if(!r){ ws.send(JSON.stringify({type:'error', message:'Room tidak ditemukan'})); return; }
      if(r.status!=='lobby'){ ws.send(JSON.stringify({type:'error', message:'Room sudah mulai'})); return; }
      if(r.teams.size >= MAX_TEAMS){ ws.send(JSON.stringify({type:'error', message:'Room penuh (10 tim)'})); return; }
      if([...r.teams.values()].some(x=>x.name.toLowerCase()===name.toLowerCase())){ ws.send(JSON.stringify({type:'error', message:'Nama tim sudah dipakai'})); return; }
      const id = Math.random().toString(36).slice(2,7);
      const team = { id, name, score:0, floor:0, streak:0, ws };
      r.teams.set(id, team);
      ws._room = code; ws._teamId = id;
      ws.send(JSON.stringify({type:'joined', code, teamId:id, room: roomPublic(r)}));
      broadcast(r, {type:'room_update', room: roomPublic(r)});
      return;
    }

    if(t==='rejoin'){
      // optional reconnect
      const code = String(msg.code||'').toUpperCase().trim();
      const id = msg.teamId;
      const r = rooms.get(code);
      if(r && r.teams.has(id)){
        const team = r.teams.get(id);
        team.ws = ws; ws._room=code; ws._teamId=id;
        ws.send(JSON.stringify({type:'rejoined', room: roomPublic(r)}));
      }
      return;
    }

    if(t==='start_game'){
      const r = rooms.get(ws._room);
      if(!r || !ws._isHost){ ws.send(JSON.stringify({type:'error', message:'Hanya host yang bisa start'})); return; }
      if(r.teams.size===0){ ws.send(JSON.stringify({type:'error', message:'Belum ada tim join'})); return; }
      r.status='playing'; r.startedAt=Date.now();
      const payload = {type:'game_start', materi:r.materi, duration:r.duration, serverTime: r.startedAt};
      broadcast(r, payload);
      // also to host
      ws.send(JSON.stringify(payload));
      return;
    }

    if(t==='score_update'){
      const r = rooms.get(ws._room);
      if(!r || r.status!=='playing') return;
      const team = r.teams.get(ws._teamId);
      if(!team) return;
      // trust client but clamp
      const score = Math.max(0, parseInt(msg.score||0,10));
      const floor = Math.max(0, parseInt(msg.floor||0,10));
      const streak = parseInt(msg.streak||0,10);
      team.score = score; team.floor = floor; team.streak = streak;
      broadcast(r, {type:'leaderboard', teams: [...r.teams.values()].map(t=>({id:t.id,name:t.name,score:t.score,floor:t.floor,streak:t.streak})).sort((a,b)=>b.score-a.score)});
      return;
    }

    if(t==='finish'){
      const r = rooms.get(ws._room);
      if(!r) return;
      const team = r.teams.get(ws._teamId);
      if(team){ team.score = parseInt(msg.score||team.score,10); team.floor=parseInt(msg.floor||team.floor,10);}
      // if all finished or time up, broadcast podium
      // For now just push leaderboard
      broadcast(r, {type:'leaderboard', teams: [...r.teams.values()].map(t=>({id:t.id,name:t.name,score:t.score,floor:t.floor})).sort((a,b)=>b.score-a.score)});
      return;
    }

    if(t==='end_game'){
      const r = rooms.get(ws._room);
      if(!r || !ws._isHost) return;
      r.status='ended';
      broadcast(r, {type:'game_end'});
      return;
    }
  });

  ws.on('close', ()=>{
    if(!ws._room) return;
    const r = rooms.get(ws._room);
    if(!r) return;
    if(ws._isHost){
      // host disconnect: keep room but mark host offline; room still alive via TTL
      r.hostWs = null;
    } else if(ws._teamId){
      // keep team entry for rejoin; just null ws
      const t = r.teams.get(ws._teamId);
      if(t) t.ws = null;
      broadcast(r, {type:'room_update', room: roomPublic(r)});
    }
  });
});

server.listen(PORT, '0.0.0.0', ()=> console.log(`sev7en-vs WS on :${PORT}/ws  admin pass=${ADMIN_PASSWORD.slice(0,3)}***  maxTeams=${MAX_TEAMS}`));
