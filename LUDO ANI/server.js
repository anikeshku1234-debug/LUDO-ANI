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

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.get('/manifest.json', (req, res) => res.sendFile(path.join(__dirname, 'manifest.json')));
app.get('/sw.js', (req, res) => {
  res.set('Content-Type', 'application/javascript');
  res.sendFile(path.join(__dirname, 'sw.js'));
});

const rooms = {};
const COLORS = ['red', 'green', 'yellow', 'blue'];
const START_OFFSET = { red: 0, green: 13, yellow: 26, blue: 39 };

// Weighted dice: 1 (+5%), 5 (+5%), 6 (+5%) | 2 (-5%), 3 (-5%), 4 (-5%)
// Base 1/6 ~ 16.67%. Adjusted: 1, 5, 6 = ~21.67% each; 2, 3, 4 = ~11.67% each
function getBiasedRoll() {
  const rand = Math.random() * 100;
  if (rand < 21.67) return 1;
  if (rand < 43.34) return 5;
  if (rand < 65.01) return 6;
  if (rand < 76.68) return 2;
  if (rand < 88.35) return 3;
  return 4;
}

function getNextTurnIndex(room) {
  const total = room.players.length;
  let nextIdx = (room.turnIndex + 1) % total;
  for (let i = 0; i < total; i++) {
    const candidate = room.players[nextIdx];
    if (!room.winners.includes(candidate.color)) return nextIdx;
    nextIdx = (nextIdx + 1) % total;
  }
  return -1;
}

function handleBotTurn(roomCode) {
  const room = rooms[roomCode];
  if (!room || !room.gameStarted) return;
  const activePlayer = room.players[room.turnIndex];
  if (!activePlayer || !activePlayer.isBot) return;

  setTimeout(() => {
    executeDiceRoll(roomCode, activePlayer.id);
  }, 1000);
}

function executeDiceRoll(roomCode, playerId) {
  const room = rooms[roomCode];
  if (!room || !room.gameStarted || room.currentRoll !== 0) return;
  const activePlayer = room.players[room.turnIndex];
  if (!activePlayer || activePlayer.id !== playerId) return;

  const roll = getBiasedRoll();
  room.currentRoll = roll;

  if (roll === 6) {
    room.consecutiveSixes = (room.consecutiveSixes || 0) + 1;
  } else {
    room.consecutiveSixes = 0;
  }

  // 3 Consecutive 6 aane par turn cancel
  if (room.consecutiveSixes >= 3) {
    room.consecutiveSixes = 0;
    room.currentRoll = 0;
    io.to(roomCode).emit('threeSixesCancelled', { color: activePlayer.color });
    setTimeout(() => {
      room.turnIndex = getNextTurnIndex(room);
      io.to(roomCode).emit('turnChanged', {
        activeColor: room.players[room.turnIndex].color,
        tokens: room.tokens
      });
      handleBotTurn(roomCode);
    }, 1000);
    return;
  }

  const myTokens = room.tokens[activePlayer.color];
  const canMove = myTokens.some(t => {
    if (t.step === -1 && roll === 6) return true;
    if (t.step !== -1 && t.step + roll <= 56) return true;
    return false;
  });

  io.to(roomCode).emit('diceRolled', {
    roll: roll,
    activeColor: activePlayer.color,
    canMove: canMove
  });

  if (!canMove) {
    setTimeout(() => {
      room.currentRoll = 0;
      room.consecutiveSixes = 0;
      room.turnIndex = getNextTurnIndex(room);
      io.to(roomCode).emit('turnChanged', {
        activeColor: room.players[room.turnIndex].color,
        tokens: room.tokens
      });
      handleBotTurn(roomCode);
    }, 900);
  } else if (activePlayer.isBot) {
    setTimeout(() => {
      let chosenIndex = -1;
      // Bot preference: Kill first, then open token, then forward movement
      for (let i = 0; i < 4; i++) {
        const t = myTokens[i];
        if (t.step !== -1 && t.step + roll <= 56) {
          chosenIndex = i;
          break;
        }
      }
      if (chosenIndex === -1 && roll === 6) {
        chosenIndex = myTokens.findIndex(t => t.step === -1);
      }
      if (chosenIndex !== -1) executeTokenMove(roomCode, activePlayer.id, chosenIndex);
    }, 800);
  }
}

function executeTokenMove(roomCode, playerId, tokenIndex) {
  const room = rooms[roomCode];
  if (!room || room.currentRoll === 0) return;
  const activePlayer = room.players[room.turnIndex];
  if (!activePlayer || activePlayer.id !== playerId) return;

  const color = activePlayer.color;
  const t = room.tokens[color][tokenIndex];
  const roll = room.currentRoll;

  const fromStep = t.step;
  let toStep = fromStep;
  let valid = false;
  let bonus = (roll === 6);
  let eventType = 'step';
  let killedInfo = null;

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
      const myGlobal = (START_OFFSET[color] + t.step) % 52;
      // 4 safe spots on stamp locations
      const safeGlobals = [0, 13, 26, 39, 8, 21, 34, 47];

      if (!safeGlobals.includes(myGlobal)) {
        room.players.forEach(p => {
          if (p.color !== color) {
            room.tokens[p.color].forEach((other, oIdx) => {
              if (other.step >= 0 && other.step < 51) {
                const otherGlobal = (START_OFFSET[p.color] + other.step) % 52;
                if (otherGlobal === myGlobal) {
                  killedInfo = { color: p.color, index: oIdx, fromStep: other.step };
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
    if (!bonus) room.consecutiveSixes = 0;

    const allFourHome = room.tokens[color].every(tok => tok.step === 56);
    if (allFourHome && !room.winners.includes(color)) {
      room.winners.push(color);
      bonus = false;
    }

    if (!bonus || allFourHome) {
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
      killedInfo: killedInfo,
      bonus: bonus
    });

    handleBotTurn(roomCode);
  }
}

io.on('connection', (socket) => {
  // Reconnect / Auto-join handler
  socket.on('reconnectUser', ({ roomCode, sessionUserId }) => {
    const room = rooms[roomCode];
    if (room) {
      const existing = room.players.find(p => p.sessionUserId === sessionUserId);
      if (existing) {
        existing.id = socket.id;
        socket.join(roomCode);
        socket.roomCode = roomCode;
        socket.playerColor = existing.color;
        socket.emit('sessionRestored', {
          roomCode: roomCode,
          myColor: existing.color,
          players: room.players,
          tokens: room.tokens,
          activeColor: room.players[room.turnIndex].color,
          gameStarted: room.gameStarted
        });
      }
    }
  });

  socket.on('createRoom', ({ playerName, sessionUserId, vsAi }) => {
    if (!playerName) return;
    const roomCode = Math.floor(1000 + Math.random() * 9000).toString();

    const playersList = [{ id: socket.id, sessionUserId: sessionUserId, name: playerName.trim(), color: COLORS[0], isBot: false }];
    if (vsAi) {
      playersList.push({ id: 'bot-id', sessionUserId: 'bot-session', name: 'Computer (AI)', color: COLORS[1], isBot: true });
    }

    rooms[roomCode] = {
      hostId: socket.id,
      gameStarted: false,
      players: playersList,
      turnIndex: 0,
      currentRoll: 0,
      consecutiveSixes: 0,
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

  socket.on('joinRoom', ({ playerName, roomCode, sessionUserId }) => {
    const code = (roomCode || '').trim().toUpperCase();
    const room = rooms[code];
    if (!room) return socket.emit('gameError', 'Room Code galat hai!');
    if (room.gameStarted) return socket.emit('gameError', 'Game chal raha hai!');
    if (room.players.length >= 4) return socket.emit('gameError', 'Room full hai!');

    const assignedColor = COLORS[room.players.length];
    room.players.push({ id: socket.id, sessionUserId: sessionUserId, name: playerName.trim(), color: assignedColor, isBot: false });

    socket.join(code);
    socket.roomCode = code;
    socket.playerColor = assignedColor;

    socket.emit('roomJoinedSuccess', { roomCode: code, myColor: assignedColor, players: room.players });
    io.to(code).emit('lobbyUpdate', { players: room.players, hostId: room.hostId });
  });

  socket.on('startGame', () => {
    const room = rooms[socket.roomCode];
    if (!room || room.hostId !== socket.id || room.players.length < 2) return;
    room.gameStarted = true;
    io.to(socket.roomCode).emit('gameStarted', {
      players: room.players,
      activeColor: room.players[0].color,
      tokens: room.tokens
    });
  });

  socket.on('rollDice', () => executeDiceRoll(socket.roomCode, socket.id));
  socket.on('moveToken', ({ tokenIndex }) => executeTokenMove(socket.roomCode, socket.id, tokenIndex));
});

server.listen(PORT, () => console.log(`Server listening on ${PORT}`));
