const got = require('got')

const ConfigManager = require('./configmanager')
const { LAUNCH_STATUS_URL } = require('./apiconstants')

const REQUEST_TIMEOUT = 8000
const MSK_TIME_ZONE = 'Europe/Moscow'

const opensAtFormat = new Intl.DateTimeFormat('ru-RU', {
    timeZone: MSK_TIME_ZONE,
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
})

function buildPayload(account) {
    const clientToken = ConfigManager.getClientToken()
    if(account == null || clientToken == null) {
        return {}
    }
    return { username: account.username, accessToken: account.accessToken, clientToken }
}

exports.fetchStatus = async function(account) {
    const body = await got.post(LAUNCH_STATUS_URL, {
        json: buildPayload(account),
        timeout: REQUEST_TIMEOUT,
        retry: 0
    }).json()
    if(body == null || body.code !== 'ok' || !Number.isFinite(body.now)) {
        throw new Error('Unexpected launch status response')
    }
    const opensAt = Number.isFinite(body.opensAt) ? body.opensAt : null
    return {
        open: body.open === true || opensAt == null,
        admin: body.admin === true,
        adminError: body.adminError === true,
        opensAt,
        clockOffset: body.now - Date.now()
    }
}

exports.formatOpensAt = function(opensAt) {
    return opensAtFormat.format(opensAt)
}

exports.formatCountdown = function(remaining) {
    const total = Math.max(0, Math.ceil(remaining / 1000))
    const hours = Math.floor(total / 3600)
    const minutes = Math.floor((total % 3600) / 60)
    const seconds = total % 60
    return [hours, minutes, seconds].map(part => String(part).padStart(2, '0')).join(':')
}
