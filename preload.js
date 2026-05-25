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
    scrapeBatch:        (ids)    => ipcRenderer.invoke('scrape-batch', ids),
    cancelScrape:       ()       => ipcRenderer.invoke('cancel-scrape'),
    computeCrc32:       (p)      => ipcRenderer.invoke('compute-crc32', p),
    onScrapeProgress:   (cb)     => ipcRenderer.on('scrape-progress', (_, d) => cb(d)),
    fetchSsSystems:       ()             => ipcRenderer.invoke('fetch-ss-systems'),
    testSsCredentials:    (user, pass)   => ipcRenderer.invoke('test-ss-credentials', user, pass),

    // RetroArch detection
    detectRetroArch: () => ipcRenderer.invoke('detect-retroarch'),

    // System presets
    getSystemPresets: () => ipcRenderer.invoke('get-system-presets'),

    // Cores
    scanCores: ()         => ipcRenderer.invoke('scan-cores'),
    getCores:  ()         => ipcRenderer.invoke('get-cores'),

    // Playlists
    getPlaylists:           ()           => ipcRenderer.invoke('get-playlists'),
    addPlaylist:            (name)       => ipcRenderer.invoke('add-playlist', name),
    updatePlaylist:         (id, name)   => ipcRenderer.invoke('update-playlist', id, name),
    deletePlaylist:         (id)         => ipcRenderer.invoke('delete-playlist', id),
    getPlaylistGames:       (plId)       => ipcRenderer.invoke('get-playlist-games', plId),
    addGameToPlaylist:      (plId, gId)  => ipcRenderer.invoke('add-game-to-playlist', plId, gId),
    removeGameFromPlaylist: (plId, gId)  => ipcRenderer.invoke('remove-game-from-playlist', plId, gId),
    getGamePlaylists:       (gId)        => ipcRenderer.invoke('get-game-playlists', gId),

    // Misc
    getBaseDir:   () => ipcRenderer.invoke('get-basedir'),
    getConfigDir: () => ipcRenderer.invoke('get-config-dir'),
    openPath:     (p) => ipcRenderer.invoke('open-path', p),
});
