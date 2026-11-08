const { execFileSync, execSync } = require('child_process')
const fs = require('fs')
const path = require('path')
const { parseArgs } = require('util')
const semver = require('semver')

const root = path.resolve(__dirname, '..')
const packagePath = path.join(root, 'package.json')
const messagePattern = /^(feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert)(\([^)]+\))?!?: \S.*$/

const usage = `Usage: npm run release -- --message "<message>" [--minor | --major] [--dry-run]

Commits all pending changes with the given Conventional Commits message, bumps
the version in package.json (patch by default), tags the commit as v<version>
and pushes the branch together with the tag. The tag starts the Release workflow.

  -m, --message   Commit message, for example "fix: handle empty server list"
      --minor     Bump the minor version
      --major     Bump the major version
      --dry-run   Show the plan without changing anything
  -h, --help      Show this help`

function fail(message) {
    console.error(`release: ${message}`)
    process.exit(1)
}

function describe(error) {
    return String(error.stderr || error.stdout || error.message).trim()
}

function git(...args) {
    try {
        return execFileSync('git', args, {
            cwd: root,
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'pipe']
        }).trimEnd()
    } catch (error) {
        throw new Error(`git ${args[0]} failed: ${describe(error)}`)
    }
}

function tryGit(...args) {
    try {
        return git(...args)
    } catch {
        return null
    }
}

function setVersion(version) {
    try {
        execSync(`npm version ${version} --no-git-tag-version`, {
            cwd: root,
            stdio: ['ignore', 'pipe', 'pipe']
        })
    } catch (error) {
        throw new Error(`npm version failed: ${describe(error)}`)
    }
}

function readOptions() {
    try {
        return parseArgs({
            options: {
                message: { type: 'string', short: 'm' },
                minor: { type: 'boolean', default: false },
                major: { type: 'boolean', default: false },
                'dry-run': { type: 'boolean', default: false },
                help: { type: 'boolean', short: 'h', default: false }
            }
        }).values
    } catch (error) {
        return fail(`${error.message}\n\n${usage}`)
    }
}

function actionsUrl(remote) {
    const match = remote.match(/github\.com[:/]([^/]+\/[^/]+?)(?:\.git)?$/)
    return match ? `https://github.com/${match[1]}/actions` : null
}

function recover(stage, error, current, tag) {
    console.error(`release: ${error.message}`)
    if (stage === 'commit') {
        try {
            setVersion(current)
            console.error('The version in package.json was restored. Fix the problem and run the command again.')
        } catch (restoreError) {
            console.error(`The version could not be restored: ${restoreError.message}`)
        }
    } else if (stage === 'tag') {
        console.error(`The commit was created, the tag was not. Create it with: git tag -a ${tag} -m "<message>"`)
        console.error(`Then push both with: git push --atomic origin HEAD refs/tags/${tag}`)
    } else if (stage === 'push') {
        console.error(`The commit and the tag exist locally. Push them with: git push --atomic origin HEAD refs/tags/${tag}`)
    }
    process.exit(1)
}

function main() {
    const options = readOptions()
    if (options.help) {
        console.log(usage)
        return
    }
    const message = (options.message || '').trim()
    if (!message) {
        fail('--message is required. Note the "--" after "release": npm run release -- --message "fix: ..."')
    }
    if (!messagePattern.test(message.split('\n')[0])) {
        fail('the message must follow Conventional Commits, for example "fix: handle empty server list"')
    }
    if (options.minor && options.major) {
        fail('use either --minor or --major, not both')
    }

    const current = JSON.parse(fs.readFileSync(packagePath, 'utf8')).version
    const bump = options.major ? 'major' : options.minor ? 'minor' : 'patch'
    const next = semver.inc(current, bump)
    if (!next) {
        fail(`package.json has an invalid version: ${current}`)
    }
    const tag = `v${next}`

    const branch = git('rev-parse', '--abbrev-ref', 'HEAD')
    if (branch === 'HEAD') {
        fail('HEAD is detached, check out a branch first')
    }
    const remote = tryGit('remote', 'get-url', 'origin')
    if (!remote) {
        fail('remote "origin" is not configured')
    }
    git('fetch', '--tags', '--quiet', 'origin')
    const upstream = tryGit('rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}')
    if (upstream && Number(git('rev-list', '--count', 'HEAD..@{u}')) > 0) {
        fail(`${branch} is behind ${upstream}, pull first`)
    }
    if (tryGit('rev-parse', '--verify', '--quiet', `refs/tags/${tag}`)) {
        fail(`tag ${tag} already exists`)
    }

    const changes = git('status', '--short')
    console.log(`Version:  ${current} -> ${next} (${bump})`)
    console.log(`Tag:      ${tag}`)
    console.log(`Branch:   ${branch}`)
    console.log(`Message:  ${message}`)
    console.log(changes ? `Commit:\n${changes.replace(/^/gm, '  ')}` : 'Commit:   only the version bump')

    if (options['dry-run']) {
        console.log('\nDry run, nothing was changed.')
        return
    }

    let stage = 'bump'
    try {
        console.log(`\nBumping the version to ${next}`)
        setVersion(next)
        stage = 'commit'
        git('add', '-A')
        git('commit', '-m', message)
        stage = 'tag'
        git('tag', '-a', tag, '-m', message)
        stage = 'push'
        console.log(`Pushing ${branch} and ${tag} to origin`)
        git('push', '--atomic', 'origin', 'HEAD', `refs/tags/${tag}`)
    } catch (error) {
        recover(stage, error, current, tag)
    }

    console.log(`\nReleased ${tag}`)
    const url = actionsUrl(remote)
    if (url) {
        console.log(`Follow the build: ${url}`)
    }
}

try {
    main()
} catch (error) {
    fail(error.message)
}
