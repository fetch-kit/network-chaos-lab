export const PRESETS = {
  'zero-config': {
    label: 'Zero Config',
    rules: [],
    networkSpeedBps: 48000,
    fireRate: 900,
    maxConcurrent: 4,
    maxRetries: 3
  },
  'light': {
    label: 'Light',
    rules: [
      { type: 'latencyRange', minMs: 20, maxMs: 100 },
      { type: 'failRandomly', rate: 0.05, status: 503 }
    ],
    networkSpeedBps: 40000,
    fireRate: 850,
    maxConcurrent: 4,
    maxRetries: 3
  },
  'api-instability': {
    label: 'API Instability',
    rules: [
      { type: 'latencyRange', minMs: 50, maxMs: 300 },
      { type: 'failRandomly', rate: 0.25, status: 503 }
    ],
    networkSpeedBps: 35000,
    fireRate: 900,
    maxConcurrent: 4,
    maxRetries: 3
  },
  'rate-limited': {
    label: 'Rate Limited',
    rules: [
      { type: 'latencyRange', minMs: 20, maxMs: 100 },
      { type: 'rateLimit', limit: 4, windowMs: 1000, retryAfterMs: 1000 }
    ],
    networkSpeedBps: 35000,
    fireRate: 140,
    maxConcurrent: 10,
    maxRetries: 2
  },
  'slow-network': {
    label: 'Slow Network',
    rules: [
      { type: 'latencyRange', minMs: 200, maxMs: 800 },
      { type: 'failRandomly', rate: 0.05, status: 503 }
    ],
    networkSpeedBps: 512,
    fireRate: 900,
    maxConcurrent: 4,
    maxRetries: 3
  },
  'meltdown': {
    label: 'Meltdown',
    rules: [
      { type: 'latencyRange', minMs: 80, maxMs: 500 },
      { type: 'failNth', n: 3, status: 500 },
      { type: 'failRandomly', rate: 0.15, status: 503 }
    ],
    networkSpeedBps: 30000,
    fireRate: 650,
    maxConcurrent: 6,
    maxRetries: 3
  }
}

export function createState() {
  const initialPreset = PRESETS['api-instability']
  return {
    running: false,
    preset: 'api-instability',
    chaosRules: [...initialPreset.rules],
    networkSpeedBps: initialPreset.networkSpeedBps,
    fireRate: initialPreset.fireRate,         // ms between attempts to start a new logical request
    maxConcurrent: initialPreset.maxConcurrent, // max simultaneous logical requests in-flight
    maxRetries: initialPreset.maxRetries,     // max retry attempts per logical request
    retryMode: 'linear',
    retryDelayMs: 200,
    retryExpoMultiplier: 2,
    retryJitter: true,
    circuitBreakerEnabled: false,
    circuitBreakerThreshold: 5,
    circuitBreakerResetMs: 10000,
    continuousEnabled: true,
    autoHardwarePacing: false,
    hardwareRequestsPerSec: 0,
    hardwareMaxConcurrent: 0,
    continuousRequests: 3,
    continuousWindowSec: 5,
    burstSize: 10,
    stats: { total: 0, success: 0, errors: 0, rateLimit: 0, retries: 0, droppedContinuous: 0 },

    // ── Replay / simulation mode ───────────────────────────────
    simulationMode: 'free-play', // 'free-play' | 'scenario'
    selectedScenarioId: null,
    gracefulRecovery: true,
  }
}
