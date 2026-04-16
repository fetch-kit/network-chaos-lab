/**
 * Built-in incident scenarios. Each represents a real historical event,
 * approximated as a sequence of chaos phases for educational replay.
 *
 * Schema per scenario:
 *   meta.id              — unique string identifier
 *   meta.name            — display name
 *   meta.description     — one-sentence summary
 *   meta.source          — postmortem URL
 *   meta.tags            — string[]
 *   meta.occurredAt      — ISO-8601 string
 *   meta.historicalContext — narrative for the context overlay
 *   traffic.requestRateRps — requests/sec for continuous producer during replay
 *   recommendedClient    — retry/circuit settings to suggest to the user
 *   timeline[]           — ordered phases, each with:
 *     name, durationSec, color (CSS), phaseContext, chaosRules[]
 *     optional trafficOverride.requestRateRps
 */

export const SCENARIOS = [
  {
    meta: {
      id: 'fastly-2021-06-08',
      name: 'Fastly CDN — Global Disruption',
      description:
        'A latent software bug introduced in May was triggered by a valid customer config on June 8, knocking out 85% of the Fastly network.',
      source: 'https://www.fastly.com/blog/summary-of-june-8-outage',
      tags: ['cdn', 'config', 'global', 'edge'],
      occurredAt: '2021-06-08T09:47:00Z',
      historicalContext:
        'At 09:47 UTC the global disruption began. Fastly monitoring detected it within one minute. By 10:27 engineering had traced it to a specific customer configuration that triggered an undiscovered bug deployed May 12. Mitigation started 10:36; 95% of the network recovered within 49 minutes of onset. The permanent fix rolled out from 17:25 UTC.',
    },
    traffic: { requestRateRps: 3.0 },
    recommendedClient: {
      maxRetries: 2,
      retryMode: 'exponential',
      retryDelayMs: 180,
      retryExpoMultiplier: 2,
      retryJitter: true,
      maxHedges: 1,
      hedgeDelayMs: 250,
      circuitBreakerEnabled: true,
      circuitBreakerThreshold: 7,
      circuitBreakerResetMs: 7000,
    },
    timeline: [
      {
        name: 'Normal before trigger',
        durationSec: 25,
        color: '#276749',
        phaseContext: 'System healthy before the triggering configuration is pushed.',
        chaosRules: [{ type: 'latency', ms: 70 }],
      },
      {
        name: 'Global disruption onset',
        durationSec: 55,
        color: '#C53030',
        trafficOverride: { requestRateRps: 4.0 },
        phaseContext:
          'Equivalent to 09:47–10:27 UTC: widespread failures while root cause is being identified.',
        chaosRules: [
          { type: 'failRandomly', rate: 0.85 },
          { type: 'latency', ms: 320 },
        ],
      },
      {
        name: 'Mitigation and rollback',
        durationSec: 55,
        color: '#C05621',
        phaseContext:
          'Equivalent to 10:36–12:35 UTC: bad config disabled, traffic stabilises but residual errors remain.',
        chaosRules: [
          { type: 'failRandomly', rate: 0.2 },
          { type: 'latency', ms: 180 },
          { type: 'throttle', rate: 5120 },
        ],
      },
      {
        name: 'Recovered with residual risk',
        durationSec: 35,
        color: '#2B6CB0',
        phaseContext:
          'Service mostly healthy while the permanent bug fix rolls out later in the day.',
        chaosRules: [
          { type: 'failRandomly', rate: 0.03 },
          { type: 'latency', ms: 90 },
        ],
      },
    ],
  },

  {
    meta: {
      id: 'cloudflare-2022-06-21',
      name: 'Cloudflare — BGP Prefix Withdrawal',
      description:
        'A routing-policy term reordering caused 19 high-traffic MCP data-centers to withdraw their prefixes, knocking 50% of Cloudflare traffic offline.',
      source: 'https://blog.cloudflare.com/cloudflare-outage-on-june-21-2022/',
      tags: ['bgp', 'routing', 'network', 'partial-global'],
      occurredAt: '2022-06-21T06:27:00Z',
      historicalContext:
        'Rollout reached MCP-enabled locations at 06:27 UTC, immediately taking 19 data-centers offline. Internal incident declared 06:32. Engineers walked back changes starting 06:51. First DC restored 06:58. Due to overlapping reverts, the problem reappeared sporadically. All reverts complete 07:42; incident closed 08:00. Those 19 sites represent only 4% of Cloudflare locations but handle ~50% of requests.',
    },
    traffic: { requestRateRps: 2.6 },
    recommendedClient: {
      maxRetries: 3,
      retryMode: 'exponential',
      retryDelayMs: 250,
      retryExpoMultiplier: 2,
      retryJitter: true,
      maxHedges: 1,
      hedgeDelayMs: 300,
      circuitBreakerEnabled: true,
      circuitBreakerThreshold: 6,
      circuitBreakerResetMs: 9000,
    },
    timeline: [
      {
        name: 'Config reaches MCP spines',
        durationSec: 30,
        color: '#6B46C1',
        phaseContext:
          'Equivalent to 06:27 UTC: rollout hits MCP-enabled sites, first failures appear.',
        chaosRules: [
          { type: 'latency', ms: 110 },
          { type: 'failRandomly', rate: 0.08 },
        ],
      },
      {
        name: 'Prefix withdrawal outage',
        durationSec: 60,
        color: '#C53030',
        trafficOverride: { requestRateRps: 3.4 },
        phaseContext:
          'Equivalent to 06:27–06:58 UTC: severe reachability loss, load balancing broken, smaller clusters overloaded.',
        chaosRules: [
          { type: 'failRandomly', rate: 0.7 },
          { type: 'latencyRange', minMs: 250, maxMs: 900 },
          { type: 'throttle', rate: 3072 },
        ],
      },
      {
        name: 'Progressive revert',
        durationSec: 50,
        color: '#C05621',
        phaseContext:
          'Equivalent to 06:58–07:42 UTC: staggered restoration with periodic error spikes from overlapping reverts.',
        chaosRules: [
          { type: 'failRandomly', rate: 0.22 },
          { type: 'latency', ms: 200 },
        ],
      },
      {
        name: 'Stabilization',
        durationSec: 30,
        color: '#276749',
        phaseContext:
          'Equivalent to 07:42–08:00 UTC: all reverts complete, incident closed.',
        chaosRules: [
          { type: 'failRandomly', rate: 0.02 },
          { type: 'latency', ms: 85 },
        ],
      },
    ],
  },

  {
    meta: {
      id: 'github-2018-10-21',
      name: 'GitHub — Cross-Region DB Failover',
      description:
        'A 43-second network partition triggered an unintended cross-region MySQL failover, leading to 24 h 11 min of service degradation while data integrity was prioritised.',
      source: 'https://github.blog/news-insights/oct21-post-incident-analysis/',
      tags: ['database', 'failover', 'replication', 'consistency'],
      occurredAt: '2018-10-21T22:52:00Z',
      historicalContext:
        'Network partition at 22:52 UTC caused Orchestrator to promote West Coast primaries. Connectivity restored in 43 s but diverged writes made a safe fail-back impossible. By 23:13 the team committed to "fail-forward" to protect data integrity at the cost of usability. Backup restoration began 00:41 UTC Oct 22. East Coast primaries returned 11:12. Replicas caught up by 16:24. Webhook backlog (5M+ events) cleared and green status restored at 23:03 UTC Oct 22.',
    },
    traffic: { requestRateRps: 2.0 },
    recommendedClient: {
      maxRetries: 4,
      retryMode: 'exponential',
      retryDelayMs: 220,
      retryExpoMultiplier: 2,
      retryJitter: true,
      maxHedges: 1,
      hedgeDelayMs: 250,
      circuitBreakerEnabled: true,
      circuitBreakerThreshold: 10,
      circuitBreakerResetMs: 12000,
    },
    timeline: [
      {
        name: 'Partition & fail-forward decision',
        durationSec: 40,
        color: '#975A16',
        phaseContext:
          'Equivalent to 22:52–23:19 UTC: topology shifts, incident escalates, writes now traversing cross-country link.',
        chaosRules: [
          { type: 'latencyRange', minMs: 180, maxMs: 700 },
          { type: 'failRandomly', rate: 0.15 },
        ],
      },
      {
        name: 'Controlled degradation',
        durationSec: 50,
        color: '#C53030',
        trafficOverride: { requestRateRps: 1.6 },
        phaseContext:
          'Non-critical workloads deliberately paused. Webhooks and Pages builds stopped to protect data integrity over uptime.',
        chaosRules: [
          { type: 'failRandomly', rate: 0.38 },
          { type: 'latency', ms: 450 },
          { type: 'rateLimit', limit: 1, windowMs: 1000, retryAfterMs: 1000 },
        ],
      },
      {
        name: 'Replica catch-up & backlog',
        durationSec: 55,
        color: '#C05621',
        phaseContext:
          'Equivalent to 06:51–16:24 UTC Oct 22: stale reads, replica lag increasing under morning peak load.',
        chaosRules: [
          { type: 'latency', ms: 220 },
          { type: 'failRandomly', rate: 0.12 },
          { type: 'throttle', rate: 4096 },
        ],
      },
      {
        name: 'Re-sync complete',
        durationSec: 25,
        color: '#276749',
        phaseContext:
          'Equivalent to post-16:24 UTC: primaries back East, replicas synced, backlog draining to green.',
        chaosRules: [
          { type: 'failRandomly', rate: 0.015 },
          { type: 'latency', ms: 95 },
        ],
      },
    ],
  },

  {
    meta: {
      id: 'atlassian-2022-04',
      name: 'Atlassian — Accidental Site Deletion',
      description:
        'A maintenance script received site IDs instead of app IDs, deleting 883 sites across 775 customers. Full restoration took up to 14 days.',
      source: 'https://www.atlassian.com/engineering/post-incident-review-april-2022-outage',
      tags: ['data', 'deletion', 'recovery', 'multi-day'],
      occurredAt: '2022-04-05T07:38:00Z',
      historicalContext:
        'Script ran 07:38–08:01 UTC Apr 5, deleting 883 sites. Major incident declared 08:17; root cause confirmed 08:53. Restoration 1 (sequential, ~48 h/batch) began Apr 5; first customers restored Apr 8. Restoration 2 (parallelised, ~12 h/batch) introduced Apr 9; all sites restored Apr 18. RPO met — data loss capped at ~5 minutes before deletion for most customers.',
    },
    traffic: { requestRateRps: 1.4 },
    recommendedClient: {
      maxRetries: 5,
      retryMode: 'exponential',
      retryDelayMs: 300,
      retryExpoMultiplier: 2,
      retryJitter: true,
      maxHedges: 0,
      hedgeDelayMs: 1000,
      circuitBreakerEnabled: true,
      circuitBreakerThreshold: 5,
      circuitBreakerResetMs: 15000,
    },
    timeline: [
      {
        name: 'Deletion script execution',
        durationSec: 30,
        color: '#9B2C2C',
        phaseContext:
          'Equivalent to 07:38–08:01 UTC: cascading site deletions, no automated detection triggered.',
        chaosRules: [
          { type: 'failRandomly', rate: 0.9 },
          { type: 'latency', ms: 500 },
        ],
      },
      {
        name: 'Incident triage & containment',
        durationSec: 35,
        color: '#C05621',
        phaseContext:
          'Major incident declared, scope assessed, bulk deletes blocked, restoration approach identified.',
        chaosRules: [
          { type: 'failRandomly', rate: 0.55 },
          { type: 'throttle', rate: 2048 },
          { type: 'latencyRange', minMs: 250, maxMs: 1000 },
        ],
      },
      {
        name: 'Restoration wave 1 (sequential)',
        durationSec: 40,
        color: '#D69E2E',
        trafficOverride: { requestRateRps: 1.0 },
        phaseContext:
          'Equivalent to Restoration 1: ~70 sequential steps, ~48 h per batch, covering 53% of impacted users.',
        chaosRules: [
          { type: 'failRandomly', rate: 0.25 },
          { type: 'latency', ms: 260 },
        ],
      },
      {
        name: 'Restoration wave 2 (accelerated)',
        durationSec: 40,
        color: '#2B6CB0',
        phaseContext:
          'Equivalent to Restoration 2: parallelised with original identifiers reused, ~12 h per batch.',
        chaosRules: [
          { type: 'failRandomly', rate: 0.12 },
          { type: 'latency', ms: 160 },
        ],
      },
      {
        name: 'Post-restore stabilisation',
        durationSec: 20,
        color: '#276749',
        phaseContext:
          'Final validation complete, all sites returned to customers, service normal.',
        chaosRules: [
          { type: 'failRandomly', rate: 0.02 },
          { type: 'latency', ms: 90 },
        ],
      },
    ],
  },

  {
    meta: {
      id: 'aws-us-east-1-2021-12-07',
      name: 'AWS US-EAST-1 — Internal Network Congestion',
      description:
        'An automated capacity scaling activity triggered a connection storm from internal clients, overwhelming routing between AWS internal and main networks and cascading into control-plane impairment.',
      source: 'https://aws.amazon.com/message/12721/',
      tags: ['aws', 'network', 'congestion', 'control-plane', 'retry-storm'],
      occurredAt: '2021-12-07T15:30:00Z',
      historicalContext:
        'Onset at 07:30 AM PST (15:30 UTC): automated scaling triggered unexpected surge of reconnect attempts from internal clients, saturating the bridge between AWS internal and main networks. Monitoring went dark immediately, slowing diagnosis. DNS traffic rerouted 09:28 AM PST giving partial relief. Significant congestion improvement 01:34 PM PST; full network device recovery 02:22 PM PST. API Gateway and STS tail not clear until 04:28–04:37 PM PST. Classic thundering-herd cascade worsened by clients lacking adequate back-off.',
    },
    traffic: { requestRateRps: 3.2 },
    recommendedClient: {
      maxRetries: 3,
      retryMode: 'exponential',
      retryDelayMs: 400,
      retryExpoMultiplier: 2.5,
      retryJitter: true,
      maxHedges: 0,
      hedgeDelayMs: 1000,
      circuitBreakerEnabled: true,
      circuitBreakerThreshold: 8,
      circuitBreakerResetMs: 12000,
    },
    timeline: [
      {
        name: 'Congestion onset (retry storm)',
        durationSec: 30,
        color: '#7B341E',
        trafficOverride: { requestRateRps: 4.8 },
        phaseContext:
          'Equivalent to 07:30–07:33 AM PST: scaling seeds exponential connection storm; latency and errors spike; monitoring goes dark.',
        chaosRules: [
          { type: 'latencyRange', minMs: 300, maxMs: 1200 },
          { type: 'failRandomly', rate: 0.45 },
        ],
      },
      {
        name: 'Blind triage (monitoring impaired)',
        durationSec: 45,
        color: '#C53030',
        phaseContext:
          'Equivalent to 07:33–09:28 AM PST: engineers diagnosing with logs only; DNS errors identified; control-plane APIs heavily erroring.',
        chaosRules: [
          { type: 'failRandomly', rate: 0.6 },
          { type: 'latency', ms: 700 },
          { type: 'throttle', rate: 2048 },
        ],
      },
      {
        name: 'DNS mitigation — partial relief',
        durationSec: 40,
        color: '#C05621',
        phaseContext:
          'Equivalent to 09:28 AM–01:34 PM PST: DNS rerouted, some services improve, congestion still present, deployment systems slow.',
        chaosRules: [
          { type: 'failRandomly', rate: 0.3 },
          { type: 'latencyRange', minMs: 180, maxMs: 600 },
          { type: 'rateLimit', limit: 2, windowMs: 1000, retryAfterMs: 2000 },
        ],
      },
      {
        name: 'Network device recovery',
        durationSec: 35,
        color: '#2B6CB0',
        phaseContext:
          'Equivalent to 01:34–02:22 PM PST: network congestion clears; EC2, ELB, Console recover; API Gateway and STS still catching up.',
        chaosRules: [
          { type: 'failRandomly', rate: 0.12 },
          { type: 'latency', ms: 220 },
        ],
      },
      {
        name: 'Full service restoration',
        durationSec: 25,
        color: '#276749',
        phaseContext:
          'Equivalent to 04:28–04:37 PM PST and beyond: STS and API Gateway stabilised, service fully healthy.',
        chaosRules: [
          { type: 'failRandomly', rate: 0.02 },
          { type: 'latency', ms: 80 },
        ],
      },
    ],
  },

  // ── Rate-Limiting Focused Scenarios ──────────────────────────────────────

  {
    meta: {
      id: 'twitter-2023-07-01-rate-limits',
      name: 'Twitter/X — Emergency Read Rate Limits',
      description:
        'Elon Musk imposed emergency API read rate limits to combat AI data scraping, cutting unverified users to 600 reads/day and locking out thousands of third-party apps worldwide.',
      source:
        'https://www.theverge.com/2023/7/1/23781198/twitter-daily-reading-limit-elon-musk-verified-paywall',
      tags: ['rate-limiting', 'api', 'social-media', 'intentional'],
      occurredAt: '2023-07-01T00:00:00Z',
      historicalContext:
        'Effective July 1 2023, Musk imposed emergency read rate limits citing "extreme levels of data scraping" by AI companies. Unverified accounts were limited to 600 posts/day (later 1000), verified Twitter Blue to 6000 (later 10000), enterprise to 100000. Many users hit the wall mid-session and were shown only a "Rate Limit Exceeded" message. TweetDeck, third-party clients, and monitoring bots went dark instantly. The limits were partially walked back within 24 h but confirmed that the API was no longer a public utility.',
    },
    traffic: { requestRateRps: 3.0 },
    recommendedClient: {
      maxRetries: 4,
      retryMode: 'exponential',
      retryDelayMs: 1000,
      retryExpoMultiplier: 2.0,
      retryJitter: true,
      maxHedges: 0,
      hedgeDelayMs: 1000,
      circuitBreakerEnabled: true,
      circuitBreakerThreshold: 5,
      circuitBreakerResetMs: 15000,
    },
    timeline: [
      {
        name: 'Normal unrestricted access',
        durationSec: 20,
        color: '#276749',
        phaseContext: 'Full API access before limits were announced.',
        chaosRules: [{ type: 'latency', ms: 80 }],
      },
      {
        name: 'Emergency limits imposed',
        durationSec: 55,
        color: '#C53030',
        trafficOverride: { requestRateRps: 4.0 },
        phaseContext:
          'Hard per-account read limits go live simultaneously across all API endpoints. 429 responses dominate; Retry-After headers set for 15-minute windows.',
        chaosRules: [
          { type: 'rateLimit', limit: 2, windowMs: 4000, retryAfterMs: 2500 },
          { type: 'latency', ms: 150 },
        ],
      },
      {
        name: 'Uneven enforcement across edge nodes',
        durationSec: 55,
        color: '#9B2C2C',
        phaseContext:
          'Limits roll out unevenly across CDN edge nodes. Some edges return 429, others still serve normally. The mix of successes and failures confuses clients into immediate retries.',
        chaosRules: [
          { type: 'rateLimit', limit: 3, windowMs: 5000, retryAfterMs: 2000 },
          { type: 'failRandomly', rate: 0.25 },
          { type: 'latency', ms: 200 },
        ],
      },
      {
        name: 'Threshold raised — limited normal',
        durationSec: 40,
        color: '#2B6CB0',
        phaseContext:
          'July 2: limits raised to 1000/10000 reads/day. API functional again for most users but bots and data-heavy apps remain throttled.',
        chaosRules: [
          { type: 'rateLimit', limit: 5, windowMs: 5000, retryAfterMs: 1000 },
          { type: 'latency', ms: 90 },
        ],
      },
    ],
  },

  {
    meta: {
      id: 'reddit-2023-07-01-api-cutover',
      name: 'Reddit — API Pricing Hard Cutover',
      description:
        "Reddit's new paid API tier went live, instantly killing free access for third-party apps and triggering a thundering herd of 429s as clients hammered the strict new per-minute rate limits.",
      source: 'https://www.redditinc.com/blog/api-terms-update',
      tags: ['rate-limiting', 'api', 'migration', 'third-party-apps'],
      occurredAt: '2023-07-01T00:00:00Z',
      historicalContext:
        'Reddit announced paid API tiers on May 31 2023 ($0.24 per 1000 calls), effective July 1. The new free tier limit was 100 queries/minute with no bulk access. Hundreds of subreddits held a blackout in protest (June 12–14). When the cutover hit on July 1, major third-party apps — Apollo, Reddit is Fun, Narwhal — immediately began throwing errors. Bot-heavy clients without updated back-off logic hammered the new limits, flooding Reddit\'s edge with a torrent of 429 responses and worsening the situation for legitimate callers.',
    },
    traffic: { requestRateRps: 3.5 },
    recommendedClient: {
      maxRetries: 3,
      retryMode: 'exponential',
      retryDelayMs: 600,
      retryExpoMultiplier: 2.5,
      retryJitter: true,
      maxHedges: 0,
      hedgeDelayMs: 1000,
      circuitBreakerEnabled: true,
      circuitBreakerThreshold: 4,
      circuitBreakerResetMs: 12000,
    },
    timeline: [
      {
        name: 'Pre-cutover free access',
        durationSec: 15,
        color: '#276749',
        phaseContext: 'Legacy unlimited API still active. Apps operating normally.',
        chaosRules: [{ type: 'latency', ms: 70 }],
      },
      {
        name: 'Cutover — coarse limits applied',
        durationSec: 40,
        color: '#D69E2E',
        phaseContext:
          'API switches to new rate tiers. Apps that pre-upgraded to the paid tier see a loose limit; free-tier apps start encountering 429s.',
        chaosRules: [
          { type: 'rateLimit', limit: 5, windowMs: 5000, retryAfterMs: 1500 },
          { type: 'latency', ms: 100 },
        ],
      },
      {
        name: 'Strict rate limits fully enforced',
        durationSec: 55,
        color: '#C53030',
        trafficOverride: { requestRateRps: 5.0 },
        phaseContext:
          'Full enforcement of 100 req/min per client. Unprepared apps retry immediately, burning their rate budget faster and generating even more 429s.',
        chaosRules: [
          { type: 'rateLimit', limit: 2, windowMs: 4000, retryAfterMs: 2000 },
          { type: 'latency', ms: 180 },
        ],
      },
      {
        name: 'Thundering herd from naive retries',
        durationSec: 40,
        color: '#9B2C2C',
        phaseContext:
          'Clients without exponential back-off hammer the API. Infrastructure tightens limits further and starts returning sporadic 5xx for overloaded quota buckets.',
        chaosRules: [
          { type: 'rateLimit', limit: 2, windowMs: 4000, retryAfterMs: 3000 },
          { type: 'failRandomly', rate: 0.3 },
          { type: 'latency', ms: 200 },
        ],
      },
      {
        name: 'Stabilised under new limits',
        durationSec: 25,
        color: '#2B6CB0',
        phaseContext:
          'Remaining apps adapt or shut down. API stable, permanently capped for all callers.',
        chaosRules: [
          { type: 'rateLimit', limit: 4, windowMs: 4000, retryAfterMs: 1500 },
          { type: 'latency', ms: 90 },
        ],
      },
    ],
  },

  {
    meta: {
      id: 'stripe-2019-09-20-api-degradation',
      name: 'Stripe — API Degradation & Protective Throttling',
      description:
        "A database leader-election event triggered elevated payment API errors. Stripe's edge shifted into protective load-shedding mode, returning 429s to high-volume callers to prevent full saturation.",
      source: 'https://status.stripe.com/',
      tags: ['rate-limiting', 'payments', 'api', 'degradation', 'load-shedding'],
      occurredAt: '2019-09-20T14:00:00Z',
      historicalContext:
        "On September 20 2019, Stripe experienced a ~33-minute window of elevated payment API errors following an unplanned database leader election. As error rates climbed, Stripe's edge load balancers began shedding traffic for callers above a per-key request threshold, returning 429 Retry-After responses rather than letting errors cascade to every client. Time-critical operations (charges, refunds) experienced both latency spikes and intermittent 429s. Customers without proper back-off logic responded with cascading retries that worsened throughput for everyone. Service was fully restored at 14:33 UTC.",
    },
    traffic: { requestRateRps: 2.5 },
    recommendedClient: {
      maxRetries: 3,
      retryMode: 'exponential',
      retryDelayMs: 400,
      retryExpoMultiplier: 2.0,
      retryJitter: true,
      maxHedges: 1,
      hedgeDelayMs: 350,
      circuitBreakerEnabled: true,
      circuitBreakerThreshold: 4,
      circuitBreakerResetMs: 10000,
    },
    timeline: [
      {
        name: 'Normal payment processing',
        durationSec: 20,
        color: '#276749',
        phaseContext: 'API healthy. Payment charges and refunds processing normally.',
        chaosRules: [{ type: 'latency', ms: 60 }],
      },
      {
        name: 'Database failover — latency spike',
        durationSec: 30,
        color: '#D69E2E',
        phaseContext:
          'Database leader election in progress. Queries queue behind the new leader. Response times climb significantly.',
        chaosRules: [
          { type: 'latencyRange', minMs: 150, maxMs: 600 },
          { type: 'failRandomly', rate: 0.1 },
        ],
      },
      {
        name: 'Error peak — edge starts load shedding',
        durationSec: 50,
        color: '#C53030',
        trafficOverride: { requestRateRps: 3.5 },
        phaseContext:
          'Stripe edge detects unsafe error rate and applies protective load-shedding. Per-API-key rate limits enforced; 429 with Retry-After returned to heavy callers.',
        chaosRules: [
          { type: 'rateLimit', limit: 3, windowMs: 4000, retryAfterMs: 2000 },
          { type: 'failRandomly', rate: 0.35 },
          { type: 'latency', ms: 250 },
        ],
      },
      {
        name: 'Partial DB recovery — limits persist',
        durationSec: 40,
        color: '#9B2C2C',
        phaseContext:
          'Database stable but edge keeps load-shedding active while traffic normalises. Clients without back-off continue burning their rate quota.',
        chaosRules: [
          { type: 'rateLimit', limit: 2, windowMs: 3000, retryAfterMs: 2000 },
          { type: 'failRandomly', rate: 0.15 },
          { type: 'latency', ms: 180 },
        ],
      },
      {
        name: 'Full service restoration',
        durationSec: 25,
        color: '#276749',
        phaseContext: 'Load-shedding lifted, error rates nominal, all payment endpoints healthy.',
        chaosRules: [
          { type: 'latency', ms: 70 },
          { type: 'failRandomly', rate: 0.01 },
        ],
      },
    ],
  },

  {
    meta: {
      id: 'github-2021-09-secondary-rate-limits',
      name: 'GitHub REST API — Secondary Rate Limits Rollout',
      description:
        'GitHub silently introduced undocumented secondary rate limits targeting burst patterns and concurrent requests, breaking automation pipelines and CI workflows that were comfortably within primary hourly quotas.',
      source: 'https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api',
      tags: ['rate-limiting', 'api', 'github', 'automation', 'secondary-limits'],
      occurredAt: '2021-09-01T00:00:00Z',
      historicalContext:
        'In September 2021 GitHub began enforcing secondary rate limits on the REST API without prominent advance notice. Unlike primary limits (5000 req/hr per token), secondary limits targeted concurrent connections, per-second burst rate, and content-creation endpoints regardless of hourly quota remaining. CI pipelines, automated release tooling, and bots began receiving 429 responses mid-run with opaque error messages offering little remediation guidance. GitHub later documented the limits and recommended serialisation, jittered back-off, and reducing parallelism. The rollout effectively penalised any well-written, high-throughput automation that had been operating safely under the primary quota.',
    },
    traffic: { requestRateRps: 3.0 },
    recommendedClient: {
      maxRetries: 5,
      retryMode: 'exponential',
      retryDelayMs: 800,
      retryExpoMultiplier: 2.0,
      retryJitter: true,
      maxHedges: 0,
      hedgeDelayMs: 1000,
      circuitBreakerEnabled: true,
      circuitBreakerThreshold: 6,
      circuitBreakerResetMs: 20000,
    },
    timeline: [
      {
        name: 'Automation baseline',
        durationSec: 20,
        color: '#276749',
        phaseContext:
          'CI pipelines and release bots running normally within primary quota. All requests succeed.',
        chaosRules: [{ type: 'latency', ms: 90 }],
      },
      {
        name: 'New secondary limits silently active',
        durationSec: 50,
        color: '#D69E2E',
        trafficOverride: { requestRateRps: 4.5 },
        phaseContext:
          'Secondary limits now enforced for burst patterns. Concurrent API calls start returning 429. Primary quota shows plenty of headroom, so callers immediately retry — worsening the burst.',
        chaosRules: [
          { type: 'rateLimit', limit: 3, windowMs: 3000, retryAfterMs: 1500 },
          { type: 'latency', ms: 120 },
        ],
      },
      {
        name: 'Cascade — retries consume burst budget',
        durationSec: 65,
        color: '#C53030',
        trafficOverride: { requestRateRps: 5.0 },
        phaseContext:
          'Automated clients retry 429s without back-off. Each retry is itself a burst, draining the secondary window budget instantly. Entire pipeline stalls while primary quota looks fine.',
        chaosRules: [
          { type: 'rateLimit', limit: 2, windowMs: 4000, retryAfterMs: 3000 },
          { type: 'failRandomly', rate: 0.2 },
          { type: 'latency', ms: 200 },
        ],
      },
      {
        name: 'Pipelines adopt jittered back-off',
        durationSec: 35,
        color: '#2B6CB0',
        phaseContext:
          'Teams serialise API calls and add jittered exponential back-off. Rate-limit pressure drops. 429s still present but throughput recovers.',
        chaosRules: [
          { type: 'rateLimit', limit: 4, windowMs: 4000, retryAfterMs: 1500 },
          { type: 'latency', ms: 100 },
        ],
      },
    ],
  },

  {
    meta: {
      id: 'npm-2020-11-registry-outage',
      name: 'npm Registry — CDN Failure & Throttled Recovery',
      description:
        'A CDN misconfiguration flushed global caches, overwhelming the npm registry origin and causing a full outage. Recovery was staged behind strict rate limits to prevent a thundering-herd re-surge.',
      source: 'https://status.npmjs.org/',
      tags: ['npm', 'registry', 'cdn', 'cascading', 'rate-limiting'],
      occurredAt: '2020-11-04T09:00:00Z',
      historicalContext:
        "In November 2020 the npm registry experienced a significant outage stemming from a CDN configuration change that invalidated cache entries globally. Origin servers were overwhelmed by the resulting miss storm, causing full request failure worldwide. Once the CDN issue was corrected, npm's recovery team brought traffic back progressively — applying strict per-IP rate limits to prevent all queued CI pipelines from hitting the origin simultaneously. The throttled ramp-up meant the registry appeared online but continued returning 429s for several hours, confusing engineering teams who had assumed the outage was still ongoing.",
    },
    traffic: { requestRateRps: 3.0 },
    recommendedClient: {
      maxRetries: 5,
      retryMode: 'exponential',
      retryDelayMs: 1000,
      retryExpoMultiplier: 2.5,
      retryJitter: true,
      maxHedges: 0,
      hedgeDelayMs: 1000,
      circuitBreakerEnabled: true,
      circuitBreakerThreshold: 3,
      circuitBreakerResetMs: 20000,
    },
    timeline: [
      {
        name: 'Registry healthy',
        durationSec: 15,
        color: '#276749',
        phaseContext: 'CDN caches warm. Installs fast and reliable.',
        chaosRules: [{ type: 'latency', ms: 60 }],
      },
      {
        name: 'CDN cache invalidation — cold-miss surge',
        durationSec: 25,
        color: '#D69E2E',
        phaseContext:
          'CDN config deployed, caches flushed globally. Cold-miss traffic hits origin. Latency climbs and intermittent errors begin.',
        chaosRules: [
          { type: 'latencyRange', minMs: 200, maxMs: 900 },
          { type: 'failRandomly', rate: 0.2 },
        ],
      },
      {
        name: 'Full registry outage',
        durationSec: 40,
        color: '#742A2A',
        phaseContext:
          'Origin capacity exhausted under the miss storm. All registry requests return 503. npm installs and publishes blocked worldwide.',
        chaosRules: [{ type: 'fail' }],
      },
      {
        name: 'Throttled recovery — strict rate limits',
        durationSec: 50,
        color: '#9B2C2C',
        phaseContext:
          'CDN fix deployed. npm brings traffic back behind strict per-IP rate limits to prevent a thundering herd re-saturating the origin. Callers see 429 instead of 503 — pipelines remain blocked.',
        chaosRules: [
          { type: 'rateLimit', limit: 2, windowMs: 5000, retryAfterMs: 3000 },
          { type: 'failRandomly', rate: 0.2 },
          { type: 'latency', ms: 300 },
        ],
      },
      {
        name: 'Gradual normalisation',
        durationSec: 40,
        color: '#2B6CB0',
        phaseContext:
          'Rate limits relaxed progressively as origin capacity is confirmed stable. Most CI pipelines unblock but throughput is still throttled.',
        chaosRules: [
          { type: 'rateLimit', limit: 5, windowMs: 5000, retryAfterMs: 1500 },
          { type: 'latency', ms: 120 },
        ],
      },
    ],
  },
]
