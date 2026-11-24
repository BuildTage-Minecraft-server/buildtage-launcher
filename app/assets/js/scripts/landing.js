/*
    ____   ____.___    _________       _____  __                                 
\   \ /   /|   |  /   _____/ _____/ ____\/  |___  _  _______ _______   ____  
 \   Y   / |   |  \_____  \ /  _ \   __\\   __\ \/ \/ /\__  \\_  __ \_/ __ \ 
  \     /  |   |  /        (  <_> )  |   |  |  \     /  / __ \|  | \/\  ___/ 
   \___/   |___| /_______  /\____/|__|   |__|   \/\_/  (____  /__|    \___  >
                         \/                                 \/            \/ 
                         
    © 2023-2026 VI Software and contributors.

    License: GNU Affero General Public License v3.0 (AGPL-3.0)
    https://www.gnu.org/licenses/agpl-3.0.en.html

    This program is distributed in the hope that it will be useful, but WITHOUT 
    ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or 
    FITNESS FOR A PARTICULAR PURPOSE. See the license for more details.

    GitHub:  https://github.com/VI-Software
    Website: https://visoftware.dev
*/


/**
 * Script for landing.ejs
 */
// Requirements
const { URL }                 = require('url')
const {
    MojangRestAPI,
    getServerStatus
}                             = require('@visoftware/vis-launcher-core/mojang')
const {
    RestResponseStatus,
    isDisplayableError,
    validateLocalFile
}                             = require('@visoftware/vis-launcher-core/common')
const {
    FullRepair,
    DistributionIndexProcessor,
    MojangIndexProcessor,
    downloadFile
}                             = require('@visoftware/vis-launcher-core/dl')
const {
    validateSelectedJvm,
    ensureJavaDirIsRoot,
    javaExecFromRoot,
    latestOpenJDK,
    extractJdk
}                             = require('@visoftware/vis-launcher-core/java')

// Internal Requirements
const DiscordWrapper          = require('./assets/js/discordwrapper')
const SkinHead                = require('./assets/js/skinhead')
const ProcessBuilder          = require('./assets/js/processbuilder')
const LaunchSchedule          = require('./assets/js/launchschedule')
const { features } = require('process')

// Launch Elements
const launch_content          = document.getElementById('launch_content')
const launch_details          = document.getElementById('launch_details')
const launch_progress         = document.getElementById('launch_progress')
const launch_progress_label   = document.getElementById('launch_progress_label')
const launch_details_text     = document.getElementById('launch_details_text')
const server_selection_button = document.getElementById('server_selection_button')
const modsButton = document.getElementById('modsButton')
const user_text               = document.getElementById('user_text')

const loggerLanding = LoggerUtil.getLogger('Landing')

/* Launch Progress Wrapper Functions */

/**
 * Show/hide the loading area.
 * 
 * @param {boolean} loading True if the loading area should be shown, otherwise false.
 */
function toggleLaunchArea(loading){
    if(loading){
        launch_details.style.display = 'flex'
        launch_content.style.display = 'none'
    } else {
        launch_details.style.display = 'none'
        launch_content.style.display = 'inline-flex'
    }
}

/**
 * Set the details text of the loading area.
 * 
 * @param {string} details The new text for the loading details.
 */
function setLaunchDetails(details){
    launch_details_text.innerHTML = details
}

/**
 * Set the value of the loading progress bar and display that value.
 * 
 * @param {number} percent Percentage (0-100)
 */
function setLaunchPercentage(percent){
    launch_progress.setAttribute('max', 100)
    launch_progress.setAttribute('value', percent)
    launch_progress_label.innerHTML = percent + '%'
}

/**
 * Set the value of the OS progress bar and display that on the UI.
 * 
 * @param {number} percent Percentage (0-100)
 */
function setDownloadPercentage(percent){
    remote.getCurrentWindow().setProgressBar(percent/100)
    setLaunchPercentage(percent)
}

/**
 * Enable or disable the launch button.
 * 
 * @param {boolean} val True to enable, false to disable.
 */
function setLaunchEnabled(val){
    document.getElementById('launch_button').disabled = !val
}

/**
 * Show guest mode login prompt overlay.
 */
function showGuestModeLoginPrompt() {
    setOverlayContent(
        Lang.queryJS('guestMode.loginRequiredTitle'),
        Lang.queryJS('guestMode.loginRequiredMessage'),
        Lang.queryJS('guestMode.loginButton'),
        Lang.queryJS('guestMode.cancelButton')
    )
    
    setOverlayHandler(() => {
        toggleOverlay(false)
        ConfigManager.endGuestMode()
        hideGuestModeBanner()
        openLoginView(VIEWS.landing)
    })
    
    setDismissHandler(() => {
        toggleOverlay(false)
        toggleLaunchArea(false)
    })
    
    toggleOverlay(true, true)
}

// Bind launch button
document.getElementById('launch_button').addEventListener('click', async e => {
    // Check if user is in guest mode
    if (ConfigManager.isGuestMode()) {
        loggerLanding.info('Launch attempted in guest mode - prompting for login')
        showGuestModeLoginPrompt()
        return
    }
    
    try {
        setLaunchDetails(Lang.queryJS('landing.launch.checkingClient'))
        toggleLaunchArea(true)
        setLaunchPercentage(0, 100)
        const buildstatus = localStorage.getItem('buildstatus')
        if (buildstatus === 'notsupported') {
            loggerLanding.error('VI Software does no longer maintained this version of the launcher and will soon be unable to connect to the servers')
            showLaunchFailure(Lang.queryJS('landing.launch.unmantainedErrorTitle'), Lang.queryJS('landing.launch.unmantainedErrorMessage'))
            return
        } else if (buildstatus === 'forceupdate') {
            loggerLanding.error('VI Software has marked this version as unsupported, and it cannot be used to play servers.')
            showLaunchFailure(Lang.queryJS('landing.launch.forceupdateErrorTitle'), Lang.queryJS('landing.launch.forceupdateErrorMessage'))
            return
        }
    } catch (err) {
        loggerLanding.error('Unhandled error in during launch process.', err)
        showLaunchFailure(Lang.queryJS('landing.launch.failureTitle'), Lang.queryJS('landing.launch.failureText'))
        return
    }
    
    try {
        setLaunchDetails(Lang.queryJS('landing.launch.checkingAccount'))
        toggleLaunchArea(true)
        setLaunchPercentage(0, 100)

        await new Promise(resolve => setTimeout(resolve, 2000)) 

        const isValid = await AuthManager.validateSelected()
        if (!isValid) {
            loggerLanding.error('Selected account is no longer valid.')

            const selectedAccount = ConfigManager.getSelectedAccount()

            setOverlayContent(
                Lang.queryJS('uibinder.validateAccount.failedMessageTitle'),
                Lang.queryJS('uibinder.validateAccount.failedMessage', { 'account': selectedAccount.displayName }),
                Lang.queryJS('uibinder.validateAccount.loginButton'),
                Lang.queryJS('settings.authAccountLogout.cancelButton')
            )
            
            setOverlayHandler(() => {
                toggleOverlay(false)

                openLoginView(VIEWS.landing)

                // Reset the launch area when the user dismisses the notification
                toggleLaunchArea(false)
                setLaunchEnabled(true)
            })
            
            setDismissHandler(() => {
                toggleOverlay(false)
                // Reset the launch area when the user dismisses the notification
                toggleLaunchArea(false)
                setLaunchEnabled(true)
            })
            
            toggleOverlay(true, true)
            return
        }
    } catch (err) {
        loggerLanding.error('Unhandled error during launch process.', err)
        showLaunchFailure(Lang.queryJS('landing.launch.failureTitle'), Lang.queryJS('landing.launch.failureText'))
        return
    }

    loggerLanding.info('Launching game...')
    try {
        const server = (await DistroAPI.getDistribution()).getServerById(ConfigManager.getSelectedServer())
        const jExe = ConfigManager.getJavaExecutable(ConfigManager.getSelectedServer())
        if(jExe == null || !ConfigManager.isManagedJavaExecutable(jExe)){
            await asyncSystemScan(server.effectiveJavaOptions)
        } else {

            setLaunchDetails(Lang.queryJS('landing.launch.pleaseWait'))
            toggleLaunchArea(true)
            setLaunchPercentage(0, 100)

            const details = await validateSelectedJvm(ensureJavaDirIsRoot(jExe), server.effectiveJavaOptions.supported)
            if(details != null){
                loggerLanding.info('Jvm Details', details)
                await dlAsync()

            } else {
                await asyncSystemScan(server.effectiveJavaOptions)
            }
        }
    } catch(err) {
        loggerLanding.error('Unhandled error in during launch process.', err)
        showLaunchFailure(Lang.queryJS('landing.launch.failureTitle'), Lang.queryJS('landing.launch.failureText'))
    }
})

// Bind settings button
document.getElementById('settingsMediaButton').onclick = async e => {
    await prepareSettings()
    switchView(getCurrentView(), VIEWS.settings)
}

document.getElementById('user_content').onclick = () => {
    openProfile()
}

/**
 * Hide the guest mode banner.
 */
function hideGuestModeBanner() {
    const banner = document.getElementById('guestModeBanner')
    if (banner) {
        banner.style.display = 'none'
    }
    
    const landingContainer = document.getElementById('landingContainer')
    if (landingContainer) {
        landingContainer.classList.remove('guest-mode')
    }
    
    const avatarContainer = document.getElementById('avatarContainer')
    if (avatarContainer) {
        avatarContainer.classList.remove('guest-avatar')
    }
}

/**
 * Show the guest mode banner.
 */
function showGuestModeBanner() {
    const banner = document.getElementById('guestModeBanner')
    if (banner) {
        banner.style.display = 'flex'
    }
}

// Bind guest mode login button
const guestModeLoginButton = document.getElementById('guestModeLoginButton')
if (guestModeLoginButton) {
    guestModeLoginButton.onclick = () => {
        ConfigManager.endGuestMode()
        hideGuestModeBanner()
        openLoginView(VIEWS.landing)
    }
}

// Bind guest mode sign up button
const guestModeSignUpButton = document.getElementById('guestModeSignUpButton')
if (guestModeSignUpButton) {
    guestModeSignUpButton.onclick = () => {
        // Open sign up page in default browser
        require('electron').shell.openExternal(Lang.queryJS('guestMode.signUpUrl'))
    }
}

function initGuestModeState() {
    if (ConfigManager.isGuestMode()) {
        showGuestModeBanner()
        user_text.innerHTML = Lang.queryJS('guestMode.guestUser')
        document.getElementById('avatarContainer').style.backgroundImage = 'none'
    }
}
// Bind selected account
function updateSelectedAccount(authUser){
    document.getElementById('avatarContainer').classList.remove('has-head')
    let username = Lang.queryJS('landing.selectedAccount.noAccountSelected')
    if(authUser != null){
        if(authUser.displayName != null){
            username = authUser.displayName
        }
        if (authUser.uuid != null) {
            const uuid = authUser.uuid
            SkinHead.getHeadDataUrl(uuid).then(head => {
                const current = ConfigManager.getSelectedAccount()
                if(head == null || current == null || current.uuid !== uuid) {
                    return
                }
                const avatar = document.getElementById('avatarContainer')
                avatar.style.setProperty('--head-image', `url("${head}")`)
                avatar.classList.add('has-head')
            })
        }
    }
    user_text.innerHTML = username
}
updateSelectedAccount(ConfigManager.getSelectedAccount())

// Bind selected server
function hasOptionalMods(modules) {
    for(const mdl of modules || []) {
        if(mdl.required != null && mdl.required.value === false) {
            return true
        }
        if(hasOptionalMods(mdl.subModules)) {
            return true
        }
    }
    return false
}

function updateModsButton(serv) {
    modsButton.style.display = serv != null && hasOptionalMods(serv.rawServer.modules) ? '' : 'none'
}

modsButton.onclick = async e => {
    await prepareSettings()
    switchView(getCurrentView(), VIEWS.settings, 150, 150, () => {
        settingsNavItemListener(document.querySelector('.settingsNavItem[rSc="settingsTabMods"]'), false)
    })
}

function updateSelectedServer(serv){
    updateModsButton(serv)
    if(getCurrentView() === VIEWS.settings){
        fullSettingsSave()
    }
    ConfigManager.setSelectedServer(serv != null ? serv.rawServer.id : null)
    ConfigManager.save()
    server_selection_button.innerHTML = (serv != null ? serv.rawServer.name : Lang.queryJS('landing.noSelection'))
    if(getCurrentView() === VIEWS.settings){
        animateSettingsTabRefresh()
    }
    setLaunchEnabled(serv != null)
}
// Real text is set in uibinder.js on distributionIndexDone.
server_selection_button.innerHTML = Lang.queryJS('landing.selectedServer.loading')
server_selection_button.onclick = async e => {
    e.target.blur()
    await toggleServerSelection(true)
}

const { LEADERBOARD_API_URL, LEADERBOARD_API_PORT } = require('./assets/js/apiconstants')

const LEADERBOARD_ROWS = 10
const LEADERBOARD_POLL_MS = 600000
const LEADERBOARD_FRESH_MS = 60000
const LEADERBOARD_LOADING_DELAY_MS = 400
const LEADERBOARD_RETRY_MS = 5000
const LEADERBOARD_TIMEOUT_MS = 5000

const leaderboardPanel = document.getElementById('leaderboardPanel')
const leaderboardRows = document.getElementById('leaderboardRows')
const leaderboardPodium = document.getElementById('leaderboardPodium')
const leaderboardTable = document.getElementById('leaderboardTable')
const leaderboardSeason = document.getElementById('leaderboardSeason')
const leaderboardStateText = document.getElementById('leaderboardStateText')
const leaderboardRetry = document.getElementById('leaderboardRetry')

const leaderboardFs = require('fs')
const leaderboardPath = require('path')
const LEADERBOARD_CACHE_FILE = leaderboardPath.join(ConfigManager.getLauncherDirectory(), 'leaderboard-cache.json')
const LEADERBOARD_PERIODS = ['all', 'week', 'month']
const LEADERBOARD_SORTS = ['kills', 'kd', 'winrate']

const leaderboardCache = new Map()
const leaderboardPending = new Map()
let leaderboardSignature = null
let leaderboardPeriod = 'all'
let leaderboardSort = 'kills'
let leaderboardRequestId = 0
let leaderboardFailures = 0
let leaderboardRetryTimer = null
let leaderboardSeasonState = null

function loadLeaderboardCache() {
    try {
        const stored = JSON.parse(leaderboardFs.readFileSync(LEADERBOARD_CACHE_FILE, 'utf8'))
        for(const [key, entry] of Object.entries(stored)) {
            if(entry != null && entry.data != null && Array.isArray(entry.data.entries) && typeof entry.receivedAt === 'number') {
                leaderboardCache.set(key, entry)
            }
        }
    } catch(err) {
        loggerLanding.debug(err)
    }
}

function saveLeaderboardCache() {
    leaderboardFs.writeFile(LEADERBOARD_CACHE_FILE, JSON.stringify(Object.fromEntries(leaderboardCache)), err => {
        if(err) {
            loggerLanding.debug(err)
        }
    })
}

function loadLeaderboardEntry(period, sort) {
    const key = `${period}:${sort}`
    let pending = leaderboardPending.get(key)
    if(pending == null) {
        pending = fetchLeaderboard(period, sort)
            .then(data => {
                const entry = { data, receivedAt: Date.now() }
                leaderboardCache.set(key, entry)
                return entry
            })
            .finally(() => leaderboardPending.delete(key))
        leaderboardPending.set(key, pending)
    }
    return pending
}

async function prefetchLeaderboard() {
    const keys = LEADERBOARD_PERIODS.flatMap(period => LEADERBOARD_SORTS.map(sort => [period, sort]))
    const results = await Promise.allSettled(keys.map(async ([period, sort]) => {
        const entry = await loadLeaderboardEntry(period, sort)
        if(period === leaderboardPeriod && sort === leaderboardSort) {
            renderLeaderboard(entry, true)
        }
    }))
    if(results.some(r => r.status === 'fulfilled')) {
        leaderboardFailures = 0
        saveLeaderboardCache()
    }
}

function setLeaderboardState(state) {
    leaderboardPanel.setAttribute('data-state', state)
    if(state !== 'ready') {
        leaderboardStateText.textContent = Lang.queryJS(`landing.leaderboard.${state}`)
        leaderboardSeason.textContent = ''
        leaderboardSeasonState = null
    }
}

async function resolveLeaderboardEndpoint() {
    if(LEADERBOARD_API_URL) {
        return LEADERBOARD_API_URL
    }
    const distro = await DistroAPI.getDistribution()
    const serv = distro.getServerById(ConfigManager.getSelectedServer())
    if(serv == null) {
        throw new Error('No server selected')
    }
    return `http://${serv.hostname}:${LEADERBOARD_API_PORT}/api/v1/leaderboard`
}

async function fetchLeaderboard(period, sort) {
    const base = await resolveLeaderboardEndpoint()
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), LEADERBOARD_TIMEOUT_MS)
    try {
        const res = await fetch(`${base}?period=${period}&sort=${sort}&limit=${LEADERBOARD_ROWS}`, { signal: controller.signal })
        if(!res.ok) {
            throw new Error(`HTTP ${res.status}`)
        }
        return await res.json()
    } finally {
        clearTimeout(timer)
    }
}

function createLeaderboardCell(className, text) {
    const cell = document.createElement('span')
    cell.className = className
    cell.textContent = text
    return cell
}

function createLeaderboardRow(entry, self) {
    const row = document.createElement('div')
    row.className = 'leaderboardRow'
    if(entry.rank <= 3) {
        row.classList.add(`place${entry.rank}`)
    }
    const name = String(entry.name)
    if(self !== '' && name.toLowerCase() === self) {
        row.classList.add('self')
    }
    const nameCell = createLeaderboardCell('lbName', name)
    nameCell.title = name
    row.append(
        createLeaderboardCell('lbRank', entry.rank),
        nameCell,
        createLeaderboardCell('lbKills', entry.kills),
        createLeaderboardCell('lbDeaths', entry.deaths),
        createLeaderboardCell('lbKd', Number(entry.kd).toFixed(2)),
        createLeaderboardCell('lbWr', `${Math.round(Number(entry.winRate) * 100)}%`)
    )
    return row
}

function leaderboardValue(entry, sort) {
    if(sort === 'kd') {
        return Number(entry.kd).toFixed(2)
    }
    if(sort === 'winrate') {
        return `${Math.round(Number(entry.winRate) * 100)}%`
    }
    return String(entry.kills)
}

function createPodiumCard(entry, place, sort, self) {
    const card = document.createElement('div')
    card.className = `podiumCard place${place}`
    const badge = createLeaderboardCell('podiumBadge', place)
    if(entry == null) {
        card.classList.add('empty')
        card.append(badge, createLeaderboardCell('podiumEmpty', '-'))
        return card
    }
    const name = String(entry.name)
    if(self !== '' && name.toLowerCase() === self) {
        card.classList.add('self')
    }
    const nameCell = createLeaderboardCell('podiumName', name)
    nameCell.title = name
    const tab = document.querySelector(`.lbTab[data-group="sort"][data-value="${sort}"]`)
    card.append(
        badge,
        nameCell,
        createLeaderboardCell('podiumValue', leaderboardValue(entry, sort)),
        createLeaderboardCell('podiumCaption', tab != null ? tab.textContent : '')
    )
    return card
}

function formatLeaderboardTime(ms) {
    const total = Math.max(0, Math.floor(ms / 1000))
    const days = Math.floor(total / 86400)
    const hms = [Math.floor(total % 86400 / 3600), Math.floor(total % 3600 / 60), total % 60]
        .map(n => String(n).padStart(2, '0'))
        .join(':')
    return days > 0 ? `${days}${Lang.queryJS('landing.leaderboard.days')} ${hms}` : hms
}

function updateLeaderboardSeason() {
    if(leaderboardSeasonState == null) {
        return
    }
    const { period, sort, minKills, minMatches, endAtMs } = leaderboardSeasonState
    const time = formatLeaderboardTime(endAtMs - Date.now())
    const ends = Lang.queryJS(period === 'week' ? 'landing.leaderboard.endsInWeek' : 'landing.leaderboard.endsInMonth', { time })
    const cond = sort === 'winrate'
        ? Lang.queryJS('landing.leaderboard.minMatches', { count: minMatches })
        : Lang.queryJS('landing.leaderboard.minKills', { count: minKills })
    leaderboardSeason.textContent = `${ends} \u00B7 ${cond}`
}

function renderLeaderboard(entry, keepScroll, animate = false) {
    const { data, receivedAt } = entry
    const entries = Array.isArray(data.entries) ? data.entries : []
    const scroll = keepScroll ? leaderboardRows.scrollTop : 0
    const account = ConfigManager.getSelectedAccount()
    const self = account != null && account.displayName != null ? account.displayName.toLowerCase() : ''
    const signature = JSON.stringify([data.period, data.sort, entries, self])
    const wasReady = leaderboardPanel.getAttribute('data-state') === 'ready'

    if(signature !== leaderboardSignature) {
        leaderboardSignature = signature
        leaderboardPanel.classList.toggle('lbFresh', animate)
        leaderboardPodium.replaceChildren(...[2, 1, 3].map(place => createPodiumCard(entries[place - 1], place, data.sort, self)))
        leaderboardPodium.classList.toggle('hidden', entries.length === 0)
        leaderboardRows.replaceChildren(...entries.slice(3).map(e => createLeaderboardRow(e, self)))
        leaderboardRows.scrollTop = scroll
        leaderboardTable.setAttribute('data-sort', data.sort)
    } else if(!wasReady) {
        leaderboardPanel.classList.remove('lbFresh')
    }

    if(entries.length === 0) {
        setLeaderboardState('empty')
        return
    }
    leaderboardPanel.setAttribute('data-state', 'ready')
    if(data.season != null) {
        leaderboardSeasonState = {
            period: data.period,
            sort: data.sort,
            minKills: data.season.minKills,
            minMatches: data.season.minMatches,
            endAtMs: receivedAt + data.season.secondsLeft * 1000
        }
        updateLeaderboardSeason()
    } else {
        leaderboardSeasonState = null
        leaderboardSeason.textContent = Lang.queryJS('landing.leaderboard.allTime')
    }
}

async function refreshLeaderboard(showCached, animate = false) {
    const period = leaderboardPeriod
    const sort = leaderboardSort
    const key = `${period}:${sort}`
    const requestId = ++leaderboardRequestId
    const cached = leaderboardCache.get(key)
    let loadingTimer = null

    if(showCached) {
        if(cached != null) {
            renderLeaderboard(cached, false, animate)
            if(Date.now() - cached.receivedAt < LEADERBOARD_FRESH_MS) {
                return
            }
        } else {
            loadingTimer = setTimeout(() => {
                if(requestId === leaderboardRequestId) {
                    setLeaderboardState('loading')
                }
            }, LEADERBOARD_LOADING_DELAY_MS)
        }
    }

    try {
        const entry = await loadLeaderboardEntry(period, sort)
        saveLeaderboardCache()
        leaderboardFailures = 0
        if(requestId === leaderboardRequestId) {
            renderLeaderboard(entry, !showCached, animate && cached == null)
        }
    } catch(err) {
        loggerLanding.warn('Unable to load the leaderboard.')
        loggerLanding.debug(err)
        leaderboardFailures++
        if(requestId === leaderboardRequestId && leaderboardCache.get(key) == null) {
            setLeaderboardState('error')
        }
        if(leaderboardFailures === 1) {
            clearTimeout(leaderboardRetryTimer)
            leaderboardRetryTimer = setTimeout(() => refreshLeaderboard(false), LEADERBOARD_RETRY_MS)
        }
    } finally {
        clearTimeout(loadingTimer)
    }
}

function isLeaderboardVisible() {
    return !document.hidden && getCurrentView() === VIEWS.landing
}

document.querySelectorAll('#leaderboardPanel .lbTab').forEach(button => {
    button.onclick = () => {
        const { group, value } = button.dataset
        if(group === 'period') {
            leaderboardPeriod = value
        } else {
            leaderboardSort = value
        }
        document.querySelectorAll(`#leaderboardPanel .lbTab[data-group="${group}"]`).forEach(other => {
            other.classList.toggle('active', other === button)
            other.setAttribute('aria-selected', String(other === button))
        })
        button.blur()
        refreshLeaderboard(true, true)
    }
})

leaderboardRetry.onclick = () => {
    leaderboardFailures = 0
    refreshLeaderboard(true, true)
}

setInterval(() => {
    if(isLeaderboardVisible()) {
        prefetchLeaderboard()
    }
}, LEADERBOARD_POLL_MS)
setInterval(updateLeaderboardSeason, 1000)
loadLeaderboardCache()
refreshLeaderboard(true, true)
prefetchLeaderboard()

// Update Mojang Status Color
const refreshMojangStatuses = async function(){
    loggerLanding.info('Refreshing Mojang Statuses..')

    let status = 'grey'
    let tooltipEssentialHTML = ''
    let tooltipNonEssentialHTML = ''

    const response = await MojangRestAPI.status()
    let statuses
    if(response.responseStatus === RestResponseStatus.SUCCESS) {
        statuses = response.data
    } else {
        loggerLanding.warn('Unable to refresh service status.')
        statuses = MojangRestAPI.getDefaultStatuses()
    }
    
    greenCount = 0
    greyCount = 0

    for(let i=0; i<statuses.length; i++){
        const service = statuses[i]

        const tooltipHTML = `<div class="mojangStatusContainer">
            <span class="mojangStatusIcon" style="color: ${MojangRestAPI.statusToHex(service.status)};">&#8226;</span>
            <span class="mojangStatusName">${service.name}</span>
        </div>`
        if(service.essential){
            tooltipEssentialHTML += tooltipHTML
        } else {
            tooltipNonEssentialHTML += tooltipHTML
        }

        if(service.status === 'yellow' && status !== 'red'){
            status = 'yellow'
        } else if(service.status === 'red'){
            status = 'red'
        } else {
            if(service.status === 'grey'){
                ++greyCount
            }
            ++greenCount
        }

    }

    if(greenCount === statuses.length){
        if(greyCount === statuses.length){
            status = 'grey'
        } else {
            status = 'green'
        }
    }
    
    document.getElementById('mojangStatusEssentialContainer').innerHTML = tooltipEssentialHTML
    document.getElementById('mojangStatusNonEssentialContainer').innerHTML = tooltipNonEssentialHTML
    document.getElementById('mojang_status_icon').style.color = MojangRestAPI.statusToHex(status)
}

const refreshServerStatus = async (fade = false) => {
    loggerLanding.info('Refreshing Server Status')
    const serv = (await DistroAPI.getDistribution()).getServerById(ConfigManager.getSelectedServer())

    let pLabel = Lang.queryJS('landing.serverStatus.server')
    let pVal = Lang.queryJS('landing.serverStatus.offline')

    try {

        const servStat = await getServerStatus(47, serv.hostname, serv.port)
        pLabel = Lang.queryJS('landing.serverStatus.players')
        pVal = servStat.players.online + '/' + servStat.players.max

    } catch (err) {
        loggerLanding.warn('Unable to refresh server status, assuming offline.')
        loggerLanding.debug(err)
    }
    if(fade){
        $('#server_status_wrapper').fadeOut(250, () => {
            document.getElementById('landingPlayerLabel').innerHTML = pLabel
            document.getElementById('player_count').innerHTML = pVal
            $('#server_status_wrapper').fadeIn(500)
        })
    } else {
        document.getElementById('landingPlayerLabel').innerHTML = pLabel
        document.getElementById('player_count').innerHTML = pVal
    }
    
}

// Server Status is refreshed in uibinder.js on distributionIndexDone.

// Set refresh rate to once every 5 minutes.
let serverStatusListener = setInterval(() => refreshServerStatus(true), 300000)

/**
 * Shows an error overlay, toggles off the launch area.
 * 
 * @param {string} title The overlay title.
 * @param {string} desc The overlay description.
 */
function showLaunchFailure(title, desc){
    setOverlayContent(
        title,
        desc,
        Lang.queryJS('landing.launch.okay')
    )
    setOverlayLogsButton(true)
    setOverlayHandler(null)
    toggleOverlay(true)
    toggleLaunchArea(false)
}

/* System (Java) Scan */

/**
 * Look for a valid Java installation inside the launcher runtime directory.
 * 
 * @param {string} supported The supported Java version range.
 */
async function findManagedJvm(supported){
    const fsx = require('fs-extra')
    const pathx = require('path')
    const runtimeDir = ConfigManager.getRuntimeDirectory()
    const listDirectories = async dir => {
        try {
            const entries = await fsx.readdir(dir, { withFileTypes: true })
            return entries.filter(entry => entry.isDirectory()).map(entry => pathx.join(dir, entry.name))
        } catch {
            return []
        }
    }
    const candidates = []
    for(const first of await listDirectories(runtimeDir)) {
        candidates.push(first)
        candidates.push(...await listDirectories(first))
    }
    for(const candidate of candidates) {
        const details = await validateSelectedJvm(ensureJavaDirIsRoot(candidate), supported)
        if(details != null && ConfigManager.isManagedJavaExecutable(javaExecFromRoot(details.path))) {
            return details
        }
    }
    return null
}

/**
 * Find the launcher managed Java, downloading it when it is missing.
 * 
 * @param {boolean} launchAfter Whether we should begin to launch after scanning. 
 * @param {boolean} downloaded Whether a download has just completed.
 */
async function asyncSystemScan(effectiveJavaOptions, launchAfter = true, downloaded = false){

    setLaunchDetails(Lang.queryJS('landing.systemScan.checking'))
    toggleLaunchArea(true)
    setLaunchPercentage(0, 100)

    const jvmDetails = await findManagedJvm(effectiveJavaOptions.supported)

    if(jvmDetails == null) {
        if(downloaded) {
            showLaunchFailure(Lang.queryJS('landing.systemScan.javaDownloadFailureTitle'), Lang.queryJS('landing.systemScan.javaDownloadFailureText'))
            return
        }
        setLaunchDetails(Lang.queryJS('landing.systemScan.javaDownloadPrepare'))
        try {
            await downloadJava(effectiveJavaOptions, launchAfter)
        } catch(err) {
            loggerLanding.error('Unhandled error in Java Download', err)
            showLaunchFailure(Lang.queryJS('landing.systemScan.javaDownloadFailureTitle'), Lang.queryJS('landing.systemScan.javaDownloadFailureText'))
        }
        return
    }

    const javaExec = javaExecFromRoot(jvmDetails.path)
    ConfigManager.setJavaExecutable(ConfigManager.getSelectedServer(), javaExec)
    ConfigManager.save()

    if(launchAfter){
        await dlAsync()
    }

}

async function downloadJava(effectiveJavaOptions, launchAfter = true) {

    // TODO Error handling.
    // asset can be null.
    const asset = await latestOpenJDK(
        effectiveJavaOptions.suggestedMajor,
        ConfigManager.getDataDirectory(),
        effectiveJavaOptions.distribution)

    if(asset == null) {
        throw new Error(Lang.queryJS('landing.downloadJava.findJdkFailure'))
    }

    let received = 0
    await downloadFile(asset.url, asset.path, ({ transferred }) => {
        received = transferred
        setDownloadPercentage(Math.trunc((transferred/asset.size)*100))
    })
    setDownloadPercentage(100)

    if(received != asset.size) {
        loggerLanding.warn(`Java Download: Expected ${asset.size} bytes but received ${received}`)
        if(!await validateLocalFile(asset.path, asset.algo, asset.hash)) {
            log.error(`Hashes do not match, ${asset.id} may be corrupted.`)
            // Don't know how this could happen, but report it.
            throw new Error(Lang.queryJS('landing.downloadJava.javaDownloadCorruptedError'))
        }
    }

    // Extract
    // Show installing progress bar.
    remote.getCurrentWindow().setProgressBar(2)

    // Wait for extration to complete.
    const eLStr = Lang.queryJS('landing.downloadJava.extractingJava')
    let dotStr = ''
    setLaunchDetails(eLStr)
    const extractListener = setInterval(() => {
        if(dotStr.length >= 3){
            dotStr = ''
        } else {
            dotStr += '.'
        }
        setLaunchDetails(eLStr + dotStr)
    }, 750)

    const newJavaExec = await extractJdk(asset.path)

    // Extraction complete, remove the loading from the OS progress bar.
    remote.getCurrentWindow().setProgressBar(-1)

    // Extraction completed successfully.
    ConfigManager.setJavaExecutable(ConfigManager.getSelectedServer(), newJavaExec)
    ConfigManager.save()

    clearInterval(extractListener)
    setLaunchDetails(Lang.queryJS('landing.downloadJava.javaInstalled'))

    await asyncSystemScan(effectiveJavaOptions, launchAfter, true)

}

// Keep reference to Minecraft Process
let proc
// Is DiscordRPC enabled
let hasRPC = false
// Joined server regex
// Change this if your server uses something different.
const GAME_JOINED_REGEX = /\[.+\]: Sound engine started/
const GAME_LAUNCH_REGEX = /^\[.+\]: (?:MinecraftForge .+ Initialized|ModLauncher .+ starting: .+|Loading Minecraft .+ with Fabric Loader .+)$/
const MIN_LINGER = 5000
const LAUNCH_POLL_INTERVAL = 30000

async function waitForLaunchWindow(logger) {
    let status
    try {
        status = await LaunchSchedule.fetchStatus(ConfigManager.getSelectedAccount())
    } catch(err) {
        logger.error('Unable to read the launch schedule.', err)
        const reason = err.response != null ? `HTTP ${err.response.statusCode}` : (err.code || err.message)
        showLaunchFailure(
            Lang.queryJS('landing.dlAsync.errorDuringLaunchTitle'),
            Lang.queryJS('landing.dlAsync.scheduleCheckFailed', { reason })
        )
        return false
    }
    if(status.open || status.admin) {
        return true
    }

    logger.info('Server is not open yet, waiting for the launch window.')
    setLaunchPercentage(100)
    let nextPoll = Date.now() + LAUNCH_POLL_INTERVAL

    while(!status.open) {
        const remaining = status.opensAt - (Date.now() + status.clockOffset)
        if(remaining > 0 && Date.now() < nextPoll) {
            setLaunchDetails(Lang.queryJS('landing.dlAsync.waitingForServer', {
                time: LaunchSchedule.formatOpensAt(status.opensAt),
                countdown: LaunchSchedule.formatCountdown(remaining)
            }))
            await new Promise(resolve => setTimeout(resolve, 1000))
            continue
        }
        nextPoll = Date.now() + LAUNCH_POLL_INTERVAL
        try {
            status = await LaunchSchedule.fetchStatus(null)
        } catch(err) {
            logger.warn('Unable to refresh the launch schedule.', err)
            if(remaining <= 0) {
                return true
            }
        }
    }
    return true
}

async function dlAsync(login = true) {

    // Login parameter is temporary for debug purposes. Allows testing the validation/downloads without
    // launching the game.

    const loggerLaunchSuite = LoggerUtil.getLogger('LaunchSuite')

    setLaunchDetails(Lang.queryJS('landing.dlAsync.loadingServerInfo'))

    let distro

    try {
        distro = await DistroAPI.refreshDistributionOrFallback()
        onDistroRefresh(distro)
    } catch(err) {
        loggerLaunchSuite.error('Unable to refresh distribution index.', err)
        showLaunchFailure(Lang.queryJS('landing.dlAsync.fatalError'), Lang.queryJS('landing.dlAsync.unableToLoadDistributionIndex'))
        return
    }

    const serv = distro.getServerById(ConfigManager.getSelectedServer())

    if(login) {
        if(ConfigManager.getSelectedAccount() == null){
            loggerLanding.error('You must be logged into an account.')
            return
        }
    }

    setLaunchDetails(Lang.queryJS('landing.dlAsync.pleaseWait'))
    toggleLaunchArea(true)
    setLaunchPercentage(0, 100)

    const authHeaders = require('./assets/js/apiconstants').DISTRO_AUTH_HEADERS
    const fullRepairModule = new FullRepair(
        ConfigManager.getCommonDirectory(),
        ConfigManager.getInstanceDirectory(),
        ConfigManager.getLauncherDirectory(),
        ConfigManager.getSelectedServer(),
        DistroAPI.isDevMode(),
        authHeaders
    )

    fullRepairModule.spawnReceiver()

    fullRepairModule.childProcess.on('error', (err) => {
        loggerLaunchSuite.error('Error during launch', err)
        showLaunchFailure(Lang.queryJS('landing.dlAsync.errorDuringLaunchTitle'), err.message || Lang.queryJS('landing.dlAsync.errorDuringLaunchText'))
    })
    fullRepairModule.childProcess.on('close', (code, _signal) => {
        if(code !== 0){
            loggerLaunchSuite.error(`Full Repair Module exited with code ${code}, assuming error.`)
            showLaunchFailure(Lang.queryJS('landing.dlAsync.errorDuringLaunchTitle'), Lang.queryJS('landing.dlAsync.seeConsoleForDetails'))
        }
    })

    loggerLaunchSuite.info('Validating files.')
    setLaunchDetails(Lang.queryJS('landing.dlAsync.validatingFileIntegrity'))
    let invalidFileCount = 0
    try {
        invalidFileCount = await fullRepairModule.verifyFiles(percent => {
            setLaunchPercentage(percent)
        })
        setLaunchPercentage(100)
    } catch (err) {
        loggerLaunchSuite.error('Error during file validation.')
        showLaunchFailure(Lang.queryJS('landing.dlAsync.errorDuringFileVerificationTitle'), err.displayable || Lang.queryJS('landing.dlAsync.seeConsoleForDetails'))
        return
    }
    

    if(invalidFileCount > 0) {
        loggerLaunchSuite.info('Downloading files.')
        setLaunchDetails(Lang.queryJS('landing.dlAsync.downloadingFiles'))
        setLaunchPercentage(0)
        try {
            await fullRepairModule.download(percent => {
                setDownloadPercentage(percent)
            })
            setDownloadPercentage(100)
        } catch(err) {
            loggerLaunchSuite.error('Error during file download.')
            showLaunchFailure(Lang.queryJS('landing.dlAsync.errorDuringFileDownloadTitle'), err.displayable || Lang.queryJS('landing.dlAsync.seeConsoleForDetails'))
            return
        }
    } else {
        loggerLaunchSuite.info('No invalid files, skipping download.')
    }

    // Remove download bar.
    remote.getCurrentWindow().setProgressBar(-1)

    fullRepairModule.destroyReceiver()

    if(login && !await waitForLaunchWindow(loggerLaunchSuite)) {
        return
    }

    setLaunchDetails(Lang.queryJS('landing.dlAsync.preparingToLaunch'))

    const mojangIndexProcessor = new MojangIndexProcessor(
        ConfigManager.getCommonDirectory(),
        serv.rawServer.minecraftVersion)
        
    const distributionIndexProcessor = new DistributionIndexProcessor(
        ConfigManager.getCommonDirectory(),
        distro,
        serv.rawServer.id,
        authHeaders
    )

    const modLoaderData = await distributionIndexProcessor.loadModLoaderVersionJson(serv)
    const versionData = await mojangIndexProcessor.getVersionJson()

    if(login) {
        const authUser = ConfigManager.getSelectedAccount()
        loggerLaunchSuite.info(`Sending selected account (${authUser.displayName}) to ProcessBuilder.`)
        let pb = new ProcessBuilder(serv, versionData, modLoaderData, authUser, remote.app.getVersion())
        setLaunchDetails(Lang.queryJS('landing.dlAsync.launchingGame'))

        // const SERVER_JOINED_REGEX = /\[.+\]: \[CHAT\] [a-zA-Z0-9_]{1,16} joined the game/
        const SERVER_JOINED_REGEX = new RegExp(`\\[.+\\]: \\[CHAT\\] ${authUser.displayName} joined the game`)

        const onLoadComplete = () => {
            toggleLaunchArea(false)
            if(hasRPC){
                DiscordWrapper.updateDetails(Lang.queryJS('landing.discord.loading'))
                proc.stdout.on('data', gameStateChange)
            }
            proc.stdout.removeListener('data', tempListener)
            proc.stderr.removeListener('data', gameErrorListener)
        }
        const start = Date.now()

        // Attach a temporary listener to the client output.
        // Will wait for a certain bit of text meaning that
        // the client application has started, and we can hide
        // the progress bar stuff.
        const tempListener = function(data){
            if(GAME_LAUNCH_REGEX.test(data.trim())){
                const diff = Date.now()-start
                if(diff < MIN_LINGER) {
                    setTimeout(onLoadComplete, MIN_LINGER-diff)
                } else {
                    onLoadComplete()
                }
            }
        }

        // Listener for Discord RPC.
        const gameStateChange = function(data){
            data = data.trim()
            if(SERVER_JOINED_REGEX.test(data)){
                DiscordWrapper.updateDetails(Lang.queryJS('landing.discord.joined'))
            } else if(GAME_JOINED_REGEX.test(data)){
                DiscordWrapper.updateDetails(Lang.queryJS('landing.discord.joining'))
            }
        }

        const gameErrorListener = function(data){
            data = data.trim()
            if(data.indexOf('Could not find or load main class net.minecraft.launchwrapper.Launch') > -1){
                loggerLaunchSuite.error('Game launch failed, LaunchWrapper was not downloaded properly.')
                showLaunchFailure(Lang.queryJS('landing.dlAsync.errorDuringLaunchTitle'), Lang.queryJS('landing.dlAsync.launchWrapperNotDownloaded'))
            }
        }

        try {
            // Build Minecraft process.
            proc = pb.build()

            // Bind listeners to stdout.
            proc.stdout.on('data', tempListener)
            proc.stderr.on('data', gameErrorListener)

            setLaunchDetails(Lang.queryJS('landing.dlAsync.doneEnjoyServer'))

            // Init Discord Hook
            if(distro.rawDistribution.discord != null && serv.rawServer.discord != null){
                DiscordWrapper.initRPC(distro.rawDistribution.discord, serv.rawServer.discord)
                hasRPC = true
                proc.on('close', (code, signal) => {
                    loggerLaunchSuite.info('Shutting down Discord Rich Presence..')
                    DiscordWrapper.shutdownRPC()
                    hasRPC = false
                    proc = null
                })
            }

        } catch(err) {

            loggerLaunchSuite.error('Error during launch', err)
            showLaunchFailure(Lang.queryJS('landing.dlAsync.errorDuringLaunchTitle'), Lang.queryJS('landing.dlAsync.checkConsoleForDetails'))

        }
    }

}

/**
 * News Loading Functions
 */

// DOM Cache
const newsContent                   = document.getElementById('newsContent')
const newsArticleTitle              = document.getElementById('newsArticleTitle')
const newsArticleDate               = document.getElementById('newsArticleDate')
const newsArticleAuthor             = document.getElementById('newsArticleAuthor')
const newsArticleComments           = document.getElementById('newsArticleComments')
const newsNavigationStatus          = document.getElementById('newsNavigationStatus')
const newsArticleContentScrollable  = document.getElementById('newsArticleContentScrollable')
const nELoadSpan                    = document.getElementById('nELoadSpan')

// News slide caches.
let newsActive = false
let newsGlideCount = 0

/**
 * Show the news UI via a slide animation.
 * 
 * @param {boolean} up True to slide up, otherwise false. 
 */
function slide_(up){
    const lCUpper = document.querySelector('#landingContainer > #upper')
    const lCLLeft = document.querySelector('#landingContainer > #lower > #left')
    const lCLCenter = document.querySelector('#landingContainer > #lower > #center')
    const lCLRight = document.querySelector('#landingContainer > #lower > #right')
    const newsBtn = document.querySelector('#landingContainer > #lower > #center #content')
    const landingContainer = document.getElementById('landingContainer')
    const newsContainer = document.querySelector('#landingContainer > #newsContainer')

    newsGlideCount++

    if(up){
        lCUpper.style.top = '-200vh'
        lCLLeft.style.top = '-200vh'
        lCLCenter.style.top = '-200vh'
        lCLRight.style.top = '-200vh'
        newsBtn.style.top = '130vh'
        newsContainer.style.top = '0px'
        //date.toLocaleDateString('en-US', {month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: 'numeric'})
        //landingContainer.style.background = 'rgba(29, 29, 29, 0.55)'
        landingContainer.style.background = 'rgba(0, 0, 0, 0.50)'
        setTimeout(() => {
            if(newsGlideCount === 1){
                lCLCenter.style.transition = 'none'
                newsBtn.style.transition = 'none'
            }
            newsGlideCount--
        }, 2000)
    } else {
        setTimeout(() => {
            newsGlideCount--
        }, 2000)
        landingContainer.style.background = null
        lCLCenter.style.transition = null
        newsBtn.style.transition = null
        newsContainer.style.top = '100%'
        lCUpper.style.top = '0px'
        lCLLeft.style.top = '0px'
        lCLCenter.style.top = '0px'
        lCLRight.style.top = '0px'
        newsBtn.style.top = '10px'
    }
}

// Bind news button.
/*
document.getElementById('newsButton').onclick = () => {
    // Toggle tabbing.
    if(newsActive){
        $('#landingContainer *').removeAttr('tabindex')
        $('#newsContainer *').attr('tabindex', '-1')
    } else {
        $('#landingContainer *').attr('tabindex', '-1')
        $('#newsContainer, #newsContainer *, #lower, #lower #center *').removeAttr('tabindex')
        if(newsAlertShown){
            $('#newsButtonAlert').fadeOut(2000)
            newsAlertShown = false
            ConfigManager.setNewsCacheDismissed(true)
            ConfigManager.save()
        }
    }
    slide_(!newsActive)
    newsActive = !newsActive
}
*/

// Array to store article meta.
let newsArr = null

// News load animation listener.
let newsLoadingListener = null

/**
 * Set the news loading animation.
 * 
 * @param {boolean} val True to set loading animation, otherwise false.
 */
function setNewsLoading(val){
    if(val){
        const nLStr = Lang.queryJS('landing.news.checking')
        let dotStr = '..'
        nELoadSpan.innerHTML = nLStr + dotStr
        newsLoadingListener = setInterval(() => {
            if(dotStr.length >= 3){
                dotStr = ''
            } else {
                dotStr += '.'
            }
            nELoadSpan.innerHTML = nLStr + dotStr
        }, 750)
    } else {
        if(newsLoadingListener != null){
            clearInterval(newsLoadingListener)
            newsLoadingListener = null
        }
    }
}

// Bind retry button.
newsErrorRetry.onclick = () => {
    $('#newsErrorFailed').fadeOut(250, () => {
        initNews()
        $('#newsErrorLoading').fadeIn(250)
    })
}

newsArticleContentScrollable.onscroll = (e) => {
    if(e.target.scrollTop > Number.parseFloat($('.newsArticleSpacerTop').css('height'))){
        newsContent.setAttribute('scrolled', '')
    } else {
        newsContent.removeAttribute('scrolled')
    }
}

/**
 * Reload the news without restarting.
 * 
 * @returns {Promise.<void>} A promise which resolves when the news
 * content has finished loading and transitioning.
 */
function reloadNews(){
    return new Promise((resolve, reject) => {
        $('#newsContent').fadeOut(250, () => {
            $('#newsErrorLoading').fadeIn(250)
            initNews().then(() => {
                resolve()
            })
        })
    })
}

let newsAlertShown = false

/**
 * Show the news alert indicating there is new news.
 */
function showNewsAlert(){
    newsAlertShown = true
    // $(newsButtonAlert).fadeIn(250)
}

async function digestMessage(str) {
    const msgUint8 = new TextEncoder().encode(str)
    const hashBuffer = await crypto.subtle.digest('SHA-1', msgUint8)
    const hashArray = Array.from(new Uint8Array(hashBuffer))
    const hashHex = hashArray
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('')
    return hashHex
}

/**
 * Initialize News UI. This will load the news and prepare
 * the UI accordingly.
 * 
 * @returns {Promise.<void>} A promise which resolves when the news
 * content has finished loading and transitioning.
 */
async function initNews(){

    setNewsLoading(true)

    const news = await loadNews()

    newsArr = news?.articles || null

    if(newsArr == null){
        // News Loading Failed
        setNewsLoading(false)

        await $('#newsErrorLoading').fadeOut(250).promise()
        await $('#newsErrorFailed').fadeIn(250).promise()

    } else if(newsArr.length === 0) {
        // No News Articles
        setNewsLoading(false)

        ConfigManager.setNewsCache({
            date: null,
            content: null,
            dismissed: false
        })
        ConfigManager.save()

        await $('#newsErrorLoading').fadeOut(250).promise()
        await $('#newsErrorNone').fadeIn(250).promise()
    } else {
        // Success
        setNewsLoading(false)

        const lN = newsArr[0]
        const cached = ConfigManager.getNewsCache()
        let newHash = await digestMessage(lN.content)
        let newDate = new Date(lN.date)
        let isNew = false

        if(cached.date != null && cached.content != null){

            if(new Date(cached.date) >= newDate){

                // Compare Content
                if(cached.content !== newHash){
                    isNew = true
                    showNewsAlert()
                } else {
                    if(!cached.dismissed){
                        isNew = true
                        showNewsAlert()
                    }
                }

            } else {
                isNew = true
                showNewsAlert()
            }

        } else {
            isNew = true
            showNewsAlert()
        }

        if(isNew){
            ConfigManager.setNewsCache({
                date: newDate.getTime(),
                content: newHash,
                dismissed: false
            })
            ConfigManager.save()
        }

        const switchHandler = (forward) => {
            let cArt = parseInt(newsContent.getAttribute('article'))
            let nxtArt = forward ? (cArt >= newsArr.length-1 ? 0 : cArt + 1) : (cArt <= 0 ? newsArr.length-1 : cArt - 1)
    
            displayArticle(newsArr[nxtArt], nxtArt+1)
        }

        document.getElementById('newsNavigateRight').onclick = () => { switchHandler(true) }
        document.getElementById('newsNavigateLeft').onclick = () => { switchHandler(false) }
        await $('#newsErrorContainer').fadeOut(250).promise()
        displayArticle(newsArr[0], 1)
        await $('#newsContent').fadeIn(250).promise()
    }


}

/**
 * Add keyboard controls to the news UI. Left and right arrows toggle
 * between articles. If you are on the landing page, the up arrow will
 * open the news UI.
 */
document.addEventListener('keydown', (e) => {
    if(newsActive){
        if(e.key === 'ArrowRight' || e.key === 'ArrowLeft'){
            document.getElementById(e.key === 'ArrowRight' ? 'newsNavigateRight' : 'newsNavigateLeft').click()
        }
        // Interferes with scrolling an article using the down arrow.
        // Not sure of a straight forward solution at this point.
        // if(e.key === 'ArrowDown'){
        //     document.getElementById('newsButton').click()
        // }
    } else {
        if(getCurrentView() === VIEWS.landing){
            if(e.key === 'ArrowUp'){
                document.getElementById('newsButton').click()
            }
        }
    }
})

/**
 * Display a news article on the UI.
 * 
 * @param {Object} articleObject The article meta object.
 * @param {number} index The article index.
 */
function displayArticle(articleObject, index){
    newsArticleTitle.innerHTML = articleObject.title
    newsArticleTitle.href = articleObject.link
    newsArticleAuthor.innerHTML = 'por ' + articleObject.author
    newsArticleDate.innerHTML = articleObject.date
    newsArticleComments.innerHTML = articleObject.comments
    newsArticleComments.href = articleObject.commentsLink
    newsArticleContentScrollable.innerHTML = '<div id="newsArticleContentWrapper"><div class="newsArticleSpacerTop"></div>' + articleObject.content + '<div class="newsArticleSpacerBot"></div></div>'
    Array.from(newsArticleContentScrollable.getElementsByClassName('bbCodeSpoilerButton')).forEach(v => {
        v.onclick = () => {
            const text = v.parentElement.getElementsByClassName('bbCodeSpoilerText')[0]
            text.style.display = text.style.display === 'block' ? 'none' : 'block'
        }
    })
    newsNavigationStatus.innerHTML = Lang.query('ejs.landing.newsNavigationStatus', {currentPage: index, totalPages: newsArr.length})
    newsContent.setAttribute('article', index-1)
}

/**
 * Load news information from the RSS feed specified in the
 * distribution index.
 */
async function loadNews(){

    const distroData = await DistroAPI.getDistribution()
    if(!distroData.rawDistribution.rss) {
        loggerLanding.debug('No RSS feed provided.')
        return null
    }

    const promise = new Promise((resolve, reject) => {
        
        const newsFeed = distroData.rawDistribution.rss
        const newsHost = new URL(newsFeed).origin + '/'
        $.ajax({
            url: newsFeed,
            success: (data) => {
                const items = $(data).find('item')
                const articles = []

                for(let i=0; i<items.length; i++){
                // JQuery Element
                    const el = $(items[i])

                    // Resolve date.
                    const date = new Date(el.find('pubDate').text()).toLocaleDateString('en-US', {month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: 'numeric'})

                    // Resolve comments.
                    let comments = el.find('slash\\:comments').text() || '0'
                    comments = comments + ' Comment' + (comments === '1' ? '' : 's')

                    // Fix relative links in content.
                    let content = el.find('content\\:encoded').text()
                    let regex = /src="(?!http:\/\/|https:\/\/)(.+?)"/g
                    let matches
                    while((matches = regex.exec(content))){
                        content = content.replace(`"${matches[1]}"`, `"${newsHost + matches[1]}"`)
                    }

                    let link   = el.find('link').text()
                    let title  = el.find('title').text()
                    let author = el.find('dc\\:creator').text()

                    // Generate article.
                    articles.push(
                        {
                            link,
                            title,
                            date,
                            author,
                            content,
                            comments,
                            commentsLink: link + '#comments'
                        }
                    )
                }
                resolve({
                    articles
                })
            },
            timeout: 2500
        }).catch(err => {
            resolve({
                articles: null
            })
        })
    })

    return await promise
}
