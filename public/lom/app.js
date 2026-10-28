// 活俠傳劇情樹：讀取 data/story.json，畫成由左到右的樹，點節點顯示從開局到該節點的路線。
(function () {
    const NODE_W = 172;
    const NODE_H = 42;
    const COL_W = NODE_W + 64;
    const ROW_H = NODE_H + 16;
    const SVG_NS = 'http://www.w3.org/2000/svg';

    const svg = document.getElementById('tree');
    const viewport = document.getElementById('viewport');
    const edgeLayer = document.getElementById('edges');
    const nodeLayer = document.getElementById('nodes');
    const canvas = document.getElementById('canvas');
    const searchInput = document.getElementById('search');
    const resultList = document.getElementById('results');

    const byId = new Map();
    let roots = [];
    const collapsed = new Set();
    let selectedId = null;
    let matchIds = new Set();
    const view = { x: 40, y: 40, k: 1 };

    // ---------- data ----------

    function loadData(data) {
        for (const n of data.nodes) {
            byId.set(n.id, Object.assign({}, n, { children: [] }));
        }
        for (const n of byId.values()) {
            const p = n.parent != null ? byId.get(n.parent) : null;
            if (p) p.children.push(n);
            else roots.push(n);
        }
        if (data.demo || data.note) {
            const banner = document.getElementById('banner');
            banner.textContent = data.note || '目前顯示的是示範資料。';
            banner.hidden = false;
        }
    }

    function pathTo(id) {
        const path = [];
        let n = byId.get(id);
        while (n) {
            path.unshift(n);
            n = n.parent != null ? byId.get(n.parent) : null;
        }
        return path;
    }

    // ---------- layout ----------

    // 葉節點依序往下排，父節點置於子節點中間。
    function layout() {
        let row = 0;
        const place = (n, depth) => {
            n.depth = depth;
            const kids = collapsed.has(n.id) ? [] : n.children;
            if (!kids.length) {
                n.row = row++;
            } else {
                kids.forEach(c => place(c, depth + 1));
                n.row = (kids[0].row + kids[kids.length - 1].row) / 2;
            }
        };
        roots.forEach(r => place(r, 0));
    }

    function visibleNodes() {
        const out = [];
        const walk = n => {
            out.push(n);
            if (!collapsed.has(n.id)) n.children.forEach(walk);
        };
        roots.forEach(walk);
        return out;
    }

    const nx = n => n.depth * COL_W;
    const ny = n => n.row * ROW_H;

    function el(tag, attrs, parent) {
        const e = document.createElementNS(SVG_NS, tag);
        for (const k in attrs) e.setAttribute(k, attrs[k]);
        if (parent) parent.appendChild(e);
        return e;
    }

    function clip(text, max) {
        return text.length > max ? text.slice(0, max - 1) + '…' : text;
    }

    function render() {
        layout();
        edgeLayer.textContent = '';
        nodeLayer.textContent = '';
        const onPath = new Set(selectedId ? pathTo(selectedId).map(n => n.id) : []);
        svg.classList.toggle('has-path', onPath.size > 0);

        for (const n of visibleNodes()) {
            const x = nx(n), y = ny(n);
            if (!collapsed.has(n.id)) {
                for (const c of n.children) {
                    const x1 = x + NODE_W, y1 = y + NODE_H / 2;
                    const x2 = nx(c), y2 = ny(c) + NODE_H / 2;
                    const mx = (x1 + x2) / 2;
                    el('path', {
                        d: `M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`,
                        class: 'edge' + (onPath.has(c.id) ? ' on-path' : ''),
                    }, edgeLayer);
                }
            }

            let cls = 'node';
            if (onPath.has(n.id)) cls += ' on-path';
            if (n.id === selectedId) cls += ' selected';
            if (matchIds.has(n.id)) cls += ' match';
            const g = el('g', { class: cls, transform: `translate(${x},${y})`, 'data-id': n.id }, nodeLayer);
            el('rect', { width: NODE_W, height: NODE_H, rx: 8 }, g);
            const tip = el('title', {}, g);
            tip.textContent = n.title + (n.choice ? `\n選擇：${n.choice}` : '');
            if (n.period) {
                el('text', { x: 10, y: 12, class: 'period' }, g).textContent = clip(n.period, 18);
                el('text', { x: 10, y: 28 }, g).textContent = clip(n.title, 11);
            } else {
                el('text', { x: 10, y: NODE_H / 2 }, g).textContent = clip(n.title, 11);
            }

            if (n.children.length) {
                const t = el('g', { class: 'toggle', transform: `translate(${x + NODE_W + 10},${y + NODE_H / 2})`, 'data-toggle': n.id }, nodeLayer);
                el('circle', { r: 8 }, t);
                el('text', {}, t).textContent = collapsed.has(n.id) ? '+' : '−';
            }
        }
        applyView();
    }

    // ---------- selection & route panel ----------

    function select(id, { center = true } = {}) {
        if (!byId.has(id)) return;
        selectedId = id;
        const path = pathTo(id);
        // 確保路線上的節點都是展開的
        path.slice(0, -1).forEach(n => collapsed.delete(n.id));
        render();
        showRoute(path);
        if (center) centerOn(byId.get(id));
        try { history.replaceState(null, '', '#node=' + encodeURIComponent(id)); } catch (e) {}
    }

    function showRoute(path) {
        const target = path[path.length - 1];
        document.getElementById('panel-empty').hidden = true;
        document.getElementById('route').hidden = false;
        document.getElementById('route-title').textContent = target.title;
        document.getElementById('route-meta').textContent =
            `共 ${path.length} 步` + (target.children.length ? `・之後有 ${target.children.length} 個分支` : '・路線終點');

        const steps = document.getElementById('steps');
        steps.textContent = '';
        path.forEach((n, i) => {
            const li = document.createElement('li');
            if (i === path.length - 1) li.className = 'current';
            const add = (cls, text, tag = 'div') => {
                const d = document.createElement(tag);
                d.className = cls;
                d.textContent = text;
                li.appendChild(d);
                return d;
            };
            if (n.period) add('s-period', n.period);
            add('s-title', n.title).addEventListener('click', () => select(n.id));
            if (n.choice) add('s-choice', n.choice);
            if (n.condition) add('s-cond', n.condition);
            if (n.summary) add('s-summary', n.summary);
            if (n.url) {
                const a = add('s-link', '查看 wiki 原文 ↗', 'a');
                a.href = n.url;
                a.target = '_blank';
                a.rel = 'noopener';
            }
            steps.appendChild(li);
        });
    }

    // ---------- search ----------

    const FIELDS = ['title', 'choice', 'condition', 'summary', 'period'];
    let activeResult = -1;

    function search(q) {
        q = q.trim().toLowerCase();
        if (!q) return [];
        const terms = q.split(/\s+/);
        const hits = [];
        for (const n of byId.values()) {
            const hay = FIELDS.map(f => n[f] || '').join(' ').toLowerCase();
            if (terms.every(t => hay.includes(t))) {
                // 標題命中的排前面
                const score = terms.some(t => n.title.toLowerCase().includes(t)) ? 0 : 1;
                hits.push({ n, score });
            }
        }
        hits.sort((a, b) => a.score - b.score);
        return hits.map(h => h.n);
    }

    function highlight(text, q) {
        const frag = document.createDocumentFragment();
        const terms = q.trim().split(/\s+/).filter(Boolean).map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
        if (!terms.length) { frag.append(text); return frag; }
        const re = new RegExp(`(${terms.join('|')})`, 'gi');
        text.split(re).forEach((part, i) => {
            if (i % 2) {
                const m = document.createElement('mark');
                m.textContent = part;
                frag.appendChild(m);
            } else if (part) {
                frag.append(part);
            }
        });
        return frag;
    }

    function updateResults() {
        const q = searchInput.value;
        const hits = search(q);
        matchIds = new Set(hits.map(n => n.id));
        render();
        resultList.textContent = '';
        activeResult = -1;
        if (!q.trim()) { resultList.hidden = true; return; }
        if (!hits.length) {
            const li = document.createElement('li');
            li.className = 'empty';
            li.textContent = '找不到符合的節點';
            resultList.appendChild(li);
        }
        hits.slice(0, 50).forEach(n => {
            const li = document.createElement('li');
            li.dataset.id = n.id;
            const t = document.createElement('div');
            t.className = 'r-title';
            t.appendChild(highlight(n.title, q));
            const s = document.createElement('div');
            s.className = 'r-sub';
            s.appendChild(highlight(pathTo(n.id).slice(0, -1).map(p => p.title).join(' › ') || '起點', q));
            li.append(t, s);
            li.addEventListener('mousedown', e => {
                e.preventDefault();
                pickResult(n.id);
            });
            resultList.appendChild(li);
        });
        resultList.hidden = false;
    }

    function pickResult(id) {
        resultList.hidden = true;
        select(id);
    }

    searchInput.addEventListener('input', updateResults);
    searchInput.addEventListener('focus', () => { if (searchInput.value.trim()) resultList.hidden = false; });
    searchInput.addEventListener('blur', () => { resultList.hidden = true; });
    searchInput.addEventListener('keydown', e => {
        const items = [...resultList.querySelectorAll('li[data-id]')];
        if (!items.length) return;
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            activeResult = (activeResult + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
            items.forEach((li, i) => li.classList.toggle('active', i === activeResult));
            items[activeResult].scrollIntoView({ block: 'nearest' });
        } else if (e.key === 'Enter') {
            pickResult(items[Math.max(activeResult, 0)].dataset.id);
        } else if (e.key === 'Escape') {
            resultList.hidden = true;
        }
    });

    // ---------- pan & zoom ----------

    function applyView() {
        viewport.setAttribute('transform', `translate(${view.x},${view.y}) scale(${view.k})`);
    }

    function zoomAt(factor, cx, cy) {
        const k = Math.min(3, Math.max(0.15, view.k * factor));
        view.x = cx - (cx - view.x) * (k / view.k);
        view.y = cy - (cy - view.y) * (k / view.k);
        view.k = k;
        applyView();
    }

    function centerOn(n) {
        const r = svg.getBoundingClientRect();
        view.x = r.width / 2 - (nx(n) + NODE_W / 2) * view.k;
        view.y = r.height / 2 - (ny(n) + NODE_H / 2) * view.k;
        applyView();
    }

    function fit() {
        const nodes = visibleNodes();
        if (!nodes.length) return;
        const r = svg.getBoundingClientRect();
        const w = Math.max(...nodes.map(nx)) + NODE_W + 40;
        const h = Math.max(...nodes.map(ny)) + NODE_H;
        view.k = Math.min(1.2, Math.max(0.15, Math.min((r.width - 40) / w, (r.height - 40) / h)));
        view.x = (r.width - w * view.k) / 2;
        view.y = (r.height - h * view.k) / 2;
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
        const toggle = hit && hit.closest('[data-toggle]');
        if (toggle) {
            const id = toggle.dataset.toggle;
            collapsed.has(id) ? collapsed.delete(id) : collapsed.add(id);
            render();
            return;
        }
        const node = hit && hit.closest('.node');
        if (node) select(node.dataset.id, { center: false });
    });

    canvas.addEventListener('wheel', e => {
        e.preventDefault();
        const r = svg.getBoundingClientRect();
        zoomAt(Math.exp(-e.deltaY * 0.0015), e.clientX - r.left, e.clientY - r.top);
    }, { passive: false });

    const zoomCenter = f => {
        const r = svg.getBoundingClientRect();
        zoomAt(f, r.width / 2, r.height / 2);
    };
    document.getElementById('zoom-in').addEventListener('click', () => zoomCenter(1.25));
    document.getElementById('zoom-out').addEventListener('click', () => zoomCenter(0.8));
    document.getElementById('zoom-fit').addEventListener('click', fit);

    // ---------- boot ----------

    fetch('data/story.json')
        .then(r => r.json())
        .then(data => {
            loadData(data);
            render();
            const m = location.hash.match(/node=([^&]+)/);
            const id = m && decodeURIComponent(m[1]);
            if (id && byId.has(id)) select(id);
            else fit();
        })
        .catch(err => {
            const banner = document.getElementById('banner');
            banner.textContent = '劇情資料載入失敗：' + err.message;
            banner.hidden = false;
        });
})();
