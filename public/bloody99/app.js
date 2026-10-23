// Client-side interactions for 血腥99 (Bloody 99, team edition)

const socket = BoardgameSession.connect('bloody99');
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
    playBoom() { this.playTone(110, 0.5, 'sawtooth', 0.15); },
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

const TEAM_NAMES = { red: '🔴 紅隊', black: '⚫ 黑隊' };
const RANK_NAMES = { 1: 'A', 11: 'J', 12: 'Q', 13: 'K' };
const RED_SUITS = ['♥', '♦'];

let latestState = null;
let roleShown = false;
let modalDismissed = false;
let selectedIds = [];
let lastPlayCount = null;

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

function button(label, className, onClick) {
    const btn = el('button', 'btn ' + className);
    btn.appendChild(el('span', null, label));
    btn.addEventListener('click', () => {
        AudioSynth.playTick();
        onClick();
    });
    return btn;
}

const rankName = (rank) => RANK_NAMES[rank] || String(rank);
const cardName = (c) => `${c.suit}${rankName(c.rank)}`;

function nameOf(state, id) {
    const p = state.players.find(pl => pl.id === id);
    return p ? p.name : '?';
}

// Short effect text shown on each card
function effectOf(rank) {
    switch (rank) {
        case 1: return '抽別人一張牌';
        case 4: return '迴轉';
        case 5: return '指定下一位';
        case 7: return '交換手牌';
        case 10: return '±10';
        case 11: return 'Pass';
        case 12: return '±20';
        case 13: return '變成 99';
        default: return `+${rank}`;
    }
}

// Would this card push the total over the limit? (10 / Q can always go down)
function isUnsafe(state, card) {
    if ([2, 3, 6, 8, 9].includes(card.rank)) return state.total + card.rank > state.limit;
    return false;
}

function rerender() {
    if (latestState && latestState.gameStarted) renderGameBoard(latestState);
}

// RENDER LOBBY WAITING ROOM
function renderWaitingRoom(state) {
    $('display-room-code').textContent = state.roomCode;
    $('player-count').textContent = state.players.length;
    const me = state.players.find(p => p.id === socket.id);
    const isHost = me ? me.host : false;

    const list = $('lobby-players-list');
    list.innerHTML = '';
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
            actions.appendChild(button('剔除', 'btn-brass btn-small', () => socket.emit('kickPlayer', { targetId: p.id })));
        }
        li.appendChild(actions);
        list.appendChild(li);
    });

    const setup = state.setup;
    $('setting-decks').textContent = setup.decks;
    $('btn-decks-minus').style.visibility = isHost && setup.decks > 1 ? 'visible' : 'hidden';
    $('btn-decks-plus').style.visibility = isHost && setup.decks < 3 ? 'visible' : 'hidden';
    const black = Math.ceil(setup.total / 2);
    $('decks-note').textContent = `${setup.decks * 52} 張牌，開局發掉 ${setup.total * 5} 張，牌堆剩 ${Math.max(0, setup.decks * 52 - setup.total * 5)} 張。`
        + `${setup.autoDecks ? `目前是建議值（${setup.defaultDecks} 副）。` : '房主自訂。'}`
        + `｜${setup.total} 人：紅隊 ${setup.total - black}、黑隊 ${black}`;
    $('toggle-kings').checked = setup.kingsReveal === 'both';
    $('toggle-black-king').checked = setup.kingsReveal === 'black';
    $('toggle-kings').disabled = !isHost;
    $('toggle-black-king').disabled = !isHost;

    const startBtn = $('btn-start-game');
    const statusMsg = $('lobby-status-msg');
    if (isHost) {
        startBtn.style.display = 'block';
        startBtn.classList.toggle('disabled', !!setup.error);
        startBtn.disabled = !!setup.error;
        statusMsg.textContent = setup.error || '你是房主！人到齊就可以開始。';
    } else {
        startBtn.style.display = 'none';
        statusMsg.textContent = '等待房主開始遊戲...';
    }
}

// IDENTITY CARD: hidden until tapped
function renderIdentity(state) {
    const my = state.my;
    const card = $('role-card');
    card.classList.toggle('peeking', roleShown);
    card.classList.toggle('team-red', roleShown && !!my && my.team === 'red');
    card.classList.toggle('team-black', roleShown && !!my && my.team === 'black');
    if (!roleShown || !my) {
        $('role-card-value').textContent = '👀 點我看陣營';
        $('role-card-desc').textContent = '';
        return;
    }
    $('role-card-value').textContent = `${TEAM_NAMES[my.team]}${my.king ? '｜👑 你是王！' : ''}`;
    $('role-card-desc').textContent = my.king
        ? (state.kingsReveal === 'both' || (state.kingsReveal === 'black' && my.team === 'black')
            ? '大家都知道你是王，小心別被爆掉！'
            : '你的身分是秘密，別讓對手發現你是王。')
        : `保護你們的王，想辦法讓${my.team === 'red' ? '黑' : '紅'}隊的王爆掉。`;
}

function renderBoard(state) {
    $('display-total').textContent = state.total;
    $('display-dir').textContent = state.dir === 1 ? '↻ 順時針' : '↺ 逆時針';
    $('display-dir').classList.toggle('reverse', state.dir !== 1);
    $('display-deck').textContent = state.deckCount;
    const last = $('last-play');
    if (state.last) {
        const l = state.last;
        last.className = 'b9-last' + (l.bust ? ' bust' : '');
        const shown = l.cards.length > 1 ? `${l.cards.map(cardName).join('+')}（當 ${rankName(l.rank)}）` : cardName(l.cards[0]);
        last.textContent = `${nameOf(state, l.by)} 出 ${shown}：${l.text}（${l.before} ➔ ${l.after}）${l.bust ? '💥 爆了！' : ''}`;
    } else {
        last.className = 'b9-last';
        last.textContent = '還沒有人出牌';
    }
}

// Seats around a circle in seat order (clockwise), with you at the bottom
function renderRing(state) {
    const box = $('ring-seats');
    box.innerHTML = '';
    const seats = state.players;
    const n = seats.length;
    const myIdx = Math.max(0, seats.findIndex(p => p.id === socket.id));
    // Next living player in the current direction, after whoever is on turn
    let nextId = null;
    const turnIdx = seats.findIndex(p => p.id === state.turnId);
    if (turnIdx >= 0 && !state.gameEnded) {
        for (let step = 1; step < n; step++) {
            const p = seats[((turnIdx + step * state.dir) % n + n) % n];
            if (!p.dead && !p.left) { nextId = p.id; break; }
        }
    }
    const radius = n > 8 ? 41 : 39;
    seats.forEach((p, i) => {
        // 90° is the bottom; growing angles go clockwise on screen
        const angle = (90 + ((i - myIdx + n) % n) * 360 / n) * Math.PI / 180;
        const seat = el('div', 'b9-seat');
        seat.style.left = `${50 + radius * Math.cos(angle)}%`;
        seat.style.top = `${50 + radius * Math.sin(angle)}%`;
        if (p.id === socket.id) seat.classList.add('me');
        if (p.id === state.turnId && !state.gameEnded) seat.classList.add('turn');
        if (p.id === nextId) seat.classList.add('next');
        if (p.dead || p.left) seat.classList.add('dead');
        if (p.team) seat.classList.add(`team-${p.team}`);
        const marks = `${p.team ? (p.team === 'red' ? '🔴' : '⚫') : ''}${p.king ? '👑' : ''}`;
        seat.appendChild(el('span', 'b9-seat-name', `${marks}${p.name}`));
        seat.appendChild(el('span', 'b9-seat-info', p.dead ? '💀' : p.left ? '已離開' : `🂠 ${p.handCount}${p.connected ? '' : ' 📴'}`));
        if (p.id === state.turnId && !state.gameEnded) seat.appendChild(el('span', 'b9-seat-tag', '出牌中'));
        else if (p.id === nextId) seat.appendChild(el('span', 'b9-seat-tag next', '下一位'));
        box.appendChild(seat);
    });
}

function renderPlayers(state) {
    renderRing(state);
    const list = $('players-list');
    list.innerHTML = '';
    state.players.forEach(p => {
        const li = el('li', 'ms-player');
        if (p.id === socket.id) li.classList.add('is-me');
        if (p.id === state.turnId && !state.gameEnded) li.classList.add('turn');
        if (p.dead) li.classList.add('dead');
        if (p.team) li.classList.add(`team-${p.team}`);
        if (!p.connected) li.classList.add('disconnected');
        const king = p.king ? '👑' : '';
        const team = p.team ? (p.team === 'red' ? '🔴' : '⚫') : '';
        li.appendChild(el('span', 'ms-name', `${p.id === state.turnId && !state.gameEnded ? '👉 ' : ''}${team}${king}${p.name}${p.id === socket.id ? ' (你)' : ''}${p.connected ? '' : ' 📴'}`));
        li.appendChild(el('span', 'ms-status', p.dead ? `💀 ${p.deathReason || ''}` : ''));
        li.appendChild(el('span', 'ms-coins', p.dead ? '' : `🂠 ${p.handCount}`));
        list.appendChild(li);
    });
}

function renderPlayLog(state) {
    const log = $('play-log');
    log.innerHTML = '';
    if (!state.playCount) log.appendChild(el('li', null, '還沒有人出牌。'));
    [...state.history].reverse().filter(h => h.type === 'play' || h.type === 'death').slice(0, 30)
        .forEach(h => log.appendChild(el('li', null, h.text)));
}

function targetGrid(state, ids, onPick) {
    const grid = el('div', 'target-grid');
    ids.forEach(id => {
        const p = state.players.find(x => x.id === id);
        grid.appendChild(button(`${p.name}（${p.handCount} 張）`, 'target-btn', () => onPick(id)));
    });
    return grid;
}

function renderControls(state) {
    const panel = $('control-panel');
    panel.innerHTML = '';
    const my = state.my;
    const me = state.players.find(p => p.id === socket.id);
    const hint = (text) => panel.appendChild(el('div', 'control-hint', text));
    const myTurn = state.turnId === socket.id && !state.gameEnded;
    const current = nameOf(state, state.turnId);

    if (state.gameEnded) {
        hint('🏁 遊戲結束！');
        panel.appendChild(button('🏆 看結果', 'btn-gold btn-wide', () => { modalDismissed = false; rerender(); }));
        return `🏁 ${TEAM_NAMES[state.winner]}獲勝！`;
    }
    if (!my || my.dead) {
        hint('💀 你已經死了，在旁邊看大家廝殺吧（還是可以當面幫隊友出主意）。');
        return `👉 輪到 ${current} 出牌`;
    }

    hint(myTurn ? `👉 輪到你了！目前點數 ${state.total}，選牌（可以選好幾張，加起來 ≤ 13 當成那張牌）：` : `⏳ 輪到 ${current} 出牌。這是你的手牌：`);
    const hand = el('div', 'b9-hand');
    selectedIds = selectedIds.filter(id => my.hand.some(c => c.id === id));
    my.hand.forEach(c => {
        const btn = el('button', 'b9-card' + (RED_SUITS.includes(c.suit) ? ' red' : '')
            + (selectedIds.includes(c.id) ? ' selected' : '') + (myTurn && isUnsafe(state, c) ? ' unsafe' : ''));
        btn.type = 'button';
        btn.appendChild(el('span', 'rank', cardName(c)));
        btn.appendChild(el('span', 'effect', effectOf(c.rank)));
        btn.disabled = !myTurn;
        btn.addEventListener('click', () => {
            AudioSynth.playTick();
            selectedIds = selectedIds.includes(c.id) ? selectedIds.filter(id => id !== c.id) : [...selectedIds, c.id];
            rerender();
        });
        hand.appendChild(btn);
    });
    panel.appendChild(hand);
    if (!my.hand.length) hint('你手上沒有牌了。');

    if (myTurn && my.hand.length && my.hand.every(c => isUnsafe(state, c))) {
        hint('😱 你手上每一張單出都會爆……試試合併出牌，或隨便選一張吧。');
    }

    const chosen = my.hand.filter(c => selectedIds.includes(c.id));
    if (myTurn && chosen.length) {
        // Several cards count as one card of their summed rank
        const rank = chosen.reduce((sum, c) => sum + c.rank, 0);
        const label = chosen.length > 1 ? `${chosen.map(cardName).join('+')} = ${rankName(rank)}` : cardName(chosen[0]);
        const play = (extra) => socket.emit('bloody99_play', { cardIds: chosen.map(c => c.id), ...extra });
        const others = state.players.filter(p => !p.dead && !p.left && p.id !== socket.id);
        const handAfter = my.hand.length - chosen.length;
        if (chosen.length > 1) hint(rank > 13 ? `${chosen.map(cardName).join('+')} = ${rank}，超過 13 不能出。` : `🃏 ${label}：${effectOf(rank)}`);
        if (rank > 13) {
            // nothing to play
        } else if (rank === 10 || rank === 12) {
            const n = rank === 10 ? 10 : 20;
            const row = el('div', 'action-row');
            row.appendChild(button(`➖ −${n}（變 ${Math.max(0, state.total - n)}）`, 'btn-gold', () => play({ sign: '-' })));
            const plus = button(`➕ +${n}（變 ${state.total + n}）`, 'btn-brass', () => {
                if (state.total + n > state.limit && !confirm(`會變成 ${state.total + n}，超過 ${state.limit} 你就死了，確定嗎？`)) return;
                play({ sign: '+' });
            });
            row.appendChild(plus);
            panel.appendChild(row);
        } else if (rank === 1) {
            hint('🫳 要抽誰的牌？（隨機抽一張，不能看）');
            panel.appendChild(targetGrid(state, others.filter(p => p.handCount > 0).map(p => p.id), id => play({ targetId: id })));
        } else if (rank === 7) {
            hint(handAfter === 0 ? `🔄 出完 ${label} 你就沒牌了！換給誰，誰就拿到空手、立刻死亡：` : '🔄 要跟誰交換全部手牌？');
            panel.appendChild(targetGrid(state, others.map(p => p.id), id => {
                if (handAfter === 0 && !confirm(`${nameOf(state, id)} 會拿到空手並立刻死亡，確定嗎？`)) return;
                play({ targetId: id });
            }));
        } else if (rank === 5) {
            hint('👉 指定誰下一個出牌？');
            panel.appendChild(targetGrid(state, others.map(p => p.id), id => play({ targetId: id })));
        } else {
            const after = rank === 13 ? state.limit : [4, 11].includes(rank) ? state.total : state.total + rank;
            const unsafe = isUnsafe(state, { rank });
            panel.appendChild(button(`出 ${label}（${effectOf(rank)}，點數變 ${after}）`, unsafe ? 'btn-brass btn-wide' : 'btn-gold btn-wide', () => {
                if (unsafe && !confirm(`會變成 ${after}，你會爆掉死亡，確定嗎？`)) return;
                play({});
            }));
        }
        if (chosen.length > 1) panel.appendChild(button('↩️ 取消選擇', 'btn-brass btn-small', () => { selectedIds = []; rerender(); }));
    }

    if (me && me.host && !myTurn) {
        const cur = state.players.find(p => p.id === state.turnId);
        if (cur && !cur.connected) {
            panel.appendChild(button(`⏭️ ${cur.name} 斷線了，跳過他`, 'btn-brass btn-small', () => socket.emit('bloody99_skip')));
        }
    }
    return myTurn ? `👉 輪到你出牌！點數 ${state.total}` : `⏳ 輪到 ${current} 出牌（點數 ${state.total}）`;
}

// GAME OVER
function renderGameOver(state) {
    const modal = $('game-over-modal');
    if (!state.gameEnded || !state.winner || modalDismissed) {
        modal.classList.remove('active');
        return;
    }
    $('winner-title').textContent = `🏆 ${TEAM_NAMES[state.winner]}獲勝！`;
    $('winner-reason').textContent = state.reason;
    const names = $('winner-names');
    names.innerHTML = '';
    const describe = (p) => `${p.king ? '👑' : ''}${p.name}${p.dead ? '💀' : ''}`;
    const winners = state.players.filter(p => p.team === state.winner);
    const losers = state.players.filter(p => p.team !== state.winner);
    names.appendChild(el('div', 'winner-line win', `🏆 贏家（${TEAM_NAMES[state.winner]}）：${winners.map(describe).join('、')}`));
    names.appendChild(el('div', 'winner-line lose', `💀 輸家：${losers.map(describe).join('、')}`));

    const list = $('final-list');
    list.innerHTML = '';
    state.players.forEach(p => {
        const li = el('li');
        if (p.team === state.winner) li.classList.add('rank-first');
        li.appendChild(el('span', null, `${TEAM_NAMES[p.team]}${p.king ? '｜👑 王' : ''}｜${p.name}`));
        li.appendChild(el('strong', null, p.dead ? `💀 ${p.deathReason || '死亡'}` : '存活'));
        list.appendChild(li);
    });
    const me = state.players.find(p => p.id === socket.id);
    $('btn-restart').style.display = me ? 'inline-block' : 'none';
    modal.classList.add('active');
}

// RENDER MAIN GAME BOARD
function renderGameBoard(state) {
    latestState = state;
    renderIdentity(state);
    renderBoard(state);
    $('ticker-text').textContent = renderControls(state);
    renderPlayers(state);
    renderPlayLog(state);
    renderGameOver(state);
    playStateSounds(state);
}

function playStateSounds(state) {
    const count = state.playCount;
    if (lastPlayCount === null || count === lastPlayCount) {
        lastPlayCount = count;
        return;
    }
    lastPlayCount = count;
    if (state.gameEnded) AudioSynth.playSuccess();
    else if (state.last && state.last.bust) AudioSynth.playBoom();
    else if (state.turnId === socket.id) AudioSynth.playNotify();
}

// REGISTER CLICK & FORM EVENT LISTENERS
function initEvents() {
    $('btn-create-room').addEventListener('click', () => {
        AudioSynth.playTick();
        const nickname = $('input-nickname').value.trim();
        if (!nickname) return showError('暱稱不能為空！');
        socket.emit('createRoom', { name: nickname, gameType: 'bloody99' });
    });

    $('btn-join-room').addEventListener('click', () => {
        AudioSynth.playTick();
        const nickname = $('input-nickname').value.trim();
        const code = $('input-room-code').value.trim().toUpperCase();
        if (!nickname) return showError('暱稱不能為空！');
        if (code.length !== 4) return showError('房號必須是 4 碼！');
        socket.emit('joinRoom', { name: nickname, roomCode: code, gameType: 'bloody99' });
    });

    $('btn-decks-minus').addEventListener('click', () => {
        AudioSynth.playTick();
        socket.emit('bloody99_settings', { decks: latestState.setup.decks - 1 });
    });
    $('btn-decks-plus').addEventListener('click', () => {
        AudioSynth.playTick();
        socket.emit('bloody99_settings', { decks: latestState.setup.decks + 1 });
    });
    // The two king options exclude each other; neither ticked hides both kings
    $('toggle-kings').addEventListener('change', () => {
        AudioSynth.playTick();
        socket.emit('bloody99_settings', { kingsReveal: $('toggle-kings').checked ? 'both' : 'none' });
    });
    $('toggle-black-king').addEventListener('change', () => {
        AudioSynth.playTick();
        socket.emit('bloody99_settings', { kingsReveal: $('toggle-black-king').checked ? 'black' : 'none' });
    });

    $('btn-start-game').addEventListener('click', () => {
        AudioSynth.playTick();
        socket.emit('startGame');
    });

    $('role-card').addEventListener('click', () => {
        AudioSynth.playTick();
        roleShown = !roleShown;
        rerender();
    });

    document.querySelectorAll('[data-open-help]').forEach(btn => btn.addEventListener('click', () => {
        AudioSynth.playTick();
        $('help-modal').classList.add('active');
    }));
    $('btn-close-help').addEventListener('click', () => $('help-modal').classList.remove('active'));
    $('help-modal').addEventListener('click', (e) => {
        if (e.target === $('help-modal')) $('help-modal').classList.remove('active');
    });

    $('btn-restart').addEventListener('click', () => {
        AudioSynth.playTick();
        socket.emit('restartGame');
    });
    $('btn-close-modal').addEventListener('click', () => {
        AudioSynth.playTick();
        modalDismissed = true;
        rerender();
    });
    $('btn-exit-lobby').addEventListener('click', () => {
        BoardgameSession.exitToPortal();
    });
}

// SOCKET MESSAGE HANDLERS
socket.on('roomUpdate', (state) => {
    latestState = state;
    if (!state.gameStarted) {
        roleShown = false;
        modalDismissed = false;
        selectedIds = [];
        lastPlayCount = null;
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
