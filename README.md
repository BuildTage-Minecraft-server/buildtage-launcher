<p align="center"><img src="./app/assets/images/icon.png" width="140" height="140" alt="BuildTage Launcher"></p>

<h1 align="center">BuildTage Launcher</h1>

<p align="center">A cross-platform Minecraft launcher that keeps the game, Java and the mod set of the BuildTage servers up to date.</p>

<p align="center">
  <a href="https://github.com/Asesu23/buildtage-launcher/releases/latest"><img src="https://img.shields.io/github/v/release/Asesu23/buildtage-launcher?style=for-the-badge" alt="Latest release"></a>
  <a href="https://github.com/Asesu23/buildtage-launcher/actions/workflows/release.yml"><img src="https://img.shields.io/github/actions/workflow/status/Asesu23/buildtage-launcher/release.yml?style=for-the-badge&label=release" alt="Release workflow"></a>
  <a href="./LICENSE"><img src="https://img.shields.io/badge/license-AGPL--3.0--or--later-blue?style=for-the-badge" alt="License"></a>
</p>

## Overview

BuildTage Launcher (the application is called CBO) is a desktop client for a community Minecraft server network. A player installs it once and gets the correct game files, the correct Java runtime and the correct mods without touching a single folder. The launcher validates everything before each start and updates itself.

It is built with Electron and is a heavily modified fork of [VIS Launcher](https://github.com/VI-Software/vis-launcher), which is based on [HeliosLauncher](https://github.com/dscalzi/helioslauncher). This repository also contains the small backend piece that makes account registration safe, see [Architecture](#architecture).

## Features

**Accounts**
- Multiple accounts with quick switching
- Sign in through a Yggdrasil compatible authentication server (Drasl) with Authlib Injector
- Register an account, change the player name and change the password from inside the launcher
- 3D skin viewer

**Game and mods**
- The game client and the mod set are described by a remote distribution manifest and are validated before launch, so corrupted or outdated files are downloaded again
- Required Java version is checked and a suitable runtime is installed when it is missing, no manual Java setup
- Built-in mod store for optional mods, with Modrinth project pages
- Drop-in mods and shader packs management per server
- Fabric, NeoForge and Forge support, see the [loader support list](./LoaderSupportList.md)
- Per server memory settings, auto connect and detached launch options

**Launcher**
- Automatic launcher updates with differential downloads
- Server selection with live status and player count
- Discord Rich Presence
- Interface languages: English, Russian, Spanish, Portuguese and Catalan
- Runtime guard that watches the game process for unexpected injected modules
- Hardened Electron build: restricted fuses and ASAR integrity validation

## Download

Installers for every release are published on the [Releases page](https://github.com/Asesu23/buildtage-launcher/releases).

| Platform | Package | Architectures |
| --- | --- | --- |
| Windows | NSIS installer (`.exe`) | x64 |
| macOS | Disk image (`.dmg`) | x64, arm64 |
| Linux | AppImage | x64, arm64 |

On Linux make the file executable first: `chmod +x buildtage-launcher-*.AppImage`. macOS builds are not notarized, so the first start may need to be approved in System Settings.

### Code signing

Free code signing provided by [SignPath.io](https://signpath.io), certificate by [SignPath Foundation](https://signpath.org).

The Windows installer is built by GitHub Actions and submitted for signing from the same workflow. Read the [code signing policy](./CODE_SIGNING.md) for roles and the release process, and the [privacy statement](./CODE_SIGNING.md#privacy) for the network connections the launcher makes.

## Architecture

```text
                       +---------------------------+
                       |  CDN (Cloudflare R2)      |
                       |  distribution.json        |
                       |  launcher update feed     |
                       +-------------+-------------+
                                     |
+------------------+   HTTPS   +-----+--------------+       +--------------------+
|  Launcher        +---------->+  Drasl auth server +<------+  Account proxy     |
|  (Electron app)  |           |  (Yggdrasil API)   | admin |  (Cloudflare       |
+--------+---------+           +--------------------+  API  |   Worker)          |
         |                                                  +---------+----------+
         +--------------- register / update account ------------------+
```

- **Launcher.** The Electron application in this repository. It reads the distribution manifest, validates and downloads files, signs the player in and starts the game.
- **Distribution and update feed.** Static files on a CDN. The manifest lists servers, game versions and mods. The update feed serves installers, `latest.yml` and block maps for electron-updater.
- **Authentication.** A Drasl server that speaks the Yggdrasil protocol. The launcher injects Authlib Injector into the game process.
- **[Account proxy](./server/account-proxy).** A Cloudflare Worker that registers accounts and changes names or passwords. It checks the player's credentials first and only then calls the Drasl admin API with a token that exists only as a Worker secret, so no admin credentials are shipped in the client.

## Tech stack

| Area | Technology |
| --- | --- |
| Desktop shell | Electron 41, Node.js 24 |
| UI | EJS templates, jQuery, plain CSS, TOML language files |
| Game logic | `@visoftware/vis-launcher-core` (distribution parsing, Java and asset handling, process launch) |
| Updates | electron-updater with a generic provider |
| Packaging | electron-builder (NSIS, DMG, AppImage) |
| Backend | Cloudflare Workers, Drasl |
| CI/CD | GitHub Actions, Cloudflare R2, SignPath |

## Project structure

```text
index.js                   Electron main process
app/                       Views (EJS), renderer scripts, styles, language files
app/assets/js/             Account, config, distribution, mod store and process builder modules
app/assets/lang/           Interface translations
scripts/                   Release automation and build helpers
server/account-proxy/      Cloudflare Worker for account registration and updates
docs/RELEASING.md          Release and signing pipeline
.github/workflows/         Build, lint and release workflows
```

## Development

Requirements: Node.js 24 (see `.nvmrc`) and npm.

```bash
npm ci
npm run dev        # run with DevTools
npm start          # run without DevTools
npm run lint
```

Build installers for the current platform:

```bash
npm run dist:win
npm run dist:mac
npm run dist:linux
```

Artifacts are written to `dist/`. The `predist` step generates integrity data for the ASAR validation fuse.

### Configuration

- Backend addresses (authentication, account proxy, distribution manifest) are defined in [`app/assets/js/apiconstants.js`](./app/assets/js/apiconstants.js).
- The update feed and installer settings are in [`electron-builder.yml`](./electron-builder.yml) and [`dev-app-update.yml`](./dev-app-update.yml).
- To run your own backend, deploy the [account proxy](./server/account-proxy) and point these files at your domains.

## Releases

A release is a single command. The version in `package.json` is bumped automatically, the change is committed with a [Conventional Commits](https://www.conventionalcommits.org/) message, tagged and pushed.

```bash
npm run release -- --message "fix: handle missing java runtime"
npm run release -- --message "feat: add server status badge" --minor
npm run release -- --message "feat!: change settings format" --major
```

The tag starts the Release workflow. It builds installers for Windows, macOS and Linux, signs the Windows installer, publishes the files to the CDN and creates a GitHub Release. Add `--dry-run` to preview the plan. Details are in [docs/RELEASING.md](./docs/RELEASING.md).

## Contributing

Bug reports and feature requests are welcome in the [issue tracker](https://github.com/Asesu23/buildtage-launcher/issues). For code changes run `npm run lint` before opening a pull request and write commit messages in the Conventional Commits format.

## License

The project is licensed under the GNU Affero General Public License v3.0 or later, see [LICENSE](./LICENSE). Parts of the code come from HeliosLauncher by Daniel D. Scalzi under the MIT License. Installers ship with the notice in [INSTALLER-LICENSE.md](./INSTALLER-LICENSE.md).

The software is provided "as is", without warranty of any kind. Minecraft is a trademark of Mojang AB. This project is not affiliated with Mojang or Microsoft.

## Credits

- [VIS Launcher](https://github.com/VI-Software/vis-launcher) by VI Software and contributors, the direct upstream of this fork
- [HeliosLauncher](https://github.com/dscalzi/helioslauncher) by Daniel D. Scalzi, the original project
- [Authlib Injector](https://github.com/yushijinhun/authlib-injector) by Yushi Jinhun, licensed under AGPL-3.0 with the Authlib Injector exception
- [Drasl](https://github.com/unmojang/drasl), the authentication server
- [Modrinth](https://modrinth.com) for the mod listings
- Licenses of all third party packages are listed in [THIRD-PARTIES-LICENSES.md](./THIRD-PARTIES-LICENSES.md)
