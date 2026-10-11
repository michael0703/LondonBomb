// Shared helpers for every game page: a per-tab seat token so refreshing or
// reconnecting puts you back in your room, a remembered nickname, invite links
// (?room=ABCD) and a proper "leave room" when exiting to the portal.
// Load this before the game's app.js.

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
        return socket;
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
