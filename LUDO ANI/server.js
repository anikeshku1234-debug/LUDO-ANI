const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: { origin: "*" },
  transports: ['polling', 'websocket']
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

// ACTIVE ROOMS IN-MEMORY STORE
const rooms = new Map();
const COLOR_ORDER = ['red', 'yellow', 'green', 'blue'];

io.on('connection', (socket) => {
  console.log('[Socket Connected]:', socket.id);

  // 1. CREATE ROOM (Exact 4-Digit Integer: 1000 - 9999)
  socket.on('createRoom', ({ hostName }) => {
    let code;
    do {
      code = Math.floor(1000 + Math.random() * 9000).toString();
    } while (rooms.has(code));

    const host = (hostName || 'Host Player').trim();
    const newRoom = {
      roomCode: code,
      hostId: socket.id,
      gameStarted: false,
      players: [{ id: socket.id, name: host, color: 'red', isHost: true }]
    };

    rooms.set(code, newRoom);
    socket.join(code);
    socket.roomCode = code;
    socket.playerColor = 'red';

    socket.emit('roomCreatedSuccess', {
      roomCode: code,
      players: newRoom.players,
      myColor: 'red',
      isHost: true
    });
    console.log(`[Room Created]: ${code} by ${host}`);
  });

  // 2. JOIN ROOM (4-Digit Integer Match)
  socket.on('joinRoom', ({ playerName, roomCode }) => {
    const rawCode = (roomCode || '').toString().trim().replace(/\s+/g, '');
    console.log(`[Join Attempt]: Code ${rawCode}`);

    const room = rooms.get(rawCode);

    if (!room) {
      socket.emit('roomError', `Galat Room Code (${rawCode})! Kripya 4-digit code check karein.`);
      return;
    }
    if (room.gameStarted) {
      socket.emit('roomError', 'Game pehle hi start ho chuka hai!');
      return;
    }
    if (room.players.length >= 4) {
      socket.emit('roomError', 'Room pehle se full hai (Max 4 Players)!');
      return;
    }

    const assignedColor = COLOR_ORDER[room.players.length] || 'yellow';
    const guest = (playerName || `Player ${room.players.length + 1}`).trim();

    room.players.push({
      id: socket.id,
      name: guest,
      color: assignedColor,
      isHost: false
    });

    socket.join(rawCode);
    socket.roomCode = rawCode;
    socket.playerColor = assignedColor;

    socket.emit('roomJoinedSuccess', {
      roomCode: rawCode,
      players: room.players,
      myColor: assignedColor,
      isHost: false
    });

    io.to(rawCode).emit('lobbyPlayerUpdate', {
      players: room.players,
      hostId: room.hostId
    });
    console.log(`[Player Joined]: ${guest} in Room ${rawCode}`);
  });

  // 3. START ONLINE GAME (Host Triggers)
  socket.on('startOnlineGame', () => {
    const code = socket.roomCode;
    if (!code || !rooms.has(code)) return;
    const room = rooms.get(code);

    if (room.hostId !== socket.id) {
      socket.emit('roomError', 'Sirf Host match start kar sakta hai!');
      return;
    }
    if (room.players.length < 2) {
      socket.emit('roomError', 'Kam se kam 2 devices judne chahiye!');
      return;
    }

    room.gameStarted = true;
    io.to(code).emit('onlineGameStarted', {
      players: room.players,
      activeColor: 'red'
    });
    console.log(`[Game Started]: In Room ${code}`);
  });

  // 4. REALTIME SYNC (Dice Roll & Token Movement)
  socket.on('broadcastGameAction', (actionData) => {
    if (socket.roomCode) {
      socket.to(socket.roomCode).emit('receiveGameAction', actionData);
    }
  });

  // 5. DISCONNECT
  socket.on('disconnect', () => {
    const code = socket.roomCode;
    if (code && rooms.has(code)) {
      const room = rooms.get(code);
      room.players = room.players.filter(p => p.id !== socket.id);
      if (room.players.length === 0) {
        rooms.delete(code);
        console.log(`[Room Cleaned]: ${code}`);
      } else {
        if (room.hostId === socket.id) {
          room.hostId = room.players[0].id;
          room.players[0].isHost = true;
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
  console.log(`Ludo Real-time Server active on port ${PORT}`);
});
