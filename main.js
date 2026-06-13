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
        if (!win.isMaximized() && !win.isMinimized()) {
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
                     'fav','want','launch_override','core_override','screenscraper_id','ra_game_id'];
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

function ssMediaUrl(url, ssUser, ssPass) {
    if (url.includes('ssid=')) return url;
    const creds = new URLSearchParams({
        devid: ssDev.devid, devpassword: ssDev.devpassword, softname: ssDev.softname,
        ssid: ssUser, sspassword: ssPass, output: 'image',
    });
    return `${url}&${creds.toString()}`;
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

async function scrapeGameById(gameId, ssUser, ssPass, win, metaOnly = false) {
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
        ...ssBaseParams(ssUser, ssPass),
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

ipcMain.handle('scrape-game', async (event, gameId, metaOnly = false) => {
    if (!db) return { ok: false, error: 'DB not ready' };
    const ssUser = db.prepare('SELECT value FROM settings WHERE key=?').get('ss_user')?.value;
    const ssPass = db.prepare('SELECT value FROM settings WHERE key=?').get('ss_pass')?.value;
    if (!ssUser || !ssPass) return { ok: false, error: 'ScreenScraper credentials not set. Go to Settings.' };
    return scrapeGameById(gameId, ssUser, ssPass, BrowserWindow.fromWebContents(event.sender), metaOnly);
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
    // Return the credential-free base URL only. The renderer displays it via the ssimg:// proxy and
    // passes it back to sgdb-apply-art, both of which add credentials in the main process.
    const results = (jeu.medias || [])
        .filter(m => wanted.has(m.type))
        .map(m => ({ thumb: m.url, url: m.url }));
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
