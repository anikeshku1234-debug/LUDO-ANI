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

// PERSISTENT USERS & ROOM ENGINE
const usersDB = new Map(); // email -> { name, email, password }
const rooms = new Map();   // roomCode -> Room Object

// 1. AUTH API: SIGNUP
app.post('/api/auth/signup', (req, res) => {
  const { name, email, password } = req.body;
  const cleanEmail = (email || '').toLowerCase().trim();

  if (!cleanEmail || !password || !name) {
    return res.json({ success: false, message: 'Sabhi fields bharna zaroori hai!' });
  }
  if (usersDB.has(cleanEmail)) {
    return res.json({ success: false, message: 'Yeh email pehle se registered hai! Login karein.' });
  }

  const user = { name: name.trim(), email: cleanEmail, password: password.trim() };
  usersDB.set(cleanEmail, user);
  res.json({ success: true, user: { name: user.name, email: user.email } });
});

// 2. AUTH API: LOGIN
app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body;
  const cleanEmail = (email || '').toLowerCase().trim();

  const user = usersDB.get(cleanEmail);
  if (!user || user.password !== (password || '').trim()) {
    return res.json({ success: false, message: 'Galat Email ya Password!' });
  }

  res.json({ success: true, user: { name: user.name, email: user.email } });
});

// 3. CREATE ROOM
app.post('/api/create-room', (req, res) => {
  const hostName = (req.body.hostName || 'Host Player').trim();
  const hostEmail = (req.body.userEmail || '').toLowerCase().trim();
  let code;
  do {
    code = Math.floor(1000 + Math.random() * 9000).toString();
  } while (rooms.has(code));

  const room = {
    code,
    players: [{ id: 'host', email: hostEmail, name: hostName, color: 'red' }],
    gameStarted: false,
    tokens: {
      red: [{ id: 0, step: -1 }, { id: 1, step: -1 }, { id: 2, step: -1 }, { id: 3, step: -1 }],
      yellow: [{ id: 0, step: -1 }, { id: 1, step: -1 }, { id: 2, step: -1 }, { id: 3, step: -1 }]
    },
    turnPointer: 0,
    activeColor: 'red',
    actions: [],
    lastUpdated: Date.now()
  };

  rooms.set(code, room);
  res.json({ success: true, roomCode: code, color: 'red' });
});

// 4. JOIN ROOM
app.post('/api/join-room', (req, res) => {
  const rawCode = (req.body.roomCode || '').toString().trim().replace(/\s+/g, '');
  const guestName = (req.body.playerName || 'Guest Player').trim();
  const guestEmail = (req.body.userEmail || '').toLowerCase().trim();

  const room = rooms.get(rawCode);
  if (!room) {
    return res.json({ success: false, message: `Room (${rawCode}) nahi mila!` });
  }

  // Check if player is reconnecting
  const existingPlayer = room.players.find(p => p.email && p.email === guestEmail);
  if (!existingPlayer && !room.players.some(p => p.id === 'guest')) {
    if (room.gameStarted) {
      return res.json({ success: false, message: 'Game pehle hi shuru ho chuka hai!' });
    }
    room.players.push({ id: 'guest', email: guestEmail, name: guestName, color: 'yellow' });
  }

  room.lastUpdated = Date.now();
  const myPlayer = room.players.find(p => p.email === guestEmail) || room.players[1] || room.players[0];
  res.json({ success: true, roomCode: rawCode, color: myPlayer.color, players: room.players });
});

// 5. START GAME
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

// 6. SEND ACTION
app.post('/api/send-action', (req, res) => {
  const code = (req.body.roomCode || '').toString().trim();
  const action = req.body.action;
  const room = rooms.get(code);
  if (!room) return res.json({ success: false });

  // Update room persistent tokens on server for crash recovery
  if (action.type === 'TOKEN_MOVED') {
    const pTokens = room.tokens[action.color];
    if (pTokens && pTokens[action.tokenId]) {
      if (action.toStep !== undefined) {
        pTokens[action.tokenId].step = action.toStep;
      }
    }
  }

  action.id = 'act_' + Math.random().toString(36).substring(2, 9) + '_' + Date.now();
  action.timestamp = Date.now();
  room.actions.push(action);
  if (room.actions.length > 60) room.actions.shift();
  room.lastUpdated = Date.now();

  res.json({ success: true });
});

// 7. POLL & AUTO RESUME STATE
app.get('/api/poll/:roomCode', (req, res) => {
  const code = (req.params.roomCode || '').toString().trim();
  const room = rooms.get(code);
  if (!room) return res.json({ success: false });

  res.json({
    success: true,
    players: room.players,
    gameStarted: room.gameStarted,
    tokens: room.tokens,
    actions: room.actions
  });
});

server.listen(PORT, () => {
  console.log(`Ludo Persistent Auth Engine active on port ${PORT}`);
});
