const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 10000;

app.use(express.json());
app.use(express.static(__dirname));

function sendFileSafe(filename, mimeType, res) {
  const localP = path.join(__dirname, filename);
  const rootP = path.join(__dirname, '..', filename);
  const target = fs.existsSync(localP) ? localP : rootP;
  if (mimeType) res.setHeader('Content-Type', mimeType);
  res.sendFile(target);
}

app.get('/', (req, res) => sendFileSafe('index.html', 'text/html', res));
app.get('/app.js', (req, res) => sendFileSafe('app.js', 'application/javascript', res));
app.get('/style.css', (req, res) => sendFileSafe('style.css', 'text/css', res));
app.get('/manifest.json', (req, res) => sendFileSafe('manifest.json', 'application/manifest+json', res));
app.get('/sw.js', (req, res) => {
  res.setHeader('Service-Worker-Allowed', '/');
  sendFileSafe('sw.js', 'application/javascript', res);
});
app.get('/logo-192.png', (req, res) => sendFileSafe('logo-192.png', 'image/png', res));
app.get('/logo-512.png', (req, res) => sendFileSafe('logo-512.png', 'image/png', res));

const rooms = new Map();

// 1. CREATE 4-DIGIT ROOM
app.post('/api/create-room', (req, res) => {
  const hostName = (req.body.hostName || 'Host Player').trim();
  let code;
  do {
    code = Math.floor(1000 + Math.random() * 9000).toString();
  } while (rooms.has(code));

  const room = {
    code,
    players: [{ id: 'host', name: hostName, color: 'red' }],
    gameStarted: false,
    actions: [],
    lastUpdated: Date.now()
  };

  rooms.set(code, room);
  res.json({ success: true, roomCode: code, color: 'red' });
});

// 2. JOIN 4-DIGIT ROOM
app.post('/api/join-room', (req, res) => {
  const rawCode = (req.body.roomCode || '').toString().trim().replace(/\s+/g, '');
  const guestName = (req.body.playerName || 'Guest Player').trim();

  const room = rooms.get(rawCode);
  if (!room) {
    return res.json({ success: false, message: `Room (${rawCode}) nahi mila! Kripya code check karein.` });
  }
  if (room.gameStarted) {
    return res.json({ success: false, message: 'Game pehle hi shuru ho chuka hai!' });
  }

  if (!room.players.some(p => p.id === 'guest')) {
    room.players.push({ id: 'guest', name: guestName, color: 'yellow' });
  }
  room.lastUpdated = Date.now();

  res.json({ success: true, roomCode: rawCode, color: 'yellow', players: room.players });
});

// 3. START GAME
app.post('/api/start-game', (req, res) => {
  const code = (req.body.roomCode || '').toString().trim();
  const room = rooms.get(code);
  if (!room) return res.json({ success: false });

  room.gameStarted = true;
  room.actions.push({
    id: 'start_' + Date.now(),
    type: 'START_MATCH',
    players: room.players,
    timestamp: Date.now()
  });
  room.lastUpdated = Date.now();
  res.json({ success: true });
});

// 4. BROADCAST ACTION
app.post('/api/send-action', (req, res) => {
  const code = (req.body.roomCode || '').toString().trim();
  const action = req.body.action;
  const room = rooms.get(code);
  if (!room) return res.json({ success: false });

  action.id = 'act_' + Math.random().toString(36).substring(2, 9) + '_' + Date.now();
  action.timestamp = Date.now();
  room.actions.push(action);
  if (room.actions.length > 50) room.actions.shift();
  room.lastUpdated = Date.now();

  res.json({ success: true });
});

// 5. POLL STATE
app.get('/api/poll/:roomCode', (req, res) => {
  const code = (req.params.roomCode || '').toString().trim();
  const room = rooms.get(code);
  if (!room) return res.json({ success: false });

  res.json({
    success: true,
    players: room.players,
    gameStarted: room.gameStarted,
    actions: room.actions
  });
});

server.listen(PORT, () => {
  console.log(`Ludo Real-time Server running on port ${PORT}`);
});
