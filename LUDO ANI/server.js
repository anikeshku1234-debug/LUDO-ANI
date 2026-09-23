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
// Turn order clockwise as per standard board: Red -> Green -> Yellow -> Blue
const COLORS = ['red', 'green', 'yellow', 'blue'];

function getFairRoll() {
  return Math.floor(Math.random() * 6) + 1;
}

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

function executeBotTurn(roomCode) {
  const room = rooms[roomCode];
  if (!room || !room.gameStarted) return;
  const activePlayer = room.players[room.turnIndex];
  if (!activePlayer || !activePlayer.isBot) return;

  setTimeout(() => {
    if (!room || !room.gameStarted) return;
    const roll = getFairRoll();
    room.currentRoll = roll;

    if (roll === 6) {
      room.consecutiveSixes = (room.consecutiveSixes || 0) + 1;
    } else {
      room.consecutiveSixes = 0;
    }

    if (room.consecutiveSixes === 3) {
      room.consecutiveSixes = 0;
      room.currentRoll = 0;
      room.turnIndex = getNextTurnIndex(room);
      io.to(roomCode).emit('diceRolled', { roll: 6, activeColor: activePlayer.color, canMove: false, message: '3 Baar 6 aaya! Baari agle player ko mili.' });
      setTimeout(() => {
        io.to(roomCode).emit('turnChanged', { activeColor: room.players[room.turnIndex].color, tokens: room.tokens });
        executeBotTurn(roomCode);
      }, 1100);
      return;
    }

    const myTokens = room.tokens[activePlayer.color];
    const moveable = [];
    myTokens.forEach((t, idx) => {
      if (t.step === -1 && roll === 6) moveable.push(idx);
      else if (t.step !== -1 && t.step + roll <= 56) moveable.push(idx);
    });

    const canMove = moveable.length > 0;
    io.to(roomCode).emit('diceRolled', { roll: roll, activeColor: activePlayer.color, canMove: canMove });

    if (!canMove) {
      setTimeout(() => {
        room.currentRoll = 0;
        room.consecutiveSixes = 0;
        room.turnIndex = getNextTurnIndex(room);
        io.to(roomCode).emit('turnChanged', { activeColor: room.players[room.turnIndex].color, tokens: room.tokens });
        executeBotTurn(roomCode);
      }, 900);
    } else {
      setTimeout(() => {
        // AI Decision logic: Kill priority > Exit base priority > Furthest step
        let chosenIdx = moveable[0];
        const outToken = moveable.find(idx => myTokens[idx].step === -1);
        if (outToken !== undefined && roll === 6) chosenIdx = outToken;

        handleMove(roomCode, activePlayer.color, chosenIdx);
      }, 700);
    }
  }, 1000);
}

function handleMove(roomCode, color, tokenIndex) {
  const room = rooms[roomCode];
  if (!room || room.currentRoll === 0) return;
  const activePlayer = room.players[room.turnIndex];
  if (!activePlayer || activePlayer.color !== color) return;

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
      // 52 Global track steps
      // Red: 0, Green: 13, Yellow: 26, Blue: 39
      const START_OFFSET = { red: 0, green: 13, yellow: 26, blue: 39 };
      const myGlobal = (START_OFFSET[color] + t.step) % 52;
      // 8 Safe places: 4 start positions & 4 star positions
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
    const allFourHome = room.tokens[color].every(tok => tok.step === 56);
    if (allFourHome && !room.winners.includes(color)) {
      room.winners.push(color);
      bonus = false;
      io.to(roomCode).emit('playerRanked', {
        color: color,
        name: activePlayer.name,
        rank: room.winners.length
      });
    }

    const remainingPlayers = room.players.filter(p => !room.winners.includes(p.color));
    if (remainingPlayers.length <= 1) {
      room.gameStarted = false;
      const loser = remainingPlayers[0] || null;
      io.to(roomCode).emit('gameOver', {
        winners: room.winners.map(c => room.players.find(p => p.color === c)),
        loser: loser
      });
      return;
    }

    if (!bonus || allFourHome) {
      room.consecutiveSixes = 0;
      room.turnIndex = getNextTurnIndex(room);
    }

    io.to(roomCode).emit('tokenMoved', {
      tokens: room.tokens,
      activeColor: room.players[room.turnIndex].color,
      eventType: eventType,
      tokenIndex: tokenIndex,
      fromStep: fromStep,
      toStep: toStep,
      moveColor: color,
      bonus: bonus
    });

    executeBotTurn(roomCode);
  }
}

io.on('connection', (socket) => {
  // Computer AI Mode
  socket.on('createBotGame', ({ playerName }) => {
    const roomCode = Math.floor(1000 + Math.random() * 9000).toString();
    rooms[roomCode] = {
      hostId: socket.id,
      gameStarted: true,
      consecutiveSixes: 0,
      players: [
        { id: socket.id, name: playerName.trim() || 'Player 1', color: 'red', isBot: false },
        { id: 'bot_green', name: 'Computer (Green)', color: 'green', isBot: true },
        { id: 'bot_yellow', name: 'Computer (Yellow)', color: 'yellow', isBot: true },
        { id: 'bot_blue', name: 'Computer (Blue)', color: 'blue', isBot: true }
      ],
      turnIndex: 0,
      currentRoll: 0,
      winners: [],
      tokens: {
        red: [{ step: -1 }, { step: -1 }, { step: -1 }, { step: -1 }],
        green: [{ step: -1 }, { step: -1 }, { step: -1 }, { step: -1 }],
        yellow: [{ step: -1 }, { step: -1 }, { step: -1 }, { step: -1 }],
        blue: [{ step: -1 }, { step: -1 }, { step: -1 }, { step: -1 }]
      }
    };

    socket.join(roomCode);
    socket.roomCode = roomCode;
    socket.playerColor = 'red';

    socket.emit('gameStarted', {
      players: rooms[roomCode].players,
      activeColor: 'red',
      tokens: rooms[roomCode].tokens,
      myColor: 'red'
    });
  });

  // Online Multiplayer Room
  socket.on('createRoom', ({ playerName }) => {
    if (!playerName) return;
    const roomCode = Math.floor(1000 + Math.random() * 9000).toString();

    rooms[roomCode] = {
      hostId: socket.id,
      gameStarted: false,
      consecutiveSixes: 0,
      players: [{ id: socket.id, name: playerName.trim(), color: COLORS[0], isBot: false }],
      turnIndex: 0,
      currentRoll: 0,
      winners: [],
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

  socket.on('joinRoom', ({ playerName, roomCode }) => {
    const code = (roomCode || '').trim().toUpperCase();
    const room = rooms[code];

    if (!room) {
      socket.emit('gameError', 'Yeh Room Code galat hai ya band ho chuka hai!');
      return;
    }
    if (room.gameStarted) {
      socket.emit('gameError', 'Game shuru ho chuka hai!');
      return;
    }
    if (room.players.length >= 4) {
      socket.emit('gameError', 'Room full hai (Maximum 4 Players)!');
      return;
    }

    const assignedColor = COLORS[room.players.length];
    const newPlayer = { id: socket.id, name: playerName.trim(), color: assignedColor, isBot: false };
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

  socket.on('startGame', () => {
    const room = rooms[socket.roomCode];
    if (!room || room.hostId !== socket.id) return;
    if (room.players.length < 2) {
      socket.emit('gameError', 'Kam se kam 2 players chahiye!');
      return;
    }

    room.gameStarted = true;
    room.turnIndex = 0;
    room.currentRoll = 0;
    room.winners = [];
    room.consecutiveSixes = 0;

    io.to(socket.roomCode).emit('gameStarted', {
      players: room.players,
      activeColor: room.players[0].color,
      tokens: room.tokens
    });
  });

  socket.on('rollDice', () => {
    const room = rooms[socket.roomCode];
    if (!room || !room.gameStarted || room.currentRoll !== 0) return;

    const activePlayer = room.players[room.turnIndex];
    if (!activePlayer || activePlayer.id !== socket.id) return;

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

    // 3 Sixes Consecutive Check
    if (roll === 6) {
      room.consecutiveSixes = (room.consecutiveSixes || 0) + 1;
    } else {
      room.consecutiveSixes = 0;
    }

    if (room.consecutiveSixes === 3) {
      room.consecutiveSixes = 0;
      room.currentRoll = 0;
      room.turnIndex = getNextTurnIndex(room);

      io.to(socket.roomCode).emit('diceRolled', {
        roll: 6,
        activeColor: activePlayer.color,
        canMove: false,
        message: '3 Baar lagatar 6 aaya! Baari cancel ho gayi.'
      });

      setTimeout(() => {
        io.to(socket.roomCode).emit('turnChanged', {
          activeColor: room.players[room.turnIndex].color,
          tokens: room.tokens
        });
        executeBotTurn(socket.roomCode);
      }, 1000);
      return;
    }

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
        room.consecutiveSixes = 0;
        room.turnIndex = getNextTurnIndex(room);
        io.to(socket.roomCode).emit('turnChanged', {
          activeColor: room.players[room.turnIndex].color,
          tokens: room.tokens
        });
        executeBotTurn(socket.roomCode);
      }, 900);
    }
  });

  socket.on('moveToken', ({ tokenIndex }) => {
    handleMove(socket.roomCode, socket.playerColor, tokenIndex);
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
