const http = require('http')
const https = require('https')
const { AUTH_BASE_URL } = require('./apiconstants')

const SESSION_ROOTS = [
    `${AUTH_BASE_URL}/authlib-injector/sessionserver`,
    `${AUTH_BASE_URL}/session`
]
const REQUEST_TIMEOUT = 8000
const MAX_REDIRECTS = 3
const AVATAR_SIZE = 64

const cache = new Map()

function download(url, redirects = 0) {
    return new Promise((resolve, reject) => {
        const parsed = new URL(url)
        const client = parsed.protocol === 'http:' ? http : https
        const req = client.get(parsed, { timeout: REQUEST_TIMEOUT }, res => {
            if(res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirects < MAX_REDIRECTS) {
                res.resume()
                resolve(download(new URL(res.headers.location, parsed).toString(), redirects + 1))
                return
            }
            if(res.statusCode !== 200) {
                res.resume()
                reject(new Error(`HTTP ${res.statusCode}`))
                return
            }
            const chunks = []
            res.on('data', chunk => chunks.push(chunk))
            res.on('end', () => resolve(Buffer.concat(chunks)))
            res.on('error', reject)
        })
        req.on('timeout', () => req.destroy(new Error('Request timed out')))
        req.on('error', reject)
    })
}

async function findSkin(uuid) {
    for(const root of SESSION_ROOTS) {
        try {
            const body = await download(`${root}/session/minecraft/profile/${uuid}`)
            const profile = JSON.parse(body.toString('utf8'))
            const property = (profile.properties || []).find(p => p.name === 'textures')
            if(property == null) {
                continue
            }
            const payload = JSON.parse(Buffer.from(property.value, 'base64').toString('utf8'))
            const skin = payload.textures && payload.textures.SKIN
            if(skin && skin.url) {
                return { url: skin.url, slim: skin.metadata != null && skin.metadata.model === 'slim' }
            }
        } catch {
            continue
        }
    }
    return null
}

function drawHead(skinDataUrl) {
    return new Promise((resolve, reject) => {
        const image = new Image()
        image.onload = () => {
            const unit = image.width / 64
            const face = 8 * unit
            const canvas = document.createElement('canvas')
            canvas.width = AVATAR_SIZE
            canvas.height = AVATAR_SIZE
            const ctx = canvas.getContext('2d')
            ctx.imageSmoothingEnabled = false
            ctx.drawImage(image, 8 * unit, 8 * unit, face, face, 0, 0, AVATAR_SIZE, AVATAR_SIZE)
            ctx.drawImage(image, 40 * unit, 8 * unit, face, face, 0, 0, AVATAR_SIZE, AVATAR_SIZE)
            resolve(canvas.toDataURL('image/png'))
        }
        image.onerror = () => reject(new Error('Invalid skin image'))
        image.src = skinDataUrl
    })
}

async function loadSkin(uuid) {
    const found = await findSkin(uuid)
    if(found == null) {
        return null
    }
    const png = await download(found.url)
    return { dataUrl: `data:image/png;base64,${png.toString('base64')}`, slim: found.slim }
}

function remember(store, uuid, task) {
    if(!store.has(uuid)) {
        const pending = task(uuid).then(value => {
            if(value == null) {
                store.delete(uuid)
            }
            return value
        }).catch(() => {
            store.delete(uuid)
            return null
        })
        store.set(uuid, pending)
    }
    return store.get(uuid)
}

const skins = new Map()

exports.getSkin = function(uuid) {
    return remember(skins, uuid, loadSkin)
}

exports.getHeadDataUrl = function(uuid) {
    return remember(cache, uuid, async id => {
        const skin = await exports.getSkin(id)
        return skin == null ? null : await drawHead(skin.dataUrl)
    })
}

exports.invalidate = function(uuid) {
    skins.delete(uuid)
    cache.delete(uuid)
}
