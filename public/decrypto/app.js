// Client-side interactions for 截碼戰 (Decrypto)

const socket = BoardgameSession.connect('decrypto');
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

const NUMS = ['1️⃣', '2️⃣', '3️⃣', '4️⃣'];

let latestState = null;
let lastSoundKey = null;
let modalDismissed = false;
// Local drafts, reset whenever the round/phase changes
let draftKey = null;
let picks = [null, null, null];
let clueDraft = ['', '', ''];
let builtPanelKey = null;

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

function nameOf(state, id) {
    const p = state.players.find(pl => pl.id === id);
    return p ? p.name : '?';
}

const codeText = (code) => (!code ? '?' : code.some(d => !d) ? '沒猜' : code.join('-'));

function rerender() {
    if (latestState && latestState.gameStarted) renderGameBoard(latestState, true);
}

// RENDER LOBBY WAITING ROOM
function renderWaitingRoom(state) {
    $('display-room-code').textContent = state.roomCode;
    $('player-count').textContent = state.players.length;
    const me = state.players.find(p => p.id === socket.id);
    const isHost = me ? me.host : false;

    const box = $('team-columns');
    box.innerHTML = '';
    state.teams.forEach((team, t) => {
        const col = el('div', `team-column team-${t}`);
        col.appendChild(el('h4', null, `${team.name}（${team.memberIds.length} 人）`));
        const list = el('ul');
        team.memberIds.forEach(id => {
            const p = state.players.find(pl => pl.id === id);
            const li = el('li');
            if (id === socket.id) li.classList.add('is-me');
            li.appendChild(el('span', 'player-name', p.name + (id === socket.id ? ' (你)' : '') + (p.host ? ' 👑' : '')));
            if (isHost && id !== socket.id) {
                const actions = el('div', 'team-actions');
                actions.appendChild(button('換隊', 'btn-brass btn-small', () => socket.emit('decrypto_switchTeam', { team: 1 - t, targetId: id })));
                const kick = button('剔除', 'btn-brass btn-small', () => socket.emit('kickPlayer', { targetId: id }));
                actions.appendChild(kick);
                li.appendChild(actions);
            }
            list.appendChild(li);
        });
        col.appendChild(list);
        if (me && me.team !== t) col.appendChild(button(`加入${team.name}`, 'btn-gold btn-small', () => socket.emit('decrypto_switchTeam', { team: t })));
        box.appendChild(col);
    });
    $('btn-shuffle-teams').style.display = isHost ? 'inline-block' : 'none';

    const startBtn = $('btn-start-game');
    const statusMsg = $('lobby-status-msg');
    if (isHost) {
        startBtn.style.display = 'block';
        startBtn.classList.toggle('disabled', !!state.setupError);
        startBtn.disabled = !!state.setupError;
        statusMsg.textContent = state.setupError || '你是房主！分好隊就可以開始。';
    } else {
        startBtn.style.display = 'none';
        statusMsg.textContent = '等待房主開始遊戲...（可以自己選隊）';
    }
}

// MY TEAM'S KEYWORDS
function renderMyWords(state) {
    const t = state.myTeam;
    const grid = $('my-words');
    grid.innerHTML = '';
    if (t === null) {
        $('my-team-label').textContent = '你在觀戰';
        return;
    }
    const team = state.teams[t];
    const mates = team.memberIds.filter(id => id !== socket.id).map(id => nameOf(state, id));
    $('my-team-label').textContent = `${team.name}的關鍵字｜隊友：${mates.join('、') || '無'}`;
    $('my-words-card').className = `my-card words-card team-${t}`;
    (team.words || []).forEach((w, i) => {
        const cell = el('div', 'keyword');
        cell.appendChild(el('span', 'keyword-num', String(i + 1)));
        cell.appendChild(el('strong', null, w));
        grid.appendChild(cell);
    });
}

// Pick one digit for each of the three clues; a digit used on another clue moves here
function renderCodePicker(panel, clues, words, onSubmit, submitLabel) {
    clues.forEach((clue, i) => {
        const row = el('div', 'picker-row');
        row.appendChild(el('div', 'picker-clue', `第 ${i + 1} 個提示：「${clue}」`));
        const btns = el('div', 'picker-digits');
        [1, 2, 3, 4].forEach(d => {
            const label = words ? `${d} ${words[d - 1]}` : String(d);
            btns.appendChild(button(label, 'digit-btn' + (picks[i] === d ? ' chosen' : ''), () => {
                picks = picks.map((v, j) => (j !== i && v === d ? null : v));
                picks[i] = picks[i] === d ? null : d;
                rerender();
            }));
        });
        row.appendChild(btns);
        panel.appendChild(row);
    });
    if (picks.every(Boolean)) {
        panel.appendChild(button(`${submitLabel}：${picks.join('-')}`, 'btn-gold btn-wide', () => {
            if (confirm(`確定送出 ${picks.join('-')} 嗎？送出後整隊就不能改了。`)) onSubmit([...picks]);
        }));
    } else {
        panel.appendChild(el('div', 'control-hint', '每個提示選一個數字（大家討論好，一個人送出就好）。'));
    }
}

function renderClueList(panel, clues, code, words) {
    const list = el('ol', 'clue-list');
    clues.forEach((c, i) => {
        const li = el('li');
        li.appendChild(el('strong', null, `「${c}」`));
        if (code) li.appendChild(el('span', 'clue-answer', ` ➔ ${code[i]}${words ? ` ${words[code[i] - 1]}` : ''}`));
        list.appendChild(li);
    });
    panel.appendChild(list);
}

function renderControls(state) {
    const panel = $('control-panel');
    const me = state.players.find(p => p.id === socket.id);
    const isHost = me && me.host;
    const t = state.myTeam;
    const teams = state.teams;
    const amEncryptor = t !== null && teams[t].encryptorId === socket.id;

    // Keep the clue form alive while other players' updates arrive, so typing is not lost
    if (state.roundPhase === 'clue' && state.myCluesDraftNeeded) {
        const key = `clue-form-${state.round}`;
        if (builtPanelKey === key) return cluePhaseTicker(state);
        builtPanelKey = key;
        panel.innerHTML = '';
        panel.appendChild(el('div', 'control-hint', '🔑 這回合你是加密者！你的密碼：'));
        panel.appendChild(el('div', 'secret-code', state.myCode.join(' - ')));
        state.myCode.forEach((d, i) => {
            const row = el('div', 'clue-input-row');
            row.appendChild(el('label', null, `第 ${i + 1} 個提示 ➔ ${d} ${teams[t].words[d - 1]}`));
            const input = el('input');
            input.type = 'text';
            input.maxLength = 20;
            input.placeholder = `讓隊友想到「${teams[t].words[d - 1]}」`;
            input.value = clueDraft[i];
            input.addEventListener('input', () => { clueDraft[i] = input.value; });
            row.appendChild(input);
            panel.appendChild(row);
        });
        panel.appendChild(button('📨 送出提示', 'btn-gold btn-wide', () => {
            if (clueDraft.some(c => !c.trim())) return showError('三個提示都要填。');
            socket.emit('decrypto_clues', { clues: clueDraft });
        }));
        panel.appendChild(el('div', 'control-hint', '送出後輪到你們隊時，要把提示照順序唸出來。小心別寫得太明顯，對手也在聽！'));
        return cluePhaseTicker(state);
    }
    builtPanelKey = null;
    panel.innerHTML = '';
    const hint = (text) => panel.appendChild(el('div', 'control-hint', text));

    if (state.roundPhase === 'clue') {
        const waiting = teams.filter(tm => !tm.cluesReady).map(tm => `${tm.name} ${nameOf(state, tm.encryptorId)}`);
        if (amEncryptor) hint('✅ 你的提示送出了，等另一隊的加密者。');
        hint(`✍️ 等待加密者寫提示：${waiting.join('、')}`);
        if (isHost) {
            teams.forEach((tm, i) => {
                const enc = state.players.find(p => p.id === tm.encryptorId);
                if (!tm.cluesReady && enc && !enc.connected) {
                    panel.appendChild(button(`🔁 ${tm.name}的加密者斷線，換下一位`, 'btn-brass btn-small', () => socket.emit('decrypto_reassign', { team: i })));
                }
            });
        }
        return cluePhaseTicker(state);
    }

    const cur = state.current;
    if (!cur) return '';
    const activeTeam = teams[cur.team];
    const encName = nameOf(state, cur.encryptorId);

    if (state.roundPhase === 'guess') {
        hint(`📢 ${activeTeam.name}的提示（${encName} 唸）：`);
        renderClueList(panel, cur.clues, cur.team === t && amEncryptor ? state.myCode : null, null);

        if (t === cur.team) {
            if (amEncryptor) hint('🤐 隊友正在猜你的密碼，不能給任何暗示喔！');
            else if (!cur.decodeDone) renderCodePicker(panel, cur.clues, teams[t].words, code => socket.emit('decrypto_guess', { code }), '🔓 送出我們的解碼');
            else hint(`✅ 你們隊猜 ${codeText(cur.decode)}（${nameOf(state, cur.decodeBy)} 送出）`);
            if (cur.interceptAllowed) hint(cur.interceptDone ? '🕵️ 對手已經送出攔截。' : '🕵️ 對手正在想要怎麼攔截…');
        } else if (t !== null) {
            if (!cur.interceptAllowed) hint('👂 第 1 回合不能攔截，先記下他們的提示（下面的紀錄表會自動整理）。');
            else if (!cur.interceptDone) renderCodePicker(panel, cur.clues, null, code => socket.emit('decrypto_guess', { code }), '🎯 送出攔截');
            else hint(`🎯 你們隊攔截猜 ${codeText(cur.intercept)}（${nameOf(state, cur.interceptBy)} 送出）`);
            hint(cur.decodeDone ? `${activeTeam.name}已經送出解碼。` : `${activeTeam.name}正在解碼…`);
        }
        if (isHost) {
            panel.appendChild(button('⏭️ 不等了，直接公布', 'btn-brass btn-small', () => {
                if (confirm('還沒送出的隊伍會當作沒猜（解碼算失誤、攔截算沒攔），確定公布嗎？')) socket.emit('decrypto_forceReveal');
            }));
        }
        return `🔍 ${activeTeam.name}的密碼`;
    }

    if (state.roundPhase === 'reveal') {
        const r = cur.result;
        hint(`🔓 ${activeTeam.name}的密碼是：`);
        panel.appendChild(el('div', 'secret-code', r.code.join(' - ')));
        renderClueList(panel, r.clues, r.code, activeTeam.words);
        panel.appendChild(el('div', 'result-line ' + (r.decodeOk ? 'good' : 'bad'),
            r.decodeOk ? `✅ ${activeTeam.name}解碼成功（猜 ${codeText(r.decode)}）` : `❌ ${activeTeam.name}解碼失敗（猜 ${codeText(r.decode)}），得到 1 個失誤`));
        if (r.interceptOk !== null) {
            const other = teams[1 - cur.team].name;
            panel.appendChild(el('div', 'result-line ' + (r.interceptOk ? 'bad' : 'good'),
                r.interceptOk ? `🎯 ${other}攔截成功（猜 ${codeText(r.intercept)}）！` : `✖️ ${other}攔截失敗（猜 ${codeText(r.intercept)}）`));
        }
        panel.appendChild(button(cur.team === 0 ? `➡️ 下一步：猜${teams[1].name}的密碼` : '➡️ 下一步：結算這回合', 'btn-gold btn-wide', () => socket.emit('decrypto_next')));
        hint('大家看完結果後，任何人都可以按下一步。');
        return `🔓 公布${activeTeam.name}的密碼`;
    }

    hint('🏁 遊戲結束！');
    panel.appendChild(button('🏆 看結果', 'btn-gold btn-wide', () => { modalDismissed = false; rerender(); }));
    return '🏁 遊戲結束！';
}

function cluePhaseTicker(state) {
    const ready = state.teams.filter(tm => tm.cluesReady).length;
    return `✍️ 第 ${state.round} 回合：加密者寫提示中（${ready}/2）`;
}

// CLUE SHEETS: every revealed clue filed under the keyword number it pointed to
function renderSheet(container, state, team) {
    container.innerHTML = '';
    const words = state.teams[team].words;
    const entries = state.dcHistory.filter(h => h.team === team);
    [0, 1, 2, 3].forEach(i => {
        const col = el('div', 'sheet-col');
        col.appendChild(el('div', 'sheet-head', `${i + 1} ${words ? words[i] : '？'}`));
        entries.forEach(h => {
            h.code.forEach((d, j) => {
                if (d === i + 1) col.appendChild(el('div', 'sheet-clue', `R${h.round} ${h.clues[j]}`));
            });
        });
        container.appendChild(col);
    });
}

function renderRoundLog(state) {
    const log = $('round-log');
    log.innerHTML = '';
    if (!state.dcHistory.length) log.appendChild(el('li', null, '還沒有公布過密碼。'));
    [...state.dcHistory].reverse().forEach(h => {
        const team = state.teams[h.team].name;
        let text = `第 ${h.round} 回合 ${team}（${nameOf(state, h.encryptorId)}）：「${h.clues.join('」「')}」➔ ${h.code.join('-')}｜解碼${h.decodeOk ? '✅' : `❌(${codeText(h.decode)})`}`;
        if (h.interceptOk !== null) text += `｜攔截${h.interceptOk ? '🎯' : `✖️(${codeText(h.intercept)})`}`;
        log.appendChild(el('li', null, text));
    });
}

// GAME OVER
function renderGameOver(state) {
    const modal = $('game-over-modal');
    if (!state.gameEnded || !state.result || modalDismissed) {
        modal.classList.remove('active');
        return;
    }
    const r = state.result;
    $('winner-title').textContent = r.winner === null ? '🤝 平手！' : `🏆 ${state.teams[r.winner].name}獲勝！`;
    $('winner-reason').textContent = r.reason;
    const list = $('final-words');
    list.innerHTML = '';
    state.teams.forEach((team, t) => {
        const li = el('li');
        if (r.winner === t) li.classList.add('rank-first');
        li.appendChild(el('span', null, `${team.name}（🎯${team.intercepts} ❌${team.misses}）：${team.memberIds.map(id => nameOf(state, id)).join('、')}`));
        li.appendChild(el('strong', null, (team.words || []).map((w, i) => `${i + 1}.${w}`).join(' ')));
        list.appendChild(li);
    });
    const me = state.players.find(p => p.id === socket.id);
    $('btn-restart').style.display = me ? 'inline-block' : 'none';
    modal.classList.add('active');
}

// RENDER MAIN GAME BOARD
function renderGameBoard(state, local = false) {
    latestState = state;
    const key = `${state.round}-${state.roundPhase}-${state.current ? state.current.team : ''}`;
    if (key !== draftKey) {
        draftKey = key;
        picks = [null, null, null];
        if (state.roundPhase !== 'clue') clueDraft = ['', '', ''];
    }
    if (local) builtPanelKey = null;
    $('display-round').textContent = `${state.round}/${state.maxRounds}`;
    state.teams.forEach((team, t) => {
        $(`display-tokens-${t}`).textContent = `🎯${team.intercepts} ❌${team.misses}`;
    });
    renderMyWords(state);
    $('ticker-text').textContent = renderControls(state);
    const mine = state.myTeam === null ? 0 : state.myTeam;
    renderSheet($('sheet-mine'), state, mine);
    renderSheet($('sheet-theirs'), state, 1 - mine);
    renderRoundLog(state);
    renderGameOver(state);
    playStateSounds(state);
}

function playStateSounds(state) {
    const key = `${state.round}-${state.roundPhase}-${state.current ? state.current.team : ''}`;
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
        socket.emit('createRoom', { name: nickname, gameType: 'decrypto' });
    });

    $('btn-join-room').addEventListener('click', () => {
        AudioSynth.playTick();
        const nickname = $('input-nickname').value.trim();
        const code = $('input-room-code').value.trim().toUpperCase();
        if (!nickname) return showError('暱稱不能為空！');
        if (code.length !== 4) return showError('房號必須是 4 碼！');
        socket.emit('joinRoom', { name: nickname, roomCode: code, gameType: 'decrypto' });
    });

    $('btn-shuffle-teams').addEventListener('click', () => {
        AudioSynth.playTick();
        socket.emit('decrypto_shuffleTeams');
    });

    $('btn-start-game').addEventListener('click', () => {
        AudioSynth.playTick();
        socket.emit('startGame');
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
        lastSoundKey = null;
        modalDismissed = false;
        draftKey = null;
        builtPanelKey = null;
        clueDraft = ['', '', ''];
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
