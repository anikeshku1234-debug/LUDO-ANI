const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

const PORT = process.env.PORT || 10000;

app.use(express.static(__dirname));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/manifest.json', (req, res) => {
  res.sendFile(path.join(__dirname, 'manifest.json'));
});

app.get('/sw.js', (req, res) => {
  res.set('Content-Type', 'application/javascript');
  res.sendFile(path.join(__dirname, 'sw.js'));
});

app.get('/logo-192.png', (req, res) => {
  const localPath = path.join(__dirname, 'logo-192.png');
  const rootPath = path.join(__dirname, '..', 'logo-192.png');
  const target = fs.existsSync(localPath) ? localPath : rootPath;
  res.sendFile(target);
});

app.get('/logo-512.png', (req, res) => {
  const localPath = path.join(__dirname, 'logo-512.png');
  const rootPath = path.join(__dirname, '..', 'logo-512.png');
  const target = fs.existsSync(localPath) ? localPath : rootPath;
  res.sendFile(target);
});

const rooms = {};
const COLORS = ['red', 'green', 'yellow', 'blue'];

// Unbiased Crypto Fair Roll (1 to 6)
function getFairRoll() {
  return Math.floor(Math.random() * 6) + 1;
}

// Next active player find karne ka helper (Finished players ko skip karega)
function getNextTurnIndex(room) {
  const total = room.players.length;
  let nextIdx = (room.turnIndex + 1) % total;
  for (let i = 0; i < total; i++) {
    const candidate = room.players[nextIdx];
    if (!room.winners.includes(candidate.color)) {
      return nextIdx;
    }
    nextIdx = (nextIdx + 1) % total;
  }
  return -1;
}

io.on('connection', (socket) => {
  // 1. Create Room
  socket.on('createRoom', ({ playerName }) => {
    if (!playerName) return;
    const roomCode = Math.floor(1000 + Math.random() * 9000).toString();

    rooms[roomCode] = {
      hostId: socket.id,
      gameStarted: false,
      players: [{ id: socket.id, name: playerName.trim(), color: COLORS[0] }],
      turnIndex: 0,
      currentRoll: 0,
      winners: [], // Finished players order [1st, 2nd, 3rd]
      tokens: {
        red: [{ step: -1 }, { step: -1 }, { step: -1 }, { step: -1 }],
        green: [{ step: -1 }, { step: -1 }, { step: -1 }, { step: -1 }],
        yellow: [{ step: -1 }, { step: -1 }, { step: -1 }, { step: -1 }],
        blue: [{ step: -1 }, { step: -1 }, { step: -1 }, { step: -1 }]
      }
    };

    socket.join(roomCode);
    socket.roomCode = roomCode;
    socket.playerColor = COLORS[0];

    socket.emit('roomCreated', {
      roomCode: roomCode,
      myColor: COLORS[0],
      isHost: true,
      players: rooms[roomCode].players
    });
  });

  // 2. Join Room
  socket.on('joinRoom', ({ playerName, roomCode }) => {
    const code = (roomCode || '').trim().toUpperCase();
    const room = rooms[code];

    if (!room) {
      socket.emit('gameError', 'Yeh Room Code galat hai ya band ho chuka hai!');
      return;
    }
    if (room.gameStarted) {
      socket.emit('gameError', 'Game pehle hi shuru ho chuka hai!');
      return;
    }
    if (room.players.length >= 4) {
      socket.emit('gameError', 'Room full hai (Maximum 4 Players)!');
      return;
    }

    const assignedColor = COLORS[room.players.length];
    const newPlayer = { id: socket.id, name: playerName.trim(), color: assignedColor };
    room.players.push(newPlayer);

    socket.join(code);
    socket.roomCode = code;
    socket.playerColor = assignedColor;

    socket.emit('roomJoinedSuccess', {
      roomCode: code,
      myColor: assignedColor,
      isHost: false,
      players: room.players
    });

    io.to(code).emit('lobbyUpdate', {
      players: room.players,
      hostId: room.hostId
    });
  });

  // 3. Start Game
  socket.on('startGame', () => {
    const room = rooms[socket.roomCode];
    if (!room || room.hostId !== socket.id) return;
    if (room.players.length < 2) {
      socket.emit('gameError', 'Game shuru karne ke liye kam se kam 2 players chahiye!');
      return;
    }

    room.gameStarted = true;
    room.turnIndex = 0;
    room.currentRoll = 0;
    room.winners = [];

    io.to(socket.roomCode).emit('gameStarted', {
      players: room.players,
      activeColor: room.players[0].color,
      tokens: room.tokens
    });
  });

  // 4. Roll Dice (Fair Roll)
  socket.on('rollDice', () => {
    const room = rooms[socket.roomCode];
    if (!room || !room.gameStarted || room.currentRoll !== 0) return;

    const activePlayer = room.players[room.turnIndex];
    if (!activePlayer || activePlayer.id !== socket.id) return;

    // Finished player roll nahi kar sakta
    if (room.winners.includes(activePlayer.color)) {
      room.turnIndex = getNextTurnIndex(room);
      io.to(socket.roomCode).emit('turnChanged', {
        activeColor: room.players[room.turnIndex].color,
        tokens: room.tokens
      });
      return;
    }

    const roll = getFairRoll();
    room.currentRoll = roll;

    const myTokens = room.tokens[activePlayer.color];
    const canMove = myTokens.some(t => {
      if (t.step === -1 && roll === 6) return true;
      if (t.step !== -1 && t.step + roll <= 56) return true;
      return false;
    });

    io.to(socket.roomCode).emit('diceRolled', {
      roll: roll,
      activeColor: activePlayer.color,
      canMove: canMove
    });

    if (!canMove) {
      setTimeout(() => {
        room.currentRoll = 0;
        room.turnIndex = getNextTurnIndex(room);
        io.to(socket.roomCode).emit('turnChanged', {
          activeColor: room.players[room.turnIndex].color,
          tokens: room.tokens
        });
      }, 900);
    }
  });

  // 5. Move Token
  socket.on('moveToken', ({ tokenIndex }) => {
    const room = rooms[socket.roomCode];
    if (!room || room.currentRoll === 0) return;

    const activePlayer = room.players[room.turnIndex];
    if (!activePlayer || activePlayer.id !== socket.id) return;

    const color = activePlayer.color;
    const t = room.tokens[color][tokenIndex];
    const roll = room.currentRoll;

    const fromStep = t.step;
    let toStep = fromStep;
    let valid = false;
    let bonus = (roll === 6);
    let eventType = 'step';

    if (t.step === -1 && roll === 6) {
      t.step = 0;
      toStep = 0;
      valid = true;
      bonus = true;
      eventType = 'out';
    } else if (t.step !== -1 && t.step + roll <= 56) {
      toStep = t.step + roll;
      t.step = toStep;
      valid = true;

      if (t.step === 56) {
        bonus = true;
        eventType = 'home';
      } else if (t.step < 51) {
        const START_OFFSET = { red: 0, green: 13, yellow: 26, blue: 39 };
        const myGlobal = (START_OFFSET[color] + t.step) % 52;
        const safeGlobals = [0, 8, 13, 21, 26, 34, 39, 47];

        if (!safeGlobals.includes(myGlobal)) {
          room.players.forEach(p => {
            if (p.color !== color) {
              room.tokens[p.color].forEach(other => {
                if (other.step >= 0 && other.step < 51) {
                  const otherGlobal = (START_OFFSET[p.color] + other.step) % 52;
                  if (otherGlobal === myGlobal) {
                    other.step = -1;
                    bonus = true;
                    eventType = 'kill';
                  }
                }
              });
            }
          });
        }
      }
    }

    if (valid) {
      room.currentRoll = 0;

      // Check karein kya player ki 4 goti Home ho chuki hain (step === 56)
      const allFourHome = room.tokens[color].every(tok => tok.step === 56);
      if (allFourHome && !room.winners.includes(color)) {
        room.winners.push(color);
        bonus = false; // Jeetne ke baad bonus roll nahi milta
        io.to(socket.roomCode).emit('playerRanked', {
          color: color,
          name: activePlayer.name,
          rank: room.winners.length
        });
      }

      // Check karein kya game khatam ho gaya (Sirf 1 active player bacha hai)
      const remainingPlayers = room.players.filter(p => !room.winners.includes(p.color));
      if (remainingPlayers.length <= 1) {
        room.gameStarted = false;
        const loser = remainingPlayers[0] || null;
        io.to(socket.roomCode).emit('gameOver', {
          winners: room.winners.map(c => room.players.find(p => p.color === c)),
          loser: loser
        });
        return;
      }

      if (!bonus || allFourHome) {
        room.turnIndex = getNextTurnIndex(room);
      }

      io.to(socket.roomCode).emit('tokenMoved', {
        tokens: room.tokens,
        activeColor: room.players[room.turnIndex].color,
        eventType: eventType,
        tokenIndex: tokenIndex,
        fromStep: fromStep,
        toStep: toStep,
        moveColor: color,
        bonus: bonus
      });
    }
  });

  socket.on('disconnect', () => {
    const room = rooms[socket.roomCode];
    if (room) {
      room.players = room.players.filter(p => p.id !== socket.id);
      if (room.players.length === 0) {
        delete rooms[socket.roomCode];
      } else {
        if (room.hostId === socket.id) {
          room.hostId = room.players[0].id;
        }
        io.to(socket.roomCode).emit('lobbyUpdate', {
          players: room.players,
          hostId: room.hostId
        });
      }
    }
  });
});

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
