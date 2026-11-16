/*
    ____   ____.___    _________       _____  __                                 
\   \ /   /|   |  /   _____/ _____/ ____\/  |___  _  _______ _______   ____  
 \   Y   / |   |  \_____  \ /  _ \   __\\   __\ \/ \/ /\__  \\_  __ \_/ __ \ 
  \     /  |   |  /        (  <_> )  |   |  |  \     /  / __ \|  | \/\  ___/ 
   \___/   |___| /_______  /\____/|__|   |__|   \/\_/  (____  /__|    \___  >
                         \/                                 \/            \/ 
                         
    © 2023-2026 VI Software and contributors.
    Portions © 2017-2026 Daniel D. Scalzi. Licensed under the MIT License.

    License: GNU Affero General Public License v3.0 (AGPL-3.0)
    https://www.gnu.org/licenses/agpl-3.0.en.html

    This program is distributed in the hope that it will be useful, but WITHOUT 
    ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or 
    FITNESS FOR A PARTICULAR PURPOSE. See the license for more details.

    GitHub:  https://github.com/VI-Software
    Website: https://visoftware.dev
*/


const remoteMain = require('@electron/remote/main')
remoteMain.initialize()

// Requirements
const { app, BrowserWindow, ipcMain, Menu } = require('electron')
const autoUpdater = require('electron-updater').autoUpdater
const ejse = require('ejs-electron')
const fs = require('fs')
const isDev = require('./app/assets/js/isdev')
const path = require('path')
const semver = require('semver')
const { pathToFileURL } = require('url')
const LangLoader = require('./app/assets/js/langloader')
const ConfigManager = require('./app/assets/js/configmanager')
const { DistroAPI } = require('./app/assets/js/distromanager')
const ModStoreManager = require('./app/assets/js/modstoremanager')
const pjson = require('./package.json')
const { Client: DiscordRPCClient } = require('@visoftware/discord-rpc')

if(!isDev && process.argv.some(arg => /^--(?:remote-debugging|inspect|debug|js-flags)/.test(arg))) {
    app.exit(1)
}

let discordClient = null
let discordActivity = null

// Setup auto updater.
function initAutoUpdater(event, data) {

    if (data) {
        autoUpdater.allowPrerelease = true
    } else {
        // Defaults to true if application version contains prerelease components (e.g. 0.12.1-alpha.1)
        // autoUpdater.allowPrerelease = true
    }

    // Set the update channel from config
    autoUpdater.channel = ConfigManager.getChannel()

    if (isDev) {
        autoUpdater.autoInstallOnAppQuit = false
        autoUpdater.updateConfigPath = path.join(__dirname, 'dev-app-update.yml')
    }
    if (process.platform === 'darwin') {
        autoUpdater.autoDownload = false
    }

    autoUpdater.requestHeaders = {
        'User-Agent': 'BuildTage-Launcher/' + pjson.version
    }
    autoUpdater.timeout = 180000 // 3 min timeout

    // Set installer options to skip user/system level prompt on Windows
    if (process.platform === 'win32') {
        autoUpdater.installerOptions = {
            perMachine: false,  // Force per-user installation, to skip that prompt
        }
    }

    autoUpdater.on('update-available', (info) => {
        event.sender.send('autoUpdateNotification', 'update-available', info)
    })
    autoUpdater.on('update-downloaded', (info) => {
        event.sender.send('autoUpdateNotification', 'update-downloaded', info)
    })
    autoUpdater.on('update-not-available', (info) => {
        event.sender.send('autoUpdateNotification', 'update-not-available', info)
    })
    autoUpdater.on('checking-for-update', () => {
        event.sender.send('autoUpdateNotification', 'checking-for-update')
    })
    autoUpdater.on('error', (err) => {
        event.sender.send('autoUpdateNotification', 'realerror', err)
    })
    autoUpdater.on('download-progress', (progress) => {
        event.sender.send('autoUpdateNotification', 'download-progress', progress)
    })
}

// Configure auto-updater specifically for the splash flow. This forwards
// autoUpdater events to the splash renderer and triggers a check immediately.
function configureAutoUpdaterForSplash(allowPrerelease = false) {
    try {
        autoUpdater.allowPrerelease = !!allowPrerelease

        // Set the update channel from config
        autoUpdater.channel = ConfigManager.getChannel()

        // Allow downgrade if user just switched channels (e.g., canary -> stable)
        // This enables users to move to a lower version when changing to a more stable channel
        autoUpdater.allowDowngrade = ConfigManager.wasChannelChanged()

        if (isDev) {
            autoUpdater.autoInstallOnAppQuit = false
            autoUpdater.updateConfigPath = path.join(__dirname, 'dev-app-update.yml')
        }

        autoUpdater.requestHeaders = {
            'User-Agent': 'BuildTage-Launcher/' + pjson.version
        }
        autoUpdater.timeout = 180000 // 3 min timeout

        // Hide installer prompts on Windows
        if (process.platform === 'win32') {
            autoUpdater.installerOptions = {
                perMachine: false,  // Force per-user installation, no prompt
                args: ['/S']  // Silent install - no UI shown during update
            }
        }

        autoUpdater.on('checking-for-update', () => {
            try { if (splashWin && splashWin.webContents) splashWin.webContents.send('autoUpdateNotification', 'checking-for-update') } catch { void 0 }
        })

        autoUpdater.on('update-available', (info) => {
            try { if (splashWin && splashWin.webContents) splashWin.webContents.send('autoUpdateNotification', 'update-available', info) } catch { void 0 }
        })

        autoUpdater.on('update-not-available', (info) => {
            try { if (splashWin && splashWin.webContents) splashWin.webContents.send('autoUpdateNotification', 'update-not-available', info) } catch { void 0 }
        })

        autoUpdater.on('error', (err) => {
            try { if (splashWin && splashWin.webContents) splashWin.webContents.send('autoUpdateNotification', 'realerror', err) } catch { void 0 }
        })

        // progress during download
        autoUpdater.on('download-progress', (progress) => {
            try {
                const percent = progress && progress.percent ? Math.floor(progress.percent) : 0
                const transferredMB = progress && progress.transferred ? (progress.transferred / (1024 * 1024)).toFixed(1) : '0'
                const totalMB = progress && progress.total ? (progress.total / (1024 * 1024)).toFixed(1) : '0'
                if (splashWin && splashWin.webContents) splashWin.webContents.send('splash-progress', { percent, message: `Загрузка ${transferredMB} МБ / ${totalMB} МБ` })
                if (splashWin && splashWin.webContents) splashWin.webContents.send('autoUpdateNotification', 'download-progress', progress)
            } catch { void 0 }
        })

        autoUpdater.on('update-downloaded', (info) => {
            try {
                if (splashWin && splashWin.webContents) splashWin.webContents.send('autoUpdateNotification', 'update-downloaded', info)
                if (splashWin && splashWin.webContents) splashWin.webContents.send('splash-message', 'Установка обновления...')
            } catch { void 0 }
            // Mandatory install when running a production build. In dev we don't auto-install.
            if (!isDev) {
                // Install immediately and restart automatically
                setTimeout(() => {
                    try { autoUpdater.quitAndInstall(true, true) } catch (err) { console.error('Failed to quit and install update', err) }
                }, 1000)
            }
        })

        try {
            // Auto update is handled by distributionIndexDone
        } catch { /* ignore */ }
    } catch (err) {
        console.error('Failed to configure auto-updater for splash', err)
    }
}

// Open channel to listen for update actions.
ipcMain.on('autoUpdateAction', (event, arg, data) => {
    switch (arg) {
        case 'initAutoUpdater':
            console.log('Initializing auto updater.')
            initAutoUpdater(event, data)
            event.sender.send('autoUpdateNotification', 'ready')
            break
        case 'checkForUpdate':
            autoUpdater.checkForUpdates()
                .catch(err => {
                    event.sender.send('autoUpdateNotification', 'realerror', err)
                })
            break
        case 'allowPrereleaseChange':
            if (!data) {
                const preRelComp = semver.prerelease(app.getVersion())
                if (preRelComp != null && preRelComp.length > 0) {
                    autoUpdater.allowPrerelease = true
                } else {
                    autoUpdater.allowPrerelease = data
                }
            } else {
                autoUpdater.allowPrerelease = data
            }
            break
        case 'installUpdateNow':
            autoUpdater.quitAndInstall(true, true)
            break
        default:
            console.log('Unknown argument', arg)
            break
    }
})
// Redirect distribution index event from preloader to renderer.
ipcMain.on('distributionIndexDone', (event, res) => {
    event.sender.send('distributionIndexDone', res)
})

// Handle X11 relaunch request from splash screen
ipcMain.on('relaunch-for-x11', () => {
    const { spawn } = require('child_process')
    
    // AppImage workaround
    // see: https://github.com/electron-userland/electron-builder/issues/1727
    if (app.isPackaged && process.env.APPIMAGE) {
        // Spawn detached process with X11 arguments
        spawn(process.env.APPIMAGE, process.argv.slice(1).concat(['--ozone-platform=x11', '--no-sandbox']), {
            detached: true,
            stdio: 'ignore'
        }).unref()
        app.quit()
    } else {
        app.relaunch({
            args: process.argv.slice(1).concat(['--ozone-platform=x11', '--no-sandbox'])
        })
        app.exit(0)
    }
})

// Handle app restart request
ipcMain.on('restart-app', () => {
    const { spawn } = require('child_process')

    // AppImage workaround
    // see: https://github.com/electron-userland/electron-builder/issues/1727
    if (app.isPackaged && process.env.APPIMAGE) {
        // Spawn detached process to avoid EPIPE errors
        spawn(process.env.APPIMAGE, process.argv.slice(1), {
            detached: true,
            stdio: 'ignore'
        }).unref()
        app.quit()
    } else {
        app.relaunch()
        app.exit(0)
    }
})

// Forward splash progress/messages from preloader (which sends to main)
// back to the splash window renderer so the UI can update.
ipcMain.on('splash-progress', (_event, payload) => {
    try {
        if (splashWin && splashWin.webContents) splashWin.webContents.send('splash-progress', payload)
    } catch { /* best-effort forward */ }
})
ipcMain.on('splash-message', (_event, message) => {
    try {
        if (splashWin && splashWin.webContents) splashWin.webContents.send('splash-message', message)
    } catch { /* best-effort forward */ }
})
ipcMain.on('splash-done', (_event) => {
    try {
        if (splashWin && splashWin.webContents) splashWin.webContents.send('splash-done')
    } catch { /* best-effort forward */ }
})


// Discord RPC IPC handlers
// We run the Discord RPC client in the main process because we need full Node API support
ipcMain.on('discord-rpc-init', (_event, data) => {
    const { genSettings, servSettings, initialDetails, state } = data

    if (discordClient) {
        try {
            discordClient.destroy()
        } catch { /* doop */ }
        discordClient = null
    }

    discordClient = new DiscordRPCClient({
        clientId: genSettings.clientId
    })

    discordActivity = {
        details: initialDetails,
        state: state,
        largeImageKey: servSettings.largeImageKey,
        largeImageText: servSettings.largeImageText,
        smallImageKey: genSettings.smallImageKey,
        smallImageText: genSettings.smallImageText,
        startTimestamp: new Date().getTime(),
        instance: false
    }

    discordClient.on('ready', () => {
        win.webContents.send('main-log', '[DiscordWrapper] Discord RPC Connected')
        discordClient.user?.setActivity(discordActivity)
    })

    discordClient.login().catch(error => {
        if (error.message.includes('ENOENT')) {
            win.webContents.send('main-log', '[DiscordWrapper] Unable to initialize Discord Rich Presence, no client detected.')
        } else {
            win.webContents.send('main-log', '[DiscordWrapper] Unable to initialize Discord Rich Presence: ' + error.message)
        }
    })
})

ipcMain.on('discord-rpc-update-details', (_event, details) => {
    if (discordActivity && discordClient) {
        discordActivity.details = details
        discordClient.user?.setActivity(discordActivity)
    }
})

ipcMain.on('discord-rpc-shutdown', (_event) => {
    if (discordClient) {
        try {
            discordClient.user?.clearActivity()
            discordClient.destroy()
        } catch { /* ignore */ }
        discordClient = null
        discordActivity = null
    }
})

// When true, temporarily suppress global dialog IPC handlers because
// we are running the early dialog flow which awaits those same events.
let suppressDialogIPC = false
let ranInitialDialogs = false

// Mod Store window IPC handler
ipcMain.on('open-mod-store', () => {
    createModStoreWindow()
})

// IPC handlers for modstore
ipcMain.handle('modstore-get-common-directory', () => {
    return ConfigManager.getCommonDirectory()
})

ipcMain.handle('modstore-get-instance-directory', () => {
    return ConfigManager.getInstanceDirectory()
})

ipcMain.handle('modstore-is-modstore-enabled', () => {
    return ConfigManager.isModStoreEnabled()
})

ipcMain.handle('modstore-get-selected-server', () => {
    // hacky way to refresh the config in case it was changed before sending the reply. 
    // TODO: Make this more politically correct by adding a refresh method to the ConfigManager.
    ConfigManager.load() 
    return ConfigManager.getSelectedServer()
})

ipcMain.handle('modstore-set-selected-server', (event, id) => {
    ConfigManager.setSelectedServer(id)
    ConfigManager.save()
})

ipcMain.handle('modstore-get-server-by-id', async (event, id) => {
    DistroAPI['commonDir'] = ConfigManager.getCommonDirectory()
    DistroAPI['instanceDir'] = ConfigManager.getInstanceDirectory()
    DistroAPI['authHeaders'] = require('./app/assets/js/apiconstants').DISTRO_AUTH_HEADERS
    const distro = await DistroAPI.getDistribution()
    return distro.getServerById(id)
})

ipcMain.on('modstore-log', (event, level, message) => {
    const { LoggerUtil } = require('@visoftware/vis-launcher-core')
    const logger = LoggerUtil.getLogger('ModStore')
    logger[level](message)
})

ipcMain.on('modstore-window-close', (event) => {
    if (modStoreWin && !modStoreWin.isDestroyed()) {
        modStoreWin.close()
    }
})

ipcMain.on('modstore-window-minimize', (event) => {
    if (modStoreWin && !modStoreWin.isDestroyed()) {
        modStoreWin.minimize()
    }
})

ipcMain.on('modstore-window-maximize', (event) => {
    if (modStoreWin && !modStoreWin.isDestroyed()) {
        if (modStoreWin.isMaximized()) {
            modStoreWin.unmaximize()
        } else {
            modStoreWin.maximize()
        }
    }
})

// ModStoreManager delegated handlers
ipcMain.handle('modstore-search-mods', async (event, options) => {
    return await ModStoreManager.searchMods(options)
})

ipcMain.handle('modstore-get-mod-details', async (event, modId) => {
    return await ModStoreManager.getModDetails(modId)
})

ipcMain.handle('modstore-get-mod-versions', async (event, modId, options) => {
    return await ModStoreManager.getModVersions(modId, options)
})

ipcMain.handle('modstore-get-version-details', async (event, versionId) => {
    return await ModStoreManager.getVersionDetails(versionId)
})

ipcMain.handle('modstore-get-categories', async () => {
    return await ModStoreManager.getCategories()
})

ipcMain.handle('modstore-get-loaders', async () => {
    return await ModStoreManager.getLoaders()
})

ipcMain.handle('modstore-get-game-versions', async () => {
    return await ModStoreManager.getGameVersions()
})

ipcMain.handle('modstore-scan-user-mods', async (event, serverId) => {
    const instanceDir = ConfigManager.getInstanceDirectory()
    const fs = require('fs-extra')
    const path = require('path')

    if (!instanceDir || !serverId) {
        return []
    }

    try {
        const modsDir = path.join(instanceDir, serverId, 'mods')
        if (await fs.pathExists(modsDir)) {
            const files = await fs.readdir(modsDir)
            return files.filter((f) => f.endsWith('.jar')).map((f) => f.toLowerCase())
        }
    } catch (error) {
        const { LoggerUtil } = require('@visoftware/vis-launcher-core')
        const logger = LoggerUtil.getLogger('ModStore')
        logger.warn('Failed to scan user mods directory:', error.message)
    }

    return []
})

ipcMain.handle('modstore-install-mod', async (event, version, serverId) => {
    const instanceDir = ConfigManager.getInstanceDirectory()
    const path = require('path')

    if (!instanceDir || !serverId) {
        throw new Error('Instance directory or server ID is not available')
    }

    const modsDir = path.join(instanceDir, serverId, 'mods')
    return await ModStoreManager.installMod(version, modsDir)
})

ipcMain.handle('modstore-remove-mod', async (event, modSlug, serverId, filesToRemove) => {
    const instanceDir = ConfigManager.getInstanceDirectory()
    const path = require('path')

    if (!instanceDir || !serverId) {
        throw new Error('Instance directory or server ID is not available')
    }

    const modsDir = path.join(instanceDir, serverId, 'mods')
    return await ModStoreManager.removeMod(modSlug, modsDir, filesToRemove)
})

// Disable hardware acceleration.
// https://electronjs.org/docs/tutorial/offscreen-rendering
app.disableHardwareAcceleration()
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion')


// Keep a global reference of the window object, if you don't, the window will
// be closed automatically when the JavaScript object is garbage collected.
let win
let splashWin
let modStoreWin
// Timestamp (ms) when splash was shown. Used to enforce a minimum display time.
let splashShownAt = 0

function createWindow() {
    // Determine if the version includes 'nightly' or 'canary' to enable prerelease features
    const isNightly = pjson.version.includes('nightly')
    const isCanary = pjson.version.includes('canary')

    win = new BrowserWindow({
        width: 980,
        height: 552,
        icon: getPlatformIcon('vis-icon'),
        frame: false,
        show: false,
        webPreferences: {
            preload: path.join(__dirname, 'app', 'assets', 'js', 'preloader.js'),
            nodeIntegration: true,
            contextIsolation: false,
            devTools: isDev
        },
        backgroundColor: '#08090f'
    })
    remoteMain.enable(win.webContents)

    if(!isDev) {
        win.webContents.on('devtools-opened', () => win.webContents.closeDevTools())
    }

    const data = {
        bkid: Math.floor((Math.random() * fs.readdirSync(path.join(__dirname, 'app', 'assets', 'images', 'backgrounds')).length)),
        lang: (str, placeHolders) => LangLoader.queryEJS(str, placeHolders),
        isNightly: isNightly,
        isCanary: isCanary
    }
    Object.entries(data).forEach(([key, val]) => ejse.data(key, val))

    win.loadURL(pathToFileURL(path.join(__dirname, 'app', 'app.ejs')).toString())

    // Intentionally do not show main window here. The splash controls
    // when the main window becomes visible to avoid exposing the UI
    // before startup checks finish.

    // Open devtools immediately if requested via CLI flag in development mode
    if (isDev && (process.argv.includes('--devtools') || process.argv.includes('-d'))) {
        try {
            win.webContents.openDevTools({ mode: 'detach' })
        } catch (err) {
            console.warn('Failed to open devtools:', err.message)
        }
    }

    win.removeMenu()

    win.resizable = true

    win.on('closed', () => {
        win = null
    })
}

function createSplashWindow() {
    splashWin = new BrowserWindow({
        width: 640,
        height: 420,
        frame: false,
        transparent: true,
        hasShadow: false,
        resizable: false,
        alwaysOnTop: true,
        modal: false,
        show: false,
        webPreferences: {
            preload: path.join(__dirname, 'app', 'assets', 'js', 'preloader.js'),
            additionalArguments: [
                `--session-type=${process.env.XDG_SESSION_TYPE || 'unknown'}`,
                `--is-wayland-native=${!process.argv.includes('--ozone-platform=x11')}`
            ],
            nodeIntegration: true,
            contextIsolation: false
        }
    })
    remoteMain.enable(splashWin.webContents)
    splashWin.removeMenu()
    splashWin.loadURL(pathToFileURL(path.join(__dirname, 'app', 'splash.ejs')).toString())
    // record shown time now as a fallback in case 'ready-to-show' fires later
    splashShownAt = Date.now()
    splashWin.once('ready-to-show', () => {
        splashShownAt = Date.now()
        splashWin.show()
    })
    splashWin.on('closed', () => { splashWin = null })
}

function createModStoreWindow() {
    // Don't create if already exists
    if (modStoreWin && !modStoreWin.isDestroyed()) {
        modStoreWin.focus()
        return
    }

    modStoreWin = new BrowserWindow({
        width: 1200,
        height: 800,
        minWidth: 900,
        minHeight: 600,
        parent: win,
        modal: false,
        icon: getPlatformIcon('vis-icon'),
        frame: false,
        show: false,
        backgroundColor: '#1a1a2e',
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: path.join(__dirname, 'app', 'assets', 'js', 'modstore-preload.js'),
            sandbox: false,
            devTools: isDev
        }
    })

    const data = {
        lang: (str, placeHolders) => LangLoader.queryEJS(str, placeHolders),
        LangLoader: LangLoader
    }
    Object.entries(data).forEach(([key, val]) => ejse.data(key, val))

    modStoreWin.loadURL(pathToFileURL(path.join(__dirname, 'app', 'modstore.ejs')).toString())


    modStoreWin.once('ready-to-show', () => {
        modStoreWin.show()
        if (isDev && (process.argv.includes('--devtools') || process.argv.includes('-d'))) {
            try {
                modStoreWin.webContents.openDevTools({ mode: 'detach' })
            } catch (err) {
                console.warn('Failed to open devtools:', err.message)
            }
        }

    })
    modStoreWin.removeMenu()

    modStoreWin.on('closed', () => {
        modStoreWin = null
    })
}

function createMenu() {

    if (process.platform === 'darwin') {

        // Extend default included application menu to continue support for quit keyboard shortcut
        let applicationSubMenu = {
            label: 'BuildTage Launcher',
            submenu: [{
                label: 'About BuildTage Launcher',
                selector: 'orderFrontStandardAboutPanel:'
            }, {
                type: 'separator'
            }, {
                label: 'Quit BuildTage Launcher',
                accelerator: 'Command+Q',
                click: () => {
                    app.quit()
                }
            }]
        }

        // New edit menu adds support for text-editing keyboard shortcuts
        let editSubMenu = {
            label: 'Editar',
            submenu: [{
                label: 'Deshacer',
                accelerator: 'CmdOrCtrl+Z',
                selector: 'undo:'
            }, {
                label: 'Rehacer',
                accelerator: 'Shift+CmdOrCtrl+Z',
                selector: 'redo:'
            }, {
                type: 'separator'
            }, {
                label: 'Cortar',
                accelerator: 'CmdOrCtrl+X',
                selector: 'cut:'
            }, {
                label: 'Copiar',
                accelerator: 'CmdOrCtrl+C',
                selector: 'copy:'
            }, {
                label: 'Pegar',
                accelerator: 'CmdOrCtrl+V',
                selector: 'paste:'
            }, {
                label: 'Seleccionar todo',
                accelerator: 'CmdOrCtrl+A',
                selector: 'selectAll:'
            }]
        }

        // Bundle submenus into a single template and build a menu object with it
        let menuTemplate = [applicationSubMenu, editSubMenu]
        let menuObject = Menu.buildFromTemplate(menuTemplate)

        // Assign it to the application
        Menu.setApplicationMenu(menuObject)

    }
}


function getPlatformIcon(filename) {
    let ext
    switch (process.platform) {
        case 'win32':
            ext = 'ico'
            break
        case 'darwin':
        case 'linux':
        default:
            ext = 'png'
            break
    }

    return path.join(__dirname, 'app', 'assets', 'images', `${filename}.${ext}`)
}

const gotTheLock = app.requestSingleInstanceLock()

if (!gotTheLock) {
    app.quit()
} else {
    app.on('second-instance', (event, commandLine, workingDirectory) => {
        // Someone or something tried to run a second instance of our APP, we should focus our window.
        if (win) {
            if (win.isMinimized()) win.restore()
            win.focus()
            win.show()
        }
    })

    app.whenReady().then(async () => {
        LangLoader.setupLanguage()

        function startAfterPrechecks() {

            createWindow()
            createMenu()
            // If splash was used previously, ensure the main window is shown
            try {
                if (!splashWin && win) {
                    win.once && win.once('ready-to-show', () => {
                        try { if (win.isMinimized && win.isMinimized()) win.restore(); win.show() } catch { void 0 }
                    })
                }
            } catch { void 0 }
            // Attempt an immediate show/focus with a brief alwaysOnTop toggle
            // but only if splash is no longer visible.
            if (!splashWin) {
                try {
                    try { if (win && win.isMinimized && win.isMinimized()) win.restore() } catch { void 0 }
                    try { if (win) win.setAlwaysOnTop(true) } catch { void 0 }
                    try { if (win) { win.show(); win.focus() } } catch (e) { console.error('Error forcing main window visible in startAfterPrechecks', e) }
                    setTimeout(() => { try { if (win) win.setAlwaysOnTop(false) } catch { void 0 } }, 250)
                } catch (e) { console.error('Immediate show/focus attempt in startAfterPrechecks failed', e) }
            }
        }

        // Run initial dialogs (canary) before showing the splash.
        try {
            try { ConfigManager.load() } catch { /* best-effort */ }
            // Temporarily suppress global dialog IPC handlers while we await replies
            suppressDialogIPC = true

            // Helper to await an IPC once event and report which channel fired
            const waitOnce = (channel) => new Promise((resolve) => ipcMain.once(channel, (...args) => resolve({ channel, args })))

            // Canary flow: if a canary build and not acknowledged, show the canary dialog
            const isCanaryBuildEarly = pjson.version.includes('canary')
            if (isCanaryBuildEarly && !ConfigManager.getCanaryAcknowledged()) {
                let canaryWinEarly = new BrowserWindow({
                    width: 600,
                    height: 300,
                    resizable: false,
                    modal: !!(win || splashWin),
                    parent: win || splashWin || null,
                    show: false,
                    icon: getPlatformIcon('vis-icon'),
                    webPreferences: {
                        nodeIntegration: true,
                        contextIsolation: false
                    }
                })
                remoteMain.enable(canaryWinEarly.webContents)
                ejse.data('lang', (str, placeHolders) => LangLoader.queryEJS(str, placeHolders))
                const canaryWebsiteURL = LangLoader.queryEJS('landing.canaryWebsiteURL')
                ejse.data('websiteURL', canaryWebsiteURL)
                ejse.data('version', pjson.version)
                canaryWinEarly.loadURL(pathToFileURL(path.join(__dirname, 'app', 'canary.ejs')).toString())
                canaryWinEarly.removeMenu()
                canaryWinEarly.once('ready-to-show', () => canaryWinEarly.show())

                // Wait for either ack or close
                const canaryRes = await Promise.race([
                    waitOnce('canary-ack'),
                    waitOnce('canary-close')
                ])

                try { canaryWinEarly.close() } catch { void 0 }

                if (canaryRes && canaryRes.channel === 'canary-close') {
                    try { canaryWinEarly.close() } catch { void 0 }
                    app.quit()
                    return
                }

                // If ack resolved and the first argument is truthy (don't ask), persist
                if (canaryRes && canaryRes.channel === 'canary-ack' && canaryRes.args && canaryRes.args.length > 0 && canaryRes.args[0]) {
                    try { ConfigManager.setCanaryAcknowledged(pjson.version) } catch (e) { console.error('Failed to persist canary acknowledgment', e) }
                }
            }

        } catch (err) {
            console.error('Error during initial dialogs', err)
        } finally {
            // Re-enable global IPC handlers
            suppressDialogIPC = false
            ranInitialDialogs = true
        }

        // Create and show splash after initial dialogs, preloader will send 'distributionIndexDone'
        try {
            createSplashWindow()
            // Start auto-update check for splash UI immediately
            try { configureAutoUpdaterForSplash(true) } catch { void 0 }
            // When preloader signals distributionIndexDone, close splash and continue
            ipcMain.once('distributionIndexDone', async (evt, res) => {
                // Ensure the splash is visible for at least 2.5 seconds to avoid flicker
                const minShowMs = 3000
                const elapsed = splashShownAt ? (Date.now() - splashShownAt) : minShowMs
                const remaining = Math.max(0, minShowMs - elapsed)

                // First: perform update check and, if an update is downloaded,
                // apply it (production) before continuing startup. This blocks
                // the boot until update resolution per user request.
                try {
                    if (splashWin && splashWin.webContents) splashWin.webContents.send('splash-message', 'Проверка обновлений...')

                    const waitForUpdateResolution = () => new Promise((resolve) => {
                        // Resolve values: { status: 'no-update' } | { status: 'downloaded', info } | { status: 'error', error, hadUpdate?: boolean }
                        let resolved = false
                        let hadUpdate = false
                        function cleanup() {
                            try { autoUpdater.removeListener('update-not-available', onNotAvailable) } catch { void 0 }
                            try { autoUpdater.removeListener('update-downloaded', onDownloaded) } catch { void 0 }
                            try { autoUpdater.removeListener('update-available', onUpdateAvailable) } catch { void 0 }
                            try { autoUpdater.removeListener('error', onError) } catch { void 0 }
                        }
                        const onNotAvailable = () => { if (resolved) return; resolved = true; cleanup(); resolve({ status: 'no-update' }) }
                        const onDownloaded = (info) => { if (resolved) return; resolved = true; cleanup(); resolve({ status: 'downloaded', info }) }
                        const onUpdateAvailable = (info) => { hadUpdate = true }
                        const onError = (err) => { if (resolved) return; resolved = true; cleanup(); resolve({ status: 'error', error: err, hadUpdate }) }

                        autoUpdater.once('update-not-available', onNotAvailable)
                        autoUpdater.once('update-downloaded', onDownloaded)
                        autoUpdater.once('update-available', onUpdateAvailable)
                        autoUpdater.once('error', onError)

                        // Trigger check (best-effort). If checkForUpdates rejects,
                        // the onError handler will resolve the promise.
                        try {
                            autoUpdater.checkForUpdates().catch((err) => { onError(err) })
                        } catch (err) {
                            onError(err)
                        }
                    })

                    // Wait for update resolution. In dev mode skip blocking.
                    let updateResult = { status: 'no-update' }
                    if (!isDev) {
                        updateResult = await waitForUpdateResolution()
                    } else {
                        // Dev env, still allow auto-updater to run in background but don't block boot.
                        try { autoUpdater.checkForUpdates().catch(() => { }) } catch { void 0 }
                    }

                    if (updateResult.status === 'downloaded') {
                        try {
                            if (splashWin && splashWin.webContents) {
                                splashWin.webContents.send('splash-progress', { percent: 100, message: 'Обновление загружено' })
                                splashWin.webContents.send('splash-message', 'Применение обновления...')
                            }
                        } catch { void 0 }
                        // In production, quit and install immediately to apply the update.
                        try {
                            autoUpdater.quitAndInstall(true, true)
                            return
                        } catch (err) {
                            console.error('Failed to quit and install update', err)
                            // Quitting failed?
                            // Fallthrough to continue startup
                        }
                    } else if (updateResult.status === 'error') {
                        console.error('Auto-update failed during check/download:', updateResult.error)
                        const message = updateResult.hadUpdate ? 'Не удалось загрузить обновление, продолжаем запуск' : 'Не удалось проверить обновления, продолжаем запуск'
                        try { if (splashWin && splashWin.webContents) splashWin.webContents.send('splash-message', message) } catch { void 0 }
                    } else {
                        try { if (splashWin && splashWin.webContents) splashWin.webContents.send('splash-message', 'Обновлений нет') } catch { void 0 }
                    }
                } catch (err) {
                    console.error('Error while waiting for update resolution', err)
                }
                // First, perform the normal startup checks
                try {
                    startAfterPrechecks()
                } catch (e) {
                    console.error('Error during post-splash startup', e)
                }

                // Then wait until the main window exists
                // before closing the splash so app doesn't receive window-all-closed.
                const maxWait = 5000 // ms
                const pollInterval = 100
                let waited = 0
                const checkAndClose = () => {
                    const elapsedNow = splashShownAt ? (Date.now() - splashShownAt) : minShowMs
                    // Close only when min display time has passed and the main window exists
                    if ((elapsedNow >= minShowMs) && win) {
                        // Make sure the main window is visible before closing the splash.
                        try {
                            if (win.isMinimized && win.isMinimized()) win.restore()
                            win.show()
                        } catch (e) { console.error('Error showing main window before splash close', e) }

                        // After attempting to show the intended window, set a
                        // short fallback to ensure the main window is visible
                        // in case the previous show attempts failed for any platform-specific reason.
                        try {
                            setTimeout(() => {
                                try {
                                    const anyVisible = win && win.isVisible && win.isVisible()
                                    if (!anyVisible) {
                                        console.warn('No visible window after splash close attempts; creating and showing main window as fallback')
                                        if (!win) {
                                            try { createWindow(); createMenu() } catch (e) { console.error('Fallback failed to create main window', e) }
                                        }
                                        try { if (win) { win.show(); win.focus() } } catch (e) { console.error('Fallback failed to show main window', e) }
                                    }
                                } catch (e) { console.error('Error during post-splash fallback check', e) }
                            }, 750)
                        } catch { void 0 }

                        try { if (splashWin) { splashWin.close(); splashWin = null } } catch { void 0 }
                        clearInterval(timer)
                        return
                    }
                    waited += pollInterval
                    if (waited >= maxWait) {
                        // give up and close splash to avoid blocking forever
                        try { if (splashWin) { splashWin.close(); splashWin = null } } catch { void 0 }
                        clearInterval(timer)
                    }
                }

                const timer = setInterval(checkAndClose, pollInterval)
                // start checking after remaining ms to respect min display
                setTimeout(() => checkAndClose(), remaining)
            })
            // We created the splash and will continue startup once the preloader
            // signals completion. Return here to avoid running the duplicate
            // createWindow logic below and accidentally creating two apps.
            return
        } catch (err) {
            console.error('Failed to create splash window', err)
            startAfterPrechecks()
        }
        // Create the main window
        try {
            ConfigManager.load()
            // If this is a canary build, and user has not acknowledged canary warnings,
            // show a short modal that warns about possible instability. The dialog
            // requires at least 10 seconds before the user can accept and has a
            // "don't show again" checkbox.
            const isCanaryBuild = pjson.version.includes('canary')
            if (!ranInitialDialogs && isCanaryBuild && !ConfigManager.getCanaryAcknowledged()) {
                let canaryWin = new BrowserWindow({
                    width: 600,
                    height: 400,
                    resizable: false,
                    modal: !!(win || splashWin),
                    parent: win || splashWin || null,
                    show: false,
                    icon: getPlatformIcon('vis-icon'),
                    webPreferences: {
                        nodeIntegration: true,
                        contextIsolation: false
                    }
                })
                remoteMain.enable(canaryWin.webContents)

                ejse.data('lang', (str, placeHolders) => LangLoader.queryEJS(str, placeHolders))
                const canaryWebsiteURL = LangLoader.queryEJS('landing.canaryWebsiteURL')
                ejse.data('websiteURL', canaryWebsiteURL)
                ejse.data('version', pjson.version)

                canaryWin.loadURL(pathToFileURL(path.join(__dirname, 'app', 'canary.ejs')).toString())
                canaryWin.removeMenu()
                canaryWin.once('ready-to-show', () => canaryWin.show())

                const { ipcMain } = require('electron')
                ipcMain.once('canary-ack', (evt, dontAsk) => {
                    if (suppressDialogIPC) {
                        return
                    }
                    if (dontAsk) {
                        try { ConfigManager.setCanaryAcknowledged(pjson.version) } catch (e) { console.error('Failed to persist canary acknowledgement', e) }
                    }
                    ejse.data('websiteURL', LangLoader.queryEJS('landing.websiteURL'))
                    try { canaryWin.close() } catch (err) { console.error('Error closing canary window', err) }
                    // After the canary dialog, continue with the normal startup.
                    startAfterPrechecks()
                })
                ipcMain.once('canary-close', () => {
                    ejse.data('websiteURL', LangLoader.queryEJS('landing.websiteURL'))
                    try { canaryWin.close() } catch (err) { console.error('Error closing canary window', err) }
                    app.quit()
                })

                // Wait here and skip creating the main window until user responds
                return
            }
            createWindow()
            createMenu()
            try {
                if (!splashWin && win) {
                    win.once && win.once('ready-to-show', () => {
                        try { if (win.isMinimized && win.isMinimized()) win.restore(); win.show() } catch { void 0 }
                    })
                }
            } catch { void 0 }
        } catch (err) {
            console.error('Failed to load configuration', err)
            createWindow()
            createMenu()
        }
    })
}

app.on('window-all-closed', () => {
    // On macOS it is common for applications and their menu bar
    // to stay active until the user quits explicitly with Cmd + Q
    if (process.platform !== 'darwin') {
        app.quit()
    }
})

app.on('activate', () => {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (win === null) {
        createWindow()
    }
})