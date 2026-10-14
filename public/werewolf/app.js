// Client-side interactions for 一夜終極狼人 (One Night Werewolf)

const socket = BoardgameSession.connect('werewolf');
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

const PHASE_LABELS = { night: '🌙 夜晚', day: '☀️ 白天', voting: '🗳️ 投票', game_over: '🏁 結束' };
const TEAM_NAMES = { village: '好人陣營', werewolf: '狼人陣營', tanner: '皮匠' };

let latestState = null;
let roleShown = false;
let lastSoundKey = null;
let clockOffset = 0;
// Local picks for multi-select night actions; reset each game
let picks = { players: [], center: [], seerMode: null };

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

function roleLabel(state, role) {
    const info = state.roleInfo[role];
    return info ? `${info.icon} ${info.name}` : '？';
}

function nameOf(state, id) {
    const p = state.players.find(pl => pl.id === id);
    return p ? p.name : '?';
}

function rerender() {
    if (latestState && latestState.gameStarted) renderGameBoard(latestState);
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

    // Role counts (host adjusts with steppers)
    const setup = state.setup;
    const box = $('role-steppers');
    box.innerHTML = '';
    state.roleOrder.forEach(role => {
        const info = state.roleInfo[role];
        const count = setup.counts[role] || 0;
        const row = el('div', 'role-stepper-row' + (count ? ' on' : ''));
        const label = el('span', null, `${info.icon} ${info.name}`);
        label.title = info.desc;
        row.appendChild(label);
        const stepper = el('div', 'stepper');
        const change = (delta) => {
            const counts = { ...setup.counts, [role]: count + delta };
            socket.emit('werewolf_settings', { counts });
        };
        if (isHost) stepper.appendChild(button('－', 'btn-brass btn-small', () => change(-1)));
        stepper.appendChild(el('strong', null, String(count)));
        if (isHost) stepper.appendChild(button('＋', 'btn-brass btn-small', () => change(1)));
        row.appendChild(stepper);
        box.appendChild(row);
    });
    $('role-count-note').textContent = `身分牌 ${setup.cardCount} 張／需要 ${setup.cardsNeeded} 張（人數＋3）｜${setup.auto ? '目前是建議組合' : '房主自訂'}`;
    $('btn-reset-roles').style.display = isHost && !setup.auto ? 'inline-block' : 'none';
    $('setting-minutes').textContent = setup.discussMinutes;
    $('btn-time-minus').style.visibility = isHost ? 'visible' : 'hidden';
    $('btn-time-plus').style.visibility = isHost ? 'visible' : 'hidden';

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

// ROLE CARD + NIGHT INFO: hidden until tapped
function renderRoleCard(state) {
    const my = state.my;
    $('role-card').classList.toggle('peeking', roleShown);
    $('role-card-value').textContent = roleShown && my ? roleLabel(state, my.startRole) : '👀 點我看身分';

    const section = $('night-info-section');
    const list = $('night-info');
    list.innerHTML = '';
    const info = my ? my.nightInfo : [];
    section.style.display = roleShown && info.length ? 'block' : 'none';
    info.forEach(text => list.appendChild(el('li', null, text)));
}

function renderRolesInGame(state) {
    const list = $('roles-in-game');
    list.innerHTML = '';
    let total = 0;
    state.rolesInGame.forEach(({ role, count }) => {
        total += count;
        const info = state.roleInfo[role];
        const li = el('li');
        li.appendChild(el('strong', null, `${info.icon} ${info.name}${count > 1 ? ` ×${count}` : ''}：`));
        li.appendChild(el('span', null, info.desc));
        list.appendChild(li);
    });
    $('roles-total').textContent = total;
}

function playerButtons(state, ids, selected, onPick) {
    const grid = el('div', 'target-grid');
    ids.forEach(id => grid.appendChild(button(nameOf(state, id), 'target-btn' + (selected.includes(id) ? ' chosen' : ''), () => onPick(id))));
    return grid;
}

function centerButtons(selected, onPick) {
    const grid = el('div', 'target-grid');
    [0, 1, 2].forEach(i => grid.appendChild(button(`🂠 中間第 ${i + 1} 張`, 'target-btn' + (selected.includes(i) ? ' chosen' : ''), () => onPick(i))));
    return grid;
}

const toggle = (list, value, max) => (list.includes(value) ? list.filter(v => v !== value) : [...list, value].slice(-max));

// NIGHT ACTION UI for the player's starting role
function renderNight(state, panel) {
    const my = state.my;
    const hint = (text) => panel.appendChild(el('div', 'control-hint', text));
    const others = state.players.filter(p => p.id !== socket.id).map(p => p.id);
    const send = (action) => socket.emit('werewolf_night', action);
    const done = state.players.filter(p => p.nightDone).length;

    if (my.nightDone) {
        hint(`🌙 你已完成夜晚行動，等待其他人…（${done}/${state.players.length}）`);
        if (!roleShown) hint('點上面的身分卡可以再看一次你的情報。');
        return;
    }
    if (!roleShown) {
        hint('🌙 天黑了！先點上面的卡片看你的身分（小心別被旁邊的人看到）。');
        return;
    }

    switch (my.startRole) {
        case 'werewolf':
            if (my.loneWolf) {
                hint('🐺 你是唯一的狼人，可以偷看中間 1 張牌：');
                panel.appendChild(centerButtons([], i => send({ centerIndex: i })));
                panel.appendChild(button('不看', 'btn-brass btn-small', () => send({})));
            } else {
                hint('🐺 記住你的狼人隊友（看下面的夜晚情報）。');
                panel.appendChild(button('✅ 記住了', 'btn-gold btn-wide', () => send({})));
            }
            break;
        case 'seer':
            hint('🔮 偷看一位玩家的牌，或中間 2 張牌：');
            panel.appendChild(playerButtons(state, others, [], id => send({ playerId: id })));
            hint(`或選中間 2 張（已選 ${picks.center.length}/2）：`);
            panel.appendChild(centerButtons(picks.center, i => { picks.center = toggle(picks.center, i, 2); rerender(); }));
            if (picks.center.length === 2) panel.appendChild(button('👀 看這兩張', 'btn-gold btn-wide', () => send({ centerIndexes: picks.center })));
            panel.appendChild(button('不看', 'btn-brass btn-small', () => send({ skip: true })));
            break;
        case 'robber':
            hint('🦹 要搶誰的牌？（換完會看到你的新身分）');
            panel.appendChild(playerButtons(state, others, [], id => send({ playerId: id })));
            panel.appendChild(button('不搶', 'btn-brass btn-small', () => send({ skip: true })));
            break;
        case 'troublemaker':
            hint(`🃏 選兩位玩家交換他們的牌（已選 ${picks.players.length}/2）：`);
            panel.appendChild(playerButtons(state, others, picks.players, id => { picks.players = toggle(picks.players, id, 2); rerender(); }));
            if (picks.players.length === 2) panel.appendChild(button('🔄 交換他們', 'btn-gold btn-wide', () => send({ playerIds: picks.players })));
            panel.appendChild(button('不換', 'btn-brass btn-small', () => send({ skip: true })));
            break;
        case 'drunk':
            hint('🍺 選中間一張牌和你的牌交換（你不會知道換到什麼）：');
            panel.appendChild(centerButtons([], i => send({ centerIndex: i })));
            break;
        case 'minion':
            hint('😈 記住誰是狼人（看下面的夜晚情報），想辦法保護他們。');
            panel.appendChild(button('✅ 記住了', 'btn-gold btn-wide', () => send({})));
            break;
        case 'mason':
            hint('👷 記住另一位守夜人（看下面的夜晚情報）。');
            panel.appendChild(button('✅ 記住了', 'btn-gold btn-wide', () => send({})));
            break;
        case 'insomniac':
            hint('😴 天亮前你會看到自己最後的牌。');
            panel.appendChild(button('✅ 好，睡覺', 'btn-gold btn-wide', () => send({})));
            break;
        default:
            hint(`${roleLabel(state, my.startRole)} 晚上沒有行動。按確認繼續睡（大家都要按，別人看不出你是誰）。`);
            panel.appendChild(button('✅ 確認', 'btn-gold btn-wide', () => send({})));
    }
}

function renderControls(state) {
    const panel = $('control-panel');
    panel.innerHTML = '';
    const me = state.players.find(p => p.id === socket.id);
    const isHost = me && me.host;
    const hint = (text) => panel.appendChild(el('div', 'control-hint', text));

    if (state.roundPhase === 'night') {
        renderNight(state, panel);
        const stuck = state.players.some(p => !p.nightDone && !p.connected);
        if (isHost && stuck) {
            panel.appendChild(button('⏭️ 有人斷線，直接天亮', 'btn-brass btn-small', () => {
                if (confirm('還有人沒完成夜晚行動，確定直接天亮嗎？')) socket.emit('werewolf_forceDawn');
            }));
        }
        return '🌙 天黑請閉眼……';
    }

    if (state.roundPhase === 'day') {
        hint('☀️ 天亮了！大家當面討論誰是狼人。可以說謊，也可以假裝自己是別的身分。');
        if (isHost) panel.appendChild(button('🗳️ 討論完了，開始投票', 'btn-gold btn-wide', () => socket.emit('werewolf_startVoting')));
        else hint('時間到或房主按下後開始投票。');
        return '☀️ 白天討論中';
    }

    if (state.roundPhase === 'voting') {
        const voted = state.votedIds.length;
        const total = state.players.filter(p => !p.left).length;
        hint('🗳️ 你要投誰？（全部投完前可以改）');
        const others = state.players.filter(p => p.id !== socket.id && !p.left).map(p => p.id);
        panel.appendChild(playerButtons(state, others, state.myVote ? [state.myVote] : [], id => socket.emit('werewolf_vote', { targetId: id })));
        hint(`已投票 ${voted}/${total}，全部投完自動開票`);
        if (isHost && voted > 0) panel.appendChild(button('⏱️ 不等了，直接開票', 'btn-brass btn-small', () => {
            if (confirm('還有人沒投票，確定直接開票嗎？')) socket.emit('werewolf_forceTally');
        }));
        return state.myVote ? `🗳️ 你投給了 ${nameOf(state, state.myVote)}` : '🗳️ 投票時間！';
    }

    hint('🏁 遊戲結束！');
    return '🏁 遊戲結束！';
}

function renderTimer(state) {
    if (state.roundPhase === 'day' && state.dayEndsAt) {
        const left = Math.max(0, Math.round((state.dayEndsAt - (Date.now() + clockOffset)) / 1000));
        $('display-timer').textContent = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
    } else {
        $('display-timer').textContent = '-';
    }
}

// GAME OVER
function renderGameOver(state) {
    const modal = $('game-over-modal');
    if (!state.gameEnded || !state.result) {
        modal.classList.remove('active');
        return;
    }
    const r = state.result;
    $('winner-title').textContent = r.winningTeams.length
        ? `🏆 ${r.winningTeams.map(t => TEAM_NAMES[t]).join('、')}獲勝！`
        : '😶 沒有陣營獲勝';

    const events = $('result-events');
    events.innerHTML = '';
    const deadNames = r.dead.map(id => nameOf(state, id));
    events.appendChild(el('li', null, deadNames.length ? `☠️ 死亡：${deadNames.join('、')}` : '☠️ 沒有人死亡'));
    r.events.forEach(text => events.appendChild(el('li', null, text)));

    const list = $('final-list');
    list.innerHTML = '';
    state.players.forEach(p => {
        const li = el('li');
        const won = r.winnerIds.includes(p.id);
        if (won) li.classList.add('rank-first');
        const vote = r.votes.find(v => v.voter === p.id);
        const changed = p.startRole !== p.finalRole ? ` ➔ ${roleLabel(state, p.finalRole)}` : '';
        li.appendChild(el('span', null, `${won ? '🏆 ' : ''}${r.dead.includes(p.id) ? '☠️ ' : ''}${p.name}：${roleLabel(state, p.startRole)}${changed}`));
        li.appendChild(el('strong', null, vote ? `投 ${nameOf(state, vote.target)}` : '沒投'));
        list.appendChild(li);
    });

    if (state.center) {
        const parts = state.center.final.map((card, i) => {
            const start = state.center.start[i];
            return `第 ${i + 1} 張 ${roleLabel(state, start)}${start !== card ? ` ➔ ${roleLabel(state, card)}` : ''}`;
        });
        $('center-reveal').textContent = `中間的牌：${parts.join('｜')}`;
    }

    const log = $('night-log');
    log.innerHTML = '';
    if (!state.nightLog.length) log.appendChild(el('li', null, '昨晚沒有人動牌。'));
    state.nightLog.forEach(text => log.appendChild(el('li', null, text)));

    const me = state.players.find(p => p.id === socket.id);
    $('btn-restart').style.display = me ? 'inline-block' : 'none';
    modal.classList.add('active');
}

// RENDER MAIN GAME BOARD
function renderGameBoard(state) {
    latestState = state;
    $('display-phase').textContent = PHASE_LABELS[state.roundPhase] || '-';
    if (state.roundPhase === 'night') {
        $('display-progress').textContent = `${state.players.filter(p => p.nightDone).length}/${state.players.length}`;
    } else if (state.roundPhase === 'voting') {
        $('display-progress').textContent = `${state.votedIds.length}/${state.players.filter(p => !p.left).length}`;
    } else {
        $('display-progress').textContent = '-';
    }
    renderRoleCard(state);
    renderRolesInGame(state);
    renderTimer(state);
    $('ticker-text').textContent = renderControls(state);
    renderGameOver(state);
    playStateSounds(state);
}

function playStateSounds(state) {
    const key = `${state.roundPhase}`;
    if (key === lastSoundKey) return;
    const first = lastSoundKey === null;
    lastSoundKey = key;
    if (first) return;
    if (state.gameEnded) AudioSynth.playSuccess();
    else AudioSynth.playNotify();
}

// REGISTER CLICK & FORM EVENT LISTENERS
function initEvents() {
    $('btn-create-room').addEventListener('click', () => {
        AudioSynth.playTick();
        const nickname = $('input-nickname').value.trim();
        if (!nickname) return showError('暱稱不能為空！');
        socket.emit('createRoom', { name: nickname, gameType: 'werewolf' });
    });

    $('btn-join-room').addEventListener('click', () => {
        AudioSynth.playTick();
        const nickname = $('input-nickname').value.trim();
        const code = $('input-room-code').value.trim().toUpperCase();
        if (!nickname) return showError('暱稱不能為空！');
        if (code.length !== 4) return showError('房號必須是 4 碼！');
        socket.emit('joinRoom', { name: nickname, roomCode: code, gameType: 'werewolf' });
    });

    $('btn-reset-roles').addEventListener('click', () => {
        AudioSynth.playTick();
        socket.emit('werewolf_settings', { counts: null });
    });
    $('btn-time-minus').addEventListener('click', () => {
        AudioSynth.playTick();
        socket.emit('werewolf_settings', { discussMinutes: latestState.setup.discussMinutes - 1 });
    });
    $('btn-time-plus').addEventListener('click', () => {
        AudioSynth.playTick();
        socket.emit('werewolf_settings', { discussMinutes: latestState.setup.discussMinutes + 1 });
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

    $('btn-restart').addEventListener('click', () => {
        AudioSynth.playTick();
        socket.emit('restartGame');
    });
    $('btn-exit-lobby').addEventListener('click', () => {
        BoardgameSession.exitToPortal();
    });

    setInterval(() => { if (latestState && latestState.gameStarted) renderTimer(latestState); }, 1000);
}

// SOCKET MESSAGE HANDLERS
socket.on('roomUpdate', (state) => {
    latestState = state;
    if (state.serverNow) clockOffset = state.serverNow - Date.now();
    if (!state.gameStarted) {
        roleShown = false;
        lastSoundKey = null;
        picks = { players: [], center: [], seerMode: null };
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
