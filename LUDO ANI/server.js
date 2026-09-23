/**
 * ============================================================================
 * LUDO ENGINE SERVER (ONLINE ROOMS + PASS & PLAY SUPPORT)
 * ============================================================================
 */
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

function getFileSafe(filename, mimeType, res) {
  const localP = path.join(__dirname, filename);
  const rootP = path.join(__dirname, '..', filename);
  const target = fs.existsSync(localP) ? localP : rootP;
  if (mimeType) res.setHeader('Content-Type', mimeType);
  res.sendFile(target);
}

app.get('/', (req, res) => getFileSafe('index.html', 'text/html', res));
app.get('/manifest.json', (req, res) => getFileSafe('manifest.json', 'application/manifest+json', res));
app.get('/sw.js', (req, res) => {
  res.setHeader('Service-Worker-Allowed', '/');
  getFileSafe('sw.js', 'application/javascript', res);
});
app.get('/logo-192.png', (req, res) => getFileSafe('logo-192.png', 'image/png', res));
app.get('/logo-512.png', (req, res) => getFileSafe('logo-512.png', 'image/png', res));

const rooms = {};

// Order of rotation: Red (BL) -> Green (TL) -> Yellow (TR) -> Blue (BR)
const COLOR_ORDER = ['red', 'green', 'yellow', 'blue'];
const OFFSETS = { red: 0, green: 13, yellow: 26, blue: 39 };
const SAFES = [0, 8, 13, 21, 26, 34, 39, 47];

function createTokens() {
  return [{ step: -1 }, { step: -1 }, { step: -1 }, { step: -1 }];
}

function getNextTurnIndex(room) {
  const total = room.players.length;
  let next = (room.turnIndex + 1) % total;
  for (let i = 0; i < total; i++) {
    if (!room.winners.includes(room.players[next].color)) {
      return next;
    }
    next = (next + 1) % total;
  }
  return -1;
}

function processPlayerMove(roomCode, color, tokenIndex) {
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
  let killed = null;

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
      const myGlobal = (OFFSETS[color] + t.step) % 52;
      if (!SAFES.includes(myGlobal)) {
        room.players.forEach(p => {
          if (p.color !== color && !room.winners.includes(p.color)) {
            room.tokens[p.color].forEach((other, oIdx) => {
              if (other.step >= 0 && other.step < 51) {
                const otherGlobal = (OFFSETS[p.color] + other.step) % 52;
                if (otherGlobal === myGlobal) {
                  killed = { color: p.color, index: oIdx, fromStep: other.step };
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

  if (!valid) return;

  room.currentRoll = 0;

  // Check if player won
  const allHome = room.tokens[color].every(tok => tok.step === 56);
  if (allHome && !room.winners.includes(color)) {
    room.winners.push(color);
    bonus = false;
    io.to(roomCode).emit('playerRanked', {
      color: color,
      name: activePlayer.name,
      rank: room.winners.length
    });
  }

  // Check Game Over
  const activeRemaining = room.players.filter(p => !room.winners.includes(p.color));
  if (activeRemaining.length <= 1) {
    room.gameStarted = false;
    const loser = activeRemaining[0] || null;

    io.to(roomCode).emit('tokenMoved', {
      tokens: room.tokens,
      activeColor: color,
      eventType: eventType,
      tokenIndex: tokenIndex,
      fromStep: fromStep,
      toStep: toStep,
      moveColor: color,
      bonus: false,
      killed: killed
    });

    setTimeout(() => {
      io.to(roomCode).emit('gameOver', {
        winners: room.winners.map(c => room.players.find(p => p.color === c)),
        loser: loser
      });
      delete rooms[roomCode];
    }, 1500);
    return;
  }

  if (!bonus || allHome) {
    room.consecutiveSixes = 0;
    room.turnIndex = getNextTurnIndex(room);
  }

  const nextColor = room.players[room.turnIndex].color;

  io.to(roomCode).emit('tokenMoved', {
    tokens: room.tokens,
    activeColor: nextColor,
    eventType: eventType,
    tokenIndex: tokenIndex,
    fromStep: fromStep,
    toStep: toStep,
    moveColor: color,
    bonus: bonus,
    killed: killed
  });
}

io.on('connection', (socket) => {
  // 1. Online: Create Room
  socket.on('createRoom', ({ playerName }) => {
    const name = (playerName || 'Player 1').trim();
    const code = Math.floor(1000 + Math.random() * 9000).toString();

    rooms[code] = {
      roomCode: code,
      hostId: socket.id,
      gameStarted: false,
      isPassAndPlay: false,
      consecutiveSixes: 0,
      turnIndex: 0,
      currentRoll: 0,
      winners: [],
      players: [{ id: socket.id, name: name, color: 'red' }],
      tokens: {
        red: createTokens(),
        green: createTokens(),
        yellow: createTokens(),
        blue: createTokens()
      }
    };

    socket.join(code);
    socket.roomCode = code;
    socket.playerColor = 'red';

    socket.emit('roomCreated', {
      roomCode: code,
      myColor: 'red',
      isHost: true,
      players: rooms[code].players
    });
  });

  // 2. Online: Join Room
  socket.on('joinRoom', ({ playerName, roomCode }) => {
    const code = (roomCode || '').trim().toUpperCase();
    const room = rooms[code];

    if (!room) return socket.emit('gameError', 'Room Code galat hai ya band ho chuka hai!');
    if (room.gameStarted) return socket.emit('gameError', 'Game pehle hi shuru ho chuka hai!');
    if (room.players.length >= 4) return socket.emit('gameError', 'Room full hai (Max 4)!');

    const assignedColor = COLOR_ORDER[room.players.length];
    const newPlayer = {
      id: socket.id,
      name: (playerName || `Player ${room.players.length + 1}`).trim(),
      color: assignedColor
    };

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

  // 3. Online: Start Game
  socket.on('startRoomGame', () => {
    const room = rooms[socket.roomCode];
    if (!room || room.hostId !== socket.id) return;
    if (room.players.length < 2) {
      return socket.emit('gameError', 'Kam se kam 2 players hona zaroori hai!');
    }

    room.gameStarted = true;
    room.turnIndex = 0;
    room.currentRoll = 0;
    room.winners = [];
    room.consecutiveSixes = 0;

    io.to(socket.roomCode).emit('gameStarted', {
      players: room.players,
      activeColor: room.players[0].color,
      tokens: room.tokens,
      isPassAndPlay: false
    });
  });

  // 4. Pass & Play Mode (2, 3, ya 4 Players on Single Device)
  socket.on('startPassAndPlay', ({ playersList }) => {
    const code = Math.floor(1000 + Math.random() * 9000).toString();
    const players = [];

    // Assign custom names & matching colors
    // If 2 players: Red & Yellow (Opposite sides)
    const assignedColors = (playersList.length === 2) ? ['red', 'yellow'] : COLOR_ORDER.slice(0, playersList.length);

    playersList.forEach((pName, idx) => {
      players.push({
        id: `local_${idx}`,
        name: (pName || `Player ${idx + 1}`).trim(),
        color: assignedColors[idx]
      });
    });

    rooms[code] = {
      roomCode: code,
      hostId: socket.id,
      gameStarted: true,
      isPassAndPlay: true,
      consecutiveSixes: 0,
      turnIndex: 0,
      currentRoll: 0,
      winners: [],
      players: players,
      tokens: {
        red: createTokens(),
        green: createTokens(),
        yellow: createTokens(),
        blue: createTokens()
      }
    };

    socket.join(code);
    socket.roomCode = code;

    socket.emit('gameStarted', {
      players: rooms[code].players,
      activeColor: players[0].color,
      tokens: rooms[code].tokens,
      isPassAndPlay: true
    });
  });

  // 5. Roll Dice
  socket.on('rollDice', () => {
    const room = rooms[socket.roomCode];
    if (!room || !room.gameStarted || room.currentRoll !== 0) return;

    const activePlayer = room.players[room.turnIndex];
    if (!room.isPassAndPlay && activePlayer.id !== socket.id) return;

    if (room.winners.includes(activePlayer.color)) {
      room.turnIndex = getNextTurnIndex(room);
      io.to(socket.roomCode).emit('turnChanged', {
        activeColor: room.players[room.turnIndex].color,
        tokens: room.tokens
      });
      return;
    }

    const roll = Math.floor(Math.random() * 6) + 1;
    room.currentRoll = roll;

    if (roll === 6) {
      room.consecutiveSixes = (room.consecutiveSixes || 0) + 1;
    } else {
      room.consecutiveSixes = 0;
    }

    // 3 Consecutive 6s rule
    if (room.consecutiveSixes === 3) {
      room.consecutiveSixes = 0;
      room.currentRoll = 0;
      room.turnIndex = getNextTurnIndex(room);

      io.to(socket.roomCode).emit('diceRolled', {
        roll: 6,
        activeColor: activePlayer.color,
        canMove: false,
        message: '3 Chhakke aane par baari cancel ho gayi!'
      });

      setTimeout(() => {
        const afterRoom = rooms[socket.roomCode];
        if (!afterRoom || !afterRoom.gameStarted) return;
        io.to(socket.roomCode).emit('turnChanged', {
          activeColor: afterRoom.players[afterRoom.turnIndex].color,
          tokens: afterRoom.tokens
        });
      }, 900);
      return;
    }

    const myTokens = room.tokens[activePlayer.color];
    const legalMoves = [];
    myTokens.forEach((t, idx) => {
      if (t.step === -1 && roll === 6) legalMoves.push(idx);
      else if (t.step !== -1 && t.step + roll <= 56) legalMoves.push(idx);
    });

    const canMove = legalMoves.length > 0;

    io.to(socket.roomCode).emit('diceRolled', {
      roll: roll,
      activeColor: activePlayer.color,
      canMove: canMove,
      legalMoves: legalMoves
    });

    if (!canMove) {
      setTimeout(() => {
        const currentR = rooms[socket.roomCode];
        if (!currentR || !currentR.gameStarted) return;

        currentR.currentRoll = 0;
        currentR.consecutiveSixes = 0;
        currentR.turnIndex = getNextTurnIndex(currentR);

        io.to(socket.roomCode).emit('turnChanged', {
          activeColor: currentR.players[currentR.turnIndex].color,
          tokens: currentR.tokens
        });
      }, 850);
    } else if (legalMoves.length === 1) {
      // Auto-move feature when only 1 option is available
      setTimeout(() => {
        processPlayerMove(socket.roomCode, activePlayer.color, legalMoves[0]);
      }, 400);
    }
  });

  // 6. Manual Move Token (when multiple choices exist)
  socket.on('moveToken', ({ tokenIndex }) => {
    const room = rooms[socket.roomCode];
    if (!room) return;
    const activePlayer = room.players[room.turnIndex];
    if (!activePlayer) return;

    if (!room.isPassAndPlay && activePlayer.id !== socket.id) return;
    processPlayerMove(socket.roomCode, activePlayer.color, tokenIndex);
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
  console.log(`Ludo Engine Server running on port ${PORT}`);
});
