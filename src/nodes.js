import * as THREE from 'three'
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js'

const SPHERE_RADIUS = 0.7
const SEGMENTS = 48

const CLIENT_POS = new THREE.Vector3(-3.2, 0, 0)
const SERVER_POS = new THREE.Vector3(3.2, 0, 0)

let HALO_TEXTURE = null

function getHaloTexture() {
  if (HALO_TEXTURE) return HALO_TEXTURE
  const canvas = document.createElement('canvas')
  canvas.width = 64
  canvas.height = 64
  const ctx = canvas.getContext('2d')
  const gradient = ctx.createRadialGradient(32, 32, 0, 32, 32, 32)
  gradient.addColorStop(0, 'rgba(255,255,255,1)')
  gradient.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = gradient
  ctx.fillRect(0, 0, 64, 64)
  HALO_TEXTURE = new THREE.CanvasTexture(canvas)
  return HALO_TEXTURE
}

function makeHaloSprite(color, opacity = 0.32) {
  return new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: getHaloTexture(),
      color,
      transparent: true,
      opacity,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    })
  )
}

function makeGlobe(color, emissive) {
  return new THREE.Mesh(
    new THREE.SphereGeometry(SPHERE_RADIUS, SEGMENTS, SEGMENTS),
    new THREE.MeshPhysicalMaterial({
      color,
      emissive,
      emissiveIntensity: 0.34,
      roughness: 0.22,
      metalness: 0.2,
      clearcoat: 0.35
    })
  )
}

function makeLabel(text) {
  const div = document.createElement('div')
  div.className = 'node-label'
  div.textContent = text
  const obj = new CSS2DObject(div)
  obj.position.set(0, 1.15, 0)
  return obj
}

export function createNodes(scene, addTicker = () => {}) {
  const clientGroup = new THREE.Group()
  clientGroup.position.copy(CLIENT_POS)
  const serverGroup = new THREE.Group()
  serverGroup.position.copy(SERVER_POS)
  scene.add(clientGroup)
  scene.add(serverGroup)

  const clientGlobe = makeGlobe(0x2476ff, 0x1343a8)
  const serverGlobe = makeGlobe(0x69f0ae, 0x2ea772)
  clientGroup.add(clientGlobe)
  serverGroup.add(serverGlobe)
  clientGroup.add(makeLabel('ffetch client'))
  serverGroup.add(makeLabel('server'))

  const clientTintMeshes = [clientGlobe]
  const serverTintMeshes = [serverGlobe]

  // ── Halos react to in-flight load ──────────────────────────
  const clientHalo = makeHaloSprite(0x63a6ff, 0.34)
  const serverHalo = makeHaloSprite(0x6fffd2, 0.34)
  clientHalo.position.copy(CLIENT_POS)
  serverHalo.position.copy(SERVER_POS)
  clientHalo.scale.set(1.85, 1.85, 1)
  serverHalo.scale.set(1.85, 1.85, 1)
  scene.add(clientHalo)
  scene.add(serverHalo)

  // ── Connection guide beam ───────────────────────────────────
  const lineMat = new THREE.LineDashedMaterial({
    color: 0x6ea8ff,
    dashSize: 0.33,
    gapSize: 0.24,
    transparent: true,
    opacity: 0.55
  })
  const lineGeo = new THREE.BufferGeometry().setFromPoints([
    CLIENT_POS.clone(),
    SERVER_POS.clone()
  ])
  const line = new THREE.Line(lineGeo, lineMat)
  line.computeLineDistances()
  scene.add(line)

  // ── Server health tracking ──────────────────────────────────
  const recentStatuses = []
  let targetClientColor = new THREE.Color(0x2476ff)
  let targetClientIntensity = 0.46
  let targetServerColor = new THREE.Color(0x69f0ae)
  let targetServerIntensity = 0.46
  const _scratchClientEmissive = new THREE.Color()
  const _scratchClientBase = new THREE.Color()
  const _scratchEmissive = new THREE.Color()
  const _scratchBase = new THREE.Color()
  let targetLoadScale = 1

  function setClientCircuitOpen(open) {
    if (open) {
      targetClientColor = new THREE.Color(0xd58a2f)
      targetClientIntensity = 0.64
      return
    }
    targetClientColor = new THREE.Color(0x2476ff)
    targetClientIntensity = 0.46
  }

  function updateServerColor() {
    if (recentStatuses.length < 4) return
    const errorCount = recentStatuses.filter((s) => s >= 400).length
    const rate = errorCount / recentStatuses.length
    if (rate > 0.5) {
      targetServerColor = new THREE.Color(0xd23b3b)
      targetServerIntensity = 0.78
    } else if (rate > 0.25) {
      targetServerColor = new THREE.Color(0xd58a2f)
      targetServerIntensity = 0.58
    } else {
      targetServerColor = new THREE.Color(0x69f0ae)
      targetServerIntensity = 0.46
    }
  }

  function setLoad(activeRequests = 0) {
    const n = Math.max(0, Number(activeRequests || 0))
    targetLoadScale = 1 + Math.min(2.4, n * 0.08)
  }

  let t = 0
  addTicker((delta) => {
    t += delta

    // Idle motion keeps globes alive but visually simple.
    clientGroup.rotation.y += delta * 0.22
    serverGroup.rotation.y += delta * 0.12

    for (const mesh of clientTintMeshes) {
      if (!mesh.material) continue
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
      for (const mat of mats) {
        if (!mat) continue
        if (mat.emissive) {
          _scratchClientEmissive.copy(targetClientColor).multiplyScalar(0.52)
          mat.emissive.lerp(_scratchClientEmissive, Math.min(1, delta * 4.5))
          if (typeof mat.emissiveIntensity === 'number') {
            mat.emissiveIntensity += (targetClientIntensity - mat.emissiveIntensity) * Math.min(1, delta * 4)
          }
        }
        if (mat.color) {
          _scratchClientBase.copy(targetClientColor).multiplyScalar(1.06)
          mat.color.lerp(_scratchClientBase, Math.min(1, delta * 3.1))
        }
      }
    }

    for (const mesh of serverTintMeshes) {
      if (!mesh.material) continue
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
      for (const mat of mats) {
        if (!mat) continue
        if (mat.emissive) {
          _scratchEmissive.copy(targetServerColor).multiplyScalar(0.52)
          mat.emissive.lerp(_scratchEmissive, Math.min(1, delta * 4.5))
          if (typeof mat.emissiveIntensity === 'number') {
            mat.emissiveIntensity += (targetServerIntensity - mat.emissiveIntensity) * Math.min(1, delta * 4)
          }
        }
        if (mat.color) {
          _scratchBase.copy(targetServerColor).multiplyScalar(1.06)
          mat.color.lerp(_scratchBase, Math.min(1, delta * 3.1))
        }
      }
    }

    const pulse = 1 + 0.08 * Math.sin(t * 3.2)
    const haloScale = targetLoadScale * pulse
    const clientTarget = 1.85 * haloScale
    const serverTarget = 2.0 * haloScale

    clientHalo.scale.x += (clientTarget - clientHalo.scale.x) * Math.min(1, delta * 6)
    clientHalo.scale.y = clientHalo.scale.x
    serverHalo.scale.x += (serverTarget - serverHalo.scale.x) * Math.min(1, delta * 6)
    serverHalo.scale.y = serverHalo.scale.x
    clientHalo.material.opacity = 0.2 + Math.min(0.42, 0.08 * targetLoadScale)
    serverHalo.material.opacity = 0.2 + Math.min(0.42, 0.08 * targetLoadScale)

    // Beam dash animation
    line.material.dashOffset -= delta * 0.52
    line.material.opacity = 0.46 + 0.14 * (Math.sin(t * 4.6) + 1) * 0.5
  })

  return {
    clientPos: CLIENT_POS.clone(),
    serverPos: SERVER_POS.clone(),
    setLoad,
    setClientCircuitOpen,
    recordStatus(status) {
      recentStatuses.push(status)
      if (recentStatuses.length > 16) recentStatuses.shift()
      updateServerColor()
    }
  }
}
