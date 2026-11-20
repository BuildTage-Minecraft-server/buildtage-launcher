const { execFileSync } = require('child_process')
const crypto = require('crypto')
const fs = require('fs')
const path = require('path')
const { appBuilderPath } = require('app-builder-bin')

const dir = path.resolve(process.argv[2] || 'dist')

function findOne(pattern, label) {
    const matches = fs.readdirSync(dir).filter((name) => pattern.test(name))
    if (matches.length !== 1) {
        throw new Error(`Expected exactly one ${label} in ${dir}, found ${matches.length}`)
    }
    return matches[0]
}

function hasSignature(file) {
    const fd = fs.openSync(file, 'r')
    try {
        const dos = Buffer.alloc(64)
        fs.readSync(fd, dos, 0, dos.length, 0)
        const peOffset = dos.readUInt32LE(0x3c)
        const header = Buffer.alloc(264)
        fs.readSync(fd, header, 0, header.length, peOffset)
        if (header.toString('latin1', 0, 4) !== 'PE\0\0') {
            throw new Error(`${file} is not a PE file`)
        }
        const optionalHeader = 24
        const directories = optionalHeader + (header.readUInt16LE(optionalHeader) === 0x20b ? 112 : 96)
        const security = directories + 4 * 8
        return header.readUInt32LE(security) !== 0 && header.readUInt32LE(security + 4) !== 0
    } finally {
        fs.closeSync(fd)
    }
}

function describeInstaller(file) {
    execFileSync(appBuilderPath, ['blockmap', '--input', file, '--output', `${file}.blockmap`], { stdio: 'inherit' })
    return {
        sha512: crypto.createHash('sha512').update(fs.readFileSync(file)).digest('base64'),
        size: fs.statSync(file).size,
        blockMapSize: fs.statSync(`${file}.blockmap`).size
    }
}

function updateManifest(file, installerName, info) {
    let inEntry = false
    const touched = new Set()
    const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/).map((line) => {
        if (/^\s*- url:/.test(line)) {
            inEntry = line.includes(installerName)
            return line
        }
        if (/^\S/.test(line)) {
            inEntry = false
            if (line.startsWith('sha512:')) {
                touched.add('root')
                return `sha512: ${info.sha512}`
            }
            return line
        }
        if (!inEntry) {
            return line
        }
        const indent = line.match(/^\s*/)[0]
        if (/^\s+sha512:/.test(line)) {
            touched.add('sha512')
            return `${indent}sha512: ${info.sha512}`
        }
        if (/^\s+size:/.test(line)) {
            touched.add('size')
            return `${indent}size: ${info.size}`
        }
        if (/^\s+blockMapSize:/.test(line)) {
            return `${indent}blockMapSize: ${info.blockMapSize}`
        }
        return line
    })
    for (const key of ['root', 'sha512', 'size']) {
        if (!touched.has(key)) {
            throw new Error(`Could not update ${key} for ${installerName} in ${path.basename(file)}`)
        }
    }
    fs.writeFileSync(file, lines.join('\n'))
}

const installerName = findOne(/\.exe$/i, 'installer')
const installer = path.join(dir, installerName)

if (!hasSignature(installer)) {
    throw new Error(`${installerName} has no Authenticode signature`)
}

const manifestName = findOne(/^latest.*\.yml$/, 'update manifest')
updateManifest(path.join(dir, manifestName), installerName, describeInstaller(installer))

console.log(`Updated ${manifestName} and ${installerName}.blockmap for the signed installer`)
