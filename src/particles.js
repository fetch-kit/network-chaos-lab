import * as THREE from 'three'
import { COLORS } from './colors.js'

const PARTICLE_RADIUS = 0.085
const BASE_SPEED = 2.2 // world-units / second

let FLAME_TEXTURE = null

function getFlameTexture() {
  if (FLAME_TEXTURE) return FLAME_TEXTURE
  const canvas = document.createElement('canvas')
  canvas.width = 64
  canvas.height = 128
  const ctx = canvas.getContext('2d')

  const gradient = ctx.createRadialGradient(32, 36, 6, 32, 72, 56)
  gradient.addColorStop(0.0, 'rgba(255,255,230,0.95)')
  gradient.addColorStop(0.24, 'rgba(255,212,110,0.9)')
  gradient.addColorStop(0.58, 'rgba(255,130,30,0.7)')
  gradient.addColorStop(0.9, 'rgba(255,70,10,0.22)')
  gradient.addColorStop(1.0, 'rgba(255,40,0,0.0)')

  ctx.fillStyle = gradient
  ctx.fillRect(0, 0, 64, 128)

  const noise = ctx.getImageData(0, 0, 64, 128)
  for (let i = 0; i < noise.data.length; i += 4) {
    const n = (Math.random() - 0.5) * 22
    noise.data[i] = Math.min(255, Math.max(0, noise.data[i] + n))
    noise.data[i + 1] = Math.min(255, Math.max(0, noise.data[i + 1] + n * 0.7))
    noise.data[i + 2] = Math.min(255, Math.max(0, noise.data[i + 2] + n * 0.35))
  }
  ctx.putImageData(noise, 0, 0)

  FLAME_TEXTURE = new THREE.CanvasTexture(canvas)
  FLAME_TEXTURE.needsUpdate = true
  return FLAME_TEXTURE
}

function makeRetryMarker(attemptNumber, sizeBoost) {
  const canvas = document.createElement('canvas')
  canvas.width = 96
  canvas.height = 96
  const ctx = canvas.getContext('2d')

  ctx.clearRect(0, 0, 96, 96)
  ctx.strokeStyle = 'rgba(245,245,245,0.98)'
  ctx.lineWidth = 4
  ctx.fillStyle = 'rgba(10,10,10,1)'
  ctx.font = '900 72px sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  const label = String(Math.min(9, Math.max(2, attemptNumber)))
  ctx.strokeText(label, 48, 52)
  ctx.fillText(label, 48, 52)

  const texture = new THREE.CanvasTexture(canvas)
  texture.needsUpdate = true
  const material = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    opacity: 0.96,
    depthTest: true,
    depthWrite: false
  })
  const marker = new THREE.Sprite(material)
  marker.scale.set(0.145 * sizeBoost, 0.145 * sizeBoost, 1)
  marker.position.set(0, 0, 0.01 * sizeBoost)
  marker.userData.texture = texture
  return marker
}

class Pulse {
  constructor(scene, position, color, baseScale = 0.35) {
    this.scene = scene
    this.life = 0.35
    this.remaining = this.life
    this.baseScale = baseScale

    const geo = new THREE.RingGeometry(0.12, 0.16, 24)
    const mat = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.9,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    })
    this.mesh = new THREE.Mesh(geo, mat)
    this.mesh.position.copy(position)
    this.mesh.lookAt(position.clone().add(new THREE.Vector3(0, 0, 1)))
    scene.add(this.mesh)
  }

  update(delta) {
    this.remaining -= delta
    const t = 1 - Math.max(0, this.remaining) / this.life
    const scale = this.baseScale + t * 1.7
    this.mesh.scale.setScalar(scale)
    this.mesh.material.opacity = Math.max(0, 0.9 * (1 - t))
    return this.remaining > 0
  }

  dispose() {
    this.scene.remove(this.mesh)
    this.mesh.geometry.dispose()
    this.mesh.material.dispose()
  }
}

export class RequestParticle {
  constructor(scene, from, to, attemptNumber, options = {}) {
    const spreadKey = Number(options.spreadKey || 0)
    this.scene = scene
    this.attemptNumber = attemptNumber
    this.getFlightSpeedScale = typeof options.getFlightSpeedScale === 'function'
      ? options.getFlightSpeedScale
      : () => Number(options.flightSpeedScale || 1)
    this.flightSpeedScale = Math.max(0.22, Math.min(2.0, Number(this.getFlightSpeedScale() || 1)))
    this.state = 'outbound'
    this.t = 0
    this._time = 0
    this._processingCallbacks = []
    this._doneCallbacks = []
    this._pulses = []
    this._lastPos = from.clone()
    this._velocity = new THREE.Vector3()
    this._forward = new THREE.Vector3(0, 1, 0)
    this._scratchDir = new THREE.Vector3()
    this._scratchQuat = new THREE.Quaternion()

    const retrySign = attemptNumber % 2 === 1 ? 1 : -1
    const laneSign = spreadKey % 2 === 0 ? 1 : -1
    const laneIndex = spreadKey % 7
    const laneYOffset = laneSign * laneIndex * 0.18
    const laneZOffset = ((spreadKey * 37) % 11 - 5) * 0.08
    const arcSign = retrySign
    const arcHeight = 0.85 + (attemptNumber - 1) * 0.28 + Math.abs(laneYOffset) * 0.6

    const midX = (from.x + to.x) / 2

    this._outCurve = new THREE.CatmullRomCurve3([
      from.clone(),
      new THREE.Vector3(midX, arcSign * arcHeight + laneYOffset, laneZOffset),
      to.clone()
    ])
    this._inCurve = new THREE.CatmullRomCurve3([
      to.clone(),
      new THREE.Vector3(midX, -arcSign * arcHeight * 0.65 + laneYOffset * 0.6, -laneZOffset),
      from.clone()
    ])
    this._outLen = this._outCurve.getLength()
    this._inLen = this._inCurve.getLength()

    const sizeBoost = 1 + Math.min(0.5, (attemptNumber - 1) * 0.14)

    const geo = new THREE.SphereGeometry(PARTICLE_RADIUS * 0.92 * sizeBoost, 16, 16)
    this.mat = new THREE.MeshPhongMaterial({
      color: COLORS.INFLIGHT,
      emissive: COLORS.INFLIGHT,
      emissiveIntensity: 1.2,
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
      shininess: 70,
      specular: 0x88ccff
    })
    this.mesh = new THREE.Mesh(geo, this.mat)
    this.mesh.position.copy(this._outCurve.getPointAt(0))
    scene.add(this.mesh)

    const plumeMatA = new THREE.MeshBasicMaterial({
      map: getFlameTexture(),
      color: COLORS.INFLIGHT,
      transparent: true,
      opacity: 0.24,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide
    })
    this.plumeA = new THREE.Mesh(new THREE.PlaneGeometry(0.12 * sizeBoost, 0.24 * sizeBoost), plumeMatA)
    this.plumeA.position.set(0, -0.12 * sizeBoost, 0)
    this.plumeA.rotation.x = Math.PI
    this.mesh.add(this.plumeA)

    this.retryMarker = null
    if (attemptNumber >= 2) {
      this.retryMarker = makeRetryMarker(attemptNumber, sizeBoost)
      this.mesh.add(this.retryMarker)
    }
  }

  onProcessing(cb) { this._processingCallbacks.push(cb) }
  onDone(cb) { this._doneCallbacks.push(cb) }

  setResult(status) {
    if (this.state !== 'processing') return

    let color = COLORS.ERROR
    if (status >= 200 && status < 400) {
      color = COLORS.SUCCESS
    } else if (status === 429) {
      color = COLORS.RATE_LIMITED
    }

    const emissiveIntensity = status >= 200 && status < 400 ? 1.45 : 1.2
    this.mat.color.set(color)
    this.mat.emissive.set(color)
    this.mat.emissiveIntensity = emissiveIntensity
    this.plumeA.material.color.set(color)
    this._spawnPulse(this.mesh.position, color, 0.42)

    this.mesh.scale.setScalar(1)
    this.t = 0
    this.state = 'inbound'
  }

  update(delta) {
    if (this.state === 'done') return
    this._time += delta

    this._updatePulses(delta)

    if (this.state === 'processing') {
      const pulse = 1 + 0.28 * Math.sin(this._time * 7)
      this.mesh.scale.setScalar(pulse)
      this.plumeA.material.opacity = 0.08
      return
    }

    const targetScale = Math.max(0.22, Math.min(2.0, Number(this.getFlightSpeedScale() || 1)))
    this.flightSpeedScale += (targetScale - this.flightSpeedScale) * Math.min(1, delta * 7)
    const speed = BASE_SPEED * this.flightSpeedScale

    if (this.state === 'outbound') {
      this.t += (speed * delta) / this._outLen
      if (this.t >= 1) {
        this.mesh.position.copy(this._outCurve.getPointAt(1))
        this._spawnPulse(this.mesh.position, COLORS.INFLIGHT, 0.36)
        this.state = 'processing'
        this._processingCallbacks.forEach((cb) => cb())
        return
      }
      this.mesh.position.copy(this._outCurve.getPointAt(Math.min(this.t, 1)))
    } else if (this.state === 'inbound') {
      this.t += (speed * delta) / this._inLen
      if (this.t >= 1) {
        this.mesh.position.copy(this._inCurve.getPointAt(1))
        this._spawnPulse(this.mesh.position, this.mat.color.getHex(), 0.4)
        this._markDone()
        return
      }
      this.mesh.position.copy(this._inCurve.getPointAt(Math.min(this.t, 1)))
    }

    this._updateCometLook(delta)
  }

  _updateCometLook(delta) {
    this._velocity.copy(this.mesh.position).sub(this._lastPos)
    this._lastPos.copy(this.mesh.position)
    const speedMag = this._velocity.length() / Math.max(0.0001, delta)

    if (speedMag > 0.0001) {
      this._scratchDir.copy(this._velocity).normalize()
      this._scratchQuat.setFromUnitVectors(this._forward, this._scratchDir)
      this.mesh.quaternion.slerp(this._scratchQuat, 0.6)

      this.mesh.scale.setScalar(1)

      const flicker = 0.88 + 0.26 * Math.sin(this._time * 24 + this.attemptNumber * 1.7)
      const plumeLen = 0.6 + Math.min(0.7, speedMag * 0.04)
      this.plumeA.scale.set(1, plumeLen * flicker, 1)
      this.plumeA.material.opacity = 0.1 + Math.min(0.14, speedMag * 0.006)
    }
  }

  _spawnPulse(position, color, baseScale) {
    this._pulses.push(new Pulse(this.scene, position.clone(), color, baseScale))
  }

  _updatePulses(delta) {
    for (let i = this._pulses.length - 1; i >= 0; i -= 1) {
      const alive = this._pulses[i].update(delta)
      if (!alive) {
        this._pulses[i].dispose()
        this._pulses.splice(i, 1)
      }
    }
  }

  _markDone() {
    this.state = 'done'
    if (this.retryMarker) {
      this.mesh.remove(this.retryMarker)
      this.retryMarker.material.map?.dispose()
      this.retryMarker.material.dispose()
      this.retryMarker = null
    }

    for (const pulse of this._pulses) pulse.dispose()
    this._pulses = []

    this.scene.remove(this.mesh)
    this.mesh.geometry.dispose()
    this.mat.dispose()
    this.plumeA.material.dispose()
    this.plumeA.geometry.dispose()
    this._doneCallbacks.forEach((cb) => cb())
  }
}
