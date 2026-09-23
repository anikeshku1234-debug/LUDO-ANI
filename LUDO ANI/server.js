const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: { origin: "*" }
});

const PORT = process.env.PORT || 10000;

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

const rooms = {};
const COLOR_ORDER = ['red', 'yellow', 'green', 'blue'];

io.on('connection', (socket) => {
  // CREATE ROOM
  socket.on('createRoom', ({ hostName }) => {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    for (let i = 0; i < 6; i++) {
      code += chars.charAt(Math.floor(Math.random() * chars.length));
    }

    const host = (hostName || 'Host Player').trim();
    rooms[code] = {
      roomCode: code,
      hostId: socket.id,
      gameStarted: false,
      players: [{ id: socket.id, name: host, color: 'red' }]
    };

    socket.join(code);
    socket.roomCode = code;
    socket.playerColor = 'red';

    socket.emit('roomCreatedSuccess', {
      roomCode: code,
      players: rooms[code].players,
      myColor: 'red'
    });
  });

  // JOIN ROOM
  socket.on('joinRoom', ({ playerName, roomCode }) => {
    const code = (roomCode || '').trim().toUpperCase();
    const room = rooms[code];

    if (!room) {
      socket.emit('roomError', 'Galat Room Code! Room nahi mila.');
      return;
    }
    if (room.gameStarted) {
      socket.emit('roomError', 'Game pehle hi shuru ho chuka hai!');
      return;
    }
    if (room.players.length >= 4) {
      socket.emit('roomError', 'Room pehle se full hai!');
      return;
    }

    const assignedColor = COLOR_ORDER[room.players.length] || 'yellow';
    const guest = (playerName || `Player ${room.players.length + 1}`).trim();

    room.players.push({
      id: socket.id,
      name: guest,
      color: assignedColor
    });

    socket.join(code);
    socket.roomCode = code;
    socket.playerColor = assignedColor;

    socket.emit('roomJoinedSuccess', {
      roomCode: code,
      players: room.players,
      myColor: assignedColor
    });

    io.to(code).emit('lobbyPlayerUpdate', {
      players: room.players,
      hostId: room.hostId
    });
  });

  // START GAME (HOST)
  socket.on('startOnlineGame', () => {
    const room = rooms[socket.roomCode];
    if (!room) return;
    if (room.hostId !== socket.id) {
      socket.emit('roomError', 'Sirf Host game shuru kar sakta hai!');
      return;
    }
    if (room.players.length < 2) {
      socket.emit('roomError', 'Kam se kam 2 players judne chahiye!');
      return;
    }

    room.gameStarted = true;
    io.to(socket.roomCode).emit('onlineGameStarted', {
      players: room.players,
      activeColor: 'red'
    });
  });

  // REALTIME ACTION SYNC
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
        }
        io.to(code).emit('lobbyPlayerUpdate', {
          players: room.players,
          hostId: room.hostId
        });
      }
    }
  });
});

server.listen(PORT, () => {
  console.log(`Ludo Server active on port ${PORT}`);
});
