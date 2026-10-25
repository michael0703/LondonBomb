// Room chat for every game page: a 💬 button in the corner opens a small chat
// window for the people in the same room. session.js loads this file and calls
// BoardgameChat.attach(socket) once the game has connected.

window.BoardgameChat = (() => {
    const MAX_KEEP = 100;
    let socket = null;
    let roomCode = null;
    let open = false;
    let unread = 0;
    let messages = [];
    const ui = {};
    let players = [];
    let tableOpen = false;
    let lastIds = '';
    let options = null;
    const bubbleTimers = {};

    const STYLE = `
.bgchat-fab {
    position: fixed; right: 16px; bottom: 16px; z-index: 950;
    width: 54px; height: 54px; border-radius: 50%; border: none;
    background: #3c2f2f; color: #fff; font-size: 1.5rem; cursor: pointer;
    border: 2px solid #e5b058; box-shadow: 0 6px 18px rgba(0,0,0,0.35); display: none;
}
.bgchat-fab.show { display: block; }
.bgchat-badge {
    position: absolute; top: -4px; right: -4px; min-width: 22px; height: 22px; padding: 0 6px;
    border-radius: 11px; background: #d9534f; color: #fff; font-size: 0.75rem; font-weight: 800;
    line-height: 22px; text-align: center; font-family: sans-serif; display: none;
}
.bgchat-panel {
    position: fixed; right: 16px; bottom: 82px; z-index: 951;
    width: 340px; max-width: calc(100vw - 32px); height: 460px; max-height: calc(100vh - 110px);
    display: none; flex-direction: column; overflow: hidden;
    background: #fffdf9; color: #3c2f2f; border: 2px solid #c39a75; border-radius: 14px;
    box-shadow: 0 12px 32px rgba(0,0,0,0.25); font-family: 'Noto Sans TC', 'Outfit', sans-serif;
}
.bgchat-panel.show { display: flex; }
.bgchat-head {
    display: flex; align-items: center; justify-content: space-between; gap: 8px;
    padding: 10px 12px; background: #3c2f2f; color: #fff; font-weight: 800; font-size: 0.95rem;
}
.bgchat-close { background: none; border: none; color: #fff; font-size: 1.2rem; cursor: pointer; padding: 0 4px; }
.bgchat-list { flex: 1; overflow-y: auto; padding: 10px; display: flex; flex-direction: column; gap: 8px; }
.bgchat-empty { margin: auto; color: #8c7a6e; font-size: 0.85rem; text-align: center; }
.bgchat-msg { max-width: 82%; align-self: flex-start; display: flex; flex-direction: column; gap: 2px; }
.bgchat-msg.mine { align-self: flex-end; align-items: flex-end; }
.bgchat-meta { font-size: 0.7rem; color: #8c7a6e; }
.bgchat-text {
    background: #f1e8dd; border-radius: 12px; padding: 6px 10px; font-size: 0.9rem; line-height: 1.45;
    word-break: break-word; white-space: pre-wrap;
}
.bgchat-msg.mine .bgchat-text { background: #e5b058; color: #2b2020; }
.bgchat-form { display: flex; gap: 6px; padding: 8px; border-top: 1px solid #eadfd3; background: #fff; }
/* Games style inputs their own way (e.g. dark, centered): keep the chat box plain */
.bgchat-panel .bgchat-input {
    flex: 1; min-width: 0; width: auto; margin: 0; border: 1px solid #cfc2b6 !important; border-radius: 10px;
    padding: 8px 10px; font-size: 16px; font-family: inherit !important; color: #3c2f2f !important;
    background: #fff !important; text-align: left !important; letter-spacing: normal !important;
    text-transform: none !important; box-shadow: none !important; height: auto;
}
.bgchat-send {
    border: none; border-radius: 10px; padding: 0 14px; background: #e5b058; color: #2b2020;
    font-weight: 800; cursor: pointer; font-family: inherit;
}
.bgtable-fab {
    position: fixed; right: 16px; bottom: 82px; z-index: 950;
    width: 54px; height: 54px; border-radius: 50%; border: 2px solid #e5b058;
    background: #3c2f2f; color: #fff; font-size: 1.5rem; cursor: pointer;
    box-shadow: 0 6px 18px rgba(0,0,0,0.35); display: none;
}
.bgtable-fab.show { display: block; }
.bgtable-panel {
    position: fixed; right: 16px; bottom: 148px; z-index: 951;
    width: 340px; max-width: calc(100vw - 32px); max-height: calc(100vh - 170px); overflow-y: auto;
    display: none; flex-direction: column; background: #fffdf9; color: #3c2f2f;
    border: 2px solid #c39a75; border-radius: 14px; box-shadow: 0 12px 32px rgba(0,0,0,0.25);
    font-family: 'Noto Sans TC', 'Outfit', sans-serif;
}
.bgtable-panel.show { display: flex; }
.bgtable-ring { position: relative; width: 280px; height: 280px; margin: 8px auto; flex: none; }
.bgtable-top {
    position: absolute; left: 50%; top: 50%; width: 150px; height: 150px; margin: -75px 0 0 -75px;
    border-radius: 50%; background: radial-gradient(#8a5a3c, #5d3a24); border: 4px solid #3c2f2f;
}
.bgtable-seat {
    position: absolute; width: 56px; margin: -28px 0 0 -28px; text-align: center;
    display: flex; flex-direction: column; align-items: center;
}
.bgtable-avatar {
    width: 38px; height: 38px; border-radius: 50%; color: #fff; font-weight: 800; font-size: 1.1rem;
    line-height: 38px; border: 2px solid #fff; box-shadow: 0 2px 6px rgba(0,0,0,0.3);
}
.bgtable-seat.me .bgtable-avatar { border-color: #e5b058; }
.bgtable-seat.away { opacity: 0.45; }
.bgtable-name { font-size: 0.65rem; max-width: 60px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.bgtable-bubble {
    position: absolute; bottom: 100%; left: 50%; transform: translateX(-50%); margin-bottom: 2px;
    background: #fff; border: 2px solid #3c2f2f; border-radius: 10px; padding: 3px 7px;
    font-size: 0.75rem; font-weight: 700; white-space: nowrap; z-index: 2; pointer-events: none;
}
.bgtable-bubble.emoji { font-size: 1.6rem; padding: 0 6px; }
.bgtable-picks { display: flex; flex-wrap: wrap; gap: 6px; padding: 8px 10px; border-top: 1px solid #eadfd3; }
.bgtable-pick {
    border: 1px solid #cfc2b6; background: #f1e8dd; border-radius: 10px; padding: 4px 8px;
    font-size: 0.8rem; cursor: pointer; font-family: inherit; color: #3c2f2f;
}
.bgtable-pick.emoji { font-size: 1.3rem; padding: 2px 8px; }
.bgtable-hint { padding: 0 10px 8px; font-size: 0.7rem; color: #8c7a6e; min-height: 1em; }
/* A page can put the table right in its layout with <div data-table-dock>; then it is always shown there */
.bgtable-panel.docked {
    position: static; display: flex; width: 100%; max-width: 380px; max-height: none; margin: 0 auto;
    z-index: auto; box-shadow: none;
}
@media (max-width: 600px) {
    .bgtable-panel { right: 8px; bottom: 140px; }
    .bgtable-fab { right: 12px; bottom: 76px; }
}
@media (max-width: 600px) {
    .bgchat-panel { right: 8px; left: 8px; width: auto; max-width: none; bottom: 78px; height: 60vh; }
    .bgchat-fab { right: 12px; bottom: 12px; }
}`;

    function el(tag, className, text) {
        const node = document.createElement(tag);
        if (className) node.className = className;
        if (text !== undefined) node.textContent = text;
        return node;
    }

    function build() {
        const style = document.createElement('style');
        style.textContent = STYLE;
        document.head.appendChild(style);

        ui.fab = el('button', 'bgchat-fab', '💬');
        ui.fab.type = 'button';
        ui.fab.setAttribute('aria-label', '聊天室');
        ui.badge = el('span', 'bgchat-badge');
        ui.fab.appendChild(ui.badge);

        ui.panel = el('div', 'bgchat-panel');
        const head = el('div', 'bgchat-head');
        ui.title = el('span', null, '💬 聊天室');
        const close = el('button', 'bgchat-close', '✕');
        close.type = 'button';
        close.setAttribute('aria-label', '關閉聊天室');
        head.appendChild(ui.title);
        head.appendChild(close);
        ui.list = el('div', 'bgchat-list');
        const form = el('form', 'bgchat-form');
        ui.input = el('input', 'bgchat-input');
        ui.input.type = 'text';
        ui.input.maxLength = 200;
        ui.input.placeholder = '輸入訊息…';
        ui.input.setAttribute('enterkeyhint', 'send');
        const send = el('button', 'bgchat-send', '送出');
        send.type = 'submit';
        form.appendChild(ui.input);
        form.appendChild(send);
        ui.panel.appendChild(head);
        ui.panel.appendChild(ui.list);
        ui.panel.appendChild(form);
        document.body.appendChild(ui.panel);
        document.body.appendChild(ui.fab);

        ui.fab.addEventListener('click', () => setOpen(!open));
        close.addEventListener('click', () => setOpen(false));
        form.addEventListener('submit', (e) => {
            e.preventDefault();
            const text = ui.input.value.trim();
            if (!text || !socket) return;
            socket.emit('chat_send', { text });
            ui.input.value = '';
        });
    }

    function setOpen(value) {
        open = value;
        ui.panel.classList.toggle('show', open);
        if (open) {
            if (tableOpen) setTableOpen(false);
            unread = 0;
            renderBadge();
            renderList();
            if (!/Mobi|Android/i.test(navigator.userAgent)) ui.input.focus();
        }
    }

    function renderBadge() {
        ui.badge.textContent = unread > 99 ? '99+' : String(unread);
        ui.badge.style.display = unread ? 'block' : 'none';
    }

    const timeText = (ms) => new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    function renderList() {
        const atBottom = ui.list.scrollHeight - ui.list.scrollTop - ui.list.clientHeight < 40;
        ui.list.innerHTML = '';
        if (!messages.length) {
            ui.list.appendChild(el('div', 'bgchat-empty', '還沒有訊息，跟大家打聲招呼吧！'));
            return;
        }
        messages.forEach(m => {
            const mine = socket && m.playerId === socket.id;
            const item = el('div', 'bgchat-msg' + (mine ? ' mine' : ''));
            item.appendChild(el('span', 'bgchat-meta', `${mine ? '你' : m.name}・${timeText(m.time)}`));
            item.appendChild(el('span', 'bgchat-text', m.text));
            ui.list.appendChild(item);
        });
        if (atBottom || open) ui.list.scrollTop = ui.list.scrollHeight;
    }


    // ---- Round table: seats in a circle, round avatars, emoji / phrase bubbles ----
    const AVATAR_COLORS = ['#c0392b', '#d35400', '#b7950b', '#27ae60', '#16a085', '#2980b9', '#8e44ad', '#c2185b', '#5d6d7e'];
    function avatarColor(name) {
        let h = 0;
        for (const ch of String(name)) h = (h * 31 + ch.codePointAt(0)) >>> 0;
        return AVATAR_COLORS[h % AVATAR_COLORS.length];
    }

    function buildTable() {
        ui.tableFab = el('button', 'bgtable-fab', '🪑');
        ui.tableFab.type = 'button';
        ui.tableFab.setAttribute('aria-label', '圓桌');
        ui.tablePanel = el('div', 'bgtable-panel');
        ui.ring = el('div', 'bgtable-ring');
        ui.picks = el('div', 'bgtable-picks');
        ui.hint = el('div', 'bgtable-hint', '點一個表情或句子，大家會在你的座位旁看到');
        ui.tablePanel.appendChild(ui.ring);
        ui.tablePanel.appendChild(ui.picks);
        ui.tablePanel.appendChild(ui.hint);
        document.body.appendChild(ui.tablePanel);
        document.body.appendChild(ui.tableFab);
        ui.tableFab.addEventListener('click', () => setTableOpen(!tableOpen));
        const dock = document.querySelector('[data-table-dock]');
        if (dock) {
            ui.dock = dock;
            ui.tablePanel.classList.add('docked');
            dock.appendChild(ui.tablePanel);
            // The dock lives inside a view that is only sometimes visible: use the floating button when it is hidden
            setInterval(syncDock, 700);
        }
    }

    function dockVisible() {
        return !!(ui.dock && ui.dock.offsetParent !== null);
    }

    function syncDock() {
        if (!ui.dock) return;
        const visible = dockVisible();
        const wasDocked = ui.tablePanel.classList.contains('docked');
        if (visible && !wasDocked) {
            ui.tablePanel.classList.add('docked');
            ui.dock.appendChild(ui.tablePanel);
            setTableOpen(false);
            renderTable();
        } else if (!visible && wasDocked) {
            ui.tablePanel.classList.remove('docked');
            document.body.appendChild(ui.tablePanel);
            ui.tablePanel.classList.remove('show');
            tableOpen = false;
        }
        ui.tableFab.classList.toggle('show', !visible && !!roomCode);
    }

    function setTableOpen(value) {
        tableOpen = value;
        if (ui.tablePanel.classList.contains('docked')) value = true;
        ui.tablePanel.classList.toggle('show', value);
        if (value) {
            if (open && !ui.tablePanel.classList.contains('docked')) setOpen(false);
            renderTable();
        }
    }

    function renderPicks() {
        ui.picks.innerHTML = '';
        if (!options) return;
        options.emojis.forEach(v => ui.picks.appendChild(pickButton('emoji', v)));
        options.phrases.forEach(v => ui.picks.appendChild(pickButton('phrase', v)));
    }

    function pickButton(kind, value) {
        const b = el('button', 'bgtable-pick' + (kind === 'emoji' ? ' emoji' : ''), value);
        b.type = 'button';
        b.addEventListener('click', () => socket && socket.emit('table_emote', { kind, value }));
        return b;
    }

    function renderTable() {
        if (!ui.ring) return;
        ui.ring.innerHTML = '';
        ui.ring.appendChild(el('div', 'bgtable-top'));
        const n = players.length;
        players.forEach((p, i) => {
            const angle = (i / Math.max(n, 1)) * 2 * Math.PI - Math.PI / 2;
            const seat = el('div', 'bgtable-seat' + (socket && p.id === socket.id ? ' me' : '') + (p.connected === false ? ' away' : ''));
            seat.dataset.pid = p.id;
            seat.style.left = `${140 + 112 * Math.cos(angle)}px`;
            seat.style.top = `${140 + 112 * Math.sin(angle)}px`;
            const avatar = el('div', 'bgtable-avatar', Array.from(String(p.name || '?'))[0]);
            avatar.style.background = avatarColor(p.name);
            seat.appendChild(avatar);
            seat.appendChild(el('div', 'bgtable-name', p.name));
            ui.ring.appendChild(seat);
        });
    }

    function showBubble(m) {
        const seat = ui.ring && ui.ring.querySelector(`[data-pid="${m.playerId}"]`);
        if (!seat) return;
        const old = seat.querySelector('.bgtable-bubble');
        if (old) old.remove();
        seat.appendChild(el('div', 'bgtable-bubble' + (m.kind === 'emoji' ? ' emoji' : ''), m.value));
        clearTimeout(bubbleTimers[m.playerId]);
        bubbleTimers[m.playerId] = setTimeout(() => {
            const b = seat.querySelector('.bgtable-bubble');
            if (b) b.remove();
        }, 3500);
    }

    function show(visible) {
        ui.fab.classList.toggle('show', visible);
        ui.tableFab.classList.toggle('show', visible && !dockVisible());
        if (!visible) {
            setOpen(false);
            setTableOpen(false);
        }
    }

    function attach(sock) {
        if (socket) return;
        socket = sock;
        build();
        buildTable();
        socket.emit('table_options');
        socket.on('table_options', (o) => { options = o; renderPicks(); });
        socket.on('table_emote', (m) => {
            showBubble(m);
        });
        socket.on('table_emote_wait', ({ waitMs } = {}) => {
            ui.hint.textContent = `太快了，${Math.ceil((waitMs || 0) / 1000)} 秒後再試`;
            setTimeout(() => { ui.hint.textContent = '點一個表情或句子，大家會在你的座位旁看到'; }, 1500);
        });
        const enterRoom = (code) => {
            if (code === roomCode) return false;
            roomCode = code;
            messages = [];
            unread = 0;
            renderBadge();
            ui.title.textContent = `💬 聊天室（${code}）`;
            show(true);
            return true;
        };
        socket.on('roomUpdate', (state) => {
            if (state && Array.isArray(state.players)) {
                const ids = state.players.map(p => p.id).join();
                players = state.players;
                if (tableOpen || dockVisible() || ids !== lastIds) renderTable();
                lastIds = ids;
            }
            const code = state && state.roomCode;
            if (code && enterRoom(code)) socket.emit('chat_history');
        });
        // This file loads after the game connected, so ask right away; also after a reconnect
        socket.emit('chat_history');
        socket.on('connect', () => socket.emit('chat_history'));
        socket.on('chat_history', ({ roomCode: code, messages: list } = {}) => {
            if (!code) return;
            enterRoom(code);
            messages = Array.isArray(list) ? list.slice(-MAX_KEEP) : [];
            renderList();
        });
        socket.on('chat_message', (m) => {
            messages.push(m);
            if (messages.length > MAX_KEEP) messages.shift();
            if (!open && !(socket && m.playerId === socket.id)) {
                unread += 1;
                renderBadge();
            }
            renderList();
        });
        socket.on('kicked', () => {
            roomCode = null;
            messages = [];
            show(false);
        });
    }

    return { attach };
})();
