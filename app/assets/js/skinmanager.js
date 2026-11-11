const fs = require('fs')
const http = require('http')
const https = require('https')
const { AUTH_BASE_URL } = require('./apiconstants')

const SERVICE_ROOTS = [
    `${AUTH_BASE_URL}/authlib-injector/minecraftservices`,
    `${AUTH_BASE_URL}/services`
]
const REQUEST_TIMEOUT = 15000
const MAX_SKIN_BYTES = 1024 * 1024
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

class SkinError extends Error {
    constructor(code, message) {
        super(message || code)
        this.code = code
    }
}

exports.SkinError = SkinError

function request(method, url, headers, body) {
    return new Promise((resolve, reject) => {
        const parsed = new URL(url)
        const client = parsed.protocol === 'http:' ? http : https
        const req = client.request(parsed, { method, headers, timeout: REQUEST_TIMEOUT }, res => {
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

function readSkinFile(filePath) {
    const data = fs.readFileSync(filePath)
    if(data.length > MAX_SKIN_BYTES) {
        throw new SkinError('tooLarge')
    }
    if(data.length < 33 || !data.subarray(0, 8).equals(PNG_SIGNATURE)) {
        throw new SkinError('notPng')
    }
    const width = data.readUInt32BE(16)
    const height = data.readUInt32BE(20)
    const valid = width > 0 && width % 64 === 0 && (height === width || height * 2 === width)
    if(!valid) {
        throw new SkinError('badSize')
    }
    return data
}

function multipart(fields, file) {
    const boundary = `----BuildTage${Date.now().toString(16)}`
    const parts = []
    for(const [name, value] of Object.entries(fields)) {
        parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`))
    }
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="skin.png"\r\nContent-Type: image/png\r\n\r\n`))
    parts.push(file)
    parts.push(Buffer.from(`\r\n--${boundary}--\r\n`))
    return { boundary, body: Buffer.concat(parts) }
}

async function callServices(send) {
    let lastError = new SkinError('unavailable')
    for(const root of SERVICE_ROOTS) {
        try {
            const res = await send(`${root}/minecraft/profile/skins`)
            if(res.status >= 200 && res.status < 300) {
                return
            }
            if(res.status === 401 || res.status === 403) {
                throw new SkinError('unauthorized')
            }
            lastError = new SkinError(res.status === 404 ? 'unavailable' : 'rejected', `HTTP ${res.status}`)
        } catch(err) {
            if(err instanceof SkinError && err.code === 'unauthorized') {
                throw err
            }
            lastError = err instanceof SkinError ? err : new SkinError('network', err.message)
        }
    }
    throw lastError
}

exports.uploadSkin = async function(accessToken, filePath, slim) {
    const png = readSkinFile(filePath)
    const form = multipart({ variant: slim ? 'slim' : 'classic' }, png)
    await callServices(url => request('POST', url, {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': `multipart/form-data; boundary=${form.boundary}`,
        'Content-Length': form.body.length
    }, form.body))
}

exports.resetSkin = async function(accessToken) {
    await callServices(url => request('DELETE', `${url}/active`, {
        'Authorization': `Bearer ${accessToken}`
    }))
}
