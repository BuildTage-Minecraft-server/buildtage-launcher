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


const { REGISTRATION_URL } = require('./assets/js/apiconstants')

const validUsername         = /^[a-zA-Z0-9_]{3,16}$/
const basicEmail            = /^\S+@\S+\.\S+$/

const loginEmailError       = document.getElementById('loginEmailError')
const loginUsername         = document.getElementById('loginUsername')
const loginPasswordError    = document.getElementById('loginPasswordError')
const loginPassword         = document.getElementById('loginPassword')
const loginPasswordToggle   = document.getElementById('loginPasswordToggle')
const loginFormError        = document.getElementById('loginFormError')
const loginButton           = document.getElementById('loginButton')
const loginRegisterButton   = document.getElementById('loginRegisterButton')
const loginForm             = document.getElementById('loginForm')

let loginBusy = false

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
    return validUsername.test(value) || basicEmail.test(value)
}

function isFormValid(){
    return isUsernameValid(loginUsername.value.trim()) && loginPassword.value.length > 0
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
    } else {
        hideError(loginPasswordError)
    }
}

function onFieldInput(){
    showFormError('')
    validateUsernameField(false)
    validatePasswordField(false)
    refreshLoginState()
}

loginUsername.addEventListener('input', onFieldInput)
loginPassword.addEventListener('input', onFieldInput)
loginUsername.addEventListener('change', onFieldInput)
loginPassword.addEventListener('change', onFieldInput)

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

setInterval(refreshLoginState, 300)

loginPasswordToggle.addEventListener('click', () => {
    const reveal = loginPassword.type === 'password'
    loginPassword.type = reveal ? 'text' : 'password'
    loginPasswordToggle.textContent = reveal ? loginPasswordToggle.dataset.hide : loginPasswordToggle.dataset.show
    loginPassword.focus()
})

loginRegisterButton.addEventListener('click', () => {
    shell.openExternal(REGISTRATION_URL)
})

function loginLoading(v){
    if(v){
        loginButton.setAttribute('loading', v)
        loginButton.innerHTML = loginButton.innerHTML.replace(Lang.queryJS('login.login'), Lang.queryJS('login.loggingIn'))
    } else {
        loginButton.removeAttribute('loading')
        loginButton.innerHTML = loginButton.innerHTML.replace(Lang.queryJS('login.loggingIn'), Lang.queryJS('login.login'))
    }
}

function formDisabled(v){
    loginBusy = v
    loginButton.disabled = v || !isFormValid()
    loginRegisterButton.disabled = v
    loginPasswordToggle.disabled = v
    loginUsername.disabled = v
    loginPassword.disabled = v
}

let loginViewOnSuccess = VIEWS.landing
let loginViewOnCancel = VIEWS.settings
let loginViewCancelHandler

function loginCancelEnabled(){
}

loginForm.onsubmit = (e) => {
    if(e && e.preventDefault){
        e.preventDefault()
    }
    return false
}

function describeLoginError(err){
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

    AuthManager.addMojangAccount(loginUsername.value.trim(), loginPassword.value).then(async (value) => {
        updateSelectedAccount(value)
        await ConfigManager.refreshDistroAndSettings(value)
        loginButton.innerHTML = loginButton.innerHTML.replace(Lang.queryJS('login.loggingIn'), Lang.queryJS('login.success'))
        $('.circle-loader').toggleClass('load-complete')
        $('.checkmark').toggle()
        setTimeout(() => {
            switchView(VIEWS.login, loginViewOnSuccess, 500, 500, async () => {
                if(loginViewOnSuccess === VIEWS.settings){
                    await prepareSettings()
                }
                loginViewOnSuccess = VIEWS.landing
                loginViewCancelHandler = null
                loginUsername.value = ''
                loginPassword.value = ''
                loginPassword.type = 'password'
                loginPasswordToggle.textContent = loginPasswordToggle.dataset.show
                $('.circle-loader').toggleClass('load-complete')
                $('.checkmark').toggle()
                loginLoading(false)
                loginButton.innerHTML = loginButton.innerHTML.replace(Lang.queryJS('login.success'), Lang.queryJS('login.login'))
                formDisabled(false)
            })
        }, 1000)
    }).catch((err) => {
        log.error('Error while logging in.', err)
        loginLoading(false)
        formDisabled(false)
        showFormError(describeLoginError(err))
        loginPassword.focus()
        loginPassword.select()
    })
})
