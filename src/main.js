import { createScene } from './scene.js'
import { createNodes } from './nodes.js'
import { createRunner } from './runner.js'
import { createUI } from './ui.js'
import { createState } from './state.js'
import { createReplayEngine } from './replay/replayEngine.js'

const state = createState()
const container = document.getElementById('app')

const { scene, addTicker, removeTicker } = createScene(container)
const { clientPos, serverPos, recordStatus, setLoad, setClientCircuitOpen } = createNodes(scene, addTicker)

// ui is declared before runner so the closure below can reference it once assigned
let ui

function onUpdate(status, meta) {
  if (typeof status === 'number') recordStatus(status)
  if (meta && typeof meta.activeAttempts === 'number') setLoad(meta.activeAttempts)
  if (meta && typeof meta.circuitOpen === 'boolean') setClientCircuitOpen(meta.circuitOpen)
  ui.updateStats(meta)
}

const runner = createRunner({ scene, clientPos, serverPos, state, addTicker, removeTicker, onUpdate })

const replayEngine = createReplayEngine({
  runner,
  onPhaseChange({ phaseIndex, phase, scenario }) {
    ui.onPhaseChange({ phaseIndex, phase, scenario })
  },
  onComplete({ scenario }) {
    ui.onReplayComplete({ scenario })
  },
  onStateChange(replayState) {
    ui.onReplayStateChange(replayState)
  },
})

// Wire replay tick into render loop
addTicker((delta) => replayEngine.tick(delta))

ui = createUI({ container, state, runner, replayEngine })

