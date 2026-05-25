const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
app.setName('emulatte');
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const { spawn } = require('child_process');

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
                     'fav','want','launch_override','screenscraper_id'];
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
        cmd = game.launch_template
            .replace('{rom}',      `"${game.rom_path}"`)
            .replace('{core}',     game.default_core     ? `"${game.default_core}"`     : '')
            .replace('{emulator}', game.default_emulator ? `"${game.default_emulator}"` : '');
    }
    if (!cmd || !cmd.trim()) return { ok: false, error: 'No launch command configured — set a Launch Template in System Manager or a Launch Override on this ROM.' };

    db.prepare('UPDATE games SET last_played=? WHERE id=?').run(Date.now(), gameId);
    spawn('bash', ['-c', cmd], { detached: true, stdio: 'ignore' }).unref();
    return { ok: true };
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
