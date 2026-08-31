// Seeded-users mode (claude-phase-4.md §3.2): a fixed pool of accounts is
// created once in setup() (idempotent — a 409 on repeat runs just means the
// account is already there, same pattern as seed-data/seed.js), then every
// VU signs in as one account chosen at random from that pool. Good for
// repeatable runs that don't grow the `users` table unboundedly, and for
// simulating returning users rather than only ever-growing signups.
//
// Run against the app's public URL, through nginx — never straight at
// `backend:4000` (see observability/k6/README.md):
//   k6 run -e BASE_URL=http://localhost -e PROFILE=baseline load-seeded.js

import { sleep } from 'k6';
import { stagesForProfile } from './lib/profiles.js';
import { signup, signin, loadCategories } from './lib/session.js';
import { runMix } from './lib/requestMix.js';

const BASE_URL = __ENV.BASE_URL || 'http://localhost';
const API_BASE = `${BASE_URL}/api`;
const PROFILE = __ENV.PROFILE || 'baseline';
const POOL_SIZE = Number(__ENV.POOL_SIZE || 20);

export const options = {
  stages: stagesForProfile(PROFILE),
  thresholds: {
    http_req_duration: ['p(95)<800'],
    // See load-signup.js for why http_req_failed is deliberately not here.
    checks: ['rate>0.95'],
  },
};

// Runs once, in a single VU, before any load stage starts (k6's setup() —
// not per-VU-iteration). Its return value is handed to every VU's default
// function as `data`.
export function setup() {
  const pool = [];
  for (let i = 1; i <= POOL_SIZE; i++) {
    const email = `k6-seeded-${i}@example.com`;
    const password = 'k6seededpass123';
    const res = signup(API_BASE, email, password, `K6 Seeded User ${i}`);
    if (res.status !== 201 && res.status !== 409) {
      throw new Error(`setup signup failed for ${email}: ${res.status} ${res.body}`);
    }
    pool.push({ email, password });
  }
  return { pool };
}

// Same "sign in once per VU, reuse for every later iteration" pattern as
// load-signup.js — see its comment for why module-scope state is enough.
let sessionReady = false;
let categories = [];
let cookieHeader = null;

function ensureSession(pool) {
  if (sessionReady) return;
  const account = pool[Math.floor(Math.random() * pool.length)];
  const { res, cookieHeader: ch } = signin(API_BASE, account.email, account.password);
  if (res.status !== 200) {
    throw new Error(`signin failed for ${account.email}: ${res.status} ${res.body}`);
  }
  if (!ch) {
    throw new Error(`signin for ${account.email} succeeded but set no session cookie`);
  }
  cookieHeader = ch;
  categories = loadCategories(API_BASE, cookieHeader);
  sessionReady = true;
}

export default function (data) {
  ensureSession(data.pool);
  runMix(API_BASE, categories, cookieHeader);
  sleep(0.5 + Math.random());
}
