// EmuLatte Couch Mode renderer — Phase 3: Start (carousel + tiles) → Wall → Gamepage.
// Ported from CREMA's start carousel/mosaic + gamepage, adapted to emulatte.db + the fluid wall.
// See docs/couch-mode-plan.md.
const $ = id => document.getElementById(id);
const escHtml = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const hasArt = g => !!(g && (g.cover || g.logo || g.hero || (g.screenshot && String(g.screenshot).trim())));
const BLANK_IMG = 'data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=';   // 1×1 transparent — avoids the broken-image glyph
function setImg(el, src) { if (!el) return; if (src) { el.src = src; el.style.display = 'block'; } else { el.src = BLANK_IMG; el.style.display = 'none'; } }
function artPlaceholderHTML(g, cta = true) {   // big/bold/stylish "no artwork" panel + optional scrape CTA
    return `<div class="art-ph"><div class="art-ph-eyebrow">No Artwork</div>`
         + `<div class="art-ph-title">${escHtml(g.title)}</div>`
         + (cta ? `<div class="art-ph-cta"><span class="x">X</span> Scrape</div>` : '')
         + `</div>`;
}
function gcellMedia(g) {   // gallery card: screenshot background + logo on top (falls back to cover, then placeholder)
    const shot = g.screenshot ? String(g.screenshot).split('|').map(s => s.trim()).filter(Boolean)[0] : '';
    const bg = shot || g.cover || '';
    if (!bg) return artPlaceholderHTML(g);
    let html = `<img src="${bg}" alt="" loading="lazy" decoding="async">`;
    if (g.logo) html += `<div class="gcell-shot-grad"></div><img class="gcell-logo" src="${g.logo}" alt="" loading="lazy" decoding="async">`;
    return html;
}

let games = [], systems = [], gamesById = new Map(), categories = [];
let playlists = [], playlistGames = {};   // playlistGames[id] = [gameId,…]
async function loadPlaylists() {
    playlists = (await window.api.getPlaylists()) || [];
    playlistGames = {};
    for (const p of playlists) playlistGames[p.id] = (await window.api.getPlaylistGames(p.id)).map(g => g.id);
}
let screen = 'start';
let catIndex = 0, startMode = 'carousel';
let wallFilter = 'all', wallTitle = 'ALL GAMES', wallSearch = '', gridFocus = 0;
let browseMode = 'gallery', listFocus = 0, gpReturn = 'wall';
let gpGame = null, gpBtnFocus = 0;

// CREMA gamepad glyphs: logical face buttons (Gamepad API positions) → per-layout icon file in assets/gamepad_icons/.
// Fixed icons (dpad_*, L1, R1…) are used by data-btn name directly.
const GP_GLYPHS = {
    xbox:        { SOUTH: 'XBOX_A',        EAST: 'XBOX_B',              WEST: 'XBOX_X',          NORTH: 'XBOX_Y',             START: 'XBOX_start',        SELECT: 'XBOX_select' },
    playstation: { SOUTH: 'playstation_X', EAST: 'playstation_circle',  WEST: 'playstation_square', NORTH: 'playstation_triangle', START: 'playstation_start', SELECT: 'playstation_select' },
    nintendo:    { SOUTH: 'switch_b.300dpi', EAST: 'switch_a.300dpi',   WEST: 'switch_y.300dpi', NORTH: 'switch_x.300dpi',    START: 'switch_plus.300dpi', SELECT: 'switch_minus.300dpi' },
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
    couchSort = (await window.api.getSetting('couch_sort')) || 'alpha';
    heroShow = (await window.api.getSetting('couch_hero_show')) || 'both';
    [games, systems] = await Promise.all([window.api.getGames(), window.api.getSystems()]);
    gamesById = new Map(games.map(g => [g.id, g]));
    await loadPlaylists();
    buildCategories();
    renderCarousel(); renderTiles();
    showScreen('start');
}
let gpLayout = 'xbox';
function applyGamepadLayout(layout) {   // paint every .gp-glyph with the chosen layout's mask image
    gpLayout = GP_GLYPHS[layout] ? layout : 'xbox';
    const map = GP_GLYPHS[gpLayout];
    document.querySelectorAll('.gp-glyph').forEach(el => {
        const name = map[el.dataset.btn] || el.dataset.btn;   // mapped face button, or fixed icon name (dpad_*, L1…)
        el.style.webkitMaskImage = `url('assets/gamepad_icons/${name}.png')`;
    });
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
const SORT_OPTS    = [['A — Z', 'alpha'], ['Last Played', 'played'], ['Favourites First', 'favs'], ['Want to Play First', 'want'], ['Recently Added', 'added'], ['Scraped First', 'scraped']];
const HERO_OPTS    = [['Logo & Name', 'both'], ['Logo Only', 'logo'], ['Name Only', 'name']];
let couchSort = 'alpha', heroShow = 'both';
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
    const el = $('ov-' + overlayIndex); if (el) { el.classList.add('selected'); el.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
}
function overlayMove(dir) {
    const sel = overlayItems.map((it, i) => it[0] !== '§' ? i : -1).filter(i => i >= 0);
    let p = sel.indexOf(overlayIndex); if (p < 0) p = 0;
    overlayIndex = sel[(p + dir + sel.length) % sel.length]; highlightOverlay();
}
async function openMenu() {
    menuOpen = true; menuMode = 'main';
    renderOverlay('SETTINGS', ['§APPEARANCE', 'Color Theme', 'Carousel Label', 'Navigation Mode', 'Display Density', '§CONTROLS', 'Gamepad Icons', '§SYSTEM', 'Close Menu', 'Exit Couch Mode']);
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
    renderOverlay('GAMEPAD ICONS', ['§GAMEPAD ICONS', ...LAYOUT_OPTS.map(([l, v]) => v === cur ? '★ ' + l : l), 'Back']);
}
function openNavMenu() {
    menuMode = 'navmode';
    renderOverlay('NAVIGATION MODE', ['§NAVIGATION MODE', ...NAV_OPTS.map(([l, v]) => v === browseMode ? '★ ' + l : l), 'Back'], 'Gallery = cover wall · List = list + details.');
}
function openHeroMenu() {
    menuMode = 'hero';
    renderOverlay('CAROUSEL LABEL', ['§CAROUSEL LABEL', ...HERO_OPTS.map(([l, v]) => v === heroShow ? '★ ' + l : l), 'Back'], 'What the start carousel shows for each system.');
}
function openSortMenu() {   // opened with SELECT from gallery/list — same options as EmuLatte's gallery sort
    menuOpen = true; menuMode = 'sort';
    renderOverlay('SORT BY', ['§SORT BY', ...SORT_OPTS.map(([l, v]) => v === couchSort ? '★ ' + l : l)]);
}
function resortActive() { if (screen === 'wall') { renderWall(); focusGrid(0); } else if (screen === 'list') { renderList(); listSelect(0); } }

// ── Playlists (gamepage: add/remove this game) ───────────────────────────────
let _plGame = null;
async function openPlaylistsMenu(keepIdx) {
    _plGame = gpGame; if (!_plGame) return;
    const inIds = new Set(await window.api.getGamePlaylists(_plGame.id));
    menuOpen = true; menuMode = 'playlists';
    const items = playlists.map(p => (inIds.has(p.id) ? '★ ' : '○ ') + p.name);
    renderOverlay('PLAYLISTS', ['§' + (_plGame.title || '').toUpperCase(), ...items, '✛ New Playlist…', 'Back'],
                  'A toggles · ★ in playlist · ○ not in playlist');
    if (keepIdx != null) { overlayIndex = Math.min(keepIdx, overlayItems.length - 1); highlightOverlay(); }
}
async function togglePlaylistForGame(name, keepIdx) {
    const p = playlists.find(pl => pl.name === name); if (!p || !_plGame) return;
    const inIds = new Set(playlistGames[p.id] || []);
    if (inIds.has(_plGame.id)) await window.api.removeGameFromPlaylist(p.id, _plGame.id);
    else await window.api.addGameToPlaylist(p.id, _plGame.id);
    await loadPlaylists(); buildCategories();
    openPlaylistsMenu(keepIdx);
}
async function createPlaylistForGame(name) {
    name = (name || '').trim();
    if (name && _plGame) { const id = await window.api.addPlaylist(name); if (id) await window.api.addGameToPlaylist(id, _plGame.id); await loadPlaylists(); buildCategories(); }
    openPlaylistsMenu();
}
function applyDensity(v) { const d = v === 'auto' ? autoDensity() : (parseFloat(v) || 1); if (window.api.setZoom) window.api.setZoom(d); }
function overlayConfirm() {
    const raw = String(overlayItems[overlayIndex] || '').replace('★ ', '');
    if (menuMode === 'main') {
        if (raw === 'Color Theme') openThemeMenu();
        else if (raw === 'Carousel Label') openHeroMenu();
        else if (raw === 'Navigation Mode') openNavMenu();
        else if (raw === 'Display Density') openDensityMenu();
        else if (raw === 'Gamepad Icons') openLayoutMenu();
        else if (raw === 'Close Menu') closeMenu();
        else if (raw === 'Exit Couch Mode') exitCouch();
        return;
    }
    if (menuMode === 'playlists') {
        const name = String(overlayItems[overlayIndex] || '').replace(/^[★○] /, '');
        if (name === 'Back') { closeMenu(); return; }
        if (name === '✛ New Playlist…') { openOSK({ mode: 'text', title: 'NEW PLAYLIST', onDone: createPlaylistForGame }); return; }
        togglePlaylistForGame(name, overlayIndex);
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
    else if (menuMode === 'sort') {
        const o = SORT_OPTS.find(([l]) => l === raw);
        if (o) { couchSort = o[1]; window.api.setSetting('couch_sort', o[1]); closeMenu(); resortActive(); }
    }
    else if (menuMode === 'hero') {
        const o = HERO_OPTS.find(([l]) => l === raw);
        if (o) { heroShow = o[1]; window.api.setSetting('couch_hero_show', o[1]); if (startMode === 'carousel') selectedHero(); openHeroMenu(); }
    }
}
function overlayBack() { if (menuMode === 'main' || menuMode === 'sort' || menuMode === 'playlists') closeMenu(); else openMenu(); }
function dispatchMenu() { if (menuOpen) closeMenu(); else openMenu(); }
function dispatchSort() { if (oskOpen || menuOpen || _scraping) return; if (screen === 'wall' || screen === 'list') openSortMenu(); }

// ── OSK search (CREMA on-screen keyboard) ────────────────────────────────────
const OSK_COLS = 7, OSK_ROWS = 6;
const OSK_KEYS = [
    ['A', 'B', 'C', 'D', 'E', 'F', 'G'],
    ['H', 'I', 'J', 'K', 'L', 'M', 'N'],
    ['O', 'P', 'Q', 'R', 'S', 'T', 'U'],
    ['V', 'W', 'X', 'Y', 'Z', '0', '1'],
    ['2', '3', '4', '5', '6', '7', '8'],
    ['9', 'SPACE', 'BKSP', 'CLEAR', 'DONE', '.', '-'],
];
let oskOpen = false, oskR = 0, oskC = 0, oskMode = 'search', oskBuf = '', oskDone = null;
function openOSK(opts = {}) {   // mode 'search' (live-filters) or 'text' (buffer + onDone callback)
    oskMode = opts.mode || 'search'; oskBuf = opts.initial || ''; oskDone = opts.onDone || null;
    $('osk-title').textContent = opts.title || 'SEARCH';
    oskOpen = true; oskR = 0; oskC = 0;
    $('osk-backdrop').classList.remove('hidden'); renderOSK();
}
function closeOSK() { oskOpen = false; oskDone = null; $('osk-backdrop').classList.add('hidden'); }
function oskGet() { return oskMode === 'search' ? wallSearch : oskBuf; }
function oskSet(v) { if (oskMode === 'search') { wallSearch = v; applySearchLive(); } else oskBuf = v; renderOSK(); }
function renderOSK() {
    const s = oskGet(); $('osk-query').textContent = s + (s.length < 50 ? '_' : '');
    const grid = $('osk-grid'); grid.innerHTML = '';
    for (let r = 0; r < OSK_ROWS; r++) for (let c = 0; c < OSK_COLS; c++) {
        const d = document.createElement('div');
        d.className = 'osk-key' + (r === oskR && c === oskC ? ' sel' : '');
        d.textContent = OSK_KEYS[r][c];
        d.onclick = () => { oskR = r; oskC = c; oskActivate(); };
        grid.appendChild(d);
    }
}
function applySearchLive() { if (browseMode === 'list') { renderList(); listSelect(0); } else { renderWall(); focusGrid(0); } }
function oskNav(dx, dy) {
    if (dy) oskR = (oskR + dy + OSK_ROWS) % OSK_ROWS;
    if (dx) oskC = (oskC + dx + OSK_COLS) % OSK_COLS;
    renderOSK();
}
function oskActivate() {
    const key = OSK_KEYS[oskR][oskC]; let s = oskGet();
    if (key === 'SPACE') s += ' ';
    else if (key === 'BKSP') s = s.slice(0, -1);
    else if (key === 'CLEAR') s = '';
    else if (key === 'DONE') { const fn = oskDone, val = oskGet(); closeOSK(); if (fn) fn(val); return; }
    else s += key;
    oskSet(s);
}
function oskClear() { oskSet(''); }
function oskTypeChar(ch) { oskSet(oskGet() + ch); }
function oskBackspace() { oskSet(oskGet().slice(0, -1)); }

// ── Categories / media ───────────────────────────────────────────────────────
// System logos keyed by the (stable) short_name, files in assets/logos/ (mostly SVG, a few PNG).
const SYS_LOGOS = {
    '3do': '3DO-Logo.png', fbn: 'fbneo.png', mame: 'MAMELogo.svg',
    a2600: 'Atari_2600_logo-01-04.svg', jaguar: 'Atari_Jaguar_logo.svg', lynx: 'Atari_Lynx_logo.svg',
    fds: 'Family_Computer_Disk_System_logo.svg', gb: 'Nintendo_Game_Boy_Logo.svg', gba: 'Game_Boy_Advance_logo.svg',
    gbc: 'Game_Boy_Color_logo.svg', pce: 'PC_engine_logo_red.svg', neogeo: 'Neogeo-logo.svg',
    ngpc: 'Neo_Geo_Pocket_Color_logo.svg', n64: 'Nintendo_64_wordmark.svg', nds: 'Nintendo_DS_Logo.svg',
    nes: 'NES.png', gc: 'nintendo gamecube.png', wii: 'Wii.svg',
    scummvm: 'ScummVM__Modern_Remastered__Logo.svg', segacd: 'Sega_CD_Logo.svg', dc: 'Dreamcast_logo_NTSC.svg',
    sms: 'Master_System_Logo.svg', genesis: 'segagenesis.png', saturn: 'sega saturn.png',
    ps1: 'PlayStation_logo_and_wordmark.svg', ps2: 'PlayStation_2_logo.svg', snes: 'Super_Nintendo_Entertainment_System_logo.svg',
};
const sysLogo = short => SYS_LOGOS[short] ? encodeURI('assets/logos/' + SYS_LOGOS[short]) : '';   // encodeURI handles spaces in filenames
function buildCategories() {
    const counts = {}; games.forEach(g => counts[g.system_id] = (counts[g.system_id] || 0) + 1);
    const sys = systems.filter(s => counts[s.id]).map(s => ({ key: 'sys:' + s.id, label: s.name, count: counts[s.id], logo: sysLogo(s.short_name) }))
                       .sort((a, b) => (a.label || '').localeCompare(b.label || ''));
    categories = [{ key: 'all', label: 'ALL GAMES', count: games.length }];
    const favs = games.filter(g => g.fav).length;
    if (favs) categories.push({ key: 'favs', label: 'FAVOURITES', count: favs });
    categories.push({ key: 'recent', label: 'RECENT', count: Math.min(games.filter(g => g.last_played).length, 60) });
    categories = categories.concat(sys);
    // Playlists last (so a left-wrap from the first item lands on them) — tagged for the "Playlist" subtitle
    const pls = playlists.map(p => ({ key: 'pl:' + p.id, label: p.name, count: (playlistGames[p.id] || []).length, type: 'playlist', plId: p.id }));
    categories = categories.concat(pls);
}
function gamesInCategory(key) {
    if (key === 'favs')   return games.filter(g => g.fav);
    if (key === 'recent') return [...games].sort((a, b) => (b.last_played || 0) - (a.last_played || 0)).slice(0, 60);
    if (key.startsWith('sys:')) { const id = Number(key.slice(4)); return games.filter(g => g.system_id === id); }
    if (key.startsWith('pl:'))  { const ids = new Set(playlistGames[Number(key.slice(3))] || []); return games.filter(g => ids.has(g.id)); }
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
function categoryCount(c) { const n = c.count || 0; return `${n.toLocaleString()} ${n === 1 ? 'GAME' : 'GAMES'}`; }
function selectedHero() {   // category name + stylish subtitle (Playlist tag + game count) over the cover mosaic
    const c = categories[catIndex];
    const logoEl = $('cz-hero-logo'), nameEl = $('cz-hero-name');
    const showLogo = !!c.logo && heroShow !== 'name';
    const showName = heroShow === 'both' || heroShow === 'name' || !showLogo;   // always fall back to the name when no logo
    if (showLogo) { logoEl.src = c.logo; logoEl.style.display = 'block'; } else { logoEl.removeAttribute('src'); logoEl.style.display = 'none'; }
    nameEl.style.display = showName ? 'block' : 'none';
    nameEl.textContent = c.label;
    const tag = $('cz-hero-tag');
    if (c.type === 'playlist') { tag.style.display = 'inline-block'; tag.textContent = 'Playlist'; } else tag.style.display = 'none';
    $('cz-hero-sub').textContent = categoryCount(c);
    fillMosaic(c.key);
}

// ── START: carousel (full-screen hero per category; nav with ◄ ►) ────────────
function renderCarousel() { selectedHero(); }
function carouselMove(dir) { const n = categories.length; catIndex = (catIndex + dir + n) % n; selectedHero(); }   // infinite roll (wraps)

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
    const bg = $('cover-backdrop'), ss = $('screenshot-player'), mini = $('cover-mini'), logo = $('list-logo'), topgrad = $('list-media-topgrad'), noart = $('list-noart');
    const shots = g.screenshot ? String(g.screenshot).split('|').map(s => s.trim()).filter(Boolean) : [];
    // Main media: a screenshot (cycling if several); fall back to hero/cover when there's none.
    if (shots.length) {
        let k = 0; setImg(ss, shots[0]); ss.classList.add('active');
        setImg(bg, ''); bg.classList.remove('active');
        if (shots.length > 1) _ssTimer = setInterval(() => { k = (k + 1) % shots.length; ss.src = shots[k]; }, 4000);
    } else {
        setImg(ss, ''); ss.classList.remove('active');
        const fb = g.hero || g.cover || '';
        setImg(bg, fb); bg.classList.toggle('active', !!fb);
    }
    // Logo on top (over a gradient for legibility)
    setImg(logo, g.logo || ''); topgrad.style.display = g.logo ? 'block' : 'none';
    // Box art (the small cover) — keep
    if (g.cover) { setImg(mini, g.cover); mini.classList.remove('hidden'); } else { setImg(mini, ''); mini.classList.add('hidden'); }
    if (hasArt(g)) { noart.style.display = 'none'; noart.innerHTML = ''; }
    else { noart.innerHTML = artPlaceholderHTML(g); noart.style.display = 'block'; }
}
function clearListDetail() {
    clearInterval(_ssTimer);
    ['stat-system', 'stat-release', 'stat-dev', 'stat-pub', 'stat-genre', 'stat-players'].forEach(id => $(id).textContent = '--');
    $('game-desc').textContent = '';
    setImg($('cover-backdrop'), ''); $('cover-backdrop').classList.remove('active');
    setImg($('screenshot-player'), ''); $('screenshot-player').classList.remove('active');
    setImg($('list-logo'), ''); $('list-media-topgrad').style.display = 'none';
    setImg($('cover-mini'), ''); $('cover-mini').classList.add('hidden');
    $('list-noart').style.display = 'none'; $('list-noart').innerHTML = '';
}
function listMove(dy) { if (dy) listSelect(listFocus + dy); }
function listActivate() { const g = listList[listFocus]; if (g) openGamepage(g.id); }
function listCycleCategory(dir) {
    const n = categories.length; catIndex = (catIndex + dir + n) % n;   // infinite roll
    const c = categories[catIndex]; wallFilter = c.key; wallTitle = c.label;
    renderList(); listSelect(0);
}

// ── WALL ─────────────────────────────────────────────────────────────────────
// ── GALLERY (CREMA gallery-screen: hero banner + responsive auto-fill grid) ──
let galleryList = [];   // cached current category list (avoids re-filter/sort on every nav)
function galleryCols() {   // actual columns in the responsive grid (cells sharing the first row's offsetTop)
    const cells = $('gallery-grid').querySelectorAll('.gcell');
    if (cells.length < 2) return 1;
    const top0 = cells[0].offsetTop; let c = 1;
    for (let i = 1; i < cells.length; i++) { if (cells[i].offsetTop === top0) c++; else break; }
    return c;
}
function enterWall() {
    wallSearch = '';
    renderWall(); showScreen('wall'); focusGrid(0);
}
function wallGamesList() {
    let list = gamesInCategory(wallFilter);
    if (wallSearch) { const q = wallSearch.toLowerCase(); list = list.filter(g => (g.title || '').toLowerCase().includes(q)); }
    return sortCouch(list);
}
const _isScraped = g => !!(g.cover || g.logo || g.screenshot || g.description);   // mirrors renderer isScraped
function sortCouch(list) {   // same sort options as EmuLatte's gallery (currentSort)
    const byTitle = (a, b) => (a.title || '').localeCompare(b.title || '', undefined, { sensitivity: 'base' });
    const arr = [...list];
    switch (couchSort) {
        case 'played':  return arr.sort((a, b) => (b.last_played || 0) - (a.last_played || 0) || byTitle(a, b));
        case 'favs':    return arr.sort((a, b) => (b.fav ? 1 : 0) - (a.fav ? 1 : 0) || byTitle(a, b));
        case 'want':    return arr.sort((a, b) => (b.want ? 1 : 0) - (a.want ? 1 : 0) || byTitle(a, b));
        case 'added':   return arr.sort((a, b) => (b.id || 0) - (a.id || 0));
        case 'scraped': return arr.sort((a, b) => (_isScraped(b) ? 1 : 0) - (_isScraped(a) ? 1 : 0) || byTitle(a, b));
        default:        return arr.sort(byTitle);   // 'alpha'
    }
}
function renderWall() {
    const grid = $('gallery-grid'); galleryList = wallGamesList();
    $('gallery-cat-name').textContent = wallTitle;
    const tag = $('gallery-search-tag');
    if (wallSearch) { tag.style.display = 'block'; tag.textContent = `"${wallSearch}"`; } else tag.style.display = 'none';
    $('gallery-count').textContent = `${galleryList.length} GAMES`;
    if (!galleryList.length) { grid.innerHTML = '<div class="couch-empty">NO GAMES</div>'; updateGalleryBg(null); return; }
    grid.innerHTML = galleryList.map((g, i) => {
        const coverArea = `<div class="gcell-cover-area">${gcellMedia(g)}</div>`;
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
function wallMove(dx, dy) {   // CREMA navigateGallery, responsive column count
    const N = galleryList.length; if (!N) return; let idx = gridFocus; const cols = galleryCols();
    if (dx > 0) idx = (idx + 1) % N;
    else if (dx < 0) idx = (idx - 1 + N) % N;
    else if (dy > 0) { const next = idx + cols; if (next < N) idx = next; }
    else if (dy < 0) { const prev = idx - cols; if (prev >= 0) idx = prev; }
    if (idx !== gridFocus) focusGrid(idx);
}
function wallActivate() { const g = galleryList[gridFocus]; if (g) openGamepage(g.id); }
function wallCycleCategory(dir) {
    const n = categories.length; catIndex = (catIndex + dir + n) % n;   // infinite roll
    const c = categories[catIndex]; wallFilter = c.key; wallTitle = c.label;
    wallSearch = ''; renderWall(); focusGrid(0);
}

// ── GAMEPAGE ─────────────────────────────────────────────────────────────────
function openGamepage(id) {
    const g = gamesById.get(id); if (!g) return; gpGame = g;
    if (screen === 'wall' || screen === 'list') gpReturn = screen;   // B returns to whichever browse view
    const hero = g.hero || (g.screenshot ? String(g.screenshot).split('|')[0] : '') || g.cover || '';
    const heroImg = $('gp-hero-img'); heroImg.src = hero; heroImg.style.display = hero ? 'block' : 'none';
    const logo = $('gp-logo'), title = $('gp-hero-title'), heroPh = $('gp-hero-ph');
    if (g.logo) { logo.src = g.logo; logo.style.display = 'block'; title.style.display = 'none'; heroPh.innerHTML = ''; }
    else if (hero) { logo.style.display = 'none'; title.style.display = 'block'; title.textContent = g.title || ''; heroPh.innerHTML = ''; }
    else { logo.style.display = 'none'; title.style.display = 'none'; heroPh.innerHTML = artPlaceholderHTML(g, false); }   // no art at all → stylish hero placeholder
    $('gp-cover').innerHTML = g.cover ? `<img src="${g.cover}">` : artPlaceholderHTML(g, false);
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
    const acts = [
        `<button class="gp-btn play" data-act="play">▶ PLAY</button>`,
        `<button class="gp-btn${g.fav ? ' active' : ''}" data-act="fav">${g.fav ? '★ FAV' : '+ FAV'}</button>`,
        `<button class="gp-btn${g.want ? ' active' : ''}" data-act="want">${g.want ? '♥ WANT' : 'WANT TO PLAY'}</button>`,
        `<button class="gp-btn" data-act="playlists">≡ PLAYLISTS</button>`,
    ];
    if (!hasArt(g)) acts.push(`<button class="gp-btn scrape" data-act="scrape">⟳ SCRAPE ARTWORK</button>`);
    $('gp-actions').innerHTML = acts.join('');
    [...$('gp-actions').querySelectorAll('.gp-btn')].forEach((b, i) => b.onclick = () => { gpBtnFocus = i; updateGpFocus(); gpActivate(); });
}
const gpButtons = () => [...$('gp-actions').querySelectorAll('.gp-btn')];
function updateGpFocus() { gpButtons().forEach((el, i) => el.classList.toggle('gp-focus', i === gpBtnFocus)); }
function gpMove(dx) { gpBtnFocus = clamp(gpBtnFocus + dx, 0, gpButtons().length - 1); updateGpFocus(); }
async function gpActivate() {
    const b = gpButtons()[gpBtnFocus]; if (!b) return;
    const act = b.dataset.act;
    if (act === 'play') launch(gpGame.id);
    else if (act === 'scrape') scrapeArtwork(gpGame.id);
    else if (act === 'playlists') openPlaylistsMenu();
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

// ── Scrape artwork (on-demand, from gallery/list/gamepage) ───────────────────
let _scraping = false;
async function scrapeArtwork(id) {
    if (_scraping) return; _scraping = true;
    const g = gamesById.get(id);
    const n = $('couch-now');
    n.classList.add('scraping');
    n.querySelector('.now-label').textContent = 'SCRAPING ARTWORK…';
    n.querySelector('.now-title').textContent = g ? g.title : '';
    n.querySelector('.now-art').style.backgroundImage = 'none';
    n.classList.remove('hidden');
    let r;
    try { r = await window.api.scrapeGame(id); } catch (e) { r = { ok: false, error: String(e && e.message || e) }; }
    _scraping = false;
    if (!r || !r.ok) {   // surface the error (e.g. credentials not set) then auto-dismiss
        n.querySelector('.now-label').textContent = (r && r.error) ? r.error : 'SCRAPE FAILED';
        clearTimeout(_nowTimer); _nowTimer = setTimeout(() => { n.classList.remove('scraping'); hideNow(); }, 3500);
        return;
    }
    // reload games so the new artwork shows everywhere, then refresh the active view
    games = await window.api.getGames();
    gamesById = new Map(games.map(x => [x.id, x]));
    if (gpGame) gpGame = gamesById.get(gpGame.id) || gpGame;
    n.classList.remove('scraping'); hideNow();
    if (screen === 'gamepage') openGamepage(id);
    else if (screen === 'wall') { renderWall(); focusGrid(gridFocus); }
    else if (screen === 'list') { renderList(); listSelect(listFocus); }
}
function dispatchScrape() {   // X — scrape the focused/current game if it lacks artwork
    if (oskOpen || menuOpen || _scraping) return;
    let g = null;
    if (screen === 'wall') g = galleryList[gridFocus];
    else if (screen === 'list') g = listList[listFocus];
    else if (screen === 'gamepage') g = gpGame;
    if (g && !hasArt(g)) scrapeArtwork(g.id);
}


// ── Input dispatch (per active screen) ───────────────────────────────────────
function dispatchNav(dx, dy) {
    if (oskOpen) { oskNav(dx, dy); return; }
    if (menuOpen) { if (dy) overlayMove(dy); return; }
    if (screen === 'start') { if (startMode === 'carousel') { if (dx) carouselMove(dx); } else tilesMove(dx, dy); }
    else if (screen === 'wall') wallMove(dx, dy);
    else if (screen === 'list') { if (dy) listMove(dy); else if (dx) listCycleCategory(dx); }
    else if (screen === 'gamepage') { if (dx) gpMove(dx); }
}
function dispatchConfirm() {
    if (oskOpen) { oskActivate(); return; }
    if (menuOpen) { overlayConfirm(); return; }
    if (screen === 'start') selectCategory();
    else if (screen === 'wall') wallActivate();
    else if (screen === 'list') listActivate();
    else gpActivate();
}
function dispatchBack() {
    if (oskOpen) { closeOSK(); return; }
    if (menuOpen) { overlayBack(); return; }
    if (!$('couch-now').classList.contains('hidden')) { hideNow(); return; }
    if (screen === 'gamepage') showScreen(gpReturn);
    else if (screen === 'wall' || screen === 'list') showScreen('start');
    else exitCouch();
}
function dispatchAux() {   // Y
    if (oskOpen) { oskClear(); return; }
    if (menuOpen) return;
    if (screen === 'start') toggleStartMode();
    else if (screen === 'wall' || screen === 'list') openOSK();   // CREMA: Y opens search
}
function dispatchShoulder(dir) { if (oskOpen || menuOpen) return; if (screen === 'wall') wallCycleCategory(dir); else if (screen === 'list') listCycleCategory(dir); }

document.addEventListener('keydown', e => {
    if (e.key === 'F11') { exitCouch(); return; }
    // While the OSK is open, type directly on a physical keyboard (CREMA parity)
    if (oskOpen) {
        if (e.key === 'Backspace') { oskBackspace(); e.preventDefault(); return; }
        if (e.key.length === 1 && /[a-z0-9 .\-]/i.test(e.key)) { oskTypeChar(e.key.toUpperCase()); e.preventDefault(); return; }
    }
    switch (e.key) {
        case 'ArrowUp':    dispatchNav(0, -1); e.preventDefault(); break;
        case 'ArrowDown':  dispatchNav(0, 1);  e.preventDefault(); break;
        case 'ArrowLeft':  dispatchNav(-1, 0); e.preventDefault(); break;
        case 'ArrowRight': dispatchNav(1, 0);  e.preventDefault(); break;
        case 'Enter':      dispatchConfirm();  break;
        case 'Escape': case 'Backspace': dispatchBack(); break;
        case 'Tab': case 'y': case 'Y': dispatchAux(); e.preventDefault(); break;
        case 'x': case 'X': dispatchScrape(); break;
        case 's': case 'S': dispatchSort(); break;
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
        if (edge(2)) dispatchScrape();       // X → scrape artwork
        if (edge(3)) dispatchAux();          // Y
        if (edge(4)) dispatchShoulder(-1);   // LB
        if (edge(5)) dispatchShoulder(1);    // RB
        if (edge(8)) dispatchSort();         // Select → sort
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
