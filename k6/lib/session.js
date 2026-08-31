import http from 'k6/http';
import { check } from 'k6';

// AUTH_MODE=cookie (expense-backend-v1/src/middleware/auth.js) — signup/signin
// set an httpOnly `expense_token` cookie, no JWT in the response body.
//
// k6's automatic per-VU cookie jar only persists *within* a single
// iteration — confirmed empirically running load-signup.js: every VU's very
// first request after signup succeeded, and every request in every later
// iteration of that same VU got 401, exactly the shape of "jar reset between
// iterations." So the cookie is captured here and threaded through
// explicitly as a `Cookie` header on every request instead — the same
// approach seed-data/*.js already uses (plain Node has no jar at all).

const JSON_HEADERS = { 'Content-Type': 'application/json' };
const COOKIE_NAME = 'expense_token';

function cookieHeaderFrom(res) {
  const jar = res.cookies && res.cookies[COOKIE_NAME];
  if (!jar || jar.length === 0) return null;
  return `${COOKIE_NAME}=${jar[0].value}`;
}

export function signup(apiBase, email, password, displayName) {
  const res = http.post(
    `${apiBase}/auth/signup`,
    JSON.stringify({ email, password, displayName }),
    { headers: JSON_HEADERS }
  );
  return { res, cookieHeader: cookieHeaderFrom(res) };
}

export function signin(apiBase, email, password) {
  const res = http.post(
    `${apiBase}/auth/signin`,
    JSON.stringify({ email, password }),
    { headers: JSON_HEADERS }
  );
  return { res, cookieHeader: cookieHeaderFrom(res) };
}

export function loadCategories(apiBase, cookieHeader) {
  const res = http.get(`${apiBase}/categories`, {
    headers: { ...JSON_HEADERS, Cookie: cookieHeader },
  });
  check(res, { 'categories loaded': (r) => r.status === 200 });
  return res.json();
}
