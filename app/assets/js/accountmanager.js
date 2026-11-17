const http = require('http')
const https = require('https')
const crypto = require('crypto')
const { ACCOUNT_API_URL, REGISTER_API_URL, REGISTER_CHALLENGE_URL } = require('./apiconstants')

const UPDATE_URL = `${ACCOUNT_API_URL}/account/update`
const REGISTER_URL = REGISTER_API_URL
const CHALLENGE_URL = REGISTER_CHALLENGE_URL
const REQUEST_TIMEOUT = 15000
const MAX_PROOF_BITS = 26
const PROOF_CHUNK_SIZE = 4000
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
        try {
            return JSON.parse(res.body)
        } catch {
            return {}
        }
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

function leadingZeroBits(digest) {
    let count = 0
    for(const byte of digest) {
        if(byte === 0) {
            count += 8
            continue
        }
        count += Math.clz32(byte) - 24
        break
    }
    return count
}

function solveChallenge(challenge, bits) {
    return new Promise(resolve => {
        const prefix = `${challenge}:`
        let nonce = 0
        const step = () => {
            const limit = nonce + PROOF_CHUNK_SIZE
            for(; nonce < limit; nonce++) {
                const digest = crypto.createHash('sha256').update(prefix + nonce).digest()
                if(leadingZeroBits(digest) >= bits) {
                    resolve(String(nonce))
                    return
                }
            }
            setImmediate(step)
        }
        step()
    })
}

async function requestProof(username) {
    const task = await post(CHALLENGE_URL, { username })
    const bits = Number(task.bits)
    if(!Number.isInteger(bits) || bits <= 0) {
        return {}
    }
    if(bits > MAX_PROOF_BITS || typeof task.challenge !== 'string') {
        throw new AccountError('unavailable')
    }
    return { challenge: task.challenge, nonce: await solveChallenge(task.challenge, bits) }
}

exports.registerAccount = async function(username, password) {
    const proof = await requestProof(username)
    await post(REGISTER_URL, { username, password, ...proof })
}
