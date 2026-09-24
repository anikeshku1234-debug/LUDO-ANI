/**
 * ============================================================================
 * LUDO ROYALE - PURE STATE REPLICATION CLIENT (100% VISUAL & TURN SYNC)
 * ============================================================================
 */

(function () {
  'use strict';

  localStorage.removeItem('ludo_active_room');

  let currentRoomCode = null;
  let myColor = 'red';
  let isBoardLaunched = false;
  let pollingInterval = null;
  let lastServerVersion = 0;

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
      for (let i = 0; i < 6; i++) {
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = 'square';
        osc.frequency.setValueAtTime(140 + Math.random() * 250, now + i * 0.05);
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
      osc.frequency.exponentialRampToValueAtTime(70, now + 0.06);
      gain.gain.setValueAtTime(0.35, now);
      gain.gain.exponentialRampToValueAtTime(0.01, now + 0.06);
      osc.connect(gain); gain.connect(this.ctx.destination);
      osc.start(now); osc.stop(now + 0.06);
    },
    playReleaseYes() {
      if (!this.enabled || !this.ctx) return;
      const now = this.ctx.currentTime;
      [523.25, 659.25, 783.99, 1046.50].forEach((f, idx) => {
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = 'square';
        osc.frequency.setValueAtTime(f, now + idx * 0.05);
        gain.gain.setValueAtTime(0.16, now + idx * 0.05);
        gain.gain.exponentialRampToValueAtTime(0.01, now + idx * 0.05 + 0.15);
        osc.connect(gain); gain.connect(this.ctx.destination);
        osc.start(now + idx * 0.05); osc.stop(now + idx * 0.05 + 0.15);
      });
    },
    playCaptureSuuu() {
      if (!this.enabled || !this.ctx) return;
      const now = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(950, now);
      osc.frequency.exponentialRampToValueAtTime(110, now + 0.45);
      gain.gain.setValueAtTime(0.28, now);
      gain.gain.exponentialRampToValueAtTime(0.01, now + 0.45);
      osc.connect(gain); gain.connect(this.ctx.destination);
      osc.start(now); osc.stop(now + 0.45);
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

  const GameState = {
    isOnline: false,
    myOnlineColor: 'red',
    players: [],
    activePlayerIndices: [],
    turnPointer: 0,
    diceValue: null,
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
      this.isRolling = false;
      this.isAnimating = false;
      this.winners = [];
      this.tokens = {
        red: [{ id: 0, step: -1 }, { id: 1, step: -1 }, { id: 2, step: -1 }, { id: 3, step: -1 }],
        yellow: [{ id: 0, step: -1 }, { id: 1, step: -1 }, { id: 2, step: -1 }, { id: 3, step: -1 }],
        green: [{ id: 0, step: -1 }, { id: 1, step: -1 }, { id: 2, step: -1 }, { id: 3, step: -1 }],
        blue: [{ id: 0, step: -1 }, { id: 1, step: -1 }, { id: 2, step: -1 }, { id: 3, step: -1 }]
      };
    },

    getCurrentPlayer() {
      return this.players[this.activePlayerIndices[this.turnPointer]] || this.players[0];
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

    ['red', 'yellow', 'green', 'blue'].forEach(color => {
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
    ['red', 'yellow', 'green', 'blue'].forEach(color => {
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

  async function onRollDiceTriggered() {
    if (GameState.isRolling || GameState.isAnimating) return;
    const currentPlayer = GameState.getCurrentPlayer();
    if (!currentPlayer) return;

    if (GameState.isOnline && currentPlayer.color !== myColor) return;

    const finalRoll = Math.floor(Math.random() * 6) + 1;
    GameState.isRolling = true;
    setDiceInteractionEnabled(false);

    SoundManager.playDiceRattle();
    const diceEl = document.getElementById('dice-3d-box');
    diceEl.className = 'dice-cube rolling-3d';

    await new Promise(res => setTimeout(res, 750));

    diceEl.className = `dice-cube show-${finalRoll}`;
    GameState.diceValue = finalRoll;
    GameState.isRolling = false;

    if (GameState.isOnline) {
      fetch('/api/send-action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          roomCode: currentRoomCode,
          action: { type: 'DICE_ROLLED', roll: finalRoll, color: myColor }
        })
      });
    }

    handlePostRollOptions(currentPlayer.color, finalRoll);
  }

  async function handlePostRollOptions(color, roll) {
    const legalTokenIds = GameState.getLegalMoves(color, roll);

    if (legalTokenIds.length === 0) {
      showTurnNotification("No Moves Available");
      await new Promise(res => setTimeout(res, 800));
      if (GameState.isOnline) {
        fetch('/api/send-action', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ roomCode: currentRoomCode, action: { type: 'TURN_PASS' } })
        });
      } else {
        advanceLocalTurn();
      }
    } else if (legalTokenIds.length === 1) {
      await new Promise(res => setTimeout(res, 350));
      executeMove(color, legalTokenIds[0], roll);
    } else {
      highlightMovableTokens(color, legalTokenIds);
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
    executeMove(color, id, GameState.diceValue);
  }

  async function executeMove(color, tokenId, roll) {
    GameState.isAnimating = true;
    setDiceInteractionEnabled(false);
    clearTokenHighlights();

    const token = GameState.tokens[color].find(t => t.id === tokenId);
    const fromStep = token.step;
    let grantBonus = (roll === 6);
    let toStep = fromStep;

    if (fromStep === -1 && roll === 6) {
      toStep = 0;
      token.step = 0;
      SoundManager.playReleaseYes();
      const tokenEl = document.getElementById(`token-${color}-${tokenId}`);
      setTokenPosition(tokenEl, color, 0, tokenId);
      await new Promise(res => setTimeout(res, 250));
    } else {
      toStep = fromStep + roll;
      token.step = toStep;
      SoundManager.playStepPuk();
      const tokenEl = document.getElementById(`token-${color}-${tokenId}`);
      setTokenPosition(tokenEl, color, toStep, tokenId);
      await new Promise(res => setTimeout(res, 250));

      if (toStep === 56) {
        grantBonus = true;
      } else if (toStep < 51) {
        const myGlobalIdx = (COLOR_SPECS[color].offset + toStep) % 52;
        if (!SAFE_CELL_INDICES.includes(myGlobalIdx)) {
          const rivalColor = (color === 'red') ? 'yellow' : 'red';
          const rivalTokens = GameState.tokens[rivalColor];
          if (rivalTokens) {
            rivalTokens.forEach(rTok => {
              if (rTok.step >= 0 && rTok.step < 51) {
                const rGlobal = (COLOR_SPECS[rivalColor].offset + rTok.step) % 52;
                if (rGlobal === myGlobalIdx) {
                  SoundManager.playCaptureSuuu();
                  grantBonus = true;
                  rTok.step = -1;
                  const rEl = document.getElementById(`token-${rivalColor}-${rTok.id}`);
                  setTokenPosition(rEl, rivalColor, -1, rTok.id);
                }
              }
            });
          }
        }
      }
    }

    if (GameState.isOnline && color === myColor) {
      fetch('/api/send-action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          roomCode: currentRoomCode,
          action: {
            type: 'TOKEN_MOVED',
            color: color,
            tokenId: tokenId,
            toStep: toStep,
            bonusTurn: grantBonus
          }
        })
      });
    }

    GameState.diceValue = null;
    GameState.isAnimating = false;

    if (!GameState.isOnline) {
      if (!grantBonus) advanceLocalTurn();
      else syncUIWithTurn();
    }
  }

  function advanceLocalTurn() {
    GameState.diceValue = null;
    GameState.turnPointer = (GameState.turnPointer + 1) % GameState.players.length;
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

  // STATE POLLING: PURE REPLICATION
  function startStatePolling(roomCode) {
    if (pollingInterval) clearInterval(pollingInterval);
    pollingInterval = setInterval(async () => {
      try {
        const res = await fetch(`/api/poll/${roomCode}`);
        const data = await res.json();
        if (!data.success) return;

        // 1. Lobby Update
        if (!isBoardLaunched && !data.gameStarted) {
          if (data.players.length >= 2 && myColor === 'red') {
            const btn = document.getElementById('btn-create-room');
            btn.innerText = `▶ START GAME (${data.players[1].name} Ready!)`;
            btn.disabled = false;
            btn.classList.remove('btn-secondary');
            btn.classList.add('btn-primary');
            btn.onclick = (e) => {
              e.preventDefault();
              btn.disabled = true;
              btn.innerText = 'Starting...';
              fetch('/api/start-game', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ roomCode: roomCode })
              });
            };
          }
        }

        // 2. Start Game Sync
        if (!isBoardLaunched && data.gameStarted) {
          launchGameBoard(data.players, true, myColor);
        }

        // 3. State Replication (Tokens & Turn)
        if (isBoardLaunched && data.version !== lastServerVersion) {
          lastServerVersion = data.version;

          // Replicate Token Steps
          if (data.tokens) {
            ['red', 'yellow'].forEach(c => {
              if (data.tokens[c]) {
                data.tokens[c].forEach((st, i) => {
                  if (GameState.tokens[c] && GameState.tokens[c][i]) {
                    GameState.tokens[c][i].step = st.step;
                  }
                });
              }
            });
            updateVisualTokensPositions();
          }

          // Replicate Turn
          const pIdx = GameState.players.findIndex(p => p.color === data.activeColor);
          if (pIdx !== -1) {
            GameState.turnPointer = pIdx;
          }

          // Replicate Opponent Dice Display
          if (data.diceValue && data.activeColor !== myColor) {
            const diceEl = document.getElementById('dice-3d-box');
            diceEl.className = `dice-cube show-${data.diceValue}`;
          }

          syncUIWithTurn();
        }
      } catch (err) {}
    }, 300);
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
    const btnCreateRoom = document.getElementById('btn-create-room');
    btnCreateRoom.onclick = async () => {
      SoundManager.init();
      const name = document.getElementById('host-player-name').value.trim() || 'Host Player';
      btnCreateRoom.innerText = 'Creating Room...';
      btnCreateRoom.disabled = true;

      try {
        const res = await fetch('/api/create-room', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ hostName: name })
        });
        const data = await res.json();
        if (data.success) {
          currentRoomCode = data.roomCode;
          myColor = 'red';
          document.getElementById('display-room-code').innerText = data.roomCode;
          document.getElementById('created-code-box').style.display = 'block';
          btnCreateRoom.innerText = 'Waiting for Friend to Join...';
          startStatePolling(data.roomCode);
        }
      } catch (err) {
        alert('Server connection error.');
        btnCreateRoom.innerText = 'CREATE ROOM';
        btnCreateRoom.disabled = false;
      }
    };

    // JOIN ROOM
    const btnJoinRoom = document.getElementById('btn-join-room');
    btnJoinRoom.onclick = async () => {
      SoundManager.init();
      const name = document.getElementById('join-player-name').value.trim() || 'Guest Player';
      const rawInput = document.getElementById('join-room-code').value || '';
      const code = rawInput.toString().trim().replace(/\s+/g, '');

      if (!code || code.length !== 4) {
        return alert('Kripya sahi 4-digit room code daalein!');
      }

      btnJoinRoom.innerText = 'Connecting...';
      btnJoinRoom.disabled = true;

      try {
        const res = await fetch('/api/join-room', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ roomCode: code, playerName: name })
        });
        const data = await res.json();
        if (!data.success) {
          alert(data.message);
          btnJoinRoom.innerText = 'JOIN ROOM';
          btnJoinRoom.disabled = false;
          return;
        }

        currentRoomCode = code;
        myColor = 'yellow';
        btnJoinRoom.innerText = '✓ Joined! Waiting for Host...';
        startStatePolling(code);
      } catch (err) {
        alert('Server connection error.');
        btnJoinRoom.innerText = 'JOIN ROOM';
        btnJoinRoom.disabled = false;
      }
    };

    document.getElementById('btn-roll-dice').addEventListener('click', onRollDiceTriggered);

    document.getElementById('btn-sound-toggle').addEventListener('click', () => {
      SoundManager.enabled = !SoundManager.enabled;
      document.getElementById('btn-sound-toggle').innerText = SoundManager.enabled ? '🔊' : '🔇';
    });

    document.getElementById('btn-settings-open').addEventListener('click', () => {
      document.getElementById('settings-modal').style.display = 'flex';
    });
    document.getElementById('btn-settings-close').addEventListener('click', () => {
      document.getElementById('settings-modal').style.display = 'none';
    });

    document.getElementById('btn-exit-lobby').addEventListener('click', () => {
      document.getElementById('settings-modal').style.display = 'none';
      document.getElementById('game-screen').style.display = 'none';
      document.getElementById('lobby-screen').style.display = 'flex';
      isBoardLaunched = false;
      if (pollingInterval) clearInterval(pollingInterval);
    });
  }

  window.addEventListener('DOMContentLoaded', () => {
    renderLobbyInputs(selectedCount);
    setupEventListeners();
  });

})();
