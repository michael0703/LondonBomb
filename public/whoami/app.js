// Client-side interactions for 名人猜猜我是誰 (Who Am I)

const socket = BoardgameSession.connect('whoami');
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

const STATUS_LABELS = {
    waiting: '等待中',
    active: '發問中',
    solved: '已猜中',
    gaveup: '已放棄',
    left: '已離開'
};

const ANSWER_LABELS = { yes: '是', no: '不是', unsure: '不確定', text: '' };

let latestState = null;
let selectedPlayerId = null;
let lastActivePlayerId = null;
const skippedQuestions = new Set(); // `${activeId}:${questionId}` the player chose not to answer
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

    const startBtn = $('btn-start-game');
    const statusMsg = $('lobby-status-msg');
    if (isHost) {
        startBtn.style.display = 'block';
        const enough = state.players.length >= 2;
        startBtn.classList.toggle('disabled', !enough);
        startBtn.disabled = !enough;
        statusMsg.textContent = enough ? '你是房主！人到齊就可以開始。' : '至少需要 2 名玩家才能開始。';
    } else {
        startBtn.style.display = 'none';
        statusMsg.textContent = '等待房主開始遊戲...';
    }
}

// RENDER PLAYER CARDS
function renderPlayers(state, me) {
    const grid = $('players-grid');
    grid.innerHTML = '';
    const order = state.turnOrder.length ? state.turnOrder : state.players.map(p => p.id);

    order.forEach((id, idx) => {
        const p = state.players.find(pl => pl.id === id);
        if (!p) return;
        const card = el('div', 'celeb-card');
        // While the game runs, only the asker's card matters; queued players are shown compactly
        const collapsed = !state.gameEnded && p.status === 'waiting';
        if (collapsed) card.classList.add('collapsed');
        if (p.id === socket.id) card.classList.add('is-me');
        if (p.id === state.activePlayerId) card.classList.add('is-active');
        if (p.id === selectedPlayerId) card.classList.add('selected');
        if (!p.connected) card.classList.add('disconnected');

        const line = el('div', 'player-line');
        line.appendChild(el('span', null, `${idx + 1}. ${p.name}${p.id === socket.id ? ' (你)' : ''}`));
        line.appendChild(el('span', `status-badge status-${p.status}`, STATUS_LABELS[p.status] || p.status));
        card.appendChild(line);

        if (collapsed) {
            grid.appendChild(card);
            return;
        }

        card.appendChild(el('div', 'celeb-name', p.celebrity ? p.celebrity.name : '❓ ？？？'));

        let meta = `${p.questionCount} 題`;
        if (p.celebrity && p.id !== socket.id) meta += `｜${p.celebrity.category}`;
        card.appendChild(el('div', 'celeb-meta', meta));

        if (me && me.host && p.status === 'active') {
            const redraw = el('button', 'btn btn-brass btn-small');
            redraw.appendChild(el('span', null, '🔄 換牌'));
            redraw.title = '大家都不認識這位名人時使用（題數會重新計算）';
            redraw.addEventListener('click', (e) => {
                e.stopPropagation();
                const who = p.id === socket.id ? '你自己' : p.name;
                if (confirm(`確定要幫 ${who} 換一張名人牌嗎？他的題數會重新計算。`)) {
                    socket.emit('whoami_redraw', { targetPlayerId: p.id });
                }
            });
            card.appendChild(redraw);

            const skip = el('button', 'btn btn-brass btn-small');
            skip.appendChild(el('span', null, '⏭️ 跳過'));
            skip.title = '先換下一位，他的題數會保留，排到最後再繼續';
            skip.addEventListener('click', (e) => {
                e.stopPropagation();
                const who = p.id === socket.id ? '你自己' : p.name;
                if (confirm(`確定要跳過 ${who} 嗎？已問的題數會保留，排到最後再繼續。`)) {
                    socket.emit('whoami_skipTurn');
                }
            });
            card.appendChild(skip);
        }

        card.addEventListener('click', () => {
            AudioSynth.playTick();
            selectedPlayerId = p.id;
            renderGameBoard(latestState);
        });
        grid.appendChild(card);
    });
}

// RENDER Q&A HISTORY OF THE SELECTED PLAYER
function renderQaList(state) {
    const target = state.players.find(p => p.id === selectedPlayerId);
    const list = $('qa-list');
    list.innerHTML = '';
    if (!target) {
        $('qa-title').textContent = '💬 問答紀錄';
        return;
    }
    $('qa-title').textContent = `💬 ${target.name}${target.id === socket.id ? ' (你)' : ''} 的問答紀錄（${target.questionCount} 題）`;

    const hasPendingGuess = state.pendingGuess && target.id === state.activePlayerId;
    if (target.questions.length === 0 && target.guesses.length === 0 && !hasPendingGuess) {
        list.appendChild(el('div', 'qa-empty', '還沒有任何問答。'));
        return;
    }

    // Guesses are shown right after the question they followed, in chronological order
    const renderGuessesAfter = (questionCount) => {
        target.guesses.forEach((g, i) => {
            if (g.afterQuestions !== questionCount) return;
            const item = el('div', 'qa-item qa-guess' + (g.correct ? ' correct' : ''));
            item.appendChild(el('div', 'qa-question', `🎯 第 ${i + 1} 次猜測：${g.text}`));
            item.appendChild(el('div', 'qa-answers', `${g.correct ? '✅ 猜對了' : '❌ 猜錯了'}（${g.judgeName} 判定）`));
            list.appendChild(item);
        });
    };

    renderGuessesAfter(0);
    target.questions.forEach(q => {
        const item = el('div', 'qa-item');
        item.appendChild(el('div', 'qa-question', `Q${q.id}. ${q.text}`));
        const answers = el('div', 'qa-answers');
        if (q.answers.length === 0) {
            answers.appendChild(el('span', 'qa-waiting', '等待回答中...'));
        }
        q.answers.forEach(a => {
            const span = el('span', 'qa-answer');
            span.appendChild(el('span', null, `${a.name}：`));
            if (a.answer === 'text') {
                span.appendChild(el('span', 'ans ans-text', a.note));
            } else {
                span.appendChild(el('span', `ans ans-${a.answer}`, ANSWER_LABELS[a.answer]));
                if (a.note) span.appendChild(el('span', 'note', `（${a.note}）`));
            }
            answers.appendChild(span);
        });
        item.appendChild(answers);
        list.appendChild(item);
        renderGuessesAfter(q.id);
    });

    if (hasPendingGuess) {
        const item = el('div', 'qa-item qa-guess');
        item.appendChild(el('div', 'qa-question', `🎯 猜測：${state.pendingGuess.text}`));
        item.appendChild(el('div', 'qa-waiting', '等待其他人判定...'));
        list.appendChild(item);
    }

    list.scrollTop = list.scrollHeight;
}

// SWITCH BOTTOM CONTROL PANELS
function renderControls(state, me, active) {
    ['panel-ask', 'panel-answer', 'panel-judge', 'panel-spectating'].forEach(id => $(id).classList.remove('active'));
    const spectate = (text) => {
        $('panel-spectating').classList.add('active');
        $('panel-spectating').querySelector('.control-hint').textContent = text;
    };

    if (!active || !me) {
        spectate('遊戲結束！');
        return '🏁 遊戲結束，來看看排名吧！';
    }

    const isMeActive = active.id === me.id;
    const lastQuestion = active.questions[active.questions.length - 1];

    if (isMeActive) {
        if (state.roundPhase === 'judging') {
            const n = state.pendingGuess && state.pendingGuess.judgments ? state.pendingGuess.judgments.length : 0;
            spectate(`你猜了「${state.pendingGuess ? state.pendingGuess.text : ''}」，等待其他人判定...（已有 ${n} 人判定，需要 ${state.judgesNeeded} 人一致）`);
            return '🎯 等待其他人判定你的猜測！';
        }
        $('panel-ask').classList.add('active');
        const waitingForAnswer = lastQuestion && lastQuestion.answers.length === 0;
        $('btn-ask').disabled = waitingForAnswer;
        $('btn-ask').classList.toggle('disabled', waitingForAnswer);
        $('ask-hint').textContent = waitingForAnswer
            ? '等待其他人回答上一題...（可以先猜答案）'
            : '輪到你了！問大家一個問題來縮小範圍吧。';
        const noGuesses = me.guessesLeft <= 0;
        $('btn-guess').disabled = noGuesses;
        $('btn-guess').classList.toggle('disabled', noGuesses);
        $('guess-quota').textContent = noGuesses
            ? '猜測次數已用完，再問一題可以多一次機會'
            : `剩餘猜測次數：${me.guessesLeft}（上限＝已問題數＋1）`;
        return `🎤 輪到你發問！目前已問 ${me.questionCount} 題。`;
    }

    if (state.roundPhase === 'judging' && state.pendingGuess) {
        $('panel-judge').classList.add('active');
        $('judge-asker').textContent = active.name;
        $('judge-guess').textContent = state.pendingGuess.text;
        $('judge-celebrity').textContent = active.celebrity ? active.celebrity.name : '';
        const judgments = state.pendingGuess.judgments || [];
        const mine = judgments.find(j => j.playerId === me.id);
        const yes = judgments.filter(j => j.correct).length;
        $('judge-progress').textContent = `需要 ${state.judgesNeeded} 人判定一致：猜對 ${yes}／猜錯 ${judgments.length - yes}`
            + (mine ? `｜你：${mine.correct ? '猜對了' : '猜錯了'}（可以改）` : '');
        $('btn-judge-correct').classList.toggle('chosen', !!mine && mine.correct);
        $('btn-judge-wrong').classList.toggle('chosen', !!mine && !mine.correct);
        return `🎯 ${active.name} 猜「${state.pendingGuess.text}」，請判定對錯！`;
    }

    // Only the latest question can be answered; older ones you skipped are left to the others
    const unanswered = lastQuestion
        && !lastQuestion.answers.some(a => a.playerId === me.id)
        && !skippedQuestions.has(`${active.id}:${lastQuestion.id}`)
        ? lastQuestion : null;
    if (unanswered) {
        $('panel-answer').classList.add('active');
        $('panel-answer').dataset.questionId = unanswered.id;
        $('answer-asker').textContent = active.name;
        $('answer-question').textContent = unanswered.text;
        $('answer-celebrity').textContent = active.celebrity ? active.celebrity.name : '';
        return `❓ ${active.name} 問：「${unanswered.text}」，請誠實回答！`;
    }

    spectate(`等待 ${active.name} 發問中...`);
    return `🎤 ${active.name} 正在思考下一個問題（已問 ${active.questionCount} 題）。`;
}

// CUSTOM CELEBRITY PROPOSAL
let proposalFormOpen = false;

function renderProposal(state, me, active) {
    const box = $('proposal-box');
    const pr = state.proposal;
    const canPropose = active && me && me.id !== active.id && state.roundPhase === 'asking' && !state.gameEnded;
    box.style.display = (pr || canPropose) ? 'flex' : 'none';
    if (!pr && !canPropose) return;

    $('btn-open-proposal').style.display = canPropose && !pr && !proposalFormOpen ? 'block' : 'none';
    $('proposal-form').style.display = canPropose && !pr && proposalFormOpen ? 'flex' : 'none';
    $('btn-open-proposal').querySelector('span').textContent = `✏️ 幫 ${active ? active.name : ''} 自創題目`;

    if (!pr) {
        $('proposal-text').textContent = '';
        $('proposal-vote-row').style.display = 'none';
        return;
    }
    const proposer = state.players.find(p => p.id === pr.proposerId);
    const target = state.players.find(p => p.id === pr.targetId);
    const counts = `同意 ${pr.yesIds.length}／不同意 ${pr.noIds.length}（共 ${pr.voterIds.length} 人可投）`;
    const myVote = pr.yesIds.includes(socket.id) ? 'yes' : pr.noIds.includes(socket.id) ? 'no' : null;
    if (pr.targetId === socket.id) {
        $('proposal-text').textContent = `✏️ ${proposer ? proposer.name : '有人'} 提議幫你換一個自訂的名人，大家投票中...（${counts}）`;
    } else {
        $('proposal-text').textContent = `✏️ ${proposer ? proposer.name : '?'} 提議把 ${target ? target.name : '?'} 的名人換成「${pr.name}」：${counts}`
            + (myVote ? (myVote === 'yes' ? '｜你：同意' : '｜你：不同意') : '');
    }
    const canVote = pr.voterIds.includes(socket.id);
    $('proposal-vote-row').style.display = canVote ? 'flex' : 'none';
    $('btn-proposal-yes').classList.toggle('chosen', myVote === 'yes');
    $('btn-proposal-no').classList.toggle('chosen', myVote === 'no');
}

// GAME OVER RANKING
function renderGameOver(state) {
    const modal = $('game-over-modal');
    if (!state.gameEnded) {
        modal.classList.remove('active');
        return;
    }
    const list = $('final-scores-list');
    list.innerHTML = '';
    const solvedCounts = state.players.filter(p => p.status === 'solved').map(p => p.questionCount);
    const best = solvedCounts.length ? Math.min(...solvedCounts) : null;

    let rank = 0;
    let prevKey = null;
    state.ranking.forEach((id, idx) => {
        const p = state.players.find(pl => pl.id === id);
        if (!p) return;
        const key = `${p.status}-${p.questionCount}`;
        if (key !== prevKey) rank = idx + 1;
        prevKey = key;

        const li = el('li');
        if (p.status === 'solved' && p.questionCount === best) li.classList.add('rank-first');
        const medal = p.status === 'solved' && p.questionCount === best ? '🏆 ' : `${rank}. `;
        li.appendChild(el('span', null, `${medal}${p.name}｜${p.celebrity ? p.celebrity.name : ''}`));
        const result = p.status === 'solved' ? `${p.questionCount} 題猜中` : STATUS_LABELS[p.status];
        li.appendChild(el('strong', null, result));
        list.appendChild(li);
    });

    const me = state.players.find(p => p.id === socket.id);
    $('btn-restart').style.display = me ? 'inline-block' : 'none';
    modal.classList.add('active');
}

// RENDER MAIN GAME BOARD
function renderGameBoard(state) {
    latestState = state;
    const me = state.me;
    const active = state.players.find(p => p.id === state.activePlayerId) || null;

    // Follow the active player's Q&A whenever the turn changes
    if (state.activePlayerId !== lastActivePlayerId) {
        lastActivePlayerId = state.activePlayerId;
        if (state.activePlayerId) selectedPlayerId = state.activePlayerId;
    }
    if (!state.players.some(p => p.id === selectedPlayerId)) {
        selectedPlayerId = state.activePlayerId || (me && me.id);
    }

    $('display-my-celebrity').textContent = me && me.celebrity ? me.celebrity.name : '？？？（猜出來才會揭曉）';
    $('display-phase').textContent = state.gameEnded ? '遊戲結束' : (state.roundPhase === 'judging' ? '判定猜測' : '發問中');
    $('display-active-player').textContent = active ? active.name : '-';
    $('display-question-count').textContent = active ? active.questionCount : '-';
    const finished = state.players.filter(p => ['solved', 'gaveup', 'left'].includes(p.status)).length;
    $('display-progress').textContent = `${finished} / ${state.players.length}`;

    renderPlayers(state, me);
    renderQaList(state);
    $('ticker-text').textContent = renderControls(state, me, active);
    renderProposal(state, me, active);
    renderGameOver(state);
    playStateSounds(state, me, active);
}

// Notify players when something needs their attention
function playStateSounds(state, me, active) {
    if (!me) return;
    let key = null;
    if (state.gameEnded) key = 'end';
    else if (active && active.id === me.id) key = `turn-${active.id}-${state.roundPhase}`;
    else if (active) key = `q-${active.id}-${active.questions.length}-${state.roundPhase}`;
    if (key === lastSoundKey) return;
    const first = lastSoundKey === null;
    lastSoundKey = key;
    if (first) return;
    if (key === 'end') AudioSynth.playSuccess();
    else AudioSynth.playNotify();
}

// REGISTER CLICK & FORM EVENT LISTENERS
function initEvents() {
    $('btn-create-room').addEventListener('click', () => {
        AudioSynth.playTick();
        const nickname = $('input-nickname').value.trim();
        if (!nickname) return showError('暱稱不能為空！');
        socket.emit('createRoom', { name: nickname, gameType: 'whoami' });
    });

    $('btn-join-room').addEventListener('click', () => {
        AudioSynth.playTick();
        const nickname = $('input-nickname').value.trim();
        const code = $('input-room-code').value.trim().toUpperCase();
        if (!nickname) return showError('暱稱不能為空！');
        if (code.length !== 4) return showError('房號必須是 4 碼！');
        socket.emit('joinRoom', { name: nickname, roomCode: code, gameType: 'whoami' });
    });

    $('btn-start-game').addEventListener('click', () => {
        AudioSynth.playTick();
        socket.emit('startGame');
    });

    const ask = () => {
        const text = $('input-question').value.trim();
        if (!text) return showError('請輸入問題！');
        if ($('btn-ask').disabled) return showError('請等其他人回答上一題。');
        AudioSynth.playTick();
        socket.emit('whoami_ask', { text });
        $('input-question').value = '';
    };
    $('btn-ask').addEventListener('click', ask);
    $('input-question').addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.isComposing) ask(); });

    const guess = () => {
        const text = $('input-guess').value.trim();
        if (!text) return showError('請輸入你猜的名人！');
        if ($('btn-guess').disabled) return showError('猜測次數已用完，請再問一題。');
        AudioSynth.playTick();
        socket.emit('whoami_guess', { text });
        $('input-guess').value = '';
    };
    $('btn-guess').addEventListener('click', guess);
    $('input-guess').addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.isComposing) guess(); });

    $('btn-give-up').addEventListener('click', () => {
        if (confirm('確定要放棄嗎？放棄的人會排在最後。')) {
            socket.emit('whoami_giveUp');
        }
    });

    function sendAnswer(answer) {
        const note = $('input-note').value.trim();
        if (answer === 'text' && !note) {
            $('input-note').focus();
            return;
        }
        AudioSynth.playTick();
        socket.emit('whoami_answer', {
            questionId: Number($('panel-answer').dataset.questionId),
            answer,
            note
        });
        $('input-note').value = '';
    }

    document.querySelectorAll('#panel-answer [data-answer]').forEach(btn => {
        btn.addEventListener('click', () => sendAnswer(btn.dataset.answer));
    });
    // Free-text answer for open questions ("演過什麼電影？")
    $('btn-answer-text').addEventListener('click', () => sendAnswer('text'));
    $('btn-answer-skip').addEventListener('click', () => {
        AudioSynth.playTick();
        skippedQuestions.add(`${latestState.activePlayerId}:${$('panel-answer').dataset.questionId}`);
        $('input-note').value = '';
        renderGameBoard(latestState);
    });
    $('input-note').addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.isComposing) sendAnswer('text'); });

    $('btn-open-proposal').addEventListener('click', () => {
        AudioSynth.playTick();
        proposalFormOpen = true;
        renderGameBoard(latestState);
        $('input-custom-celebrity').focus();
    });
    const sendProposal = () => {
        const name = $('input-custom-celebrity').value.trim();
        if (!name) return showError('請輸入要出的名人！');
        AudioSynth.playTick();
        socket.emit('whoami_proposeCustom', { name });
        $('input-custom-celebrity').value = '';
        proposalFormOpen = false;
    };
    $('btn-send-proposal').addEventListener('click', sendProposal);
    $('input-custom-celebrity').addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.isComposing) sendProposal(); });
    $('btn-proposal-yes').addEventListener('click', () => {
        AudioSynth.playTick();
        socket.emit('whoami_voteCustom', { agree: true });
    });
    $('btn-proposal-no').addEventListener('click', () => {
        AudioSynth.playTick();
        socket.emit('whoami_voteCustom', { agree: false });
    });

    $('btn-judge-correct').addEventListener('click', () => {
        AudioSynth.playTick();
        socket.emit('whoami_judge', { correct: true });
    });
    $('btn-judge-wrong').addEventListener('click', () => {
        AudioSynth.playTick();
        socket.emit('whoami_judge', { correct: false });
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
    if (!state.gameStarted) {
        lastActivePlayerId = null;
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
