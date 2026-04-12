// Three.js hex color values for MeshBasicMaterial / MeshPhysicalMaterial
export const COLORS = {
  INFLIGHT:     0x2979ff,  // blue  — in-flight request
  SUCCESS:      0x69f0ae,  // green — 2xx response
  ERROR:        0xff5252,  // red   — 5xx / connection error
  RATE_LIMITED: 0xffab40   // amber — 429 response
}

// CSS hex strings for UI legend
export const COLORS_CSS = {
  INFLIGHT:     '#2979ff',
  SUCCESS:      '#69f0ae',
  ERROR:        '#ff5252',
  RATE_LIMITED: '#ffab40'
}
