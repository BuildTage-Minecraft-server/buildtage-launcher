const MAX_BODY_BYTES = 2048
const MAX_LAUNCH_BODY_BYTES = 8192
const UPSTREAM_TIMEOUT_MS = 10000
const USERNAME_PATTERN = /^[a-zA-Z0-9_]{3,16}$/
const MIN_PASSWORD_LENGTH = 8
const MAX_LOG_UPLOAD_BYTES = 2 * 1024 * 1024
const MAX_VERSION_LENGTH = 32
const MSK_OFFSET = '+03:00'
const OPENS_AT_PATTERN = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})$/

function respond(status, body) {
    return new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
    })
}

function reply(status, code, message, extra) {
    const body = { code, ...extra }
    if(message) {
        body.message = message
    }
    return respond(status, body)
}

function upstream(env, path, init) {
    return fetch(`${env.DRASL_URL}${path}`, { ...init, signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS) })
}

function isText(value, max) {
    return typeof value === 'string' && value.length > 0 && value.length <= max
}

function parseRequest(raw) {
    let data
    try {
        data = JSON.parse(raw)
    } catch {
        return null
    }
    if(data == null || typeof data !== 'object' || !isText(data.username, 128) || !isText(data.password, 256)) {
        return null
    }
    const changes = {}
    if(data.playerName !== undefined) {
        if(!isText(data.playerName, 64)) {
            return null
        }
        changes.playerName = data.playerName
    }
    if(data.newPassword !== undefined) {
        if(!isText(data.newPassword, 256)) {
            return null
        }
        changes.password = data.newPassword
    }
    if(Object.keys(changes).length === 0) {
        return null
    }
    return { username: data.username, password: data.password, changes }
}

async function verifyPassword(env, username, password) {
    const res = await upstream(env, '/authlib-injector/authserver/authenticate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agent: { name: 'Minecraft', version: 1 }, username, password, requestUser: false })
    })
    if(res.status === 401 || res.status === 403) {
        return reply(403, 'wrongPassword')
    }
    if(res.status === 429) {
        return reply(429, 'rateLimited')
    }
    if(!res.ok) {
        return reply(502, 'unavailable')
    }
    try {
        const session = await res.json()
        await upstream(env, '/authlib-injector/authserver/invalidate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ accessToken: session.accessToken, clientToken: session.clientToken })
        })
    } catch {
        return null
    }
    return null
}

async function findUser(env, username) {
    const res = await upstream(env, '/drasl/api/v3/users', {
        headers: { Authorization: `Bearer ${env.DRASL_ADMIN_TOKEN}` }
    })
    if(!res.ok) {
        return null
    }
    const needle = username.toLowerCase()
    return (await res.json()).find(entry => typeof entry.username === 'string' && entry.username.toLowerCase() === needle) || null
}

async function findUserUuid(env, username) {
    const user = await findUser(env, username)
    return user != null && typeof user.uuid === 'string' ? user.uuid : null
}

function classifyFailure(status, message) {
    console.error('drasl failure', status, message)
    if(status === 429) {
        return reply(429, 'rateLimited')
    }
    if(status === 409 || /taken|already|exists|in use/i.test(message)) {
        return reply(409, 'nameTaken')
    }
    if(status === 404 || status === 401 || status === 403 || status >= 500) {
        return reply(502, 'unavailable')
    }
    return reply(400, 'rejected', message)
}

function parseRegistration(raw) {
    let data
    try {
        data = JSON.parse(raw)
    } catch {
        return null
    }
    if(data == null || typeof data !== 'object' || typeof data.username !== 'string' || typeof data.password !== 'string') {
        return null
    }
    if(!USERNAME_PATTERN.test(data.username) || data.password.length < MIN_PASSWORD_LENGTH || data.password.length > 256) {
        return null
    }
    return { username: data.username, password: data.password }
}

async function readFailureMessage(res) {
    try {
        return String((await res.json()).message || '')
    } catch {
        return ''
    }
}

async function registerAccount(request, env) {
    const raw = await request.text()
    if(raw.length > MAX_BODY_BYTES) {
        return reply(413, 'rejected')
    }
    const parsed = parseRegistration(raw)
    if(parsed == null) {
        return reply(400, 'rejected')
    }
    const res = await upstream(env, '/drasl/api/v3/users', {
        method: 'POST',
        headers: { Authorization: `Bearer ${env.DRASL_ADMIN_TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: parsed.username, password: parsed.password, playerName: parsed.username })
    })
    if(res.ok) {
        return reply(201, 'ok')
    }
    return classifyFailure(res.status, await readFailureMessage(res))
}

async function updateAccount(request, env) {
    const raw = await request.text()
    if(raw.length > MAX_BODY_BYTES) {
        return reply(413, 'rejected')
    }
    const parsed = parseRequest(raw)
    if(parsed == null) {
        return reply(400, 'rejected')
    }
    const failure = await verifyPassword(env, parsed.username, parsed.password)
    if(failure != null) {
        return failure
    }
    const uuid = await findUserUuid(env, parsed.username)
    if(uuid == null) {
        return reply(502, 'unavailable')
    }
    const res = await upstream(env, `/drasl/api/v3/users/${encodeURIComponent(uuid)}`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${env.DRASL_ADMIN_TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(parsed.changes)
    })
    if(res.ok) {
        return reply(200, 'ok')
    }
    return classifyFailure(res.status, await readFailureMessage(res))
}

function readSessionHeaders(request) {
    const authorization = request.headers.get('Authorization') || ''
    const accessToken = authorization.startsWith('Bearer ') ? authorization.slice(7).trim() : ''
    const clientToken = (request.headers.get('X-Client-Token') || '').trim()
    if(!isText(accessToken, 2048) || !isText(clientToken, 256)) {
        return null
    }
    return { accessToken, clientToken }
}

async function validateSession(env, session) {
    const res = await upstream(env, '/authlib-injector/authserver/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(session)
    })
    if(res.status === 204 || res.status === 200) {
        return true
    }
    if(res.status === 401 || res.status === 403) {
        return false
    }
    throw new Error(`validate failed with status ${res.status}`)
}

async function uploadLogs(request, env) {
    if(!env.LOGS) {
        return reply(503, 'unavailable')
    }
    const session = readSessionHeaders(request)
    if(session == null) {
        return reply(401, 'unauthorized')
    }
    const length = Number(request.headers.get('Content-Length'))
    if(!Number.isInteger(length) || length <= 0) {
        return reply(411, 'rejected')
    }
    if(length > MAX_LOG_UPLOAD_BYTES) {
        return reply(413, 'rejected')
    }
    if(!await validateSession(env, session)) {
        return reply(401, 'unauthorized')
    }
    const body = await request.arrayBuffer()
    const magic = new Uint8Array(body.slice(0, 2))
    if(body.byteLength !== length || magic[0] !== 0x1f || magic[1] !== 0x8b) {
        return reply(400, 'rejected')
    }
    const id = crypto.randomUUID().replace(/-/g, '').slice(0, 12).toUpperCase()
    const version = (request.headers.get('X-Launcher-Version') || 'unknown').slice(0, MAX_VERSION_LENGTH)
    await env.LOGS.put(`reports/${id}.log.gz`, body, {
        httpMetadata: { contentType: 'application/gzip' },
        customMetadata: { launcherVersion: version, uploadedAt: new Date().toISOString() }
    })
    return reply(201, 'ok', null, { id })
}

function parseOpensAt(value) {
    if(typeof value !== 'string') {
        return null
    }
    const match = OPENS_AT_PATTERN.exec(value.trim())
    if(match == null) {
        return null
    }
    const time = Date.parse(`${match[1]}T${match[2]}:00${MSK_OFFSET}`)
    return Number.isNaN(time) ? null : time
}

function parseLaunchRequest(raw) {
    if(raw.trim().length === 0) {
        return { credentials: null }
    }
    let data
    try {
        data = JSON.parse(raw)
    } catch {
        return null
    }
    if(data == null || typeof data !== 'object') {
        return null
    }
    if(!isText(data.username, 128) || !isText(data.accessToken, 4096) || !isText(data.clientToken, 256)) {
        return { credentials: null }
    }
    return { credentials: { username: data.username, accessToken: data.accessToken, clientToken: data.clientToken } }
}

async function isLaunchAdmin(env, credentials) {
    const res = await upstream(env, '/authlib-injector/authserver/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accessToken: credentials.accessToken, clientToken: credentials.clientToken })
    })
    if(res.status !== 204 && res.status !== 200) {
        return false
    }
    const user = await findUser(env, credentials.username)
    return user != null && user.isAdmin === true
}

async function launchStatus(request, env) {
    const raw = await request.text()
    if(raw.length > MAX_LAUNCH_BODY_BYTES) {
        return reply(413, 'rejected')
    }
    const parsed = parseLaunchRequest(raw)
    if(parsed == null) {
        return reply(400, 'rejected')
    }
    const opensAt = parseOpensAt(env.LAUNCH_OPENS_AT)
    const now = Date.now()
    const open = opensAt == null || now >= opensAt
    const admin = !open && parsed.credentials != null && await isLaunchAdmin(env, parsed.credentials)
    return respond(200, { code: 'ok', now, opensAt, open, admin })
}

const ROUTES = {
    '/account/update': updateAccount,
    '/account/register': registerAccount,
    '/launch/status': launchStatus,
    '/logs/upload': uploadLogs
}

export default {
    async fetch(request, env) {
        const url = new URL(request.url)
        const handler = ROUTES[url.pathname]
        if(handler == null) {
            return reply(404, 'rejected')
        }
        if(request.method !== 'POST') {
            return reply(405, 'rejected')
        }
        if(!env.DRASL_ADMIN_TOKEN || !env.DRASL_URL) {
            return reply(503, 'unavailable')
        }
        try {
            return await handler(request, env)
        } catch (err) {
            console.error('upstream error', err)
            return reply(502, 'unavailable')
        }
    }
}
