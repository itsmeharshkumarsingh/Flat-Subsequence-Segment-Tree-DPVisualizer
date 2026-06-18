// === Core Utility Methods ===
// Expressive shorthand DOM query selector
const $ = (q) => document.querySelector(q);
// Standard XML namespace definition required to programmatically inject SVG elements into the DOM
const svgNS = 'http://www.w3.org/2000/svg';
// Promise-based blocking mechanism used to pause the async execution loop for smooth UI animation frames
const sleep = (ms) => new Promise(res => setTimeout(res, ms));

// Frame-rate pacing constant (in milliseconds) for the visualizer transitions
const DELAY = 450; 

// === UI / DOM Elements ===
const arrEl = $('#arr');
const kEl = $('#k');
const startBtn = $('#start');
const resetBtn = $('#reset');
const inputBox = $('#input');
const mapBox = $('#map');
const svg = $('#svg');
const statusEl = $('#status');
const ansEl = $('#ans');

// === Global State Invariants ===
let A = [],             // Raw input vector containing the sequence data
    K = 0,             // Absolute difference threshold constraint
    uniq = [],         // Contiguous list of unique values extracted from sequence A
    idOf = new Map();  // Hash engine mapping: Raw Element Value -> Compressed Rank Index
let size = 0,          // Smallest power-of-2 boundary capable of holding unique elements
    seg = [],          // Internal flat array representing the Segment Tree state
    pos = [],          // Absolute (x, y) coordinates for rendering SVG node circles
    groups = [];       // Heap collection tracking references to raw SVG elements (1-Indexed)

/**
 * Computes the next structural power of 2 to guarantee a perfectly 
 * balanced, symmetric full binary tree structure.
 */
function nextPow2(x) {
    let p = 1;
    while (p < x) p <<= 1;
    return p;
}

/**
 * Input Parsing Engine: Reads the sequence strings, filters invalid tokens, 
 * and fallback seeds a balanced default array if user input is empty.
 */
function parse() {
    A = arrEl.value.trim().split(/\s+/).map(Number).filter(v => !Number.isNaN(v));
    if (!A.length) {
        A = [1, 5, 4, 3, 8, 6, 9, 7, 2, 4]; // Balanced fallback sequence
        arrEl.value = A.join(' ');
    }
    K = parseInt(kEl.value, 10) || 0;
}

/**
 * Coordinate Compression Filter: Sorts elements and strips duplicates out, 
 * mapping huge value gaps into tight, sequential ranks to optimize memory layout.
 */
function compress() {
    const s = Array.from(new Set(A)).sort((a, b) => a - b);
    uniq = s;
    idOf = new Map();
    s.forEach((v, i) => idOf.set(v, i));
}

/**
 * Renders the initial raw input sequence elements into clean, animated UI blocks.
 */
function renderArray() {
    inputBox.innerHTML = '';
    A.forEach((v, i) => {
        const b = document.createElement('div');
        b.className = 'array-block pop';
        b.id = `arr-${i}`; 
        b.textContent = v;
        inputBox.appendChild(b);
    });
}

/**
 * Renders the visual coordinate compression table mapping raw values to index positions.
 */
function renderMap() {
    mapBox.innerHTML = '';
    mapBox.style.gridTemplateColumns = `repeat(${Math.min(uniq.length, 14)}, 1fr)`; 
    uniq.forEach((v, i) => {
        const cell = document.createElement('div');
        cell.className = 'map-cell';
        cell.id = `map-${i}`; 
        cell.innerHTML = `<div class="num">val ${v}</div><div class="idx">idx ${i}</div>`; 
        mapBox.appendChild(cell);
    });
}

/**
 * Wipes out all active child elements from the SVG canvas box prior to reconstructing a new tree.
 */
function clearSVG() {
    while (svg.firstChild) svg.removeChild(svg.firstChild);
}

/**
 * Static Grid Layout Generator: Pre-calculates absolute geometric coordinates for 
 * every node on the SVG canvas based on tree level depths and parent-child splits.
 */
function layout() {
    const levels = Math.log2(size) + 1 | 0; // Absolute max height depth of the binary tree
    const W = 2000,
        H = 1100,
        mx = 40,
        my = 60;
    const dy = (H - 2 * my) / levels; // Linear structural vertical separation distance between tree rows
    pos = new Array(2 * size);

    for (let i = 1; i < 2 * size; i++) {
        const d = Math.floor(Math.log2(i)); // Calculate current row depth index
        const start = 1 << d,
            off = i - start,
            cols = 1 << d;
        const x = mx + (W - 2 * mx) * (off + 0.5) / cols; // Even horizontal balancing across screen width
        const y = my + dy * d + 10;
        pos[i] = { x, y };
    }
}

/**
 * Programmatically constructs and wires an attribute-injected SVG node string.
 */
function make(tag, attrs) {
    const el = document.createElementNS(svgNS, tag);
    for (const k in attrs) el.setAttribute(k, attrs[k]);
    return el;
}

/**
 * Draws a static structural branch line connecting a parent node to a child node.
 */
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

/**
 * Generates an SVG node containing a outer circle, index metadata label, 
 * and dynamic text tracking the current active DP value inside.
 */
function nodeGroup(i, label, val) {
    const g = make('g', {
        class: 'node',
        'data-i': i
    });
    const { x, y } = pos[i];
    const r = 38; // Structural circle node radius
    g.appendChild(make('circle', { cx: x, cy: y, r }));
    
    // Label tag (Tracks rank coordinates or internal indices)
    const t1 = make('text', { x, y: y - 8, 'text-anchor': 'middle', fill: '#cbd5e1' });
    t1.textContent = label;
    g.appendChild(t1);
    
    // Dynamic Value tag (Tracks the underlying DP state)
    const t2 = make('text', { x, y: y + 12, 'text-anchor': 'middle', fill: '#fff', style: 'font-weight:800' });
    t2.textContent = val;
    g.appendChild(t2);
    
    svg.appendChild(g);
    return g;
}

/**
 * Dynamically modifies the internal text content values displayed within an SVG node group.
 */
function setNodeVal(i, v) {
    const g = groups[i];
    if (!g) return;
    g.querySelectorAll('text')[1].textContent = v;
}

/**
 * Swaps class styling states on nodes to animate processing phases (e.g., active, inside range, updated).
 */
function mark(i, cls, on = true) {
    const g = groups[i];
    if (!g) return;
    g.setAttribute('class', `node ${cls ? (on ? cls : '') : ''}`.trim());
}

/**
 * Structural Merge Popup: Injects a transient floating overlay card visualizing 
 * the associative parent consolidation step: Max(Left Child, Right Child).
 */
function showMergePrompt(i, leftV, rightV, merged) {
    const { x, y } = pos[i];
    const w = 280, h = 64;
    const prompt = make('g', { class: 'prompt', opacity: 0 });
    
    prompt.appendChild(make('rect', { x: x - w / 2, y: y - 88, width: w, height: h }));
    
    const t1 = make('text', { x, y: y - 68, 'text-anchor': 'middle', class: 'hl' });
    t1.textContent = 'merge = max';
    prompt.appendChild(t1);
    
    const t2 = make('text', { x, y: y - 48, 'text-anchor': 'middle' });
    t2.textContent = `max(${leftV}, ${rightV}) = ${merged}`; 
    prompt.appendChild(t2);
    
    svg.appendChild(prompt);
    requestAnimationFrame(() => prompt.setAttribute('opacity', '1'));
    
    // Smoothly phase out prompt card after completion
    setTimeout(() => {
        prompt.setAttribute('opacity', '0');
        setTimeout(() => {
            try { svg.removeChild(prompt); } catch (e) {}
        }, 220);
    }, 1200);
}

/**
 * Structural Allocation Loop: Builds the tree topology from the bottom up, 
 * positioning empty leaf indices and internal tracking ranges sequentially.
 */
async function buildTree() {
    size = nextPow2(Math.max(2, uniq.length));
    seg = new Array(2 * size).fill(0);
    groups = new Array(2 * size);
    clearSVG();
    layout();
    
    // Inject connecting branch line paths
    for (let i = 1; i < size; i++) {
        const p = pos[i], L = pos[2 * i], R = pos[2 * i + 1];
        drawEdge(p.x, p.y, L.x, L.y);
        drawEdge(p.x, p.y, R.x, R.y);
    }
    // Initialize leaf locations
    for (let i = 0; i < size; i++) {
        const idx = size + i;
        const label = (i < uniq.length ? `v ${uniq[i]}` : '—'); 
        groups[idx] = nodeGroup(idx, label, 0);
        mark(idx, 'build', true);
        await sleep(DELAY);
        mark(idx, '', false);
    }
    // Initialize parent tracking nodes sequentially up to root node position 1
    for (let i = size - 1; i >= 1; i--) {
        groups[i] = nodeGroup(i, `n ${i}`, 0); 
        mark(i, 'build', true);
        await sleep(DELAY);
        mark(i, '', false);
    }
    statusEl.textContent = 'Tree built. DP ready.';
}

/**
 * Custom Binary Search Lower Bound Implementation: Locates the first element 
 * index greater than or equal to value x.
 */
function lowerBound(arr, x) {
    let l = 0,
        r = arr.length;
    while (l < r) {
        const m = l + Math.floor((r - l) / 2);
        if (arr[m] < x) l = m + 1;
        else r = m;
    }
    return l;
}

/**
 * Custom Binary Search Upper Bound Implementation: Locates the first element 
 * index strictly greater than value x.
 */
function upperBound(arr, x) {
    let l = 0,
        r = arr.length;
    while (l < r) {
        const m = l + Math.floor((r - l) / 2);
        if (arr[m] <= x) l = m + 1;
        else r = m;
    }
    return l;
}

/**
 * Dynamic Interval Mapper: Converts real sequence search limits [a - K, a + K] 
 * into compressed rank bounds using binary searches.
 */
function valueToIndexRange(L, R) {
    const li = lowerBound(uniq, L);
    const ri = upperBound(uniq, R) - 1;
    if (li > ri) return null; // Guardrail against empty ranges
    return [li, ri];
}

/**
 * HIGH-PERFORMANCE ITERATIVE RANGE MAXIMUM QUERY (RMQ) ENGINE
 * Executes sub-logarithmic range queries by traveling up through leaf pointers 
 * and collecting max values across disjoint boundaries.
 */
async function rangeQuery(li, ri) {
    let best = 0;
    let l = li + size, r = ri + size; // Convert ranks into active heap leaf node positions
    
    while (l <= r) {
        if (l % 2 === 1) { // Left pointer is right child -> Node is isolated, include in answer pool
            mark(l, 'inside', true);
            best = Math.max(best, seg[l]);
            await sleep(DELAY / 2);
            l++;
        }
        if (r % 2 === 0) { // Right pointer is left child -> Node is isolated, include in answer pool
            mark(r, 'inside', true);
            best = Math.max(best, seg[r]);
            await sleep(DELAY / 2);
            r--;
        }
        l >>= 1; // Move up to father node position
        r >>= 1; // Move up to father node position
        
        // Only highlight parent layers if we haven't crossed/broken boundaries
        if (l <= r) {
            if (l > 0) mark(l, 'query', true);
            if (r > 0) mark(r, 'query', true);
            await sleep(DELAY / 2);
        }
    }
    return best;
}

/**
 * POINT UPDATE ENGINE
 * Inserts the newly computed DP value length into its designated unique rank leaf node 
 * and bubbles up structural changes to the root, resolving parent invariants.
 */
async function pointUpdate(idx, newVal) {
    let i = size + idx; // Map compressed index to heap leaf node location
    
    // Check if the new value is actually changing the leaf state
    if (seg[i] === newVal) return; 

    seg[i] = newVal;
    setNodeVal(i, newVal);
    mark(i, 'update', true);
    await sleep(DELAY);
    mark(i, 'update2', true);
    await sleep(DELAY / 2);
    mark(i, '', false);

    // Parent bubble loop ONLY triggers if a leaf state mutation occurred
    while (i > 1) {
        i >>= 1;
        const L = 2 * i, R = 2 * i + 1;
        const merged = Math.max(seg[L], seg[R]);
        
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

/**
 * CORE OPTIMIZATION EXECUTION LOOP:
 * Processes sequence array values sequentially, running range maximum queries 
 * to fetch optimum predecessors and caching values back into the tree in O(N log N) time.
 */
async function runDP() {
    let answer = 0;
    for (let t = 0; t < A.length; t++) {
        const a = A[t];
        const L = a - K, R = a + K; // Establish math constraint windows
        
        statusEl.textContent = `Step ${t+1}/${A.length}: a=${a}, find max on [${L}, ${R}]`;
        
        // Highlight active source array cell processing
        const blk = document.getElementById(`arr-${t}`);
        blk.classList.add('flash');
        await sleep(DELAY);
        blk.classList.remove('flash');
        
        const range = valueToIndexRange(L, R);
        let r = 0;
        
        if (range) {
            const [li, ri] = range;
            // Highlight current targets within table bounds
            for (let i = li; i <= ri; i++) {
                const cell = document.getElementById(`map-${i}`);
                if (cell) cell.style.borderColor = '#22c55e';
            }
            
            // Execute the range maximum query tracking
            r = await rangeQuery(li, ri);
            
            // Revert table cell border visibility state
            for (let i = li; i <= ri; i++) {
                const cell = document.getElementById(`map-${i}`);
                if (cell) cell.style.borderColor = 'transparent';
            }
        }
        
        const idx = idOf.get(a);
        statusEl.textContent = `Update value ${a} (idx ${idx}) with r+1 = ${r+1}`;
        
        // Update segment tree with optimum path configuration lengths
        await pointUpdate(idx, r + 1);
        
        answer = Math.max(answer, r + 1);
        ansEl.textContent = answer;
        await sleep(DELAY);
    }
    statusEl.textContent = 'Done!';
}

// === IO Interface / Interactive Event Locking Toggles ===
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

/**
 * Master Controller Thread: Controls pipeline processing from string parsing 
 * through visual tree population and DP execution.
 */
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

/**
 * Environment Resetter: Re-boots interface components back to standard template initialization defaults.
 */
function reset() {
    enable();
    inputBox.innerHTML = '';
    mapBox.innerHTML = '';
    clearSVG();
    statusEl.textContent = 'Status: Ready.';
    ansEl.textContent = '—';
}

// Wire operational elements to core triggers
startBtn.addEventListener('click', start);
resetBtn.addEventListener('click', reset);

// Initial execution to seed viewport panels on program launch
(function init() {
    parse();
    compress();
    renderArray();
    renderMap();
})();