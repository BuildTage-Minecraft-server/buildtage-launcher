/*
    ____   ____.___    _________       _____  __                                 
\   \ /   /|   |  /   _____/ _____/ ____\/  |___  _  _______ _______   ____  
 \   Y   / |   |  \_____  \ /  _ \   __\\   __\ \/ \/ /\__  \\_  __ \_/ __ \ 
  \     /  |   |  /        (  <_> )  |   |  |  \     /  / __ \|  | \/\  ___/ 
   \___/   |___| /_______  /\____/|__|   |__|   \/\_/  (____  /__|    \___  >
                         \/                                 \/            \/ 
                         
    © 2023-2026 VI Software and contributors.
    Portions © 2017-2026 Daniel D. Scalzi. Licensed under the MIT License.

    License: GNU Affero General Public License v3.0 (AGPL-3.0)
    https://www.gnu.org/licenses/agpl-3.0.en.html

    This program is distributed in the hope that it will be useful, but WITHOUT 
    ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or 
    FITNESS FOR A PARTICULAR PURPOSE. See the license for more details.

    GitHub:  https://github.com/VI-Software
    Website: https://visoftware.dev
*/

/**
 * Minimal Yggdrasil client for the account server (Drasl).
 * 
 * Every function resolves with plain data or rejects with an object that
 * has a title and a desc, which is what the login UI knows how to display.
 * 
 * @module yggdrasil
 */
const http  = require('http')
const https = require('https')
const { YGGDRASIL_AUTH_URLS } = require('./apiconstants')

const REQUEST_TIMEOUT = 10000

const ERRORS = {
    invalidCredentials: {
        title: 'Invalid credentials',
        desc: 'The username or password is incorrect. Please check them and try again.'
    },
    noProfile: {
        title: 'No player profile',
        desc: 'This account has no player profile. Please contact the server administrator.'
    },
    rateLimited: {
        title: 'Too many attempts',
        desc: 'Too many login attempts were made. Please wait a minute and try again.'
    },
    serverError: {
        title: 'Account server error',
        desc: 'The account server returned an unexpected error. Please try again later.'
    },
    unreachable: {
        title: 'Account server unreachable',
        desc: 'Could not connect to the account server. Check your internet connection and try again.'
    },
    unknown: {
        title: 'Unknown error during login',
        desc: 'An unknown error occurred. Please try again.'
    }
}

function isDisplayable(err) {
    return err != null && typeof err === 'object' && typeof err.title === 'string' && typeof err.desc === 'string'
}

exports.toDisplayable = function(err) {
    return isDisplayable(err) ? err : { ...ERRORS.unknown }
}

function postJson(base, endpoint, payload) {
    return new Promise((resolve, reject) => {
        const url = new URL(`${base}/${endpoint}`)
        const body = JSON.stringify(payload)
        const client = url.protocol === 'http:' ? http : https
        const req = client.request(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(body),
                'Accept': 'application/json'
            },
            timeout: REQUEST_TIMEOUT
        }, res => {
            const chunks = []
            res.on('data', chunk => chunks.push(chunk))
            res.on('end', () => {
                const text = Buffer.concat(chunks).toString('utf8')
                let json = null
                if(text.length > 0) {
                    try {
                        json = JSON.parse(text)
                    } catch {
                        json = null
                    }
                }
                resolve({ status: res.statusCode, json })
            })
        })
        req.on('timeout', () => req.destroy(new Error('Request timed out')))
        req.on('error', reject)
        req.write(body)
        req.end()
    })
}

async function request(endpoint, payload) {
    let last = null
    for(const base of YGGDRASIL_AUTH_URLS) {
        try {
            last = await postJson(base, endpoint, payload)
        } catch (err) {
            throw { ...ERRORS.unreachable, cause: err }
        }
        if(last.status === 404 && last.json == null) {
            continue
        }
        return last
    }
    return last
}

function failure(res) {
    if(res.status === 429) {
        return { ...ERRORS.rateLimited }
    }
    if(res.status === 401 || res.status === 403 || (res.json && res.json.error === 'ForbiddenOperationException')) {
        return { ...ERRORS.invalidCredentials }
    }
    return { ...ERRORS.serverError, status: res.status }
}

/**
 * Authenticate with a username and password.
 * 
 * @param {string} username The account username.
 * @param {string} password The account password.
 * @param {string|null} clientToken The stored client token, if there is one.
 * @returns {Promise.<{accessToken: string, clientToken: string, selectedProfile: {id: string, name: string}}>}
 */
exports.authenticate = async function(username, password, clientToken) {
    const payload = {
        agent: { name: 'Minecraft', version: 1 },
        username,
        password,
        requestUser: true
    }
    if(clientToken != null) {
        payload.clientToken = clientToken
    }
    const res = await request('authenticate', payload)
    if(res.status !== 200 || res.json == null) {
        throw failure(res)
    }
    const data = res.json
    let profile = data.selectedProfile
    if(profile == null && Array.isArray(data.availableProfiles) && data.availableProfiles.length === 1) {
        profile = data.availableProfiles[0]
    }
    if(profile == null || !data.accessToken) {
        throw { ...ERRORS.noProfile }
    }
    return {
        accessToken: data.accessToken,
        clientToken: data.clientToken,
        selectedProfile: { id: profile.id, name: profile.name }
    }
}

/**
 * Check whether an access token is still valid.
 * 
 * @param {string} accessToken The access token.
 * @param {string} clientToken The client token.
 * @returns {Promise.<boolean>} True if the token is valid.
 */
exports.validate = async function(accessToken, clientToken) {
    const res = await request('validate', { accessToken, clientToken })
    if(res.status === 204 || res.status === 200) {
        return true
    }
    if(res.status === 401 || res.status === 403) {
        return false
    }
    throw failure(res)
}

/**
 * Exchange an access token for a new one.
 * 
 * @param {string} accessToken The access token.
 * @param {string} clientToken The client token.
 * @returns {Promise.<{accessToken: string, clientToken: string}>}
 */
exports.refresh = async function(accessToken, clientToken) {
    const res = await request('refresh', { accessToken, clientToken, requestUser: false })
    if(res.status !== 200 || res.json == null || !res.json.accessToken) {
        throw failure(res)
    }
    return { accessToken: res.json.accessToken, clientToken: res.json.clientToken }
}

/**
 * Invalidate an access token.
 * 
 * @param {string} accessToken The access token.
 * @param {string} clientToken The client token.
 * @returns {Promise.<void>}
 */
exports.invalidate = async function(accessToken, clientToken) {
    const res = await request('invalidate', { accessToken, clientToken })
    if(res.status !== 204 && res.status !== 200) {
        throw failure(res)
    }
}