import http from 'k6/http';
import { check } from 'k6';

// AUTH_MODE=cookie (expense-backend-v1/src/middleware/auth.js) — signup/signin
// set an httpOnly `expense_token` cookie, no JWT in the response body. k6
// maintains one cookie jar per VU automatically, so nothing needs to be
// captured/replayed by hand here (unlike seed-data/*.js, which run in plain
// Node and do that manually).

const JSON_HEADERS = { 'Content-Type': 'application/json' };

export function signup(apiBase, email, password, displayName) {
  return http.post(
    `${apiBase}/auth/signup`,
    JSON.stringify({ email, password, displayName }),
    { headers: JSON_HEADERS }
  );
}

export function signin(apiBase, email, password) {
  return http.post(
    `${apiBase}/auth/signin`,
    JSON.stringify({ email, password }),
    { headers: JSON_HEADERS }
  );
}

export function loadCategories(apiBase) {
  const res = http.get(`${apiBase}/categories`, { headers: JSON_HEADERS });
  check(res, { 'categories loaded': (r) => r.status === 200 });
  return res.json();
}
