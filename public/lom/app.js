// 活俠傳劇情圖：讀取 data/story.json（由 tools/lom-build.js 產生）。
// 事件地圖：一個節點＝一個事件，時間由上往下、每條路線一欄，共用的事件橫跨多欄。
// 事件流程圖：點進事件後，節點＝子事件／戰鬥／結局，邊＝要做的選擇或骰出的結果。
(function () {
    const SVG_NS = 'http://www.w3.org/2000/svg';
    const NODE_H = 40;
    // 事件地圖
    const LANE_W = 200;
    const NODE_W = 176;
    const ROW_H = 58;
    // 流程圖
    const FLOW_W = 184;
    const FLOW_COL = 224;
    const FLOW_ROW = 128;

    const svg = document.getElementById('tree');
    const viewport = document.getElementById('viewport');
    const edgeLayer = document.getElementById('edges');
    const nodeLayer = document.getElementById('nodes');
    const labelLayer = document.getElementById('labels');
    const canvas = document.getElementById('canvas');
    const searchInput = document.getElementById('search');
    const resultList = document.getElementById('results');
    const panel = document.getElementById('panel-body');
    const crumb = document.getElementById('crumb');

    let data = null;
    const eventById = new Map();
    const preds = new Map(); // 事件 id -> 前一個事件們
    const firstEventOfPage = new Map();
    const goalById = new Map();
    const pageGoals = new Map(); // 結局 id -> 會走到它的事件頁

    let mode = 'map';        // 'map' | 'flow'
    let flowPage = null;     // 流程圖的事件頁編號
    let flowFrom = null;     // 從哪個地圖事件點進來
    let selected = null;     // 地圖：事件 id；流程圖：節點編號
    let goal = null;         // 目前選的目標
    const view = { x: 0, y: 0, k: 1 };
    const saved = { x: 0, y: 0, k: 1 }; // 離開地圖時的視角

    // ---------- 小工具 ----------

    function el(tag, attrs, parent) {
        const e = document.createElementNS(SVG_NS, tag);
        for (const k in attrs) e.setAttribute(k, attrs[k]);
        if (parent) parent.appendChild(e);
        return e;
    }

    function h(tag, cls, textContent) {
        const e = document.createElement(tag);
        if (cls) e.className = cls;
        if (textContent != null) e.textContent = textContent;
        return e;
    }

    function clip(text, max) {
        return text.length > max ? text.slice(0, max - 1) + '…' : text;
    }

    function link(url, label) {
        const a = h('a', 's-link', label);
        a.href = url;
        a.target = '_blank';
        a.rel = 'noopener';
        return a;
    }

    function setHash(hash) {
        try { history.replaceState(null, '', hash ? '#' + hash : location.pathname); } catch (e) {}
    }

    const pageOf = ev => (ev.page != null ? data.pages[ev.page] : null);
    const laneNames = ev => ev.other ? ['其他'] : ev.lanes.map(l => data.sections[data.slots[ev.slot].section].lanes[l]);
    const isAllLanes = ev => !ev.other && ev.lanes.length === data.sections[data.slots[ev.slot].section].lanes.length;
    // 邊上要顯示的步驟：拿掉「（任一選項）」和內部跳轉
    const shownSteps = steps => (steps || []).filter(st => st.o !== '（任一選項）' && !/^→/.test(st.o));

    // ---------- 載入 ----------

    function load(d) {
        data = d;
        for (const ev of data.events) {
            eventById.set(ev.id, ev);
            preds.set(ev.id, []);
            if (ev.page != null && !firstEventOfPage.has(ev.page)) firstEventOfPage.set(ev.page, ev.id);
        }
        for (const [a, b] of data.edges) preds.get(b).push(a);
        for (const g of data.goals) goalById.set(g.id, g);
        data.pages.forEach((p, i) => (p.goals || []).forEach(g => {
            if (!pageGoals.has(g)) pageGoals.set(g, []);
            pageGoals.get(g).push(i);
        }));
        buildSearchIndex();
        buildGoalBar();
        layoutMap();

        const src = document.getElementById('source');
        src.textContent = '';
        src.append('資料整理自 ', link(data.source.url, data.source.name), `（${data.source.license}），內容以 wiki 為準。`);
    }

    // ---------- 事件地圖：版面 ----------

    let mapLayout = null;

    function layoutMap() {
        const maxLanes = Math.max(...data.sections.map(s => s.lanes.length));
        const otherX = (maxLanes / 2) * LANE_W + 60;
        const pos = new Map();
        const headers = [];
        const times = [];
        let row = 0;
        let otherRow = 0; // 「其他」欄自己往下排，不撐開主線的間距
        data.sections.forEach((sec, s) => {
            const n = sec.lanes.length;
            const laneX = l => (l - (n - 1) / 2) * LANE_W;
            headers.push({ title: sec.title, row, lanes: sec.lanes.map((name, l) => ({ name, x: laneX(l) })) });
            row += 1.6;
            data.slots.forEach((slot, si) => {
                if (slot.section !== s) return;
                const off = new Array(n).fill(0);
                for (const ev of data.events) {
                    if (ev.slot !== si) continue;
                    if (ev.other) {
                        otherRow = Math.max(otherRow, row);
                        pos.set(ev.id, { x: otherX, y: otherRow++ * ROW_H, w: NODE_W });
                        continue;
                    }
                    const r = Math.max(...ev.lanes.map(l => off[l]));
                    ev.lanes.forEach(l => { off[l] = r + 1; });
                    const xs = ev.lanes.map(laneX);
                    pos.set(ev.id, {
                        x: (Math.min(...xs) + Math.max(...xs)) / 2,
                        y: (row + r) * ROW_H,
                        w: NODE_W + (ev.lanes.length - 1) * LANE_W,
                        laneXs: xs,
                    });
                }
                const used = Math.max(1, ...off);
                times.push({ label: slot.label, y: row * ROW_H });
                row += used + 0.3;
            });
        });
        mapLayout = { pos, headers, times, otherX, left: -(maxLanes / 2) * LANE_W - 20 };
    }

    // ---------- 畫圖 ----------

    function clear() {
        edgeLayer.textContent = '';
        nodeLayer.textContent = '';
        labelLayer.textContent = '';
    }

    function edgeLabel(x, y, text, full, cls) {
        if (!text) return;
        const g = el('g', { class: 'elabel ' + (cls || ''), transform: `translate(${x},${y})` }, labelLayer);
        const t = el('text', { 'text-anchor': 'middle', 'dominant-baseline': 'central' }, g);
        t.textContent = text;
        if (full) el('title', {}, g).textContent = full;
        const w = text.length * 11 + 10;
        g.insertBefore(el('rect', { x: -w / 2, y: -9, width: w, height: 18, rx: 4 }), t);
    }

    function nodeBox(id, x, y, w, title, small, cls, tip) {
        const g = el('g', { class: 'node ' + cls, transform: `translate(${x - w / 2},${y})`, 'data-id': id }, nodeLayer);
        el('rect', { width: w, height: NODE_H, rx: 8 }, g);
        el('title', {}, g).textContent = tip || title;
        const max = Math.floor((w - 16) / 13);
        if (small) {
            el('text', { x: 10, y: 12, class: 'small' }, g).textContent = clip(small, Math.floor((w - 16) / 10));
            el('text', { x: 10, y: 28 }, g).textContent = clip(title, max);
        } else {
            el('text', { x: 10, y: NODE_H / 2 }, g).textContent = clip(title, max);
        }
        return g;
    }

    function curve(x1, y1, x2, y2) {
        const my = (y1 + y2) / 2;
        return `M${x1},${y1} C${x1},${my} ${x2},${my} ${x2},${y2}`;
    }

    function renderMap() {
        clear();
        const { pos, headers, times, otherX, left } = mapLayout;
        const lit = new Set();
        const marks = new Map(); // 事件 id -> 目標步驟編號
        if (selected) {
            const stack = [selected];
            while (stack.length) {
                const id = stack.pop();
                if (lit.has(id)) continue;
                lit.add(id);
                stack.push(...preds.get(id));
            }
        } else if (goal) {
            const steps = goal.steps || [{ no: '', pages: goal.pages || [] }];
            for (const st of steps) {
                for (const p of st.pages) {
                    for (const ev of data.events) {
                        if (ev.page !== p) continue;
                        lit.add(ev.id);
                        if (st.no && !marks.has(ev.id)) marks.set(ev.id, st.no);
                    }
                }
            }
            for (const p of pageGoals.get(goal.id) || []) for (const ev of data.events) if (ev.page === p) lit.add(ev.id);
        }
        svg.classList.toggle('has-path', lit.size > 0);

        for (const hd of headers) {
            const y = hd.row * ROW_H;
            el('text', { x: left - 130, y: y + 14, class: 'sec-title' }, labelLayer).textContent = hd.title;
            for (const ln of hd.lanes) {
                const parts = ln.name.split('・');
                parts.forEach((p, i) => {
                    el('text', { x: ln.x, y: y + 14 + i * 15, class: 'lane-title', 'text-anchor': 'middle' }, labelLayer).textContent = p;
                });
            }
        }
        if (data.events.some(e => e.other)) {
            el('text', { x: otherX, y: 14, class: 'lane-title', 'text-anchor': 'middle' }, labelLayer).textContent = '其他（不在主表／任意時間）';
        }
        let lastTime = '';
        for (const t of times) {
            const [year, md] = t.label.split(' ');
            el('text', { x: left - 130, y: t.y + NODE_H / 2, class: 'time', 'dominant-baseline': 'middle' }, labelLayer).textContent = year !== lastTime ? t.label : md;
            lastTime = year;
        }

        for (const [a, b, label] of data.edges) {
            const pa = pos.get(a), pb = pos.get(b);
            // 起點／終點盡量落在兩個事件共有的路線上
            const shared = (pa.laneXs || [pa.x]).filter(x => (pb.laneXs || [pb.x]).includes(x));
            const xa = shared.length ? (Math.min(...shared) + Math.max(...shared)) / 2 : pa.x;
            const xb = shared.length ? xa : pb.x;
            const on = lit.has(a) && lit.has(b) && selected;
            el('path', { d: curve(xa, pa.y + NODE_H, xb, pb.y), class: 'edge' + (on ? ' on-path' : '') }, edgeLayer);
            if (label) edgeLabel((xa + xb) / 2, (pa.y + NODE_H + pb.y) / 2, clip(label.split('／')[0].split('・').pop(), 12) + (label.includes('／') ? '…' : ''), '路線：' + label, 'route' + (on ? ' on-path' : ''));
        }

        for (const ev of data.events) {
            const p = pos.get(ev.id);
            const page = pageOf(ev);
            let cls = 'kind-event';
            if (!page) cls += ' no-page';
            if (ev.other) cls += ' other';
            if (lit.has(ev.id)) cls += ' on-path';
            if (ev.id === selected) cls += ' selected';
            if (matchIds.has(ev.id)) cls += ' match';
            const branches = page ? page.flow.n.length - 1 : 0;
            const small = (isAllLanes(ev) ? '' : laneNames(ev).map(n => n.split('・').pop()).join('／') + ' ') + (branches ? `${branches} 個分支` : '');
            nodeBox(ev.id, p.x, p.y, p.w, ev.title, small.trim(), cls, ev.title);
            if (marks.has(ev.id)) {
                const g = el('g', { class: 'mark', transform: `translate(${p.x - p.w / 2},${p.y})` }, labelLayer);
                el('circle', { r: 11 }, g);
                el('text', { 'text-anchor': 'middle', 'dominant-baseline': 'central' }, g).textContent = marks.get(ev.id);
            }
        }
        applyView();
    }

    // ---------- 流程圖 ----------

    let flowLayout = null;

    function layoutFlow(page) {
        const { n, ed } = data.pages[page].flow;
        const kids = n.map(() => []);
        const parent = n.map(() => null);
        const parentEdge = n.map(() => null);
        const seen = new Set([0]);
        const queue = [0];
        // 廣度優先建出生成樹，剩下的邊當成「也可以從這裡過來」
        const out = n.map(() => []);
        ed.forEach((e, i) => out[e[0]].push(i));
        while (queue.length) {
            const a = queue.shift();
            for (const i of out[a]) {
                const b = ed[i][1];
                if (seen.has(b)) continue;
                seen.add(b);
                parent[b] = a;
                parentEdge[b] = i;
                kids[a].push(b);
                queue.push(b);
            }
        }
        const pos = [];
        let col = 0;
        const place = (i, depth) => {
            if (!kids[i].length) pos[i] = { x: col++ * FLOW_COL, y: depth * FLOW_ROW };
            else {
                kids[i].forEach(c => place(c, depth + 1));
                pos[i] = { x: (pos[kids[i][0]].x + pos[kids[i][kids[i].length - 1]].x) / 2, y: depth * FLOW_ROW };
            }
        };
        place(0, 0);
        // 沒接上起點的節點（理論上不會有）排在最後
        n.forEach((_, i) => { if (!pos[i]) pos[i] = { x: col++ * FLOW_COL, y: 0 }; });
        flowLayout = { pos, parent, parentEdge };
    }

    function flowPath(i) {
        const path = [i];
        while (flowLayout.parent[path[0]] != null) path.unshift(flowLayout.parent[path[0]]);
        return path;
    }

    const FLOW_KIND = { start: '事件開始', event: '事件', battle: '戰鬥', stop: '結束', end: '結局', badend: '生死簿', page: '接到其他事件' };

    function renderFlow() {
        clear();
        const { n, ed } = data.pages[flowPage].flow;
        const { pos, parentEdge } = flowLayout;
        const onNodes = new Set(selected != null ? flowPath(selected) : []);
        const onEdges = new Set([...onNodes].map(i => parentEdge[i]).filter(i => i != null));
        svg.classList.toggle('has-path', onNodes.size > 0);
        const treeEdge = new Set(parentEdge.filter(i => i != null));

        ed.forEach(([a, b, steps, alts], i) => {
            const pa = pos[a], pb = pos[b];
            const tree = treeEdge.has(i);
            const on = onEdges.has(i);
            el('path', { d: curve(pa.x, pa.y + NODE_H, pb.x, pb.y), class: 'edge' + (tree ? '' : ' extra') + (on ? ' on-path' : '') }, edgeLayer);
            const shown = shownSteps(steps);
            const label = shown.length ? shown[shown.length - 1].o : '';
            const full = shown.map(st => (st.h ? st.h + '：' : '') + st.o).join('\n') + (alts ? `\n（另有 ${alts.length - 1} 種選法也走到這裡）` : '');
            // 標籤放在靠近下一個節點的位置，兄弟分支的標籤才不會擠在一起
            const t = tree ? 0.72 : 0.3;
            const lx = pa.x + (pb.x - pa.x) * (tree ? 0.93 : t);
            const ly = pa.y + NODE_H + (pb.y - pa.y - NODE_H) * t;
            edgeLabel(lx, ly, clip(label + (alts ? ` 等 ${alts.length} 種` : ''), 13), full, on ? 'on-path' : '');
        });

        n.forEach((node, i) => {
            let cls = 'kind-' + (node.k || 'event');
            if (onNodes.has(i)) cls += ' on-path';
            if (i === selected) cls += ' selected';
            if (matchIds.has(`${flowPage}:${i}`)) cls += ' match';
            nodeBox(i, pos[i].x, pos[i].y, FLOW_W, node.t.replace(/^(事件|🆚戰你娘親|🆚決鬥|🆚對決)：/, ''), FLOW_KIND[node.k || 'event'], cls, node.t);
        });
        applyView();
    }

    function render() {
        if (mode === 'map') renderMap();
        else renderFlow();
    }

    // ---------- 右側面板 ----------

    function panelClear() {
        panel.textContent = '';
        panel.scrollTop = 0;
        document.getElementById('panel').scrollTop = 0;
    }

    function info(parent, cls, text) {
        if (text) parent.appendChild(h('div', cls, text));
    }

    function goalChip(id) {
        const g = goalById.get(id);
        const b = h('button', 'chip kind-' + g.kind, g.title);
        b.type = 'button';
        b.addEventListener('click', () => selectGoal(id));
        return b;
    }

    function showIntro() {
        panelClear();
        panel.appendChild(h('p', 'intro', '每個節點是一個事件，時間由上往下排，每條路線一欄。點事件會亮出從開局走到那裡的路線；點「打開事件流程圖」可以看事件裡每個選項、骰子結果會走到哪裡。'));
        panel.appendChild(h('p', 'hint', '想達成某個結局或結緣，可以點上方的結緣攻略，或直接搜尋結局名稱。'));
    }

    function showEvent(ev) {
        panelClear();
        const page = pageOf(ev);
        panel.appendChild(h('div', 'p-kicker', `${data.slots[ev.slot].label}・${laneNames(ev).join('、')}${isAllLanes(ev) && laneNames(ev).length > 1 ? '（各路線共通）' : ''}`));
        panel.appendChild(h('h2', '', ev.title));
        if (page) {
            info(panel, 's-cond', page.condition);
            info(panel, 's-summary', page.summary);
            info(panel, 's-remark', page.remark);
            if (page.flow.n.length > 1) {
                const b = h('button', 'primary', `打開事件流程圖（${page.flow.n.length - 1} 個分支）`);
                b.type = 'button';
                b.addEventListener('click', () => openFlow(ev.page, ev.id));
                panel.appendChild(b);
            }
            if (page.goals) {
                panel.appendChild(h('h3', '', '可能走到的結局'));
                const box = h('div', 'chips');
                page.goals.forEach(g => box.appendChild(goalChip(g)));
                panel.appendChild(box);
            }
            panel.appendChild(link(page.url, '查看 wiki 原文 ↗'));
        } else {
            panel.appendChild(h('p', 's-remark', 'wiki 上這個事件還沒有詳細頁面。'));
            if (ev.url) panel.appendChild(link(ev.url, '查看 wiki ↗'));
        }

        // 怎麼走到這裡：所有可能經過的前置事件，依時間排序
        const anc = new Set();
        const stack = [...preds.get(ev.id)];
        while (stack.length) {
            const id = stack.pop();
            if (anc.has(id)) continue;
            anc.add(id);
            stack.push(...preds.get(id));
        }
        if (anc.size) {
            panel.appendChild(h('h3', '', `怎麼走到這裡（經過 ${anc.size} 個事件）`));
            const ol = h('ol', 'steps');
            for (const e of data.events) {
                if (!anc.has(e.id)) continue;
                const li = h('li');
                const t = h('span', 's-title', e.title);
                t.addEventListener('click', () => selectEvent(e.id));
                li.appendChild(h('span', 's-time', data.slots[e.slot].label.split(' ').pop() + ' '));
                li.appendChild(t);
                if (!isAllLanes(e)) li.appendChild(h('span', 'tag', laneNames(e).map(n => n.split('・').pop()).join('／')));
                ol.appendChild(li);
            }
            panel.appendChild(ol);
        }
    }

    function stepText(st) {
        const box = h('div', 'step');
        if (st.h) box.appendChild(h('div', 's-head', st.h.replace(/^(選擇|選項)：/, '選擇：')));
        box.appendChild(h('div', 's-opt', st.o));
        info(box, 's-effects', st.e);
        info(box, 's-result', st.r);
        return box;
    }

    function showFlowNode(i) {
        panelClear();
        const page = data.pages[flowPage];
        const { n, ed } = page.flow;
        const node = n[i];
        panel.appendChild(h('div', 'p-kicker', `${page.title}・${FLOW_KIND[node.k || 'event']}`));
        panel.appendChild(h('h2', '', node.t));
        info(panel, 's-cond', node.c);
        info(panel, 's-effects', node.e);
        info(panel, 's-summary', node.s);
        info(panel, 's-remark', node.m);
        if (node.goal) {
            const box = h('div', 'chips');
            box.appendChild(goalChip(node.goal));
            panel.appendChild(box);
        }
        if (node.page != null) {
            const b = h('button', 'primary', `前往「${data.pages[node.page].title}」`);
            b.type = 'button';
            b.addEventListener('click', () => openFlow(node.page, firstEventOfPage.get(node.page)));
            panel.appendChild(b);
        }

        const path = flowPath(i);
        if (path.length > 1) {
            panel.appendChild(h('h3', '', '怎麼觸發'));
            const ol = h('ol', 'route');
            path.forEach((ni, k) => {
                const li = h('li');
                const t = h('div', 's-title', n[ni].t);
                t.addEventListener('click', () => selectFlowNode(ni));
                li.appendChild(t);
                const next = path[k + 1];
                if (next != null) {
                    const e = ed[flowLayout.parentEdge[next]];
                    const steps = shownSteps(e[2]);
                    if (steps.length) steps.forEach(st => li.appendChild(stepText(st)));
                    else li.appendChild(h('div', 's-auto', '自動接續'));
                    if (e[3]) li.appendChild(h('div', 's-remark', `另有 ${e[3].length - 1} 種選法也會走到下一步`));
                }
                ol.appendChild(li);
            });
            panel.appendChild(ol);
        }
        // 其他可以走到這個節點的路徑
        const others = ed.filter((e, k) => e[1] === i && k !== flowLayout.parentEdge[i]);
        if (others.length) {
            panel.appendChild(h('h3', '', '也可以從這裡過來'));
            const ul = h('ul', 'route');
            others.forEach(e => {
                const li = h('li');
                const t = h('div', 's-title', n[e[0]].t);
                t.addEventListener('click', () => selectFlowNode(e[0]));
                li.appendChild(t);
                shownSteps(e[2]).forEach(st => li.appendChild(stepText(st)));
                ul.appendChild(li);
            });
            panel.appendChild(ul);
        }
        panel.appendChild(link(page.url, '查看 wiki 原文 ↗'));
    }

    function showGoal(g) {
        panelClear();
        panel.appendChild(h('div', 'p-kicker', { romance: '結緣攻略', end: '結局・汗青書', badend: '猝死結局・生死簿' }[g.kind]));
        panel.appendChild(h('h2', '', g.title));
        if (g.steps) {
            panel.appendChild(h('p', 'hint', '地圖上有編號的事件就是攻略的各個步驟。'));
            const ol = h('ol', 'goal-steps');
            for (const st of g.steps) {
                const li = h('li');
                li.appendChild(h('div', 's-time', st.time));
                const t = h('div', 's-title', st.event);
                if (st.pages.length) {
                    const evId = firstEventOfPage.get(st.pages[0]);
                    if (evId) t.addEventListener('click', () => selectEvent(evId));
                    else t.addEventListener('click', () => openFlow(st.pages[0], null));
                    t.classList.add('clickable');
                }
                li.appendChild(t);
                info(li, 's-todo', st.todo);
                info(li, 's-remark', st.note);
                ol.appendChild(li);
            }
            panel.appendChild(ol);
        } else {
            info(panel, 's-summary', g.summary);
            if (g.condition) {
                panel.appendChild(h('h3', '', '條件與流程'));
                info(panel, 's-todo', g.condition);
            }
            const related = [...new Set([...(g.pages || []), ...(pageGoals.get(g.id) || [])])];
            if (related.length) {
                panel.appendChild(h('h3', '', '相關事件'));
                const box = h('div', 'chips');
                for (const p of related) {
                    const b = h('button', 'chip', data.pages[p].title);
                    b.type = 'button';
                    b.addEventListener('click', () => {
                        const evId = firstEventOfPage.get(p);
                        if ((pageGoals.get(g.id) || []).includes(p)) {
                            const node = data.pages[p].flow.n.findIndex(x => x.goal === g.id);
                            openFlow(p, evId, node >= 0 ? node : null);
                        } else if (evId) selectEvent(evId);
                        else openFlow(p, null);
                    });
                    box.appendChild(b);
                }
                panel.appendChild(box);
            }
        }
        panel.appendChild(link(g.url, '查看 wiki 原文 ↗'));
    }

    // ---------- 狀態切換 ----------

    function setCrumb() {
        crumb.hidden = mode !== 'flow';
        if (mode !== 'flow') return;
        document.getElementById('crumb-title').textContent = data.pages[flowPage].title;
    }

    function selectEvent(id, { center = true } = {}) {
        if (mode !== 'map') backToMap(false);
        goal = null;
        selected = id;
        updateGoalBar();
        renderMap();
        showEvent(eventById.get(id));
        if (center) {
            view.k = Math.max(view.k, 0.85);
            const p = mapLayout.pos.get(id);
            centerOn(p.x, p.y + NODE_H / 2);
        }
        setHash(id);
    }

    function selectGoal(id) {
        const g = goalById.get(id);
        if (!g) return;
        if (mode !== 'map') backToMap(false);
        goal = g;
        selected = null;
        updateGoalBar();
        renderMap();
        showGoal(g);
        // 移到第一個有標出來的事件
        const firstPage = g.steps ? (g.steps.find(st => st.pages.length) || { pages: [] }).pages[0] : (g.pages || [])[0];
        const evId = firstPage != null && firstEventOfPage.get(firstPage);
        if (evId) {
            view.k = Math.max(Math.min(view.k, 0.7), 0.5);
            const p = mapLayout.pos.get(evId);
            // 寬的共通事件只對準左側（編號標在左上角）
            centerOn(p.x - p.w / 2 + NODE_W / 2, p.y + NODE_H / 2 + 120);
        }
        setHash('g-' + id);
    }

    function openFlow(page, fromEvent, node = null) {
        if (mode === 'map') Object.assign(saved, view);
        mode = 'flow';
        flowPage = page;
        flowFrom = fromEvent;
        selected = null;
        layoutFlow(page);
        setCrumb();
        if (node != null) selectFlowNode(node);
        else {
            renderFlow();
            showFlowNode(0);
            view.k = 0.9;
            view.x = svg.getBoundingClientRect().width / 2 - flowLayout.pos[0].x * view.k;
            view.y = 30;
            applyView();
            setHash(`f-${page}`);
        }
    }

    function selectFlowNode(i) {
        selected = i;
        renderFlow();
        showFlowNode(i);
        view.k = Math.max(view.k, 0.75);
        centerOn(flowLayout.pos[i].x, flowLayout.pos[i].y + NODE_H / 2);
        setHash(`f-${flowPage}-${i}`);
    }

    function backToMap(restore = true) {
        mode = 'map';
        setCrumb();
        selected = null;
        if (restore) {
            Object.assign(view, saved);
            if (flowFrom) selectEvent(flowFrom, { center: false });
            else { renderMap(); showIntro(); setHash(''); }
        }
    }

    document.getElementById('crumb-back').addEventListener('click', () => backToMap());

    // ---------- 結緣攻略快捷鍵 ----------

    function buildGoalBar() {
        const bar = document.getElementById('goalbar');
        bar.textContent = '';
        bar.appendChild(h('span', 'goal-label', '結緣攻略'));
        for (const g of data.goals) {
            if (g.kind !== 'romance') continue;
            const b = h('button', 'chip kind-romance', g.title.replace('結緣攻略', ''));
            b.type = 'button';
            b.dataset.goal = g.id;
            b.addEventListener('click', () => (goal && goal.id === g.id ? clearGoal() : selectGoal(g.id)));
            bar.appendChild(b);
        }
    }

    function updateGoalBar() {
        document.querySelectorAll('#goalbar [data-goal]').forEach(b => b.classList.toggle('active', !!goal && goal.id === b.dataset.goal));
    }

    function clearGoal() {
        goal = null;
        updateGoalBar();
        renderMap();
        showIntro();
        setHash('');
    }

    // ---------- 搜尋 ----------

    let index = [];
    let matchIds = new Set();
    let activeResult = -1;

    function buildSearchIndex() {
        index = [];
        for (const g of data.goals) {
            index.push({ type: 'goal', id: g.id, title: g.title, sub: { romance: '結緣攻略', end: '結局', badend: '生死簿' }[g.kind], hay: [g.title, g.summary, g.kind === 'romance' ? '結緣 攻略' : '結局'].join(' ') });
        }
        const seenPage = new Set();
        for (const ev of data.events) {
            const page = pageOf(ev);
            // 每月例會這類重複事件只列第一次
            if (ev.page != null && seenPage.has(ev.page)) continue;
            if (ev.page != null) seenPage.add(ev.page);
            index.push({ type: 'event', id: ev.id, title: ev.title, sub: data.slots[ev.slot].label + (isAllLanes(ev) ? '' : '・' + laneNames(ev).join('、')), hay: [ev.title, page && page.condition, page && page.summary].join(' ') });
        }
        data.pages.forEach((p, pi) => {
            p.flow.ed.forEach(([a, b, steps]) => {
                const target = p.flow.n[b];
                const opts = shownSteps(steps).map(st => st.o + ' ' + (st.e || '') + ' ' + (st.r || '')).join(' ');
                index.push({ type: 'flow', page: pi, node: b, title: target.t, sub: `${p.title} › ${shownSteps(steps).map(st => st.o).slice(-2).join(' › ')}`, hay: [target.t, opts, target.e, target.s].join(' ') });
            });
        });
        for (const it of index) it.hay = it.hay.toLowerCase();
    }

    function search(q) {
        const terms = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
        if (!terms.length) return [];
        const rank = { goal: 0, event: 1, flow: 2 };
        return index
            .filter(it => terms.every(t => it.hay.includes(t)))
            .map(it => ({ it, score: rank[it.type] * 2 + (terms.every(t => it.title.toLowerCase().includes(t)) ? 0 : 1) }))
            .sort((a, b) => a.score - b.score || a.it.title.length - b.it.title.length)
            .map(x => x.it);
    }

    function highlight(text, q) {
        const frag = document.createDocumentFragment();
        const terms = q.trim().split(/\s+/).filter(Boolean).map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
        if (!terms.length) { frag.append(text); return frag; }
        text.split(new RegExp(`(${terms.join('|')})`, 'gi')).forEach((part, i) => {
            if (i % 2) frag.appendChild(h('mark', '', part));
            else if (part) frag.append(part);
        });
        return frag;
    }

    function updateResults() {
        const q = searchInput.value;
        const hits = search(q);
        matchIds = new Set(hits.map(it => it.type === 'event' ? it.id : it.type === 'flow' ? `${it.page}:${it.node}` : null).filter(Boolean));
        render();
        resultList.textContent = '';
        activeResult = -1;
        if (!q.trim()) { resultList.hidden = true; return; }
        if (!hits.length) resultList.appendChild(h('li', 'empty', '找不到符合的事件或選項'));
        if (hits.length > 60) resultList.appendChild(h('li', 'empty', `共 ${hits.length} 筆，只列出前 60 筆，可以多打幾個字縮小範圍`));
        const TYPE = { goal: '目標', event: '事件', flow: '選項' };
        hits.slice(0, 60).forEach((it, i) => {
            const li = h('li');
            li.dataset.i = i;
            const t = h('div', 'r-title');
            t.appendChild(h('span', 'r-type type-' + it.type, TYPE[it.type]));
            t.appendChild(highlight(it.title, q));
            const s = h('div', 'r-sub');
            s.appendChild(highlight(it.sub || '', q));
            li.append(t, s);
            li.addEventListener('mousedown', e => {
                e.preventDefault();
                pick(it);
            });
            resultList.appendChild(li);
        });
        resultList._hits = hits;
        resultList.hidden = false;
    }

    function pick(it) {
        resultList.hidden = true;
        searchInput.blur();
        if (it.type === 'goal') selectGoal(it.id);
        else if (it.type === 'event') selectEvent(it.id);
        else openFlow(it.page, firstEventOfPage.get(it.page) || null, it.node);
    }

    let searchTimer = 0;
    searchInput.addEventListener('input', () => {
        clearTimeout(searchTimer);
        searchTimer = setTimeout(updateResults, 150);
    });
    searchInput.addEventListener('focus', () => { if (searchInput.value.trim()) resultList.hidden = false; });
    searchInput.addEventListener('blur', () => { resultList.hidden = true; });
    searchInput.addEventListener('keydown', e => {
        const items = [...resultList.querySelectorAll('li[data-i]')];
        if (!items.length) return;
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            activeResult = (activeResult + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
            items.forEach((li, i) => li.classList.toggle('active', i === activeResult));
            items[activeResult].scrollIntoView({ block: 'nearest' });
        } else if (e.key === 'Enter') {
            pick(resultList._hits[+items[Math.max(activeResult, 0)].dataset.i]);
        } else if (e.key === 'Escape') {
            resultList.hidden = true;
        }
    });

    // ---------- 平移與縮放 ----------

    function applyView() {
        viewport.setAttribute('transform', `translate(${view.x},${view.y}) scale(${view.k})`);
    }

    function zoomAt(factor, cx, cy) {
        const k = Math.min(2.5, Math.max(0.12, view.k * factor));
        view.x = cx - (cx - view.x) * (k / view.k);
        view.y = cy - (cy - view.y) * (k / view.k);
        view.k = k;
        applyView();
    }

    function centerOn(x, y) {
        const r = svg.getBoundingClientRect();
        view.x = r.width / 2 - x * view.k;
        view.y = r.height / 2 - y * view.k;
        applyView();
    }

    function fit() {
        const box = viewport.getBBox();
        const r = svg.getBoundingClientRect();
        view.k = Math.min(1.2, Math.max(0.12, Math.min((r.width - 40) / box.width, (r.height - 40) / box.height)));
        view.x = (r.width - box.width * view.k) / 2 - box.x * view.k;
        view.y = (r.height - box.height * view.k) / 2 - box.y * view.k;
        applyView();
    }

    const pointers = new Map();
    let dragMoved = 0;
    let pinchDist = 0;

    canvas.addEventListener('pointerdown', e => {
        pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
        dragMoved = 0;
        if (pointers.size === 2) {
            const [a, b] = [...pointers.values()];
            pinchDist = Math.hypot(a.x - b.x, a.y - b.y);
        }
        canvas.setPointerCapture(e.pointerId);
        canvas.classList.add('dragging');
    });

    canvas.addEventListener('pointermove', e => {
        const prev = pointers.get(e.pointerId);
        if (!prev) return;
        const cur = { x: e.clientX, y: e.clientY };
        if (pointers.size === 1) {
            view.x += cur.x - prev.x;
            view.y += cur.y - prev.y;
            dragMoved += Math.abs(cur.x - prev.x) + Math.abs(cur.y - prev.y);
            applyView();
        }
        pointers.set(e.pointerId, cur);
        if (pointers.size === 2) {
            const [a, b] = [...pointers.values()];
            const d = Math.hypot(a.x - b.x, a.y - b.y);
            const r = svg.getBoundingClientRect();
            if (pinchDist) zoomAt(d / pinchDist, (a.x + b.x) / 2 - r.left, (a.y + b.y) / 2 - r.top);
            pinchDist = d;
            dragMoved = Infinity;
        }
    });

    const endPointer = e => {
        pointers.delete(e.pointerId);
        if (pointers.size < 2) pinchDist = 0;
        if (!pointers.size) canvas.classList.remove('dragging');
    };
    canvas.addEventListener('pointerup', endPointer);
    canvas.addEventListener('pointercancel', endPointer);

    // pointer capture 會把 click 的 target 改成 canvas，所以用座標找出實際點到的元素
    canvas.addEventListener('click', e => {
        if (dragMoved > 5) return;
        const hit = document.elementFromPoint(e.clientX, e.clientY);
        const node = hit && hit.closest('.node');
        if (!node) return;
        if (mode === 'map') selectEvent(node.dataset.id, { center: false });
        else selectFlowNode(+node.dataset.id);
    });

    canvas.addEventListener('dblclick', e => {
        if (mode !== 'map') return;
        const hit = document.elementFromPoint(e.clientX, e.clientY);
        const node = hit && hit.closest('.node');
        const ev = node && eventById.get(node.dataset.id);
        if (ev && ev.page != null) openFlow(ev.page, ev.id);
    });

    // 滾輪捲動畫面；按住 Ctrl（或觸控板雙指縮放）時縮放
    canvas.addEventListener('wheel', e => {
        e.preventDefault();
        if (e.ctrlKey || e.metaKey) {
            const r = svg.getBoundingClientRect();
            zoomAt(Math.exp(-e.deltaY * 0.01), e.clientX - r.left, e.clientY - r.top);
        } else {
            view.x -= e.shiftKey ? e.deltaY : e.deltaX;
            view.y -= e.shiftKey ? 0 : e.deltaY;
            applyView();
        }
    }, { passive: false });

    const zoomCenter = f => {
        const r = svg.getBoundingClientRect();
        zoomAt(f, r.width / 2, r.height / 2);
    };
    document.getElementById('zoom-in').addEventListener('click', () => zoomCenter(1.25));
    document.getElementById('zoom-out').addEventListener('click', () => zoomCenter(0.8));
    document.getElementById('zoom-fit').addEventListener('click', fit);

    // ---------- 啟動 ----------

    function route() {
        const m = location.hash.match(/^#([\w-]+)$/);
        const hash = m ? m[1] : '';
        let f;
        if (eventById.has(hash)) return selectEvent(hash);
        if (hash.startsWith('g-') && goalById.has(hash.slice(2))) return selectGoal(hash.slice(2));
        if ((f = hash.match(/^f-(\d+)(?:-(\d+))?$/)) && data.pages[+f[1]]) {
            return openFlow(+f[1], firstEventOfPage.get(+f[1]) || null, f[2] != null && data.pages[+f[1]].flow.n[+f[2]] ? +f[2] : null);
        }
        renderMap();
        showIntro();
        // 從第一年開頭看起
        const r = svg.getBoundingClientRect();
        view.k = Math.min(0.85, r.width / (mapLayout.otherX + NODE_W / 2 - mapLayout.left + 160));
        view.x = 12 - (mapLayout.left - 140) * view.k;
        view.y = 20;
        applyView();
    }

    fetch('data/story.json')
        .then(r => r.json())
        .then(d => {
            load(d);
            route();
        })
        .catch(err => {
            const banner = document.getElementById('banner');
            banner.textContent = '劇情資料載入失敗：' + err.message;
            banner.hidden = false;
        });
})();
