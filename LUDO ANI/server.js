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
  const f = fs.existsSync(path.join(__dirname, 'index.html')) ? path.join(__dirname, 'index.html') : path.join(__dirname, '..', 'index.html');
  res.sendFile(f);
});

app.get('/manifest.json', (req, res) => {
  const f = fs.existsSync(path.join(__dirname, 'manifest.json')) ? path.join(__dirname, 'manifest.json') : path.join(__dirname, '..', 'manifest.json');
  res.setHeader('Content-Type', 'application/manifest+json');
  res.sendFile(f);
});

app.get('/sw.js', (req, res) => {
  const f = fs.existsSync(path.join(__dirname, 'sw.js')) ? path.join(__dirname, 'sw.js') : path.join(__dirname, '..', 'sw.js');
  res.setHeader('Content-Type', 'application/javascript');
  res.sendFile(f);
});

app.get('/logo-192.png', (req, res) => {
  const f = fs.existsSync(path.join(__dirname, 'logo-192.png')) ? path.join(__dirname, 'logo-192.png') : path.join(__dirname, '..', 'logo-192.png');
  res.sendFile(f);
});

app.get('/logo-512.png', (req, res) => {
  const f = fs.existsSync(path.join(__dirname, 'logo-512.png')) ? path.join(__dirname, 'logo-512.png') : path.join(__dirname, '..', 'logo-512.png');
  res.sendFile(f);
});

const rooms = {};
const ORDER = ['red', 'green', 'yellow', 'blue'];
const OFFSETS = { red: 0, green: 13, yellow: 26, blue: 39 };
const SAFES = [0, 8, 13, 21, 26, 34, 39, 47];

function createTokens() {
  return [{ step: -1 }, { step: -1 }, { step: -1 }, { step: -1 }];
}

function getNextTurn(room) {
  const count = room.players.length;
  let nxt = (room.turnIndex + 1) % count;
  for (let i = 0; i < count; i++) {
    if (!room.winners.includes(room.players[nxt].color)) {
      return nxt;
    }
    nxt = (nxt + 1) % count;
  }
  return -1;
}

function runBotTurn(code) {
  const room = rooms[code];
  if (!room || !room.gameStarted) return;
  const player = room.players[room.turnIndex];
  if (!player || !player.isBot) return;

  setTimeout(() => {
    if (!room || !room.gameStarted) return;
    const roll = Math.floor(Math.random() * 6) + 1;
    room.currentRoll = roll;

    if (roll === 6) {
      room.consecutiveSixes = (room.consecutiveSixes || 0) + 1;
    } else {
      room.consecutiveSixes = 0;
    }

    if (room.consecutiveSixes === 3) {
      room.consecutiveSixes = 0;
      room.currentRoll = 0;
      room.turnIndex = getNextTurn(room);
      io.to(code).emit('diceRolled', { roll: 6, activeColor: player.color, canMove: false, message: 'Bot ke lagatar 3 chhakke! Chance cancel.' });
      setTimeout(() => {
        io.to(code).emit('turnChanged', { activeColor: room.players[room.turnIndex].color, tokens: room.tokens });
        runBotTurn(code);
      }, 700);
      return;
    }

    const tks = room.tokens[player.color];
    const validIndices = [];
    tks.forEach((t, i) => {
      if (t.step === -1 && roll === 6) validIndices.push(i);
      else if (t.step !== -1 && t.step + roll <= 56) validIndices.push(i);
    });

    const canMove = validIndices.length > 0;
    io.to(code).emit('diceRolled', { roll: roll, activeColor: player.color, canMove: canMove });

    if (!canMove) {
      setTimeout(() => {
        room.currentRoll = 0;
        room.consecutiveSixes = 0;
        room.turnIndex = getNextTurn(room);
        io.to(code).emit('turnChanged', { activeColor: room.players[room.turnIndex].color, tokens: room.tokens });
        runBotTurn(code);
      }, 600);
    } else {
      setTimeout(() => {
        let pick = validIndices[0];
        const out = validIndices.find(idx => tks[idx].step === -1);
        if (out !== undefined && roll === 6) pick = out;
        processMove(code, player.color, pick);
      }, 400);
    }
  }, 400);
}

function processMove(code, color, tokenIndex) {
  const room = rooms[code];
  if (!room || room.currentRoll === 0) return;
  const player = room.players[room.turnIndex];
  if (!player || player.color !== color) return;

  const t = room.tokens[color][tokenIndex];
  const roll = room.currentRoll;
  let valid = false;
  let bonus = (roll === 6);
  let eventType = 'step';

  if (t.step === -1 && roll === 6) {
    t.step = 0;
    valid = true;
    bonus = true;
    eventType = 'out';
  } else if (t.step !== -1 && t.step + roll <= 56) {
    t.step += roll;
    valid = true;

    if (t.step === 56) {
      bonus = true;
      eventType = 'home';
    } else if (t.step < 51) {
      const myGlobal = (OFFSETS[color] + t.step) % 52;
      if (!SAFES.includes(myGlobal)) {
        room.players.forEach(p => {
          if (p.color !== color) {
            room.tokens[p.color].forEach(other => {
              if (other.step >= 0 && other.step < 51) {
                const oppGlobal = (OFFSETS[p.color] + other.step) % 52;
                if (oppGlobal === myGlobal) {
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
    const allHome = room.tokens[color].every(x => x.step === 56);
    if (allHome && !room.winners.includes(color)) {
      room.winners.push(color);
      bonus = false;
      io.to(code).emit('playerRanked', { color: color, name: player.name, rank: room.winners.length });
    }

    const remaining = room.players.filter(p => !room.winners.includes(p.color));
    if (remaining.length <= 1) {
      room.gameStarted = false;
      const loser = remaining[0] || null;
      io.to(code).emit('tokenMoved', { tokens: room.tokens, activeColor: color, eventType: eventType });
      setTimeout(() => {
        io.to(code).emit('gameOver', {
          winners: room.winners.map(c => room.players.find(p => p.color === c)),
          loser: loser
        });
        delete rooms[code];
      }, 700);
      return;
    }

    if (!bonus || allHome) {
      room.consecutiveSixes = 0;
      room.turnIndex = getNextTurn(room);
    }

    const nextColor = room.players[room.turnIndex].color;
    io.to(code).emit('tokenMoved', { tokens: room.tokens, activeColor: nextColor, eventType: eventType });
    runBotTurn(code);
  }
}

io.on('connection', (socket) => {
  socket.on('startBotMatch', ({ playerName }) => {
    const code = Math.floor(1000 + Math.random() * 9000).toString();
    rooms[code] = {
      hostId: socket.id,
      gameStarted: true,
      turnIndex: 0,
      currentRoll: 0,
      winners: [],
      consecutiveSixes: 0,
      players: [
        { id: socket.id, name: (playerName || 'Player 1').trim(), color: 'red', isBot: false },
        { id: 'bot_yellow', name: 'Computer (Yellow)', color: 'yellow', isBot: true }
      ],
      tokens: {
        red: createTokens(),
        yellow: createTokens(),
        green: createTokens(),
        blue: createTokens()
      }
    };
    socket.join(code);
    socket.roomCode = code;
    socket.playerColor = 'red';

    socket.emit('gameStarted', {
      players: rooms[code].players,
      activeColor: 'red',
      tokens: rooms[code].tokens,
      myColor: 'red'
    });
  });

  socket.on('createRoom', ({ playerName }) => {
    if (!playerName || !playerName.trim()) return socket.emit('gameError', 'Naam likhein!');
    const code = Math.floor(1000 + Math.random() * 9000).toString();
    rooms[code] = {
      hostId: socket.id,
      gameStarted: false,
      turnIndex: 0,
      currentRoll: 0,
      winners: [],
      consecutiveSixes: 0,
      players: [{ id: socket.id, name: playerName.trim(), color: 'red', isBot: false }],
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
    socket.emit('roomCreated', { roomCode: code, players: rooms[code].players });
  });

  socket.on('joinRoom', ({ playerName, roomCode }) => {
    const code = (roomCode || '').trim().toUpperCase();
    const room = rooms[code];
    if (!room) return socket.emit('gameError', 'Galat Room Code!');
    if (room.gameStarted) return socket.emit('gameError', 'Game pehle shuru ho chuka hai!');
    if (room.players.length >= 4) return socket.emit('gameError', 'Room full hai!');

    const color = ORDER[room.players.length];
    const newPlayer = { id: socket.id, name: (playerName || 'Player').trim(), color: color, isBot: false };
    room.players.push(newPlayer);
    socket.join(code);
    socket.roomCode = code;
    socket.playerColor = color;

    socket.emit('roomJoinedSuccess', { roomCode: code, players: room.players, myColor: color });
    io.to(code).emit('lobbyUpdate', { players: room.players, hostId: room.hostId });
  });

  socket.on('startRoomGame', () => {
    const room = rooms[socket.roomCode];
    if (!room || room.hostId !== socket.id) return;
    if (room.players.length < 2) return socket.emit('gameError', 'Kam se kam 2 players chahiye!');

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
    const player = room.players[room.turnIndex];
    if (!player || player.id !== socket.id) return;

    if (room.winners.includes(player.color)) {
      room.turnIndex = getNextTurn(room);
      io.to(socket.roomCode).emit('turnChanged', { activeColor: room.players[room.turnIndex].color, tokens: room.tokens });
      return;
    }

    const roll = Math.floor(Math.random() * 6) + 1;
    room.currentRoll = roll;

    if (roll === 6) {
      room.consecutiveSixes = (room.consecutiveSixes || 0) + 1;
    } else {
      room.consecutiveSixes = 0;
    }

    if (room.consecutiveSixes === 3) {
      room.consecutiveSixes = 0;
      room.currentRoll = 0;
      room.turnIndex = getNextTurn(room);
      io.to(socket.roomCode).emit('diceRolled', { roll: 6, activeColor: player.color, canMove: false, message: '3 baar 6 aaya! Chance cancel.' });
      setTimeout(() => {
        io.to(socket.roomCode).emit('turnChanged', { activeColor: room.players[room.turnIndex].color, tokens: room.tokens });
        runBotTurn(socket.roomCode);
      }, 700);
      return;
    }

    const tks = room.tokens[player.color];
    const canMove = tks.some(t => (t.step === -1 && roll === 6) || (t.step !== -1 && t.step + roll <= 56));

    io.to(socket.roomCode).emit('diceRolled', { roll: roll, activeColor: player.color, canMove: canMove });

    if (!canMove) {
      setTimeout(() => {
        room.currentRoll = 0;
        room.consecutiveSixes = 0;
        room.turnIndex = getNextTurn(room);
        io.to(socket.roomCode).emit('turnChanged', { activeColor: room.players[room.turnIndex].color, tokens: room.tokens });
        runBotTurn(socket.roomCode);
      }, 700);
    }
  });

  socket.on('moveToken', ({ tokenIndex }) => {
    processMove(socket.roomCode, socket.playerColor, tokenIndex);
  });

  socket.on('disconnect', () => {
    const room = rooms[socket.roomCode];
    if (room) {
      room.players = room.players.filter(p => p.id !== socket.id);
      if (room.players.length === 0) {
        delete rooms[socket.roomCode];
      } else {
        if (room.hostId === socket.id) room.hostId = room.players[0].id;
        io.to(socket.roomCode).emit('lobbyUpdate', { players: room.players, hostId: room.hostId });
      }
    }
  });
});

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
