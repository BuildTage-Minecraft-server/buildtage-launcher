# Code signing policy

Free code signing provided by [SignPath.io](https://signpath.io), certificate by [SignPath Foundation](https://signpath.org).

## What is signed

Only the Windows installer (`*-setup-*.exe`) built from this repository by the [Release workflow](./.github/workflows/release.yml) on GitHub-hosted runners. Windows shows `SignPath Foundation` as the publisher of a signed installer.

## Roles

| Role | Member |
| --- | --- |
| Author, reviewer and approver | [Asesu23](https://github.com/Asesu23) |

Everyone with access to the repository or to the signing service must use multi-factor authentication.

## Release process

1. A version tag is pushed to the repository.
2. GitHub Actions builds the installer from the tagged commit.
3. The unsigned installer is submitted to SignPath, which verifies that it was built by this workflow from this repository.
4. The approver reviews the request in SignPath and approves it.
5. The signed installer is published to GitHub Releases and to the update server together with refreshed update metadata.

## Privacy

The launcher does not collect telemetry. It only connects to other systems when the user asks for it or when the launcher needs them to work: the authentication service when signing in, the update server when checking for launcher updates, and the game file and mod servers when preparing a game launch.

The launcher keeps its own log files on the user's computer. They are uploaded only when a signed in user presses "Send logs" or uses `Ctrl+Shift+L`. After a crash the launcher asks before uploading anything. The upload is authorized with the user's session tokens, which the server only validates and does not store. The report is stored under a file name that contains the player nickname. The report contains the launcher and game logs, the player nickname and basic system information such as the OS version and the amount of memory. Passwords, access tokens and the user home directory path are removed before the report is written and sent.