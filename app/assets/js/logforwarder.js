const { ipcRenderer } = require('electron')
const util = require('util')

const FLUSH_DELAY_MS = 200
const CONSOLE_LEVELS = {
    log: 'info',
    info: 'info',
    debug: 'debug',
    warn: 'warn',
    error: 'error'
}

let queue = []
let timer = null

function sourceName() {
    try {
        return location.pathname.split('/').pop() || 'renderer'
    } catch {
        return 'renderer'
    }
}

function flush() {
    timer = null
    if(queue.length === 0) {
        return
    }
    const batch = queue
    queue = []
    try {
        ipcRenderer.send('logs-entries', batch)
    } catch {
        void 0
    }
}

function forward(level, args) {
    try {
        queue.push([sourceName(), level, util.format(...args), Date.now()])
        if(timer == null) {
            timer = setTimeout(flush, FLUSH_DELAY_MS)
        }
    } catch {
        void 0
    }
}

Object.entries(CONSOLE_LEVELS).forEach(([method, level]) => {
    const original = console[method].bind(console)
    console[method] = (...args) => {
        forward(level, args)
        original(...args)
    }
})

window.addEventListener('error', event => {
    forward('error', [`Uncaught error: ${event.message} at ${event.filename}:${event.lineno}:${event.colno}`, event.error])
})

window.addEventListener('unhandledrejection', event => {
    forward('error', ['Unhandled promise rejection:', event.reason])
})

window.addEventListener('beforeunload', flush)
