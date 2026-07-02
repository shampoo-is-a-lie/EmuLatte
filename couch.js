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

// ── Cover frame: full natural proportion + faux CD jewel case (mirrors desktop EmuLatte) ──
const JEWEL_SYS = new Set(['ps1', 'saturn', 'segacd', 'dc', 'pcecd', 'pcfx', 'neocd', '3do']);
const isJewel = g => JEWEL_SYS.has(String(g && g.system_short || '').toLowerCase());
const JEWEL_AR_MIN = 0.88, JEWEL_AR_MAX = 1.20;
const coverFrameHTML = g => `<div class="cover-frame"><img src="${g.cover}" alt=""></div>`;
function applyCoverFrame(g, frame, img) {   // jewel case only for square-ish art on CD systems; else the art's full natural ratio
    if (!frame || !img) return;
    frame.classList.remove('jewel');
    if (!isJewel(g)) return;
    const decide = () => { const w = img.naturalWidth, h = img.naturalHeight; if (w && h) frame.classList.toggle('jewel', (w / h) >= JEWEL_AR_MIN && (w / h) <= JEWEL_AR_MAX); };
    if (img.complete && img.naturalWidth) decide(); else img.addEventListener('load', decide, { once: true });
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
    heroShow = (await window.api.getSetting('couch_hero_show')) || 'name';
    retroOn = (await window.api.getSetting('couch_retro')) === '1'; document.body.classList.toggle('retro', retroOn);
    crtOn = (await window.api.getSetting('couch_crt_layout')) === '1'; document.body.classList.toggle('crt', crtOn);
    if (crtOn) browseMode = 'list';   // CRT defaults to List view (per-session; the saved non-CRT preference is untouched)
    returnCombo = (await window.api.getSetting('couch_return_combo')) || 'START + SELECT';
    saverDelayMin = Number((await window.api.getSetting('couch_screensaver')) ?? '3') || 0;
    sfxOn = (await window.api.getSetting('couch_sfx')) !== '0';
    bgmMode = (await window.api.getSetting('couch_bgm_mode')) || 'off';
    const vRaw = await window.api.getSetting('couch_vol'); vol = vRaw == null ? 0.3 : (Number(vRaw) || 0);
    initAudio();
    [games, systems] = await Promise.all([window.api.getGames(), window.api.getSystems()]);
    gamesById = new Map(games.map(g => [g.id, g]));
    await loadPlaylists();
    buildCategories();
    renderCarousel(); renderTiles();
    showScreen('start');
    resetIdle();
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

// ── Themes (full set ported from CafeNeurotico/CREMA) ──
const THEMES = {
  "DARK GRAY": {bg: "#141414", bg_panel: "rgba(0,0,0,0.5)", bg_menu: "#222222", accent: "#ffffff", accent_menu: "#00e5ff", text_main: "#ffffff", text_sec: "#bbbbbb", text_dim: "#777777", border: "rgba(255,255,255,0.1)", border_solid: "#555555"},
  "CREMA (DEFAULT)": {bg: "#2C1E16", bg_panel: "rgba(67, 40, 24, 0.6)", bg_menu: "#432818", accent: "#D4A373", accent_menu: "#D4A373", text_main: "#FFE6A7", text_sec: "#E6CC98", text_dim: "#A47148", border: "rgba(212, 163, 115, 0.2)", border_solid: "#8B5A2B"},
  "CYBERPUNK": {bg: "#09090b", bg_panel: "rgba(26, 26, 46, 0.7)", bg_menu: "#1a1a2e", accent: "#f3e600", accent_menu: "#00ffcc", text_main: "#00ffcc", text_sec: "#e0e0e0", text_dim: "#ff003c", border: "rgba(243, 230, 0, 0.2)", border_solid: "#ff003c"},
  "VAPOUR OS": {bg: "#171a21", bg_panel: "rgba(27, 40, 56, 0.7)", bg_menu: "#1b2838", accent: "#66c0f4", accent_menu: "#66c0f4", text_main: "#c7d5e0", text_sec: "#8f98a0", text_dim: "#556b82", border: "rgba(102, 192, 244, 0.2)", border_solid: "#2a475e"},
  "PSIV BLUE": {bg: "#000022", bg_panel: "rgba(0, 67, 156, 0.4)", bg_menu: "#001144", accent: "#ffffff", accent_menu: "#0070cc", text_main: "#ffffff", text_sec: "#aaaaaa", text_dim: "#666666", border: "rgba(0, 112, 204, 0.3)", border_solid: "#00439c"},
  "GREEN BOX": {bg: "#0e0e0e", bg_panel: "rgba(82, 176, 67, 0.10)", bg_menu: "#111111", accent: "#52b043", accent_menu: "#107C10", text_main: "#ffffff", text_sec: "#a8d8a4", text_dim: "#3d8030", border: "rgba(82, 176, 67, 0.22)", border_solid: "#1a3d1a"},
  "MOVIESFLIX": {bg: "#141414", bg_panel: "rgba(255, 255, 255, 0.07)", bg_menu: "#000000", accent: "#e50914", accent_menu: "#e50914", text_main: "#ffffff", text_sec: "#b3b3b3", text_dim: "#6d6d6d", border: "rgba(229, 9, 20, 0.30)", border_solid: "#404040"},
  "SNOW": {bg: "#0a1628", bg_panel: "rgba(32, 68, 110, 0.65)", bg_menu: "#0f2040", accent: "#93d0f0", accent_menu: "#b8e4f8", text_main: "#e8f4ff", text_sec: "#8bbbd8", text_dim: "#4a7898", border: "rgba(147, 208, 240, 0.18)", border_solid: "#1c4060"},
  "WIN XP": {bg: "#0055e5", bg_panel: "rgba(236, 233, 216, 0.3)", bg_menu: "#003399", accent: "#ffd700", accent_menu: "#ffd700", text_main: "#ffffff", text_sec: "#ece9d8", text_dim: "#c0c0c0", border: "rgba(255, 255, 255, 0.3)", border_solid: "#4fcc3a"},
  "PSIII CLASSIC": {bg: "#000000", bg_panel: "rgba(25, 25, 25, 0.7)", bg_menu: "#111111", accent: "#dcdcdc", accent_menu: "#ffffff", text_main: "#ffffff", text_sec: "#aaaaaa", text_dim: "#666666", border: "rgba(255, 255, 255, 0.2)", border_solid: "#444444"},
  "PSIII RED": {bg: "#2b0000", bg_panel: "rgba(40, 0, 0, 0.7)", bg_menu: "#1a0000", accent: "#ff4d4d", accent_menu: "#ff4d4d", text_main: "#ffffff", text_sec: "#ffcccc", text_dim: "#cc6666", border: "rgba(255, 77, 77, 0.2)", border_solid: "#800000"},
  "PSIII GREEN": {bg: "#001a00", bg_panel: "rgba(0, 30, 0, 0.7)", bg_menu: "#000d00", accent: "#4dff4d", accent_menu: "#4dff4d", text_main: "#ffffff", text_sec: "#ccffcc", text_dim: "#66cc66", border: "rgba(77, 255, 77, 0.2)", border_solid: "#004d00"},
  "PSIII BLUE": {bg: "#000a1a", bg_panel: "rgba(0, 15, 30, 0.7)", bg_menu: "#00050d", accent: "#4d94ff", accent_menu: "#4d94ff", text_main: "#ffffff", text_sec: "#cce0ff", text_dim: "#66a3ff", border: "rgba(77, 148, 255, 0.2)", border_solid: "#003380"},
  "PSIII PURPLE": {bg: "#1a001a", bg_panel: "rgba(30, 0, 30, 0.7)", bg_menu: "#0d000d", accent: "#d24dff", accent_menu: "#d24dff", text_main: "#ffffff", text_sec: "#f0ccff", text_dim: "#c266cc", border: "rgba(210, 77, 255, 0.2)", border_solid: "#800080"},
  "PSIII GOLD": {bg: "#261a00", bg_panel: "rgba(40, 25, 0, 0.7)", bg_menu: "#130d00", accent: "#ffcc00", accent_menu: "#ffcc00", text_main: "#ffffff", text_sec: "#ffeecc", text_dim: "#cca300", border: "rgba(255, 204, 0, 0.2)", border_solid: "#997300"},
  "PSIII SILVER": {bg: "#1a1a1a", bg_panel: "rgba(35, 35, 35, 0.7)", bg_menu: "#0d0d0d", accent: "#cccccc", accent_menu: "#cccccc", text_main: "#ffffff", text_sec: "#e6e6e6", text_dim: "#999999", border: "rgba(204, 204, 204, 0.2)", border_solid: "#666666"},
  "DRACULA": {bg: "#282a36", bg_panel: "rgba(68, 71, 90, 0.7)", bg_menu: "#44475a", accent: "#bd93f9", accent_menu: "#ff79c6", text_main: "#f8f8f2", text_sec: "#8be9fd", text_dim: "#8290bc", border: "rgba(189, 147, 249, 0.2)", border_solid: "#8290bc"},
  "GRUVBOX": {bg: "#282828", bg_panel: "rgba(60, 56, 54, 0.8)", bg_menu: "#3c3836", accent: "#fabd2f", accent_menu: "#fe8019", text_main: "#ebdbb2", text_sec: "#b8bb26", text_dim: "#a89984", border: "rgba(250, 189, 47, 0.2)", border_solid: "#504945"},
  "NORD": {bg: "#2e3440", bg_panel: "rgba(59, 66, 82, 0.8)", bg_menu: "#3b4252", accent: "#88c0d0", accent_menu: "#81a1c1", text_main: "#eceff4", text_sec: "#e5e9f0", text_dim: "#7a8ba0", border: "rgba(136, 192, 208, 0.2)", border_solid: "#5e6f84"},
  "SOLARIZED DARK": {bg: "#002b36", bg_panel: "rgba(7, 54, 66, 0.8)", bg_menu: "#073642", accent: "#2aa198", accent_menu: "#268bd2", text_main: "#839496", text_sec: "#93a1a1", text_dim: "#7a9196", border: "rgba(42, 161, 152, 0.2)", border_solid: "#1a5060"},
  "CATPPUCCIN MOCHA": {bg: "#1e1e2e", bg_panel: "rgba(30, 30, 46, 0.8)", bg_menu: "#181825", accent: "#cba6f7", accent_menu: "#f5c2e7", text_main: "#cdd6f4", text_sec: "#bac2de", text_dim: "#6c7086", border: "rgba(203, 166, 247, 0.2)", border_solid: "#313244"},
  "CATPPUCCIN MACCHIATO": {bg: "#24273a", bg_panel: "rgba(36, 39, 58, 0.8)", bg_menu: "#1e2030", accent: "#c6a0f6", accent_menu: "#f4b8e4", text_main: "#cad3f5", text_sec: "#b8c0e0", text_dim: "#6e738d", border: "rgba(198, 160, 246, 0.2)", border_solid: "#363a4f"},
  "CATPPUCCIN FRAPPÉ": {bg: "#303446", bg_panel: "rgba(48, 52, 70, 0.8)", bg_menu: "#292c3c", accent: "#ca9ee6", accent_menu: "#f2d5cf", text_main: "#c6d0f5", text_sec: "#b5bfe2", text_dim: "#737994", border: "rgba(202, 158, 230, 0.2)", border_solid: "#414559"},
  "TOKYO NIGHT": {bg: "#1a1b26", bg_panel: "rgba(36, 40, 59, 0.8)", bg_menu: "#16161e", accent: "#7aa2f7", accent_menu: "#bb9af7", text_main: "#c0caf5", text_sec: "#a9b1d6", text_dim: "#7885ac", border: "rgba(122, 162, 247, 0.2)", border_solid: "#3d4468"},
  "EVERFOREST": {bg: "#2b3339", bg_panel: "rgba(50, 56, 62, 0.8)", bg_menu: "#2f383e", accent: "#a7c080", accent_menu: "#e67e80", text_main: "#d3c6aa", text_sec: "#a7c080", text_dim: "#859289", border: "rgba(167, 192, 128, 0.2)", border_solid: "#4b565c"},
  "ROSÉ PINE": {bg: "#191724", bg_panel: "rgba(31, 29, 46, 0.8)", bg_menu: "#1f1d2e", accent: "#c4a7e7", accent_menu: "#ebbcba", text_main: "#e0def4", text_sec: "#9ccfd8", text_dim: "#6e6a86", border: "rgba(196, 167, 231, 0.2)", border_solid: "#26233a"},
  "GAME BOY DMG": {bg: "#0f380f", bg_panel: "rgba(48, 98, 48, 0.70)", bg_menu: "#1a4a1a", accent: "#9bbc0f", accent_menu: "#8bac0f", text_main: "#9bbc0f", text_sec: "#8bac0f", text_dim: "#306230", border: "rgba(155, 188, 15, 0.25)", border_solid: "#306230"},
  "PIP BOY": {bg: "#000000", bg_panel: "rgba(0, 20, 0, 0.7)", bg_menu: "#001100", accent: "#14ff00", accent_menu: "#14ff00", text_main: "#14ff00", text_sec: "#0ea000", text_dim: "#0a6000", border: "rgba(20, 255, 0, 0.2)", border_solid: "#0ea000"},
  "SEVASTOPOL": {bg: "#050d05", bg_panel: "rgba(10, 25, 10, 0.7)", bg_menu: "#081808", accent: "#f5e6b3", accent_menu: "#ff0000", text_main: "#f5e6b3", text_sec: "#a39977", text_dim: "#4d594d", border: "rgba(245, 230, 179, 0.1)", border_solid: "#1a331a"},
  "RIP AND TEAR CLASSIC": {bg: "#110000", bg_panel: "rgba(80, 5, 5, 0.78)", bg_menu: "#1a0000", accent: "#ff0000", accent_menu: "#cc0000", text_main: "#f5d020", text_sec: "#d0a000", text_dim: "#7a4400", border: "rgba(255, 0, 0, 0.22)", border_solid: "#5a0000"},
  "SUPER BROTHERS": {bg: "#5C94FC", bg_panel: "rgba(0, 0, 0, 0.75)", bg_menu: "#000070", accent: "#F8D820", accent_menu: "#F87020", text_main: "#ffffff", text_sec: "#F8D820", text_dim: "#6898F8", border: "rgba(248, 216, 32, 0.30)", border_solid: "#000000"},
  "GREEN HILL": {bg: "#0044AA", bg_panel: "rgba(0, 60, 0, 0.82)", bg_menu: "#003300", accent: "#F8D020", accent_menu: "#F8D020", text_main: "#ffffff", text_sec: "#A8E888", text_dim: "#50A050", border: "rgba(248, 208, 32, 0.30)", border_solid: "#006600"},
  "NES": {bg: "#18181A", bg_panel: "rgba(40, 38, 42, 0.85)", bg_menu: "#222024", accent: "#C42020", accent_menu: "#CC3030", text_main: "#F0F0F0", text_sec: "#C0B8C0", text_dim: "#706870", border: "rgba(196, 32, 32, 0.22)", border_solid: "#3C3A3E"},
  "SNES": {bg: "#1E1828", bg_panel: "rgba(50, 42, 80, 0.72)", bg_menu: "#160E20", accent: "#8060C8", accent_menu: "#A888E8", text_main: "#E8E0F0", text_sec: "#A890C8", text_dim: "#605090", border: "rgba(128, 96, 200, 0.22)", border_solid: "#302050"},
  "BLOODBORNE": {bg: "#0a0606", bg_panel: "rgba(60, 20, 10, 0.78)", bg_menu: "#150808", accent: "#c0952a", accent_menu: "#d4a838", text_main: "#e8d8b0", text_sec: "#b09070", text_dim: "#604830", border: "rgba(192, 149, 42, 0.22)", border_solid: "#4a1818"},
  "METROID PRIME": {bg: "#050a12", bg_panel: "rgba(255, 120, 20, 0.12)", bg_menu: "#080f1a", accent: "#ff6a00", accent_menu: "#ff8a30", text_main: "#e0f0ff", text_sec: "#60c8e0", text_dim: "#304858", border: "rgba(255, 106, 0, 0.22)", border_solid: "#1a2a3a"},
  "SILENT HILL": {bg: "#141210", bg_panel: "rgba(80, 50, 35, 0.72)", bg_menu: "#1a1510", accent: "#c85020", accent_menu: "#e06030", text_main: "#e0d0c0", text_sec: "#a09080", text_dim: "#605040", border: "rgba(200, 80, 32, 0.22)", border_solid: "#4a3020"},
  "DIABLO": {bg: "#0c0808", bg_panel: "rgba(80, 20, 0, 0.75)", bg_menu: "#140808", accent: "#e84000", accent_menu: "#c03000", text_main: "#f0d898", text_sec: "#c0a060", text_dim: "#705028", border: "rgba(232, 64, 0, 0.22)", border_solid: "#4a1a00"},
  "HALF-LIFE": {bg: "#141618", bg_panel: "rgba(245, 130, 32, 0.12)", bg_menu: "#1c1e20", accent: "#f58320", accent_menu: "#ff9a40", text_main: "#f0f0f0", text_sec: "#b0b8c0", text_dim: "#606870", border: "rgba(245, 131, 32, 0.22)", border_solid: "#2a3038"},
  "SHOVEL KNIGHT": {bg: "#1a1a2e", bg_panel: "rgba(30, 40, 80, 0.75)", bg_menu: "#100c20", accent: "#f8d840", accent_menu: "#f0c020", text_main: "#e8f0ff", text_sec: "#88b8f8", text_dim: "#4060a0", border: "rgba(248, 216, 64, 0.28)", border_solid: "#202858"},
  "EARTHY & ORGANIC": {bg: "#3E4E3A", bg_panel: "rgba(91, 107, 85, 0.7)", bg_menu: "#4F5D48", accent: "#D4B28C", accent_menu: "#A9C298", text_main: "#F3EDE4", text_sec: "#D8D3C8", text_dim: "#8E9E88", border: "rgba(212, 178, 140, 0.2)", border_solid: "#6b7d63"},
  "DOPAMINE BRIGHTS": {bg: "#080810", bg_panel: "rgba(255, 50, 120, 0.12)", bg_menu: "#100820", accent: "#FF2D78", accent_menu: "#00F5D4", text_main: "#ffffff", text_sec: "#FF80C0", text_dim: "#6030A0", border: "rgba(255, 45, 120, 0.28)", border_solid: "#2A0850"},
  "RETRO REVIVAL": {bg: "#2A1A10", bg_panel: "rgba(80, 50, 30, 0.70)", bg_menu: "#1E1008", accent: "#E8883A", accent_menu: "#4AAA98", text_main: "#F8E8C8", text_sec: "#C8A878", text_dim: "#7A5838", border: "rgba(232, 136, 58, 0.22)", border_solid: "#5A3820"},
  "VAPORWAVE": {bg: "#0d0221", bg_panel: "rgba(80, 10, 100, 0.65)", bg_menu: "#150330", accent: "#ff71ce", accent_menu: "#01cdfe", text_main: "#f0e0ff", text_sec: "#c080ff", text_dim: "#6030a0", border: "rgba(255, 113, 206, 0.25)", border_solid: "#35005a"},
  "AURORA": {bg: "#0a1520", bg_panel: "rgba(0, 80, 80, 0.55)", bg_menu: "#081018", accent: "#00e8c8", accent_menu: "#b060ff", text_main: "#d0f8f0", text_sec: "#78d8c8", text_dim: "#306858", border: "rgba(0, 232, 200, 0.20)", border_solid: "#0a4040"},
  "NOIR": {bg: "#0a0a0a", bg_panel: "rgba(45, 45, 45, 0.78)", bg_menu: "#151515", accent: "#d4a030", accent_menu: "#f0b838", text_main: "#e8e0d0", text_sec: "#a09888", text_dim: "#606058", border: "rgba(212, 160, 48, 0.20)", border_solid: "#303028"},
  "BIOLUMINESCENCE": {bg: "#020810", bg_panel: "rgba(0, 120, 120, 0.42)", bg_menu: "#030c18", accent: "#00e8a8", accent_menu: "#00ffc0", text_main: "#c0f8f0", text_sec: "#60d8c8", text_dim: "#206858", border: "rgba(0, 232, 168, 0.22)", border_solid: "#0a3838"},
  "BRUTALIST": {bg: "#1a1a1a", bg_panel: "rgba(80, 80, 80, 0.55)", bg_menu: "#222222", accent: "#e03000", accent_menu: "#ff4010", text_main: "#f0f0f0", text_sec: "#c0c0c0", text_dim: "#808080", border: "rgba(224, 48, 0, 0.25)", border_solid: "#404040"},
  "OXOCARBON": {bg: "#161616", bg_panel: "rgba(38, 38, 38, 0.85)", bg_menu: "#262626", accent: "#0f62fe", accent_menu: "#4589ff", text_main: "#f4f4f4", text_sec: "#c6c6c6", text_dim: "#8d8d8d", border: "rgba(15, 98, 254, 0.25)", border_solid: "#393939"},
  "MATERIAL DARK": {bg: "#1a1c1e", bg_panel: "rgba(40, 48, 56, 0.80)", bg_menu: "#212325", accent: "#4fc3f7", accent_menu: "#0288d1", text_main: "#e1e2e8", text_sec: "#c1c2cb", text_dim: "#8589a0", border: "rgba(79, 195, 247, 0.18)", border_solid: "#3a3f4a"},
  "N7": {bg: "#080c14", bg_panel: "rgba(20, 30, 60, 0.78)", bg_menu: "#0c1428", accent: "#cc0000", accent_menu: "#4488cc", text_main: "#e8eeff", text_sec: "#7aa0cc", text_dim: "#3d5880", border: "rgba(204, 0, 0, 0.25)", border_solid: "#1a2848"},
  "TRON LEGACY": {bg: "#000000", bg_panel: "rgba(0, 200, 255, 0.08)", bg_menu: "#000508", accent: "#00c8ff", accent_menu: "#ff8c00", text_main: "#ffffff", text_sec: "#80d8ff", text_dim: "#204858", border: "rgba(0, 200, 255, 0.28)", border_solid: "#0a1a20"},
  "DEAD SPACE": {bg: "#020202", bg_panel: "rgba(255, 100, 20, 0.10)", bg_menu: "#050505", accent: "#ff6400", accent_menu: "#ff8030", text_main: "#f0f0f0", text_sec: "#ff9060", text_dim: "#602010", border: "rgba(255, 100, 32, 0.25)", border_solid: "#200800"},
  "COLONY SHIP": {bg: "#10120e", bg_panel: "rgba(50, 60, 40, 0.72)", bg_menu: "#141810", accent: "#c8b040", accent_menu: "#e0c850", text_main: "#d8e0c0", text_sec: "#909a70", text_dim: "#485840", border: "rgba(200, 176, 64, 0.22)", border_solid: "#303820"},
  "NECROMORPH": {bg: "#030808", bg_panel: "rgba(0, 80, 20, 0.60)", bg_menu: "#040a04", accent: "#80ff20", accent_menu: "#60c010", text_main: "#c8ffc0", text_sec: "#70c060", text_dim: "#306020", border: "rgba(128, 255, 32, 0.22)", border_solid: "#0a2808"},
  "CRIMSON PEAK": {bg: "#120508", bg_panel: "rgba(80, 15, 30, 0.75)", bg_menu: "#1a080c", accent: "#d4904a", accent_menu: "#e0b060", text_main: "#f0e0d8", text_sec: "#c0909a", text_dim: "#7a3848", border: "rgba(212, 144, 74, 0.22)", border_solid: "#5a1520"},
  "LAKESIDE CURSE": {bg: "#0c0a08", bg_panel: "rgba(60, 40, 20, 0.72)", bg_menu: "#141008", accent: "#e09030", accent_menu: "#f0b040", text_main: "#f0e8d0", text_sec: "#b09070", text_dim: "#706050", border: "rgba(224, 144, 48, 0.22)", border_solid: "#402808"},
  "THE BACKROOMS": {bg: "#1a1810", bg_panel: "rgba(220, 200, 100, 0.10)", bg_menu: "#201e14", accent: "#d4c840", accent_menu: "#f0e050", text_main: "#f0e8c8", text_sec: "#b0a870", text_dim: "#706840", border: "rgba(212, 200, 64, 0.22)", border_solid: "#3a3820"}
};
const THEME_CATEGORIES = {
  "Originals & System": ["CREMA (DEFAULT)", "DARK GRAY", "CYBERPUNK", "SNOW", "MOVIESFLIX", "VAPOUR OS", "PSIV BLUE", "GREEN BOX", "WIN XP"],
  "Gaming Legends": ["GAME BOY DMG", "PIP BOY", "SEVASTOPOL", "RIP AND TEAR CLASSIC", "SUPER BROTHERS", "GREEN HILL", "NES", "SNES", "BLOODBORNE", "METROID PRIME", "SILENT HILL", "DIABLO", "HALF-LIFE", "SHOVEL KNIGHT"],
  "Aesthetics": ["EARTHY & ORGANIC", "DOPAMINE BRIGHTS", "RETRO REVIVAL", "VAPORWAVE", "AURORA", "NOIR", "BIOLUMINESCENCE", "BRUTALIST"],
  "Linux Ricing": ["DRACULA", "GRUVBOX", "NORD", "SOLARIZED DARK", "CATPPUCCIN FRAPPÉ", "CATPPUCCIN MACCHIATO", "CATPPUCCIN MOCHA", "TOKYO NIGHT", "EVERFOREST", "ROSÉ PINE", "OXOCARBON", "MATERIAL DARK"],
  "Sci-Fi Universes": ["N7", "TRON LEGACY", "DEAD SPACE", "COLONY SHIP", "NECROMORPH"],
  "Horror Realm": ["CRIMSON PEAK", "LAKESIDE CURSE", "THE BACKROOMS"],
  "PSIII Colors": ["PSIII CLASSIC", "PSIII RED", "PSIII GREEN", "PSIII BLUE", "PSIII PURPLE", "PSIII GOLD", "PSIII SILVER"]
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
const RETRO_OPTS   = [['Off', '0'], ['On', '1']];
const CRT_OPTS     = [['Off', '0'], ['On', '1']];
const SAVER_OPTS   = [['Off', '0'], ['1 min', '1'], ['3 min', '3'], ['5 min', '5'], ['10 min', '10']];
const COMBO_OPTS   = ['START + SELECT', 'L1 + R1 + START + SELECT', 'L3 + R3', 'START + SELECT (HOLD 2 SEC)', 'L1 + R1 + START + SELECT (HOLD 2 SEC)', 'L3 + R3 (HOLD 2 SEC)'];
const BGM_ORDER    = ['off', 'ambient', 'piano', 'jazz', 'lofi'];
const BGM_LABEL    = { off: 'Off', ambient: 'Ambient', piano: 'Piano', jazz: 'Jazz', lofi: 'Lo-Fi' };
let couchSort = 'alpha', heroShow = 'name', retroOn = false, crtOn = false, returnCombo = 'START + SELECT';

// ── Ambient sound (BGM + nav/select/back SFX, ported from CREMA) ──────────────
let sfxOn = true, bgmMode = 'off', vol = 0.3, _audioKicked = false;
let sfxNav = null, sfxSelect = null, sfxBack = null, bgmAudio = null;
function initAudio() {
    const bp = 'assets/sounds/';
    sfxNav = new Audio(bp + 'nav.wav'); sfxSelect = new Audio(bp + 'select.wav'); sfxBack = new Audio(bp + 'back.wav');
    bgmAudio = new Audio(); bgmAudio.loop = true;
}
function playSfx(a) { if (sfxOn && a) { try { a.currentTime = 0; a.play().catch(() => {}); } catch {} } }
function applyBgm() {
    if (!bgmAudio) return;
    if (bgmMode === 'off') { bgmAudio.pause(); return; }
    if (!bgmAudio.src.endsWith('bgm_' + bgmMode + '.mp3')) bgmAudio.src = 'assets/sounds/bgm_' + bgmMode + '.mp3';
    bgmAudio.volume = vol;
    if (_audioKicked) bgmAudio.play().catch(() => {});   // browsers only allow audio after a user gesture
}
function kickAudio() { if (_audioKicked) return; _audioKicked = true; applyBgm(); }   // start BGM on first user input
const getCfg = async (k, d) => (await window.api.getSetting(k)) || d;

function renderOverlay(title, items, hint) {
    overlayItems = items;
    const list = $('overlay-list'); $('overlay-title').textContent = title; list.dataset.mode = menuMode; list.innerHTML = '';
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
    renderOverlay('SETTINGS', ['§APPEARANCE', 'Color Theme', 'Full-Retro', 'CRT Mode (640x480)', 'Carousel Label', 'Navigation Mode', 'Display Density', 'Screensaver', '§AUDIO', 'Sound', '§CONTROLS', 'Gamepad Icons', 'Return Combo', '§SYSTEM', 'Manage Save States', 'Close Menu', 'Exit Couch Mode']);
}
function closeMenu() { menuOpen = false; $('overlay-backdrop').classList.add('hidden'); }
let _themeCat = null;
async function openThemeMenu() {   // level 1: theme categories
    menuMode = 'themecat'; _themeCat = null;
    renderOverlay('COLOR THEME', ['§CATEGORY', ...Object.keys(THEME_CATEGORIES), 'Back']);
}
async function openThemeCatMenu(cat) {   // level 2: themes within a category
    menuMode = 'theme'; _themeCat = cat; const cur = await getCfg('couch_theme', 'CREMA (DEFAULT)');
    renderOverlay(cat.toUpperCase(), ['§' + cat, ...(THEME_CATEGORIES[cat] || []).map(n => n === cur ? '★ ' + n : n), 'Back']);
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
function openRetroMenu() {
    menuMode = 'retro';
    renderOverlay('FULL-RETRO', ['§FULL-RETRO', ...RETRO_OPTS.map(([l, v]) => (v === '1') === retroOn ? '★ ' + l : l), 'Back'], '8-bit pixel font for the interface.');
}
function openCrtMenu() {
    menuMode = 'crt';
    renderOverlay('CRT MODE', ['§CRT MODE (640x480)', ...CRT_OPTS.map(([l, v]) => (v === '1') === crtOn ? '★ ' + l : l), 'Back'], 'A 640x480-tailored layout for CRT screens. Only affects Couch Mode.');
}
function openSaverMenu() {
    menuMode = 'saver';
    renderOverlay('SCREENSAVER', ['§AFTER IDLE', ...SAVER_OPTS.map(([l, v]) => Number(v) === saverDelayMin ? '★ ' + l : l), 'Back'], 'Shows a screenshot slideshow when idle.');
}
function openComboMenu() {
    menuMode = 'combo';
    renderOverlay('RETURN COMBO', ['§RETURN TO COUCH', ...COMBO_OPTS.map(m => m === returnCombo ? '★ ' + m : m), 'Back'], 'Buttons to hold during a game to return to Couch Mode. Match it to RetroArch’s Close combo so one press does both.');
}
function openSoundMenu(keepIdx) {
    menuMode = 'sound';
    renderOverlay('SOUND', ['§AUDIO',
        `Music: ${BGM_LABEL[bgmMode] || 'Off'}`,
        `Sound Effects: ${sfxOn ? 'On' : 'Off'}`,
        `Volume: ${Math.round(vol * 100)}%`,
        'Back'], 'A cycles · ◄ ► adjusts volume.');
    if (keepIdx != null) { overlayIndex = Math.min(keepIdx, overlayItems.length - 1); highlightOverlay(); }
}
function soundHorizontal(dx) {   // ◄ ► on the Volume row
    if (!String(overlayItems[overlayIndex] || '').startsWith('Volume')) return;
    vol = Math.max(0, Math.min(1, +(vol + dx * 0.1).toFixed(2)));
    if (bgmAudio) bgmAudio.volume = vol;
    window.api.setSetting('couch_vol', String(vol));
    openSoundMenu(overlayIndex);
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
async function overlayConfirm() {
    const raw = String(overlayItems[overlayIndex] || '').replace('★ ', '');
    if (menuMode === 'main') {
        if (raw === 'Color Theme') openThemeMenu();
        else if (raw === 'Full-Retro') openRetroMenu();
        else if (raw === 'CRT Mode (640x480)') openCrtMenu();
        else if (raw === 'Carousel Label') openHeroMenu();
        else if (raw === 'Navigation Mode') openNavMenu();
        else if (raw === 'Display Density') openDensityMenu();
        else if (raw === 'Screensaver') openSaverMenu();
        else if (raw === 'Sound') openSoundMenu();
        else if (raw === 'Gamepad Icons') openLayoutMenu();
        else if (raw === 'Return Combo') openComboMenu();
        else if (raw === 'Manage Save States') openSaveMgr();
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
    if (menuMode === 'themecat') {
        if (raw === 'Back') { openMenu(); return; }
        if (THEME_CATEGORIES[raw]) openThemeCatMenu(raw);
        return;
    }
    if (menuMode === 'theme' && raw === 'Back') { openThemeMenu(); return; }
    if (raw === 'Back') { openMenu(); return; }
    if (menuMode === 'theme') { applyTheme(raw); window.api.setSetting('couch_theme', raw); openThemeCatMenu(_themeCat); }
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
    else if (menuMode === 'retro') {
        const o = RETRO_OPTS.find(([l]) => l === raw);
        if (o) { retroOn = o[1] === '1'; window.api.setSetting('couch_retro', o[1]); document.body.classList.toggle('retro', retroOn); openRetroMenu(); }
    }
    else if (menuMode === 'crt') {
        const o = CRT_OPTS.find(([l]) => l === raw);
        if (o) {
            crtOn = o[1] === '1'; window.api.setSetting('couch_crt_layout', o[1]); document.body.classList.toggle('crt', crtOn);
            // CRT defaults to List view; turning CRT off restores the saved non-CRT preference.
            browseMode = crtOn ? 'list' : ((await window.api.getSetting('couch_browse_mode')) || 'gallery');
            if (screen === 'wall' || screen === 'list') (browseMode === 'list' ? enterList : enterWall)();   // re-flow the active browse view for the new layout
            requestAnimationFrame(fitTileLabels);   // tile label base size differs per layout — refit
            openCrtMenu();
        }
    }
    else if (menuMode === 'saver') {
        const o = SAVER_OPTS.find(([l]) => l === raw);
        if (o) { saverDelayMin = Number(o[1]); window.api.setSetting('couch_screensaver', o[1]); resetIdle(); openSaverMenu(); }
    }
    else if (menuMode === 'combo') {
        if (COMBO_OPTS.includes(raw)) { returnCombo = raw; window.api.setSetting('couch_return_combo', raw); openComboMenu(); }
    }
    else if (menuMode === 'sound') {
        const it = String(overlayItems[overlayIndex] || '');
        if (it.startsWith('Music')) { bgmMode = BGM_ORDER[(BGM_ORDER.indexOf(bgmMode) + 1) % BGM_ORDER.length]; window.api.setSetting('couch_bgm_mode', bgmMode); applyBgm(); }
        else if (it.startsWith('Sound Effects')) { sfxOn = !sfxOn; window.api.setSetting('couch_sfx', sfxOn ? '1' : '0'); }
        else if (it.startsWith('Volume')) { vol = vol >= 1 ? 0 : +(vol + 0.1).toFixed(2); if (bgmAudio) bgmAudio.volume = vol; window.api.setSetting('couch_vol', String(vol)); }
        openSoundMenu(overlayIndex);
    }
}
function overlayBack() {
    if (menuMode === 'main' || menuMode === 'sort' || menuMode === 'playlists') closeMenu();
    else if (menuMode === 'theme') openThemeMenu();   // back to theme categories
    else openMenu();
}
function dispatchMenu() { if (ssOpen || smOpen || infoOpen) return; if (menuOpen) closeMenu(); else openMenu(); }
function dispatchSort() { if (ssOpen || oskOpen || menuOpen || smOpen || infoOpen || _scraping) return; if (screen === 'wall' || screen === 'list') openSortMenu(); }

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
        return `<div class="cz-tile" data-i="${i}">${bg}<div class="cz-tile-grad"></div><div class="cz-tile-text"><div class="cz-tile-label">${escHtml(c.label)}</div><div class="cz-tile-count">${c.count}</div></div></div>`;
    }).join('');
    [...$('cz-tiles').querySelectorAll('.cz-tile')].forEach(el => el.onclick = () => { catIndex = Number(el.dataset.i); updateTiles(); selectCategory(); });
    updateTiles(); fitTileLabels();
}
function fitTileLabels() {   // graceful shrink-to-fit: scale each system/category name down until it fits its tile
    const tiles = $('cz-tiles'); if (!tiles || tiles.style.display === 'none') return;
    tiles.querySelectorAll('.cz-tile-label').forEach(label => {
        label.style.fontSize = '';   // reset to the CSS base for the active mode
        const wrap = label.parentElement, cs = getComputedStyle(wrap);
        const avail = wrap.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
        const w = label.scrollWidth; if (avail <= 0 || w <= avail) return;
        label.style.fontSize = Math.max(12, Math.floor(parseFloat(getComputedStyle(label).fontSize) * avail / w)) + 'px';
    });
}
window.addEventListener('resize', fitTileLabels);
function updateTiles() {
    [...$('cz-tiles').querySelectorAll('.cz-tile')].forEach((el, i) => { el.classList.toggle('sel', i === catIndex); if (i === catIndex) el.scrollIntoView({ block: 'nearest' }); });
}
function tilesCols() { const t = [...$('cz-tiles').querySelectorAll('.cz-tile')]; if (t.length < 2) return 1; const t0 = t[0].offsetTop; let c = 1; for (let i = 1; i < t.length; i++) { if (t[i].offsetTop === t0) c++; else break; } return c; }
function tilesMove(dx, dy) {
    const n = categories.length; if (!n) return; const cols = tilesCols(); let idx = catIndex;
    if (dx > 0) idx = (idx + 1) % n;                                    // wrap last→first
    else if (dx < 0) idx = (idx - 1 + n) % n;                           // wrap first→last
    else if (dy > 0) { idx += cols; if (idx >= n) idx %= cols; }        // down past the end → top of the column
    else if (dy < 0) { idx -= cols; if (idx < 0) { const rows = Math.ceil(n / cols); idx += rows * cols; if (idx >= n) idx -= cols; } }   // up past the start → bottom of the column
    catIndex = idx; updateTiles();
}
function toggleStartMode() {
    startMode = startMode === 'carousel' ? 'tiles' : 'carousel';
    $('cz-hero').style.display = startMode === 'carousel' ? 'block' : 'none';
    $('cz-tiles').style.display = startMode === 'tiles' ? 'grid' : 'none';
    if (startMode === 'carousel') selectedHero(); else { updateTiles(); requestAnimationFrame(fitTileLabels); }
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
        return `<div class="game-item" id="game-${i}" data-i="${i}" data-id="${g.id}"><span class="gi-label"><span class="list-install-dot">●</span>${p}${escHtml(g.title)}</span></div>`;
    }).join('');
    [...l.querySelectorAll('.game-item')].forEach(el => el.onclick = () => { listSelect(Number(el.dataset.i)); openGamepage(Number(el.dataset.id)); });
}
function listSelect(i) {   // CREMA updateGameSelection: selection + scroll + media/stats
    if (!listList.length) return;
    listFocus = clamp(i, 0, listList.length - 1);
    const items = [...$('game-list').querySelectorAll('.game-item')];
    items.forEach((el, j) => {
        el.classList.toggle('selected', j === listFocus);
        const lbl = el.querySelector('.gi-label');
        if (lbl) { lbl.classList.remove('marquee'); lbl.style.removeProperty('--gi-shift'); lbl.style.animationDuration = ''; }
    });
    if (items[listFocus]) { items[listFocus].scrollIntoView({ block: 'nearest' }); if (crtOn) applyMarquee(items[listFocus]); }
    updateListDetail(listList[listFocus]);
}
function applyMarquee(item) {   // CRT: scroll a too-long selected title gracefully
    const lbl = item.querySelector('.gi-label'); if (!lbl) return;
    const cs = getComputedStyle(item);
    const avail = item.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    const overflow = lbl.scrollWidth - avail;
    if (overflow > 8) {
        lbl.style.setProperty('--gi-shift', '-' + (overflow + 12) + 'px');
        lbl.style.animationDuration = clamp((overflow + 12) / 38, 3, 11) + 's';
        lbl.classList.add('marquee');
    }
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
    // Box art (the small cover). Normal mode = fixed-frame overlay; CRT = full natural proportion / jewel case.
    const miniCrt = $('cover-mini-crt');
    if (crtOn) {
        setImg(mini, ''); mini.classList.add('hidden');
        if (g.cover) { miniCrt.classList.remove('hidden'); miniCrt.innerHTML = coverFrameHTML(g); applyCoverFrame(g, miniCrt.querySelector('.cover-frame'), miniCrt.querySelector('img')); }
        else { miniCrt.classList.add('hidden'); miniCrt.innerHTML = ''; }
    } else {
        miniCrt.classList.add('hidden'); miniCrt.innerHTML = '';
        if (g.cover) { setImg(mini, g.cover); mini.classList.remove('hidden'); } else { setImg(mini, ''); mini.classList.add('hidden'); }
    }
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
    $('cover-mini-crt').classList.add('hidden'); $('cover-mini-crt').innerHTML = '';
    $('list-noart').style.display = 'none'; $('list-noart').innerHTML = '';
}
function listMove(dy) { const n = listList.length; if (dy && n) listSelect((listFocus + dy + n) % n); }   // wrap last↔first
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
function updateGalleryBg(g) {   // hero img + centered game name (logo removed; name side-scrolls when too long)
    const img = $('gallery-hero-img'), name = $('gallery-hero-game-name');
    if (!g) { img.src = ''; img.style.display = 'none'; name.innerHTML = ''; return; }
    const src = g.hero || (g.screenshot ? String(g.screenshot).split('|')[0] : '') || g.cover || '';
    img.src = src; img.style.display = src ? 'block' : 'none';
    name.innerHTML = `<span>${escHtml(g.title || '')}</span>`;
    applyHeroNameMarquee();
}
function applyHeroNameMarquee() {
    const el = $('gallery-hero-game-name'), inner = el.firstElementChild; if (!inner) return;
    el.classList.remove('scroll'); inner.style.removeProperty('--shift'); inner.style.removeProperty('--dur');
    const over = inner.scrollWidth - el.clientWidth;
    if (over > 2) { el.classList.add('scroll'); inner.style.setProperty('--shift', (-over - 6) + 'px'); inner.style.setProperty('--dur', clamp(Math.round(over / 22), 4, 12) + 's'); }
}
function wallMove(dx, dy) {   // CREMA navigateGallery, responsive column count
    const N = galleryList.length; if (!N) return; let idx = gridFocus; const cols = galleryCols();
    if (dx > 0) idx = (idx + 1) % N;                                   // wrap last→first
    else if (dx < 0) idx = (idx - 1 + N) % N;                          // wrap first→last
    else if (dy > 0) { idx += cols; if (idx >= N) idx %= cols; }       // down past the end → top of the column
    else if (dy < 0) { idx -= cols; if (idx < 0) { const rows = Math.ceil(N / cols); idx += rows * cols; if (idx >= N) idx -= cols; } }   // up past the start → bottom of the column
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
    const cov = $('gp-cover');
    if (g.cover) { cov.classList.remove('noart'); cov.innerHTML = coverFrameHTML(g); applyCoverFrame(g, cov.querySelector('.cover-frame'), cov.querySelector('img')); }
    else { cov.classList.add('noart'); cov.innerHTML = artPlaceholderHTML(g, false); }
    const ss = g.screenshot ? String(g.screenshot).split('|').filter(s => s.trim()) : [];
    if (ss.length) { $('gp-ss').style.display = crtOn ? 'flex' : 'block'; $('gp-ss').querySelector('img').src = ss[0]; } else $('gp-ss').style.display = 'none';
    const stats = [['SYSTEM', g.system_name], ['YEAR', g.year], ['PLAYERS', g.players]].filter(([, v]) => v);   // the rest moves to the INFO modal
    $('gp-right').innerHTML = stats.map(([k, v]) => `<div class="gp-stat"><span class="k">${k}</span><span class="v"><span>${escHtml(v)}</span></span></div>`).join('');
    $('gp-scrape-hint').style.display = hasArt(g) ? 'none' : '';   // footer: offer X Scrape only when the game has no artwork
    buildGpActions();
    showScreen('gamepage'); $('gp-content').scrollTop = 0; gpBtnFocus = 0; updateGpFocus();
    if (crtOn) requestAnimationFrame(applyStatMarquee);   // side-scroll any stat value that's too long for its column
}
function applyStatMarquee() {
    document.querySelectorAll('#gp-right .gp-stat .v').forEach(v => {
        const inner = v.firstElementChild; if (!inner) return;
        v.classList.remove('scroll'); inner.style.removeProperty('--shift'); inner.style.removeProperty('--dur');
        const over = inner.scrollWidth - v.clientWidth;
        if (over > 2) { v.classList.add('scroll'); inner.style.setProperty('--shift', (-over - 4) + 'px'); inner.style.setProperty('--dur', clamp(Math.round(over / 26), 3, 9) + 's'); }
    });
}
function buildGpActions() {
    const g = gpGame;
    const acts = [
        `<button class="gp-btn play" data-act="play">▶ PLAY</button>`,
        `<button class="gp-btn" data-act="info">INFO</button>`,
        `<button class="gp-btn${g.fav ? ' active' : ''}" data-act="fav">${g.fav ? '★ FAV' : '+ FAV'}</button>`,
        `<button class="gp-btn${g.want ? ' active' : ''}" data-act="want">${g.want ? '♥ WANT' : 'WANT TO PLAY'}</button>`,
        `<button class="gp-btn" data-act="playlists">≡ PLAYLISTS</button>`,
    ];   // scrape lives on X (footer hint) — no hero button
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
    else if (act === 'info') openInfo();
    else if (act === 'scrape') scrapeArtwork(gpGame.id);
    else if (act === 'playlists') openPlaylistsMenu();
    else { gpGame[act] = gpGame[act] ? 0 : 1; await window.api.setGameFlag(gpGame.id, act, gpGame[act]); buildGpActions(); updateGpFocus(); }
}

// ── Info modal (full description + developer/publisher, big letters) ──────────
let infoOpen = false;
function openInfo() {
    const g = gpGame; if (!g) return;
    $('info-title').textContent = g.title || '';
    const meta = [];
    if (g.developer) meta.push(['Developer', g.developer]);
    if (g.publisher) meta.push(['Publisher', g.publisher]);
    if (g.genre) meta.push(['Genre', String(g.genre).split(',')[0].trim()]);
    if (g.rating) meta.push(['Rating', g.rating]);
    $('info-meta').innerHTML = meta.map(([k, v]) => `<span class="info-chip"><b>${k}</b>${escHtml(v)}</span>`).join('');
    $('info-desc').textContent = g.description || 'No description available.';
    infoOpen = true; $('info-backdrop').classList.remove('hidden'); $('info-desc').scrollTop = 0;
}
function closeInfo() { infoOpen = false; $('info-backdrop').classList.add('hidden'); }
function infoScroll(dy) { const d = $('info-desc'); d.scrollTop += dy * Math.max(60, d.clientHeight * 0.4); }

// ── Save-States Manager (gamepad-navigable; mirrors the desktop Save Manager) ─
let smOpen = false, smView = 'games', smGames = [], smSlots = [], smGame = null, smSel = 0, smPendDel = false;
const smSlotName = slot => slot === 'auto' ? 'AUTO SAVE' : 'SLOT ' + slot;
function smFmtBytes(b) { if (!b) return ''; const u = ['B', 'KB', 'MB', 'GB']; let i = 0, n = b; while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; } return n.toFixed(n < 10 && i ? 1 : 0) + u[i]; }
async function openSaveMgr() { closeMenu(); smOpen = true; $('sm2-backdrop').classList.remove('hidden'); await smShowGames(); }
function smClose() { smOpen = false; smPendDel = false; $('sm2-backdrop').classList.add('hidden'); }
async function smShowGames() {
    smView = 'games'; smGame = null; smSel = 0; smPendDel = false;
    smGames = (await window.api.listGamesWithSaves()) || [];
    $('sm2-title').textContent = 'SAVE STATES';
    $('sm2-sub').textContent = `${smGames.length} GAME${smGames.length !== 1 ? 'S' : ''}`;
    const grid = $('sm2-grid'); grid.classList.remove('slots');
    if (!smGames.length) { grid.innerHTML = '<div id="sm2-empty">NO SAVE STATES FOUND</div>'; $('sm2-detail').textContent = ''; smRenderHint(); return; }
    grid.innerHTML = smGames.map((g, i) => {
        const fg = g.logo || g.cover || g.thumb, bg = g.cover || g.thumb;
        const art = fg ? `${bg ? `<div class="sm2-bg" style="background-image:url('${bg}')"></div>` : ''}<img class="logo" src="${fg}" alt="">`
                       : `<div class="sm2-name">${escHtml(g.title)}</div>`;
        return `<div class="sm2-card" data-i="${i}"><div class="sm2-art">${art}<span class="sm2-count">${g.count}</span></div><div class="sm2-tag">${escHtml(g.title)}</div></div>`;
    }).join('');
    smWireCards(); smSel = 0; smHighlight(); smRenderHint();
}
async function smShowSlots(game) {
    smView = 'slots'; smGame = game; smSel = 0; smPendDel = false;
    smSlots = (await window.api.listSaveStates(game.id)) || [];
    $('sm2-title').textContent = (game.title || 'GAME').toUpperCase();
    $('sm2-sub').textContent = `${smSlots.length} SAVE${smSlots.length !== 1 ? 'S' : ''}`;
    const grid = $('sm2-grid'); grid.classList.add('slots');
    const cards = [`<div class="sm2-card" data-i="0"><div class="sm2-art"><span class="sm2-fresh-ic">▶</span></div><div class="sm2-tag">START FRESH</div></div>`];
    smSlots.forEach((s, i) => {
        const art = s.thumb ? `<img class="shot" src="${s.thumb}" alt="">` : `<div class="sm2-name">${smSlotName(s.slot)}</div>`;
        cards.push(`<div class="sm2-card" data-i="${i + 1}"><div class="sm2-art">${art}</div><div class="sm2-tag">${escHtml(s.label || smSlotName(s.slot))}</div></div>`);
    });
    grid.innerHTML = cards.join('');
    smWireCards(); smSel = 0; smHighlight(); smRenderHint();
}
function smWireCards() { [...$('sm2-grid').querySelectorAll('.sm2-card')].forEach(el => el.onclick = () => { smSel = Number(el.dataset.i); smPendDel = false; smHighlight(); smConfirm(); }); }
const smCards = () => [...$('sm2-grid').querySelectorAll('.sm2-card')];
function smCols() { const c = smCards(); if (c.length < 2) return 1; const t = c[0].offsetTop; let n = 1; for (let i = 1; i < c.length; i++) { if (c[i].offsetTop === t) n++; else break; } return n; }
function smHighlight() {
    const cards = smCards();
    cards.forEach((el, i) => { el.classList.toggle('sel', i === smSel); el.classList.toggle('pending-del', smPendDel && i === smSel); });
    if (cards[smSel]) cards[smSel].scrollIntoView({ block: 'nearest' });
    smDetail();
}
function smDetail() {
    const d = $('sm2-detail');
    if (smView === 'games') { d.textContent = smGames.length ? 'SELECT A GAME' : ''; return; }
    if (smPendDel) { d.textContent = 'PRESS DELETE AGAIN TO CONFIRM · B TO CANCEL'; return; }
    if (smSel === 0) { d.textContent = 'Start a new game (ignore saves)'; return; }
    const s = smSlots[smSel - 1]; if (!s) { d.textContent = ''; return; }
    d.textContent = `${smSlotName(s.slot)}${s.label ? ` · "${s.label}"` : ''}${s.size ? ' · ' + smFmtBytes(s.size) : ''} · ${relTime(s.mtime)}`;
}
function smRenderHint() {
    const G = b => `<span class="gp-glyph" data-btn="${b}"></span>`;
    $('sm2-hint').innerHTML = smView === 'games'
        ? `<span>${G('SOUTH')} Open</span><span>${G('L1')} Restore</span><span>${G('R1')} Backup All</span><span>${G('EAST')} Close</span>`
        : `<span>${G('SOUTH')} Launch</span><span>${G('WEST')} Delete</span><span>${G('NORTH')} Label</span><span>${G('R1')} Backup</span><span>${G('EAST')} Back</span>`;
    applyGamepadLayout(gpLayout);   // paint the freshly-added glyphs for the current layout
}
function smMove(dx, dy) {
    smPendDel = false;
    const n = smCards().length; if (!n) return; const cols = smCols();
    if (dx > 0) smSel = Math.min(n - 1, smSel + 1);
    else if (dx < 0) smSel = Math.max(0, smSel - 1);
    else if (dy > 0) { if (smSel + cols < n) smSel += cols; }
    else if (dy < 0) { if (smSel - cols >= 0) smSel -= cols; }
    smHighlight();
}
function smConfirm() {
    if (smView === 'games') { const g = smGames[smSel]; if (g) smShowSlots(g); return; }
    if (!smGame) return;
    if (smSel === 0) { smClose(); doLaunch(smGame.id, { fresh: true }); return; }
    const s = smSlots[smSel - 1]; if (s) { smClose(); doLaunch(smGame.id, { slot: s.slot }); }
}
function smBack() {
    if (smPendDel) { smPendDel = false; smHighlight(); return; }
    if (smView === 'slots') smShowGames(); else smClose();
}
async function smDelete() {
    if (smView !== 'slots' || smSel === 0) return;
    const s = smSlots[smSel - 1]; if (!s) return;
    if (!smPendDel) { smPendDel = true; smHighlight(); return; }   // first press arms, second confirms
    smPendDel = false;
    const r = await window.api.deleteSaveState(s.file);
    if (r && r.ok) smShowSlots(smGame); else $('sm2-detail').textContent = (r && r.error) || 'DELETE FAILED';
}
function smLabel() {
    if (smView !== 'slots' || smSel === 0) return;
    const s = smSlots[smSel - 1]; if (!s) return;
    openOSK({ mode: 'text', title: 'LABEL THIS SAVE', initial: s.label || '', onDone: async val => { await window.api.setSaveLabel(smGame.id, s.slot, val); smShowSlots(smGame); } });
}
async function smBackupRestore(which) {   // R1 = backup, L1 = restore (restore only from the games view)
    if (which === 'backup') {
        const r = smView === 'slots' && smGame ? await window.api.backupSaves('game', smGame.id) : await window.api.backupSaves('all');
        if (r && r.canceled) return;
        $('sm2-detail').textContent = r && r.ok ? `BACKED UP ${r.files} FILE(S)` : ((r && r.error) || 'BACKUP FAILED');
    } else {
        if (smView !== 'games') return;
        const r = await window.api.restoreSaves();
        if (r && r.canceled) return;
        if (r && r.ok) { smShowGames(); $('sm2-detail').textContent = `RESTORED ${r.restored} FILE(S)`; }
        else $('sm2-detail').textContent = (r && r.error) || 'RESTORE FAILED';
    }
}

// ── Launch + Now Playing ─────────────────────────────────────────────────────
let _nowTimer;
async function launch(id) {   // opening a game: offer save states (resume vs fresh) if any exist
    let states = []; try { states = await window.api.listSaveStates(id); } catch {}
    const g = gamesById.get(id);
    if (states.length && g) openSaveStates(id, g, states);
    else doLaunch(id, {});
}
async function doLaunch(id, opts) {
    const g = gamesById.get(id); if (!g) return;
    clearTimeout(saverTimer); clearTimeout(_nowTimer);   // pause the screensaver / any toast while a game runs
    enterGameRunning(g);
    const r = await window.api.launchGameEx(id, opts);
    if (!r || !r.ok) {   // failed to launch — drop out of the now-playing screen and surface the error briefly
        exitGameRunning();
        showNow(g); $('couch-now').querySelector('.now-label').textContent = 'COULD NOT LAUNCH';
        _nowTimer = setTimeout(hideNow, 2500);
    }
}

// ── Now Playing (CREMA 1:1): while a game runs, block all input except the return combo ───────
let gameRunning = false, wakeHoldFrames = 0;
function comboInstruction() {
    const m = returnCombo || 'START + SELECT';
    return m.includes('HOLD') ? 'HOLD ' + m.replace(' (HOLD 2 SEC)', '') + ' TO RETURN' : 'PRESS ' + m + ' TO RETURN';
}
function enterGameRunning(g) {
    gameRunning = true; wakeHoldFrames = 0;
    if (bgmAudio) bgmAudio.pause();
    setImg($('sleep-cover'), g.cover || '');
    $('sleep-title').textContent = g.title || '';
    $('sleep-instruction').textContent = comboInstruction();
    $('sleep-screen').classList.remove('hidden');
}
function exitGameRunning() {
    if (!gameRunning) return;
    gameRunning = false; wakeHoldFrames = 0;
    $('sleep-screen').classList.add('hidden');
    playSfx(sfxSelect); applyBgm();
    if (window.api.forceFocus) window.api.forceFocus();
    resetIdle();
}
// Polled every frame while gameRunning — only the configured combo gets us back to Couch.
function checkReturnCombo(gp) {
    const down = i => !!(gp.buttons[i] && gp.buttons[i].pressed);
    const m = returnCombo || 'START + SELECT';
    let matched;
    if (m.includes('L1 + R1 + START + SELECT')) matched = down(4) && down(5) && down(9) && down(8);
    else if (m.includes('L3 + R3')) matched = down(10) && down(11);
    else matched = down(9) && down(8);   // START + SELECT
    if (!matched) { wakeHoldFrames = 0; return; }
    if (m.includes('HOLD 2 SEC')) { if (++wakeHoldFrames >= 120) exitGameRunning(); }
    else exitGameRunning();
}

// ── Save-states modal (resume vs fresh) ──────────────────────────────────────
let ssOpen = false, ssIndex = 0, ssStates = [], ssGameId = null;
function relTime(ms) {
    const m = Math.floor((Date.now() - ms) / 60000);
    if (m < 1) return 'just now'; if (m < 60) return m + 'm ago';
    const h = Math.floor(m / 60); if (h < 24) return h + 'h ago';
    const d = Math.floor(h / 24); if (d < 30) return d + 'd ago';
    return new Date(ms).toLocaleDateString();
}
function openSaveStates(id, g, states) {
    ssOpen = true; ssGameId = id; ssStates = states; ssIndex = 0;
    $('ss-subtitle').textContent = g.title || '';
    const cards = ['<div class="ss-card" data-i="0"><div class="ss-fresh">▶</div><div class="ss-meta"><div class="ss-slot">START FRESH</div><div class="ss-time">New game</div></div></div>'];
    states.forEach((s, i) => {
        const thumb = s.thumb ? `<img class="ss-thumb" src="${s.thumb}">` : `<div class="ss-fresh" style="font-size:26px">SAVE</div>`;
        const name = s.label || (s.slot === 'auto' ? 'AUTO SAVE' : 'SLOT ' + s.slot);
        cards.push(`<div class="ss-card" data-i="${i + 1}">${thumb}<div class="ss-meta"><div class="ss-slot">${escHtml(name)}</div><div class="ss-time">${relTime(s.mtime)}</div></div></div>`);
    });
    $('ss-cards').innerHTML = cards.join('');
    [...$('ss-cards').querySelectorAll('.ss-card')].forEach(el => el.onclick = () => { ssIndex = Number(el.dataset.i); ssHighlight(); ssActivate(); });
    $('ss-backdrop').classList.remove('hidden'); ssHighlight();
}
function ssHighlight() {
    const cs = [...$('ss-cards').querySelectorAll('.ss-card')];
    cs.forEach((el, i) => el.classList.toggle('sel', i === ssIndex));
    if (cs[ssIndex]) cs[ssIndex].scrollIntoView({ inline: 'center', block: 'nearest' });
}
function ssMove(d) { const n = ssStates.length + 1; ssIndex = (ssIndex + d + n) % n; ssHighlight(); }
function ssClose() { ssOpen = false; $('ss-backdrop').classList.add('hidden'); }
function ssActivate() {
    const id = ssGameId, idx = ssIndex; ssClose();
    if (idx === 0) doLaunch(id, { fresh: true });
    else doLaunch(id, { slot: ssStates[idx - 1].slot });
}

// ── Screensaver (idle → fullscreen screenshot slideshow) ─────────────────────
let saverDelayMin = 3, saverTimer = null, saverActive = false, saverPool = [], saverIdx = 0, saverCycle = null;
function buildSaverPool() {
    const pool = [];
    for (const g of games) {
        const shots = g.screenshot ? String(g.screenshot).split('|').map(s => s.trim()).filter(Boolean) : [];
        const img = shots[0] || g.hero || g.cover || '';
        if (img) pool.push({ img, title: g.title || '' });
    }
    for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
    return pool;
}
function startSaver() {
    if (saverActive || ssOpen || gameRunning) return;
    if (!saverPool.length) saverPool = buildSaverPool();
    if (!saverPool.length) return;
    saverActive = true; saverIdx = 0; showSaverFrame();
    $('saver').classList.remove('hidden');
    saverCycle = setInterval(nextSaver, 9000);
}
function showSaverFrame() {
    const it = saverPool[saverIdx % saverPool.length];
    const img = $('saver-img'); img.style.animation = 'none'; void img.offsetWidth; img.style.animation = '';   // restart Ken-Burns pan
    img.src = it.img; $('saver-game').textContent = it.title;
}
function nextSaver() { saverIdx = (saverIdx + 1) % saverPool.length; showSaverFrame(); }
function stopSaver() { saverActive = false; clearInterval(saverCycle); $('saver').classList.add('hidden'); }
function resetIdle() {
    clearTimeout(saverTimer);
    if (saverActive) stopSaver();
    if (gameRunning) return;   // no screensaver while a game is running
    if (saverDelayMin > 0) saverTimer = setTimeout(startSaver, saverDelayMin * 60000);
}
// Returns true if the input was consumed waking the screensaver (caller should not act on it).
function wokeSaver() { if (saverActive) { stopSaver(); resetIdle(); return true; } return false; }
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
function dispatchScrape() {   // X — scrape the focused/current game if it lacks artwork (or delete a save in the manager)
    if (smOpen) { smDelete(); return; }
    if (ssOpen || oskOpen || menuOpen || infoOpen || _scraping) return;
    let g = null;
    if (screen === 'wall') g = galleryList[gridFocus];
    else if (screen === 'list') g = listList[listFocus];
    else if (screen === 'gamepage') g = gpGame;
    if (g && !hasArt(g)) scrapeArtwork(g.id);
}


// ── Input dispatch (per active screen) ───────────────────────────────────────
function dispatchNav(dx, dy) {
    if (ssOpen) { if (dx) ssMove(dx); return; }
    if (oskOpen) { oskNav(dx, dy); return; }
    if (smOpen) { playSfx(sfxNav); smMove(dx, dy); return; }
    if (infoOpen) { if (dy) infoScroll(dy); return; }
    playSfx(sfxNav);
    if (menuOpen) { if (menuMode === 'sound' && dx) { soundHorizontal(dx); return; } if (dy) overlayMove(dy); return; }
    if (screen === 'start') { if (startMode === 'carousel') { if (dx) carouselMove(dx); } else tilesMove(dx, dy); }
    else if (screen === 'wall') wallMove(dx, dy);
    else if (screen === 'list') { if (dy) listMove(dy); else if (dx) listCycleCategory(dx); }
    else if (screen === 'gamepage') { if (dx) gpMove(dx); }
}
function dispatchConfirm() {
    if (ssOpen) { ssActivate(); return; }
    playSfx(sfxSelect);
    if (oskOpen) { oskActivate(); return; }
    if (smOpen) { smConfirm(); return; }
    if (infoOpen) { closeInfo(); return; }
    if (menuOpen) { overlayConfirm(); return; }
    if (screen === 'start') selectCategory();
    else if (screen === 'wall') wallActivate();
    else if (screen === 'list') listActivate();
    else gpActivate();
}
function dispatchBack() {
    if (ssOpen) { ssClose(); return; }
    playSfx(sfxBack);
    if (oskOpen) { closeOSK(); return; }
    if (smOpen) { smBack(); return; }
    if (infoOpen) { closeInfo(); return; }
    if (menuOpen) { overlayBack(); return; }
    if (!$('couch-now').classList.contains('hidden')) { hideNow(); return; }
    if (screen === 'gamepage') showScreen(gpReturn);
    else if (screen === 'wall' || screen === 'list') showScreen('start');
    else exitCouch();
}
function dispatchAux() {   // Y
    if (ssOpen) return;
    if (oskOpen) { oskClear(); return; }
    if (smOpen) { smLabel(); return; }
    if (infoOpen || menuOpen) return;
    if (screen === 'start') toggleStartMode();
    else if (screen === 'wall' || screen === 'list') openOSK();   // CREMA: Y opens search
}
function dispatchShoulder(dir) {
    if (smOpen) { smBackupRestore(dir < 0 ? 'restore' : 'backup'); return; }
    if (ssOpen || oskOpen || menuOpen || infoOpen) return;
    if (screen === 'wall') wallCycleCategory(dir);
    else if (screen === 'list') listCycleCategory(dir);
    else if (screen === 'gamepage') gpCycleGame(dir);
}
function gpCycleGame(dir) {   // L1/R1 on the gamepage → previous/next game in the current browse list (wraps last↔first)
    const fromList = gpReturn === 'list', arr = fromList ? listList : galleryList, n = arr.length; if (!n) return;
    const idx = (((fromList ? listFocus : gridFocus) + dir) % n + n) % n;
    if (fromList) listSelect(idx); else focusGrid(idx);   // keep the underlying browse selection in sync for when B returns
    playSfx(sfxNav); openGamepage(arr[idx].id);
}
// L2/R2: jump to the next/previous leading letter (CRT only — list + gallery)
function dispatchLetterJump(dir) {
    if (!crtOn || ssOpen || oskOpen || menuOpen || smOpen || infoOpen) return;
    if (screen === 'list') letterJump(listList, listFocus, dir, listSelect);
    else if (screen === 'wall') letterJump(galleryList, gridFocus, dir, focusGrid);
}
function letterJump(list, cur, dir, go) {
    if (!list.length) return;
    const key = g => { const c = (g && g.title || '').trim()[0]; return c ? c.toUpperCase() : '#'; };
    let i = clamp(cur, 0, list.length - 1); const curKey = key(list[i]);
    if (dir > 0) { while (i < list.length - 1 && key(list[i]) === curKey) i++; }
    else {   // step to the start of the previous letter group
        while (i > 0 && key(list[i]) === curKey) i--;
        const prevKey = key(list[i]);
        while (i > 0 && key(list[i - 1]) === prevKey) i--;
    }
    playSfx(sfxNav); go(i);
}

document.addEventListener('keydown', e => {
    if (gameRunning) {   // a game is running — keyboard fallback to return (gamepad uses the combo)
        if (e.key === 'Escape' || e.key === 'Backspace') exitGameRunning();
        e.preventDefault(); return;
    }
    if (e.key === 'F11') { exitCouch(); return; }
    kickAudio();
    if (wokeSaver()) { e.preventDefault(); return; }   // any key wakes the screensaver (and is swallowed)
    resetIdle();
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
        case ',': dispatchLetterJump(-1); break;
        case '.': dispatchLetterJump(1); break;
        case 'm': case 'M': dispatchMenu(); break;
    }
});

// ── Gamepad ──────────────────────────────────────────────────────────────────
const firstPad = () => Array.prototype.find.call(navigator.getGamepads ? navigator.getGamepads() : [], p => p);
let _btnPrev = {}, _navHeld = null, _navAt = 0, _navReps = 0;
function pollPad() {
    const gp = firstPad();
    if (gameRunning) {   // only the return combo acts; track button state so the held combo isn't a fresh edge on return
        if (gp) { checkReturnCombo(gp); for (let i = 0; i < gp.buttons.length; i++) _btnPrev[i] = !!(gp.buttons[i] && gp.buttons[i].pressed); }
        else _btnPrev = {};
        requestAnimationFrame(pollPad); return;
    }
    if (gp) {
        const down = i => !!(gp.buttons[i] && gp.buttons[i].pressed);
        const anyAct = gp.buttons.some(b => b && b.pressed) || (gp.axes || []).some(a => Math.abs(a) > 0.5);
        if (anyAct) { kickAudio(); resetIdle(); if (wokeSaver()) { _btnPrev = {}; _navHeld = null; requestAnimationFrame(pollPad); return; } }
        const edge = i => { const p = down(i); const w = _btnPrev[i]; _btnPrev[i] = p; return p && !w; };
        if (edge(0)) dispatchConfirm();      // A
        if (edge(1)) dispatchBack();         // B
        if (edge(2)) dispatchScrape();       // X → scrape artwork
        if (edge(3)) dispatchAux();          // Y
        if (edge(4)) dispatchShoulder(-1);   // LB
        if (edge(5)) dispatchShoulder(1);    // RB
        if (edge(6)) dispatchLetterJump(-1); // LT → previous letter
        if (edge(7)) dispatchLetterJump(1);  // RT → next letter
        if (edge(8)) dispatchSort();         // Select → sort
        if (edge(9)) dispatchMenu();         // Start → settings menu
        const ax = gp.axes[0] || 0, ay = gp.axes[1] || 0, DZ = 0.5; let dx = 0, dy = 0;
        if (down(14) || ax < -DZ) dx = -1; else if (down(15) || ax > DZ) dx = 1;
        if (down(12) || ay < -DZ) dy = -1; else if (down(13) || ay > DZ) dy = 1;
        const dir = (dx || dy) ? dx + ',' + dy : null; const now = performance.now();
        if (dir) {
            if (dir !== _navHeld) { _navHeld = dir; _navReps = 0; _navAt = now + 320; dispatchNav(dx, dy); }
            else if (now >= _navAt) {
                // Hold to repeat; in CRT, vertical scrolling through list/gallery accelerates the longer it's held.
                const interval = (crtOn && dy && (screen === 'list' || screen === 'wall')) ? Math.max(28, 110 - (++_navReps) * 9) : 110;
                _navAt = now + interval; dispatchNav(dx, dy);
            }
        } else { _navHeld = null; _navReps = 0; }
    } else { _btnPrev = {}; _navHeld = null; }
    requestAnimationFrame(pollPad);
}
requestAnimationFrame(pollPad);

// The hero IS the carousel (controller/keyboard nav); a mouse click opens the shown category.
$('cz-hero').addEventListener('click', () => { kickAudio(); if (!wokeSaver()) selectCategory(); });
document.addEventListener('mousemove', () => { if (!wokeSaver()) resetIdle(); });
init();
