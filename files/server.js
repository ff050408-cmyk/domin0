// Domin relay server: serves the game files AND relays WebSocket messages between players in a room.
// Run: npm install && node server.js   (PORT env var is respected)
const http = require('http'), fs = require('fs'), path = require('path');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 3000;
const TYPES = { '.html':'text/html; charset=utf-8', '.js':'text/javascript', '.png':'image/png',
  '.webmanifest':'application/manifest+json', '.json':'application/json' };

const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/' || p === '') p = '/index.html';
  const f = path.join(__dirname, path.normalize(p).replace(/^(\.\.[\/\\])+/, ''));
  if (!f.startsWith(__dirname)) { res.writeHead(403); return res.end(); }
  fs.readFile(f, (err, data) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream' });
    res.end(data);
  });
});

const wss = new WebSocketServer({ server });
const rooms = new Map(); // code -> { seat: ws }

const send = (ws, m) => { if (ws.readyState === 1) ws.send(JSON.stringify(m)); };

wss.on('connection', ws => {
  ws.isAlive = true;
  ws.on('pong', () => ws.isAlive = true);
  ws.room = null; ws.seat = null;

  ws.on('message', raw => {
    let m; try { m = JSON.parse(raw); } catch { return; }
    if (m.t === 'join') {
      if (ws.room) return;
      const code = String(m.room || 'ROOM').slice(0, 16).toUpperCase();
      const room = rooms.get(code) || {};
      let seat = [0, 1, 2, 3].find(s => !room[s]);
      if (seat === undefined) return send(ws, { t: 'full' });
      room[seat] = ws; rooms.set(code, room);
      ws.room = code; ws.seat = seat; ws.av = m.av;
      const seats = {};
      for (const s in room) seats[s] = room[s].av;
      send(ws, { t: 'hi', seat, seats });
      for (const s in room) if (+s !== seat) send(room[s], { t: 'peer', seat, av: m.av });
      return;
    }
    if (!ws.room) return;
    const room = rooms.get(ws.room); if (!room) return;
    m.from = ws.seat;
    if (m.t === 'rtc') { const to = room[m.to]; if (to) send(to, m); return; } // voice signalling: to one player
    for (const s in room) if (+s !== ws.seat) send(room[s], m);               // everything else: to the others
  });

  ws.on('close', () => {
    if (!ws.room) return;
    const room = rooms.get(ws.room); if (!room) return;
    delete room[ws.seat];
    if (!Object.keys(room).length) rooms.delete(ws.room);
    else for (const s in room) send(room[s], { t: 'left', seat: ws.seat });
  });
});

setInterval(() => wss.clients.forEach(ws => {   // drop dead connections
  if (!ws.isAlive) return ws.terminate();
  ws.isAlive = false; ws.ping();
}), 30000);

server.listen(PORT, () => console.log('Domin running on port ' + PORT));
