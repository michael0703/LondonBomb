// Client-side interactions for 阿瓦隆 (The Resistance: Avalon)

const socket = BoardgameSession.connect('avalon');
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

const TEAM_NAMES = { good: '好人陣營', evil: '壞人陣營' };
const TEAM_TAGS = { good: '好人', evil: '壞人' };

let latestState = null;
let roleShown = false;
let lastSoundKey = null;
let modalDismissed = false;
// Leader's picks while building a team; reset whenever the phase changes
let picks = [];
let picksKey = null;

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

// One role card: icon, name, team, ability text, plus an optional footer
function roleTile(state, role, on, footer) {
    const info = state.roleInfo[role];
    const team = info.team === 'evil' ? 'werewolf' : 'village';
    const tile = el('div', `role-tile team-${team}` + (on ? ' on' : ''));
    const head = el('div', 'role-tile-head');
    head.appendChild(el('span', 'role-tile-icon', info.icon));
    head.appendChild(el('strong', null, info.name));
    head.appendChild(el('span', 'role-tile-team', TEAM_TAGS[info.team]));
    tile.appendChild(head);
    tile.appendChild(el('p', 'role-tile-desc', info.desc));
    if (footer) tile.appendChild(footer);
    return tile;
}

// Good/evil counts and quest sizes per player count, current count highlighted
function renderCountTable(container, state, current) {
    container.innerHTML = '';
    const table = el('table', 'help-table');
    const head = el('tr');
    ['人數', '好人', '壞人', '任務 1～5 人數'].forEach(t => head.appendChild(el('th', null, t)));
    table.appendChild(head);
    Object.keys(state.teamSizes).forEach(n => {
        const tr = el('tr', Number(n) === current ? 'current' : '');
        const [good, evil] = state.teamSizes[n];
        const sizes = state.questSizeTable[n].map((s, i) => (i === 3 && Number(n) >= 7 ? `${s}*` : String(s))).join('、');
        [n, good, evil, sizes].forEach(t => tr.appendChild(el('td', null, String(t))));
        table.appendChild(tr);
    });
    container.appendChild(table);
    container.appendChild(el('p', 'help-note', '* 7 人以上的第 4 個任務要 2 張失敗才算失敗。'));
}

function renderHelpRoles(state) {
    const list = $('help-roles');
    list.innerHTML = '';
    Object.keys(state.roleInfo).forEach(role => {
        const info = state.roleInfo[role];
        const li = el('li');
        li.appendChild(el('strong', null, `${info.icon} ${info.name}（${TEAM_TAGS[info.team]}）`));
        li.appendChild(el('span', null, `：${info.desc}`));
        list.appendChild(li);
    });
    const extra = el('li', null, '梅林和刺客一定會有；派西維爾、魔甘娜、莫德雷德、奧伯倫由房主在大廳選擇要不要加入。');
    list.appendChild(extra);
    renderCountTable($('help-table'), state, state.players.length);
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

    // Role tiles: Merlin and the assassin are fixed, the host toggles the advanced ones
    const setup = state.setup;
    const box = $('role-tiles');
    box.innerHTML = '';
    ['merlin', 'servant', 'assassin', 'minion'].forEach(role => {
        box.appendChild(roleTile(state, role, true, el('div', 'stepper', role === 'merlin' || role === 'assassin' ? '固定' : '補滿人數')));
    });
    state.extraRoles.forEach(role => {
        const on = setup.extras.includes(role);
        const footer = el('div', 'stepper');
        if (isHost) {
            footer.appendChild(button(on ? '✅ 已加入' : '➕ 加入', on ? 'btn-gold btn-small' : 'btn-brass btn-small', () => {
                const extras = on ? setup.extras.filter(r => r !== role) : [...setup.extras, role];
                socket.emit('avalon_settings', { extras });
            }));
        } else {
            footer.appendChild(el('strong', null, on ? '✅ 已加入' : '未加入'));
        }
        box.insertBefore(roleTile(state, role, on, footer), state.roleInfo[role].team === 'good' ? box.children[1] : null);
    });
    const teams = setup.teams;
    $('role-note').textContent = (teams ? `${setup.total} 人：好人 ${teams[0]}、壞人 ${teams[1]}。` : '需要 5～10 人。')
        + (isHost ? '點進階角色的按鈕加入或移除；空位會補成忠臣／爪牙。' : '進階角色由房主決定。');
    $('toggle-lady').checked = setup.lady;
    $('toggle-lady').disabled = !isHost;

    renderCountTable($('count-table'), state, setup.total);
    renderHelpRoles(state);

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

// ROLE CARD: hidden until tapped
function renderRoleCard(state) {
    const my = state.my;
    $('role-card').classList.toggle('peeking', roleShown);
    $('role-card-value').textContent = roleShown && my ? `${roleLabel(state, my.role)}（${TEAM_NAMES[my.team]}）` : '👀 點我看身分';
    $('role-card-desc').textContent = roleShown && my ? state.roleInfo[my.role].desc : '';
    const info = $('role-card-info');
    info.innerHTML = '';
    if (roleShown && my) [...my.nightInfo, ...my.ladyInfo].forEach(t => info.appendChild(el('li', null, t)));
}

function renderTracks(state) {
    const track = $('quest-track');
    track.innerHTML = '';
    state.questSizes.forEach((size, i) => {
        const result = state.results[i];
        const cls = 'quest-dot' + (result ? ` ${result}` : '') + (i === state.quest && !result && !state.gameEnded ? ' current' : '');
        const dot = el('div', cls);
        dot.appendChild(el('strong', null, result === 'success' ? '✅' : result === 'fail' ? '❌' : String(size)));
        dot.appendChild(el('span', null, `任務 ${i + 1}${state.failsNeeded[i] > 1 ? '（2 敗）' : ''}`));
        track.appendChild(dot);
    });
    $('reject-track').textContent = `連續否決：${state.rejects}/${state.maxRejects}（滿 ${state.maxRejects} 次壞人獲勝）`;
}

function renderPlayers(state) {
    const list = $('players-list');
    list.innerHTML = '';
    state.players.forEach(p => {
        const li = el('li', 'ms-player');
        if (p.id === socket.id) li.classList.add('is-me');
        if (p.id === state.leaderId) li.classList.add('active');
        if (p.left) li.classList.add('left');
        if (!p.connected) li.classList.add('disconnected');
        const marks = [
            p.id === state.leaderId ? '👑' : '',
            state.team.includes(p.id) && state.roundPhase !== 'proposal' ? '⚔️' : '',
            p.id === state.ladyHolderId ? '🌊' : ''
        ].join('');
        li.appendChild(el('span', 'ms-name', `${marks} ${p.name}${p.id === socket.id ? ' (你)' : ''}${p.connected ? '' : ' 📴'}`));
        let status = '';
        if (p.left) status = '已離開';
        else if (state.roundPhase === 'vote') status = p.voted ? '已投票' : '投票中…';
        else if (state.roundPhase === 'quest' && state.team.includes(p.id)) status = p.questDone ? '已出牌' : '出牌中…';
        if (p.role) status = roleLabel(state, p.role);
        li.appendChild(el('span', 'ms-status', status));
        li.appendChild(el('span', 'ms-coins', ''));
        list.appendChild(li);
    });
}

function renderRoundLog(state) {
    const log = $('round-log');
    log.innerHTML = '';
    if (!state.rounds.length) log.appendChild(el('li', null, '還沒有提名。'));
    [...state.rounds].reverse().forEach(r => {
        const li = el('li');
        let text = `任務 ${r.quest + 1}｜👑 ${nameOf(state, r.leaderId)} 提名：${r.team.map(id => nameOf(state, id)).join('、')}`;
        if (r.votes) {
            const yes = Object.keys(r.votes).filter(id => r.votes[id]).map(id => nameOf(state, id));
            const no = Object.keys(r.votes).filter(id => !r.votes[id]).map(id => nameOf(state, id));
            text += `\n${r.approved ? '✅ 通過' : '❌ 否決'}｜同意：${yes.join('、') || '無'}｜反對：${no.join('、') || '無'}`;
        } else {
            text += '\n🗳️ 投票中…';
        }
        if (r.result) text += `\n${r.result.success ? '🏆 任務成功' : '💥 任務失敗'}（${r.result.fails} 張失敗）`;
        li.textContent = text;
        li.style.whiteSpace = 'pre-line';
        log.appendChild(li);
    });
}

function renderRolesInGame(state) {
    const box = $('roles-in-game');
    box.innerHTML = '';
    state.rolesInGame.forEach(role => box.appendChild(roleTile(state, role, true)));
}

function playerGrid(state, ids, selected, onPick) {
    const grid = el('div', 'target-grid');
    ids.forEach(id => grid.appendChild(button(nameOf(state, id) + (id === socket.id ? '（你）' : ''), 'target-btn' + (selected.includes(id) ? ' chosen' : ''), () => onPick(id))));
    return grid;
}

function renderControls(state) {
    const panel = $('control-panel');
    panel.innerHTML = '';
    const me = state.players.find(p => p.id === socket.id);
    const my = state.my;
    const isHost = me && me.host;
    const hint = (text) => panel.appendChild(el('div', 'control-hint', text));
    const active = state.players.filter(p => !p.left).map(p => p.id);
    const leader = nameOf(state, state.leaderId);
    const size = state.questSizes[state.quest];
    const hostForce = (label, question) => {
        if (isHost) panel.appendChild(button(label, 'btn-brass btn-small', () => { if (confirm(question)) socket.emit('avalon_force'); }));
    };

    if (state.roundPhase === 'proposal') {
        if (state.leaderId === socket.id) {
            hint(`👑 你是隊長！選 ${size} 位隊員出第 ${state.quest + 1} 個任務（可以選自己）。已選 ${picks.length}/${size}`);
            panel.appendChild(playerGrid(state, active, picks, id => {
                picks = picks.includes(id) ? picks.filter(x => x !== id) : [...picks, id].slice(-size);
                rerender();
            }));
            if (picks.length === size) panel.appendChild(button('📜 送出提名', 'btn-gold btn-wide', () => socket.emit('avalon_propose', { team: picks })));
        } else {
            hint(`👑 等待隊長 ${leader} 提名 ${size} 位隊員…大家可以當面給建議。`);
            hostForce('⏭️ 隊長不在，換下一位', `確定跳過隊長 ${leader} 嗎？`);
        }
        return `👑 任務 ${state.quest + 1}：${leader} 提名中（${size} 人）`;
    }

    if (state.roundPhase === 'vote') {
        const team = state.team.map(id => nameOf(state, id)).join('、');
        hint(`🗳️ ${leader} 提名：${team}`);
        hint('你同意這支隊伍出任務嗎？（全部投完前可以改）');
        const row = el('div', 'action-row');
        row.appendChild(button('👍 同意', 'btn-gold' + (my && my.vote === true ? ' chosen' : ''), () => socket.emit('avalon_vote', { approve: true })));
        row.appendChild(button('👎 反對', 'btn-brass' + (my && my.vote === false ? ' chosen' : ''), () => socket.emit('avalon_vote', { approve: false })));
        panel.appendChild(row);
        const voted = state.players.filter(p => p.voted).length;
        hint(`${my && my.vote !== null ? `你投了「${my.vote ? '同意' : '反對'}」。` : ''}已投票 ${voted}/${active.length}`);
        hostForce('⏭️ 不等了，直接開票', '還有人沒投票，沒投的人不計，確定開票嗎？');
        return my && my.vote !== null ? '🗳️ 等其他人投票…' : '🗳️ 投票！';
    }

    if (state.roundPhase === 'quest') {
        const done = state.players.filter(p => p.questDone).length;
        if (state.team.includes(socket.id) && my) {
            if (my.questCard) {
                hint(`⚔️ 你已經出牌了，等其他隊員…（${done}/${state.team.length}）`);
            } else {
                hint(my.team === 'good' ? '⚔️ 出任務！你是好人，只能出「成功」。' : '⚔️ 出任務！你是壞人，可以選「成功」或「失敗」。');
                const row = el('div', 'action-row');
                row.appendChild(button('✅ 成功', 'btn-gold', () => socket.emit('avalon_quest', { card: 'success' })));
                const fail = button('❌ 失敗', 'btn-brass', () => socket.emit('avalon_quest', { card: 'fail' }));
                if (my.team === 'good') { fail.disabled = true; fail.classList.add('disabled'); }
                row.appendChild(fail);
                panel.appendChild(row);
                hint('出牌前遮好螢幕，別讓旁邊的人看到。');
            }
        } else {
            hint(`⚔️ ${state.team.map(id => nameOf(state, id)).join('、')} 正在出任務…（${done}/${state.team.length}）`);
        }
        hostForce('⏭️ 不等了，直接公布', '還有隊員沒出牌，沒出的算「成功」，確定公布嗎？');
        return `⚔️ 任務 ${state.quest + 1} 進行中`;
    }

    if (state.roundPhase === 'quest_result' && state.lastQuest) {
        const q = state.lastQuest;
        panel.appendChild(el('div', 'result-line ' + (q.success ? 'good' : 'bad'),
            q.success ? `🏆 任務 ${q.quest + 1} 成功！（${q.fails} 張失敗）` : `💥 任務 ${q.quest + 1} 失敗！（${q.fails} 張失敗${q.needed > 1 ? '，這個任務要 2 張才算失敗' : ''}）`));
        panel.appendChild(button('➡️ 下一步', 'btn-gold btn-wide', () => socket.emit('avalon_continue')));
        hint('大家看完結果後，任何人都可以按下一步。');
        return q.success ? `🏆 任務 ${q.quest + 1} 成功！` : `💥 任務 ${q.quest + 1} 失敗！`;
    }

    if (state.roundPhase === 'lady') {
        const holder = nameOf(state, state.ladyHolderId);
        if (state.ladyHolderId === socket.id) {
            hint('🌊 你拿著湖中女神，選一位玩家查驗他的陣營（只有你會看到結果）：');
            const targets = active.filter(id => id !== socket.id && !state.ladyUsedIds.includes(id));
            panel.appendChild(playerGrid(state, targets, [], id => {
                if (confirm(`確定查驗 ${nameOf(state, id)} 嗎？湖中女神會交給他。`)) socket.emit('avalon_lady', { targetId: id });
            }));
        } else {
            hint(`🌊 ${holder} 正在用湖中女神查驗一位玩家…`);
            hostForce('⏭️ 跳過湖中女神', '確定跳過這次的湖中女神嗎？');
        }
        return `🌊 湖中女神：${holder}`;
    }

    if (state.roundPhase === 'assassin') {
        if (state.assassinId === socket.id) {
            hint('🗡️ 好人完成了 3 個任務！跟其他壞人當面討論，然後指定你覺得是梅林的人：');
            const targets = active.filter(id => id !== socket.id);
            panel.appendChild(playerGrid(state, targets, [], id => {
                if (confirm(`確定刺殺 ${nameOf(state, id)} 嗎？只有一次機會！`)) socket.emit('avalon_assassinate', { targetId: id });
            }));
        } else if (my && my.team === 'evil') {
            hint(`🗡️ 跟刺客 ${nameOf(state, state.assassinId)} 當面討論誰是梅林，由他在手機上決定。`);
        } else {
            hint(`🗡️ 好人完成了 3 個任務！等刺客 ${nameOf(state, state.assassinId)} 決定要刺殺誰…`);
        }
        return '🗡️ 刺殺階段';
    }

    hint('🏁 遊戲結束！');
    panel.appendChild(button('🏆 看結果', 'btn-gold btn-wide', () => { modalDismissed = false; rerender(); }));
    return '🏁 遊戲結束！';
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
    const teamOf = (p) => (p.role ? state.roleInfo[p.role].team : null);
    const describe = (p) => `${p.name}（${roleLabel(state, p.role)}）`;
    const winners = state.players.filter(p => teamOf(p) === state.winner);
    const losers = state.players.filter(p => teamOf(p) !== state.winner);
    names.appendChild(el('div', 'winner-line win', `🏆 贏家：${winners.map(describe).join('、') || '沒有人'}`));
    if (losers.length) names.appendChild(el('div', 'winner-line lose', `💀 輸家：${losers.map(describe).join('、')}`));

    const list = $('final-list');
    list.innerHTML = '';
    if (state.assassinTarget) {
        const li = el('li');
        li.appendChild(el('span', null, `🗡️ 刺客刺殺了 ${nameOf(state, state.assassinTarget)}`));
        li.appendChild(el('strong', null, state.winner === 'evil' ? '刺中梅林！' : '不是梅林'));
        list.appendChild(li);
    }
    const li = el('li');
    li.appendChild(el('span', null, `任務結果：${state.results.map((r, i) => `${i + 1}${r === 'success' ? '✅' : '❌'}`).join(' ')}`));
    li.appendChild(el('strong', null, `否決 ${state.rejects} 次`));
    list.appendChild(li);

    const me = state.players.find(p => p.id === socket.id);
    $('btn-restart').style.display = me ? 'inline-block' : 'none';
    modal.classList.add('active');
}

// RENDER MAIN GAME BOARD
function renderGameBoard(state) {
    latestState = state;
    const key = `${state.quest}-${state.roundPhase}-${state.leaderId}`;
    if (key !== picksKey) {
        picksKey = key;
        picks = [];
    }
    renderRoleCard(state);
    renderTracks(state);
    $('ticker-text').textContent = renderControls(state);
    renderPlayers(state);
    renderRoundLog(state);
    renderRolesInGame(state);
    renderHelpRoles(state);
    renderGameOver(state);
    playStateSounds(state);
}

function playStateSounds(state) {
    if (lastSoundKey === null) {
        lastSoundKey = picksKey;
        return;
    }
    if (picksKey === lastSoundKey) return;
    lastSoundKey = picksKey;
    if (state.gameEnded) AudioSynth.playSuccess();
    else AudioSynth.playNotify();
}

// REGISTER CLICK & FORM EVENT LISTENERS
function initEvents() {
    $('btn-create-room').addEventListener('click', () => {
        AudioSynth.playTick();
        const nickname = $('input-nickname').value.trim();
        if (!nickname) return showError('暱稱不能為空！');
        socket.emit('createRoom', { name: nickname, gameType: 'avalon' });
    });

    $('btn-join-room').addEventListener('click', () => {
        AudioSynth.playTick();
        const nickname = $('input-nickname').value.trim();
        const code = $('input-room-code').value.trim().toUpperCase();
        if (!nickname) return showError('暱稱不能為空！');
        if (code.length !== 4) return showError('房號必須是 4 碼！');
        socket.emit('joinRoom', { name: nickname, roomCode: code, gameType: 'avalon' });
    });

    $('toggle-lady').addEventListener('change', () => {
        AudioSynth.playTick();
        socket.emit('avalon_settings', { lady: $('toggle-lady').checked });
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
        lastSoundKey = null;
        modalDismissed = false;
        picks = [];
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
