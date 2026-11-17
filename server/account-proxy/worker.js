const MAX_BODY_BYTES = 2048
const UPSTREAM_TIMEOUT_MS = 10000
const USERNAME_PATTERN = /^[a-zA-Z0-9_]{3,16}$/
const MIN_PASSWORD_LENGTH = 8

function reply(status, code, message) {
    const body = { code }
    if(message) {
        body.message = message
    }
    return new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
    })
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

async function findUserUuid(env, username) {
    const res = await upstream(env, '/drasl/api/v3/users', {
        headers: { Authorization: `Bearer ${env.DRASL_ADMIN_TOKEN}` }
    })
    if(!res.ok) {
        return null
    }
    const needle = username.toLowerCase()
    const user = (await res.json()).find(entry => typeof entry.username === 'string' && entry.username.toLowerCase() === needle)
    return user != null && typeof user.uuid === 'string' ? user.uuid : null
}

function classifyFailure(status, message) {
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

const ROUTES = {
    '/account/update': updateAccount,
    '/account/register': registerAccount
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
        } catch {
            return reply(502, 'unavailable')
        }
    }
}