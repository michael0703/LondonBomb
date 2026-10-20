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

    function show(visible) {
        ui.fab.classList.toggle('show', visible);
        if (!visible) setOpen(false);
    }

    function attach(sock) {
        if (socket) return;
        socket = sock;
        build();

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
