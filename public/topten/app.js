// Client-side interactions for TopTen (天才猜心王)

const socket = io();

// AUDIO SYNTHESIS ENGINE (Web Audio API)
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
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(500, this.ctx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(10, this.ctx.currentTime + 0.06);
        gain.gain.setValueAtTime(0.15, this.ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 0.06);
        osc.connect(gain);
        gain.connect(this.ctx.destination);
        osc.start();
        osc.stop(this.ctx.currentTime + 0.06);
    },
    
    playValve() {
        this.init();
        if (this.ctx.state === 'suspended') this.ctx.resume();
        
        const bufferSize = this.ctx.sampleRate * 0.15;
        const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < bufferSize; i++) {
            data[i] = Math.random() * 2 - 1;
        }
        
        const noise = this.ctx.createBufferSource();
        noise.buffer = buffer;
        
        const filter = this.ctx.createBiquadFilter();
        filter.type = 'bandpass';
        filter.frequency.value = 1000;
        
        const gain = this.ctx.createGain();
        gain.gain.setValueAtTime(0.08, this.ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 0.15);
        
        noise.connect(filter);
        filter.connect(gain);
        gain.connect(this.ctx.destination);
        noise.start();
    },

    playErrorBuzzer() {
        this.init();
        if (this.ctx.state === 'suspended') this.ctx.resume();
        
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(130, this.ctx.currentTime);
        osc.frequency.linearRampToValueAtTime(80, this.ctx.currentTime + 0.35);
        gain.gain.setValueAtTime(0.25, this.ctx.currentTime);
        gain.gain.linearRampToValueAtTime(0.001, this.ctx.currentTime + 0.35);
        osc.connect(gain);
        gain.connect(this.ctx.destination);
        osc.start();
        osc.stop(this.ctx.currentTime + 0.35);
    }
};

// STEAM PARTICLES CANVAS EFFECT
const SteamCanvas = {
    canvas: null,
    ctx: null,
    particles: [],
    
    init() {
        this.canvas = document.getElementById('steam-canvas');
        if (!this.canvas) return;
        this.ctx = this.canvas.getContext('2d');
        this.resize();
        window.addEventListener('resize', () => this.resize());
        
        for (let i = 0; i < 15; i++) {
            this.particles.push(this.createParticle(true));
        }
        this.animate();
    },
    
    resize() {
        this.canvas.width = window.innerWidth;
        this.canvas.height = window.innerHeight;
    },
    
    createParticle(randomY = false) {
        return {
            x: Math.random() * this.canvas.width,
            y: randomY ? Math.random() * this.canvas.height : this.canvas.height + 20,
            size: 30 + Math.random() * 60,
            speedY: -0.4 - Math.random() * 0.8,
            speedX: (Math.random() - 0.5) * 0.3,
            alpha: 0.05 + Math.random() * 0.15,
            expand: 0.05 + Math.random() * 0.08
        };
    },
    
    animate() {
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        
        this.particles.forEach((p, idx) => {
            p.y += p.speedY;
            p.x += p.speedX;
            p.size += p.expand;
            
            this.ctx.beginPath();
            const grad = this.ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.size);
            grad.addColorStop(0, `rgba(139, 90, 43, ${p.alpha})`);
            grad.addColorStop(0.5, `rgba(74, 50, 30, ${p.alpha * 0.4})`);
            grad.addColorStop(1, 'rgba(0,0,0,0)');
            this.ctx.fillStyle = grad;
            this.ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
            this.ctx.fill();
            
            if (p.y < -p.size || p.x < -p.size || p.x > this.canvas.width + p.size) {
                this.particles[idx] = this.createParticle();
            }
        });
        requestAnimationFrame(() => this.animate());
    }
};

// DOM SELECTORS
const displays = {
    loginView: document.getElementById('login-view'),
    waitingView: document.getElementById('waiting-view'),
    gameView: document.getElementById('game-view'),
    
    displayRoomCode: document.getElementById('display-room-code'),
    playerCount: document.getElementById('player-count'),
    lobbyPlayersList: document.getElementById('lobby-players-list'),
    lobbyStatusMsg: document.getElementById('lobby-status-msg'),
    
    // Dashboard indicators
    phase: document.getElementById('display-phase'),
    activePlayer: document.getElementById('display-active-player'),
    lives: document.getElementById('display-lives'),
    roundNum: document.getElementById('display-round-num'),
    
    tickerText: document.getElementById('ticker-text'),
    gameTable: document.getElementById('game-table'),
    
    // Topic card details
    topicQuestion: document.getElementById('topic-question'),
    topicMinDesc: document.getElementById('topic-min-desc'),
    topicMaxDesc: document.getElementById('topic-max-desc'),
    btnSkipTopic: document.getElementById('btn-skip-topic'),
    
    // Pressure Gauge
    gaugeNeedle: document.getElementById('gauge-needle'),
    gaugeLivesVal: document.getElementById('gauge-lives-val'),
    
    // Panels
    panelAnswering: document.getElementById('panel-answering'),
    mySecretNumber: document.getElementById('my-secret-number'),
    inputAnswerText: document.getElementById('input-answer-text'),
    btnSubmitAnswer: document.getElementById('btn-submit-answer'),
    
    panelSorting: document.getElementById('panel-sorting'),
    sortingHintText: document.getElementById('sorting-hint-text'),
    
    panelResult: document.getElementById('panel-result'),
    btnNextRound: document.getElementById('btn-next-round'),
    
    panelSpectating: document.getElementById('panel-spectating'),
    
    // Modals
    resultModal: document.getElementById('result-modal'),
    resultBadge: document.getElementById('result-badge'),
    resultDetails: document.getElementById('result-details'),
    btnResultReady: document.getElementById('btn-result-ready'),
    
    gameOverModal: document.getElementById('game-over-modal'),
    gameOverSubtitle: document.getElementById('game-over-subtitle'),
    finalScoresList: document.getElementById('final-scores-list'),
    btnExitLobby: document.getElementById('btn-exit-lobby'),
    errorToast: document.getElementById('error-toast'),
    
    // Custom topic controls
    btnCustomTopic: document.getElementById('btn-custom-topic'),
    customTopicModal: document.getElementById('custom-topic-modal'),
    inputCustomQuestion: document.getElementById('input-custom-question'),
    inputCustomMin: document.getElementById('input-custom-min'),
    inputCustomMax: document.getElementById('input-custom-max'),
    btnCustomCancel: document.getElementById('btn-custom-cancel'),
    btnCustomSubmit: document.getElementById('btn-custom-submit')
};

const buttons = {
    createRoom: document.getElementById('btn-create-room'),
    joinRoom: document.getElementById('btn-join-room'),
    addBot: document.getElementById('btn-add-bot'),
    startGame: document.getElementById('btn-start-game')
};

const inputs = {
    nickname: document.getElementById('input-nickname'),
    roomCode: document.getElementById('input-room-code')
};

// STATE VARIABLES
let myId = null;
let latestState = null;
let isSubmittingAnswer = false;

// VIEW SWITCHER
function switchView(viewName) {
    displays.loginView.classList.remove('active');
    displays.waitingView.classList.remove('active');
    displays.gameView.classList.remove('active');
    
    if (viewName === 'login') displays.loginView.classList.add('active');
    else if (viewName === 'waiting') displays.waitingView.classList.add('active');
    else if (viewName === 'game') displays.gameView.classList.add('active');
}

// TOAST ERROR NOTIFICATION
function showError(msg) {
    displays.errorToast.textContent = msg;
    displays.errorToast.classList.add('active');
    setTimeout(() => {
        displays.errorToast.classList.remove('active');
    }, 3000);
}

// RENDER LOBBY WAITING ROOM
function renderWaitingRoom(state) {
    displays.displayRoomCode.textContent = state.roomCode;
    displays.playerCount.textContent = state.players.length;
    displays.lobbyPlayersList.innerHTML = '';
    
    state.players.forEach(p => {
        const li = document.createElement('li');
        if (p.id === socket.id) li.classList.add('is-me');
        if (p.host) li.classList.add('is-host');
        
        const nameSpan = document.createElement('span');
        nameSpan.className = 'player-name';
        nameSpan.textContent = p.name;
        if (p.id === socket.id) nameSpan.textContent += ' (你)';
        li.appendChild(nameSpan);
        
        const badgeAndActionContainer = document.createElement('div');
        badgeAndActionContainer.style.display = 'flex';
        badgeAndActionContainer.style.alignItems = 'center';
        badgeAndActionContainer.style.gap = '8px';

        if (p.host) {
            const badgeSpan = document.createElement('span');
            badgeSpan.className = 'badge badge-host';
            badgeSpan.textContent = '工坊主';
            badgeAndActionContainer.appendChild(badgeSpan);
        } else if (p.isBot) {
            const badgeSpan = document.createElement('span');
            badgeSpan.className = 'badge badge-bot';
            badgeSpan.textContent = 'AI';
            badgeAndActionContainer.appendChild(badgeSpan);
        }

        // If I am the host and this player is not me, render a kick button!
        const me = state.players.find(pl => pl.id === socket.id);
        const isHost = me ? me.host : false;
        if (isHost && p.id !== socket.id) {
            const kickBtn = document.createElement('button');
            kickBtn.className = 'btn btn-brass';
            kickBtn.style.padding = '2px 8px';
            kickBtn.style.fontSize = '0.72rem';
            kickBtn.style.height = 'auto';
            kickBtn.innerHTML = '<span>剔除</span>';
            kickBtn.addEventListener('click', () => {
                AudioSynth.playTick();
                socket.emit('kickPlayer', { targetId: p.id });
            });
            badgeAndActionContainer.appendChild(kickBtn);
        }
        
        li.appendChild(badgeAndActionContainer);
        displays.lobbyPlayersList.appendChild(li);
    });
    
    const me = state.players.find(p => p.id === socket.id);
    const isHost = me ? me.host : false;
    
    if (isHost) {
        buttons.addBot.style.display = 'block';
        buttons.startGame.style.display = 'block';
        displays.lobbyStatusMsg.textContent = '你是工坊主！你可以新增機器人或開始對局。';
        
        if (state.players.length >= 4) {
            buttons.startGame.classList.remove('disabled');
            buttons.startGame.removeAttribute('disabled');
        } else {
            buttons.startGame.classList.add('disabled');
            buttons.startGame.setAttribute('disabled', 'true');
            displays.lobbyStatusMsg.textContent = '任務需要至少 4 名探員才可解鎖。';
        }
    } else {
        buttons.addBot.style.display = 'none';
        buttons.startGame.style.display = 'none';
        displays.lobbyStatusMsg.textContent = '等待工坊主開始任務部署...';
    }
}

// RENDER MAIN GAME BOARD
function renderGameBoard(state, me) {
    latestState = state;
    const isHost = me && me.host;
    
    // ----------------------------------------------------
    // 1. UPDATE DASHBOARD & TARIFF TEXT
    // ----------------------------------------------------
    let phaseStr = '準備中';
    if (state.roundPhase === 'answering') phaseStr = '思考回答中';
    else if (state.roundPhase === 'sorting') phaseStr = '隊長排序中';
    else if (state.roundPhase === 'revealing_complete') phaseStr = '翻牌結算';
    else if (state.roundPhase === 'round_result') phaseStr = '回合結束';
    else if (state.roundPhase === 'game_over') phaseStr = '遊戲結束';
    
    displays.phase.textContent = phaseStr;
    displays.roundNum.textContent = `${state.currentRound} / ${state.totalRounds}`;
    displays.lives.textContent = `${state.lives} ❤️`;
    
    const captain = state.players.find(p => p.id === state.players[state.captainIndex].id);
    displays.activePlayer.textContent = captain ? captain.name : '-';
    
    // Pressure Gauge Needle
    // 8 lives = 90deg, 0 lives = -90deg
    const needleDeg = (state.lives * 22.5) - 90;
    displays.gaugeNeedle.style.transform = `rotate(${needleDeg}deg)`;
    displays.gaugeLivesVal.textContent = state.lives;
    
    // Update Topic Card Elements
    if (state.currentTopic) {
        displays.topicQuestion.textContent = state.currentTopic.question;
        displays.topicMinDesc.textContent = state.currentTopic.minDescription;
        displays.topicMaxDesc.textContent = state.currentTopic.maxDescription;
    }
    
    // ----------------------------------------------------
    // 2. RENDER PLAYER CIRCLE SEATS
    // ----------------------------------------------------
    // Clear old dynamic player boxes (except center-dial)
    const boxes = displays.gameTable.querySelectorAll('.player-box');
    boxes.forEach(b => b.remove());
    
    // Sort players so local player is always centered at the bottom (angle: PI/2)
    const myIndex = state.players.findIndex(p => p.id === socket.id);
    const orderedPlayers = [];
    if (myIndex !== -1) {
        for (let i = 0; i < state.players.length; i++) {
            orderedPlayers.push(state.players[(myIndex + i) % state.players.length]);
        }
    } else {
        orderedPlayers.push(...state.players);
    }
    
    const N = orderedPlayers.length;
    const R_percent = 36; // Radius of circular table
    
    const isSortingPhase = state.roundPhase === 'sorting';
    const isMeCaptain = captain && captain.id === socket.id;
    
    orderedPlayers.forEach((p, idx) => {
        const box = document.createElement('div');
        box.className = 'player-box';
        
        // Seat placement angle
        const angle = (Math.PI / 2) + (idx * (2 * Math.PI / N));
        const x = 50 + R_percent * Math.cos(angle);
        const y = 50 + R_percent * Math.sin(angle);
        box.style.left = `${x}%`;
        box.style.top = `${y}%`;
        box.style.transform = 'translate(-50%, -50%)';
        
        if (state.roundPhase === 'sorting' && state.activePlayerId === p.id) {
            box.classList.add('active-player');
        }
        
        // Name Row (Name + Badges)
        const nameRow = document.createElement('div');
        nameRow.className = 'player-name-row';
        
        const nameSpan = document.createElement('span');
        nameSpan.className = 'player-name';
        nameSpan.textContent = p.name;
        if (p.id === socket.id) nameSpan.textContent += ' (你)';
        nameRow.appendChild(nameSpan);
        
        const badgesDiv = document.createElement('div');
        badgesDiv.className = 'player-badges';
        
        if (p.id === captain.id) {
            const b = document.createElement('span');
            b.className = 'badge badge-captain';
            b.textContent = '隊長';
            badgesDiv.appendChild(b);
        }
        if (p.hasAnswered && state.roundPhase === 'answering') {
            const b = document.createElement('span');
            b.className = 'badge badge-answered';
            b.textContent = '已回答';
            badgesDiv.appendChild(b);
        }
        
        nameRow.appendChild(badgesDiv);
        box.appendChild(nameRow);
        
        // Render TopTen card
        const card = document.createElement('div');
        card.className = 'topten-card';
        if (p.id === socket.id) card.classList.add('my-card');
        
        if (p.isRevealed) {
            card.classList.add('revealed');
            card.textContent = p.cardNumber;
        } else if (p.id === socket.id && p.cardNumber !== null) {
            // Local player sees their own card number in covered status
            card.textContent = p.cardNumber;
        } else {
            card.textContent = '❓';
        }
        box.appendChild(card);
        
        // Render Answer text speech bubble
        const bubble = document.createElement('div');
        bubble.className = 'answer-bubble';
        
        if (state.roundPhase === 'answering') {
            if (p.hasAnswered) {
                if (p.id === socket.id) {
                    bubble.textContent = p.answerText;
                } else {
                    bubble.textContent = '📝 已提交答案';
                }
            } else {
                bubble.classList.add('waiting-text');
                bubble.textContent = '正在思考描述...';
            }
        } else {
            // sorting, result, game_over
            bubble.textContent = p.answerText || '(無回答)';
        }
        box.appendChild(bubble);
        
        // If sorting phase, and I am the captain, and target player card is not yet revealed
        if (isSortingPhase && isMeCaptain && !p.isRevealed) {
            box.classList.add('sort-targetable');
            box.addEventListener('click', () => {
                AudioSynth.playValve();
                socket.emit('topten_revealPlayer', { targetPlayerId: p.id });
            });
        }
        
        displays.gameTable.appendChild(box);
    });
    
    // ----------------------------------------------------
    // 3. SWITCH CONTROL PANEL SUB-VIEWS
    // ----------------------------------------------------
    // Hide all control panels
    displays.panelAnswering.classList.remove('active');
    displays.panelSorting.classList.remove('active');
    displays.panelResult.classList.remove('active');
    displays.panelSpectating.classList.remove('active');
    
    let ticker = '';
    
    if (state.roundPhase === 'answering') {
        if (me && !me.hasAnswered) {
            displays.panelAnswering.classList.add('active');
            displays.mySecretNumber.textContent = me.cardNumber || '?';
            ticker = `【回答階段】請根據你的祕密數字強度，提交一句描述（嚴禁包含數字）！`;
        } else {
            displays.panelSpectating.classList.add('active');
            displays.panelSpectating.querySelector('.control-hint').textContent = '你已提交回答，正在等待其他探員提交描述...';
            ticker = `【回答階段】等待其他探員提交對應數字強度的敘述。`;
        }
    } else if (state.roundPhase === 'sorting') {
        if (isMeCaptain) {
            displays.panelSorting.classList.add('active');
            displays.sortingHintText.textContent = `你是隊長！請根據所有人的文字描述，【由小到大】點擊圓桌上的卡牌翻牌。`;
            ticker = `【排序階段】你是隊長！請審慎評估，由小到大翻開所有人卡牌。`;
        } else {
            displays.panelSpectating.classList.add('active');
            displays.panelSpectating.querySelector('.control-hint').textContent = `隊長【${captain ? captain.name : ''}】正在進行讀心與排序，請屏息以待...`;
            ticker = `【排序階段】隊長【${captain ? captain.name : ''}】正在將大家給出的描述由小到大排序翻牌中。`;
        }
    } else if (state.roundPhase === 'round_result') {
        const isCaptain = me && (state.players[state.captainIndex].id === socket.id);
        
        if (isHost || isCaptain) {
            displays.panelResult.classList.add('active');
            ticker = `【回合結算】恭喜本回合安全過關！請點擊按鈕進入下一回合。`;
        } else {
            displays.panelSpectating.classList.add('active');
            displays.panelSpectating.querySelector('.control-hint').textContent = `回合結算完畢！等待隊長或工坊主開啟下一回合...`;
            ticker = `【回合結算】安全通關！等待工坊主或隊長開啟新回合。`;
        }
    }
    
    // Show/hide skip/custom topic buttons based on role and phase
    if (state.roundPhase === 'answering') {
        if (isHost) displays.btnSkipTopic.style.display = 'block';
        else displays.btnSkipTopic.style.display = 'none';

        const isMeCaptain = captain && captain.id === socket.id;
        if (isMeCaptain) displays.btnCustomTopic.style.display = 'block';
        else displays.btnCustomTopic.style.display = 'none';
    } else {
        displays.btnSkipTopic.style.display = 'none';
        displays.btnCustomTopic.style.display = 'none';
    }
    
    displays.tickerText.textContent = ticker;
    
    // ----------------------------------------------------
    // 3.5. CHALLENGE RESULT MODAL
    // ----------------------------------------------------
    if (state.roundPhase === 'revealing_complete') {
        displays.resultModal.classList.add('active');
        
        // Check if there was a score deduction (meaning a smaller number was revealed)
        // Since we decrement lives, let's see if the sequence has an out-of-order element
        let errorFlipped = false;
        let detailsStr = '';
        
        // Find if sequence has any backward steps
        let seq = state.revealedSequence || [];
        for (let i = 1; i < seq.length; i++) {
            if (seq[i] < seq[i-1]) {
                errorFlipped = true;
            }
        }
        
        if (errorFlipped) {
            displays.resultBadge.textContent = "🔴 排序錯誤 (Order Error)";
            displays.resultBadge.className = "result-badge-failure";
            displays.resultDetails.innerHTML = `翻牌順序發生倒退！<br>最終揭曉順序：【${seq.join(' ➔ ')}】。<br>大家可以討論看看是在哪裡產生了默契誤差喔！`;
        } else {
            displays.resultBadge.textContent = "🟢 完美過關 (Perfect Sequence)";
            displays.resultBadge.className = "result-badge-success";
            displays.resultDetails.innerHTML = `隊長完美排序！<br>揭曉順序：【${seq.join(' ➔ ')}】。<br>全體默契爆棚，繼續保持！`;
        }
        
        // Ready button
        if (me && me.readyToDeploy) {
            displays.btnResultReady.classList.add('disabled');
            displays.btnResultReady.querySelector('span').textContent = '等待其他人準備...';
        } else {
            displays.btnResultReady.classList.remove('disabled');
            displays.btnResultReady.querySelector('span').textContent = '宣告就緒';
        }
    } else {
        displays.resultModal.classList.remove('active');
    }
    
    // ----------------------------------------------------
    // 4. GAME OVER SUMMARY MODAL
    // ----------------------------------------------------
    if (state.roundPhase === 'game_over' || state.gameEnded) {
        displays.gameOverSubtitle.textContent = `🎉 恭喜完成了全部 5 個回合的默契考驗！`;
        displays.gameOverModal.querySelector('.modal-title').textContent = '🏆 順利通關 🏆';
        displays.gameOverModal.querySelector('.modal-title').className = 'logo-text text-gold';
        
        displays.finalScoresList.innerHTML = '';
        state.players.forEach(p => {
            const li = document.createElement('li');
            li.innerHTML = `<span>${p.name} ${p.isBot ? '(AI)' : ''}</span> 
                            <span>數字: <strong>${p.cardNumber}</strong>, 描述: "${p.answerText}"</span>`;
            displays.finalScoresList.appendChild(li);
        });
        
        displays.gameOverModal.classList.add('active');
    } else {
        displays.gameOverModal.classList.remove('active');
    }
}

// REGISTER CLICK & FORM EVENT LISTENERS
function initSocketAndEvents() {
    buttons.createRoom.addEventListener('click', () => {
        AudioSynth.playTick();
        const nickname = inputs.nickname.value.trim();
        if (!nickname) {
            showError('探員暱稱不能為空！');
            return;
        }
        socket.emit('createRoom', { name: nickname, gameType: 'topten' });
    });

    buttons.joinRoom.addEventListener('click', () => {
        AudioSynth.playTick();
        const nickname = inputs.nickname.value.trim();
        const code = inputs.roomCode.value.trim().toUpperCase();
        if (!nickname) {
            showError('探員暱稱不能為空！');
            return;
        }
        if (code.length !== 4) {
            showError('房號必須是 4 碼！');
            return;
        }
        socket.emit('joinRoom', { name: nickname, roomCode: code });
    });

    buttons.addBot.addEventListener('click', () => {
        AudioSynth.playTick();
        socket.emit('addBot');
    });

    buttons.startGame.addEventListener('click', () => {
        AudioSynth.playTick();
        socket.emit('startGame');
    });

    // Submitting answer
    displays.btnSubmitAnswer.addEventListener('click', () => {
        if (isSubmittingAnswer) return;
        
        const val = displays.inputAnswerText.value.trim();
        if (!val) {
            showError('回答描述不能為空！');
            return;
        }
        
        isSubmittingAnswer = true;
        AudioSynth.playValve();
        socket.emit('topten_submitAnswer', { answerText: val });
        displays.inputAnswerText.value = '';
    });

    // Next round trigger
    displays.btnNextRound.addEventListener('click', () => {
        AudioSynth.playTick();
        socket.emit('topten_nextRound');
    });

    // Ready for next round popup button
    displays.btnResultReady.addEventListener('click', () => {
        AudioSynth.playTick();
        socket.emit('topten_readyToDeploy');
    });

    displays.btnSkipTopic.addEventListener('click', () => {
        AudioSynth.playTick();
        socket.emit('topten_skipTopic');
    });

    // Custom Topic dialog triggers
    displays.btnCustomTopic.addEventListener('click', () => {
        AudioSynth.playTick();
        displays.inputCustomQuestion.value = '';
        displays.inputCustomMin.value = '';
        displays.inputCustomMax.value = '';
        displays.customTopicModal.classList.add('active');
    });

    displays.btnCustomCancel.addEventListener('click', () => {
        AudioSynth.playTick();
        displays.customTopicModal.classList.remove('active');
    });

    displays.btnCustomSubmit.addEventListener('click', () => {
        const question = displays.inputCustomQuestion.value.trim();
        const minD = displays.inputCustomMin.value.trim();
        const maxD = displays.inputCustomMax.value.trim();

        if (!question || !minD || !maxD) {
            showError('所有自訂題目與刻度欄位皆不能為空！');
            return;
        }

        AudioSynth.playValve();
        socket.emit('topten_setCustomTopic', {
            question: question,
            minDescription: minD,
            maxDescription: maxD
        });
        displays.customTopicModal.classList.remove('active');
    });

    displays.btnExitLobby.addEventListener('click', () => {
        AudioSynth.playTick();
        window.location.href = '/';
    });
}

// SOCKET MESSAGE HANDLERS
socket.on('roomUpdate', (state) => {
    isSubmittingAnswer = false;
    
    if (!state.gameStarted) {
        switchView('waiting');
        renderWaitingRoom(state);
    } else {
        switchView('game');
        renderGameBoard(state, state.me);
    }
});

socket.on('errorMsg', (msg) => {
    isSubmittingAnswer = false;
    showError(msg);
});

socket.on('topten_sequenceErrorSound', () => {
    AudioSynth.playErrorBuzzer();
});

socket.on('kicked', () => {
    showError('你已被工坊主剔除出房間。');
    switchView('login');
});
window.addEventListener('load', () => {
    SteamCanvas.init();
    initSocketAndEvents();
});
