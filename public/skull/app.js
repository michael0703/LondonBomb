// Client-side interactions for Skull (骷髏牌)

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
        gain.gain.setValueAtTime(0.1, this.ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 0.06);
        osc.connect(gain);
        gain.connect(this.ctx.destination);
        osc.start();
        osc.stop(this.ctx.currentTime + 0.06);
    },
    
    playValve() {
        this.init();
        if (this.ctx.state === 'suspended') this.ctx.resume();
        
        // Steam valve hiss (simulated white noise)
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
        gain.gain.setValueAtTime(0.04, this.ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 0.15);
        
        noise.connect(filter);
        filter.connect(gain);
        gain.connect(this.ctx.destination);
        
        noise.start();
        noise.stop(this.ctx.currentTime + 0.15);
    },
    
    playCymbal() {
        this.init();
        if (this.ctx.state === 'suspended') this.ctx.resume();
        
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(650, this.ctx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(800, this.ctx.currentTime + 0.3);
        
        gain.gain.setValueAtTime(0.12, this.ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 0.35);
        
        osc.connect(gain);
        gain.connect(this.ctx.destination);
        osc.start();
        osc.stop(this.ctx.currentTime + 0.35);
    },
    
    playExplosion() {
        this.init();
        if (this.ctx.state === 'suspended') this.ctx.resume();
        
        const osc1 = this.ctx.createOscillator();
        const osc2 = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        
        osc1.type = 'sawtooth';
        osc1.frequency.setValueAtTime(100, this.ctx.currentTime);
        osc1.frequency.linearRampToValueAtTime(20, this.ctx.currentTime + 0.4);
        
        osc2.type = 'square';
        osc2.frequency.setValueAtTime(95, this.ctx.currentTime);
        osc2.frequency.linearRampToValueAtTime(10, this.ctx.currentTime + 0.4);
        
        gain.gain.setValueAtTime(0.2, this.ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 0.45);
        
        osc1.connect(gain);
        osc2.connect(gain);
        gain.connect(this.ctx.destination);
        
        osc1.start();
        osc2.start();
        osc1.stop(this.ctx.currentTime + 0.45);
        osc2.stop(this.ctx.currentTime + 0.45);
    }
};

// UI ELEMENTS SELECTORS
const views = {
    login: document.getElementById('login-view'),
    waiting: document.getElementById('waiting-view'),
    game: document.getElementById('game-view')
};

const inputs = {
    nickname: document.getElementById('input-nickname'),
    roomCode: document.getElementById('input-room-code')
};

const buttons = {
    createRoom: document.getElementById('btn-create-room'),
    joinRoom: document.getElementById('btn-join-room'),
    addBot: document.getElementById('btn-add-bot'),
    startGame: document.getElementById('btn-start-game'),
    confirmReady: document.getElementById('btn-confirm-ready'),
    startBid: document.getElementById('btn-start-bid'),
    submitBid: document.getElementById('btn-submit-bid'),
    passBid: document.getElementById('btn-pass-bid'),
    bidUp: document.getElementById('btn-bid-up'),
    bidDown: document.getElementById('btn-bid-down'),
    restartGame: document.getElementById('btn-restart-game'),
    exitLobby: document.getElementById('btn-exit-lobby'),
    closeLostToast: document.getElementById('btn-close-lost-toast')
};

const displays = {
    roomCode: document.getElementById('display-room-code'),
    playerCount: document.getElementById('player-count'),
    playersList: document.getElementById('lobby-players-list'),
    statusMsg: document.getElementById('lobby-status-msg'),
    
    phase: document.getElementById('display-phase'),
    activePlayer: document.getElementById('display-active-player'),
    highestBid: document.getElementById('display-highest-bid'),
    roundNum: document.getElementById('display-round-num'),
    
    tickerText: document.getElementById('ticker-text'),
    gameTable: document.getElementById('game-table'),
    
    // Panels
    panelDeploy: document.getElementById('panel-deploy'),
    panelPlacing: document.getElementById('panel-placing'),
    panelBidding: document.getElementById('panel-bidding'),
    panelRevealing: document.getElementById('panel-revealing'),
    panelSpectating: document.getElementById('panel-spectating'),
    myCardPoolContainer: document.getElementById('my-card-pool-container'),
    myCardPoolIcons: document.getElementById('my-card-pool-icons'),
    
    placingHand: document.getElementById('placing-hand'),
    displayMyBid: document.getElementById('display-my-bid'),
    revealTargetCount: document.getElementById('reveal-target-count'),
    
    // Modals
    discardModal: document.getElementById('discard-modal'),
    discardHandSelection: document.getElementById('discard-hand-selection'),
    toastLostCard: document.getElementById('toast-lost-card'),
    lostCardTitle: document.getElementById('lost-card-title'),
    lostCardIcon: document.getElementById('lost-card-icon'),
    lostCardDesc: document.getElementById('lost-card-desc'),
    gameOverModal: document.getElementById('game-over-modal'),
    gameOverSubtitle: document.getElementById('game-over-subtitle'),
    finalScoresList: document.getElementById('final-scores-list'),
    errorToast: document.getElementById('error-toast'),
    
    // Result Modal
    resultModal: document.getElementById('result-modal'),
    resultBadge: document.getElementById('result-badge'),
    resultDetails: document.getElementById('result-details'),
    btnResultReady: document.getElementById('btn-result-ready')
};

// STATE
let myId = null;
let latestState = null;
let currentMyBid = 1;
let isRevealingInProgress = false;
let isBiddingInProgress = false;

// VIEW MANAGER
function switchView(viewName) {
    Object.keys(views).forEach(key => {
        views[key].classList.toggle('active', key === viewName);
    });
}

function showError(msg) {
    displays.errorToast.textContent = msg;
    displays.errorToast.classList.add('active');
    setTimeout(() => {
        displays.errorToast.classList.remove('active');
    }, 3000);
}

// SETUP EVENT LISTENERS
function setupEventListeners() {
    buttons.createRoom.addEventListener('click', () => {
        AudioSynth.playTick();
        const nickname = inputs.nickname.value.trim();
        if (!nickname) {
            showError('請輸入暱稱！');
            return;
        }
        socket.emit('createRoom', { name: nickname, gameType: 'skull' });
    });

    buttons.joinRoom.addEventListener('click', () => {
        AudioSynth.playTick();
        const nickname = inputs.nickname.value.trim();
        const code = inputs.roomCode.value.trim().toUpperCase();
        if (!nickname || !code) {
            showError('請填寫暱稱及4字房號！');
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

    buttons.confirmReady.addEventListener('click', () => {
        AudioSynth.playTick();
        socket.emit('skull_readyToDeploy');
    });

    displays.btnResultReady.addEventListener('click', () => {
        AudioSynth.playTick();
        socket.emit('skull_readyToDeploy');
    });

    buttons.startBid.addEventListener('click', () => {
        AudioSynth.playTick();
        if (latestState) {
            // Find max available bid (total placed cards)
            let totalPlaced = 0;
            latestState.players.forEach(p => {
                totalPlaced += p.playedCardsCount || 0;
            });
            
            // Set currentMyBid starting point: must be higher than current bid
            const currentHighest = latestState.highestBid || 0;
            currentMyBid = Math.min(currentHighest + 1, totalPlaced);
            displays.displayMyBid.textContent = currentMyBid;
            
            displays.panelPlacing.classList.remove('active');
            displays.panelBidding.classList.add('active');
        }
    });

    buttons.bidUp.addEventListener('click', () => {
        AudioSynth.playTick();
        if (latestState) {
            let totalPlaced = 0;
            latestState.players.forEach(p => {
                totalPlaced += p.playedCardsCount || 0;
            });
            if (currentMyBid < totalPlaced) {
                currentMyBid++;
                displays.displayMyBid.textContent = currentMyBid;
            }
        }
    });

    buttons.bidDown.addEventListener('click', () => {
        AudioSynth.playTick();
        if (latestState) {
            const minBid = (latestState.highestBid || 0) + 1;
            if (currentMyBid > minBid) {
                currentMyBid--;
                displays.displayMyBid.textContent = currentMyBid;
            }
        }
    });

    buttons.submitBid.addEventListener('click', () => {
        if (isBiddingInProgress) return;
        isBiddingInProgress = true;
        AudioSynth.playTick();
        socket.emit('skull_bid', { bidAmount: currentMyBid });
    });

    buttons.passBid.addEventListener('click', () => {
        if (isBiddingInProgress) return;
        isBiddingInProgress = true;
        AudioSynth.playValve();
        socket.emit('skull_pass');
    });

    buttons.restartGame.addEventListener('click', () => {
        AudioSynth.playTick();
        displays.gameOverModal.classList.remove('active');
        socket.emit('restartGame');
    });

    buttons.exitLobby.addEventListener('click', () => {
        AudioSynth.playTick();
        window.location.href = '/';
    });

    buttons.closeLostToast.addEventListener('click', () => {
        AudioSynth.playTick();
        displays.toastLostCard.classList.remove('active');
    });
}

// RENDER: LOBBY
function renderWaitingRoom(state) {
    displays.roomCode.textContent = state.roomCode;
    displays.playerCount.textContent = state.players.length;
    
    // Clear list
    displays.playersList.innerHTML = '';
    
    const myInfo = state.players.find(p => p.id === socket.id);
    const isHost = myInfo ? myInfo.host : false;
    
    state.players.forEach(p => {
        const li = document.createElement('li');
        li.className = 'lobby-player-card';
        
        const infoDiv = document.createElement('div');
        infoDiv.className = 'lobby-player-info';
        
        if (p.host) {
            const crown = document.createElement('span');
            crown.className = 'host-crown';
            crown.textContent = '👑 ';
            infoDiv.appendChild(crown);
        }
        
        const nameSpan = document.createElement('span');
        nameSpan.textContent = p.name;
        infoDiv.appendChild(nameSpan);
        
        if (p.isBot) {
            const botTag = document.createElement('span');
            botTag.className = 'bot-tag';
            botTag.textContent = 'AI';
            infoDiv.appendChild(botTag);
        }
        
        li.appendChild(infoDiv);
        
        // Host kick option
        if (isHost && p.id !== socket.id) {
            const btnKick = document.createElement('button');
            btnKick.className = 'btn btn-kick';
            btnKick.textContent = '剔除';
            btnKick.addEventListener('click', () => {
                AudioSynth.playTick();
                if (confirm(`確定要剔除 ${p.name} 嗎？`)) {
                    socket.emit('kickPlayer', { targetId: p.id });
                }
            });
            li.appendChild(btnKick);
        }
        
        displays.playersList.appendChild(li);
    });
    
    // Show/hide host buttons
    if (isHost) {
        buttons.addBot.style.display = 'block';
        buttons.startGame.style.display = 'block';
        
        if (state.players.length >= 2) {
            buttons.startGame.classList.remove('disabled');
            buttons.startGame.removeAttribute('disabled');
            displays.statusMsg.textContent = '準備就緒，隨時可以開始任務。';
        } else {
            buttons.startGame.classList.add('disabled');
            buttons.startGame.setAttribute('disabled', 'true');
            displays.statusMsg.textContent = '至少需要 2 位探員才可以開始。';
        }
    } else {
        buttons.addBot.style.display = 'none';
        buttons.startGame.style.display = 'none';
        displays.statusMsg.textContent = '等待房主開始部署任務...';
    }
}

// RENDER: GAMEPLAY
function renderGameBoard(state, me) {
    latestState = state;
    myId = socket.id;
    
    // Set text elements
    let phaseText = '出牌階段';
    if (state.roundPhase === 'bidding') phaseText = '競標階段';
    if (state.roundPhase === 'revealing') phaseText = '翻牌階段';
    displays.phase.textContent = phaseText;
    
    // Active player name
    const activeP = state.players.find(p => p.id === state.activePlayerId);
    displays.activePlayer.textContent = activeP ? activeP.name : '無';
    
    // Highest bid
    const challengerP = state.players.find(p => p.id === state.challengerId);
    displays.highestBid.textContent = state.highestBid > 0 
        ? `${challengerP ? challengerP.name : '挑戰者'} (${state.highestBid} 張)` 
        : '無';
        
    displays.roundNum.textContent = `第 ${state.round} 回合`;
    
    // ----------------------------------------------------
    // 1. RENDER GAME TABLE (CIRCULAR ALL PLAYERS LAYOUT)
    // ----------------------------------------------------
    // Clear and insert steampunk center dial
    displays.gameTable.innerHTML = `
        <div id="table-center-dial" class="table-center-dial">
            <div id="center-phase" class="center-phase-text">準備中</div>
            <div id="center-bid-circle" class="center-bid-circle">
                <div class="center-bid-label">最高競標</div>
                <div id="center-bid-val">0</div>
            </div>
            <div id="center-active-name" class="center-active-text">-</div>
        </div>
    `;

    const centerPhase = document.getElementById('center-phase');
    const centerBidVal = document.getElementById('center-bid-val');
    const centerActiveName = document.getElementById('center-active-name');
    
    centerPhase.textContent = phaseText;
    centerBidVal.textContent = state.highestBid || 0;
    centerActiveName.textContent = activeP ? `👉 行動者: ${activeP.name}` : '-';

    const isChallengerSelf = state.challengerId === socket.id;
    const isRevealingPhase = state.roundPhase === 'revealing';
    
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
    
    // Check order constraints for revealing
    const mePlayer = state.players.find(p => p.id === socket.id);
    const ownCardsAllRevealed = mePlayer && (mePlayer.playedCards.filter(c => !c.revealed).length === 0);
    
    const N = orderedPlayers.length;
    const R_percent = 36; // Radius of circular table

    orderedPlayers.forEach((p, idx) => {
        const box = document.createElement('div');
        box.className = 'player-box';
        
        // Circular placement
        const angle = (Math.PI / 2) + (idx * 2 * Math.PI / N);
        const x = 50 + R_percent * Math.cos(angle);
        const y = 50 + R_percent * Math.sin(angle);
        box.style.left = `${x}%`;
        box.style.top = `${y}%`;
        box.style.transform = 'translate(-50%, -50%)';

        if (state.activePlayerId === p.id && !state.gameEnded) {
            box.classList.add('active-player');
        }
        if (p.eliminated) {
            box.classList.add('eliminated-player');
        }
        
        // If I am the challenger and it's revealing, can I click this player's stack?
        let isRevealable = false;
        if (isRevealingPhase && isChallengerSelf && !state.gameEnded && !p.eliminated) {
            if (p.id === socket.id) {
                isRevealable = p.playedCards.some(c => !c.revealed);
            } else {
                isRevealable = ownCardsAllRevealed && p.playedCards.some(c => !c.revealed);
            }
        }
        
        if (isRevealable) {
            box.classList.add('reveal-targetable');
            box.addEventListener('click', () => {
                if (isRevealingInProgress) return;
                isRevealingInProgress = true;
                AudioSynth.playTick();
                socket.emit('skull_revealCard', { targetPlayerId: p.id });
            });
        }
        
        // Name Row
        const nameRow = document.createElement('div');
        nameRow.className = 'player-name-row';
        
        const nameSpan = document.createElement('span');
        nameSpan.className = 'player-name';
        nameSpan.textContent = p.name;
        nameRow.appendChild(nameSpan);
        
        const badgesDiv = document.createElement('div');
        badgesDiv.className = 'player-badges';
        
        if (state.challengerId === p.id) {
            const b = document.createElement('span');
            b.className = 'badge badge-challenger';
            b.textContent = '挑戰者';
            badgesDiv.appendChild(b);
        } else if (p.passed) {
            const b = document.createElement('span');
            b.className = 'badge badge-passed';
            b.textContent = 'PASS';
            badgesDiv.appendChild(b);
        }
        if (p.eliminated) {
            const b = document.createElement('span');
            b.className = 'badge badge-eliminated';
            b.textContent = '淘汰';
            badgesDiv.appendChild(b);
        }
        
        nameRow.appendChild(badgesDiv);
        box.appendChild(nameRow);
        
        // Score Row (2 dots)
        const scoreRow = document.createElement('div');
        scoreRow.className = 'player-score-row';
        for (let i = 0; i < 2; i++) {
            const dot = document.createElement('div');
            dot.className = 'score-dot';
            if (p.score > i) {
                dot.classList.add('filled');
            }
            scoreRow.appendChild(dot);
        }
        box.appendChild(scoreRow);
        
        // Stack visual
        const stackContainer = document.createElement('div');
        stackContainer.className = 'personal-stack-container';
        
        const stack = document.createElement('div');
        stack.className = 'personal-stack';
        
        // Find the index of the next card to reveal in p.playedCards (rightmost unrevealed card)
        let nextRevealIndex = -1;
        for (let i = p.playedCards.length - 1; i >= 0; i--) {
            if (!p.playedCards[i].revealed) {
                nextRevealIndex = i;
                break;
            }
        }

        // Render cards inside stack
        p.playedCards.forEach((c, idx) => {
            const cardEl = document.createElement('div');
            cardEl.className = 'stack-card';
            if (idx === nextRevealIndex && isRevealable) {
                cardEl.classList.add('next-to-reveal');
            }
            
            const inner = document.createElement('div');
            inner.className = 'stack-card-inner';
            
            if (c.revealed) {
                if (c.type === 'flower') {
                    cardEl.classList.add('revealed-flower');
                    inner.textContent = '🌸';
                } else {
                    cardEl.classList.add('revealed-skull');
                    inner.textContent = '💀';
                }
            } else {
                // If card type is visible (meaning it's my own card face down)
                if (c.type === 'flower') {
                    cardEl.classList.add('revealed-flower');
                    cardEl.style.opacity = '0.75';
                    cardEl.style.borderStyle = 'dashed';
                    inner.textContent = '🌸';
                } else if (c.type === 'skull') {
                    cardEl.classList.add('revealed-skull');
                    cardEl.style.opacity = '0.75';
                    cardEl.style.borderStyle = 'dashed';
                    inner.textContent = '💀';
                } else {
                    inner.textContent = '❓';
                }
            }
            
            cardEl.appendChild(inner);
            stack.appendChild(cardEl);
        });
        
        stackContainer.appendChild(stack);
        box.appendChild(stackContainer);
        
        // Hand size summary (Only display for other players; local player already sees hand list)
        if (p.id !== socket.id) {
            const handSum = document.createElement('div');
            handSum.className = 'player-hand-summary';
            handSum.textContent = `剩餘手牌: ${p.remainingHandSize} 張`;
            box.appendChild(handSum);
        }
        
        displays.gameTable.appendChild(box);
    });

    // ----------------------------------------------------
    // 2. TICKER BANNER TEXT UPDATE
    // ----------------------------------------------------
    let ticker = '';
    if (state.gameEnded) {
        const winner = state.players.find(p => p.id === state.winnerTeam);
        ticker = `🏆 遊戲結束！恭喜 ${winner ? winner.name : '贏家'} 獲得最終勝利！`;
    } else if (state.roundPhase === 'placing') {
        const promptDeploy = state.players.some(p => !p.readyToDeploy);
        if (promptDeploy) {
            ticker = `請點擊下方「宣告就緒」重新發牌並部署初始卡牌。`;
        } else {
            ticker = `【出牌階段】輪到 ${activeP ? activeP.name : '出牌者'} 的回合。請出牌或發起挑戰競標。`;
        }
    } else if (state.roundPhase === 'bidding') {
        ticker = `【競標階段】輪到 ${activeP ? activeP.name : '加價者'} 行動。目前最高出價為 ${state.highestBid} 張。`;
    } else if (state.roundPhase === 'revealing') {
        const challenger = state.players.find(p => p.id === state.challengerId);
        const remain = state.highestBid - state.revealedCardsCount;
        ticker = `⚡ 【挑戰者 ${challenger ? challenger.name : ''}】必須翻牌！還需翻開 ${remain} 張（依照規則須由右至左，先翻自己，再翻別人）。`;
    } else if (state.roundPhase === 'revealing_complete') {
        ticker = `✨ 結算完畢！請全體生存探員點擊下方「宣告就緒」以進入下一輪。`;
    }
    displays.tickerText.textContent = ticker;

    // ----------------------------------------------------
    // 2.5 RENDER MY CARD POOL TRACKER (PERSISTENT SUMMARY)
    // ----------------------------------------------------
    if (me && !me.eliminated) {
        displays.myCardPoolContainer.style.display = 'flex';
        displays.myCardPoolIcons.innerHTML = '';
        
        // Count cards
        const flowersInHand = me.cards.filter(c => c === 'flower').length;
        const skullsInHand = me.cards.filter(c => c === 'skull').length;
        
        const mePlayer = state.players.find(p => p.id === socket.id);
        const flowersOnTable = mePlayer ? mePlayer.playedCards.filter(c => c.type === 'flower').length : 0;
        const skullsOnTable = mePlayer ? mePlayer.playedCards.filter(c => c.type === 'skull').length : 0;
        
        const lostFlowers = 3 - (flowersInHand + flowersOnTable);
        const lostSkulls = 1 - (skullsInHand + skullsOnTable);
        
        // Helper to append icons
        const addIcons = (type, inHand, onTable, lost) => {
            const emoji = type === 'flower' ? '🌸' : '💀';
            for (let i = 0; i < inHand; i++) {
                const el = document.createElement('div');
                el.className = 'pool-card-icon';
                el.textContent = emoji;
                displays.myCardPoolIcons.appendChild(el);
            }
            for (let i = 0; i < onTable; i++) {
                const el = document.createElement('div');
                el.className = 'pool-card-icon played';
                el.textContent = emoji;
                displays.myCardPoolIcons.appendChild(el);
            }
            for (let i = 0; i < lost; i++) {
                const el = document.createElement('div');
                el.className = 'pool-card-icon lost';
                el.textContent = emoji;
                displays.myCardPoolIcons.appendChild(el);
            }
        };
        
        addIcons('flower', flowersInHand, flowersOnTable, lostFlowers);
        addIcons('skull', skullsInHand, skullsOnTable, lostSkulls);
    } else {
        displays.myCardPoolContainer.style.display = 'none';
    }

    // ----------------------------------------------------
    // 3. BOTTOM CONTROL PANELS STATE
    // ----------------------------------------------------
    // Turn off all panels first
    displays.panelDeploy.classList.remove('active');
    displays.panelPlacing.classList.remove('active');
    displays.panelBidding.classList.remove('active');
    displays.panelRevealing.classList.remove('active');
    displays.panelSpectating.classList.remove('active');

    // If eliminated, show spectator panel
    if (me && me.eliminated) {
        displays.panelSpectating.classList.add('active');
    } else if (state.players.some(p => !p.readyToDeploy)) {
        // If someone is not ready for deployment (round transition)
        displays.panelDeploy.classList.add('active');
        if (me && me.readyToDeploy) {
            buttons.confirmReady.classList.add('disabled');
            buttons.confirmReady.setAttribute('disabled', 'true');
            buttons.confirmReady.querySelector('span').textContent = '已宣告就緒';
        } else {
            buttons.confirmReady.classList.remove('disabled');
            buttons.confirmReady.removeAttribute('disabled');
            buttons.confirmReady.querySelector('span').textContent = '宣告就緒';
        }
    } else if (state.roundPhase === 'placing') {
        // Placing hand panel
        displays.panelPlacing.classList.add('active');
        displays.placingHand.innerHTML = '';
        
        const isMyTurn = state.activePlayerId === socket.id;
        
        // Show bid challenge button only if everyone has played at least 1 card
        const everyonePlayedOne = state.players.filter(p => !p.eliminated).every(p => p.playedCardsCount >= 1);
        
        // Or if I have no cards in hand, I MUST bid, can't place cards
        const noHand = me && me.cards.length === 0;
        
        if (isMyTurn && !state.gameEnded && (noHand || everyonePlayedOne)) {
            buttons.startBid.style.display = 'block';
            buttons.startBid.classList.remove('disabled');
            buttons.startBid.removeAttribute('disabled');
        } else {
            buttons.startBid.style.display = 'none';
        }

        if (me && me.cards) {
            me.cards.forEach(type => {
                const card = document.createElement('div');
                card.className = 'hand-card';
                
                const icon = document.createElement('span');
                icon.className = 'hand-card-icon';
                icon.textContent = type === 'flower' ? '🌸' : '💀';
                
                const label = document.createElement('span');
                card.className = 'hand-card';
                label.className = 'hand-card-label';
                label.textContent = type === 'flower' ? '鮮花' : '骷髏';
                
                card.appendChild(icon);
                card.appendChild(label);
                
                // Clicking hand card to place it
                if (isMyTurn && !state.gameEnded && !noHand) {
                    card.addEventListener('click', () => {
                        AudioSynth.playValve();
                        socket.emit('skull_placeCard', { cardType: type });
                    });
                } else {
                    card.classList.add('disabled');
                    card.style.opacity = 0.5;
                    card.style.cursor = 'not-allowed';
                }
                
                displays.placingHand.appendChild(card);
            });
        }
    } else if (state.roundPhase === 'bidding') {
        const isMyTurn = state.activePlayerId === socket.id;
        
        // If it's my turn, show bid controls
        if (isMyTurn && !state.gameEnded && me && !me.passed) {
            displays.panelBidding.classList.add('active');
            
            // Adjust currentMyBid constraints
            const minBid = (state.highestBid || 0) + 1;
            let totalPlaced = 0;
            state.players.forEach(p => {
                totalPlaced += p.playedCardsCount || 0;
            });
            
            currentMyBid = Math.max(minBid, currentMyBid);
            currentMyBid = Math.min(totalPlaced, currentMyBid);
            displays.displayMyBid.textContent = currentMyBid;

            // Hide Pass button if no one has bid yet (this is the initial bid)
            if (state.highestBid === 0) {
                buttons.passBid.style.display = 'none';
            } else {
                buttons.passBid.style.display = 'inline-block';
            }
        } else {
            // If it's not my turn or I passed, show static text or spectator panel
            displays.panelSpectating.classList.add('active');
            displays.panelSpectating.querySelector('.control-hint').textContent = me && me.passed 
                ? '你已宣告放棄競標 (Pass)，等待本輪競標結算...' 
                : '競標進行中，等待其他探員行動...';
        }
    } else if (state.roundPhase === 'revealing') {
        if (isChallengerSelf) {
            displays.panelRevealing.classList.add('active');
            displays.revealTargetCount.textContent = state.highestBid;
        } else {
            displays.panelSpectating.classList.add('active');
            const challenger = state.players.find(p => p.id === state.challengerId);
            displays.panelSpectating.querySelector('.control-hint').textContent = `挑戰者 ${challenger ? challenger.name : ''} 正在翻牌結算中...`;
        }
    }
    
    // ----------------------------------------------------
    // 3.5. CHALLENGE RESULT MODAL
    // ----------------------------------------------------
    if (state.roundPhase === 'revealing_complete') {
        displays.resultModal.classList.add('active');
        
        // Find if someone hit a skull (if there is a revealed skull on the board)
        let skullOwner = null;
        state.players.forEach(p => {
            if (p.playedCards.some(c => c.revealed && c.type === 'skull')) {
                skullOwner = p;
            }
        });
        
        const challenger = state.players.find(p => p.id === state.challengerId);
        
        if (skullOwner) {
            // Failure!
            displays.resultBadge.textContent = "🔴 挑戰失敗 (Challenge Failure)";
            displays.resultBadge.className = "result-badge-failure";
            
            if (skullOwner.id === state.challengerId) {
                displays.resultDetails.innerHTML = `挑戰者 <strong>${challenger ? challenger.name : ''}</strong> 踩中了<strong>自己</strong>放置的骷髏！<br>自爆成功！必須秘密選擇丟棄 1 張手牌。`;
            } else {
                displays.resultDetails.innerHTML = `挑戰者 <strong>${challenger ? challenger.name : ''}</strong> 踩中了 <strong>${skullOwner.name}</strong> 的骷髏！<br>永久失去 1 張隨機手牌。`;
            }
        } else {
            // Success!
            displays.resultBadge.textContent = "🟢 挑戰成功 (Challenge Success)";
            displays.resultBadge.className = "result-badge-success";
            displays.resultDetails.innerHTML = `挑戰者 <strong>${challenger ? challenger.name : ''}</strong> 成功出價 <strong>${state.highestBid}</strong> 張，並且順利翻開了 <strong>${state.revealedCardsCount}</strong> 張鮮花牌，未踩中任何骷髏！`;
        }
        
        // Ready button state
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
    if (state.gameEnded) {
        const winner = state.players.find(p => p.id === state.winnerTeam);
        displays.gameOverSubtitle.textContent = winner 
            ? `${winner.name} 贏得了最終對局！` 
            : '對局宣告結束！';
            
        displays.finalScoresList.innerHTML = '';
        state.players.forEach(p => {
            const li = document.createElement('li');
            li.innerHTML = `<span>${p.name} ${p.isBot ? '(AI)' : ''}</span> 
                            <span>得分: ${p.score}/2 ${p.eliminated ? '<strong class="text-red">(已淘汰)</strong>' : ''}</span>`;
            displays.finalScoresList.appendChild(li);
        });
        
        // Show restart option only for host
        const isHost = me && me.host;
        buttons.restartGame.style.display = isHost ? 'block' : 'none';
        
        displays.gameOverModal.classList.add('active');
    } else {
        displays.gameOverModal.classList.remove('active');
    }
}

// SOCKET MESSAGE HANDLERS
socket.on('roomUpdate', (state) => {
    isRevealingInProgress = false;
    isBiddingInProgress = false;
    // If not started yet, render lobby
    if (!state.gameStarted) {
        switchView('waiting');
        renderWaitingRoom(state);
    } else {
        switchView('game');
        
        renderGameBoard(state, state.me);
    }
});

socket.on('errorMsg', (msg) => {
    isRevealingInProgress = false;
    isBiddingInProgress = false;
    showError(msg);
});

socket.on('kicked', () => {
    alert('你已被房主剔除出房間。');
    window.location.href = '/';
});

// Prompt player to discard a card secretly when self-exploded
socket.on('skull_mustDiscardSelf', ({ remainingCards }) => {
    AudioSynth.playExplosion();
    displays.discardHandSelection.innerHTML = '';
    
    remainingCards.forEach((type, index) => {
        const card = document.createElement('div');
        card.className = 'hand-card';
        
        const icon = document.createElement('span');
        icon.className = 'hand-card-icon';
        icon.textContent = type === 'flower' ? '🌸' : '💀';
        
        const label = document.createElement('span');
        label.className = 'hand-card-label';
        label.textContent = type === 'flower' ? '鮮花' : '骷髏';
        
        card.appendChild(icon);
        card.appendChild(label);
        
        card.addEventListener('click', () => {
            AudioSynth.playTick();
            displays.discardModal.classList.remove('active');
            socket.emit('skull_discardChoice', { cardIndex: index });
        });
        
        displays.discardHandSelection.appendChild(card);
    });
    
    displays.discardModal.classList.add('active');
});

// Toast popup when losing a card
socket.on('skull_cardLost', ({ cardType, isSelfExplode, byPlayerName }) => {
    AudioSynth.playExplosion();
    
    if (isSelfExplode) {
        displays.lostCardTitle.textContent = '💀 挑戰失敗自爆 💀';
        displays.lostCardDesc.textContent = `你踩中了自己放的骷髏！永久失去了一張【${cardType === 'flower' ? '🌸 鮮花牌' : '💀 骷髏牌'}】。`;
    } else {
        displays.lostCardTitle.textContent = '💥 挑戰踩中骷髏 💥';
        displays.lostCardDesc.textContent = `你踩中了 ${byPlayerName} 的骷髏！他隨機抽走了你的一張【${cardType === 'flower' ? '🌸 鮮花牌' : '💀 骷髏牌'}】並永久丟棄。`;
    }
    
    displays.lostCardIcon.textContent = cardType === 'flower' ? '🌸' : '💀';
    displays.toastLostCard.classList.add('active');
});

// Play flip sounds based on card type revealed
socket.on('skull_cardRevealedSound', ({ cardType }) => {
    if (cardType === 'flower') {
        AudioSynth.playCymbal();
    } else {
        AudioSynth.playExplosion();
    }
});

// INITIALIZE APP
document.addEventListener('DOMContentLoaded', () => {
    setupEventListeners();
});
