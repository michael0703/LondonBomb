// Time Bomb - Client App Logic

const socket = io();

// STATE
let currentRoomCode = null;
let currentName = null;
let isHost = false;
let myId = null;
let isFirstUpdate = true;
let latestState = null;

// SOUND SYNTHESIS ENGINE (Web Audio API)
const AudioSynth = {
    ctx: null,
    
    init() {
        if (!this.ctx) {
            this.ctx = new (window.AudioContext || window.webkitAudioContext)();
        }
    },
    
    playTick() {
        this.init();
        if (this.ctx.state === 'suspended') this.ctx.resume();
        
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        
        osc.connect(gain);
        gain.connect(this.ctx.destination);
        
        osc.frequency.setValueAtTime(800, this.ctx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(100, this.ctx.currentTime + 0.05);
        
        gain.gain.setValueAtTime(0.05, this.ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + 0.05);
        
        osc.start();
        osc.stop(this.ctx.currentTime + 0.05);
    },
    
    playSnip() {
        this.init();
        if (this.ctx.state === 'suspended') this.ctx.resume();
        
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        
        osc.connect(gain);
        gain.connect(this.ctx.destination);
        
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(1200, this.ctx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(150, this.ctx.currentTime + 0.15);
        
        gain.gain.setValueAtTime(0.3, this.ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + 0.15);
        
        osc.start();
        osc.stop(this.ctx.currentTime + 0.15);
    },
    
    playSuccessChime() {
        this.init();
        if (this.ctx.state === 'suspended') this.ctx.resume();
        
        const now = this.ctx.currentTime;
        const frequencies = [523.25, 659.25, 783.99, 1046.50]; // C5, E5, G5, C6 chord
        
        frequencies.forEach((f, index) => {
            const osc = this.ctx.createOscillator();
            const gain = this.ctx.createGain();
            
            osc.connect(gain);
            gain.connect(this.ctx.destination);
            
            osc.type = 'sine';
            osc.frequency.setValueAtTime(f, now + index * 0.08);
            
            gain.gain.setValueAtTime(0.0, now);
            gain.gain.linearRampToValueAtTime(0.12, now + index * 0.08 + 0.02);
            gain.gain.exponentialRampToValueAtTime(0.001, now + index * 0.08 + 0.6);
            
            osc.start(now + index * 0.08);
            osc.stop(now + index * 0.08 + 0.65);
        });
    },
    
    playExplosion() {
        this.init();
        if (this.ctx.state === 'suspended') this.ctx.resume();
        
        const now = this.ctx.currentTime;
        const duration = 2.5;
        
        // Generate white noise buffer
        const bufferSize = this.ctx.sampleRate * duration;
        const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < bufferSize; i++) {
            data[i] = Math.random() * 2 - 1;
        }
        
        const noise = this.ctx.createBufferSource();
        noise.buffer = buffer;
        
        // Filter noise for boom rumble
        const filter = this.ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(800, now);
        filter.frequency.exponentialRampToValueAtTime(20, now + duration);
        
        const gain = this.ctx.createGain();
        gain.gain.setValueAtTime(0.5, now);
        gain.gain.exponentialRampToValueAtTime(0.01, now + duration);
        
        noise.connect(filter);
        filter.connect(gain);
        gain.connect(this.ctx.destination);
        
        noise.start(now);
        noise.stop(now + duration);
    },
    
    playVictoryFanfare() {
        this.init();
        if (this.ctx.state === 'suspended') this.ctx.resume();
        
        const now = this.ctx.currentTime;
        const notes = [587.33, 587.33, 587.33, 783.99, 987.77]; // D5, D5, D5, G5, B5 brass fanfare
        const durations = [0.12, 0.12, 0.12, 0.4, 0.8];
        const deltas = [0, 0.15, 0.3, 0.45, 0.9];
        
        notes.forEach((f, idx) => {
            const osc = this.ctx.createOscillator();
            const gain = this.ctx.createGain();
            
            osc.connect(gain);
            gain.connect(this.ctx.destination);
            
            osc.type = 'sawtooth';
            osc.frequency.setValueAtTime(f, now + deltas[idx]);
            
            // Brass sound high pass filter to remove harsh sub-frequencies
            const filter = this.ctx.createBiquadFilter();
            filter.type = 'highpass';
            filter.frequency.value = 200;
            osc.disconnect(gain);
            osc.connect(filter);
            filter.connect(gain);
            
            gain.gain.setValueAtTime(0, now);
            gain.gain.linearRampToValueAtTime(0.1, now + deltas[idx] + 0.02);
            gain.gain.exponentialRampToValueAtTime(0.001, now + deltas[idx] + durations[idx]);
            
            osc.start(now + deltas[idx]);
            osc.stop(now + deltas[idx] + durations[idx]);
        });
    }
};

// DOM SELECTORS
const views = {
    lobby: document.getElementById('lobby-view'),
    waiting: document.getElementById('waiting-view'),
    game: document.getElementById('game-view')
};

const inputs = {
    name: document.getElementById('player-name'),
    roomCode: document.getElementById('room-code-input')
};

const buttons = {
    createRoom: document.getElementById('btn-create-room'),
    joinRoom: document.getElementById('btn-join-room'),
    startGame: document.getElementById('btn-start-game'),
    addBot: document.getElementById('btn-add-bot'),
    deployConfirm: document.getElementById('btn-deploy-confirm'),
    confirmRole: document.getElementById('btn-confirm-role'),
    restart: document.getElementById('btn-restart'),
    revealRole: document.getElementById('btn-reveal-role'),
    viewBoard: document.getElementById('btn-view-board'),
    showSummary: document.getElementById('btn-show-summary'),
    exitLobby: document.getElementById('btn-exit-lobby'),
    openHistory: document.getElementById('btn-open-history'),
    closeHistory: document.getElementById('btn-close-history')
};

const displays = {
    roomCodeText: document.getElementById('room-code-text'),
    playerCount: document.getElementById('player-count'),
    playersList: document.getElementById('players-list'),
    lobbyStatusMsg: document.getElementById('lobby-status-msg'),
    progressBar: document.getElementById('progress-bar'),
    progressText: document.getElementById('progress-text'),
    safeProgressBar: document.getElementById('safe-progress-bar'),
    safeProgressText: document.getElementById('safe-progress-text'),
    cutsRemainingVal: document.getElementById('cuts-remaining-val'),
    cutsTotalVal: document.getElementById('cuts-total-val'),
    playersRing: document.getElementById('players-ring'),
    roleCardFront: document.getElementById('role-card-front'),
    roleBadgeText: document.getElementById('role-badge-text'),
    deployModal: document.getElementById('deploy-modal'),
    secretWiresReveal: document.getElementById('secret-wires-reveal'),
    handMemoText: document.getElementById('hand-memo-text'),
    roleRevealModal: document.getElementById('role-reveal-modal'),
    rrRoleInfo: document.getElementById('rr-role-info'),
    rrRoleTitle: document.getElementById('rr-role-title'),
    rrRoleDesc: document.getElementById('rr-role-desc'),
    rrStampBox: document.getElementById('rr-stamp-box'),
    gameOverModal: document.getElementById('game-over-modal'),
    gameOverContent: document.getElementById('game-over-content'),
    gameOverTitle: document.getElementById('game-over-title'),
    gameOverSubtitle: document.getElementById('game-over-subtitle'),
    finalRolesList: document.getElementById('final-roles-list'),
    explosionFlash: document.getElementById('explosion-flash'),
    errorToast: document.getElementById('error-toast'),
    historyModal: document.getElementById('history-modal'),
    historyList: document.getElementById('history-list')
};

// INITIALIZATION
document.addEventListener('DOMContentLoaded', () => {
    setupEventListeners();
});

function setupEventListeners() {
    // Buttons
    buttons.createRoom.addEventListener('click', onCreateRoom);
    buttons.joinRoom.addEventListener('click', onJoinRoom);
    buttons.startGame.addEventListener('click', onStartGame);
    buttons.addBot.addEventListener('click', onAddBot);
    buttons.deployConfirm.addEventListener('click', onDeployConfirm);
    buttons.confirmRole.addEventListener('click', onConfirmRoleReveal);
    buttons.restart.addEventListener('click', onRestart);
    buttons.viewBoard.addEventListener('click', onViewBoard);
    buttons.showSummary.addEventListener('click', onShowSummary);
    buttons.exitLobby.addEventListener('click', onExitLobby);
    buttons.openHistory.addEventListener('click', onOpenHistory);
    buttons.closeHistory.addEventListener('click', onCloseHistory);
    
    // Inputs (Enter key triggers)
    inputs.roomCode.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') onJoinRoom();
    });

    // Peek Role functionality (Press and Hold to prevent screen-sniping)
    buttons.revealRole.addEventListener('mousedown', showRoleCard);
    buttons.revealRole.addEventListener('touchstart', (e) => {
        e.preventDefault();
        showRoleCard();
    });
    
    document.addEventListener('mouseup', hideRoleCard);
    document.addEventListener('touchend', hideRoleCard);
    buttons.revealRole.addEventListener('mouseleave', hideRoleCard);
}

// ACTION HANDLERS
function onCreateRoom() {
    AudioSynth.playTick();
    const name = inputs.name.value.trim();
    if (!name) {
        showError('請先輸入你的名字。');
        return;
    }
    currentName = name;
    socket.emit('createRoom', { name });
}

function onJoinRoom() {
    AudioSynth.playTick();
    const name = inputs.name.value.trim();
    const code = inputs.roomCode.value.trim();
    if (!name) {
        showError('請先輸入你的名字。');
        return;
    }
    if (!code) {
        showError('請輸入 4 位房間代碼。');
        return;
    }
    currentName = name;
    currentRoomCode = code.toUpperCase();
    socket.emit('joinRoom', { name, roomCode: currentRoomCode });
}

function onStartGame() {
    AudioSynth.playTick();
    if (isHost) {
        socket.emit('startGame');
    }
}

function onAddBot() {
    AudioSynth.playTick();
    if (isHost) {
        socket.emit('addBot');
    }
}

function onConfirmRoleReveal() {
    AudioSynth.playTick();
    displays.roleRevealModal.classList.remove('active');
    socket.emit('confirmRoleReveal');
}

function onDeployConfirm() {
    AudioSynth.playTick();
    displays.deployModal.classList.remove('active');
    socket.emit('deployCards');
}

function onRestart() {
    AudioSynth.playTick();
    displays.gameOverModal.classList.remove('active');
    displays.gameOverModal.classList.remove('minimized');
    buttons.showSummary.style.display = 'none';
    socket.emit('restartGame');
}

function onExitLobby() {
    AudioSynth.playTick();
    location.reload();
}

function onViewBoard() {
    AudioSynth.playTick();
    displays.gameOverModal.classList.add('minimized');
    buttons.showSummary.style.display = 'block';
}

function onShowSummary() {
    AudioSynth.playTick();
    displays.gameOverModal.classList.remove('minimized');
    buttons.showSummary.style.display = 'none';
}

function onOpenHistory() {
    AudioSynth.playTick();
    displays.historyList.innerHTML = '';
    
    if (latestState && latestState.history && latestState.history.length > 0) {
        const cutLogs = latestState.history.filter(h => h.type === 'cut' || h.text.includes('輪開始') || h.text.includes('獲勝'));
        if (cutLogs.length === 0) {
            displays.historyList.innerHTML = `<div style="text-align:center; color:rgba(245,238,220,0.4); padding:20px 0;">尚無剪線紀錄</div>`;
        } else {
            cutLogs.forEach(h => {
                const item = document.createElement('div');
                item.style.marginBottom = '8px';
                item.style.borderBottom = '1px dashed rgba(212,175,55,0.15)';
                item.style.paddingBottom = '4px';
                
                let color = 'var(--color-text-light)';
                if (h.text.includes('✅')) {
                    color = 'var(--color-good-blue)';
                } else if (h.text.includes('❌')) {
                    color = 'var(--color-safe-brown)';
                } else if (h.text.includes('💥') || h.text.includes('獲勝')) {
                    color = 'var(--color-bad-red)';
                } else if (h.text.includes('輪開始')) {
                    color = 'var(--color-brass)';
                    item.style.fontWeight = 'bold';
                }
                
                item.innerHTML = `<span style="color:${color};">${escapeHTML(h.text)}</span>`;
                displays.historyList.appendChild(item);
            });
        }
    } else {
        displays.historyList.innerHTML = `<div style="text-align:center; color:rgba(245,238,220,0.4); padding:20px 0;">尚無紀錄</div>`;
    }
    
    displays.historyModal.classList.add('active');
}

function onCloseHistory() {
    AudioSynth.playTick();
    displays.historyModal.classList.remove('active');
}

// ROLE CARD TOGGLE
function showRoleCard() {
    displays.roleCardFront.classList.remove('hidden');
    buttons.revealRole.classList.add('hidden');
}

function hideRoleCard() {
    displays.roleCardFront.classList.add('hidden');
    buttons.revealRole.classList.remove('hidden');
}

// ERROR TOAST
let errorTimeout = null;
function showError(msg) {
    displays.errorToast.textContent = msg;
    displays.errorToast.classList.add('active');
    
    if (errorTimeout) clearTimeout(errorTimeout);
    errorTimeout = setTimeout(() => {
        displays.errorToast.classList.remove('active');
    }, 4000);
}

// VIEW NAVIGATION
function switchView(viewName) {
    Object.values(views).forEach(v => v.classList.remove('active'));
    views[viewName].classList.add('active');
}

// SOCKET RECEPTORS
socket.on('connect', () => {
    myId = socket.id;
    console.log(`已連線伺服器。ID: ${myId}`);
});

socket.on('errorMsg', (msg) => {
    showError(msg);
});

socket.on('roomCreated', (code) => {
    currentRoomCode = code;
    isHost = true;
    switchView('waiting');
});

socket.on('kicked', () => {
    alert('你已被房主剔除出房間。');
    location.reload();
});

// SOUND LOGIC FOR STATE CHANGES
let previousCutsCount = 0;
let previousSuccessCablesCount = 0;
let previousGameEnded = false;
let previousSummaryRevealed = false;
let activeRoleModalRevealed = false; // Tracks if the stamp animation has run in this round

socket.on('roomUpdate', (state) => {
    latestState = state;
    console.log('Room state updated:', state);
    
    // Update local variables
    const me = state.players.find(p => p.id === myId);
    if (me) {
        isHost = me.host;
        if (me.role) {
            displays.roleCardFront.className = `role-card-front ${me.role.toLowerCase()}`;
            displays.roleBadgeText.textContent = me.role === 'Sherlock' ? '大偵探 (藍隊)' : '莫里亞蒂 (紅隊)';
        }
    }

    // Determine current view
    if (!state.gameStarted) {
        switchView('waiting');
        renderWaitingRoom(state);
        activeRoleModalRevealed = false; // Reset role animation lock
        
        // Explicitly clear game-over modal state on return to lobby
        displays.gameOverModal.classList.remove('active');
        displays.gameOverModal.classList.remove('minimized');
        buttons.showSummary.style.display = 'none';
        displays.handMemoText.textContent = '無';
    } else {
        switchView('game');
        
        // CEREMONIAL ROLE REVEAL CHECK (at game start or when first assigned)
        if (me && me.role && !me.roleRevealed) {
            if (!activeRoleModalRevealed) {
                activeRoleModalRevealed = true;
                displays.roleRevealModal.classList.add('active');
                displays.rrStampBox.className = 'role-reveal-stamp-box';
                displays.rrRoleInfo.classList.add('hidden');

                const panel = displays.roleRevealModal.querySelector('.steampunk-panel');
                panel.className = 'modal-content steampunk-panel role-reveal-panel';

                if (me.role === 'Sherlock') {
                    panel.classList.add('sherlock-revealed');
                    displays.rrRoleTitle.textContent = '大偵探 (藍隊) 🔍';
                    displays.rrRoleDesc.textContent = '你是藍隊大偵探。與探員語音討論，找出所有成功引線以拆除炸彈！小心別剪到紅色引爆裝置。';
                } else {
                    panel.classList.add('moriarty-revealed');
                    displays.rrRoleTitle.textContent = '莫里亞蒂 (紅隊) 💥';
                    displays.rrRoleDesc.textContent = '你是紅隊莫里亞蒂。散布假線索，引誘大偵探剪斷引爆裝置，或拖延 4 輪時間以引爆炸彈！';
                }

                // Play stamp sound cue and trigger animations
                setTimeout(() => {
                    displays.rrStampBox.classList.add('stamped-out');
                    displays.rrRoleInfo.classList.remove('hidden');
                    AudioSynth.playSnip(); // simulated stamping heavy snap
                }, 1300);
            }
        } else {
            displays.roleRevealModal.classList.remove('active');
        }

        renderGameBoard(state, me);
    }
});

// RENDER: LOBBY
function renderWaitingRoom(state) {
    displays.roomCodeText.textContent = state.roomCode;
    displays.playerCount.textContent = state.players.length;
    
    displays.playersList.innerHTML = '';
    state.players.forEach(p => {
        const card = document.createElement('div');
        card.className = `player-lobby-card ${p.connected ? '' : 'disconnected'}`;
        
        let kickButtonHtml = '';
        if (isHost && p.id !== myId) {
            kickButtonHtml = `<button class="btn btn-brass" style="padding: 2px 8px; font-size: 0.75rem; margin-left: 10px; border-color: var(--color-bad-red); color: var(--color-bad-red); cursor: pointer;" onclick="kickPlayer('${p.id}')">剔除</button>`;
        }
        
        card.innerHTML = `
            <div class="player-info">
                <span class="player-name">${escapeHTML(p.name)}</span>
                ${p.isBot ? '<span class="host-badge" style="background:rgba(205,127,50,0.8);color:#fff;">AI</span>' : ''}
                ${p.host ? '<span class="host-badge">房主</span>' : ''}
                ${p.id === myId ? '<span class="host-badge" style="background:#00bcd4;color:#fff;">你</span>' : ''}
                ${kickButtonHtml}
            </div>
            <div class="conn-status"></div>
        `;
        displays.playersList.appendChild(card);
    });

    if (isHost) {
        buttons.startGame.style.display = 'block';
        buttons.addBot.style.display = state.players.length < 8 ? 'block' : 'none';
        if (state.players.length >= 4) {
            buttons.startGame.classList.remove('disabled');
            buttons.startGame.disabled = false;
            displays.lobbyStatusMsg.textContent = '已集齊最少人數，隨時可以開始任務！';
            displays.lobbyStatusMsg.style.color = '#4cd964';
        } else {
            buttons.startGame.classList.add('disabled');
            buttons.startGame.disabled = true;
            displays.lobbyStatusMsg.textContent = `還需至少 ${4 - state.players.length} 名探員加入。`;
            displays.lobbyStatusMsg.style.color = '#cd7f32';
        }
    } else {
        buttons.startGame.style.display = 'none';
        buttons.addBot.style.display = 'none';
        displays.lobbyStatusMsg.textContent = '等待房主開始部署任務...';
        displays.lobbyStatusMsg.style.color = '#d4af37';
    }
}

// Global Declaration adjuster (called via inline onclick)
window.adjustDeclaration = function(delta, maxCards) {
    const successEl = document.getElementById('self-dec-success');
    if (!successEl) return;
    
    let success = parseInt(successEl.textContent) || 0;
    success = Math.max(0, success + delta);
    
    if (success > maxCards) {
        showError(`宣告數量不能超過目前手牌數（${maxCards}張）！`);
        return;
    }
    
    successEl.textContent = success;
    socket.emit('declareHand', { successDeclared: success });
};

// Global confirm declaration trigger
window.confirmSelfDeclaration = function() {
    AudioSynth.playTick();
    socket.emit('confirmDeclaration');
};

// Global start next round trigger (Host only)
window.startNextRound = function() {
    AudioSynth.playTick();
    socket.emit('startNextRound');
};

// Global kick player trigger (Host only)
window.kickPlayer = function(targetId) {
    AudioSynth.playTick();
    if (confirm('確定要將該探員/機器人剔除出房間嗎？')) {
        socket.emit('kickPlayer', { targetId });
    }
};

// Global reveal summary trigger (Host only)
window.revealSummary = function() {
    AudioSynth.playTick();
    socket.emit('revealSummary');
};

// RENDER: GAME
function renderGameBoard(state, me) {
    // 0. Update Hand Memo Dashboard
    if (me && me.initialHand && me.initialHand.length > 0) {
        const successCount = me.initialHand.filter(t => t === 'success').length;
        const bombCount = me.initialHand.filter(t => t === 'bomb').length;
        const safeCount = me.initialHand.filter(t => t === 'safe').length;
        
        const parts = [];
        if (successCount > 0) parts.push(`✅ ${successCount}`);
        if (safeCount > 0) parts.push(`❌ ${safeCount}`);
        if (bombCount > 0) parts.push(`💥 ${bombCount}`);
        
        displays.handMemoText.innerHTML = parts.join(' | ');
    } else {
        displays.handMemoText.textContent = '無';
    }

    // 1. Dashboard Wires Progress bars
    const progressPercent = (state.successCablesCut / state.successCablesTotal) * 100;
    displays.progressBar.style.width = `${progressPercent}%`;
    displays.progressText.textContent = `${state.successCablesCut} / ${state.successCablesTotal}`;
    
    const safePercent = state.safeWiresTotal > 0 ? (state.safeWiresCut / state.safeWiresTotal) * 100 : 0;
    displays.safeProgressBar.style.width = `${safePercent}%`;
    displays.safeProgressText.textContent = `${state.safeWiresCut} / ${state.safeWiresTotal}`;

    // Valves (Rounds)
    document.querySelectorAll('.valve').forEach(valve => {
        const rnd = parseInt(valve.dataset.round);
        valve.className = 'valve';
        if (rnd === state.round) {
            valve.classList.add('active');
        } else if (rnd < state.round) {
            valve.classList.add('past');
        }
    });

    displays.cutsRemainingVal.textContent = state.cutsRemaining;
    displays.cutsTotalVal.textContent = state.players.length;

    // 2. Sound cues tracking
    const cutsDone = state.players.length - state.cutsRemaining;
    if (state.cutsRemaining !== previousCutsCount && previousCutsCount !== 0) {
        AudioSynth.playSnip();
    }
    previousCutsCount = state.cutsRemaining;

    if (state.successCablesCut > previousSuccessCablesCount) {
        setTimeout(() => AudioSynth.playSuccessChime(), 180);
    }
    previousSuccessCablesCount = state.successCablesCut;

    // 3. Phase banner updates
    let banner = document.getElementById('phase-banner');
    if (!banner) {
        banner = document.createElement('div');
        banner.id = 'phase-banner';
        banner.className = 'phase-banner';
        const gameLayout = views.game.querySelector('.game-layout');
        if (gameLayout) {
            views.game.insertBefore(banner, gameLayout);
        }
    }

    if (state.roundPhase === 'deploying') {
        banner.textContent = '【 部署階段 】 請等待所有探員查看並背面朝上部署引線...';
        banner.style.borderColor = 'var(--color-bronze)';
        banner.style.background = 'rgba(184, 115, 51, 0.08)';
    } else if (state.roundPhase === 'declaring') {
        const hasBots = state.players.some(p => p.isBot);
        if (hasBots) {
            banner.textContent = `【 宣告階段 】 請向大家宣告你的手牌！剩餘時間：${state.declarationTimer} 秒 (全體真人完成宣告可提早結束)`;
        } else {
            banner.textContent = '【 宣告階段 】 請向大家宣告你的手牌！等待所有探員完成宣告...';
        }
        banner.style.borderColor = 'var(--color-brass)';
        banner.style.background = 'rgba(212, 175, 55, 0.08)';
    } else if (state.roundPhase === 'cutting') {
        const activeCutter = state.players.find(p => p.id === state.cutterOwnerId);
        const cutterName = activeCutter ? activeCutter.name : '未知';
        banner.innerHTML = `【 剪線階段 】 剪線鉗目前由 <strong style="color:var(--color-brass);">${escapeHTML(cutterName)}</strong> 持有！`;
        banner.style.borderColor = 'var(--color-good-blue)';
        banner.style.background = 'rgba(0, 188, 212, 0.05)';
    } else if (state.roundPhase === 'round_ending') {
        const nextRnd = state.round + 1;
        if (me && me.host) {
            banner.innerHTML = `【 輪次結束 】 本輪剪線已耗盡！請檢查翻牌結果。 <button class="btn btn-gold" style="padding: 4px 12px; font-size: 0.8rem; margin-left: 15px;" onclick="startNextRound()">開啟第 ${nextRnd} 輪任務</button>`;
        } else {
            banner.textContent = `【 輪次結束 】 本輪剪線已耗盡！請檢查翻牌結果。等待房主開啟第 ${nextRnd} 輪...`;
        }
        banner.style.borderColor = 'var(--color-bad-red)';
        banner.style.background = 'rgba(238, 76, 64, 0.08)';
    }

    if (state.gameEnded) {
        if (!state.summaryRevealed) {
            if (me && me.host) {
                banner.innerHTML = `【 遊戲結束 】 任務已達成終局！請確認桌面最後翻牌結果。 <button class="btn btn-gold" style="padding: 4px 12px; font-size: 0.8rem; margin-left: 15px;" onclick="revealSummary()">揭曉最終結算報告</button>`;
            } else {
                banner.textContent = '【 遊戲結束 】 任務已達成終局！請確認桌面最後翻牌結果。等待房主點擊揭曉結算...';
            }
            banner.style.borderColor = 'var(--color-brass)';
            banner.style.background = 'rgba(212, 175, 55, 0.08)';
        } else {
            banner.textContent = '【 任務結算 】 最終任務報告已揭曉。';
            banner.style.borderColor = 'var(--color-bronze)';
            banner.style.background = 'rgba(184, 115, 51, 0.08)';
        }
    }

    // 4. Render players cards board ring
    displays.playersRing.innerHTML = '';
    const hasWireCutter = state.cutterOwnerId === myId;
    
    state.players.forEach(p => {
        const cardFrame = document.createElement('div');
        cardFrame.className = 'player-game-card';
        if (p.id === state.cutterOwnerId) cardFrame.classList.add('has-cutter');
        if (p.id === myId) cardFrame.classList.add('self-card');
        if (!p.connected) cardFrame.classList.add('disconnected');

        // Status label
        let statusText = '';
        if (state.roundPhase === 'deploying') {
            statusText = p.readyToDeploy ? '<span class="pg-status-badge ready">已部署</span>' : '<span class="pg-status-badge waiting">檢查中...</span>';
        } else {
            statusText = p.connected ? '' : '<span class="pg-status-badge waiting" style="color:var(--color-bad-red)">失去連線</span>';
        }

        const headerDiv = document.createElement('div');
        headerDiv.className = 'pg-header';
        headerDiv.innerHTML = `
            <span class="pg-name">${escapeHTML(p.name)} ${p.id === myId ? '(你)' : ''}</span>
            ${statusText}
        `;
        cardFrame.appendChild(headerDiv);

        const cardsRow = document.createElement('div');
        cardsRow.className = 'pg-cards-row';

        p.cards.forEach((c, idx) => {
            const wire = document.createElement('div');
            wire.className = 'wire-card';
            
            if (c.revealed) {
                wire.classList.add('flipped');
            }

            // High intensity glow effect for the card that was just cut
            const isJustCut = state.lastCutPlayerId === p.id && state.lastCutCardIndex === idx;
            if (isJustCut) {
                wire.classList.add('just-cut');
            }

            // Cutter rules
            const allowedToCut = hasWireCutter && p.id !== myId && state.roundPhase === 'cutting' && !c.revealed && !state.gameEnded;
            if (allowedToCut) {
                wire.classList.add('can-cut');
                wire.addEventListener('click', () => {
                    socket.emit('makeCut', { targetPlayerId: p.id, cardIndex: idx });
                });
            }

            // Card Inner structure
            let cardFrontClass = 'safe';
            let iconText = '❌';
            if (c.type === 'success') {
                cardFrontClass = 'success';
                iconText = '✅';
            } else if (c.type === 'bomb') {
                cardFrontClass = 'bomb';
                iconText = '💥';
            }

            wire.innerHTML = `
                <div class="wire-card-inner">
                    <div class="wire-card-back">✂️</div>
                    <div class="wire-card-front ${cardFrontClass}">
                        <div class="icon">${iconText}</div>
                    </div>
                </div>
            `;
            cardsRow.appendChild(wire);
        });

        cardFrame.appendChild(cardsRow);

        // Render hand declarations
        const decDiv = document.createElement('div');
        if (p.id === myId) {
            decDiv.className = 'pg-declaration self-dec';
            const maxCards = 5 - (state.round - 1);
            
            const canAdjust = state.roundPhase === 'declaring' && !p.readyToDeclare;
            
            let btnConfirmHtml = '';
            if (state.roundPhase === 'declaring') {
                if (p.readyToDeclare) {
                    btnConfirmHtml = `<span style="color:#4cd964;font-weight:bold;font-size:0.8rem;">✓ 宣告已確認</span>`;
                } else {
                    btnConfirmHtml = `<button class="btn btn-brass" style="padding:4px 10px;font-size:0.75rem;" onclick="confirmSelfDeclaration()">確認宣告</button>`;
                }
            } else if (state.roundPhase === 'cutting') {
                btnConfirmHtml = `<span style="color:rgba(245,238,220,0.4);font-size:0.75rem;">🔒 宣告已鎖定</span>`;
            } else {
                btnConfirmHtml = `<span style="color:rgba(245,238,220,0.4);font-size:0.75rem;">等待部署...</span>`;
            }

            decDiv.innerHTML = `
                <span class="dec-label">申報成功引線：</span>
                <div class="dec-counter-row">
                    <div class="dec-counter">
                        <span class="dec-icon">✅</span>
                        ${canAdjust ? `<button class="dec-btn" onclick="adjustDeclaration(-1, ${maxCards})">-</button>` : ''}
                        <span class="dec-num" id="self-dec-success">${p.successDeclared || 0}</span>
                        ${canAdjust ? `<button class="dec-btn" onclick="adjustDeclaration(1, ${maxCards})">+</button>` : ''}
                    </div>
                </div>
                <div class="dec-action-row" style="margin-top:6px;width:100%;text-align:center;">
                    ${btnConfirmHtml}
                </div>
            `;
        } else {
            decDiv.className = 'pg-declaration';
            let readyBadge = '';
            let valDisplay = '';
            if (state.roundPhase === 'declaring') {
                readyBadge = p.readyToDeclare ? ' <span style="color:#4cd964;font-size:0.7rem;">(已確認)</span>' : ' <span style="color:var(--color-copper);font-size:0.7rem;">(宣告中...)</span>';
                valDisplay = '❓'; // Hide value during declaring phase
            } else {
                valDisplay = `✅ ${p.successDeclared || 0}`; // Reveal when phase is cutting or later
            }
            decDiv.innerHTML = `
                <span class="dec-label">宣告：</span>
                <span class="dec-val">${valDisplay}</span>
                ${readyBadge}
            `;
        }
        cardFrame.appendChild(decDiv);

        displays.playersRing.appendChild(cardFrame);
    });

    // 5. Secret Wires Preview (Deploy modal)
    if (me && me.secretHand && !me.readyToDeploy && me.roleRevealed) {
        displays.deployModal.classList.add('active');
        displays.secretWiresReveal.innerHTML = '';
        
        me.secretHand.forEach(type => {
            const card = document.createElement('div');
            let cardClass = 'safe';
            let icon = '❌';
            let label = '安全引線';
            
            if (type === 'success') {
                cardClass = 'success';
                icon = '✅';
                label = '成功引線';
            } else if (type === 'bomb') {
                cardClass = 'bomb';
                icon = '💥';
                label = '引爆裝置';
            }

            card.className = `modal-wire-card ${cardClass}`;
            card.innerHTML = `
                <span class="card-val-name">${label}</span>
                <span class="icon">${icon}</span>
            `;
            displays.secretWiresReveal.appendChild(card);
        });
    } else {
        displays.deployModal.classList.remove('active');
    }

    // 6. Game Over displays
    if (state.gameEnded && state.summaryRevealed) {
        if (!displays.gameOverModal.classList.contains('minimized')) {
            displays.gameOverModal.classList.add('active');
        }
        
        if (state.winnerTeam === 'Sherlock') {
            displays.gameOverContent.className = 'modal-content steampunk-panel game-over-panel sherlock-win';
            displays.gameOverTitle.textContent = '任務順利完成';
            displays.gameOverSubtitle.textContent = '大偵探小隊成功解出了炸彈！';
        } else {
            displays.gameOverContent.className = 'modal-content steampunk-panel game-over-panel moriarty-win';
            displays.gameOverTitle.textContent = '炸彈引爆';
            if (state.boobyTrapCut) {
                displays.gameOverSubtitle.textContent = '莫里亞蒂小隊獲勝！有人剪斷了引爆線！';
            } else {
                displays.gameOverSubtitle.textContent = '莫里亞蒂小隊獲勝！時間耗盡，炸彈爆炸。';
            }
        }

        displays.finalRolesList.innerHTML = '';
        state.players.forEach(p => {
            const row = document.createElement('div');
            row.className = `final-player-card ${p.role === 'Sherlock' ? 'sherlock-role' : 'moriarty-role'}`;
            row.innerHTML = `
                <span class="name">${escapeHTML(p.name)}</span>
                <span class="role">${p.role === 'Sherlock' ? '大偵探' : '莫里亞蒂'}</span>
            `;
            displays.finalRolesList.appendChild(row);
        });

        if (isHost) {
            buttons.restart.style.display = 'block';
            buttons.restart.querySelector('span').textContent = '再玩一局';
        } else {
            buttons.restart.style.display = 'none';
        }
    } else {
        displays.gameOverModal.classList.remove('active');
        displays.gameOverModal.classList.remove('minimized');
        buttons.showSummary.style.display = 'none';
    }

    // Play immediate sound cues and flash on game end transition
    if (state.gameEnded && !previousGameEnded) {
        if (state.winnerTeam === 'Sherlock') {
            AudioSynth.playVictoryFanfare();
        } else {
            AudioSynth.playExplosion();
            displays.explosionFlash.classList.add('explosion-trigger');
            setTimeout(() => {
                displays.explosionFlash.classList.remove('explosion-trigger');
            }, 1000);
        }
    }

    previousGameEnded = state.gameEnded;
    previousSummaryRevealed = state.summaryRevealed;
    isFirstUpdate = false;

    // 7. Action ticker updates
    renderFeeds(state);
}

// RENDER: TICKER LOG
function renderFeeds(state) {
    const tickerText = document.getElementById('ticker-text');
    if (tickerText && state.history && state.history.length > 0) {
        const actions = state.history.filter(h => h.type === 'system' || h.type === 'cut');
        if (actions.length > 0) {
            const latestAction = actions[actions.length - 1];
            tickerText.textContent = latestAction.text;
        }
    }
}

// HELPERS
function escapeHTML(str) {
    if (!str) return '';
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}
