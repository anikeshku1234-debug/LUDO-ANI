const express = require('express');
const http = require('http');
const path = require('path'); // <-- Path module zaroori hai
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

const PORT = process.env.PORT || 3000;

// 1. Static files serve karne ke liye (HTML, CSS, JS)
app.use(express.static(__dirname));

// 2. Browser me directly index.html kholne ke liye
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Chaaro classic Ludo colours
const COLORS = [
  { name: 'Red', hex: '#dc2626' },
  { name: 'Green', hex: '#16a34a' },
  { name: 'Yellow', hex: '#ca8a04' },
  { name: 'Blue', hex: '#2563eb' }
];

const rooms = {};

io.on('connection', (socket) => {
  // Join ya Create Room
  socket.on('joinRoom', ({ roomCode, playerName }) => {
    const code = roomCode.trim().toUpperCase();
    const name = playerName.trim();

    if (!code || !name) {
      socket.emit('errorMsg', 'Room code aur naam dono zaroori hain!');
      return;
    }

    if (!rooms[code]) {
      rooms[code] = { players: [], turnIndex: 0, started: false };
    }

    const room = rooms[code];

    if (room.players.length >= 4) {
      socket.emit('errorMsg', 'Yeh room full ho chuka hai (Max 4 players)!');
      return;
    }

    if (room.started) {
      socket.emit('errorMsg', 'Game pehle hi start ho chuka hai!');
      return;
    }

    const assignedColor = COLORS[room.players.length];
    const newPlayer = {
      id: socket.id,
      name: name,
      color: assignedColor.name,
      colorHex: assignedColor.hex
    };

    room.players.push(newPlayer);
    socket.join(code);

    io.to(code).emit('roomUpdate', {
      players: room.players,
      roomCode: code
    });
  });

  // Start Game
  socket.on('startGame', (roomCode) => {
    const code = roomCode.trim().toUpperCase();
    const room = rooms[code];

    if (!room) return;

    if (room.players.length < 2) {
      socket.emit('errorMsg', 'Game start karne ke liye kam se kam 2 players chahiye!');
      return;
    }

    room.started = true;
    room.turnIndex = 0;

    io.to(code).emit('gameStarted', {
      players: room.players,
      currentTurn: room.players[0]
    });
  });

  // Roll Dice
  socket.on('rollDice', (roomCode) => {
    const code = roomCode.trim().toUpperCase();
    const room = rooms[code];

    if (!room || !room.started) return;

    const currentTurnPlayer = room.players[room.turnIndex];

    if (socket.id !== currentTurnPlayer.id) {
      socket.emit('errorMsg', 'Abhi aapki turn nahi hai! Intezar karein.');
      return;
    }

    const diceValue = Math.floor(Math.random() * 6) + 1;

    if (diceValue !== 6) {
      room.turnIndex = (room.turnIndex + 1) % room.players.length;
    }

    io.to(code).emit('diceRolled', {
      rolledBy: currentTurnPlayer,
      value: diceValue,
      nextTurn: room.players[room.turnIndex]
    });
  });

  // Disconnect
  socket.on('disconnect', () => {
    for (const code in rooms) {
      const room = rooms[code];
      const index = room.players.findIndex((p) => p.id === socket.id);

      if (index !== -1) {
        room.players.splice(index, 1);

        if (room.players.length === 0) {
          delete rooms[code];
        } else {
          if (room.turnIndex >= room.players.length) {
            room.turnIndex = 0;
          }
          io.to(code).emit('roomUpdate', {
            players: room.players,
            roomCode: code
          });
        }
        break;
      }
    }
  });
});

server.listen(PORT, () => {
  console.log(`Ludo server is live on port ${PORT}`);
});
