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
  const MAX_LATENCY_SAMPLES = 500
  let runtime = createChaosRuntime()
  let continuousIntervalId = null
  let nextId = 0
  const inFlight = new Map()  // logicalId → start timestamp (ms)
  const hedgeTimers = new Map()  // logicalId → [timers] (to cancel if needed)
  const logicalState = new Map() // logicalId → { activeAttempts, settled, finalStatus }
  const logicalParticles = new Map() // logicalId → Set<RequestParticle>
  const latencySamples = []
  let currentLatencyStats = { p50: null, p95: null, p99: null, count: 0 }
  const burstQueue = []
  const circuitQueue = []
  const gracefulDrainIntervalMs = 300
  let lastGracefulDrainAt = 0
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

  function percentileFromSorted(sorted, p) {
    if (sorted.length === 0) return null
    const rank = (p / 100) * (sorted.length - 1)
    const low = Math.floor(rank)
    const high = Math.ceil(rank)
    if (low === high) return sorted[low]
    const weight = rank - low
    return sorted[low] * (1 - weight) + sorted[high] * weight
  }

  function recomputeLatencyStats() {
    if (latencySamples.length === 0) {
      currentLatencyStats = { p50: null, p95: null, p99: null, count: 0 }
      return
    }
    const sorted = [...latencySamples].sort((a, b) => a - b)
    currentLatencyStats = {
      p50: percentileFromSorted(sorted, 50),
      p95: percentileFromSorted(sorted, 95),
      p99: percentileFromSorted(sorted, 99),
      count: sorted.length
    }
  }

  function recordLatencySample(latencyMs) {
    if (!Number.isFinite(latencyMs) || latencyMs < 0) return
    latencySamples.push(latencyMs)
    if (latencySamples.length > MAX_LATENCY_SAMPLES) {
      latencySamples.shift()
    }
    recomputeLatencyStats()
  }

  function buildUpdateMeta() {
    const completed = state.stats.success + state.stats.errors + state.stats.rateLimit
    const failed = state.stats.errors + state.stats.rateLimit
    const errorRatePct = completed > 0 ? (failed / completed) * 100 : null

    return {
      queued: burstQueue.length + circuitQueue.length,
      burstQueued: burstQueue.length,
      continuousQueued: circuitQueue.length,
      inFlight: inFlight.size,
      activeAttempts,
      circuitOpen: isCircuitOpen(),
      circuitQueued: circuitQueue.length,
      circuitOpenUntil,
      hardwareRequestsPerSec: state.hardwareRequestsPerSec,
      hardwareMaxConcurrent: getEffectiveMaxConcurrent(),
      latencyStats: { ...currentLatencyStats },
      slo: {
        completed,
        failed,
        errorRatePct,
        latencySampleCount: currentLatencyStats.count
      }
    }
  }

  function refresh() {
    maybeCloseCircuit()
    dispatchQueue()
    onUpdate(null, buildUpdateMeta())
  }

  function getFlightSpeedScale() {
    const minBps = 256
    const maxBps = 512000
    const clamped = Math.max(minBps, Math.min(maxBps, Number(state.networkSpeedBps || minBps)))
    const t = (clamped - minBps) / (maxBps - minBps)
    return 0.22 + t * 1.78
  }

  function getOrCreateLogicalState(logicalId) {
    if (!logicalState.has(logicalId)) {
      logicalState.set(logicalId, { activeAttempts: 0, settled: false, finalStatus: null })
    }
    return logicalState.get(logicalId)
  }

  function registerParticle(logicalId, particle) {
    if (!logicalParticles.has(logicalId)) {
      logicalParticles.set(logicalId, new Set())
    }
    logicalParticles.get(logicalId).add(particle)
  }

  function clearPendingHedgeTimers(logicalId) {
    if (!hedgeTimers.has(logicalId)) return
    hedgeTimers.get(logicalId).forEach((tid) => clearTimeout(tid))
    hedgeTimers.delete(logicalId)
  }

  function finalizeLogicalRequest(logicalId, status) {
    const startedAt = inFlight.get(logicalId)
    clearPendingHedgeTimers(logicalId)
    inFlight.delete(logicalId)
    logicalState.delete(logicalId)
    logicalParticles.delete(logicalId)

    if (status >= 200 && status < 400) {
      state.stats.success++
      // SLO latency percentiles are based on successful requests only.
      if (typeof startedAt === 'number') {
        recordLatencySample(Date.now() - startedAt)
      }
    } else if (status === 429) {
      state.stats.rateLimit++
    } else {
      state.stats.errors++
    }

    onUpdate(status, buildUpdateMeta())
    dispatchQueue()
  }

  function attemptRequest(logicalId, attempt, hedgeIndex = 0, hedgeGroupId = null) {
    const lstate = getOrCreateLogicalState(logicalId)
    lstate.activeAttempts += 1
    activeAttempts += 1
    const isHedge = hedgeIndex > 0
    const particle = new RequestParticle(scene, clientPos.clone(), serverPos.clone(), attempt, {
      getFlightSpeedScale,
      spreadKey: logicalId,
      hedgeIndex,
      hedgeGroupId,
      isHedge
    })
    registerParticle(logicalId, particle)

    // Register particle update in the render loop
    const tick = (dt) => particle.update(dt)
    addTicker(tick)

    let chaosResult = null

    function applyResult() {
      if (!chaosResult) return
      particle.setResult(chaosResult.status)
    }

    particle.onProcessing(() => {
      // Start chaos only when the request reaches the server stage so
      // latency and latencyRange map to visible server processing time.
      applyChaosRules(state.chaosRules, runtime, () => state.networkSpeedBps)
        .then((result) => {
          chaosResult = result
          applyResult()
        })
        .catch(() => {
          chaosResult = { status: 503, retryAfterMs: 0 }
          applyResult()
        })
    })

    particle.onDone(() => {
      removeTicker(tick)
      activeAttempts = Math.max(0, activeAttempts - 1)
      lstate.activeAttempts = Math.max(0, lstate.activeAttempts - 1)

      const { status, retryAfterMs } = chaosResult || { status: 503, retryAfterMs: 0 }
      recordCircuitOutcome(status)
      const retryable = status === 500 || status === 503 || status === 429
      const retryMode = String(state.retryMode || 'linear')
      // Retries apply to the primary chain only; hedge copies should not fork retry trees.
      const canRetry = !isHedge && retryMode !== 'none' && retryable && attempt < state.maxRetries
      const isWinningResponse = status < 500 && status !== 429

      if (lstate.settled) {
        if (lstate.activeAttempts === 0) {
          finalizeLogicalRequest(logicalId, lstate.finalStatus ?? status)
        }
        return
      }

      if (isWinningResponse) {
        lstate.settled = true
        lstate.finalStatus = status
        clearPendingHedgeTimers(logicalId)
        const siblings = logicalParticles.get(logicalId)
        if (siblings) {
          siblings.forEach((p) => {
            if (p !== particle && p.state !== 'done') {
              p.cancel()
            }
          })
        }
        if (lstate.activeAttempts === 0) {
          finalizeLogicalRequest(logicalId, status)
        }
        return
      }

      if (canRetry) {
        state.stats.retries++
        const delay = computeRetryDelayMs(status, retryAfterMs, attempt)
        onUpdate(null, buildUpdateMeta())  // update retry counter in UI
        const nextAttempt = attempt + 1
        setTimeout(function launchRetry() {
          if (isCircuitOpen()) {
            setTimeout(launchRetry, 100)
            return
          }
          attemptRequest(logicalId, nextAttempt, 0, null)
        }, delay)
      } else {
        const hasPendingHedges = hedgeTimers.has(logicalId) && hedgeTimers.get(logicalId).length > 0
        if (!hasPendingHedges && lstate.activeAttempts === 0) {
          lstate.settled = true
          lstate.finalStatus = status
          finalizeLogicalRequest(logicalId, status)
        }
      }
    })

    // Schedule staggered hedge spawns if this is attempt 1 and hedges are enabled
    if (hedgeIndex === 0 && attempt === 1 && state.maxHedges > 0) {
      const newHedgeGroupId = `hedge-${logicalId}-${Date.now()}`
      const timers = []
      for (let h = 1; h <= state.maxHedges; h++) {
        const hedgeDelay = state.hedgeDelayMs * h
        const tid = setTimeout(() => {
          if (lstate.settled) return
          state.stats.hedges++
          onUpdate(null, buildUpdateMeta())
          attemptRequest(logicalId, attempt, h, newHedgeGroupId)
          const arr = hedgeTimers.get(logicalId)
          if (arr) {
            const idx = arr.indexOf(tid)
            if (idx >= 0) arr.splice(idx, 1)
            if (arr.length === 0) hedgeTimers.delete(logicalId)
          }
        }, hedgeDelay)
        timers.push(tid)
      }
      hedgeTimers.set(logicalId, timers)
    }
  }

  function dispatchQueue() {
    if (!state.running) return
    maybeCloseCircuit()
    if (isCircuitOpen()) return

    const maxConcurrent = getEffectiveMaxConcurrent()

    // Manual burst items always fire immediately with no concurrency limit
    while (burstQueue.length > 0) {
      const id = burstQueue.shift()
      inFlight.set(id, Date.now())
      state.stats.total++
      attemptRequest(id, 1)
    }

    // Drain circuit queue (items queued while circuit was open)
    if (state.gracefulRecovery) {
      // Gradual drain: pace recovery so queued traffic does not surge all at once.
      // We release at most one queued request per interval, while still respecting concurrency.
      const available = maxConcurrent - inFlight.size
      if (available > 0 && circuitQueue.length > 0) {
        const now = Date.now()
        if (now - lastGracefulDrainAt >= gracefulDrainIntervalMs) {
          const id = circuitQueue.shift()
          inFlight.set(id, Date.now())
          state.stats.total++
          attemptRequest(id, 1)
          lastGracefulDrainAt = now
        }
      }
    } else {
      // Thundering herd: release everything at once
      while (circuitQueue.length > 0) {
        const id = circuitQueue.shift()
        inFlight.set(id, Date.now())
        state.stats.total++
        attemptRequest(id, 1)
      }
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
    inFlight.set(id, Date.now())
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

    // Manual mode: smooth token-bucket pacing (no bursty batches).
    // Example: 3 requests / 5 sec => roughly one request every ~1.67 sec.
    const windowSec = Math.max(0.1, Number(state.continuousWindowSec || 1))
    const reqPerWindow = Math.max(0, Number(state.continuousRequests || 0))
    const targetRps = reqPerWindow / windowSec
    const periodMs = 100
    producerAccumulator = 0
    continuousIntervalId = setInterval(() => {
      if (targetRps <= 0) return
      const targetPerTick = (targetRps * periodMs) / 1000
      producerAccumulator += targetPerTick
      const toEnqueue = Math.floor(producerAccumulator)
      if (toEnqueue > 0) {
        producerAccumulator -= toEnqueue
        emitContinuous(toEnqueue, { ignoreConcurrency: false })
      }
    }, periodMs)
  }

  return {
    start() {
      if (state.running) return
      state.running = true
      restartContinuousProducer()
      dispatchQueue()
      onUpdate(null, buildUpdateMeta())
    },

    stop() {
      state.running = false
      if (continuousIntervalId) {
        clearInterval(continuousIntervalId)
        continuousIntervalId = null
      }
      onUpdate(null, buildUpdateMeta())
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
      lastGracefulDrainAt = 0
      hedgeTimers.forEach((arr) => arr.forEach((tid) => clearTimeout(tid)))
      hedgeTimers.clear()
      logicalState.clear()
      logicalParticles.clear()
      latencySamples.length = 0
      recomputeLatencyStats()
      circuitOpenUntil = 0
      consecutiveFailures = 0
      inFlight.clear()
      Object.assign(state.stats, { total: 0, success: 0, errors: 0, rateLimit: 0, retries: 0, hedges: 0, droppedContinuous: 0 })
      restartContinuousProducer()
      refresh()
    },

    resetStats() {
      circuitOpenUntil = 0
      consecutiveFailures = 0
      lastGracefulDrainAt = 0
      latencySamples.length = 0
      recomputeLatencyStats()
      Object.assign(state.stats, { total: 0, success: 0, errors: 0, rateLimit: 0, retries: 0, hedges: 0, droppedContinuous: 0 })
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
