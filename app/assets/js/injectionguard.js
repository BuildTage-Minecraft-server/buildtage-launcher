const child_process = require('child_process')
const fs            = require('fs')
const os            = require('os')
const path          = require('path')
const { LoggerUtil } = require('@visoftware/vis-launcher-core')

const logger = LoggerUtil.getLogger('InjectionGuard')

const FIRST_CHECK_DELAY_MS = 20000
const CHECK_INTERVAL_MS = 15000
const CONFIRMATIONS_REQUIRED = 2
const POWERSHELL_TIMEOUT_MS = 20000

const LINUX_TRUSTED_PREFIXES = ['/usr/', '/lib/', '/lib32/', '/lib64/', '/opt/', '/nix/store/', '/gnu/store/', '/run/opengl-driver/', '/run/host/', '/app/', '/snap/']
const TEMP_TRUSTED_FOLDERS = /^(?:lwjgl_|jna)/i

const LIST_MODULES_SCRIPT = '(Get-Process -Id $env:GUARD_PID -ErrorAction Stop).Modules | ForEach-Object { $_.FileName } | ConvertTo-Json -Compress'

const VERIFY_SCRIPT = '$items = @($env:GUARD_PATHS | ConvertFrom-Json); $items | ForEach-Object { [pscustomobject]@{ path = $_; status = [string](Get-AuthenticodeSignature -LiteralPath $_).Status } } | ConvertTo-Json -Compress'

function normalize(target) {
    const resolved = path.resolve(target)
    return process.platform === 'win32' ? resolved.toLowerCase() : resolved
}

function isInside(target, directory) {
    const base = normalize(directory)
    const value = normalize(target)
    return value === base || value.startsWith(base + path.sep)
}

function powershellPath() {
    const root = process.env.SystemRoot || 'C:\\Windows'
    return path.join(root, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
}

function runPowerShell(script, env) {
    return new Promise((resolve, reject) => {
        child_process.execFile(
            powershellPath(),
            ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
            { env: { ...process.env, ...env }, windowsHide: true, timeout: POWERSHELL_TIMEOUT_MS, maxBuffer: 4 * 1024 * 1024 },
            (err, stdout) => err ? reject(err) : resolve(stdout.trim())
        )
    })
}

function parseJsonList(text) {
    if(!text) {
        return []
    }
    const parsed = JSON.parse(text)
    return Array.isArray(parsed) ? parsed : [parsed]
}

function trustedDirectories(options) {
    const directories = [options.javaHome, options.nativesDir]
    if(process.platform === 'win32') {
        directories.push(process.env.SystemRoot || 'C:\\Windows')
    }
    return directories.filter(Boolean)
}

function isTrustedTempModule(modulePath) {
    const tmp = os.tmpdir()
    if(!isInside(modulePath, tmp)) {
        return false
    }
    const relative = path.relative(path.resolve(tmp), path.resolve(modulePath))
    return TEMP_TRUSTED_FOLDERS.test(relative.split(path.sep)[0])
}

async function findWindowsViolations(pid, options, verified) {
    const modules = parseJsonList(await runPowerShell(LIST_MODULES_SCRIPT, { GUARD_PID: String(pid) }))
    const directories = trustedDirectories(options)
    const unknown = modules.filter(modulePath => typeof modulePath === 'string'
        && !directories.some(directory => isInside(modulePath, directory))
        && !isTrustedTempModule(modulePath)
        && !verified.has(normalize(modulePath)))
    if(unknown.length === 0) {
        return []
    }
    const results = parseJsonList(await runPowerShell(VERIFY_SCRIPT, { GUARD_PATHS: JSON.stringify(unknown) }))
    const violations = []
    for(const entry of results) {
        if(entry.status === 'Valid') {
            verified.add(normalize(entry.path))
        } else {
            violations.push(entry.path)
        }
    }
    return violations
}

function findLinuxViolations(pid, options) {
    const lines = fs.readFileSync(`/proc/${pid}/maps`, 'utf8').split('\n')
    const directories = trustedDirectories(options)
    const violations = new Set()
    for(const line of lines) {
        const match = /^\S+\s+(\S{4})\s+\S+\s+\S+\s+\S+\s+(.+)$/.exec(line)
        if(match == null || !match[1].includes('x')) {
            continue
        }
        const target = match[2].trim()
        const suspicious = /^\/memfd:/.test(target) || /\(deleted\)$/.test(target)
        if(suspicious) {
            violations.add(target)
            continue
        }
        if(!target.startsWith('/') || !/\.so(?:\.|$)/.test(target)) {
            continue
        }
        if(LINUX_TRUSTED_PREFIXES.some(prefix => target.startsWith(prefix))
            || directories.some(directory => isInside(target, directory))
            || isTrustedTempModule(target)) {
            continue
        }
        violations.add(target)
    }
    return [...violations]
}

function startInjectionGuard(options) {
    if(process.platform !== 'win32' && process.platform !== 'linux') {
        return { stop() {} }
    }

    const verified = new Set()
    const strikes = new Map()
    let timer = null
    let stopped = false

    const scan = async () => {
        if(stopped) {
            return
        }
        try {
            const found = process.platform === 'win32'
                ? await findWindowsViolations(options.pid, options, verified)
                : findLinuxViolations(options.pid, options)
            const confirmed = []
            for(const entry of found) {
                const count = (strikes.get(entry) || 0) + 1
                strikes.set(entry, count)
                logger.warn('Unrecognized module in the game process:', entry, `(${count}/${CONFIRMATIONS_REQUIRED})`)
                if(count >= CONFIRMATIONS_REQUIRED) {
                    confirmed.push(entry)
                }
            }
            for(const entry of [...strikes.keys()]) {
                if(!found.includes(entry)) {
                    strikes.delete(entry)
                }
            }
            if(confirmed.length > 0 && !stopped) {
                stopped = true
                options.onViolation(confirmed)
                return
            }
        } catch(err) {
            logger.debug('Module check skipped:', err.message)
        }
        if(!stopped) {
            timer = setTimeout(scan, CHECK_INTERVAL_MS)
        }
    }

    timer = setTimeout(scan, FIRST_CHECK_DELAY_MS)

    return {
        stop() {
            stopped = true
            if(timer != null) {
                clearTimeout(timer)
            }
        }
    }
}

module.exports = { startInjectionGuard }
