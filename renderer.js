'use strict';

// ── STATE ─────────────────────────────────────────────────────────────────────
let allGames   = [];
let allSystems = [];
let currentFilter   = 'all';
let currentSort     = 'alpha';   // gallery sort (next to search)
let currentCategory = 'all';     // console / handheld / arcade filter
let currentView    = 'view-gallery';
let currentGame    = null;
let slideshowUrls  = [];
let slideshowIndex = 0;
let heroCycleTimer     = null;
let ssBannerKbInterval = null;
let heroQueue      = [];
let _achAll = [];
let _achFilter = 'all';
let ssSystems            = [];
let allPlaylists         = [];
let allCores             = [];
let allSystemPresets     = [];
let currentPlaylistGames = [];
let retroarchVariant     = 'none';
let _activePanelSection  = null; // 'systems' | 'playlists' | 'search' | null
let _scanEntries         = []; // structured results of the last folder scan

// ── INIT ──────────────────────────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', async () => {
    applyZoom();
    await loadSystems();
    await loadGames();
    await loadPlaylists();
    await loadCores();
    await loadSystemPresets();
    retroarchVariant = await window.api.getSetting('retroarch_variant') || 'none';
    const savedTheme = await window.api.getSetting('el_theme') || 'CREMA';
    applyTheme(savedTheme, false);
    wireUI();
    enhanceAllSelects();
    updateTemplateButtonLabels();
    wireScrapeProgress();
    window.api.signalReady();
});

async function applyZoom() {
    const z = await window.api.getSetting('zoom');
    if (z) window.api.setZoom(parseFloat(z));
}

// ── DATA LOADING ──────────────────────────────────────────────────────────────
async function loadSystems() {
    allSystems = await window.api.getSystems();
    renderSystemFilters();
    populateSystemSelects();
}

let gamesById = new Map();   // O(1) id → game lookup (gallery/list event delegation; avoids per-card find)
async function loadGames() {
    allGames = await window.api.getGames();
    gamesById = new Map(allGames.map(g => [g.id, g]));
    renderSystemFilters();
    renderCurrentView();
    startHeroCycle();
}

async function loadPlaylists() {
    allPlaylists = await window.api.getPlaylists();
    renderPlaylistFilters();
}

async function loadCores() {
    allCores = await window.api.getCores();
}

async function loadSystemPresets() {
    allSystemPresets = await window.api.getSystemPresets();
}

// ── RENDERING ─────────────────────────────────────────────────────────────────
function getFilteredGames() {
    let games;
    if (typeof currentFilter === 'string' && currentFilter.startsWith('playlist:')) {
        games = currentPlaylistGames;
    } else {
        games = allGames;
        if      (currentFilter === 'favs')   games = games.filter(g => g.fav);
        else if (currentFilter === 'want')   games = games.filter(g => g.want);
        else if (currentFilter === 'recent') games = [...games].sort((a,b) => (b.last_played||0)-(a.last_played||0)).slice(0,50);
        else if (currentFilter !== 'all')    games = games.filter(g => g.system_id === Number(currentFilter));
    }
    const q = document.getElementById('gallery-search')?.value.trim().toLowerCase();
    if (q) {
        games = games.filter(g =>
            (g.title       || '').toLowerCase().includes(q) ||
            (g.system_name || '').toLowerCase().includes(q) ||
            (g.genre       || '').toLowerCase().includes(q) ||
            (g.developer   || '').toLowerCase().includes(q) ||
            (g.year        || '').includes(q)
        );
    }
    if (currentCategory !== 'all') games = games.filter(g => systemCategory(g.system_short) === currentCategory);
    return sortGames(games);
}

const HANDHELD_SYS = new Set(['gb','gbc','gba','gg','ngp','ngpc','ws','wsc','nds','dsi','3ds','psp','vita','lynx','vb','ngage','wonderswan','supervision','pokemini','gw']);
const ARCADE_SYS   = new Set(['arcade','mame','fbneo','fba','neogeo','cps1','cps2','cps3','naomi','atomiswave','model2','model3']);
const systemCategory = short => { const s = (short || '').toLowerCase(); return HANDHELD_SYS.has(s) ? 'handheld' : ARCADE_SYS.has(s) ? 'arcade' : 'console'; };
const isScraped = g => !!(g.cover || g.screenscraper_id || g.description);
function sortGames(games) {
    const byTitle = (a, b) => (a.title || '').localeCompare(b.title || '', undefined, { sensitivity: 'base' });
    const arr = [...games];
    switch (currentSort) {
        case 'played':  return arr.sort((a, b) => (b.last_played || 0) - (a.last_played || 0) || byTitle(a, b));
        case 'favs':    return arr.sort((a, b) => (b.fav ? 1 : 0) - (a.fav ? 1 : 0) || byTitle(a, b));
        case 'want':    return arr.sort((a, b) => (b.want ? 1 : 0) - (a.want ? 1 : 0) || byTitle(a, b));
        case 'added':   return arr.sort((a, b) => (b.id || 0) - (a.id || 0));                 // higher id = added later
        case 'scraped': return arr.sort((a, b) => (isScraped(b) ? 1 : 0) - (isScraped(a) ? 1 : 0) || byTitle(a, b));
        default:        return arr.sort(byTitle);                                             // 'alpha'
    }
}

function renderCurrentView() {
    const games = getFilteredGames();
    updateCategoryHeader(games);
    if (currentView === 'view-gallery') renderGallery(games);
    else if (currentView === 'view-list') renderList(games);
}

function updateCategoryHeader(games) {
    let label = 'ALL GAMES';
    const isPlaylist = typeof currentFilter === 'string' && currentFilter.startsWith('playlist:');
    if (currentFilter === 'favs')        label = 'FAVOURITES';
    else if (currentFilter === 'want')   label = 'WANT TO PLAY';
    else if (currentFilter === 'recent') label = 'RECENTLY PLAYED';
    else if (isPlaylist) {
        const plId = Number(currentFilter.split(':')[1]);
        const pl = allPlaylists.find(p => p.id === plId);
        if (pl) label = pl.name.toUpperCase();
    } else if (currentFilter !== 'all') {
        const sys = allSystems.find(s => s.id === Number(currentFilter));
        if (sys) label = sys.name.toUpperCase();
    }
    const q = document.getElementById('gallery-search')?.value.trim();
    if (q) label = `RESULTS FOR "${q.toUpperCase()}"`;

    document.getElementById('gallery-category-text').textContent = label;
    document.getElementById('gallery-category-count').textContent =
        `${games.length} ${games.length === 1 ? 'GAME' : 'GAMES'}`;

    const searchEl  = document.getElementById('gallery-search');
    const countEl   = document.getElementById('gallery-search-count');
    const clearBtn  = document.getElementById('btn-gsearch-clear');
    if (searchEl && !q) searchEl.placeholder = `Search ${label === 'ALL GAMES' ? 'All Games' : label}…`;
    if (countEl) countEl.textContent = `${games.length} ${games.length === 1 ? 'game' : 'games'}`;
    if (clearBtn) clearBtn.style.display = q ? 'flex' : 'none';

    const isSystem = currentFilter !== 'all' && currentFilter !== 'favs' &&
                     currentFilter !== 'want' && currentFilter !== 'recent' && !isPlaylist;
    document.getElementById('system-hero-btns').style.display = isSystem ? 'flex' : 'none';
}

// Systems whose game boxes are NOT standard portrait — wide US cartridge boxes (LANDSCAPE: SNES,
// N64, Atari/Coleco/Intellivision) and squarish handheld boxes (SQUARE: Game Boy family + Game
// Gear). These (plus jewel/orient/natural systems) get the gallery's "special" uniform-slot
// treatment so the full cover shows uncropped. short_name comes from the system preset.
const COVER_LANDSCAPE = new Set([
    'snes', 'n64', 'a2600', 'a5200', 'a7800', 'coleco', 'intv', 'vectrex',
]);
const COVER_SQUARE = new Set([
    'gb', 'gbc', 'gba', 'gg', 'ngp', 'ngpc', 'ws', 'wsc', 'nds',   // DS boxes are squarish, not CD jewel cases
]);
// CD-era systems eligible for the faux jewel case. This is only a GATE: within these systems
// the cover's own shape decides the frame — square-ish art (JP CD jewel case) gets the jewel
// frame, portrait art (US/PAL tall cover, e.g. half the Saturn library) stays a flat cover.
// DVD/UMD/cartridge systems are excluded outright.
const JEWEL_CASE = new Set([
    'ps1', 'saturn', 'segacd', 'dc', 'pcecd', 'pcfx', 'neocd', '3do',
]);
const isJewel = shortName => JEWEL_CASE.has((shortName || '').toLowerCase());
// Art counts as a square jewel-case insert within this aspect-ratio band; outside it stays flat.
// Upper 1.20 catches US PlayStation covers (squarish, ~1.165); portrait Saturn/PS1 scans
// (~0.65–0.71) fall below the floor and stay flat.
const JEWEL_AR_MIN = 0.88, JEWEL_AR_MAX = 1.20;
// For a jewel-eligible game, toggle the jewel frame on `container` once the cover has loaded,
// based on the art's real proportions. Handles already-cached images and load failures.
function applyJewelCase(img, container) {
    if (!img || !container) return;
    const decide = () => {
        if (!img.naturalWidth || !img.naturalHeight) return;
        const ar = img.naturalWidth / img.naturalHeight;
        container.classList.toggle('jewel', ar >= JEWEL_AR_MIN && ar <= JEWEL_AR_MAX);
    };
    container.classList.remove('jewel');
    if (!img.getAttribute('src')) return;
    if (img.complete && img.naturalWidth) decide();
    else img.addEventListener('load', decide, { once: true });
}

// Systems whose cover ORIENTATION depends on region: SNES (US landscape / JP portrait) and
// PC Engine HuCard (squarish ~0.85). They have no standard box shape, so in the gallery they get
// the contained "special" slot (which shows any shape uncropped); the game page shows full art too.
const ORIENT_ADAPTIVE = new Set(['snes']);
const isOrientAdaptive = shortName => ORIENT_ADAPTIVE.has((shortName || '').toLowerCase());
const NATURAL_RATIO = new Set(['pce']);
const isNaturalRatio = shortName => NATURAL_RATIO.has((shortName || '').toLowerCase());
// A gallery card needs the "special" uniform-slot treatment (contained art + blurred backdrop)
// whenever its cover isn't the standard portrait shape — any landscape/square/jewel/orientation/
// natural system. Standard portrait covers just fill the slot.
const hasSpecialCover = shortName => {
    const s = (shortName || '').toLowerCase();
    return COVER_LANDSCAPE.has(s) || COVER_SQUARE.has(s) || isJewel(s) || isOrientAdaptive(s) || isNaturalRatio(s);
};

// Screenshot viewer display profile, by the system's real screen tech:
//   dmg = original Game Boy (4-shade green dot-matrix LCD, recolored)
//   lcd = handhelds (flat LCD, pixel grid, no scanlines/curvature/bloom)
//   crt = everything else (TV consoles + arcade — scanlines, bloom, curvature)
const DMG_SYSTEMS = new Set(['gb']);
const LCD_SYSTEMS = new Set(['gbc', 'gba', 'gg', 'lynx', 'ngp', 'ngpc', 'ws', 'wsc', 'nds', '3ds', 'psp', 'vita', 'vb']);
const displayType = shortName => {
    const s = (shortName || '').toLowerCase();
    if (DMG_SYSTEMS.has(s)) return 'dmg';
    if (LCD_SYSTEMS.has(s)) return 'lcd';
    return 'crt';
};

// ── CORE ↔ SYSTEM COMPATIBILITY ───────────────────────────────────────────────
// Disc/container/homebrew extensions are shared across many systems, so they don't prove
// compatibility alone — for those we match on the core's .info system/database names instead.
const GENERIC_CORE_EXT = new Set(['zip','7z','chd','iso','bin','cue','m3u','img','ccd','toc','mds','mdf','raw','sub','pbp','cso','ecm','exe','elf','dol']);
// Manufacturer/filler words dropped before comparing names ("game" is kept so Game Boy ≠ Virtual Boy).
const NAME_NOISE = new Set(['the','sony','sega','nintendo','nec','snk','atari','bandai','commodore','amstrad','sinclair','microsoft','coleco','mattel','entertainment','system','computer','console','home','video']);
// Tokens that mark a DIFFERENT, game-incompatible model within a family (PS1≠PS2≠PSP, Genesis≠Sega CD).
// Single digit only, so generation numbers (PS"2") count but intrinsic ones (TurboGrafx-"16") don't.
const isModelToken = t => /^\d$/.test(t) || ['portable','advance','cd','32x','supergrafx'].includes(t);
const nameTokens = s => String(s || '').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
// Does a core's system/database name refer to this EmuLatte system? Token-set containment, rejected
// when either side carries a model token the other lacks (so a PS1 core ≠ the PS2 system, etc.).
function nameRelates(sysName, coreName) {
    const sys  = nameTokens(sysName).filter(t => !NAME_NOISE.has(t));
    const core = nameTokens(coreName).filter(t => !NAME_NOISE.has(t));
    if (!sys.length || !core.length) return false;
    const sysSet = new Set(sys), coreSet = new Set(core);
    if (!(sys.every(t => coreSet.has(t)) || core.every(t => sysSet.has(t)))) return false;
    if (core.some(t => !sysSet.has(t) && isModelToken(t))) return false;
    if (sys.some(t => !coreSet.has(t) && isModelToken(t))) return false;
    return true;
}
const systemById = id => allSystems.find(s => s.id === Number(id));
const coreByPath = p => allCores.find(c => c.path === p);

function coreMatchesSystem(core, system) {
    if (!system) return false;
    // the system's explicitly-named core (preset or stored) always counts — even when the fuzzy
    // name/extension matching misses it (e.g. FinalBurn Neo: "FBNeo" vs "FinalBurn", generic .zip)
    if (system.default_core && core.path.split('/').pop() === system.default_core.split('/').pop()) return true;
    const sysExts  = (system.extensions || '').split(',').map(e => e.trim().toLowerCase().replace(/^\./, '')).filter(Boolean);
    const coreExts = (core.supported_extensions || '').split('|').map(e => e.trim().toLowerCase()).filter(Boolean);
    // 1) a distinctive (non-generic) shared extension → compatible (cartridge systems)
    if (coreExts.some(e => !GENERIC_CORE_EXT.has(e) && sysExts.includes(e))) return true;
    // 2) the core's system/database name(s) refer to this system (disc systems w/ shared extensions)
    const coreNames = [core.system_names, ...String(core.db_names || '').split('|')].filter(Boolean);
    if (coreNames.some(n => nameRelates(system.name, n))) return true;
    // 3) no metadata at all → fall back to any extension overlap
    if (!core.supported_extensions && !core.system_names && !core.db_names)
        return coreExts.some(e => sysExts.includes(e));
    return false;
}
const coresForSystem = system => allCores.filter(c => coreMatchesSystem(c, system));

// Show the selected core's description under its chooser.
function updateCoreDesc(selId, descId) {
    const sel = document.getElementById(selId), desc = document.getElementById(descId);
    if (!sel || !desc) return;
    const d = coreByPath(sel.value)?.description || '';
    desc.textContent = d;
    desc.style.display = d ? 'block' : 'none';
}

// ── Repair disc references (cue/gdi track filenames vs the real files on disk) ──
function discRepairMessage(r) {
    if (!r || !r.ok)   return `✗ ${r?.error || 'Repair failed.'}`;
    if (r.notDisc || !r.discFiles) return 'No disc images (.cue/.gdi/.m3u) here to repair.';
    let msg = r.refsFixed
        ? `✓ Fixed ${r.refsFixed} track reference${r.refsFixed !== 1 ? 's' : ''} across ${r.filesFixed} of ${r.discFiles} disc file${r.discFiles !== 1 ? 's' : ''}. Originals backed up as .bak.`
        : `✓ Checked ${r.discFiles} disc file${r.discFiles !== 1 ? 's' : ''} — all references already match the files on disk, nothing to change.`;
    if (r.unresolved?.length) msg += `\n⚠ Could not find on disk: ${r.unresolved.join(', ')}`;
    return msg;
}
async function runDiscRepair(btn, out, call) {
    btn.disabled = true; out.textContent = 'Repairing…';
    try { out.textContent = discRepairMessage(await call()); }
    catch (e) { out.textContent = `✗ ${e.message}`; }
    finally { btn.disabled = false; }
}

// ── RetroArch launch settings (override editor) ───────────────────────────────
let _raScope = 'global', _raRef = 0;
function raOverrideToggleFields() {
    const on = document.getElementById('ra-ovr-enabled').checked;
    const f = document.getElementById('ra-ovr-fields');
    f.style.opacity = on ? '1' : '0.4';
    f.style.pointerEvents = on ? 'auto' : 'none';
}
async function openRaOverride(scope, refId, title, note) {
    _raScope = scope; _raRef = refId || 0;
    document.getElementById('ra-override-title').textContent = title;
    document.getElementById('ra-override-scope-note').textContent = note || '';
    const monSel = document.getElementById('ra-ovr-monitor');
    const [mons, d] = await Promise.all([
        window.api.getMonitors(), window.api.getRaOverride(scope, _raRef),
    ]);
    monSel.innerHTML = `<option value="">— Don't change —</option><option value="0">Auto / primary</option>` +
        mons.map(m => `<option value="${m.index}">${escHtml(m.label)}</option>`).join('');
    const o = d || {};
    document.getElementById('ra-ovr-enabled').checked     = !!o.enabled;
    monSel.value                                          = o.monitor ?? '';
    document.getElementById('ra-ovr-fullscreen').value    = o.fullscreen ?? '';
    document.getElementById('ra-ovr-aspect').value        = o.aspect ?? '';
    document.getElementById('ra-ovr-shader-enable').value = o.shaderEnable ?? '';
    _raOvrShader                                          = o.shader ?? '';
    _shaderBrowserOvr.refreshCurrent(); _shaderBrowserOvr.go('');
    document.getElementById('ra-ovr-custom').value        = o.custom ?? '';
    raOverrideToggleFields();
    openModal('modal-ra-override');
}

// ── SAVE STATE MANAGER (memory-card style) ────────────────────────────────────
let _smGame = null, _smSlots = [], _smSel = -1, _smFromGames = false, _smGames = [], _smSort = 'recent', _smScroll = 0;
const smFmtBytes = n => n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB';
const smFmtDate  = ms => { try { return new Date(ms).toLocaleString(); } catch { return ''; } };
const smSlotName = s => s === 'auto' ? 'AUTO' : `SLOT ${s}`;

async function refreshRaConfigInfo() {
    const el = document.getElementById('ra-config-info');
    if (!el) return;
    try {
        const info = await window.api.raConfigInfo();
        el.innerHTML = `Config file: <b>${escHtml(info.path)}</b><br>${info.keys} settings · ${(info.size / 1024).toFixed(1)} KB`;
    } catch {}
}

// ── RETROARCH SETTINGS (full menu over EmuLatte's owned config) ───────────────
let _raCfg = {}, _raChanges = {}, _raCoreChanges = {}, _raAllRendered = false;
const RA_ASPECTS = [['0','4:3'],['1','16:9'],['2','16:10'],['3','16:15'],['4','21:9'],['5','1:1'],['6','2:1'],['7','3:2'],['11','5:4'],['19','Square pixel'],['20','Config'],['22','Core provided'],['23','Custom']];
const RA_VIDEO_SPEC = [
    {k:'video_driver', l:'Video driver', t:'select', o:['gl','glcore','vulkan','sdl2','d3d11','vga']},
    {k:'video_fullscreen', l:'Start in fullscreen', t:'bool'},
    {k:'video_windowed_fullscreen', l:'Windowed fullscreen', t:'bool'},
    {k:'video_monitor_index', l:'Monitor index (0 = primary)', t:'number'},
    {k:'video_fullscreen_x', l:'Fullscreen width', t:'number'},
    {k:'video_fullscreen_y', l:'Fullscreen height', t:'number'},
    {k:'video_vsync', l:'Vertical sync (VSync)', t:'bool'},
    {k:'video_swap_interval', l:'VSync swap interval', t:'select', o:['1','2','3','4']},
    {k:'video_scale_integer', l:'Integer scale', t:'bool'},
    {k:'aspect_ratio_index', l:'Aspect ratio', t:'select', o:RA_ASPECTS},
    {k:'video_smooth', l:'Bilinear filtering', t:'bool'},
    {k:'video_threaded', l:'Threaded video', t:'bool'},
    {k:'video_rotation', l:'Rotation', t:'select', o:[['0','Normal'],['1','90°'],['2','180°'],['3','270°']]},
    {k:'video_shader_enable', l:'Enable shaders', t:'bool'},
    {k:'video_black_frame_insertion', l:'Black frame insertion', t:'number'},
    {k:'video_hard_sync', l:'Hard GPU sync', t:'bool'},
    {k:'video_hard_sync_frames', l:'Hard sync frames', t:'number'},
    {k:'video_max_swapchain_images', l:'Max swapchain images', t:'select', o:['1','2','3']},
    {k:'crt_switch_resolution', l:'CRT SwitchRes (0 = off)', t:'select', o:[['0','Off'],['1','15 kHz'],['2','15 kHz interlaced'],['3','Native']]},
    {k:'crt_switch_resolution_super', l:'CRT super resolution', t:'text'},
];
const RA_AUDIO_SPEC = [
    {k:'audio_enable', l:'Enable audio', t:'bool'},
    {k:'audio_driver', l:'Audio driver', t:'select', o:['alsa','alsathread','pulse','pipewire','oss','sdl2','jack']},
    {k:'audio_device', l:'Audio device', t:'text'},
    {k:'audio_latency', l:'Audio latency (ms)', t:'number'},
    {k:'audio_volume', l:'Audio volume (dB)', t:'text'},
    {k:'audio_mute_enable', l:'Mute', t:'bool'},
    {k:'audio_sync', l:'Audio sync', t:'bool'},
    {k:'audio_rate_control', l:'Dynamic rate control', t:'bool'},
    {k:'audio_resampler', l:'Resampler', t:'select', o:['sinc','CC']},
];
const RA_INPUT_SPEC = [
    {k:'input_max_users', l:'Max users', t:'number'},
    {k:'input_autodetect_enable', l:'Autoconfig (auto-detect pads)', t:'bool'},
    {k:'input_menu_toggle_gamepad_combo', l:'Menu toggle combo', t:'select', o:[['0','None'],['1','L3 + R3'],['2','L1+R1+Start+Select'],['3','Start + Select'],['4','L3 + R'],['5','L3 + L1'],['6','Hold Start'],['7','Hold Select'],['8','Down + Select']]},
    {k:'menu_swap_ok_cancel_buttons', l:'Swap OK / Cancel buttons', t:'bool'},
    {k:'input_poll_type_behavior', l:'Input poll type', t:'select', o:[['0','Early'],['1','Normal'],['2','Late']]},
    {k:'input_overlay_enable', l:'On-screen overlay', t:'bool'},
    {k:'quit_press_twice', l:'Press quit twice to exit', t:'bool'},
    {k:'all_users_control_menu', l:'All users control the menu', t:'bool'},
];
const RA_DRIVERS_SPEC = [
    {k:'menu_driver', l:'Menu driver', t:'select', o:['ozone','xmb','rgui','glui']},
    {k:'video_driver', l:'Video driver', t:'select', o:['gl','glcore','vulkan','sdl2','vga']},
    {k:'audio_driver', l:'Audio driver', t:'select', o:['alsa','alsathread','pulse','pipewire','oss','sdl2','jack']},
    {k:'input_driver', l:'Input driver', t:'select', o:['udev','x','sdl2','linuxraw','wayland']},
    {k:'input_joypad_driver', l:'Controller driver', t:'select', o:['udev','sdl2','linuxraw','hid']},
    {k:'wifi_driver', l:'Wi-Fi driver', t:'text'},
    {k:'location_driver', l:'Location driver', t:'text'},
    {k:'camera_driver', l:'Camera driver', t:'text'},
    {k:'record_driver', l:'Record driver', t:'text'},
    {k:'midi_driver', l:'MIDI driver', t:'text'},
];
const RA_LATENCY_SPEC = [
    {k:'run_ahead_enabled', l:'Run-Ahead (reduce latency)', t:'bool'},
    {k:'run_ahead_frames', l:'Run-Ahead frames', t:'number'},
    {k:'run_ahead_secondary_instance', l:'Run-Ahead via second instance', t:'bool'},
    {k:'run_ahead_hide_warnings', l:'Hide Run-Ahead warnings', t:'bool'},
    {k:'video_frame_delay', l:'Frame delay (ms)', t:'number'},
    {k:'video_frame_delay_auto', l:'Automatic frame delay', t:'bool'},
    {k:'input_block_timeout', l:'Input block timeout', t:'number'},
];
const RA_CORE_SPEC = [
    {k:'video_shared_context', l:'Shared hardware context', t:'bool'},
    {k:'check_firmware_before_loading', l:'Check firmware before loading', t:'bool'},
    {k:'dummy_on_core_shutdown', l:'Stay in frontend on core shutdown', t:'bool'},
    {k:'core_option_category_enable', l:'Core option categories', t:'bool'},
    {k:'core_set_supports_no_game_enable', l:'Allow cores without content', t:'bool'},
    {k:'core_info_cache_enable', l:'Cache core info files', t:'bool'},
    {k:'video_allow_rotate', l:'Allow cores to rotate video', t:'bool'},
];
const RA_CONFIG_SPEC = [
    {k:'config_save_on_exit', l:'Save configuration on exit', t:'bool'},
    {k:'auto_overrides_enable', l:'Auto-load override files', t:'bool'},
    {k:'auto_remaps_enable', l:'Auto-load remap files', t:'bool'},
    {k:'auto_shaders_enable', l:'Auto-load shader presets', t:'bool'},
    {k:'game_specific_options', l:'Per-game core options', t:'bool'},
    {k:'global_core_options', l:'Single global core-options file', t:'bool'},
];
const RA_SAVING_SPEC = [
    {k:'savestate_auto_save', l:'Auto save state on exit', t:'bool'},
    {k:'savestate_auto_load', l:'Auto load state on start', t:'bool'},
    {k:'savestate_auto_index', l:'Increment save-state index', t:'bool'},
    {k:'savestate_max_keep', l:'Max auto save states to keep', t:'number'},
    {k:'savestate_thumbnail_enable', l:'Save-state thumbnails', t:'bool'},
    {k:'block_sram_overwrite', l:'Don’t overwrite SRAM on load', t:'bool'},
    {k:'autosave_interval', l:'SaveRAM autosave interval (s)', t:'number'},
    {k:'sort_savefiles_enable', l:'Sort saves into folders', t:'bool'},
    {k:'sort_savestates_enable', l:'Sort save states into folders', t:'bool'},
    {k:'savefiles_in_content_dir', l:'Write saves to content dir', t:'bool'},
    {k:'savestates_in_content_dir', l:'Write states to content dir', t:'bool'},
];
const RA_THROTTLE_SPEC = [
    {k:'fastforward_ratio', l:'Fast-forward rate (0 = unlimited)', t:'text'},
    {k:'fastforward_frameskip', l:'Fast-forward frameskip', t:'bool'},
    {k:'slowmotion_ratio', l:'Slow-motion rate', t:'text'},
    {k:'vrr_runloop_enable', l:'Sync to exact content framerate', t:'bool'},
    {k:'menu_throttle_framerate', l:'Throttle menu framerate', t:'bool'},
    {k:'rewind_enable', l:'Rewind', t:'bool'},
    {k:'rewind_granularity', l:'Rewind frames per step', t:'number'},
    {k:'rewind_buffer_size', l:'Rewind buffer size (MB)', t:'number'},
];
const RA_OSD_SPEC = [
    {k:'video_font_enable', l:'On-screen notifications', t:'bool'},
    {k:'video_font_size', l:'Notification size', t:'number'},
    {k:'video_message_pos_x', l:'Notification X position', t:'text'},
    {k:'video_message_pos_y', l:'Notification Y position', t:'text'},
    {k:'menu_enable_widgets', l:'Graphics widgets', t:'bool'},
    {k:'menu_widget_scale_auto', l:'Auto-scale widgets', t:'bool'},
    {k:'fps_show', l:'Display framerate', t:'bool'},
    {k:'framecount_show', l:'Display frame count', t:'bool'},
    {k:'memory_show', l:'Display memory usage', t:'bool'},
    {k:'statistics_show', l:'Display statistics', t:'bool'},
];
const RA_UI_SPEC = [
    {k:'pause_nonactive', l:'Pause when window unfocused', t:'bool'},
    {k:'menu_pause_libretro', l:'Pause content while in menu', t:'bool'},
    {k:'mouse_enable', l:'Menu mouse support', t:'bool'},
    {k:'pointer_enable', l:'Menu touch support', t:'bool'},
    {k:'menu_show_load_core', l:'Show “Load Core”', t:'bool'},
    {k:'menu_show_load_content', l:'Show “Load Content”', t:'bool'},
    {k:'kiosk_mode_enable', l:'Kiosk mode', t:'bool'},
    {k:'quit_on_close_content', l:'Quit when content closes', t:'bool'},
    {k:'video_disable_composition', l:'Disable desktop composition', t:'bool'},
];
const RA_CHEEVOS_SPEC = [
    {k:'cheevos_enable', l:'Enable achievements', t:'bool'},
    {k:'cheevos_username', l:'Username', t:'text'},
    {k:'cheevos_hardcore_mode_enable', l:'Hardcore mode', t:'bool'},
    {k:'cheevos_leaderboards_enable', l:'Leaderboards', t:'bool'},
    {k:'cheevos_richpresence_enable', l:'Rich presence', t:'bool'},
    {k:'cheevos_badges_enable', l:'Achievement badges', t:'bool'},
    {k:'cheevos_test_unofficial', l:'Test unofficial achievements', t:'bool'},
    {k:'cheevos_auto_screenshot', l:'Screenshot on unlock', t:'bool'},
    {k:'cheevos_start_active', l:'Start with all active', t:'bool'},
    {k:'cheevos_challenge_indicators', l:'Challenge indicators', t:'bool'},
];
const RA_NETPLAY_SPEC = [
    {k:'netplay_nickname', l:'Nickname', t:'text'},
    {k:'netplay_public_announce', l:'Publicly announce', t:'bool'},
    {k:'netplay_ip_address', l:'Server address', t:'text'},
    {k:'netplay_tcp_udp_port', l:'Port', t:'number'},
    {k:'netplay_password', l:'Server password', t:'text'},
    {k:'netplay_spectate_password', l:'Spectator password', t:'text'},
    {k:'netplay_start_as_spectator', l:'Start in spectator mode', t:'bool'},
    {k:'netplay_allow_slaves', l:'Allow slave-mode clients', t:'bool'},
    {k:'netplay_check_frames', l:'Sync check frames', t:'number'},
    {k:'network_cmd_enable', l:'Network commands', t:'bool'},
    {k:'network_cmd_port', l:'Network command port', t:'number'},
];
const RA_PLAYLIST_SPEC = [
    {k:'history_list_enable', l:'History playlist', t:'bool'},
    {k:'content_history_size', l:'History size', t:'number'},
    {k:'playlist_entry_remove_enable', l:'Allow removing entries', t:'select', o:[['0','Off'],['1','All'],['2','History only']]},
    {k:'playlist_sort_alphabetical', l:'Sort alphabetically', t:'bool'},
    {k:'playlist_show_sublabels', l:'Show sub-labels', t:'bool'},
    {k:'scan_without_core_match', l:'Scan without core match', t:'bool'},
];
const RA_OVERLAY_SPEC = [
    {k:'input_overlay_enable', l:'Display overlay', t:'bool'},
    {k:'input_overlay', l:'Overlay preset (.cfg)', t:'text'},
    {k:'input_overlay_opacity', l:'Overlay opacity', t:'text'},
    {k:'input_overlay_scale', l:'Overlay scale', t:'text'},
    {k:'input_overlay_hide_in_menu', l:'Hide overlay in menu', t:'bool'},
    {k:'input_overlay_show_physical_inputs', l:'Show inputs on overlay', t:'bool'},
    {k:'input_overlay_auto_scale', l:'Auto-scale overlay', t:'bool'},
];
const RA_DIR_SPEC = [
    {k:'system_directory', l:'System / BIOS', t:'text'},
    {k:'libretro_directory', l:'Cores', t:'text'},
    {k:'libretro_info_path', l:'Core info', t:'text'},
    {k:'savefile_directory', l:'Saves (SRAM)', t:'text'},
    {k:'savestate_directory', l:'Save states', t:'text'},
    {k:'video_shader_dir', l:'Shaders', t:'text'},
    {k:'overlay_directory', l:'Overlays', t:'text'},
    {k:'assets_directory', l:'Assets', t:'text'},
    {k:'thumbnails_directory', l:'Thumbnails', t:'text'},
    {k:'playlist_directory', l:'Playlists', t:'text'},
    {k:'joypad_autoconfig_dir', l:'Controller profiles', t:'text'},
    {k:'input_remapping_directory', l:'Input remaps', t:'text'},
    {k:'cheat_database_path', l:'Cheats', t:'text'},
    {k:'rgui_browser_directory', l:'File browser start', t:'text'},
    {k:'log_dir', l:'Logs', t:'text'},
];
const RA_LOGGING_SPEC = [
    {k:'log_verbosity', l:'Logging verbosity', t:'bool'},
    {k:'frontend_log_level', l:'Frontend log level', t:'select', o:[['0','Debug'],['1','Info'],['2','Warning'],['3','Error']]},
    {k:'libretro_log_level', l:'Core log level', t:'select', o:[['0','Debug'],['1','Info'],['2','Warning'],['3','Error']]},
    {k:'log_to_file', l:'Log to file', t:'bool'},
    {k:'log_to_file_timestamp', l:'Timestamp log files', t:'bool'},
    {k:'perfcnt_enable', l:'Performance counters', t:'bool'},
];
const RA_RECORDING_SPEC = [
    {k:'video_gpu_record', l:'Use GPU recording', t:'bool'},
    {k:'video_record_quality', l:'Recording quality', t:'select', o:[['0','Custom'],['1','Low'],['2','Medium'],['3','High'],['4','Lossless'],['5','WebM Fast'],['6','WebM High']]},
    {k:'video_stream_quality', l:'Streaming quality', t:'select', o:[['10','Custom'],['11','Low'],['12','Medium'],['13','High']]},
    {k:'streaming_mode', l:'Streaming mode', t:'select', o:[['0','Twitch'],['1','YouTube'],['2','Local'],['3','Custom'],['4','Facebook']]},
    {k:'video_stream_port', l:'UDP stream port', t:'number'},
    {k:'streaming_title', l:'Stream title', t:'text'},
    {k:'streaming_url', l:'Stream URL', t:'text'},
];
const RA_POWER_SPEC = [
    {k:'sustained_performance_mode', l:'Sustained performance mode', t:'bool'},
    {k:'gamemode_enable', l:'Feral GameMode', t:'bool'},
    {k:'menu_battery_level_enable', l:'Show battery level', t:'bool'},
];
const RA_AI_SPEC = [
    {k:'ai_service_enable', l:'Enable AI Service', t:'bool'},
    {k:'ai_service_mode', l:'Output mode', t:'select', o:[['0','Image overlay'],['1','Text To Speech'],['2','Narrator']]},
    {k:'ai_service_url', l:'Service URL', t:'text'},
    {k:'ai_service_source_lang', l:'Source language (code)', t:'number'},
    {k:'ai_service_target_lang', l:'Target language (code)', t:'number'},
    {k:'ai_service_pause', l:'Pause during translation', t:'bool'},
];
const RA_ACCESS_SPEC = [
    {k:'accessibility_enable', l:'Accessibility (menu narration)', t:'bool'},
    {k:'accessibility_narrator_speech_speed', l:'Narrator speech speed', t:'number'},
];
const RA_USER_SPEC = [
    {k:'user_language', l:'Menu language (index)', t:'number'},
    {k:'camera_allow', l:'Allow camera access', t:'bool'},
    {k:'location_allow', l:'Allow location access', t:'bool'},
    {k:'discord_allow', l:'Discord rich presence', t:'bool'},
    {k:'youtube_stream_key', l:'YouTube stream key', t:'text'},
    {k:'twitch_stream_key', l:'Twitch stream key', t:'text'},
    {k:'facebook_stream_key', l:'Facebook stream key', t:'text'},
];
const RA_FILEBROWSER_SPEC = [
    {k:'show_hidden_files', l:'Show hidden files', t:'bool'},
    {k:'use_last_start_directory', l:'Remember last directory', t:'bool'},
    {k:'menu_navigation_browser_filter_supported_extensions_enable', l:'Filter unknown extensions', t:'bool'},
    {k:'filter_by_current_core', l:'Filter by current core', t:'bool'},
    {k:'navigation_wraparound', l:'Navigation wrap-around', t:'bool'},
];
// (Express RA settings are rendered bespoke — see renderExpressSettings / paintExpress below.)
function makeRaSettingRow({ k, l, t, o }) {
    const row = document.createElement('div'); row.className = 'ra-set-row';
    row.dataset.k = k; row.dataset.label = `${l || k} ${k}`.toLowerCase();
    const lab = document.createElement('label'); lab.innerHTML = `${escHtml(l || k)}<br><span class="ra-key">${escHtml(k)}</span>`;
    const val = _raCfg[k] != null ? String(_raCfg[k]) : '';
    let ctrl;
    if (t === 'bool') {
        ctrl = document.createElement('select');
        ctrl.innerHTML = '<option value="true">On</option><option value="false">Off</option>';
        ctrl.value = val === 'true' ? 'true' : 'false';
    } else if (t === 'select') {
        ctrl = document.createElement('select');
        ctrl.innerHTML = (o || []).map(opt => { const v = Array.isArray(opt) ? opt[0] : opt, lbl = Array.isArray(opt) ? opt[1] : opt; return `<option value="${escHtml(v)}">${escHtml(lbl)}</option>`; }).join('');
        if (![...ctrl.options].some(op => op.value === val)) ctrl.insertAdjacentHTML('beforeend', `<option value="${escHtml(val)}">${escHtml(val || '(unset)')}</option>`);
        ctrl.value = val;
    } else {
        ctrl = document.createElement('input'); ctrl.type = t === 'number' ? 'number' : 'text'; ctrl.value = val;
    }
    ctrl.addEventListener('change', () => { _raChanges[k] = ctrl.value; _raCfg[k] = ctrl.value; });
    row.append(lab, ctrl);
    return row;
}
function renderRaPane(id, spec) { const c = document.getElementById(id); c.innerHTML = ''; spec.forEach(s => c.appendChild(makeRaSettingRow(s))); }
// ── EXPRESS RA SETTINGS (Settings hub → Express) ──────────────────────────────
// Curated essentials that write EmuLatte's OWN RetroArch cfg immediately (no Save button).
// Bespoke (not spec-driven) because several controls map one chip-set onto multiple cfg keys.
let _expressCfg         = {};   // live copy of the owned cfg
let _expressMonitors    = [];   // Electron displays (1-based .index; matches RA video_monitor_index)
let _expressRootShaders = [];   // root-level .slangp presets = "Emulatte presets" (user-extensible)
let _expressFavs        = [];   // [{file,name}] favourited shaders (persisted in a setting)
// Correct RetroArch aspect_ratio_index values (aspectratio_lut order) for the "More…" menu.
const EXP_ASPECT_MORE = [['1','16:9'],['2','16:10'],['4','21:9'],['5','1:1'],['7','3:2'],['11','5:4'],
                         ['21','Square pixel'],['19','32:9'],['20','Config'],['23','Custom']];

function flashExpressSaved() {
    const el = document.getElementById('express-saved'); if (!el) return;
    el.textContent = '✓ Saved'; el.classList.add('show');
    clearTimeout(flashExpressSaved._t);
    flashExpressSaved._t = setTimeout(() => el.classList.remove('show'), 1200);
}
function expApply(updates) {                        // merge → persist → repaint (so coupled chips refresh)
    Object.assign(_expressCfg, updates);
    window.api.raConfigSet(updates);
    flashExpressSaved();
    paintExpress();
}
async function renderExpressSettings() {            // async entry: load cfg + monitors + shaders + favs, then paint
    const c = document.getElementById('settings-express');
    c.innerHTML = '<div class="ra-pane-hint">Loading…</div>';
    let root = { presets: [] };
    try {
        const [cfg, mons, r, favRaw] = await Promise.all([
            window.api.raConfigGetAll().then(x => x || {}),
            window.api.getMonitors().catch(() => []),
            window.api.raBrowseShaders('').catch(() => ({ presets: [] })),
            window.api.getSetting('express_fav_shaders'),
        ]);
        _expressCfg = cfg || {}; _expressMonitors = mons || []; root = r || { presets: [] };
        try { _expressFavs = JSON.parse(favRaw) || []; } catch { _expressFavs = []; }
    } catch { _expressCfg = _expressCfg || {}; }
    _expressRootShaders = root.presets || [];
    paintExpress();
}
// small builders
function expGroup(c, title) { const h = document.createElement('div'); h.className = 'ra-simple-group'; h.textContent = title; c.appendChild(h); }
function expRow(c, label, sub) {
    const row = document.createElement('div'); row.className = 'ra-simple-row';
    const lab = document.createElement('div'); lab.className = 'ra-simple-label'; lab.textContent = label; row.appendChild(lab);
    const body = document.createElement('div'); row.appendChild(body);
    if (sub) { const s = document.createElement('div'); s.className = 'ra-simple-sub'; s.textContent = sub; row.appendChild(s); }
    c.appendChild(row); return body;
}
function expChips(body, options) {                  // options: [{label, rec, sel, on}]
    const chips = document.createElement('div'); chips.className = 'ra-chips';
    options.forEach(o => {
        const chip = document.createElement('button');
        chip.className = 'ra-chip' + (o.rec ? ' star' : '') + (o.sel ? ' sel' : '');
        chip.innerHTML = (o.rec ? '<span class="stari">★</span>' : '') + escHtml(o.label);
        chip.onclick = o.on;
        chips.appendChild(chip);
    });
    body.appendChild(chips); return chips;
}
function expTextRow(c, label, key, isPassword, sub) {
    const body = expRow(c, label, sub);
    const inp = document.createElement('input'); inp.type = isPassword ? 'password' : 'text';
    inp.value = _expressCfg[key] != null ? String(_expressCfg[key]) : ''; inp.style.width = '260px';
    inp.addEventListener('change', () => { _expressCfg[key] = inp.value; window.api.raConfigSet({ [key]: inp.value }); flashExpressSaved(); });
    body.appendChild(inp);
}
function paintExpress() {
    const c = document.getElementById('settings-express'); if (!c) return;
    const sc = document.getElementById('settings-content'); const top = sc ? sc.scrollTop : 0;
    c.innerHTML = '';
    const g = k => (_expressCfg[k] != null ? String(_expressCfg[k]) : '');

    expGroup(c, 'Display');

    if (_expressMonitors.length > 1) {                              // Screen — numbers only (Electron order ≠ desktop order)
        const cur = g('video_monitor_index') || '0';
        const body = expRow(c, 'Screen', 'Which monitor RetroArch opens on. Numbers match RetroArch — if the wrong screen lights up, try the next number.');
        const opts = [{ label: 'Auto', rec: true, sel: cur === '0', on: () => expApply({ video_monitor_index: '0' }) }];
        _expressMonitors.forEach(m => {
            const v = String(m.index);
            opts.push({ label: v, sel: cur === v, on: () => expApply({ video_monitor_index: v, video_fullscreen: 'true', video_windowed_fullscreen: 'false' }) });
        });
        expChips(body, opts);
    }

    {                                                               // Screen ratio — quick chips + More…
        const cur = g('aspect_ratio_index');
        const setA = v => expApply({ aspect_ratio_index: v, video_aspect_ratio_auto: 'false' });
        const body = expRow(c, 'Screen ratio', '4:3 = classic shape · Core provided = the system’s own · Full = stretch to fill.');
        const chips = expChips(body, [
            { label: '4:3', rec: true, sel: cur === '0', on: () => setA('0') },
            { label: 'Core provided', sel: cur === '22', on: () => setA('22') },
            { label: 'Full', sel: cur === '24', on: () => setA('24') },
        ]);
        const sel = document.createElement('select'); sel.className = 'exp-more';
        sel.innerHTML = `<option value="">More…</option>` + EXP_ASPECT_MORE.map(([v, l]) => `<option value="${v}">${escHtml(l)}</option>`).join('');
        if (EXP_ASPECT_MORE.some(([v]) => v === cur)) sel.value = cur;
        sel.onchange = () => { if (sel.value) setA(sel.value); };
        chips.appendChild(sel);
    }

    {                                                               // Fullscreen — 3-way over two keys
        const fs = g('video_fullscreen') === 'true', win = g('video_windowed_fullscreen') === 'true';
        const body = expRow(c, 'Fullscreen', 'Windowed = borderless (friendly with multi-monitor). Full = exclusive (needed to force a specific screen).');
        expChips(body, [
            { label: 'On (Windowed)', sel: fs && win, on: () => expApply({ video_fullscreen: 'true', video_windowed_fullscreen: 'true' }) },
            { label: 'On (Full)', rec: true, sel: fs && !win, on: () => expApply({ video_fullscreen: 'true', video_windowed_fullscreen: 'false' }) },
            { label: 'Off', sel: !fs, on: () => expApply({ video_fullscreen: 'false' }) },
        ]);
    }

    {                                                               // Big menu for CRT — RA's OWN menu scale + Ozone font scale (not EmuLatte)
        const big = parseFloat(g('menu_scale_factor') || '1') >= 1.5;
        const body = expRow(c, 'Big menu (for CRT / TV)', 'Enlarges RetroArch’s OWN menu so it’s readable on a CRT or TV (menu scale 2× + Global font scale 2.00×). Doesn’t affect EmuLatte.');
        expChips(body, [
            { label: 'Off', rec: true, sel: !big, on: () => expApply({ menu_scale_factor: '1.000000', ozone_font_scale: '0', ozone_font_scale_factor_global: '1.000000' }) },
            { label: 'On', sel: big, on: () => expApply({ menu_scale_factor: '2.000000', ozone_font_scale: '1', ozone_font_scale_factor_global: '2.000000' }) },
        ]);
    }

    expGroup(c, 'Shaders');
    {
        const on = g('video_shader_enable') === 'true';
        const body = expRow(c, 'Shaders', 'Visual filters like CRT scanlines.');
        expChips(body, [
            { label: 'Off', rec: true, sel: !on, on: () => expApply({ video_shader_enable: 'false' }) },
            { label: 'On', sel: on, on: () => expApply({ video_shader_enable: 'true' }) },
        ]);
        if (on) paintExpressShaders(c);
    }

    expGroup(c, 'Saves');
    {
        const auto = g('savestate_auto_save') === 'true' && g('savestate_auto_load') === 'true';
        const body = expRow(c, 'Auto-save & resume', 'Saves a state when you quit and reloads it next launch — pick up exactly where you left off.');
        expChips(body, [
            { label: 'Off', rec: true, sel: !auto, on: () => expApply({ savestate_auto_save: 'false', savestate_auto_load: 'false' }) },
            { label: 'On', sel: auto, on: () => expApply({ savestate_auto_save: 'true', savestate_auto_load: 'true' }) },
        ]);
    }

    expGroup(c, 'RetroAchievements');
    {
        const on = g('cheevos_enable') === 'true';
        const body = expRow(c, 'Achievements', 'Earn achievements as you play (needs a free retroachievements.org account).');
        expChips(body, [
            { label: 'Off', rec: true, sel: !on, on: () => expApply({ cheevos_enable: 'false' }) },
            { label: 'On', sel: on, on: () => expApply({ cheevos_enable: 'true' }) },
        ]);
        if (on) {
            expTextRow(c, 'Username', 'cheevos_username', false);
            expTextRow(c, 'Password', 'cheevos_password', true, 'Used once to sign in; RetroArch then stores a token.');
        }
    }

    if (sc) sc.scrollTop = top;
}
function paintExpressShaders(c) {
    const cur = _expressCfg.video_shader || '';
    const info = expRow(c, 'Current shader');
    info.textContent = cur ? cur.split('/').pop().replace(/\.(slangp|glslp|cgp)$/i, '') : '(none)';
    info.style.cssText = `font-size:12px; font-weight:700; color:${cur ? 'var(--accent)' : 'var(--text_dim)'};`;

    if (_expressRootShaders.length) {                               // Emulatte presets = root-level .slangp (user-extensible)
        const body = expRow(c, 'Emulatte presets', 'Curated presets. Add or remove .slangp files in the shaders folder and they show up here.');
        const wrap = document.createElement('div'); wrap.className = 'ra-chips';
        _expressRootShaders.forEach(p => wrap.appendChild(expShaderChip(p.file, p.name)));
        body.appendChild(wrap);
    } else {
        const body = expRow(c, 'Emulatte presets', 'No curated presets installed yet.');
        const btn = document.createElement('button'); btn.textContent = 'Install Emulatte presets';
        btn.onclick = async () => { btn.disabled = true; btn.textContent = '…'; await window.api.installBundledPresets(); renderExpressSettings(); };
        body.appendChild(btn);
    }

    const favs = _expressFavs.filter(f => !_expressRootShaders.some(r => r.file === f.file));
    if (favs.length) {
        const body = expRow(c, 'Favourites', 'Shaders you’ve starred for quick access.');
        const wrap = document.createElement('div'); wrap.className = 'ra-chips';
        favs.forEach(f => wrap.appendChild(expShaderChip(f.file, f.name)));
        body.appendChild(wrap);
    }

    const b = expRow(c, 'More shaders', 'Browse the full shader collection, organised by folder — star any to favourite it.');
    const btn = document.createElement('button'); btn.textContent = 'Browse all shaders…'; btn.onclick = openExpressShaderBrowser;
    b.appendChild(btn);
}
function expShaderChip(file, name) {
    const wrap = document.createElement('span'); wrap.className = 'exp-shader-chip';
    const chip = document.createElement('button');
    chip.className = 'ra-chip' + (_expressCfg.video_shader === file ? ' sel' : '');
    chip.textContent = name;
    chip.onclick = () => expApply({ video_shader: file, video_shader_enable: 'true' });
    const isFav = _expressFavs.some(f => f.file === file);
    const star = document.createElement('button');
    star.className = 'exp-fav' + (isFav ? ' on' : ''); star.innerHTML = '★';
    star.title = isFav ? 'Remove favourite' : 'Add favourite';
    star.onclick = e => { e.stopPropagation(); toggleExpressFav(file, name); };
    wrap.append(chip, star); return wrap;
}
function toggleExpressFav(file, name) {
    const i = _expressFavs.findIndex(f => f.file === file);
    if (i >= 0) _expressFavs.splice(i, 1); else _expressFavs.push({ file, name });
    window.api.setSetting('express_fav_shaders', JSON.stringify(_expressFavs));
    paintExpress();
}
const _shaderBrowserExpress = createShaderBrowser({
    crumbs: 'exp-shader-crumbs', list: 'exp-shader-browser', current: 'exp-shader-current',
    get: () => _expressCfg.video_shader || '',
    set: f => { _expressCfg.video_shader = f; _expressCfg.video_shader_enable = 'true';
                window.api.raConfigSet({ video_shader: f, video_shader_enable: 'true' }); flashExpressSaved(); },
    fav: { has: f => _expressFavs.some(x => x.file === f), toggle: (f, n) => toggleExpressFav(f, n) },
});
function openExpressShaderBrowser() {
    openModal('modal-express-shaders');
    _shaderBrowserExpress.refreshCurrent();
    _shaderBrowserExpress.go('');
}
function renderRaAll() {
    const c = document.getElementById('ra-pane-all'); c.innerHTML = '';
    const frag = document.createDocumentFragment();
    Object.keys(_raCfg).sort().forEach(k => {
        const v = String(_raCfg[k] ?? '');
        frag.appendChild(makeRaSettingRow({ k, l: k, t: (v === 'true' || v === 'false') ? 'bool' : 'text' }));
    });
    c.appendChild(frag); _raAllRendered = true;
}
const SHADER_TAG = { slangp: 'SLANG', glslp: 'GLSL', cgp: 'CG' };
// Reusable shader folder-browser. get()/set() bind it to wherever the selected preset lives.
function createShaderBrowser({ crumbs, list, current, get, set, fav }) {
    const refreshCurrent = () => {
        const cur = get();
        const el = document.getElementById(current); if (el) el.textContent = cur ? cur.split('/').pop() : '(none)';
        document.querySelectorAll('#' + list + ' .ra-shader-item').forEach(x => x.classList.toggle('sel', x.dataset.file === cur && !!cur));
    };
    async function go(rel = '') {
        let res = { dirs: [], presets: [] }; try { res = await window.api.raBrowseShaders(rel); } catch {}
        const cr = document.getElementById(crumbs);
        const parts = rel ? rel.split('/').filter(Boolean) : [];
        let acc = ''; let html = `<a data-rel="">shaders</a>`;
        parts.forEach(p => { acc = acc ? acc + '/' + p : p; html += ` <span>/</span> <a data-rel="${escHtml(acc)}">${escHtml(p)}</a>`; });
        cr.innerHTML = html;
        cr.querySelectorAll('a').forEach(a => a.onclick = () => go(a.dataset.rel));
        const b = document.getElementById(list); b.innerHTML = '';
        res.dirs.forEach(d => {
            const el = document.createElement('div'); el.className = 'ra-shader-item folder';
            el.innerHTML = `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg><span>${escHtml(d)}</span>`;
            el.onclick = () => go(rel ? rel + '/' + d : d);
            b.appendChild(el);
        });
        res.presets.forEach(p => {
            const el = document.createElement('div'); el.className = 'ra-shader-item'; el.dataset.file = p.file;
            el.innerHTML = `<span class="ra-shader-tag">${SHADER_TAG[p.type] || '?'}</span><span style="flex:1; min-width:0;">${escHtml(p.name)}</span>`;
            if (p.file === get()) el.classList.add('sel');
            el.onclick = () => { set(p.file); refreshCurrent(); };
            if (fav) {                                              // optional ⭐ favourite toggle per preset
                const star = document.createElement('button');
                star.className = 'exp-fav' + (fav.has(p.file) ? ' on' : ''); star.innerHTML = '★';
                star.title = fav.has(p.file) ? 'Remove favourite' : 'Add favourite';
                star.onclick = e => { e.stopPropagation(); fav.toggle(p.file, p.name); star.classList.toggle('on'); };
                el.appendChild(star);
            }
            b.appendChild(el);
        });
        if (!res.dirs.length && !res.presets.length) b.innerHTML = '<div class="ra-pane-hint" style="padding:12px;">Empty folder.</div>';
    }
    return { go, refreshCurrent };
}
// Main Shaders pane (writes the owned base config).
const _shaderBrowserMain = createShaderBrowser({
    crumbs: 'ra-shader-crumbs', list: 'ra-shader-browser', current: 'ra-shader-current',
    get: () => _raCfg.video_shader || '', set: f => { _raChanges.video_shader = f; _raCfg.video_shader = f; },
});
// Per-system / per-game override modal (writes the override's shader field).
let _raOvrShader = '';
const _shaderBrowserOvr = createShaderBrowser({
    crumbs: 'ra-ovr-shader-crumbs', list: 'ra-ovr-shader-browser', current: 'ra-ovr-shader-current',
    get: () => _raOvrShader, set: f => { _raOvrShader = f; },
});
function renderRaShaders() {
    const en = document.getElementById('ra-shader-enable');
    en.value = _raCfg.video_shader_enable === 'true' ? 'true' : 'false';
    en.onchange = () => { _raChanges.video_shader_enable = en.value; _raCfg.video_shader_enable = en.value; };
    _shaderBrowserMain.refreshCurrent();
    document.getElementById('ra-shader-clear').onclick = () => { _raChanges.video_shader = ''; _raCfg.video_shader = ''; _shaderBrowserMain.refreshCurrent(); };
    _shaderBrowserMain.go('');
}
async function renderRaCoreOpts() {
    const c = document.getElementById('ra-coreopts-list'); c.innerHTML = '';
    let res = { options: [] }; try { res = await window.api.raCoreOptionsGet(); } catch {}
    if (!res.options || !res.options.length) { c.innerHTML = '<div class="ra-pane-hint">No core options set yet — they appear once you set them in RetroArch (Quick Menu → Core Options).</div>'; return; }
    res.options.forEach(({ k, v }) => {
        const row = document.createElement('div'); row.className = 'ra-set-row'; row.dataset.label = k.toLowerCase();
        const lab = document.createElement('label'); lab.innerHTML = `<span class="ra-key">${escHtml(k)}</span>`;
        const inp = document.createElement('input'); inp.type = 'text'; inp.value = v;
        inp.addEventListener('change', () => { _raCoreChanges[k] = inp.value; });
        row.append(lab, inp); c.appendChild(row);
    });
}
async function renderRaTemplates() {
    const c = document.getElementById('ra-template-list'); c.innerHTML = '';
    let templates = []; try { templates = await window.api.getControlTemplates(); } catch {}
    if (!templates.length) { c.innerHTML = '<div class="ra-pane-hint">No templates apply to your current systems.</div>'; return; }
    templates.forEach(t => {
        const card = document.createElement('div'); card.className = 'tool-card'; card.style.marginBottom = '10px';
        const title = document.createElement('div'); title.className = 'tool-card-title'; title.textContent = t.name;
        const desc = document.createElement('div'); desc.className = 'hint'; desc.style.marginTop = '0'; desc.textContent = t.desc;
        card.append(title, desc);
        t.targets.forEach(tg => {
            const row = document.createElement('div'); row.className = 'ra-set-row';
            const lab = document.createElement('label'); lab.innerHTML = `${escHtml(tg.systemName)}<br><span class="ra-key">${escHtml(tg.folder)}${tg.installed ? ' · installed' : ''}</span>`;
            const btn = document.createElement('button'); btn.textContent = tg.installed ? 'Re-install' : 'Install'; btn.style.fontSize = '11px'; btn.style.flexShrink = '0';
            btn.onclick = async () => {
                btn.disabled = true; btn.textContent = '…';
                const r = await window.api.installControlTemplate(t.id, tg.systemId);
                if (r.ok) { showLaunchToast(`Installed “${t.name}” for ${tg.systemName}.`, null, 'CONTROLS'); renderRaTemplates(); renderRaRemaps(); }
                else { btn.disabled = false; btn.textContent = 'Install'; showLaunchToast(r.error || 'Install failed', null, 'CONTROLS'); }
            };
            row.append(lab, btn); card.appendChild(row);
        });
        c.appendChild(card);
    });
}
async function renderRaRemaps() {
    const c = document.getElementById('ra-remap-list'); c.innerHTML = '';
    let list = []; try { list = await window.api.raListRemaps(); } catch {}
    if (!list.length) { c.innerHTML = '<div class="ra-pane-hint">No remap files found.</div>'; return; }
    list.forEach(r => {
        const row = document.createElement('div'); row.className = 'ra-set-row';
        const lab = document.createElement('label'); lab.innerHTML = `${escHtml(r.name)}<br><span class="ra-key">${escHtml(r.core)}${r.enabled ? '' : ' · disabled'}</span>`;
        const wrap = document.createElement('div'); wrap.style.cssText = 'display:flex; gap:8px; flex-shrink:0;';
        const tog = document.createElement('button'); tog.textContent = r.enabled ? 'Disable' : 'Enable'; tog.style.fontSize = '11px';
        tog.onclick = async () => { await window.api.raRemapToggle(r.path, !r.enabled); renderRaRemaps(); };
        const del = document.createElement('button'); del.textContent = 'Delete'; del.className = 'danger'; del.style.fontSize = '11px';
        del.onclick = async () => { if (await showConfirm(`Delete remap “${r.name}” (${r.core})?`, 'Delete', true, 'Delete Remap')) { await window.api.raRemapDelete(r.path); renderRaRemaps(); } };
        wrap.append(tog, del); row.append(lab, wrap); c.appendChild(row);
    });
}

async function openRaSettings() {
    closeModal('modal-settings');                       // never stack two blurred modals
    _raCfg = await window.api.raConfigGetAll(); _raChanges = {}; _raCoreChanges = {}; _raAllRendered = false;
    renderRaShaders(); renderRaCoreOpts(); renderRaTemplates(); renderRaRemaps();
    renderRaPane('ra-pane-drivers', RA_DRIVERS_SPEC);
    renderRaPane('ra-pane-video', RA_VIDEO_SPEC);
    renderRaPane('ra-pane-audio', RA_AUDIO_SPEC);
    renderRaPane('ra-pane-input', RA_INPUT_SPEC);
    renderRaPane('ra-pane-latency', RA_LATENCY_SPEC);
    renderRaPane('ra-pane-core', RA_CORE_SPEC);
    renderRaPane('ra-pane-config', RA_CONFIG_SPEC);
    renderRaPane('ra-pane-saving', RA_SAVING_SPEC);
    renderRaPane('ra-pane-throttle', RA_THROTTLE_SPEC);
    renderRaPane('ra-pane-osd', RA_OSD_SPEC);
    renderRaPane('ra-pane-ui', RA_UI_SPEC);
    renderRaPane('ra-pane-cheevos', RA_CHEEVOS_SPEC);
    renderRaPane('ra-pane-netplay', RA_NETPLAY_SPEC);
    renderRaPane('ra-pane-playlists', RA_PLAYLIST_SPEC);
    renderRaPane('ra-pane-overlay', RA_OVERLAY_SPEC);
    renderRaPane('ra-pane-logging', RA_LOGGING_SPEC);
    renderRaPane('ra-pane-recording', RA_RECORDING_SPEC);
    renderRaPane('ra-pane-power', RA_POWER_SPEC);
    renderRaPane('ra-pane-ai', RA_AI_SPEC);
    renderRaPane('ra-pane-access', RA_ACCESS_SPEC);
    renderRaPane('ra-pane-user', RA_USER_SPEC);
    renderRaPane('ra-pane-filebrowser', RA_FILEBROWSER_SPEC);
    renderRaPane('ra-pane-directory', RA_DIR_SPEC);
    document.getElementById('ra-pane-all').innerHTML = '';
    document.getElementById('ra-set-search').value = '';
    document.getElementById('ra-set-content').classList.remove('searching');
    document.querySelectorAll('#ra-set-rail .cp-rail-item').forEach(b => b.classList.toggle('active', b.dataset.rapane === 'video'));
    document.querySelectorAll('#modal-ra-settings .cp-pane').forEach(p => p.classList.toggle('active', p.dataset.rapane === 'video'));
    document.getElementById('ra-set-content').scrollTop = 0;
    openModal('modal-ra-settings');
}

function openSaveManager(gameId = null) {
    _smSel = -1; _smFromGames = false; _smScroll = 0;   // fresh open starts at the top
    openModal('modal-save-manager');
    gameId ? smShowSlots(gameId) : smShowGames();
}

async function smShowGames() {
    _smGame = null;
    document.getElementById('sm-back').style.display = 'none';
    document.getElementById('sm-fresh').style.display = 'none';
    document.getElementById('sm-slot-actions').style.display = 'none';
    document.getElementById('sm-restore').style.display = '';
    document.getElementById('sm-search').style.display = '';
    document.getElementById('sm-sort').style.display = '';
    document.getElementById('sm-backup').textContent = '⤓ BACKUP ALL';
    document.getElementById('sm-title').textContent = 'SAVE STATES';
    document.getElementById('sm-grid').classList.remove('slots');
    _smGames = await window.api.listGamesWithSaves();
    document.getElementById('sm-sub').textContent = `${_smGames.length} GAMES`;
    smRenderGames();
    document.getElementById('sm-grid').scrollTop = _smScroll;   // keep position when returning from a game
}

function smRenderGames() {
    const q = (document.getElementById('sm-search').value || '').trim().toLowerCase();
    let list = q ? _smGames.filter(g => (g.title || '').toLowerCase().includes(q)) : _smGames.slice();
    if (_smSort === 'alpha') list.sort((a, b) => (a.title || '').localeCompare(b.title || ''));
    else                     list.sort((a, b) => (b.latest || 0) - (a.latest || 0));
    document.getElementById('sm-detail').textContent = !_smGames.length ? 'NO SAVE STATES FOUND.' : (list.length ? 'SELECT A GAME' : 'NO MATCHES.');
    const grid = document.getElementById('sm-grid');
    grid.innerHTML = list.map(g => {
        const fg = g.logo || g.cover || g.thumb;   // foreground art — always contained & centered
        const bg = g.cover || g.thumb;             // blurred backdrop fills the box with the game's palette
        const art = fg
            ? `${bg ? `<div class="sm-bg" style="background-image:url('${escHtml(bg)}')"></div>` : ''}<img class="logo" src="${escHtml(fg)}">`
            : `<div class="sm-name">${escHtml(g.title)}</div>`;
        return `<div class="sm-card" data-id="${g.id}">${art}<span class="sm-count">${g.count}</span><span class="sm-tag">${escHtml(g.title)}</span></div>`;
    }).join('') || `<div class="sm-name" style="grid-column:1/-1;padding:40px;">NO MATCHES.</div>`;
    grid.querySelectorAll('.sm-card').forEach(el => el.addEventListener('click', () => { _smScroll = grid.scrollTop; _smFromGames = true; smShowSlots(Number(el.dataset.id)); }));
}

async function smShowSlots(gameId) {
    _smGame = allGames.find(g => g.id === gameId) || { id: gameId, title: 'GAME' };
    _smSel = -1;
    document.getElementById('sm-back').style.display = _smFromGames ? '' : 'none';
    document.getElementById('sm-fresh').style.display = '';
    document.getElementById('sm-slot-actions').style.display = 'none';
    document.getElementById('sm-restore').style.display = 'none';
    document.getElementById('sm-search').style.display = 'none';
    document.getElementById('sm-sort').style.display = 'none';
    document.getElementById('sm-backup').textContent = '⤓ BACKUP';
    document.getElementById('sm-title').textContent = (_smGame.title || 'GAME').toUpperCase();
    document.getElementById('sm-detail').textContent = 'SELECT A SAVE…';
    _smSlots = await window.api.listSaveStates(gameId);
    document.getElementById('sm-sub').textContent = `${_smSlots.length} SAVE${_smSlots.length !== 1 ? 'S' : ''}`;
    const grid = document.getElementById('sm-grid');
    grid.classList.add('slots');
    grid.innerHTML = _smSlots.map((s, i) => `<div class="sm-card" data-idx="${i}">
        ${s.thumb ? `<img src="${escHtml(s.thumb)}">` : `<div class="sm-name">${smSlotName(s.slot)}</div>`}
        <span class="sm-tag">${escHtml(s.label || smSlotName(s.slot))}</span>
    </div>`).join('') || `<div class="sm-name" style="grid-column:1/-1;padding:40px;">NO SAVES FOR THIS GAME YET.</div>`;
    grid.querySelectorAll('.sm-card').forEach(el => el.addEventListener('click', () => smSelectSlot(Number(el.dataset.idx))));
}

function smSelectSlot(i) {
    _smSel = i;
    document.querySelectorAll('#sm-grid .sm-card').forEach((el, idx) => el.classList.toggle('sel', idx === i));
    const s = _smSlots[i];
    document.getElementById('sm-detail').textContent = `${smSlotName(s.slot)}${s.label ? ` · "${s.label}"` : ''} · ${smFmtBytes(s.size)} · ${smFmtDate(s.mtime)}`;
    document.getElementById('sm-slot-actions').style.display = '';
}

async function smLaunch(opts) {
    if (!_smGame) return;
    const r = await window.api.launchGameEx(_smGame.id, opts);
    if (r.ok) { closeModal('modal-save-manager'); showNowPlaying(allGames.find(g => g.id === _smGame.id) || _smGame); }
    else showLaunchToast(r.error || 'Launch failed', null);
}

function renderGallery(games) {
    const grid = document.getElementById('gallery-grid');
    if (!games.length) {
        grid.innerHTML = `<div style="grid-column:1/-1; padding:60px; text-align:center; color:var(--text_dim); font-weight:900; letter-spacing:2px; font-size:14px;">NO ROMS FOUND</div>`;
        document.getElementById('hero-icon').style.display = 'block';
        return;
    }
    document.getElementById('hero-icon').style.display = 'none';
    // Build the whole grid as one string. Interactions are handled by ONE delegated listener on the
    // grid (wired once in wireUI) — not per-card listeners — and covers lazy-load + skip off-screen
    // layout via CSS content-visibility, so even a multi-thousand-game library stays responsive.
    const fbStyle  = 'align-items:center; justify-content:center; color:var(--text_dim); font-size:11px; font-weight:900; letter-spacing:1px; text-align:center;';
    grid.innerHTML = games.map(g => {
        const hasCover = g.cover && g.cover !== '';
        const sysLabel = g.system_short || g.system_name || '';
        const special  = hasSpecialCover(g.system_short);
        const jewel    = isJewel(g.system_short);
        return `<div class="gallery-item" data-id="${g.id}"${jewel ? ' data-jewel="1"' : ''}>
            <div class="gallery-cover-wrap${special ? ' special' : ''}">
                ${special && hasCover ? `<div class="gcover-bg" style="background-image:url('${g.cover}')"></div>` : ''}
                <div class="cover-frame">
                    ${hasCover
                        ? `<img class="gallery-cover" src="${g.cover}" loading="lazy" decoding="async" onerror="this.style.display='none';this.nextElementSibling.style.display='flex';">
                           <div class="gallery-cover gallery-cover-fallback" style="display:none; ${fbStyle}">${escHtml(g.title)}</div>`
                        : `<div class="gallery-cover gallery-cover-fallback" style="display:flex; ${fbStyle}">${escHtml(g.title)}</div>`
                    }
                </div>
                ${sysLabel ? `<div class="gallery-system-badge">${escHtml(sysLabel)}</div>` : ''}
                <div class="gallery-flag-btns ${g.fav || g.want ? 'has-active' : ''}">
                    <button class="btn-gallery-fav  ${g.fav  ? 'active' : ''}" data-field="fav"  title="Favourite">★</button>
                    <button class="btn-gallery-want ${g.want ? 'active' : ''}" data-field="want" title="Want to Play">♥</button>
                    <button class="btn-gallery-playlist" title="Add to playlist"><svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><line x1="3" y1="6" x2="14" y2="6"/><line x1="3" y1="12" x2="14" y2="12"/><line x1="3" y1="18" x2="10" y2="18"/><line x1="18" y1="9" x2="18" y2="19"/><line x1="13" y1="14" x2="23" y2="14"/></svg></button>
                </div>
            </div>
            <div class="gallery-title">${escHtml(g.title)}</div>
            <button class="btn-play-gallery">▶ PLAY</button>
        </div>`;
    }).join('');
}

// Wired ONCE (wireUI). Delegated click + lazy-image jewel measuring — O(1) per render regardless of size.
function wireGalleryDelegation() {
    const grid = document.getElementById('gallery-grid');
    grid.addEventListener('click', async e => {
        const card = e.target.closest('.gallery-item'); if (!card) return;
        const id = Number(card.dataset.id);
        if (e.target.closest('.btn-play-gallery'))     { e.stopPropagation(); launchGame(id); return; }
        if (e.target.closest('.btn-gallery-playlist'))  { e.stopPropagation(); openPlaylistPicker(id); return; }
        const flag = e.target.closest('.btn-gallery-fav, .btn-gallery-want');
        if (flag) {
            e.stopPropagation();
            const field = flag.dataset.field, game = gamesById.get(id); if (!game) return;
            const newVal = game[field] ? 0 : 1; game[field] = newVal;
            await window.api.setGameFlag(id, field, newVal);
            flag.classList.toggle('active', !!newVal);
            const wrap = flag.closest('.gallery-flag-btns');
            wrap.classList.toggle('has-active', !!wrap.querySelector('.active'));
            flag.style.animation = ''; void flag.offsetWidth; flag.style.animation = 'gallery-flag-glow 0.35s ease-out';
            return;
        }
        const game = gamesById.get(id); if (game) openGamePage(game);
    });
    // Cover load → only jewel cards need AR measuring; load doesn't bubble, so listen in capture phase.
    grid.addEventListener('load', e => {
        const img = e.target;
        if (img.classList && img.classList.contains('gallery-cover')) {
            const item = img.closest('.gallery-item');
            if (item && item.dataset.jewel === '1') applyJewelCase(img, img.closest('.cover-frame'));
        }
    }, true);
    // List view: one delegated listener for the table rows.
    document.getElementById('list-tbody').addEventListener('click', async e => {
        const fav = e.target.closest('[data-fav]');
        if (fav) {
            e.stopPropagation();
            const id = Number(fav.dataset.fav), game = gamesById.get(id); if (!game) return;
            game.fav = game.fav ? 0 : 1;
            await window.api.setGameFlag(id, 'fav', game.fav);
            fav.textContent = game.fav ? '★' : '☆';
            fav.style.color = game.fav ? '#ffeb3b' : 'var(--text_dim)';
            return;
        }
        const launch = e.target.closest('.btn-launch-list');
        if (launch) { e.stopPropagation(); launchGame(Number(launch.dataset.id)); return; }
        const row = e.target.closest('tr[data-id]');
        if (row) { const game = gamesById.get(Number(row.dataset.id)); if (game) openGamePage(game); }
    });
}

function renderList(games) {
    const tbody = document.getElementById('list-tbody');
    if (!games.length) {
        tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; padding:40px; color:var(--text_dim);">No ROMs found</td></tr>`;
        return;
    }
    tbody.innerHTML = games.map(g => `
        <tr data-id="${g.id}">
            <td><button class="btn-launch-list" data-id="${g.id}" style="padding:6px 14px; font-size:11px; background:#e65100; border:none; color:#fff; border-radius:4px; cursor:pointer; font-family:inherit; font-weight:900;">▶</button></td>
            <td><span style="color:${g.fav ? '#ffeb3b' : 'var(--text_dim)'}; cursor:pointer;" data-fav="${g.id}">${g.fav ? '★' : '☆'}</span></td>
            <td>${escHtml(g.title)}</td>
            <td>${escHtml(g.system_name || '')}</td>
            <td>${escHtml(g.year || '')}</td>
            <td>${escHtml(g.genre || '')}</td>
        </tr>
    `).join('');

    // Row interactions handled by one delegated listener on #list-tbody (wired once in wireUI).
}

// ── HERO CYCLE ────────────────────────────────────────────────────────────────
function startHeroCycle() {
    clearInterval(heroCycleTimer);
    const img = document.getElementById('hero-kb-img');
    const nameEl = document.getElementById('hero-game-name');
    const games = getFilteredGames().filter(g => g.hero);
    heroQueue = games.length ? games : allGames.filter(g => g.hero);
    if (!heroQueue.length) { img.style.opacity = 0; nameEl.textContent = ''; return; }
    let i = 0;
    const show = () => {
        const g = heroQueue[i % heroQueue.length];
        img.style.opacity = 0;
        setTimeout(() => {
            img.src = g.hero;
            img.style.opacity = 1;
            nameEl.textContent = g.title;
        }, 500);
        i++;
    };
    show();
    heroCycleTimer = setInterval(show, 6000);
}

// ── SYSTEM FILTERS ────────────────────────────────────────────────────────────
function renderSystemFilters() {
    const container = document.getElementById('system-filters');
    if (!allSystems.length) {
        container.innerHTML = '';
        return;
    }
    container.innerHTML = `<div style="font-size:10px; font-weight:900; color:var(--text_dim); letter-spacing:2px; text-transform:uppercase; margin-bottom:4px; padding-left:2px;">Systems</div>` +
        allSystems.map(s => {
            const count = allGames.filter(g => g.system_id === s.id).length;
            return `<button class="filter-btn-system" data-system-id="${s.id}" data-filter="${s.id}"
                style="width:100%; text-align:left; font-size:11px; padding:8px 10px; background:var(--bg_menu); border:1px solid var(--border); color:var(--text_sec); border-radius:6px; display:flex; justify-content:space-between; align-items:center;">
                <span>${escHtml(s.name)}</span>
                <span style="color:var(--text_dim); font-size:10px;">${count}</span>
            </button>`;
        }).join('');

    container.querySelectorAll('.filter-btn-system').forEach(btn => {
        if (String(currentFilter) === String(btn.dataset.filter)) btn.style.background = 'var(--text_main)';
        btn.addEventListener('click', () => setFilter(btn.dataset.filter));
    });
}

function populateSystemSelects() {
    const opts = `<option value="">— Select System —</option>` +
        allSystems.map(s => `<option value="${s.id}">${escHtml(s.name)}</option>`).join('');
    ['add-rom-system', 'scan-system-select', 'edit-system'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.innerHTML = opts;
    });
}

function renderPlaylistFilters() {
    const container = document.getElementById('playlist-filters');
    if (!allPlaylists.length) { container.innerHTML = ''; return; }
    container.innerHTML = allPlaylists.map(p =>
        `<div style="display:flex; align-items:center; gap:6px;">
            <button class="filter-btn-playlist" data-filter="playlist:${p.id}"
                style="flex:1; text-align:left; font-size:11px; padding:8px 10px; background:var(--bg_menu); border:1px solid var(--border); color:var(--text_sec); border-radius:6px; cursor:pointer; font-family:inherit; font-weight:900; transition:background 0.15s;">
                ${escHtml(p.name)}
            </button>
            <button class="btn-playlist-edit" data-playlist-id="${p.id}" title="Rename / Delete"
                style="width:26px; height:26px; padding:0; background:transparent; border:1px solid var(--border); color:var(--text_dim); border-radius:4px; font-size:15px; flex-shrink:0; cursor:pointer; display:flex; align-items:center; justify-content:center; font-family:inherit;">⋯</button>
        </div>`
    ).join('');

    container.querySelectorAll('.filter-btn-playlist').forEach(btn => {
        if (currentFilter === btn.dataset.filter) {
            btn.style.background  = 'var(--text_main)';
            btn.style.color       = 'var(--bg)';
            btn.style.borderColor = 'var(--text_main)';
            btn.style.boxShadow   = '0 0 10px var(--text_main)';
        }
        btn.addEventListener('click', () => setFilter(btn.dataset.filter));
    });

    container.querySelectorAll('.btn-playlist-edit').forEach(btn => {
        btn.addEventListener('click', e => {
            e.stopPropagation();
            const pl = allPlaylists.find(p => p.id === Number(btn.dataset.playlistId));
            if (pl) openPlaylistEditModal(pl);
        });
    });
}

function openPlaylistEditModal(pl) {
    document.getElementById('edit-playlist-id').value   = pl.id;
    document.getElementById('edit-playlist-name').value = pl.name;
    openModal('modal-edit-playlist');
}

// ── GAMEPAGE ──────────────────────────────────────────────────────────────────
// Full-screen image viewer — click backdrop or press Escape to dismiss.
function openImageLightbox(src) {
    if (!src) return;
    const ov = document.createElement('div');
    ov.id = 'img-lightbox';
    ov.style.cssText = 'position:fixed; inset:0; z-index:100001; background:rgba(0,0,0,0.85); ' +
        'display:flex; align-items:center; justify-content:center; padding:40px; cursor:zoom-out; backdrop-filter:blur(4px);';
    const img = document.createElement('img');
    img.src = src;
    img.style.cssText = 'max-width:100%; max-height:100%; object-fit:contain; border-radius:8px; box-shadow:0 20px 60px rgba(0,0,0,0.85);';
    ov.appendChild(img);
    const close = () => { ov.remove(); document.removeEventListener('keydown', onKey); };
    const onKey = e => { if (e.key === 'Escape') close(); };
    ov.addEventListener('click', close);
    document.addEventListener('keydown', onKey);
    document.body.appendChild(ov);
}

function openGamePage(game) {
    currentGame = game;

    const hero = document.getElementById('gamepage-hero');
    hero.style.backgroundImage = game.hero ? `url("${game.hero}")` : '';
    hero.style.backgroundColor = game.hero ? '' : 'var(--bg_menu)';

    const logo = document.getElementById('gamepage-logo');
    if (game.logo) { logo.src = game.logo; logo.style.display = 'block'; }
    else           { logo.src = ''; logo.style.display = 'none'; }

    const titleEl = document.getElementById('gamepage-title-text');
    titleEl.textContent = game.title;
    titleEl.style.display = game.logo ? 'none' : 'block';

    const sysBadge = document.getElementById('gamepage-system-badge');
    if (game.system_name) {
        sysBadge.style.display = 'flex';
        sysBadge.innerHTML = `<span style="background:rgba(0,0,0,0.6); color:var(--accent); font-size:11px; font-weight:900; letter-spacing:2px; padding:4px 10px; border-radius:20px; text-transform:uppercase; border:1px solid var(--border_solid);">${escHtml(game.system_name)}</span>`;
    } else {
        sysBadge.style.display = 'none';
    }

    document.getElementById('btn-gamepage-fav').classList.toggle('active',  !!game.fav);
    document.getElementById('btn-gamepage-want').classList.toggle('active', !!game.want);

    const cov = document.getElementById('gamepage-cover');
    cov.src = game.cover || '';
    cov.style.cursor = game.cover ? 'zoom-in' : 'default';
    // Default: show the FULL cover at its natural ratio across the column width — no crop,
    // whatever the shape (e.g. tall 3DO boxes). The jewel case (square art) overrides this via CSS.
    cov.style.aspectRatio = 'auto';
    cov.style.objectFit   = 'contain';
    const coverFrame = document.getElementById('gamepage-cover-frame');
    coverFrame.classList.remove('jewel');
    if (isJewel(game.system_short)) applyJewelCase(cov, coverFrame);   // square art → jewel case; tall/portrait art stays full

    const stats = [];
    if (game.system_name) stats.push({ label: 'System',    val: game.system_name });
    if (game.year)        stats.push({ label: 'Released',  val: game.year });
    if (game.developer)   stats.push({ label: 'Developer', val: game.developer });
    if (game.publisher)   stats.push({ label: 'Publisher', val: game.publisher });
    if (game.genre)       stats.push({ label: 'Genre',     val: game.genre });
    if (game.players)     stats.push({ label: 'Players',   val: game.players });
    if (game.rating)      stats.push({ label: 'Rating',    val: game.rating });
    document.getElementById('gamepage-stats').innerHTML = stats.map(s =>
        `<div class="gamepage-stat"><span class="stat-label">${s.label}</span><span class="stat-val">${escHtml(s.val)}</span></div>`
    ).join('');

    document.getElementById('gamepage-description').textContent = game.description || '';
    document.getElementById('gp-ach-container').innerHTML = '';
    loadGamepageAchievements(game);

    const trailerBtn = document.getElementById('btn-gamepage-trailer');
    trailerBtn.style.display = 'none';
    trailerBtn.onclick = null;
    const capturedTitle = game.title;
    window.api.checkLocalTrailer(capturedTitle).then(localUrl => {
        if (localUrl && currentGame?.title === capturedTitle) {
            trailerBtn.style.display = 'flex';
            trailerBtn.onclick = () => {
                document.getElementById('modal-trailer-player').classList.add('active');
                const vid = document.getElementById('detail-video-player');
                vid.src = localUrl; vid.play();
            };
        }
    });

    clearInterval(ssBannerKbInterval);
    const banner   = document.getElementById('gamepage-screenshots-banner');
    const ssKbImg  = document.getElementById('gamepage-ss-kb-img');
    if (game.screenshot) {
        const screens = String(game.screenshot).split('|').filter(s => s.trim());
        if (screens.length) {
            banner.style.display = 'block';
            let kbIdx = 0;
            const showNextSs = () => {
                ssKbImg.style.opacity = '0';
                setTimeout(() => {
                    ssKbImg.src     = screens[kbIdx];
                    ssKbImg.style.opacity = '1';
                    kbIdx = (kbIdx + 1) % screens.length;
                }, 500);
            };
            showNextSs();
            if (screens.length > 1) ssBannerKbInterval = setInterval(showNextSs, 5000);
            banner.onclick = () => openSlideshow(screens, 0);
        } else {
            banner.style.display = 'none';
        }
    } else {
        banner.style.display = 'none';
    }

    switchView('view-gamepage');
}

let _bgView = 'view-gallery';
function switchView(viewId) {
    const gp = document.getElementById('view-gamepage');
    const backdrop = document.getElementById('gamepage-backdrop');

    if (viewId === 'view-gamepage') {
        // Float the game page over the current view (gallery/list) with a blurred backdrop —
        // the background view stays active underneath rather than being swapped out.
        if (currentView !== 'view-gamepage') _bgView = currentView;
        gp.classList.add('active');
        backdrop.classList.add('active');
        document.body.classList.add('gamepage-open');   // shows the floating Play button (a layer outside the scrolling panel)
        currentView = 'view-gamepage';
        document.getElementById('gamepage-back-bar').style.display = 'none';
        return;
    }

    gp.classList.remove('active');
    backdrop.classList.remove('active');
    document.body.classList.remove('gamepage-open');
    document.querySelectorAll('.view').forEach(v => { if (v !== gp) v.classList.remove('active'); });
    document.getElementById(viewId)?.classList.add('active');
    currentView = viewId;
    document.getElementById('gamepage-back-bar').style.display = 'none';
    document.getElementById('btn-view-gallery')?.classList.toggle('active', viewId === 'view-gallery');
    document.getElementById('btn-view-list')?.classList.toggle('active', viewId === 'view-list');

    currentGame = null;
    clearInterval(ssBannerKbInterval);
    startHeroCycle();
}

function closeGamePage() { switchView(_bgView || 'view-gallery'); renderCurrentView(); }

// ── LAUNCH ────────────────────────────────────────────────────────────────────
async function launchGame(id) {
    const result = await window.api.launchGame(id);
    if (!result.ok) { showLaunchToast(result.error || 'No launch command configured', result.cmd); return; }
    const game = allGames.find(g => g.id === id);
    if (game) showNowPlaying(game);
}

// ── Now Playing popup (mirrors CafeNeurotico) ─────────────────────────────────
let _npTimer = null;
function showNowPlaying(game) {
    const modal    = document.getElementById('modal-now-playing');
    const artBg    = document.getElementById('np-art-bg');
    const logoImg  = document.getElementById('np-logo-img');
    const coverImg = document.getElementById('np-cover-img');
    const artWrap  = document.getElementById('np-art');
    const titleEl  = document.getElementById('np-title');
    if (!modal) return;

    titleEl.textContent = game.title || '';

    const logo  = game.logo  || null;
    const cover = game.cover || null;
    const hero  = game.hero  || null;

    logoImg.style.display  = 'none';
    coverImg.style.display = 'none';
    artBg.style.backgroundImage = '';

    if (logo) {
        artWrap.style.display = 'flex';
        logoImg.src = logo; logoImg.style.display = '';
        if (cover || hero) artBg.style.backgroundImage = `url("${cover || hero}")`;
    } else if (cover) {
        artWrap.style.display = 'flex';
        coverImg.src = cover; coverImg.style.display = '';
        artBg.style.backgroundImage = `url("${cover}")`;
    } else {
        artWrap.style.display = 'none';
    }

    modal.classList.add('active');
    clearTimeout(_npTimer);
    _npTimer = setTimeout(closeNowPlaying, 5000);
}
function closeNowPlaying() {
    clearTimeout(_npTimer);
    document.getElementById('modal-now-playing')?.classList.remove('active');
}

let toastTimer = null;
function showLaunchToast(msg, cmd, label) {
    const toast  = document.getElementById('launch-toast');
    const msgEl  = document.getElementById('launch-toast-msg');
    const isInfo = !cmd && /^(Done|Stopped|Scraped|Added|Updated)/.test(msg);
    toast.style.borderColor = isInfo ? 'var(--border_solid)' : '#c62828';
    toast.querySelector('div').style.color = isInfo ? 'var(--accent)' : '#ef5350';
    toast.querySelector('div').textContent = label || (isInfo ? 'SCRAPE' : 'LAUNCH FAILED');
    msgEl.textContent = cmd ? `${msg}\n\nCommand: ${cmd}` : msg;
    toast.style.display = 'block';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toast.style.display = 'none'; }, 7000);
    toast.onclick = () => { toast.style.display = 'none'; clearTimeout(toastTimer); };
}

async function pushGameToCngm(gameId, btn) {
    if (!gameId) return;
    if (btn) { btn.disabled = true; btn.classList.add('working'); }
    const r = await window.api.addToCngm(gameId);
    if (btn) { btn.disabled = false; btn.classList.remove('working'); }
    showLaunchToast(
        r.ok ? (r.updated ? 'Updated in CafeNeurotico.' : 'Added to CafeNeurotico (Emulation category).')
             : (r.error || 'Failed to add to CafeNeurotico.'),
        null, 'CAFENEUROTICO');
}

// ── RETROACHIEVEMENTS ────────────────────────────────────────────────────────

function _relativeDate(iso) {
    if (!iso) return '';
    try {
        const d    = new Date(iso);
        const days = Math.floor((Date.now() - d) / 86400000);
        if (days === 0) return 'today';
        if (days === 1) return 'yesterday';
        if (days < 7)  return `${days} days ago`;
        if (days < 30) return `${Math.floor(days / 7)} week${days < 14 ? '' : 's'} ago`;
        return d.toLocaleDateString();
    } catch { return iso; }
}

async function loadGamepageAchievements(game) {
    const container = document.getElementById('gp-ach-container');
    container.innerHTML = '';
    _achAll = [];

    let res = await window.api.getRaAchievements(game.ra_game_id);
    if (!res.ok || !res.achievements.length) {
        res = await window.api.fetchRaAchievements(game.id);
    }
    if (!res.ok || !res.achievements.length) return;

    _achAll = res.achievements;
    _renderAchStrip(container, res.achievements);
}

function _renderAchStrip(container, achievements) {
    const total    = achievements.length;
    const unlocked = achievements.filter(a => a.date_unlocked).length;
    const pct      = total ? Math.round(unlocked / total * 100) : 0;

    const strip = document.createElement('div');
    strip.style.cssText = 'background:var(--bg_panel); border-radius:8px; padding:14px; border:1px solid var(--border_solid); display:flex; flex-direction:column; gap:10px; cursor:pointer; margin-top:20px;';
    strip.title   = 'View all achievements';
    strip.onclick = () => openAchievementsModal();

    strip.innerHTML = `
        <div style="display:flex; align-items:center; gap:8px;">
            <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="var(--accent)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M8 21h8M12 17v4M5 7H3v4a4 4 0 0 0 4 4h10a4 4 0 0 0 4-4V7h-2"/><path d="M5 3h14v8a7 7 0 0 1-7 7 7 7 0 0 1-7-7V3z"/></svg>
            <span class="stat-label" style="flex:1;">ACHIEVEMENTS <span style="font-size:9px; opacity:0.7; font-weight:400; letter-spacing:1px;">— RETROACHIEVEMENTS</span></span>
            <span style="font-size:11px; font-weight:900; color:var(--accent);">${unlocked} / ${total}</span>
        </div>
        <div style="height:3px; border-radius:2px; background:var(--border_solid); overflow:hidden;">
            <div style="height:100%; width:${pct}%; border-radius:2px; background:linear-gradient(90deg, color-mix(in srgb, var(--accent) 60%, transparent), var(--accent)); transition:width 0.5s ease;"></div>
        </div>`;

    const preview = document.createElement('div');
    preview.style.cssText = 'display:flex; flex-direction:column; gap:5px;';
    const recent = achievements.filter(a => a.date_unlocked).slice(0, 3);
    if (recent.length) {
        for (const a of recent) {
            const row = document.createElement('div');
            row.style.cssText = 'display:flex; align-items:center; gap:7px;';
            if (a.image_unlocked) {
                const img = document.createElement('img');
                img.src = a.image_unlocked;
                img.style.cssText = 'width:22px; height:22px; border-radius:3px; object-fit:cover; flex-shrink:0;';
                img.onerror = () => img.style.display = 'none';
                row.appendChild(img);
            }
            const nameEl = document.createElement('span');
            nameEl.style.cssText = 'font-size:10px; color:#82c882; font-weight:700; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; flex:1;';
            nameEl.textContent = a.name;
            row.appendChild(nameEl);
            const dateEl = document.createElement('span');
            dateEl.style.cssText = 'font-size:9px; color:rgba(130,200,130,0.55); flex-shrink:0;';
            dateEl.textContent = _relativeDate(a.date_unlocked);
            row.appendChild(dateEl);
            preview.appendChild(row);
        }
    } else {
        const noEl = document.createElement('span');
        noEl.style.cssText = 'font-size:10px; color:var(--text_dim); font-style:italic;';
        noEl.textContent = 'No achievements unlocked yet';
        preview.appendChild(noEl);
    }
    strip.appendChild(preview);
    strip.insertAdjacentHTML('beforeend', '<div style="font-size:10px; color:var(--text_dim); text-align:right; letter-spacing:0.5px;">TAP TO VIEW ALL →</div>');
    container.appendChild(strip);
}

function openAchievementsModal() {
    if (!_achAll.length) return;
    const modal = document.getElementById('modal-achievements');
    document.getElementById('ach-modal-game-title').textContent = currentGame?.title || '';
    const total    = _achAll.length;
    const unlocked = _achAll.filter(a => a.date_unlocked).length;
    const pct      = total ? Math.round(unlocked / total * 100) : 0;
    document.getElementById('ach-ring').setAttribute('stroke-dasharray', `${pct} 100`);
    document.getElementById('ach-ring-pct').textContent   = `${pct}%`;
    document.getElementById('ach-ring-count').textContent = `${unlocked}/${total}`;
    _achFilter = 'all';
    document.querySelectorAll('.ach-filter-btn').forEach(b => b.classList.toggle('active', b.dataset.filter === 'all'));
    _renderAchGrid();
    modal.classList.add('active');
}

function _renderAchGrid() {
    const grid  = document.getElementById('ach-modal-grid');
    const empty = document.getElementById('ach-modal-empty');
    grid.innerHTML = '';
    const list = _achAll.filter(a =>
        _achFilter === 'all'      ? true
      : _achFilter === 'unlocked' ? !!a.date_unlocked
      :                             !a.date_unlocked
    );
    if (!list.length) { grid.style.display = 'none'; empty.style.display = 'flex'; return; }
    grid.style.display = 'grid'; empty.style.display = 'none';
    for (const a of list) {
        const isUnlocked = !!a.date_unlocked;
        const card = document.createElement('div');
        card.className = 'ach-card' + (isUnlocked ? ' unlocked' : '');
        const iconUrl = isUnlocked ? a.image_unlocked : a.image_locked;
        if (iconUrl) {
            const img = document.createElement('img');
            img.src = iconUrl;
            if (!isUnlocked) img.style.cssText = 'filter:grayscale(1) opacity(0.4);';
            img.onerror = () => img.replaceWith(Object.assign(document.createElement('div'), { style: 'width:52px;height:52px;border-radius:6px;background:rgba(255,255,255,0.05);' }));
            card.appendChild(img);
        } else {
            card.appendChild(Object.assign(document.createElement('div'), { style: `width:52px;height:52px;border-radius:6px;background:rgba(255,255,255,0.05);${!isUnlocked?'opacity:0.4;':''}` }));
        }
        const name = document.createElement('div');
        name.className = 'ach-name'; name.textContent = a.name;
        card.appendChild(name);
        if (a.description) {
            const desc = document.createElement('div');
            desc.className = 'ach-desc'; desc.textContent = a.description;
            card.appendChild(desc);
        }
        if (a.points) {
            const pts = document.createElement('div');
            pts.className = 'ach-pts'; pts.textContent = `${a.points} pts`;
            card.appendChild(pts);
        }
        if (isUnlocked) {
            const date = document.createElement('div');
            date.className = 'ach-date'; date.textContent = _relativeDate(a.date_unlocked);
            card.appendChild(date);
        } else {
            card.appendChild(Object.assign(document.createElement('div'), { className: 'ach-lock', textContent: '🔒' }));
        }
        grid.appendChild(card);
    }
}

// ── SLIDESHOW ─────────────────────────────────────────────────────────────────
function openSlideshow(urls, startIndex = 0) {
    slideshowUrls  = urls;
    slideshowIndex = startIndex;
    const screen = document.querySelector('#modal-slideshow .crt-screen');   // pick the per-system display profile
    if (screen) screen.className = `crt-screen ${displayType(currentGame?.system_short)}`;
    showSlide();
    document.getElementById('modal-slideshow').classList.add('active');
}

function showSlide() {
    const img = document.getElementById('slideshow-img');
    img.src = slideshowUrls[slideshowIndex] || '';
    const bloom = document.getElementById('slideshow-img-bloom');   // CRT bloom layer mirrors the shot
    if (bloom) bloom.src = img.src;
    const multi = slideshowUrls.length > 1;
    document.getElementById('slide-prev').style.display    = multi ? 'flex' : 'none';
    document.getElementById('slide-next').style.display    = multi ? 'flex' : 'none';
    const counter = document.getElementById('slide-counter');
    if (counter) counter.textContent = multi ? `${slideshowIndex + 1} / ${slideshowUrls.length}` : '';
}

// ── MODALS ────────────────────────────────────────────────────────────────────
function openModal(id) {
    document.getElementById(id)?.classList.add('active');
}
function closeModal(id) {
    _openCustSel?.close();                                                  // dismiss any open themed dropdown…
    document.querySelectorAll('.cust-sel-list').forEach(el => el.remove()); // …and sweep an orphaned portaled list (z-100000) so it can't linger and block clicks
    document.getElementById(id)?.classList.remove('active');
}

// ── Themed confirm / alert dialogs (replaces the native window.confirm) ───────
function _openDialog(body, okLabel, isDanger, showCancel, title) {
    const dlg    = document.getElementById('modal-dialog');
    const titleE = document.getElementById('modal-dialog-title');
    const bodyE  = document.getElementById('modal-dialog-body');
    const okE    = document.getElementById('modal-dialog-ok');
    const cancel = document.getElementById('modal-dialog-cancel');
    return new Promise(resolve => {
        titleE.textContent   = title || '';
        titleE.style.display = title ? 'block' : 'none';
        bodyE.textContent    = body;
        okE.textContent      = okLabel;
        okE.className        = isDanger ? '' : 'primary';
        okE.style.cssText    = isDanger
            ? 'flex:1; background:rgba(198,40,40,0.15); border:1px solid #c62828; color:#ef5350;'
            : 'flex:1;';
        cancel.style.display = showCancel ? '' : 'none';
        dlg.classList.add('active');
        const done = r => {
            dlg.classList.remove('active');
            okE.onclick = cancel.onclick = dlg.onclick = null;
            resolve(r);
        };
        okE.onclick     = () => done(true);
        cancel.onclick  = () => done(false);
        dlg.onclick     = e => { if (e.target === dlg) done(false); };
    });
}
function showAlert(body, title)                                          { return _openDialog(body, 'OK', false, false, title); }
function showConfirm(body, okLabel = 'Confirm', isDanger = false, title) { return _openDialog(body, okLabel, isDanger, true, title); }

function openAddRomModal(presetSystemId = null) {
    document.getElementById('add-rom-path').value  = '';
    document.getElementById('add-rom-title').value = '';
    const sys = document.getElementById('add-rom-system');
    sys.value = presetSystemId !== null ? String(presetSystemId) : '';
    openModal('modal-add-rom');
}

function populateCoreOverrideSelect(game, showAll = false) {
    const sel  = document.getElementById('edit-core-override');
    const list = showAll ? allCores.slice() : coresForSystem(systemById(game.system_id));
    // keep the current override visible even if it wouldn't pass the compatibility filter
    if (game.core_override && !list.some(c => c.path === game.core_override)) {
        const cur = coreByPath(game.core_override);
        if (cur) list.unshift(cur);
    }
    sel.innerHTML = `<option value="">— Use system default —</option>` +
        list.map(c => `<option value="${escHtml(c.path)}">${escHtml(c.name)}</option>`).join('');
    sel.value = game.core_override || '';
    updateCoreDesc('edit-core-override', 'edit-core-override-desc');
}

// System-wide default core chooser (Edit System modal). currentValue is a stored core path.
function populateSystemCoreSelect(system, currentValue, showAll = false) {
    const sel  = document.getElementById('edit-system-core');
    const list = showAll ? allCores.slice() : coresForSystem(system);
    if (currentValue && !list.some(c => c.path === currentValue))
        list.unshift(coreByPath(currentValue) || { path: currentValue, name: currentValue.split('/').pop() });
    sel.innerHTML = `<option value="">— No default core —</option>` +
        list.map(c => `<option value="${escHtml(c.path)}">${escHtml(c.name)}</option>`).join('');
    sel.value = currentValue || '';
    updateCoreDesc('edit-system-core', 'edit-system-core-desc');
}

// ── CORE DOWNLOADER (libretro buildbot) ───────────────────────────────────────
let _coreDlAvailable = [];   // cached buildbot index (per session)
let _coreDlSystem    = null; // system the downloader was opened for → "recommended" banner + dropdown refresh
let _coreDlBusy      = false;

const coreInstalledNames = () => {                          // installed .so basename → display name
    const m = {};
    allCores.forEach(c => { m[c.path.split('/').pop()] = c.name; });
    return m;
};
function recommendedCoreBase(system) {
    if (!system) return '';
    let dc = system.default_core || '';
    if (!dc && system.short_name) dc = (allSystemPresets.find(p => p.short_name === system.short_name) || {}).default_core || '';
    return (dc || '').split('/').pop().replace(/\.so$/, '');   // → "name_libretro"
}
async function openCoreDownloader(system = null) {
    _coreDlSystem = system;
    document.getElementById('core-dl-search').value = '';
    document.getElementById('core-dl-status').textContent = '';
    document.getElementById('core-dl-rec').innerHTML = '';
    document.getElementById('core-dl-list').innerHTML = '<div class="ra-pane-hint" style="padding:14px;">Loading core list…</div>';
    openModal('modal-core-downloader');
    if (!_coreDlAvailable.length) {
        const r = await window.api.listAvailableCores();
        if (!r.ok) { document.getElementById('core-dl-list').innerHTML = `<div class="ra-pane-hint" style="padding:14px; color:#ef5350;">${escHtml(r.error || 'Could not load the core list.')}</div>`; return; }
        _coreDlAvailable = r.cores;
    }
    renderCoreDownloader();
}
function coreDlRow(core, installed, isRec) {
    const row = document.createElement('div');
    row.className = 'core-dl-item' + (isRec ? ' rec' : '');
    const isInstalled = !!installed[core.so];
    const left = document.createElement('div'); left.style.minWidth = '0';
    left.innerHTML = `<div class="cdl-name">${escHtml(isInstalled ? installed[core.so] : core.name)}</div><div class="cdl-id">${escHtml(core.base)}</div>`;
    const right = document.createElement('div'); right.style.cssText = 'display:flex; align-items:center; gap:8px; flex-shrink:0;';
    if (isInstalled) {
        const tag = document.createElement('span'); tag.className = 'core-dl-installed'; tag.textContent = '✓ Installed';
        const upd = document.createElement('button'); upd.textContent = 'Update'; upd.onclick = () => installCoreFromRow(core, row);
        right.append(tag, upd);
    } else {
        const btn = document.createElement('button'); btn.textContent = '⬇ Install';
        btn.style.cssText = 'background:var(--accent); color:var(--bg); border-color:var(--accent); font-weight:900;';
        btn.onclick = () => installCoreFromRow(core, row);
        right.append(btn);
    }
    row.append(left, right);
    return row;
}
function renderCoreDownloader() {
    const q = (document.getElementById('core-dl-search').value || '').trim().toLowerCase();
    const installed = coreInstalledNames();
    const recBase = recommendedCoreBase(_coreDlSystem);
    const rec = recBase && _coreDlAvailable.find(c => c.base === recBase);

    const recEl = document.getElementById('core-dl-rec');
    if (rec && !q) {
        recEl.innerHTML = `<div class="core-dl-rec-hdr">Recommended for ${escHtml(_coreDlSystem?.name || 'this system')}</div>`;
        recEl.appendChild(coreDlRow(rec, installed, true));
    } else recEl.innerHTML = '';

    let list = _coreDlAvailable;
    if (q)        list = list.filter(c => c.name.toLowerCase().includes(q) || c.base.toLowerCase().includes(q));
    else if (rec) list = list.filter(c => c.base !== rec.base);   // already shown in the banner above
    const listEl = document.getElementById('core-dl-list');
    if (!list.length) { listEl.innerHTML = '<div class="ra-pane-hint" style="padding:14px;">No cores match.</div>'; return; }
    const frag = document.createDocumentFragment();
    list.forEach(c => frag.appendChild(coreDlRow(c, installed, false)));
    listEl.innerHTML = ''; listEl.appendChild(frag);
}
async function installCoreFromRow(core, row) {
    if (_coreDlBusy) return;
    _coreDlBusy = true;
    const btn = row.querySelector('button'); const orig = btn ? btn.textContent : '';
    if (btn) { btn.disabled = true; btn.textContent = '…'; }
    const statusEl = document.getElementById('core-dl-status');
    statusEl.style.color = 'var(--text_dim)'; statusEl.textContent = `Downloading ${core.name}…`;
    const r = await window.api.installCore(core.base);
    _coreDlBusy = false;
    if (r.ok) {
        await loadCores();
        statusEl.style.color = 'var(--accent)'; statusEl.textContent = `Installed ${core.name}.`;
        renderCoreDownloader();                                   // refresh installed badges
        if (_coreDlSystem) {                                      // refresh the open Edit-System dropdown + select the new core
            document.getElementById('edit-system-core-all').checked = false;
            populateSystemCoreSelect(_coreDlSystem, r.path);
        }
    } else {
        if (btn) { btn.disabled = false; btn.textContent = orig; }
        statusEl.style.color = '#ef5350'; statusEl.textContent = r.error || 'Install failed.';
    }
}

function openEditGameModal(game) {
    document.getElementById('edit-game-id').value        = game.id;
    document.getElementById('edit-title').value          = game.title || '';
    document.getElementById('edit-system').value         = game.system_id || '';
    document.getElementById('edit-rom-path').value       = game.rom_path || '';
    document.getElementById('edit-year').value           = game.year || '';
    document.getElementById('edit-genre').value          = game.genre || '';
    document.getElementById('edit-developer').value      = game.developer || '';
    document.getElementById('edit-publisher').value      = game.publisher || '';
    document.getElementById('edit-players').value        = game.players || '';
    document.getElementById('edit-rating').value         = game.rating || '';
    document.getElementById('edit-description').value    = game.description || '';
    document.getElementById('edit-launch-override').value = game.launch_override || '';
    document.getElementById('edit-ra-game-id').value      = game.ra_game_id || '';

    const setPreview = (imgId, src) => {
        const el = document.getElementById(imgId);
        el.src = src || '';
        el.style.display = 'block';
    };
    setPreview('edit-cover-preview',      game.cover);
    setPreview('edit-hero-preview',       game.hero);
    setPreview('edit-logo-preview',       game.logo);
    setPreview('edit-screenshot-preview', game.screenshot ? game.screenshot.split('|')[0] : '');

    populateCoreOverrideSelect(game);
    document.getElementById('repair-disc-game-result').style.display = 'none';
    openModal('modal-edit-game');
    setTimeout(() => {
        const updateCmdPreview = () => {
            const override = document.getElementById('edit-launch-override').value.trim();
            const romPath  = document.getElementById('edit-rom-path').value.trim();
            const sysId    = document.getElementById('edit-system').value;
            const sys      = allSystems.find(s => s.id === Number(sysId));
            let cmd = override;
            if (!cmd && sys?.launch_template && romPath) {
                cmd = sys.launch_template
                    .replace('{rom}',      romPath ? `"${romPath}"` : '')
                    .replace('{core}',     sys.default_core     ? `"${sys.default_core}"`     : '')
                    .replace('{emulator}', sys.default_emulator ? `"${sys.default_emulator}"` : '');
            }
            const wrap    = document.getElementById('edit-cmd-preview-wrap');
            const preview = document.getElementById('edit-cmd-preview');
            if (cmd) { preview.textContent = cmd; wrap.style.display = 'block'; }
            else      { wrap.style.display = 'none'; }
        };
        updateCmdPreview();
    }, 50);
}

function openSystemsModal() {
    renderSystemsList();
    openModal('modal-systems');
}

function renderSystemsList() {
    const list = document.getElementById('systems-list');
    if (!allSystems.length) {
        list.innerHTML = `<div style="text-align:center; padding:30px; color:var(--text_dim); font-size:13px;">No systems added yet.</div>`;
        return;
    }
    list.innerHTML = allSystems.map(s => {
        const count = allGames.filter(g => g.system_id === s.id).length;
        return `<div class="system-list-item">
            <div>
                <div class="sys-name">${escHtml(s.name)}</div>
                <div class="sys-meta">${escHtml(s.extensions || '—')} · ${count} ROM${count !== 1 ? 's' : ''} · ${escHtml(s.launch_template || 'No template')}</div>
            </div>
            <button class="btn-edit-sys" data-id="${s.id}" style="font-size:11px; padding:6px 14px;">Edit</button>
        </div>`;
    }).join('');
    list.querySelectorAll('.btn-edit-sys').forEach(btn => {
        btn.addEventListener('click', () => {
            const sys = allSystems.find(s => s.id === Number(btn.dataset.id));
            if (sys) openEditSystemModal(sys);
        });
    });
}

function retroarchStatusLabel(variant) {
    return { native: '✓ Native RetroArch detected', flatpak: '✓ RetroArch Flatpak detected', none: '✗ RetroArch not found' }[variant] || 'Unknown';
}

function retroarchStatusColor(variant) {
    return variant === 'none' ? '#ef5350' : 'var(--accent)';
}

function applyRetroArchTemplate(template) {
    if (!template || retroarchVariant !== 'flatpak') return template;
    return template.replace(/^retroarch\b/, 'flatpak run org.libretro.RetroArch');
}

function updateTemplateButtonLabels() {
    const detectedTpl = retroarchVariant === 'native'  ? 'retroarch -L {core} {rom}' :
                        retroarchVariant === 'flatpak' ? 'flatpak run org.libretro.RetroArch -L {core} {rom}' : null;
    document.querySelectorAll('.preset-template-btn').forEach(btn => {
        const isDetected = detectedTpl && btn.dataset.tpl === detectedTpl;
        btn.style.color       = isDetected ? 'var(--accent)' : '';
        btn.style.borderColor = isDetected ? 'var(--accent)' : '';
    });
}

function resolveCorePath(coreFilename) {
    if (!coreFilename) return '';
    const match = allCores.find(c => c.path.split('/').pop() === coreFilename);
    return match ? match.path : '';
}

function applySystemPreset(preset) {
    document.getElementById('edit-system-modal-title').textContent = 'Add System';
    document.getElementById('edit-system-id').value             = '';
    document.getElementById('edit-system-name').value           = preset.name;
    document.getElementById('edit-system-short').value          = preset.short_name || '';
    document.getElementById('edit-system-extensions').value     = preset.extensions || '';
    document.getElementById('edit-system-template').value       = applyRetroArchTemplate(preset.launch_template || '');
    document.getElementById('edit-system-core-all').checked      = false;
    let presetCore = resolveCorePath(preset.default_core);                          // the preset's core if installed…
    if (!presetCore) { const c = coresForSystem(preset)[0]; if (c) presetCore = c.path; }   // …else auto-pick a compatible one
    populateSystemCoreSelect(preset, presetCore);
    document.getElementById('edit-system-emulator').value       = '';
    document.getElementById('edit-system-ssid').value           = preset.screenscraper_id ?? '';
    document.getElementById('btn-edit-system-delete').style.display = 'none';
}

function openSystemPresetsModal() {
    document.getElementById('preset-search').value = '';
    renderPresetList('');
    openModal('modal-system-presets');
}

function renderPresetList(query) {
    const list = document.getElementById('preset-list');
    const q = query.trim().toLowerCase();
    const filtered = q
        ? allSystemPresets.filter(p =>
            p.name.toLowerCase().includes(q) ||
            (p.short_name || '').toLowerCase().includes(q))
        : allSystemPresets;
    list.innerHTML = filtered.map((p, i) => {
        // The preset's own named core being installed counts as ready, even if the fuzzy matcher misses it.
        const hasCore = !!resolveCorePath(p.default_core) || coresForSystem(p).length > 0;
        return `<div class="preset-item" data-index="${allSystemPresets.indexOf(p)}"
            style="display:flex; justify-content:space-between; align-items:center; padding:8px 12px; border-radius:6px; background:rgba(0,0,0,0.2); border:1px solid var(--border); cursor:pointer; transition:background 0.15s, border-color 0.15s; gap:10px;">
            <div style="min-width:0;">
                <div style="font-size:13px; font-weight:900; color:var(--text_main); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${escHtml(p.name)}</div>
                <div style="font-size:10px; color:var(--text_dim); margin-top:2px; letter-spacing:1px;">${escHtml(p.extensions || '')}</div>
            </div>
            <div style="display:flex; align-items:center; gap:8px; flex-shrink:0;">
                ${hasCore ? `<span style="font-size:9px; font-weight:900; color:var(--accent); background:rgba(212,163,115,0.12); border:1px solid var(--border); padding:2px 7px; border-radius:4px; letter-spacing:1px; text-transform:uppercase;">CORE READY</span>` : ''}
                <span style="font-size:11px; color:var(--text_dim);">${p.short_name || ''}</span>
            </div>
        </div>`;
    }).join('') || `<div style="text-align:center; padding:30px; color:var(--text_dim);">No systems found.</div>`;

    list.querySelectorAll('.preset-item').forEach(el => {
        el.addEventListener('mouseenter', () => { el.style.background = 'rgba(212,163,115,0.1)'; el.style.borderColor = 'var(--border_solid)'; });
        el.addEventListener('mouseleave', () => { el.style.background = 'rgba(0,0,0,0.2)';       el.style.borderColor = 'var(--border)'; });
        el.addEventListener('click', () => {
            const preset = allSystemPresets[Number(el.dataset.index)];
            if (!preset) return;
            applySystemPreset(preset);
            closeModal('modal-system-presets');
            openModal('modal-edit-system');
        });
    });
}

function openEditSystemModal(sys = null) {
    const isNew = !sys;
    document.getElementById('edit-system-modal-title').textContent = isNew ? 'Add System' : 'Edit System';
    document.getElementById('edit-system-id').value             = sys?.id || '';
    document.getElementById('edit-system-name').value          = sys?.name || '';
    document.getElementById('edit-system-short').value         = sys?.short_name || '';
    document.getElementById('edit-system-extensions').value    = sys?.extensions || '';
    document.getElementById('edit-system-template').value      = sys?.launch_template || '';
    document.getElementById('edit-system-core-all').checked     = false;
    const storedCore = sys?.default_core || '';                    // resolve a bare filename to its installed path
    const resolvedCore = coreByPath(storedCore) ? storedCore : (resolveCorePath(storedCore.split('/').pop()) || storedCore);
    populateSystemCoreSelect(sys || {}, resolvedCore);
    document.getElementById('edit-system-emulator').value      = sys?.default_emulator || '';
    document.getElementById('edit-system-ssid').value          = sys?.screenscraper_id || '';
    document.getElementById('btn-edit-system-delete').style.display = isNew ? 'none' : '';
    renderBiosStatus(sys?.short_name || '');
    document.getElementById('repair-disc-system-result').style.display = 'none';
    closeModal('modal-systems');                 // avoid stacking two backdrop-filter overlays
    openModal('modal-edit-system');
}

async function renderBiosStatus(shortName) {
    const list = document.getElementById('bios-list');
    const scanBtn = document.getElementById('btn-bios-scan');
    const r = await window.api.biosStatus(shortName);
    if (!r.ok || !r.files.length) {
        list.innerHTML = '<span style="color:var(--text_dim);">No BIOS files needed for this system.</span>';
        scanBtn.style.display = 'none';
        return;
    }
    scanBtn.style.display = '';
    const badge = s => s === 'verified' ? '<span style="color:#66bb6a; font-weight:700;">✓ verified</span>'
                     : s === 'present'  ? '<span style="color:#ffb74d;">present (unverified)</span>'
                     :                    '<span style="color:#ef5350;">missing</span>';
    list.innerHTML =
        (r.note ? `<div style="color:var(--text_dim); margin-bottom:6px;">${escHtml(r.note)}</div>` : '') +
        r.files.map(b => `
            <div style="display:flex; align-items:center; justify-content:space-between; gap:10px; padding:3px 0;">
                <span><code>${escHtml(b.file)}</code>${b.region ? ` <span style="color:var(--text_dim);">(${escHtml(b.region)})</span>` : ''}${b.required ? ' <span style="color:var(--text_dim);">· required</span>' : ''}</span>
                <span style="display:flex; gap:10px; align-items:center; white-space:nowrap;">${badge(b.status)}
                    <button type="button" class="btn-bios-add" data-file="${escHtml(b.file)}" style="font-size:10px; padding:3px 9px;">${b.status === 'missing' ? 'ADD' : 'REPLACE'}</button>
                </span>
            </div>`).join('') +
        `<div style="color:var(--text_dim); font-size:10px; margin-top:6px; word-break:break-all;">→ ${escHtml(r.systemDir)}</div>`;

    list.querySelectorAll('.btn-bios-add').forEach(btn => btn.addEventListener('click', async () => {
        const res = await window.api.biosAddFile(shortName, btn.dataset.file);
        if (res.canceled) return;
        if (!res.ok) { showLaunchToast(res.error || 'Failed to add BIOS.', null, 'BIOS'); return; }
        showLaunchToast(res.md5Known && res.verified === false
            ? `Added ${btn.dataset.file} — note: MD5 didn't match a known-good hash.`
            : `Added ${btn.dataset.file}.`, null, 'BIOS');
        renderBiosStatus(shortName);
    }));
}

// ── SIDE PANEL ────────────────────────────────────────────────────────────────
function openPanel(section) {
    if (_activePanelSection === section) { closePanel(); return; }
    _activePanelSection = section;
    document.getElementById('side-panel').classList.add('open');
    ['systems', 'playlists'].forEach(s => {
        document.getElementById(`panel-sec-${s}`).style.display = s === section ? '' : 'none';
    });
    document.querySelectorAll('.rail-btn[data-panel]').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.panel === section);
    });
}

function closePanel() {
    _activePanelSection = null;
    document.getElementById('side-panel').classList.remove('open');
    document.querySelectorAll('.rail-btn[data-panel]').forEach(btn => btn.classList.remove('active'));
}

// ── FILTER / SORT ─────────────────────────────────────────────────────────────
async function setFilter(filter) {
    currentFilter = filter;

    document.querySelectorAll('.rail-btn[data-rail], .filter-btn-system, .filter-btn-playlist').forEach(btn => {
        btn.classList.remove('active');
        btn.style.background  = '';
        btn.style.color       = '';
        btn.style.borderColor = '';
        btn.style.boxShadow   = '';
    });

    const active = document.querySelector(
        `.rail-btn[data-rail="${CSS.escape(filter)}"], ` +
        `.filter-btn-system[data-filter="${CSS.escape(filter)}"], ` +
        `.filter-btn-playlist[data-filter="${CSS.escape(filter)}"]`
    );
    if (active) {
        active.classList.add('active');
        if (active.classList.contains('filter-btn-system') || active.classList.contains('filter-btn-playlist')) {
            active.style.background  = 'var(--text_main)';
            active.style.color       = 'var(--bg)';
            active.style.borderColor = 'var(--text_main)';
            active.style.boxShadow   = '0 0 10px var(--text_main)';
        }
    }

    if (typeof filter === 'string' && filter.startsWith('playlist:')) {
        const plId = Number(filter.split(':')[1]);
        currentPlaylistGames = await window.api.getPlaylistGames(plId);
    }

    if (currentView !== 'view-gamepage') renderCurrentView();
    startHeroCycle();
}

// ── THEME SYSTEM ──────────────────────────────────────────────────────────────
let _activeTheme = 'CREMA';

const EL_THEMES = {
    "DARK GRAY": {bg:"#141414",bg_panel:"rgba(0,0,0,0.5)",bg_menu:"#222222",accent:"#ffffff",text_main:"#ffffff",text_sec:"#bbbbbb",text_dim:"#777777",border:"rgba(255,255,255,0.1)",border_solid:"#555555"},
    "CREMA": {bg:"#2C1E16",bg_panel:"rgba(67, 40, 24, 0.6)",bg_menu:"#432818",accent:"#D4A373",text_main:"#FFE6A7",text_sec:"#E6CC98",text_dim:"#A47148",border:"rgba(212, 163, 115, 0.2)",border_solid:"#8B5A2B"},
    "CYBERPUNK": {bg:"#09090b",bg_panel:"rgba(26, 26, 46, 0.7)",bg_menu:"#1a1a2e",accent:"#f3e600",text_main:"#00ffcc",text_sec:"#e0e0e0",text_dim:"#ff003c",border:"rgba(243, 230, 0, 0.2)",border_solid:"#ff003c"},
    "VAPOUR OS": {bg:"#171a21",bg_panel:"rgba(27, 40, 56, 0.7)",bg_menu:"#1b2838",accent:"#66c0f4",text_main:"#c7d5e0",text_sec:"#8f98a0",text_dim:"#556b82",border:"rgba(102, 192, 244, 0.2)",border_solid:"#2a475e"},
    "PSIV BLUE": {bg:"#000022",bg_panel:"rgba(0, 67, 156, 0.4)",bg_menu:"#001144",accent:"#ffffff",text_main:"#ffffff",text_sec:"#aaaaaa",text_dim:"#666666",border:"rgba(0, 112, 204, 0.3)",border_solid:"#00439c"},
    "GREEN BOX": {bg:"#0e0e0e",bg_panel:"rgba(82, 176, 67, 0.10)",bg_menu:"#111111",accent:"#52b043",text_main:"#ffffff",text_sec:"#a8d8a4",text_dim:"#3d8030",border:"rgba(82, 176, 67, 0.22)",border_solid:"#1a3d1a"},
    "MOVIESFLIX": {bg:"#141414",bg_panel:"rgba(255, 255, 255, 0.07)",bg_menu:"#000000",accent:"#e50914",text_main:"#ffffff",text_sec:"#b3b3b3",text_dim:"#6d6d6d",border:"rgba(229, 9, 20, 0.30)",border_solid:"#404040"},
    "SNOW": {bg:"#0a1628",bg_panel:"rgba(32, 68, 110, 0.65)",bg_menu:"#0f2040",accent:"#93d0f0",text_main:"#e8f4ff",text_sec:"#8bbbd8",text_dim:"#4a7898",border:"rgba(147, 208, 240, 0.18)",border_solid:"#1c4060"},
    "WIN XP": {bg:"#003399",bg_panel:"rgba(236, 233, 216, 0.2)",bg_menu:"#0054E3",accent:"#ffd700",text_main:"#FFFFFF",text_sec:"#ECE9D8",text_dim:"#99B4D1",border:"rgba(236, 233, 216, 0.4)",border_solid:"#4fcc3a"},
    "PSIII CLASSIC": {bg:"#000000",bg_panel:"rgba(25, 25, 25, 0.7)",bg_menu:"#111111",accent:"#dcdcdc",text_main:"#ffffff",text_sec:"#aaaaaa",text_dim:"#666666",border:"rgba(255, 255, 255, 0.2)",border_solid:"#444444"},
    "PSIII RED": {bg:"#2b0000",bg_panel:"rgba(40, 0, 0, 0.7)",bg_menu:"#1a0000",accent:"#ff4d4d",text_main:"#ffffff",text_sec:"#ffcccc",text_dim:"#cc6666",border:"rgba(255, 77, 77, 0.2)",border_solid:"#800000"},
    "PSIII GREEN": {bg:"#001a00",bg_panel:"rgba(0, 30, 0, 0.7)",bg_menu:"#000d00",accent:"#4dff4d",text_main:"#ffffff",text_sec:"#ccffcc",text_dim:"#66cc66",border:"rgba(77, 255, 77, 0.2)",border_solid:"#004d00"},
    "PSIII BLUE": {bg:"#000a1a",bg_panel:"rgba(0, 15, 30, 0.7)",bg_menu:"#00050d",accent:"#4d94ff",text_main:"#ffffff",text_sec:"#cce0ff",text_dim:"#66a3ff",border:"rgba(77, 148, 255, 0.2)",border_solid:"#003380"},
    "PSIII PURPLE": {bg:"#1a001a",bg_panel:"rgba(30, 0, 30, 0.7)",bg_menu:"#0d000d",accent:"#d24dff",text_main:"#ffffff",text_sec:"#f0ccff",text_dim:"#c266cc",border:"rgba(210, 77, 255, 0.2)",border_solid:"#800080"},
    "PSIII GOLD": {bg:"#261a00",bg_panel:"rgba(40, 25, 0, 0.7)",bg_menu:"#130d00",accent:"#ffcc00",text_main:"#ffffff",text_sec:"#ffeecc",text_dim:"#cca300",border:"rgba(255, 204, 0, 0.2)",border_solid:"#997300"},
    "PSIII SILVER": {bg:"#1a1a1a",bg_panel:"rgba(35, 35, 35, 0.7)",bg_menu:"#0d0d0d",accent:"#cccccc",text_main:"#ffffff",text_sec:"#e6e6e6",text_dim:"#999999",border:"rgba(204, 204, 204, 0.2)",border_solid:"#666666"},
    "DRACULA": {bg:"#282a36",bg_panel:"rgba(68, 71, 90, 0.7)",bg_menu:"#44475a",accent:"#bd93f9",text_main:"#f8f8f2",text_sec:"#8be9fd",text_dim:"#8290bc",border:"rgba(189, 147, 249, 0.2)",border_solid:"#8290bc"},
    "GRUVBOX": {bg:"#282828",bg_panel:"rgba(60, 56, 54, 0.8)",bg_menu:"#3c3836",accent:"#fabd2f",text_main:"#ebdbb2",text_sec:"#b8bb26",text_dim:"#a89984",border:"rgba(250, 189, 47, 0.2)",border_solid:"#504945"},
    "NORD": {bg:"#2e3440",bg_panel:"rgba(59, 66, 82, 0.8)",bg_menu:"#3b4252",accent:"#88c0d0",text_main:"#eceff4",text_sec:"#e5e9f0",text_dim:"#7a8ba0",border:"rgba(136, 192, 208, 0.2)",border_solid:"#5e6f84"},
    "SOLARIZED DARK": {bg:"#002b36",bg_panel:"rgba(7, 54, 66, 0.8)",bg_menu:"#073642",accent:"#2aa198",text_main:"#839496",text_sec:"#93a1a1",text_dim:"#7a9196",border:"rgba(42, 161, 152, 0.2)",border_solid:"#1a5060"},
    "CATPPUCCIN MOCHA": {bg:"#1e1e2e",bg_panel:"rgba(30, 30, 46, 0.8)",bg_menu:"#181825",accent:"#cba6f7",text_main:"#cdd6f4",text_sec:"#bac2de",text_dim:"#6c7086",border:"rgba(203, 166, 247, 0.2)",border_solid:"#313244"},
    "CATPPUCCIN MACCHIATO": {bg:"#24273a",bg_panel:"rgba(36, 39, 58, 0.8)",bg_menu:"#1e2030",accent:"#c6a0f6",text_main:"#cad3f5",text_sec:"#b8c0e0",text_dim:"#6e738d",border:"rgba(198, 160, 246, 0.2)",border_solid:"#363a4f"},
    "CATPPUCCIN FRAPPÉ": {bg:"#303446",bg_panel:"rgba(48, 52, 70, 0.8)",bg_menu:"#292c3c",accent:"#ca9ee6",text_main:"#c6d0f5",text_sec:"#b5bfe2",text_dim:"#737994",border:"rgba(202, 158, 230, 0.2)",border_solid:"#414559"},
    "TOKYO NIGHT": {bg:"#1a1b26",bg_panel:"rgba(36, 40, 59, 0.8)",bg_menu:"#16161e",accent:"#7aa2f7",text_main:"#c0caf5",text_sec:"#a9b1d6",text_dim:"#7885ac",border:"rgba(122, 162, 247, 0.2)",border_solid:"#3d4468"},
    "EVERFOREST": {bg:"#2b3339",bg_panel:"rgba(50, 56, 62, 0.8)",bg_menu:"#2f383e",accent:"#a7c080",text_main:"#d3c6aa",text_sec:"#a7c080",text_dim:"#859289",border:"rgba(167, 192, 128, 0.2)",border_solid:"#4b565c"},
    "ROSÉ PINE": {bg:"#191724",bg_panel:"rgba(31, 29, 46, 0.8)",bg_menu:"#1f1d2e",accent:"#c4a7e7",text_main:"#e0def4",text_sec:"#9ccfd8",text_dim:"#6e6a86",border:"rgba(196, 167, 231, 0.2)",border_solid:"#26233a"},
    "GAME BOY DMG": {bg:"#0f380f",bg_panel:"rgba(48, 98, 48, 0.70)",bg_menu:"#1a4a1a",accent:"#9bbc0f",text_main:"#9bbc0f",text_sec:"#8bac0f",text_dim:"#306230",border:"rgba(155, 188, 15, 0.25)",border_solid:"#306230"},
    "PIP BOY": {bg:"#000000",bg_panel:"rgba(0, 20, 0, 0.7)",bg_menu:"#001100",accent:"#14ff00",text_main:"#14ff00",text_sec:"#0ea000",text_dim:"#0a6000",border:"rgba(20, 255, 0, 0.2)",border_solid:"#0ea000"},
    "SEVASTOPOL": {bg:"#050d05",bg_panel:"rgba(10, 25, 10, 0.7)",bg_menu:"#081808",accent:"#f5e6b3",text_main:"#f5e6b3",text_sec:"#a39977",text_dim:"#4d594d",border:"rgba(245, 230, 179, 0.1)",border_solid:"#1a331a"},
    "RIP AND TEAR CLASSIC": {bg:"#110000",bg_panel:"rgba(80, 5, 5, 0.78)",bg_menu:"#1a0000",accent:"#ff0000",text_main:"#f5d020",text_sec:"#d0a000",text_dim:"#7a4400",border:"rgba(255, 0, 0, 0.22)",border_solid:"#5a0000"},
    "SUPER BROTHERS": {bg:"#5C94FC",bg_panel:"rgba(0, 0, 0, 0.75)",bg_menu:"#000070",accent:"#F8D820",text_main:"#ffffff",text_sec:"#F8D820",text_dim:"#6898F8",border:"rgba(248, 216, 32, 0.30)",border_solid:"#000000"},
    "GREEN HILL": {bg:"#0044AA",bg_panel:"rgba(0, 60, 0, 0.82)",bg_menu:"#003300",accent:"#F8D020",text_main:"#ffffff",text_sec:"#A8E888",text_dim:"#50A050",border:"rgba(248, 208, 32, 0.30)",border_solid:"#006600"},
    "NES": {bg:"#18181A",bg_panel:"rgba(40, 38, 42, 0.85)",bg_menu:"#222024",accent:"#C42020",text_main:"#F0F0F0",text_sec:"#C0B8C0",text_dim:"#706870",border:"rgba(196, 32, 32, 0.22)",border_solid:"#3C3A3E"},
    "SNES": {bg:"#1E1828",bg_panel:"rgba(50, 42, 80, 0.72)",bg_menu:"#160E20",accent:"#8060C8",text_main:"#E8E0F0",text_sec:"#A890C8",text_dim:"#605090",border:"rgba(128, 96, 200, 0.22)",border_solid:"#302050"},
    "BLOODBORNE": {bg:"#0a0606",bg_panel:"rgba(60, 20, 10, 0.78)",bg_menu:"#150808",accent:"#c0952a",text_main:"#e8d8b0",text_sec:"#b09070",text_dim:"#604830",border:"rgba(192, 149, 42, 0.22)",border_solid:"#4a1818"},
    "METROID PRIME": {bg:"#050a12",bg_panel:"rgba(255, 120, 20, 0.12)",bg_menu:"#080f1a",accent:"#ff6a00",text_main:"#e0f0ff",text_sec:"#60c8e0",text_dim:"#304858",border:"rgba(255, 106, 0, 0.22)",border_solid:"#1a2a3a"},
    "SILENT HILL": {bg:"#141210",bg_panel:"rgba(80, 50, 35, 0.72)",bg_menu:"#1a1510",accent:"#c85020",text_main:"#e0d0c0",text_sec:"#a09080",text_dim:"#605040",border:"rgba(200, 80, 32, 0.22)",border_solid:"#4a3020"},
    "DIABLO": {bg:"#0c0808",bg_panel:"rgba(80, 20, 0, 0.75)",bg_menu:"#140808",accent:"#e84000",text_main:"#f0d898",text_sec:"#c0a060",text_dim:"#705028",border:"rgba(232, 64, 0, 0.22)",border_solid:"#4a1a00"},
    "HALF-LIFE": {bg:"#141618",bg_panel:"rgba(245, 130, 32, 0.12)",bg_menu:"#1c1e20",accent:"#f58320",text_main:"#f0f0f0",text_sec:"#b0b8c0",text_dim:"#606870",border:"rgba(245, 131, 32, 0.22)",border_solid:"#2a3038"},
    "SHOVEL KNIGHT": {bg:"#1a1a2e",bg_panel:"rgba(30, 40, 80, 0.75)",bg_menu:"#100c20",accent:"#f8d840",text_main:"#e8f0ff",text_sec:"#88b8f8",text_dim:"#4060a0",border:"rgba(248, 216, 64, 0.28)",border_solid:"#202858"},
    "EARTHY & ORGANIC": {bg:"#3E4E3A",bg_panel:"rgba(91, 107, 85, 0.7)",bg_menu:"#4F5D48",accent:"#D4B28C",text_main:"#F3EDE4",text_sec:"#D8D3C8",text_dim:"#8E9E88",border:"rgba(212, 178, 140, 0.2)",border_solid:"#6b7d63"},
    "DOPAMINE BRIGHTS": {bg:"#080810",bg_panel:"rgba(255, 50, 120, 0.12)",bg_menu:"#100820",accent:"#FF2D78",text_main:"#ffffff",text_sec:"#FF80C0",text_dim:"#6030A0",border:"rgba(255, 45, 120, 0.28)",border_solid:"#2A0850"},
    "RETRO REVIVAL": {bg:"#2A1A10",bg_panel:"rgba(80, 50, 30, 0.70)",bg_menu:"#1E1008",accent:"#E8883A",text_main:"#F8E8C8",text_sec:"#C8A878",text_dim:"#7A5838",border:"rgba(232, 136, 58, 0.22)",border_solid:"#5A3820"},
    "VAPORWAVE": {bg:"#0d0221",bg_panel:"rgba(80, 10, 100, 0.65)",bg_menu:"#150330",accent:"#ff71ce",text_main:"#f0e0ff",text_sec:"#c080ff",text_dim:"#6030a0",border:"rgba(255, 113, 206, 0.25)",border_solid:"#35005a"},
    "AURORA": {bg:"#0a1520",bg_panel:"rgba(0, 80, 80, 0.55)",bg_menu:"#081018",accent:"#00e8c8",text_main:"#d0f8f0",text_sec:"#78d8c8",text_dim:"#306858",border:"rgba(0, 232, 200, 0.20)",border_solid:"#0a4040"},
    "NOIR": {bg:"#0a0a0a",bg_panel:"rgba(45, 45, 45, 0.78)",bg_menu:"#151515",accent:"#d4a030",text_main:"#e8e0d0",text_sec:"#a09888",text_dim:"#606058",border:"rgba(212, 160, 48, 0.20)",border_solid:"#303028"},
    "BIOLUMINESCENCE": {bg:"#020810",bg_panel:"rgba(0, 120, 120, 0.42)",bg_menu:"#030c18",accent:"#00e8a8",text_main:"#c0f8f0",text_sec:"#60d8c8",text_dim:"#206858",border:"rgba(0, 232, 168, 0.22)",border_solid:"#0a3838"},
    "BRUTALIST": {bg:"#1a1a1a",bg_panel:"rgba(80, 80, 80, 0.55)",bg_menu:"#222222",accent:"#e03000",text_main:"#f0f0f0",text_sec:"#c0c0c0",text_dim:"#808080",border:"rgba(224, 48, 0, 0.25)",border_solid:"#404040"},
    "OXOCARBON": {bg:"#161616",bg_panel:"rgba(38, 38, 38, 0.85)",bg_menu:"#262626",accent:"#0f62fe",text_main:"#f4f4f4",text_sec:"#c6c6c6",text_dim:"#8d8d8d",border:"rgba(15, 98, 254, 0.25)",border_solid:"#393939"},
    "MATERIAL DARK": {bg:"#1a1c1e",bg_panel:"rgba(40, 48, 56, 0.80)",bg_menu:"#212325",accent:"#4fc3f7",text_main:"#e1e2e8",text_sec:"#c1c2cb",text_dim:"#8589a0",border:"rgba(79, 195, 247, 0.18)",border_solid:"#3a3f4a"},
    "N7": {bg:"#080c14",bg_panel:"rgba(20, 30, 60, 0.78)",bg_menu:"#0c1428",accent:"#cc0000",text_main:"#e8eeff",text_sec:"#7aa0cc",text_dim:"#3d5880",border:"rgba(204, 0, 0, 0.25)",border_solid:"#1a2848"},
    "TRON LEGACY": {bg:"#000000",bg_panel:"rgba(0, 200, 255, 0.08)",bg_menu:"#000508",accent:"#00c8ff",text_main:"#ffffff",text_sec:"#80d8ff",text_dim:"#204858",border:"rgba(0, 200, 255, 0.28)",border_solid:"#0a1a20"},
    "DEAD SPACE": {bg:"#020202",bg_panel:"rgba(255, 100, 20, 0.10)",bg_menu:"#050505",accent:"#ff6400",text_main:"#f0f0f0",text_sec:"#ff9060",text_dim:"#602010",border:"rgba(255, 100, 32, 0.25)",border_solid:"#200800"},
    "COLONY SHIP": {bg:"#10120e",bg_panel:"rgba(50, 60, 40, 0.72)",bg_menu:"#141810",accent:"#c8b040",text_main:"#d8e0c0",text_sec:"#909a70",text_dim:"#485840",border:"rgba(200, 176, 64, 0.22)",border_solid:"#303820"},
    "NECROMORPH": {bg:"#030808",bg_panel:"rgba(0, 80, 20, 0.60)",bg_menu:"#040a04",accent:"#80ff20",text_main:"#c8ffc0",text_sec:"#70c060",text_dim:"#306020",border:"rgba(128, 255, 32, 0.22)",border_solid:"#0a2808"},
    "CRIMSON PEAK": {bg:"#120508",bg_panel:"rgba(80, 15, 30, 0.75)",bg_menu:"#1a080c",accent:"#d4904a",text_main:"#f0e0d8",text_sec:"#c0909a",text_dim:"#7a3848",border:"rgba(212, 144, 74, 0.22)",border_solid:"#5a1520"},
    "LAKESIDE CURSE": {bg:"#0c0a08",bg_panel:"rgba(60, 40, 20, 0.72)",bg_menu:"#141008",accent:"#e09030",text_main:"#f0e8d0",text_sec:"#b09070",text_dim:"#706050",border:"rgba(224, 144, 48, 0.22)",border_solid:"#402808"},
    "THE BACKROOMS": {bg:"#1a1810",bg_panel:"rgba(220, 200, 100, 0.10)",bg_menu:"#201e14",accent:"#d4c840",text_main:"#f0e8c8",text_sec:"#b0a870",text_dim:"#706840",border:"rgba(212, 200, 64, 0.22)",border_solid:"#3a3820"}
};

const EL_THEME_CATEGORIES = {
    "Originals & System": ["DARK GRAY","CREMA","CYBERPUNK","SNOW","MOVIESFLIX","VAPOUR OS","PSIV BLUE","GREEN BOX","WIN XP"],
    "Gaming Legends": ["GAME BOY DMG","PIP BOY","SEVASTOPOL","RIP AND TEAR CLASSIC","SUPER BROTHERS","GREEN HILL","NES","SNES","BLOODBORNE","METROID PRIME","SILENT HILL","DIABLO","HALF-LIFE","SHOVEL KNIGHT"],
    "Aesthetics": ["EARTHY & ORGANIC","DOPAMINE BRIGHTS","RETRO REVIVAL","VAPORWAVE","AURORA","NOIR","BIOLUMINESCENCE","BRUTALIST"],
    "Linux Ricing": ["DRACULA","GRUVBOX","NORD","SOLARIZED DARK","CATPPUCCIN FRAPPÉ","CATPPUCCIN MACCHIATO","CATPPUCCIN MOCHA","TOKYO NIGHT","EVERFOREST","ROSÉ PINE","OXOCARBON","MATERIAL DARK"],
    "Sci-Fi Universes": ["N7","TRON LEGACY","DEAD SPACE","COLONY SHIP","NECROMORPH"],
    "Horror Realm": ["CRIMSON PEAK","LAKESIDE CURSE","THE BACKROOMS"],
    "PSIII Colors": ["PSIII CLASSIC","PSIII RED","PSIII GREEN","PSIII BLUE","PSIII PURPLE","PSIII GOLD","PSIII SILVER"]
};

function applyTheme(name, save = true) {
    const t = EL_THEMES[name];
    if (!t) return;
    const root = document.documentElement;
    Object.keys(t).forEach(k => root.style.setProperty(`--${k}`, t[k]));
    _activeTheme = name;
    if (save) {
        window.api.setSetting('el_theme', name);
        try { localStorage.setItem('el_theme_cache', JSON.stringify(t)); } catch(e) {}
    }
    const btn = document.getElementById('btn-theme-switch');
    if (btn) btn.textContent = name;
}

function renderThemeCategories() {
    const cats = document.getElementById('theme-cats');
    const grid = document.getElementById('theme-grid');
    const backBtn = document.getElementById('btn-theme-back');
    if (!cats || !grid) return;
    backBtn.style.display = 'none';
    cats.innerHTML = '';
    grid.innerHTML = '';
    Object.keys(EL_THEME_CATEGORIES).forEach(cat => {
        const btn = document.createElement('button');
        btn.className = 'theme-cat-btn';
        btn.textContent = cat;
        btn.addEventListener('click', () => {
            cats.querySelectorAll('.theme-cat-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            renderThemesInCategory(cat);
        });
        cats.appendChild(btn);
    });
    // Show first category by default
    const firstCat = Object.keys(EL_THEME_CATEGORIES)[0];
    cats.querySelector('.theme-cat-btn')?.classList.add('active');
    renderThemesInCategory(firstCat);
}

function renderThemesInCategory(cat) {
    const grid = document.getElementById('theme-grid');
    const backBtn = document.getElementById('btn-theme-back');
    if (!grid) return;
    backBtn.style.display = '';
    grid.innerHTML = '';
    (EL_THEME_CATEGORIES[cat] || []).forEach(name => {
        const t = EL_THEMES[name];
        if (!t) return;
        const wrap = document.createElement('div');
        wrap.className = 'theme-swatch' + (name === _activeTheme ? ' active' : '');
        wrap.title = name;
        wrap.innerHTML = `
            <div style="background:${t.bg}; padding:10px 12px; display:flex; flex-direction:column; gap:6px;">
                <div style="background:${t.bg_menu}; border-radius:4px; padding:6px 8px; border:1px solid ${t.border_solid};">
                    <div style="font-size:9px; font-weight:900; color:${t.accent}; letter-spacing:1px; text-transform:uppercase;">${escHtml(name)}</div>
                </div>
                <div style="display:flex; gap:5px; align-items:center;">
                    <div style="width:14px; height:14px; border-radius:50%; background:${t.accent};"></div>
                    <div style="font-size:9px; color:${t.text_sec};">Aa</div>
                    <div style="font-size:9px; color:${t.text_dim}; margin-left:auto;">Bb</div>
                </div>
            </div>`;
        wrap.addEventListener('click', () => {
            applyTheme(name);
            grid.querySelectorAll('.theme-swatch').forEach(s => s.classList.remove('active'));
            wrap.classList.add('active');
        });
        grid.appendChild(wrap);
    });
}

// ── UI WIRING ─────────────────────────────────────────────────────────────────
// ── THEMED DROPDOWNS ────────────────────────────────────────────────────────
// Replace native <select> popups (un-themeable) with a styled widget. The native
// <select> stays as the source of truth (hidden), so every existing .value read/write
// keeps working; we just mirror it and intercept programmatic value/option changes.
let _openCustSel = null;

function installSelectValueShim(sel, onChange) {
    if (sel.dataset.shim) return;
    sel.dataset.shim = '1';
    const vd = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value');
    const id = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'selectedIndex');
    Object.defineProperty(sel, 'value',         { configurable: true, get() { return vd.get.call(this); }, set(v) { vd.set.call(this, v); onChange(); } });
    Object.defineProperty(sel, 'selectedIndex', { configurable: true, get() { return id.get.call(this); }, set(v) { id.set.call(this, v); onChange(); } });
}

function enhanceSelect(sel) {
    if (!sel || sel.dataset.enh) return;
    sel.dataset.enh = '1';
    sel.style.display = 'none';

    const wrap = document.createElement('div');
    wrap.className = 'cust-sel';
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'cust-sel-btn';
    btn.innerHTML = '<span class="cust-sel-label"></span><span class="cust-sel-arrow">▾</span>';
    wrap.appendChild(btn);
    sel.parentNode.insertBefore(wrap, sel.nextSibling);
    const labelEl = btn.querySelector('.cust-sel-label');

    const syncLabel = () => { const o = sel.options[sel.selectedIndex]; labelEl.textContent = o ? o.textContent : ''; };

    let listEl = null;
    const api = { close };

    function close() {
        if (listEl) { listEl.remove(); listEl = null; }
        wrap.classList.remove('open');
        document.removeEventListener('mousedown', onDocDown, true);
        document.removeEventListener('keydown', onKey, true);
        window.removeEventListener('resize', close, true);
        window.removeEventListener('scroll', onScroll, true);
        if (_openCustSel === api) _openCustSel = null;
    }
    function onDocDown(e) { if (!listEl?.contains(e.target) && !wrap.contains(e.target)) close(); }
    function onKey(e) { if (e.key === 'Escape') close(); }
    // Dismiss when the page/modal behind the list scrolls, but NOT when scrolling the list itself.
    function onScroll(e) { if (!listEl?.contains(e.target)) close(); }

    function position() {
        const r = btn.getBoundingClientRect();
        listEl.style.left  = `${r.left}px`;
        listEl.style.width = `${r.width}px`;
        const below  = window.innerHeight - r.bottom;
        const listH  = Math.min(listEl.scrollHeight, 260);
        if (below < listH + 8 && r.top > below) {
            listEl.style.top = ''; listEl.style.bottom = `${window.innerHeight - r.top + 4}px`;
        } else {
            listEl.style.bottom = ''; listEl.style.top = `${r.bottom + 4}px`;
        }
    }

    function open() {
        _openCustSel?.close();
        listEl = document.createElement('div');
        listEl.className = 'cust-sel-list';
        Array.from(sel.options).forEach((o, i) => {
            const item = document.createElement('div');
            item.className = 'cust-sel-item' + (i === sel.selectedIndex ? ' sel' : '');
            item.textContent = o.textContent;
            item.addEventListener('mousedown', e => {
                e.preventDefault();
                try {
                    sel.selectedIndex = i;                              // shim → syncLabel
                    sel.dispatchEvent(new Event('change', { bubbles: true }));
                } finally {
                    close();                                            // always tear down the portaled list + listeners
                }
            });
            listEl.appendChild(item);
        });
        document.body.appendChild(listEl);
        position();
        wrap.classList.add('open');
        document.addEventListener('mousedown', onDocDown, true);
        document.addEventListener('keydown', onKey, true);
        window.addEventListener('resize', close, true);
        window.addEventListener('scroll', onScroll, true);
        _openCustSel = api;
        listEl.querySelector('.sel')?.scrollIntoView({ block: 'nearest' });
    }

    btn.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); listEl ? close() : open(); });

    installSelectValueShim(sel, syncLabel);
    new MutationObserver(syncLabel).observe(sel, { childList: true });
    syncLabel();
}

function enhanceAllSelects() {
    // RetroArch-settings selects stay native (CSS-themed) — they live in scrollable panes
    // and are created dynamically, so the portal widget mispositions there.
    document.querySelectorAll('select').forEach(sel => { if (!sel.closest('#modal-ra-settings')) enhanceSelect(sel); });
}

function wireUI() {
    // Titlebar
    document.getElementById('btn-min').addEventListener('click', () => window.api.minimize());
    document.getElementById('btn-max').addEventListener('click', () => window.api.maximize());
    document.getElementById('btn-close').addEventListener('click', () => window.api.close());
    document.getElementById('btn-go-fullscreen').addEventListener('click', () => window.api.enterCouch());

    // View switches
    document.getElementById('btn-view-gallery').addEventListener('click', () => {
        switchView('view-gallery');
        renderGallery(getFilteredGames());
    });
    document.getElementById('btn-view-list').addEventListener('click', () => {
        switchView('view-list');
        renderList(getFilteredGames());
    });

    // Refresh
    document.getElementById('btn-refresh-library').addEventListener('click', async () => {
        const btn = document.getElementById('btn-refresh-library');
        btn.style.animation = 'spin 0.6s linear infinite';
        await loadGames();
        btn.style.animation = '';
    });

    // Gallery search — debounced so typing doesn't rebuild the whole grid on every keystroke
    wireGalleryDelegation();
    let _searchDebounce;
    document.getElementById('gallery-search').addEventListener('input', () => {
        clearTimeout(_searchDebounce);
        _searchDebounce = setTimeout(() => renderCurrentView(), 140);
    });
    document.getElementById('gallery-sort').addEventListener('change', e => { currentSort = e.target.value; renderCurrentView(); });
    document.getElementById('gallery-category').addEventListener('change', e => { currentCategory = e.target.value; renderCurrentView(); });
    document.getElementById('btn-gsearch-clear').addEventListener('click', () => {
        document.getElementById('gallery-search').value = '';
        document.getElementById('btn-gsearch-clear').style.display = 'none';
        renderCurrentView();
        document.getElementById('gallery-search').focus();
    });

    // Rail nav filter buttons
    document.querySelectorAll('.rail-btn[data-rail]').forEach(btn => {
        btn.addEventListener('click', () => { closePanel(); setFilter(btn.dataset.rail); });
    });
    // Rail panel toggle buttons (search icon focuses gallery search instead of opening panel)
    document.querySelectorAll('.rail-btn[data-panel]').forEach(btn => {
        btn.addEventListener('click', () => {
            if (btn.dataset.panel === 'search') {
                document.getElementById('gallery-search')?.focus();
            } else {
                openPanel(btn.dataset.panel);
            }
        });
    });
    // Panel close buttons
    ['btn-panel-close', 'btn-panel-close-2'].forEach(id => {
        document.getElementById(id)?.addEventListener('click', closePanel);
    });

    // Add ROM button
    document.getElementById('btn-add-rom').addEventListener('click', () => openAddRomModal());

    // Scan folder button
    document.getElementById('btn-scan-folder').addEventListener('click', () => openModal('modal-scan-folder'));

    // Hero scan button (system-scoped)
    document.getElementById('btn-hero-scan').addEventListener('click', () => {
        openModal('modal-scan-folder');
        const sel = document.getElementById('scan-system-select');
        if (sel && currentFilter !== 'all' && currentFilter !== 'favs' && currentFilter !== 'want' && currentFilter !== 'recent') {
            sel.value = String(currentFilter);
            const sys = allSystems.find(s => s.id === Number(currentFilter));
            if (sys) document.getElementById('scan-extensions').value = sys.extensions || '';
        }
    });

    // Hero scrape all (system-scoped) — opens source picker
    document.getElementById('btn-hero-scrape-all').addEventListener('click', () => {
        // Intentionally unguarded: picking a source while a scrape runs enqueues into it.
        _scrapeAllSystemId = (currentFilter !== 'all' && currentFilter !== 'favs' && currentFilter !== 'want' && currentFilter !== 'recent')
            ? currentFilter : null;
        _scraperPickerMode = 'batch';
        document.getElementById('scraper-picker-status').textContent = '';
        openModal('modal-scraper-picker');
    });

    // Hero add ROM button (system-scoped)
    document.getElementById('btn-hero-add-rom').addEventListener('click', () => {
        const presetId = (currentFilter !== 'all' && currentFilter !== 'favs' && currentFilter !== 'want' && currentFilter !== 'recent')
            ? Number(currentFilter) : null;
        openAddRomModal(presetId);
    });

    // Systems manager is reached from Settings → Systems (btn-settings-manage-systems)

    // Settings
    document.getElementById('btn-open-settings').addEventListener('click', async () => {
        document.getElementById('settings-ss-user').value          = await window.api.getSetting('ss_user')           || '';
        document.getElementById('settings-ss-pass').value          = await window.api.getSetting('ss_pass')           || '';
        document.getElementById('settings-ra-user').value          = await window.api.getSetting('ra_user')           || '';
        document.getElementById('settings-ra-key').value           = await window.api.getSetting('ra_api_key')        || '';
        document.getElementById('settings-igdb-client-id').value   = await window.api.getSetting('igdb_client_id')    || '';
        document.getElementById('settings-igdb-client-secret').value = await window.api.getSetting('igdb_client_secret') || '';
        document.getElementById('settings-tgdb-key').value         = await window.api.getSetting('tgdb_api_key')      || '';
        document.getElementById('settings-sgdb-key').value         = await window.api.getSetting('sgdb_api_key')      || '';
        document.getElementById('settings-moby-key').value         = await window.api.getSetting('moby_api_key')      || '';
        const z = await window.api.getSetting('zoom') || '1.0';
        document.querySelectorAll('.zoom-btn').forEach(b => b.classList.toggle('active', b.dataset.val === z));
        document.getElementById('settings-search').value = '';
        document.querySelectorAll('#modal-settings .tool-card').forEach(c => c.style.display = '');
        document.getElementById('settings-content').classList.remove('searching');
        document.querySelectorAll('#settings-rail .cp-rail-item').forEach(b => b.classList.toggle('active', b.dataset.pane === 'general'));
        document.querySelectorAll('#modal-settings .cp-pane').forEach(p => p.classList.toggle('active', p.dataset.pane === 'general'));
        document.getElementById('settings-content').scrollTop = 0;
        document.getElementById('settings-ss-status').textContent   = '';
        document.getElementById('settings-ra-status').textContent   = '';
        document.getElementById('settings-igdb-status').textContent = '';
        document.getElementById('settings-tgdb-status').textContent = '';
        document.getElementById('settings-sgdb-status').textContent = '';
        const cngmImportEl = document.getElementById('settings-cngm-import-status');
        cngmImportEl.style.display = 'none'; cngmImportEl.textContent = '';
        const raStatusEl = document.getElementById('settings-retroarch-status');
        raStatusEl.textContent = retroarchStatusLabel(retroarchVariant);
        raStatusEl.style.color = retroarchStatusColor(retroarchVariant);
        const coresEl = document.getElementById('settings-cores-status');
        coresEl.textContent = allCores.length ? `${allCores.length} core${allCores.length !== 1 ? 's' : ''} scanned.` : '';
        document.getElementById('ra-config-status').textContent = '';
        refreshRaConfigInfo();
        openModal('modal-settings');
    });

    // Back to library
    document.getElementById('btn-gamepage-back').addEventListener('click', () => {
        switchView('view-gallery');
        renderGallery(getFilteredGames());
    });

    // Close the floating game page: backdrop click, the ✕ button, or Escape
    document.getElementById('gamepage-backdrop').addEventListener('click', closeGamePage);
    document.getElementById('gamepage-overlay-close').addEventListener('click', closeGamePage);
    document.addEventListener('keydown', e => {
        if (e.key === 'Escape' && currentView === 'view-gamepage' && !document.getElementById('img-lightbox')) closeGamePage();
    });

    // Gamepage launch
    document.getElementById('btn-gamepage-launch').addEventListener('click', () => {
        if (currentGame) launchGame(currentGame.id);
    });

    // Now Playing popup — dismiss on backdrop click or close button
    document.getElementById('modal-now-playing').addEventListener('click', e => {
        if (e.target === document.getElementById('modal-now-playing')) closeNowPlaying();
    });
    document.getElementById('np-close-btn').addEventListener('click', closeNowPlaying);

    // Gamepage fav / want
    document.getElementById('btn-gamepage-fav').addEventListener('click', async () => {
        if (!currentGame) return;
        currentGame.fav = currentGame.fav ? 0 : 1;
        await window.api.setGameFlag(currentGame.id, 'fav', currentGame.fav);
        document.getElementById('btn-gamepage-fav').classList.toggle('active', !!currentGame.fav);
    });
    document.getElementById('btn-gamepage-want').addEventListener('click', async () => {
        if (!currentGame) return;
        currentGame.want = currentGame.want ? 0 : 1;
        await window.api.setGameFlag(currentGame.id, 'want', currentGame.want);
        document.getElementById('btn-gamepage-want').classList.toggle('active', !!currentGame.want);
    });

    // Gamepage scrape — opens picker modal in full-scrape mode
    document.getElementById('btn-gamepage-scrape').addEventListener('click', () => {
        if (!currentGame) return;
        _scraperPickerMode = 'full';
        document.getElementById('scraper-picker-status').textContent = '';
        openModal('modal-scraper-picker');
    });

    // Gamepage edit
    document.getElementById('btn-gamepage-edit').addEventListener('click', () => {
        if (currentGame) openEditGameModal(currentGame);
    });

    // Gamepage remove — same backend as the edit-modal Delete ROM, reachable without opening Edit
    document.getElementById('btn-gamepage-remove').addEventListener('click', async () => {
        if (!currentGame) return;
        if (!await showConfirm(`Remove "${currentGame.title}" from the library?\nThe ROM file will NOT be deleted.`, 'Remove', true, 'Remove Game')) return;
        await window.api.deleteGame(currentGame.id);
        currentGame = null;
        switchView('view-gallery');
        await loadGames();
    });

    // Gamepage → CafeNeurotico
    document.getElementById('btn-gamepage-cngm').addEventListener('click', e => {
        if (currentGame) pushGameToCngm(currentGame.id, e.currentTarget);
    });

    // Gamepage cover → click to view full size
    document.getElementById('gamepage-cover').addEventListener('click', () => {
        if (currentGame?.cover) openImageLightbox(currentGame.cover);
    });

    // ── TRAILERS ─────────────────────────────────────────────────────────────
    let _trailerTitle  = '';
    let _trailerIgdbId = '';

    async function _runYtSearch(query) {
        const lst  = document.getElementById('yt-search-list');
        const stat = document.getElementById('yt-search-status');
        lst.innerHTML = '';
        stat.textContent = `Searching YouTube for "${query}"…`;

        if (_trailerIgdbId) {
            _renderYtResult({ id: _trailerIgdbId, thumbnail: `https://img.youtube.com/vi/${_trailerIgdbId}/hqdefault.jpg`, title: '🎬 Official Trailer (via IGDB)', official: true });
        }

        const results  = await window.api.searchYoutube(query);
        const filtered = results.filter(r => r.id !== _trailerIgdbId);
        filtered.forEach(res => _renderYtResult(res));
        const total = (_trailerIgdbId ? 1 : 0) + filtered.length;
        stat.textContent = total ? 'Click a result to download it.' : 'No results found.';
    }

    function _renderYtResult(res) {
        const lst = document.getElementById('yt-search-list');
        const div = document.createElement('div');
        div.className = 'yt-search-item';
        if (res.official) div.style.border = '2px solid var(--accent)';
        div.innerHTML = `<img src="${res.thumbnail}" style="width:120px; border-radius:4px; flex-shrink:0;"><div style="color:${res.official ? 'var(--accent)' : 'var(--text_main)'}; font-weight:bold; font-size:13px;">${escHtml(res.title)}</div>`;
        div.addEventListener('click', () => {
            closeModal('modal-trailer-search');
            openTrailerProgress(_trailerTitle, res.id);
        });
        lst.appendChild(div);
    }

    document.getElementById('btn-watch-trailer').addEventListener('click', async () => {
        const gameId = Number(document.getElementById('edit-game-id').value);
        const game   = allGames.find(g => g.id === gameId);
        _trailerTitle  = document.getElementById('edit-title').value.trim() || game?.title || '';
        _trailerIgdbId = game?.igdb_trailer || '';
        if (!_trailerTitle) return;
        const localUrl = await window.api.checkLocalTrailer(_trailerTitle);
        if (localUrl) {
            document.getElementById('modal-trailer-player').classList.add('active');
            const vid = document.getElementById('detail-video-player');
            vid.src = localUrl; vid.play();
        } else {
            const sysName = game?.system_name || '';
            const defaultQuery = [_trailerTitle, sysName, 'trailer'].filter(Boolean).join(' ');
            document.getElementById('yt-search-input').value = defaultQuery;
            openModal('modal-trailer-search');
            await _runYtSearch(defaultQuery);
        }
    });

    document.getElementById('btn-yt-search').addEventListener('click', async () => {
        const query = document.getElementById('yt-search-input').value.trim();
        if (query) await _runYtSearch(query);
    });

    document.getElementById('yt-search-input').addEventListener('keydown', async (e) => {
        if (e.key === 'Enter') {
            const query = document.getElementById('yt-search-input').value.trim();
            if (query) await _runYtSearch(query);
        }
    });

    document.getElementById('btn-delete-trailer').addEventListener('click', async () => {
        const title = document.getElementById('edit-title').value.trim();
        if (!title) return;
        const ok = await window.api.deleteTrailer(title);
        showLaunchToast(ok ? 'Trailer deleted.' : 'No local trailer found.', null);
        if (ok) {
            const trailerBtn = document.getElementById('btn-gamepage-trailer');
            trailerBtn.style.display = 'none';
            trailerBtn.onclick = null;
        }
    });

    document.getElementById('btn-close-yt-search').addEventListener('click', () => closeModal('modal-trailer-search'));
    document.getElementById('btn-close-player').addEventListener('click', () => {
        closeModal('modal-trailer-player');
        const vid = document.getElementById('detail-video-player');
        vid.pause(); vid.removeAttribute('src'); vid.load();
    });

    window.api.onDownloadProgress(pct => {
        const fill = document.getElementById('dl-progress-fill');
        const text = document.getElementById('dl-progress-text');
        if (fill) fill.style.width = `${pct}%`;
        if (text) text.textContent  = `${Math.floor(pct)}%`;
    });

    // ── MODAL: ADD ROM ───────────────────────────────────────────────────────
    document.getElementById('btn-add-rom-browse').addEventListener('click', async () => {
        const p = await window.api.selectFile();
        if (!p) return;
        document.getElementById('add-rom-path').value = p;
        if (!document.getElementById('add-rom-title').value) {
            const base = p.split('/').pop().replace(/\.[^.]+$/, '');
            document.getElementById('add-rom-title').value = base;
        }
    });
    document.getElementById('btn-add-rom-cancel').addEventListener('click', () => closeModal('modal-add-rom'));
    document.getElementById('btn-add-rom-confirm').addEventListener('click', async () => {
        const romPath  = document.getElementById('add-rom-path').value.trim();
        const title    = document.getElementById('add-rom-title').value.trim();
        const systemId = document.getElementById('add-rom-system').value;
        if (!romPath || !title) { showAlert('ROM path and title are required.', 'Add ROM'); return; }
        await window.api.addGame({ system_id: systemId || null, title, rom_path: romPath });
        closeModal('modal-add-rom');
        await loadGames();
    });

    // ── MODAL: SCAN FOLDER ───────────────────────────────────────────────────
    document.getElementById('btn-scan-browse').addEventListener('click', async () => {
        const p = await window.api.selectDirectory();
        if (p) document.getElementById('scan-folder-path').value = p;
    });
    document.getElementById('scan-system-select').addEventListener('change', () => {
        const id = document.getElementById('scan-system-select').value;
        const sys = allSystems.find(s => s.id === Number(id));
        if (sys) document.getElementById('scan-extensions').value = sys.extensions || '';
    });
    document.getElementById('btn-scan-run').addEventListener('click', async () => {
        const folder = document.getElementById('scan-folder-path').value.trim();
        const exts   = document.getElementById('scan-extensions').value.trim();
        if (!folder) { showAlert('Please select a folder first.', 'Scan Folder'); return; }
        _scanEntries = await window.api.scanRomFolder(folder, exts);
        const resultsWrap = document.getElementById('scan-results-wrap');
        const resultsList = document.getElementById('scan-results-list');
        document.getElementById('scan-results-count').textContent = _scanEntries.length;
        const sysOpts = `<option value="">— Skip —</option>` +
            allSystems.map(s => `<option value="${s.id}">${escHtml(s.name)}</option>`).join('');
        const presetId = document.getElementById('scan-system-select').value;
        resultsList.innerHTML = _scanEntries.map((e, i) => {
            const badge = e.kind === 'multidisc'
                ? `<span class="disc-badge" title="${e.discCount} discs — imported as one game via a generated .m3u playlist">${e.discCount} DISCS</span>`
                : (e.kind === 'playlist' ? `<span class="disc-badge" title="Multi-disc playlist">M3U</span>` : '');
            return `<div class="scan-result-item">
                <span class="rom-name" title="${escHtml(e.path)}">${escHtml(e.title)}${badge}</span>
                <select class="scan-item-system" data-idx="${i}">
                    ${sysOpts.replace(`value="${presetId}"`, `value="${presetId}" selected`)}
                </select>
            </div>`;
        }).join('') || `<div style="text-align:center; padding:20px; color:var(--text_dim);">No ROMs found with those extensions.</div>`;
        resultsWrap.style.display = _scanEntries.length ? 'block' : 'none';
        if (!_scanEntries.length) showAlert('No ROMs found with those extensions.', 'Scan Folder');
    });
    document.getElementById('btn-scan-cancel').addEventListener('click', () => {
        closeModal('modal-scan-folder');
        document.getElementById('scan-results-wrap').style.display = 'none';
        document.getElementById('scan-folder-path').value = '';
    });
    document.getElementById('btn-scan-import').addEventListener('click', async () => {
        const items = document.querySelectorAll('.scan-item-system');
        let count = 0;
        for (const sel of items) {
            if (!sel.value) continue;
            const entry = _scanEntries[Number(sel.dataset.idx)];
            if (!entry) continue;
            let romPath = entry.path;
            if (entry.kind === 'multidisc') {
                const r = await window.api.createM3u({ title: entry.title, discs: entry.discs });
                if (r?.ok) romPath = r.path;   // fall back to disc 1 if the .m3u can't be written
            }
            await window.api.addGame({ system_id: sel.value, title: entry.title, rom_path: romPath });
            count++;
        }
        closeModal('modal-scan-folder');
        document.getElementById('scan-results-wrap').style.display = 'none';
        document.getElementById('scan-folder-path').value = '';
        await loadGames();
        if (count) showAlert(`${count} ROM${count !== 1 ? 's' : ''} imported.`, 'Scan Folder');
    });

    // ── MODAL: EDIT GAME ─────────────────────────────────────────────────────
    const updateCmdPreview = () => {
        const id       = Number(document.getElementById('edit-game-id').value);
        const override = document.getElementById('edit-launch-override').value.trim();
        const romPath  = document.getElementById('edit-rom-path').value.trim();
        const sysId    = document.getElementById('edit-system').value;
        const sys      = allSystems.find(s => s.id === Number(sysId));
        let cmd = override;
        if (!cmd && sys?.launch_template && romPath) {
            cmd = sys.launch_template
                .replace('{rom}',      romPath ? `"${romPath}"` : '')
                .replace('{core}',     sys.default_core     ? `"${sys.default_core}"`     : '')
                .replace('{emulator}', sys.default_emulator ? `"${sys.default_emulator}"` : '');
        }
        const wrap = document.getElementById('edit-cmd-preview-wrap');
        const preview = document.getElementById('edit-cmd-preview');
        if (cmd) { preview.textContent = cmd; wrap.style.display = 'block'; }
        else      { wrap.style.display = 'none'; }
    };
    ['edit-launch-override', 'edit-rom-path', 'edit-system'].forEach(id => {
        document.getElementById(id)?.addEventListener('input',  updateCmdPreview);
        document.getElementById(id)?.addEventListener('change', updateCmdPreview);
    });

    document.getElementById('btn-edit-browse-rom').addEventListener('click', async () => {
        const p = await window.api.selectFile();
        if (p) { document.getElementById('edit-rom-path').value = p; updateCmdPreview(); }
    });
    document.getElementById('btn-edit-cover').addEventListener('click',      () => browseArt('cover'));
    document.getElementById('btn-edit-hero').addEventListener('click',       () => browseArt('hero'));
    document.getElementById('btn-edit-logo').addEventListener('click',       () => browseArt('logo'));
    document.getElementById('btn-edit-screenshot').addEventListener('click', () => browseArt('screenshot'));

    document.getElementById('btn-scrape-cover').addEventListener('click',      () => openArtPicker('cover'));
    document.getElementById('btn-scrape-hero').addEventListener('click',       () => openArtPicker('hero'));
    document.getElementById('btn-scrape-logo').addEventListener('click',       () => openArtPicker('logo'));
    document.getElementById('btn-scrape-screenshot').addEventListener('click', () => openArtPicker('screenshot'));

    document.getElementById('btn-scrape-meta').addEventListener('click', () => {
        if (!currentGame) return;
        _scraperPickerMode = 'meta';
        document.getElementById('scraper-picker-status').textContent = '';
        openModal('modal-scraper-picker');
    });

    for (const type of ['cover', 'hero', 'logo', 'screenshot']) {
        document.getElementById(`btn-delete-${type}`).addEventListener('click', async () => {
            const id = Number(document.getElementById('edit-game-id').value);
            await window.api.deleteGameArt(id, type);
            const prev = document.getElementById(_artPreviewId[type]);
            if (prev) prev.src = '';
            const g = allGames.find(x => x.id === id);
            if (g) g[type] = null;
        });
    }

    // Art picker modal
    document.getElementById('btn-art-picker-close').addEventListener('click', () =>
        document.getElementById('modal-art-picker').classList.remove('active'));
    document.getElementById('btn-art-picker-search').addEventListener('click', async () => {
        const query = document.getElementById('art-picker-search').value.trim();
        if (query) await _artPickerSearch(query);
    });
    document.getElementById('art-picker-search').addEventListener('keydown', async e => {
        if (e.key === 'Enter') {
            const query = document.getElementById('art-picker-search').value.trim();
            if (query) await _artPickerSearch(query);
        }
    });
    document.getElementById('btn-edit-cancel').addEventListener('click', () => closeModal('modal-edit-game'));
    document.getElementById('btn-edit-save').addEventListener('click', async () => {
        const id = Number(document.getElementById('edit-game-id').value);
        const data = {
            title:           document.getElementById('edit-title').value.trim(),
            system_id:       document.getElementById('edit-system').value || null,
            rom_path:        document.getElementById('edit-rom-path').value.trim(),
            year:            document.getElementById('edit-year').value.trim(),
            genre:           document.getElementById('edit-genre').value.trim(),
            developer:       document.getElementById('edit-developer').value.trim(),
            publisher:       document.getElementById('edit-publisher').value.trim(),
            players:         document.getElementById('edit-players').value.trim(),
            rating:          document.getElementById('edit-rating').value.trim(),
            description:     document.getElementById('edit-description').value.trim(),
            launch_override: document.getElementById('edit-launch-override').value.trim(),
            core_override:   document.getElementById('edit-core-override').value || null,
            ra_game_id:      parseInt(document.getElementById('edit-ra-game-id').value) || null,
        };
        if (!data.title) { showAlert('Title is required.', 'Edit Game'); return; }
        await window.api.updateGame(id, data);
        closeModal('modal-edit-game');
        await loadGames();
        const updated = allGames.find(g => g.id === id);
        if (updated && currentGame?.id === id) openGamePage(updated);
    });
    document.getElementById('btn-edit-delete').addEventListener('click', async () => {
        const id = Number(document.getElementById('edit-game-id').value);
        if (!await showConfirm('Delete this ROM from the library?\nThe file will NOT be deleted.', 'Delete', true, 'Delete Game')) return;
        await window.api.deleteGame(id);
        closeModal('modal-edit-game');
        switchView('view-gallery');
        await loadGames();
    });

    document.getElementById('btn-edit-cngm').addEventListener('click', e => {
        const id = Number(document.getElementById('edit-game-id').value);
        if (id) pushGameToCngm(id, e.currentTarget);
    });

    // ── MODAL: SYSTEMS ───────────────────────────────────────────────────────
    document.getElementById('btn-add-system').addEventListener('click', () => {
        closeModal('modal-systems');
        openSystemPresetsModal();
    });

    // ── MODAL: SYSTEM PRESET PICKER ──────────────────────────────────────────
    document.getElementById('preset-search').addEventListener('input', e => renderPresetList(e.target.value));
    document.getElementById('btn-preset-cancel').addEventListener('click', () => {
        closeModal('modal-system-presets');
        openSystemsModal();
    });
    document.getElementById('btn-preset-custom').addEventListener('click', () => {
        closeModal('modal-system-presets');
        openEditSystemModal(null);
    });

    // Preset template buttons in edit-system modal
    document.querySelectorAll('.preset-template-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.getElementById('edit-system-template').value = btn.dataset.tpl;
        });
    });

    // ── MODAL: EDIT SYSTEM ───────────────────────────────────────────────────
    document.getElementById('btn-edit-system-cancel').addEventListener('click', () => {
        closeModal('modal-edit-system');
        openSystemsModal();
    });
    document.getElementById('btn-edit-system-save').addEventListener('click', async () => {
        const id = document.getElementById('edit-system-id').value;
        const data = {
            name:             document.getElementById('edit-system-name').value.trim(),
            short_name:       document.getElementById('edit-system-short').value.trim(),
            extensions:       document.getElementById('edit-system-extensions').value.trim(),
            launch_template:  document.getElementById('edit-system-template').value.trim(),
            default_core:     document.getElementById('edit-system-core').value.trim(),
            default_emulator: document.getElementById('edit-system-emulator').value.trim(),
            screenscraper_id: document.getElementById('edit-system-ssid').value || null,
        };
        if (!data.name) { showAlert('System name is required.', 'Edit System'); return; }
        if (id) await window.api.updateSystem(Number(id), data);
        else    await window.api.addSystem(data);
        closeModal('modal-edit-system');
        await loadSystems();
        await loadGames();
        openSystemsModal();
    });
    document.getElementById('btn-edit-system-delete').addEventListener('click', async () => {
        const id = Number(document.getElementById('edit-system-id').value);
        const sys = allSystems.find(s => s.id === id);
        const count = allGames.filter(g => g.system_id === id).length;
        if (!await showConfirm(`Delete system "${sys?.name}"?\nThis will also delete all ${count} ROM(s) in this system.`, 'Delete', true, 'Delete System')) return;
        await window.api.deleteSystem(id);
        closeModal('modal-edit-system');
        await loadSystems();
        await loadGames();
        if (currentFilter === String(id)) setFilter('all');
        openSystemsModal();
    });

    // BIOS: scan a folder and auto-install matches (by MD5, falling back to filename) for any system
    document.getElementById('btn-bios-scan').addEventListener('click', async () => {
        const short = document.getElementById('edit-system-short').value.trim();
        const res = await window.api.biosScanFolder();
        if (res.canceled) return;
        if (!res.ok) { showLaunchToast(res.error || 'Scan failed.', null, 'BIOS'); return; }
        showLaunchToast(res.installed.length
            ? `Added ${res.installed.length} BIOS file(s): ${res.installed.join(', ')}.`
            : 'Done. No matching BIOS files found in that folder.', null, 'BIOS');
        if (short) renderBiosStatus(short);
    });

    // ── EDIT SYSTEM: BROWSE CORE (custom .so path) ───────────────────────────
    document.getElementById('btn-edit-system-core-browse').addEventListener('click', async () => {
        const p = await window.api.selectFile([
            { name: 'RetroArch Cores', extensions: ['so'] },
            { name: 'All Files', extensions: ['*'] },
        ]);
        if (!p) return;
        const sel = document.getElementById('edit-system-core');
        if (![...sel.options].some(o => o.value === p))   // add the custom path as an option
            sel.insertAdjacentHTML('beforeend', `<option value="${escHtml(p)}">${escHtml(p.split('/').pop())}</option>`);
        sel.value = p;
        sel.dispatchEvent(new Event('change', { bubbles: true }));
    });

    // ── CORE CHOOSERS: descriptions + "show all" toggles ─────────────────────
    document.getElementById('edit-core-override').addEventListener('change',
        () => updateCoreDesc('edit-core-override', 'edit-core-override-desc'));
    document.getElementById('edit-system-core').addEventListener('change',
        () => updateCoreDesc('edit-system-core', 'edit-system-core-desc'));
    document.getElementById('edit-core-override-all').addEventListener('change', e => {
        const g = allGames.find(x => x.id === Number(document.getElementById('edit-game-id').value));
        if (g) populateCoreOverrideSelect({ ...g, core_override: document.getElementById('edit-core-override').value }, e.target.checked);
    });
    document.getElementById('edit-system-core-all').addEventListener('change', e => {
        const sysId = Number(document.getElementById('edit-system-id').value);
        const sys = systemById(sysId) || { extensions: document.getElementById('edit-system-extensions').value, name: document.getElementById('edit-system-name').value };
        populateSystemCoreSelect(sys, document.getElementById('edit-system-core').value, e.target.checked);
    });

    // ── REPAIR DISC REFERENCES ───────────────────────────────────────────────
    document.getElementById('btn-repair-disc-system').addEventListener('click', async () => {
        const id  = Number(document.getElementById('edit-system-id').value);
        const out = document.getElementById('repair-disc-system-result');
        out.style.display = 'block';
        if (!id) { out.textContent = 'Save the system first, then reopen it to repair its games.'; return; }
        await runDiscRepair(document.getElementById('btn-repair-disc-system'), out, () => window.api.repairDiscRefsSystem(id));
    });
    document.getElementById('btn-repair-disc-game').addEventListener('click', async () => {
        const id  = Number(document.getElementById('edit-game-id').value);
        const out = document.getElementById('repair-disc-game-result');
        out.style.display = 'block';
        await runDiscRepair(document.getElementById('btn-repair-disc-game'), out, () => window.api.repairDiscRefsGame(id));
    });

    // ── RETROARCH LAUNCH SETTINGS (override editor) ───────────────────────────
    document.getElementById('btn-ra-override-system').addEventListener('click', () => {
        const id = Number(document.getElementById('edit-system-id').value);
        if (!id) { showAlert('Save the system first, then configure its RetroArch settings.', 'RetroArch Settings'); return; }
        openRaOverride('system', id, `RetroArch Settings — ${document.getElementById('edit-system-name').value || 'System'}`, 'Applies to all games in this system. Overrides Global; a per-game setting wins over this.');
    });
    document.getElementById('btn-ra-override-game').addEventListener('click', () => {
        const id = Number(document.getElementById('edit-game-id').value);
        if (!id) { showAlert('Save the game first.', 'RetroArch Settings'); return; }
        openRaOverride('game', id, `RetroArch Settings — ${document.getElementById('edit-title').value || 'Game'}`, 'Highest priority — overrides the system and global settings for this game only.');
    });
    document.getElementById('ra-ovr-enabled').addEventListener('change', raOverrideToggleFields);
    document.getElementById('ra-ovr-shader-clear').addEventListener('click', () => { _raOvrShader = ''; _shaderBrowserOvr.refreshCurrent(); });
    document.getElementById('ra-override-cancel').addEventListener('click', () => closeModal('modal-ra-override'));
    document.getElementById('ra-override-save').addEventListener('click', async () => {
        await window.api.setRaOverride(_raScope, _raRef, {
            enabled:      document.getElementById('ra-ovr-enabled').checked,
            monitor:      document.getElementById('ra-ovr-monitor').value,
            fullscreen:   document.getElementById('ra-ovr-fullscreen').value,
            aspect:       document.getElementById('ra-ovr-aspect').value,
            shaderEnable: document.getElementById('ra-ovr-shader-enable').value,
            shader:       _raOvrShader,
            custom:       document.getElementById('ra-ovr-custom').value,
        });
        closeModal('modal-ra-override');
    });

    // ── SAVE STATE MANAGER ───────────────────────────────────────────────────
    document.getElementById('btn-gamepage-saves').addEventListener('click', () => { if (currentGame) openSaveManager(currentGame.id); });
    document.getElementById('btn-open-save-manager').addEventListener('click', () => openSaveManager(null));
    document.getElementById('btn-rail-save-manager').addEventListener('click', () => openSaveManager(null));
    document.getElementById('btn-gamepage-ra').addEventListener('click', () => {
        if (currentGame) openRaOverride('game', currentGame.id, `RetroArch Settings — ${currentGame.title || 'Game'}`, 'Highest priority — overrides the system and global settings for this game only.');
    });
    document.getElementById('sm-close').addEventListener('click', () => closeModal('modal-save-manager'));
    document.getElementById('sm-back').addEventListener('click', () => smShowGames());
    document.getElementById('sm-search').addEventListener('input', () => smRenderGames());
    document.getElementById('sm-sort').addEventListener('click', () => {
        _smSort = _smSort === 'recent' ? 'alpha' : 'recent';
        document.getElementById('sm-sort').textContent = _smSort === 'alpha' ? 'A-Z' : 'RECENT';
        smRenderGames();
    });
    document.getElementById('sm-fresh').addEventListener('click', () => smLaunch({ fresh: true }));
    document.getElementById('sm-launch').addEventListener('click', () => { const s = _smSlots[_smSel]; if (s) smLaunch({ slot: s.slot }); });
    document.getElementById('sm-delete').addEventListener('click', async () => {
        const s = _smSlots[_smSel]; if (!s || !_smGame) return;
        if (!await showConfirm(`Delete ${smSlotName(s.slot)}? This removes the save-state file from disk.`, 'Delete', true, 'Delete Save State')) return;
        const r = await window.api.deleteSaveState(s.file);
        if (r.ok) smShowSlots(_smGame.id); else showLaunchToast(r.error || 'Delete failed', null);
    });
    document.getElementById('sm-label').addEventListener('click', () => {
        const s = _smSlots[_smSel]; if (!s || !_smGame) return;
        const detail = document.getElementById('sm-detail');
        detail.innerHTML = `<input id="sm-label-input" value="${escHtml(s.label || '')}" placeholder="LABEL THIS SAVE" style="font-family:'Courier New',monospace; width:280px; text-transform:uppercase;">`;
        const inp = document.getElementById('sm-label-input'); inp.focus(); inp.select();
        const commit = async () => {
            await window.api.setSaveLabel(_smGame.id, s.slot, inp.value);
            s.label = inp.value.trim();
            const tag = document.querySelector(`#sm-grid .sm-card[data-idx="${_smSel}"] .sm-tag`);
            if (tag) tag.textContent = s.label || smSlotName(s.slot);
            smSelectSlot(_smSel);
        };
        inp.addEventListener('keydown', e => { if (e.key === 'Enter') commit(); else if (e.key === 'Escape') smSelectSlot(_smSel); });
        inp.addEventListener('blur', commit);
    });
    document.getElementById('sm-backup').addEventListener('click', async () => {
        const r = _smGame ? await window.api.backupSaves('game', _smGame.id) : await window.api.backupSaves('all');
        if (r.canceled) return;
        showLaunchToast(r.ok ? `Backed up ${r.files} file(s) → ${r.path}` : (r.error || 'Backup failed'), null, 'BACKUP');
    });
    document.getElementById('sm-restore').addEventListener('click', async () => {
        const r = await window.api.restoreSaves();
        if (r.canceled) return;
        if (r.ok) { showLaunchToast(`Restored ${r.restored} save file(s).`, null, 'RESTORE'); _smGame ? smShowSlots(_smGame.id) : smShowGames(); }
        else showLaunchToast(r.error || 'Restore failed', null, 'RESTORE');
    });
    document.getElementById('btn-backup-ra-settings').addEventListener('click', async () => {
        const out = document.getElementById('settings-backup-status');
        const r = await window.api.backupRaSettings();
        if (r.canceled) return;
        out.textContent = r.ok ? `✓ Saved to ${r.path}` : `✗ ${r.error || 'Backup failed'}`;
    });
    document.getElementById('btn-restore-ra-settings').addEventListener('click', async () => {
        const out = document.getElementById('settings-backup-status');
        const r = await window.api.restoreRaSettings();
        if (r.canceled) return;
        out.textContent = r.ok ? `✓ Restored ${r.restored} setting group(s).` : `✗ ${r.error || 'Restore failed'}`;
    });

    // ── EMULATTE-OWNED RETROARCH CONFIG ──────────────────────────────────────
    const raCfgStatus = msg => { document.getElementById('ra-config-status').textContent = msg || ''; };
    document.getElementById('btn-ra-configure').addEventListener('click', async () => {
        await window.api.launchRetroarchConfig();
        raCfgStatus('Opened RetroArch on EmuLatte’s config. Changes you make there save back here.');
    });
    document.getElementById('btn-ra-reimport-paths').addEventListener('click', async () => {
        await window.api.raConfigReimportPaths(); await refreshRaConfigInfo();
        raCfgStatus('✓ Re-imported folder paths from this machine’s RetroArch.');
    });
    document.getElementById('btn-ra-cfg-import').addEventListener('click', async () => {
        const r = await window.api.raConfigImport(); if (r.canceled) return;
        await refreshRaConfigInfo(); raCfgStatus(r.ok ? '✓ Imported config.' : `✗ ${r.error || 'Import failed'}`);
    });
    document.getElementById('btn-ra-cfg-export').addEventListener('click', async () => {
        const r = await window.api.raConfigExport(); if (r.canceled) return;
        raCfgStatus(r.ok ? `✓ Exported to ${r.path}` : `✗ ${r.error || 'Export failed'}`);
    });
    document.getElementById('btn-ra-cfg-relocate').addEventListener('click', async () => {
        const r = await window.api.raConfigRelocate(); if (r.canceled) return;
        await refreshRaConfigInfo(); raCfgStatus(r.ok ? `✓ Config now at ${r.path}` : `✗ ${r.error || 'Failed'}`);
    });
    document.getElementById('btn-ra-cfg-folder').addEventListener('click', () => window.api.raConfigOpenFolder());
    document.getElementById('btn-ra-cfg-reset').addEventListener('click', async () => {
        if (!await showConfirm('Reset EmuLatte’s RetroArch config to a clean seed (only folder paths re-imported)? Your tweaks in this config will be lost.', 'Reset', true, 'Reset RetroArch Config')) return;
        await window.api.raConfigReset(); await refreshRaConfigInfo(); raCfgStatus('✓ Reset to a clean config.');
    });

    // RetroArch full settings menu
    document.getElementById('btn-ra-settings').addEventListener('click', openRaSettings);
    const closeRaSettings = () => { closeModal('modal-ra-settings'); openModal('modal-settings'); };   // return to the Settings hub it came from
    document.getElementById('btn-ra-set-close').addEventListener('click', closeRaSettings);
    document.getElementById('btn-ra-set-save').addEventListener('click', async () => {
        await window.api.raConfigSet(_raChanges);
        if (Object.keys(_raCoreChanges).length) await window.api.raCoreOptionsSet(_raCoreChanges);
        _raChanges = {}; _raCoreChanges = {};
        closeRaSettings();
        showLaunchToast('RetroArch settings saved — applies on next launch.', null, 'RETROARCH');
    });
    document.getElementById('btn-ra-remap-in-ra').addEventListener('click', () => window.api.launchRetroarchConfig());
    // Shader pack download + bundled presets
    const raShaderStatus = m => { const el = document.getElementById('ra-shader-status'); if (el) el.textContent = m || ''; };
    window.api.onShaderPackProgress(d => {
        if (d.extracting) raShaderStatus('Extracting shader pack…');
        else raShaderStatus(`Downloading shader pack… ${(d.got / 1048576).toFixed(1)} MB${d.total ? ' / ' + (d.total / 1048576).toFixed(0) + ' MB' : ''}`);
    });
    document.getElementById('btn-ra-shader-pack').addEventListener('click', async () => {
        const btn = document.getElementById('btn-ra-shader-pack'); btn.disabled = true;
        raShaderStatus('Starting download…');
        const r = await window.api.downloadShaderPack();
        btn.disabled = false;
        raShaderStatus(r.ok ? `✓ Installed ${r.files} shader files. Browse below.` : `✗ ${r.error || 'Download failed'}`);
        if (r.ok) browseShaders('');
    });
    document.getElementById('btn-ra-shader-bundled').addEventListener('click', async () => {
        const r = await window.api.installBundledPresets();
        raShaderStatus(r.ok ? `✓ Installed: ${r.names.join(', ')}` : `✗ ${r.error || 'Failed'}`);
        if (r.ok) browseShaders('');
    });
    document.querySelectorAll('#ra-set-rail .cp-rail-item').forEach(item => {
        item.addEventListener('click', () => {
            const pane = item.dataset.rapane;
            if (pane === 'all' && !_raAllRendered) renderRaAll();
            document.querySelectorAll('#ra-set-rail .cp-rail-item').forEach(b => b.classList.toggle('active', b === item));
            document.querySelectorAll('#modal-ra-settings .cp-pane').forEach(p => p.classList.toggle('active', p.dataset.rapane === pane));
            document.getElementById('ra-set-content').scrollTop = 0;
        });
    });
    document.getElementById('ra-set-search').addEventListener('input', e => {
        const q = e.target.value.trim().toLowerCase();
        if (q && !_raAllRendered) renderRaAll();                       // search must reach every key
        document.getElementById('ra-set-content').classList.toggle('searching', !!q);
        document.querySelectorAll('#modal-ra-settings .ra-set-row').forEach(row => {
            row.style.display = !q || (row.dataset.label || '').includes(q) ? '' : 'none';
        });
        // While searching, only reveal panes that actually contain a matching setting row — otherwise the
        // non-row panes (Shaders browser, Controls, etc.) show in full and look like you jumped to them.
        document.querySelectorAll('#modal-ra-settings .cp-pane').forEach(pane => {
            if (!q) { pane.style.display = ''; return; }
            const hasMatch = [...pane.querySelectorAll('.ra-set-row')].some(r => r.style.display !== 'none');
            pane.style.display = hasMatch ? '' : 'none';
        });
    });

    // ── GAMEPAGE: + PLAYLIST ─────────────────────────────────────────────────
    document.getElementById('btn-gamepage-playlist').addEventListener('click', () => { if (currentGame) openPlaylistPicker(currentGame.id); });
    document.getElementById('btn-playlist-picker-close').addEventListener('click', () => closeModal('modal-add-to-playlist'));
    document.getElementById('btn-playlist-picker-create').addEventListener('click', async () => {
        const inp = document.getElementById('playlist-picker-new');
        const name = inp.value.trim();
        if (!name || _plPickerGameId == null) return;
        const newId = await window.api.addPlaylist(name);   // returns the new playlist id
        inp.value = '';
        await loadPlaylists();
        if (newId) await window.api.addGameToPlaylist(newId, _plPickerGameId);   // create & add in one step
        await renderPlaylistPicker();
        if (typeof currentFilter === 'string' && currentFilter.startsWith('playlist:'))
            currentPlaylistGames = await window.api.getPlaylistGames(Number(currentFilter.split(':')[1]));
    });
    document.getElementById('playlist-picker-new').addEventListener('keydown', e => { if (e.key === 'Enter') document.getElementById('btn-playlist-picker-create').click(); });

    // ── MODAL: CREATE PLAYLIST ────────────────────────────────────────────────
    document.getElementById('btn-add-playlist').addEventListener('click', () => {
        document.getElementById('new-playlist-name').value = '';
        openModal('modal-create-playlist');
    });
    document.getElementById('btn-create-playlist-cancel').addEventListener('click', () => closeModal('modal-create-playlist'));
    document.getElementById('btn-create-playlist-confirm').addEventListener('click', async () => {
        const name = document.getElementById('new-playlist-name').value.trim();
        if (!name) return;
        await window.api.addPlaylist(name);
        closeModal('modal-create-playlist');
        await loadPlaylists();
    });

    // ── MODAL: EDIT PLAYLIST ──────────────────────────────────────────────────
    document.getElementById('btn-edit-playlist-cancel').addEventListener('click', () => closeModal('modal-edit-playlist'));
    document.getElementById('btn-edit-playlist-save').addEventListener('click', async () => {
        const id   = Number(document.getElementById('edit-playlist-id').value);
        const name = document.getElementById('edit-playlist-name').value.trim();
        if (!name) return;
        await window.api.updatePlaylist(id, name);
        closeModal('modal-edit-playlist');
        await loadPlaylists();
    });
    document.getElementById('btn-edit-playlist-delete').addEventListener('click', async () => {
        const id = Number(document.getElementById('edit-playlist-id').value);
        const pl = allPlaylists.find(p => p.id === id);
        if (!await showConfirm(`Delete playlist "${pl?.name}"?`, 'Delete', true, 'Delete Playlist')) return;
        await window.api.deletePlaylist(id);
        closeModal('modal-edit-playlist');
        if (currentFilter === `playlist:${id}`) setFilter('all');
        await loadPlaylists();
    });

    // ── SETTINGS: RE-DETECT RETROARCH ────────────────────────────────────────
    document.getElementById('btn-detect-retroarch').addEventListener('click', async () => {
        const btn = document.getElementById('btn-detect-retroarch');
        btn.textContent = 'Detecting…';
        btn.disabled = true;
        retroarchVariant = await window.api.detectRetroArch();
        btn.textContent = 'Re-detect';
        btn.disabled = false;
        const raStatusEl = document.getElementById('settings-retroarch-status');
        raStatusEl.textContent = retroarchStatusLabel(retroarchVariant);
        raStatusEl.style.color = retroarchStatusColor(retroarchVariant);
        updateTemplateButtonLabels();
    });

    // ── SETTINGS: SCAN CORES ──────────────────────────────────────────────────
    document.getElementById('btn-scan-cores').addEventListener('click', async () => {
        const btn      = document.getElementById('btn-scan-cores');
        const statusEl = document.getElementById('settings-cores-status');
        btn.textContent = 'Scanning…';
        btn.disabled = true;
        const result = await window.api.scanCores();
        btn.textContent = 'Scan RetroArch Cores';
        btn.disabled = false;
        if (result.ok) {
            await loadCores();
            statusEl.textContent = `${result.count} core${result.count !== 1 ? 's' : ''} found.`;
            statusEl.style.color = 'var(--accent)';
        } else {
            statusEl.textContent = result.error || 'Scan failed.';
            statusEl.style.color = '#ef5350';
        }
    });

    // ── CORE DOWNLOADER ──────────────────────────────────────────────────────
    document.getElementById('btn-download-cores').addEventListener('click', () => openCoreDownloader(null));
    document.getElementById('btn-core-dl-close').addEventListener('click', () => closeModal('modal-core-downloader'));
    document.getElementById('btn-express-shaders-close').addEventListener('click', () => closeModal('modal-express-shaders'));
    document.getElementById('core-dl-search').addEventListener('input', renderCoreDownloader);
    document.getElementById('btn-edit-system-core-download').addEventListener('click', () => {
        const id  = document.getElementById('edit-system-id').value;
        const sys = id ? allSystems.find(s => s.id === Number(id)) : null;
        // build a system-like object from the live form so "recommended" works even for an unsaved system
        openCoreDownloader({
            id:           sys?.id,
            name:         document.getElementById('edit-system-name').value || sys?.name || 'this system',
            short_name:   document.getElementById('edit-system-short').value || sys?.short_name || '',
            default_core: document.getElementById('edit-system-core').value || sys?.default_core || '',
            extensions:   document.getElementById('edit-system-extensions').value || sys?.extensions || '',
        });
    });
    window.api.onCoreInstallProgress(d => {
        const el = document.getElementById('core-dl-status');
        if (!el || d.done) return;                               // final message is set by installCoreFromRow
        el.style.color = 'var(--text_dim)';
        if (d.extracting) el.textContent = 'Extracting…';
        else if (d.total) el.textContent = `Downloading… ${(d.got / 1048576).toFixed(1)} / ${(d.total / 1048576).toFixed(1)} MB`;
        else if (d.got)   el.textContent = `Downloading… ${(d.got / 1048576).toFixed(1)} MB`;
    });

    // ── MODAL: SS SYSTEM BROWSER ─────────────────────────────────────────────
    document.getElementById('btn-browse-ss-systems').addEventListener('click', async () => {
        const btn = document.getElementById('btn-browse-ss-systems');
        btn.textContent = '…';
        btn.disabled = true;
        const result = await window.api.fetchSsSystems();
        btn.textContent = 'Browse';
        btn.disabled = false;
        if (!result.ok) { showAlert(result.error || 'Failed to fetch ScreenScraper systems.', 'ScreenScraper'); return; }
        ssSystems = result.systems;
        document.getElementById('ss-systems-search').value = '';
        renderSsSystemsList('');
        openModal('modal-ss-systems');
    });
    document.getElementById('ss-systems-search').addEventListener('input', e => renderSsSystemsList(e.target.value));
    document.getElementById('btn-ss-systems-cancel').addEventListener('click', () => closeModal('modal-ss-systems'));

    // ── MODAL: SETTINGS ──────────────────────────────────────────────────────
    document.getElementById('btn-test-ss').addEventListener('click', async () => {
        const btn      = document.getElementById('btn-test-ss');
        const statusEl = document.getElementById('settings-ss-status');
        const user = document.getElementById('settings-ss-user').value.trim();
        const pass = document.getElementById('settings-ss-pass').value.trim();
        btn.textContent = 'Testing…';
        btn.disabled = true;
        const result = await window.api.testSsCredentials(user, pass);
        btn.textContent = 'Test Credentials';
        btn.disabled = false;
        if (result.ok) {
            statusEl.textContent = `✓ Connected as ${result.username} — ${result.systemCount} systems available`;
            statusEl.style.color = 'var(--accent)';
        } else {
            statusEl.textContent = `✗ ${result.error}`;
            statusEl.style.color = '#ef5350';
        }
    });

    document.getElementById('btn-test-ra').addEventListener('click', async () => {
        const btn      = document.getElementById('btn-test-ra');
        const statusEl = document.getElementById('settings-ra-status');
        const user = document.getElementById('settings-ra-user').value.trim();
        const key  = document.getElementById('settings-ra-key').value.trim();
        btn.textContent = 'Testing…'; btn.disabled = true;
        const result = await window.api.testRaCredentials(user, key);
        btn.textContent = 'Test Credentials'; btn.disabled = false;
        if (result.ok) {
            statusEl.textContent = `✓ Connected as ${result.username}`;
            statusEl.style.color = 'var(--accent)';
        } else {
            statusEl.textContent = `✗ ${result.error}`;
            statusEl.style.color = '#ef5350';
        }
    });

    document.getElementById('btn-import-cngm-creds').addEventListener('click', async () => {
        const btn      = document.getElementById('btn-import-cngm-creds');
        const statusEl = document.getElementById('settings-cngm-import-status');
        btn.textContent = 'Importing…'; btn.disabled = true;
        const result = await window.api.importCngmCredentials();
        btn.textContent = 'Import from CNGM'; btn.disabled = false;
        statusEl.style.display = 'block';
        if (result.ok) {
            if (result.igdb_client_id)     document.getElementById('settings-igdb-client-id').value     = result.igdb_client_id;
            if (result.igdb_client_secret) document.getElementById('settings-igdb-client-secret').value = result.igdb_client_secret;
            if (result.sgdb_api_key)       document.getElementById('settings-sgdb-key').value           = result.sgdb_api_key;
            const imported = [
                result.igdb_client_id     ? 'IGDB' : null,
                result.sgdb_api_key       ? 'SteamGridDB' : null,
            ].filter(Boolean).join(', ');
            statusEl.textContent = `✓ Imported: ${imported}. Save to apply.`;
            statusEl.style.color = 'var(--accent)';
        } else {
            statusEl.textContent = `✗ ${result.error}`;
            statusEl.style.color = '#ef5350';
        }
    });

    document.getElementById('btn-test-igdb').addEventListener('click', async () => {
        const btn      = document.getElementById('btn-test-igdb');
        const statusEl = document.getElementById('settings-igdb-status');
        const id     = document.getElementById('settings-igdb-client-id').value.trim();
        const secret = document.getElementById('settings-igdb-client-secret').value.trim();
        btn.textContent = 'Testing…'; btn.disabled = true;
        const result = await window.api.testIgdbCredentials(id, secret);
        btn.textContent = 'Test Credentials'; btn.disabled = false;
        statusEl.textContent = result.ok ? '✓ IGDB credentials valid.' : `✗ ${result.error}`;
        statusEl.style.color  = result.ok ? 'var(--accent)' : '#ef5350';
    });

    document.getElementById('btn-test-tgdb').addEventListener('click', async () => {
        const btn      = document.getElementById('btn-test-tgdb');
        const statusEl = document.getElementById('settings-tgdb-status');
        const key = document.getElementById('settings-tgdb-key').value.trim();
        btn.textContent = 'Testing…'; btn.disabled = true;
        const result = await window.api.testTgdbKey(key);
        btn.textContent = 'Test Key'; btn.disabled = false;
        statusEl.textContent = result.ok ? '✓ TheGamesDB key valid.' : `✗ ${result.error}`;
        statusEl.style.color  = result.ok ? 'var(--accent)' : '#ef5350';
    });

    document.getElementById('btn-test-sgdb').addEventListener('click', async () => {
        const btn      = document.getElementById('btn-test-sgdb');
        const statusEl = document.getElementById('settings-sgdb-status');
        const key = document.getElementById('settings-sgdb-key').value.trim();
        btn.textContent = 'Testing…'; btn.disabled = true;
        const result = await window.api.testSgdbKey(key);
        btn.textContent = 'Test Key'; btn.disabled = false;
        statusEl.textContent = result.ok ? '✓ SteamGridDB key valid.' : `✗ ${result.error}`;
        statusEl.style.color  = result.ok ? 'var(--accent)' : '#ef5350';
    });

    document.getElementById('btn-test-moby').addEventListener('click', async () => {
        const btn      = document.getElementById('btn-test-moby');
        const statusEl = document.getElementById('settings-moby-status');
        const key = document.getElementById('settings-moby-key').value.trim();
        btn.textContent = 'Testing…'; btn.disabled = true;
        const result = await window.api.testMobyKey(key);
        btn.textContent = 'Test Key'; btn.disabled = false;
        statusEl.textContent = result.ok ? '✓ MobyGames key valid.' : `✗ ${result.error}`;
        statusEl.style.color  = result.ok ? 'var(--accent)' : '#ef5350';
    });

    // Achievements modal
    document.getElementById('btn-ach-modal-close').addEventListener('click', () =>
        document.getElementById('modal-achievements').classList.remove('active'));
    document.querySelectorAll('.ach-filter-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            _achFilter = btn.dataset.filter;
            document.querySelectorAll('.ach-filter-btn').forEach(b => b.classList.toggle('active', b === btn));
            _renderAchGrid();
        });
    });

    document.getElementById('btn-settings-cancel').addEventListener('click', () => closeModal('modal-settings'));
    document.getElementById('btn-settings-save').addEventListener('click', async () => {
        const zBtn = document.querySelector('.zoom-btn.active');
        const z = zBtn ? zBtn.dataset.val : '1.0';
        await window.api.setSetting('zoom', z);
        window.api.setZoom(parseFloat(z));
        await window.api.setSetting('ss_user',             document.getElementById('settings-ss-user').value.trim());
        await window.api.setSetting('ss_pass',             document.getElementById('settings-ss-pass').value.trim());
        await window.api.setSetting('ra_user',             document.getElementById('settings-ra-user').value.trim());
        await window.api.setSetting('ra_api_key',          document.getElementById('settings-ra-key').value.trim());
        await window.api.setSetting('igdb_client_id',      document.getElementById('settings-igdb-client-id').value.trim());
        await window.api.setSetting('igdb_client_secret',  document.getElementById('settings-igdb-client-secret').value.trim());
        await window.api.setSetting('tgdb_api_key',        document.getElementById('settings-tgdb-key').value.trim());
        await window.api.setSetting('sgdb_api_key',        document.getElementById('settings-sgdb-key').value.trim());
        await window.api.setSetting('moby_api_key',        document.getElementById('settings-moby-key').value.trim());
        closeModal('modal-settings');
    });
    document.getElementById('btn-settings-open-data-dir').addEventListener('click', async () => {
        const dir = await window.api.getConfigDir();
        window.api.openPath(dir);
    });

    // ── DATA: BACKUP / RESTORE ───────────────────────────────────────────────
    const runBackup = async (scope, label) => {
        const status = document.getElementById('backup-status');
        status.style.color = 'var(--text_dim)'; status.textContent = `Backing up ${label}… (this can take a moment)`;
        const r = await window.api.createBackup(scope);
        if (r.canceled) { status.textContent = ''; return; }
        status.style.color = r.ok ? 'var(--accent)' : '#ef5350';
        status.textContent = r.ok ? `✓ Saved backup${r.withSaves ? ' (incl. save states)' : ''}.` : (r.error || 'Backup failed.');
    };
    document.getElementById('btn-backup-emulatte').addEventListener('click', () => runBackup('emulatte', 'EmuLatte'));
    document.getElementById('btn-backup-suite').addEventListener('click', () => runBackup('suite', 'the CafeNeurotico Suite'));
    document.getElementById('btn-restore-backup').addEventListener('click', async () => {
        if (!await showConfirm('Restore from a backup ZIP?\nThis OVERWRITES your current library and settings, then restarts EmuLatte.', 'Restore', true, 'Restore Backup')) return;
        const status = document.getElementById('backup-status');
        status.style.color = 'var(--text_dim)'; status.textContent = 'Restoring…';
        const r = await window.api.restoreBackup();
        if (r.canceled) { status.textContent = ''; return; }
        if (r.ok) { status.style.color = 'var(--accent)'; status.textContent = `✓ Restored ${r.configFiles} files${r.saveFiles ? ` + ${r.saveFiles} saves` : ''}. Restarting…`; }
        else { status.style.color = '#ef5350'; status.textContent = r.error || 'Restore failed.'; }
    });

    // ── DATA: CLEAN UNUSED MEDIA ─────────────────────────────────────────────
    document.getElementById('btn-clean-media').addEventListener('click', async () => {
        const status = document.getElementById('clean-media-status');
        const btn = document.getElementById('btn-clean-media');
        btn.disabled = true; status.style.color = 'var(--text_dim)'; status.textContent = 'Scanning…';
        const scan = await window.api.cleanUnusedMedia(true);
        btn.disabled = false;
        if (!scan.ok) { status.textContent = scan.error || 'Scan failed.'; status.style.color = '#ef5350'; return; }
        if (!scan.count) { status.textContent = 'No orphaned files — your library is tidy. 🎉'; status.style.color = 'var(--accent)'; return; }
        const mb = (scan.bytes / 1048576).toFixed(1);
        status.textContent = '';
        if (!await showConfirm(`Found ${scan.count} unused file${scan.count !== 1 ? 's' : ''} (${mb} MB) not linked to any game.\nDelete them to free disk space?`, 'Delete', true, 'Clean Unused Media')) return;
        btn.disabled = true; status.style.color = 'var(--text_dim)'; status.textContent = 'Deleting…';
        const res = await window.api.cleanUnusedMedia(false);
        btn.disabled = false;
        status.style.color = 'var(--accent)';
        status.textContent = res.ok ? `Deleted ${res.count} file${res.count !== 1 ? 's' : ''}, freed ${(res.bytes / 1048576).toFixed(1)} MB.` : (res.error || 'Failed.');
    });

    // ── DATA: DUPLICATE FINDER ───────────────────────────────────────────────
    document.getElementById('btn-find-duplicates').addEventListener('click', openDuplicatesModal);
    document.getElementById('btn-duplicates-close').addEventListener('click', () => closeModal('modal-duplicates'));
    document.getElementById('btn-dup-remove').addEventListener('click', async () => {
        const ids = [...document.querySelectorAll('#dup-list .dup-cb:checked')].map(cb => Number(cb.dataset.id));
        if (!ids.length) { showAlert('Nothing selected to remove.', 'Remove Duplicates'); return; }
        if (!await showConfirm(`Remove ${ids.length} duplicate game${ids.length !== 1 ? 's' : ''} from the library?\nROM files will NOT be deleted.`, 'Remove', true, 'Remove Duplicates')) return;
        for (const id of ids) await window.api.deleteGame(id);
        await loadGames();
        closeModal('modal-duplicates');
        renderCurrentView();
        showLaunchToast(`Removed ${ids.length} duplicate${ids.length !== 1 ? 's' : ''}.`, null);
    });

    // ── MODAL: SCRAPER PICKER ────────────────────────────────────────────────
    document.getElementById('btn-scraper-picker-cancel').addEventListener('click', () => closeModal('modal-scraper-picker'));
    document.getElementById('btn-refine-scrape-cancel').addEventListener('click', () => closeModal('modal-refine-scrape'));
    document.getElementById('btn-refine-scrape-go').addEventListener('click', runRefineScrape);
    document.getElementById('refine-scrape-name').addEventListener('keydown', e => { if (e.key === 'Enter') runRefineScrape(); });

    async function runScraper(scraperFn, scraperLabel, refineMeta = false) {
        if (!currentGame) return;
        const statusEl = document.getElementById('scraper-picker-status');
        const btns = document.querySelectorAll('.scraper-pick-btn');
        btns.forEach(b => b.disabled = true);
        statusEl.textContent = `Scraping with ${scraperLabel}…`;
        statusEl.style.color = 'var(--text_dim)';
        const result = await scraperFn(currentGame.id);
        btns.forEach(b => b.disabled = false);
        if (result.ok) {
            closeModal('modal-scraper-picker');
            await loadGames();
            const updated = allGames.find(g => g.id === currentGame.id);
            if (updated) openGamePage(updated);
            showLaunchToast(`Scraped with ${scraperLabel}: ${result.updated?.join(', ') || 'done'}.`, null);
        } else if (refineMeta && result.notFound) {
            closeModal('modal-scraper-picker');                      // ScreenScraper found nothing → offer a name refine
            openRefineScrape(currentGame.id, true, result.error);
        } else {
            statusEl.textContent = `✗ ${result.error}`;
            statusEl.style.color = '#ef5350';
        }
    }

    async function _pickArt(scraper) {
        closeModal('modal-scraper-picker');
        _artPickerScraper = scraper;
        await _openArtPickerModal();
    }

    document.getElementById('btn-scrape-with-ss').addEventListener('click', async () => {
        if (_scraperPickerMode === 'art')   { await _pickArt('ss'); return; }
        if (_scraperPickerMode === 'batch') { closeModal('modal-scraper-picker'); scrapeAll(_scrapeAllSystemId); return; }
        if (_scraperPickerMode === 'meta')  { runScraper(id => window.api.scrapeGameMeta(id), 'ScreenScraper', true); return; }
        if (!currentGame) return;
        closeModal('modal-scraper-picker');
        scrapeGame(currentGame.id);
    });
    document.getElementById('btn-scrape-with-igdb').addEventListener('click', async () => {
        if (_scraperPickerMode === 'art')   { await _pickArt('igdb'); return; }
        if (_scraperPickerMode === 'batch') { closeModal('modal-scraper-picker'); scrapeAllWith(_scrapeAllSystemId, 'igdb'); return; }
        if (_scraperPickerMode === 'meta')  { runScraper(id => window.api.igdbScrapeGameMeta(id), 'IGDB'); return; }
        runScraper(id => window.api.igdbScrapeGame(id), 'IGDB');
    });
    document.getElementById('btn-scrape-with-tgdb').addEventListener('click', async () => {
        if (_scraperPickerMode === 'art')   { await _pickArt('tgdb'); return; }
        if (_scraperPickerMode === 'batch') { closeModal('modal-scraper-picker'); scrapeAllWith(_scrapeAllSystemId, 'tgdb'); return; }
        if (_scraperPickerMode === 'meta')  { runScraper(id => window.api.tgdbScrapeGameMeta(id), 'TheGamesDB'); return; }
        runScraper(id => window.api.tgdbScrapeGame(id), 'TheGamesDB');
    });
    document.getElementById('btn-scrape-with-sgdb').addEventListener('click', async () => {
        if (_scraperPickerMode === 'art')   { await _pickArt('sgdb'); return; }
        if (_scraperPickerMode === 'batch') { closeModal('modal-scraper-picker'); scrapeAllWith(_scrapeAllSystemId, 'sgdb'); return; }
        if (_scraperPickerMode === 'meta')  {
            const statusEl = document.getElementById('scraper-picker-status');
            statusEl.textContent = 'SteamGridDB provides artwork only — no text metadata.';
            statusEl.style.color = 'var(--text_dim)';
            return;
        }
        runScraper(id => window.api.sgdbScrapeGame(id), 'SteamGridDB');
    });
    document.getElementById('btn-scrape-with-moby').addEventListener('click', async () => {
        if (_scraperPickerMode === 'art')   { await _pickArt('moby'); return; }
        if (_scraperPickerMode === 'batch') { closeModal('modal-scraper-picker'); scrapeAllWith(_scrapeAllSystemId, 'moby'); return; }
        if (_scraperPickerMode === 'meta')  { runScraper(id => window.api.mobyScrapeGameMeta(id), 'MobyGames'); return; }
        runScraper(id => window.api.mobyScrapeGame(id), 'MobyGames');
    });

    // ── MODAL: ADD EMULATOR ──────────────────────────────────────────────────
    let emulatorChosen = null;
    let allEmulators   = [];

    function renderEmulatorList(query = '') {
        const list  = document.getElementById('emulator-list');
        const empty = document.getElementById('emulator-empty');
        const q = query.toLowerCase();
        const filtered = allEmulators.filter(e =>
            !q || e.name.toLowerCase().includes(q) || e.exec.toLowerCase().includes(q)
        );
        list.innerHTML = '';
        if (!filtered.length) { empty.style.display = ''; return; }
        empty.style.display = 'none';
        filtered.forEach(em => {
            const row = document.createElement('div');
            row.style.cssText = 'display:flex; flex-direction:column; gap:2px; padding:10px 12px; border-radius:6px; border:1px solid var(--border_solid); cursor:pointer; background:rgba(0,0,0,0.2);';
            row.innerHTML = `<span style="font-weight:700; font-size:13px;">${em.name}</span>
                             <span style="font-size:11px; color:var(--text_dim); font-family:monospace;">${em.exec}</span>
                             ${em.comment ? `<span style="font-size:11px; color:var(--text_dim);">${em.comment}</span>` : ''}`;
            row.addEventListener('mouseenter', () => row.style.background = 'rgba(255,255,255,0.06)');
            row.addEventListener('mouseleave', () => row.style.background = 'rgba(0,0,0,0.2)');
            row.addEventListener('click', () => {
                emulatorChosen = em;
                document.getElementById('emulator-chosen-name').textContent = em.name;
                document.getElementById('emulator-chosen-exec').textContent = em.exec;
                const sel = document.getElementById('emulator-system-select');
                sel.innerHTML = allSystems.map(s => `<option value="${s.id}">${s.name}</option>`).join('');
                showEmulatorStep(2);
            });
            list.appendChild(row);
        });
    }

    document.getElementById('btn-add-emulator').addEventListener('click', async () => {
        closeModal('modal-settings');
        showEmulatorStep(1);
        document.getElementById('emulator-search').value = '';
        document.getElementById('emulator-list').innerHTML = '<div style="color:var(--text_dim); font-size:12px; padding:20px 0; text-align:center;">Scanning…</div>';
        document.getElementById('emulator-empty').style.display = 'none';
        openModal('modal-add-emulator');
        allEmulators = await window.api.scanEmulators();
        renderEmulatorList();
    });

    document.getElementById('emulator-search').addEventListener('input', e => renderEmulatorList(e.target.value));

    function showEmulatorStep(step) {
        document.getElementById('add-emulator-step1').style.display  = step === 1 ? ''     : 'none';
        document.getElementById('add-emulator-custom').style.display  = step === 'c' ? 'flex' : 'none';
        document.getElementById('add-emulator-step2').style.display  = step === 2 ? 'flex' : 'none';
    }

    document.getElementById('btn-emulator-back').addEventListener('click', () => showEmulatorStep(1));

    document.getElementById('btn-emulator-custom').addEventListener('click', () => {
        document.getElementById('custom-emulator-name').value = '';
        document.getElementById('custom-emulator-exec').value = '';
        showEmulatorStep('c');
    });

    document.getElementById('btn-custom-emulator-browse').addEventListener('click', async () => {
        const file = await window.api.selectFile([{ name: 'All Files', extensions: ['*'] }]);
        if (file) document.getElementById('custom-emulator-exec').value = file;
    });

    document.getElementById('btn-custom-emulator-continue').addEventListener('click', () => {
        const name = document.getElementById('custom-emulator-name').value.trim();
        const exec = document.getElementById('custom-emulator-exec').value.trim();
        if (!name || !exec) return;
        emulatorChosen = { name, exec, icon: '', comment: 'Custom' };
        document.getElementById('emulator-chosen-name').textContent = name;
        document.getElementById('emulator-chosen-exec').textContent = exec;
        const sel = document.getElementById('emulator-system-select');
        sel.innerHTML = allSystems.map(s => `<option value="${s.id}">${s.name}</option>`).join('');
        showEmulatorStep(2);
    });

    document.getElementById('btn-custom-emulator-back').addEventListener('click', () => showEmulatorStep(1));

    document.getElementById('btn-emulator-assign').addEventListener('click', async () => {
        if (!emulatorChosen) return;
        const sysId = parseInt(document.getElementById('emulator-system-select').value);
        await window.api.updateSystem(sysId, {
            launch_template:  '{emulator} {rom}',
            default_emulator: emulatorChosen.exec,
        });
        await loadSystems();
        closeModal('modal-add-emulator');
        showLaunchToast(`${emulatorChosen.name} assigned to system.`);
    });

    document.getElementById('btn-emulator-new-system').addEventListener('click', () => {
        closeModal('modal-add-emulator');
        openEditSystemModal(null);
        document.getElementById('edit-system-name').value     = emulatorChosen.name;
        document.getElementById('edit-system-emulator').value = emulatorChosen.exec;
        document.getElementById('edit-system-template').value = '{emulator} {rom}';
    });

    document.getElementById('btn-add-emulator-cancel').addEventListener('click', () => closeModal('modal-add-emulator'));

    // ── MODAL: SLIDESHOW ─────────────────────────────────────────────────────
    document.getElementById('modal-slideshow').addEventListener('click', e => {
        if (!e.target.closest('.crt-screen') && !e.target.closest('.slide-nav') && !e.target.closest('#slide-close')) closeModal('modal-slideshow');
    });
    document.getElementById('slide-prev').addEventListener('click', e => {
        e.stopPropagation();
        slideshowIndex = (slideshowIndex - 1 + slideshowUrls.length) % slideshowUrls.length;
        showSlide();
    });
    document.getElementById('slide-next').addEventListener('click', e => {
        e.stopPropagation();
        slideshowIndex = (slideshowIndex + 1) % slideshowUrls.length;
        showSlide();
    });
    document.getElementById('slide-close').addEventListener('click', e => {
        e.stopPropagation();
        closeModal('modal-slideshow');
    });

    // Systems close
    document.getElementById('btn-systems-close').addEventListener('click', () => closeModal('modal-systems'));

    // ── MODAL: THEMES ────────────────────────────────────────────────────────
    document.getElementById('btn-theme-switch').addEventListener('click', () => {
        renderThemeCategories();
        openModal('modal-themes');
    });
    document.getElementById('btn-close-themes').addEventListener('click', () => closeModal('modal-themes'));
    document.getElementById('btn-theme-back').addEventListener('click', () => {
        closeModal('modal-themes');
        openModal('modal-settings');
    });

    // ── ZOOM SEG BUTTONS ─────────────────────────────────────────────────────
    document.querySelectorAll('.zoom-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.zoom-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            window.api.setZoom(parseFloat(btn.dataset.val));
        });
    });

    // ── SETTINGS SEARCH ──────────────────────────────────────────────────────
    document.getElementById('settings-search').addEventListener('input', e => {
        const q = e.target.value.trim().toLowerCase();
        document.getElementById('settings-content').classList.toggle('searching', !!q);   // show every pane while searching
        document.querySelectorAll('#modal-settings .tool-card').forEach(card => {
            const haystack = (card.dataset.search || '') + ' ' + (card.textContent || '');
            card.style.display = !q || haystack.toLowerCase().includes(q) ? '' : 'none';
        });
    });

    // Settings hub: category rail switches panes
    document.querySelectorAll('#settings-rail .cp-rail-item').forEach(item => {
        item.addEventListener('click', () => {
            const pane = item.dataset.pane;
            if (pane === 'express') renderExpressSettings();   // load fresh + render the chips on entry
            document.querySelectorAll('#settings-rail .cp-rail-item').forEach(b => b.classList.toggle('active', b === item));
            document.querySelectorAll('#modal-settings .cp-pane').forEach(p => p.classList.toggle('active', p.dataset.pane === pane));
            document.getElementById('settings-content').scrollTop = 0;
        });
    });
    // Manage Systems reachable from the hub (close Settings first so two blurred modals don't stack)
    document.getElementById('btn-settings-manage-systems').addEventListener('click', () => { closeModal('modal-settings'); openSystemsModal(); });

    // Keyboard
    document.addEventListener('keydown', e => {
        if (e.key === 'Escape') {
            const open = document.querySelector('.modal-overlay.active');
            if (open) { open.classList.remove('active'); return; }
            if (currentView === 'view-gamepage') { switchView('view-gallery'); renderGallery(getFilteredGames()); }
        }
        if (e.key === 'ArrowLeft'  && document.getElementById('modal-slideshow').classList.contains('active')) {
            slideshowIndex = (slideshowIndex - 1 + slideshowUrls.length) % slideshowUrls.length;
            showSlide();
        }
        if (e.key === 'ArrowRight' && document.getElementById('modal-slideshow').classList.contains('active')) {
            slideshowIndex = (slideshowIndex + 1) % slideshowUrls.length;
            showSlide();
        }
    });
}

// ── ARTWORK BROWSE HELPER ─────────────────────────────────────────────────────
async function browseArt(type) {
    const id = Number(document.getElementById('edit-game-id').value);
    const dest = await window.api.selectLocalImage(id, type);
    if (!dest) return;
    const previewId = { cover: 'edit-cover-preview', hero: 'edit-hero-preview', logo: 'edit-logo-preview', screenshot: 'edit-screenshot-preview' }[type];
    if (previewId) document.getElementById(previewId).src = dest;
    await window.api.updateGame(id, { [type]: dest });
    const g = allGames.find(g => g.id === id);
    if (g) g[type] = dest;
}

// ── ART PICKER ────────────────────────────────────────────────────────────────
let _artPickerType          = 'cover';
let _artPickerScraper       = 'sgdb';
let _scraperPickerMode      = 'full'; // 'full' | 'art' | 'batch'
let _scrapeAllSystemId      = null;
let _artPickerSystemShort   = '';

const _artPreviewId   = { cover: 'edit-cover-preview', hero: 'edit-hero-preview', logo: 'edit-logo-preview', screenshot: 'edit-screenshot-preview' };
const _artPickerCols  = { cover: 3, hero: 2, logo: 3, screenshot: 2 };
const _artIsContain   = { logo: true, screenshot: false, cover: false, hero: false };
const _scraperLabels  = { ss: 'ScreenScraper', igdb: 'IGDB', tgdb: 'TheGamesDB', sgdb: 'SteamGridDB', moby: 'MobyGames' };
const _artTypeLabels  = { cover: 'Cover Art', hero: 'Hero Art', logo: 'Logo', screenshot: 'Screenshot' };

function openArtPicker(type) {
    _artPickerType    = type;
    _scraperPickerMode = 'art';
    document.getElementById('scraper-picker-status').textContent = '';
    openModal('modal-scraper-picker');
}

async function _openArtPickerModal() {
    const gameId    = Number(document.getElementById('edit-game-id').value);
    const gameTitle = document.getElementById('edit-title').value.trim() || 'Unknown';
    const romPath   = document.getElementById('edit-rom-path').value.trim();
    const romFile   = romPath.split(/[\\/]/).pop() || gameTitle;
    const sysId     = Number(document.getElementById('edit-system').value);
    const sys       = allSystems.find(s => s.id === sysId);
    _artPickerSystemShort = sys?.short_name || '';

    document.getElementById('art-picker-title').textContent =
        `${_artTypeLabels[_artPickerType]} — ${_scraperLabels[_artPickerScraper]}`;
    document.getElementById('art-picker-search').value =
        _artPickerScraper === 'ss' ? romFile : gameTitle;
    document.getElementById('art-picker-grid').innerHTML = '';
    document.getElementById('art-picker-grid').style.gridTemplateColumns =
        `repeat(${_artPickerCols[_artPickerType] || 3}, 1fr)`;
    document.getElementById('art-picker-status').textContent = '';
    openModal('modal-art-picker');

    const query = document.getElementById('art-picker-search').value;
    await _artPickerSearch(query, gameId);
}

async function _artPickerSearch(query, gameId) {
    const stat       = document.getElementById('art-picker-status');
    const grid       = document.getElementById('art-picker-grid');
    const capturedId = gameId ?? Number(document.getElementById('edit-game-id').value);
    grid.innerHTML   = '';
    stat.textContent = `Searching ${_scraperLabels[_artPickerScraper]} for "${query}"…`;
    stat.style.color = 'var(--text_dim)';

    let result;
    switch (_artPickerScraper) {
        case 'sgdb': result = await window.api.sgdbSearchArt(query, _artPickerType); break;
        case 'tgdb': result = await window.api.tgdbSearchArt(query, _artPickerType, _artPickerSystemShort); break;
        case 'igdb': result = await window.api.igdbSearchArt(query, _artPickerType, _artPickerSystemShort); break;
        case 'ss':   result = await window.api.ssSearchArt(capturedId, _artPickerType); break;
        case 'moby': result = await window.api.mobySearchArt(query, _artPickerType, _artPickerSystemShort); break;
        default:     result = { ok: false, error: 'Unknown scraper.' };
    }

    if (!result.ok) {
        stat.textContent = `✗ ${result.error}`;
        stat.style.color = '#ef5350';
        return;
    }
    if (!result.results.length) {
        stat.textContent = 'No results found. Try a different search.';
        return;
    }
    stat.textContent = `${result.results.length} result${result.results.length !== 1 ? 's' : ''} — click to apply.`;

    for (const item of result.results) {
        const wrap = document.createElement('div');
        wrap.style.cssText = 'position:relative; border-radius:6px; overflow:hidden; cursor:pointer; border:2px solid transparent; transition:border 0.15s;';

        const img = document.createElement('img');
        // ScreenScraper thumbs carry no credentials in item.thumb; load them through the ssimg://
        // proxy so the main process adds the user's account out of view of the DOM. Other sources
        // return ready-to-load URLs.
        img.src = _artPickerScraper === 'ss'
            ? `ssimg://thumb/?u=${encodeURIComponent(item.thumb)}`
            : item.thumb;
        img.style.cssText = 'width:100%; display:block; border-radius:4px; transition:transform 0.15s; object-fit:'
            + (_artIsContain[_artPickerType] ? 'contain; background:rgba(0,0,0,0.4); padding:8px;' : 'cover;');

        wrap.addEventListener('mouseover', () => { if (!wrap.dataset.saved) { wrap.style.borderColor = 'var(--accent)'; img.style.transform = 'scale(1.04)'; } });
        wrap.addEventListener('mouseout',  () => { if (!wrap.dataset.saved) { wrap.style.borderColor = 'transparent'; img.style.transform = 'scale(1)'; } });

        wrap.addEventListener('click', async () => {
            if (wrap.dataset.saved) return;
            stat.textContent = 'Downloading…';
            stat.style.color = 'var(--text_dim)';
            grid.style.opacity = '0.5'; grid.style.pointerEvents = 'none';
            const r = await window.api.sgdbApplyArt(capturedId, item.url, _artPickerType);
            grid.style.opacity = '1'; grid.style.pointerEvents = '';
            if (r.ok) {
                if (_artPickerType === 'screenshot') {
                    wrap.dataset.saved = '1';
                    wrap.style.borderColor = '#66bb6a';
                    img.style.transform = 'scale(1)';
                    const check = document.createElement('div');
                    check.textContent = '✓';
                    check.style.cssText = 'position:absolute; top:6px; right:8px; color:#66bb6a; font-size:20px; font-weight:900; text-shadow:0 1px 4px #000; pointer-events:none;';
                    wrap.appendChild(check);
                    stat.style.color = '#66bb6a';
                    stat.textContent = 'Added! Click more screenshots to keep adding.';
                    const g = allGames.find(x => x.id === capturedId);
                    const hadScreenshot = !!g?.screenshot;
                    if (g) g.screenshot = hadScreenshot ? `${g.screenshot}|${r.path}` : r.path;
                    const prev = document.getElementById(_artPreviewId[_artPickerType]);
                    if (prev && !hadScreenshot) prev.src = r.path;
                } else {
                    const prev = document.getElementById(_artPreviewId[_artPickerType]);
                    if (prev) prev.src = r.path;
                    const g = allGames.find(x => x.id === capturedId);
                    if (g) g[_artPickerType] = r.path;
                    document.getElementById('modal-art-picker').classList.remove('active');
                }
            } else {
                stat.textContent = `✗ ${r.error || 'Download failed.'}`;
                stat.style.color = '#ef5350';
            }
        });

        wrap.appendChild(img);
        grid.appendChild(wrap);
    }
}

// ── TRAILER HELPERS ───────────────────────────────────────────────────────────
function openTrailerProgress(title, videoId) {
    document.getElementById('modal-trailer-progress').classList.add('active');
    document.getElementById('dl-progress-game').textContent = title;
    document.getElementById('dl-progress-fill').style.width = '0%';
    document.getElementById('dl-progress-text').textContent = '0%';
    window.api.downloadTrailer(title, videoId).then(success => {
        document.getElementById('modal-trailer-progress').classList.remove('active');
        if (success) {
            showLaunchToast('Trailer downloaded!', null);
            if (currentGame?.title === title) {
                const btn = document.getElementById('btn-gamepage-trailer');
                window.api.checkLocalTrailer(title).then(url => {
                    if (!url) return;
                    btn.style.display = 'flex';
                    btn.onclick = () => {
                        document.getElementById('modal-trailer-player').classList.add('active');
                        const vid = document.getElementById('detail-video-player');
                        vid.src = url; vid.play();
                    };
                });
            }
        } else {
            showLaunchToast('Download failed.', null);
        }
    });
}

// ── SCREENSCRAPER ─────────────────────────────────────────────────────────────

async function scrapeGame(gameId) {
    const btn = document.getElementById('btn-gamepage-scrape');
    if (btn) btn.classList.add('working');
    const result = await window.api.scrapeGame(gameId);
    if (btn) btn.classList.remove('working');
    if (!result.ok) {
        if (result.notFound) openRefineScrape(gameId, false, result.error);   // let the user retry with a different name
        else showLaunchToast(result.error || 'Scrape failed', null);
        return;
    }
    await loadGames();
    const updated = allGames.find(g => g.id === gameId);
    if (updated && currentGame?.id === gameId) openGamePage(updated);
    if (result.session) updateRateInfo(result.session);
}

// ── REFINE SCREENSCRAPER SEARCH BY NAME (on not-found) ────────────────────────
let _refineGameId = null, _refineMeta = false;
function openRefineScrape(gameId, metaOnly, why) {
    _refineGameId = gameId; _refineMeta = !!metaOnly;
    const game = allGames.find(g => g.id === gameId);
    const guess = game ? (game.title || (game.rom_path || '').split('/').pop().replace(/\.[^.]+$/, '')) : '';
    document.getElementById('refine-scrape-sub').textContent = why || `Couldn’t find this game on ScreenScraper. Try a different name:`;
    const inp = document.getElementById('refine-scrape-name'); inp.value = guess;
    document.getElementById('refine-scrape-status').textContent = '';
    openModal('modal-refine-scrape');
    setTimeout(() => { inp.focus(); inp.select(); }, 50);
}
async function runRefineScrape() {
    const name = document.getElementById('refine-scrape-name').value.trim();
    if (!name) return;
    const status = document.getElementById('refine-scrape-status');
    const btn = document.getElementById('btn-refine-scrape-go');
    btn.disabled = true; status.style.color = 'var(--text_dim)'; status.textContent = 'Searching ScreenScraper…';
    const result = await window.api.scrapeGame(_refineGameId, _refineMeta, name);
    btn.disabled = false;
    if (result.ok) {
        closeModal('modal-refine-scrape');
        await loadGames();
        const updated = allGames.find(g => g.id === _refineGameId);
        if (updated && currentGame?.id === _refineGameId) openGamePage(updated);
        if (result.session) updateRateInfo(result.session);
        showLaunchToast(`Found & scraped “${name}”.`, null);
    } else {
        status.style.color = '#ef5350';
        status.textContent = result.error || 'Still not found. Try another name.';
    }
}

// ── ADD TO PLAYLIST (shared by the game page + gallery cards) ─────────────────
let _plPickerGameId = null;
async function openPlaylistPicker(gameId) {
    _plPickerGameId = gameId;
    document.getElementById('playlist-picker-new').value = '';
    await renderPlaylistPicker();
    openModal('modal-add-to-playlist');
}
async function renderPlaylistPicker() {
    const gameId = _plPickerGameId;
    const list = document.getElementById('playlist-picker-list');
    if (!allPlaylists.length) {
        list.innerHTML = `<div style="text-align:center; padding:20px; color:var(--text_dim);">No playlists yet — create one below.</div>`;
        return;
    }
    const inIds = await window.api.getGamePlaylists(gameId);
    list.innerHTML = allPlaylists.map(p => {
        const inList = inIds.includes(p.id);
        return `<div style="display:flex; justify-content:space-between; align-items:center; padding:8px 12px; border-radius:6px; background:rgba(0,0,0,0.2); border:1px solid var(--border);">
            <span style="color:var(--text_sec); font-size:13px;">${escHtml(p.name)}</span>
            <button class="btn-pl-toggle" data-playlist-id="${p.id}" data-in="${inList ? '1' : '0'}"
                style="font-size:11px; padding:4px 14px; ${inList ? 'background:var(--accent); border-color:var(--accent); color:var(--bg);' : ''}">${inList ? '✓ Added' : '+ Add'}</button>
        </div>`;
    }).join('');
    list.querySelectorAll('.btn-pl-toggle').forEach(btn => {
        btn.addEventListener('click', async () => {
            const plId = Number(btn.dataset.playlistId);
            const inList = btn.dataset.in === '1';
            if (inList) {
                await window.api.removeGameFromPlaylist(plId, gameId);
                btn.dataset.in = '0'; btn.textContent = '+ Add'; btn.style.cssText = 'font-size:11px; padding:4px 14px;';
            } else {
                await window.api.addGameToPlaylist(plId, gameId);
                btn.dataset.in = '1'; btn.textContent = '✓ Added'; btn.style.cssText = 'font-size:11px; padding:4px 14px; background:var(--accent); border-color:var(--accent); color:var(--bg);';
            }
            if (typeof currentFilter === 'string' && currentFilter.startsWith('playlist:'))
                currentPlaylistGames = await window.api.getPlaylistGames(Number(currentFilter.split(':')[1]));
        });
    });
}

// ── DUPLICATE FINDER ──────────────────────────────────────────────────────────
const _normDupTitle  = t => (t || '').toLowerCase().replace(/\([^)]*\)|\[[^\]]*\]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
const _completeness  = g => ['cover', 'hero', 'logo', 'screenshot', 'description', 'year', 'developer'].reduce((n, k) => n + (g[k] ? 1 : 0), 0);
function findDuplicateGroups() {
    const map = new Map();
    for (const g of allGames) {
        const norm = _normDupTitle(g.title); if (!norm) continue;
        const key = norm + '::' + g.system_id;                  // same title on the same system = a duplicate set
        (map.get(key) || map.set(key, []).get(key)).push(g);
    }
    const groups = [];
    for (const arr of map.values()) {
        if (arr.length < 2) continue;
        arr.sort((a, b) => _completeness(b) - _completeness(a) || (a.id - b.id));   // most-complete first (kept), then oldest
        groups.push(arr);
    }
    return groups.sort((a, b) => (a[0].title || '').localeCompare(b[0].title || ''));
}
function openDuplicatesModal() {
    const groups = findDuplicateGroups();
    const body = document.getElementById('dup-list');
    const removeBtn = document.getElementById('btn-dup-remove');
    if (!groups.length) {
        body.innerHTML = `<div style="text-align:center; padding:30px; color:var(--text_dim);">No duplicate games found. 🎉</div>`;
        removeBtn.style.display = 'none';
    } else {
        removeBtn.style.display = '';
        body.innerHTML = groups.map(grp => {
            const sys = grp[0].system_name || grp[0].system_short || '';
            const rows = grp.map((g, i) => {
                const keep = i === 0;
                const meta = `${escHtml(sys)}${g.year ? ' · ' + escHtml(g.year) : ''} · ${g.cover ? 'has art' : 'no art'}${keep ? ' · <b style="color:var(--accent)">keep</b>' : ''}`;
                return `<label class="dup-row">
                    <input type="checkbox" class="dup-cb" data-id="${g.id}" ${keep ? '' : 'checked'}>
                    <span class="dup-title">${escHtml(g.title)}</span>
                    <span class="dup-meta">${meta}</span>
                </label>`;
            }).join('');
            return `<div class="dup-group"><div class="dup-group-title">${escHtml(grp[0].title)} <span style="color:var(--text_dim); font-weight:400;">— ${grp.length} copies</span></div>${rows}</div>`;
        }).join('');
    }
    openModal('modal-duplicates');
}

// ── UNIFIED SCRAPE QUEUE ──────────────────────────────────────────────────────
// Every "Scrape All" (any system, any source) feeds one renderer-side worker that
// scrapes a game at a time via the per-game IPC. Queuing more while it runs just
// appends and grows the count, so concurrent requests share a single pill.
let scrapeQueue     = [];                                // [{ id, scraperFn, isSS }]
let scrapeRunning   = false;
let scrapeCancelled = false;
let scrapeStats     = { done: 0, failed: 0, total: 0 };  // aggregate for the whole run

function scraperFnFor(source) {
    switch (source) {
        case 'igdb': return id => window.api.igdbScrapeGame(id);
        case 'tgdb': return id => window.api.tgdbScrapeGame(id);
        case 'moby': return id => window.api.mobyScrapeGame(id);
        case 'sgdb': return id => window.api.sgdbScrapeGame(id);
        default:     return id => window.api.scrapeGame(id);   // 'ss'
    }
}

function updateScrapeCount() {
    const { done, total } = scrapeStats;
    const cur = Math.min(done + (scrapeRunning ? 1 : 0), total);
    document.getElementById('scrape-panel-count').textContent = `${cur} / ${total}`;
    document.getElementById('scrape-progress-bar').style.width = `${total ? Math.round((done / total) * 100) : 0}%`;
}

function enqueueScrape(systemId, source) {
    const games = systemId
        ? allGames.filter(g => g.system_id === Number(systemId))
        : allGames;
    if (!games.length) { showLaunchToast('No ROMs to scrape in this system.', null); return; }

    const fn   = scraperFnFor(source);
    const isSS = !['igdb', 'tgdb', 'moby', 'sgdb'].includes(source);
    for (const g of games) scrapeQueue.push({ id: g.id, scraperFn: fn, isSS });
    scrapeStats.total += games.length;

    if (scrapeRunning) updateScrapeCount();   // already running → reflect the bigger total
    else runScrapeWorker();
}

async function runScrapeWorker() {
    scrapeRunning   = true;
    scrapeCancelled = false;
    showScrapePanel(true);

    while (scrapeQueue.length && !scrapeCancelled) {
        const item = scrapeQueue.shift();
        const g    = allGames.find(x => x.id === item.id);
        document.getElementById('scrape-panel-title').textContent = g?.title || g?.rom_path?.split('/').pop() || '';
        updateScrapeCount();

        const result = await item.scraperFn(item.id);
        if (!result?.ok) scrapeStats.failed++;
        else if (result.session) updateRateInfo(result.session);
        scrapeStats.done++;
        updateScrapeCount();

        // Courtesy delay between ScreenScraper requests (rate limits)
        if (item.isSS && scrapeQueue.length && !scrapeCancelled) await new Promise(r => setTimeout(r, 1500));
    }

    const { done, failed } = scrapeStats;
    const cancelled = scrapeCancelled;
    scrapeQueue   = [];
    scrapeStats   = { done: 0, failed: 0, total: 0 };
    scrapeRunning = false;
    showScrapePanel(false);

    await loadGames();
    if (currentGame) {
        const updated = allGames.find(g => g.id === currentGame.id);
        if (updated) openGamePage(updated);
    }

    const verb = cancelled ? 'Stopped' : 'Done';
    const msg  = failed
        ? `${verb}. ${done - failed} scraped, ${failed} failed.`
        : `${verb}. ${done} ROM${done !== 1 ? 's' : ''} scraped.`;
    showLaunchToast(msg, null);
}

// Entry points used by the scraper-picker batch buttons.
function scrapeAll(systemId)          { enqueueScrape(systemId, 'ss'); }
function scrapeAllWith(systemId, src) { enqueueScrape(systemId, src); }

function wireScrapeProgress() {
    document.getElementById('btn-scrape-cancel').addEventListener('click', () => {
        if (!scrapeRunning) { showScrapePanel(false); return; }
        scrapeCancelled = true;
        scrapeQueue = [];   // drop everything still queued; the in-flight game finishes
        document.getElementById('scrape-panel-title').textContent = 'Stopping…';
    });
}

function showScrapePanel(visible) {
    document.getElementById('scrape-panel').style.display = visible ? 'block' : 'none';
    if (!visible) {
        document.getElementById('scrape-progress-bar').style.width = '0%';
        document.getElementById('scrape-panel-title').textContent  = '';
        document.getElementById('scrape-panel-count').textContent  = '';
    }
}

function updateRateInfo(session) {
    if (!session?.requestsToday || !session?.requestsLimit) return;
    const el = document.getElementById('scrape-rate-info');
    if (el) el.textContent = `${session.requestsToday} / ${session.requestsLimit} today`;
}

// ── SS SYSTEM BROWSER ─────────────────────────────────────────────────────────
function renderSsSystemsList(query) {
    const list = document.getElementById('ss-systems-list');
    const q = query.trim().toLowerCase();
    const filtered = q
        ? ssSystems.filter(s => s.name.toLowerCase().includes(q) || String(s.id).includes(q))
        : ssSystems;
    if (!filtered.length) {
        list.innerHTML = `<div style="text-align:center; padding:20px; color:var(--text_dim);">No systems found.</div>`;
        return;
    }
    list.innerHTML = filtered.map(s =>
        `<div class="ss-system-item" data-id="${s.id}"
            style="display:flex; justify-content:space-between; align-items:center; padding:8px 12px; border-radius:6px; background:rgba(0,0,0,0.2); border:1px solid var(--border); cursor:pointer; transition:background 0.15s, border-color 0.15s;">
            <span style="color:var(--text_sec); font-size:13px;">${escHtml(s.name)}</span>
            <span style="color:var(--text_dim); font-size:11px; font-weight:900; margin-left:10px; flex-shrink:0;">#${s.id}</span>
        </div>`
    ).join('');
    list.querySelectorAll('.ss-system-item').forEach(el => {
        el.addEventListener('mouseenter', () => { el.style.background = 'rgba(212,163,115,0.12)'; el.style.borderColor = 'var(--border_solid)'; });
        el.addEventListener('mouseleave', () => { el.style.background = 'rgba(0,0,0,0.2)';       el.style.borderColor = 'var(--border)'; });
        el.addEventListener('click', () => {
            document.getElementById('edit-system-ssid').value = el.dataset.id;
            closeModal('modal-ss-systems');
        });
    });
}

// ── UTILITIES ─────────────────────────────────────────────────────────────────
function escHtml(str) {
    if (!str) return '';
    return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
