// Fresh-signup mode (claude-phase-4.md §3.1): every VU signs up as a
// brand-new user once, then runs the request mix. Good for exercising
// signup/auth under concurrency and for multi-tenant-shaped data (many
// distinct users) — the `users` table grows every run, unlike load-seeded.js.
//
// Run against the app's public URL, through nginx — never straight at
// `backend:4000` (see observability/k6/README.md):
//   k6 run -e BASE_URL=http://localhost -e PROFILE=baseline load-signup.js

import { sleep } from 'k6';
import exec from 'k6/execution';
import { stagesForProfile } from './lib/profiles.js';
import { signup, loadCategories } from './lib/session.js';
import { runMix } from './lib/requestMix.js';

const BASE_URL = __ENV.BASE_URL || 'http://localhost';
const API_BASE = `${BASE_URL}/api`;
const PROFILE = __ENV.PROFILE || 'baseline';

export const options = {
  stages: stagesForProfile(PROFILE),
  thresholds: {
    http_req_duration: ['p(95)<800'],
    // Deliberately no http_req_failed threshold: this mix sends real 400/401
    // requests on purpose (claude-phase-4.md §5), which k6 counts as
    // "failed" by default — `checks` (did each response match what was
    // *expected*) is the meaningful pass/fail signal here instead.
    checks: ['rate>0.95'],
  },
};

// Module-scope state persists across iterations of the same VU (k6 runs each
// VU as its own isolated JS instance) — this is what makes "sign up once,
// reuse the session for every later iteration" work without a setup()/data
// round-trip, per claude-phase-4.md §2.
let sessionReady = false;
let categories = [];

function ensureSession() {
  if (sessionReady) return;
  // Unique per VU per run, so re-running this script never collides with a
  // previous run's accounts.
  const email = `k6-signup-${exec.vu.idInTest}-${Date.now()}@example.com`;
  const res = signup(API_BASE, email, 'k6password123', `K6 Signup VU ${exec.vu.idInTest}`);
  if (res.status !== 201) {
    throw new Error(`signup failed for ${email}: ${res.status} ${res.body}`);
  }
  categories = loadCategories(API_BASE);
  sessionReady = true;
}

export default function () {
  ensureSession();
  runMix(API_BASE, categories);
  sleep(0.5 + Math.random());
}
