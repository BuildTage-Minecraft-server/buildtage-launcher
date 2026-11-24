const fs = require('fs')
const os = require('os')
const path = require('path')
const util = require('util')
const zlib = require('zlib')
const { app, BrowserWindow, clipboard, dialog, shell } = require('electron')

const ConfigManager = require('./configmanager')
const LangLoader = require('./langloader')
const { LOG_UPLOAD_URL } = require('./apiconstants')
const pjson = require('../../../package.json')

const MAX_ENTRY_LENGTH = 10000
const MAX_BATCH_SIZE = 500
const MAX_LAUNCHER_LOG_BYTES = 1024 * 1024
const MAX_GAME_LOG_BYTES = 256 * 1024
const MAX_CRASH_REPORT_BYTES = 128 * 1024
const CRASH_REPORT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000
const UPLOAD_TIMEOUT_MS = 20000
const SEND_COOLDOWN_MS = 30000
const LEVELS = new Set(['debug', 'info', 'warn', 'error'])
const ANSI_PATTERN = /\u001b\[[0-9;]*m/g

const REDACTIONS = [
    [/(--(?:accessToken|session)['",\s]+)[^\s'",\]]+/g, '$1<redacted>'],
    [/Bearer\s+[\w.~+/=-]+/gi, 'Bearer <redacted>'],
    [/((?:access_?token|client_?token|refresh_?token|password|new_?password|secret|authorization)["']?\s*[:=]\s*["']?)[^\s"',}&]+/gi, '$1<redacted>'],
    [/eyJ[\w-]{8,}\.[\w-]{8,}\.[\w-]*/g, '<redacted-jwt>']
]

let logPath = null
let previousLogPath = null
let promptOpen = false
let crashPrompted = false
let lastReport = null

function escapeRegExp(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function buildHomePatterns() {
    const home = os.homedir()
    if(!home || home.length < 2) {
        return []
    }
    const variants = new Set([home, home.replace(/\\/g, '\\\\'), home.replace(/\\/g, '/')])
    const flags = process.platform === 'win32' ? 'gi' : 'g'
    return [...variants].map(variant => new RegExp(escapeRegExp(variant), flags))
}

const HOME_PATTERNS = buildHomePatterns()

function redact(text) {
    let result = text.replace(ANSI_PATTERN, '')
    for(const [pattern, replacement] of REDACTIONS) {
        result = result.replace(pattern, replacement)
    }
    for(const pattern of HOME_PATTERNS) {
        result = result.replace(pattern, '~')
    }
    return result
}

function attempt(fn) {
    try {
        return fn()
    } catch {
        return undefined
    }
}

function append(text) {
    if(logPath == null || text.length === 0) {
        return
    }
    try {
        fs.appendFileSync(logPath, text)
    } catch {
        void 0
    }
}

function formatLine(source, level, message, time) {
    const raw = String(message).slice(0, MAX_ENTRY_LENGTH * 4)
    const text = redact(raw).slice(0, MAX_ENTRY_LENGTH).trimEnd()
    if(text.length === 0) {
        return ''
    }
    const stamp = new Date(Number.isFinite(time) ? time : Date.now()).toISOString()
    const tag = LEVELS.has(level) ? level.toUpperCase() : 'INFO'
    return `${stamp} [${String(source).slice(0, 32)}] [${tag}] ${text}\n`
}

function record(source, level, message) {
    append(formatLine(source, level, message, Date.now()))
}

function recordBatch(entries) {
    if(!Array.isArray(entries)) {
        return
    }
    const lines = entries
        .slice(0, MAX_BATCH_SIZE)
        .map(entry => Array.isArray(entry) ? formatLine(entry[0], entry[1], entry[2], entry[3]) : '')
    append(lines.join(''))
}

function hookStream(target, level) {
    if(target == null || typeof target.write !== 'function') {
        return
    }
    const original = target.write.bind(target)
    target.write = (chunk, ...rest) => {
        try {
            record('main', level, Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk))
        } catch {
            void 0
        }
        return original(chunk, ...rest)
    }
}

function handleUncaughtException(err) {
    record('main', 'error', `Uncaught exception: ${err && err.stack ? err.stack : util.inspect(err)}`)
    if(app.isReady()) {
        reportCrash(BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0])
    } else {
        dialog.showErrorBox(app.name, String(err && err.message ? err.message : err))
    }
}

function init() {
    if(logPath != null) {
        return
    }
    const logsDir = path.join(app.getPath('userData'), 'logs')
    try {
        fs.mkdirSync(logsDir, { recursive: true })
        const current = path.join(logsDir, 'launcher.log')
        previousLogPath = path.join(logsDir, 'launcher.prev.log')
        if(fs.existsSync(current)) {
            fs.renameSync(current, previousLogPath)
        }
        fs.writeFileSync(current, '')
        logPath = current
    } catch {
        return
    }
    hookStream(process.stdout, 'info')
    hookStream(process.stderr, 'error')
    process.on('uncaughtException', handleUncaughtException)
    record('main', 'info', `Session started, CBO ${pjson.version}`)
}

function readTail(file, maxBytes) {
    try {
        const size = fs.statSync(file).size
        const length = Math.min(size, maxBytes)
        const buffer = Buffer.alloc(length)
        const fd = fs.openSync(file, 'r')
        try {
            fs.readSync(fd, buffer, 0, length, size - length)
        } finally {
            fs.closeSync(fd)
        }
        return buffer.toString('utf8')
    } catch {
        return null
    }
}

function newestCrashReport(dir) {
    try {
        const newest = fs.readdirSync(dir)
            .filter(name => name.endsWith('.txt'))
            .map(name => ({ name, time: fs.statSync(path.join(dir, name)).mtimeMs }))
            .sort((a, b) => b.time - a.time)[0]
        if(newest == null || Date.now() - newest.time > CRASH_REPORT_MAX_AGE_MS) {
            return null
        }
        return { name: newest.name, content: readTail(path.join(dir, newest.name), MAX_CRASH_REPORT_BYTES) }
    } catch {
        return null
    }
}

function formatGigabytes(bytes) {
    return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`
}

function describeSystem() {
    const cpus = os.cpus()
    const serverId = attempt(() => ConfigManager.getSelectedServer())
    const account = attempt(() => ConfigManager.getSelectedAccount())
    const lines = [
        `Generated: ${new Date().toISOString()}`,
        `Launcher: ${pjson.version} (${app.isPackaged ? 'packaged' : 'development'})`,
        `OS: ${os.type()} ${os.release()} ${os.arch()}`,
        `Electron: ${process.versions.electron}, Chrome: ${process.versions.chrome}, Node: ${process.versions.node}`,
        `Memory: ${formatGigabytes(os.freemem())} free of ${formatGigabytes(os.totalmem())}`,
        `CPU: ${cpus.length > 0 ? cpus[0].model : 'unknown'} x${cpus.length}`,
        `Locale: ${app.getLocale()}`,
        `Player: ${account && account.displayName ? account.displayName : 'none'}`,
        `Server: ${serverId || 'none'}`
    ]
    if(serverId) {
        const minRam = attempt(() => ConfigManager.getMinRAM(serverId))
        const maxRam = attempt(() => ConfigManager.getMaxRAM(serverId))
        lines.push(`Java: ${attempt(() => ConfigManager.getJavaExecutable(serverId)) || 'not set'}`)
        lines.push(`RAM: ${minRam || '?'} to ${maxRam || '?'}`)
    }
    return lines.join('\n')
}

function section(title, content) {
    return `\n\n===== ${title} =====\n${content == null ? '(not available)' : content}`
}

function buildReport() {
    let report = `===== System =====\n${describeSystem()}`
    report += section('launcher.log', readTail(logPath, MAX_LAUNCHER_LOG_BYTES))
    report += section('launcher.prev.log', readTail(previousLogPath, MAX_LAUNCHER_LOG_BYTES))
    const serverId = attempt(() => ConfigManager.getSelectedServer())
    const instanceDir = attempt(() => ConfigManager.getInstanceDirectory())
    if(serverId && instanceDir) {
        const gameDir = path.join(instanceDir, serverId)
        report += section('game latest.log', readTail(path.join(gameDir, 'logs', 'latest.log'), MAX_GAME_LOG_BYTES))
        const crash = newestCrashReport(path.join(gameDir, 'crash-reports'))
        if(crash != null) {
            report += section(`game crash report ${crash.name}`, crash.content)
        }
    }
    return redact(report)
}

async function upload() {
    const body = zlib.gzipSync(Buffer.from(buildReport(), 'utf8'))
    const res = await fetch(LOG_UPLOAD_URL, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/gzip',
            'X-Launcher-Version': pjson.version
        },
        body,
        signal: AbortSignal.timeout(UPLOAD_TIMEOUT_MS)
    })
    let data = {}
    try {
        data = await res.json()
    } catch {
        void 0
    }
    if(!res.ok || typeof data.id !== 'string') {
        throw new Error(data.code || `HTTP ${res.status}`)
    }
    return data.id
}

function t(key, placeholders) {
    const id = `logs.${key}`
    try {
        return LangLoader.queryJS(id, placeholders)
    } catch {
        void 0
    }
    LangLoader.loadLanguage('en_US')
    try {
        return LangLoader.queryJS(id, placeholders)
    } catch {
        return key
    }
}

function usableWindow(window) {
    return window != null && !window.isDestroyed() ? window : undefined
}

function showBox(window, options) {
    const base = { title: t('title'), noLink: true, ...options }
    return window ? dialog.showMessageBox(window, base) : dialog.showMessageBox(base)
}

async function confirmSend(window, crashed) {
    const { response } = await showBox(window, {
        type: crashed ? 'error' : 'question',
        message: t(crashed ? 'crashMessage' : 'confirmMessage'),
        detail: t('confirmDetail'),
        buttons: [t('send'), t('cancel')],
        defaultId: 0,
        cancelId: 1
    })
    return response === 0
}

async function showSent(window, id) {
    const { response } = await showBox(window, {
        type: 'info',
        message: t('sentMessage'),
        detail: t('sentDetail', { id }),
        buttons: [t('copyId'), t('ok')],
        defaultId: 1,
        cancelId: 1
    })
    if(response === 0) {
        clipboard.writeText(id)
    }
}

async function showFailure(window, err) {
    const { response } = await showBox(window, {
        type: 'error',
        message: t('failedMessage'),
        detail: t('failedDetail', { error: err.message }),
        buttons: [t('openFolder'), t('ok')],
        defaultId: 1,
        cancelId: 1
    })
    if(response === 0 && logPath != null) {
        shell.showItemInFolder(logPath)
    }
}

async function promptAndSend(parent, { crashed = false } = {}) {
    if(promptOpen) {
        return
    }
    promptOpen = true
    const window = usableWindow(parent)
    try {
        if(lastReport != null && Date.now() - lastReport.time < SEND_COOLDOWN_MS) {
            await showBox(window, {
                type: 'info',
                message: t('tooSoon', { id: lastReport.id }),
                buttons: [t('ok')]
            })
            return
        }
        if(!await confirmSend(window, crashed)) {
            return
        }
        let id
        try {
            id = await upload()
        } catch(err) {
            record('main', 'error', `Log upload failed: ${err.message}`)
            await showFailure(window, err)
            return
        }
        lastReport = { id, time: Date.now() }
        record('main', 'info', `Log report uploaded as ${id}`)
        await showSent(window, id)
    } catch(err) {
        record('main', 'error', `Log report dialog failed: ${err.message}`)
    } finally {
        promptOpen = false
    }
}

function reportCrash(window) {
    if(crashPrompted) {
        return
    }
    crashPrompted = true
    promptAndSend(window, { crashed: true })
}

function watch(window) {
    const contents = window.webContents
    contents.on('before-input-event', (event, input) => {
        if(input.type === 'keyDown' && input.shift && (input.control || input.meta) && input.code === 'KeyL') {
            event.preventDefault()
            promptAndSend(window)
        }
    })
    contents.on('render-process-gone', (event, details) => {
        record('main', 'error', `Renderer process gone: ${details.reason} (exit code ${details.exitCode})`)
        if(details.reason !== 'clean-exit') {
            reportCrash(window)
        }
    })
    contents.on('did-fail-load', (event, code, description, url, isMainFrame) => {
        if(!isMainFrame || code === -3) {
            return
        }
        record('main', 'error', `Failed to load ${url}: ${description} (${code})`)
        reportCrash(window)
    })
    contents.on('unresponsive', () => {
        record('main', 'warn', 'Renderer process became unresponsive')
    })
}

module.exports = { init, record, recordBatch, watch, promptAndSend }
