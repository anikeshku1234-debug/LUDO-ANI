const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" }
});

const PORT = process.env.PORT || 10000;

// Serve frontend directly
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

const rooms = {};
const COLORS = ['red', 'green', 'yellow', 'blue'];

io.on('connection', (socket) => {
  console.log('Player connected:', socket.id);

  socket.on('joinRoom', ({ playerName, roomCode }) => {
    if (!roomCode || !playerName) return;

    if (!rooms[roomCode]) {
      rooms[roomCode] = {
        players: [],
        turnIndex: 0,
        lastRoll: null
      };
    }

    const room = rooms[roomCode];

    if (room.players.length >= 4) {
      socket.emit('gameError', 'Room pehle se full hai (Max 4 Players)!');
      return;
    }

    const assignedColor = COLORS[room.players.length];
    const player = {
      id: socket.id,
      name: playerName,
      color: assignedColor
    };

    room.players.push(player);
    socket.join(roomCode);
    socket.roomCode = roomCode;

    // Send confirmation to joined player
    socket.emit('roomJoined', {
      myColor: assignedColor,
      roomCode: roomCode
    });

    // Broadcast updated state to all in room
    io.to(roomCode).emit('updateState', {
      players: room.players,
      currentTurn: room.players[room.turnIndex].id,
      lastRoll: room.lastRoll
    });
  });

  socket.on('rollDice', () => {
    const roomCode = socket.roomCode;
    const room = rooms[roomCode];
    if (!room) return;

    const currentPlayer = room.players[room.turnIndex];
    if (!currentPlayer || currentPlayer.id !== socket.id) {
      socket.emit('gameError', 'Abhi aapki baari nahi hai!');
      return;
    }

    // Random dice 1 to 6
    const roll = Math.floor(Math.random() * 6) + 1;
    room.lastRoll = roll;

    // Turn shift logic (6 aane par extra baari)
    if (roll !== 6) {
      room.turnIndex = (room.turnIndex + 1) % room.players.length;
    }

    io.to(roomCode).emit('updateState', {
      players: room.players,
      currentTurn: room.players[room.turnIndex].id,
      lastRoll: room.lastRoll
    });
  });

  socket.on('disconnect', () => {
    const roomCode = socket.roomCode;
    if (roomCode && rooms[roomCode]) {
      rooms[roomCode].players = rooms[roomCode].players.filter(p => p.id !== socket.id);
      if (rooms[roomCode].players.length === 0) {
        delete rooms[roomCode];
      } else {
        rooms[roomCode].turnIndex = 0;
        io.to(roomCode).emit('updateState', {
          players: rooms[roomCode].players,
          currentTurn: rooms[roomCode].players[0].id,
          lastRoll: null
        });
      }
    }
  });
});

server.listen(PORT, () => {
  console.log(`Ludo server is live on port ${PORT}`);
});
