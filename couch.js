// EmuLatte Couch Mode renderer — Phase 3: Start (carousel + tiles) → Wall → Gamepage.
// Ported from CREMA's start carousel/mosaic + gamepage, adapted to emulatte.db + the fluid wall.
// See docs/couch-mode-plan.md.
const $ = id => document.getElementById(id);
const escHtml = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

let games = [], systems = [], gamesById = new Map(), categories = [];
let screen = 'start';
let catIndex = 0, startMode = 'carousel';
let wallFilter = 'all', wallTitle = 'ALL GAMES', wallSearch = '', gridFocus = 0;
let gpGame = null, gpBtnFocus = 0;

const GP_LAYOUTS = {   // labels = physical button performing each action (standard Gamepad API: 0=bottom, 1=right, 3=top)
    xbox:        { a: 'A', b: 'B', y: 'Y' },
    playstation: { a: '✕', b: '○', y: '△' },
    nintendo:    { a: 'B', b: 'A', y: 'X' },
};
function autoDensity() {
    const h = window.screen.height || window.innerHeight || 1080;
    if (h <= 540) return 2.4; if (h <= 768) return 1.7; if (h <= 1080) return 1.25; return 1.0;
}
async function init() {
    const dRaw = (await window.api.getSetting('couch_density')) || 'auto';
    const density = dRaw === 'auto' ? autoDensity() : (parseFloat(dRaw) || 1);
    if (window.api.setZoom && density !== 1) window.api.setZoom(density);
    if ((await window.api.getSetting('couch_hide_cursor')) === '1') document.body.style.cursor = 'none';
    applyGamepadLayout((await window.api.getSetting('couch_gamepad_layout')) || 'xbox');
    [games, systems] = await Promise.all([window.api.getGames(), window.api.getSystems()]);
    gamesById = new Map(games.map(g => [g.id, g]));
    buildCategories();
    renderCarousel(); renderTiles();
    showScreen('start');
}
function applyGamepadLayout(layout) {
    const L = GP_LAYOUTS[layout] || GP_LAYOUTS.xbox;
    document.querySelectorAll('.pb.a').forEach(e => e.textContent = L.a);
    document.querySelectorAll('.pb.b').forEach(e => e.textContent = L.b);
    document.querySelectorAll('.pb.y').forEach(e => e.textContent = L.y);
}

// ── Categories / media ───────────────────────────────────────────────────────
function buildCategories() {
    const counts = {}; games.forEach(g => counts[g.system_id] = (counts[g.system_id] || 0) + 1);
    const sys = systems.filter(s => counts[s.id]).map(s => ({ key: 'sys:' + s.id, label: s.name, count: counts[s.id] }))
                       .sort((a, b) => (a.label || '').localeCompare(b.label || ''));
    categories = [{ key: 'all', label: 'ALL GAMES', count: games.length }];
    const favs = games.filter(g => g.fav).length;
    if (favs) categories.push({ key: 'favs', label: 'FAVOURITES', count: favs });
    categories.push({ key: 'recent', label: 'RECENT', count: Math.min(games.filter(g => g.last_played).length, 60) });
    categories = categories.concat(sys);
}
function gamesInCategory(key) {
    if (key === 'favs')   return games.filter(g => g.fav);
    if (key === 'recent') return [...games].sort((a, b) => (b.last_played || 0) - (a.last_played || 0)).slice(0, 60);
    if (key.startsWith('sys:')) { const id = Number(key.slice(4)); return games.filter(g => g.system_id === id); }
    return games;
}
function mediaForCategory(key) {
    const gs = gamesInCategory(key); let media = [];
    gs.forEach(g => { if (g.screenshot) media.push(...String(g.screenshot).split('|').filter(s => s.trim())); });
    if (media.length < 3) gs.forEach(g => { if (g.cover) media.push(g.cover); });
    media = [...new Set(media)];
    for (let i = media.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [media[i], media[j]] = [media[j], media[i]]; }
    return media;
}

// ── Screen router ────────────────────────────────────────────────────────────
function showScreen(s) { screen = s; ['start', 'wall', 'gamepage'].forEach(id => $('screen-' + id).classList.toggle('hidden', id !== s)); }

// ── START: hero mosaic ───────────────────────────────────────────────────────
function fillMosaic(key) {
    const m = $('cz-mosaic'), fb = $('cz-hero-fallback');
    const media = mediaForCategory(key);
    if (media.length >= 1) {
        fb.style.display = 'none'; m.style.display = 'block'; m.innerHTML = '';
        for (let i = 0; i < 3; i++) {
            const img = document.createElement('img'); img.className = 'mosaic-img'; img.src = media[i % media.length];
            m.appendChild(img); setTimeout(() => img.classList.add('show'), i * 150 + 50);
        }
    } else { m.style.display = 'none'; fb.style.display = 'block'; }
}
function selectedHero() {   // category name overlaid on the hero pictures + the cover mosaic
    const c = categories[catIndex];
    $('cz-hero-title').textContent = c.label;
    fillMosaic(c.key);
}

// ── START: carousel (full-screen hero per category; nav with ◄ ►) ────────────
function renderCarousel() { selectedHero(); }
function carouselMove(dir) { catIndex = clamp(catIndex + dir, 0, categories.length - 1); selectedHero(); }

// ── START: tiles ─────────────────────────────────────────────────────────────
function renderTiles() {
    $('cz-tiles').innerHTML = categories.map((c, i) => {
        const media = mediaForCategory(c.key);
        const bg = media[0] ? `<img class="cz-tile-bg" src="${media[0]}" loading="lazy">` : '';
        return `<div class="cz-tile" data-i="${i}">${bg}<div class="cz-tile-grad"></div><div class="cz-tile-count">${c.count}</div><div class="cz-tile-label">${escHtml(c.label)}</div></div>`;
    }).join('');
    [...$('cz-tiles').querySelectorAll('.cz-tile')].forEach(el => el.onclick = () => { catIndex = Number(el.dataset.i); updateTiles(); selectCategory(); });
    updateTiles();
}
function updateTiles() {
    [...$('cz-tiles').querySelectorAll('.cz-tile')].forEach((el, i) => { el.classList.toggle('sel', i === catIndex); if (i === catIndex) el.scrollIntoView({ block: 'nearest' }); });
}
function tilesCols() { const t = [...$('cz-tiles').querySelectorAll('.cz-tile')]; if (t.length < 2) return 1; const t0 = t[0].offsetTop; let c = 1; for (let i = 1; i < t.length; i++) { if (t[i].offsetTop === t0) c++; else break; } return c; }
function tilesMove(dx, dy) {
    const n = categories.length, cols = tilesCols();
    if (dy < 0) catIndex = Math.max(0, catIndex - cols);
    else if (dy > 0) catIndex = Math.min(n - 1, catIndex + cols);
    else catIndex = clamp(catIndex + dx, 0, n - 1);
    updateTiles();
}
function toggleStartMode() {
    startMode = startMode === 'carousel' ? 'tiles' : 'carousel';
    $('cz-hero').style.display = startMode === 'carousel' ? 'block' : 'none';
    $('cz-tiles').style.display = startMode === 'tiles' ? 'grid' : 'none';
    if (startMode === 'carousel') selectedHero(); else updateTiles();
}
function selectCategory() {
    const c = categories[catIndex];
    wallFilter = c.key; wallTitle = c.label;
    enterWall();
}

// ── WALL ─────────────────────────────────────────────────────────────────────
function enterWall() {
    $('wall-title').textContent = wallTitle; $('wall-search').value = ''; wallSearch = '';
    renderWall(); showScreen('wall'); focusGrid(0);
}
function wallGamesList() {
    let list = gamesInCategory(wallFilter);
    if (wallSearch) { const q = wallSearch.toLowerCase(); list = list.filter(g => (g.title || '').toLowerCase().includes(q)); }
    if (wallFilter !== 'recent') list = [...list].sort((a, b) => (a.title || '').localeCompare(b.title || '', undefined, { sensitivity: 'base' }));
    return list;
}
function renderWall() {
    const grid = $('couch-grid'); const list = wallGamesList();
    $('wall-count').textContent = `${list.length} GAME${list.length !== 1 ? 'S' : ''}`;
    if (!list.length) { grid.innerHTML = '<div class="couch-empty">NO GAMES</div>'; return; }
    grid.innerHTML = list.map(g => {
        const ss = g.screenshot ? String(g.screenshot).split('|').map(s => s.trim()).filter(Boolean)[0] : '';
        const bg = ss || g.cover || '';   // prefer a screenshot, fall back to cover, then a plain panel
        const inner = bg
            ? `<img class="cc-ss" src="${bg}" loading="lazy" decoding="async" onerror="this.style.display='none'"><div class="cc-grad"></div>`
              + (g.logo ? `<img class="cc-logo" src="${g.logo}" loading="lazy" decoding="async">` : `<div class="cc-name">${escHtml(g.title)}</div>`)
            : `<div class="cc-fallback">${escHtml(g.title)}</div>`;
        return `<button class="couch-card" data-id="${g.id}"><div class="cc-slot">${inner}</div></button>`;
    }).join('');
}
const wallCards = () => [...$('couch-grid').querySelectorAll('.couch-card')];
function wallCols() { const c = wallCards(); if (c.length < 2) return 1; const t0 = c[0].offsetTop; let n = 1; for (let i = 1; i < c.length; i++) { if (c[i].offsetTop === t0) n++; else break; } return n; }
function focusGrid(i) {
    const c = wallCards(); $('couch-grid').querySelectorAll('.gp-focus').forEach(e => e.classList.remove('gp-focus'));
    if (!c.length) return; gridFocus = clamp(i, 0, c.length - 1); c[gridFocus].classList.add('gp-focus'); c[gridFocus].scrollIntoView({ block: 'nearest' });
}
function wallMove(dx, dy) { const c = wallCards(); if (!c.length) return; const cols = wallCols(); if (dy < 0) focusGrid(gridFocus - cols); else if (dy > 0) focusGrid(Math.min(gridFocus + cols, c.length - 1)); else { const n = gridFocus + dx; if (n >= 0 && n < c.length) focusGrid(n); } }
function wallActivate() { const el = wallCards()[gridFocus]; if (el) openGamepage(Number(el.dataset.id)); }
function wallCycleCategory(dir) {
    catIndex = clamp(catIndex + dir, 0, categories.length - 1);
    const c = categories[catIndex]; wallFilter = c.key; wallTitle = c.label;
    $('wall-title').textContent = wallTitle; renderWall(); focusGrid(0);
}

// ── GAMEPAGE ─────────────────────────────────────────────────────────────────
function openGamepage(id) {
    const g = gamesById.get(id); if (!g) return; gpGame = g;
    const hero = g.hero || (g.screenshot ? String(g.screenshot).split('|')[0] : '') || g.cover || '';
    const heroImg = $('gp-hero-img'); heroImg.src = hero; heroImg.style.display = hero ? 'block' : 'none';
    const logo = $('gp-logo'), title = $('gp-hero-title');
    if (g.logo) { logo.src = g.logo; logo.style.display = 'block'; title.style.display = 'none'; }
    else { logo.style.display = 'none'; title.style.display = 'block'; title.textContent = g.title || ''; }
    $('gp-cover').innerHTML = g.cover ? `<img src="${g.cover}">` : `<div class="nocover">NO COVER ART</div>`;
    const ss = g.screenshot ? String(g.screenshot).split('|').filter(s => s.trim()) : [];
    if (ss.length) { $('gp-ss').style.display = 'block'; $('gp-ss').querySelector('img').src = ss[0]; } else $('gp-ss').style.display = 'none';
    $('gp-desc').textContent = g.description || 'No description available.';
    const stats = [['SYSTEM', g.system_name], ['YEAR', g.year], ['GENRE', g.genre], ['DEVELOPER', g.developer], ['PUBLISHER', g.publisher], ['PLAYERS', g.players], ['RATING', g.rating]].filter(([, v]) => v);
    $('gp-right').innerHTML = stats.map(([k, v]) => `<div class="gp-stat"><span class="k">${k}</span><span class="v">${escHtml(v)}</span></div>`).join('');
    buildGpActions();
    showScreen('gamepage'); $('gp-content').scrollTop = 0; gpBtnFocus = 0; updateGpFocus();
}
function buildGpActions() {
    const g = gpGame;
    $('gp-actions').innerHTML = [
        `<button class="gp-btn play" data-act="play">▶ PLAY</button>`,
        `<button class="gp-btn${g.fav ? ' active' : ''}" data-act="fav">${g.fav ? '★ FAV' : '+ FAV'}</button>`,
        `<button class="gp-btn${g.want ? ' active' : ''}" data-act="want">${g.want ? '♥ WANT' : 'WANT TO PLAY'}</button>`,
    ].join('');
    [...$('gp-actions').querySelectorAll('.gp-btn')].forEach((b, i) => b.onclick = () => { gpBtnFocus = i; updateGpFocus(); gpActivate(); });
}
const gpButtons = () => [...$('gp-actions').querySelectorAll('.gp-btn')];
function updateGpFocus() { gpButtons().forEach((el, i) => el.classList.toggle('gp-focus', i === gpBtnFocus)); }
function gpMove(dx) { gpBtnFocus = clamp(gpBtnFocus + dx, 0, gpButtons().length - 1); updateGpFocus(); }
async function gpActivate() {
    const b = gpButtons()[gpBtnFocus]; if (!b) return;
    const act = b.dataset.act;
    if (act === 'play') launch(gpGame.id);
    else { gpGame[act] = gpGame[act] ? 0 : 1; await window.api.setGameFlag(gpGame.id, act, gpGame[act]); buildGpActions(); updateGpFocus(); }
}

// ── Launch + Now Playing ─────────────────────────────────────────────────────
$('couch-grid').addEventListener('click', e => { const c = e.target.closest('.couch-card'); if (c) { focusGrid(wallCards().indexOf(c)); openGamepage(Number(c.dataset.id)); } });
let _nowTimer;
async function launch(id) {
    const g = gamesById.get(id); if (!g) return;
    showNow(g);
    const r = await window.api.launchGame(id);
    clearTimeout(_nowTimer);
    if (!r || !r.ok) { $('couch-now').querySelector('.now-label').textContent = 'COULD NOT LAUNCH'; _nowTimer = setTimeout(hideNow, 2500); }
    else _nowTimer = setTimeout(hideNow, 4500);
}
function showNow(g) {
    const n = $('couch-now');
    n.querySelector('.now-label').textContent = 'NOW LAUNCHING';
    n.querySelector('.now-title').textContent = g.title || '';
    const bg = g.hero || g.screenshot || g.cover || '';
    n.querySelector('.now-art').style.backgroundImage = bg ? `url('${bg.split('|')[0]}')` : 'none';
    n.classList.remove('hidden');
}
function hideNow() { $('couch-now').classList.add('hidden'); }
function exitCouch() { window.api && window.api.exitCouch && window.api.exitCouch(); }

// ── Wall search ──────────────────────────────────────────────────────────────
$('wall-search').addEventListener('input', e => { wallSearch = e.target.value.trim(); renderWall(); focusGrid(0); });

// ── Input dispatch (per active screen) ───────────────────────────────────────
function dispatchNav(dx, dy) {
    if (screen === 'start') { if (startMode === 'carousel') { if (dx) carouselMove(dx); } else tilesMove(dx, dy); }
    else if (screen === 'wall') wallMove(dx, dy);
    else if (screen === 'gamepage') { if (dx) gpMove(dx); }
}
function dispatchConfirm() { if (screen === 'start') selectCategory(); else if (screen === 'wall') wallActivate(); else gpActivate(); }
function dispatchBack() {
    if (!$('couch-now').classList.contains('hidden')) { hideNow(); return; }
    if (screen === 'gamepage') enterWall();
    else if (screen === 'wall') showScreen('start');
    else exitCouch();
}
function dispatchAux() { if (screen === 'start') toggleStartMode(); }
function dispatchShoulder(dir) { if (screen === 'wall') wallCycleCategory(dir); }

document.addEventListener('keydown', e => {
    if (e.key === 'F11') { exitCouch(); return; }
    if (document.activeElement === $('wall-search')) { if (e.key === 'Enter' || e.key === 'Escape') { $('wall-search').blur(); focusGrid(0); } return; }
    switch (e.key) {
        case 'ArrowUp':    dispatchNav(0, -1); e.preventDefault(); break;
        case 'ArrowDown':  dispatchNav(0, 1);  e.preventDefault(); break;
        case 'ArrowLeft':  dispatchNav(-1, 0); e.preventDefault(); break;
        case 'ArrowRight': dispatchNav(1, 0);  e.preventDefault(); break;
        case 'Enter':      dispatchConfirm();  break;
        case 'Escape': case 'Backspace': dispatchBack(); break;
        case 'Tab': case 'y': case 'Y': dispatchAux(); e.preventDefault(); break;
        case '[': dispatchShoulder(-1); break;
        case ']': dispatchShoulder(1); break;
    }
});

// ── Gamepad ──────────────────────────────────────────────────────────────────
const firstPad = () => Array.prototype.find.call(navigator.getGamepads ? navigator.getGamepads() : [], p => p);
let _btnPrev = {}, _navHeld = null, _navAt = 0;
function pollPad() {
    const gp = firstPad();
    if (gp) {
        const down = i => !!(gp.buttons[i] && gp.buttons[i].pressed);
        const edge = i => { const p = down(i); const w = _btnPrev[i]; _btnPrev[i] = p; return p && !w; };
        if (edge(0)) dispatchConfirm();      // A
        if (edge(1)) dispatchBack();         // B
        if (edge(3)) dispatchAux();          // Y
        if (edge(4)) dispatchShoulder(-1);   // LB
        if (edge(5)) dispatchShoulder(1);    // RB
        const ax = gp.axes[0] || 0, ay = gp.axes[1] || 0, DZ = 0.5; let dx = 0, dy = 0;
        if (down(14) || ax < -DZ) dx = -1; else if (down(15) || ax > DZ) dx = 1;
        if (down(12) || ay < -DZ) dy = -1; else if (down(13) || ay > DZ) dy = 1;
        const dir = (dx || dy) ? dx + ',' + dy : null; const now = performance.now();
        if (dir) { if (dir !== _navHeld) { _navHeld = dir; _navAt = now + 320; dispatchNav(dx, dy); } else if (now >= _navAt) { _navAt = now + 110; dispatchNav(dx, dy); } }
        else _navHeld = null;
    } else { _btnPrev = {}; _navHeld = null; }
    requestAnimationFrame(pollPad);
}
requestAnimationFrame(pollPad);

// The hero IS the carousel (controller/keyboard nav); a mouse click opens the shown category.
$('cz-hero').addEventListener('click', () => selectCategory());
init();
