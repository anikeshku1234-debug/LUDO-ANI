/**
 * ============================================================================
 * LUDO ROYALE - FULL REALTIME ENGINE + WEBRTC LIVE VOICE CHAT (MIC & SPEAKER)
 * ============================================================================
 */

(function () {
  'use strict';

  localStorage.removeItem('ludo_active_room');

  let currentUser = JSON.parse(localStorage.getItem('ludo_user') || 'null');
  let currentRoomCode = null;
  let myColor = 'red';
  let isBoardLaunched = false;
  let isGameOver = false;
  let pollingInterval = null;
  let lastServerVersion = 0;

  // ==========================================================================
  // WEBRTC VOICE CHAT ENGINE (MIC & SPEAKER)
  // ==========================================================================
  const VoiceChat = {
    localStream: null,
    peerConnection: null,
    isMuted: false,
    remoteAudio: null,
    rtcConfig: {
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' }
      ]
    },

    async init() {
      const micBtn = document.getElementById('btn-mic-toggle');
      if (micBtn) {
        micBtn.style.display = 'inline-block';
        micBtn.className = 'icon-btn mic-active';
        micBtn.onclick = () => this.toggleMic();
      }

      if (!this.remoteAudio) {
        this.remoteAudio = document.createElement('audio');
        this.remoteAudio.autoplay = true;
        document.body.appendChild(this.remoteAudio);
      }

      try {
        this.localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      } catch (err) {
        console.warn('Microphone permission denied or not available:', err);
        if (micBtn) {
          micBtn.innerText = '🔇';
          micBtn.className = 'icon-btn mic-muted';
        }
        return;
      }

      this.createPeerConnection();

      // Agar host hai toh audio offer create karega
      if (myColor === 'red') {
        this.createAndSendOffer();
      }
    },

    createPeerConnection() {
      this.peerConnection = new RTCPeerConnection(this.rtcConfig);

      if (this.localStream) {
        this.localStream.getTracks().forEach(track => {
          this.peerConnection.addTrack(track, this.localStream);
        });
      }

      this.peerConnection.ontrack = (event) => {
        if (this.remoteAudio && event.streams && event.streams[0]) {
          this.remoteAudio.srcObject = event.streams[0];
        }
      };

      this.peerConnection.onicecandidate = (event) => {
        if (event.candidate && currentRoomCode) {
          fetch('/api/send-action', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              roomCode: currentRoomCode,
              action: { type: 'VOICE_ICE', candidate: event.candidate, fromColor: myColor }
            })
          });
        }
      };
    },

    async createAndSendOffer() {
      if (!this.peerConnection) return;
      const offer = await this.peerConnection.createOffer();
      await this.peerConnection.setLocalDescription(offer);

      fetch('/api/send-action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          roomCode: currentRoomCode,
          action: { type: 'VOICE_OFFER', sdp: offer, fromColor: myColor }
        })
      });
    },

    async handleRemoteOffer(offer) {
      if (!this.peerConnection) this.createPeerConnection();
      await this.peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
      const answer = await this.peerConnection.createAnswer();
      await this.peerConnection.setLocalDescription(answer);

      fetch('/api/send-action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          roomCode: currentRoomCode,
          action: { type: 'VOICE_ANSWER', sdp: answer, fromColor: myColor }
        })
      });
    },

    async handleRemoteAnswer(answer) {
      if (this.peerConnection && this.peerConnection.signalingState !== 'stable') {
        await this.peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
      }
    },

    async handleRemoteIce(candidate) {
      if (this.peerConnection) {
        try {
          await this.peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
        } catch (e) {}
      }
    },

    toggleMic() {
      if (!this.localStream) return;
      const audioTrack = this.localStream.getAudioTracks()[0];
      if (audioTrack) {
        this.isMuted = !this.isMuted;
        audioTrack.enabled = !this.isMuted;
        const micBtn = document.getElementById('btn-mic-toggle');
        if (micBtn) {
          micBtn.innerText = this.isMuted ? '🔇' : '🎙️';
          micBtn.className = this.isMuted ? 'icon-btn mic-muted' : 'icon-btn mic-active';
        }
      }
    },

    stop() {
      if (this.localStream) {
        this.localStream.getTracks().forEach(t => t.stop());
        this.localStream = null;
      }
      if (this.peerConnection) {
        this.peerConnection.close();
        this.peerConnection = null;
      }
      const micBtn = document.getElementById('btn-mic-toggle');
      if (micBtn) micBtn.style.display = 'none';
    }
  };

  // SOUND SYNTHESIZER
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
      osc.frequency.exponentialRampToValueAtTime(110, now + 0.55);
      gain.gain.setValueAtTime(0.32, now);
      gain.gain.exponentialRampToValueAtTime(0.01, now + 0.55);
      osc.connect(gain); gain.connect(this.ctx.destination);
      osc.start(now); osc.stop(now + 0.55);
    },
    playHomeChime() {
      if (!this.enabled || !this.ctx) return;
      const now = this.ctx.currentTime;
      const notes = [523.25, 659.25, 783.99, 1046.50, 1318.51];
      notes.forEach((freq, idx) => {
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, now + idx * 0.08);
        gain.gain.setValueAtTime(0.25, now + idx * 0.08);
        gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.08 + 0.35);
        osc.connect(gain); gain.connect(this.ctx.destination);
        osc.start(now + idx * 0.08); osc.stop(now + idx * 0.08 + 0.35);
      });
    },
    playVictory() {
      if (!this.enabled || !this.ctx) return;
      const now = this.ctx.currentTime;
      [440, 554.37, 659.25, 880, 1108.73].forEach((f, idx) => {
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(f, now + idx * 0.14);
        gain.gain.setValueAtTime(0.32, now + idx * 0.14);
        gain.gain.exponentialRampToValueAtTime(0.01, now + idx * 0.14 + 0.45);
        osc.connect(gain); gain.connect(this.ctx.destination);
        osc.start(now + idx * 0.14); osc.stop(now + idx * 0.14 + 0.45);
      });
    }
  };

  // COORDINATES & TRACK SPECS
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
      if (color === 'yellow') return { row: dist + 1, col: 7 };
      if (color === 'green')  return { row: 7, col: dist + 1 };
      if (color === 'blue')   return { row: 7, col: 13 - dist };
    }
  }

  const GameState = {
    isOnline: false,
    players: [],
    activeColor: 'red',
    diceValue: null,
    consecutiveSixes: 0,
    isRolling: false,
    isAnimating: false,
    winners: [],
    tokens: {
      red: [-1, -1, -1, -1],
      yellow: [-1, -1, -1, -1],
      green: [-1, -1, -1, -1],
      blue: [-1, -1, -1, -1]
    },

    init(configuredPlayers, isOnlineMode = false) {
      this.isOnline = isOnlineMode;
      this.players = configuredPlayers;
      this.activeColor = configuredPlayers[0].color;
      this.diceValue = null;
      this.consecutiveSixes = 0;
      this.isRolling = false;
      this.isAnimating = false;
      this.winners = [];
      this.tokens = {
        red: [-1, -1, -1, -1],
        yellow: [-1, -1, -1, -1],
        green: [-1, -1, -1, -1],
        blue: [-1, -1, -1, -1]
      };
      isGameOver = false;
    },

    canTokenMove(step, roll) {
      if (step === -1) return roll === 6;
      return (step + roll) <= 56;
    },

    getLegalMoves(color, roll) {
      const list = this.tokens[color] || [];
      const valid = [];
      list.forEach((step, id) => {
        if (this.canTokenMove(step, roll)) valid.push(id);
      });
      return valid;
    }
  };

  // WEIGHTED DICE ROLL (6: +10%, 2: -10%)
  function getBiasedDiceRoll() {
    const r = Math.random() * 100;
    if (r < 16.67) return 1;
    if (r < 23.34) return 2;
    if (r < 40.01) return 3;
    if (r < 56.68) return 4;
    if (r < 73.35) return 5;
    return 6;
  }

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

    injectHomeCounters();
  }

  function injectHomeCounters() {
    ['red', 'yellow', 'green', 'blue'].forEach(c => {
      const tri = document.querySelector(`.tri-${c}`);
      if (tri) {
        let badge = document.getElementById(`home-count-${c}`);
        if (!badge) {
          badge = document.createElement('div');
          badge.id = `home-count-${c}`;
          badge.className = 'home-count-badge';
          tri.appendChild(badge);
        }
        badge.innerText = '0/4';
      }
    });
  }

  function updateHomeCounters() {
    ['red', 'yellow', 'green', 'blue'].forEach(c => {
      const b = document.getElementById(`home-count-${c}`);
      if (b && GameState.tokens[c]) {
        const homeTokens = GameState.tokens[c].filter(s => s === 56).length;
        b.innerText = `${homeTokens}/4`;
      }
    });
  }

  function applyStackedPositions() {
    const cellGroups = new Map();
    const activeColors = GameState.players.map(p => p.color);
    activeColors.forEach(color => {
      for (let i = 0; i < 4; i++) {
        const tok = document.getElementById(`token-${color}-${i}`);
        if (tok && tok.parentElement) {
          const parent = tok.parentElement;
          if (!cellGroups.has(parent)) {
            cellGroups.set(parent, []);
          }
          cellGroups.get(parent).push(tok);
        }
      }
    });

    cellGroups.forEach((tokens, parent) => {
      const count = tokens.length;
      if (count <= 1 || parent.classList.contains('base-spot')) {
        tokens.forEach(tok => {
          tok.classList.remove('token-stacked');
          tok.style.top = '50%';
          tok.style.left = '50%';
        });
      } else {
        tokens.forEach((tok, idx) => {
          tok.classList.add('token-stacked');
          if (count === 2) {
            tok.style.top = '50%';
            tok.style.left = idx === 0 ? '30%' : '70%';
          } else if (count === 3) {
            if (idx === 0) { tok.style.top = '28%'; tok.style.left = '50%'; }
            else if (idx === 1) { tok.style.top = '72%'; tok.style.left = '30%'; }
            else { tok.style.top = '72%'; tok.style.left = '70%'; }
          } else {
            tok.style.top = idx < 2 ? '28%' : '72%';
            tok.style.left = idx % 2 === 0 ? '28%' : '72%';
          }
        });
      }
    });
  }

  function mountTokenToTarget(tokenEl, color, step, id) {
    if (step === -1) {
      const spot = document.querySelector(`.base-spot[data-color="${color}"][data-index="${id}"]`);
      if (spot && tokenEl.parentElement !== spot) {
        spot.appendChild(tokenEl);
        tokenEl.classList.remove('token-stacked');
        tokenEl.style.top = '50%';
        tokenEl.style.left = '50%';
      }
    } else {
      const v = getVisualCoordsForStep(color, step);
      if (v) {
        const cell = document.getElementById(`cell-${v.row}-${v.col}`);
        if (cell && tokenEl.parentElement !== cell) {
          cell.appendChild(tokenEl);
        }
      }
    }
  }

  function createAllTokens() {
    document.querySelectorAll('.ludo-token').forEach(el => el.remove());

    const activeColors = GameState.players.map(p => p.color);
    activeColors.forEach(color => {
      for (let i = 0; i < 4; i++) {
        const tok = document.createElement('div');
        tok.className = `ludo-token token-${color}`;
        tok.id = `token-${color}-${i}`;
        tok.dataset.color = color;
        tok.dataset.id = i;
        tok.onclick = onTokenClicked;
        mountTokenToTarget(tok, color, -1, i);
      }
    });
    applyStackedPositions();
    updateHomeCounters();
  }

  function updateTokensView() {
    if (GameState.isAnimating) return;
    const activeColors = GameState.players.map(p => p.color);
    activeColors.forEach(color => {
      const steps = GameState.tokens[color] || [];
      steps.forEach((step, i) => {
        let tok = document.getElementById(`token-${color}-${i}`);
        if (!tok) {
          tok = document.createElement('div');
          tok.className = `ludo-token token-${color}`;
          tok.id = `token-${color}-${i}`;
          tok.dataset.color = color;
          tok.dataset.id = i;
          tok.onclick = onTokenClicked;
        }
        mountTokenToTarget(tok, color, step, i);
      });
    });
    applyStackedPositions();
    updateHomeCounters();
  }

  async function animateForwardSteps(color, tokenId, fromStep, toStep) {
    const tokenEl = document.getElementById(`token-${color}-${tokenId}`);
    if (!tokenEl) return;

    if (fromStep === -1) {
      SoundManager.playReleaseYes();
      mountTokenToTarget(tokenEl, color, 0, tokenId);
      applyStackedPositions();
      await new Promise(res => setTimeout(res, 260));
      return;
    }

    for (let s = fromStep + 1; s <= toStep; s++) {
      await new Promise(res => setTimeout(res, 140));
      SoundManager.playStepPuk();
      mountTokenToTarget(tokenEl, color, s, tokenId);
      applyStackedPositions();
    }

    if (toStep === 56) {
      SoundManager.playHomeChime();
    }
    await new Promise(res => setTimeout(res, 100));
  }

  async function animateReverseRewind(color, tokenId, fromStep) {
    const tokenEl = document.getElementById(`token-${color}-${tokenId}`);
    if (!tokenEl) return;

    await new Promise(res => setTimeout(res, 250)); // 1/4s Pause

    SoundManager.playCaptureSuuu();
    for (let s = fromStep - 1; s >= 0; s--) {
      await new Promise(res => setTimeout(res, 60));
      mountTokenToTarget(tokenEl, color, s, tokenId);
      applyStackedPositions();
    }
    await new Promise(res => setTimeout(res, 80));
    mountTokenToTarget(tokenEl, color, -1, tokenId);
    applyStackedPositions();
  }

  function checkGameFinished() {
    const activeColors = GameState.players.map(p => p.color);
    activeColors.forEach(c => {
      const allFourHome = GameState.tokens[c] && GameState.tokens[c].every(s => s === 56);
      if (allFourHome && !GameState.winners.includes(c)) {
        GameState.winners.push(c);
      }
    });

    const neededWinners = GameState.players.length - 1;
    if (GameState.winners.length >= neededWinners && !isGameOver) {
      isGameOver = true;
      SoundManager.playVictory();
      triggerPodiumVictoryModal();
      return true;
    }
    return false;
  }

  function triggerPodiumVictoryModal() {
    let modal = document.getElementById('victory-modal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'victory-modal';
      modal.className = 'modal-backdrop';
      modal.innerHTML = `
        <div class="modal-dialog victory-dialog" style="max-width:340px;">
          <div class="confetti-holder">🏆🎉</div>
          <h2 id="winner-celebrate-title">MATCH FINISHED!</h2>
          <div id="podium-rankings-list" class="podium-list"></div>
          <div class="modal-actions">
            <button class="btn btn-primary btn-large" id="btn-victory-replay">Play Again</button>
          </div>
        </div>
      `;
      document.body.appendChild(modal);
      document.getElementById('btn-victory-replay').onclick = () => {
        modal.style.display = 'none';
        startPassAndPlayMatch();
      };
    }

    const title = document.getElementById('winner-celebrate-title');
    const podiumList = document.getElementById('podium-rankings-list');

    const firstWinnerColor = GameState.winners[0];
    const firstWinner = GameState.players.find(p => p.color === firstWinnerColor);
    title.innerText = `${firstWinner ? firstWinner.name.toUpperCase() : 'PLAYER'} IS WINNER!`;

    podiumList.innerHTML = '';
    const rankBadges = ['🥇 1st Place (WINNER)', '🥈 2nd Place', '🥉 3rd Place'];

    GameState.winners.forEach((wColor, idx) => {
      const playerObj = GameState.players.find(p => p.color === wColor) || { name: wColor.toUpperCase() };
      const row = document.createElement('div');
      row.className = 'podium-item';
      row.innerHTML = `<span>${rankBadges[idx] || `${idx + 1}th Place`}</span><span style="color:var(--ludo-${wColor})">${playerObj.name}</span>`;
      podiumList.appendChild(row);
    });

    const loser = GameState.players.find(p => !GameState.winners.includes(p.color));
    if (loser) {
      const loserRow = document.createElement('div');
      loserRow.className = 'podium-item';
      loserRow.style.border = '1px solid #ef4444';
      loserRow.innerHTML = `<span style="color:#ef4444; font-weight:bold;">❌ Looser</span><span style="color:var(--ludo-${loser.color})">${loser.name}</span>`;
      podiumList.appendChild(loserRow);
    }

    modal.style.display = 'flex';
    setDiceInteractionEnabled(false);
  }

  async function onRollDiceTriggered() {
    if (GameState.isRolling || GameState.isAnimating || isGameOver) return;
    if (GameState.isOnline && GameState.activeColor !== myColor) return;

    const roll = getBiasedDiceRoll();
    GameState.isRolling = true;
    setDiceInteractionEnabled(false);

    SoundManager.playDiceRattle();
    const diceEl = document.getElementById('dice-3d-box');
    diceEl.className = 'dice-cube rolling-3d';

    await new Promise(res => setTimeout(res, 750));

    diceEl.className = `dice-cube show-${roll}`;
    GameState.diceValue = roll;
    GameState.isRolling = false;

    if (roll === 6) {
      GameState.consecutiveSixes++;
    } else {
      GameState.consecutiveSixes = 0;
    }

    if (GameState.consecutiveSixes === 3) {
      showTurnNotification("3 Baar 6 Aaya! Turn Cancelled");
      GameState.consecutiveSixes = 0;
      await new Promise(res => setTimeout(res, 900));

      if (GameState.isOnline) {
        fetch('/api/send-action', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ roomCode: currentRoomCode, action: { type: 'TURN_PASS' } })
        });
      } else {
        advancePassPlayTurn();
      }
      return;
    }

    if (GameState.isOnline) {
      fetch('/api/send-action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          roomCode: currentRoomCode,
          action: { type: 'DICE_ROLLED', roll: roll, color: myColor }
        })
      });
    }

    handlePostRoll(GameState.activeColor, roll);
  }

  async function handlePostRoll(color, roll) {
    if (isGameOver) return;
    const legalTokens = GameState.getLegalMoves(color, roll);

    if (legalTokens.length === 0) {
      showTurnNotification("No Moves Available");
      await new Promise(res => setTimeout(res, 850));
      if (GameState.isOnline) {
        fetch('/api/send-action', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ roomCode: currentRoomCode, action: { type: 'TURN_PASS' } })
        });
      } else {
        advancePassPlayTurn();
      }
    } else if (legalTokens.length === 1) {
      await new Promise(res => setTimeout(res, 350));
      executeMove(color, legalTokens[0], roll);
    } else {
      highlightMovableTokens(color, legalTokens);
      showTurnNotification("Select a Token to Move");
    }
  }

  function onTokenClicked(e) {
    if (GameState.isRolling || GameState.isAnimating || !GameState.diceValue || isGameOver) return;

    const color = e.currentTarget.dataset.color;
    const id = parseInt(e.currentTarget.dataset.id, 10);

    if (color !== GameState.activeColor) return;
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

    const fromStep = GameState.tokens[color][tokenId];
    let toStep = fromStep;
    let grantBonus = (roll === 6);
    let cutRival = false;
    let cutTokenId = -1;

    if (fromStep === -1 && roll === 6) {
      toStep = 0;
      await animateForwardSteps(color, tokenId, fromStep, toStep);
    } else {
      toStep = fromStep + roll;
      await animateForwardSteps(color, tokenId, fromStep, toStep);

      if (toStep === 56) {
        grantBonus = true;
      } else if (toStep < 51) {
        const myGlobal = (COLOR_SPECS[color].offset + toStep) % 52;

        if (!SAFE_CELL_INDICES.includes(myGlobal)) {
          const rivalPlayers = GameState.players.filter(p => p.color !== color);
          for (let rp of rivalPlayers) {
            const rival = rp.color;
            if (GameState.tokens[rival]) {
              const matchingRivalIds = [];
              for (let rId = 0; rId < 4; rId++) {
                const rStep = GameState.tokens[rival][rId];
                if (rStep >= 0 && rStep < 51) {
                  const rivalGlobal = (COLOR_SPECS[rival].offset + rStep) % 52;
                  if (rivalGlobal === myGlobal) {
                    matchingRivalIds.push(rId);
                  }
                }
              }

              let myTokensOnCell = 1;
              for (let mId = 0; mId < 4; mId++) {
                if (mId !== tokenId && GameState.tokens[color][mId] === toStep) {
                  myTokensOnCell++;
                }
              }

              if (matchingRivalIds.length === 1 || (matchingRivalIds.length >= 2 && myTokensOnCell >= 2)) {
                for (let rId of matchingRivalIds) {
                  grantBonus = true;
                  cutRival = true;
                  cutTokenId = rId;
                  const cutOriginStep = GameState.tokens[rival][rId] >= 0 ? GameState.tokens[rival][rId] : toStep;
                  GameState.tokens[rival][rId] = -1;
                  await animateReverseRewind(rival, rId, cutOriginStep);
                }
                break;
              }
            }
          }
        }
      }
    }

    GameState.tokens[color][tokenId] = toStep;
    updateTokensView();
    updateHomeCounters();

    const ended = checkGameFinished();
    if (ended) {
      GameState.diceValue = null;
      GameState.isAnimating = false;
      return;
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
            bonusTurn: grantBonus,
            cutRival: cutRival,
            cutTokenId: cutTokenId
          }
        })
      });
    }

    GameState.diceValue = null;
    GameState.isAnimating = false;

    if (!GameState.isOnline) {
      if (!grantBonus) {
        advancePassPlayTurn();
      } else {
        syncUIWithTurn();
      }
    }
  }

  function advancePassPlayTurn() {
    if (isGameOver) return;
    GameState.diceValue = null;
    GameState.consecutiveSixes = 0;
    const playerColors = GameState.players.map(p => p.color);
    let curIndex = playerColors.indexOf(GameState.activeColor);

    for (let i = 0; i < playerColors.length; i++) {
      curIndex = (curIndex + 1) % playerColors.length;
      const candidateColor = playerColors[curIndex];
      if (!GameState.winners.includes(candidateColor)) {
        GameState.activeColor = candidateColor;
        break;
      }
    }
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
    if (isGameOver) return;
    const curColor = GameState.activeColor;
    const playerObj = GameState.players.find(p => p.color === curColor) || { name: curColor.toUpperCase() };

    const nameEl = document.getElementById('turn-player-name');
    nameEl.innerText = playerObj.name;
    nameEl.style.color = `var(--ludo-${curColor})`;

    document.getElementById('footer-player-title').innerText = playerObj.name;
    document.getElementById('badge-pin-icon').className = `pin-sample token-${curColor}`;

    const isMyTurn = !GameState.isOnline || (curColor === myColor);
    document.getElementById('footer-player-status').innerText = isMyTurn ? 'ROLL THE DICE' : 'WAITING FOR OPPONENT...';
    setDiceInteractionEnabled(isMyTurn && !GameState.diceValue && !GameState.isAnimating);
  }

  function setDiceInteractionEnabled(enable) {
    const diceBtn = document.getElementById('btn-roll-dice');
    const arrow = document.getElementById('dice-pointer-arrow');
    if (isGameOver) {
      diceBtn.disabled = true;
      arrow.style.visibility = 'hidden';
      return;
    }
    diceBtn.disabled = !enable;
    arrow.style.visibility = enable ? 'visible' : 'hidden';
  }

  function showTurnNotification(msg) {
    document.getElementById('footer-player-status').innerText = msg;
  }

  function launchGameBoard(configuredPlayers, isOnlineMode = false) {
    if (isBoardLaunched) return;
    isBoardLaunched = true;

    ['red', 'green', 'yellow', 'blue'].forEach(c => {
      const label = document.getElementById(`label-${c}`);
      const p = configuredPlayers.find(x => x.color === c);
      if (p) label.innerText = p.name;
      else label.innerText = c.toUpperCase();
    });

    document.getElementById('hud-room-display').innerText = isOnlineMode ? `ROOM: ${currentRoomCode}` : 'PASS & PLAY';
    GameState.init(configuredPlayers, isOnlineMode);
    document.getElementById('lobby-screen').style.display = 'none';
    document.getElementById('game-screen').style.display = 'flex';

    buildBoardGrid();
    createAllTokens();
    syncUIWithTurn();

    // Online game shuru hote hi Voice Chat initialize karein
    if (isOnlineMode) {
      VoiceChat.init();
    }
  }

  // 7. REALTIME ONLINE STATE REPLICATION
  function startStatePolling(roomCode) {
    if (pollingInterval) clearInterval(pollingInterval);
    pollingInterval = setInterval(async () => {
      try {
        const res = await fetch(`/api/poll/${roomCode}`);
        const data = await res.json();
        if (!data.success) return;

        // 1. Lobby Host Readiness
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
              btn.innerText = 'Starting Game...';
              fetch('/api/start-game', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ roomCode: roomCode })
              });
            };
          }
        }

        // 2. Launch Board synchronously
        if (!isBoardLaunched && data.gameStarted) {
          launchGameBoard(data.players, true);
        }

        // 3. State Replication
        if (isBoardLaunched && data.version !== lastServerVersion) {
          lastServerVersion = data.version;

          if (data.tokens && !GameState.isAnimating) {
            ['red', 'yellow'].forEach(c => {
              if (c !== myColor) {
                data.tokens[c].forEach(async (newStep, i) => {
                  const oldStep = GameState.tokens[c][i];
                  if (newStep !== oldStep) {
                    if (newStep === -1 && oldStep >= 0) {
                      await animateReverseRewind(c, i, oldStep);
                    } else if (newStep > oldStep || (oldStep === -1 && newStep === 0)) {
                      await animateForwardSteps(c, i, oldStep, newStep);
                    }
                    GameState.tokens[c][i] = newStep;
                    updateTokensView();
                    updateHomeCounters();
                    checkGameFinished();
                  }
                });
              } else {
                GameState.tokens[c] = [...data.tokens[c]];
              }
            });
            updateTokensView();
            updateHomeCounters();
            checkGameFinished();
          }

          GameState.activeColor = data.activeColor;

          if (data.diceValue) {
            if (data.activeColor !== myColor && GameState.diceValue !== data.diceValue) {
              SoundManager.playDiceRattle();
            }
            GameState.diceValue = data.diceValue;
            const diceEl = document.getElementById('dice-3d-box');
            diceEl.className = `dice-cube show-${data.diceValue}`;
          } else {
            GameState.diceValue = null;
          }

          syncUIWithTurn();
        }

        // Voice Chat Signaling handling from actions
        if (data.actions) {
          data.actions.forEach(act => {
            if (act.fromColor && act.fromColor !== myColor) {
              if (act.type === 'VOICE_OFFER') {
                VoiceChat.handleRemoteOffer(act.sdp);
              } else if (act.type === 'VOICE_ANSWER') {
                VoiceChat.handleRemoteAnswer(act.sdp);
              } else if (act.type === 'VOICE_ICE') {
                VoiceChat.handleRemoteIce(act.candidate);
              }
            }
          });
        }
      } catch (err) {}
    }, 300);
  }

  // Pass & Play Mode Selection
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

  // 8. USER AUTHENTICATION UI
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

  // 9. CONTROLS INITIALIZATION
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
      const name = (currentUser ? currentUser.name : document.getElementById('host-player-name').value.trim()) || 'Host Player';
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
      const name = (currentUser ? currentUser.name : document.getElementById('join-player-name').value.trim()) || 'Guest Player';
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
      isGameOver = false;
      VoiceChat.stop();
      if (pollingInterval) clearInterval(pollingInterval);
    });
  }

  window.addEventListener('DOMContentLoaded', () => {
    renderLobbyInputs(selectedCount);
    injectAuthModal();
    setupEventListeners();
    updateAuthHeaderUI();
  });

})();
