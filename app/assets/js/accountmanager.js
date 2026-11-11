const http = require('http')
const https = require('https')
const { AUTH_BASE_URL, DRASL_ADMIN_TOKEN } = require('./apiconstants')

const AUTH_SERVER = `${AUTH_BASE_URL}/authlib-injector/authserver`
const API_USERS = `${AUTH_BASE_URL}/drasl/api/v1/users`
const REQUEST_TIMEOUT = 15000

class AccountError extends Error {
    constructor(code, message) {
        super(message || code)
        this.code = code
    }
}

exports.AccountError = AccountError

function send(method, url, headers, payload) {
    return new Promise((resolve, reject) => {
        const body = payload == null ? null : Buffer.from(JSON.stringify(payload))
        const parsed = new URL(url)
        const client = parsed.protocol === 'http:' ? http : https
        const options = { method, timeout: REQUEST_TIMEOUT, headers: { ...headers } }
        if(body != null) {
            options.headers['Content-Type'] = 'application/json'
            options.headers['Content-Length'] = body.length
        }
        const req = client.request(parsed, options, res => {
            const chunks = []
            res.on('data', chunk => chunks.push(chunk))
            res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') }))
            res.on('error', reject)
        })
        req.on('timeout', () => req.destroy(new Error('Request timed out')))
        req.on('error', reject)
        if(body != null) {
            req.write(body)
        }
        req.end()
    })
}

async function attempt(method, url, headers, payload) {
    try {
        return await send(method, url, headers, payload)
    } catch(err) {
        throw new AccountError('network', err.message)
    }
}

function serverMessage(body) {
    try {
        return JSON.parse(body).message || ''
    } catch {
        return ''
    }
}

async function verifyPassword(username, password) {
    const res = await attempt('POST', `${AUTH_SERVER}/authenticate`, {}, {
        agent: { name: 'Minecraft', version: 1 },
        username,
        password,
        requestUser: false
    })
    if(res.status === 401 || res.status === 403) {
        throw new AccountError('wrongPassword')
    }
    if(res.status === 429) {
        throw new AccountError('rateLimited')
    }
    if(res.status < 200 || res.status >= 300) {
        throw new AccountError('network', `HTTP ${res.status}`)
    }
    try {
        const session = JSON.parse(res.body)
        await attempt('POST', `${AUTH_SERVER}/invalidate`, {}, { accessToken: session.accessToken, clientToken: session.clientToken })
    } catch {
        return
    }
}

async function findUserUuid(headers, username) {
    const res = await attempt('GET', API_USERS, headers)
    if(res.status < 200 || res.status >= 300) {
        throw new AccountError('unavailable')
    }
    const needle = username.toLowerCase()
    const user = JSON.parse(res.body).find(entry => typeof entry.username === 'string' && entry.username.toLowerCase() === needle)
    if(user == null || typeof user.uuid !== 'string') {
        throw new AccountError('unavailable')
    }
    return user.uuid
}

function classifyFailure(status, message) {
    const text = message.toLowerCase()
    if(status === 409 || /taken|already|exists|in use/.test(text)) {
        return 'nameTaken'
    }
    if(status === 404 || status >= 500 || status === 401 || status === 403) {
        return 'unavailable'
    }
    return 'rejected'
}

exports.updateAccount = async function(username, password, changes) {
    if(!DRASL_ADMIN_TOKEN) {
        throw new AccountError('unavailable')
    }
    await verifyPassword(username, password)
    const headers = { 'Authorization': `Bearer ${DRASL_ADMIN_TOKEN}` }
    const uuid = await findUserUuid(headers, username)
    const payload = {}
    if(changes.playerName) {
        payload.playerName = changes.playerName
    }
    if(changes.newPassword) {
        payload.password = changes.newPassword
    }
    const res = await attempt('PATCH', `${API_USERS}/${uuid}`, headers, payload)
    if(res.status >= 200 && res.status < 300) {
        return
    }
    const message = serverMessage(res.body)
    throw new AccountError(classifyFailure(res.status, message), message)
}
