// Load profiles from claude-phase-4.md §4 — selected at runtime via the
// PROFILE env var so load-signup.js/load-seeded.js don't need to be
// duplicated per profile: `k6 run -e PROFILE=spike load-seeded.js`.
export const PROFILES = {
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
  // to actually break something.
  spike: [
    { duration: '30s', target: 10 },
    { duration: '20s', target: 100 },
    { duration: '1m', target: 100 },
    { duration: '30s', target: 10 },
  ],
};

export function stagesForProfile(name) {
  const stages = PROFILES[name];
  if (!stages) {
    throw new Error(`Unknown PROFILE "${name}" — expected one of: ${Object.keys(PROFILES).join(', ')}`);
  }
  return stages;
}
