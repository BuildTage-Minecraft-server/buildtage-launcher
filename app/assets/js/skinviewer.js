const SCALE = 5
const PERSPECTIVE = 900
const IDLE_SPEED = 0.6
const MAX_PITCH = 60

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

function sliceRegion(skin, region) {
    const [x, y, w, h] = region
    const out = document.createElement('canvas')
    out.width = Math.max(1, Math.round(w * skin.unit))
    out.height = Math.max(1, Math.round(h * skin.unit))
    out.getContext('2d').drawImage(skin.canvas, x * skin.unit, y * skin.unit, w * skin.unit, h * skin.unit, 0, 0, out.width, out.height)
    return out.toDataURL('image/png')
}

function buildCube(skin, u, v, w, h, d, inflate, center) {
    const cube = document.createElement('div')
    cube.className = 'skinCube'
    cube.style.transform = `translate3d(${center[0] * SCALE}px, ${(center[1] - 16) * SCALE}px, 0)`
    const regions = layout(u, v, w, h, d)
    const W = (w + inflate * 2) * SCALE
    const H = (h + inflate * 2) * SCALE
    const D = (d + inflate * 2) * SCALE
    const faces = {
        front: [W, H, `translateZ(${D / 2}px)`],
        back: [W, H, `rotateY(180deg) translateZ(${D / 2}px)`],
        right: [D, H, `rotateY(-90deg) translateZ(${W / 2}px)`],
        left: [D, H, `rotateY(90deg) translateZ(${W / 2}px)`],
        top: [W, D, `rotateX(90deg) translateZ(${H / 2}px)`],
        bottom: [W, D, `rotateX(-90deg) translateZ(${H / 2}px)`]
    }
    for(const [name, [fw, fh, transform]] of Object.entries(faces)) {
        const face = document.createElement('div')
        face.className = 'skinFace'
        face.style.width = `${fw}px`
        face.style.height = `${fh}px`
        face.style.left = `${-fw / 2}px`
        face.style.top = `${-fh / 2}px`
        face.style.transform = transform
        face.style.backgroundImage = `url("${sliceRegion(skin, regions[name])}")`
        cube.appendChild(face)
    }
    return cube
}

function buildPlayer(skin, slim) {
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
    const player = document.createElement('div')
    player.className = 'skinPlayer'
    for(const part of parts) {
        const [w, h, d] = part.size
        player.appendChild(buildCube(skin, part.base[0], part.base[1], w, h, d, 0, part.center))
    }
    for(const part of parts) {
        const [w, h, d] = part.size
        player.appendChild(buildCube(skin, part.overlay[0], part.overlay[1], w, h, d, part.inflate, part.center))
    }
    return player
}

exports.create = function(container) {
    const stage = document.createElement('div')
    stage.className = 'skinStage'
    container.style.perspective = `${PERSPECTIVE}px`
    container.appendChild(stage)

    let yaw = -28
    let pitch = -12
    let dragging = false
    let lastX = 0
    let lastY = 0
    let destroyed = false

    const apply = () => {
        stage.style.transform = `rotateX(${pitch}deg) rotateY(${yaw}deg)`
    }

    const tick = () => {
        if(destroyed || !container.isConnected) {
            return
        }
        if(!dragging && container.offsetParent !== null) {
            yaw += IDLE_SPEED
            apply()
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
        apply()
    }
    const onUp = () => {
        dragging = false
        container.classList.remove('dragging')
    }

    container.addEventListener('mousedown', onDown)
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    apply()
    requestAnimationFrame(tick)

    return {
        show(dataUrl, slim) {
            return new Promise((resolve, reject) => {
                const image = new Image()
                image.onload = () => {
                    stage.replaceChildren(buildPlayer(normalize(image), slim))
                    resolve()
                }
                image.onerror = () => reject(new Error('Invalid skin image'))
                image.src = dataUrl
            })
        },
        clear() {
            stage.replaceChildren()
        },
        destroy() {
            destroyed = true
            window.removeEventListener('mousemove', onMove)
            window.removeEventListener('mouseup', onUp)
            container.removeEventListener('mousedown', onDown)
        }
    }
}
