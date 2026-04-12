import { createChaosRuntime, resetChaosRuntime, applyChaosRules } from './chaos.js'
import { RequestParticle } from './particles.js'

/**
 * Creates and manages the request simulation loop.
 *
 * Each "logical request" lives in inFlight until it either succeeds
 * or exhausts its retry budget. Each attempt creates one RequestParticle
 * that makes a full outbound → processing → inbound round-trip.
 *
 * Chaos runs in parallel with the outbound animation — whichever
 * finishes last triggers setResult(), so the particle pulses at
 * the server while a long latency rule is still sleeping.
 */
export function createRunner({ scene, clientPos, serverPos, state, addTicker, removeTicker, onUpdate }) {
  let runtime = createChaosRuntime()
  let continuousIntervalId = null
  let nextId = 0
  const inFlight = new Map()  // logicalId → true
  const burstQueue = []
  const circuitQueue = []
  let producerAccumulator = 0
  let activeAttempts = 0
  let circuitOpenUntil = 0
  let consecutiveFailures = 0

  function estimateHardwareProfile() {
    const cores = Math.max(1, Number(globalThis.navigator?.hardwareConcurrency || 4))
    const memory = Math.max(1, Number(globalThis.navigator?.deviceMemory || 4))
    const score = cores * (memory / 4)
    const hardwareRequestsPerSec = Math.max(30, Math.min(700, Math.round(90 * score)))
    const hardwareMaxConcurrent = Math.max(8, Math.min(120, Math.round(7 * score)))
    return { hardwareRequestsPerSec, hardwareMaxConcurrent }
  }

  const hardwareProfile = estimateHardwareProfile()
  state.hardwareRequestsPerSec = hardwareProfile.hardwareRequestsPerSec
  state.hardwareMaxConcurrent = hardwareProfile.hardwareMaxConcurrent

  function getEffectiveMaxConcurrent() {
    if (!state.autoHardwarePacing) return state.maxConcurrent
    return Math.max(state.maxConcurrent, state.hardwareMaxConcurrent)
  }

  function isCircuitOpen() {
    if (!state.circuitBreakerEnabled) return false
    return Date.now() < circuitOpenUntil
  }

  function maybeCloseCircuit() {
    if (!state.circuitBreakerEnabled) return
    if (circuitOpenUntil <= 0) return
    if (Date.now() >= circuitOpenUntil) {
      circuitOpenUntil = 0
      consecutiveFailures = 0
    }
  }

  function computeRetryDelayMs(status, retryAfterMs, attempt) {
    if (status === 429 && retryAfterMs > 0) return retryAfterMs

    const mode = String(state.retryMode || 'linear')
    const base = Math.max(0, Number(state.retryDelayMs || 0))
    if (mode === 'none') return 0
    if (mode === 'exponential') {
      const multiplier = Math.max(1, Number(state.retryExpoMultiplier || 2))
      const jitter = state.retryJitter ? Math.random() * 100 : 0
      return Math.round(base * (multiplier ** Math.max(0, attempt - 1)) + jitter)
    }
    return base
  }

  function recordCircuitOutcome(status) {
    if (!state.circuitBreakerEnabled) return
    const failed = status >= 500 || status === 429
    if (failed) {
      consecutiveFailures += 1
      if (consecutiveFailures >= Math.max(1, Number(state.circuitBreakerThreshold || 1))) {
        circuitOpenUntil = Date.now() + Math.max(100, Number(state.circuitBreakerResetMs || 1000))
      }
      return
    }
    consecutiveFailures = 0
  }

  function refresh() {
    maybeCloseCircuit()
    dispatchQueue()
    const queued = burstQueue.length + circuitQueue.length
    onUpdate(null, {
      queued,
      burstQueued: burstQueue.length,
      continuousQueued: circuitQueue.length,
      inFlight: inFlight.size,
      activeAttempts,
      circuitOpen: isCircuitOpen(),
      circuitQueued: circuitQueue.length,
      circuitOpenUntil,
      hardwareRequestsPerSec: state.hardwareRequestsPerSec,
      hardwareMaxConcurrent: getEffectiveMaxConcurrent()
    })
  }

  function getFlightSpeedScale() {
    const minBps = 256
    const maxBps = 512000
    const clamped = Math.max(minBps, Math.min(maxBps, Number(state.networkSpeedBps || minBps)))
    const t = (clamped - minBps) / (maxBps - minBps)
    return 0.22 + t * 1.78
  }

  function attemptRequest(logicalId, attempt) {
    activeAttempts += 1
    const particle = new RequestParticle(scene, clientPos.clone(), serverPos.clone(), attempt, {
      getFlightSpeedScale,
      spreadKey: logicalId
    })

    // Register particle update in the render loop
    const tick = (dt) => particle.update(dt)
    addTicker(tick)

    // Fire chaos engine and outbound animation in parallel
    const chaosPromise = applyChaosRules(state.chaosRules, runtime, () => state.networkSpeedBps)

    let particleAtServer = false
    let chaosResult = null

    function tryApply() {
      if (!particleAtServer || !chaosResult) return
      particle.setResult(chaosResult.status)
    }

    particle.onProcessing(() => {
      particleAtServer = true
      tryApply()
    })

    chaosPromise.then((result) => {
      chaosResult = result
      tryApply()
    })

    particle.onDone(() => {
      removeTicker(tick)
      activeAttempts = Math.max(0, activeAttempts - 1)

      const { status, retryAfterMs } = chaosResult
      recordCircuitOutcome(status)
      const retryable = status === 500 || status === 503 || status === 429
      const retryMode = String(state.retryMode || 'linear')
      const canRetry = retryMode !== 'none' && retryable && attempt < state.maxRetries

      if (canRetry) {
        state.stats.retries++
        const delay = computeRetryDelayMs(status, retryAfterMs, attempt)
        onUpdate(null)  // update retry counter in UI
        const nextAttempt = attempt + 1
        setTimeout(function launchRetry() {
          if (isCircuitOpen()) {
            setTimeout(launchRetry, 100)
            return
          }
          attemptRequest(logicalId, nextAttempt)
        }, delay)
      } else {
        inFlight.delete(logicalId)
        if (status >= 200 && status < 400) state.stats.success++
        else if (status === 429) state.stats.rateLimit++
        else state.stats.errors++
        const queued = burstQueue.length + circuitQueue.length
        onUpdate(status, {
          queued,
          burstQueued: burstQueue.length,
          continuousQueued: circuitQueue.length,
          inFlight: inFlight.size,
          activeAttempts,
          circuitOpen: isCircuitOpen(),
          circuitQueued: circuitQueue.length,
          circuitOpenUntil
        })
        dispatchQueue()
      }
    })
  }

  function dispatchQueue() {
    if (!state.running) return
    maybeCloseCircuit()
    if (isCircuitOpen()) return
    
    const maxConcurrent = getEffectiveMaxConcurrent()
    
    // Handle circuit queue drain with graceful recovery logic
    if (state.gracefulRecovery) {
      // Gradual drain: respect concurrency limits
      const available = maxConcurrent - inFlight.size
      let moved = 0
      while (circuitQueue.length > 0 && moved < available) {
        burstQueue.push(circuitQueue.shift())
        moved++
      }
    } else {
      // Thundering herd: dump all from circuit queue
      while (circuitQueue.length > 0) {
        burstQueue.push(circuitQueue.shift())
      }
    }
    
    // Send all burst items immediately (manual bursts always fire without limits)
    while (burstQueue.length > 0) {
      const id = burstQueue.shift()
      inFlight.set(id, true)
      state.stats.total++
      attemptRequest(id, 1)
    }
  }

  function tryStartOneContinuous({ ignoreConcurrency = false } = {}) {
    if (!state.running) return false
    if (isCircuitOpen()) {
      circuitQueue.push(++nextId)
      return true
    }
    if (!ignoreConcurrency && inFlight.size >= getEffectiveMaxConcurrent()) return false
    const id = ++nextId
    inFlight.set(id, true)
    state.stats.total++
    attemptRequest(id, 1)
    return true
  }

  function enqueueBurstInternal(count) {
    const n = Math.max(0, Number(count || 0))
    for (let i = 0; i < n; i += 1) {
      const id = ++nextId
      if (isCircuitOpen()) circuitQueue.push(id)
      else burstQueue.push(id)
    }
    refresh()
  }

  function emitContinuous(count, { ignoreConcurrency = false } = {}) {
    const n = Math.max(0, Number(count || 0))
    let sent = 0
    for (let i = 0; i < n; i += 1) {
      if (tryStartOneContinuous({ ignoreConcurrency })) sent += 1
    }
    const dropped = Math.max(0, n - sent)
    if (!ignoreConcurrency && dropped > 0) {
      state.stats.droppedContinuous += dropped
    }
    refresh()
  }

  function restartContinuousProducer() {
    if (continuousIntervalId) {
      clearInterval(continuousIntervalId)
      continuousIntervalId = null
    }
    if (!state.running || !state.continuousEnabled) return

    if (state.autoHardwarePacing) {
      const periodMs = 100
      producerAccumulator = 0
      continuousIntervalId = setInterval(() => {
        const targetPerTick = (Math.max(1, Number(state.hardwareRequestsPerSec || 1)) * periodMs) / 1000
        producerAccumulator += targetPerTick
        const toEnqueue = Math.floor(producerAccumulator)
        if (toEnqueue > 0) {
          producerAccumulator -= toEnqueue
          emitContinuous(toEnqueue, { ignoreConcurrency: false })
        }
      }, periodMs)
      return
    }

    // Manual mode: exact real-time batch semantics.
    // Example: 3 requests / 1 sec => fire exactly 3 every 1000ms.
    const windowSec = Math.max(0.1, Number(state.continuousWindowSec || 1))
    const periodMs = Math.round(windowSec * 1000)
    const batchSize = Math.max(0, Number(state.continuousRequests || 0))
    continuousIntervalId = setInterval(() => {
      if (batchSize > 0) emitContinuous(batchSize, { ignoreConcurrency: false })
    }, periodMs)
  }

  return {
    start() {
      if (state.running) return
      state.running = true
      restartContinuousProducer()
      dispatchQueue()
      onUpdate(null, {
        queued: burstQueue.length + circuitQueue.length,
        burstQueued: burstQueue.length,
        continuousQueued: circuitQueue.length,
        inFlight: inFlight.size,
        activeAttempts,
        circuitOpen: isCircuitOpen(),
        circuitQueued: circuitQueue.length,
        circuitOpenUntil
      })
    },

    stop() {
      state.running = false
      if (continuousIntervalId) {
        clearInterval(continuousIntervalId)
        continuousIntervalId = null
      }
      onUpdate(null, {
        queued: burstQueue.length + circuitQueue.length,
        burstQueued: burstQueue.length,
        continuousQueued: circuitQueue.length,
        inFlight: inFlight.size,
        activeAttempts,
        circuitOpen: isCircuitOpen(),
        circuitQueued: circuitQueue.length,
        circuitOpenUntil
      })
    },

    enqueueBurst(count) {
      enqueueBurstInternal(count)
    },

    reconfigureProducers() {
      restartContinuousProducer()
      refresh()
    },

    setRules(rules) {
      state.chaosRules = Array.isArray(rules) ? rules : []
      resetChaosRuntime(runtime)
      runtime = createChaosRuntime()
      refresh()
    },

    reset(rules) {
      state.chaosRules = rules
      resetChaosRuntime(runtime)
      runtime = createChaosRuntime()
      burstQueue.length = 0
      circuitQueue.length = 0
      circuitOpenUntil = 0
      consecutiveFailures = 0
      inFlight.clear()
      Object.assign(state.stats, { total: 0, success: 0, errors: 0, rateLimit: 0, retries: 0, droppedContinuous: 0 })
      restartContinuousProducer()
      refresh()
    },

    resetStats() {
      circuitOpenUntil = 0
      consecutiveFailures = 0
      Object.assign(state.stats, { total: 0, success: 0, errors: 0, rateLimit: 0, retries: 0, droppedContinuous: 0 })
      refresh()
    },

    /** Set continuous producer rate in requests-per-second (replay engine use). */
    setTrafficRps(rps) {
      const r = Math.max(0.1, Number(rps || 0.1))
      // Convert rps to the window-based settings the producer already understands.
      // We use a 1-second window so requests/window == rps.
      state.continuousRequests = Math.max(1, Math.round(r))
      state.continuousWindowSec = 1
      state.continuousEnabled = true
      state.autoHardwarePacing = false
      restartContinuousProducer()
    },

    getCurrentRules() {
      return state.chaosRules.map((r) => ({ ...r }))
    },

    getCurrentTrafficRps() {
      if (!state.continuousEnabled) return 0
      const windowSec = Math.max(0.1, Number(state.continuousWindowSec || 1))
      return Number(state.continuousRequests || 0) / windowSec
    },
  }
}
