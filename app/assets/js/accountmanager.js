const http = require('http')
const https = require('https')
const { AUTH_BASE_URL } = require('./apiconstants')

const API_URL = `${AUTH_BASE_URL}/drasl/api/v1/user`
const REQUEST_TIMEOUT = 15000

class AccountError extends Error {
    constructor(code, message) {
        super(message || code)
        this.code = code
    }
}

exports.AccountError = AccountError

function patch(accessToken, payload) {
    return new Promise((resolve, reject) => {
        const body = Buffer.from(JSON.stringify(payload))
        const parsed = new URL(API_URL)
        const client = parsed.protocol === 'http:' ? http : https
        const req = client.request(parsed, {
            method: 'PATCH',
            timeout: REQUEST_TIMEOUT,
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json',
                'Content-Length': body.length
            }
        }, res => {
            const chunks = []
            res.on('data', chunk => chunks.push(chunk))
            res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') }))
            res.on('error', reject)
        })
        req.on('timeout', () => req.destroy(new Error('Request timed out')))
        req.on('error', reject)
        req.write(body)
        req.end()
    })
}

function serverMessage(body) {
    try {
        const parsed = JSON.parse(body)
        return parsed.message || parsed.error || ''
    } catch {
        return ''
    }
}

exports.updateAccount = async function(accessToken, changes) {
    const payload = {}
    if(changes.playerName) {
        payload.playerName = changes.playerName
    }
    if(changes.password) {
        payload.password = changes.password
    }
    let res
    try {
        res = await patch(accessToken, payload)
    } catch(err) {
        throw new AccountError('network', err.message)
    }
    if(res.status >= 200 && res.status < 300) {
        return
    }
    if(res.status === 401 || res.status === 403) {
        throw new AccountError('unauthorized')
    }
    if(res.status === 404 || res.status === 405) {
        throw new AccountError('unavailable')
    }
    throw new AccountError('rejected', serverMessage(res.body))
}
