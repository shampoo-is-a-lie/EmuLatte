'use strict';

// ── STATE ─────────────────────────────────────────────────────────────────────
let allGames   = [];
let allSystems = [];
let currentFilter  = 'all';
let currentView    = 'view-gallery';
let currentGame    = null;
let slideshowUrls  = [];
let slideshowIndex = 0;
let heroCycleTimer = null;
let heroQueue      = [];
let scrapeActive        = false;
let ssSystems           = [];
let allPlaylists        = [];
let allCores            = [];
let currentPlaylistGames = [];

// ── INIT ──────────────────────────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', async () => {
    applyZoom();
    await loadSystems();
    await loadGames();
    await loadPlaylists();
    await loadCores();
    wireUI();
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

async function loadGames() {
    allGames = await window.api.getGames();
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
    const q = document.getElementById('search-bar')?.value.trim().toLowerCase();
    if (q) {
        games = games.filter(g =>
            (g.title       || '').toLowerCase().includes(q) ||
            (g.system_name || '').toLowerCase().includes(q) ||
            (g.genre       || '').toLowerCase().includes(q) ||
            (g.developer   || '').toLowerCase().includes(q) ||
            (g.year        || '').includes(q)
        );
    }
    return games;
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
    const q = document.getElementById('search-bar')?.value.trim();
    if (q) label = `RESULTS FOR "${q.toUpperCase()}"`;

    document.getElementById('gallery-category-text').textContent = label;
    document.getElementById('gallery-category-count').textContent =
        `${games.length} ${games.length === 1 ? 'GAME' : 'GAMES'}`;

    const isSystem = currentFilter !== 'all' && currentFilter !== 'favs' &&
                     currentFilter !== 'want' && currentFilter !== 'recent' && !isPlaylist;
    document.getElementById('system-hero-btns').style.display = isSystem ? 'flex' : 'none';
}

function renderGallery(games) {
    const grid = document.getElementById('gallery-grid');
    if (!games.length) {
        grid.innerHTML = `<div style="grid-column:1/-1; padding:60px; text-align:center; color:var(--text_dim); font-weight:900; letter-spacing:2px; font-size:14px;">NO ROMS FOUND</div>`;
        document.getElementById('hero-icon').style.display = 'block';
        return;
    }
    document.getElementById('hero-icon').style.display = 'none';
    grid.innerHTML = games.map(g => {
        const hasCover = g.cover && g.cover !== '';
        const sysLabel = g.system_short || g.system_name || '';
        return `<div class="gallery-item" data-id="${g.id}">
            <div class="gallery-cover-wrap">
                ${hasCover
                    ? `<img class="gallery-cover" src="${g.cover}" onerror="this.style.display='none';this.nextElementSibling.style.display='flex';">
                       <div class="gallery-cover" style="display:none; align-items:center; justify-content:center; color:var(--text_dim); font-size:11px; font-weight:900; letter-spacing:1px;">${escHtml(g.title)}</div>`
                    : `<div class="gallery-cover" style="display:flex; align-items:center; justify-content:center; color:var(--text_dim); font-size:11px; font-weight:900; letter-spacing:1px; padding:10px;">${escHtml(g.title)}</div>`
                }
                ${sysLabel ? `<div class="gallery-system-badge">${escHtml(sysLabel)}</div>` : ''}
                <div class="gallery-flag-btns ${g.fav || g.want ? 'has-active' : ''}">
                    <button class="btn-gallery-fav  ${g.fav  ? 'active' : ''}" data-id="${g.id}" data-field="fav"  title="Favourite">★</button>
                    <button class="btn-gallery-want ${g.want ? 'active' : ''}" data-id="${g.id}" data-field="want" title="Want to Play">♥</button>
                </div>
            </div>
            <div class="gallery-title">${escHtml(g.title)}</div>
        </div>`;
    }).join('');

    grid.querySelectorAll('.gallery-item').forEach(el => {
        el.addEventListener('click', e => {
            if (e.target.closest('.btn-gallery-fav, .btn-gallery-want')) return;
            const game = allGames.find(g => g.id === Number(el.dataset.id));
            if (game) openGamePage(game);
        });
    });

    grid.querySelectorAll('.btn-gallery-fav, .btn-gallery-want').forEach(btn => {
        btn.addEventListener('click', async e => {
            e.stopPropagation();
            const id    = Number(btn.dataset.id);
            const field = btn.dataset.field;
            const game  = allGames.find(g => g.id === id);
            if (!game) return;
            const newVal = game[field] ? 0 : 1;
            game[field] = newVal;
            await window.api.setGameFlag(id, field, newVal);
            btn.classList.toggle('active', !!newVal);
            const wrap = btn.closest('.gallery-flag-btns');
            const anyActive = wrap.querySelector('.active');
            wrap.classList.toggle('has-active', !!anyActive);
        });
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

    tbody.querySelectorAll('tr[data-id]').forEach(tr => {
        tr.addEventListener('click', e => {
            if (e.target.closest('.btn-launch-list') || e.target.closest('[data-fav]')) return;
            const game = allGames.find(g => g.id === Number(tr.dataset.id));
            if (game) openGamePage(game);
        });
    });

    tbody.querySelectorAll('.btn-launch-list').forEach(btn => {
        btn.addEventListener('click', e => { e.stopPropagation(); launchGame(Number(btn.dataset.id)); });
    });

    tbody.querySelectorAll('[data-fav]').forEach(el => {
        el.addEventListener('click', async e => {
            e.stopPropagation();
            const id   = Number(el.dataset.fav);
            const game = allGames.find(g => g.id === id);
            if (!game) return;
            game.fav = game.fav ? 0 : 1;
            await window.api.setGameFlag(id, 'fav', game.fav);
            el.textContent = game.fav ? '★' : '☆';
            el.style.color = game.fav ? '#ffeb3b' : 'var(--text_dim)';
        });
    });
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

    const favBtn  = document.getElementById('btn-gamepage-fav');
    const wantBtn = document.getElementById('btn-gamepage-want');
    favBtn.textContent  = game.fav  ? '★ FAVED'       : '+ FAV';
    wantBtn.textContent = game.want ? '♥ WANT TO PLAY' : 'WANT TO PLAY';
    favBtn.classList.toggle('active',  !!game.fav);
    wantBtn.classList.toggle('active', !!game.want);

    const coverWrap = document.getElementById('gamepage-cover-wrap');
    const coverImg  = document.getElementById('gamepage-cover');
    if (game.cover) { coverImg.src = game.cover; coverWrap.style.display = 'block'; }
    else            { coverWrap.style.display = 'none'; }

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

    const banner = document.getElementById('gamepage-screenshots-banner');
    if (game.screenshot) {
        banner.style.backgroundImage = `url("${game.screenshot}")`;
        banner.style.display = 'block';
        banner.onclick = () => openSlideshow([game.screenshot]);
    } else {
        banner.style.display = 'none';
    }

    switchView('view-gamepage');
}

function switchView(viewId) {
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    document.getElementById(viewId)?.classList.add('active');
    currentView = viewId;

    const backBar = document.getElementById('gamepage-back-bar');
    backBar.style.display = viewId === 'view-gamepage' ? 'block' : 'none';

    if (viewId !== 'view-gamepage') {
        currentGame = null;
        startHeroCycle();
    }
}

// ── LAUNCH ────────────────────────────────────────────────────────────────────
async function launchGame(id) {
    const result = await window.api.launchGame(id);
    if (!result.ok) showLaunchToast(result.error || 'No launch command configured', result.cmd);
}

let toastTimer = null;
function showLaunchToast(msg, cmd) {
    const toast  = document.getElementById('launch-toast');
    const msgEl  = document.getElementById('launch-toast-msg');
    const isInfo = !cmd && (msg.startsWith('Done') || msg.startsWith('Scraped'));
    toast.style.borderColor = isInfo ? 'var(--border_solid)' : '#c62828';
    toast.querySelector('div').style.color = isInfo ? 'var(--accent)' : '#ef5350';
    toast.querySelector('div').textContent = isInfo ? 'SCRAPE' : 'LAUNCH FAILED';
    msgEl.textContent = cmd ? `${msg}\n\nCommand: ${cmd}` : msg;
    toast.style.display = 'block';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toast.style.display = 'none'; }, 7000);
    toast.onclick = () => { toast.style.display = 'none'; clearTimeout(toastTimer); };
}

// ── SLIDESHOW ─────────────────────────────────────────────────────────────────
function openSlideshow(urls, startIndex = 0) {
    slideshowUrls  = urls;
    slideshowIndex = startIndex;
    showSlide();
    document.getElementById('modal-slideshow').classList.add('active');
}

function showSlide() {
    const img = document.getElementById('slideshow-img');
    img.src = slideshowUrls[slideshowIndex] || '';
    document.getElementById('slide-prev').style.display = slideshowUrls.length > 1 ? 'flex' : 'none';
    document.getElementById('slide-next').style.display = slideshowUrls.length > 1 ? 'flex' : 'none';
}

// ── MODALS ────────────────────────────────────────────────────────────────────
function openModal(id) {
    document.getElementById(id)?.classList.add('active');
}
function closeModal(id) {
    document.getElementById(id)?.classList.remove('active');
}

function openAddRomModal(presetSystemId = null) {
    document.getElementById('add-rom-path').value  = '';
    document.getElementById('add-rom-title').value = '';
    const sys = document.getElementById('add-rom-system');
    sys.value = presetSystemId !== null ? String(presetSystemId) : '';
    openModal('modal-add-rom');
}

function populateCoreOverrideSelect(game) {
    const sel = document.getElementById('edit-core-override');
    sel.innerHTML = `<option value="">— Use system default —</option>` +
        allCores.map(c => `<option value="${escHtml(c.path)}">${escHtml(c.name)}</option>`).join('');
    sel.value = game.core_override || '';
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

    const setPreview = (imgId, src) => {
        const el = document.getElementById(imgId);
        el.src = src || '';
        el.style.display = src ? 'block' : 'block';
    };
    setPreview('edit-cover-preview',      game.cover);
    setPreview('edit-hero-preview',       game.hero);
    setPreview('edit-logo-preview',       game.logo);
    setPreview('edit-screenshot-preview', game.screenshot);

    populateCoreOverrideSelect(game);
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

function openEditSystemModal(sys = null) {
    const isNew = !sys;
    document.getElementById('edit-system-modal-title').textContent = isNew ? 'Add System' : 'Edit System';
    document.getElementById('edit-system-id').value             = sys?.id || '';
    document.getElementById('edit-system-name').value          = sys?.name || '';
    document.getElementById('edit-system-short').value         = sys?.short_name || '';
    document.getElementById('edit-system-extensions').value    = sys?.extensions || '';
    document.getElementById('edit-system-template').value      = sys?.launch_template || '';
    document.getElementById('edit-system-core').value          = sys?.default_core || '';
    document.getElementById('edit-system-emulator').value      = sys?.default_emulator || '';
    document.getElementById('edit-system-ssid').value          = sys?.screenscraper_id || '';
    document.getElementById('btn-edit-system-delete').style.display = isNew ? 'none' : '';
    openModal('modal-edit-system');
}

// ── FILTER / SORT ─────────────────────────────────────────────────────────────
async function setFilter(filter) {
    currentFilter = filter;

    document.querySelectorAll('.filter-grid button, .filter-btn-system, .filter-btn-playlist').forEach(btn => {
        btn.classList.remove('active');
        btn.style.background  = '';
        btn.style.color       = '';
        btn.style.borderColor = '';
        btn.style.boxShadow   = '';
    });

    const active = document.querySelector(
        `.filter-grid button[data-filter="${CSS.escape(filter)}"], ` +
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

// ── UI WIRING ─────────────────────────────────────────────────────────────────
function wireUI() {
    // Titlebar
    document.getElementById('btn-min').addEventListener('click', () => window.api.minimize());
    document.getElementById('btn-max').addEventListener('click', () => window.api.maximize());
    document.getElementById('btn-close').addEventListener('click', () => window.api.close());

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

    // Search
    document.getElementById('search-bar').addEventListener('input', () => renderCurrentView());

    // Sidebar static filters
    document.querySelectorAll('.filter-grid button').forEach(btn => {
        btn.addEventListener('click', () => setFilter(btn.dataset.filter));
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

    // Hero scrape all (system-scoped)
    document.getElementById('btn-hero-scrape-all').addEventListener('click', () => {
        if (scrapeActive) return;
        const systemId = (currentFilter !== 'all' && currentFilter !== 'favs' && currentFilter !== 'want' && currentFilter !== 'recent')
            ? currentFilter : null;
        scrapeAll(systemId);
    });

    // Hero add ROM button (system-scoped)
    document.getElementById('btn-hero-add-rom').addEventListener('click', () => {
        const presetId = (currentFilter !== 'all' && currentFilter !== 'favs' && currentFilter !== 'want' && currentFilter !== 'recent')
            ? Number(currentFilter) : null;
        openAddRomModal(presetId);
    });

    // Systems manager
    document.getElementById('btn-open-systems').addEventListener('click', openSystemsModal);

    // Settings
    document.getElementById('btn-open-settings').addEventListener('click', async () => {
        document.getElementById('settings-ss-user').value = await window.api.getSetting('ss_user') || '';
        document.getElementById('settings-ss-pass').value = await window.api.getSetting('ss_pass') || '';
        const z = await window.api.getSetting('zoom') || '1.0';
        document.getElementById('settings-zoom').value = z;
        openModal('modal-settings');
    });

    // Back to library
    document.getElementById('btn-gamepage-back').addEventListener('click', () => {
        switchView(currentView === 'view-gamepage' ? 'view-gallery' : currentView);
        switchView('view-gallery');
        renderGallery(getFilteredGames());
    });

    // Gamepage launch
    document.getElementById('btn-gamepage-launch').addEventListener('click', () => {
        if (currentGame) launchGame(currentGame.id);
    });

    // Gamepage fav / want
    document.getElementById('btn-gamepage-fav').addEventListener('click', async () => {
        if (!currentGame) return;
        currentGame.fav = currentGame.fav ? 0 : 1;
        await window.api.setGameFlag(currentGame.id, 'fav', currentGame.fav);
        document.getElementById('btn-gamepage-fav').textContent  = currentGame.fav  ? '★ FAVED' : '+ FAV';
        document.getElementById('btn-gamepage-fav').classList.toggle('active', !!currentGame.fav);
    });
    document.getElementById('btn-gamepage-want').addEventListener('click', async () => {
        if (!currentGame) return;
        currentGame.want = currentGame.want ? 0 : 1;
        await window.api.setGameFlag(currentGame.id, 'want', currentGame.want);
        document.getElementById('btn-gamepage-want').textContent = currentGame.want ? '♥ WANT TO PLAY' : 'WANT TO PLAY';
        document.getElementById('btn-gamepage-want').classList.toggle('active', !!currentGame.want);
    });

    // Gamepage scrape
    document.getElementById('btn-gamepage-scrape').addEventListener('click', () => {
        if (currentGame) scrapeGame(currentGame.id);
    });

    // Gamepage edit
    document.getElementById('btn-gamepage-edit').addEventListener('click', () => {
        if (currentGame) openEditGameModal(currentGame);
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
        if (!romPath || !title) { alert('ROM path and title are required.'); return; }
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
        if (!folder) { alert('Please select a folder first.'); return; }
        const files = await window.api.scanRomFolder(folder, exts);
        const resultsWrap = document.getElementById('scan-results-wrap');
        const resultsList = document.getElementById('scan-results-list');
        document.getElementById('scan-results-count').textContent = files.length;
        const sysOpts = `<option value="">— Skip —</option>` +
            allSystems.map(s => `<option value="${s.id}">${escHtml(s.name)}</option>`).join('');
        const presetId = document.getElementById('scan-system-select').value;
        resultsList.innerHTML = files.map((f, i) => {
            const base = f.split('/').pop().replace(/\.[^.]+$/, '');
            return `<div class="scan-result-item">
                <span class="rom-name" title="${escHtml(f)}">${escHtml(base)}</span>
                <select class="scan-item-system" data-path="${escHtml(f)}" data-title="${escHtml(base)}">
                    ${sysOpts.replace(`value="${presetId}"`, `value="${presetId}" selected`)}
                </select>
            </div>`;
        }).join('') || `<div style="text-align:center; padding:20px; color:var(--text_dim);">No ROMs found with those extensions.</div>`;
        resultsWrap.style.display = files.length ? 'block' : 'none';
        if (!files.length) alert('No ROMs found with those extensions.');
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
            const title = sel.dataset.title;
            const romPath = sel.dataset.path;
            await window.api.addGame({ system_id: sel.value, title, rom_path: romPath });
            count++;
        }
        closeModal('modal-scan-folder');
        document.getElementById('scan-results-wrap').style.display = 'none';
        document.getElementById('scan-folder-path').value = '';
        await loadGames();
        if (count) alert(`${count} ROM${count !== 1 ? 's' : ''} imported.`);
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
        };
        if (!data.title) { alert('Title is required.'); return; }
        await window.api.updateGame(id, data);
        closeModal('modal-edit-game');
        await loadGames();
        const updated = allGames.find(g => g.id === id);
        if (updated && currentGame?.id === id) openGamePage(updated);
    });
    document.getElementById('btn-edit-delete').addEventListener('click', async () => {
        const id = Number(document.getElementById('edit-game-id').value);
        if (!confirm('Delete this ROM from the library? The file will NOT be deleted.')) return;
        await window.api.deleteGame(id);
        closeModal('modal-edit-game');
        switchView('view-gallery');
        await loadGames();
    });

    // ── MODAL: SYSTEMS ───────────────────────────────────────────────────────
    document.getElementById('btn-add-system').addEventListener('click', () => {
        closeModal('modal-systems');
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
        if (!data.name) { alert('System name is required.'); return; }
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
        if (!confirm(`Delete system "${sys?.name}"? This will also delete all ${count} ROM(s) in this system.`)) return;
        await window.api.deleteSystem(id);
        closeModal('modal-edit-system');
        await loadSystems();
        await loadGames();
        if (currentFilter === String(id)) setFilter('all');
        openSystemsModal();
    });

    // ── EDIT SYSTEM: BROWSE CORE ─────────────────────────────────────────────
    document.getElementById('btn-edit-system-core-browse').addEventListener('click', async () => {
        const p = await window.api.selectFile([
            { name: 'RetroArch Cores', extensions: ['so'] },
            { name: 'All Files', extensions: ['*'] },
        ]);
        if (p) document.getElementById('edit-system-core').value = p;
    });

    // ── GAMEPAGE: + PLAYLIST ─────────────────────────────────────────────────
    document.getElementById('btn-gamepage-playlist').addEventListener('click', async () => {
        if (!currentGame) return;
        const gamePlaylistIds = await window.api.getGamePlaylists(currentGame.id);
        const list = document.getElementById('playlist-picker-list');
        if (!allPlaylists.length) {
            list.innerHTML = `<div style="text-align:center; padding:20px; color:var(--text_dim);">No playlists yet — create one from the sidebar.</div>`;
        } else {
            list.innerHTML = allPlaylists.map(p => {
                const inList = gamePlaylistIds.includes(p.id);
                return `<div style="display:flex; justify-content:space-between; align-items:center; padding:8px 12px; border-radius:6px; background:rgba(0,0,0,0.2); border:1px solid var(--border);">
                    <span style="color:var(--text_sec); font-size:13px;">${escHtml(p.name)}</span>
                    <button class="btn-pl-toggle" data-playlist-id="${p.id}" data-in="${inList ? '1':'0'}"
                        style="font-size:11px; padding:4px 14px; ${inList ? 'background:var(--accent); border-color:var(--accent); color:var(--bg);' : ''}">${inList ? '✓ Added' : '+ Add'}</button>
                </div>`;
            }).join('');
            list.querySelectorAll('.btn-pl-toggle').forEach(btn => {
                btn.addEventListener('click', async () => {
                    const plId   = Number(btn.dataset.playlistId);
                    const inList = btn.dataset.in === '1';
                    if (inList) {
                        await window.api.removeGameFromPlaylist(plId, currentGame.id);
                        btn.dataset.in = '0';
                        btn.textContent = '+ Add';
                        btn.style.cssText = 'font-size:11px; padding:4px 14px;';
                    } else {
                        await window.api.addGameToPlaylist(plId, currentGame.id);
                        btn.dataset.in = '1';
                        btn.textContent = '✓ Added';
                        btn.style.cssText = 'font-size:11px; padding:4px 14px; background:var(--accent); border-color:var(--accent); color:var(--bg);';
                    }
                    if (typeof currentFilter === 'string' && currentFilter.startsWith('playlist:')) {
                        currentPlaylistGames = await window.api.getPlaylistGames(Number(currentFilter.split(':')[1]));
                    }
                });
            });
        }
        openModal('modal-add-to-playlist');
    });
    document.getElementById('btn-playlist-picker-close').addEventListener('click', () => closeModal('modal-add-to-playlist'));

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
        if (!confirm(`Delete playlist "${pl?.name}"?`)) return;
        await window.api.deletePlaylist(id);
        closeModal('modal-edit-playlist');
        if (currentFilter === `playlist:${id}`) setFilter('all');
        await loadPlaylists();
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

    // ── MODAL: SS SYSTEM BROWSER ─────────────────────────────────────────────
    document.getElementById('btn-browse-ss-systems').addEventListener('click', async () => {
        const btn = document.getElementById('btn-browse-ss-systems');
        btn.textContent = '…';
        btn.disabled = true;
        const result = await window.api.fetchSsSystems();
        btn.textContent = 'Browse';
        btn.disabled = false;
        if (!result.ok) { alert(result.error || 'Failed to fetch ScreenScraper systems.'); return; }
        ssSystems = result.systems;
        document.getElementById('ss-systems-search').value = '';
        renderSsSystemsList('');
        openModal('modal-ss-systems');
    });
    document.getElementById('ss-systems-search').addEventListener('input', e => renderSsSystemsList(e.target.value));
    document.getElementById('btn-ss-systems-cancel').addEventListener('click', () => closeModal('modal-ss-systems'));

    // ── MODAL: SETTINGS ──────────────────────────────────────────────────────
    document.getElementById('btn-settings-cancel').addEventListener('click', () => closeModal('modal-settings'));
    document.getElementById('btn-settings-save').addEventListener('click', async () => {
        const z = document.getElementById('settings-zoom').value;
        await window.api.setSetting('zoom', z);
        window.api.setZoom(parseFloat(z));
        await window.api.setSetting('ss_user', document.getElementById('settings-ss-user').value.trim());
        await window.api.setSetting('ss_pass', document.getElementById('settings-ss-pass').value.trim());
        closeModal('modal-settings');
    });
    document.getElementById('btn-settings-open-data-dir').addEventListener('click', async () => {
        const dir = await window.api.getConfigDir();
        window.api.openPath(dir);
    });

    // ── MODAL: SLIDESHOW ─────────────────────────────────────────────────────
    document.getElementById('modal-slideshow').addEventListener('click', e => {
        if (!e.target.closest('.slideshow-img') && !e.target.closest('.slide-nav')) closeModal('modal-slideshow');
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

    // Close modals on backdrop click
    document.querySelectorAll('.modal-overlay').forEach(overlay => {
        if (overlay.id === 'modal-slideshow') return;
        overlay.addEventListener('click', e => {
            if (e.target === overlay) overlay.classList.remove('active');
        });
    });

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

// ── SCREENSCRAPER ─────────────────────────────────────────────────────────────

async function scrapeGame(gameId) {
    const btn = document.getElementById('btn-gamepage-scrape');
    if (btn) btn.textContent = 'SCRAPING…';
    const result = await window.api.scrapeGame(gameId);
    if (btn) btn.textContent = 'SCRAPE';
    if (!result.ok) {
        showLaunchToast(result.error || 'Scrape failed', null);
        return;
    }
    await loadGames();
    const updated = allGames.find(g => g.id === gameId);
    if (updated && currentGame?.id === gameId) openGamePage(updated);
    if (result.session) updateRateInfo(result.session);
}

async function scrapeAll(systemId) {
    const games = systemId
        ? allGames.filter(g => g.system_id === Number(systemId))
        : allGames;
    if (!games.length) { showLaunchToast('No ROMs to scrape in this system.', null); return; }

    scrapeActive = true;
    showScrapePanel(true);
    const result = await window.api.scrapeBatch(games.map(g => g.id));
    scrapeActive = false;

    if (!result.ok) { showLaunchToast(result.error, null); showScrapePanel(false); return; }

    await loadGames();
    if (currentGame) {
        const updated = allGames.find(g => g.id === currentGame.id);
        if (updated) openGamePage(updated);
    }
}

function wireScrapeProgress() {
    window.api.onScrapeProgress(data => {
        if (data.status === 'done') {
            showScrapePanel(false);
            scrapeActive = false;
            const msg = data.failed
                ? `Done. ${data.done - data.failed} scraped, ${data.failed} failed.`
                : `Done. ${data.done} ROM${data.done !== 1 ? 's' : ''} scraped.`;
            showLaunchToast(msg, null);
            if (data.session) updateRateInfo(data.session);
            return;
        }
        const pct = data.total ? Math.round((data.current / data.total) * 100) : 0;
        document.getElementById('scrape-progress-bar').style.width = `${pct}%`;
        document.getElementById('scrape-panel-title').textContent   = data.title || '';
        document.getElementById('scrape-panel-count').textContent   = `${data.current} / ${data.total}`;
        if (data.session) updateRateInfo(data.session);
    });

    document.getElementById('btn-scrape-cancel').addEventListener('click', async () => {
        await window.api.cancelScrape();
        showScrapePanel(false);
        scrapeActive = false;
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
