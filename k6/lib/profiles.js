// Load profiles from claude-phase-4.md §4 — selected at runtime via the
// PROFILE env var so load-signup.js/load-seeded.js don't need to be
// duplicated per profile: `k6 run -e PROFILE=spike load-seeded.js`.
//
// Every profile below except `burst` uses k6's default ramping-vus executor
// (plain `stages`), which *ramps* toward its target — even `spike` climbs
// 10→100 over 20s, not instantly. None of them start VUs simultaneously.
export const STAGE_PROFILES = {
  // Confirm the pipeline works end-to-end before running anything heavier.
  baseline: [
    { duration: '30s', target: 5 },
    { duration: '2m', target: 10 },
    { duration: '30s', target: 0 },
  ],
  // Sustained load — the profile that matters for SLO/burn-rate work later;
  // a short spike can't demonstrate fast- vs slow-burn behavior.
  soak: [
    { duration: '2m', target: 30 },
    { duration: '25m', target: 30 },
    { duration: '2m', target: 0 },
  ],
  // Visible climb in Grafana rather than jumping straight to peak load.
  ramp: [
    { duration: '5m', target: 100 },
    { duration: '5m', target: 100 },
    { duration: '3m', target: 0 },
  ],
  // Sudden jump to the 100-VU ceiling — stresses the MySQL connection pool
  // (DB_POOL_SIZE=10 in docker-compose.yml) on purpose; most likely profile
  // to actually break something. Still a 20s ramp under the hood, not
  // instant — use `burst` below for genuinely simultaneous VU start.
  spike: [
    { duration: '30s', target: 10 },
    { duration: '20s', target: 100 },
    { duration: '1m', target: 100 },
    { duration: '30s', target: 10 },
  ],
};

// Not in claude-phase-4.md §4 — added because the ramping-vus executor above
// can't produce true "N requests fired at the same instant" traffic, only
// "N VUs added over a ramp window." `per-vu-iterations` spins up all VUs
// together and starts their first iteration (signup, in load-signup.js) as
// close to simultaneously as k6's scheduler allows. Tunable via env vars
// since a one-shot burst doesn't fit the duration/target stage shape:
// BURST_VUS (default 100), BURST_ITERATIONS (default 3), BURST_MAX_DURATION.
function burstScenario() {
  return {
    scenarios: {
      burst: {
        executor: 'per-vu-iterations',
        vus: Number(__ENV.BURST_VUS || 100),
        iterations: Number(__ENV.BURST_ITERATIONS || 3),
        maxDuration: __ENV.BURST_MAX_DURATION || '2m',
      },
    },
  };
}

// Returns the `options` fragment for the given PROFILE — either
// `{ stages }` (ramping-vus, the 4 profiles above) or `{ scenarios }`
// (burst). Spread the result into `options` in the entry script.
export function optionsForProfile(name) {
  if (name === 'burst') return burstScenario();
  const stages = STAGE_PROFILES[name];
  if (!stages) {
    throw new Error(`Unknown PROFILE "${name}" — expected one of: ${[...Object.keys(STAGE_PROFILES), 'burst'].join(', ')}`);
  }
  return { stages };
}
