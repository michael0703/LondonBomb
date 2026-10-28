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
        if (fs.existsSync(path.join(DOCS, page))) {
            const md = read(page);
            const m = md.match(/## 條件與流程([\s\S]*?)(?=\n## |$)/);
            if (m) condition = text(m[1]).slice(0, 1200);
        }
        endNodes.set(no, add(ends, `結局 ${no}：${name}`, {
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

// ---------- 主支線簡易表格：年 › 月旬 › 路線 › 事件 ----------

const MONTHS = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九', '十', '十一', '十二'];
const XUN = { 上: 1, 中: 2, 下: 3 };

const eventFiles = new Map(); // slug -> 是否已放入樹
for (const dir of ['simple', 'detailed_description']) {
    for (const f of fs.readdirSync(path.join(DOCS, 'event', dir))) {
        if (f.endsWith('.md')) eventFiles.set(`${dir}/${f.slice(0, -3)}`, false);
    }
}
const pendingEvents = []; // [eventNode, slug]，等全部事件節點都建好後再展開（才能跨事件跳轉）
const placed = new Map(); // slug -> eventNode

function addEventLinks(parent, html) {
    const lines = html.split(/<br\s*\/?>|\n/i).map(s => s.trim()).filter(Boolean);
    for (const line of lines) {
        const link = line.match(/\[([^\]]+)\]\(([^)]+)\)/);
        const name = text(link ? link[1] : line);
        if (!name || name === '-') continue;
        if (link && /^\/event\/(simple|detailed_description)\//.test(link[2])) {
            const slug = decodeURIComponent(link[2].replace(/^\/event\//, '').replace(/#.*$/, ''));
            if (placed.has(slug)) {
                add(parent, `→ ${name}`, { kind: 'ref', goto: placed.get(slug).id });
                continue;
            }
            const ev = add(parent, name, { kind: 'event', url: eventUrl(slug) });
            if (eventFiles.has(slug)) {
                eventFiles.set(slug, true);
                pendingEvents.push([ev, slug]);
            }
            placed.set(slug, ev);
            eventIndex.set(name, ev);
        } else if (link) {
            const url = /^https?:/.test(link[2]) ? link[2] : `${SITE}${link[2].replace(/#.*$/, '')}.html${(link[2].match(/#.*$/) || [''])[0]}`;
            add(parent, name, { kind: 'event', url });
        } else {
            add(parent, name, { kind: 'event', summary: '（wiki 尚無此事件的詳細頁面）' });
        }
    }
}

function buildTimeline(root) {
    const md = read('event/story-simple-table.md');
    const sections = md.split(/\n## /).slice(1);
    for (const sec of sections) {
        const title = sec.split('\n')[0].trim();
        if (title === '備註') continue;
        const tableHtml = (sec.match(/<table[\s\S]*?<\/table>/i) || [])[0];
        if (!tableHtml) continue;
        const yearNode = add(root, title.replace(/:\s*/, '：'), { kind: 'year' });
        const { rows, grid } = parseTable(tableHtml);
        const headerRows = rows.filter(r => r.length && r.every(c => c.header)).length;

        if (title === '任意時間') {
            for (const row of rows) for (const cell of row) addEventLinks(yearNode, cell.html.includes('](') ? cell.html : text(cell.html));
            continue;
        }

        // 欄位名稱：多層表頭從上到下串起來
        const width = Math.max(...grid.map(r => r.length));
        const colName = [];
        for (let c = 0; c < width; c++) {
            const parts = [];
            for (let r = 0; r < headerRows; r++) {
                const cell = grid[r] && grid[r][c];
                if (cell) {
                    const t = text(cell.html).replace(/\n/g, '');
                    if (t && parts[parts.length - 1] !== t) parts.push(t);
                }
            }
            colName[c] = parts.join('・');
        }

        const byMonth = colName[1] === '上旬'; // 第一年型：列＝月份、欄＝旬
        let monthText = '';
        for (let r = headerRows; r < grid.length; r++) {
            const g = grid[r];
            if (!g || !g.length) continue;
            monthText = text(g[0].html).replace(/月$/, '') || monthText;
            if (byMonth) {
                for (let c = 1; c < g.length; c++) {
                    if (!g[c] || !g[c].origin) continue;
                    const h = g[c].html;
                    if (text(h) === '-' || !text(h)) continue;
                    const slot = add(yearNode, `${monthText}月${colName[c]}`, { kind: 'slot' });
                    addEventLinks(slot, h);
                }
            } else {
                if (!g[1]) continue; // rowspan 超出表格底部留下的空列
                const xun = text(g[1].html);
                const routeCols = colName.length - 2;
                let slot = null;
                for (let c = 2; c < g.length; c++) {
                    const cell = g[c];
                    if (!cell || !cell.origin) continue;
                    if (text(cell.html) === '-' || !text(cell.html)) continue;
                    slot = slot || add(yearNode, `${monthText}月${xun}旬`, { kind: 'slot' });
                    let parent = slot;
                    if (cell.span < routeCols) {
                        const names = colName.slice(c, c + cell.span);
                        parent = add(slot, names.join('／'), { kind: 'route', summary: `路線：${names.join('、')}` });
                    }
                    addEventLinks(parent, cell.html);
                }
            }
        }
    }

    // 表格沒列到的事件頁，依檔名（年-月-旬）放到對應時間下
    // 詳細篇是簡易事件的整理，沒被表格連到就不另外列
    const extra = [...eventFiles].filter(([slug, used]) => !used && slug.startsWith('simple/')).map(([slug]) => slug).sort();
    if (extra.length) {
        const other = add(root, '其他事件（表格未列）', { kind: 'year', summary: 'wiki 有事件頁，但主支線簡易表格沒有列出的事件，依檔名的時間排序。' });
        for (const slug of extra) {
            const m = slug.replace(/^simple\//, '').match(/^(\d+)-(\d+)-(\d+)-(.+)$/);
            const name = m ? m[4] : slug;
            const period = m && +m[1] ? `第${MONTHS[+m[1]]}年${MONTHS[+m[2]]}月${Object.keys(XUN)[+m[3] - 1] || ''}旬` : '';
            const ev = add(other, name, { kind: 'event', period, url: eventUrl(slug) });
            placed.set(slug, ev);
            if (!eventIndex.has(name)) eventIndex.set(name, ev);
            pendingEvents.push([ev, slug]);
        }
    }
}

// ---------- main ----------

const root = add(null, '活俠傳', { kind: 'root', summary: '劇情分支總覽。資料來自活俠傳 wiki。', url: `${SITE}/` });
const timelineRoot = add(root, '劇情時間線', { kind: 'group', url: `${SITE}/event/story-simple-table.html` });
buildEndings(root);
buildTimeline(timelineRoot);

for (const [ev, slug] of pendingEvents) {
    const md = read(`event/${slug}.md`);
    const t = frontmatterTitle(md);
    if (t && t !== ev.title && !ev.title.startsWith('→')) ev.title = t;
    buildEvent(ev, md);
}

// 補上每個節點的時間：沿著祖先找年與月旬
const byId = new Map(nodes.map(n => [n.id, n]));
for (const n of nodes) {
    if (n.kind !== 'event' || n.period) continue;
    let p = byId.get(n.parent);
    let slot = '', year = '';
    while (p) {
        if (p.kind === 'slot' && !slot) slot = p.title;
        if (p.kind === 'year') year = p.title;
        p = byId.get(p.parent);
    }
    if (year || slot) n.period = [year, slot].filter(Boolean).join(' ');
}

const kinds = {};
for (const n of nodes) kinds[n.kind] = (kinds[n.kind] || 0) + 1;

const data = {
    source: {
        name: '活俠傳 wiki',
        url: `${SITE}/`,
        repo: 'https://github.com/Mr-Smilin/LoM-wiki',
        commit,
        license: 'CC BY-NC-SA 4.0',
    },
    note: '資料整理自活俠傳 wiki（CC BY-NC-SA 4.0），內容以 wiki 為準。',
    generatedAt: new Date().toISOString(),
    nodes,
};
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(data));
console.log(`寫入 ${path.relative(process.cwd(), OUT)}：${nodes.length} 個節點`, kinds);
