// === Utils ===
const $ = (q) => document.querySelector(q);
const svgNS = 'http://www.w3.org/2000/svg';
const sleep = (ms) => new Promise(res => setTimeout(res, ms));

// Fixed pacing similar to your demo
const DELAY = 450; // ms per step

// === DOM ===
const arrEl = $('#arr');
const kEl = $('#k');
const startBtn = $('#start');
const resetBtn = $('#reset');
const inputBox = $('#input');
const mapBox = $('#map');
const svg = $('#svg');
const statusEl = $('#status');
const ansEl = $('#ans');

// === State ===
let A = [],
    K = 0,
    uniq = [],
    idOf = new Map();
let size = 0,
    seg = [],
    pos = [],
    groups = []; // heap-style 1..2*size-1

function nextPow2(x) {
    let p = 1;
    while (p < x) p <<= 1;
    return p;
}

function parse() {
    A = arrEl.value.trim().split(/\s+/).map(Number).filter(v => !Number.isNaN(v));
    if (!A.length) {
        A = [1, 5, 4, 3, 8, 6, 9, 7, 2, 4];
        arrEl.value = A.join(' ');
    }
    K = parseInt(kEl.value, 10) || 0;
}

function compress() {
    const s = Array.from(new Set(A)).sort((a, b) => a - b);
    uniq = s;
    idOf = new Map();
    s.forEach((v, i) => idOf.set(v, i));
}

function renderArray() {
    inputBox.innerHTML = '';
    A.forEach((v, i) => {
        const b = document.createElement('div');
        b.className = 'array-block pop';
        b.id = `arr-${i}`; // FIXED
        b.textContent = v;
        inputBox.appendChild(b);
    });
}

function renderMap() {
    mapBox.innerHTML = '';
    mapBox.style.gridTemplateColumns = `repeat(${Math.min(uniq.length, 14)}, 1fr)`; // FIXED
    uniq.forEach((v, i) => {
        const cell = document.createElement('div');
        cell.className = 'map-cell';
        cell.id = `map-${i}`; // FIXED
        cell.innerHTML = `<div class="num">val ${v}</div><div class="idx">idx ${i}</div>`; // FIXED
        mapBox.appendChild(cell);
    });
}

function clearSVG() {
    while (svg.firstChild) svg.removeChild(svg.firstChild);
}

function layout() {
    const levels = Math.log2(size) + 1 | 0;
    const W = 2000,
        H = 1100,
        mx = 40,
        my = 60;
    const dy = (H - 2 * my) / levels;
    pos = new Array(2 * size);
    for (let i = 1; i < 2 * size; i++) {
        const d = Math.floor(Math.log2(i));
        const start = 1 << d,
            off = i - start,
            cols = 1 << d;
        const x = mx + (W - 2 * mx) * (off + 0.5) / cols;
        const y = my + dy * d + 10;
        pos[i] = {
            x,
            y
        };
    }
}

function make(tag, attrs) {
    const el = document.createElementNS(svgNS, tag);
    for (const k in attrs) el.setAttribute(k, attrs[k]);
    return el;
}

function drawEdge(x1, y1, x2, y2) {
    const l = make('line', {
        x1,
        y1,
        x2,
        y2,
        class: 'edge'
    });
    svg.appendChild(l);
    return l;
}

function nodeGroup(i, label, val) {
    const g = make('g', {
        class: 'node',
        'data-i': i
    });
    const {
        x,
        y
    } = pos[i];
    const r = 38; // circle radius
    g.appendChild(make('circle', {
        cx: x,
        cy: y,
        r
    }));
    const t1 = make('text', {
        x,
        y: y - 8,
        'text-anchor': 'middle',
        fill: '#cbd5e1'
    });
    t1.textContent = label;
    g.appendChild(t1);
    const t2 = make('text', {
        x,
        y: y + 12,
        'text-anchor': 'middle',
        fill: '#fff',
        style: 'font-weight:800'
    });
    t2.textContent = val;
    g.appendChild(t2);
    svg.appendChild(g);
    return g;
}

function setNodeVal(i, v) {
    const g = groups[i];
    if (!g) return;
    g.querySelectorAll('text')[1].textContent = v;
}

function mark(i, cls, on = true) {
    const g = groups[i];
    if (!g) return;
    g.setAttribute('class', `node ${cls? (on? cls: '') : ''}`.trim());
} // FIXED

function showMergePrompt(i, leftV, rightV, merged) {
    const {
        x,
        y
    } = pos[i];
    const w = 280,
        h = 64;
    const prompt = make('g', {
        class: 'prompt',
        opacity: 0
    });
    prompt.appendChild(make('rect', {
        x: x - w / 2,
        y: y - 88,
        width: w,
        height: h
    }));
    const t1 = make('text', {
        x,
        y: y - 68,
        'text-anchor': 'middle',
        class: 'hl'
    });
    t1.textContent = 'merge = max';
    prompt.appendChild(t1);
    const t2 = make('text', {
        x,
        y: y - 48,
        'text-anchor': 'middle'
    });
    t2.textContent = `max(${leftV}, ${rightV}) = ${merged}`; // FIXED
    prompt.appendChild(t2);
    svg.appendChild(prompt);
    requestAnimationFrame(() => prompt.setAttribute('opacity', '1'));
    setTimeout(() => {
        prompt.setAttribute('opacity', '0');
        setTimeout(() => {
            try {
                svg.removeChild(prompt);
            } catch (e) {}
        }, 220);
    }, 1200);
}

async function buildTree() {
    size = nextPow2(Math.max(2, uniq.length));
    seg = new Array(2 * size).fill(0);
    groups = new Array(2 * size);
    clearSVG();
    layout();
    // edges
    for (let i = 1; i < size; i++) {
        const p = pos[i],
            L = pos[2 * i],
            R = pos[2 * i + 1];
        drawEdge(p.x, p.y, L.x, L.y);
        drawEdge(p.x, p.y, R.x, R.y);
    }
    // leaves
    for (let i = 0; i < size; i++) {
        const idx = size + i;
        const label = (i < uniq.length ? `v ${uniq[i]}` : '—'); // FIXED
        groups[idx] = nodeGroup(idx, label, 0);
        mark(idx, 'build', true);
        await sleep(DELAY);
        mark(idx, '', false);
    }
    // internal nodes init to 0 (animate build green)
    for (let i = size - 1; i >= 1; i--) {
        groups[i] = nodeGroup(i, `n ${i}`, 0); // FIXED
        mark(i, 'build', true);
        await sleep(DELAY);
        mark(i, '', false);
    }
    statusEl.textContent = 'Tree built. DP ready.';
}

function lowerBound(arr, x) {
    let l = 0,
        r = arr.length;
    while (l < r) {
        const m = (l + r) >> 1;
        if (arr[m] < x) l = m + 1;
        else r = m;
    }
    return l;
}

function upperBound(arr, x) {
    let l = 0,
        r = arr.length;
    while (l < r) {
        const m = (l + r) >> 1;
        if (arr[m] <= x) l = m + 1;
        else r = m;
    }
    return l;
}

function valueToIndexRange(L, R) {
    const li = lowerBound(uniq, L);
    const ri = upperBound(uniq, R) - 1;
    if (li > ri) return null;
    return [li, ri];
}

async function rangeQuery(li, ri) {
    let best = 0;
    let l = li + size,
        r = ri + size;
    while (l <= r) {
        if (l % 2 === 1) {
            mark(l, 'inside', true);
            best = Math.max(best, seg[l]);
            await sleep(DELAY / 2);
            l++;
        }
        if (r % 2 === 0) {
            mark(r, 'inside', true);
            best = Math.max(best, seg[r]);
            await sleep(DELAY / 2);
            r--;
        }
        l >>= 1;
        r >>= 1;
        if (l > 0) mark(l, 'query', true);
        if (r > 0) mark(r, 'query', true);
        await sleep(DELAY / 2);
    }
    return best;
}

async function pointUpdate(idx, newVal) {
    let i = size + idx;
    // leaf
    if (seg[i] < newVal) {
        seg[i] = newVal;
        setNodeVal(i, newVal);
        mark(i, 'update', true);
        await sleep(DELAY);
        mark(i, 'update2', true);
        await sleep(DELAY / 2);
        mark(i, '', false);
    }
    while (i > 1) {
        i >>= 1;
        const L = 2 * i,
            R = 2 * i + 1;
        const merged = Math.max(seg[L], seg[R]);
        const before = seg[i];
        seg[i] = merged;
        setNodeVal(i, merged);
        mark(i, 'update', true);
        mark(L, 'update', true);
        mark(R, 'update', true);
        showMergePrompt(i, seg[L], seg[R], merged);
        await sleep(DELAY);
        mark(i, '', false);
        mark(L, '', false);
        mark(R, '', false);
    }
}

async function runDP() {
    let answer = 0;
    for (let t = 0; t < A.length; t++) {
        const a = A[t];
        const L = a - K,
            R = a + K;
        statusEl.textContent = `Step ${t+1}/${A.length}: a=${a}, find max on [${L}, ${R}]`; // FIXED
        // flash array block
        const blk = document.getElementById(`arr-${t}`); // FIXED
        blk.classList.add('flash');
        await sleep(DELAY);
        blk.classList.remove('flash');
        const range = valueToIndexRange(L, R);
        let r = 0;
        if (range) {
            const [li, ri] = range; // focus compressed cells
            // highlight map cells
            for (let i = li; i <= ri; i++) {
                const cell = document.getElementById(`map-${i}`);
                if (cell) {
                    cell.style.borderColor = '#22c55e';
                }
            } // FIXED
            r = await rangeQuery(li, ri);
            for (let i = li; i <= ri; i++) {
                const cell = document.getElementById(`map-${i}`);
                if (cell) {
                    cell.style.borderColor = 'transparent';
                }
            } // FIXED
        }
        const idx = idOf.get(a);
        statusEl.textContent = `Update value ${a} (idx ${idx}) with r+1 = ${r+1}`; // FIXED
        await pointUpdate(idx, r + 1);
        answer = Math.max(answer, r + 1);
        ansEl.textContent = answer;
        await sleep(DELAY);
    }
    statusEl.textContent = 'Done!';
}

function disable() {
    startBtn.disabled = true;
    resetBtn.disabled = true;
    arrEl.disabled = true;
    kEl.disabled = true;
}

function enable() {
    startBtn.disabled = false;
    resetBtn.disabled = false;
    arrEl.disabled = false;
    kEl.disabled = false;
}

async function start() {
    disable();
    parse();
    compress();
    renderArray();
    renderMap();
    await buildTree();
    await runDP();
    enable();
}

function reset() {
    enable();
    inputBox.innerHTML = '';
    mapBox.innerHTML = '';
    clearSVG();
    statusEl.textContent = 'Status: Ready.';
    ansEl.textContent = '—';
}

// events
startBtn.addEventListener('click', start);
resetBtn.addEventListener('click', reset);

// initial paint
(function init() {
    parse();
    compress();
    renderArray();
    renderMap();
})();