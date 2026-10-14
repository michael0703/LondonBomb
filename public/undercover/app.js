// Client-side interactions for 誰是臥底 (Undercover)

const socket = BoardgameSession.connect('undercover');
BoardgameSession.initLoginForm({ nameInputId: 'input-nickname', roomInputId: 'input-room-code' });
BoardgameSession.mountInviteButton('display-room-code');

// AUDIO SYNTHESIS ENGINE (Web Audio API)
const AudioSynth = {
    ctx: null,

    init() {
        if (!this.ctx) {
            this.ctx = new (window.AudioContext || window.webkitAudioContext)();
        }
        if (this.ctx.state === 'suspended') this.ctx.resume();
    },

    playTone(freq, duration, type = 'triangle', volume = 0.12) {
        this.init();
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = type;
        osc.frequency.setValueAtTime(freq, this.ctx.currentTime);
        gain.gain.setValueAtTime(volume, this.ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + duration);
        osc.connect(gain);
        gain.connect(this.ctx.destination);
        osc.start();
        osc.stop(this.ctx.currentTime + duration);
    },

    playTick() { this.playTone(500, 0.06); },
    playNotify() { this.playTone(880, 0.15, 'sine', 0.1); },
    playSuccess() {
        [523, 659, 784].forEach((f, i) => setTimeout(() => this.playTone(f, 0.18, 'sine', 0.12), i * 110));
    }
};

const $ = (id) => document.getElementById(id);

const views = {
    login: $('login-view'),
    waiting: $('waiting-view'),
    game: $('game-view')
};

const ROLE_LABELS = { civilian: '🙂 平民', undercover: '🕵️ 臥底', blank: '⬜ 白板' };
const PHASE_LABELS = { speaking: '描述中', voting: '投票中', reveal: '開票', game_over: '遊戲結束' };

let latestState = null;
let wordShown = false;
let lastSoundKey = null;

function switchView(name) {
    Object.entries(views).forEach(([key, el]) => el.classList.toggle('active', key === name));
}

function showError(msg) {
    const toast = $('error-toast');
    toast.textContent = msg;
    toast.classList.add('active');
    setTimeout(() => toast.classList.remove('active'), 3000);
}

function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
}

function nameOf(state, id) {
    const p = state.players.find(pl => pl.id === id);
    return p ? p.name : '?';
}

// RENDER LOBBY WAITING ROOM
function renderWaitingRoom(state) {
    $('display-room-code').textContent = state.roomCode;
    $('player-count').textContent = state.players.length;
    const list = $('lobby-players-list');
    list.innerHTML = '';

    const me = state.players.find(p => p.id === socket.id);
    const isHost = me ? me.host : false;

    state.players.forEach(p => {
        const li = el('li');
        if (p.id === socket.id) li.classList.add('is-me');
        if (p.host) li.classList.add('is-host');
        li.appendChild(el('span', 'player-name', p.name + (p.id === socket.id ? ' (你)' : '')));

        const actions = el('div');
        actions.style.display = 'flex';
        actions.style.alignItems = 'center';
        actions.style.gap = '8px';
        if (p.host) actions.appendChild(el('span', 'badge badge-host', '房主'));
        if (isHost && p.id !== socket.id) {
            const kickBtn = el('button', 'btn btn-brass btn-small');
            kickBtn.appendChild(el('span', null, '剔除'));
            kickBtn.addEventListener('click', () => {
                AudioSynth.playTick();
                socket.emit('kickPlayer', { targetId: p.id });
            });
            actions.appendChild(kickBtn);
        }
        li.appendChild(actions);
        list.appendChild(li);
    });

    // Role settings (only the host can change them)
    const setup = state.setup;
    $('setting-undercover').textContent = setup.undercover;
    $('setting-blank').textContent = setup.blank;
    $('setting-civilian').textContent = Math.max(0, setup.civilian);
    document.querySelectorAll('[data-setting]').forEach(btn => {
        btn.style.visibility = isHost ? 'visible' : 'hidden';
    });
    $('setting-note').textContent = setup.auto
        ? `臥底人數依玩家數自動決定（4–6 人 1 個、7–10 人 2 個）`
        : `房主手動設定（自動值是 ${setup.defaultUndercover} 個）`;

    const startBtn = $('btn-start-game');
    const statusMsg = $('lobby-status-msg');
    if (isHost) {
        startBtn.style.display = 'block';
        startBtn.classList.toggle('disabled', !!setup.error);
        startBtn.disabled = !!setup.error;
        statusMsg.textContent = setup.error || '你是房主！人到齊就可以開始。';
    } else {
        startBtn.style.display = 'none';
        statusMsg.textContent = setup.error && state.players.length < 4 ? setup.error : '等待房主開始遊戲...';
    }
}

// SECRET WORD CARD
function renderWordCard(state) {
    const me = state.me;
    const card = $('word-card');
    card.classList.toggle('hidden-word', !wordShown);
    if (!wordShown) {
        $('display-my-word').textContent = '👀 點我看詞';
    } else if (me && me.role === 'blank') {
        $('display-my-word').textContent = '⬜ 你是白板（沒有詞）';
    } else {
        $('display-my-word').textContent = me && me.word ? me.word : '？';
    }
}

// ROLE COUNTS: how many of each role this game has and how many are still in
function renderRoleCounts(state) {
    const box = $('role-counts');
    box.innerHTML = '';
    [['undercover', '🕵️ 臥底'], ['blank', '⬜ 白板'], ['civilian', '🙂 平民']].forEach(([role, label]) => {
        const c = state.roleCounts[role];
        if (!c || (role === 'blank' && c.total === 0)) return;
        const chip = el('span', 'role-chip role-chip-' + role);
        chip.appendChild(el('span', null, `${label} `));
        chip.appendChild(el('strong', null, `剩 ${c.alive}`));
        chip.appendChild(el('span', null, ` / ${c.total}`));
        box.appendChild(chip);
    });
}

// PLAYER LIST (seat order)
function renderPlayers(state) {
    const list = $('players-list');
    list.innerHTML = '';
    const speakerId = state.roundPhase === 'speaking' ? state.speakOrder[state.speakIndex] : null;

    state.players.forEach(p => {
        const li = el('li', 'uc-player');
        if (p.id === socket.id) li.classList.add('is-me');
        if (!p.alive) li.classList.add('out');
        if (p.id === speakerId) li.classList.add('speaking');
        if (!p.connected) li.classList.add('disconnected');

        const nameBox = el('span', 'uc-name', p.name + (p.id === socket.id ? ' (你)' : '') + (p.connected ? '' : ' 📴'));
        // Eliminated players see everyone's role and word
        if (state.viewerIsGhost && !state.gameEnded && p.role) {
            nameBox.appendChild(el('span', 'uc-reveal role-' + p.role, `${ROLE_LABELS[p.role]}${p.word ? `｜${p.word}` : ''}`));
        }
        li.appendChild(nameBox);

        let status = '';
        if (!p.alive) {
            status = p.left ? '已離開' : `出局｜${ROLE_LABELS[p.role] || ''}`;
        } else if (state.roundPhase === 'speaking') {
            const pos = state.speakOrder.indexOf(p.id);
            if (p.id === speakerId) status = '🗣️ 說話中';
            else if (pos !== -1 && pos < state.speakIndex) status = '✔ 說完了';
            else if (pos !== -1) status = `第 ${pos + 1} 位`;
        } else if (state.roundPhase === 'voting') {
            status = state.votedIds.includes(p.id) ? '✔ 已投票' : '投票中...';
        } else if (state.gameEnded && p.role) {
            status = ROLE_LABELS[p.role];
        }
        li.appendChild(el('span', 'uc-status', status));
        list.appendChild(li);
    });
}

// SWITCH BOTTOM CONTROL PANELS
function renderControls(state) {
    ['panel-speaking', 'panel-voting', 'panel-reveal', 'panel-spectating'].forEach(id => $(id).classList.remove('active'));
    const me = state.me;
    const spectate = (text) => {
        $('panel-spectating').classList.add('active');
        $('panel-spectating').querySelector('.control-hint').textContent = text;
    };

    if (state.roundPhase === 'speaking') {
        const speakerId = state.speakOrder[state.speakIndex];
        const speakerName = nameOf(state, speakerId);
        const isMe = speakerId === socket.id;
        $('panel-speaking').classList.add('active');
        $('btn-done-speaking').style.display = isMe ? 'block' : 'none';
        $('btn-skip-speaker').style.display = !isMe && me && me.host ? 'block' : 'none';
        $('btn-skip-speaker').querySelector('span').textContent = `⏭️ 跳過 ${speakerName}`;
        renderEarlyVote(state);
        $('speaking-hint').textContent = isMe
            ? '輪到你了！用一句話描述你的詞（不能直接說出來），說完按下面的按鈕。'
            : `請聽【${speakerName}】描述...`;
        return isMe ? '🗣️ 輪到你描述！' : `🗣️ 第 ${state.round} 輪：${speakerName} 正在描述`;
    }

    if (state.roundPhase === 'voting') {
        const alivePlayers = state.players.filter(p => p.alive);
        const votedCount = state.votedIds.length;
        if (!me || !me.alive) {
            spectate(`大家正在投票...（${votedCount}/${alivePlayers.length}）`);
            return '🗳️ 投票中';
        }
        $('panel-voting').classList.add('active');
        $('voting-hint').textContent = state.revote
            ? '⚖️ 平票！只能在平票的人之中再投一次：'
            : '你覺得誰是臥底？投下你的一票（開票前可以改）：';
        const options = $('vote-options');
        options.innerHTML = '';
        alivePlayers
            .filter(p => p.id !== socket.id && (!state.candidates || state.candidates.includes(p.id)))
            .forEach(p => {
                const btn = el('button', 'btn vote-option' + (state.myVote === p.id ? ' chosen' : ''));
                btn.appendChild(el('span', null, (state.myVote === p.id ? '☑️ ' : '') + p.name));
                btn.addEventListener('click', () => {
                    AudioSynth.playTick();
                    socket.emit('undercover_vote', { targetId: p.id });
                });
                options.appendChild(btn);
            });
        $('vote-progress').textContent = `已投票 ${votedCount}/${alivePlayers.length}，全部投完自動開票`;
        $('btn-force-tally').style.display = me.host && votedCount > 0 ? 'block' : 'none';
        return state.myVote ? `🗳️ 你投給了 ${nameOf(state, state.myVote)}，等待其他人...` : '🗳️ 投票時間！';
    }

    if (state.roundPhase === 'reveal' && state.result) {
        $('panel-reveal').classList.add('active');
        const r = state.result;
        let title;
        if (r.eliminatedId) {
            const out = state.players.find(p => p.id === r.eliminatedId);
            title = `☠️ ${out.name} 出局！身分是 ${ROLE_LABELS[out.role] || '?'}`;
        } else if (state.next === 'revote') {
            title = `⚖️ ${r.tied.map(id => nameOf(state, id)).join('、')} 平票，要再投一次`;
        } else {
            title = '⚖️ 再次平票，這輪沒有人出局';
        }
        $('reveal-title').textContent = title;
        renderVoteList($('reveal-votes'), state);
        $('btn-continue').querySelector('span').textContent = state.next === 'revote' ? '⚖️ 開始重新投票' : '▶️ 下一輪';
        $('btn-continue').style.display = me && me.host ? 'block' : 'none';
        $('reveal-wait').style.display = me && me.host ? 'none' : 'block';
        return title;
    }

    spectate('遊戲結束！');
    return '🏁 遊戲結束！';
}

// Early vote proposal box inside the speaking panel
function renderEarlyVote(state) {
    const me = state.me;
    const ev = state.earlyVote;
    const canTakePart = me && me.alive;
    $('btn-propose-early').style.display = canTakePart && !ev && !state.earlyProposers.includes(socket.id) ? 'block' : 'none';
    $('early-vote-box').style.display = ev ? 'flex' : 'none';
    if (!ev) return;
    const myChoice = ev.yesIds.includes(socket.id) ? 'yes' : ev.noIds.includes(socket.id) ? 'no' : null;
    let text = `🗳️ ${nameOf(state, ev.proposerId)} 提議提早投票：同意 ${ev.yesIds.length} 人，需要 ${ev.needed} 人（存活 ${ev.alive} 人）`;
    if (myChoice) text += myChoice === 'yes' ? '｜你：同意' : '｜你：不同意';
    $('early-vote-text').textContent = text;
    $('btn-early-yes').parentElement.style.display = canTakePart ? 'flex' : 'none';
    $('btn-early-yes').classList.toggle('chosen', myChoice === 'yes');
    $('btn-early-no').classList.toggle('chosen', myChoice === 'no');
}

// Who voted for whom, grouped by target
function renderVoteList(list, state) {
    list.innerHTML = '';
    state.result.tally.forEach(t => {
        const voters = state.result.votes.filter(v => v.target === t.id).map(v => nameOf(state, v.voter));
        const li = el('li');
        li.appendChild(el('strong', null, `${nameOf(state, t.id)}：${t.count} 票`));
        li.appendChild(el('span', null, `（${voters.join('、')}）`));
        list.appendChild(li);
    });
}

// GAME OVER
function renderGameOver(state) {
    const modal = $('game-over-modal');
    if (!state.gameEnded) {
        modal.classList.remove('active');
        return;
    }
    $('winner-title').textContent = state.winnerTeam === 'civilian' ? '🎉 平民獲勝！' : '🕵️ 臥底獲勝！';
    $('winner-words').textContent = state.pair
        ? `平民的詞：「${state.pair.civilian}」｜臥底的詞：「${state.pair.undercover}」`
        : '';

    const list = $('final-roles-list');
    list.innerHTML = '';
    const order = { undercover: 0, blank: 1, civilian: 2 };
    [...state.players].sort((a, b) => order[a.role] - order[b.role]).forEach(p => {
        const li = el('li');
        const won = (state.winnerTeam === 'civilian') === (p.role === 'civilian');
        if (won) li.classList.add('rank-first');
        li.appendChild(el('span', null, `${won ? '🏆 ' : ''}${p.name}${p.alive ? '' : '（出局）'}`));
        li.appendChild(el('strong', null, `${ROLE_LABELS[p.role] || ''}${p.word ? `｜${p.word}` : ''}`));
        list.appendChild(li);
    });

    const me = state.players.find(p => p.id === socket.id);
    $('btn-restart').style.display = me ? 'inline-block' : 'none';
    modal.classList.add('active');
}

// RENDER MAIN GAME BOARD
function renderGameBoard(state) {
    latestState = state;
    $('display-round').textContent = state.round;
    $('display-phase').textContent = PHASE_LABELS[state.roundPhase] || '-';
    $('display-alive').textContent = state.players.filter(p => p.alive).length;

    renderWordCard(state);
    renderRoleCounts(state);
    $('ghost-banner').style.display = state.viewerIsGhost && !state.gameEnded ? 'block' : 'none';
    renderPlayers(state);
    $('ticker-text').textContent = renderControls(state);
    renderGameOver(state);
    playStateSounds(state);
}

// Notify players when it's their turn to speak, the vote opens, or the game ends
function playStateSounds(state) {
    let key = `${state.round}-${state.roundPhase}-${state.revote}-${state.earlyVote ? state.earlyVote.proposerId : ''}`;
    const mySpeakTurn = state.roundPhase === 'speaking' && state.speakOrder[state.speakIndex] === socket.id;
    if (mySpeakTurn) key += '-me';
    if (key === lastSoundKey) return;
    const first = lastSoundKey === null;
    lastSoundKey = key;
    if (first) return;
    if (state.gameEnded) AudioSynth.playSuccess();
    else if (mySpeakTurn || state.roundPhase !== 'speaking') AudioSynth.playNotify();
}

// REGISTER CLICK & FORM EVENT LISTENERS
function initEvents() {
    $('btn-create-room').addEventListener('click', () => {
        AudioSynth.playTick();
        const nickname = $('input-nickname').value.trim();
        if (!nickname) return showError('暱稱不能為空！');
        socket.emit('createRoom', { name: nickname, gameType: 'undercover' });
    });

    $('btn-join-room').addEventListener('click', () => {
        AudioSynth.playTick();
        const nickname = $('input-nickname').value.trim();
        const code = $('input-room-code').value.trim().toUpperCase();
        if (!nickname) return showError('暱稱不能為空！');
        if (code.length !== 4) return showError('房號必須是 4 碼！');
        socket.emit('joinRoom', { name: nickname, roomCode: code, gameType: 'undercover' });
    });

    document.querySelectorAll('[data-setting]').forEach(btn => {
        btn.addEventListener('click', () => {
            if (!latestState) return;
            AudioSynth.playTick();
            const key = btn.dataset.setting;
            const value = latestState.setup[key] + Number(btn.dataset.delta);
            socket.emit('undercover_settings', { [key]: value });
        });
    });

    $('btn-start-game').addEventListener('click', () => {
        AudioSynth.playTick();
        socket.emit('startGame');
    });

    $('word-card').addEventListener('click', () => {
        AudioSynth.playTick();
        wordShown = !wordShown;
        if (latestState) renderWordCard(latestState);
    });

    $('btn-done-speaking').addEventListener('click', () => {
        AudioSynth.playTick();
        socket.emit('undercover_doneSpeaking');
    });
    $('btn-skip-speaker').addEventListener('click', () => {
        AudioSynth.playTick();
        socket.emit('undercover_doneSpeaking');
    });
    $('btn-propose-early').addEventListener('click', () => {
        AudioSynth.playTick();
        socket.emit('undercover_proposeEarlyVote');
    });
    $('btn-early-yes').addEventListener('click', () => {
        AudioSynth.playTick();
        socket.emit('undercover_earlyVoteAnswer', { agree: true });
    });
    $('btn-early-no').addEventListener('click', () => {
        AudioSynth.playTick();
        socket.emit('undercover_earlyVoteAnswer', { agree: false });
    });
    $('btn-force-tally').addEventListener('click', () => {
        if (confirm('還有人沒投票，確定要直接開票嗎？')) socket.emit('undercover_forceTally');
    });
    $('btn-continue').addEventListener('click', () => {
        AudioSynth.playTick();
        socket.emit('undercover_continue');
    });

    $('btn-restart').addEventListener('click', () => {
        AudioSynth.playTick();
        socket.emit('restartGame');
    });
    $('btn-exit-lobby').addEventListener('click', () => {
        BoardgameSession.exitToPortal();
    });
}

// SOCKET MESSAGE HANDLERS
socket.on('roomUpdate', (state) => {
    latestState = state;
    if (!state.gameStarted) {
        wordShown = false;
        lastSoundKey = null;
        $('game-over-modal').classList.remove('active');
        switchView('waiting');
        renderWaitingRoom(state);
    } else {
        switchView('game');
        renderGameBoard(state);
    }
});

socket.on('errorMsg', showError);

socket.on('kicked', () => {
    showError('你已被房主剔除出房間。');
    switchView('login');
});

window.addEventListener('load', initEvents);
