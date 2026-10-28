#!/usr/bin/env node
// 把活俠傳 wiki（https://github.com/Mr-Smilin/LoM-wiki）的劇情資料轉成 public/lom/data/story.json。
//
// 用法：
//   node tools/lom-build.js                 # 自動 git clone wiki 原始檔到暫存資料夾
//   node tools/lom-build.js <LoM-wiki 路徑>  # 使用已下載的 wiki 原始檔
//
// 樹的骨幹來自「主支線簡易表格」（年 › 月旬 › 路線 › 事件），
// 每個事件頁裡的「👉選擇／🎲天運／☯事件…」再展開成選項分支，結局另外列在「汗青書」與「生死簿」底下。

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const REPO = 'https://github.com/Mr-Smilin/LoM-wiki.git';
const SITE = 'https://smilin.net/LoM-wiki';
const OUT = path.join(__dirname, '..', 'public', 'lom', 'data', 'story.json');

// ---------- 取得 wiki 原始檔 ----------

function wikiDir() {
    if (process.argv[2]) return path.resolve(process.argv[2]);
    const dir = path.join(os.tmpdir(), 'LoM-wiki');
    if (fs.existsSync(path.join(dir, '.git'))) {
        execFileSync('git', ['-C', dir, 'pull', '--ff-only', '-q'], { stdio: 'inherit' });
    } else {
        execFileSync('git', ['clone', '--depth', '1', '-q', REPO, dir], { stdio: 'inherit' });
    }
    return dir;
}

const ROOT = wikiDir();
const DOCS = path.join(ROOT, 'docs');
const read = rel => fs.readFileSync(path.join(DOCS, rel), 'utf8');
const commit = (() => {
    try { return execFileSync('git', ['-C', ROOT, 'rev-parse', '--short', 'HEAD']).toString().trim(); } catch (e) { return null; }
})();

// ---------- HTML / Markdown 小工具 ----------

// 允許屬性值裡出現 ">"（wiki 的 title 屬性常有「道德>40」這種寫法）
// 只認字母開頭的標籤，避免把「【<80】」這種擲骰條件當成 HTML 吃掉
const TAG = /<\/?[A-Za-z!](?:[^>"']|"[^"]*"|'[^']*')*>/g;

function decode(s) {
    return s.replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&');
}

function text(html) {
    return decode(html
        .replace(/<!--[\s\S]*?-->/g, '')
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(TAG, '')
        .replace(/\[\[([^\]|]*\|)?([^\]]*)\]\]/g, '$2')
        .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
        .replace(/\*\*/g, ''))
        .split('\n').map(l => l.trim()).filter(Boolean).join('\n');
}

// 一行裡所有 title="…" 的內容（wiki 用滑鼠提示來寫數值變化）
function titles(html) {
    const out = [];
    html.replace(/title="([^"]*)"/g, (_, t) => { out.push(decode(t)); return _; });
    return out.map(t => t.split('\n').map(l => l.trim()).filter(Boolean).join('；')).filter(Boolean).join('；');
}

// 表格格子裡的 HTML：原始碼的換行只是排版，真正的換行是 <br> 和條列
function cellText(html) {
    return text(html.replace(/\s*\n\s*/g, ' ').replace(/<li>\s*/gi, '<br>• ').replace(/<\/li>/gi, ''));
}

function frontmatterTitle(md) {
    const m = md.match(/^---[\s\S]*?\ntitle:\s*(.+)\n[\s\S]*?---/);
    return m ? m[1].trim() : null;
}

// 把 <table> 解析成格子，處理 rowspan / colspan
function parseTable(html) {
    const rows = [];
    const grid = [];
    const trs = html.match(/<tr[\s\S]*?<\/tr>/g) || [];
    trs.forEach((tr, r) => {
        grid[r] = grid[r] || [];
        let c = 0;
        const cells = tr.match(/<t[hd](?:[^>"']|"[^"]*"|'[^']*')*>[\s\S]*?<\/t[hd]>/g) || [];
        const row = [];
        for (const cell of cells) {
            while (grid[r][c]) c++;
            const attrs = cell.match(/^<t[hd]((?:[^>"']|"[^"]*"|'[^']*')*)>/)[1];
            const rs = +(attrs.match(/rowspan\s*=\s*"?(\d+)/) || [0, 1])[1];
            const cs = +(attrs.match(/colspan\s*=\s*"?(\d+)/) || [0, 1])[1];
            const inner = cell.replace(/^<t[hd](?:[^>"']|"[^"]*"|'[^']*')*>/, '').replace(/<\/t[hd]>$/, '');
            const entry = { html: inner, col: c, span: cs, header: /^<th/.test(cell), origin: true };
            row.push(entry);
            for (let i = 0; i < rs; i++) {
                grid[r + i] = grid[r + i] || [];
                for (let j = 0; j < cs; j++) grid[r + i][c + j] = i === 0 && j === 0 ? entry : Object.assign({}, entry, { origin: false });
            }
            c += cs;
        }
        rows.push(row);
    });
    return { rows, grid };
}

// ---------- 節點 ----------

const nodes = [];
let seq = 0;
function add(parent, title, extra = {}) {
    const n = Object.assign({ id: (seq++).toString(36), parent: parent ? parent.id : null, title }, extra);
    for (const k of Object.keys(n)) if (n[k] === '' || n[k] == null) if (k !== 'parent') delete n[k];
    nodes.push(n);
    return n;
}

// slug 形如「simple/1-04-1-遊戲開局」或「detailed_description/3-08-2-武林大會」
const eventUrl = slug => `${SITE}/event/${slug.split('/').map(encodeURIComponent).join('/')}.html`;

// 一段 HTML／Markdown 裡連到事件頁的 slug（依出現順序、不重複）
function eventLinks(html) {
    const out = [];
    html.replace(/\]\(\/event\/((?:simple|detailed_description)\/[^)#]+)[^)]*\)/g, (_, slug) => {
        slug = decodeURIComponent(slug);
        if (!out.includes(slug)) out.push(slug);
        return _;
    });
    return out;
}

// ---------- 結局 ----------

const endNodes = new Map();    // 汗青書編號 -> node
const badendNodes = new Map(); // 生死簿編號 -> node

function buildEndings(root) {
    const ends = add(root, '結局：汗青書', { kind: 'group', url: `${SITE}/event/ends.html`, summary: '遊戲的正式結局。' });
    const { rows } = parseTable(read('event/ends/index.md'));
    for (const row of rows) {
        if (row.length < 3) continue;
        const no = (text(row[0].html).match(/結局\s*(\d+)/) || [])[1];
        if (!no) continue;
        const name = text(row[1].html);
        const info = text(row[2].html);
        const page = `event/ends/end-${no}.md`;
        let condition = '';
        let links = eventLinks(row[2].html);
        if (fs.existsSync(path.join(DOCS, page))) {
            const md = read(page);
            const m = md.match(/## 條件與流程([\s\S]*?)(?=\n## |$)/);
            if (m) {
                condition = text(m[1]).slice(0, 2000);
                links = links.concat(eventLinks(m[1]));
            }
        }
        endNodes.set(no, add(ends, `結局 ${no}：${name}`, {
            links,
            kind: 'end',
            summary: info,
            condition,
            url: fs.existsSync(path.join(DOCS, page)) ? `${SITE}/event/ends/end-${no}.html` : `${SITE}/event/ends.html`,
        }));
    }

    const bad = add(root, '猝死結局：生死簿', { kind: 'group', url: `${SITE}/event/badends.html`, summary: '劇情中途的死亡結局。' });
    const md = read('event/badends/index.md');
    const tables = md.match(/<Btable[\s\S]*?<\/Btable>/gi) || [];
    for (const t of tables) {
        for (const row of parseTable(t).rows) {
            if (row.length < 5) continue;
            const no = (text(row[0].html).match(/No\.\s*(\d+)/) || [])[1];
            if (!no) continue;
            const page = `event/badends/badend-${no}.md`;
            badendNodes.set(no, add(bad, `生死簿 ${no}：${text(row[1].html)}`, {
                links: eventLinks(row[4].html),
                kind: 'badend',
                summary: text(row[2].html),
                condition: text(row[4].html),
                url: fs.existsSync(path.join(DOCS, page)) ? `${SITE}/event/badends/badend-${no}.html` : `${SITE}/event/badends.html`,
            }));
        }
    }
}

// ---------- 事件頁：選項分支 ----------

const HEADER = /^(👉|🎲|☯|🆚|💬|📖)[^：\s]*：/;
const EMOJI = /[\u{1F300}-\u{1FAFF}☀-➿️☯]/gu;

function key(label) {
    return label.replace(EMOJI, '').replace(/\s+/g, '').replace(/（[^）]*）/g, '');
}
function shortKey(label) {
    const k = key(label);
    return k.slice(k.indexOf('：') + 1).replace(/\([^)]*\)$/, '');
}

// 「文字 → 目標」：只切第一個箭頭，後面的都算目標描述
function splitArrow(line) {
    const i = line.indexOf('→');
    if (i < 0) return { label: line.trim(), target: '' };
    return { label: line.slice(0, i).trim(), target: line.slice(i + 1).trim() };
}

// 把一個事件頁解析成區塊：{ header, target, effects, notes[], options[], condition }
// 事件頁表格的欄位：多數是「觸發條件／事件內容／備註」，有些前面多一欄「階段名稱」
function eventRows(md) {
    const out = [];
    const tables = md.match(/<(table|btable)\b[\s\S]*?<\/\1>/gi) || [];
    for (const t of tables) {
        const { rows } = parseTable(t);
        const head = rows.find(r => r.length && r.every(c => c.header));
        const names = head ? head.map(c => text(c.html)) : [];
        const col = name => names.indexOf(name);
        const iContent = col('事件內容') >= 0 ? col('事件內容') : 1;
        const iCond = col('觸發條件') >= 0 ? col('觸發條件') : 0;
        const iRemark = col('備註') >= 0 ? col('備註') : iContent + 1;
        const iStage = col('階段名稱');
        for (const row of rows) {
            if (row === head || row.length <= iContent || row.every(c => c.header)) continue;
            const cell = i => (i >= 0 && row[i] ? text(row[i].html).replace(/^-$/, '') : '');
            out.push({ content: row[iContent].html, condition: cell(iCond), remark: cell(iRemark), stage: cell(iStage) });
        }
    }
    return out;
}

function parseEventPage(md) {
    const blocks = [];
    {
        for (const row of eventRows(md)) {
            const { condition, remark } = row;
            let block = null;
            let first = true;
            const close = () => {
                if (!block) return;
                // 「💬閒聊：A」「💬閒聊：B」…並列時，整組是可選的閒聊話題而不是標題加選項
                if (block.header && block.header.startsWith('💬') && block.options.length && block.options.every(o => o.label.startsWith('💬'))) {
                    block.options.unshift({ label: block.header, target: block.target, effects: block.effects, indent: 0 });
                    Object.assign(block, { header: '💬閒聊', target: '', effects: '' });
                }
                blocks.push(block);
                block = null;
            };
            for (const rawLine of row.content.split(/<br\s*\/?>|\n(?=\s*\n)/i)) {
                const effects = titles(rawLine);
                const raw = text(rawLine).replace(/\n/g, ' ');
                const indent = (raw.match(/^　*/) || [''])[0].length;
                const line = raw.replace(/^[　\s]+/, '');
                if (!line) { close(); continue; }
                if (!block) {
                    block = { notes: [], options: [], condition: first ? condition : '', remark: first ? remark : '' };
                    first = false;
                    if (HEADER.test(line)) {
                        const { label, target } = splitArrow(line);
                        Object.assign(block, { header: label, target, effects });
                        continue;
                    }
                    block.narrative = true;
                }
                if (block.narrative || (/^(📖|🚩)/.test(line) && !HEADER.test(line))) {
                    block.notes.push(line + (effects ? `（${effects}）` : ''));
                    continue;
                }
                if (line.startsWith('→')) {
                    // 「→ 條件」形式的分歧，用全形空白縮排表示巢狀
                    const { label, target } = splitArrow(line.slice(1));
                    block.options.push({ label, target, effects, indent: indent + 1, cond: true });
                } else {
                    const { label, target } = splitArrow(line);
                    block.options.push({ label, target, effects, indent: 0 });
                }
            }
            close();
        }
    }
    return blocks;
}

let eventIndex = new Map(); // 事件名稱 -> 事件節點（跨事件跳轉用）

function resolveSpecial(target) {
    const b = target.match(/生死簿\s*(?:No\.)?\s*(\d+)/);
    if (b && badendNodes.has(b[1])) return { kind: 'badend', node: badendNodes.get(b[1]) };
    const e = target.match(/(?:汗青書|結局)\s*(\d+)/);
    if (e && endNodes.has(e[1])) return { kind: 'end', node: endNodes.get(e[1]) };
    return null;
}

function buildEvent(eventNode, md) {
    const original = { summary: eventNode.summary, condition: eventNode.condition, remark: eventNode.remark };
    const blocks = parseEventPage(md);
    const byKey = new Map();
    const byShort = new Map();
    for (const b of blocks) {
        if (!b.header) continue;
        if (!byKey.has(key(b.header))) byKey.set(key(b.header), b);
        if (!byShort.has(shortKey(b.header))) byShort.set(shortKey(b.header), b);
    }
    const find = target => {
        if (!target) return null;
        // 只看第一段；目標後面常接「(自帶憤怒…)」之類的說明，逐一去掉結尾括號再比對
        let t = splitArrow(target).label;
        for (;;) {
            if (byKey.has(key(t))) return byKey.get(key(t));
            const stripped = t.replace(/\s*[(（][^()（）]*[)）]\s*$/, '');
            if (stripped === t) break;
            t = stripped;
        }
        return byShort.get(shortKey(splitArrow(target).label)) || null;
    };
    const done = new Map(); // block -> node

    // 接到目標：區塊（第一次展開，之後放跳轉）、結局、其他事件或結束文字
    function attachTarget(parent, target) {
        if (!target) return;
        const b = find(target);
        if (b) {
            if (done.has(b)) add(parent, `→ ${b.header.replace(EMOJI, '')}`, { kind: 'ref', goto: done.get(b).id });
            else expand(parent, b);
            return;
        }
        const sp = resolveSpecial(target);
        if (sp) {
            add(parent, target.replace(EMOJI, '').trim(), { kind: sp.kind === 'badend' ? 'badend-ref' : 'end-ref', goto: sp.node.id });
            return;
        }
        const first = splitArrow(target).label.replace(EMOJI, '').replace(/^[^：]*：/, '').trim();
        const ev = eventIndex.get(first);
        if (ev && ev.id !== eventNode.id) {
            add(parent, `→ 事件：${first}`, { kind: 'ref', goto: ev.id });
            return;
        }
        // 「事件結束」「設置🚩…」之類的純文字結果，記在父節點上
        const parentNode = nodes[nodes.length - 1] && nodes.find(n => n.id === parent.id);
        if (parentNode) parentNode.result = target.replace(/\s+/g, ' ');
    }

    function expand(parent, b) {
        const node = add(parent, b.header.replace(EMOJI, '').trim(), {
            kind: 'decision',
            effects: b.effects,
            condition: b.condition,
            summary: b.notes.join('\n'),
            remark: b.remark,
        });
        done.set(b, node);
        const stack = [{ indent: -1, node }];
        for (const o of b.options) {
            while (stack.length > 1 && stack[stack.length - 1].indent >= o.indent) stack.pop();
            const p = stack[stack.length - 1].node;
            const on = add(p, o.label.replace(EMOJI, '').trim() || '（無文字）', { kind: o.cond ? 'branch' : 'option', effects: o.effects });
            stack.push({ indent: o.indent, node: on });
            attachTarget(on, o.target);
        }
        // 標頭本身的箭頭：不管選哪個選項都會接到這裡
        if (b.target) attachTarget(node, b.target);
        return node;
    }

    for (const b of blocks) {
        if (b.narrative) {
            eventNode.summary = [eventNode.summary, b.notes.join('\n')].filter(Boolean).join('\n');
            if (b.condition && !eventNode.condition) eventNode.condition = b.condition;
            if (b.remark) eventNode.remark = [eventNode.remark, b.remark].filter(Boolean).join('\n');
            continue;
        }
        if (!done.has(b)) expand(eventNode, b);
    }
    if (done.size) return;
    // 結構化解析沒抓到分支：丟掉它當成敘述收集的文字，改用寬鬆的解析
    Object.assign(eventNode, original);
    for (const k of Object.keys(original)) if (eventNode[k] == null) delete eventNode[k];
    const before = nodes.length;
    buildEventLoose(eventNode, md);
    if (nodes.length === before) buildEventList(eventNode, md);
    if (nodes.length === before) buildEventIndex(eventNode, md);
}

// 用 Markdown 巢狀清單寫的頁面：每個「## 小節」一個節點，清單依縮排變成子節點
function buildEventList(eventNode, md) {
    const body = md.replace(/^---[\s\S]*?---/, '');
    let section = null;
    let stack = [];
    for (const line of body.split('\n')) {
        const h = line.match(/^##+\s+(.+)/);
        if (h) {
            section = null;
            stack = [];
            if (!/相關條目/.test(h[1])) section = { title: text(h[1]) };
            continue;
        }
        const item = line.match(/^(\s*)(?:[+\-*]|\d+\.)\s+(.+)$/);
        if (!item || !section) continue;
        if (!section.node) section.node = add(eventNode, section.title, { kind: 'decision' });
        const indent = item[1].replace(/\t/g, '  ').length;
        const t = text(item[2]).replace(/\n/g, ' ').replace(/[．。]$/, '');
        if (!t) continue;
        while (stack.length && stack[stack.length - 1].indent >= indent) stack.pop();
        const parent = stack.length ? stack[stack.length - 1].node : section.node;
        const { label, result } = splitLoose(t);
        const n = add(parent, label.replace(EMOJI, '').trim() || t, { kind: /📜|👉|「/.test(t) ? 'option' : 'branch', result });
        const sp = resolveSpecial(t);
        if (sp) add(n, sp.node.title, { kind: sp.kind + '-ref', goto: sp.node.id });
        stack.push({ indent, node: n });
    }
}

// 只列出系列事件連結的索引頁：把連結變成跳轉節點
function buildEventIndex(eventNode, md) {
    const body = md.replace(/^---[\s\S]*?---/, '');
    const seen = new Set();
    body.replace(/\[([^\]]+)\]\(\/event\/((?:simple|detailed_description)\/[^)#]+)[^)]*\)/g, (_, name, slug) => {
        slug = decodeURIComponent(slug);
        const target = placed.get(slug);
        if (!target || target.id === eventNode.id || seen.has(slug)) return _;
        seen.add(slug);
        add(eventNode, `→ 事件：${text(name)}`, { kind: 'ref', goto: target.id });
        return _;
    });
    const summary = text(body.replace(/^# .*$/m, '').replace(/^#+ .*$/gm, ''));
    if (summary && !eventNode.summary) eventNode.summary = summary.slice(0, 600);
}

// 自由格式的事件頁：每一列（階段）一個節點，像選項或結果的行列成子節點
const CHOICE_LIKE = /👉|🎲|🆚|「|【|生死簿|汗青書|→|接「/;

// 「👉「選項」：結果」「條件: 結果」切成選項與結果；「天運：…」這種標記後的冒號和「」裡的冒號不算
function splitLoose(t) {
    if (/[:：]\s*$/.test(t)) return { label: t.replace(/[:：]\s*$/, ''), result: '' };
    const re = /[:：]/g;
    let m;
    while ((m = re.exec(t))) {
        const prefix = t.slice(0, m.index);
        if (/(選擇|選項|天運|天命|事件|閒聊|對決|決鬥|抉擇|戰役)$/.test(prefix.replace(EMOJI, '').trim())) continue;
        if ((prefix.match(/「/g) || []).length > (prefix.match(/」/g) || []).length) continue;
        return { label: prefix.trim(), result: t.slice(m.index + 1).trim() };
    }
    return { label: t, result: '' };
}

function buildEventLoose(eventNode, md) {
    for (const row of eventRows(md)) {
        const lines = row.content.split(/<br\s*\/?>/i)
            .map(l => ({ text: text(l).replace(/\n/g, ' ').replace(/^[•\-\s\u3000]+/, ''), effects: titles(l) }))
            .filter(l => l.text);
        if (!lines.length) continue;
        const choices = lines.filter(l => CHOICE_LIKE.test(l.text));
        const notes = lines.filter(l => !CHOICE_LIKE.test(l.text)).map(l => l.text);
        if (!choices.length && !row.stage) {
            eventNode.summary = [eventNode.summary, notes.join('\n')].filter(Boolean).join('\n');
            if (row.condition && !eventNode.condition) eventNode.condition = row.condition;
            if (row.remark) eventNode.remark = [eventNode.remark, row.remark].filter(Boolean).join('\n');
            continue;
        }
        const stage = add(eventNode, row.stage || notes[0] || choices[0].text.replace(EMOJI, ''), {
            kind: 'decision',
            condition: row.condition,
            remark: row.remark,
            summary: (row.stage ? notes : notes.slice(1)).join('\n'),
        });
        for (const c of choices) {
            const { label: raw, result } = splitLoose(c.text);
            const label = raw.replace(EMOJI, '').trim() || c.text;
            const on = add(stage, label, { kind: /^(👉|「)/.test(c.text) ? 'option' : 'branch', effects: c.effects, result });
            const sp = resolveSpecial(c.text);
            if (sp) add(on, (c.text.match(/(生死簿|汗青書|結局)\s*\d+[^。，]*/) || [sp.node.title])[0].replace(/[\[\]()（）《》]/g, '').trim(), { kind: sp.kind + '-ref', goto: sp.node.id });
        }
    }
}

// ---------- 主支線簡易表格：事件地圖 ----------
//
// 時間由上往下，每條路線一欄。表格裡橫跨幾欄的格子＝那幾條路線共用的事件。
// 每個事件出現一次就是一個節點；同一個事件頁（例如每月的唐門例會）只解析一次，存在 pages。

const MONTHS = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九', '十', '十一', '十二'];
const YEARS = ['', '第一年', '第二年', '第三年', '第四年'];
const XUN = ['上', '中', '下'];
const monthNo = t => MONTHS.indexOf(t.replace(/月$/, ''));

const eventFiles = new Set();
for (const dir of ['simple', 'detailed_description']) {
    for (const f of fs.readdirSync(path.join(DOCS, 'event', dir))) if (f.endsWith('.md')) eventFiles.add(`${dir}/${f.slice(0, -3)}`);
}

const placed = new Map(); // slug -> 事件頁的錨點節點（選項樹掛在底下）
const pageOrder = [];     // 錨點節點，依第一次出現的順序

function pageFor(slug, name) {
    if (!eventFiles.has(slug)) return null;
    if (!placed.has(slug)) {
        const anchor = add(null, name, { kind: 'event', url: eventUrl(slug), slug });
        placed.set(slug, anchor);
        pageOrder.push(anchor);
        if (!eventIndex.has(name)) eventIndex.set(name, anchor);
    }
    return placed.get(slug);
}

const sections = [];
const slots = [];   // { section, year, month, xun, label }
const events = [];  // { id, title, slot, lanes: [欄位], anchor, url, other }

function cellEvents(html) {
    const out = [];
    for (const line of html.split(/<br\s*\/?>|\n/i).map(x => x.trim()).filter(Boolean)) {
        const link = line.match(/\[([^\]]+)\]\(([^)]+)\)/);
        const name = text(link ? link[1] : line);
        if (!name || name === '-') continue;
        let anchor = null, url = '';
        if (link && /^\/event\/(simple|detailed_description)\//.test(link[2])) {
            const slug = decodeURIComponent(link[2].replace(/^\/event\//, '').replace(/#.*$/, ''));
            anchor = pageFor(slug, name);
            url = eventUrl(slug);
        } else if (link) {
            url = /^https?:/.test(link[2]) ? link[2] : `${SITE}${link[2].replace(/#.*$/, '')}.html${(link[2].match(/#.*$/) || [''])[0]}`;
        }
        out.push({ title: name, anchor, url });
    }
    return out;
}

function addEvents(slot, lanes, html, other = false) {
    for (const e of cellEvents(html)) {
        events.push({ id: 'e' + events.length, title: e.title, slot, lanes, anchor: e.anchor, url: e.url, other });
    }
}

function buildTimeline() {
    const md = read('event/story-simple-table.md');
    let anytime = '';
    for (const sec of md.split(/\n## /).slice(1)) {
        const title = sec.split('\n')[0].trim();
        const tableHtml = (sec.match(/<table[\s\S]*?<\/table>/i) || [])[0];
        if (!tableHtml || title === '備註') continue;
        if (title === '任意時間') { anytime = tableHtml; continue; }

        const { rows, grid } = parseTable(tableHtml);
        const headerRows = rows.filter(r => r.length && r.every(c => c.header)).length;
        const width = Math.max(...grid.map(r => r.length));
        const colName = [];
        for (let c = 0; c < width; c++) {
            const parts = [];
            for (let r = 0; r < headerRows; r++) {
                const cell = grid[r] && grid[r][c];
                const t = cell ? text(cell.html).replace(/\n/g, '') : '';
                if (t && parts[parts.length - 1] !== t) parts.push(t);
            }
            colName[c] = parts.join('・');
        }
        const byMonth = colName[1] === '上旬'; // 第一年型：列＝月份、欄＝旬，只有一條路線
        const section = sections.length;
        const lanes = byMonth ? ['主線'] : colName.slice(2);
        while (lanes.length && !lanes[lanes.length - 1]) lanes.pop();
        sections.push({ title: title.replace(/:\s*/, '：'), lanes });
        let year = /第一年/.test(title) ? 1 : /第二年/.test(title) ? 2 : 3;
        let lastMonth = 0;
        const slotFor = (month, xun) => {
            if (month < lastMonth) year++; // 「第三年十一月至第四年」跨年
            lastMonth = month;
            slots.push({ section, year, month, xun, label: `${YEARS[year]} ${MONTHS[month]}月${XUN[xun - 1]}旬` });
            return slots.length - 1;
        };
        let monthText = '';
        for (let r = headerRows; r < grid.length; r++) {
            const g = grid[r];
            if (!g || !g.length) continue;
            monthText = text(g[0].html) || monthText;
            if (byMonth) {
                for (let c = 1; c < g.length; c++) {
                    if (!g[c] || !g[c].origin || !text(g[c].html) || text(g[c].html) === '-') continue;
                    addEvents(slotFor(monthNo(monthText), c), [0], g[c].html);
                }
            } else {
                if (!g[1]) continue; // rowspan 超出表格底部留下的空列
                let slot = null;
                for (let c = 2; c < g.length; c++) {
                    const cell = g[c];
                    if (!cell || !cell.origin || !text(cell.html) || text(cell.html) === '-') continue;
                    if (slot == null) slot = slotFor(monthNo(monthText), XUN.indexOf(text(g[1].html)) + 1);
                    const lanesOf = Array.from({ length: cell.span }, (_, i) => c - 2 + i).filter(l => l < lanes.length);
                    addEvents(slot, lanesOf, cell.html);
                }
            }
        }
    }

    // 「任意時間」與表格沒列到的事件頁放在最右邊的「其他」欄，依檔名的時間對到最接近的旬
    const key = (y, m, x) => y * 1000 + (m < 4 && y > 1 ? m + 12 : m) * 10 + x; // 遊戲從四月開始
    const slotKeys = slots.map(s => key(s.year, s.month, s.xun));
    if (anytime) addEvents(0, [], anytime.replace(/<\/?t[dr][^>]*>/g, '<br>'), true);
    const listed = new Set(placed.keys());
    for (const slug of [...eventFiles].filter(s => s.startsWith('simple/') && !listed.has(s)).sort()) {
        const m = slug.match(/^simple\/(\d+)-(\d+)-(\d+)-(.+)$/);
        if (!m) continue;
        const k = +m[1] ? key(+m[1], +m[2], +m[3]) : 0;
        let slot = 0;
        slotKeys.forEach((sk, i) => { if (sk <= k) slot = i; });
        events.push({ id: 'e' + events.length, title: m[4], slot, lanes: [], anchor: pageFor(slug, m[4]), url: eventUrl(slug), other: true });
    }
}

// 事件之間的連線：同一欄裡依時間相鄰的事件相連；換章節時，上一章各欄的最後一個事件連到下一章各欄的第一個事件
function buildEdges() {
    const edges = new Map();
    const byId = new Map(events.map(e => [e.id, e]));
    // 路線分岔的地方（下一個事件只屬於部分路線）在邊上標出路線名稱
    const link = (a, b) => {
        if (a === b || edges.has(`${a}>${b}`)) return;
        const from = byId.get(a), to = byId.get(b);
        const sec = sections[slots[to.slot].section];
        const sameSection = slots[from.slot].section === slots[to.slot].section;
        const narrower = to.lanes.length < sec.lanes.length && (!sameSection || to.lanes.length < from.lanes.length);
        edges.set(`${a}>${b}`, narrower ? to.lanes.map(l => sec.lanes[l]).join('／') : '');
    };
    let prevTails = [];
    sections.forEach((sec, s) => {
        const inSec = events.filter(e => !e.other && slots[e.slot].section === s);
        const heads = [], tails = [];
        sec.lanes.forEach((_, lane) => {
            const seq = inSec.filter(e => e.lanes.includes(lane));
            seq.forEach((e, i) => { if (i) link(seq[i - 1].id, e.id); });
            if (seq.length) { heads.push(seq[0].id); tails.push(seq[seq.length - 1].id); }
        });
        for (const t of prevTails) for (const h of new Set(heads)) link(t, h);
        prevTails = [...new Set(tails)];
    });
    return [...edges].map(([k, label]) => label ? [...k.split('>'), label] : k.split('>'));
}

// ---------- 目標：結緣攻略 ----------

function buildRomances() {
    const out = [];
    for (const f of fs.readdirSync(path.join(DOCS, 'event', 'pursuit')).filter(f => /^girl\d+\.md$/.test(f)).sort()) {
        const md = read(`event/pursuit/${f}`);
        const title = frontmatterTitle(md);
        const sec = (md.match(/## 結緣必要條件([\s\S]*?)(?=\n## |$)/) || [])[1];
        if (!title || !sec) continue;
        const steps = [];
        for (const t of sec.match(/<table[\s\S]*?<\/table>/gi) || []) {
            for (const row of parseTable(t).rows) {
                if (row.length < 4 || /^編號$/.test(text(row[0].html))) continue;
                steps.push({
                    no: text(row[0].html),
                    time: cellText(row[1].html).replace(/^•\s*/, '').replace(/\n•\s*/g, '；'),
                    event: cellText(row[2].html).replace(/^•\s*/, '').replace(/\n•?\s*/g, '、'),
                    links: eventLinks(row[2].html),
                    todo: cellText(row[3].html),
                    note: row[4] ? cellText(row[4].html) : '',
                });
            }
        }
        if (steps.length) out.push({ title, file: f.slice(0, -3), steps });
    }
    return out;
}

// ---------- main ----------

const endRoot = add(null, '結局', { kind: 'group' });
buildEndings(endRoot);
buildTimeline();
const edgeList = buildEdges();
const romances = buildRomances();
// 結緣攻略裡提到、但表格沒列出的事件頁也要能解析
for (const r of romances) for (const st of r.steps) for (const slug of st.links) pageFor(slug, slug.replace(/^.*\/\d+-\d+-\d+-/, ''));

for (const anchor of pageOrder) {
    const md = read(`event/${anchor.slug}.md`);
    const t = frontmatterTitle(md);
    if (t) anchor.title = t;
    buildEvent(anchor, md);
}

// 錨點節點底下的選項樹轉成巢狀結構
const children = new Map();
for (const n of nodes) {
    if (n.parent == null) continue;
    if (!children.has(n.parent)) children.set(n.parent, []);
    children.get(n.parent).push(n);
}
const pageIndex = new Map(pageOrder.map((a, i) => [a.id, i]));
const endingIds = new Map(); // 結局節點 id -> 目標 id
const goals = [];

for (const n of [...endNodes.values(), ...badendNodes.values()]) {
    const id = (n.kind === 'end' ? 'end' : 'bad') + n.title.match(/\d+/)[0];
    endingIds.set(n.id, id);
    goals.push({
        id,
        kind: n.kind,
        title: n.title,
        summary: n.summary,
        condition: n.condition,
        url: n.url,
        pages: (n.links || []).map(slug => placed.has(slug) ? pageIndex.get(placed.get(slug).id) : null).filter(x => x != null),
    });
}
romances.forEach(r => {
    goals.unshift({
        id: r.file,
        kind: 'romance',
        title: r.title,
        url: `${SITE}/event/pursuit/${r.file}.html`,
        steps: r.steps.map(st => ({
            no: st.no,
            time: st.time,
            event: st.event,
            todo: st.todo,
            note: st.note,
            pages: st.links.map(slug => placed.has(slug) ? pageIndex.get(placed.get(slug).id) : null).filter(x => x != null),
        })),
    });
});

// 事件頁的選項樹轉成流程圖：節點＝子事件（☯事件、🆚戰鬥、各階段）與結局，邊＝一路上的選項／骰子結果
const CHOICE_HEADER = /^(選擇|選項|天運|天命|閒聊|抉擇|👉)/;

function buildFlow(anchor, endsFound) {
    const fnodes = [{ t: anchor.title, k: 'start' }];
    const fedges = [];
    const owner = new Map(); // 決策節點 id -> 所在的流程節點
    const flowOf = new Map(); // 子事件的決策節點 id -> 流程節點
    const ends = new Map();
    const newNode = (n, extra = {}) => {
        const f = Object.assign({ t: n.title }, extra);
        if (n.effects) f.e = n.effects;
        if (n.condition) f.c = n.condition;
        if (n.summary) f.s = n.summary;
        if (n.remark) f.m = n.remark;
        fnodes.push(f);
        return fnodes.length - 1;
    };
    const edge = (from, to, steps) => fedges.push(steps.length ? [from, to, steps] : [from, to]);
    const step = (header, opt) => {
        const st = { o: opt.title };
        if (header) st.h = header.title;
        if (opt.effects) st.e = opt.effects;
        if (opt.result) st.r = opt.result;
        return st;
    };
    const endNode = (goalId, title, kind) => {
        if (!ends.has(goalId)) ends.set(goalId, fnodes.push({ t: title, k: kind, goal: goalId }) - 1);
        endsFound.add(goalId);
        return ends.get(goalId);
    };

    function target(from, n, steps) {
        // n 是選項、分歧或跳轉節點走到的下一個節點
        if (n.kind === 'decision') {
            if (CHOICE_HEADER.test(n.title)) { owner.set(n.id, from); walk(n, from, steps); return; }
            const idx = newNode(n, { k: /^🆚|對決|決鬥/.test(n.title) ? 'battle' : 'event' });
            flowOf.set(n.id, idx);
            owner.set(n.id, idx);
            edge(from, idx, steps);
            walk(n, idx, []);
        } else if (n.kind === 'ref') {
            if (flowOf.has(n.goto)) edge(from, flowOf.get(n.goto), steps);
            else if (owner.has(n.goto)) edge(from, owner.get(n.goto), steps.concat({ o: n.title }));
            else if (pageIndex.has(n.goto)) edge(from, fnodes.push({ t: n.title.replace(/^→\s*/, ''), k: 'page', page: pageIndex.get(n.goto) }) - 1, steps);
        } else if (/-ref$/.test(n.kind) && endingIds.has(n.goto)) {
            const goal = endingIds.get(n.goto);
            const g = nodes.find(x => x.id === n.goto);
            edge(from, endNode(goal, g.title, n.kind === 'badend-ref' ? 'badend' : 'end'), steps);
        }
    }

    function walk(n, from, steps) {
        const kids = children.get(n.id) || [];
        const opts = kids.filter(k => k.kind === 'option' || k.kind === 'branch');
        const rest = kids.filter(k => !(k.kind === 'option' || k.kind === 'branch'));
        const header = n.kind === 'decision' && CHOICE_HEADER.test(n.title) ? n : null;
        for (const o of opts) {
            const sub = children.get(o.id) || [];
            const st = steps.concat(step(header, o));
            if (sub.length) walk(o, from, st);
            else if (!rest.length) {
                // 沒有後續的選項：事件在這裡結束
                const idx = fnodes.push({ t: o.result ? o.result.replace(/^→\s*/, '') : '事件結束', k: 'stop' }) - 1;
                edge(from, idx, st);
            }
        }
        // 標頭的箭頭或接續區塊：不論選哪個選項都會走到這裡
        for (const c of rest) {
            const st = header && opts.length ? steps.concat({ h: header.title, o: '（任一選項）' }) : steps;
            target(from, c, st);
        }
    }

    walk(anchor, 0, []);

    // 同一個節點走到「事件結束」的多條邊合併成一條，其他選法放在 alts；自己連回自己的邊（內部合流）不畫
    const merged = [];
    const stopEdge = new Map();
    for (const e of fedges) {
        const [from, to, steps = []] = e;
        if (from === to) continue;
        if (fnodes[to].k === 'stop') {
            const k = `${from}|${fnodes[to].t}`;
            if (stopEdge.has(k)) {
                const m = stopEdge.get(k);
                (m[3] = m[3] || [m[2] || []]).push(steps);
                fnodes[to].dead = true;
                continue;
            }
            stopEdge.set(k, e);
        }
        merged.push(e);
    }
    // 拿掉合併後沒人連到的節點，重新編號
    const keep = fnodes.map((n, i) => i === 0 || merged.some(e => e[1] === i));
    const remap = [];
    const out = [];
    fnodes.forEach((n, i) => { if (keep[i]) { remap[i] = out.length; delete n.dead; out.push(n); } });
    return { n: out, ed: merged.filter(e => keep[e[0]]).map(e => [remap[e[0]], remap[e[1]], ...e.slice(2)]) };
}

const pages = pageOrder.map(a => {
    const ends = new Set();
    const p = { title: a.title, url: a.url };
    if (a.condition) p.condition = a.condition;
    if (a.summary) p.summary = a.summary;
    if (a.remark) p.remark = a.remark;
    p.flow = buildFlow(a, ends);
    if (ends.size) p.goals = [...ends];
    return p;
});

const data = {
    source: {
        name: '活俠傳 wiki',
        url: `${SITE}/`,
        repo: 'https://github.com/Mr-Smilin/LoM-wiki',
        commit,
        license: 'CC BY-NC-SA 4.0',
    },
    generatedAt: new Date().toISOString(),
    sections,
    slots: slots.map(s => ({ section: s.section, label: s.label })),
    events: events.map(e => {
        const o = { id: e.id, title: e.title, slot: e.slot, lanes: e.lanes };
        if (e.anchor) o.page = pageIndex.get(e.anchor.id);
        else if (e.url) o.url = e.url;
        if (e.other) o.other = true;
        return o;
    }),
    edges: edgeList,
    pages,
    goals,
};
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(data));
console.log(`寫入 ${path.relative(process.cwd(), OUT)}：${events.length} 個事件、${edgeList.length} 條連線、${pages.length} 個事件頁、${goals.length} 個目標（${romances.length} 份結緣攻略）`);
