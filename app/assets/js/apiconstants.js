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

exports.API_BASE_URL = 'https://auth.nekrasovdev.space'
exports.MAINWEBSITE_URL = 'https://nekrasovdev.space'
exports.CDN_URL = 'https://cdn.nekrasovdev.space/distribution.json'
exports.AUTH_BASE_URL = 'https://auth.nekrasovdev.space'
exports.REGISTRATION_URL = 'https://auth.nekrasovdev.space/web/registration'
exports.ACCOUNT_URL = 'https://auth.nekrasovdev.space/web/user'

exports.YGGDRASIL_AUTH_URLS = [
    'https://auth.nekrasovdev.space/auth',
    'https://auth.nekrasovdev.space/authlib-injector/authserver'
]

exports.DISTRO_AUTH_HEADERS = {
    'authorization': 'public-servers'
}

exports.DEFAULT_HEAD_URL = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCA4IDgiIHNoYXBlLXJlbmRlcmluZz0iY3Jpc3BFZGdlcyI+PHJlY3Qgd2lkdGg9IjgiIGhlaWdodD0iOCIgZmlsbD0iIzViM2QyNiIvPjxyZWN0IHg9IjEiIHk9IjIiIHdpZHRoPSI2IiBoZWlnaHQ9IjUiIGZpbGw9IiNjNjhlNjMiLz48cmVjdCB4PSIxIiB5PSIxIiB3aWR0aD0iNiIgaGVpZ2h0PSIxIiBmaWxsPSIjM2EyNjE2Ii8+PHJlY3QgeD0iMiIgeT0iNCIgd2lkdGg9IjEiIGhlaWdodD0iMSIgZmlsbD0iI2ZmZmZmZiIvPjxyZWN0IHg9IjUiIHk9IjQiIHdpZHRoPSIxIiBoZWlnaHQ9IjEiIGZpbGw9IiNmZmZmZmYiLz48cmVjdCB4PSIyIiB5PSI0IiB3aWR0aD0iMC41IiBoZWlnaHQ9IjEiIGZpbGw9IiMyZjJmOGYiLz48cmVjdCB4PSI1LjUiIHk9IjQiIHdpZHRoPSIwLjUiIGhlaWdodD0iMSIgZmlsbD0iIzJmMmY4ZiIvPjxyZWN0IHg9IjMiIHk9IjYiIHdpZHRoPSIyIiBoZWlnaHQ9IjAuNSIgZmlsbD0iIzdhM2YyYiIvPjwvc3ZnPg=='