const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');

const app = express();
const server = http.createServer(app);

// Fast CORS and Socket Settings
const io = new Server(server, {
  cors: { origin: "*" },
  transports: ['polling', 'websocket'],
  allowEIO3: true
});

const PORT = process.env.PORT || 10000;

app.use(express.json());
app.use(express.static(__dirname));

// Keep-alive ping endpoint (taaki server turant wake-up rahe)
app.get('/ping', (req, res) => res.send('pong'));

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

// ACTIVE ROOMS
const rooms = {};
const COLOR_ORDER = ['red', 'yellow', 'green', 'blue'];

// FAST REST API FOR INSTANT ROOM CREATION & CHECKING
app.post('/api/create-room', (req, res) => {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) code += chars.charAt(Math.floor(Math.random() * chars.length));

  const hostName = (req.body.hostName || 'Host Player').trim();
  rooms[code] = {
    roomCode: code,
    hostId: null,
    gameStarted: false,
    players: [{ id: null, name: hostName, color: 'red', isHost: true }]
  };
  res.json({ success: true, roomCode: code, color: 'red' });
});

app.post('/api/check-room', (req, res) => {
  const code = (req.body.roomCode || '').trim().toUpperCase();
  const room = rooms[code];
  if (!room) return res.json({ success: false, message: 'Galat Room Code! Room nahi mila.' });
  if (room.gameStarted) return res.json({ success: false, message: 'Game pehle shuru ho chuka hai!' });
  if (room.players.length >= 4) return res.json({ success: false, message: 'Room full hai!' });
  res.json({ success: true, roomCode: code });
});

// REALTIME SOCKET HANDLING
io.on('connection', (socket) => {
  // Join socket channel to room
  socket.on('registerInRoom', ({ roomCode, playerName, isHost }) => {
    const code = (roomCode || '').trim().toUpperCase();
    const room = rooms[code];
    if (!room) return socket.emit('roomError', 'Room expire ho chuka hai.');

    socket.join(code);
    socket.roomCode = code;

    if (isHost) {
      room.hostId = socket.id;
      room.players[0].id = socket.id;
      socket.playerColor = 'red';
      socket.emit('roomCreatedSuccess', { roomCode: code, players: room.players, myColor: 'red' });
    } else {
      const assignedColor = COLOR_ORDER[room.players.length] || 'yellow';
      const guest = (playerName || `Player ${room.players.length + 1}`).trim();
      const existing = room.players.find(p => p.id === socket.id);
      if (!existing) {
        room.players.push({ id: socket.id, name: guest, color: assignedColor, isHost: false });
      }
      socket.playerColor = assignedColor;
      socket.emit('roomJoinedSuccess', { roomCode: code, players: room.players, myColor: assignedColor });
    }

    io.to(code).emit('lobbyPlayerUpdate', { players: room.players, hostId: room.hostId });
  });

  socket.on('startOnlineGame', () => {
    const room = rooms[socket.roomCode];
    if (!room) return;
    if (room.players.length < 2) {
      return socket.emit('roomError', 'Kam se kam 2 players chahiye!');
    }
    room.gameStarted = true;
    io.to(socket.roomCode).emit('onlineGameStarted', {
      players: room.players,
      activeColor: 'red'
    });
  });

  socket.on('broadcastGameAction', (actionData) => {
    if (socket.roomCode) {
      socket.to(socket.roomCode).emit('receiveGameAction', actionData);
    }
  });

  socket.on('disconnect', () => {
    const code = socket.roomCode;
    const room = rooms[code];
    if (room) {
      room.players = room.players.filter(p => p.id !== socket.id);
      if (room.players.length === 0) {
        delete rooms[code];
      } else {
        if (room.hostId === socket.id) {
          room.hostId = room.players[0].id;
          if (room.players[0]) room.players[0].isHost = true;
        }
        io.to(code).emit('lobbyPlayerUpdate', { players: room.players, hostId: room.hostId });
      }
    }
  });
});

server.listen(PORT, () => {
  console.log(`Ludo Fast-Engine running on port ${PORT}`);
});
