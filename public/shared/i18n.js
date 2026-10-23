// Chinese / English switch for every page. Each phone picks its own language
// (remembered in localStorage). The games are written in Chinese; in English
// mode this file translates the page's text as it appears (including text the
// server sends) using dictionaries in /shared/i18n/. Player names and chat
// messages are left alone. Switching back restores the original Chinese.
//
// Dictionary files call BoardgameI18n.add({ '中文': 'English', ... }).
// Keys with {0}, {1}… are templates: '輪到 {0} 出牌' -> 'It is {0}'s turn'.
// The captured parts are translated too when they are known words.

window.BoardgameI18n = (() => {
    const KEY = 'boardgame_lang';
    const CJK = /[㐀-鿿豈-﫿]/;
    const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'TEXTAREA', 'NOSCRIPT']);
    const ATTRS = ['placeholder', 'title', 'aria-label'];

    let lang = 'zh';
    try { lang = localStorage.getItem(KEY) === 'en' ? 'en' : 'zh'; } catch (e) { /* storage blocked */ }

    const exact = new Map();
    const templates = [];
    let phrases = [];
    let phrasesDirty = false;
    const cache = new Map();
    const loaded = new Set();
    let observer = null;
    let button = null;

    // Which dictionaries a page needs: common + the game folder's own (+ word banks)
    const page = location.pathname.split('/').filter(Boolean)[0] || 'portal';
    const BANKS = { whoami: ['bank-celebrities'], whonum: ['whoami'], topten: ['bank-topics'], undercover: ['bank-undercover'], decrypto: ['bank-decrypto'] };
    const files = ['common', page, ...(BANKS[page] || [])];

    function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

    function add(dict) {
        Object.entries(dict).forEach(([zh, en]) => {
            if (/\{\d+\}/.test(zh)) {
                const order = [];
                // Parts may be empty (e.g. an optional suffix the code leaves blank)
                const source = zh.split(/(\{\d+\})/).map(part => {
                    const m = part.match(/^\{(\d+)\}$/);
                    if (m) { order.push(Number(m[1])); return '([\\s\\S]*?)'; }
                    return escapeRe(part);
                }).join('');
                templates.push({ re: new RegExp(`^${source}$`), order, en, weight: zh.replace(/\{\d+\}/g, '').length });
            } else {
                exact.set(zh, en);
            }
        });
        templates.sort((a, b) => b.weight - a.weight);
        phrasesDirty = true;
        cache.clear();
    }

    function phraseList() {
        if (phrasesDirty) {
            phrases = [...exact.entries()].filter(([zh]) => zh.length >= 2 && CJK.test(zh)).sort((a, b) => b[0].length - a[0].length);
            phrasesDirty = false;
        }
        return phrases;
    }

    // How much of a string is still untranslated: Chinese characters weigh most,
    // leftover full-width punctuation counts a little
    const FULLWIDTH = /[（）：，、｜「」『』。！？【】；]/g;
    const cjkCount = (s) => (s.match(/[㐀-鿿豈-﫿]/g) || []).length * 10 + (s.match(FULLWIDTH) || []).length;
    const untranslated = (s) => cjkCount(s) > 0;
    // Finished English text: turn leftover full-width punctuation into normal punctuation
    const ASCII_PUNCT = { '（': ' (', '）': ')', '：': ': ', '，': ', ', '、': ', ', '｜': ' | ', '「': '"', '」': '"', '『': '"', '』': '"', '。': '. ', '！': '! ', '？': '? ', '【': '[', '】': ']', '；': '; ' };
    function tidy(s) {
        if (CJK.test(s)) return s;
        // Quoted items written back to back: 「a」「b」 -> "a", "b"
        s = s.replace(/」「/g, '", "').replace(/』『/g, '", "');
        return s.replace(FULLWIDTH, c => ASCII_PUNCT[c]).replace(/ {2,}/g, ' ').replace(/\( /g, '(').replace(/ ([),.!?:])/g, '$1').trim();
    }

    // Exact entry, else the template whose filled-in result has the least Chinese
    // left (several templates can match text built from pieces)
    function translateCore(s, depth) {
        if (exact.has(s)) return exact.get(s);
        let best = null;
        for (const t of templates) {
            const m = s.match(t.re);
            if (!m) continue;
            let out = t.en;
            t.order.forEach((idx, i) => {
                const part = m[i + 1];
                out = out.split(`{${idx}}`).join(depth < 5 ? translate(part, depth + 1) : part);
            });
            if (!untranslated(out)) return out;
            if (best === null || cjkCount(out) < cjkCount(best)) best = out;
        }
        return best;
    }

    const SEPARATORS = { '、': ', ', '，': ', ', '｜': ' | ' };

    // Translate one string; keeps surrounding whitespace
    function translate(s, depth = 0) {
        if (!s || !CJK.test(s)) return s;
        if (cache.has(s)) return cache.get(s);
        // Multi-line text: one line at a time
        if (s.includes('\n') && s.trim().includes('\n')) {
            const out = s.split('\n').map(line => translate(line, depth + 1)).join('\n');
            if (depth === 0) cache.set(s, out);
            return out;
        }
        const lead = s.match(/^\s*/)[0];
        const trail = s.match(/\s*$/)[0];
        const core = s.trim();
        let out = depth < 6 ? translateCore(core, depth) : null;
        const better = (candidate) => candidate !== null && (out === null || cjkCount(candidate) < cjkCount(out));
        // Several sentences built into one line: one sentence at a time
        if ((out === null || untranslated(out)) && depth < 6) {
            const sentences = core.split(/(?<=[。！？])/).filter(Boolean);
            if (sentences.length > 1) {
                const joined = sentences.map(x => translate(x, depth + 1).trim()).join(' ');
                if (better(joined)) out = joined;
            }
        }
        // Lists joined with 、 ， ｜: translate each piece
        if ((out === null || untranslated(out)) && depth < 6 && /[、，｜]/.test(core)) {
            const pieces = core.split(/([、，｜])/);
            const joined = pieces.map(p => (SEPARATORS[p] || translate(p, depth + 1).trim())).join('');
            if (joined !== core && better(joined)) out = joined;
        }
        // Last resort: replace known phrases inside whatever is still Chinese
        if (out === null || CJK.test(out)) {
            out = out === null ? core : out;
            for (const [zh, en] of phraseList()) {
                if (out.includes(zh)) out = out.split(zh).join(en);
                if (!CJK.test(out)) break;
            }
        }
        out = lead + (depth === 0 ? tidy(out) : out) + trail;
        if (depth === 0) cache.set(s, out);
        return out;
    }

    function skipped(node) {
        for (let el = node.nodeType === 1 ? node : node.parentElement; el; el = el.parentElement) {
            if (SKIP_TAGS.has(el.tagName) || el.hasAttribute('data-no-i18n') || el.classList.contains('bgchat-list')) return true;
        }
        return false;
    }

    function translateTextNode(node) {
        const text = node.nodeValue;
        if (!CJK.test(text) || skipped(node)) return;
        const out = translate(text);
        if (out !== text) {
            node.__i18nZh = text;
            node.__i18nEn = out;
            node.nodeValue = out;
        }
    }

    function translateElementAttrs(el) {
        ATTRS.forEach(attr => {
            const v = el.getAttribute && el.getAttribute(attr);
            if (v && CJK.test(v) && !skipped(el)) {
                el.setAttribute(`data-i18n-zh-${attr}`, v);
                el.setAttribute(attr, translate(v));
            }
        });
    }

    function walk(root) {
        if (root.nodeType === 3) return translateTextNode(root);
        if (root.nodeType !== 1 || skipped(root)) return;
        translateElementAttrs(root);
        const tw = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
        let n;
        while ((n = tw.nextNode())) {
            if (n.nodeType === 3) translateTextNode(n);
            else translateElementAttrs(n);
        }
    }

    function translateTitle() {
        if (!document.__i18nZhTitle) document.__i18nZhTitle = document.title;
        document.title = translate(document.__i18nZhTitle);
    }

    function startObserver() {
        if (observer) return;
        observer = new MutationObserver(mutations => {
            if (lang !== 'en') return;
            mutations.forEach(m => {
                if (m.type === 'characterData') {
                    if (m.target.nodeValue !== m.target.__i18nEn) translateTextNode(m.target);
                } else if (m.type === 'attributes') {
                    translateElementAttrs(m.target);
                } else {
                    m.addedNodes.forEach(walk);
                }
            });
        });
        observer.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATTRS });
    }

    // Put the Chinese back on everything we changed
    function restore() {
        const tw = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
        let n;
        while ((n = tw.nextNode())) {
            if (n.nodeType === 3) {
                if (n.__i18nZh !== undefined && n.nodeValue === n.__i18nEn) n.nodeValue = n.__i18nZh;
            } else {
                ATTRS.forEach(attr => {
                    const zh = n.getAttribute(`data-i18n-zh-${attr}`);
                    if (zh !== null) { n.setAttribute(attr, zh); n.removeAttribute(`data-i18n-zh-${attr}`); }
                });
            }
        }
        if (document.__i18nZhTitle) document.title = document.__i18nZhTitle;
    }

    function loadDictionaries() {
        const pending = files.filter(f => !loaded.has(f)).map(f => new Promise(resolve => {
            loaded.add(f);
            const s = document.createElement('script');
            s.src = `/shared/i18n/${f}.js`;
            s.onload = resolve;
            s.onerror = resolve; // a game without its own dictionary still gets common
            document.head.appendChild(s);
        }));
        return Promise.all(pending);
    }

    async function apply() {
        document.documentElement.lang = lang === 'en' ? 'en' : 'zh-TW';
        renderButton();
        if (lang === 'en') {
            await loadDictionaries();
            if (lang !== 'en') return;
            walk(document.body);
            translateTitle();
            startObserver();
        } else {
            restore();
        }
    }

    function setLang(next) {
        lang = next === 'en' ? 'en' : 'zh';
        try { localStorage.setItem(KEY, lang); } catch (e) { /* storage blocked */ }
        apply();
    }

    function renderButton() {
        if (!button) {
            button = document.createElement('button');
            button.type = 'button';
            button.setAttribute('data-no-i18n', '');
            button.setAttribute('aria-label', 'Language / 語言');
            button.style.cssText = 'position:fixed;left:12px;bottom:12px;z-index:950;padding:8px 12px;border-radius:20px;'
                + 'border:2px solid #e5b058;background:#3c2f2f;color:#fff;font-weight:800;font-size:0.85rem;cursor:pointer;'
                + 'box-shadow:0 4px 12px rgba(0,0,0,0.3);font-family:sans-serif;';
            button.addEventListener('click', () => setLang(lang === 'en' ? 'zh' : 'en'));
            document.body.appendChild(button);
        }
        button.textContent = lang === 'en' ? '🌐 中文' : '🌐 EN';
    }

    // alert / confirm / prompt messages come from the games' code in Chinese
    ['alert', 'confirm', 'prompt'].forEach(fn => {
        const original = window[fn].bind(window);
        window[fn] = (message, ...rest) => original(lang === 'en' ? translate(String(message)) : message, ...rest);
    });

    function init() { apply(); }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();

    return { add, translate, setLang, get lang() { return lang; } };
})();
