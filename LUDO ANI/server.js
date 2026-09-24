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

const usersDB = new Map();
const rooms = new Map();

// 1. AUTH SIGNUP
app.post('/api/auth/signup', (req, res) => {
  const { name, email, password } = req.body;
  const cleanEmail = (email || '').toLowerCase().trim();
  if (!cleanEmail || !password || !name) {
    return res.json({ success: false, message: 'Sabhi fields bharna zaroori hai!' });
  }
  if (usersDB.has(cleanEmail)) {
    return res.json({ success: false, message: 'Email pehle se registered hai! Login karein.' });
  }
  const user = { name: name.trim(), email: cleanEmail, password: password.trim() };
  usersDB.set(cleanEmail, user);
  res.json({ success: true, user: { name: user.name, email: user.email } });
});

// 2. AUTH LOGIN
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
    activeColor: 'red',
    currentRoll: null,
    consecutiveSixes: 0,
    tokens: {
      red: [{ id: 0, step: -1 }, { id: 1, step: -1 }, { id: 2, step: -1 }, { id: 3, step: -1 }],
      yellow: [{ id: 0, step: -1 }, { id: 1, step: -1 }, { id: 2, step: -1 }, { id: 3, step: -1 }]
    },
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

  const existingGuest = room.players.find(p => p.id === 'guest');
  if (!existingGuest) {
    room.players.push({ id: 'guest', email: guestEmail, name: guestName, color: 'yellow' });
  }
  room.lastUpdated = Date.now();

  res.json({ success: true, roomCode: rawCode, color: 'yellow', players: room.players });
});

// 5. START GAME
app.post('/api/start-game', (req, res) => {
  const code = (req.body.roomCode || '').toString().trim();
  const room = rooms.get(code);
  if (!room) return res.json({ success: false });

  room.gameStarted = true;
  room.activeColor = 'red';
  room.currentRoll = null;
  room.actions.push({
    id: 'start_' + Date.now(),
    type: 'START_MATCH',
    players: room.players,
    timestamp: Date.now()
  });
  room.lastUpdated = Date.now();
  res.json({ success: true });
});

// 6. ACTION DISPATCH (DICE ROLL & MOVE)
app.post('/api/send-action', (req, res) => {
  const code = (req.body.roomCode || '').toString().trim();
  const act = req.body.action;
  const room = rooms.get(code);
  if (!room) return res.json({ success: false });

  if (act.type === 'DICE_ROLLED') {
    room.currentRoll = act.roll;
  } else if (act.type === 'TOKEN_MOVED') {
    if (room.tokens[act.color] && room.tokens[act.color][act.tokenId]) {
      room.tokens[act.color][act.tokenId].step = act.toStep;
    }
    // Turn alternate between Red and Yellow
    if (!act.bonusTurn) {
      room.activeColor = (act.color === 'red') ? 'yellow' : 'red';
      room.currentRoll = null;
    }
  } else if (act.type === 'TURN_PASS') {
    room.activeColor = (room.activeColor === 'red') ? 'yellow' : 'red';
    room.currentRoll = null;
  }

  act.id = 'act_' + Math.random().toString(36).substring(2, 9) + '_' + Date.now();
  act.timestamp = Date.now();
  act.serverActiveColor = room.activeColor;
  act.serverCurrentRoll = room.currentRoll;

  room.actions.push(act);
  if (room.actions.length > 60) room.actions.shift();
  room.lastUpdated = Date.now();

  res.json({ success: true });
});

// 7. REALTIME STATE POLL
app.get('/api/poll/:roomCode', (req, res) => {
  const code = (req.params.roomCode || '').toString().trim();
  const room = rooms.get(code);
  if (!room) return res.json({ success: false });

  res.json({
    success: true,
    players: room.players,
    gameStarted: room.gameStarted,
    activeColor: room.activeColor,
    currentRoll: room.currentRoll,
    tokens: room.tokens,
    actions: room.actions
  });
});

server.listen(PORT, () => {
  console.log(`Ludo Real-time Engine running on port ${PORT}`);
});
