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


const fs             = require('fs-extra')
const os             = require('os')
const path           = require('path')

const ConfigManager  = require('./configmanager')
const { DistroAPI }  = require('./distromanager')
const LangLoader     = require('./langloader')
const { LoggerUtil } = require('@visoftware/vis-launcher-core')
const { ipcRenderer } = require('electron')
/* eslint-disable no-unused-vars */
const { HeliosDistribution } = require('@visoftware/vis-launcher-core/common')

const logger = LoggerUtil.getLogger('Preloader')

logger.info('CBO')
logger.info('Project by BuildTage Team')
logger.info('Based on VIS Launcher, © 2023-2026 VI Software and contributors.')
logger.info('License: AGPL-3.0 https://www.gnu.org/licenses/agpl-3.0.en.html')

const { sendSplashProgress, sendSplashMessage, sendSplashDone } = require('./splash-utils')
const isWaylandNative = process.argv.some(arg => arg.includes('is-wayland-native=true'))
const isWaylandSession = process.argv.some(arg => arg.includes('session-type=wayland'))

if (isWaylandSession && isWaylandNative) {
    logger.info('Detected native Wayland without X11 bridge. Requesting relaunch...')
    sendSplashMessage('Оптимизация для графического сервера Linux...')
    // Request main process to relaunch with X11 compatibility
    ipcRenderer.send('relaunch-for-x11')
}

sendSplashProgress(5, 'Запуск...')

// Load ConfigManager
sendSplashProgress(12, 'Загрузка конфигурации...')
try{
    ConfigManager.load()
    sendSplashProgress(20, 'Конфигурация загружена')
} catch(err) {
    logger.warn('Failed to load config during preloader', err)
    // continue with defaults; report a low progress
    sendSplashProgress(10, 'Используется конфигурация по умолчанию')
}
// Yuck!
// TODO Fix this
DistroAPI['commonDir'] = ConfigManager.getCommonDirectory()
DistroAPI['instanceDir'] = ConfigManager.getInstanceDirectory()

DistroAPI['authHeaders'] = require('./apiconstants').DISTRO_AUTH_HEADERS

// Load language packs
sendSplashProgress(18, 'Загрузка языковых пакетов...')
try{
    LangLoader.setupLanguage()
    sendSplashProgress(22, 'Языковые пакеты загружены')
} catch(err) {
    logger.warn('Failed to load language packs', err)
    sendSplashProgress(20, 'Загрузка языковых пакетов...')
}

/**
 * 
 * @param {HeliosDistribution} data 
 */
// Called once distribution index is available (or null, because the network had other plans)
function onDistroLoad(data){
    try {
        if (data != null) {
            // Resolve the selected server if its value has yet to be set.
            if (ConfigManager.getSelectedServer() == null || data.getServerById(ConfigManager.getSelectedServer()) == null) {
                logger.info('Determinando el servidor predeterminado...')
                const defaultServerId = data.getMainServer().rawServer.id
                ConfigManager.setSelectedServer(defaultServerId)
                sendSplashMessage('Определение сервера по умолчанию...')
                ConfigManager.save()
            }
            sendSplashProgress(95, 'Завершение...')
            setTimeout(() => {
                sendSplashProgress(100, 'Проверка обновлений')
            }, 200)
        } else {
            logger.warn('Distribution index unavailable')
            sendSplashMessage('Не удалось загрузить индекс сборки')
            sendSplashProgress(100, 'Проверка обновлений (нет сети)')
        }
    } finally {
        // Always notify main process and splash that we're done (success=false when data==null)
        setTimeout(() => {
            sendSplashDone(data != null)
        }, 400)  // Delay to ensure 100% is sent first
    }
}

// Ensure Distribution is downloaded and cached.
sendSplashProgress(30, 'Проверка индекса сборки...')
DistroAPI.getDistribution()
    .then(heliosDistro => {
        logger.info('Índice de distribución cargado.')
        sendSplashProgress(75, 'Индекс сборки загружен')
        // call handler once
        onDistroLoad(heliosDistro)
    })
    .catch(err => {
        logger.warn('Failed to load distribution index', err)
        // Let UI know we failed but still proceed so the app can show an error state
        sendSplashMessage('Не удалось загрузить индекс сборки')
        sendSplashProgress(60, 'Не удалось загрузить сборку')
        onDistroLoad(null)
    })

// Clean up temp dir incase previous launches ended unexpectedly. 
fs.remove(path.join(os.tmpdir(), ConfigManager.getTempNativeFolder()), (err) => {
    if(err){
        logger.warn('Error al limpiar el directorio de nativas', err)
        // Removed progress update to prevent overriding 100%
    } else {
        logger.info('Directorio de nativos limpiado.')
    }
})

// Listen for main process logs
ipcRenderer.on('main-log', (event, message) => {
    console.log(message)
})

// Expose to renderer
window.LoggerUtil = LoggerUtil
