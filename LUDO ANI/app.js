/**
 * ============================================================================
 * LUDO ROYALE - COMPLETE CLIENT ENGINE WITH 4-DIGIT INTEGER ROOM SYNC
 * ============================================================================
 */

(function () {
  'use strict';

  // Global socket setup
  const socket = (typeof io !== 'undefined') ? io({ transports: ['polling', 'websocket'] }) : null;

  // 1. SOUND MANAGER (WEB AUDIO SYNTHESIZER)
  const SoundManager = {
    ctx: null,
    enabled: true,

    init() {
      if (!this.ctx) {
        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        this.ctx = new AudioContextClass();
      }
      if (this.ctx.state === 'suspended') {
        this.ctx.resume();
      }
    },

    playDiceRattle() {
      if (!this.enabled || !this.ctx) return;
      const now = this.ctx.currentTime;
      for (let i = 0; i < 7; i++) {
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = 'square';
        osc.frequency.setValueAtTime(120 + Math.random() * 260, now + i * 0.05);
        gain.gain.setValueAtTime(0.18, now + i * 0.05);
        gain.gain.exponentialRampToValueAtTime(0.01, now + i * 0.05 + 0.04);
        osc.connect(gain);
        gain.connect(this.ctx.destination);
        osc.start(now + i * 0.05);
        osc.stop(now + i * 0.05 + 0.04);
      }
    },

    playStepPuk() {
      if (!this.enabled || !this.ctx) return;
      const now = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(320, now);
      osc.frequency.exponentialRampToValueAtTime(70, now + 0.065);
      gain.gain.setValueAtTime(0.35, now);
      gain.gain.exponentialRampToValueAtTime(0.01, now + 0.065);
      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start(now);
      osc.stop(now + 0.065);
    },

    playReleaseYes() {
      if (!this.enabled || !this.ctx) return;
      const now = this.ctx.currentTime;
      const freqs = [523.25, 659.25, 783.99, 1046.50];
      freqs.forEach((f, idx) => {
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = 'square';
        osc.frequency.setValueAtTime(f, now + idx * 0.055);
        gain.gain.setValueAtTime(0.16, now + idx * 0.055);
        gain.gain.exponentialRampToValueAtTime(0.01, now + idx * 0.055 + 0.16);
        osc.connect(gain);
        gain.connect(this.ctx.destination);
        osc.start(now + idx * 0.055);
        osc.stop(now + idx * 0.055 + 0.16);
      });
    },

    playCaptureSuuu() {
      if (!this.enabled || !this.ctx) return;
      const now = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(950, now);
      osc.frequency.exponentialRampToValueAtTime(110, now + 0.48);
      gain.gain.setValueAtTime(0.28, now);
      gain.gain.exponentialRampToValueAtTime(0.01, now + 0.48);
      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start(now);
      osc.stop(now + 0.48);
    },

    playTwinkleChime() {
      if (!this.enabled || !this.ctx) return;
      const now = this.ctx.currentTime;
      const notes = [1046.50, 1318.51, 1567.98, 2093.00, 2637.02];
      notes.forEach((freq, i) => {
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, now + i * 0.065);
        gain.gain.setValueAtTime(0.22, now + i * 0.065);
        gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.065 + 0.32);
        osc.connect(gain);
        gain.connect(this.ctx.destination);
        osc.start(now + i * 0.065);
        osc.stop(now + i * 0.065 + 0.32);
      });
    },

    playVictory() {
      if (!this.enabled || !this.ctx) return;
      const now = this.ctx.currentTime;
      const fanfares = [440, 554.37, 659.25, 880];
      fanfares.forEach((f, idx) => {
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(f, now + idx * 0.12);
        gain.gain.setValueAtTime(0.3, now + idx * 0.12);
        gain.gain.exponentialRampToValueAtTime(0.01, now + idx * 0.12 + 0.4);
        osc.connect(gain);
        gain.connect(this.ctx.destination);
        osc.start(now + idx * 0.12);
        osc.stop(now + idx * 0.12 + 0.4);
      });
    }
  };

  // 2. 15x15 BOARD COORDINATES
  const GLOBAL_TRACK_52 = [
    [13,6],[12,6],[11,6],[10,6],[9,6],[8,5],[8,4],[8,3],[8,2],[8,1],[8,0],[7,0],[6,0],
    [6,1],[6,2],[6,3],[6,4],[6,5],[5,6],[4,6],[3,6],[2,6],[1,6],[0,6],[0,7],[0,8],
    [1,8],[2,8],[3,8],[4,8],[5,8],[6,9],[6,10],[6,11],[6,12],[6,13],[6,14],[7,14],[8,14],
    [8,13],[8,12],[8,11],[8,10],[8,9],[9,8],[10,8],[11,8],[12,8],[13,8],[14,8],[14,7],[14,6]
  ];

  const COLOR_SPECS = {
    red:    { offset: 0 },
    green:  { offset: 13 },
    yellow: { offset: 26 },
    blue:   { offset: 39 }
  };

  const SAFE_CELL_INDICES = [0, 8, 13, 21, 26, 34, 39, 47];

  function getVisualCoordsForStep(color, step) {
    if (step === -1) return null;
    if (step === 56) return { row: 7, col: 7 };

    const spec = COLOR_SPECS[color];
    if (step < 51) {
      const idx = (spec.offset + step) % 52;
      const [r, c] = GLOBAL_TRACK_52[idx];
      return { row: r, col: c };
    } else {
      const dist = step - 51;
      if (color === 'red')    return { row: 13 - dist, col: 7 };
      if (color === 'green')  return { row: 7, col: dist + 1 };
      if (color === 'yellow') return { row: dist + 1, col: 7 };
      if (color === 'blue')   return { row: 7, col: 13 - dist };
    }
  }

  // 3. GAME STATE
  const GAME_RULES = { THREE_SIX_PENALTY: true };

  const GameState = {
    isOnline: false,
    myOnlineColor: 'red',
    players: [],
    activePlayerIndices: [],
    turnPointer: 0,
    diceValue: null,
    consecutiveSixes: 0,
    isRolling: false,
    isAnimating: false,
    winners: [],
    tokens: {},

    init(configuredPlayers, isOnline = false, myOnlineColor = 'red') {
      this.isOnline = isOnline;
      this.myOnlineColor = myOnlineColor;
      this.players = configuredPlayers;
      this.activePlayerIndices = configuredPlayers.map((_, idx) => idx);
      this.turnPointer = 0;
      this.diceValue = null;
      this.consecutiveSixes = 0;
      this.isRolling = false;
      this.isAnimating = false;
      this.winners = [];
      this.tokens = {};

      ['red', 'green', 'yellow', 'blue'].forEach(color => {
        this.tokens[color] = [
          { id: 0, step: -1 },
          { id: 1, step: -1 },
          { id: 2, step: -1 },
          { id: 3, step: -1 }
        ];
      });
    },

    getCurrentPlayer() {
      return this.players[this.activePlayerIndices[this.turnPointer]];
    },

    canTokenMove(token, roll) {
      if (token.step === -1) return roll === 6;
      return (token.step + roll) <= 56;
    },

    getLegalMoves(color, roll) {
      const pTokens = this.tokens[color];
      const valid = [];
      pTokens.forEach(t => {
        if (this.canTokenMove(t, roll)) valid.push(t.id);
      });
      return valid;
    },

    advanceTurn() {
      this.diceValue = null;
      this.consecutiveSixes = 0;

      if (this.winners.length >= this.players.length - 1) return;

      let count = this.activePlayerIndices.length;
      let nextPtr = (this.turnPointer + 1) % count;
      for (let i = 0; i < count; i++) {
        const candidate = this.players[this.activePlayerIndices[nextPtr]];
        if (!this.winners.includes(candidate.color)) {
          this.turnPointer = nextPtr;
          return;
        }
        nextPtr = (nextPtr + 1) % count;
      }
    }
  };

  // 4. UI BUILDER (Exact Reference Matched Stars)
  function buildBoardGrid() {
    const layer = document.getElementById('cells-layer');
    layer.innerHTML = '';

    for (let r = 0; r < 15; r++) {
      for (let c = 0; c < 15; c++) {
        const cell = document.createElement('div');
        cell.className = 'board-cell';
        cell.id = `cell-${r}-${c}`;

        if (c === 7 && r >= 9 && r <= 13) cell.classList.add('cell-red-path');
        if (r === 13 && c === 6) cell.classList.add('cell-red-path');

        if (r === 7 && c >= 1 && c <= 5) cell.classList.add('cell-green-path');
        if (r === 6 && c === 1) cell.classList.add('cell-green-path');

        if (c === 7 && r >= 1 && r <= 5) cell.classList.add('cell-yellow-path');
        if (r === 1 && c === 8) cell.classList.add('cell-yellow-path');

        if (r === 7 && c >= 9 && c <= 13) cell.classList.add('cell-blue-path');
        if (r === 8 && c === 13) cell.classList.add('cell-blue-path');

        // Reference Matched Star Placement
        if ((r === 12 && c === 8) || (r === 8 && c === 2) || (r === 2 && c === 6) || (r === 6 && c === 12)) {
          cell.classList.add('safe-cell-star');
        }

        if (r === 14 && c === 7) cell.innerHTML = '<span class="arrow-symbol">↑</span>';
        if (r === 7 && c === 0) cell.innerHTML = '<span class="arrow-symbol">→</span>';
        if (r === 0 && c === 7) cell.innerHTML = '<span class="arrow-symbol">↓</span>';
        if (r === 7 && c === 14) cell.innerHTML = '<span class="arrow-symbol">←</span>';

        layer.appendChild(cell);
      }
    }
  }

  function getBaseSpotPixelCoords(color, index) {
    const spot = document.querySelector(`.base-spot[data-color="${color}"][data-index="${index}"]`);
    if (!spot) return { top: 0, left: 0 };
    const boardEl = document.getElementById('ludo-board');
    const sRect = spot.getBoundingClientRect();
    const bRect = boardEl.getBoundingClientRect();
    return {
      top: (sRect.top - bRect.top) + sRect.height / 2,
      left: (sRect.left - bRect.left) + sRect.width / 2
    };
  }

  function getCellPixelCoords(row, col) {
    const cell = document.getElementById(`cell-${row}-${col}`);
    const boardEl = document.getElementById('ludo-board');
    const cRect = cell.getBoundingClientRect();
    const bRect = boardEl.getBoundingClientRect();
    return {
      top: (cRect.top - bRect.top) + cRect.height / 2,
      left: (cRect.left - bRect.left) + cRect.width / 2
    };
  }

  function renderTokensLayer() {
    const layer = document.getElementById('tokens-layer');
    layer.innerHTML = '';

    ['red', 'green', 'yellow', 'blue'].forEach(color => {
      const pTokens = GameState.tokens[color];
      if (!pTokens) return;

      pTokens.forEach(t => {
        const tokenEl = document.createElement('div');
        tokenEl.className = `ludo-token token-${color}`;
        tokenEl.id = `token-${color}-${t.id}`;
        tokenEl.dataset.color = color;
        tokenEl.dataset.id = t.id;

        let coords;
        if (t.step === -1) {
          coords = getBaseSpotPixelCoords(color, t.id);
        } else {
          const v = getVisualCoordsForStep(color, t.step);
          coords = getCellPixelCoords(v.row, v.col);
        }

        tokenEl.style.top = `${coords.top}px`;
        tokenEl.style.left = `${coords.left}px`;
        tokenEl.addEventListener('click', onTokenClicked);
        layer.appendChild(tokenEl);
      });
    });
  }

  function updateVisualTokensPositions() {
    ['red', 'green', 'yellow', 'blue'].forEach(color => {
      const pTokens = GameState.tokens[color];
      if (!pTokens) return;

      pTokens.forEach(t => {
        const el = document.getElementById(`token-${color}-${t.id}`);
        if (!el) return;

        let coords;
        if (t.step === -1) {
          coords = getBaseSpotPixelCoords(color, t.id);
        } else {
          const v = getVisualCoordsForStep(color, t.step);
          coords = getCellPixelCoords(v.row, v.col);
        }
        el.style.top = `${coords.top}px`;
        el.style.left = `${coords.left}px`;
      });
    });
  }

  // 5. ANIMATIONS (Acoustic Cell-by-cell Puk & Suuu)
  async function animateTokenSteps(color, tokenId, fromStep, toStep) {
    const tokenEl = document.getElementById(`token-${color}-${tokenId}`);
    if (!tokenEl) return;

    for (let s = fromStep + 1; s <= toStep; s++) {
      await new Promise(resolve => setTimeout(resolve, 140));
      SoundManager.playStepPuk();
      const v = getVisualCoordsForStep(color, s);
      const coords = getCellPixelCoords(v.row, v.col);
      tokenEl.style.top = `${coords.top}px`;
      tokenEl.style.left = `${coords.left}px`;
    }
  }

  async function animateTokenReverseReturn(color, tokenId, fromStep) {
    const tokenEl = document.getElementById(`token-${color}-${tokenId}`);
    if (!tokenEl) return;

    for (let s = fromStep - 1; s >= 0; s--) {
      await new Promise(resolve => setTimeout(resolve, 55));
      const v = getVisualCoordsForStep(color, s);
      const coords = getCellPixelCoords(v.row, v.col);
      tokenEl.style.top = `${coords.top}px`;
      tokenEl.style.left = `${coords.left}px`;
    }

    await new Promise(resolve => setTimeout(resolve, 80));
    const baseCoords = getBaseSpotPixelCoords(color, tokenId);
    tokenEl.style.top = `${baseCoords.top}px`;
    tokenEl.style.left = `${baseCoords.left}px`;
  }

  // 6. GAMEPLAY
  async function onRollDiceTriggered() {
    if (GameState.isRolling || GameState.isAnimating) return;

    const currentPlayer = GameState.getCurrentPlayer();
    if (!currentPlayer) return;

    if (GameState.isOnline && currentPlayer.color !== GameState.myOnlineColor) return;

    const finalRoll = Math.floor(Math.random() * 6) + 1;
    applyDiceRoll(finalRoll);

    if (GameState.isOnline && socket) {
      socket.emit('broadcastGameAction', {
        type: 'DICE_ROLLED',
        roll: finalRoll
      });
    }
  }

  async function applyDiceRoll(finalRoll) {
    GameState.isRolling = true;
    setDiceInteractionEnabled(false);

    SoundManager.playDiceRattle();
    const diceEl = document.getElementById('dice-3d-box');
    diceEl.className = 'dice-cube rolling-3d';

    await new Promise(res => setTimeout(res, 850));

    diceEl.className = `dice-cube show-${finalRoll}`;
    GameState.diceValue = finalRoll;
    GameState.isRolling = false;

    if (finalRoll === 6) {
      GameState.consecutiveSixes++;
    } else {
      GameState.consecutiveSixes = 0;
    }

    if (GAME_RULES.THREE_SIX_PENALTY && GameState.consecutiveSixes === 3) {
      showTurnNotification("3 Consecutive 6s! Turn Cancelled");
      await new Promise(res => setTimeout(res, 900));
      GameState.advanceTurn();
      syncUIWithTurn();
      return;
    }

    const currentPlayer = GameState.getCurrentPlayer();
    const legalTokenIds = GameState.getLegalMoves(currentPlayer.color, finalRoll);

    if (legalTokenIds.length === 0) {
      showTurnNotification("No Moves Available");
      await new Promise(res => setTimeout(res, 750));
      GameState.advanceTurn();
      syncUIWithTurn();
    } else if (legalTokenIds.length === 1) {
      await new Promise(res => setTimeout(res, 350));
      executeMove(currentPlayer.color, legalTokenIds[0]);

      if (GameState.isOnline && socket && currentPlayer.color === GameState.myOnlineColor) {
        socket.emit('broadcastGameAction', {
          type: 'TOKEN_MOVED',
          color: currentPlayer.color,
          tokenId: legalTokenIds[0]
        });
      }
    } else {
      if (!GameState.isOnline || currentPlayer.color === GameState.myOnlineColor) {
        highlightMovableTokens(currentPlayer.color, legalTokenIds);
        showTurnNotification("Select a Token to Move");
      }
    }
  }

  function onTokenClicked(e) {
    if (GameState.isRolling || GameState.isAnimating || !GameState.diceValue) return;

    const color = e.currentTarget.dataset.color;
    const id = parseInt(e.currentTarget.dataset.id, 10);
    const currentPlayer = GameState.getCurrentPlayer();

    if (!currentPlayer || color !== currentPlayer.color) return;
    if (GameState.isOnline && color !== GameState.myOnlineColor) return;

    const legalTokens = GameState.getLegalMoves(color, GameState.diceValue);
    if (!legalTokens.includes(id)) return;

    clearTokenHighlights();
    executeMove(color, id);

    if (GameState.isOnline && socket) {
      socket.emit('broadcastGameAction', {
        type: 'TOKEN_MOVED',
        color: color,
        tokenId: id
      });
    }
  }

  async function executeMove(color, tokenId) {
    GameState.isAnimating = true;
    setDiceInteractionEnabled(false);
    clearTokenHighlights();

    const token = GameState.tokens[color].find(t => t.id === tokenId);
    const roll = GameState.diceValue;
    const fromStep = token.step;
    let grantBonus = (roll === 6);

    if (fromStep === -1 && roll === 6) {
      token.step = 0;
      SoundManager.playReleaseYes();
      const v = getVisualCoordsForStep(color, 0);
      const coords = getCellPixelCoords(v.row, v.col);
      const tokenEl = document.getElementById(`token-${color}-${tokenId}`);
      tokenEl.style.top = `${coords.top}px`;
      tokenEl.style.left = `${coords.left}px`;
      await new Promise(res => setTimeout(res, 280));
    } else {
      const toStep = fromStep + roll;
      await animateTokenSteps(color, tokenId, fromStep, toStep);
      token.step = toStep;

      if (toStep === 56) {
        SoundManager.playTwinkleChime();
        grantBonus = true;
      } else if (toStep < 51) {
        const myGlobalIdx = (COLOR_SPECS[color].offset + toStep) % 52;
        if (!SAFE_CELL_INDICES.includes(myGlobalIdx)) {
          for (const rival of GameState.players) {
            if (rival.color !== color && !GameState.winners.includes(rival.color)) {
              const rivalTokens = GameState.tokens[rival.color];
              for (const rTok of rivalTokens) {
                if (rTok.step >= 0 && rTok.step < 51) {
                  const rGlobal = (COLOR_SPECS[rival.color].offset + rTok.step) % 52;
                  if (rGlobal === myGlobalIdx) {
                    SoundManager.playCaptureSuuu();
                    grantBonus = true;
                    rTok.step = -1;
                    await animateTokenReverseReturn(rival.color, rTok.id, rTok.step >= 0 ? rTok.step : 0);
                  }
                }
              }
            }
          }
        }
      }
    }

    const isPlayerFinished = GameState.tokens[color].every(t => t.step === 56);
    if (isPlayerFinished && !GameState.winners.includes(color)) {
      GameState.winners.push(color);
      grantBonus = false;
      SoundManager.playVictory();
    }

    if (GameState.winners.length >= GameState.players.length - 1) {
      triggerPodiumVictoryModal();
      GameState.isAnimating = false;
      return;
    }

    if (!grantBonus || isPlayerFinished) {
      GameState.advanceTurn();
    }

    GameState.isAnimating = false;
    syncUIWithTurn();
  }

  function highlightMovableTokens(color, tokenIds) {
    clearTokenHighlights();
    tokenIds.forEach(id => {
      const el = document.getElementById(`token-${color}-${id}`);
      if (el) el.classList.add('token-selectable');
    });
  }

  function clearTokenHighlights() {
    document.querySelectorAll('.token-selectable').forEach(el => {
      el.classList.remove('token-selectable');
    });
  }

  function syncUIWithTurn() {
    const p = GameState.getCurrentPlayer();
    if (!p) return;

    const nameEl = document.getElementById('turn-player-name');
    nameEl.innerText = p.name;
    nameEl.style.color = `var(--ludo-${p.color})`;

    document.getElementById('footer-player-title').innerText = p.name;
    document.getElementById('footer-player-status').innerText = 'ROLL THE DICE';
    document.getElementById('badge-pin-icon').className = `pin-sample token-${p.color}`;

    const canRoll = !GameState.isOnline || (p.color === GameState.myOnlineColor);
    setDiceInteractionEnabled(canRoll);
  }

  function setDiceInteractionEnabled(enable) {
    const diceBtn = document.getElementById('btn-roll-dice');
    const arrow = document.getElementById('dice-pointer-arrow');
    diceBtn.disabled = !enable;
    arrow.style.visibility = enable ? 'visible' : 'hidden';
  }

  function showTurnNotification(msg) {
    document.getElementById('footer-player-status').innerText = msg;
  }

  function triggerPodiumVictoryModal() {
    const modal = document.getElementById('victory-modal');
    const title = document.getElementById('winner-celebrate-title');
    const podiumList = document.getElementById('podium-rankings-list');

    const firstWinnerColor = GameState.winners[0];
    const firstWinner = GameState.players.find(p => p.color === firstWinnerColor);
    title.innerText = `${firstWinner ? firstWinner.name.toUpperCase() : 'PLAYER'} WINS!`;

    podiumList.innerHTML = '';
    const medals = ['🥇 1st Place', '🥈 2nd Place', '🥉 3rd Place'];
    GameState.winners.forEach((wColor, idx) => {
      const playerObj = GameState.players.find(p => p.color === wColor);
      const row = document.createElement('div');
      row.className = 'podium-item';
      row.innerHTML = `<span>${medals[idx] || `${idx + 1}th Place`}</span><span style="color:var(--ludo-${wColor})">${playerObj.name}</span>`;
      podiumList.appendChild(row);
    });

    const loser = GameState.players.find(p => !GameState.winners.includes(p.color));
    if (loser) {
      const loserRow = document.createElement('div');
      loserRow.className = 'podium-item';
      loserRow.style.borderColor = '#ef4444';
      loserRow.innerHTML = `<span style="color:#ef4444;">❌ Looser</span><span style="color:var(--ludo-${loser.color})">${loser.name}</span>`;
      podiumList.appendChild(loserRow);
    }

    modal.style.display = 'flex';
  }

  // 7. BOARD LAUNCHER
  function launchGameBoard(configuredPlayers, isOnline = false, myColor = 'red') {
    ['red', 'green', 'yellow', 'blue'].forEach(c => {
      const label = document.getElementById(`label-${c}`);
      const p = configuredPlayers.find(x => x.color === c);
      if (p) {
        label.innerText = p.name;
      } else {
        label.innerText = c.toUpperCase();
      }
    });

    GameState.init(configuredPlayers, isOnline, myColor);
    document.getElementById('lobby-screen').style.display = 'none';
    document.getElementById('game-screen').style.display = 'flex';

    buildBoardGrid();
    renderTokensLayer();
    syncUIWithTurn();
  }

  // 8. PURE SOCKET EVENT HANDLERS (4-Digit Room Handling)
  function setupRoomSocketListeners() {
    if (!socket) return;

    socket.on('roomError', (msg) => {
      alert(msg);
      const btnCreate = document.getElementById('btn-create-room');
      const btnJoin = document.getElementById('btn-join-room');
      btnCreate.innerText = 'CREATE ROOM';
      btnCreate.disabled = false;
      btnJoin.innerText = 'JOIN ROOM';
      btnJoin.disabled = false;
    });

    socket.on('roomCreatedSuccess', (data) => {
      socket.roomCode = data.roomCode;
      socket.playerColor = data.myColor;
      document.getElementById('display-room-code').innerText = data.roomCode;
      document.getElementById('created-code-box').style.display = 'block';

      const btnCreate = document.getElementById('btn-create-room');
      btnCreate.innerText = 'START ONLINE GAME (Waiting for friend...)';
      btnCreate.disabled = false;
      btnCreate.classList.remove('btn-secondary');
      btnCreate.classList.add('btn-primary');
      btnCreate.onclick = () => socket.emit('startOnlineGame');
    });

    socket.on('roomJoinedSuccess', (data) => {
      socket.roomCode = data.roomCode;
      socket.playerColor = data.myColor;
      document.getElementById('created-code-box').style.display = 'block';
      document.getElementById('display-room-code').innerText = data.roomCode;

      const btnJoin = document.getElementById('btn-join-room');
      btnJoin.innerText = '✓ Joined! Waiting for Host...';
      btnJoin.disabled = true;
    });

    socket.on('lobbyPlayerUpdate', (data) => {
      const count = data.players.length;
      document.getElementById('hud-room-display').innerText = `ROOM: ${socket.roomCode} (${count}/4)`;
      const btnCreate = document.getElementById('btn-create-room');
      if (data.hostId === socket.id && count >= 2) {
        btnCreate.innerText = `▶ START ONLINE GAME (${count} Ready)`;
      }
    });

    socket.on('onlineGameStarted', (data) => {
      SoundManager.init();
      document.getElementById('hud-room-display').innerText = `ONLINE: ${socket.roomCode}`;
      launchGameBoard(data.players, true, socket.playerColor || 'red');
    });

    socket.on('receiveGameAction', (action) => {
      if (action.type === 'DICE_ROLLED') {
        applyDiceRoll(action.roll);
      } else if (action.type === 'TOKEN_MOVED') {
        executeMove(action.color, action.tokenId);
      }
    });
  }

  // 9. EVENT LISTENERS
  let selectedCount = 3;

  function renderLobbyInputs(count) {
    const container = document.getElementById('player-inputs-container');
    container.innerHTML = '';
    const colors = (count === 2) ? ['red', 'yellow'] : ['red', 'green', 'yellow', 'blue'].slice(0, count);

    colors.forEach((c, i) => {
      const row = document.createElement('div');
      row.className = 'input-row';
      row.innerHTML = `
        <div class="input-dot" style="background:var(--ludo-${c});"></div>
        <input type="text" id="name-input-${c}" value="Player ${i + 1}" placeholder="${c.toUpperCase()} Name" maxlength="12" />
      `;
      container.appendChild(row);
    });
  }

  function startPassAndPlayMatch() {
    SoundManager.init();
    const colors = (selectedCount === 2) ? ['red', 'yellow'] : ['red', 'green', 'yellow', 'blue'].slice(0, selectedCount);
    const configuredPlayers = colors.map(c => {
      const inp = document.getElementById(`name-input-${c}`);
      return {
        id: `local_${c}`,
        color: c,
        name: inp ? inp.value.trim() || c.toUpperCase() : c.toUpperCase()
      };
    });
    launchGameBoard(configuredPlayers, false);
  }

  function setupEventListeners() {
    document.getElementById('btn-audio-init').addEventListener('click', () => {
      SoundManager.init();
      document.getElementById('audio-unlock-overlay').style.display = 'none';
    });

    document.querySelectorAll('.tab-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
        e.target.classList.add('active');
        document.getElementById(e.target.dataset.tab).classList.add('active');
      });
    });

    document.querySelectorAll('.btn-count').forEach(btn => {
      btn.addEventListener('click', (e) => {
        document.querySelectorAll('.btn-count').forEach(b => b.classList.remove('active'));
        e.target.classList.add('active');
        selectedCount = parseInt(e.target.dataset.count, 10);
        renderLobbyInputs(selectedCount);
      });
    });

    document.getElementById('btn-start-passplay').addEventListener('click', startPassAndPlayMatch);

    // 4-DIGIT CREATE ROOM
    document.getElementById('btn-create-room').addEventListener('click', () => {
      if (!socket) return alert('Server connecting... Kripya refresh karein.');
      const btn = document.getElementById('btn-create-room');
      btn.innerText = 'Creating 4-Digit Room...';
      const name = document.getElementById('host-player-name').value.trim() || 'Host Player';
      socket.emit('createRoom', { hostName: name });
    });

    // 4-DIGIT JOIN ROOM
    document.getElementById('btn-join-room').addEventListener('click', () => {
      if (!socket) return alert('Server connecting... Kripya refresh karein.');
      const btn = document.getElementById('btn-join-room');
      const name = document.getElementById('join-player-name').value.trim() || 'Guest Player';
      const rawInput = document.getElementById('join-room-code').value || '';
      const code = rawInput.toString().trim().replace(/\s+/g, '');

      if (!code || code.length !== 4) {
        return alert('Kripya sahi 4-digit numeric room code daalein (Jaise: 5821)!');
      }

      btn.innerText = 'Joining...';
      btn.disabled = true;
      socket.emit('joinRoom', { playerName: name, roomCode: code });
    });

    document.getElementById('btn-roll-dice').addEventListener('click', onRollDiceTriggered);

    document.getElementById('btn-sound-toggle').addEventListener('click', () => {
      SoundManager.enabled = !SoundManager.enabled;
      document.getElementById('btn-sound-toggle').innerText = SoundManager.enabled ? '🔊' : '🔇';
      document.getElementById('toggle-sfx').checked = SoundManager.enabled;
    });

    document.getElementById('btn-settings-open').addEventListener('click', () => {
      document.getElementById('settings-modal').style.display = 'flex';
    });
    document.getElementById('btn-settings-close').addEventListener('click', () => {
      document.getElementById('settings-modal').style.display = 'none';
    });
    document.getElementById('toggle-sfx').addEventListener('change', (e) => {
      SoundManager.enabled = e.target.checked;
      document.getElementById('btn-sound-toggle').innerText = SoundManager.enabled ? '🔊' : '🔇';
    });
    document.getElementById('toggle-three-six').addEventListener('change', (e) => {
      GAME_RULES.THREE_SIX_PENALTY = e.target.checked;
    });

    document.getElementById('btn-confirm-restart').addEventListener('click', () => {
      document.getElementById('settings-modal').style.display = 'none';
      document.getElementById('confirm-modal').style.display = 'flex';
    });
    document.getElementById('btn-modal-cancel').addEventListener('click', () => {
      document.getElementById('confirm-modal').style.display = 'none';
    });
    document.getElementById('btn-modal-yes').addEventListener('click', () => {
      document.getElementById('confirm-modal').style.display = 'none';
      startPassAndPlayMatch();
    });
    document.getElementById('btn-exit-lobby').addEventListener('click', () => {
      document.getElementById('settings-modal').style.display = 'none';
      document.getElementById('game-screen').style.display = 'none';
      document.getElementById('lobby-screen').style.display = 'flex';
    });

    document.getElementById('btn-victory-replay').addEventListener('click', () => {
      document.getElementById('victory-modal').style.display = 'none';
      startPassAndPlayMatch();
    });

    window.addEventListener('resize', () => {
      if (document.getElementById('game-screen').style.display === 'flex') {
        updateVisualTokensPositions();
      }
    });

    setupRoomSocketListeners();
  }

  window.addEventListener('DOMContentLoaded', () => {
    renderLobbyInputs(selectedCount);
    setupEventListeners();
  });

})();
