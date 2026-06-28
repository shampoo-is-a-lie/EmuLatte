// EmuLatte Couch Mode renderer — Phase 1: fluid, mouse-usable game wall over emulatte.db.
// (Gamepad navigation = Phase 2; chosen-screen targeting + density UI = Phase 4.) See docs/couch-mode-plan.md.
const $ = id => document.getElementById(id);
const escHtml = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let games = [], systems = [], filter = 'all', search = '';

async function init() {
    // CRT/TV density (set by the Settings UI in a later phase; default 1.0 = no scaling)
    const density = parseFloat(await window.api.getSetting('couch_density')) || 1;
    if (window.api.setZoom && density !== 1) window.api.setZoom(density);

    [games, systems] = await Promise.all([window.api.getGames(), window.api.getSystems()]);
    buildFilters();
    render();
}

function systemsWithGames() {
    const counts = {};
    games.forEach(g => { counts[g.system_id] = (counts[g.system_id] || 0) + 1; });
    return systems.filter(s => counts[s.id]).map(s => ({ ...s, count: counts[s.id] }))
                  .sort((a, b) => (a.name || '').localeCompare(b.name || ''));
}

function buildFilters() {
    const fixed = [['all', 'ALL'], ['favs', '★ FAVOURITES'], ['recent', '↻ RECENT']];
    let html = fixed.map(([k, l]) => `<button class="cf-chip${filter === k ? ' active' : ''}" data-f="${k}">${l}</button>`).join('');
    html += systemsWithGames().map(s =>
        `<button class="cf-chip${filter === 'sys:' + s.id ? ' active' : ''}" data-f="sys:${s.id}">${escHtml(s.name)} <span class="cf-count">${s.count}</span></button>`).join('');
    const el = $('couch-filters');
    el.innerHTML = html;
    el.querySelectorAll('.cf-chip').forEach(b => b.onclick = () => {
        filter = b.dataset.f; buildFilters(); render(); $('couch-grid').scrollTop = 0;
    });
}

function filteredGames() {
    let list = games;
    if (filter === 'favs')        list = list.filter(g => g.fav);
    else if (filter === 'recent') list = [...list].sort((a, b) => (b.last_played || 0) - (a.last_played || 0)).slice(0, 60);
    else if (filter.startsWith('sys:')) { const id = Number(filter.slice(4)); list = list.filter(g => g.system_id === id); }
    if (search) { const q = search.toLowerCase(); list = list.filter(g => (g.title || '').toLowerCase().includes(q)); }
    if (filter !== 'recent') list = [...list].sort((a, b) => (a.title || '').localeCompare(b.title || '', undefined, { sensitivity: 'base' }));
    return list;
}

function render() {
    const grid = $('couch-grid');
    const list = filteredGames();
    $('couch-count').textContent = `${list.length} GAME${list.length !== 1 ? 'S' : ''}`;
    if (!list.length) { grid.innerHTML = '<div class="couch-empty">NO GAMES</div>'; return; }
    grid.innerHTML = list.map(g => {
        const art = g.cover
            ? `<img class="cc-img" src="${g.cover}" loading="lazy" decoding="async" onerror="this.style.display='none';this.nextElementSibling.style.display='flex';"><div class="cc-fallback">${escHtml(g.title)}</div>`
            : `<div class="cc-fallback" style="display:flex">${escHtml(g.title)}</div>`;
        return `<button class="couch-card" data-id="${g.id}"><div class="cc-slot">${art}</div><div class="cc-title">${escHtml(g.title)}</div></button>`;
    }).join('');
}

// Delegated launch (one listener for the whole wall)
$('couch-grid').addEventListener('click', e => {
    const card = e.target.closest('.couch-card'); if (!card) return;
    launch(Number(card.dataset.id));
});

let _nowTimer;
async function launch(id) {
    const g = games.find(x => x.id === id); if (!g) return;
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

// Search
$('couch-search').addEventListener('input', e => { search = e.target.value.trim(); render(); });

// Exit (Phase 2 will add full gamepad navigation; B still backs out)
function exitCouch() { window.api && window.api.exitCouch && window.api.exitCouch(); }
$('couch-exit').addEventListener('click', exitCouch);
document.addEventListener('keydown', e => {
    if (e.key === 'F11') { exitCouch(); return; }
    if (e.key === 'Escape') { if (!$('couch-now').classList.contains('hidden')) hideNow(); else exitCouch(); }
});
let _bWasDown = false;
function pollGamepad() {
    const gp = Array.prototype.find.call(navigator.getGamepads ? navigator.getGamepads() : [], p => p);
    const bDown = !!(gp && gp.buttons[1] && gp.buttons[1].pressed);
    if (bDown && !_bWasDown) { if (!$('couch-now').classList.contains('hidden')) hideNow(); else exitCouch(); }
    _bWasDown = bDown;
    requestAnimationFrame(pollGamepad);
}
requestAnimationFrame(pollGamepad);

init();
