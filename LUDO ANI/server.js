/**
 * ============================================================================
 * LUDO MULTIPLAYER & SMART AI ENGINE SERVER
 * Core Engine: Express, HTTP, Socket.IO, Crypto, Path, FS
 * Features: True Unbiased Rolls, 3-Consecutive Sixes Rule, 8 Safe Zones,
 *           Progressive Rankings (1st, 2nd, 3rd, Looser), 1v1 Fast AI,
 *           Anti-Stall Turn Management, Room State Isolation.
 * ============================================================================
 */

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

// --- APP & SERVER INITIALIZATION ---
const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  },
  pingTimeout: 30000,
  pingInterval: 10000
});

const PORT = process.env.PORT || 10000;

// Middleware for static files
app.use(express.static(__dirname));

// --- ASSET SERVING & PWA FALLBACK ROUTES ---

app.get('/', (req, res) => {
  const localIndex = path.join(__dirname, 'index.html');
  const rootIndex = path.join(__dirname, '..', 'index.html');
  const target = fs.existsSync(localIndex) ? localIndex : rootIndex;
  res.sendFile(target);
});

app.get('/manifest.json', (req, res) => {
  const localManifest = path.join(__dirname, 'manifest.json');
  const rootManifest = path.join(__dirname, '..', 'manifest.json');
  const target = fs.existsSync(localManifest) ? localManifest : rootManifest;
  res.setHeader('Content-Type', 'application/manifest+json');
  res.sendFile(target);
});

app.get('/sw.js', (req, res) => {
  const localSW = path.join(__dirname, 'sw.js');
  const rootSW = path.join(__dirname, '..', 'sw.js');
  const target = fs.existsSync(localSW) ? localSW : rootSW;
  res.setHeader('Content-Type', 'application/javascript');
  res.setHeader('Service-Worker-Allowed', '/');
  res.sendFile(target);
});

app.get('/logo-192.png', (req, res) => {
  const localPath = path.join(__dirname, 'logo-192.png');
  const rootPath = path.join(__dirname, '..', 'logo-192.png');
  const target = fs.existsSync(localPath) ? localPath : rootPath;
  res.setHeader('Content-Type', 'image/png');
  res.sendFile(target);
});

app.get('/logo-512.png', (req, res) => {
  const localPath = path.join(__dirname, 'logo-512.png');
  const rootPath = path.join(__dirname, '..', 'logo-512.png');
  const target = fs.existsSync(localPath) ? localPath : rootPath;
  res.setHeader('Content-Type', 'image/png');
  res.sendFile(target);
});

// Health check route
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', activeRooms: Object.keys(rooms).length });
});

// --- CORE GAME CONSTANTS & BOARD TOPOLOGY ---

/**
 * Standard clockwise order matching board layout:
 * Red: Bottom-Left
 * Green: Top-Left
 * Yellow: Top-Right
 * Blue: Bottom-Right
 */
const BOARD_COLORS = ['red', 'green', 'yellow', 'blue'];

/**
 * Track Offset Indices:
 * Board track has 52 main perimeter coordinates (0 to 51).
 * Offset represents the global index where each player exits their yard onto the track.
 */
const COLOR_START_OFFSETS = {
  red: 0,
  green: 13,
  yellow: 26,
  blue: 39
};

/**
 * 8 Safe Positions on the 52-cell track:
 * - 4 Entry points: 0 (Red), 13 (Green), 26 (Yellow), 39 (Blue)
 * - 4 Star squares: 8, 21, 34, 47
 * No player can be captured on these cells.
 */
const GLOBAL_SAFE_INDICES = [0, 8, 13, 21, 26, 34, 39, 47];

// In-Memory Storage for Active Rooms
const rooms = {};

// --- CRYPTOGRAPHIC FAIR DICE UTILITY ---

/**
 * Generates an integer from 1 to 6 using a cryptographic PRNG.
 * Prevents bias and predictable sequence exploits.
 */
function getFairCryptoRoll() {
  return crypto.randomInt(1, 7);
}

// --- STATE CREATION & HELPER FACTORIES ---

/**
 * Creates 4 tokens for a given color.
 * Step convention:
 *   -1 : In Base (Yard)
 *    0 : Entry position on main track
 * 1-50 : Navigating main track
 * 51-55: Home Column (safe path towards center)
 *   56 : Home (Finished)
 */
function createInitialTokenSet() {
  return [
    { id: 0, step: -1 },
    { id: 1, step: -1 },
    { id: 2, step: -1 },
    { id: 3, step: -1 }
  ];
}

/**
 * Calculates global track position (0-51) from color and relative step.
 * Returns -1 if token is in yard, home column, or finished.
 */
function getGlobalTrackIndex(color, step) {
  if (step < 0 || step > 50) return -1;
  const offset = COLOR_START_OFFSETS[color];
  return (offset + step) % 52;
}

/**
 * Checks if a specific global coordinate is marked as safe.
 */
function isTrackIndexSafe(globalIndex) {
  return GLOBAL_SAFE_INDICES.includes(globalIndex);
}

/**
 * Finds the index of the next active player who hasn't finished all 4 tokens yet.
 */
function determineNextActivePlayerIndex(room) {
  const totalPlayers = room.players.length;
  if (totalPlayers === 0) return -1;

  let nextCandidate = (room.turnIndex + 1) % totalPlayers;
  for (let searchCount = 0; searchCount < totalPlayers; searchCount++) {
    const candidatePlayer = room.players[nextCandidate];
    if (!room.winners.includes(candidatePlayer.color)) {
      return nextCandidate;
    }
    nextCandidate = (nextCandidate + 1) % totalPlayers;
  }
  return -1;
}

/**
 * Checks whether a single token can execute a move with the rolled value.
 */
function isTokenMoveLegal(token, roll) {
  if (token.step === -1) {
    return roll === 6;
  }
  return token.step + roll <= 56;
}

/**
 * Returns all token indices that are eligible to move given the current roll.
 */
function getMovableTokenIndices(tokens, roll) {
  const legalIndices = [];
  tokens.forEach((tok, idx) => {
    if (isTokenMoveLegal(tok, roll)) {
      legalIndices.push(idx);
    }
  });
  return legalIndices;
}

/**
 * Checks if all 4 tokens of a player have reached the center finish (step 56).
 */
function hasPlayerCompletedAllTokens(tokens) {
  return tokens.every(t => t.step === 56);
}

// --- FAST SMART AI DECISION TREE ---

/**
 * Evaluates the best token to move for the AI player.
 * Priority Heuristics:
 * 1. Capture Opponent: Eliminates enemy token and awards bonus turn.
 * 2. Enter Center Finish: Reaches step 56 (Home) and awards bonus turn.
 * 3. Base Release: If roll is 6, release a new token into active play.
 * 4. Land on Safe Square: Move token onto a star or colored safe cell.
 * 5. Escape Danger: Move an exposed token away if an opponent is within 6 steps behind.
 * 6. Lead Progression: Advance token closest to Home.
 */
function selectBestBotTokenIndex(room, botColor, roll, movableIndices) {
  const botTokens = room.tokens[botColor];
  const botOffset = COLOR_START_OFFSETS[botColor];

  // Heuristic 1: Find instant kill
  for (const idx of movableIndices) {
    const t = botTokens[idx];
    const candidateStep = t.step === -1 ? 0 : t.step + roll;
    if (candidateStep <= 50) {
      const candidateGlobal = (botOffset + candidateStep) % 52;
      if (!isTrackIndexSafe(candidateGlobal)) {
        for (const player of room.players) {
          if (player.color !== botColor && !room.winners.includes(player.color)) {
            const opponentTokens = room.tokens[player.color];
            const enemyKilled = opponentTokens.some(other => {
              if (other.step >= 0 && other.step <= 50) {
                const oppGlobal = (COLOR_START_OFFSETS[player.color] + other.step) % 52;
                return oppGlobal === candidateGlobal;
              }
              return false;
            });
            if (enemyKilled) return idx;
          }
        }
      }
    }
  }

  // Heuristic 2: Finish a token (Step 56)
  for (const idx of movableIndices) {
    const t = botTokens[idx];
    if (t.step !== -1 && t.step + roll === 56) {
      return idx;
    }
  }

  // Heuristic 3: Exit base on a 6
  if (roll === 6) {
    const baseTokenIdx = movableIndices.find(idx => botTokens[idx].step === -1);
    if (baseTokenIdx !== undefined) {
      return baseTokenIdx;
    }
  }

  // Heuristic 4: Move onto a safe cell
  for (const idx of movableIndices) {
    const t = botTokens[idx];
    const candidateStep = t.step === -1 ? 0 : t.step + roll;
    if (candidateStep <= 50) {
      const candidateGlobal = (botOffset + candidateStep) % 52;
      if (isTrackIndexSafe(candidateGlobal)) {
        return idx;
      }
    }
  }

  // Heuristic 5: Advance furthest token
  let chosenIndex = movableIndices[0];
  let maxStep = -2;
  for (const idx of movableIndices) {
    const t = botTokens[idx];
    if (t.step > maxStep) {
      maxStep = t.step;
      chosenIndex = idx;
    }
  }

  return chosenIndex;
}

/**
 * Executes an automated turn for AI bot with fast, non-blocking responsiveness.
 */
function triggerBotTurn(roomCode) {
  const room = rooms[roomCode];
  if (!room || !room.gameStarted) return;

  const activePlayer = room.players[room.turnIndex];
  if (!activePlayer || !activePlayer.isBot) return;

  // 400ms delay to simulate fast natural reaction without UI lock
  setTimeout(() => {
    const currentRoom = rooms[roomCode];
    if (!currentRoom || !currentRoom.gameStarted) return;

    const currentActor = currentRoom.players[currentRoom.turnIndex];
    if (!currentActor || !currentActor.isBot || currentActor.id !== activePlayer.id) return;

    const roll = getFairCryptoRoll();
    currentRoom.currentRoll = roll;

    // Consecutive 6s tracking
    if (roll === 6) {
      currentRoom.consecutiveSixes = (currentRoom.consecutiveSixes || 0) + 1;
    } else {
      currentRoom.consecutiveSixes = 0;
    }

    // 3 Sixes cancellation rule
    if (currentRoom.consecutiveSixes === 3) {
      currentRoom.consecutiveSixes = 0;
      currentRoom.currentRoll = 0;
      currentRoom.turnIndex = determineNextActivePlayerIndex(currentRoom);

      io.to(roomCode).emit('diceRolled', {
        roll: 6,
        activeColor: currentActor.color,
        canMove: false,
        message: 'AI ke lagatar 3 bar 6 aaye! Baari cancel.'
      });

      setTimeout(() => {
        const afterCancelRoom = rooms[roomCode];
        if (!afterCancelRoom || !afterCancelRoom.gameStarted) return;
        io.to(roomCode).emit('turnChanged', {
          activeColor: afterCancelRoom.players[afterCancelRoom.turnIndex].color,
          tokens: afterCancelRoom.tokens
        });
        triggerBotTurn(roomCode);
      }, 700);
      return;
    }

    const botTokens = currentRoom.tokens[currentActor.color];
    const legalMoves = getMovableTokenIndices(botTokens, roll);
    const canMove = legalMoves.length > 0;

    io.to(roomCode).emit('diceRolled', {
      roll: roll,
      activeColor: currentActor.color,
      canMove: canMove
    });

    if (!canMove) {
      setTimeout(() => {
        const noMoveRoom = rooms[roomCode];
        if (!noMoveRoom || !noMoveRoom.gameStarted) return;

        noMoveRoom.currentRoll = 0;
        noMoveRoom.consecutiveSixes = 0;
        noMoveRoom.turnIndex = determineNextActivePlayerIndex(noMoveRoom);

        io.to(roomCode).emit('turnChanged', {
          activeColor: noMoveRoom.players[noMoveRoom.turnIndex].color,
          tokens: noMoveRoom.tokens
        });
        triggerBotTurn(roomCode);
      }, 600);
    } else {
      setTimeout(() => {
        const moveRoom = rooms[roomCode];
        if (!moveRoom || !moveRoom.gameStarted) return;
        const selectedTokenIdx = selectBestBotTokenIndex(moveRoom, currentActor.color, roll, legalMoves);
        executePlayerMove(roomCode, currentActor.color, selectedTokenIdx);
      }, 450);
    }
  }, 400);
}

// --- CORE GAME ENGINE MOVE DISPATCHER ---

/**
 * Handles validation, movement execution, token capturing,
 * bonus calculation, win checking, and turn switching.
 */
function executePlayerMove(roomCode, playerColor, tokenIndex) {
  const room = rooms[roomCode];
  if (!room || !room.gameStarted || room.currentRoll === 0) return;

  const activePlayer = room.players[room.turnIndex];
  if (!activePlayer || activePlayer.color !== playerColor) return;

  const tokens = room.tokens[playerColor];
  const targetToken = tokens[tokenIndex];
  if (!targetToken) return;

  const roll = room.currentRoll;
  const fromStep = targetToken.step;
  let toStep = fromStep;
  let isValidMove = false;
  let bonusTurn = (roll === 6);
  let eventType = 'step';
  let capturedInfo = null;

  // Scenario 1: Releasing from Base Yard
  if (fromStep === -1 && roll === 6) {
    targetToken.step = 0;
    toStep = 0;
    isValidMove = true;
    bonusTurn = true;
    eventType = 'out';
  }
  // Scenario 2: Advancing along the path
  else if (fromStep !== -1 && fromStep + roll <= 56) {
    toStep = fromStep + roll;
    targetToken.step = toStep;
    isValidMove = true;

    // Sub-scenario: Token reached Home Center
    if (toStep === 56) {
      bonusTurn = true;
      eventType = 'home';
    }
    // Sub-scenario: On main perimeter track (evaluate possible capture)
    else if (toStep < 51) {
      const myGlobalPos = getGlobalTrackIndex(playerColor, toStep);
      const isTargetSafe = isTrackIndexSafe(myGlobalPos);

      if (!isTargetSafe) {
        for (const rival of room.players) {
          if (rival.color !== playerColor && !room.winners.includes(rival.color)) {
            const rivalTokens = room.tokens[rival.color];
            rivalTokens.forEach((otherTok, oIdx) => {
              if (otherTok.step >= 0 && otherTok.step < 51) {
                const rivalGlobalPos = getGlobalTrackIndex(rival.color, otherTok.step);
                if (rivalGlobalPos === myGlobalPos) {
                  // Capture successful
                  capturedInfo = {
                    color: rival.color,
                    index: oIdx,
                    fromStep: otherTok.step
                  };
                  otherTok.step = -1; // Sent back to base yard
                  bonusTurn = true;
                  eventType = 'kill';
                }
              }
            });
          }
        }
      }
    }
  }

  if (!isValidMove) return;

  // Clear active dice roll state
  room.currentRoll = 0;

  // Check if current player has completed all 4 tokens
  const isPlayerComplete = hasPlayerCompletedAllTokens(room.tokens[playerColor]);
  if (isPlayerComplete && !room.winners.includes(playerColor)) {
    room.winners.push(playerColor);
    bonusTurn = false; // Winning move forfeits additional bonus roll

    io.to(roomCode).emit('playerRanked', {
      color: playerColor,
      name: activePlayer.name,
      rank: room.winners.length
    });
  }

  // Check for GameOver: only 1 active unfinished player left
  const activeRemainingPlayers = room.players.filter(p => !room.winners.includes(p.color));
  if (activeRemainingPlayers.length <= 1) {
    room.gameStarted = false;
    const designatedLoser = activeRemainingPlayers[0] || null;

    io.to(roomCode).emit('tokenMoved', {
      tokens: room.tokens,
      activeColor: playerColor,
      eventType: eventType,
      tokenIndex: tokenIndex,
      fromStep: fromStep,
      toStep: toStep,
      moveColor: playerColor,
      bonus: false,
      capturedInfo: capturedInfo
    });

    setTimeout(() => {
      io.to(roomCode).emit('gameOver', {
        winners: room.winners.map(c => room.players.find(p => p.color === c)),
        loser: designatedLoser
      });
      // Clean room memory after match finishes
      delete rooms[roomCode];
    }, 1200);
    return;
  }

  // Turn rotation logic
  if (!bonusTurn || isPlayerComplete) {
    room.consecutiveSixes = 0;
    room.turnIndex = determineNextActivePlayerIndex(room);
  }

  const nextColorToPlay = room.players[room.turnIndex].color;

  io.to(roomCode).emit('tokenMoved', {
    tokens: room.tokens,
    activeColor: nextColorToPlay,
    eventType: eventType,
    tokenIndex: tokenIndex,
    fromStep: fromStep,
    toStep: toStep,
    moveColor: playerColor,
    bonus: bonusTurn,
    capturedInfo: capturedInfo
  });

  // If next actor is an AI bot, trigger turn immediately
  triggerBotTurn(roomCode);
}

// --- SOCKET.IO EVENT ROUTER ---

io.on('connection', (socket) => {

  /**
   * 1. 1v1 FAST PLAY VS COMPUTER (AI)
   * Red (Human) vs Yellow (Computer Bot)
   */
  socket.on('createBotGame', ({ playerName }) => {
    const rawName = (playerName || '').trim();
    const displayName = rawName.length > 0 ? rawName : 'Player 1';
    const roomCode = crypto.randomInt(1000, 9999).toString();

    rooms[roomCode] = {
      roomCode: roomCode,
      hostId: socket.id,
      gameStarted: true,
      consecutiveSixes: 0,
      turnIndex: 0,
      currentRoll: 0,
      winners: [],
      players: [
        { id: socket.id, name: displayName, color: 'red', isBot: false },
        { id: 'bot_yellow', name: 'Computer (Yellow)', color: 'yellow', isBot: true }
      ],
      tokens: {
        red: createInitialTokenSet(),
        yellow: createInitialTokenSet(),
        green: createInitialTokenSet(),
        blue: createInitialTokenSet()
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

  /**
   * 2. CREATE MULTIPLAYER ROOM (Lobby Phase)
   */
  socket.on('createRoom', ({ playerName }) => {
    const rawName = (playerName || '').trim();
    if (!rawName) {
      socket.emit('gameError', 'Kripya apna naam likhein!');
      return;
    }

    const roomCode = crypto.randomInt(1000, 9999).toString();

    rooms[roomCode] = {
      roomCode: roomCode,
      hostId: socket.id,
      gameStarted: false,
      consecutiveSixes: 0,
      turnIndex: 0,
      currentRoll: 0,
      winners: [],
      players: [
        { id: socket.id, name: rawName, color: 'red', isBot: false }
      ],
      tokens: {
        red: createInitialTokenSet(),
        green: createInitialTokenSet(),
        yellow: createInitialTokenSet(),
        blue: createInitialTokenSet()
      }
    };

    socket.join(roomCode);
    socket.roomCode = roomCode;
    socket.playerColor = 'red';

    socket.emit('roomCreated', {
      roomCode: roomCode,
      myColor: 'red',
      isHost: true,
      players: rooms[roomCode].players
    });
  });

  /**
   * 3. JOIN MULTIPLAYER ROOM (Supports 2 to 4 Players)
   */
  socket.on('joinRoom', ({ playerName, roomCode }) => {
    const rawName = (playerName || '').trim();
    const targetCode = (roomCode || '').trim().toUpperCase();

    if (!rawName) {
      socket.emit('gameError', 'Kripya apna naam likhein!');
      return;
    }
    if (!targetCode) {
      socket.emit('gameError', 'Kripya 4-digit Room Code daalein!');
      return;
    }

    const room = rooms[targetCode];
    if (!room) {
      socket.emit('gameError', 'Yeh Room Code maujood nahi hai ya match khatam ho chuka hai!');
      return;
    }
    if (room.gameStarted) {
      socket.emit('gameError', 'Game pehle se shuru ho chuka hai!');
      return;
    }
    if (room.players.length >= 4) {
      socket.emit('gameError', 'Room pehle se full hai (Maximum 4 Players)!');
      return;
    }

    // Assign color sequentially: 0->red, 1->green, 2->yellow, 3->blue
    const assignedColor = BOARD_COLORS[room.players.length];
    const newPlayer = {
      id: socket.id,
      name: rawName,
      color: assignedColor,
      isBot: false
    };

    room.players.push(newPlayer);
    socket.join(targetCode);
    socket.roomCode = targetCode;
    socket.playerColor = assignedColor;

    socket.emit('roomJoinedSuccess', {
      roomCode: targetCode,
      myColor: assignedColor,
      isHost: false,
      players: room.players
    });

    io.to(targetCode).emit('lobbyUpdate', {
      players: room.players,
      hostId: room.hostId
    });
  });

  /**
   * 4. START MULTIPLAYER GAME (Host Only)
   */
  socket.on('startGame', () => {
    const room = rooms[socket.roomCode];
    if (!room) return;

    if (room.hostId !== socket.id) {
      socket.emit('gameError', 'Sirf Host game shuru kar sakta hai!');
      return;
    }
    if (room.players.length < 2) {
      socket.emit('gameError', 'Khel shuru karne ke liye kam se kam 2 players hona zaroori hai!');
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

  /**
   * 5. HUMAN DICE ROLL HANDLER
   */
  socket.on('rollDice', () => {
    const room = rooms[socket.roomCode];
    if (!room || !room.gameStarted || room.currentRoll !== 0) return;

    const activePlayer = room.players[room.turnIndex];
    if (!activePlayer || activePlayer.id !== socket.id) return;

    // Safety guard: Winner cannot roll
    if (room.winners.includes(activePlayer.color)) {
      room.turnIndex = determineNextActivePlayerIndex(room);
      io.to(socket.roomCode).emit('turnChanged', {
        activeColor: room.players[room.turnIndex].color,
        tokens: room.tokens
      });
      return;
    }

    const roll = getFairCryptoRoll();
    room.currentRoll = roll;

    // 3 Sixes in a row evaluation
    if (roll === 6) {
      room.consecutiveSixes = (room.consecutiveSixes || 0) + 1;
    } else {
      room.consecutiveSixes = 0;
    }

    if (room.consecutiveSixes === 3) {
      room.consecutiveSixes = 0;
      room.currentRoll = 0;
      room.turnIndex = determineNextActivePlayerIndex(room);

      io.to(socket.roomCode).emit('diceRolled', {
        roll: 6,
        activeColor: activePlayer.color,
        canMove: false,
        message: 'Lagatar 3 bar 6 aaya! Chance cancel ho gayi.'
      });

      setTimeout(() => {
        const postCancelRoom = rooms[socket.roomCode];
        if (!postCancelRoom || !postCancelRoom.gameStarted) return;
        io.to(socket.roomCode).emit('turnChanged', {
          activeColor: postCancelRoom.players[postCancelRoom.turnIndex].color,
          tokens: postCancelRoom.tokens
        });
        triggerBotTurn(socket.roomCode);
      }, 900);
      return;
    }

    const playerTokens = room.tokens[activePlayer.color];
    const legalMoves = getMovableTokenIndices(playerTokens, roll);
    const canMove = legalMoves.length > 0;

    io.to(socket.roomCode).emit('diceRolled', {
      roll: roll,
      activeColor: activePlayer.color,
      canMove: canMove
    });

    // Auto-advance turn if no moves are available
    if (!canMove) {
      setTimeout(() => {
        const stalledRoom = rooms[socket.roomCode];
        if (!stalledRoom || !stalledRoom.gameStarted) return;

        stalledRoom.currentRoll = 0;
        stalledRoom.consecutiveSixes = 0;
        stalledRoom.turnIndex = determineNextActivePlayerIndex(stalledRoom);

        io.to(socket.roomCode).emit('turnChanged', {
          activeColor: stalledRoom.players[stalledRoom.turnIndex].color,
          tokens: stalledRoom.tokens
        });
        triggerBotTurn(socket.roomCode);
      }, 800);
    }
  });

  /**
   * 6. HUMAN TOKEN MOVE DISPATCHER
   */
  socket.on('moveToken', ({ tokenIndex }) => {
    if (typeof tokenIndex !== 'number' || tokenIndex < 0 || tokenIndex > 3) return;
    executePlayerMove(socket.roomCode, socket.playerColor, tokenIndex);
  });

  /**
   * 7. DISCONNECT & CLEANUP
   */
  socket.on('disconnect', () => {
    const room = rooms[socket.roomCode];
    if (!room) return;

    // Filter disconnected player
    room.players = room.players.filter(p => p.id !== socket.id);

    // If room is empty, clear from memory
    if (room.players.length === 0) {
      delete rooms[socket.roomCode];
      return;
    }

    // Reassign host if host disconnected
    if (room.hostId === socket.id) {
      room.hostId = room.players[0].id;
    }

    // If only 1 player remains while game is active, end game
    if (room.gameStarted && room.players.filter(p => !p.isBot).length === 0) {
      delete rooms[socket.roomCode];
      return;
    }

    io.to(socket.roomCode).emit('lobbyUpdate', {
      players: room.players,
      hostId: room.hostId
    });
  });
});

// --- SERVER BOOTSTRAP ---

server.listen(PORT, () => {
  console.log(`====================================================`);
  console.log(`🚀 LUDO MULTIPLAYER & SMART AI SERVER IS RUNNING`);
  console.log(`📡 Listening on Port: ${PORT}`);
  console.log(`🔒 Fair Dice RNG: Crypto.randomInt Active`);
  console.log(`====================================================`);
});
