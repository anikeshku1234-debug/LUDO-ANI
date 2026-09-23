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

// GLOBAL ROOMS OBJECT
const rooms = new Map();
const COLOR_ORDER = ['red', 'yellow', 'green', 'blue'];

io.on('connection', (socket) => {
  console.log('Connected:', socket.id);

  // CREATE ROOM
  socket.on('createRoom', ({ hostName }) => {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    for (let i = 0; i < 6; i++) {
      code += chars.charAt(Math.floor(Math.random() * chars.length));
    }

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

    socket.emit('roomCreatedSuccess', {
      roomCode: code,
      players: newRoom.players,
      myColor: 'red'
    });
    console.log(`Room created: [${code}] by [${host}]`);
  });

  // JOIN ROOM
  socket.on('joinRoom', ({ playerName, roomCode }) => {
    const rawCode = (roomCode || '').toString().trim().toUpperCase().replace(/\s+/g, '');
    console.log(`Join attempt with code: [${rawCode}]`);

    let targetRoom = null;
    let targetCode = null;

    // Direct search & fallback case-insensitive search
    if (rooms.has(rawCode)) {
      targetRoom = rooms.get(rawCode);
      targetCode = rawCode;
    } else {
      for (let [k, v] of rooms.entries()) {
        if (k.trim().toUpperCase() === rawCode) {
          targetRoom = v;
          targetCode = k;
          break;
        }
      }
    }

    if (!targetRoom) {
      console.log(`Failed: Room [${rawCode}] not found. Active rooms:`, Array.from(rooms.keys()));
      socket.emit('roomError', `Room (${rawCode}) nahi mila! Kripya code check karein.`);
      return;
    }

    if (targetRoom.gameStarted) {
      socket.emit('roomError', 'Game pehle hi shuru ho chuka hai!');
      return;
    }

    if (targetRoom.players.length >= 4) {
      socket.emit('roomError', 'Room full ho chuka hai (Max 4 Players)!');
      return;
    }

    const assignedColor = COLOR_ORDER[targetRoom.players.length] || 'yellow';
    const guest = (playerName || `Player ${targetRoom.players.length + 1}`).trim();

    targetRoom.players.push({
      id: socket.id,
      name: guest,
      color: assignedColor,
      isHost: false
    });

    socket.join(targetCode);
    socket.roomCode = targetCode;

    socket.emit('roomJoinedSuccess', {
      roomCode: targetCode,
      players: targetRoom.players,
      myColor: assignedColor
    });

    // Notify all players in room
    io.to(targetCode).emit('lobbyPlayerUpdate', {
      players: targetRoom.players,
      hostId: targetRoom.hostId
    });

    console.log(`Success: [${guest}] joined room [${targetCode}]`);
  });

  // START ONLINE GAME
  socket.on('startOnlineGame', () => {
    const code = socket.roomCode;
    if (!code || !rooms.has(code)) return;
    const room = rooms.get(code);

    if (room.hostId !== socket.id) {
      socket.emit('roomError', 'Sirf Host game start kar sakta hai!');
      return;
    }

    if (room.players.length < 2) {
      socket.emit('roomError', 'Kam se kam 2 players chahiye!');
      return;
    }

    room.gameStarted = true;
    io.to(code).emit('onlineGameStarted', {
      players: room.players,
      activeColor: 'red'
    });
  });

  // GAME ACTION SYNC
  socket.on('broadcastGameAction', (actionData) => {
    if (socket.roomCode) {
      socket.to(socket.roomCode).emit('receiveGameAction', actionData);
    }
  });

  socket.on('disconnect', () => {
    const code = socket.roomCode;
    if (code && rooms.has(code)) {
      const room = rooms.get(code);
      room.players = room.players.filter(p => p.id !== socket.id);
      if (room.players.length === 0) {
        rooms.delete(code);
        console.log(`Room [${code}] deleted (Empty)`);
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
  console.log(`Server live on ${PORT}`);
});
