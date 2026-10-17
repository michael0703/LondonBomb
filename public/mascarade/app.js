// Client-side interactions for 化裝舞會 (Mascarade)

const socket = BoardgameSession.connect('mascarade');
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

const ALL_ROLES = ['king', 'queen', 'judge', 'bishop', 'thief', 'witch', 'cheat', 'peasant', 'spy', 'fool', 'inquisitor', 'widow'];
const PEEK_SECONDS = 5;

let latestState = null;
let lastSoundKey = null;
// Local UI state for multi-step choices; reset whenever the turn or phase changes
let ui = { key: null, mode: null, target: null, picks: [] };
let peekTimer = null;

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
    if (String(id).startsWith('center')) return `中間第 ${Number(String(id).slice(6)) + 1} 張`;
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

    // Role set: host ticks roles; others just see the list
    const setup = state.setup;
    const checklist = $('role-checklist');
    checklist.innerHTML = '';
    ALL_ROLES.forEach(role => {
        const info = state.roleInfo[role];
        const label = el('label', 'role-check' + (setup.roles.includes(role) ? ' on' : ''));
        const box = el('input');
        box.type = 'checkbox';
        box.checked = setup.roles.includes(role);
        box.disabled = !isHost;
        box.addEventListener('change', () => {
            AudioSynth.playTick();
            const roles = box.checked ? [...setup.roles, role] : setup.roles.filter(r => r !== role);
            socket.emit('mascarade_settings', { roles });
        });
        label.appendChild(box);
        label.appendChild(el('span', null, `${info.icon} ${info.name}${role === 'peasant' ? ' ×2' : ''}`));
        label.title = info.desc;
        checklist.appendChild(label);
    });
    let note = `角色牌 ${setup.cardCount} 張／需要 ${setup.cardsNeeded} 張（農夫算 2 張）`;
    if (setup.centerCount > 0) note += `，多出的 ${setup.centerCount} 張蓋在中間`;
    note += setup.auto ? '｜目前是建議組合' : '｜房主自訂';
    $('role-count-note').textContent = note;
    $('btn-reset-roles').style.display = isHost && !setup.auto ? 'inline-block' : 'none';
    $('toggle-keep-log').checked = setup.keepLog;
    $('toggle-keep-log').disabled = !isHost;

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

// MY CARD: hidden except during the opening look, a peek, or the end
function renderMyCard(state) {
    if (peekTimer) return; // a peek is on screen
    const me = state.players.find(p => p.id === socket.id);
    const card = $('my-card');
    card.classList.remove('peeking');
    $('my-card-timer').textContent = '';
    if (me && me.card) {
        card.classList.add('peeking');
        $('my-card-value').textContent = roleLabel(state, me.card);
    } else {
        $('my-card-value').textContent = '🎭 蓋著';
    }
}

function showPeek(cards) {
    clearInterval(peekTimer);
    let left = PEEK_SECONDS;
    const card = $('my-card');
    card.classList.add('peeking');
    $('my-card-value').textContent = cards.map(c => `${c.label}：${roleLabel(latestState, c.role)}`).join('｜');
    $('my-card-timer').textContent = `${left} 秒後蓋回，快記住！`;
    peekTimer = setInterval(() => {
        left -= 1;
        if (left <= 0) {
            clearInterval(peekTimer);
            peekTimer = null;
            if (latestState) renderMyCard(latestState);
            return;
        }
        $('my-card-timer').textContent = `${left} 秒後蓋回，快記住！`;
    }, 1000);
}

// SEATS
function renderPlayers(state) {
    const list = $('players-list');
    list.innerHTML = '';
    const claim = state.claim;
    state.players.forEach(p => {
        const li = el('li', 'ms-player');
        if (p.id === socket.id) li.classList.add('is-me');
        if (p.id === state.activePlayerId) li.classList.add('active');
        if (p.left) li.classList.add('left');
        if (!p.connected) li.classList.add('disconnected');
        if (state.winners.includes(p.id)) li.classList.add('winner');

        const name = el('span', 'ms-name', `${p.id === state.activePlayerId ? '👉 ' : ''}${p.name}${p.id === socket.id ? ' (你)' : ''}${p.connected ? '' : ' 📴'}`);
        li.appendChild(name);

        let status = '';
        if (p.left) status = '已離開';
        else if (claim && p.id === claim.claimerId) status = `📢 ${roleLabel(state, claim.role)}`;
        else if (claim && claim.challengerIds.includes(p.id)) status = '🙋 我才是！';
        else if (claim && claim.respondedIds.includes(p.id)) status = '🤐';
        else if (claim) status = '…';
        if (p.card) status = (status ? status + '｜' : '') + roleLabel(state, p.card);
        li.appendChild(el('span', 'ms-status', status));
        li.appendChild(el('span', 'ms-coins', `🪙 ${p.coins}`));
        list.appendChild(li);
    });

    const center = $('center-cards');
    center.innerHTML = '';
    state.center.forEach((c, i) => {
        center.appendChild(el('span', 'center-card', `🂠 中間第 ${i + 1} 張${c.card ? `：${roleLabel(state, c.card)}` : ''}`));
    });
}

function renderRevealLog(state) {
    $('reveal-log-section').style.display = state.setup.keepLog ? 'block' : 'none';
    const list = $('reveal-log');
    list.innerHTML = '';
    if (!state.revealLog.length) list.appendChild(el('li', 'setting-note', '還沒有人亮過牌。'));
    [...state.revealLog].reverse().forEach(entry => {
        const what = entry.claimRole === 'inquisitor' ? '審判官的審問' : `宣告${roleLabel(state, entry.claimRole)}`;
        list.appendChild(el('li', null, `第 ${entry.turn} 回合（${what}）：${entry.entries.map(e => `${e.name}＝${roleLabel(state, e.role)}`).join('、')}`));
    });
}

function renderRoleReference(state) {
    const list = $('role-reference-list');
    list.innerHTML = '';
    state.rolesInGame.forEach(role => {
        const info = state.roleInfo[role];
        const li = el('li');
        li.appendChild(el('strong', null, `${info.icon} ${info.name}${role === 'peasant' ? ' ×2' : ''}：`));
        li.appendChild(el('span', null, info.desc));
        list.appendChild(li);
    });
}

// Pick-a-target buttons
function targetButtons(state, ids, onPick, selected = []) {
    const grid = el('div', 'target-grid');
    ids.forEach(id => {
        const p = state.players.find(pl => pl.id === id);
        const label = `${nameOf(state, id)}${p ? `（🪙${p.coins}）` : ''}`;
        const btn = button(label, 'target-btn' + (selected.includes(id) ? ' chosen' : ''), () => onPick(id));
        grid.appendChild(btn);
    });
    return grid;
}

function swapButtons(onChoose) {
    const row = el('div', 'quick-answer-row');
    row.appendChild(button('🔄 真的交換', 'btn-answer answer-yes', () => onChoose(true)));
    row.appendChild(button('🤥 假裝交換', 'btn-answer answer-no', () => onChoose(false)));
    return row;
}

// MAIN CONTROL PANEL (rebuilt on every update)
function renderControls(state) {
    const panel = $('control-panel');
    panel.innerHTML = '';
    const me = state.players.find(p => p.id === socket.id);
    const isHost = me && me.host;
    const active = state.players.find(p => p.id === state.activePlayerId);
    const isMyTurn = active && me && active.id === me.id;
    const hint = (text) => panel.appendChild(el('div', 'control-hint', text));

    if (state.roundPhase === 'intro') {
        hint('👀 大家先記住每個人一開始的角色（列在下面的座位表）！');
        if (isHost) panel.appendChild(button('🙈 大家記好了，蓋牌！', 'btn-gold btn-wide', () => socket.emit('mascarade_beginPlay')));
        else hint('等房主按下蓋牌...');
        return '🎭 記住大家的角色！';
    }

    if (state.roundPhase === 'action') {
        if (!isMyTurn) {
            hint(`等待【${active ? active.name : '?'}】行動...`);
            if (isHost && active && !active.connected) {
                panel.appendChild(button(`⏭️ 跳過 ${active.name}`, 'btn-brass btn-small', () => socket.emit('mascarade_skipTurn')));
            }
            return `🎭 輪到 ${active ? active.name : '?'}`;
        }

        const others = state.players.filter(p => p.id !== me.id && !p.left).map(p => p.id);
        const swapTargets = [...others, ...state.center.map(c => c.id)];

        if (ui.mode === 'swap') {
            hint('要拿誰的牌來跟你的牌交換（或假裝交換）？');
            panel.appendChild(targetButtons(state, swapTargets, (id) => { ui.target = id; rerender(); }, ui.target ? [ui.target] : []));
            if (ui.target) {
                hint(`對象：${nameOf(state, ui.target)}。大家只會看到你拿了這兩張牌，不知道你有沒有換。`);
                panel.appendChild(swapButtons(doSwap => socket.emit('mascarade_swap', { targetId: ui.target, doSwap })));
            }
            panel.appendChild(button('↩️ 返回', 'btn-brass btn-small', () => { ui.mode = null; ui.target = null; rerender(); }));
            return '🔄 選擇交換對象';
        }

        if (ui.mode === 'claim') {
            hint('你要宣告自己是誰？（說謊也可以）');
            const grid = el('div', 'target-grid');
            state.rolesInGame.forEach(role => {
                grid.appendChild(button(roleLabel(state, role), 'target-btn', () => {
                    ui.mode = null;
                    socket.emit('mascarade_claim', { role });
                }));
            });
            panel.appendChild(grid);
            panel.appendChild(button('↩️ 返回', 'btn-brass btn-small', () => { ui.mode = null; rerender(); }));
            return '📢 選擇要宣告的角色';
        }

        if (state.mustSwapAfterReveal) {
            hint('輪到你了！你的牌上一回合剛被翻開，你已經知道自己是誰，這回合只能交換（或假裝交換）。');
        } else if (state.forcedSwap) {
            hint(`輪到你了！前 ${state.forcedSwapTurns} 回合只能交換（目前第 ${state.turn + 1} 回合）。`);
        } else {
            hint('輪到你了！選一個行動：');
        }
        const row = el('div', 'action-row');
        row.appendChild(button('🔄 交換', 'btn-gold', () => { ui.mode = 'swap'; rerender(); }));
        const look = button('👀 偷看自己的牌', 'btn-brass', () => socket.emit('mascarade_look'));
        const claim = button('📢 宣告角色', 'btn-brass', () => { ui.mode = 'claim'; rerender(); });
        [look, claim].forEach(b => { b.disabled = state.forcedSwap; b.classList.toggle('disabled', state.forcedSwap); });
        row.appendChild(look);
        row.appendChild(claim);
        panel.appendChild(row);
        return '🎭 輪到你行動！';
    }

    if (state.roundPhase === 'claim' && state.claim) {
        const claim = state.claim;
        const claimer = nameOf(state, claim.claimerId);
        const role = roleLabel(state, claim.role);
        const responded = claim.respondedIds.length;
        const total = claim.responderIds.length;
        if (claim.claimerId === socket.id) {
            hint(`你宣告自己是【${role}】，等大家回應...（${responded}/${total}）`);
        } else if (claim.responderIds.includes(socket.id) && !claim.respondedIds.includes(socket.id)) {
            panel.appendChild(el('div', 'claim-banner', `📢 ${claimer} 宣告：「我是${role}！」`));
            hint('你也要喊「我才是！」嗎？（喊了就要亮牌，說謊的人付 1 金幣到法院）');
            const row = el('div', 'quick-answer-row');
            row.appendChild(button(`🙋 我才是${state.roleInfo[claim.role].name}！`, 'btn-answer answer-no', () => socket.emit('mascarade_respond', { challenge: true })));
            row.appendChild(button('🤐 不質疑', 'btn-answer answer-yes', () => socket.emit('mascarade_respond', { challenge: false })));
            panel.appendChild(row);
        } else {
            hint(`${claimer} 宣告自己是【${role}】，等其他人回應...（${responded}/${total}）`);
        }
        if (claim.challengerIds.length) hint(`🙋 說自己才是的人：${claim.challengerIds.map(id => nameOf(state, id)).join('、')}`);
        if (isHost) panel.appendChild(button('⏱️ 不等了，直接結算', 'btn-brass btn-small', () => {
            if (confirm('還有人沒回應，確定直接結算嗎？沒回應的人當作不質疑。')) socket.emit('mascarade_forceResolve');
        }));
        return `📢 ${claimer} 說自己是${role}！`;
    }

    if (state.roundPhase === 'ability' && state.ability) {
        renderAbility(state, panel, me, isHost);
        return `✨ ${nameOf(state, state.ability.playerId)} 正在發動能力`;
    }

    if (state.roundPhase === 'result' && state.result) {
        renderResult(state, panel);
        if (isMyTurn || isHost) {
            panel.appendChild(button('▶️ 下一位', 'btn-gold btn-wide', () => socket.emit('mascarade_continue')));
        } else {
            hint(`等待 ${active ? active.name : ''} 或房主按下一位...`);
        }
        return '📜 結算結果';
    }

    if (state.gameEnded && state.result) renderResult(state, panel);
    return '🏁 遊戲結束！';
}

function renderResult(state, panel) {
    const r = state.result;
    panel.appendChild(el('div', 'claim-banner', `📢 ${nameOf(state, r.claimerId)} 宣告自己是${roleLabel(state, r.role)}`));
    if (r.reveals.length) {
        const list = el('ul', 'reveal-list');
        r.reveals.forEach(rv => {
            list.appendChild(el('li', rv.truthful ? 'truthful' : 'liar', `${rv.truthful ? '✅' : '❌'} ${rv.name} 亮牌：${roleLabel(state, rv.role)}`));
        });
        panel.appendChild(list);
    }
    const fx = el('ul', 'effect-list');
    r.effects.forEach(text => fx.appendChild(el('li', null, text)));
    panel.appendChild(fx);
}

function renderAbility(state, panel, me, isHost) {
    const ab = state.ability;
    const hint = (text) => panel.appendChild(el('div', 'control-hint', text));
    const mine = ab.playerId === socket.id;
    const who = nameOf(state, ab.playerId);
    if (state.result) renderResult(state, panel);

    if (ab.type === 'inquisition') {
        if (ab.targetId === socket.id) {
            panel.appendChild(el('div', 'claim-banner', `🔥 ${who} 要你猜自己的角色！猜錯要付他 4 金幣`));
            const grid = el('div', 'target-grid');
            state.rolesInGame.forEach(role => {
                grid.appendChild(button(roleLabel(state, role), 'target-btn', () => socket.emit('mascarade_inquisitionGuess', { role })));
            });
            panel.appendChild(grid);
        } else {
            hint(`🔥 ${nameOf(state, ab.targetId)} 正在猜自己的角色...`);
        }
    } else if (!mine) {
        hint(`✨ ${who} 正在決定怎麼發動能力...`);
    } else if (ab.type === 'bishop') {
        hint('⛪ 最有錢的人不只一位，選一位拿他 2 金幣：');
        panel.appendChild(targetButtons(state, ab.options, id => socket.emit('mascarade_ability', { targetId: id })));
    } else if (ab.type === 'witch') {
        hint('🧙 要跟誰交換全部金幣？');
        panel.appendChild(targetButtons(state, ab.options, id => socket.emit('mascarade_ability', { targetId: id })));
        panel.appendChild(button('不交換', 'btn-brass btn-small', () => socket.emit('mascarade_ability', { skip: true })));
    } else if (ab.type === 'spy') {
        if (!state.spyView) {
            hint('🕵️ 要偷看哪一張牌（會同時看到你自己的牌）？');
            panel.appendChild(targetButtons(state, ab.options, id => socket.emit('mascarade_ability', { targetId: id })));
        } else {
            const v = state.spyView;
            panel.appendChild(el('div', 'claim-banner', `你的牌：${roleLabel(state, v.ownRole)}｜${v.targetLabel}：${roleLabel(state, v.targetRole)}`));
            hint('要交換嗎？大家只會看到你拿了這兩張牌。');
            panel.appendChild(swapButtons(doSwap => socket.emit('mascarade_ability', { doSwap })));
        }
    } else if (ab.type === 'fool') {
        hint(`🤡 選兩位玩家，交換（或假裝交換）他們的牌（已選 ${ui.picks.length}/2）：`);
        panel.appendChild(targetButtons(state, ab.options, id => {
            ui.picks = ui.picks.includes(id) ? ui.picks.filter(x => x !== id) : [...ui.picks, id].slice(-2);
            rerender();
        }, ui.picks));
        if (ui.picks.length === 2) panel.appendChild(swapButtons(doSwap => socket.emit('mascarade_ability', { targetIds: ui.picks, doSwap })));
        panel.appendChild(button('不動別人的牌', 'btn-brass btn-small', () => socket.emit('mascarade_ability', { skip: true })));
    } else if (ab.type === 'inquisitor') {
        hint('🔥 指定一位玩家猜自己的角色（猜錯付你 4 金幣）：');
        panel.appendChild(targetButtons(state, ab.options, id => socket.emit('mascarade_ability', { targetId: id })));
    }

    const stuckOn = ab.type === 'inquisition' ? ab.targetId : ab.playerId;
    const stuckPlayer = state.players.find(p => p.id === stuckOn);
    if (isHost && stuckPlayer && !stuckPlayer.connected) {
        panel.appendChild(button('⏭️ 取消這次能力', 'btn-brass btn-small', () => socket.emit('mascarade_cancelAbility')));
    }
}

// GAME OVER
function renderGameOver(state) {
    const modal = $('game-over-modal');
    if (!state.gameEnded) {
        modal.classList.remove('active');
        return;
    }
    const names = state.winners.map(id => nameOf(state, id)).join('、');
    $('winner-title').textContent = `🏆 ${names} 獲勝！`;
    const list = $('final-list');
    list.innerHTML = '';
    [...state.players].sort((a, b) => b.coins - a.coins).forEach(p => {
        const li = el('li');
        if (state.winners.includes(p.id)) li.classList.add('rank-first');
        // Starting card ➔ final card, so everyone can see how the masks moved
        const roles = p.startCard && p.startCard !== p.card
            ? `本來 ${roleLabel(state, p.startCard)} ➔ 最後 ${roleLabel(state, p.card)}`
            : `${roleLabel(state, p.card)}（沒變）`;
        li.appendChild(el('span', null, `${state.winners.includes(p.id) ? '🏆 ' : ''}${p.name}｜${roles}`));
        li.appendChild(el('strong', null, `🪙 ${p.coins}`));
        list.appendChild(li);
    });
    $('center-final').textContent = state.center.length
        ? '中間的牌：' + state.center.map((c, i) => `第 ${i + 1} 張 ${c.startCard && c.startCard !== c.card
            ? `本來 ${roleLabel(state, c.startCard)} ➔ 最後 ${roleLabel(state, c.card)}`
            : roleLabel(state, c.card)}`).join('｜')
        : '';
    const me = state.players.find(p => p.id === socket.id);
    $('btn-restart').style.display = me ? 'inline-block' : 'none';
    modal.classList.add('active');
}

// RENDER MAIN GAME BOARD
function renderGameBoard(state) {
    latestState = state;
    const uiKey = `${state.turn}-${state.roundPhase}-${state.ability ? state.ability.type : ''}`;
    if (ui.key !== uiKey) ui = { key: uiKey, mode: null, target: null, picks: [] };

    const me = state.players.find(p => p.id === socket.id);
    $('display-my-coins').textContent = me ? me.coins : '-';
    $('display-court').textContent = state.court;
    $('display-turn').textContent = state.turn + 1;

    renderMyCard(state);
    renderPlayers(state);
    renderRevealLog(state);
    renderRoleReference(state);
    const ticker = renderControls(state);
    $('ticker-text').textContent = state.lastAction && state.roundPhase === 'action' ? state.lastAction : ticker;
    renderGameOver(state);
    playStateSounds(state);
}

// Ping players when it's their move or a claim needs their answer
function playStateSounds(state) {
    const needsMe = (state.roundPhase === 'action' && state.activePlayerId === socket.id)
        || (state.roundPhase === 'claim' && state.claim && state.claim.responderIds.includes(socket.id) && !state.claim.respondedIds.includes(socket.id))
        || (state.roundPhase === 'ability' && state.ability && (state.ability.playerId === socket.id || state.ability.targetId === socket.id));
    const key = `${state.turn}-${state.roundPhase}-${needsMe}-${state.gameEnded}`;
    if (key === lastSoundKey) return;
    const first = lastSoundKey === null;
    lastSoundKey = key;
    if (first) return;
    if (state.gameEnded) AudioSynth.playSuccess();
    else if (needsMe) AudioSynth.playNotify();
}

// REGISTER CLICK & FORM EVENT LISTENERS
function initEvents() {
    $('btn-create-room').addEventListener('click', () => {
        AudioSynth.playTick();
        const nickname = $('input-nickname').value.trim();
        if (!nickname) return showError('暱稱不能為空！');
        socket.emit('createRoom', { name: nickname, gameType: 'mascarade' });
    });

    $('btn-join-room').addEventListener('click', () => {
        AudioSynth.playTick();
        const nickname = $('input-nickname').value.trim();
        const code = $('input-room-code').value.trim().toUpperCase();
        if (!nickname) return showError('暱稱不能為空！');
        if (code.length !== 4) return showError('房號必須是 4 碼！');
        socket.emit('joinRoom', { name: nickname, roomCode: code, gameType: 'mascarade' });
    });

    $('btn-reset-roles').addEventListener('click', () => {
        AudioSynth.playTick();
        socket.emit('mascarade_settings', { roles: null });
    });
    $('toggle-keep-log').addEventListener('change', () => {
        socket.emit('mascarade_settings', { keepLog: $('toggle-keep-log').checked });
    });

    $('btn-start-game').addEventListener('click', () => {
        AudioSynth.playTick();
        socket.emit('startGame');
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
        lastSoundKey = null;
        $('game-over-modal').classList.remove('active');
        switchView('waiting');
        renderWaitingRoom(state);
    } else {
        switchView('game');
        renderGameBoard(state);
    }
});

socket.on('mascarade_peek', ({ cards }) => {
    AudioSynth.playNotify();
    showPeek(cards);
});

socket.on('errorMsg', showError);

socket.on('kicked', () => {
    showError('你已被房主剔除出房間。');
    switchView('login');
});

window.addEventListener('load', initEvents);
