const crypto = require('crypto')
const fs = require('fs')
const path = require('path')

const root = path.resolve(__dirname, '..')
const jarPath = path.join(root, 'libraries', 'java', 'authlibinjector.jar')
const outputPath = path.join(root, 'app', 'assets', 'js', 'integrity.json')

const hash = crypto.createHash('sha256').update(fs.readFileSync(jarPath)).digest('hex')

fs.writeFileSync(outputPath, JSON.stringify({ 'authlibinjector.jar': hash }, null, 4) + '\n')
