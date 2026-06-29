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
let browseMode = 'gallery', listFocus = 0, gpReturn = 'wall';
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
    applyTheme((await window.api.getSetting('couch_theme')) || 'CREMA (DEFAULT)');
    const dRaw = (await window.api.getSetting('couch_density')) || 'auto';
    const density = dRaw === 'auto' ? autoDensity() : (parseFloat(dRaw) || 1);
    if (window.api.setZoom && density !== 1) window.api.setZoom(density);
    if ((await window.api.getSetting('couch_hide_cursor')) === '1') document.body.style.cursor = 'none';
    applyGamepadLayout((await window.api.getSetting('couch_gamepad_layout')) || 'xbox');
    browseMode = (await window.api.getSetting('couch_browse_mode')) || 'gallery';
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

// ── Themes (ported from CafeNeurotico/CREMA; add more from CREMA's THEMES, same shape) ──
const THEMES = {
    "CREMA (DEFAULT)": { bg: "#2C1E16", bg_panel: "rgba(67,40,24,0.6)", bg_menu: "#432818", accent: "#D4A373", text_main: "#FFE6A7", text_sec: "#E6CC98", text_dim: "#A47148", border: "rgba(212,163,115,0.2)", border_solid: "#8B5A2B" },
    "DARK GRAY": { bg: "#141414", bg_panel: "rgba(0,0,0,0.5)", bg_menu: "#222222", accent: "#ffffff", text_main: "#ffffff", text_sec: "#bbbbbb", text_dim: "#777777", border: "rgba(255,255,255,0.1)", border_solid: "#555555" },
    "CYBERPUNK": { bg: "#09090b", bg_panel: "rgba(26,26,46,0.7)", bg_menu: "#1a1a2e", accent: "#f3e600", text_main: "#00ffcc", text_sec: "#e0e0e0", text_dim: "#ff003c", border: "rgba(243,230,0,0.2)", border_solid: "#ff003c" },
    "VAPOUR OS": { bg: "#171a21", bg_panel: "rgba(27,40,56,0.7)", bg_menu: "#1b2838", accent: "#66c0f4", text_main: "#c7d5e0", text_sec: "#8f98a0", text_dim: "#556b82", border: "rgba(102,192,244,0.2)", border_solid: "#2a475e" },
    "MOVIESFLIX": { bg: "#141414", bg_panel: "rgba(255,255,255,0.07)", bg_menu: "#000000", accent: "#e50914", text_main: "#ffffff", text_sec: "#b3b3b3", text_dim: "#6d6d6d", border: "rgba(229,9,20,0.30)", border_solid: "#404040" },
    "GREEN BOX": { bg: "#0e0e0e", bg_panel: "rgba(82,176,67,0.10)", bg_menu: "#111111", accent: "#52b043", text_main: "#ffffff", text_sec: "#a8d8a4", text_dim: "#3d8030", border: "rgba(82,176,67,0.22)", border_solid: "#1a3d1a" },
    "SNOW": { bg: "#0a1628", bg_panel: "rgba(32,68,110,0.65)", bg_menu: "#0f2040", accent: "#93d0f0", text_main: "#e8f4ff", text_sec: "#8bbbd8", text_dim: "#4a7898", border: "rgba(147,208,240,0.18)", border_solid: "#1c4060" },
    "GAME BOY DMG": { bg: "#0f380f", bg_panel: "rgba(48,98,48,0.70)", bg_menu: "#1a4a1a", accent: "#9bbc0f", text_main: "#9bbc0f", text_sec: "#8bac0f", text_dim: "#306230", border: "rgba(155,188,15,0.25)", border_solid: "#306230" },
    "PIP BOY": { bg: "#000000", bg_panel: "rgba(0,20,0,0.7)", bg_menu: "#001100", accent: "#14ff00", text_main: "#14ff00", text_sec: "#0ea000", text_dim: "#0a6000", border: "rgba(20,255,0,0.2)", border_solid: "#0ea000" },
    "DRACULA": { bg: "#282a36", bg_panel: "rgba(68,71,90,0.7)", bg_menu: "#44475a", accent: "#bd93f9", text_main: "#f8f8f2", text_sec: "#8be9fd", text_dim: "#8290bc", border: "rgba(189,147,249,0.2)", border_solid: "#8290bc" },
    "GRUVBOX": { bg: "#282828", bg_panel: "rgba(60,56,54,0.8)", bg_menu: "#3c3836", accent: "#fabd2f", text_main: "#ebdbb2", text_sec: "#b8bb26", text_dim: "#a89984", border: "rgba(250,189,47,0.2)", border_solid: "#504945" },
    "NORD": { bg: "#2e3440", bg_panel: "rgba(59,66,82,0.8)", bg_menu: "#3b4252", accent: "#88c0d0", text_main: "#eceff4", text_sec: "#e5e9f0", text_dim: "#7a8ba0", border: "rgba(136,192,208,0.2)", border_solid: "#5e6f84" },
    "CATPPUCCIN MOCHA": { bg: "#1e1e2e", bg_panel: "rgba(30,30,46,0.8)", bg_menu: "#181825", accent: "#cba6f7", text_main: "#cdd6f4", text_sec: "#bac2de", text_dim: "#6c7086", border: "rgba(203,166,247,0.2)", border_solid: "#313244" },
    "TOKYO NIGHT": { bg: "#1a1b26", bg_panel: "rgba(36,40,59,0.8)", bg_menu: "#16161e", accent: "#7aa2f7", text_main: "#c0caf5", text_sec: "#a9b1d6", text_dim: "#7885ac", border: "rgba(122,162,247,0.2)", border_solid: "#3d4468" },
    "ROSÉ PINE": { bg: "#191724", bg_panel: "rgba(31,29,46,0.8)", bg_menu: "#1f1d2e", accent: "#c4a7e7", text_main: "#e0def4", text_sec: "#9ccfd8", text_dim: "#6e6a86", border: "rgba(196,167,231,0.2)", border_solid: "#26233a" },
    "NES": { bg: "#18181A", bg_panel: "rgba(40,38,42,0.85)", bg_menu: "#222024", accent: "#C42020", text_main: "#F0F0F0", text_sec: "#C0B8C0", text_dim: "#706870", border: "rgba(196,32,32,0.22)", border_solid: "#3C3A3E" },
    "SNES": { bg: "#1E1828", bg_panel: "rgba(50,42,80,0.72)", bg_menu: "#160E20", accent: "#8060C8", text_main: "#E8E0F0", text_sec: "#A890C8", text_dim: "#605090", border: "rgba(128,96,200,0.22)", border_solid: "#302050" },
    "BLOODBORNE": { bg: "#0a0606", bg_panel: "rgba(60,20,10,0.78)", bg_menu: "#150808", accent: "#c0952a", text_main: "#e8d8b0", text_sec: "#b09070", text_dim: "#604830", border: "rgba(192,149,42,0.22)", border_solid: "#4a1818" },
    "TRON LEGACY": { bg: "#000000", bg_panel: "rgba(0,200,255,0.08)", bg_menu: "#000508", accent: "#00c8ff", text_main: "#ffffff", text_sec: "#80d8ff", text_dim: "#204858", border: "rgba(0,200,255,0.28)", border_solid: "#0a1a20" },
    "VAPORWAVE": { bg: "#0d0221", bg_panel: "rgba(80,10,100,0.65)", bg_menu: "#150330", accent: "#ff71ce", text_main: "#f0e0ff", text_sec: "#c080ff", text_dim: "#6030a0", border: "rgba(255,113,206,0.25)", border_solid: "#35005a" },
};
function applyTheme(name) {
    const t = THEMES[name] || THEMES["CREMA (DEFAULT)"];
    const r = document.documentElement;
    Object.keys(t).forEach(k => r.style.setProperty('--' + k, t[k]));
}

// ── Settings menu (CREMA-style overlay) ──────────────────────────────────────
let menuOpen = false, menuMode = 'main', overlayItems = [], overlayIndex = 0;
const DENSITY_OPTS = [['Auto', 'auto'], ['Comfortable', '1.0'], ['Large', '1.5'], ['Extra-Large', '2.0'], ['CRT (low-res)', '2.5']];
const LAYOUT_OPTS  = [['Xbox', 'xbox'], ['PlayStation', 'playstation'], ['Nintendo', 'nintendo']];
const NAV_OPTS     = [['Gallery', 'gallery'], ['List', 'list']];
const getCfg = async (k, d) => (await window.api.getSetting(k)) || d;

function renderOverlay(title, items, hint) {
    overlayItems = items;
    const list = $('overlay-list'); $('overlay-title').textContent = title; list.innerHTML = '';
    items.forEach((it, i) => {
        const d = document.createElement('div');
        if (it[0] === '§') { d.className = 'overlay-section'; d.textContent = it.slice(1); }
        else { d.className = 'overlay-item'; d.id = 'ov-' + i; d.textContent = it; d.onclick = () => { overlayIndex = i; overlayConfirm(); }; }
        list.appendChild(d);
    });
    overlayIndex = items.findIndex(it => it[0] !== '§'); if (overlayIndex < 0) overlayIndex = 0;
    const he = $('overlay-hint'); if (hint) { he.textContent = hint; he.style.display = 'block'; } else he.style.display = 'none';
    highlightOverlay();
    $('overlay-backdrop').classList.remove('hidden');
}
function highlightOverlay() {
    $('overlay-list').querySelectorAll('.overlay-item').forEach(e => e.classList.remove('selected'));
    const el = $('ov-' + overlayIndex); if (el) { el.classList.add('selected'); el.scrollIntoView({ block: 'nearest' }); }
}
function overlayMove(dir) {
    const sel = overlayItems.map((it, i) => it[0] !== '§' ? i : -1).filter(i => i >= 0);
    let p = sel.indexOf(overlayIndex); if (p < 0) p = 0;
    overlayIndex = sel[(p + dir + sel.length) % sel.length]; highlightOverlay();
}
async function openMenu() {
    menuOpen = true; menuMode = 'main';
    renderOverlay('SETTINGS', ['§APPEARANCE', 'Color Theme', 'Navigation Mode', 'Display Density', '§CONTROLS', 'Gamepad Buttons', '§SYSTEM', 'Close Menu', 'Exit Couch Mode']);
}
function closeMenu() { menuOpen = false; $('overlay-backdrop').classList.add('hidden'); }
async function openThemeMenu() {
    menuMode = 'theme'; const cur = await getCfg('couch_theme', 'CREMA (DEFAULT)');
    renderOverlay('COLOR THEME', ['§COLOR THEME', ...Object.keys(THEMES).map(n => n === cur ? '★ ' + n : n), 'Back']);
}
async function openDensityMenu() {
    menuMode = 'density'; const cur = await getCfg('couch_density', 'auto');
    renderOverlay('DISPLAY DENSITY', ['§DISPLAY DENSITY', ...DENSITY_OPTS.map(([l, v]) => v === cur ? '★ ' + l : l), 'Back'], 'Scales the interface for TVs / CRTs. Works in 4:3 and 16:9.');
}
async function openLayoutMenu() {
    menuMode = 'layout'; const cur = await getCfg('couch_gamepad_layout', 'xbox');
    renderOverlay('GAMEPAD BUTTONS', ['§GAMEPAD BUTTONS', ...LAYOUT_OPTS.map(([l, v]) => v === cur ? '★ ' + l : l), 'Back']);
}
function openNavMenu() {
    menuMode = 'navmode';
    renderOverlay('NAVIGATION MODE', ['§NAVIGATION MODE', ...NAV_OPTS.map(([l, v]) => v === browseMode ? '★ ' + l : l), 'Back'], 'Gallery = cover wall · List = list + details.');
}
function applyDensity(v) { const d = v === 'auto' ? autoDensity() : (parseFloat(v) || 1); if (window.api.setZoom) window.api.setZoom(d); }
function overlayConfirm() {
    const raw = String(overlayItems[overlayIndex] || '').replace('★ ', '');
    if (menuMode === 'main') {
        if (raw === 'Color Theme') openThemeMenu();
        else if (raw === 'Navigation Mode') openNavMenu();
        else if (raw === 'Display Density') openDensityMenu();
        else if (raw === 'Gamepad Buttons') openLayoutMenu();
        else if (raw === 'Close Menu') closeMenu();
        else if (raw === 'Exit Couch Mode') exitCouch();
        return;
    }
    if (raw === 'Back') { openMenu(); return; }
    if (menuMode === 'theme') { applyTheme(raw); window.api.setSetting('couch_theme', raw); openThemeMenu(); }
    else if (menuMode === 'density') { const o = DENSITY_OPTS.find(([l]) => l === raw); if (o) { window.api.setSetting('couch_density', o[1]); applyDensity(o[1]); openDensityMenu(); } }
    else if (menuMode === 'layout') { const o = LAYOUT_OPTS.find(([l]) => l === raw); if (o) { window.api.setSetting('couch_gamepad_layout', o[1]); applyGamepadLayout(o[1]); openLayoutMenu(); } }
    else if (menuMode === 'navmode') {
        const o = NAV_OPTS.find(([l]) => l === raw);
        if (o) {
            browseMode = o[1]; window.api.setSetting('couch_browse_mode', o[1]);
            if (screen === 'wall' || screen === 'list') (o[1] === 'list' ? enterList : enterWall)();   // switch the current category live
            openNavMenu();
        }
    }
}
function overlayBack() { if (menuMode === 'main') closeMenu(); else openMenu(); }
function dispatchMenu() { if (menuOpen) closeMenu(); else openMenu(); }

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
function showScreen(s) { if (s !== 'list') clearInterval(_ssTimer); screen = s; ['start', 'wall', 'list', 'gamepage'].forEach(id => $('screen-' + id).classList.toggle('hidden', id !== s)); }

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
    if (browseMode === 'list') enterList(); else enterWall();
}

// ── LIST VIEW (CREMA main-screen style: list + media/details + stats) ────────
let listList = [], _ssTimer = null;   // cached current category list + screenshot cycler
function enterList() { renderList(); showScreen('list'); listSelect(0); }
function renderList() {   // CREMA renderGameList
    const l = $('game-list'); listList = wallGamesList();
    $('list-cat-name').textContent = wallTitle;
    $('list-count').textContent = `${listList.length} GAMES`;
    if (!listList.length) { l.innerHTML = '<div class="couch-empty">NO GAMES</div>'; clearListDetail(); return; }
    l.innerHTML = listList.map((g, i) => {
        let p = ''; if (g.fav) p += '★ '; if (g.want) p += '♥ ';
        return `<div class="game-item" id="game-${i}" data-i="${i}" data-id="${g.id}"><span class="list-install-dot">●</span>${p}${escHtml(g.title)}</div>`;
    }).join('');
    [...l.querySelectorAll('.game-item')].forEach(el => el.onclick = () => { listSelect(Number(el.dataset.i)); openGamepage(Number(el.dataset.id)); });
}
function listSelect(i) {   // CREMA updateGameSelection: selection + scroll + media/stats
    if (!listList.length) return;
    listFocus = clamp(i, 0, listList.length - 1);
    const items = [...$('game-list').querySelectorAll('.game-item')];
    items.forEach((el, j) => el.classList.toggle('selected', j === listFocus));
    if (items[listFocus]) items[listFocus].scrollIntoView({ block: 'nearest' });
    updateListDetail(listList[listFocus]);
}
function updateListDetail(g) {   // CREMA media layers (cover backdrop + cycling screenshots + cover-mini) + stats
    clearInterval(_ssTimer);
    if (!g) return;
    $('stat-system').textContent = g.system_name || '--';
    $('stat-release').textContent = g.year || '--';
    $('stat-dev').textContent = g.developer || '--';
    $('stat-pub').textContent = g.publisher || '--';
    let genre = g.genre ? String(g.genre) : '--'; if (genre.includes(',')) genre = genre.split(',')[0].trim(); $('stat-genre').textContent = genre;
    $('stat-players').textContent = g.players || '--';
    let d = g.description || '—'; if (d.length > 500) d = d.slice(0, 497) + '...'; $('game-desc').textContent = d;
    const bg = $('cover-backdrop'), ss = $('screenshot-player'), mini = $('cover-mini');
    bg.src = g.cover || g.hero || '';
    const shots = g.screenshot ? String(g.screenshot).split('|').map(s => s.trim()).filter(Boolean) : [];
    if (shots.length) {
        let k = 0; ss.src = shots[0]; ss.classList.add('active');
        if (g.cover) { mini.src = g.cover; mini.classList.remove('hidden'); } else mini.classList.add('hidden');
        _ssTimer = setInterval(() => { k = (k + 1) % shots.length; ss.src = shots[k]; }, 4000);
    } else { ss.classList.remove('active'); ss.src = ''; mini.classList.add('hidden'); }
}
function clearListDetail() {
    clearInterval(_ssTimer);
    ['stat-system', 'stat-release', 'stat-dev', 'stat-pub', 'stat-genre', 'stat-players'].forEach(id => $(id).textContent = '--');
    $('game-desc').textContent = '';
    $('cover-backdrop').src = ''; $('screenshot-player').classList.remove('active'); $('cover-mini').classList.add('hidden');
}
function listMove(dy) { if (dy) listSelect(listFocus + dy); }
function listActivate() { const g = listList[listFocus]; if (g) openGamepage(g.id); }
function listCycleCategory(dir) {
    catIndex = clamp(catIndex + dir, 0, categories.length - 1);
    const c = categories[catIndex]; wallFilter = c.key; wallTitle = c.label;
    renderList(); listSelect(0);
}

// ── WALL ─────────────────────────────────────────────────────────────────────
// ── GALLERY (CREMA gallery-screen: hero banner + 9-col grid, ported) ──────────
const GALLERY_COLS = 9;
let galleryList = [];   // cached current category list (avoids re-filter/sort on every nav)
function enterWall() {
    wallSearch = '';
    renderWall(); showScreen('wall'); focusGrid(0);
}
function wallGamesList() {
    let list = gamesInCategory(wallFilter);
    if (wallSearch) { const q = wallSearch.toLowerCase(); list = list.filter(g => (g.title || '').toLowerCase().includes(q)); }
    if (wallFilter !== 'recent') list = [...list].sort((a, b) => (a.title || '').localeCompare(b.title || '', undefined, { sensitivity: 'base' }));
    return list;
}
function renderWall() {
    const grid = $('gallery-grid'); galleryList = wallGamesList();
    $('gallery-cat-name').textContent = wallTitle;
    const tag = $('gallery-search-tag');
    if (wallSearch) { tag.style.display = 'block'; tag.textContent = `"${wallSearch}"`; } else tag.style.display = 'none';
    $('gallery-count').textContent = `${galleryList.length} GAMES`;
    if (!galleryList.length) { grid.innerHTML = '<div class="couch-empty">NO GAMES</div>'; updateGalleryBg(null); return; }
    grid.innerHTML = galleryList.map((g, i) => {
        const coverArea = g.cover
            ? `<div class="gcell-cover-area"><img src="${g.cover}" alt="" loading="lazy" decoding="async"></div>`
            : `<div class="gcell-cover-area"><div class="gcell-noart">${escHtml(g.title)}</div></div>`;
        const footer = `<div class="gcell-footer"><div class="gcell-title">${escHtml(g.title)}</div><div class="gcell-footer-row"><button class="gcell-play-btn gcell-installed-btn">▶ PLAY</button></div></div>`;
        return `<div class="gcell" id="gcell-${i}" data-id="${g.id}" data-i="${i}">${coverArea}${footer}</div>`;
    }).join('');
    [...grid.querySelectorAll('.gcell')].forEach(el => el.onclick = () => { gridFocus = Number(el.dataset.i); openGamepage(Number(el.dataset.id)); });
}
function focusGrid(i) {   // CREMA updateGallerySelection: toggle .selected + keep centered + hero
    if (!galleryList.length) { updateGalleryBg(null); return; }
    gridFocus = clamp(i, 0, galleryList.length - 1);
    $('gallery-grid').querySelectorAll('.gcell').forEach((el, j) => el.classList.toggle('selected', j === gridFocus));
    const scroller = $('gallery-scroll'); const sel = $('gcell-' + gridFocus);
    if (scroller && sel) {
        if (gridFocus === 0) scroller.scrollTo({ top: 0, behavior: 'smooth' });
        else { const target = Math.max(0, sel.offsetTop - scroller.clientHeight / 2 + sel.offsetHeight / 2); scroller.scrollTo({ top: target, behavior: 'smooth' }); }
    }
    updateGalleryBg(galleryList[gridFocus]);
}
function updateGalleryBg(g) {   // CREMA updateGalleryBg: hero img + name + logo
    const img = $('gallery-hero-img'), name = $('gallery-hero-game-name'), logo = $('gallery-hero-logo');
    if (!g) { img.src = ''; img.style.display = 'none'; logo.src = ''; logo.style.display = 'none'; name.textContent = ''; return; }
    const src = g.hero || (g.screenshot ? String(g.screenshot).split('|')[0] : '') || g.cover || '';
    img.src = src; img.style.display = src ? 'block' : 'none';
    name.textContent = g.title || '';
    if (g.logo) { logo.src = g.logo; logo.style.display = 'block'; } else { logo.src = ''; logo.style.display = 'none'; }
}
function wallMove(dx, dy) {   // CREMA navigateGallery (9-col grid)
    const N = galleryList.length; if (!N) return; let idx = gridFocus;
    if (dx > 0) idx = (idx + 1) % N;
    else if (dx < 0) idx = (idx - 1 + N) % N;
    else if (dy > 0) { const next = idx + GALLERY_COLS; if (next < N) idx = next; }
    else if (dy < 0) { const prev = idx - GALLERY_COLS; if (prev >= 0) idx = prev; }
    if (idx !== gridFocus) focusGrid(idx);
}
function wallActivate() { const g = galleryList[gridFocus]; if (g) openGamepage(g.id); }
function wallCycleCategory(dir) {
    catIndex = clamp(catIndex + dir, 0, categories.length - 1);
    const c = categories[catIndex]; wallFilter = c.key; wallTitle = c.label;
    wallSearch = ''; renderWall(); focusGrid(0);
}

// ── GAMEPAGE ─────────────────────────────────────────────────────────────────
function openGamepage(id) {
    const g = gamesById.get(id); if (!g) return; gpGame = g;
    if (screen === 'wall' || screen === 'list') gpReturn = screen;   // B returns to whichever browse view
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


// ── Input dispatch (per active screen) ───────────────────────────────────────
function dispatchNav(dx, dy) {
    if (menuOpen) { if (dy) overlayMove(dy); return; }
    if (screen === 'start') { if (startMode === 'carousel') { if (dx) carouselMove(dx); } else tilesMove(dx, dy); }
    else if (screen === 'wall') wallMove(dx, dy);
    else if (screen === 'list') { if (dy) listMove(dy); else if (dx) listCycleCategory(dx); }
    else if (screen === 'gamepage') { if (dx) gpMove(dx); }
}
function dispatchConfirm() {
    if (menuOpen) { overlayConfirm(); return; }
    if (screen === 'start') selectCategory();
    else if (screen === 'wall') wallActivate();
    else if (screen === 'list') listActivate();
    else gpActivate();
}
function dispatchBack() {
    if (menuOpen) { overlayBack(); return; }
    if (!$('couch-now').classList.contains('hidden')) { hideNow(); return; }
    if (screen === 'gamepage') showScreen(gpReturn);
    else if (screen === 'wall' || screen === 'list') showScreen('start');
    else exitCouch();
}
function dispatchAux() { if (menuOpen) return; if (screen === 'start') toggleStartMode(); }
function dispatchShoulder(dir) { if (menuOpen) return; if (screen === 'wall') wallCycleCategory(dir); else if (screen === 'list') listCycleCategory(dir); }

document.addEventListener('keydown', e => {
    if (e.key === 'F11') { exitCouch(); return; }
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
        case 'm': case 'M': dispatchMenu(); break;
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
        if (edge(9)) dispatchMenu();         // Start → settings menu
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
