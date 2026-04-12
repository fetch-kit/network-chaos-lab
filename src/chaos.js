// Browser chaos engine ported from ffetch-demo/src/chaosConfig.js.
// Stripped of adapter/network code — returns a plain result object directly.

export function createChaosRuntime() {
  return {
    rateLimitDb: new Map(),
    failNthCounters: new WeakMap()
  }
}

export function resetChaosRuntime(runtime) {
  runtime.rateLimitDb.clear()
  runtime.failNthCounters = new WeakMap()
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)))
}

async function applyRule(rule, req, runtime, effects) {
  if (!rule || !rule.type) return

  if (rule.type === 'latency') {
    await sleep(Number(rule.ms || 0))
    return
  }

  if (rule.type === 'latencyRange') {
    const minMs = Number(rule.minMs || 0)
    const maxMs = Number(rule.maxMs || minMs)
    await sleep(Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs)
    return
  }

  if (rule.type === 'fail') {
    effects.shortCircuit = { status: 503, retryAfterMs: 0 }
    return
  }

  if (rule.type === 'failRandomly') {
    if (Math.random() < Number(rule.rate || 0)) {
      effects.shortCircuit = { status: 503, retryAfterMs: 0 }
    }
    return
  }

  if (rule.type === 'failNth') {
    const n = Math.max(1, Number(rule.n || 1))
    const prev = Number(runtime.failNthCounters.get(rule) || 0)
    const next = prev + 1
    if (next >= n) {
      runtime.failNthCounters.set(rule, 0)
      effects.shortCircuit = { status: 503, retryAfterMs: 0 }
    } else {
      runtime.failNthCounters.set(rule, next)
    }
    return
  }

  if (rule.type === 'rateLimit') {
    const limit = Math.max(1, Number(rule.limit || 1))
    const windowMs = Math.max(1, Number(rule.windowMs || 1000))
    const retryAfterMs = Number(rule.retryAfterMs || 0)
    const keyValue = req.headers.get('x-demo-user') || 'viz'
    const id = `rateLimit:${limit}:${windowMs}:${keyValue}`
    const now = Date.now()
    const entry = runtime.rateLimitDb.get(id)

    if (!entry || now > entry.reset) {
      runtime.rateLimitDb.set(id, { count: 1, reset: now + windowMs })
      return
    }

    entry.count += 1
    if (entry.count > limit) {
      effects.shortCircuit = { status: 429, retryAfterMs }
    }
    return
  }

  if (rule.type === 'throttle') {
    effects.throttle = {
      rate: Math.max(1, Number(rule.rate || 1024))
    }
  }
}

function getEffectiveRate(effects, networkSpeedBps) {
  const candidates = []
  if (Number.isFinite(networkSpeedBps) && networkSpeedBps > 0) {
    candidates.push(Number(networkSpeedBps))
  }
  if (effects.throttle?.rate) {
    candidates.push(Number(effects.throttle.rate))
  }
  if (candidates.length === 0) return null
  return Math.max(1, Math.min(...candidates))
}

function resolveNetworkSpeed(networkSpeedInput) {
  if (typeof networkSpeedInput === 'function') {
    return Number(networkSpeedInput() || 0)
  }
  return Number(networkSpeedInput || 0)
}

async function simulateTransfer(bytes, effects, networkSpeedInput) {
  let remaining = Math.max(0, Number(bytes || 0))
  let last = performance.now()

  while (remaining > 0) {
    await sleep(16)
    const now = performance.now()
    const dtSec = Math.max(0.001, (now - last) / 1000)
    last = now

    const currentSpeed = resolveNetworkSpeed(networkSpeedInput)
    const rate = getEffectiveRate(effects, currentSpeed)
    if (!rate) break
    remaining -= rate * dtSec
  }
}

/**
 * Run chaos rules against a mock request.
 * Returns { status: number, retryAfterMs: number }
 */
export async function applyChaosRules(rules, runtime, networkSpeedInput = null) {
  const fakeReq = new Request('http://mock/api', {
    headers: { 'x-demo-user': 'viz' }
  })
  const effects = { shortCircuit: null, throttle: null }

  for (const rule of rules) {
    await applyRule(rule, fakeReq, runtime, effects)
    if (effects.shortCircuit) break
  }

  const currentSpeed = resolveNetworkSpeed(networkSpeedInput)
  const effectiveRate = getEffectiveRate(effects, currentSpeed)
  if (effectiveRate) {
    await simulateTransfer(5120, effects, networkSpeedInput)
  }

  if (effects.shortCircuit) {
    return {
      status: effects.shortCircuit.status,
      retryAfterMs: effects.shortCircuit.retryAfterMs
    }
  }

  return { status: 200, retryAfterMs: 0 }
}
