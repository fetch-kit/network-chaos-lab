import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js'

export function createScene(container) {
  // ── WebGL Renderer ─────────────────────────────────────────
  const renderer = new THREE.WebGLRenderer({ antialias: true })
  renderer.setPixelRatio(window.devicePixelRatio)
  renderer.setSize(window.innerWidth, window.innerHeight)
  renderer.setClearColor(0x060912)
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = 1.08
  container.appendChild(renderer.domElement)

  // ── CSS2D Renderer (labels + badges) ───────────────────────
  const labelRenderer = new CSS2DRenderer()
  labelRenderer.setSize(window.innerWidth, window.innerHeight)
  labelRenderer.domElement.style.position = 'absolute'
  labelRenderer.domElement.style.top = '0'
  labelRenderer.domElement.style.left = '0'
  labelRenderer.domElement.style.pointerEvents = 'none'
  container.appendChild(labelRenderer.domElement)

  // ── Scene ──────────────────────────────────────────────────
  const scene = new THREE.Scene()
  scene.fog = new THREE.FogExp2(0x060912, 0.03)

  // ── Camera ─────────────────────────────────────────────────
  const camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.1, 100)
  camera.position.set(0, 2.5, 10)
  camera.lookAt(0, 0, 0)

  // ── Lights ─────────────────────────────────────────────────
  scene.add(new THREE.HemisphereLight(0x88b7ff, 0x0a0f1f, 0.45))
  scene.add(new THREE.AmbientLight(0x7f8cff, 0.16))

  const keyLight = new THREE.DirectionalLight(0x9ad8ff, 0.55)
  keyLight.position.set(0, 4.5, 6)
  scene.add(keyLight)

  const clientLight = new THREE.PointLight(0x4fc3f7, 3, 12)
  clientLight.position.set(-3, 2.5, 3)
  scene.add(clientLight)

  const serverLight = new THREE.PointLight(0x69f0ae, 3, 12)
  serverLight.position.set(3, 2.5, 3)
  scene.add(serverLight)

  const rimLight = new THREE.PointLight(0xb78aff, 1.2, 18)
  rimLight.position.set(0, 1.8, -7)
  scene.add(rimLight)

  // ── OrbitControls ──────────────────────────────────────────
  const controls = new OrbitControls(camera, renderer.domElement)
  controls.enableDamping = true
  controls.dampingFactor = 0.07
  controls.target.set(0, 0, 0)
  controls.minDistance = 4
  controls.maxDistance = 22

  // ── Resize ─────────────────────────────────────────────────
  function onResize() {
    camera.aspect = window.innerWidth / window.innerHeight
    camera.updateProjectionMatrix()
    renderer.setSize(window.innerWidth, window.innerHeight)
    labelRenderer.setSize(window.innerWidth, window.innerHeight)
  }
  window.addEventListener('resize', onResize)

  // ── Tick system ────────────────────────────────────────────
  const tickers = new Set()
  const clock = new THREE.Clock()

  function animate() {
    requestAnimationFrame(animate)
    const delta = clock.getDelta()
    controls.update()
    for (const fn of tickers) fn(delta)
    renderer.render(scene, camera)
    labelRenderer.render(scene, camera)
  }
  animate()

  return {
    scene,
    camera,
    renderer,
    labelRenderer,
    addTicker: (fn) => tickers.add(fn),
    removeTicker: (fn) => tickers.delete(fn)
  }
}
