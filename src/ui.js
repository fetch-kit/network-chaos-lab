import { PRESETS } from './state.js'
import { COLORS_CSS } from './colors.js'
import { SCENARIOS } from './replay/scenarios.js'

const LEGEND_ITEMS = [
  ['In-flight', COLORS_CSS.INFLIGHT],
  ['Success', COLORS_CSS.SUCCESS],
  ['Error', COLORS_CSS.ERROR],
  ['Rate limited', COLORS_CSS.RATE_LIMITED]
]

const RULE_TYPES = [
  'latency',
  'latencyRange',
  'fail',
  'failRandomly',
  'failNth',
  'rateLimit',
  'throttle'
]

function cloneRules(rules) {
  return (Array.isArray(rules) ? rules : []).map((r) => ({ ...r }))
}

function normalizeRuleForExport(rule) {
  const type = String(rule?.type || '')
  if (type === 'latency') return { latency: { ms: Math.max(0, Number(rule.ms || 0)) } }
  if (type === 'latencyRange') {
    return {
      latencyRange: {
        minMs: Math.max(0, Number(rule.minMs || 0)),
        maxMs: Math.max(0, Number(rule.maxMs || 0))
      }
    }
  }
  if (type === 'fail') return { fail: {} }
  if (type === 'failRandomly') return { failRandomly: { rate: Math.max(0, Math.min(1, Number(rule.rate || 0))) } }
  if (type === 'failNth') return { failNth: { n: Math.max(1, Number(rule.n || 1)) } }
  if (type === 'rateLimit') {
    return {
      rateLimit: {
        limit: Math.max(1, Number(rule.limit || 1)),
        windowMs: Math.max(1, Number(rule.windowMs || 1000)),
        retryAfterMs: Math.max(0, Number(rule.retryAfterMs || 0))
      }
    }
  }
  if (type === 'throttle') return { throttle: { rate: Math.max(1, Number(rule.rate || 1024)) } }
  return null
}

function buildExportPayload(rules) {
  return {
    global: cloneRules(rules)
      .map(normalizeRuleForExport)
      .filter(Boolean)
  }
}

function toChaosFetchJs(payload) {
  return `export const chaosConfig = ${JSON.stringify(payload, null, 2)}`
}

function toChaosProxyYaml(payload) {
  const lines = ['global:']
  for (const node of payload.global) {
    const key = Object.keys(node)[0]
    const params = node[key] || {}
    const entries = Object.entries(params)
    if (entries.length === 0) {
      lines.push(`  - ${key}: {}`)
      continue
    }
    const inline = entries
      .map(([k, v]) => `${k}: ${typeof v === 'number' || typeof v === 'boolean' ? v : JSON.stringify(v)}`)
      .join(', ')
    lines.push(`  - ${key}: { ${inline} }`)
  }
  return lines.join('\n')
}

function createDefaultRule(type) {
  if (type === 'latency') return { type: 'latency', ms: 100 }
  if (type === 'latencyRange') return { type: 'latencyRange', minMs: 50, maxMs: 300 }
  if (type === 'fail') return { type: 'fail' }
  if (type === 'failRandomly') return { type: 'failRandomly', rate: 0.2 }
  if (type === 'failNth') return { type: 'failNth', n: 3 }
  if (type === 'rateLimit') return { type: 'rateLimit', limit: 4, windowMs: 1000, retryAfterMs: 1000 }
  return { type: 'throttle', rate: 2048 }
}

function ruleParamsHtml(rule, idx) {
  const t = rule.type
  if (t === 'latency') {
    return `<input data-rule-ms="${idx}" type="number" min="0" value="${Number(rule.ms || 0)}" style="width:72px" title="ms" />`
  }
  if (t === 'latencyRange') {
    return `<input data-rule-min="${idx}" type="number" min="0" value="${Number(rule.minMs || 0)}" style="width:62px" title="min ms" />
      <input data-rule-max="${idx}" type="number" min="0" value="${Number(rule.maxMs || 0)}" style="width:62px" title="max ms" />`
  }
  if (t === 'fail') {
    return `<span class="legend-item" style="font-size:10px; opacity:0.8">status 503</span>`
  }
  if (t === 'failRandomly') {
    return `<input data-rule-rate="${idx}" type="number" min="0" max="1" step="0.01" value="${Number(rule.rate || 0)}" style="width:62px" title="rate 0..1" />
      <span class="legend-item" style="font-size:10px; opacity:0.8">503</span>`
  }
  if (t === 'failNth') {
    return `<input data-rule-n="${idx}" type="number" min="1" value="${Number(rule.n || 1)}" style="width:62px" title="N" />
      <span class="legend-item" style="font-size:10px; opacity:0.8">503</span>`
  }
  if (t === 'rateLimit') {
    return `<input data-rule-limit="${idx}" type="number" min="1" value="${Number(rule.limit || 1)}" style="width:48px" title="limit" />
      <input data-rule-window="${idx}" type="number" min="1" value="${Number(rule.windowMs || 1000)}" style="width:62px" title="window ms" />
      <input data-rule-retry="${idx}" type="number" min="0" value="${Number(rule.retryAfterMs || 0)}" style="width:62px" title="retry-after ms" />`
  }
  return `<input data-rule-throttle="${idx}" type="number" min="1" value="${Number(rule.rate || 1024)}" style="width:82px" title="B/s" />`
}

export function createUI({ container, state, runner, replayEngine }) {
  const formatSpeed = (bps) => `${(bps / 1024).toFixed(1)} KB/s`

  const panel = document.createElement('div')
  panel.id = 'ui-panel'
  panel.innerHTML = `
    <h1>Request Chaos Visualizer</h1>

    <!-- ── Scenario selector ──────────────────────────────── -->
    <div class="scenario-picker">
      <span class="legend-item" style="font-weight:600; color:#e2e8f0;">Simulation mode</span>
      <select id="scenario-select" style="width:100%; margin-top:4px;">
        <option value="__free_play__">▶ Free Play (edit rules freely)</option>
        ${SCENARIOS.map((s) => `<option value="${s.meta.id}">${s.meta.name}</option>`).join('')}
      </select>
      <div style="display:flex; gap:6px; margin-top:6px;">
        <button id="btn-replay-action" class="btn-primary active" style="flex:1">▶ Start</button>
        <button id="btn-context" class="btn-preset" style="padding:6px 10px" title="Scenario context" disabled>ℹ</button>
      </div>
    </div>

    <!-- ── Timeline strip (scenario mode only) ────────────── -->
    <div id="timeline-section" style="display:none; flex-direction:column; gap:4px;">
      <div id="timeline-wrap" style="position:relative; height:14px;">
        <div id="timeline-bar" style="display:flex; height:100%; border-radius:4px; overflow:hidden; gap:1px;"></div>
        <div id="timeline-playhead" style="
          position:absolute; top:-3px; bottom:-3px; left:0;
          width:2px; background:#fff; border-radius:1px;
          box-shadow:0 0 4px rgba(255,255,255,0.7);
          pointer-events:none; transition:left 0.1s linear;
        "></div>
      </div>
      <div style="display:flex; justify-content:space-between;">
        <span id="timeline-elapsed" class="legend-item" style="font-size:10px;">0s</span>
        <span id="timeline-phase-name" class="legend-item" style="font-size:10px; font-weight:600; color:#e2e8f0;"></span>
        <span id="timeline-total" class="legend-item" style="font-size:10px;">0s</span>
      </div>
      <button id="btn-apply-recommended" class="btn-preset" style="width:100%; padding:7px; margin-top:2px;">
        Apply recommended client settings
      </button>
    </div>

    <div class="presets">
      ${Object.entries(PRESETS).map(([key, { label }]) =>
        `<button class="btn-preset${state.preset === key ? ' active' : ''}" data-preset="${key}">${label}</button>`
      ).join('')}
    </div>

    <div class="network-speed">
      <label for="network-speed-slider" class="legend-item">Network speed</label>
      <input id="network-speed-slider" type="range" min="256" max="512000" step="256" value="${state.networkSpeedBps}" style="width:100%" />
      <span id="network-speed-value" class="legend-item">${formatSpeed(state.networkSpeedBps)}</span>
    </div>

    <div class="workload">
      <span class="legend-item">Continuous load</span>
      <label class="legend-item" style="justify-content:space-between">
        <span>Auto (hardware)</span>
        <input id="auto-hw-pacing" type="checkbox" ${state.autoHardwarePacing ? 'checked' : ''} />
      </label>
      <span id="hardware-profile" class="legend-item">HW target: pending...</span>
      <label class="legend-item" style="justify-content:space-between">
        <span>Enabled</span>
        <input id="continuous-enabled" type="checkbox" ${state.continuousEnabled ? 'checked' : ''} />
      </label>
      <div class="legend-item" style="justify-content:space-between">
        <span>Requests / window</span>
        <input id="continuous-requests" type="number" min="1" max="200" value="${state.continuousRequests}" style="width:74px" />
      </div>
      <div class="legend-item" style="justify-content:space-between">
        <span>Window (sec)</span>
        <input id="continuous-window" type="number" min="0.1" step="0.1" value="${state.continuousWindowSec}" style="width:74px" />
      </div>
    </div>

    <div class="client-settings">
      <span class="legend-item">Client settings</span>
      <div class="legend-item" style="justify-content:space-between">
        <span>Max retries</span>
        <input id="retry-max" type="number" min="0" max="9" value="${state.maxRetries}" style="width:74px" />
      </div>
      <div class="legend-item" style="justify-content:space-between">
        <span>Retry mode</span>
        <select id="retry-mode" style="width:112px">
          <option value="none" ${state.retryMode === 'none' ? 'selected' : ''}>none</option>
          <option value="linear" ${state.retryMode === 'linear' ? 'selected' : ''}>linear</option>
          <option value="exponential" ${state.retryMode === 'exponential' ? 'selected' : ''}>expo</option>
        </select>
      </div>
      <div class="legend-item" style="justify-content:space-between">
        <span>Delay ms</span>
        <input id="retry-delay" type="number" min="0" value="${state.retryDelayMs}" style="width:74px" />
      </div>
      <div class="legend-item" style="justify-content:space-between">
        <span>Expo multiplier</span>
        <input id="retry-mult" type="number" min="1" step="0.1" value="${state.retryExpoMultiplier}" style="width:74px" />
      </div>
      <label class="legend-item" style="justify-content:space-between">
        <span>Jitter (+0..100ms)</span>
        <input id="retry-jitter" type="checkbox" ${state.retryJitter ? 'checked' : ''} />
      </label>
      <label class="legend-item" style="justify-content:space-between">
        <span>Max hedges</span>
        <select id="hedge-max" style="width:74px">
          <option value="0" ${state.maxHedges === 0 ? 'selected' : ''}>0</option>
          <option value="1" ${state.maxHedges === 1 ? 'selected' : ''}>1</option>
          <option value="2" ${state.maxHedges === 2 ? 'selected' : ''}>2</option>
        </select>
      </label>
      <div class="legend-item" style="justify-content:space-between">
        <span>Hedge delay ms</span>
        <input id="hedge-delay" type="number" min="0" max="5000" value="${state.hedgeDelayMs}" style="width:74px" />
      </div>
      <label class="legend-item" style="justify-content:space-between">
        <span>Circuit breaker</span>
        <input id="cb-enabled" type="checkbox" ${state.circuitBreakerEnabled ? 'checked' : ''} />
      </label>
      <div class="legend-item" style="justify-content:space-between">
        <span>CB threshold</span>
        <input id="cb-threshold" type="number" min="1" value="${state.circuitBreakerThreshold}" style="width:74px" />
      </div>
      <div class="legend-item" style="justify-content:space-between">
        <span>CB reset ms</span>
        <input id="cb-reset" type="number" min="100" value="${state.circuitBreakerResetMs}" style="width:74px" />
      </div>
      <label class="legend-item" style="justify-content:space-between">
        <span>Graceful recovery</span>
        <input id="graceful-recovery" type="checkbox" ${state.gracefulRecovery ? 'checked' : ''} />
      </label>
      <span id="cb-status" class="legend-item">Circuit: closed</span>
    </div>

    <div class="server-rules">
      <span class="legend-item">Server rules</span>
      <div id="rules-list" style="display:flex; flex-direction:column; gap:6px"></div>
      <div class="legend-item" style="justify-content:space-between; gap:8px;">
        <select id="add-rule-type" style="flex:1">
          ${RULE_TYPES.map((t) => `<option value="${t}">${t}</option>`).join('')}
        </select>
        <button id="add-rule" class="btn-preset" style="padding:6px 10px">Add</button>
      </div>
    </div>

    <div class="export">
      <span class="legend-item">Export</span>
      <span class="legend-item" style="font-size:10px; opacity:0.8">Global rules only. No port/target.</span>
      <div class="legend-item" style="justify-content:space-between; gap:8px; align-items:center;">
        <select id="export-format" style="flex:1">
          <option value="yaml-chaos-proxy">yaml (chaos-proxy)</option>
          <option value="js-chaos-fetch">js (chaos-fetch)</option>
        </select>
        <button id="export-copy" class="btn-preset" style="padding:6px 10px">Copy</button>
        <button id="export-download" class="btn-preset" style="padding:6px 10px">Download</button>
      </div>
      <textarea id="export-preview" readonly style="width:100%; min-height:110px; resize:vertical; background:rgba(0,0,0,0.25); color:#cbd5e1; border:1px solid rgba(255,255,255,0.12); border-radius:6px; padding:8px; font:11px/1.35 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;"></textarea>
    </div>

    <div class="burst">
      <span class="legend-item">Burst</span>
      <div class="legend-item" style="justify-content:space-between; gap:8px;">
        <select id="burst-size" style="flex:1">
          ${[1, 5, 10, 25, 50, 100, 200].map((n) => `<option value="${n}" ${state.burstSize === n ? 'selected' : ''}>${n}</option>`).join('')}
        </select>
        <button id="send-burst" class="btn-preset" style="padding:6px 10px">Send</button>
      </div>
    </div>

    <div class="queue">
      <span id="stat-queued" class="legend-item">Queue: 0</span>
      <span id="stat-burst-queued" class="legend-item">Burst queue: 0</span>
      <span id="stat-cont-queued" class="legend-item">Continuous queue: 0</span>
      <span id="stat-circuit" class="legend-item">Circuit queue: 0</span>
      <span id="stat-inflight" class="legend-item">Visible in-flight: 0</span>
      <span id="stat-logical-inflight" class="legend-item">Logical in-flight: 0</span>
    </div>

    <div class="legend">
      ${LEGEND_ITEMS.map(([label, color]) =>
        `<span class="legend-item">
          <span class="legend-dot" style="background:${color}"></span>${label}
        </span>`
      ).join('')}
    </div>

    <div class="stats">
      <span id="stat-total">0 sent</span>
      <span id="stat-retries">↩ 0 retries</span>
      <span id="stat-hedges" class="hedge-badge-fill">🛡 0 hedges</span>
      <span id="stat-success" style="color:${COLORS_CSS.SUCCESS}">✓ 0</span>
      <span id="stat-errors" style="color:${COLORS_CSS.ERROR}">✗ 0</span>
      <span id="stat-ratelimit" style="color:${COLORS_CSS.RATE_LIMITED}">⊘ 0</span>
      <span id="stat-latency-mode" style="color:#94a3b8; font-size:11px; grid-column: 1 / -1;">Latency SLO (success only)</span>
      <span id="stat-p50">p50: -</span>
      <span id="stat-p95">p95: -</span>
      <span id="stat-p99">p99: -</span>
      <span id="stat-latency-samples">latency n: 0</span>
      <span id="stat-error-rate">error rate: -</span>
    </div>
  `

  container.appendChild(panel)

  // ── Context / description overlay ─────────────────────────────────────────
  const overlay = document.createElement('div')
  overlay.id = 'scenario-overlay'
  overlay.style.cssText = [
    'position:fixed; inset:0; z-index:100;',
    'background:rgba(6,9,18,0.82); backdrop-filter:blur(6px);',
    'display:none; align-items:center; justify-content:center;',
  ].join('')
  overlay.innerHTML = `
    <div style="
      background:rgba(15,15,30,0.97);
      border:1px solid rgba(255,255,255,0.12);
      border-radius:14px;
      padding:28px 32px;
      max-width:520px;
      width:calc(100vw - 48px);
      display:flex; flex-direction:column; gap:14px;
    ">
      <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:12px;">
        <div style="flex:1;">
          <div id="ol-tag" style="font-size:10px; letter-spacing:0.1em; text-transform:uppercase; color:#6366f1; margin-bottom:4px;"></div>
          <h2 id="ol-title" style="font-size:15px; font-weight:700; color:#e2e8f0; line-height:1.3;"></h2>
        </div>
        <button id="ol-close" class="btn-preset" style="padding:4px 8px; flex-shrink:0;">✕</button>
      </div>
      <p id="ol-description" style="font-size:12px; color:#94a3b8; line-height:1.55;"></p>
      <div id="ol-context" style="font-size:11px; color:#7dd3fc; line-height:1.6; padding:10px 12px; background:rgba(0,0,0,0.25); border-radius:8px; border-left:3px solid #3b82f6;"></div>
      <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
        <span id="ol-source" style="font-size:10px; color:#475569;"></span>
        <span id="ol-date" style="font-size:10px; color:#475569;"></span>
      </div>
      <div style="display:flex; gap:8px; justify-content:flex-end;">
        <button id="ol-cancel" class="btn-preset" style="padding:8px 18px;">Cancel</button>
        <button id="ol-ok" class="btn-primary" style="width:auto; padding:8px 24px;">▶ Start Scenario</button>
      </div>
    </div>
  `
  container.appendChild(overlay)

  const speedSlider = panel.querySelector('#network-speed-slider')
  const speedValue = panel.querySelector('#network-speed-value')
  speedSlider.addEventListener('input', () => {
    state.networkSpeedBps = Number(speedSlider.value)
    speedValue.textContent = formatSpeed(state.networkSpeedBps)
  })

  const continuousEnabled = panel.querySelector('#continuous-enabled')
  const autoHwPacing = panel.querySelector('#auto-hw-pacing')
  const hardwareProfile = panel.querySelector('#hardware-profile')
  const continuousRequests = panel.querySelector('#continuous-requests')
  const continuousWindow = panel.querySelector('#continuous-window')

  function updatePacingUI() {
    const disabled = state.autoHardwarePacing
    continuousRequests.disabled = disabled
    continuousWindow.disabled = disabled
    const rps = Number(state.hardwareRequestsPerSec || 0)
    const conc = Number(state.hardwareMaxConcurrent || 0)
    hardwareProfile.textContent = rps > 0
      ? `HW target: ${rps}/s, concurrency ${conc}`
      : 'HW target: measuring...'
  }

  function applyContinuousConfig() {
    state.continuousEnabled = continuousEnabled.checked
    state.autoHardwarePacing = autoHwPacing.checked
    state.continuousRequests = Math.max(1, Number(continuousRequests.value || 1))
    state.continuousWindowSec = Math.max(0.1, Number(continuousWindow.value || 1))
    updatePacingUI()
    runner.reconfigureProducers()
  }

  continuousEnabled.addEventListener('change', applyContinuousConfig)
  autoHwPacing.addEventListener('change', applyContinuousConfig)
  continuousRequests.addEventListener('change', applyContinuousConfig)
  continuousWindow.addEventListener('change', applyContinuousConfig)

  const retryMax = panel.querySelector('#retry-max')
  const retryMode = panel.querySelector('#retry-mode')
  const retryDelay = panel.querySelector('#retry-delay')
  const retryMult = panel.querySelector('#retry-mult')
  const retryJitter = panel.querySelector('#retry-jitter')
  const hedgeMax = panel.querySelector('#hedge-max')
  const hedgeDelay = panel.querySelector('#hedge-delay')
  const cbEnabled = panel.querySelector('#cb-enabled')
  const cbThreshold = panel.querySelector('#cb-threshold')
  const cbReset = panel.querySelector('#cb-reset')
  const gracefulRecovery = panel.querySelector('#graceful-recovery')

  function applyClientSettings() {
    state.maxRetries = Math.max(0, Number(retryMax.value || 0))
    state.retryMode = String(retryMode.value || 'linear')
    state.retryDelayMs = Math.max(0, Number(retryDelay.value || 0))
    state.retryExpoMultiplier = Math.max(1, Number(retryMult.value || 1))
    state.retryJitter = retryJitter.checked
    state.maxHedges = Math.max(0, Math.min(2, Number(hedgeMax.value || 0)))
    state.hedgeDelayMs = Math.max(0, Number(hedgeDelay.value || 1000))
    state.circuitBreakerEnabled = cbEnabled.checked
    state.circuitBreakerThreshold = Math.max(1, Number(cbThreshold.value || 1))
    state.circuitBreakerResetMs = Math.max(100, Number(cbReset.value || 100))
    state.gracefulRecovery = gracefulRecovery.checked
  }

  retryMax.addEventListener('change', applyClientSettings)
  retryMode.addEventListener('change', applyClientSettings)
  retryDelay.addEventListener('change', applyClientSettings)
  retryMult.addEventListener('change', applyClientSettings)
  retryJitter.addEventListener('change', applyClientSettings)
  hedgeMax.addEventListener('change', applyClientSettings)
  hedgeDelay.addEventListener('change', applyClientSettings)
  cbEnabled.addEventListener('change', applyClientSettings)
  cbThreshold.addEventListener('change', applyClientSettings)
  cbReset.addEventListener('change', applyClientSettings)
  gracefulRecovery.addEventListener('change', applyClientSettings)

  const rulesList = panel.querySelector('#rules-list')
  const addRuleType = panel.querySelector('#add-rule-type')
  const addRule = panel.querySelector('#add-rule')
  const exportFormat = panel.querySelector('#export-format')
  const exportCopy = panel.querySelector('#export-copy')
  const exportDownload = panel.querySelector('#export-download')
  const exportPreview = panel.querySelector('#export-preview')

  function getExportDoc() {
    const payload = buildExportPayload(state.chaosRules)
    if (exportFormat.value === 'yaml-chaos-proxy') {
      return {
        content: toChaosProxyYaml(payload),
        fileName: 'chaos-proxy.yaml',
        mime: 'application/x-yaml'
      }
    }
    return {
      content: toChaosFetchJs(payload),
      fileName: 'chaos-fetch.config.js',
      mime: 'application/javascript'
    }
  }

  function renderExportPreview() {
    exportPreview.value = getExportDoc().content
  }

  exportFormat.addEventListener('change', renderExportPreview)
  exportCopy.addEventListener('click', async () => {
    const { content } = getExportDoc()
    try {
      await navigator.clipboard.writeText(content)
      exportCopy.textContent = 'Copied'
      setTimeout(() => { exportCopy.textContent = 'Copy' }, 900)
    } catch {
      exportCopy.textContent = 'Failed'
      setTimeout(() => { exportCopy.textContent = 'Copy' }, 1200)
    }
  })
  exportDownload.addEventListener('click', () => {
    const { content, fileName, mime } = getExportDoc()
    const blob = new Blob([content], { type: mime })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = fileName
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
  })

  function applyRules() {
    runner.setRules(cloneRules(state.chaosRules))
    renderExportPreview()
  }

  function setRuleNumber(index, key, value, min = null, max = null) {
    let num = Number(value)
    if (!Number.isFinite(num)) return
    if (typeof min === 'number') num = Math.max(min, num)
    if (typeof max === 'number') num = Math.min(max, num)
    state.chaosRules[index][key] = num
    applyRules()
  }

  function bindRuleEvents() {
    rulesList.querySelectorAll('[data-rule-type]').forEach((el) => {
      el.addEventListener('change', () => {
        const index = Number(el.dataset.ruleType)
        state.chaosRules[index] = createDefaultRule(el.value)
        renderRules()
        applyRules()
      })
    })

    rulesList.querySelectorAll('[data-rule-remove]').forEach((el) => {
      el.addEventListener('click', () => {
        const index = Number(el.dataset.ruleRemove)
        state.chaosRules.splice(index, 1)
        renderRules()
        applyRules()
      })
    })

    rulesList.querySelectorAll('[data-rule-ms]').forEach((el) => el.addEventListener('change', () => setRuleNumber(Number(el.dataset.ruleMs), 'ms', el.value, 0)))
    rulesList.querySelectorAll('[data-rule-min]').forEach((el) => el.addEventListener('change', () => setRuleNumber(Number(el.dataset.ruleMin), 'minMs', el.value, 0)))
    rulesList.querySelectorAll('[data-rule-max]').forEach((el) => el.addEventListener('change', () => setRuleNumber(Number(el.dataset.ruleMax), 'maxMs', el.value, 0)))
    rulesList.querySelectorAll('[data-rule-rate]').forEach((el) => el.addEventListener('change', () => setRuleNumber(Number(el.dataset.ruleRate), 'rate', el.value, 0, 1)))
    rulesList.querySelectorAll('[data-rule-n]').forEach((el) => el.addEventListener('change', () => setRuleNumber(Number(el.dataset.ruleN), 'n', el.value, 1)))
    rulesList.querySelectorAll('[data-rule-limit]').forEach((el) => el.addEventListener('change', () => setRuleNumber(Number(el.dataset.ruleLimit), 'limit', el.value, 1)))
    rulesList.querySelectorAll('[data-rule-window]').forEach((el) => el.addEventListener('change', () => setRuleNumber(Number(el.dataset.ruleWindow), 'windowMs', el.value, 1)))
    rulesList.querySelectorAll('[data-rule-retry]').forEach((el) => el.addEventListener('change', () => setRuleNumber(Number(el.dataset.ruleRetry), 'retryAfterMs', el.value, 0)))
    rulesList.querySelectorAll('[data-rule-throttle]').forEach((el) => el.addEventListener('change', () => setRuleNumber(Number(el.dataset.ruleThrottle), 'rate', el.value, 1)))
  }

  function renderRules() {
    rulesList.innerHTML = state.chaosRules.map((rule, idx) => `
      <div class="legend-item" style="justify-content:space-between; gap:6px; align-items:center;">
        <select data-rule-type="${idx}" style="width:108px">
          ${RULE_TYPES.map((t) => `<option value="${t}" ${rule.type === t ? 'selected' : ''}>${t}</option>`).join('')}
        </select>
        <div style="display:flex; align-items:center; gap:4px; flex-wrap:wrap; justify-content:flex-end;">
          ${ruleParamsHtml(rule, idx)}
          <button data-rule-remove="${idx}" class="btn-preset" style="padding:4px 6px">x</button>
        </div>
      </div>
    `).join('')
    bindRuleEvents()
  }

  addRule.addEventListener('click', () => {
    const type = String(addRuleType.value)
    state.chaosRules.push(createDefaultRule(type))
    renderRules()
    applyRules()
  })

  panel.querySelectorAll('.btn-preset').forEach((btn) => {
    btn.addEventListener('click', () => {
      const key = btn.dataset.preset
      if (!key) return
      state.preset = key
      const preset = PRESETS[key]
      panel.querySelectorAll('.btn-preset[data-preset]').forEach((b) => b.classList.remove('active'))
      btn.classList.add('active')
      state.networkSpeedBps = preset.networkSpeedBps
      state.fireRate = preset.fireRate
      state.maxConcurrent = preset.maxConcurrent
      state.maxRetries = preset.maxRetries
      state.chaosRules = cloneRules(preset.rules)
      speedSlider.value = String(state.networkSpeedBps)
      speedValue.textContent = formatSpeed(state.networkSpeedBps)
      retryMax.value = String(state.maxRetries)
      renderRules()
      runner.setRules(cloneRules(state.chaosRules))
      runner.reconfigureProducers()
      renderExportPreview()
    })
  })

  const burstSize = panel.querySelector('#burst-size')
  const sendBurst = panel.querySelector('#send-burst')

  burstSize.addEventListener('change', () => {
    state.burstSize = Number(burstSize.value)
  })

  sendBurst.addEventListener('click', () => {
    const count = Number(burstSize.value)
    state.burstSize = count
    runner.enqueueBurst(count)
  })

  const elTotal = panel.querySelector('#stat-total')
  const elRetries = panel.querySelector('#stat-retries')
  const elHedges = panel.querySelector('#stat-hedges')
  const elSuccess = panel.querySelector('#stat-success')
  const elErrors = panel.querySelector('#stat-errors')
  const elRateLimit = panel.querySelector('#stat-ratelimit')
  const elP50 = panel.querySelector('#stat-p50')
  const elP95 = panel.querySelector('#stat-p95')
  const elP99 = panel.querySelector('#stat-p99')
  const elLatencySamples = panel.querySelector('#stat-latency-samples')
  const elErrorRate = panel.querySelector('#stat-error-rate')
  const elQueued = panel.querySelector('#stat-queued')
  const elBurstQueued = panel.querySelector('#stat-burst-queued')
  const elContQueued = panel.querySelector('#stat-cont-queued')
  const elCircuitQueued = panel.querySelector('#stat-circuit')
  const elInFlight = panel.querySelector('#stat-inflight')
  const elLogicalInFlight = panel.querySelector('#stat-logical-inflight')
  const elCircuitStatus = panel.querySelector('#cb-status')

  function updateStats(meta = {}) {
    function fmtLatency(v) {
      return Number.isFinite(v) ? `${Math.round(v)}ms` : '-'
    }

    const s = state.stats
    elTotal.textContent = `${s.total} sent`
    elRetries.textContent = `↩ ${s.retries} retries`
    if (elHedges) elHedges.textContent = `🛡 ${s.hedges} hedges`
    elSuccess.textContent = `✓ ${s.success}`
    elErrors.textContent = `✗ ${s.errors}`
    elRateLimit.textContent = `⊘ ${s.rateLimit}`
    if (meta.latencyStats) {
      if (elP50) elP50.textContent = `p50: ${fmtLatency(meta.latencyStats.p50)}`
      if (elP95) elP95.textContent = `p95: ${fmtLatency(meta.latencyStats.p95)}`
      if (elP99) elP99.textContent = `p99: ${fmtLatency(meta.latencyStats.p99)}`
    }
    if (meta.slo) {
      if (elLatencySamples) elLatencySamples.textContent = `latency n: ${meta.slo.latencySampleCount ?? 0}`
      if (elErrorRate) {
        const pct = Number.isFinite(meta.slo.errorRatePct) ? `${meta.slo.errorRatePct.toFixed(1)}%` : '-'
        elErrorRate.textContent = `error rate: ${pct}`
      }
    }
    if (typeof meta.queued === 'number') elQueued.textContent = `Queue: ${meta.queued}`
    if (typeof meta.burstQueued === 'number') elBurstQueued.textContent = `Burst queue: ${meta.burstQueued}`
    if (typeof meta.continuousQueued === 'number') elContQueued.textContent = `Continuous queue: ${meta.continuousQueued}`
    if (typeof meta.circuitQueued === 'number') elCircuitQueued.textContent = `Circuit queue: ${meta.circuitQueued}`
    if (typeof meta.activeAttempts === 'number') elInFlight.textContent = `Visible in-flight: ${meta.activeAttempts}`
    if (typeof meta.inFlight === 'number') elLogicalInFlight.textContent = `Logical in-flight: ${meta.inFlight}`
    if (typeof meta.hardwareRequestsPerSec === 'number') state.hardwareRequestsPerSec = meta.hardwareRequestsPerSec
    if (typeof meta.hardwareMaxConcurrent === 'number') state.hardwareMaxConcurrent = meta.hardwareMaxConcurrent
    if (typeof meta.circuitOpen === 'boolean') {
      if (meta.circuitOpen && Number(meta.circuitOpenUntil || 0) > Date.now()) {
        const seconds = Math.max(0, Math.ceil((meta.circuitOpenUntil - Date.now()) / 1000))
        elCircuitStatus.textContent = `Circuit: OPEN (${seconds}s)`
      } else {
        elCircuitStatus.textContent = 'Circuit: closed'
      }
    }
    updatePacingUI()
  }

  renderRules()
  updatePacingUI()
  applyClientSettings()
  renderExportPreview()

  // ── Replay UI wiring ──────────────────────────────────────────────────────

  const scenarioSelect    = panel.querySelector('#scenario-select')
  const btnReplayAction   = panel.querySelector('#btn-replay-action')
  const btnContext        = panel.querySelector('#btn-context')
  const timelineSection   = panel.querySelector('#timeline-section')
  const timelineBar       = panel.querySelector('#timeline-bar')
  const timelinePlayhead  = panel.querySelector('#timeline-playhead')
  const timelineElapsed   = panel.querySelector('#timeline-elapsed')
  const timelinePhaseName = panel.querySelector('#timeline-phase-name')
  const timelineTotal     = panel.querySelector('#timeline-total')
  const btnApplyRec       = panel.querySelector('#btn-apply-recommended')
  const serverRulesDiv    = panel.querySelector('.server-rules')

  // Overlay elements
  const olClose       = overlay.querySelector('#ol-close')
  const olCancel      = overlay.querySelector('#ol-cancel')
  const olOk          = overlay.querySelector('#ol-ok')
  const olTag         = overlay.querySelector('#ol-tag')
  const olTitle       = overlay.querySelector('#ol-title')
  const olDescription = overlay.querySelector('#ol-description')
  const olContext     = overlay.querySelector('#ol-context')
  const olSource      = overlay.querySelector('#ol-source')
  const olDate        = overlay.querySelector('#ol-date')

  // Track replay state
  let replayState = replayEngine.getState()
  let pendingScenario = null   // scenario staged for the OK/Cancel overlay

  function getSelectedScenario() {
    const id = scenarioSelect.value
    return id === '__free_play__' ? null : SCENARIOS.find((s) => s.meta.id === id) ?? null
  }

  function isScenarioMode() {
    return scenarioSelect.value !== '__free_play__'
  }

  function fmt(ms) {
    const s = Math.round(ms / 1000)
    if (s < 60) return `${s}s`
    return `${Math.floor(s / 60)}m ${s % 60}s`
  }

  // Build the coloured phase blocks in the timeline bar
  function renderTimelineBar(scenario) {
    const totalMs = scenario.timeline.reduce((a, p) => a + p.durationSec * 1000, 0)
    timelineBar.innerHTML = scenario.timeline.map((phase) => {
      const pct = (phase.durationSec * 1000 / totalMs * 100).toFixed(2)
      return `<div title="${phase.name}" style="
        flex:0 0 ${pct}%;
        background:${phase.color};
        opacity:0.55;
        border-radius:2px;
        transition:opacity 0.2s;
      " data-phase-bar></div>`
    }).join('')
    timelineTotal.textContent = fmt(totalMs)
  }

  function updateTimelineBar(phaseIndex, phaseElapsedMs, phaseDurationMs) {
    const bars = timelineBar.querySelectorAll('[data-phase-bar]')
    bars.forEach((bar, i) => {
      if (i < phaseIndex) {
        bar.style.opacity = '1'
      } else if (i === phaseIndex) {
        const progress = Math.min(1, phaseElapsedMs / phaseDurationMs)
        bar.style.opacity = String(0.55 + progress * 0.45)
      } else {
        bar.style.opacity = '0.25'
      }
    })
    // Move playhead
    if (replayState.scenarioTotalMs > 0) {
      const pct = Math.min(100, replayState.scenarioElapsedMs / replayState.scenarioTotalMs * 100)
      timelinePlayhead.style.left = `${pct.toFixed(2)}%`
    }
  }

  function enterScenarioMode(scenario) {
    serverRulesDiv.style.display = 'none'
    timelineSection.style.display = 'flex'
    btnApplyRec.disabled = false
    btnApplyRec.title = 'Apply recommended client settings from scenario JSON'
    btnContext.disabled = false
    renderTimelineBar(scenario)
    timelinePhaseName.textContent = scenario.timeline[0]?.name ?? ''
    timelineElapsed.textContent = '0s'
    timelinePlayhead.style.left = '0%'
  }

  function enterFreePlayMode() {
    serverRulesDiv.style.display = ''
    timelineSection.style.display = 'none'
    btnApplyRec.disabled = true
    btnApplyRec.title = 'Only available in scenario mode (v2: will infer from current rules)'
    btnContext.disabled = true
    pendingScenario = null
  }

  function showOverlay(scenario, forInfo = false) {
    const m = scenario.meta
    olTag.textContent = (m.tags ?? []).join(' · ')
    olTitle.textContent = m.name
    olDescription.textContent = m.description
    olContext.textContent = m.historicalContext
    olSource.textContent = m.source ? `Source: ${m.source}` : ''
    const d = m.occurredAt ? new Date(m.occurredAt).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : ''
    olDate.textContent = d ? `· Occurred: ${d}` : ''
    olOk.style.display = forInfo ? 'none' : ''
    olCancel.textContent = forInfo ? 'Close' : 'Cancel'
    overlay.style.display = 'flex'
  }

  function hideOverlay() {
    overlay.style.display = 'none'
    pendingScenario = null
  }

  function syncReplayButton() {
    if (!isScenarioMode()) {
      // free play — use the simple stop/start on runner directly
      btnReplayAction.textContent = state.running ? '⏹ Stop' : '▶ Start'
      btnReplayAction.classList.toggle('active', state.running)
      return
    }
    if (replayState.ended) {
      btnReplayAction.textContent = '↺ Restart'
      btnReplayAction.classList.add('active')
    } else if (replayState.active && !replayState.paused) {
      btnReplayAction.textContent = '⏹ Stop'
      btnReplayAction.classList.add('active')
    } else {
      btnReplayAction.textContent = '▶ Start Scenario'
      btnReplayAction.classList.remove('active')
    }
  }

  function applyRecommendedSettings(scenario) {
    const r = scenario.recommendedClient
    if (!r) return
    if (typeof r.maxRetries === 'number') { state.maxRetries = r.maxRetries; retryMax.value = String(r.maxRetries) }
    if (r.retryMode) { state.retryMode = r.retryMode; retryMode.value = r.retryMode }
    if (typeof r.retryDelayMs === 'number') { state.retryDelayMs = r.retryDelayMs; retryDelay.value = String(r.retryDelayMs) }
    if (typeof r.retryExpoMultiplier === 'number') { state.retryExpoMultiplier = r.retryExpoMultiplier; retryMult.value = String(r.retryExpoMultiplier) }
    if (typeof r.retryJitter === 'boolean') { state.retryJitter = r.retryJitter; retryJitter.checked = r.retryJitter }
    if (typeof r.maxHedges === 'number') { state.maxHedges = r.maxHedges; hedgeMax.value = String(r.maxHedges) }
    if (typeof r.hedgeDelayMs === 'number') { state.hedgeDelayMs = r.hedgeDelayMs; hedgeDelay.value = String(r.hedgeDelayMs) }
    if (typeof r.circuitBreakerEnabled === 'boolean') { state.circuitBreakerEnabled = r.circuitBreakerEnabled; cbEnabled.checked = r.circuitBreakerEnabled }
    if (typeof r.circuitBreakerThreshold === 'number') { state.circuitBreakerThreshold = r.circuitBreakerThreshold; cbThreshold.value = String(r.circuitBreakerThreshold) }
    if (typeof r.circuitBreakerResetMs === 'number') { state.circuitBreakerResetMs = r.circuitBreakerResetMs; cbReset.value = String(r.circuitBreakerResetMs) }
    if (typeof r.gracefulRecovery === 'boolean') { state.gracefulRecovery = r.gracefulRecovery; gracefulRecovery.checked = r.gracefulRecovery }
    // Flash button to confirm
    btnApplyRec.textContent = '✓ Applied'
    setTimeout(() => { btnApplyRec.textContent = 'Apply recommended client settings' }, 1200)
  }

  // ── Scenario selector change ───────────────────────────────────────────────
  scenarioSelect.addEventListener('change', () => {
    // If replay is running, stop it first
    if (replayState.active || replayState.ended) {
      replayEngine.stop()
    }
    const scenario = getSelectedScenario()
    if (scenario) {
      enterScenarioMode(scenario)
    } else {
      enterFreePlayMode()
    }
    syncReplayButton()
    renderExportPreview()
  })
  btnReplayAction.addEventListener('click', () => {
    if (!isScenarioMode()) {
      // Free Play: just toggle runner
      if (state.running) {
        runner.stop()
      } else {
        runner.start()
      }
      syncReplayButton()
      return
    }

    const scenario = getSelectedScenario()
    if (!scenario) return

    if (replayState.ended) {
      // Restart
      replayEngine.restart()
      runner.start()
      return
    }

    if (replayState.active && !replayState.paused) {
      // Stop
      replayEngine.stop()
      runner.stop()
      syncReplayButton()
      return
    }

    // Not active yet — show confirmation overlay
    pendingScenario = scenario
    replayEngine.loadScenario(scenario)
    showOverlay(scenario, false)
  })

  // ── Overlay OK → actually start ────────────────────────────────────────────
  olOk.addEventListener('click', () => {
    const scenario = pendingScenario
    hideOverlay()
    if (!scenario) return
    if (!state.running) runner.start()
    replayEngine.start()
    enterScenarioMode(scenario)
    syncReplayButton()
  })

  olCancel.addEventListener('click', hideOverlay)
  olClose.addEventListener('click', hideOverlay)
  overlay.addEventListener('click', (e) => { if (e.target === overlay) hideOverlay() })

  // ── Context info button (while running) ────────────────────────────────────
  btnContext.addEventListener('click', () => {
    const scenario = getSelectedScenario()
    if (scenario) showOverlay(scenario, true)
  })

  // ── Apply recommended settings button ─────────────────────────────────────
  btnApplyRec.disabled = true   // disabled in free play mode on init
  btnApplyRec.title = 'Only available in scenario mode (v2: will infer from current rules)'
  btnApplyRec.addEventListener('click', () => {
    const scenario = getSelectedScenario()
    if (scenario) applyRecommendedSettings(scenario)
  })

  // ── Callbacks from replayEngine ────────────────────────────────────────────
  function onPhaseChange({ phaseIndex, phase }) {
    timelinePhaseName.textContent = phase.name
    renderExportPreview()
  }

  function onReplayComplete() {
    syncReplayButton()
    renderExportPreview()
  }

  function onReplayStateChange(rs) {
    replayState = rs
    syncReplayButton()

    if (!rs.active && !rs.ended) return

    timelineElapsed.textContent = fmt(rs.scenarioElapsedMs)
    timelinePhaseName.textContent = rs.phaseName
    updateTimelineBar(rs.phaseIndex, rs.phaseElapsedMs, rs.phaseDurationMs)
  }

  // Initial mode
  enterFreePlayMode()
  syncReplayButton()

  return { updateStats, onPhaseChange, onReplayComplete, onReplayStateChange }
}
