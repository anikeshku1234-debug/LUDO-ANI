/**
 * ============================================================================
 * LUDO ROYALE - PURE INSTANT SYNC (NO STALE MEMORY LOCKS)
 * ============================================================================
 */

(function () {
  'use strict';

  // Purane atke huye rooms ko hamesha ke liye clear karein
  localStorage.removeItem('ludo_active_room');

  let currentUser = JSON.parse(localStorage.getItem('ludo_user') || 'null');
  let currentRoomCode = null;
  let myColor = 'red';
  let isBoardLaunched = false;
  let pollingInterval = null;
  let processedActionIds = new Set();

  const SoundManager = {
    ctx: null,
    enabled: true,
    init() {
      if (!this.ctx) {
        const AudioClass = window.AudioContext || window.webkitAudioContext;
        this.ctx = new AudioClass();
      }
      if (this.ctx.state === 'suspended') this.ctx.resume();
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
        osc.connect(gain); gain.connect(this.ctx.destination);
        osc.start(now + i * 0.05); osc.stop(now + i * 0.05 + 0.04);
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
      osc.connect(gain); gain.connect(this.ctx.destination);
      osc.start(now); osc.stop(now + 0.065);
    },
    playReleaseYes() {
      if (!this.enabled || !this.ctx) return;
      const now = this.ctx.currentTime;
      [523.25, 659.25, 783.99, 1046.50].forEach((f, idx) => {
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = 'square';
        osc.frequency.setValueAtTime(f, now + idx * 0.055);
        gain.gain.setValueAtTime(0.16, now + idx * 0.055);
        gain.gain.exponentialRampToValueAtTime(0.01, now + idx * 0.055 + 0.16);
        osc.connect(gain); gain.connect(this.ctx.destination);
        osc.start(now + idx * 0.055); osc.stop(now + idx * 0.055 + 0.16);
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
      osc.connect(gain); gain.connect(this.ctx.destination);
      osc.start(now); osc.stop(now + 0.48);
    },
    playTwinkleChime() {
      if (!this.enabled || !this.ctx) return;
      const now = this.ctx.currentTime;
      [1046.50, 1318.51, 1567.98, 2093.00, 2637.02].forEach((freq, i) => {
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, now + i * 0.065);
        gain.gain.setValueAtTime(0.22, now + i * 0.065);
        gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.065 + 0.32);
        osc.connect(gain); gain.connect(this.ctx.destination);
        osc.start(now + i * 0.065); osc.stop(now + i * 0.065 + 0.32);
      });
    },
    playVictory() {
      if (!this.enabled || !this.ctx) return;
      const now = this.ctx.currentTime;
      [440, 554.37, 659.25, 880].forEach((f, idx) => {
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(f, now + idx * 0.12);
        gain.gain.setValueAtTime(0.3, now + idx * 0.12);
        gain.gain.exponentialRampToValueAtTime(0.01, now + idx * 0.12 + 0.4);
        osc.connect(gain); gain.connect(this.ctx.destination);
        osc.start(now + idx * 0.12); osc.stop(now + idx * 0.12 + 0.4);
      });
    }
  };

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

    init(configuredPlayers, isOnlineMode = false, myOnlineClr = 'red') {
      this.isOnline = isOnlineMode;
      this.myOnlineColor = myOnlineClr;
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
          { id: 0, step: -1 }, { id: 1, step: -1 }, { id: 2, step: -1 }, { id: 3, step: -1 }
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
      clearTokenHighlights();

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

  function setTokenPosition(tokenEl, color, step, id) {
    if (step === -1) {
      const spot = document.querySelector(`.base-spot[data-color="${color}"][data-index="${id}"]`);
      if (spot) {
        spot.appendChild(tokenEl);
        tokenEl.style.top = '50%';
        tokenEl.style.left = '50%';
      }
    } else {
      const v = getVisualCoordsForStep(color, step);
      const cell = document.getElementById(`cell-${v.row}-${v.col}`);
      if (cell) {
        cell.appendChild(tokenEl);
        tokenEl.style.top = '50%';
        tokenEl.style.left = '50%';
      }
    }
  }

  function renderTokensLayer() {
    document.querySelectorAll('.ludo-token').forEach(el => el.remove());

    ['red', 'green', 'yellow', 'blue'].forEach(color => {
      const pTokens = GameState.tokens[color];
      if (!pTokens) return;

      pTokens.forEach(t => {
        const tokenEl = document.createElement('div');
        tokenEl.className = `ludo-token token-${color}`;
        tokenEl.id = `token-${color}-${t.id}`;
        tokenEl.dataset.color = color;
        tokenEl.dataset.id = t.id;

        setTokenPosition(tokenEl, color, t.step, t.id);
        tokenEl.addEventListener('click', onTokenClicked);
      });
    });
  }

  function updateVisualTokensPositions() {
    ['red', 'green', 'yellow', 'blue'].forEach(color => {
      const pTokens = GameState.tokens[color];
      if (!pTokens) return;

      pTokens.forEach(t => {
        const el = document.getElementById(`token-${color}-${t.id}`);
        if (el) {
          setTokenPosition(el, color, t.step, t.id);
        }
      });
    });
  }

  async function animateTokenSteps(color, tokenId, fromStep, toStep) {
    const tokenEl = document.getElementById(`token-${color}-${tokenId}`);
    if (!tokenEl) return;
    for (let s = fromStep + 1; s <= toStep; s++) {
      await new Promise(res => setTimeout(res, 130));
      SoundManager.playStepPuk();
      setTokenPosition(tokenEl, color, s, tokenId);
    }
  }

  async function animateTokenReverseReturn(color, tokenId, fromStep) {
    const tokenEl = document.getElementById(`token-${color}-${tokenId}`);
    if (!tokenEl) return;
    for (let s = fromStep - 1; s >= 0; s--) {
      await new Promise(res => setTimeout(res, 50));
      setTokenPosition(tokenEl, color, s, tokenId);
    }
    await new Promise(res => setTimeout(res, 70));
    setTokenPosition(tokenEl, color, -1, tokenId);
  }

  function broadcastOnlineAction(action) {
    if (!currentRoomCode) return;
    fetch('/api/send-action', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ roomCode: currentRoomCode, action: action })
    }).catch(e => console.warn('Sync error:', e));
  }

  async function onRollDiceTriggered() {
    if (GameState.isRolling || GameState.isAnimating) return;
    const currentPlayer = GameState.getCurrentPlayer();
    if (!currentPlayer) return;

    if (GameState.isOnline && currentPlayer.color !== myColor) return;

    const finalRoll = Math.floor(Math.random() * 6) + 1;
    applyDiceRoll(finalRoll);

    if (GameState.isOnline) {
      broadcastOnlineAction({ type: 'DICE_ROLLED', roll: finalRoll, color: currentPlayer.color });
    }
  }

  async function applyDiceRoll(finalRoll) {
    GameState.isRolling = true;
    setDiceInteractionEnabled(false);
    clearTokenHighlights();

    SoundManager.playDiceRattle();
    const diceEl = document.getElementById('dice-3d-box');
    diceEl.className = 'dice-cube rolling-3d';

    await new Promise(res => setTimeout(res, 800));

    diceEl.className = `dice-cube show-${finalRoll}`;
    GameState.diceValue = finalRoll;
    GameState.isRolling = false;

    if (finalRoll === 6) GameState.consecutiveSixes++;
    else GameState.consecutiveSixes = 0;

    if (GAME_RULES.THREE_SIX_PENALTY && GameState.consecutiveSixes === 3) {
      showTurnNotification("3 Consecutive 6s! Turn Cancelled");
      await new Promise(res => setTimeout(res, 850));
      GameState.advanceTurn();
      if (GameState.isOnline) broadcastOnlineAction({ type: 'TURN_PASS' });
      syncUIWithTurn();
      return;
    }

    const currentPlayer = GameState.getCurrentPlayer();
    const legalTokenIds = GameState.getLegalMoves(currentPlayer.color, finalRoll);

    if (legalTokenIds.length === 0) {
      showTurnNotification("No Moves Available");
      await new Promise(res => setTimeout(res, 750));
      GameState.advanceTurn();
      if (GameState.isOnline) broadcastOnlineAction({ type: 'TURN_PASS' });
      syncUIWithTurn();
    } else if (legalTokenIds.length === 1) {
      highlightMovableTokens(currentPlayer.color, legalTokenIds);
      await new Promise(res => setTimeout(res, 400));
      clearTokenHighlights();
      executeMove(currentPlayer.color, legalTokenIds[0]);
    } else {
      highlightMovableTokens(currentPlayer.color, legalTokenIds);
      showTurnNotification("Select a Token to Move");
    }
  }

  function onTokenClicked(e) {
    if (GameState.isRolling || GameState.isAnimating || !GameState.diceValue) return;

    const color = e.currentTarget.dataset.color;
    const id = parseInt(e.currentTarget.dataset.id, 10);
    const currentPlayer = GameState.getCurrentPlayer();

    if (!currentPlayer || color !== currentPlayer.color) return;
    if (GameState.isOnline && color !== myColor) return;

    const legalTokens = GameState.getLegalMoves(color, GameState.diceValue);
    if (!legalTokens.includes(id)) return;

    clearTokenHighlights();
    executeMove(color, id);
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
      const tokenEl = document.getElementById(`token-${color}-${tokenId}`);
      setTokenPosition(tokenEl, color, 0, tokenId);
      await new Promise(res => setTimeout(res, 250));
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

    if (GameState.isOnline && color === myColor) {
      broadcastOnlineAction({
        type: 'TOKEN_MOVED',
        color: color,
        tokenId: tokenId,
        toStep: token.step,
        bonusTurn: grantBonus
      });
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
    document.getElementById('badge-pin-icon').className = `pin-sample token-${p.color}`;

    const isMyBaari = !GameState.isOnline || (p.color === myColor);
    document.getElementById('footer-player-status').innerText = isMyBaari ? 'ROLL THE DICE' : 'WAITING FOR OPPONENT...';
    setDiceInteractionEnabled(isMyBaari);
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

  function launchGameBoard(configuredPlayers, isOnlineMode = false, myOnlineClr = 'red') {
    if (isBoardLaunched) return;
    isBoardLaunched = true;

    ['red', 'green', 'yellow', 'blue'].forEach(c => {
      const label = document.getElementById(`label-${c}`);
      const p = configuredPlayers.find(x => x.color === c);
      if (p) label.innerText = p.name;
      else label.innerText = c.toUpperCase();
    });

    document.getElementById('hud-room-display').innerText = isOnlineMode ? `ROOM: ${currentRoomCode}` : 'PASS & PLAY';
    GameState.init(configuredPlayers, isOnlineMode, myOnlineClr);
    document.getElementById('lobby-screen').style.display = 'none';
    document.getElementById('game-screen').style.display = 'flex';

    buildBoardGrid();
    renderTokensLayer();
    syncUIWithTurn();
  }

  // REALTIME STATE POLLING (350MS RESILIENT SYNC)
  function startStatePolling(roomCode) {
    if (pollingInterval) clearInterval(pollingInterval);
    pollingInterval = setInterval(async () => {
      try {
        const res = await fetch(`/api/poll/${roomCode}`);
        const data = await res.json();
        if (!data.success) return;

        // Lobby Sync (Host activates Start Game)
        if (!isBoardLaunched && !data.gameStarted) {
          if (data.players.length >= 2 && myColor === 'red') {
            const btn = document.getElementById('btn-create-room');
            btn.innerText = `▶ START GAME (${data.players[1].name} Ready!)`;
            btn.disabled = false;
            btn.classList.remove('btn-secondary');
            btn.classList.add('btn-primary');
            btn.onclick = () => {
              btn.disabled = true;
              fetch('/api/start-game', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ roomCode: roomCode })
              });
            };
          }
        }

        // Synchronous Board Launcher
        if (!isBoardLaunched && data.gameStarted) {
          launchGameBoard(data.players, true, myColor);
          if (data.tokens) {
            ['red', 'yellow'].forEach(c => {
              if (data.tokens[c]) {
                data.tokens[c].forEach((st, idx) => {
                  if (GameState.tokens[c] && GameState.tokens[c][idx]) {
                    GameState.tokens[c][idx].step = st.step;
                  }
                });
              }
            });
            updateVisualTokensPositions();
          }
        }

        // Live Remote Actions Synchronizer
        if (data.actions && data.actions.length > 0) {
          for (let act of data.actions) {
            if (!processedActionIds.has(act.id)) {
              processedActionIds.add(act.id);

              if (act.type === 'START_MATCH') {
                launchGameBoard(act.players, true, myColor);
              } else if (act.type === 'DICE_ROLLED') {
                if (GameState.getCurrentPlayer().color !== myColor) {
                  applyDiceRoll(act.roll);
                }
              } else if (act.type === 'TOKEN_MOVED') {
                if (act.color !== myColor) {
                  executeMove(act.color, act.tokenId);
                }
              } else if (act.type === 'TURN_PASS') {
                if (GameState.getCurrentPlayer().color !== myColor) {
                  GameState.advanceTurn();
                  syncUIWithTurn();
                }
              }
            }
          }
        }
      } catch (err) {}
    }, 350);
  }

  // Pass & Play Mode
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

  // USER AUTHENTICATION UI
  function updateAuthHeaderUI() {
    let authBox = document.getElementById('user-profile-badge');
    if (!authBox) {
      authBox = document.createElement('div');
      authBox.id = 'user-profile-badge';
      authBox.style = "position:absolute; top:12px; right:12px; display:flex; align-items:center; gap:8px; z-index:100;";
      document.getElementById('lobby-screen').appendChild(authBox);
    }

    if (currentUser) {
      authBox.innerHTML = `
        <div style="background:#1e293b; border:1px solid #38bdf8; padding:6px 12px; border-radius:20px; font-size:12px; font-weight:bold; color:#38bdf8;">
          👤 ${currentUser.name}
        </div>
        <button id="btn-logout-user" style="background:#ef4444; color:white; border:none; border-radius:8px; padding:6px 10px; font-size:11px; cursor:pointer;">Logout</button>
      `;
      document.getElementById('host-player-name').value = currentUser.name;
      document.getElementById('join-player-name').value = currentUser.name;
      document.getElementById('btn-logout-user').onclick = () => {
        localStorage.removeItem('ludo_user');
        currentUser = null;
        updateAuthHeaderUI();
      };
    } else {
      authBox.innerHTML = `
        <button id="btn-open-login" style="background:#0284c7; color:white; border:none; border-radius:20px; padding:6px 14px; font-size:12px; font-weight:bold; cursor:pointer; box-shadow:0 2px 6px rgba(0,0,0,0.4);">
          🔑 Login / Sign Up
        </button>
      `;
      document.getElementById('btn-open-login').onclick = () => {
        document.getElementById('auth-modal').style.display = 'flex';
      };
    }
  }

  function injectAuthModal() {
    if (document.getElementById('auth-modal')) return;
    const modal = document.createElement('div');
    modal.id = 'auth-modal';
    modal.className = 'modal-backdrop';
    modal.style.display = 'none';
    modal.innerHTML = `
      <div class="modal-dialog" style="max-width:340px;">
        <h2 id="auth-title">User Login</h2>
        <div style="display:flex; flex-direction:column; gap:8px; margin: 15px 0;">
          <input type="text" id="auth-name" placeholder="Apna Naam (Only for Sign Up)" style="display:none; padding:10px; background:#0f172a; border:1px solid #334155; color:white; border-radius:8px;">
          <input type="email" id="auth-email" placeholder="Email Address" style="padding:10px; background:#0f172a; border:1px solid #334155; color:white; border-radius:8px;">
          <input type="password" id="auth-pass" placeholder="Password" style="padding:10px; background:#0f172a; border:1px solid #334155; color:white; border-radius:8px;">
        </div>
        <button class="btn btn-primary btn-large" id="btn-auth-submit">LOGIN</button>
        <p id="toggle-auth-mode" style="margin-top:12px; font-size:12px; color:#38bdf8; cursor:pointer;">Naya account banayein (Sign Up)</p>
        <button class="btn btn-secondary" id="btn-auth-close" style="margin-top:8px; width:100%;">Close</button>
      </div>
    `;
    document.body.appendChild(modal);

    let isSignUpMode = false;
    document.getElementById('toggle-auth-mode').onclick = () => {
      isSignUpMode = !isSignUpMode;
      document.getElementById('auth-title').innerText = isSignUpMode ? 'Naya Account Banayein' : 'User Login';
      document.getElementById('auth-name').style.display = isSignUpMode ? 'block' : 'none';
      document.getElementById('btn-auth-submit').innerText = isSignUpMode ? 'SIGN UP' : 'LOGIN';
      document.getElementById('toggle-auth-mode').innerText = isSignUpMode ? 'Account hai? Login karein' : 'Naya account banayein (Sign Up)';
    };

    document.getElementById('btn-auth-close').onclick = () => {
      modal.style.display = 'none';
    };

    document.getElementById('btn-auth-submit').onclick = async () => {
      const email = document.getElementById('auth-email').value.trim();
      const password = document.getElementById('auth-pass').value.trim();
      const name = document.getElementById('auth-name').value.trim();

      const endpoint = isSignUpMode ? '/api/auth/signup' : '/api/auth/login';
      const bodyData = isSignUpMode ? { name, email, password } : { email, password };

      try {
        const res = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(bodyData)
        });
        const data = await res.json();
        if (data.success) {
          currentUser = data.user;
          localStorage.setItem('ludo_user', JSON.stringify(currentUser));
          modal.style.display = 'none';
          updateAuthHeaderUI();
          alert(`Swagat hai, ${currentUser.name}!`);
        } else {
          alert(data.message);
        }
      } catch (e) {
        alert('Server connection error.');
      }
    };
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

    // CREATE ROOM
    document.getElementById('btn-create-room').addEventListener('click', async () => {
      SoundManager.init();
      const btn = document.getElementById('btn-create-room');
      const name = (currentUser ? currentUser.name : document.getElementById('host-player-name').value.trim()) || 'Host Player';
      const email = currentUser ? currentUser.email : '';
      btn.innerText = 'Creating Room...';
      btn.disabled = true;

      try {
        const res = await fetch('/api/create-room', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ hostName: name, userEmail: email })
        });
        const data = await res.json();
        if (data.success) {
          currentRoomCode = data.roomCode;
          myColor = 'red';
          document.getElementById('display-room-code').innerText = data.roomCode;
          document.getElementById('created-code-box').style.display = 'block';
          btn.innerText = 'Waiting for Friend to Join...';
          startStatePolling(data.roomCode);
        }
      } catch (err) {
        alert('Server se connect nahi ho paya.');
        btn.innerText = 'CREATE ROOM';
        btn.disabled = false;
      }
    });

    // JOIN ROOM
    document.getElementById('btn-join-room').addEventListener('click', async () => {
      SoundManager.init();
      const btn = document.getElementById('btn-join-room');
      const name = (currentUser ? currentUser.name : document.getElementById('join-player-name').value.trim()) || 'Guest Player';
      const email = currentUser ? currentUser.email : '';
      const rawInput = document.getElementById('join-room-code').value || '';
      const code = rawInput.toString().trim().replace(/\s+/g, '');

      if (!code || code.length !== 4) {
        return alert('Kripya sahi 4-digit room code daalein (Jaise: 4821)!');
      }

      btn.innerText = 'Connecting...';
      btn.disabled = true;

      try {
        const res = await fetch('/api/join-room', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ roomCode: code, playerName: name, userEmail: email })
        });
        const data = await res.json();
        if (!data.success) {
          alert(data.message);
          btn.innerText = 'JOIN ROOM';
          btn.disabled = false;
          return;
        }

        currentRoomCode = code;
        myColor = data.color || 'yellow';
        btn.innerText = '✓ Connected! Waiting for Host to Start...';
        startStatePolling(code);
      } catch (err) {
        alert('Server se connect nahi ho paya.');
        btn.innerText = 'JOIN ROOM';
        btn.disabled = false;
      }
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
      isBoardLaunched = false;
      if (pollingInterval) clearInterval(pollingInterval);
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
  }

  window.addEventListener('DOMContentLoaded', () => {
    renderLobbyInputs(selectedCount);
    injectAuthModal();
    setupEventListeners();
    updateAuthHeaderUI();
  });

})();
