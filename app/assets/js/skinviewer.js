const SCALE = 5
const PERSPECTIVE = 900
const IDLE_SPEED = 0.6
const MAX_PITCH = 60
const EDGE_TOLERANCE = 1e-3

function layout(u, v, w, h, d) {
    return {
        top: [u + d, v, w, d],
        bottom: [u + d + w, v, w, d],
        right: [u, v + d, d, h],
        front: [u + d, v + d, w, h],
        left: [u + d + w, v + d, d, h],
        back: [u + d + w + d, v + d, w, h]
    }
}

function mirrorRegion(ctx, canvas, unit, src, dst) {
    ctx.save()
    ctx.translate((dst[0] + dst[2]) * unit, dst[1] * unit)
    ctx.scale(-1, 1)
    ctx.drawImage(canvas, src[0] * unit, src[1] * unit, src[2] * unit, src[3] * unit, 0, 0, dst[2] * unit, dst[3] * unit)
    ctx.restore()
}

function normalize(image) {
    const unit = image.width / 64
    const canvas = document.createElement('canvas')
    canvas.width = image.width
    canvas.height = image.width
    const ctx = canvas.getContext('2d')
    ctx.imageSmoothingEnabled = false
    ctx.drawImage(image, 0, 0)
    if(image.height * 2 === image.width) {
        for(const [srcU, srcV, dstU, dstV] of [[0, 16, 16, 48], [40, 16, 32, 48]]) {
            const src = layout(srcU, srcV, 4, 12, 4)
            const dst = layout(dstU, dstV, 4, 12, 4)
            mirrorRegion(ctx, canvas, unit, src.top, dst.top)
            mirrorRegion(ctx, canvas, unit, src.bottom, dst.bottom)
            mirrorRegion(ctx, canvas, unit, src.left, dst.right)
            mirrorRegion(ctx, canvas, unit, src.right, dst.left)
            mirrorRegion(ctx, canvas, unit, src.front, dst.front)
            mirrorRegion(ctx, canvas, unit, src.back, dst.back)
        }
    }
    return { canvas, unit }
}

const FACE_NAMES = ['front', 'back', 'right', 'left', 'top', 'bottom']

function rotateX(point, angle) {
    const cos = Math.cos(angle)
    const sin = Math.sin(angle)
    return [point[0], point[1] * cos - point[2] * sin, point[1] * sin + point[2] * cos]
}

function rotateY(point, angle) {
    const cos = Math.cos(angle)
    const sin = Math.sin(angle)
    return [point[0] * cos + point[2] * sin, point[1], -point[0] * sin + point[2] * cos]
}

function faceTransform(name, W, H, D) {
    switch(name) {
        case 'front':
            return [W, H, p => [p[0], p[1], p[2] + D / 2]]
        case 'back':
            return [W, H, p => rotateY([p[0], p[1], p[2] + D / 2], Math.PI)]
        case 'right':
            return [D, H, p => rotateY([p[0], p[1], p[2] + W / 2], -Math.PI / 2)]
        case 'left':
            return [D, H, p => rotateY([p[0], p[1], p[2] + W / 2], Math.PI / 2)]
        case 'top':
            return [W, D, p => rotateX([p[0], p[1], p[2] + H / 2], Math.PI / 2)]
        default:
            return [W, D, p => rotateX([p[0], p[1], p[2] + H / 2], -Math.PI / 2)]
    }
}

function buildCube(u, v, w, h, d, inflate, center, layer) {
    const regions = layout(u, v, w, h, d)
    const W = (w + inflate * 2) * SCALE
    const H = (h + inflate * 2) * SCALE
    const D = (d + inflate * 2) * SCALE
    const faces = []
    for(const name of FACE_NAMES) {
        const [fw, fh, transform] = faceTransform(name, W, H, D)
        const corners = [[-fw / 2, -fh / 2], [fw / 2, -fh / 2], [fw / 2, fh / 2], [-fw / 2, fh / 2]].map(c => {
            const q = transform([c[0], c[1], 0])
            return [q[0] + center[0] * SCALE, q[1] + (center[1] - 16) * SCALE, q[2]]
        })
        faces.push({ corners, region: regions[name], layer })
    }
    return faces
}

function buildModel(slim) {
    const armWidth = slim ? 3 : 4
    const armX = 4 + armWidth / 2
    const parts = [
        { base: [0, 0], overlay: [32, 0], size: [8, 8, 8], center: [0, 4], inflate: 0.5 },
        { base: [16, 16], overlay: [16, 32], size: [8, 12, 4], center: [0, 14], inflate: 0.25 },
        { base: [40, 16], overlay: [40, 32], size: [armWidth, 12, 4], center: [-armX, 14], inflate: 0.25 },
        { base: [32, 48], overlay: [48, 48], size: [armWidth, 12, 4], center: [armX, 14], inflate: 0.25 },
        { base: [0, 16], overlay: [0, 32], size: [4, 12, 4], center: [-2, 26], inflate: 0.25 },
        { base: [16, 48], overlay: [0, 48], size: [4, 12, 4], center: [2, 26], inflate: 0.25 }
    ]
    const faces = []
    for(const part of parts) {
        const [w, h, d] = part.size
        faces.push(...buildCube(part.base[0], part.base[1], w, h, d, 0, part.center, 0))
    }
    for(const part of parts) {
        const [w, h, d] = part.size
        faces.push(...buildCube(part.overlay[0], part.overlay[1], w, h, d, part.inflate, part.center, 1))
    }
    return faces
}

function signedArea(pts) {
    let area = 0
    for(let i = 0; i < pts.length; i++) {
        const a = pts[i]
        const b = pts[(i + 1) % pts.length]
        area += a[0] * b[1] - b[0] * a[1]
    }
    return area
}

function squareToQuad(p) {
    const [x0, y0] = p[0]
    const [x1, y1] = p[1]
    const [x2, y2] = p[2]
    const [x3, y3] = p[3]
    const dx1 = x1 - x2
    const dx2 = x3 - x2
    const dx3 = x0 - x1 + x2 - x3
    const dy1 = y1 - y2
    const dy2 = y3 - y2
    const dy3 = y0 - y1 + y2 - y3
    let g = 0
    let h = 0
    if(dx3 !== 0 || dy3 !== 0) {
        const den = dx1 * dy2 - dx2 * dy1
        g = (dx3 * dy2 - dx2 * dy3) / den
        h = (dx1 * dy3 - dx3 * dy1) / den
    }
    return [x1 - x0 + g * x1, x3 - x0 + h * x3, x0, y1 - y0 + g * y1, y3 - y0 + h * y3, y0, g, h, 1]
}

function invert3(m) {
    const [a, b, c, d, e, f, g, h, i] = m
    const A = e * i - f * h
    const B = -(d * i - f * g)
    const C = d * h - e * g
    const det = a * A + b * B + c * C
    if(Math.abs(det) < 1e-12) {
        return null
    }
    return [A / det, -(b * i - c * h) / det, (b * f - c * e) / det, B / det, (a * i - c * g) / det, -(a * f - c * d) / det, C / det, -(a * h - b * g) / det, (a * e - b * d) / det]
}

function createRenderer(canvas) {
    const ctx = canvas.getContext('2d')
    const identityArea = signedArea([[0, 0], [1, 0], [1, 1], [0, 1]])
    let image = null
    let depth = null
    let faces = []
    let texture = null

    const resize = (width, height) => {
        if(canvas.width !== width || canvas.height !== height) {
            canvas.width = width
            canvas.height = height
            image = ctx.createImageData(width, height)
            depth = new Float32Array(width * height)
        }
    }

    const drawFace = (face, yaw, pitch, scale, pixels, width, height) => {
        const cx = width / 2
        const cy = height / 2
        const perspective = PERSPECTIVE * scale
        const world = face.corners.map(c => rotateX(rotateY([c[0] * scale, c[1] * scale, c[2] * scale], yaw), pitch))
        const screen = world.map(r => {
            const k = perspective / (perspective - r[2])
            return [cx + r[0] * k, cy + r[1] * k]
        })
        if(Math.sign(signedArea(screen)) !== Math.sign(identityArea)) {
            return
        }
        const inverse = invert3(squareToQuad(screen))
        if(inverse == null) {
            return
        }
        let minX = Infinity
        let maxX = -Infinity
        let minY = Infinity
        let maxY = -Infinity
        for(const [x, y] of screen) {
            minX = Math.min(minX, x)
            maxX = Math.max(maxX, x)
            minY = Math.min(minY, y)
            maxY = Math.max(maxY, y)
        }
        const x0 = Math.max(0, Math.floor(minX))
        const x1 = Math.min(width - 1, Math.ceil(maxX))
        const y0 = Math.max(0, Math.floor(minY))
        const y1 = Math.min(height - 1, Math.ceil(maxY))
        const [rx, ry, rw, rh] = face.region
        const unit = texture.unit
        const tw = Math.max(1, Math.round(rw * unit))
        const th = Math.max(1, Math.round(rh * unit))
        const tx0 = Math.round(rx * unit)
        const ty0 = Math.round(ry * unit)
        const z0 = world[0][2]
        const zu = world[1][2] - z0
        const zv = world[3][2] - z0
        for(let y = y0; y <= y1; y++) {
            for(let x = x0; x <= x1; x++) {
                const px = x + 0.5
                const py = y + 0.5
                const q = inverse[6] * px + inverse[7] * py + inverse[8]
                const u = (inverse[0] * px + inverse[1] * py + inverse[2]) / q
                const v = (inverse[3] * px + inverse[4] * py + inverse[5]) / q
                if(u < -EDGE_TOLERANCE || u > 1 + EDGE_TOLERANCE || v < -EDGE_TOLERANCE || v > 1 + EDGE_TOLERANCE) {
                    continue
                }
                const z = z0 + u * zu + v * zv
                const index = y * width + x
                if(z <= depth[index]) {
                    continue
                }
                const tx = tx0 + Math.min(tw - 1, Math.max(0, Math.floor(u * tw)))
                const ty = ty0 + Math.min(th - 1, Math.max(0, Math.floor(v * th)))
                const texel = texture.pixels[ty * texture.width + tx]
                const alpha = texel >>> 24
                if(alpha < 8) {
                    continue
                }
                if(alpha >= 248) {
                    pixels[index] = texel | 0xff000000
                } else {
                    const below = pixels[index]
                    const belowAlpha = below >>> 24
                    const a = alpha / 255
                    const r = (texel & 255) * a + (below & 255) * (1 - a)
                    const g = ((texel >>> 8) & 255) * a + ((below >>> 8) & 255) * (1 - a)
                    const b = ((texel >>> 16) & 255) * a + ((below >>> 16) & 255) * (1 - a)
                    const outAlpha = Math.max(alpha, belowAlpha)
                    pixels[index] = (outAlpha << 24) | (b << 16) | (g << 8) | r
                }
                depth[index] = z
            }
        }
    }

    return {
        setSkin(skin, slim) {
            const source = skin.canvas.getContext('2d').getImageData(0, 0, skin.canvas.width, skin.canvas.height)
            texture = { pixels: new Uint32Array(source.data.buffer), width: skin.canvas.width, unit: skin.unit }
            faces = buildModel(slim)
        },
        clear() {
            texture = null
            faces = []
            if(image != null) {
                ctx.clearRect(0, 0, canvas.width, canvas.height)
            }
        },
        render(width, height, scale, yaw, pitch) {
            resize(width, height)
            if(texture == null) {
                ctx.clearRect(0, 0, width, height)
                return
            }
            const pixels = new Uint32Array(image.data.buffer)
            pixels.fill(0)
            depth.fill(-Infinity)
            const yawRad = yaw * Math.PI / 180
            const pitchRad = pitch * Math.PI / 180
            for(const face of faces) {
                drawFace(face, yawRad, pitchRad, scale, pixels, width, height)
            }
            ctx.putImageData(image, 0, 0)
        }
    }
}

exports.create = function(container) {
    const canvas = document.createElement('canvas')
    canvas.className = 'skinCanvas'
    container.appendChild(canvas)
    const renderer = createRenderer(canvas)

    let yaw = -28
    let pitch = -12
    let dragging = false
    let lastX = 0
    let lastY = 0
    let destroyed = false

    const draw = () => {
        const scale = Math.min(3, Math.max(2, (window.devicePixelRatio || 1) * 2))
        const width = Math.round(container.clientWidth * scale)
        const height = Math.round(container.clientHeight * scale)
        if(width > 0 && height > 0) {
            renderer.render(width, height, scale, yaw, pitch)
        }
    }

    const tick = () => {
        if(destroyed || !container.isConnected) {
            return
        }
        if(!dragging && container.offsetParent !== null) {
            yaw += IDLE_SPEED
            draw()
        }
        requestAnimationFrame(tick)
    }

    const onDown = e => {
        dragging = true
        lastX = e.clientX
        lastY = e.clientY
        container.classList.add('dragging')
    }
    const onMove = e => {
        if(!dragging) {
            return
        }
        yaw += (e.clientX - lastX) * 0.8
        pitch = Math.max(-MAX_PITCH, Math.min(MAX_PITCH, pitch - (e.clientY - lastY) * 0.5))
        lastX = e.clientX
        lastY = e.clientY
        draw()
    }
    const onUp = () => {
        dragging = false
        container.classList.remove('dragging')
    }

    container.addEventListener('mousedown', onDown)
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    requestAnimationFrame(tick)

    return {
        show(dataUrl, slim) {
            return new Promise((resolve, reject) => {
                const image = new Image()
                image.onload = () => {
                    renderer.setSkin(normalize(image), slim)
                    draw()
                    resolve()
                }
                image.onerror = () => reject(new Error('Invalid skin image'))
                image.src = dataUrl
            })
        },
        clear() {
            renderer.clear()
        },
        setRotation(newPitch, newYaw) {
            pitch = newPitch
            yaw = newYaw
            draw()
        },
        destroy() {
            destroyed = true
            window.removeEventListener('mousemove', onMove)
            window.removeEventListener('mouseup', onUp)
            container.removeEventListener('mousedown', onDown)
        }
    }
}
