const { app, BrowserWindow, ipcMain, dialog, shell, protocol } = require('electron');
app.setName('emulatte');

// ssimg:// proxies ScreenScraper thumbnails through the main process so the user's ssid/sspassword
// never reach the renderer/DOM (only a credential-free base URL is passed). Must be registered
// before app 'ready'. The handler that adds credentials and fetches is installed in whenReady().
protocol.registerSchemesAsPrivileged([
    { scheme: 'ssimg', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
]);
const path = require('path');
const fs = require('fs');
const os = require('os');
const https = require('https');
const zlib = require('zlib');
const Database = require('better-sqlite3');
const { spawn, spawnSync, execFile } = require('child_process');
const crypto = require('crypto');
const AdmZip = require('adm-zip');

let baseDir;
if (process.env.APPIMAGE) {
    baseDir = path.dirname(process.env.APPIMAGE);
} else if (app.isPackaged) {
    baseDir = path.dirname(process.execPath);
} else {
    baseDir = __dirname;
}

const configDir    = path.join(baseDir, 'GameManagerConfig', 'EmuLatte');
const imagesDir    = path.join(configDir, 'images');
const trailersDir  = path.join(configDir, 'videos');
const dbPath       = path.join(configDir, 'emulatte.db');

const baseAssetPath  = app.isPackaged ? process.resourcesPath : __dirname;
const binDir         = path.join(baseAssetPath, 'assets', 'bin', 'linux');
const ytDlpPath      = path.join(binDir, 'yt-dlp');
const ffmpegPath     = path.join(binDir, 'ffmpeg');
const ytDlpConfigPath = path.join(binDir, 'yt-dlp.conf');

let db;

function getSavedBounds() {
    try {
        const raw = db.prepare("SELECT value FROM settings WHERE key='window_bounds'").get()?.value;
        if (raw) return JSON.parse(raw);
    } catch(e) {}
    return null;
}

function createWindow() {
    const saved = getSavedBounds();
    const win = new BrowserWindow({
        width:  saved?.width  || 1400,
        height: saved?.height || 950,
        x: saved?.x,
        y: saved?.y,
        frame: false,
        show: false,
        backgroundColor: '#2C1E16',
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
            webSecurity: false
        }
    });
    win.setMenu(null);
    win.loadFile('index.html');

    win.on('close', () => {
        if (!win.isMaximized() && !win.isMinimized() && !win.isFullScreen()) {   // don't persist couch-mode fullscreen bounds
            const b = win.getBounds();
            db.prepare("INSERT OR REPLACE INTO settings (key,value) VALUES ('window_bounds',?)").run(JSON.stringify(b));
        }
    });

    const showWin = () => { if (!win.isVisible()) win.show(); };
    ipcMain.once('renderer-ready', showWin);
    win.once('ready-to-show', () => setTimeout(showWin, 3000));
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
    app.quit();
} else {
    app.on('second-instance', () => {
        const w = BrowserWindow.getAllWindows()[0];
        if (w) { if (w.isMinimized()) w.restore(); w.focus(); }
    });
}

app.whenReady().then(() => {
    // Serve ScreenScraper thumbnails: the renderer passes only the credential-free base URL as
    // ?u=<encoded>; we add the user's credentials here (where they already live) and stream the
    // image back, so the password never appears in the DOM, a GET query string, or the HTTP cache.
    protocol.handle('ssimg', async (request) => {
        try {
            const base = new URL(request.url).searchParams.get('u');
            if (!base) return new Response('bad request', { status: 400 });
            const ssUser = db?.prepare('SELECT value FROM settings WHERE key=?').get('ss_user')?.value;
            const ssPass = db?.prepare('SELECT value FROM settings WHERE key=?').get('ss_pass')?.value;
            if (!ssUser || !ssPass) return new Response('no credentials', { status: 401 });
            const res = await fetch(ssMediaUrl(base, ssUser, ssPass));
            if (!res.ok) return new Response('upstream error', { status: res.status });
            const buf = Buffer.from(await res.arrayBuffer());
            return new Response(buf, { status: 200, headers: { 'content-type': res.headers.get('content-type') || 'image/jpeg' } });
        } catch {
            return new Response('error', { status: 500 });
        }
    });

    if (!fs.existsSync(configDir)) fs.mkdirSync(configDir, { recursive: true });
    ['covers', 'heroes', 'logos', 'screenshots'].forEach(d =>
        fs.mkdirSync(path.join(imagesDir, d), { recursive: true })
    );
    fs.mkdirSync(trailersDir, { recursive: true });

    try {
        db = new Database(dbPath);
        db.pragma('journal_mode = WAL');

        db.prepare(`CREATE TABLE IF NOT EXISTS systems (
            id                INTEGER PRIMARY KEY AUTOINCREMENT,
            name              TEXT NOT NULL,
            short_name        TEXT,
            extensions        TEXT,
            default_core      TEXT,
            default_emulator  TEXT,
            launch_template   TEXT,
            screenscraper_id  INTEGER
        )`).run();

        db.prepare(`CREATE TABLE IF NOT EXISTS games (
            id               INTEGER PRIMARY KEY AUTOINCREMENT,
            system_id        INTEGER,
            title            TEXT NOT NULL,
            rom_path         TEXT,
            description      TEXT,
            year             TEXT,
            developer        TEXT,
            publisher        TEXT,
            genre            TEXT,
            players          TEXT,
            rating           TEXT,
            screenscraper_id INTEGER,
            cover            TEXT,
            hero             TEXT,
            logo             TEXT,
            screenshot       TEXT,
            last_played      INTEGER DEFAULT 0,
            fav              INTEGER DEFAULT 0,
            want             INTEGER DEFAULT 0,
            launch_override  TEXT,
            FOREIGN KEY (system_id) REFERENCES systems(id)
        )`).run();

        db.prepare(`CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT)`).run();

        db.prepare(`CREATE TABLE IF NOT EXISTS cores (
            id           INTEGER PRIMARY KEY AUTOINCREMENT,
            path         TEXT NOT NULL UNIQUE,
            name         TEXT,
            system_names TEXT
        )`).run();

        // EmuLatte's own RetroArch launch overrides, layered global → system → game via --appendconfig.
        db.prepare(`CREATE TABLE IF NOT EXISTS ra_overrides (
            scope  TEXT NOT NULL,        -- 'global' | 'system' | 'game'
            ref_id INTEGER NOT NULL,     -- 0 for global, else system_id / game_id
            data   TEXT,                 -- JSON of the chosen settings
            PRIMARY KEY (scope, ref_id)
        )`).run();

        // User labels for save-state slots (RetroArch doesn't name slots).
        db.prepare(`CREATE TABLE IF NOT EXISTS save_labels (
            game_id INTEGER NOT NULL,
            slot    TEXT NOT NULL,
            label   TEXT,
            PRIMARY KEY (game_id, slot)
        )`).run();

        db.prepare(`CREATE TABLE IF NOT EXISTS playlists (
            id   INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL
        )`).run();

        db.prepare(`CREATE TABLE IF NOT EXISTS playlist_games (
            playlist_id INTEGER NOT NULL,
            game_id     INTEGER NOT NULL,
            sort_order  INTEGER DEFAULT 0,
            PRIMARY KEY (playlist_id, game_id),
            FOREIGN KEY (playlist_id) REFERENCES playlists(id) ON DELETE CASCADE,
            FOREIGN KEY (game_id)     REFERENCES games(id)     ON DELETE CASCADE
        )`).run();

        try { db.prepare(`ALTER TABLE games ADD COLUMN core_override TEXT`).run(); } catch {}
        try { db.prepare(`ALTER TABLE games ADD COLUMN ra_game_id INTEGER`).run(); } catch {}
        try { db.prepare(`ALTER TABLE games ADD COLUMN igdb_trailer TEXT`).run(); } catch {}
        // Richer core metadata parsed from RetroArch .info files (for compatibility + descriptions).
        for (const col of ['display_name', 'supported_extensions', 'db_names', 'description'])
            try { db.prepare(`ALTER TABLE cores ADD COLUMN ${col} TEXT`).run(); } catch {}
        // Fix a wrong ScreenScraper system id shipped in an old preset (Wii was 117 → 404; correct is 16).
        try { db.prepare(`UPDATE systems SET screenscraper_id=16 WHERE short_name='wii' AND screenscraper_id=117`).run(); } catch {}
        db.prepare(`CREATE TABLE IF NOT EXISTS ra_achievements (
            ra_game_id  INTEGER NOT NULL,
            ach_id      TEXT    NOT NULL,
            title       TEXT,
            description TEXT,
            points      INTEGER DEFAULT 0,
            badge_name  TEXT,
            date_earned TEXT,
            PRIMARY KEY (ra_game_id, ach_id)
        )`).run();

        const raVariant = detectRetroArch();
        db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run('retroarch_variant', raVariant);
    } catch (err) {
        console.error('DB error:', err);
    }

    createWindow();
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });

// ── WINDOW CONTROLS ──────────────────────────────────────────────────────────
ipcMain.on('window-minimize', e => BrowserWindow.fromWebContents(e.sender)?.minimize());
ipcMain.on('window-maximize', e => {
    const w = BrowserWindow.fromWebContents(e.sender);
    w?.isMaximized() ? w.unmaximize() : w?.maximize();
});
ipcMain.on('window-close', e => BrowserWindow.fromWebContents(e.sender)?.close());

// ── COUCH MODE (fullscreen play-only face) ───────────────────────────────────
// Phase 0: fullscreen on the window's CURRENT output (works natively on every platform).
// Chosen-screen targeting + the Wayland→XWayland relaunch path arrive in Phase 4
// (see docs/couch-mode-plan.md §3). couch.html/couch.js are the lean gamepad-first renderer.
ipcMain.handle('enter-couch-mode', e => {
    const win = BrowserWindow.fromWebContents(e.sender); if (!win) return { ok: false };
    win.setFullScreen(true);
    win.loadFile('couch.html');
    return { ok: true };
});
ipcMain.handle('exit-couch-mode', e => {
    const win = BrowserWindow.fromWebContents(e.sender); if (!win) return { ok: false };
    win.setFullScreen(false);
    win.loadFile('index.html');
    return { ok: true };
});

// ── SYSTEMS ──────────────────────────────────────────────────────────────────
ipcMain.handle('get-systems', () => {
    if (!db) return [];
    return db.prepare('SELECT * FROM systems ORDER BY name ASC').all();
});

ipcMain.handle('add-system', (_, data) => {
    if (!db) return null;
    const r = db.prepare(`INSERT INTO systems
        (name, short_name, extensions, default_core, default_emulator, launch_template, screenscraper_id)
        VALUES (@name, @short_name, @extensions, @default_core, @default_emulator, @launch_template, @screenscraper_id)`)
      .run({
          name: data.name || '',
          short_name: data.short_name || '',
          extensions: data.extensions || '',
          default_core: data.default_core || '',
          default_emulator: data.default_emulator || '',
          launch_template: data.launch_template || '',
          screenscraper_id: data.screenscraper_id || null
      });
    return r.lastInsertRowid;
});

ipcMain.handle('update-system', (_, id, data) => {
    if (!db) return false;
    db.prepare(`UPDATE systems SET
        name=@name, short_name=@short_name, extensions=@extensions,
        default_core=@default_core, default_emulator=@default_emulator,
        launch_template=@launch_template, screenscraper_id=@screenscraper_id
        WHERE id=${id}`)
      .run({
          name: data.name || '',
          short_name: data.short_name || '',
          extensions: data.extensions || '',
          default_core: data.default_core || '',
          default_emulator: data.default_emulator || '',
          launch_template: data.launch_template || '',
          screenscraper_id: data.screenscraper_id || null
      });
    return true;
});

ipcMain.handle('delete-system', (_, id) => {
    if (!db) return false;
    db.prepare('DELETE FROM games WHERE system_id=?').run(id);
    db.prepare('DELETE FROM systems WHERE id=?').run(id);
    return true;
});

// ── GAMES ─────────────────────────────────────────────────────────────────────
ipcMain.handle('get-games', () => {
    if (!db) return [];
    return db.prepare(`
        SELECT g.*, s.name AS system_name, s.short_name AS system_short,
               s.launch_template, s.default_core, s.default_emulator
        FROM games g
        LEFT JOIN systems s ON g.system_id = s.id
        ORDER BY g.title ASC
    `).all();
});

ipcMain.handle('add-game', (_, data) => {
    if (!db) return null;
    const r = db.prepare(`INSERT INTO games
        (system_id, title, rom_path, description, year, developer, publisher,
         genre, players, rating, launch_override)
        VALUES (@system_id, @title, @rom_path, @description, @year, @developer, @publisher,
                @genre, @players, @rating, @launch_override)`)
      .run({
          system_id:       data.system_id       || null,
          title:           data.title           || '',
          rom_path:        data.rom_path        || '',
          description:     data.description     || '',
          year:            data.year            || '',
          developer:       data.developer       || '',
          publisher:       data.publisher       || '',
          genre:           data.genre           || '',
          players:         data.players         || '',
          rating:          data.rating          || '',
          launch_override: data.launch_override || ''
      });
    ensureScummvmTarget(data.rom_path);   // make ScummVM games launchable automatically (fill empty .scummvm)
    return r.lastInsertRowid;
});

ipcMain.handle('update-game', (_, id, data) => {
    if (!db) return false;
    const allowed = ['system_id','title','rom_path','description','year','developer','publisher',
                     'genre','players','rating','cover','hero','logo','screenshot',
                     'fav','want','launch_override','core_override','screenscraper_id','ra_game_id'];
    const keys = Object.keys(data).filter(k => allowed.includes(k));
    if (!keys.length) return false;
    const fields = keys.map(k => `${k}=@${k}`).join(', ');
    db.prepare(`UPDATE games SET ${fields} WHERE id=${id}`).run(data);
    return true;
});

ipcMain.handle('delete-game', (_, id) => {
    if (!db) return false;
    // Clean up the art we manage (never the ROM, never user-picked LOCAL files outside imagesDir)
    // and the playlist links, since foreign_keys/cascade isn't enabled on this connection.
    const g = db.prepare('SELECT cover, hero, logo, screenshot FROM games WHERE id=?').get(id);
    if (g) {
        [g.cover, g.hero, g.logo, ...(g.screenshot ? g.screenshot.split('|') : [])]
            .filter(Boolean)
            .forEach(p => { try { if (p.startsWith(imagesDir)) fs.unlinkSync(p); } catch {} });
    }
    db.prepare('DELETE FROM playlist_games WHERE game_id=?').run(id);
    db.prepare('DELETE FROM games WHERE id=?').run(id);
    return true;
});

ipcMain.handle('set-game-flag', (_, id, field, value) => {
    if (!db || !['fav', 'want'].includes(field)) return false;
    db.prepare(`UPDATE games SET ${field}=? WHERE id=?`).run(value ? 1 : 0, id);
    return true;
});

ipcMain.handle('update-last-played', (_, id) => {
    if (!db) return;
    db.prepare('UPDATE games SET last_played=? WHERE id=?').run(Date.now(), id);
});

// ── SETTINGS ─────────────────────────────────────────────────────────────────
ipcMain.handle('get-setting', (_, key) => {
    if (!db) return null;
    const row = db.prepare('SELECT value FROM settings WHERE key=?').get(key);
    return row ? row.value : null;
});

ipcMain.handle('set-setting', (_, key, value) => {
    if (!db) return;
    db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(key, String(value ?? ''));
});

// ── LAUNCH ────────────────────────────────────────────────────────────────────
// Build the shell launch command for a game row (joined with its system fields).
// Shared by launch-game and add-to-cngm so EmuLatte and CafeNeurotico run it identically.
// ── RETROARCH LAUNCH OVERRIDES ────────────────────────────────────────────────
// EmuLatte writes its OWN .cfg files and layers them onto a launch with --appendconfig, so the
// user's host retroarch.cfg is never modified. Scopes stack global → system → game (game wins).
const raOverrideDir  = () => { const d = path.join(configDir, 'retroarch_overrides'); fs.mkdirSync(d, { recursive: true }); return d; };
const raOverridePath = (scope, refId) => path.join(raOverrideDir(), `${scope}_${refId || 0}.cfg`);

function getRetroArchCfgDir() {
    const variant = db?.prepare('SELECT value FROM settings WHERE key=?').get('retroarch_variant')?.value || detectRetroArch();
    return variant === 'flatpak'
        ? path.join(os.homedir(), '.var', 'app', 'org.libretro.RetroArch', 'config', 'retroarch')
        : path.join(os.homedir(), '.config', 'retroarch');
}
const hostRaCfgPath = () => path.join(getRetroArchCfgDir(), 'retroarch.cfg');

// ── EMULATTE-OWNED RETROARCH CONFIG ───────────────────────────────────────────
// RetroArch runs as an engine on EmuLatte's OWN config (launched with --config), never the
// host's. The base is seeded clean: only directory/path keys are imported from the host so
// cores/BIOS/saves resolve; everything else stays at RetroArch defaults. EmuLatte owns it.
const RA_PATH_KEYS = [
    'system_directory', 'libretro_directory', 'libretro_info_path', 'core_assets_directory',
    'savefile_directory', 'savestate_directory', 'video_shader_dir', 'assets_directory',
    'joypad_autoconfig_dir', 'overlay_directory', 'osk_overlay_directory', 'input_remapping_directory',
    'playlist_directory', 'thumbnails_directory', 'cheat_database_path', 'cursor_directory',
    'video_filter_dir', 'audio_filter_dir', 'rgui_browser_directory', 'rgui_config_directory',
    'recording_config_directory', 'recording_output_directory', 'video_layout_directory',
    'cache_directory', 'content_database_path', 'log_dir',
];
function ownedRaCfgPath() {
    const custom = db?.prepare('SELECT value FROM settings WHERE key=?').get('ra_config_path')?.value;
    return custom || path.join(configDir, 'retroarch', 'emulatte-retroarch.cfg');
}
function parseRaCfg(file) {
    const map = {};
    try {
        for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
            if (line.trim().startsWith('#')) continue;
            const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*"?(.*?)"?\s*$/);
            if (m) map[m[1]] = m[2];
        }
    } catch {}
    return map;
}
function readHostPathKeys() {
    const out = {};
    let txt = ''; try { txt = fs.readFileSync(hostRaCfgPath(), 'utf8'); } catch {}
    for (const k of RA_PATH_KEYS) {
        const m = txt.match(new RegExp(`^\\s*${k}\\s*=\\s*"([^"]*)"`, 'm'));
        if (m) out[k] = m[1];
    }
    return out;
}
// Merge keys into a .cfg, updating existing lines in place and appending new ones.
function writeRaCfgKeys(file, updates) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    let lines = []; try { lines = fs.readFileSync(file, 'utf8').split('\n'); } catch {}
    const seen = new Set();
    lines = lines.map(line => {
        const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=/);
        if (m && Object.prototype.hasOwnProperty.call(updates, m[1])) { seen.add(m[1]); return `${m[1]} = "${updates[m[1]]}"`; }
        return line;
    });
    for (const [k, v] of Object.entries(updates)) if (!seen.has(k)) lines.push(`${k} = "${v}"`);
    fs.writeFileSync(file, lines.join('\n').replace(/\n*$/, '\n'), 'utf8');
}
// Create the owned config if missing (or re-seed when force=true): clean + imported paths.
function ensureOwnedRaCfg(force = false) {
    const file = ownedRaCfgPath();
    if (!force && fs.existsSync(file)) return file;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const lines = [
        '# EmuLatte-owned RetroArch configuration.',
        '# Seeded clean — only directory paths were imported from your host config; everything else is RetroArch defaults.',
        '# Tailor this from EmuLatte (Settings -> RetroArch). RetroArch is the engine; this is the config.',
        'config_save_on_exit = "true"',
        ...Object.entries(readHostPathKeys()).map(([k, v]) => `${k} = "${v}"`),
    ];
    fs.writeFileSync(file, lines.join('\n') + '\n', 'utf8');
    return file;
}
// Re-derive only the path keys from the local host config (portability / a new machine).
const reimportRaPaths = () => { const f = ensureOwnedRaCfg(); writeRaCfgKeys(f, readHostPathKeys()); return f; };

function readRaCfgKey(key) {
    const cfgDir = getRetroArchCfgDir();
    for (const file of [ownedRaCfgPath(), hostRaCfgPath()]) {   // prefer EmuLatte's owned config
        try {
            const m = fs.readFileSync(file, 'utf8').match(new RegExp(`^\\s*${key}\\s*=\\s*"([^"]*)"`, 'm'));
            if (m && m[1] && m[1] !== 'default') return m[1].replace(/^~(?=[/\\])/, os.homedir()).replace(/^:/, cfgDir);
        } catch {}
    }
    return '';
}
// Render a saved override to a .cfg file (or remove it when disabled). Returns the path or null.
function writeRaOverride(scope, refId) {
    const file = raOverridePath(scope, refId);
    let data = {};
    try { data = JSON.parse(db?.prepare('SELECT data FROM ra_overrides WHERE scope=? AND ref_id=?').get(scope, refId || 0)?.data || '{}'); } catch {}
    if (!data || !data.enabled) { try { fs.unlinkSync(file); } catch {} return null; }
    const lines = ['# Generated by EmuLatte — edit these in EmuLatte, not here.',
                   'config_save_on_exit = "false"'];   // never let our settings leak back into the host config
    const mon = data.monitor, specificMon = mon != null && mon !== '' && mon !== '0';
    if (mon != null && mon !== '') lines.push(`video_monitor_index = "${mon}"`);
    if (specificMon) {
        // A specific monitor only takes effect in EXCLUSIVE fullscreen — borderless/windowed-fullscreen
        // (and Wayland) ignore video_monitor_index, so force exclusive fullscreen on that output.
        lines.push('video_fullscreen = "true"');
        lines.push('video_windowed_fullscreen = "false"');
    } else if (data.fullscreen != null && data.fullscreen !== '') {
        lines.push(`video_fullscreen = "${data.fullscreen}"`);
    }
    if (data.aspect != null && data.aspect !== '') { lines.push(`aspect_ratio_index = "${data.aspect}"`); lines.push('video_aspect_ratio_auto = "false"'); }
    if (data.shaderEnable != null && data.shaderEnable !== '') lines.push(`video_shader_enable = "${data.shaderEnable}"`);
    if (data.shaderEnable === 'true' && data.shader)           lines.push(`video_shader = "${data.shader}"`);
    if (data.custom && data.custom.trim())                     lines.push(data.custom.trim());
    try { fs.writeFileSync(file, lines.join('\n') + '\n', 'utf8'); return file; } catch { return null; }
}
function raOverrideFiles(game) {
    const paths = [];
    for (const [scope, refId] of [['global', 0], ['system', game.system_id], ['game', game.id]]) {
        if (refId == null) continue;
        const p = writeRaOverride(scope, refId);
        if (p) paths.push(p);
    }
    return paths;
}
// Session cfg that disables save-on-exit, so normal gameplay never writes the owned base config
// (keeps per-game/per-system overrides from leaking into it).
function sessionNoSavePath() {
    const f = raOverridePath('_session', 'nosave');
    try { fs.writeFileSync(f, 'config_save_on_exit = "false"\n'); } catch {}
    return f;
}
// The shader that should be active for a game: per-game/system override wins, else the owned base config.
function effectiveShader(game) {
    if (game) for (const [scope, refId] of [['game', game.id], ['system', game.system_id]]) {
        if (refId == null) continue;
        try {
            const d = JSON.parse(db?.prepare('SELECT data FROM ra_overrides WHERE scope=? AND ref_id=?').get(scope, refId || 0)?.data || '{}');
            if (d.enabled && d.shaderEnable) return { enable: d.shaderEnable === 'true', shader: d.shader || '' };
        } catch {}
    }
    const base = parseRaCfg(ownedRaCfgPath());
    return { enable: base.video_shader_enable === 'true', shader: base.video_shader || '' };
}
// --set-shader force-applies the preset every launch (overrides auto-presets), so the chosen
// shader actually shows up even though gameplay never saves the config back.
function shaderArg(game) { const s = effectiveShader(game); return (s.enable && s.shader) ? ` --set-shader "${s.shader}"` : ''; }

// Build a per-launch config = owned base + enabled scope overrides (global→system→game, later wins) +
// forced no-save. Passed via --config (which RetroArch honours), instead of --appendconfig (which is
// not reliably applied here). Returns the file path.
function launchConfigFile(game, extra = {}) {
    const cfg = parseRaCfg(ensureOwnedRaCfg());
    const scopes = game ? [['global', 0], ['system', game.system_id], ['game', game.id]] : [['global', 0]];
    for (const [scope, refId] of scopes) {
        if (refId == null) continue;
        let data = {};
        try { data = JSON.parse(db?.prepare('SELECT data FROM ra_overrides WHERE scope=? AND ref_id=?').get(scope, refId || 0)?.data || '{}'); } catch {}
        if (!data.enabled) continue;
        const mon = data.monitor, specificMon = mon != null && mon !== '' && mon !== '0';
        if (mon != null && mon !== '') cfg.video_monitor_index = mon;
        if (specificMon) { cfg.video_fullscreen = 'true'; cfg.video_windowed_fullscreen = 'false'; }   // exclusive fullscreen so the index applies
        else if (data.fullscreen != null && data.fullscreen !== '') cfg.video_fullscreen = data.fullscreen;
        if (data.aspect != null && data.aspect !== '') { cfg.aspect_ratio_index = data.aspect; cfg.video_aspect_ratio_auto = 'false'; }
        if (data.shaderEnable != null && data.shaderEnable !== '') cfg.video_shader_enable = data.shaderEnable;
        if (data.shaderEnable === 'true' && data.shader) cfg.video_shader = data.shader;
        if (data.custom && data.custom.trim())
            for (const line of data.custom.trim().split('\n')) { const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*"?(.*?)"?\s*$/); if (m) cfg[m[1]] = m[2]; }
    }
    Object.assign(cfg, extra);
    cfg.config_save_on_exit = 'false';
    const file = raOverridePath('_launch', 0);
    try { fs.writeFileSync(file, Object.entries(cfg).map(([k, v]) => `${k} = "${v}"`).join('\n') + '\n', 'utf8'); } catch {}
    return file;
}
function retroarchConfigArgs(game) {
    return ` --config "${launchConfigFile(game)}"${shaderArg(game)}`;
}

// ScummVM's libretro core reads the game's target id from the .scummvm file. Many ROM sets ship
// these files EMPTY → RetroArch "Failed to load contents of game file". Populate an empty one with
// its basename (the conventional ScummVM gameid) so the game just launches. Written in place, since
// the core auto-detects the game's data directory from where the .scummvm file lives.
function ensureScummvmTarget(romPath) {
    try {
        if (!romPath || !/\.scummvm$/i.test(romPath) || !fs.existsSync(romPath)) return;
        if (fs.statSync(romPath).size > 0) return;
        const id = path.basename(romPath).replace(/\.scummvm$/i, '').trim();
        if (id) fs.writeFileSync(romPath, id + '\n', 'utf8');
    } catch {}
}

function baseLaunchCommand(game) {   // the command WITHOUT EmuLatte's --appendconfig overrides
    let cmd = game.launch_override;
    if (!cmd && game.launch_template && game.rom_path) {
        const core = game.core_override || game.default_core || '';
        cmd = game.launch_template
            .replace('{rom}',      `"${game.rom_path}"`)
            .replace('{core}',     core                  ? `"${core}"`                  : '')
            .replace('{emulator}', game.default_emulator ? `"${game.default_emulator}"` : '');
    }
    return (cmd && cmd.trim()) ? cmd.trim() : '';
}
function buildLaunchCommand(game) {
    let cmd = baseLaunchCommand(game);
    if (cmd && /retroarch/i.test(cmd)) cmd += retroarchConfigArgs(game);   // run on EmuLatte's owned config + overrides
    return cmd;
}

const gameWithSystem = (gameId) => db.prepare(`
    SELECT g.*, s.launch_template, s.default_core, s.default_emulator
    FROM games g LEFT JOIN systems s ON g.system_id = s.id
    WHERE g.id=?
`).get(gameId);

ipcMain.handle('launch-game', (_, gameId) => {
    if (!db) return { ok: false, error: 'DB not ready' };
    const game = gameWithSystem(gameId);
    if (!game) return { ok: false, error: 'Game not found' };

    ensureScummvmTarget(game.rom_path);   // safety net for already-imported ScummVM games with an empty .scummvm
    const cmd = buildLaunchCommand(game);
    if (!cmd) return { ok: false, error: 'No launch command configured — set a Launch Template in System Manager or a Launch Override on this ROM.' };

    db.prepare('UPDATE games SET last_played=? WHERE id=?').run(Date.now(), gameId);
    spawn('bash', ['-c', cmd], { detached: true, stdio: 'ignore' }).unref();
    return { ok: true };
});

// ── RETROARCH SETTINGS (override editor) ──────────────────────────────────────
ipcMain.handle('get-ra-override', (_, scope, refId) => {
    if (!db) return {};
    try { return JSON.parse(db.prepare('SELECT data FROM ra_overrides WHERE scope=? AND ref_id=?').get(scope, refId || 0)?.data || '{}'); }
    catch { return {}; }
});
ipcMain.handle('set-ra-override', (_, scope, refId, data) => {
    if (!db) return { ok: false };
    db.prepare('INSERT OR REPLACE INTO ra_overrides (scope, ref_id, data) VALUES (?,?,?)').run(scope, refId || 0, JSON.stringify(data || {}));
    writeRaOverride(scope, refId || 0);   // keep the .cfg in sync immediately (so CNGM-stored commands pick it up)
    return { ok: true };
});
ipcMain.handle('get-monitors', () => {
    const { screen } = require('electron');
    const primaryId = screen.getPrimaryDisplay().id;
    return screen.getAllDisplays().map((d, i) => ({
        index: i + 1,                                  // RetroArch video_monitor_index is 1-based (0 = auto/primary)
        label: `Monitor ${i + 1} — ${d.size.width}×${d.size.height}${d.id === primaryId ? ' (primary)' : ''}`,
    }));
});
ipcMain.handle('list-ra-shaders', () => {
    const dir = readRaCfgKey('video_shader_dir') || path.join(getRetroArchCfgDir(), 'shaders');
    const out = [];
    (function walk(d, depth) {
        if (depth > 3) return;
        let entries = []; try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
        for (const e of entries) {
            const full = path.join(d, e.name);
            if (e.isDirectory()) walk(full, depth + 1);
            else if (/\.(slangp|glslp|cgp)$/i.test(e.name)) out.push({ path: full, name: e.name });
        }
    })(dir, 0);
    out.sort((a, b) => a.name.localeCompare(b.name));
    return out;
});

// ── SAVE STATE MANAGER ────────────────────────────────────────────────────────
const savestateDir = () => readRaCfgKey('savestate_directory') || path.join(getRetroArchCfgDir(), 'states');
const contentBase  = romPath => path.basename(romPath).replace(/\.[^.]+$/, '');

// All save-state files for a game (slot 0 = ".state", N = ".stateN", auto = ".state.auto"),
// each with its RetroArch thumbnail (.png), timestamp, size and user label.
ipcMain.handle('list-save-states', (_, gameId) => {
    if (!db) return [];
    const g = db.prepare('SELECT rom_path FROM games WHERE id=?').get(gameId);
    if (!g?.rom_path) return [];
    const base = contentBase(g.rom_path);
    const labels = {};
    try { for (const r of db.prepare('SELECT slot,label FROM save_labels WHERE game_id=?').all(gameId)) labels[r.slot] = r.label; } catch {}
    const out = [];
    (function scan(d, depth) {
        if (depth > 2) return;
        let es = []; try { es = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
        for (const e of es) {
            if (e.isDirectory()) { scan(path.join(d, e.name), depth + 1); continue; }
            const n = e.name;
            if (n.endsWith('.png') || !n.startsWith(base + '.state')) continue;
            const suffix = n.slice(base.length);
            let slot;
            if (suffix === '.state') slot = '0';
            else if (suffix === '.state.auto') slot = 'auto';
            else { const m = suffix.match(/^\.state(\d+)$/); if (!m) continue; slot = m[1]; }
            const full = path.join(d, n);
            let st; try { st = fs.statSync(full); } catch { continue; }
            out.push({ slot, file: full, thumb: fs.existsSync(full + '.png') ? full + '.png' : null,
                       mtime: st.mtimeMs, size: st.size, label: labels[slot] || '' });
        }
    })(savestateDir(), 0);
    out.sort((a, b) => (a.slot === 'auto' ? -1 : b.slot === 'auto' ? 1 : Number(a.slot) - Number(b.slot)));
    return out;
});

// Games that have at least one save state — for the cross-library card view.
ipcMain.handle('list-games-with-saves', () => {
    if (!db) return [];
    const games = db.prepare(`SELECT g.id,g.title,g.cover,g.logo,g.rom_path,s.name sys FROM games g LEFT JOIN systems s ON g.system_id=s.id WHERE g.rom_path<>''`).all();
    const byBase = new Map(games.map(g => [contentBase(g.rom_path), g]));
    const agg = new Map();   // gameId -> {count, latest, latestFile}
    (function scan(d, depth) {
        if (depth > 2) return;
        let es = []; try { es = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
        for (const e of es) {
            if (e.isDirectory()) { scan(path.join(d, e.name), depth + 1); continue; }
            const n = e.name;
            if (n.endsWith('.png')) continue;
            const m = n.match(/^(.*)\.state(\d+|\.auto)?$/);
            if (!m) continue;
            const g = byBase.get(m[1]); if (!g) continue;
            const full = path.join(d, n);
            let st; try { st = fs.statSync(full); } catch { continue; }
            const a = agg.get(g.id) || { count: 0, latest: 0, latestFile: null };
            a.count++;
            if (st.mtimeMs >= a.latest) { a.latest = st.mtimeMs; a.latestFile = full; }
            agg.set(g.id, a);
        }
    })(savestateDir(), 0);
    return [...agg.entries()].map(([id, a]) => {
        const g = games.find(x => x.id === id);
        const thumb = a.latestFile && fs.existsSync(a.latestFile + '.png') ? a.latestFile + '.png' : null;
        return { id, title: g.title, cover: g.cover, logo: g.logo, thumb, system: g.sys, count: a.count, latest: a.latest };
    }).sort((x, y) => y.latest - x.latest);
});

ipcMain.handle('set-save-label', (_, gameId, slot, label) => {
    if (!db) return { ok: false };
    if (label && label.trim())
        db.prepare('INSERT OR REPLACE INTO save_labels (game_id, slot, label) VALUES (?,?,?)').run(gameId, String(slot), label.trim());
    else
        db.prepare('DELETE FROM save_labels WHERE game_id=? AND slot=?').run(gameId, String(slot));
    return { ok: true };
});

ipcMain.handle('delete-save-state', (_, file) => {
    try {
        const dir = path.resolve(savestateDir());
        if (!path.resolve(file).startsWith(dir)) return { ok: false, error: 'Refusing to delete outside the save-state folder.' };
        fs.unlinkSync(file);
        try { fs.unlinkSync(file + '.png'); } catch {}
        return { ok: true };
    } catch (e) { return { ok: false, error: e.message }; }
});

// Launch with save-state intent: a specific slot (--entryslot), or fresh (no auto-load).
ipcMain.handle('launch-game-ex', (_, gameId, opts = {}) => {
    if (!db) return { ok: false, error: 'DB not ready' };
    const game = gameWithSystem(gameId);
    if (!game) return { ok: false, error: 'Game not found' };
    let cmd = baseLaunchCommand(game);
    if (!cmd) return { ok: false, error: 'No launch command configured.' };
    if (/retroarch/i.test(cmd)) {
        const extra = opts.fresh ? { savestate_auto_load: 'false' } : {};
        cmd += ` --config "${launchConfigFile(game, extra)}"${shaderArg(game)}`;
        if (opts.slot != null && opts.slot !== 'auto') cmd += ` --entryslot ${Number(opts.slot)}`;
    }
    db.prepare('UPDATE games SET last_played=? WHERE id=?').run(Date.now(), gameId);
    spawn('bash', ['-c', cmd], { detached: true, stdio: 'ignore' }).unref();
    return { ok: true };
});

// ── EMULATTE-OWNED RETROARCH CONFIG: management + 1:1 settings ────────────────
ipcMain.handle('ra-config-info', () => {
    const file = ensureOwnedRaCfg();
    let size = 0, mtime = 0, keys = 0;
    try { const st = fs.statSync(file); size = st.size; mtime = st.mtimeMs; } catch {}
    try { keys = Object.keys(parseRaCfg(file)).length; } catch {}
    return { path: file, host: hostRaCfgPath(), size, mtime, keys };
});
ipcMain.handle('ra-config-get-all', () => parseRaCfg(ensureOwnedRaCfg()));            // every key/value, for the editor
ipcMain.handle('ra-config-set', (_, updates) => { writeRaCfgKeys(ensureOwnedRaCfg(), updates || {}); return { ok: true }; });
ipcMain.handle('ra-config-reimport-paths', () => { reimportRaPaths(); return { ok: true }; });
ipcMain.handle('ra-config-reset', () => { ensureOwnedRaCfg(true); return { ok: true }; });
ipcMain.handle('ra-config-open-folder', () => { shell.showItemInFolder(ensureOwnedRaCfg()); return { ok: true }; });
ipcMain.handle('ra-config-relocate', async () => {
    const { canceled, filePath } = await dialog.showSaveDialog({ defaultPath: ownedRaCfgPath(), filters: [{ name: 'RetroArch config', extensions: ['cfg'] }] });
    if (canceled || !filePath) return { ok: false, canceled: true };
    try { fs.copyFileSync(ensureOwnedRaCfg(), filePath); } catch (e) { return { ok: false, error: e.message }; }
    db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run('ra_config_path', filePath);
    return { ok: true, path: filePath };
});
ipcMain.handle('ra-config-import', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog({ properties: ['openFile'], filters: [{ name: 'RetroArch config', extensions: ['cfg'] }] });
    if (canceled || !filePaths?.length) return { ok: false, canceled: true };
    try { fs.copyFileSync(filePaths[0], ownedRaCfgPath()); } catch (e) { return { ok: false, error: e.message }; }
    return { ok: true };
});
ipcMain.handle('ra-config-export', async () => {
    const { canceled, filePath } = await dialog.showSaveDialog({ defaultPath: `emulatte-retroarch-${dateStamp()}.cfg`, filters: [{ name: 'RetroArch config', extensions: ['cfg'] }] });
    if (canceled || !filePath) return { ok: false, canceled: true };
    try { fs.copyFileSync(ensureOwnedRaCfg(), filePath); } catch (e) { return { ok: false, error: e.message }; }
    return { ok: true, path: filePath };
});
// Open RetroArch's own menu running on EmuLatte's config, with save-on-exit ON (two-way sync).
ipcMain.handle('launch-retroarch-config', () => {
    const variant = db?.prepare('SELECT value FROM settings WHERE key=?').get('retroarch_variant')?.value || detectRetroArch();
    const exec = variant === 'flatpak' ? 'flatpak run org.libretro.RetroArch' : 'retroarch';
    const cmd = `${exec} --config "${ensureOwnedRaCfg()}" --menu`;
    spawn('bash', ['-c', cmd], { detached: true, stdio: 'ignore' }).unref();
    return { ok: true };
});

// ── CORE OPTIONS ──────────────────────────────────────────────────────────────
// Where RetroArch reads/writes per-core options. Pin it explicitly in the owned config
// so EmuLatte and RetroArch agree on the file.
function coreOptionsFile() {
    let p = parseRaCfg(ownedRaCfgPath()).core_options_path;
    if (!p) { p = path.join(path.dirname(ownedRaCfgPath()), 'retroarch-core-options.cfg'); writeRaCfgKeys(ensureOwnedRaCfg(), { core_options_path: p }); }
    return p.replace(/^~(?=[/\\])/, os.homedir());
}
ipcMain.handle('ra-core-options-get', () => {
    const f = coreOptionsFile();
    const map = parseRaCfg(f);
    return { path: f, options: Object.entries(map).map(([k, v]) => ({ k, v })).sort((a, b) => a.k.localeCompare(b.k)) };
});
ipcMain.handle('ra-core-options-set', (_, updates) => { writeRaCfgKeys(coreOptionsFile(), updates || {}); return { ok: true }; });

// ── SHADER BROWSER (folder-by-folder, like RetroArch's preset browser) ────────
ipcMain.handle('ra-browse-shaders', (_, rel = '') => {
    const root = readRaCfgKey('video_shader_dir') || path.join(getRetroArchCfgDir(), 'shaders');
    const cur = path.resolve(path.join(root, rel));
    if (!cur.startsWith(path.resolve(root))) return { root, rel: '', dirs: [], presets: [], hasParent: false };
    let entries = []; try { entries = fs.readdirSync(cur, { withFileTypes: true }); } catch {}
    const dirs = [], presets = [];
    for (const e of entries) {
        if (e.isDirectory()) dirs.push(e.name);
        else { const m = e.name.match(/\.(slangp|glslp|cgp)$/i); if (m) presets.push({ name: e.name.replace(/\.(slangp|glslp|cgp)$/i, ''), file: path.join(cur, e.name), type: m[1].toLowerCase() }); }
    }
    dirs.sort((a, b) => a.localeCompare(b));
    presets.sort((a, b) => a.name.localeCompare(b.name));
    return { root, rel, dirs, presets, hasParent: !!rel };
});

// Download a URL to a file, following GitHub redirects, reporting progress.
function httpsDownload(url, dest, onProgress) {
    return new Promise((resolve, reject) => {
        const file = fs.createWriteStream(dest);
        const get = (u, redirects = 0) => {
            https.get(u, { headers: { 'User-Agent': 'EmuLatte' } }, res => {
                if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location && redirects < 6) {
                    res.resume(); return get(res.headers.location, redirects + 1);
                }
                if (res.statusCode !== 200) { res.resume(); return reject(new Error('HTTP ' + res.statusCode)); }
                const total = parseInt(res.headers['content-length'] || '0', 10); let got = 0;
                res.on('data', c => { got += c.length; onProgress && onProgress(got, total); });
                res.pipe(file);
                file.on('finish', () => file.close(() => resolve()));
            }).on('error', err => { try { fs.unlinkSync(dest); } catch {} reject(err); });
        };
        get(url);
    });
}
const shaderDir = () => readRaCfgKey('video_shader_dir') || path.join(getRetroArchCfgDir(), 'shaders');

// Download libretro's official slang-shaders into <shaders>/shaders_slang (same layout RetroArch's updater uses).
ipcMain.handle('download-shader-pack', async (e) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    const dest = path.join(os.tmpdir(), 'emulatte-slang-shaders.zip');
    try {
        await httpsDownload('https://github.com/libretro/slang-shaders/archive/refs/heads/master.zip', dest,
            (got, total) => win?.webContents.send('shader-pack-progress', { got, total }));
        win?.webContents.send('shader-pack-progress', { extracting: true });
        const zip = new AdmZip(dest);
        const target = path.join(shaderDir(), 'shaders_slang');
        fs.mkdirSync(target, { recursive: true });
        let n = 0;
        for (const entry of zip.getEntries()) {
            if (entry.isDirectory) continue;
            const rel = entry.entryName.replace(/^slang-shaders-[^/]+\//, '');   // strip the top "slang-shaders-master/" folder
            if (!rel) continue;
            const out = path.join(target, rel);
            fs.mkdirSync(path.dirname(out), { recursive: true });
            fs.writeFileSync(out, entry.getData()); n++;
        }
        try { fs.unlinkSync(dest); } catch {}
        return { ok: true, files: n, dir: target };
    } catch (err) { return { ok: false, error: err.message }; }
});

// Copy EmuLatte's bundled curated presets into the shader root (their relative refs resolve against the pack).
ipcMain.handle('install-bundled-presets', () => {
    const root = shaderDir(); fs.mkdirSync(root, { recursive: true });
    const src = path.join(__dirname, 'assets', 'shaders');
    let names = [];
    for (const f of safeReaddir(src)) if (/\.(slangp|glslp|cgp)$/i.test(f)) { try { fs.copyFileSync(path.join(src, f), path.join(root, f)); names.push(f.replace(/\.[^.]+$/, '')); } catch {} }
    return { ok: true, names };
});

// ── INPUT REMAPS (.rmp files) ─────────────────────────────────────────────────
const remapsDir = () => readRaCfgKey('input_remapping_directory') || path.join(getRetroArchCfgDir(), 'config', 'remaps');
ipcMain.handle('ra-list-remaps', () => {
    const root = remapsDir(); const out = [];
    (function walk(d, depth) {
        if (depth > 3) return;
        let es = []; try { es = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
        for (const e of es) {
            const full = path.join(d, e.name);
            if (e.isDirectory()) { walk(full, depth + 1); continue; }
            if (!/\.rmp(\.disabled)?$/i.test(e.name)) continue;
            out.push({ path: full, name: e.name.replace(/\.rmp(\.disabled)?$/i, ''), core: path.basename(path.dirname(full)), enabled: !/\.disabled$/i.test(e.name) });
        }
    })(root, 0);
    return out.sort((a, b) => (a.core + a.name).localeCompare(b.core + b.name));
});
ipcMain.handle('ra-remap-toggle', (_, file, enable) => {
    try {
        const target = enable ? file.replace(/\.disabled$/i, '') : (/\.disabled$/i.test(file) ? file : file + '.disabled');
        if (target !== file) fs.renameSync(file, target);
        return { ok: true, path: target };
    } catch (e) { return { ok: false, error: e.message }; }
});
ipcMain.handle('ra-remap-delete', (_, file) => {
    try {
        const dir = path.resolve(remapsDir());
        if (!path.resolve(file).startsWith(dir)) return { ok: false, error: 'Refusing to delete outside the remaps folder.' };
        fs.unlinkSync(file); return { ok: true };
    } catch (e) { return { ok: false, error: e.message }; }
});

// The RetroArch remap folder for a core = its short "corename" (from the .info file).
function coreRemapFolder(coreSoPath) {
    if (!coreSoPath) return '';
    const base = path.basename(coreSoPath).replace(/\.so$/i, '');
    const infoDir = readRaCfgKey('libretro_info_path') || path.join(getRetroArchCfgDir(), 'info');
    try {
        const name = infoField(fs.readFileSync(path.join(infoDir, base + '.info'), 'utf8'), 'corename');
        if (name) return name;
    } catch {}
    return base.replace(/_libretro$/i, '');   // fallback
}
const controlTemplates = () => { try { return JSON.parse(fs.readFileSync(path.join(__dirname, 'assets', 'control_templates.json'), 'utf8')); } catch { return []; } };

// Templates + which of the user's systems each applies to (with resolved remap folder + installed state).
ipcMain.handle('get-control-templates', () => {
    if (!db) return [];
    const systems = db.prepare('SELECT id, name, short_name, default_core FROM systems').all();
    const root = remapsDir();
    return controlTemplates().map(t => {
        const wants = new Set(t.systems.map(s => s.toLowerCase()));
        const targets = systems.filter(s => wants.has((s.short_name || '').toLowerCase()))
            .map(s => {
                const folder = coreRemapFolder(s.default_core);
                const rmp = path.join(root, folder, folder + '.rmp');
                return { systemId: s.id, systemName: s.name, folder, installed: fs.existsSync(rmp) };
            }).filter(t2 => t2.folder);
        return { id: t.id, name: t.name, desc: t.desc, targets };
    }).filter(t => t.targets.length);
});

ipcMain.handle('install-control-template', (_, templateId, systemId) => {
    if (!db) return { ok: false, error: 'DB not ready' };
    const t = controlTemplates().find(x => x.id === templateId);
    const sys = db.prepare('SELECT default_core FROM systems WHERE id=?').get(systemId);
    if (!t || !sys) return { ok: false, error: 'Not found' };
    const folder = coreRemapFolder(sys.default_core);
    if (!folder) return { ok: false, error: 'Could not resolve the core for this system.' };
    const updates = {};
    for (const line of t.lines) { const m = line.match(/^\s*([A-Za-z0-9_+-]+)\s*=\s*"?(.*?)"?\s*$/); if (m) updates[m[1]] = m[2]; }
    try {
        const dir = path.join(remapsDir(), folder);
        fs.mkdirSync(dir, { recursive: true });
        writeRaCfgKeys(path.join(dir, folder + '.rmp'), updates);
        return { ok: true, folder };
    } catch (e) { return { ok: false, error: e.message }; }
});

// ── BACKUP / RESTORE ──────────────────────────────────────────────────────────
// ── BACKUP / RESTORE ──────────────────────────────────────────────────────────
const savefileDir = () => readRaCfgKey('savefile_directory') || path.join(getRetroArchCfgDir(), 'saves');
const dateStamp   = () => new Date().toISOString().slice(0, 10);
const gameBase    = id => { const g = db.prepare('SELECT rom_path FROM games WHERE id=?').get(id); return g?.rom_path ? contentBase(g.rom_path) : null; };
const safeReaddir = d => { try { return fs.readdirSync(d).filter(f => { try { return fs.statSync(path.join(d, f)).isFile(); } catch { return false; } }); } catch { return []; } };

function saveFilesForScope(scope, refId) {
    let bases = null;   // null = everything
    if (scope === 'game')   { const b = gameBase(refId); bases = new Set(b ? [b] : []); }
    if (scope === 'system') bases = new Set(db.prepare('SELECT rom_path FROM games WHERE system_id=?').all(refId).map(r => contentBase(r.rom_path)));
    const hit = f => !bases || [...bases].some(b => f === b + '.srm' || f.startsWith(b + '.state'));
    const out = [];
    for (const f of safeReaddir(savestateDir())) if (hit(f)) out.push({ abs: path.join(savestateDir(), f), folder: 'states' });
    for (const f of safeReaddir(savefileDir()))  if (hit(f)) out.push({ abs: path.join(savefileDir(),  f), folder: 'saves'  });
    return out;
}
function labelsForScope(scope, refId) {
    let rows = [];
    if (scope === 'game') rows = db.prepare('SELECT * FROM save_labels WHERE game_id=?').all(refId);
    else if (scope === 'system') { const ids = db.prepare('SELECT id FROM games WHERE system_id=?').all(refId).map(r => r.id); rows = ids.length ? db.prepare(`SELECT * FROM save_labels WHERE game_id IN (${ids.map(() => '?').join(',')})`).all(...ids) : []; }
    else rows = db.prepare('SELECT * FROM save_labels').all();
    return rows.map(r => ({ base: gameBase(r.game_id), slot: r.slot, label: r.label })).filter(r => r.base);
}

ipcMain.handle('backup-saves', async (_, scope, refId) => {
    if (!db) return { ok: false, error: 'DB not ready' };
    const files = saveFilesForScope(scope, refId);
    if (!files.length) return { ok: false, error: 'No save files found for this selection.' };
    const tag = scope === 'game' ? '-' + (gameBase(refId) || 'game').replace(/[^\w-]+/g, '_').slice(0, 40) : scope === 'system' ? '-system' : '';
    const { canceled, filePath } = await dialog.showSaveDialog({ defaultPath: `emulatte-saves${tag}-${dateStamp()}.zip`, filters: [{ name: 'Zip archive', extensions: ['zip'] }] });
    if (canceled || !filePath) return { ok: false, canceled: true };
    try {
        const zip = new AdmZip();
        for (const f of files) zip.addLocalFile(f.abs, f.folder);
        zip.addFile('emulatte-saves.json', Buffer.from(JSON.stringify({ kind: 'saves', app: 'EmuLatte', created: Date.now(), scope, labels: labelsForScope(scope, refId) }, null, 2)));
        zip.writeZip(filePath);
        return { ok: true, path: filePath, files: files.length };
    } catch (e) { return { ok: false, error: e.message }; }
});

ipcMain.handle('restore-saves', async () => {
    if (!db) return { ok: false, error: 'DB not ready' };
    const { canceled, filePaths } = await dialog.showOpenDialog({ properties: ['openFile'], filters: [{ name: 'Zip archive', extensions: ['zip'] }] });
    if (canceled || !filePaths?.length) return { ok: false, canceled: true };
    try {
        const zip = new AdmZip(filePaths[0]);
        const stDir = savestateDir(), svDir = savefileDir();
        fs.mkdirSync(stDir, { recursive: true }); fs.mkdirSync(svDir, { recursive: true });
        let restored = 0;
        for (const e of zip.getEntries()) {
            if (e.isDirectory) continue;
            const dest = e.entryName.startsWith('states/') ? stDir : e.entryName.startsWith('saves/') ? svDir : null;
            if (!dest) continue;
            fs.writeFileSync(path.join(dest, path.basename(e.entryName)), e.getData());
            restored++;
        }
        try {
            const meta = JSON.parse(zip.readAsText('emulatte-saves.json') || '{}');
            const games = db.prepare("SELECT id, rom_path FROM games WHERE rom_path<>''").all();
            for (const l of (meta.labels || [])) {
                const g = games.find(x => contentBase(x.rom_path) === l.base);
                if (g && l.label) db.prepare('INSERT OR REPLACE INTO save_labels (game_id, slot, label) VALUES (?,?,?)').run(g.id, String(l.slot), l.label);
            }
        } catch {}
        return { ok: true, restored };
    } catch (e) { return { ok: false, error: e.message }; }
});

ipcMain.handle('backup-ra-settings', async () => {
    if (!db) return { ok: false, error: 'DB not ready' };
    const { canceled, filePath } = await dialog.showSaveDialog({ defaultPath: `emulatte-retroarch-settings-${dateStamp()}.zip`, filters: [{ name: 'Zip archive', extensions: ['zip'] }] });
    if (canceled || !filePath) return { ok: false, canceled: true };
    try {
        const zip = new AdmZip();
        const hostCfg = path.join(getRetroArchCfgDir(), 'retroarch.cfg');
        if (fs.existsSync(hostCfg)) zip.addLocalFile(hostCfg);                 // reference copy of the host config
        const ovr = raOverrideDir();
        if (fs.existsSync(ovr)) for (const f of safeReaddir(ovr)) zip.addLocalFile(path.join(ovr, f), 'emulatte_overrides');
        zip.addFile('emulatte-settings.json', Buffer.from(JSON.stringify({ kind: 'settings', app: 'EmuLatte', created: Date.now(), overrides: db.prepare('SELECT scope, ref_id, data FROM ra_overrides').all() }, null, 2)));
        zip.writeZip(filePath);
        return { ok: true, path: filePath };
    } catch (e) { return { ok: false, error: e.message }; }
});

ipcMain.handle('restore-ra-settings', async () => {
    if (!db) return { ok: false, error: 'DB not ready' };
    const { canceled, filePaths } = await dialog.showOpenDialog({ properties: ['openFile'], filters: [{ name: 'Zip archive', extensions: ['zip'] }] });
    if (canceled || !filePaths?.length) return { ok: false, canceled: true };
    try {
        const zip = new AdmZip(filePaths[0]);
        const meta = JSON.parse(zip.readAsText('emulatte-settings.json') || '{}');
        let n = 0;
        for (const o of (meta.overrides || [])) {
            db.prepare('INSERT OR REPLACE INTO ra_overrides (scope, ref_id, data) VALUES (?,?,?)').run(o.scope, o.ref_id, o.data);
            writeRaOverride(o.scope, o.ref_id);
            n++;
        }
        return { ok: true, restored: n };
    } catch (e) { return { ok: false, error: e.message }; }
});

// ── FULL BACKUP / RESTORE (config folder + RetroArch saves) ───────────────────
// scope 'emulatte' → just GameManagerConfig/EmuLatte; scope 'suite' → all of GameManagerConfig
// (CafeNeurotico Suite, same as CafeNeurotico's own backup). Both bundle RetroArch save states +
// savefiles (which live OUTSIDE GameManagerConfig) under a known prefix so restore can re-home them.
const BK_STATES = '__ra_saves__/states/';
const BK_SAVES  = '__ra_saves__/saves/';
ipcMain.handle('create-backup', async (_, scope = 'emulatte') => {
    const isSuite = scope === 'suite';
    const { canceled, filePath } = await dialog.showSaveDialog({
        title: isSuite ? 'Back Up CafeNeurotico Suite' : 'Back Up EmuLatte',
        defaultPath: isSuite ? `CafeNeurotico Suite ${dateStamp()}.zip` : `EmuLatte ${dateStamp()}.zip`,
        filters: [{ name: 'Zip archive', extensions: ['zip'] }],
    });
    if (canceled || !filePath) return { ok: false, canceled: true };
    try {
        try { db?.pragma('wal_checkpoint(TRUNCATE)'); } catch {}            // flush WAL so emulatte.db is consistent in the zip
        const zip = new AdmZip();
        if (isSuite) zip.addLocalFolder(path.join(baseDir, 'GameManagerConfig'), 'GameManagerConfig');
        else         zip.addLocalFolder(configDir, 'GameManagerConfig/EmuLatte');
        const stateDir = savestateDir(), saveDir = savefileDir();
        let withSaves = false;
        if (stateDir && fs.existsSync(stateDir)) { zip.addLocalFolder(stateDir, BK_STATES.slice(0, -1)); withSaves = true; }
        if (saveDir && fs.existsSync(saveDir) && path.resolve(saveDir) !== path.resolve(stateDir || '')) { zip.addLocalFolder(saveDir, BK_SAVES.slice(0, -1)); withSaves = true; }
        zip.addFile('__emulatte_backup__.json', Buffer.from(JSON.stringify({ app: 'EmuLatte', scope, created: Date.now(), withSaves }, null, 2)));
        zip.writeZip(filePath);
        return { ok: true, path: filePath, withSaves };
    } catch (e) { return { ok: false, error: e.message }; }
});

ipcMain.handle('restore-backup', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog({ properties: ['openFile'], filters: [{ name: 'Zip archive', extensions: ['zip'] }] });
    if (canceled || !filePaths?.length) return { ok: false, canceled: true };
    let result;
    try {
        const zip = new AdmZip(filePaths[0]);
        const entries = zip.getEntries();
        if (!entries.some(e => e.entryName.startsWith('GameManagerConfig/'))) return { ok: false, error: 'This ZIP is not an EmuLatte or CafeNeurotico Suite backup.' };
        const stateDir = savestateDir(), saveDir = savefileDir();
        // Finalize + close the DB before overwriting it, so a later WAL checkpoint can't clobber the restore.
        try { db?.pragma('wal_checkpoint(TRUNCATE)'); } catch {}
        try { db?.close(); } catch {}
        db = null;
        let cfgN = 0, saveN = 0;
        for (const e of entries) {
            if (e.isDirectory) continue;
            const name = e.entryName;
            let out = null;
            if (name.startsWith('GameManagerConfig/'))      { out = path.join(baseDir, name); cfgN++; }
            else if (name.startsWith(BK_STATES) && stateDir) { out = path.join(stateDir, name.slice(BK_STATES.length)); saveN++; }
            else if (name.startsWith(BK_SAVES)  && saveDir)  { out = path.join(saveDir,  name.slice(BK_SAVES.length));  saveN++; }
            if (!out) continue;
            fs.mkdirSync(path.dirname(out), { recursive: true });
            fs.writeFileSync(out, e.getData());
        }
        result = { ok: true, configFiles: cfgN, saveFiles: saveN };
    } catch (e) { result = { ok: false, error: e.message }; }
    // DB is closed either way → relaunch so EmuLatte reopens the restored data cleanly.
    if (result.ok) setTimeout(() => { app.relaunch(); app.exit(0); }, 900);
    return result;
});

// Push a game into CafeNeurotico's library under the Emulation category. CNGM shares the
// GameManagerConfig folder, buckets by the Store column, stores art as relative
// GameManagerConfig/images/<file> paths, and shell-execs LaunchCommand — so we copy the art
// across and write a row whose LaunchCommand is EmuLatte's own RetroArch command.
function copyArtToCngm(srcAbs, cngmImagesDir, gameId, type) {
    if (!srcAbs || !fs.existsSync(srcAbs)) return '';
    const ext = path.extname(srcAbs) || '.jpg';
    const fn  = `emulatte_${gameId}_${type}${ext}`;
    try { fs.copyFileSync(srcAbs, path.join(cngmImagesDir, fn)); }
    catch { return ''; }
    return `GameManagerConfig/images/${fn}`;
}

ipcMain.handle('add-to-cngm', (_, gameId) => {
    if (!db) return { ok: false, error: 'DB not ready' };
    const game = gameWithSystem(gameId);
    if (!game) return { ok: false, error: 'Game not found' };

    ensureScummvmTarget(game.rom_path);   // safety net for already-imported ScummVM games with an empty .scummvm
    const cmd = buildLaunchCommand(game);
    if (!cmd) return { ok: false, error: 'No launch command for this game — set a Launch Template/core first.' };

    const cngmDir = path.join(baseDir, 'GameManagerConfig');
    const cngmDb  = path.join(cngmDir, 'games.db');
    if (!fs.existsSync(cngmDb)) return { ok: false, error: 'CafeNeurotico database not found in the shared GameManagerConfig folder.' };
    const cngmImages = path.join(cngmDir, 'images');
    fs.mkdirSync(cngmImages, { recursive: true });

    let cdb;
    try {
        cdb = new Database(cngmDb, { timeout: 4000 });
        const cover = copyArtToCngm(game.cover, cngmImages, gameId, 'cover');
        const hero  = copyArtToCngm(game.hero,  cngmImages, gameId, 'hero');
        const logo  = copyArtToCngm(game.logo,  cngmImages, gameId, 'logo');
        const shots = (game.screenshot || '').split('|').filter(Boolean)
            .map((s, i) => copyArtToCngm(s, cngmImages, gameId, `ss${i}`)).filter(Boolean).join('|');

        // Dedupe on the launch command (unique per rom+core): update in place if present.
        const existing = cdb.prepare('SELECT id FROM games WHERE LaunchCommand=?').get(cmd);
        if (existing) {
            cdb.prepare(`UPDATE games SET Game=?, Store='Emulation', GENRE=?, DEV=?, PUB=?, RELEASED=?,
                Description=?, CoverArt=?, HeroArt=?, Logo=?, Screenshot=?, Installed=1 WHERE id=?`)
               .run(game.title, game.genre || '', game.developer || '', game.publisher || '', game.year || '',
                    game.description || '', cover, hero, logo, shots, existing.id);
            cdb.close();
            return { ok: true, updated: true };
        }
        cdb.prepare(`INSERT INTO games (Store, Game, GENRE, DEV, PUB, RELEASED, Description,
            CoverArt, HeroArt, Logo, Screenshot, LaunchCommand, Installed)
            VALUES ('Emulation', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`)
           .run(game.title, game.genre || '', game.developer || '', game.publisher || '', game.year || '',
                game.description || '', cover, hero, logo, shots, cmd);
        cdb.close();
        return { ok: true };
    } catch (e) {
        try { cdb?.close(); } catch {}
        return { ok: false, error: e.message };
    }
});

// ── SCREENSCRAPER HELPERS ─────────────────────────────────────────────────────

function computeFileCrc32(filePath) {
    return new Promise((resolve, reject) => {
        const stream = fs.createReadStream(filePath, { highWaterMark: 65536 });
        let crc = 0;
        stream.on('data', chunk => { crc = zlib.crc32(chunk, crc); });
        stream.on('end',  () => resolve(crc.toString(16).toUpperCase().padStart(8, '0')));
        stream.on('error', reject);
    });
}

function httpsGet(url) {
    return new Promise((resolve, reject) => {
        const req = https.get(url, { headers: { 'User-Agent': 'EmuLatte/1.0' } }, res => {
            const chunks = [];
            res.on('data', c => chunks.push(c));
            res.on('end', () => {
                const raw = Buffer.concat(chunks);
                const enc = res.headers['content-encoding'];
                if (enc === 'gzip' || enc === 'deflate' || enc === 'br') {
                    zlib.unzip(raw, (err, buf) => {
                        if (err) reject(err);
                        else resolve({ status: res.statusCode, body: buf, headers: res.headers });
                    });
                } else {
                    resolve({ status: res.statusCode, body: raw, headers: res.headers });
                }
            });
        });
        req.on('error', reject);
        req.setTimeout(20000, () => { req.destroy(); reject(new Error('timeout')); });
    });
}

async function downloadFile(url, destPath) {
    const { status, body } = await httpsGet(url);
    if (status !== 200) throw new Error(`HTTP ${status}`);
    fs.writeFileSync(destPath, body);
}

// Maps system short_name → { igdb: platform_id, tgdb: platform_id, moby: platform_id }
const PLATFORM_MAP = {
    nes:    { igdb: 18,  tgdb: 7,    moby: 22  }, fds:    { igdb: 51,  tgdb: 4918, moby: 52  },
    snes:   { igdb: 19,  tgdb: 6,    moby: 15  }, n64:    { igdb: 4,   tgdb: 3,    moby: 9   },
    gc:     { igdb: 21,  tgdb: 2,    moby: 14  }, wii:    { igdb: 5,   tgdb: 9,    moby: 82  },
    gb:     { igdb: 33,  tgdb: 4,    moby: 10  }, gbc:    { igdb: 22,  tgdb: 41,   moby: 11  },
    gba:    { igdb: 24,  tgdb: 5,    moby: 12  }, nds:    { igdb: 20,  tgdb: 8,    moby: 44  },
    '3ds':  { igdb: 37,  tgdb: 4911, moby: 101 }, vb:     { igdb: 87,  tgdb: null, moby: 29  },
    sms:    { igdb: 64,  tgdb: 35,   moby: 26  }, genesis:{ igdb: 29,  tgdb: 36,   moby: 16  },
    '32x':  { igdb: 30,  tgdb: 33,   moby: 21  }, segacd: { igdb: 78,  tgdb: 21,   moby: 20  },
    saturn: { igdb: 32,  tgdb: 17,   moby: 23  }, dc:     { igdb: 23,  tgdb: 16,   moby: 8   },
    gg:     { igdb: 35,  tgdb: 20,   moby: 25  }, sg1000: { igdb: 84,  tgdb: null, moby: 43  },
    ps1:    { igdb: 7,   tgdb: 10,   moby: 6   }, ps2:    { igdb: 8,   tgdb: 11,   moby: 7   },
    psp:    { igdb: 38,  tgdb: 13,   moby: 46  }, vita:   { igdb: 46,  tgdb: 39,   moby: 105 },
    a2600:  { igdb: 59,  tgdb: 22,   moby: 28  }, a5200:  { igdb: 66,  tgdb: 26,   moby: 33  },
    a7800:  { igdb: 60,  tgdb: 27,   moby: 34  }, lynx:   { igdb: 61,  tgdb: 4924, moby: 18  },
    jaguar: { igdb: 62,  tgdb: 32,   moby: 17  }, atarist:{ igdb: 63,  tgdb: 4938, moby: 24  },
    pce:    { igdb: 86,  tgdb: 34,   moby: 40  }, pcecd:  { igdb: 150, tgdb: 4955, moby: 45  },
    sgfx:   { igdb: 128, tgdb: null, moby: null }, pcfx:  { igdb: 274, tgdb: 4930, moby: 59  },
    neogeo: { igdb: 80,  tgdb: 24,   moby: 36  }, neocd:  { igdb: 136, tgdb: null, moby: 54  },
    ngp:    { igdb: 119, tgdb: 4922, moby: 52  }, ngpc:   { igdb: 120, tgdb: null, moby: 53  },
    c64:    { igdb: 15,  tgdb: 40,   moby: 27  }, amiga:  { igdb: 16,  tgdb: 4911, moby: 19  },
    cpc:    { igdb: 25,  tgdb: 4914, moby: 60  }, zxs:    { igdb: 26,  tgdb: 4913, moby: 41  },
    msx:    { igdb: 27,  tgdb: 4929, moby: 57  }, msx2:   { igdb: 53,  tgdb: null, moby: 57  },
    coleco: { igdb: 68,  tgdb: 29,   moby: 29  }, intv:   { igdb: 67,  tgdb: 30,   moby: 30  },
    '3do':  { igdb: 50,  tgdb: 50,   moby: 35  }, ws:     { igdb: 57,  tgdb: 4925, moby: 49  },
    wsc:    { igdb: 123, tgdb: 4926, moby: 50  }, vectrex:{ igdb: 70,  tgdb: 4931, moby: 37  },
    mame:   { igdb: 52,  tgdb: 23,   moby: 143 }, fbn:    { igdb: 52,  tgdb: 23,   moby: 143 },
    dos:    { igdb: 13,  tgdb: 1,    moby: 2   }, ps3:    { igdb: 9,   tgdb: 12,   moby: 81  },
    switch: { igdb: 130, tgdb: 4971, moby: 203 },
};

// Dev credentials identify EmuLatte itself; users supply their own account (ssid/sspassword).
// In a shipped build they live XOR-scrambled in assets/ss_dev.dat (no plaintext in the AppImage,
// the same approach ES-DE uses). assets/ss_dev.json is the plaintext source kept for local dev;
// both files are gitignored, and predist regenerates the .dat from the .json before packaging.
// The key below is obfuscation, not encryption — it only defeats `strings`/secret-scanners.
const SS_DEV_KEY = 'EmuLatte::cafeneurotico::ss-dev::xor::v1';
function ssDevXor(buf) {
    const out = Buffer.allocUnsafe(buf.length);
    for (let i = 0; i < buf.length; i++) out[i] = buf[i] ^ SS_DEV_KEY.charCodeAt(i % SS_DEV_KEY.length);
    return out;
}
let ssDev = { devid: '', devpassword: '', softname: 'EmuLatte' };
try {
    const dat  = fs.readFileSync(path.join(__dirname, 'assets', 'ss_dev.dat'), 'utf8');
    const json = ssDevXor(Buffer.from(dat, 'base64')).toString('utf8');
    ssDev = { ...ssDev, ...JSON.parse(json) };
} catch {
    try {
        ssDev = { ...ssDev, ...JSON.parse(fs.readFileSync(path.join(__dirname, 'assets', 'ss_dev.json'), 'utf8')) };
    } catch {}
}

function ssBaseParams(ssUser, ssPass) {
    return {
        devid: ssDev.devid, devpassword: ssDev.devpassword,
        softname: ssDev.softname, output: 'json',
        ssid: ssUser, sspassword: ssPass,
    };
}

const SS_CRED_KEYS = ['devid', 'devpassword', 'softname', 'ssid', 'sspassword', 'output'];
// Drop any credential/API params already baked into a ScreenScraper media URL. SS now returns
// media URLs with the request's creds embedded, so we strip them to (a) keep the password out of
// the renderer/DOM and (b) avoid duplicate params when we add our own.
function ssStripCreds(url) {
    const [base, qs = ''] = url.split('?');
    const keep = new URLSearchParams();
    for (const [k, v] of new URLSearchParams(qs)) if (!SS_CRED_KEYS.includes(k)) keep.set(k, v);
    const s = keep.toString();
    return s ? `${base}?${s}` : base;
}
function ssMediaUrl(url, ssUser, ssPass) {
    const clean = ssStripCreds(url);
    const creds = new URLSearchParams({
        devid: ssDev.devid, devpassword: ssDev.devpassword, softname: ssDev.softname,
        ssid: ssUser, sspassword: ssPass, output: 'image',
    });
    return `${clean}${clean.includes('?') ? '&' : '?'}${creds.toString()}`;
}

function ssApiUrl(endpoint, params) {
    return `https://www.screenscraper.fr/api2/${endpoint}?${new URLSearchParams(params).toString()}`;
}

async function ssApiCall(endpoint, params) {
    if (!ssDev.devid || !ssDev.devpassword) throw new Error('Dev credentials missing from this build (assets/ss_dev.json)');
    const { status, body } = await httpsGet(ssApiUrl(endpoint, params));
    if (status !== 200) throw new Error(`HTTP ${status}`);
    const text = body.toString('utf8');
    try { return JSON.parse(text); }
    catch { throw new Error(text.slice(0, 120) || 'Invalid JSON from ScreenScraper'); }
}

const REGION_PREF = ['wor', 'us', 'eu', 'fr', 'jp', 'ss'];
const LANG_PREF   = ['en', 'fr', 'es', 'de', 'pt'];

function ssPickRegion(arr) {
    if (!arr?.length) return '';
    for (const r of REGION_PREF) { const f = arr.find(n => n.region === r); if (f?.text) return f.text; }
    return arr[0]?.text || '';
}
function ssPickLang(arr) {
    if (!arr?.length) return '';
    for (const l of LANG_PREF) { const f = arr.find(n => n.langue === l); if (f?.text) return f.text; }
    return arr[0]?.text || '';
}
function ssPickYear(arr) {
    const t = ssPickRegion(arr);
    return t ? t.slice(0, 4) : '';
}
function ssPickMedia(medias, type) {
    const candidates = medias.filter(m => m.type === type);
    if (!candidates.length) return null;
    for (const r of REGION_PREF) { const f = candidates.find(m => m.region === r); if (f) return f; }
    return candidates[0];
}

async function scrapeGameById(gameId, ssUser, ssPass, win, metaOnly = false, searchName = '') {
    const game = db.prepare(`
        SELECT g.*, s.screenscraper_id AS system_ss_id
        FROM games g LEFT JOIN systems s ON g.system_id = s.id WHERE g.id=?
    `).get(gameId);
    if (!game) return { ok: false, error: 'Game not found' };

    let apiResult, jeu;
    const refine = (searchName || '').trim();
    if (refine) {
        // Refine-by-name: jeuRecherche returns full jeu objects (incl. medias), best match first.
        const params = { ...ssBaseParams(ssUser, ssPass), recherche: refine };
        if (game.system_ss_id) params.systemeid = game.system_ss_id;
        try { apiResult = await ssApiCall('jeuRecherche.php', params); }
        catch (e) {
            if (/HTTP 404/.test(e.message)) return { ok: false, notFound: true, error: `No ScreenScraper match for “${refine}”.` };
            return { ok: false, error: `API error: ${e.message}` };
        }
        jeu = apiResult.response?.jeux?.[0];
        if (!jeu) return { ok: false, notFound: true, error: `No ScreenScraper match for “${refine}”.` };
    } else {
        // Default: match by ROM filename + CRC/size.
        let crc = '', romSize = 0;
        const romFileName = game.rom_path ? path.basename(game.rom_path) : '';
        if (game.rom_path && fs.existsSync(game.rom_path)) {
            try {
                crc     = await computeFileCrc32(game.rom_path);
                romSize = fs.statSync(game.rom_path).size;
            } catch {}
        }
        const params = { ...ssBaseParams(ssUser, ssPass), romtype: 'rom', romnom: romFileName };
        if (crc)               params.crc       = crc;
        if (romSize)           params.romtaille = romSize;
        if (game.system_ss_id) params.systemeid = game.system_ss_id;
        try { apiResult = await ssApiCall('jeuInfos.php', params); }
        catch (e) {
            // ScreenScraper returns HTTP 404 ("Rom/Iso/Dossier non trouvée") when nothing matches — soft "not found" so the UI can offer a name refine.
            if (/HTTP 404/.test(e.message)) return { ok: false, notFound: true, error: 'Not found on ScreenScraper — try refining the name.' };
            return { ok: false, error: `API error: ${e.message}` };
        }
        jeu = apiResult.response?.jeu;
        if (!jeu) return { ok: false, notFound: true, error: apiResult.response?.msg || 'Not found on ScreenScraper — try refining the name.' };
    }

    // Session info (rate limits)
    const session = {
        requestsToday: apiResult.response?.requeststoday,
        requestsLimit: apiResult.response?.requestslimit,
    };

    // Extract metadata
    const updates = {
        screenscraper_id: jeu.id     || null,
        title:            ssPickRegion(jeu.noms)     || game.title,
        description:      ssPickLang(jeu.synopsis)   || '',
        year:             ssPickYear(jeu.dates)       || '',
        developer:        jeu.developpeur?.text       || '',
        publisher:        jeu.editeur?.text           || '',
        genre:            jeu.genres?.[0]?.noms?.find(n => n.langue === 'en')?.text || '',
        players:          jeu.joueurs?.text           || '',
        rating:           jeu.note?.text              || '',
    };

    // Download media
    if (!metaOnly) {
        const medias = jeu.medias || [];
        const mediaMap = { 'box-2D': 'cover', fanart: 'hero', wheel: 'logo', ss: 'screenshot' };
        const subdirMap = { cover: 'covers', hero: 'heroes', logo: 'logos', screenshot: 'screenshots' };

        for (const [ssType, field] of Object.entries(mediaMap)) {
            const media = ssPickMedia(medias, ssType);
            if (!media?.url) continue;
            const ext     = media.format ? `.${media.format}` : '.jpg';
            const subdir  = subdirMap[field];
            const dest    = path.join(imagesDir, subdir, `${gameId}_${field}${ext}`);
            const dlUrl   = ssMediaUrl(media.url, ssUser, ssPass);
            try { await downloadFile(dlUrl, dest); updates[field] = dest; } catch {}
        }
    }

    // Persist
    const allowed = metaOnly
        ? ['title','description','year','developer','publisher','genre','players','rating','screenscraper_id']
        : ['title','description','year','developer','publisher','genre','players','rating','screenscraper_id','cover','hero','logo','screenshot'];
    const keys   = Object.keys(updates).filter(k => allowed.includes(k));
    const fields = keys.map(k => `${k}=@${k}`).join(', ');
    db.prepare(`UPDATE games SET ${fields} WHERE id=${gameId}`).run(updates);

    return { ok: true, updates, session };
}

let batchScrapeCancel = false;

ipcMain.handle('scrape-game', async (event, gameId, metaOnly = false, searchName = '') => {
    if (!db) return { ok: false, error: 'DB not ready' };
    const ssUser = db.prepare('SELECT value FROM settings WHERE key=?').get('ss_user')?.value;
    const ssPass = db.prepare('SELECT value FROM settings WHERE key=?').get('ss_pass')?.value;
    if (!ssUser || !ssPass) return { ok: false, error: 'ScreenScraper credentials not set. Go to Settings.' };
    return scrapeGameById(gameId, ssUser, ssPass, BrowserWindow.fromWebContents(event.sender), metaOnly, searchName);
});

ipcMain.handle('scrape-batch', async (event, gameIds) => {
    if (!db) return { ok: false, error: 'DB not ready' };
    const ssUser = db.prepare('SELECT value FROM settings WHERE key=?').get('ss_user')?.value;
    const ssPass = db.prepare('SELECT value FROM settings WHERE key=?').get('ss_pass')?.value;
    if (!ssUser || !ssPass) return { ok: false, error: 'ScreenScraper credentials not set. Go to Settings.' };

    batchScrapeCancel = false;
    const win   = BrowserWindow.fromWebContents(event.sender);
    const total = gameIds.length;
    let done = 0, failed = 0;
    let lastSession = null;

    for (const id of gameIds) {
        if (batchScrapeCancel) break;
        const game = db.prepare('SELECT title FROM games WHERE id=?').get(id);
        win?.webContents.send('scrape-progress', { current: done + 1, total, title: game?.title || '', status: 'scraping', session: lastSession });

        const result = await scrapeGameById(id, ssUser, ssPass, win);
        if (result.ok) { if (result.session) lastSession = result.session; }
        else { failed++; }
        done++;

        if (!batchScrapeCancel && done < total) await new Promise(r => setTimeout(r, 1500));
    }

    win?.webContents.send('scrape-progress', { current: done, total, done, status: 'done', failed, session: lastSession });
    return { ok: true, done, failed };
});

ipcMain.handle('cancel-scrape',   () => { batchScrapeCancel = true; });
ipcMain.handle('compute-crc32', async (_, filePath) => {
    try { return await computeFileCrc32(filePath); } catch { return null; }
});

ipcMain.handle('test-ss-credentials', async (_, ssUser, ssPass) => {
    if (!ssUser || !ssPass) return { ok: false, error: 'Enter username and password first.' };
    try {
        const result = await ssApiCall('systemesListe.php', ssBaseParams(ssUser, ssPass));
        const systems = result.response?.systemes;
        if (!systems) return { ok: false, error: result.response?.msg || 'Invalid credentials.' };
        return { ok: true, username: ssUser, systemCount: systems.length };
    } catch(e) {
        const msg = e.message.match(/43[01]|401/) ? 'Invalid credentials.' :
                    e.message.includes('timeout')  ? 'Connection timed out.' : e.message;
        return { ok: false, error: msg };
    }
});

ipcMain.handle('fetch-ss-systems', async () => {
    if (!db) return { ok: false, error: 'DB not ready' };
    const ssUser = db.prepare('SELECT value FROM settings WHERE key=?').get('ss_user')?.value;
    const ssPass = db.prepare('SELECT value FROM settings WHERE key=?').get('ss_pass')?.value;
    if (!ssUser || !ssPass) return { ok: false, error: 'ScreenScraper credentials not set in Settings.' };
    try {
        const result = await ssApiCall('systemesListe.php', ssBaseParams(ssUser, ssPass));
        const systems = result.response?.systemes || [];
        return { ok: true, systems: systems.map(s => ({ id: s.id, name: s.noms?.nom_eu || s.noms?.nom_us || s.noms?.nom_jp || String(s.id) })).sort((a,b) => a.name.localeCompare(b.name)) };
    } catch(e) {
        return { ok: false, error: e.message };
    }
});

// ── RETROARCH DETECTION ───────────────────────────────────────────────────────
function detectRetroArch() {
    const which = spawnSync('which', ['retroarch'], { encoding: 'utf8' });
    if (which.status === 0 && which.stdout.trim()) return 'native';

    const flatpakPaths = [
        '/var/lib/flatpak/app/org.libretro.RetroArch',
        path.join(os.homedir(), '.local', 'share', 'flatpak', 'app', 'org.libretro.RetroArch'),
    ];
    if (flatpakPaths.some(p => fs.existsSync(p))) return 'flatpak';

    return 'none';
}

ipcMain.handle('detect-retroarch', () => {
    if (!db) return 'none';
    const variant = detectRetroArch();
    db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run('retroarch_variant', variant);
    return variant;
});

// ── SYSTEM PRESETS ────────────────────────────────────────────────────────────
ipcMain.handle('get-system-presets', () => {
    try {
        return JSON.parse(fs.readFileSync(path.join(__dirname, 'assets', 'systems.json'), 'utf8'));
    } catch { return []; }
});

// ── CORES ─────────────────────────────────────────────────────────────────────
// Pull a "key = value" / 'key = "value"' field out of a RetroArch .info file.
function infoField(txt, key) {
    const q = txt.match(new RegExp(`^${key}\\s*=\\s*"([^"]*)"`, 'm'));
    if (q) return q[1].trim();
    const u = txt.match(new RegExp(`^${key}\\s*=\\s*(.+?)\\s*$`, 'm'));
    return u ? u[1].trim() : '';
}

function scanCoresNow() {
    if (!db) return { ok: false, error: 'DB not ready' };
    const coreDirs = [
        path.join(os.homedir(), '.config', 'retroarch', 'cores'),
        path.join(os.homedir(), '.var', 'app', 'org.libretro.RetroArch', 'config', 'retroarch', 'cores'),
    ];
    // RetroArch keeps the .info files in a sibling `info/` dir, NOT next to the .so. Look there first
    // (then next to the .so as a fallback) — otherwise no core metadata is found at all.
    const insert = db.prepare(`INSERT OR REPLACE INTO cores
        (path, name, system_names, display_name, supported_extensions, db_names, description)
        VALUES (@path, @name, @system_names, @display_name, @supported_extensions, @db_names, @description)`);
    const insertAll = db.transaction(items => { for (const c of items) insert.run(c); });
    const found = [];
    for (const dir of coreDirs) {
        if (!fs.existsSync(dir)) continue;
        const infoDir = path.join(path.dirname(dir), 'info');
        let files;
        try { files = fs.readdirSync(dir); } catch { continue; }
        for (const file of files.filter(f => f.endsWith('_libretro.so'))) {
            const corePath = path.join(dir, file);
            const base     = file.replace(/\.so$/, '.info');
            const infoPath = [path.join(infoDir, base), path.join(dir, base)].find(p => fs.existsSync(p));
            const rec = {
                path: corePath,
                name: file.replace('_libretro.so', '').replace(/_/g, ' '),
                system_names: '', display_name: '', supported_extensions: '', db_names: '', description: '',
            };
            if (infoPath) {
                try {
                    const txt = fs.readFileSync(infoPath, 'utf8');
                    rec.display_name         = infoField(txt, 'display_name');
                    rec.system_names         = infoField(txt, 'systemname');
                    rec.db_names             = infoField(txt, 'database');
                    rec.supported_extensions = infoField(txt, 'supported_extensions');
                    rec.description          = infoField(txt, 'description');
                    rec.name = rec.display_name || infoField(txt, 'corename') || rec.name;
                } catch {}
            }
            found.push(rec);
        }
    }
    insertAll(found);
    return { ok: true, count: found.length };
}
ipcMain.handle('scan-cores', () => scanCoresNow());

ipcMain.handle('get-cores', () => {
    if (!db) return [];
    return db.prepare('SELECT * FROM cores ORDER BY name').all();
});

// ── CORE DOWNLOADER (libretro buildbot) ───────────────────────────────────────
// Cores install into the SAME dirs scan-cores reads from, so they're picked up immediately.
function buildbotCoreBase() {
    const arch = { x64: 'x86_64', ia32: 'i686', arm64: 'arm64', arm: 'armhf' }[process.arch] || 'x86_64';
    return `https://buildbot.libretro.com/nightly/linux/${arch}/latest`;
}
const coresInstallDir    = () => readRaCfgKey('libretro_directory')  || path.join(getRetroArchCfgDir(), 'cores');
const coreInfoInstallDir = () => readRaCfgKey('libretro_info_path')  || path.join(getRetroArchCfgDir(), 'info');
const prettyCoreName = base => base.replace(/_libretro$/, '').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

let _coreIndexCache = null;
async function fetchCoreIndex(force) {
    if (_coreIndexCache && !force) return _coreIndexCache;
    const { status, body } = await httpsGet(`${buildbotCoreBase()}/.index-extended`);
    if (status !== 200) throw new Error('Core list unavailable (HTTP ' + status + ')');
    const list = body.toString('utf8').split('\n').map(line => {
        const file = line.trim().split(/\s+/).pop();             // "<date> <crc> name_libretro.so.zip"
        if (!file || !file.endsWith('_libretro.so.zip')) return null;
        const so   = file.replace(/\.zip$/, '');                 // name_libretro.so
        const base = so.replace(/\.so$/, '');                    // name_libretro
        return { file, so, base, name: prettyCoreName(base) };
    }).filter(Boolean);
    list.sort((a, b) => a.name.localeCompare(b.name));
    _coreIndexCache = list;
    return list;
}
ipcMain.handle('list-available-cores', async () => {
    try { return { ok: true, cores: await fetchCoreIndex() }; }
    catch (err) { return { ok: false, error: err.message }; }
});
// Download a single core (+ its .info) and install it where RetroArch/EmuLatte look for cores.
ipcMain.handle('install-core', async (e, coreArg) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    let base = String(coreArg || '').split('/').pop().replace(/\.zip$/, '').replace(/\.so$/, '');   // accept name / name_libretro / .so / path
    if (!base) return { ok: false, error: 'No core specified' };
    if (!/_libretro$/.test(base)) base += '_libretro';
    const so = base + '.so', zipName = so + '.zip';
    const tmp = path.join(os.tmpdir(), 'emulatte-' + zipName);
    try {
        await httpsDownload(`${buildbotCoreBase()}/${zipName}`, tmp,
            (got, total) => win?.webContents.send('core-install-progress', { base, got, total }));
        win?.webContents.send('core-install-progress', { base, extracting: true });
        const dir = coresInstallDir(); fs.mkdirSync(dir, { recursive: true });
        const zip = new AdmZip(tmp);
        const entry = zip.getEntries().find(en => en.entryName.endsWith(so)) || zip.getEntries().find(en => en.entryName.endsWith('.so'));
        if (!entry) throw new Error('No .so core found in the downloaded archive');
        fs.writeFileSync(path.join(dir, so), entry.getData());
        try { fs.unlinkSync(tmp); } catch {}
        // best-effort: fetch the matching .info so scan-cores can categorise the new core
        try {
            const info = await httpsGet(`https://raw.githubusercontent.com/libretro/libretro-core-info/master/${base}.info`);
            if (info.status === 200 && info.body?.length) {
                const idir = coreInfoInstallDir(); fs.mkdirSync(idir, { recursive: true });
                fs.writeFileSync(path.join(idir, base + '.info'), info.body);
            }
        } catch {}
        scanCoresNow();
        win?.webContents.send('core-install-progress', { base, done: true });
        return { ok: true, so, path: path.join(dir, so) };
    } catch (err) {
        try { fs.unlinkSync(tmp); } catch {}
        return { ok: false, error: err.message };
    }
});

// ── RETROACHIEVEMENTS ────────────────────────────────────────────────────────

function raApiUrl(endpoint, params) {
    return `https://retroachievements.org/API/${endpoint}?${new URLSearchParams(params).toString()}`;
}
async function raApiCall(endpoint, params) {
    const { status, body } = await httpsGet(raApiUrl(endpoint, params));
    if (status !== 200) throw new Error(`HTTP ${status}`);
    const text = body.toString('utf8');
    try { return JSON.parse(text); }
    catch { throw new Error(text.slice(0, 120) || 'Invalid JSON from RetroAchievements'); }
}
function computeFileMd5(filePath) {
    return new Promise((resolve, reject) => {
        const hash   = crypto.createHash('md5');
        const stream = fs.createReadStream(filePath);
        stream.on('data',  chunk => hash.update(chunk));
        stream.on('end',   ()    => resolve(hash.digest('hex')));
        stream.on('error', err   => reject(err));
    });
}
function raMapAchievements(rows) {
    return rows.map(a => ({
        name:           a.title,
        description:    a.description,
        points:         a.points,
        date_unlocked:  a.date_earned || null,
        image_unlocked: `https://media.retroachievements.org/Badge/${a.badge_name}.png`,
        image_locked:   `https://media.retroachievements.org/Badge/${a.badge_name}_lock.png`,
    }));
}

ipcMain.handle('test-ra-credentials', async (_, user, key) => {
    if (!user || !key) return { ok: false, error: 'Enter username and API key first.' };
    try {
        const result = await raApiCall('API_GetUserSummary.php', { z: user, y: key, u: user, g: 1 });
        if (result.Error) return { ok: false, error: result.Error };
        return { ok: true, username: result.User || user };
    } catch(e) { return { ok: false, error: e.message }; }
});

ipcMain.handle('fetch-ra-achievements', async (_, gameId) => {
    if (!db) return { ok: false, error: 'DB not ready' };
    const raUser = db.prepare('SELECT value FROM settings WHERE key=?').get('ra_user')?.value;
    const raKey  = db.prepare('SELECT value FROM settings WHERE key=?').get('ra_api_key')?.value;
    if (!raUser || !raKey) return { ok: false, error: 'RetroAchievements credentials not set in Settings.' };

    const game = db.prepare('SELECT * FROM games WHERE id=?').get(gameId);
    if (!game) return { ok: false, error: 'Game not found.' };

    let raGameId = game.ra_game_id;
    if (!raGameId && game.rom_path && fs.existsSync(game.rom_path)) {
        try {
            const md5 = await computeFileMd5(game.rom_path);
            const r   = await raApiCall('API_GetGameInfoByHash.php', { z: raUser, y: raKey, m: md5 });
            raGameId  = r?.GameID || 0;
            if (raGameId) db.prepare('UPDATE games SET ra_game_id=? WHERE id=?').run(raGameId, gameId);
        } catch {}
    }
    if (!raGameId) return { ok: false, error: 'Game not found on RetroAchievements. Set the RA Game ID manually in Edit ROM.' };

    try {
        const data = await raApiCall('API_GetGameInfoAndUserProgress.php', { z: raUser, y: raKey, u: raUser, g: raGameId });
        if (data.Error) return { ok: false, error: data.Error };

        const achievements = Object.values(data.Achievements || {}).map(a => ({
            ach_id:      String(a.ID),
            title:       a.Title       || '',
            description: a.Description || '',
            points:      a.Points      || 0,
            badge_name:  a.BadgeName   || '',
            date_earned: a.DateEarned  ? a.DateEarned.replace(' ', 'T') : null,
        }));

        const ins = db.prepare(`INSERT OR REPLACE INTO ra_achievements
            (ra_game_id,ach_id,title,description,points,badge_name,date_earned)
            VALUES (@ra_game_id,@ach_id,@title,@description,@points,@badge_name,@date_earned)`);
        db.transaction(list => list.forEach(a => ins.run({ ra_game_id: raGameId, ...a })))(achievements);

        return { ok: true, raGameId, achievements: raMapAchievements(achievements) };
    } catch(e) { return { ok: false, error: e.message }; }
});

ipcMain.handle('get-ra-achievements', (_, raGameId) => {
    if (!db || !raGameId) return { ok: false, achievements: [] };
    const rows = db.prepare('SELECT * FROM ra_achievements WHERE ra_game_id=?').all(raGameId);
    if (!rows.length) return { ok: false, achievements: [] };
    return { ok: true, achievements: raMapAchievements(rows) };
});

// ── ART PICKER ────────────────────────────────────────────────────────────────
ipcMain.handle('sgdb-search-art', async (_, gameName, assetType) => {
    const apiKey = db?.prepare('SELECT value FROM settings WHERE key=?').get('sgdb_api_key')?.value;
    if (!apiKey) return { ok: false, error: 'No SteamGridDB API key set in Settings.' };
    try {
        const headers = { 'Authorization': `Bearer ${apiKey}` };
        const searchRes  = await fetch(`https://www.steamgriddb.com/api/v2/search/autocomplete/${encodeURIComponent(gameName)}`, { headers });
        const searchData = await searchRes.json();
        if (!searchData.success || !searchData.data?.length) return { ok: true, results: [] };
        const sgdbId = searchData.data[0].id;

        const endpointMap = { cover: 'grids', hero: 'heroes', logo: 'logos', screenshot: 'grids' };
        const endpoint = endpointMap[assetType] || 'grids';
        const query    = assetType === 'cover' ? '?dimensions=600x900' : '';
        const artRes   = await fetch(`https://www.steamgriddb.com/api/v2/${endpoint}/game/${sgdbId}${query}`, { headers });
        const artData  = await artRes.json();
        if (!artData.success) return { ok: true, results: [] };
        return { ok: true, results: artData.data.map(g => ({ thumb: g.thumb, url: g.url })) };
    } catch(e) { return { ok: false, error: e.message }; }
});

ipcMain.handle('sgdb-apply-art', async (_, gameId, url, assetType) => {
    if (!db) return { ok: false };
    const subdir = { cover: 'covers', hero: 'heroes', logo: 'logos', screenshot: 'screenshots' }[assetType] || 'covers';
    const ext  = url.split('.').pop().split('?')[0] || 'jpg';
    const dest = path.join(imagesDir, subdir, `${gameId}_${assetType}_${Date.now()}.${ext}`);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    // ScreenScraper media arrives as a credential-free base URL; add the user's credentials here
    // (in the main process) rather than ever exposing them to the renderer. Other sources' URLs
    // are already complete and pass through untouched.
    let fetchUrl = url;
    if (url.includes('screenscraper.fr')) {
        const ssUser = db.prepare('SELECT value FROM settings WHERE key=?').get('ss_user')?.value;
        const ssPass = db.prepare('SELECT value FROM settings WHERE key=?').get('ss_pass')?.value;
        if (ssUser && ssPass) fetchUrl = ssMediaUrl(url, ssUser, ssPass);
    }
    try {
        const res = await fetch(fetchUrl);
        if (!res.ok) return { ok: false };
        fs.writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
        if (assetType === 'screenshot') {
            const cur    = db.prepare('SELECT screenshot FROM games WHERE id=?').get(gameId)?.screenshot || '';
            const newVal = cur ? `${cur}|${dest}` : dest;
            db.prepare('UPDATE games SET screenshot=? WHERE id=?').run(newVal, gameId);
        } else {
            db.prepare(`UPDATE games SET ${assetType}=? WHERE id=?`).run(dest, gameId);
        }
        return { ok: true, path: dest };
    } catch(e) {
        // Never echo the URL back — fetch errors can embed it, and SS URLs carry credentials.
        return { ok: false, error: String(e?.message || e).replace(/https?:\/\/\S+/gi, '[url]') };
    }
});

ipcMain.handle('delete-game-art', (_, gameId, assetType) => {
    if (!db) return false;
    const allowed = ['cover', 'hero', 'logo', 'screenshot'];
    if (!allowed.includes(assetType)) return false;
    db.prepare(`UPDATE games SET ${assetType}=NULL WHERE id=?`).run(gameId);
    return true;
});

ipcMain.handle('ss-search-art', async (_, gameId, assetType) => {
    if (!db) return { ok: false, error: 'DB not ready' };
    const ssUser = db.prepare('SELECT value FROM settings WHERE key=?').get('ss_user')?.value;
    const ssPass = db.prepare('SELECT value FROM settings WHERE key=?').get('ss_pass')?.value;
    if (!ssUser || !ssPass) return { ok: false, error: 'ScreenScraper credentials not set in Settings.' };

    const game = db.prepare(`SELECT g.*, s.screenscraper_id AS system_ss_id
        FROM games g LEFT JOIN systems s ON g.system_id=s.id WHERE g.id=?`).get(gameId);
    if (!game) return { ok: false, error: 'Game not found.' };

    const romFileName = game.rom_path ? path.basename(game.rom_path) : (game.title + '.rom');
    let crc = '', romSize = 0;
    if (game.rom_path && fs.existsSync(game.rom_path)) {
        try { crc = await computeFileCrc32(game.rom_path); romSize = fs.statSync(game.rom_path).size; } catch {}
    }
    const params = {
        ...ssBaseParams(ssUser, ssPass),
        romtype: 'rom', romnom: romFileName,
    };
    if (crc)               params.crc       = crc;
    if (romSize)           params.romtaille = romSize;
    if (game.system_ss_id) params.systemeid = game.system_ss_id;

    let apiResult;
    try { apiResult = await ssApiCall('jeuInfos.php', params); }
    catch(e) { return { ok: false, error: e.message }; }

    const jeu = apiResult.response?.jeu;
    if (!jeu) return { ok: false, error: apiResult.response?.msg || 'Game not found on ScreenScraper.' };

    const typeMap = {
        cover:      ['box-2D', 'box-2D-side', 'box-3D'],
        hero:       ['fanart', 'ss', 'sstitle'],
        logo:       ['wheel', 'wheel-carbon', 'wheel-steel'],
        screenshot: ['ss', 'sstitle', 'fanart'],
    };
    const wanted = new Set(typeMap[assetType] || ['box-2D']);
    // Return the credential-free base URL only (SS now embeds creds in m.url — strip them). The
    // renderer displays it via the ssimg:// proxy and passes it back to sgdb-apply-art, both of
    // which add credentials in the main process.
    const results = (jeu.medias || [])
        .filter(m => wanted.has(m.type))
        .map(m => ({ thumb: ssStripCreds(m.url), url: ssStripCreds(m.url) }));
    return { ok: true, results };
});

ipcMain.handle('tgdb-search-art', async (_, gameName, assetType, systemShortName) => {
    const apiKey = db?.prepare('SELECT value FROM settings WHERE key=?').get('tgdb_api_key')?.value;
    if (!apiKey) return { ok: false, error: 'TheGamesDB API key not set in Settings.' };
    try {
        const tgdbPlatId = systemShortName ? PLATFORM_MAP[systemShortName]?.tgdb : null;
        const platformFilter = tgdbPlatId ? `&filter[platform]=${tgdbPlatId}` : '';
        const { status, body } = await httpsGet(
            `https://api.thegamesdb.net/v1/Games/ByGameName?apikey=${encodeURIComponent(apiKey)}&name=${encodeURIComponent(gameName)}&fields=overview&include=boxart${platformFilter}`
        );
        if (status !== 200) return { ok: false, error: `HTTP ${status}` };
        const data = JSON.parse(body.toString('utf8'));
        if (!data.data?.games?.length) return { ok: true, results: [] };

        const gId        = data.data.games[0].id;
        const boxartBase = data.include?.boxart?.base_url?.original || '';
        const boxarts    = data.include?.boxart?.data?.[String(gId)] || [];
        const typeMap    = { cover: ['boxart'], hero: ['fanart'], logo: ['clearlogo'], screenshot: ['screenshot', 'titlescreen'] };
        const wanted     = new Set(typeMap[assetType] || ['boxart']);

        const results = boxarts
            .filter(b => wanted.has(b.type))
            .map(b => ({ thumb: `${boxartBase}${b.filename}`, url: `${boxartBase}${b.filename}` }));
        return { ok: true, results };
    } catch(e) { return { ok: false, error: e.message }; }
});

ipcMain.handle('igdb-search-art', async (_, gameName, assetType, systemShortName) => {
    if (assetType === 'logo') return { ok: false, error: 'IGDB does not provide logo/wheel artwork.' };
    const clientId     = db?.prepare('SELECT value FROM settings WHERE key=?').get('igdb_client_id')?.value;
    const clientSecret = db?.prepare('SELECT value FROM settings WHERE key=?').get('igdb_client_secret')?.value;
    if (!clientId || !clientSecret) return { ok: false, error: 'IGDB credentials not set in Settings.' };
    try {
        const token      = await getIgdbToken(clientId, clientSecret);
        const escaped    = gameName.replace(/"/g, '');
        const igdbPlatId = systemShortName ? PLATFORM_MAP[systemShortName]?.igdb : null;
        const whereClause = igdbPlatId ? `where platforms = [${igdbPlatId}];` : '';
        const results = await igdbQuery('games',
            `fields cover.url,screenshots.url; search "${escaped}"; ${whereClause} limit 1;`,
            clientId, token);
        if (!results.length) return { ok: true, results: [] };
        const g = results[0];
        let items = [];
        if (assetType === 'cover' && g.cover?.url) {
            items = [{ url: igdbImg(g.cover.url, 'cover_big'), thumb: igdbImg(g.cover.url, 'cover_big') }];
        } else if ((assetType === 'hero' || assetType === 'screenshot') && g.screenshots?.length) {
            items = g.screenshots.map(s => ({
                url:   igdbImg(s.url, 'screenshot_big'),
                thumb: igdbImg(s.url, 'screenshot_med'),
            }));
        }
        return { ok: true, results: items };
    } catch(e) { return { ok: false, error: e.message }; }
});

// ── BIOS MANAGER ──────────────────────────────────────────────────────────────
// EmuLatte never downloads BIOS (copyrighted firmware). It only verifies and installs
// files the user already owns into RetroArch's system/ folder. Database in assets/bios_db.json.
let biosDb = {};
try { biosDb = JSON.parse(fs.readFileSync(path.join(__dirname, 'assets', 'bios_db.json'), 'utf8')); } catch {}

function md5File(p) {
    try { return crypto.createHash('md5').update(fs.readFileSync(p)).digest('hex'); } catch { return null; }
}

function getRetroArchSystemDir() {
    const variant = db?.prepare('SELECT value FROM settings WHERE key=?').get('retroarch_variant')?.value || detectRetroArch();
    const cfgDir = variant === 'flatpak'
        ? path.join(os.homedir(), '.var', 'app', 'org.libretro.RetroArch', 'config', 'retroarch')
        : path.join(os.homedir(), '.config', 'retroarch');
    try {
        const m = fs.readFileSync(path.join(cfgDir, 'retroarch.cfg'), 'utf8').match(/^\s*system_directory\s*=\s*"([^"]*)"/m);
        if (m && m[1] && m[1] !== 'default') {
            const dir = m[1].replace(/^~(?=[/\\])/, os.homedir()).replace(/^:/, cfgDir);
            if (fs.existsSync(dir)) return dir;
        }
    } catch {}
    return path.join(cfgDir, 'system');
}

function walkFiles(dir, depth = 0, acc = []) {
    if (depth > 4 || acc.length > 8000) return acc;
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return acc; }
    for (const e of entries) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) walkFiles(full, depth + 1, acc);
        else acc.push(full);
    }
    return acc;
}

ipcMain.handle('bios-status', (_, shortName) => {
    const entry = biosDb[shortName];
    if (!entry || !entry.files) return { ok: true, files: [], note: '' };
    const sysDir = getRetroArchSystemDir();
    const files = entry.files.map(b => {
        const dest = path.join(sysDir, b.file);
        let status = 'missing';
        if (fs.existsSync(dest)) status = (b.md5 && md5File(dest) === b.md5.toLowerCase()) ? 'verified' : 'present';
        return { file: b.file, required: !!b.required, region: b.region || '', status };
    });
    return { ok: true, files, note: entry.note || '', systemDir: sysDir };
});

ipcMain.handle('bios-add-file', async (event, shortName, biosFile) => {
    const spec = biosDb[shortName]?.files?.find(b => b.file === biosFile);
    if (!spec) return { ok: false, error: 'Unknown BIOS file.' };
    const win = BrowserWindow.fromWebContents(event.sender);
    const res = await dialog.showOpenDialog(win, { title: `Select ${biosFile}`, properties: ['openFile'] });
    if (res.canceled || !res.filePaths[0]) return { ok: false, canceled: true };
    const verified = spec.md5 ? (md5File(res.filePaths[0]) === spec.md5.toLowerCase()) : null;
    const sysDir = getRetroArchSystemDir();
    try {
        fs.mkdirSync(sysDir, { recursive: true });
        fs.copyFileSync(res.filePaths[0], path.join(sysDir, biosFile));
    } catch (e) { return { ok: false, error: e.message }; }
    return { ok: true, verified, md5Known: !!spec.md5 };
});

ipcMain.handle('bios-scan-folder', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const res = await dialog.showOpenDialog(win, { title: 'Select a folder containing your BIOS files', properties: ['openDirectory'] });
    if (res.canceled || !res.filePaths[0]) return { ok: false, canceled: true };

    const byMd5 = {}, byName = {};
    for (const sys of Object.values(biosDb)) {
        for (const b of (sys.files || [])) {
            if (b.md5) byMd5[b.md5.toLowerCase()] = b.file;
            byName[b.file.toLowerCase()] = b.file;
        }
    }
    const sysDir = getRetroArchSystemDir();
    try { fs.mkdirSync(sysDir, { recursive: true }); } catch (e) { return { ok: false, error: e.message }; }

    const installed = new Set();
    for (const f of walkFiles(res.filePaths[0])) {
        let size = 0; try { size = fs.statSync(f).size; } catch { continue; }
        const byHash = size <= 16 * 1024 * 1024 ? byMd5[md5File(f)] : null;   // hash only small files (skip ROMs)
        const target = byHash || byName[path.basename(f).toLowerCase()];
        if (!target) continue;
        try { fs.copyFileSync(f, path.join(sysDir, target)); installed.add(target); } catch {}
    }
    return { ok: true, installed: [...installed], systemDir: sysDir };
});

// ── CNGM CREDENTIAL IMPORT ────────────────────────────────────────────────────
ipcMain.handle('import-cngm-credentials', () => {
    const cngmDb = path.join(baseDir, 'GameManagerConfig', 'games.db');
    if (!fs.existsSync(cngmDb)) return { ok: false, error: 'CNGM database not found. Make sure CNGM is installed in the same folder.' };
    try {
        const cdb = new Database(cngmDb, { readonly: true, timeout: 3000 });
        const get = (key) => cdb.prepare('SELECT value FROM settings WHERE key=?').get(key)?.value || '';
        const result = {
            igdb_client_id:     get('igdb_client_id'),
            igdb_client_secret: get('igdb_client_secret'),
            sgdb_api_key:       get('steamgriddb_api'),
        };
        cdb.close();
        const found = Object.values(result).some(v => v);
        if (!found) return { ok: false, error: 'No IGDB or SteamGridDB credentials found in CNGM.' };
        return { ok: true, ...result };
    } catch(e) { return { ok: false, error: e.message }; }
});

// ── IGDB ──────────────────────────────────────────────────────────────────────
let _igdbToken = null;
let _igdbTokenExp = 0;

async function getIgdbToken(clientId, clientSecret) {
    if (_igdbToken && Date.now() < _igdbTokenExp) return _igdbToken;
    const res = await fetch(
        `https://id.twitch.tv/oauth2/token?client_id=${encodeURIComponent(clientId)}&client_secret=${encodeURIComponent(clientSecret)}&grant_type=client_credentials`,
        { method: 'POST' }
    );
    if (!res.ok) throw new Error(`Twitch OAuth error ${res.status}`);
    const data = await res.json();
    _igdbToken    = data.access_token;
    _igdbTokenExp = Date.now() + (data.expires_in - 60) * 1000;
    return _igdbToken;
}

async function igdbQuery(endpoint, body, clientId, token) {
    const res = await fetch(`https://api.igdb.com/v4/${endpoint}`, {
        method: 'POST',
        headers: { 'Client-ID': clientId, 'Authorization': `Bearer ${token}`, 'Content-Type': 'text/plain' },
        body,
    });
    if (!res.ok) throw new Error(`IGDB HTTP ${res.status}`);
    return res.json();
}

function igdbImg(url, size) {
    if (!url) return null;
    return `https:${url.replace('t_thumb', `t_${size}`)}`;
}

ipcMain.handle('test-igdb-credentials', async (_, clientId, clientSecret) => {
    if (!clientId || !clientSecret) return { ok: false, error: 'Enter Client ID and Client Secret first.' };
    try {
        _igdbToken = null;
        await getIgdbToken(clientId, clientSecret);
        return { ok: true };
    } catch(e) { return { ok: false, error: e.message }; }
});

ipcMain.handle('igdb-scrape-game', async (_, gameId, metaOnly = false) => {
    if (!db) return { ok: false, error: 'DB not ready' };
    const game = db.prepare(`SELECT g.*, s.short_name AS system_short
        FROM games g LEFT JOIN systems s ON g.system_id=s.id WHERE g.id=?`).get(gameId);
    if (!game) return { ok: false, error: 'Game not found.' };

    const clientId     = db.prepare('SELECT value FROM settings WHERE key=?').get('igdb_client_id')?.value;
    const clientSecret = db.prepare('SELECT value FROM settings WHERE key=?').get('igdb_client_secret')?.value;
    if (!clientId || !clientSecret) return { ok: false, error: 'IGDB credentials not set in Settings.' };

    try {
        const token      = await getIgdbToken(clientId, clientSecret);
        const escaped    = game.title.replace(/"/g, '');
        const igdbPlatId = PLATFORM_MAP[game.system_short]?.igdb;
        const whereClause = igdbPlatId ? `where platforms = [${igdbPlatId}];` : '';
        const results = await igdbQuery('games',
            `fields name,summary,first_release_date,genres.name,involved_companies.developer,involved_companies.publisher,involved_companies.company.name,cover.url,screenshots.url,videos.video_id,rating; search "${escaped}"; ${whereClause} limit 1;`,
            clientId, token);
        if (!results.length) return { ok: false, error: `No IGDB results for "${game.title}"` };

        const g = results[0];
        const updates = {};
        if (g.summary)              updates.description = g.summary;
        if (g.first_release_date)   updates.year        = new Date(g.first_release_date * 1000).getFullYear().toString();
        if (g.rating)               updates.rating      = (g.rating / 10).toFixed(1);
        if (g.genres?.length)       updates.genre       = g.genres.map(x => x.name).join(', ');

        const devs = (g.involved_companies || []).filter(c => c.developer).map(c => c.company?.name).filter(Boolean);
        const pubs = (g.involved_companies || []).filter(c => c.publisher).map(c => c.company?.name).filter(Boolean);
        if (devs.length) updates.developer = devs[0];
        if (pubs.length) updates.publisher = pubs[0];
        if (g.videos?.length) updates.igdb_trailer = g.videos[0].video_id;

        if (!metaOnly) {
            if (g.cover?.url) {
                const dest = path.join(imagesDir, 'covers', `${gameId}.jpg`);
                fs.mkdirSync(path.dirname(dest), { recursive: true });
                await downloadFile(igdbImg(g.cover.url, 'cover_big'), dest);
                updates.cover = dest;
            }
            if (g.screenshots?.length) {
                const heroUrl  = igdbImg(g.screenshots[0].url, 'screenshot_big');
                const heroDest = path.join(imagesDir, 'heroes', `${gameId}.jpg`);
                fs.mkdirSync(path.dirname(heroDest), { recursive: true });
                await downloadFile(heroUrl, heroDest);
                updates.hero = heroDest;
                const ssDest = path.join(imagesDir, 'screenshots', `${gameId}.jpg`);
                fs.mkdirSync(path.dirname(ssDest), { recursive: true });
                await downloadFile(igdbImg(g.screenshots[0].url, 'screenshot_big'), ssDest);
                updates.screenshot = ssDest;
            }
        }

        if (Object.keys(updates).length) {
            const sets = Object.keys(updates).map(k => `${k}=@${k}`).join(',');
            db.prepare(`UPDATE games SET ${sets} WHERE id=@id`).run({ ...updates, id: gameId });
        }
        return { ok: true, updated: Object.keys(updates) };
    } catch(e) { return { ok: false, error: e.message }; }
});

// ── THEGAMESDB ────────────────────────────────────────────────────────────────
ipcMain.handle('test-tgdb-key', async (_, apiKey) => {
    if (!apiKey) return { ok: false, error: 'Enter API key first.' };
    try {
        const { status, body } = await httpsGet(
            `https://api.thegamesdb.net/v1/Games/ByGameName?apikey=${encodeURIComponent(apiKey)}&name=mario&fields=overview`
        );
        if (status === 403) return { ok: false, error: 'Invalid API key.' };
        if (status !== 200) return { ok: false, error: `HTTP ${status}` };
        const data = JSON.parse(body.toString('utf8'));
        if (data.code !== 200) return { ok: false, error: data.status || 'API error' };
        return { ok: true };
    } catch(e) { return { ok: false, error: e.message }; }
});

ipcMain.handle('tgdb-scrape-game', async (_, gameId, metaOnly = false) => {
    if (!db) return { ok: false, error: 'DB not ready' };
    const game = db.prepare(`SELECT g.*, s.short_name AS system_short
        FROM games g LEFT JOIN systems s ON g.system_id=s.id WHERE g.id=?`).get(gameId);
    if (!game) return { ok: false, error: 'Game not found.' };

    const apiKey = db.prepare('SELECT value FROM settings WHERE key=?').get('tgdb_api_key')?.value;
    if (!apiKey) return { ok: false, error: 'TheGamesDB API key not set in Settings.' };

    try {
        const tgdbPlatId = PLATFORM_MAP[game.system_short]?.tgdb;
        const platformFilter = tgdbPlatId ? `&filter[platform]=${tgdbPlatId}` : '';
        const { status, body } = await httpsGet(
            `https://api.thegamesdb.net/v1/Games/ByGameName?apikey=${encodeURIComponent(apiKey)}&name=${encodeURIComponent(game.title)}&fields=overview,rating,players,release_date&include=boxart${platformFilter}`
        );
        if (status !== 200) return { ok: false, error: `HTTP ${status}` };
        const data = JSON.parse(body.toString('utf8'));
        if (!data.data?.games?.length) return { ok: false, error: `No TheGamesDB results for "${game.title}"` };

        const g    = data.data.games[0];
        const gId  = g.id;
        const updates = {};
        if (g.overview)     updates.description = g.overview;
        if (g.rating)       updates.rating      = g.rating;
        if (g.players)      updates.players     = String(g.players);
        if (g.release_date) updates.year        = g.release_date.slice(0, 4);

        const boxartBase = data.include?.boxart?.base_url?.original;
        const boxarts    = data.include?.boxart?.data?.[String(gId)] || [];
        const byType     = (t) => boxarts.find(b => b.type === t);

        async function fetchBoxart(type, subdir, field) {
            const b = byType(type);
            if (!b || !boxartBase) return;
            const ext  = b.filename.split('.').pop() || 'jpg';
            const dest = path.join(imagesDir, subdir, `${gameId}.${ext}`);
            fs.mkdirSync(path.dirname(dest), { recursive: true });
            await downloadFile(`${boxartBase}${b.filename}`, dest);
            updates[field] = dest;
        }

        if (!metaOnly) {
            await fetchBoxart('boxart',    'covers',      'cover');
            await fetchBoxart('fanart',    'heroes',      'hero');
            await fetchBoxart('clearlogo', 'logos',       'logo');

            const ss = byType('screenshot') || byType('titlescreen');
            if (ss && boxartBase) {
                const ext  = ss.filename.split('.').pop() || 'jpg';
                const dest = path.join(imagesDir, 'screenshots', `${gameId}.${ext}`);
                fs.mkdirSync(path.dirname(dest), { recursive: true });
                await downloadFile(`${boxartBase}${ss.filename}`, dest);
                updates.screenshot = dest;
            }
        }

        if (Object.keys(updates).length) {
            const sets = Object.keys(updates).map(k => `${k}=@${k}`).join(',');
            db.prepare(`UPDATE games SET ${sets} WHERE id=@id`).run({ ...updates, id: gameId });
        }
        return { ok: true, updated: Object.keys(updates) };
    } catch(e) { return { ok: false, error: e.message }; }
});

// ── STEAMGRIDDB ───────────────────────────────────────────────────────────────
async function sgdbFetch(sgdbPath, apiKey) {
    const res = await fetch(`https://www.steamgriddb.com/api/v2${sgdbPath}`, {
        headers: { 'Authorization': `Bearer ${apiKey}` },
    });
    if (!res.ok) throw new Error(`SGDB HTTP ${res.status}`);
    return res.json();
}

ipcMain.handle('test-sgdb-key', async (_, apiKey) => {
    if (!apiKey) return { ok: false, error: 'Enter API key first.' };
    try {
        const data = await sgdbFetch('/search/autocomplete/mario', apiKey);
        if (!data.success) return { ok: false, error: data.errors?.join(', ') || 'API error' };
        return { ok: true };
    } catch(e) { return { ok: false, error: e.message }; }
});

ipcMain.handle('sgdb-scrape-game', async (_, gameId) => {
    if (!db) return { ok: false, error: 'DB not ready' };
    const game = db.prepare('SELECT * FROM games WHERE id=?').get(gameId);
    if (!game) return { ok: false, error: 'Game not found.' };

    const apiKey = db.prepare('SELECT value FROM settings WHERE key=?').get('sgdb_api_key')?.value;
    if (!apiKey) return { ok: false, error: 'SteamGridDB API key not set in Settings.' };

    try {
        const search = await sgdbFetch(`/search/autocomplete/${encodeURIComponent(game.title)}`, apiKey);
        if (!search.success || !search.data?.length) return { ok: false, error: `No SteamGridDB results for "${game.title}"` };

        const sgdbId = search.data[0].id;
        const updates = {};

        async function fetchSgdbArt(type, subdir, field, query = '') {
            try {
                const data = await sgdbFetch(`/${type}/game/${sgdbId}${query}`, apiKey);
                if (!data.success || !data.data?.length) return;
                const url  = data.data[0].url;
                const ext  = url.split('.').pop().split('?')[0] || 'png';
                const dest = path.join(imagesDir, subdir, `${gameId}.${ext}`);
                fs.mkdirSync(path.dirname(dest), { recursive: true });
                await downloadFile(url, dest);
                updates[field] = dest;
            } catch {}
        }

        await fetchSgdbArt('grids',  'covers', 'cover', '?dimensions=600x900');
        await fetchSgdbArt('heroes', 'heroes', 'hero');
        await fetchSgdbArt('logos',  'logos',  'logo');

        if (Object.keys(updates).length) {
            const sets = Object.keys(updates).map(k => `${k}=@${k}`).join(',');
            db.prepare(`UPDATE games SET ${sets} WHERE id=@id`).run({ ...updates, id: gameId });
        }
        return { ok: true, updated: Object.keys(updates) };
    } catch(e) { return { ok: false, error: e.message }; }
});

// ── MOBYGAMES ─────────────────────────────────────────────────────────────────

function mobyApiUrl(endpoint, params = {}) {
    const apiKey = db?.prepare('SELECT value FROM settings WHERE key=?').get('moby_api_key')?.value || '';
    return `https://api.mobygames.com/v1/${endpoint}?api_key=${encodeURIComponent(apiKey)}&${new URLSearchParams(params).toString()}`;
}

function cleanRomTitle(raw) {
    return (raw || '')
        .replace(/\.[^.]+$/, '')
        .replace(/\s*\([^)]*\)/g, '')
        .replace(/\s*\[[^\]]*\]/g, '')
        .replace(/_/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

ipcMain.handle('test-moby-key', async (_, key) => {
    if (!key) return { ok: false, error: 'Enter API key first.' };
    try {
        const res = await fetch(`https://api.mobygames.com/v1/games?api_key=${encodeURIComponent(key)}&title=Pac-Man&limit=1`);
        if (res.status === 401) return { ok: false, error: 'Invalid API key.' };
        if (res.status === 429) return { ok: false, error: 'Rate limit hit — key is valid but try again later.' };
        if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
        return { ok: true };
    } catch(e) { return { ok: false, error: e.message }; }
});

ipcMain.handle('moby-scrape-game', async (_, gameId, metaOnly = false) => {
    if (!db) return { ok: false, error: 'DB not ready' };
    const apiKey = db.prepare('SELECT value FROM settings WHERE key=?').get('moby_api_key')?.value;
    if (!apiKey) return { ok: false, error: 'MobyGames API key not set in Settings.' };

    const game = db.prepare(`SELECT g.*, s.short_name AS system_short
        FROM games g LEFT JOIN systems s ON g.system_id=s.id WHERE g.id=?`).get(gameId);
    if (!game) return { ok: false, error: 'Game not found.' };

    try {
        const searchTitle = cleanRomTitle(game.title);
        const mobyPlatId  = PLATFORM_MAP[game.system_short]?.moby || null;
        const platParam   = mobyPlatId ? { platform: mobyPlatId } : {};
        const searchRes   = await fetch(mobyApiUrl('games', { title: searchTitle, limit: 5, ...platParam }));
        if (searchRes.status === 401) return { ok: false, error: 'Invalid MobyGames API key.' };
        if (searchRes.status === 429) return { ok: false, error: 'MobyGames rate limit reached (360/hr). Try again later.' };
        if (!searchRes.ok) return { ok: false, error: `Search failed: HTTP ${searchRes.status}` };
        const searchData = await searchRes.json();
        if (!searchData.games?.length) return { ok: false, error: `No MobyGames results for "${searchTitle}"` };

        const mg      = searchData.games[0];
        const mobyId  = mg.game_id;
        const updates = {};

        if (mg.description && !game.description)
            updates.description = mg.description.replace(/<[^>]+>/g, '');
        if (mg.genres?.length && !game.genre)
            updates.genre = mg.genres.map(g => g.genre_name).join(', ');

        // Year: earliest release across all platforms
        const dates = (mg.platforms || [])
            .map(p => p.first_release_date).filter(Boolean)
            .map(d => parseInt(d.slice(0, 4))).filter(n => !isNaN(n));
        if (dates.length && !game.year)
            updates.year = String(Math.min(...dates));

        if (metaOnly) {
            if (Object.keys(updates).length) {
                const sets = Object.keys(updates).map(k => `${k}=@${k}`).join(',');
                db.prepare(`UPDATE games SET ${sets} WHERE id=@id`).run({ ...updates, id: gameId });
            }
            return { ok: true, updated: Object.keys(updates) };
        }

        // Cover art
        const coversRes = await fetch(mobyApiUrl(`games/${mobyId}/covers`));
        if (coversRes.ok) {
            const coversData = await coversRes.json();
            let frontUrl = null;
            // Prefer platform-matched group, fall back to any group
            for (const pass of [true, false]) {
                for (const group of coversData.cover_groups || []) {
                    if (pass && mobyPlatId && group.platform?.platform_id !== mobyPlatId) continue;
                    const front = (group.covers || []).find(c => c.scan_of === 'Front Cover');
                    if (front?.image) { frontUrl = front.image; break; }
                }
                if (frontUrl) break;
            }
            if (frontUrl && !game.cover) {
                const ext  = path.extname(new URL(frontUrl).pathname) || '.jpg';
                const dest = path.join(imagesDir, 'covers', `${gameId}${ext}`);
                await downloadFile(frontUrl, dest);
                updates.cover = dest;
            }
        }

        // Screenshots
        const ssParams = mobyPlatId ? { platform: mobyPlatId } : {};
        const ssRes = await fetch(mobyApiUrl(`games/${mobyId}/screenshots`, ssParams));
        if (ssRes.ok) {
            const ssData = await ssRes.json();
            const first  = ssData.screenshots?.[0]?.image;
            if (first && !game.screenshot) {
                const ext  = path.extname(new URL(first).pathname) || '.jpg';
                const dest = path.join(imagesDir, 'screenshots', `${gameId}${ext}`);
                await downloadFile(first, dest);
                updates.screenshot = dest;
            }
            if (first && !game.hero) {
                const ext  = path.extname(new URL(first).pathname) || '.jpg';
                const dest = path.join(imagesDir, 'heroes', `${gameId}${ext}`);
                await downloadFile(first, dest);
                updates.hero = dest;
            }
        }

        if (Object.keys(updates).length) {
            const sets = Object.keys(updates).map(k => `${k}=@${k}`).join(',');
            db.prepare(`UPDATE games SET ${sets} WHERE id=@id`).run({ ...updates, id: gameId });
        }
        return { ok: true, updated: Object.keys(updates) };
    } catch(e) { return { ok: false, error: e.message }; }
});

ipcMain.handle('moby-search-art', async (_, gameName, assetType, systemShortName) => {
    const apiKey = db?.prepare('SELECT value FROM settings WHERE key=?').get('moby_api_key')?.value;
    if (!apiKey) return { ok: false, error: 'MobyGames API key not set in Settings.' };
    if (assetType === 'logo') return { ok: false, error: 'MobyGames does not provide logo/wheel artwork.' };
    try {
        const mobyPlatId = systemShortName ? PLATFORM_MAP[systemShortName]?.moby : null;
        const platParam  = mobyPlatId ? { platform: mobyPlatId } : {};
        const searchRes  = await fetch(mobyApiUrl('games', { title: gameName, limit: 5, ...platParam }));
        if (!searchRes.ok) return { ok: false, error: `HTTP ${searchRes.status}` };
        const searchData = await searchRes.json();
        if (!searchData.games?.length) return { ok: true, results: [] };
        const mobyId = searchData.games[0].game_id;

        if (assetType === 'cover') {
            const res = await fetch(mobyApiUrl(`games/${mobyId}/covers`));
            if (!res.ok) return { ok: true, results: [] };
            const data = await res.json();
            const results = [];
            for (const group of data.cover_groups || []) {
                for (const cover of group.covers || []) {
                    if (cover.image) results.push({ url: cover.image, thumb: cover.image });
                }
            }
            return { ok: true, results: results.slice(0, 20) };
        } else {
            const res = await fetch(mobyApiUrl(`games/${mobyId}/screenshots`, mobyPlatId ? { platform: mobyPlatId } : {}));
            if (!res.ok) return { ok: true, results: [] };
            const data = await res.json();
            const results = (data.screenshots || [])
                .filter(s => s.image)
                .map(s => ({ url: s.image, thumb: s.image }));
            return { ok: true, results: results.slice(0, 20) };
        }
    } catch(e) { return { ok: false, error: e.message }; }
});

// ── EMULATOR SCANNER ─────────────────────────────────────────────────────────
ipcMain.handle('scan-emulators', () => {
    const dirs = [
        '/usr/share/applications',
        '/usr/local/share/applications',
        path.join(os.homedir(), '.local/share/applications'),
        '/var/lib/flatpak/exports/share/applications',
        path.join(os.homedir(), '.local/share/flatpak/exports/share/applications'),
    ];
    const seen = new Set();
    const emulators = [];
    for (const dir of dirs) {
        if (!fs.existsSync(dir)) continue;
        let files;
        try { files = fs.readdirSync(dir).filter(f => f.endsWith('.desktop')); }
        catch { continue; }
        for (const file of files) {
            try {
                const content = fs.readFileSync(path.join(dir, file), 'utf8');
                const entrySection = content.split('\n');
                const get = (key) => {
                    const line = entrySection.find(l => l.startsWith(key + '='));
                    return line ? line.slice(key.length + 1).trim() : '';
                };
                if (get('Type') && get('Type') !== 'Application') continue;
                if (!get('Categories').toLowerCase().includes('emulator')) continue;
                const name = get('Name');
                const execRaw = get('Exec');
                if (!name || !execRaw) continue;
                const exec = execRaw.replace(/\s*%[a-zA-Z]\s*/g, '').trim();
                if (!exec || seen.has(exec)) continue;
                seen.add(exec);
                emulators.push({ name, exec, icon: get('Icon'), comment: get('Comment') });
            } catch {}
        }
    }
    return emulators.sort((a, b) => a.name.localeCompare(b.name));
});

// ── PLAYLISTS ─────────────────────────────────────────────────────────────────
ipcMain.handle('get-playlists', () => {
    if (!db) return [];
    return db.prepare('SELECT * FROM playlists ORDER BY name').all();
});

ipcMain.handle('add-playlist', (_, name) => {
    if (!db) return null;
    return db.prepare('INSERT INTO playlists (name) VALUES (?)').run(name.trim()).lastInsertRowid;
});

ipcMain.handle('update-playlist', (_, id, name) => {
    if (!db) return false;
    db.prepare('UPDATE playlists SET name=? WHERE id=?').run(name.trim(), id);
    return true;
});

ipcMain.handle('delete-playlist', (_, id) => {
    if (!db) return false;
    db.prepare('DELETE FROM playlist_games WHERE playlist_id=?').run(id);
    db.prepare('DELETE FROM playlists WHERE id=?').run(id);
    return true;
});

ipcMain.handle('get-playlist-games', (_, playlistId) => {
    if (!db) return [];
    return db.prepare(`
        SELECT g.*, s.name AS system_name, s.short_name AS system_short,
               s.launch_template, s.default_core, s.default_emulator, pg.sort_order
        FROM playlist_games pg
        JOIN games g ON g.id = pg.game_id
        LEFT JOIN systems s ON s.id = g.system_id
        WHERE pg.playlist_id = ?
        ORDER BY pg.sort_order, g.title
    `).all(playlistId);
});

ipcMain.handle('add-game-to-playlist', (_, playlistId, gameId) => {
    if (!db) return { ok: false };
    const max = db.prepare('SELECT MAX(sort_order) AS m FROM playlist_games WHERE playlist_id=?').get(playlistId);
    const order = (max?.m ?? -1) + 1;
    try {
        db.prepare('INSERT INTO playlist_games (playlist_id, game_id, sort_order) VALUES (?, ?, ?)').run(playlistId, gameId, order);
        return { ok: true };
    } catch { return { ok: false, error: 'Already in playlist' }; }
});

ipcMain.handle('remove-game-from-playlist', (_, playlistId, gameId) => {
    if (!db) return false;
    db.prepare('DELETE FROM playlist_games WHERE playlist_id=? AND game_id=?').run(playlistId, gameId);
    return true;
});

ipcMain.handle('get-game-playlists', (_, gameId) => {
    if (!db) return [];
    return db.prepare('SELECT playlist_id FROM playlist_games WHERE game_id=?').all(gameId).map(r => r.playlist_id);
});

// ── FILE / FOLDER PICKERS ─────────────────────────────────────────────────────
ipcMain.handle('select-file', async (_, filters) => {
    const { canceled, filePaths } = await dialog.showOpenDialog({
        properties: ['openFile'],
        filters: filters || [{ name: 'All Files', extensions: ['*'] }]
    });
    return canceled ? null : filePaths[0];
});

ipcMain.handle('select-directory', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog({ properties: ['openDirectory'] });
    return canceled ? null : filePaths[0];
});

// ── Disc-image aware scanning ─────────────────────────────────────────────────
// Disc games arrive as an "index" file (.cue/.gdi/.ccd/.mds) that points at data
// "sidecar" tracks (.bin/.img/.sub/.raw), or as a self-contained image
// (.chd/.iso/.pbp/.cso/...). A .m3u playlist groups the discs of one game so
// RetroArch can swap them mid-play. We offer the index/playlist/image to import —
// never a bare sidecar — and collapse multi-disc sets into one entry.
const DISC_PLAYLIST_EXTS = new Set(['m3u']);
const DISC_INDEX_EXTS    = new Set(['cue', 'gdi', 'ccd', 'mds', 'toc']);
const DISC_SIDECAR_EXTS  = new Set(['bin', 'img', 'sub', 'raw', 'ecm']);
const DISC_FORMAT_EXTS   = new Set([
    ...DISC_PLAYLIST_EXTS, ...DISC_INDEX_EXTS, ...DISC_SIDECAR_EXTS,
    'chd', 'iso', 'cdi', 'pbp', 'cso', 'nrg', 'mdf'
]);
const extOf = f => path.extname(f).replace(/^\./, '').toLowerCase();
const stripExt = f => path.basename(f).replace(/\.[^.]+$/, '');
// A (Disc 1), [CD2], Disk 3, Side A… token used to recognise & strip multi-disc names.
const DISC_TOKEN_RE = /[\s._-]*[\(\[]?\s*(?:disc|disk|cd)\s*([0-9]+)\s*(?:of\s*[0-9]+)?\s*[\)\]]?/i;
const discNumberOf  = base => { const m = base.match(DISC_TOKEN_RE); return m ? parseInt(m[1], 10) : null; };
const discGameKey   = base => base.replace(DISC_TOKEN_RE, ' ').replace(/\s{2,}/g, ' ').trim().toLowerCase();
const discCleanTitle = base => base.replace(DISC_TOKEN_RE, ' ').replace(/\s{2,}/g, ' ').replace(/[\s._-]+$/, '').trim();

// Absolute paths of the files an index/playlist file points at.
function discReferencedFiles(indexFile) {
    const dir = path.dirname(indexFile);
    const ext = extOf(indexFile);
    const abs = r => path.resolve(path.isAbsolute(r) ? r : path.join(dir, r));
    if (ext === 'ccd') { const b = stripExt(indexFile); return [abs(`${b}.img`), abs(`${b}.sub`)]; }
    if (ext === 'mds') { return [abs(`${stripExt(indexFile)}.mdf`)]; }
    let text = '';
    try { text = fs.readFileSync(indexFile, 'utf8'); } catch { return []; }
    const refs = [];
    for (const raw of text.split(/\r?\n/)) {
        const l = raw.trim();
        if (!l || l.startsWith('#')) continue;
        const q = l.match(/"([^"]+)"/);
        if (q) { refs.push(q[1]); continue; }
        if (ext === 'cue') { const m = l.match(/^FILE\s+(\S+)\s+\w+/i); if (m) refs.push(m[1]); }
        else if (ext === 'gdi') { const m = l.match(/(\S+\.(?:bin|raw|iso))\b/i); if (m) refs.push(m[1]); }
        else if (ext === 'm3u' || ext === 'toc') { refs.push(l); }
    }
    return refs.map(abs);
}

ipcMain.handle('scan-rom-folder', (_, folderPath, extensions) => {
    const exts = new Set(
        (extensions || '').split(',')
            .map(e => e.trim().toLowerCase().replace(/^\./, ''))
            .filter(Boolean)
    );
    const matched = [];
    (function walk(dir) {
        let entries;
        try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
        for (const e of entries) {
            const full = path.join(dir, e.name);
            if (e.isDirectory()) { walk(full); continue; }
            const ext = extOf(e.name);
            if (exts.size === 0 || exts.has(ext)) matched.push(full);
        }
    })(folderPath);

    const single = p => ({ kind: 'single', path: p, title: stripExt(p) });
    const discAware = [...exts].some(e => DISC_FORMAT_EXTS.has(e));
    if (!discAware) return matched.map(single);

    // 1. Suppress every track/disc referenced from inside an index or playlist.
    const referenced = new Set();
    for (const f of matched) {
        if (DISC_INDEX_EXTS.has(extOf(f)) || DISC_PLAYLIST_EXTS.has(extOf(f)))
            for (const r of discReferencedFiles(f)) referenced.add(r);
    }
    // 2. Launchable candidates: not referenced elsewhere, and never a bare sidecar.
    const candidates = matched.filter(f =>
        !referenced.has(path.resolve(f)) && !DISC_SIDECAR_EXTS.has(extOf(f)));

    // 3. Group multi-disc sets (by game name + format); a lone disc stays single.
    const entries = [];
    const groups  = new Map();
    const loose   = [];
    for (const f of candidates) {
        if (DISC_PLAYLIST_EXTS.has(extOf(f))) { entries.push({ kind: 'playlist', path: f, title: stripExt(f) }); continue; }
        const disc = discNumberOf(stripExt(f));
        if (disc == null) { loose.push(f); continue; }
        const key = `${discGameKey(stripExt(f))}::${extOf(f)}`;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push({ path: f, disc });
    }
    for (const discs of groups.values()) {
        if (discs.length < 2) { loose.push(discs[0].path); continue; }
        discs.sort((a, b) => a.disc - b.disc);
        entries.push({
            kind: 'multidisc',
            path: discs[0].path,
            discs: discs.map(d => d.path),
            discCount: discs.length,
            title: discCleanTitle(stripExt(discs[0].path))
        });
    }
    for (const f of loose) entries.push(single(f));
    entries.sort((a, b) => a.title.localeCompare(b.title));
    return entries;
});

// Write a .m3u playlist (one disc path per line, absolute) into EmuLatte's own data
// dir so it works even when the ROM folder is read-only (e.g. an external SSD).
ipcMain.handle('create-m3u', (_, { title, discs }) => {
    try {
        const dir = path.join(configDir, 'playlists');
        fs.mkdirSync(dir, { recursive: true });
        const safe = (String(title || 'game').replace(/[^\w\-]+/g, '_').replace(/^_+|_+$/g, '')) || 'game';
        let file = path.join(dir, `${safe}.m3u`);
        for (let n = 2; fs.existsSync(file); n++) file = path.join(dir, `${safe}_${n}.m3u`);
        fs.writeFileSync(file, (discs || []).join('\n') + '\n', 'utf8');
        return { ok: true, path: file };
    } catch (e) { return { ok: false, error: e.message }; }
});

// ── REPAIR DISC REFERENCES ────────────────────────────────────────────────────
// Disc index files (.cue/.gdi/.toc) name their track files (.bin/.raw/.iso). When a ROM set is
// lowercased on disk but the text inside the index isn't, case-sensitive Linux can't find the
// tracks ("Could not open track file"). This rewrites each reference to the file that actually
// exists (case-insensitive match), backing up the original as <file>.bak.
const DISC_INDEX_RE = /\.(cue|gdi|toc|m3u)$/i;

function repairDiscFile(indexPath, seen = new Set()) {
    const res = { file: indexPath, fixed: [], unresolved: [] };
    if (seen.has(indexPath)) return res;
    seen.add(indexPath);
    const ext = path.extname(indexPath).toLowerCase().replace('.', '');
    const dir = path.dirname(indexPath);
    let text;
    try { text = fs.readFileSync(indexPath, 'utf8'); } catch { res.error = 'cannot read'; return res; }
    let entries = [];
    try { entries = fs.readdirSync(dir); } catch {}
    const byLower = new Map(entries.map(f => [f.toLowerCase(), f]));
    // resolve a referenced filename to the real on-disk name; null = already correct, undefined = missing
    const resolve = ref => {
        const base = ref.replace(/^.*[/\\]/, '');
        if (fs.existsSync(path.join(dir, base))) return null;
        const actual = byLower.get(base.toLowerCase());
        if (actual && actual !== base) return actual;
        res.unresolved.push(base);
        return undefined;
    };

    let out = text;
    if (ext === 'm3u') {
        // disc paths — recurse into each referenced index so its own track refs get fixed
        for (const raw of text.split(/\r?\n/)) {
            const l = raw.trim();
            if (!l || l.startsWith('#')) continue;
            const disc = path.isAbsolute(l) ? l : path.join(dir, l);
            if (DISC_INDEX_RE.test(disc) && fs.existsSync(disc)) {
                const sub = repairDiscFile(disc, seen);
                res.fixed.push(...sub.fixed); res.unresolved.push(...sub.unresolved);
            }
        }
    } else if (ext === 'cue' || ext === 'toc') {
        out = text.replace(/^(\s*FILE\s+)"([^"]+)"/gim, (m, pre, name) => {
            const a = resolve(name);
            if (a) { res.fixed.push([name, a]); return `${pre}"${a}"`; }
            return m;
        });
    } else if (ext === 'gdi') {
        out = text.replace(/"?([^\s"]+\.(?:bin|raw|iso))"?/gi, (m, name) => {
            const a = resolve(name);
            if (a) { res.fixed.push([name, a]); return m.includes('"') ? `"${a}"` : a; }
            return m;
        });
    }
    if (res.fixed.length && out !== text) {
        try {
            const bak = indexPath + '.bak';
            if (!fs.existsSync(bak)) fs.copyFileSync(indexPath, bak);
            fs.writeFileSync(indexPath, out, 'utf8');
        } catch (e) { res.error = e.message; }
    }
    return res;
}

function summarizeRepairs(results) {
    let filesFixed = 0, refsFixed = 0;
    const unresolved = [];
    for (const r of results) {
        if (r.fixed?.length) { filesFixed++; refsFixed += r.fixed.length; }
        for (const u of (r.unresolved || [])) unresolved.push(u);
    }
    return { ok: true, discFiles: results.length, filesFixed, refsFixed, unresolved: [...new Set(unresolved)].slice(0, 12) };
}

ipcMain.handle('repair-disc-refs-game', (_, gameId) => {
    if (!db) return { ok: false, error: 'DB not ready' };
    const g = db.prepare('SELECT rom_path FROM games WHERE id=?').get(gameId);
    if (!g?.rom_path) return { ok: false, error: 'This game has no ROM path.' };
    if (!DISC_INDEX_RE.test(g.rom_path)) return { ok: true, notDisc: true, discFiles: 0, filesFixed: 0, refsFixed: 0, unresolved: [] };
    return summarizeRepairs([repairDiscFile(g.rom_path)]);
});

ipcMain.handle('repair-disc-refs-system', (_, systemId) => {
    if (!db) return { ok: false, error: 'DB not ready' };
    const games = db.prepare('SELECT rom_path FROM games WHERE system_id=?').all(systemId);
    const disc = games.filter(g => g.rom_path && DISC_INDEX_RE.test(g.rom_path));
    if (!disc.length) return { ok: true, notDisc: true, discFiles: 0, filesFixed: 0, refsFixed: 0, unresolved: [] };
    return summarizeRepairs(disc.map(g => repairDiscFile(g.rom_path)));
});

// ── IMAGE MANAGEMENT ──────────────────────────────────────────────────────────
ipcMain.handle('select-local-image', async (_, gameId, type) => {
    const { canceled, filePaths } = await dialog.showOpenDialog({
        properties: ['openFile'],
        filters: [{ name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'webp', 'gif'] }]
    });
    if (canceled || !filePaths[0]) return null;
    const src = filePaths[0];
    const ext = path.extname(src);
    const subdir = { cover: 'covers', hero: 'heroes', logo: 'logos', screenshot: 'screenshots' }[type] || 'covers';
    const dest = path.join(imagesDir, subdir, `${gameId}_${type}${ext}`);
    try { fs.copyFileSync(src, dest); } catch { return null; }
    return dest;
});

ipcMain.handle('read-file-base64', (_, filePath) => {
    try { return fs.readFileSync(filePath).toString('base64'); } catch { return null; }
});

// ── TRAILERS ──────────────────────────────────────────────────────────────────
function trailerFilePath(title) { return path.join(trailersDir, `${title.replace(/[\\/:*?"<>|#]/g, '').trim()}.mp4`); }

ipcMain.handle('check-local-trailer', (_, title) => {
    const p = trailerFilePath(title);
    return fs.existsSync(p) ? `file://${p}` : null;
});

ipcMain.handle('delete-trailer', (_, title) => {
    const p = trailerFilePath(title);
    try { if (fs.existsSync(p)) { fs.unlinkSync(p); return true; } } catch {}
    return false;
});

// Find (and optionally delete) managed art/trailers no longer referenced by any game.
ipcMain.handle('clean-unused-media', (_, dryRun = true) => {
    if (!db) return { ok: false, error: 'DB not ready' };
    const games = db.prepare('SELECT title, cover, hero, logo, screenshot FROM games').all();
    const refImages = new Set();
    for (const g of games)
        [g.cover, g.hero, g.logo, ...(g.screenshot ? g.screenshot.split('|') : [])]
            .filter(Boolean).forEach(p => refImages.add(path.resolve(p)));
    const refTrailers = new Set(games.map(g => path.resolve(trailerFilePath(g.title || ''))));

    const orphans = [];
    let bytes = 0;
    const sweep = (dir, refSet) => {
        let files = []; try { files = fs.readdirSync(dir); } catch { return; }
        for (const f of files) {
            const full = path.join(dir, f);
            try {
                const st = fs.statSync(full);
                if (!st.isFile()) continue;
                if (!refSet.has(path.resolve(full))) { orphans.push(full); bytes += st.size; }
            } catch {}
        }
    };
    for (const sub of ['covers', 'heroes', 'logos', 'screenshots']) sweep(path.join(imagesDir, sub), refImages);
    sweep(trailersDir, refTrailers);

    if (!dryRun) for (const p of orphans) { try { fs.unlinkSync(p); } catch {} }
    return { ok: true, count: orphans.length, bytes };
});

ipcMain.handle('search-youtube', async (_, query) => {
    return new Promise((resolve) => {
        const args = ['--config-location', ytDlpConfigPath, `ytsearch5:${query}`, '--print', '%(id)s|%(thumbnail)s|%(title)s', '--no-playlist'];
        execFile(ytDlpPath, args, { timeout: 20000 }, (error, stdout) => {
            if (!stdout?.trim()) { resolve([]); return; }
            resolve(stdout.split('\n').filter(l => l.trim()).map(line => {
                const parts = line.split('|');
                return { id: parts[0], thumbnail: parts[1], title: parts.slice(2).join('|') };
            }));
        });
    });
});

ipcMain.handle('download-trailer', (event, title, videoId) => {
    const filePath = trailerFilePath(title);
    const win = event.sender.getOwnerBrowserWindow();
    const args = ['--config-location', ytDlpConfigPath, '--ffmpeg-location', ffmpegPath,
        `https://www.youtube.com/watch?v=${videoId}`,
        '-f', 'bestvideo[ext=mp4][height<=720]+bestaudio[ext=m4a]/best[ext=mp4]/best',
        '-o', filePath, '--no-part', '--newline'];
    return new Promise((resolve) => {
        const ytdlp = spawn(ytDlpPath, args);
        ytdlp.stdout.on('data', (data) => {
            const match = data.toString().match(/\[download\]\s+(\d+(\.\d+)?)%/);
            if (match && win) win.webContents.send('download-progress', parseFloat(match[1]));
        });
        ytdlp.on('close', (code) => resolve(code === 0));
    });
});

// ── MISC ──────────────────────────────────────────────────────────────────────
ipcMain.handle('get-basedir',    () => baseDir);
ipcMain.handle('get-config-dir', () => configDir);
ipcMain.handle('open-path',  (_, p) => shell.openPath(p));
