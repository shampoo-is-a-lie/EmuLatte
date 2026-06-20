const { contextBridge, ipcRenderer, webFrame } = require('electron');

contextBridge.exposeInMainWorld('api', {
    signalReady: () => ipcRenderer.send('renderer-ready'),
    setZoom:     (f) => webFrame.setZoomFactor(f),

    minimize: () => ipcRenderer.send('window-minimize'),
    maximize: () => ipcRenderer.send('window-maximize'),
    close:    () => ipcRenderer.send('window-close'),

    // Systems
    getSystems:   ()         => ipcRenderer.invoke('get-systems'),
    addSystem:    (data)     => ipcRenderer.invoke('add-system', data),
    updateSystem: (id, data) => ipcRenderer.invoke('update-system', id, data),
    deleteSystem: (id)       => ipcRenderer.invoke('delete-system', id),

    // Games
    getGames:        ()         => ipcRenderer.invoke('get-games'),
    addGame:         (data)     => ipcRenderer.invoke('add-game', data),
    updateGame:      (id, data) => ipcRenderer.invoke('update-game', id, data),
    deleteGame:      (id)       => ipcRenderer.invoke('delete-game', id),
    setGameFlag:     (id, f, v) => ipcRenderer.invoke('set-game-flag', id, f, v),
    updateLastPlayed:(id)       => ipcRenderer.invoke('update-last-played', id),
    launchGame:      (id)       => ipcRenderer.invoke('launch-game', id),
    addToCngm:       (id)       => ipcRenderer.invoke('add-to-cngm', id),

    // Settings
    getSetting: (k)    => ipcRenderer.invoke('get-setting', k),
    setSetting: (k, v) => ipcRenderer.invoke('set-setting', k, v),

    // File / folder pickers
    selectFile:      (filters) => ipcRenderer.invoke('select-file', filters),
    selectDirectory: ()        => ipcRenderer.invoke('select-directory'),
    scanRomFolder:   (p, exts) => ipcRenderer.invoke('scan-rom-folder', p, exts),

    // Image management
    selectLocalImage: (id, type) => ipcRenderer.invoke('select-local-image', id, type),
    readFileBase64:   (p)        => ipcRenderer.invoke('read-file-base64', p),

    // Screenscraper
    scrapeGame:         (id)     => ipcRenderer.invoke('scrape-game', id),
    scrapeGameMeta:     (id)     => ipcRenderer.invoke('scrape-game', id, true),
    scrapeBatch:        (ids)    => ipcRenderer.invoke('scrape-batch', ids),
    cancelScrape:       ()       => ipcRenderer.invoke('cancel-scrape'),
    computeCrc32:       (p)      => ipcRenderer.invoke('compute-crc32', p),
    onScrapeProgress:   (cb)     => ipcRenderer.on('scrape-progress', (_, d) => cb(d)),
    fetchSsSystems:       ()             => ipcRenderer.invoke('fetch-ss-systems'),
    testSsCredentials:    (user, pass)   => ipcRenderer.invoke('test-ss-credentials', user, pass),

    // RetroAchievements
    testRaCredentials:    (user, key)    => ipcRenderer.invoke('test-ra-credentials', user, key),
    fetchRaAchievements:  (id)           => ipcRenderer.invoke('fetch-ra-achievements', id),
    getRaAchievements:    (raGameId)     => ipcRenderer.invoke('get-ra-achievements', raGameId),

    // Art picker
    sgdbSearchArt: (name, type)      => ipcRenderer.invoke('sgdb-search-art', name, type),
    sgdbApplyArt:  (id, url, type)   => ipcRenderer.invoke('sgdb-apply-art', id, url, type),
    deleteGameArt: (id, type)        => ipcRenderer.invoke('delete-game-art', id, type),
    ssSearchArt:   (id, type)        => ipcRenderer.invoke('ss-search-art', id, type),
    tgdbSearchArt: (name, type, sys) => ipcRenderer.invoke('tgdb-search-art', name, type, sys),
    igdbSearchArt: (name, type, sys) => ipcRenderer.invoke('igdb-search-art', name, type, sys),

    // CNGM import
    importCngmCredentials: () => ipcRenderer.invoke('import-cngm-credentials'),

    // IGDB
    testIgdbCredentials: (id, secret) => ipcRenderer.invoke('test-igdb-credentials', id, secret),
    igdbScrapeGame:      (id)         => ipcRenderer.invoke('igdb-scrape-game', id),
    igdbScrapeGameMeta:  (id)         => ipcRenderer.invoke('igdb-scrape-game', id, true),

    // TheGamesDB
    testTgdbKey:   (key) => ipcRenderer.invoke('test-tgdb-key', key),
    tgdbScrapeGame:(id)  => ipcRenderer.invoke('tgdb-scrape-game', id),
    tgdbScrapeGameMeta:(id) => ipcRenderer.invoke('tgdb-scrape-game', id, true),

    // SteamGridDB
    testSgdbKey:   (key) => ipcRenderer.invoke('test-sgdb-key', key),
    sgdbScrapeGame:(id)  => ipcRenderer.invoke('sgdb-scrape-game', id),

    // MobyGames
    testMobyKey:       (key)             => ipcRenderer.invoke('test-moby-key', key),
    mobyScrapeGame:    (id)              => ipcRenderer.invoke('moby-scrape-game', id),
    mobyScrapeGameMeta:(id)              => ipcRenderer.invoke('moby-scrape-game', id, true),
    mobySearchArt:     (name, type, sys) => ipcRenderer.invoke('moby-search-art', name, type, sys),

    // RetroArch detection
    detectRetroArch: () => ipcRenderer.invoke('detect-retroarch'),

    // System presets
    getSystemPresets: () => ipcRenderer.invoke('get-system-presets'),
    biosStatus:     (short)       => ipcRenderer.invoke('bios-status', short),
    biosAddFile:    (short, file) => ipcRenderer.invoke('bios-add-file', short, file),
    biosScanFolder: ()            => ipcRenderer.invoke('bios-scan-folder'),

    // Cores
    scanCores:     ()     => ipcRenderer.invoke('scan-cores'),
    getCores:      ()     => ipcRenderer.invoke('get-cores'),
    scanEmulators: ()     => ipcRenderer.invoke('scan-emulators'),

    // Playlists
    getPlaylists:           ()           => ipcRenderer.invoke('get-playlists'),
    addPlaylist:            (name)       => ipcRenderer.invoke('add-playlist', name),
    updatePlaylist:         (id, name)   => ipcRenderer.invoke('update-playlist', id, name),
    deletePlaylist:         (id)         => ipcRenderer.invoke('delete-playlist', id),
    getPlaylistGames:       (plId)       => ipcRenderer.invoke('get-playlist-games', plId),
    addGameToPlaylist:      (plId, gId)  => ipcRenderer.invoke('add-game-to-playlist', plId, gId),
    removeGameFromPlaylist: (plId, gId)  => ipcRenderer.invoke('remove-game-from-playlist', plId, gId),
    getGamePlaylists:       (gId)        => ipcRenderer.invoke('get-game-playlists', gId),

    // Trailers
    checkLocalTrailer: (title)          => ipcRenderer.invoke('check-local-trailer', title),
    deleteTrailer:     (title)          => ipcRenderer.invoke('delete-trailer', title),
    searchYoutube:     (title)          => ipcRenderer.invoke('search-youtube', title),
    downloadTrailer:   (title, videoId) => ipcRenderer.invoke('download-trailer', title, videoId),
    onDownloadProgress:(cb)             => ipcRenderer.on('download-progress', (_, d) => cb(d)),

    // Misc
    getBaseDir:   () => ipcRenderer.invoke('get-basedir'),
    getConfigDir: () => ipcRenderer.invoke('get-config-dir'),
    openPath:     (p) => ipcRenderer.invoke('open-path', p),
});
