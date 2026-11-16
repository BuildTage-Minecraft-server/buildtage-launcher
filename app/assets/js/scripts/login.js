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


const loginLogger = LoggerUtil.getLogger('Login')

const AccountService = require('./assets/js/accountmanager')

const DISTRO_REFRESH_TIMEOUT = 15000
const MIN_PASSWORD_LENGTH = 8

const validUsername         = /^[a-zA-Z0-9_]{3,16}$/
const basicEmail            = /^\S+@\S+\.\S+$/

const loginEmailError       = document.getElementById('loginEmailError')
const loginUsername         = document.getElementById('loginUsername')
const loginPasswordError    = document.getElementById('loginPasswordError')
const loginPassword         = document.getElementById('loginPassword')
const loginPasswordToggle   = document.getElementById('loginPasswordToggle')
const loginPasswordConfirmContainer = document.getElementById('loginPasswordConfirmContainer')
const loginPasswordConfirmError = document.getElementById('loginPasswordConfirmError')
const loginPasswordConfirm  = document.getElementById('loginPasswordConfirm')
const loginSubheader        = document.getElementById('loginSubheader')
const loginButtonText       = document.getElementById('loginButtonText')
const loginModeToggle       = document.getElementById('loginModeToggle')
const loginFormError        = document.getElementById('loginFormError')
const loginButton           = document.getElementById('loginButton')
const loginForm             = document.getElementById('loginForm')

let loginBusy = false
let loginMode = 'login'

function showError(element, value){
    element.innerHTML = value
    element.style.opacity = 1
}

function hideError(element){
    element.style.opacity = 0
}

function shakeError(element){
    if(element.style.opacity == 1){
        element.classList.remove('shake')
        void element.offsetWidth
        element.classList.add('shake')
    }
}

function showFormError(text){
    loginFormError.textContent = text
    loginFormError.style.display = text ? 'block' : 'none'
}

function isUsernameValid(value){
    if(loginMode === 'register'){
        return validUsername.test(value)
    }
    return validUsername.test(value) || basicEmail.test(value)
}

function isPasswordValid(){
    if(loginMode === 'register'){
        return loginPassword.value.length >= MIN_PASSWORD_LENGTH
    }
    return loginPassword.value.length > 0
}

function isFormValid(){
    if(!isUsernameValid(loginUsername.value.trim()) || !isPasswordValid()){
        return false
    }
    return loginMode !== 'register' || loginPasswordConfirm.value === loginPassword.value
}

function loginDisabled(v){
    if(loginButton.disabled !== v){
        loginButton.disabled = v
    }
}

function refreshLoginState(){
    if(!loginBusy){
        loginDisabled(!isFormValid())
    }
}

function validateUsernameField(report){
    const value = loginUsername.value.trim()
    if(value.length === 0){
        if(report){
            showError(loginEmailError, Lang.queryJS('login.error.requiredValue'))
        }
    } else if(!isUsernameValid(value)){
        showError(loginEmailError, Lang.queryJS('login.error.invalidValue'))
    } else {
        hideError(loginEmailError)
    }
}

function validatePasswordField(report){
    if(loginPassword.value.length === 0){
        if(report){
            showError(loginPasswordError, Lang.queryJS('login.error.requiredValue'))
        }
    } else if(report && !isPasswordValid()){
        showError(loginPasswordError, Lang.queryJS('login.error.passwordShort'))
    } else {
        hideError(loginPasswordError)
    }
}

function validatePasswordConfirmField(report){
    if(loginMode !== 'register' || loginPasswordConfirm.value === loginPassword.value){
        hideError(loginPasswordConfirmError)
    } else if(report){
        showError(loginPasswordConfirmError, Lang.queryJS('login.error.passwordMismatch'))
    }
}

function onFieldInput(){
    showFormError('')
    validateUsernameField(false)
    validatePasswordField(false)
    validatePasswordConfirmField(false)
    refreshLoginState()
}

loginUsername.addEventListener('input', onFieldInput)
loginPassword.addEventListener('input', onFieldInput)
loginPasswordConfirm.addEventListener('input', onFieldInput)
loginUsername.addEventListener('change', onFieldInput)
loginPassword.addEventListener('change', onFieldInput)
loginPasswordConfirm.addEventListener('change', onFieldInput)

loginUsername.addEventListener('focusout', () => {
    validateUsernameField(true)
    shakeError(loginEmailError)
    refreshLoginState()
})
loginPassword.addEventListener('focusout', () => {
    validatePasswordField(true)
    shakeError(loginPasswordError)
    refreshLoginState()
})
loginPasswordConfirm.addEventListener('focusout', () => {
    validatePasswordConfirmField(true)
    shakeError(loginPasswordConfirmError)
    refreshLoginState()
})

setInterval(refreshLoginState, 300)

loginPasswordToggle.addEventListener('click', () => {
    const reveal = loginPassword.type === 'password'
    loginPassword.type = reveal ? 'text' : 'password'
    loginPasswordConfirm.type = loginPassword.type
    loginPasswordToggle.textContent = reveal ? loginPasswordToggle.dataset.hide : loginPasswordToggle.dataset.show
    loginPassword.focus()
})

function setLoginButtonText(text){
    loginButtonText.textContent = text
}

function idleButtonText(){
    return Lang.queryJS(loginMode === 'register' ? 'login.registerButton' : 'login.login')
}

function loginLoading(v){
    if(v){
        loginButton.setAttribute('loading', v)
        setLoginButtonText(Lang.queryJS(loginMode === 'register' ? 'login.registering' : 'login.loggingIn'))
    } else {
        loginButton.removeAttribute('loading')
        setLoginButtonText(idleButtonText())
    }
}

function formDisabled(v){
    loginBusy = v
    loginButton.disabled = v || !isFormValid()
    loginPasswordToggle.disabled = v
    loginModeToggle.disabled = v
    loginUsername.disabled = v
    loginPassword.disabled = v
    loginPasswordConfirm.disabled = v
}

function setLoginMode(mode){
    loginMode = mode
    const registering = mode === 'register'
    loginPasswordConfirmContainer.style.display = registering ? 'flex' : 'none'
    loginSubheader.textContent = loginSubheader.dataset[mode]
    loginModeToggle.textContent = loginModeToggle.dataset[mode]
    loginPassword.autocomplete = registering ? 'new-password' : 'current-password'
    loginPasswordConfirm.value = ''
    hideError(loginEmailError)
    hideError(loginPasswordError)
    hideError(loginPasswordConfirmError)
    showFormError('')
    if(!loginButton.hasAttribute('loading')){
        setLoginButtonText(idleButtonText())
    }
    refreshLoginState()
}

function refreshLoginModeToggle(){
    const available = ConfigManager.isRegistrationAvailable()
    loginModeToggle.style.display = available ? 'block' : 'none'
    if(!available && loginMode === 'register'){
        setLoginMode('login')
    }
}

loginModeToggle.addEventListener('click', () => {
    if(!loginBusy){
        setLoginMode(loginMode === 'register' ? 'login' : 'register')
        loginUsername.focus()
    }
})

let loginViewOnSuccess = VIEWS.landing

function openLoginView(onSuccess = VIEWS.landing, from = getCurrentView(), mode = 'login'){
    loginViewOnSuccess = onSuccess
    setLoginMode(mode)
    refreshLoginModeToggle()
    switchView(from, VIEWS.login, 500, 500)
}

function openRegistration(){
    if(getCurrentView() === VIEWS.login){
        setLoginMode('register')
        loginUsername.focus()
        return
    }
    const from = getCurrentView()
    openLoginView(from === VIEWS.settings ? VIEWS.settings : VIEWS.landing, from, 'register')
}

function withTimeout(promise, ms){
    let timer
    const timeout = new Promise(resolve => {
        timer = setTimeout(resolve, ms)
    })
    return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
}

loginForm.onsubmit = (e) => {
    if(e && e.preventDefault){
        e.preventDefault()
    }
    return false
}

function describeLoginError(err){
    if(err instanceof AccountService.AccountError){
        const detail = err.code === 'rejected' && err.message && err.message !== 'rejected' ? ` ${err.message}` : ''
        return Lang.queryJS(`login.registerError.${err.code}`) + detail
    }
    if(err != null && typeof err === 'object' && typeof err.desc === 'string' && err.desc.length > 0){
        return err.desc
    }
    return Lang.queryJS('login.error.unknown.desc')
}

loginButton.addEventListener('click', () => {
    if(loginBusy || !isFormValid()){
        return
    }

    showFormError('')
    formDisabled(true)
    loginLoading(true)

    const username = loginUsername.value.trim()
    const password = loginPassword.value
    let attempt
    if(loginMode === 'register'){
        attempt = AccountService.registerAccount(username, password).then(() => {
            setLoginMode('login')
            loginLoading(true)
            return AuthManager.addMojangAccount(username, password)
        })
    } else {
        attempt = AuthManager.addMojangAccount(username, password)
    }

    attempt.then(async (value) => {
        updateSelectedAccount(value)
        await withTimeout(ConfigManager.refreshDistroAndSettings(value), DISTRO_REFRESH_TIMEOUT)
        refreshRegistrationLink()
        setLoginButtonText(Lang.queryJS('login.success'))
        $('.circle-loader').toggleClass('load-complete')
        $('.checkmark').toggle()
        setTimeout(() => {
            switchView(VIEWS.login, loginViewOnSuccess, 500, 500, async () => {
                if(loginViewOnSuccess === VIEWS.settings){
                    await prepareSettings()
                }
                loginViewOnSuccess = VIEWS.landing
                loginUsername.value = ''
                loginPassword.value = ''
                loginPassword.type = 'password'
                loginPasswordConfirm.type = 'password'
                loginPasswordToggle.textContent = loginPasswordToggle.dataset.show
                $('.circle-loader').toggleClass('load-complete')
                $('.checkmark').toggle()
                setLoginMode('login')
                loginLoading(false)
                formDisabled(false)
            })
        }, 1000)
    }).catch((err) => {
        loginLogger.error('Error while logging in.', err)
        loginLoading(false)
        formDisabled(false)
        showFormError(describeLoginError(err))
        loginPassword.focus()
        loginPassword.select()
    })
})