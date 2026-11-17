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

const ProfileSkinSource  = require('./assets/js/skinhead')
const ProfileSkinViewer  = require('./assets/js/skinviewer')
const ProfileSkinManager = require('./assets/js/skinmanager')
const ProfileAccounts    = require('./assets/js/accountmanager')

const PROFILE_NAME_PATTERN = /^[a-zA-Z0-9_]{3,16}$/
const PROFILE_MIN_PASSWORD = 8

const profileBody          = document.getElementById('profileBody')
const profileNick          = document.getElementById('profileNick')
const profileHead          = document.getElementById('profileHead')
const profileSkinViewerEl  = document.getElementById('profileSkinViewer')
const profileSkinEmpty     = document.getElementById('profileSkinEmpty')
const profileSkinUpload    = document.getElementById('profileSkinUpload')
const profileSkinReset     = document.getElementById('profileSkinReset')
const profileSkinStatus    = document.getElementById('profileSkinStatus')
const profileAccountForm   = document.getElementById('profileAccountForm')
const profileName          = document.getElementById('profileName')
const profileNewPassword   = document.getElementById('profileNewPassword')
const profileRepeatPassword = document.getElementById('profileRepeatPassword')
const profileCurrentPassword = document.getElementById('profileCurrentPassword')
const profilePasswordToggle = document.getElementById('profilePasswordToggle')
const profileSave          = document.getElementById('profileSave')
const profileAccountStatus = document.getElementById('profileAccountStatus')

let profileSkinViewer = null
let profileBusy = false

function setProfileStatus(element, message, kind) {
    element.textContent = message
    element.classList.remove('ok', 'error')
    if(kind) {
        element.classList.add(kind)
    }
}

function setProfileBusy(busy) {
    profileBusy = busy
    profileBody.classList.toggle('busy', busy)
    refreshProfileForm()
}

function refreshProfileIdentity() {
    const account = ConfigManager.getSelectedAccount()
    profileNick.textContent = account != null && account.displayName != null ? account.displayName : Lang.queryJS('landing.selectedAccount.noAccountSelected')
    profileName.placeholder = account != null && account.displayName != null ? account.displayName : ''
    profileHead.classList.remove('has-head')
    if(account == null || account.uuid == null) {
        return
    }
    const uuid = account.uuid
    ProfileSkinSource.getHeadDataUrl(uuid).then(head => {
        const current = ConfigManager.getSelectedAccount()
        if(head == null || current == null || current.uuid !== uuid) {
            return
        }
        profileHead.style.setProperty('--head-image', `url("${head}")`)
        profileHead.classList.add('has-head')
    })
}

async function refreshProfileSkin() {
    if(profileSkinViewer == null) {
        profileSkinViewer = ProfileSkinViewer.create(profileSkinViewerEl)
    }
    const account = ConfigManager.getSelectedAccount()
    if(account == null) {
        profileSkinViewer.clear()
        profileSkinEmpty.hidden = false
        return
    }
    const skin = await ProfileSkinSource.getSkin(account.uuid)
    const current = ConfigManager.getSelectedAccount()
    if(current == null || current.uuid !== account.uuid) {
        return
    }
    if(skin == null) {
        profileSkinViewer.clear()
        profileSkinEmpty.hidden = false
        return
    }
    try {
        await profileSkinViewer.show(skin.dataUrl, skin.slim)
        profileSkinEmpty.hidden = true
    } catch {
        profileSkinViewer.clear()
        profileSkinEmpty.hidden = false
    }
}

async function applyProfileSkinChange(action, successKey) {
    const account = ConfigManager.getSelectedAccount()
    if(account == null || profileBusy) {
        return
    }
    setProfileBusy(true)
    setProfileStatus(profileSkinStatus, '', null)
    try {
        await action(account)
        ProfileSkinSource.invalidate(account.uuid)
        setProfileStatus(profileSkinStatus, Lang.queryJS(`profile.skin.${successKey}`), 'ok')
        await refreshProfileSkin()
        updateSelectedAccount(ConfigManager.getSelectedAccount())
        refreshProfileIdentity()
    } catch(err) {
        const code = err instanceof ProfileSkinManager.SkinError ? err.code : 'network'
        setProfileStatus(profileSkinStatus, Lang.queryJS(`profile.skin.${code}`), 'error')
    } finally {
        setProfileBusy(false)
    }
}

async function pickProfileSkin() {
    const res = await remote.dialog.showOpenDialog(remote.getCurrentWindow(), {
        title: Lang.queryJS('profile.skin.selectTitle'),
        properties: ['openFile'],
        filters: [{ name: Lang.queryJS('profile.skin.pngFilter'), extensions: ['png'] }]
    })
    if(res.canceled) {
        return
    }
    await applyProfileSkinChange(account => ProfileSkinManager.uploadSkin(account.accessToken, res.filePaths[0]), 'uploaded')
}

function readProfileForm() {
    const account = ConfigManager.getSelectedAccount()
    const name = profileName.value.trim()
    return {
        account,
        name: account != null && name === account.displayName ? '' : name,
        rawName: name,
        newPassword: profileNewPassword.value,
        repeatPassword: profileRepeatPassword.value,
        password: profileCurrentPassword.value
    }
}

function profileFormProblem(form) {
    if(form.rawName.length > 0 && !PROFILE_NAME_PATTERN.test(form.rawName)) {
        return 'invalidName'
    }
    if(!form.name && !form.newPassword) {
        return 'nothing'
    }
    if(form.newPassword) {
        if(form.newPassword.length < PROFILE_MIN_PASSWORD) {
            return 'passwordShort'
        }
        if(form.newPassword !== form.repeatPassword) {
            return 'mismatch'
        }
    }
    if(!form.password) {
        return 'needCurrent'
    }
    return null
}

function refreshProfileForm() {
    const form = readProfileForm()
    const problem = profileFormProblem(form)
    profileSave.disabled = profileBusy || form.account == null || problem != null
    profileName.classList.toggle('invalid', form.rawName.length > 0 && !PROFILE_NAME_PATTERN.test(form.rawName))
    profileNewPassword.classList.toggle('invalid', form.newPassword.length > 0 && form.newPassword.length < PROFILE_MIN_PASSWORD)
    profileRepeatPassword.classList.toggle('invalid', form.repeatPassword.length > 0 && form.repeatPassword !== form.newPassword)
}

function onProfileFormInput() {
    refreshProfileForm()
    const form = readProfileForm()
    const touched = form.rawName || form.newPassword || form.repeatPassword || form.password
    if(!touched) {
        setProfileStatus(profileAccountStatus, '', null)
        return
    }
    const problem = profileFormProblem(form)
    setProfileStatus(profileAccountStatus, problem == null ? '' : Lang.queryJS(`profile.account.hint.${problem}`), null)
}

function clearProfileForm() {
    profileName.value = ''
    profileNewPassword.value = ''
    profileRepeatPassword.value = ''
    profileCurrentPassword.value = ''
    refreshProfileForm()
}

async function saveProfileAccount() {
    const form = readProfileForm()
    if(profileBusy || form.account == null || profileFormProblem(form) != null) {
        return
    }
    setProfileBusy(true)
    setProfileStatus(profileAccountStatus, '', null)
    try {
        await ProfileAccounts.updateAccount(form.account.username, form.password, {
            playerName: form.name,
            newPassword: form.newPassword
        })
        if(form.name) {
            const stored = ConfigManager.getAuthAccount(form.account.uuid)
            stored.displayName = form.name
            ConfigManager.save()
            updateSelectedAccount(ConfigManager.getSelectedAccount())
            refreshProfileIdentity()
        }
        clearProfileForm()
        setProfileStatus(profileAccountStatus, Lang.queryJS('profile.account.saved'), 'ok')
    } catch(err) {
        const code = err instanceof ProfileAccounts.AccountError ? err.code : 'network'
        const detail = code === 'rejected' && err.message && err.message !== 'rejected' ? ` ${err.message}` : ''
        setProfileStatus(profileAccountStatus, Lang.queryJS(`profile.account.${code}`) + detail, 'error')
    } finally {
        setProfileBusy(false)
    }
}

function setProfilePasswordsVisible(visible) {
    const type = visible ? 'text' : 'password'
    profileNewPassword.type = type
    profileRepeatPassword.type = type
    profileCurrentPassword.type = type
    profilePasswordToggle.textContent = visible ? profilePasswordToggle.dataset.hide : profilePasswordToggle.dataset.show
}

function processProfileLogOut() {
    const uuid = ConfigManager.getSelectedAccount().uuid
    const isLastAccount = Object.keys(ConfigManager.getAuthAccounts()).length === 1
    AuthManager.removeMojangAccount(uuid).then(() => {
        const selected = ConfigManager.getSelectedAccount()
        updateSelectedAccount(selected)
        if(isLastAccount) {
            openLoginView(VIEWS.landing, VIEWS.profile)
        } else {
            validateSelectedAccount()
            refreshProfileIdentity()
            refreshProfileSkin()
        }
    })
}

function confirmProfileLogOut() {
    setOverlayContent(
        Lang.queryJS('profile.logout.title'),
        Lang.queryJS('profile.logout.message'),
        Lang.queryJS('profile.logout.confirmButton'),
        Lang.queryJS('profile.logout.cancelButton')
    )
    setOverlayHandler(() => {
        toggleOverlay(false)
        processProfileLogOut()
    })
    setDismissHandler(() => {
        toggleOverlay(false)
    })
    toggleOverlay(true, true)
}

function prepareProfile() {
    clearProfileForm()
    setProfilePasswordsVisible(false)
    setProfileStatus(profileSkinStatus, '', null)
    setProfileStatus(profileAccountStatus, '', null)
    refreshProfileIdentity()
    return refreshProfileSkin()
}

async function openProfile() {
    if(ConfigManager.isGuestMode()) {
        ConfigManager.endGuestMode()
        hideGuestModeBanner()
        openLoginView(VIEWS.landing)
        return
    }
    if(ConfigManager.getSelectedAccount() == null) {
        openLoginView(VIEWS.landing)
        return
    }
    await prepareProfile()
    switchView(getCurrentView(), VIEWS.profile)
}

function closeProfile() {
    if(profileBusy) {
        return
    }
    switchView(getCurrentView(), VIEWS.landing)
}

profileSkinUpload.onclick = pickProfileSkin
profileSkinReset.onclick = () => {
    applyProfileSkinChange(account => ProfileSkinManager.resetSkin(account.accessToken), 'removed')
}
profileAccountForm.addEventListener('submit', e => {
    e.preventDefault()
    saveProfileAccount()
})
for(const input of [profileName, profileNewPassword, profileRepeatPassword, profileCurrentPassword]) {
    input.addEventListener('input', onProfileFormInput)
}
profilePasswordToggle.onclick = () => {
    setProfilePasswordsVisible(profileNewPassword.type === 'password')
}
document.getElementById('profileLogout').onclick = confirmProfileLogOut
document.getElementById('profileDone').onclick = closeProfile
document.addEventListener('keydown', e => {
    if(e.key === 'Escape' && getCurrentView() === VIEWS.profile && !document.getElementById('main').hasAttribute('overlay')) {
        closeProfile()
    }
})
