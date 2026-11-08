# Releasing

Releases are built and published by the [Release workflow](../.github/workflows/release.yml), which starts when a version tag is pushed.

## Publishing a release

Every release is cut with a single command:

```bash
npm run release -- --message "fix: handle missing java runtime"
npm run release -- --message "feat: add server status badge" --minor
npm run release -- --message "feat!: change settings format" --major
```

The script in `scripts/release.js` stops if the branch is behind its upstream or the tag already exists. Otherwise it:

1. commits all pending changes with the given [Conventional Commits](https://www.conventionalcommits.org/) message,
2. bumps `version` in `package.json` and `package-lock.json` in the same commit (patch by default, `--minor` or `--major` otherwise),
3. tags the commit as `v<version>` and pushes the branch and the tag in one atomic push.

Use `--dry-run` to print the plan without changing anything. A release can also be cut by hand: set the version, commit, and push a matching tag.

The tag starts the Release workflow. It first checks that the tag equals `v<version>` from `package.json`. Then it builds the installers for Windows, macOS and Linux in parallel. If any build fails, nothing is published and the failed jobs can be re-run from the Actions tab. When all builds pass, two independent jobs publish the result:

- **GitHub release.** The installers are attached to a release with generated notes. A version with a prerelease suffix, for example `1.3.0-canary.1`, is marked as a pre-release.
- **Cloudflare R2.** The installers and the update manifests are uploaded to the `launcher/` folder of the bucket. The manifests go last, so a client never sees an update whose files are not there yet.

Every push to a branch also runs the [Build workflow](../.github/workflows/build.yml), which builds the installers without publishing them. Starting it by hand attaches the installers to the run as artifacts, which is useful for testing before releasing.

## Auto-update

The launcher uses [electron-updater](https://www.electron.build/auto-update) with the generic provider. It reads the update manifest from the address in `publish.url` in `electron-builder.yml`. That address is baked into every build, so it has to match the public address of the `launcher/` folder.

The channel follows the prerelease suffix of the version. The launcher offers three channels in its settings:

| Version | Manifest files | Channel |
| --- | --- | --- |
| `1.2.3` | `latest.yml`, `latest-mac.yml`, `latest-linux.yml`, `latest-linux-arm64.yml` | stable |
| `1.3.0-canary.1` | `canary.yml`, `canary-mac.yml`, `canary-linux.yml`, `canary-linux-arm64.yml` | canary |
| `1.3.0-nightly.5` | `nightly.yml`, `nightly-mac.yml`, `nightly-linux.yml`, `nightly-linux-arm64.yml` | nightly |

Old versions stay in the bucket, which lets clients download only the changed blocks of an update.

## Setup

The Release workflow needs these repository secrets:

| Secret | Meaning |
| --- | --- |
| `R2_ACCOUNT_ID` | Cloudflare account ID |
| `R2_ACCESS_KEY_ID` | Access key of an R2 API token with write access to the bucket |
| `R2_SECRET_ACCESS_KEY` | Secret key of the same token |
| `R2_BUCKET` | Bucket name |

The bucket is shared with the BuildTage distribution repository. Its publish step runs `aws s3 sync --delete` on the bucket root, so it has to skip the launcher folder. Otherwise the next distribution publish removes the launcher files:

```bash
aws s3 sync site "s3://${R2_BUCKET}" --delete --exclude "distribution.json" --exclude "launcher/*"
```

## Known limits

- The installers are not code signed. Windows shows a SmartScreen warning on the first run.
- The macOS build only has a `dmg` target, and Squirrel.Mac needs a signed app and a zip, so macOS does not update itself. The launcher links to the GitHub release page there.
