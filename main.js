const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
app.setName('emulatte');
const path = require('path');
const fs = require('fs');
const os = require('os');
const https = require('https');
const zlib = require('zlib');
const Database = require('better-sqlite3');
const { spawn, spawnSync } = require('child_process');

let baseDir;
if (process.env.APPIMAGE) {
    baseDir = path.dirname(process.env.APPIMAGE);
} else if (app.isPackaged) {
    baseDir = path.dirname(process.execPath);
} else {
    baseDir = __dirname;
}

const configDir = path.join(baseDir, 'GameManagerConfig', 'EmuLatte');
const imagesDir = path.join(configDir, 'images');
const dbPath    = path.join(configDir, 'emulatte.db');

let db;

function createWindow() {
    const win = new BrowserWindow({
        width: 1400,
        height: 950,
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
    if (!fs.existsSync(configDir)) fs.mkdirSync(configDir, { recursive: true });
    ['covers', 'heroes', 'logos', 'screenshots'].forEach(d =>
        fs.mkdirSync(path.join(imagesDir, d), { recursive: true })
    );

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
    return r.lastInsertRowid;
});

ipcMain.handle('update-game', (_, id, data) => {
    if (!db) return false;
    const allowed = ['system_id','title','rom_path','description','year','developer','publisher',
                     'genre','players','rating','cover','hero','logo','screenshot',
                     'fav','want','launch_override','core_override','screenscraper_id'];
    const keys = Object.keys(data).filter(k => allowed.includes(k));
    if (!keys.length) return false;
    const fields = keys.map(k => `${k}=@${k}`).join(', ');
    db.prepare(`UPDATE games SET ${fields} WHERE id=${id}`).run(data);
    return true;
});

ipcMain.handle('delete-game', (_, id) => {
    if (!db) return false;
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
ipcMain.handle('launch-game', (_, gameId) => {
    if (!db) return { ok: false, error: 'DB not ready' };
    const game = db.prepare(`
        SELECT g.*, s.launch_template, s.default_core, s.default_emulator
        FROM games g LEFT JOIN systems s ON g.system_id = s.id
        WHERE g.id=?
    `).get(gameId);
    if (!game) return { ok: false, error: 'Game not found' };

    let cmd = game.launch_override;
    if (!cmd && game.launch_template && game.rom_path) {
        const core = game.core_override || game.default_core || '';
        cmd = game.launch_template
            .replace('{rom}',      `"${game.rom_path}"`)
            .replace('{core}',     core                  ? `"${core}"`                  : '')
            .replace('{emulator}', game.default_emulator ? `"${game.default_emulator}"` : '');
    }
    if (!cmd || !cmd.trim()) return { ok: false, error: 'No launch command configured — set a Launch Template in System Manager or a Launch Override on this ROM.' };

    db.prepare('UPDATE games SET last_played=? WHERE id=?').run(Date.now(), gameId);
    spawn('bash', ['-c', cmd], { detached: true, stdio: 'ignore' }).unref();
    return { ok: true };
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
            res.on('end',  () => resolve({ status: res.statusCode, body: Buffer.concat(chunks) }));
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

function ssApiUrl(endpoint, params) {
    return `https://www.screenscraper.fr/api2/${endpoint}?${new URLSearchParams(params).toString()}`;
}

async function ssApiCall(endpoint, params) {
    const { status, body } = await httpsGet(ssApiUrl(endpoint, params));
    if (status !== 200) throw new Error(`HTTP ${status}`);
    try { return JSON.parse(body.toString('utf8')); }
    catch { throw new Error('Invalid JSON from ScreenScraper'); }
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

async function scrapeGameById(gameId, ssUser, ssPass, win) {
    const game = db.prepare(`
        SELECT g.*, s.screenscraper_id AS system_ss_id
        FROM games g LEFT JOIN systems s ON g.system_id = s.id WHERE g.id=?
    `).get(gameId);
    if (!game) return { ok: false, error: 'Game not found' };

    let crc = '', romSize = 0;
    const romFileName = game.rom_path ? path.basename(game.rom_path) : '';

    if (game.rom_path && fs.existsSync(game.rom_path)) {
        try {
            crc     = await computeFileCrc32(game.rom_path);
            romSize = fs.statSync(game.rom_path).size;
        } catch {}
    }

    const params = {
        devid: '', devpassword: '',
        softname: 'emulatte', output: 'json',
        ssid: ssUser, sspassword: ssPass,
        romtype: 'rom', romnom: romFileName,
    };
    if (crc)                params.crc        = crc;
    if (romSize)            params.romtaille  = romSize;
    if (game.system_ss_id)  params.systemeid  = game.system_ss_id;

    let apiResult;
    try { apiResult = await ssApiCall('jeuInfos.php', params); }
    catch(e) { return { ok: false, error: `API error: ${e.message}` }; }

    const jeu = apiResult.response?.jeu;
    if (!jeu) {
        const msg = apiResult.response?.msg || 'Game not found on ScreenScraper';
        return { ok: false, error: msg };
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
    const medias = jeu.medias || [];
    const mediaMap = { 'box-2D': 'cover', fanart: 'hero', wheel: 'logo', ss: 'screenshot' };
    const subdirMap = { cover: 'covers', hero: 'heroes', logo: 'logos', screenshot: 'screenshots' };

    for (const [ssType, field] of Object.entries(mediaMap)) {
        const media = ssPickMedia(medias, ssType);
        if (!media?.url) continue;
        const ext     = media.format ? `.${media.format}` : '.jpg';
        const subdir  = subdirMap[field];
        const dest    = path.join(imagesDir, subdir, `${gameId}_${field}${ext}`);
        const dlUrl   = media.url.includes('ssid=')
            ? media.url
            : `${media.url}&ssid=${encodeURIComponent(ssUser)}&sspassword=${encodeURIComponent(ssPass)}&softname=emulatte&output=image`;
        try { await downloadFile(dlUrl, dest); updates[field] = dest; } catch {}
    }

    // Persist
    const allowed = ['title','description','year','developer','publisher','genre','players',
                     'rating','screenscraper_id','cover','hero','logo','screenshot'];
    const keys   = Object.keys(updates).filter(k => allowed.includes(k));
    const fields = keys.map(k => `${k}=@${k}`).join(', ');
    db.prepare(`UPDATE games SET ${fields} WHERE id=${gameId}`).run(updates);

    return { ok: true, updates, session };
}

let batchScrapeCancel = false;

ipcMain.handle('scrape-game', async (event, gameId) => {
    if (!db) return { ok: false, error: 'DB not ready' };
    const ssUser = db.prepare('SELECT value FROM settings WHERE key=?').get('ss_user')?.value;
    const ssPass = db.prepare('SELECT value FROM settings WHERE key=?').get('ss_pass')?.value;
    if (!ssUser || !ssPass) return { ok: false, error: 'ScreenScraper credentials not set. Go to Settings.' };
    return scrapeGameById(gameId, ssUser, ssPass, BrowserWindow.fromWebContents(event.sender));
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

    win?.webContents.send('scrape-progress', { current: done, total, status: 'done', failed, session: lastSession });
    return { ok: true, done, failed };
});

ipcMain.handle('cancel-scrape',   () => { batchScrapeCancel = true; });
ipcMain.handle('compute-crc32', async (_, filePath) => {
    try { return await computeFileCrc32(filePath); } catch { return null; }
});

ipcMain.handle('test-ss-credentials', async (_, ssUser, ssPass) => {
    if (!ssUser || !ssPass) return { ok: false, error: 'Enter username and password first.' };
    try {
        const result = await ssApiCall('ssUserInfos.php', {
            devid: '', devpassword: '', softname: 'emulatte', output: 'json',
            ssid: ssUser, sspassword: ssPass,
        });
        const user = result.response?.ssuser;
        if (!user) return { ok: false, error: result.response?.msg || 'Invalid credentials.' };
        return {
            ok: true,
            username: user.id || ssUser,
            requestsToday: user.requeststoday ?? '?',
            requestsLimit: user.maxrequestsperday ?? '?',
        };
    } catch(e) {
        const msg = e.message.includes('431') || e.message.includes('401') ? 'Invalid credentials.' :
                    e.message.includes('timeout') ? 'Connection timed out.' : e.message;
        return { ok: false, error: msg };
    }
});

ipcMain.handle('fetch-ss-systems', async () => {
    if (!db) return { ok: false, error: 'DB not ready' };
    const ssUser = db.prepare('SELECT value FROM settings WHERE key=?').get('ss_user')?.value;
    const ssPass = db.prepare('SELECT value FROM settings WHERE key=?').get('ss_pass')?.value;
    if (!ssUser || !ssPass) return { ok: false, error: 'ScreenScraper credentials not set in Settings.' };
    try {
        const result = await ssApiCall('systemesListe.php', {
            devid: '', devpassword: '', softname: 'emulatte', output: 'json',
            ssid: ssUser, sspassword: ssPass,
        });
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

    try {
        const list = spawnSync('flatpak', ['list', '--app', '--columns=application'], { encoding: 'utf8' });
        if (list.stdout?.includes('org.libretro.RetroArch')) return 'flatpak';
    } catch {}

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
ipcMain.handle('scan-cores', () => {
    if (!db) return { ok: false, error: 'DB not ready' };
    const coreDirs = [
        path.join(os.homedir(), '.config', 'retroarch', 'cores'),
        path.join(os.homedir(), '.var', 'app', 'org.libretro.RetroArch', 'config', 'retroarch', 'cores'),
    ];
    const insert = db.prepare('INSERT OR REPLACE INTO cores (path, name, system_names) VALUES (?, ?, ?)');
    const insertAll = db.transaction(items => { for (const c of items) insert.run(c.path, c.name, c.systemNames); });
    const found = [];
    for (const dir of coreDirs) {
        if (!fs.existsSync(dir)) continue;
        let files;
        try { files = fs.readdirSync(dir); } catch { continue; }
        for (const file of files.filter(f => f.endsWith('_libretro.so'))) {
            const corePath = path.join(dir, file);
            const infoPath = corePath.replace('.so', '.info');
            let name = file.replace('_libretro.so', '').replace(/_/g, ' ');
            let systemNames = '';
            if (fs.existsSync(infoPath)) {
                const txt = fs.readFileSync(infoPath, 'utf8');
                const nm  = txt.match(/^corename\s*=\s*"?(.+?)"?\s*$/m);
                const sm  = txt.match(/^systemname\s*=\s*"?(.+?)"?\s*$/m);
                if (nm) name = nm[1].trim();
                if (sm) systemNames = sm[1].trim();
            }
            found.push({ path: corePath, name, systemNames });
        }
    }
    insertAll(found);
    return { ok: true, count: found.length };
});

ipcMain.handle('get-cores', () => {
    if (!db) return [];
    return db.prepare('SELECT * FROM cores ORDER BY name').all();
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

ipcMain.handle('scan-rom-folder', (_, folderPath, extensions) => {
    const exts = new Set(
        (extensions || '').split(',')
            .map(e => e.trim().toLowerCase().replace(/^\./, ''))
            .filter(Boolean)
    );
    const results = [];
    function walk(dir) {
        let entries;
        try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
        for (const e of entries) {
            const full = path.join(dir, e.name);
            if (e.isDirectory()) { walk(full); continue; }
            const ext = path.extname(e.name).replace(/^\./, '').toLowerCase();
            if (exts.size === 0 || exts.has(ext)) results.push(full);
        }
    }
    walk(folderPath);
    return results;
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
    fs.copyFileSync(src, dest);
    return dest;
});

ipcMain.handle('read-file-base64', (_, filePath) => {
    try { return fs.readFileSync(filePath).toString('base64'); } catch { return null; }
});

// ── MISC ──────────────────────────────────────────────────────────────────────
ipcMain.handle('get-basedir',    () => baseDir);
ipcMain.handle('get-config-dir', () => configDir);
ipcMain.handle('open-path',  (_, p) => shell.openPath(p));
