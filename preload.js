const { contextBridge, ipcRenderer, webFrame } = require('electron');

contextBridge.exposeInMainWorld('api', {
    signalReady: () => ipcRenderer.send('renderer-ready'),
    setZoom:     (f) => webFrame.setZoomFactor(f),

    minimize: () => ipcRenderer.send('window-minimize'),
    maximize: () => ipcRenderer.send('window-maximize'),
    close:    () => ipcRenderer.send('window-close'),
    enterCouch: (opts) => ipcRenderer.invoke('enter-couch-mode', opts),
    exitCouch:  ()     => ipcRenderer.invoke('exit-couch-mode'),

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
    createM3u:       (payload) => ipcRenderer.invoke('create-m3u', payload),
    repairDiscRefsGame:   (id) => ipcRenderer.invoke('repair-disc-refs-game', id),
    repairDiscRefsSystem: (id) => ipcRenderer.invoke('repair-disc-refs-system', id),

    // RetroArch launch settings (override editor)
    getRaOverride: (scope, refId) => ipcRenderer.invoke('get-ra-override', scope, refId),
    setRaOverride: (scope, refId, data) => ipcRenderer.invoke('set-ra-override', scope, refId, data),
    getMonitors:   ()  => ipcRenderer.invoke('get-monitors'),
    listRaShaders: ()  => ipcRenderer.invoke('list-ra-shaders'),

    // EmuLatte-owned RetroArch config (engine model)
    raConfigInfo:        ()        => ipcRenderer.invoke('ra-config-info'),
    raConfigGetAll:      ()        => ipcRenderer.invoke('ra-config-get-all'),
    raConfigSet:         (updates) => ipcRenderer.invoke('ra-config-set', updates),
    raConfigReimportPaths: ()      => ipcRenderer.invoke('ra-config-reimport-paths'),
    raConfigReset:       ()        => ipcRenderer.invoke('ra-config-reset'),
    raConfigOpenFolder:  ()        => ipcRenderer.invoke('ra-config-open-folder'),
    raConfigRelocate:    ()        => ipcRenderer.invoke('ra-config-relocate'),
    raConfigImport:      ()        => ipcRenderer.invoke('ra-config-import'),
    raConfigExport:      ()        => ipcRenderer.invoke('ra-config-export'),
    launchRetroarchConfig: ()      => ipcRenderer.invoke('launch-retroarch-config'),
    raCoreOptionsGet:    ()              => ipcRenderer.invoke('ra-core-options-get'),
    raCoreOptionsSet:    (updates)       => ipcRenderer.invoke('ra-core-options-set', updates),
    raBrowseShaders:     (rel)           => ipcRenderer.invoke('ra-browse-shaders', rel),
    downloadShaderPack:  ()              => ipcRenderer.invoke('download-shader-pack'),
    installBundledPresets: ()            => ipcRenderer.invoke('install-bundled-presets'),
    onShaderPackProgress: (cb)           => ipcRenderer.on('shader-pack-progress', (_, d) => cb(d)),
    raListRemaps:        ()              => ipcRenderer.invoke('ra-list-remaps'),
    raRemapToggle:       (file, enable)  => ipcRenderer.invoke('ra-remap-toggle', file, enable),
    raRemapDelete:       (file)          => ipcRenderer.invoke('ra-remap-delete', file),
    getControlTemplates: ()              => ipcRenderer.invoke('get-control-templates'),
    installControlTemplate: (id, sysId)  => ipcRenderer.invoke('install-control-template', id, sysId),

    // Save-state manager
    listSaveStates:     (id)            => ipcRenderer.invoke('list-save-states', id),
    listGamesWithSaves: ()              => ipcRenderer.invoke('list-games-with-saves'),
    setSaveLabel:       (id, slot, lbl) => ipcRenderer.invoke('set-save-label', id, slot, lbl),
    deleteSaveState:    (file)          => ipcRenderer.invoke('delete-save-state', file),
    launchGameEx:       (id, opts)      => ipcRenderer.invoke('launch-game-ex', id, opts),

    // Backup / restore
    backupSaves:       (scope, refId) => ipcRenderer.invoke('backup-saves', scope, refId),
    restoreSaves:      ()             => ipcRenderer.invoke('restore-saves'),
    backupRaSettings:  ()             => ipcRenderer.invoke('backup-ra-settings'),
    restoreRaSettings: ()             => ipcRenderer.invoke('restore-ra-settings'),

    // Image management
    selectLocalImage: (id, type) => ipcRenderer.invoke('select-local-image', id, type),
    readFileBase64:   (p)        => ipcRenderer.invoke('read-file-base64', p),

    // Screenscraper
    scrapeGame:         (id, metaOnly, searchName) => ipcRenderer.invoke('scrape-game', id, !!metaOnly, searchName || ''),
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
    listAvailableCores: () => ipcRenderer.invoke('list-available-cores'),
    installCore:   (core) => ipcRenderer.invoke('install-core', core),
    onCoreInstallProgress: (cb) => ipcRenderer.on('core-install-progress', (_, d) => cb(d)),
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
    cleanUnusedMedia:  (dryRun)         => ipcRenderer.invoke('clean-unused-media', dryRun),
    createBackup:      (scope)          => ipcRenderer.invoke('create-backup', scope),
    restoreBackup:     ()               => ipcRenderer.invoke('restore-backup'),
    searchYoutube:     (title)          => ipcRenderer.invoke('search-youtube', title),
    downloadTrailer:   (title, videoId) => ipcRenderer.invoke('download-trailer', title, videoId),
    onDownloadProgress:(cb)             => ipcRenderer.on('download-progress', (_, d) => cb(d)),

    // Misc
    getBaseDir:   () => ipcRenderer.invoke('get-basedir'),
    getConfigDir: () => ipcRenderer.invoke('get-config-dir'),
    openPath:     (p) => ipcRenderer.invoke('open-path', p),
});
