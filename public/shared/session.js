// Shared helpers for every game page: a per-tab seat token so refreshing or
// reconnecting puts you back in your room, a remembered nickname, invite links
// (?room=ABCD) and a proper "leave room" when exiting to the portal.
// Load this before the game's app.js.

// Every page that loads this also gets the 中文 / EN switch
(() => {
    const s = document.createElement('script');
    s.src = '/shared/i18n.js';
    document.head.appendChild(s);
})();

window.BoardgameSession = (() => {
    const TOKEN_KEY = 'boardgame_session_token';
    const NAME_KEY = 'boardgame_nickname';

    function randomToken() {
        if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
        return Array.from({ length: 4 }, () => Math.random().toString(36).slice(2, 10)).join('');
    }

    // sessionStorage: survives refresh but is separate per tab, so two tabs can play as two people
    let token = sessionStorage.getItem(TOKEN_KEY);
    if (!token) {
        token = randomToken();
        sessionStorage.setItem(TOKEN_KEY, token);
    }

    let socket = null;

    function connect(gameType) {
        socket = io({ auth: { token, gameType } });
        installResultsHold(socket);
        loadChat(socket);
        return socket;
    }

    // After a game ends, whoever presses the game's "back to lobby" button
    // (restartGame) resets the room, but everyone else keeps their results on
    // screen: their lobby updates are held back until they press it too.
    // The lobby shows who is still looking at results.
    function installResultsHold(sock) {
        const handlers = [];
        let last = null;        // last state the game saw
        let pending = null;     // newest lobby state held back while looking at results
        let holding = false;
        let goingBack = false;  // this player asked to go back themselves
        let viewers = [];
        let banner = null;

        const deliver = (state) => {
            last = state;
            handlers.forEach(h => h(state));
            renderBanner();
        };

        const nameOf = (id) => {
            const p = ((pending || last) && (pending || last).players || []).find(x => x.id === id);
            return p ? p.name : '?';
        };

        function renderBanner() {
            if (!banner) {
                banner = document.createElement('div');
                banner.style.cssText = 'position:fixed;top:0;left:50%;transform:translateX(-50%);z-index:940;max-width:min(560px,94vw);'
                    + 'padding:6px 14px;border-radius:0 0 12px 12px;background:#3c2f2f;color:#fff;font-size:0.82rem;font-weight:700;'
                    + 'text-align:center;box-shadow:0 4px 12px rgba(0,0,0,0.25);display:none;font-family:sans-serif;';
                document.body.appendChild(banner);
            }
            const others = viewers.filter(id => id !== sock.id);
            // On the results screen the note goes at the top; in the lobby at the bottom,
            // clear of the lobby's header buttons
            const place = (atTop) => {
                banner.style.top = atTop ? '0' : 'auto';
                banner.style.bottom = atTop ? 'auto' : '16px';
                banner.style.borderRadius = atTop ? '0 0 12px 12px' : '12px';
                banner.style.maxWidth = atTop ? 'min(560px,94vw)' : 'calc(100vw - 200px)';
            };
            if (holding) {
                place(true);
                banner.textContent = '🏠 其他人已經回到大廳了，你可以慢慢看結果；看完按「回大廳」就會過去。';
            } else if (last && !last.gameStarted && others.length) {
                place(false);
                banner.textContent = `⏳ 還在看結果：${others.map(nameOf).join('、')}`;
            } else {
                banner.style.display = 'none';
                return;
            }
            banner.style.display = 'block';
        }

        sock.on('roomUpdate', (state) => {
            if (state.gameStarted) {
                // A new game (or the same one) is on: always show it
                holding = false;
                pending = null;
                goingBack = false;
                deliver(state);
                return;
            }
            if (holding) {
                pending = state;
                renderBanner();
                return;
            }
            if (last && last.gameStarted && last.gameEnded && !goingBack) {
                // Someone else went back to the lobby: keep showing the results
                holding = true;
                pending = state;
                renderBanner();
                return;
            }
            goingBack = false;
            deliver(state);
        });

        sock.on('resultViewers', ({ ids } = {}) => {
            viewers = Array.isArray(ids) ? ids : [];
            // Reloaded the page while listed as looking at results: we are in the lobby now
            if (!holding && last && !last.gameStarted && viewers.includes(sock.id)) sock.emit('lobby_back');
            renderBanner();
        });

        // Games register their own roomUpdate handlers; route them through the hold
        const originalOn = sock.on.bind(sock);
        sock.on = (event, fn) => {
            if (event === 'roomUpdate') {
                handlers.push(fn);
                return sock;
            }
            return originalOn(event, fn);
        };

        const originalEmit = sock.emit.bind(sock);
        sock.emit = (event, ...args) => {
            if (event === 'restartGame' && last && last.gameEnded) {
                if (holding) {
                    // The room is already back in the lobby: just go there
                    holding = false;
                    const state = pending;
                    pending = null;
                    originalEmit('lobby_back');
                    if (state) deliver(state);
                    return sock;
                }
                goingBack = true;
            }
            return originalEmit(event, ...args);
        };
    }

    // Every game gets the room chat window (public/shared/chat.js)
    function loadChat(sock) {
        const script = document.createElement('script');
        script.src = '/shared/chat.js';
        script.onload = () => { if (window.BoardgameChat) window.BoardgameChat.attach(sock); };
        document.head.appendChild(script);
    }

    function inviteRoomCode() {
        const code = new URLSearchParams(location.search).get('room');
        return code ? code.trim().toUpperCase().slice(0, 4) : '';
    }

    // Prefill nickname / room code inputs and remember the nickname as it's typed
    function initLoginForm({ nameInputId, roomInputId }) {
        const nameInput = document.getElementById(nameInputId);
        const roomInput = document.getElementById(roomInputId);
        if (nameInput) {
            nameInput.value = nameInput.value || localStorage.getItem(NAME_KEY) || '';
            nameInput.addEventListener('input', () => localStorage.setItem(NAME_KEY, nameInput.value.trim()));
        }
        const code = inviteRoomCode();
        if (roomInput && code) {
            roomInput.value = code;
            if (nameInput && !nameInput.value) nameInput.focus();
        }
    }

    function inviteUrl(code) {
        return `${location.origin}${location.pathname}?room=${encodeURIComponent(code)}`;
    }

    async function copyText(text) {
        try {
            await navigator.clipboard.writeText(text);
            return true;
        } catch (e) {
            // Clipboard API needs https; fall back for plain-http LAN hosting
            const area = document.createElement('textarea');
            area.value = text;
            area.style.position = 'fixed';
            area.style.opacity = '0';
            document.body.appendChild(area);
            area.select();
            const ok = document.execCommand('copy');
            area.remove();
            return ok;
        }
    }

    // Adds a "copy invite link" button next to the lobby's room code element
    function mountInviteButton(codeElementId, className = 'btn btn-brass') {
        const codeEl = document.getElementById(codeElementId);
        if (!codeEl) return;
        const anchor = codeEl.parentElement;
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = `${className} invite-link-btn`;
        btn.style.marginLeft = '10px';
        btn.style.padding = '6px 12px';
        btn.style.fontSize = '0.8rem';
        btn.style.width = 'auto';
        const label = document.createElement('span');
        label.textContent = '🔗 複製邀請連結';
        btn.appendChild(label);
        btn.addEventListener('click', async () => {
            const code = codeEl.textContent.trim();
            if (!/^[A-Z]{4}$/.test(code)) return;
            const url = inviteUrl(code);
            if (navigator.share && /Mobi|Android/i.test(navigator.userAgent)) {
                try {
                    await navigator.share({ title: document.title, text: `一起來玩！房號 ${code}`, url });
                    return;
                } catch (e) { /* cancelled: fall through to copy */ }
            }
            const ok = await copyText(url);
            label.textContent = ok ? '✅ 已複製！' : url;
            setTimeout(() => { label.textContent = '🔗 複製邀請連結'; }, 2000);
        });
        anchor.insertAdjacentElement('afterend', btn);
    }

    // Leave the room for real (no reconnect) and go back to the portal
    function exitToPortal() {
        const go = () => { window.location.href = '/'; };
        if (!socket || !socket.connected) return go();
        socket.emit('leaveRoom', go);
        setTimeout(go, 1000);
    }

    return { connect, initLoginForm, mountInviteButton, exitToPortal, inviteUrl };
})();
