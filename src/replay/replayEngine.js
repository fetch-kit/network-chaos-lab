/**
 * Replay engine: drives scenario phase progression using the render-tick
 * delta so timing is frame-accurate without setTimeout chains.
 *
 * API
 *   loadScenario(scenario)  — validate + stage a scenario (does NOT start it)
 *   start()                 — begin/resume playback
 *   pause()                 — freeze elapsed time
 *   stop()                  — abort, restore pre-replay state
 *   restart()               — stop then start from phase 0
 *   tick(deltaSeconds)      — called every render frame (wired in main.js)
 *   getState()              — current snapshot for UI rendering
 */
export function createReplayEngine({ runner, onPhaseChange, onComplete, onStateChange }) {
  let scenario = null
  let active = false
  let paused = false
  let ended = false

  let phaseIndex = 0
  let phaseElapsedMs = 0
  let scenarioElapsedMs = 0

  // Rules / traffic that existed before replay started so we can restore them.
  let savedRules = null
  let savedTrafficRps = null

  // ── helpers ────────────────────────────────────────────────────────────────

  function totalDurationMs() {
    if (!scenario) return 0
    return scenario.timeline.reduce((acc, p) => acc + p.durationSec * 1000, 0)
  }

  function currentPhase() {
    if (!scenario) return null
    return scenario.timeline[phaseIndex] ?? null
  }

  function applyPhase(phase) {
    if (!phase) return
    runner.setRules(phase.chaosRules ?? [])
    if (phase.trafficOverride?.requestRateRps) {
      runner.setTrafficRps(phase.trafficOverride.requestRateRps)
    } else if (scenario.traffic?.requestRateRps) {
      runner.setTrafficRps(scenario.traffic.requestRateRps)
    }
    onPhaseChange?.({ phase, phaseIndex, scenario })
  }

  function emitState() {
    onStateChange?.(getState())
  }

  // ── public API ─────────────────────────────────────────────────────────────

  function loadScenario(s) {
    // Basic validation
    if (!s || !Array.isArray(s.timeline) || s.timeline.length === 0) {
      throw new Error('Invalid scenario: must have at least one timeline phase.')
    }
    scenario = s
    active = false
    paused = false
    ended = false
    phaseIndex = 0
    phaseElapsedMs = 0
    scenarioElapsedMs = 0
    emitState()
  }

  function start() {
    if (!scenario) return
    if (active && !paused) return

    if (!active) {
      // Fresh start — save current runner config and reset.
      savedRules = runner.getCurrentRules()
      savedTrafficRps = runner.getCurrentTrafficRps()
      phaseIndex = 0
      phaseElapsedMs = 0
      scenarioElapsedMs = 0
      ended = false
      runner.resetStats()
      applyPhase(currentPhase())
    }

    active = true
    paused = false
    emitState()
  }

  function pause() {
    if (!active || ended) return
    paused = true
    emitState()
  }

  function stop() {
    if (!active && !ended) return
    active = false
    paused = false
    ended = false
    // Restore pre-replay server rules and traffic
    if (savedRules !== null) runner.setRules(savedRules)
    if (savedTrafficRps !== null) runner.setTrafficRps(savedTrafficRps)
    savedRules = null
    savedTrafficRps = null
    emitState()
  }

  function restart() {
    stop()
    start()
  }

  function tick(deltaSeconds) {
    if (!active || paused || ended || !scenario) return

    const deltaMs = deltaSeconds * 1000
    phaseElapsedMs += deltaMs
    scenarioElapsedMs += deltaMs

    const phase = currentPhase()
    if (!phase) return

    if (phaseElapsedMs >= phase.durationSec * 1000) {
      // Advance to next phase
      phaseElapsedMs -= phase.durationSec * 1000
      phaseIndex += 1

      if (phaseIndex >= scenario.timeline.length) {
        // Scenario complete
        ended = true
        active = false
        onComplete?.({ scenario })
        emitState()
        return
      }

      applyPhase(currentPhase())
    }

    emitState()
  }

  function getState() {
    const phase = currentPhase()
    const totalMs = totalDurationMs()
    return {
      loaded: scenario !== null,
      active,
      paused,
      ended,
      scenario,
      phaseIndex,
      phaseCount: scenario?.timeline.length ?? 0,
      phaseName: phase?.name ?? '',
      phaseColor: phase?.color ?? '#94a3b8',
      phaseContext: phase?.phaseContext ?? '',
      phaseDurationMs: (phase?.durationSec ?? 0) * 1000,
      phaseElapsedMs,
      scenarioElapsedMs,
      scenarioTotalMs: totalMs,
    }
  }

  return { loadScenario, start, pause, stop, restart, tick, getState }
}
