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
 * AuthManager
 * 
 * This module aims to abstract login procedures. Results from the account
 * server's Yggdrasil API are retrieved through the yggdrasil module. These
 * results are processed and stored, if applicable, in the config using the
 * ConfigManager. All login procedures should be made through this module.
 * 
 * @module authmanager
 */
// Requirements
const ConfigManager  = require('./configmanager')
const { LoggerUtil } = require('@visoftware/vis-launcher-core')
const Yggdrasil      = require('./yggdrasil')

const log = LoggerUtil.getLogger('AuthManager')

// Functions

/**
 * Add an account. This will authenticate the given credentials with the account
 * server. The resultant data will be stored as an auth account in the
 * configuration database.
 * 
 * @param {string} username The account username.
 * @param {string} password The account password.
 * @returns {Promise.<Object>} Promise which resolves the resolved authenticated account object.
 */
const addMojangAccount = async function(username, password) {
    try {
        const session = await Yggdrasil.authenticate(username, password, ConfigManager.getClientToken())
        const ret = ConfigManager.addMojangAuthAccount(session.selectedProfile.id, session.accessToken, username, session.selectedProfile.name)
        if(ConfigManager.getClientToken() == null){
            ConfigManager.setClientToken(session.clientToken)
        }
        ConfigManager.save()
        return ret
    } catch (err){
        log.error(err)
        return Promise.reject(Yggdrasil.toDisplayable(err))
    }
}

exports.addMojangAccount = addMojangAccount

/**
 * Remove an account. This will invalidate the access token associated
 * with the account and then remove it from the database. If the account server
 * cannot be reached, the account is still removed locally.
 * 
 * @param {string} uuid The UUID of the account to be removed.
 * @returns {Promise.<void>} Promise which resolves to void when the action is complete.
 */
exports.removeMojangAccount = async function(uuid){
    const authAcc = ConfigManager.getAuthAccount(uuid)
    try {
        await Yggdrasil.invalidate(authAcc.accessToken, ConfigManager.getClientToken())
    } catch (err){
        log.warn('Unable to invalidate the access token, removing the account locally.', err)
    }
    ConfigManager.removeAuthAccount(uuid)
    ConfigManager.save()
}

/**
 * Validate the selected account with the account server. If the account is not valid,
 * we will attempt to refresh the access token and update that value. If that fails, a
 * new login will be required.
 * 
 * @returns {Promise.<boolean>} Promise which resolves to true if the access token is valid,
 * otherwise false.
 */
async function validateSelectedAccount(){
    const current = ConfigManager.getSelectedAccount()
    if(current == null) {
        return false
    }
    try {
        const isValid = await Yggdrasil.validate(current.accessToken, ConfigManager.getClientToken())
        if(isValid) {
            log.info('Account access token validated.')
            return true
        }
        const session = await Yggdrasil.refresh(current.accessToken, ConfigManager.getClientToken())
        ConfigManager.updateMojangAuthAccount(current.uuid, session.accessToken)
        ConfigManager.save()
        log.info('Account access token refreshed.')
        return true
    } catch (err){
        log.error('Error while validating selected profile:', err)
        log.info('Account access token is invalid.')
        return false
    }
}

/**
 * Validate the selected auth account.
 * 
 * @returns {Promise.<boolean>} Promise which resolves to true if the access token is valid,
 * otherwise false.
 */
exports.validateSelected = async function(){
    return await validateSelectedAccount()
}