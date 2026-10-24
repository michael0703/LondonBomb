// 🐞 button on every page: players send a bug report or a feature request,
// and the server opens a GitHub issue for it (report.js on the server).
(() => {
    const NAME_KEY = 'boardgame_nickname';
    const STYLE = `
.bgreport-btn {
    position: fixed; left: 104px; bottom: 12px; z-index: 950; padding: 8px 12px; border-radius: 20px;
    border: 2px solid #e5b058; background: #3c2f2f; color: #fff; font-weight: 800; font-size: 0.85rem;
    cursor: pointer; box-shadow: 0 4px 12px rgba(0,0,0,0.3); font-family: sans-serif;
}
.bgreport-overlay {
    position: fixed; inset: 0; z-index: 1001; background: rgba(0,0,0,0.45);
    display: none; align-items: center; justify-content: center; padding: 12px;
}
.bgreport-overlay.show { display: flex; }
.bgreport-box {
    width: 100%; max-width: 440px; max-height: 92vh; overflow-y: auto; background: #fffdf9; color: #3c2f2f;
    border: 2px solid #c39a75; border-radius: 14px; padding: 16px; font-family: 'Noto Sans TC', 'Outfit', sans-serif;
    display: flex; flex-direction: column; gap: 10px; text-align: left;
}
.bgreport-box h2 { margin: 0; font-size: 1.15rem; }
.bgreport-box p { margin: 0; font-size: 0.82rem; color: #8c7a6e; line-height: 1.5; }
.bgreport-kinds { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.bgreport-kind {
    border: 2px solid #cfc2b6; border-radius: 10px; padding: 10px 6px; background: #fff; cursor: pointer;
    font-weight: 800; font-family: inherit; font-size: 0.9rem; color: #3c2f2f;
}
.bgreport-kind.on { border-color: #e5b058; background: #fff6e3; }
.bgreport-box label { font-size: 0.82rem; font-weight: 700; display: flex; flex-direction: column; gap: 4px; }
.bgreport-box input, .bgreport-box textarea {
    border: 1px solid #cfc2b6 !important; border-radius: 10px; padding: 8px 10px; font-size: 16px; font-family: inherit !important;
    color: #3c2f2f !important; background: #fff !important; text-align: left !important; width: 100%; box-sizing: border-box;
    letter-spacing: normal !important; text-transform: none !important;
}
.bgreport-box textarea { min-height: 110px; resize: vertical; }
.bgreport-actions { display: flex; gap: 8px; }
.bgreport-actions button {
    flex: 1; border: none; border-radius: 10px; padding: 11px; font-weight: 800; cursor: pointer; font-family: inherit; font-size: 0.95rem;
}
.bgreport-send { background: #e5b058; color: #2b2020; }
.bgreport-send:disabled { opacity: 0.6; cursor: default; }
.bgreport-cancel { background: #eadfd3; color: #3c2f2f; }
.bgreport-msg { font-size: 0.85rem; font-weight: 700; }
.bgreport-msg.err { color: #b03a2e; }
.bgreport-msg.ok { color: #2f6d63; }
.bgreport-msg a { color: #2f4c78; word-break: break-all; }
.bgreport-hp { position: absolute; left: -9999px; width: 1px; height: 1px; opacity: 0; }
@media (max-width: 600px) { .bgreport-btn { left: 98px; } }`;

    let kind = 'bug';
    const ui = {};

    function el(tag, className, text) {
        const node = document.createElement(tag);
        if (className) node.className = className;
        if (text !== undefined) node.textContent = text;
        return node;
    }

    const page = location.pathname.split('/').filter(Boolean)[0] || '';
    const roomCode = () => {
        const codeEl = document.getElementById('display-room-code');
        const code = codeEl ? codeEl.textContent.trim().slice(0, 4) : '';
        return /^[A-Z]{4}$/.test(code) ? code : '';
    };

    function build() {
        const style = document.createElement('style');
        style.textContent = STYLE;
        document.head.appendChild(style);

        ui.button = el('button', 'bgreport-btn', '🐞 回報');
        ui.button.type = 'button';
        document.body.appendChild(ui.button);

        ui.overlay = el('div', 'bgreport-overlay');
        const box = el('form', 'bgreport-box');
        box.appendChild(el('h2', null, '🐞 回報問題 / 💡 提出想要的功能'));
        box.appendChild(el('p', null, '送出後會在 GitHub 開一則 issue，大家都看得到。有 GitHub 帳號的朋友可以去按 👍 支持。'));

        const kinds = el('div', 'bgreport-kinds');
        ui.kindBug = el('button', 'bgreport-kind on', '🐞 有 Bug');
        ui.kindFeature = el('button', 'bgreport-kind', '💡 想要的功能');
        [ui.kindBug, ui.kindFeature].forEach(b => { b.type = 'button'; kinds.appendChild(b); });
        box.appendChild(kinds);

        const field = (labelText, input) => {
            const label = el('label', null, labelText);
            label.appendChild(input);
            box.appendChild(label);
            return input;
        };
        ui.title = field('標題', el('input'));
        ui.title.maxLength = 80;
        ui.details = field('詳細說明', el('textarea'));
        ui.details.maxLength = 2000;
        ui.name = field('你的名字（選填）', el('input'));
        ui.name.maxLength = 30;
        ui.honeypot = el('input', 'bgreport-hp');
        ui.honeypot.tabIndex = -1;
        ui.honeypot.autocomplete = 'off';
        box.appendChild(ui.honeypot);

        ui.msg = el('div', 'bgreport-msg');
        box.appendChild(ui.msg);
        const actions = el('div', 'bgreport-actions');
        ui.cancel = el('button', 'bgreport-cancel', '關閉');
        ui.cancel.type = 'button';
        ui.send = el('button', 'bgreport-send', '送出');
        ui.send.type = 'submit';
        actions.appendChild(ui.cancel);
        actions.appendChild(ui.send);
        box.appendChild(actions);
        ui.overlay.appendChild(box);
        document.body.appendChild(ui.overlay);

        ui.button.addEventListener('click', open);
        ui.cancel.addEventListener('click', close);
        ui.overlay.addEventListener('click', (e) => { if (e.target === ui.overlay) close(); });
        ui.kindBug.addEventListener('click', () => setKind('bug'));
        ui.kindFeature.addEventListener('click', () => setKind('feature'));
        box.addEventListener('submit', (e) => { e.preventDefault(); send(); });
    }

    function setKind(next) {
        kind = next;
        ui.kindBug.classList.toggle('on', kind === 'bug');
        ui.kindFeature.classList.toggle('on', kind === 'feature');
        ui.title.placeholder = kind === 'bug' ? '例如：投票後畫面卡住' : '例如：希望可以設定回合時間';
        ui.details.placeholder = kind === 'bug'
            ? '發生了什麼？你做了哪些步驟？本來應該怎樣？'
            : '想要什麼功能？在什麼情況下會用到？';
    }

    function showMessage(text, type, link) {
        ui.msg.className = 'bgreport-msg' + (type ? ` ${type}` : '');
        ui.msg.textContent = text;
        if (link) {
            ui.msg.appendChild(document.createElement('br'));
            const a = el('a', null, link);
            a.href = link;
            a.target = '_blank';
            a.rel = 'noopener';
            ui.msg.appendChild(a);
        }
    }

    async function open() {
        setKind(kind);
        if (!ui.name.value) {
            try { ui.name.value = localStorage.getItem(NAME_KEY) || ''; } catch (e) { /* storage blocked */ }
        }
        showMessage('');
        ui.send.disabled = false;
        ui.overlay.classList.add('show');
        try {
            const res = await fetch('/api/report/status');
            const status = await res.json();
            if (!status.enabled) {
                showMessage('回報功能還沒設定好（伺服器缺少 GitHub token），請先直接跟房主說。', 'err');
                ui.send.disabled = true;
            }
        } catch (e) { /* the send will report the problem */ }
    }

    function close() {
        ui.overlay.classList.remove('show');
    }

    async function send() {
        const title = ui.title.value.trim();
        const details = ui.details.value.trim();
        if (title.length < 2) return showMessage('請寫一個標題。', 'err');
        if (details.length < 5) return showMessage('請多描述一點細節。', 'err');
        ui.send.disabled = true;
        showMessage('送出中…');
        try {
            const res = await fetch('/api/report', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ kind, title, details, name: ui.name.value.trim(), game: page, room: roomCode(), website: ui.honeypot.value })
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
                ui.send.disabled = false;
                return showMessage(data.error || '送出失敗，請稍後再試。', 'err');
            }
            ui.title.value = '';
            ui.details.value = '';
            showMessage('✅ 送出了，謝謝！可以在這裡看到（有 GitHub 帳號可以按 👍）：', 'ok', data.url || '');
        } catch (e) {
            ui.send.disabled = false;
            showMessage('連不上伺服器，請稍後再試。', 'err');
        }
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', build);
    else build();
})();
