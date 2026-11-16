const http = require('http')
const https = require('https')
const { ACCOUNT_API_URL } = require('./apiconstants')

const UPDATE_URL = `${ACCOUNT_API_URL}/account/update`
const REGISTER_URL = `${ACCOUNT_API_URL}/account/register`
const REQUEST_TIMEOUT = 15000
const KNOWN_CODES = new Set(['wrongPassword', 'rateLimited', 'nameTaken', 'rejected', 'unavailable'])

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

async function post(url, payload) {
    let res
    try {
        res = await send('POST', url, {}, payload)
    } catch(err) {
        throw new AccountError('network', err.message)
    }
    if(res.status >= 200 && res.status < 300) {
        return
    }
    let code = 'unavailable'
    let message = ''
    try {
        const body = JSON.parse(res.body)
        if(KNOWN_CODES.has(body.code)) {
            code = body.code
        }
        message = typeof body.message === 'string' ? body.message : ''
    } catch {
        code = 'unavailable'
    }
    throw new AccountError(code, message)
}

exports.updateAccount = function(username, password, changes) {
    const payload = { username, password }
    if(changes.playerName) {
        payload.playerName = changes.playerName
    }
    if(changes.newPassword) {
        payload.newPassword = changes.newPassword
    }
    return post(UPDATE_URL, payload)
}

exports.registerAccount = function(username, password) {
    return post(REGISTER_URL, { username, password })
}