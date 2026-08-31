import http from 'k6/http';
import { check } from 'k6';

const DESCRIPTIONS = ['Groceries', 'Uber ride', 'Coffee', 'Movie tickets', 'Electricity bill', 'Lunch', 'Gym membership', 'Books', 'Flight ticket', 'Phone recharge'];
const JSON_HEADERS = { 'Content-Type': 'application/json' };

function randomItem(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function randomDateWithinDays(days) {
  const d = new Date();
  d.setDate(d.getDate() - Math.floor(Math.random() * days));
  return d.toISOString().slice(0, 10);
}

function randomAmount() {
  return Math.round((Math.random() * 5000 + 50) * 100) / 100;
}

// One iteration of realistic + deliberately-invalid traffic, run by a VU that
// already has a valid session cookie (see load-signup.js / load-seeded.js).
// Weights mirror claude-phase-4.md §5, adapted to this app's real API:
// cookie auth (not Bearer), camelCase body fields, and the actual validation
// messages/status codes from expense-backend-v1/src/routes/expenses.js.
export function runMix(apiBase, categories) {
  const roll = Math.random();
  const categoryId = categories.length > 0 ? randomItem(categories).id : 1;

  if (roll < 0.30) {
    const res = http.get(`${apiBase}/expenses`, { headers: JSON_HEADERS });
    check(res, { 'list expenses: 200': (r) => r.status === 200 });
  } else if (roll < 0.55) {
    const res = http.post(`${apiBase}/expenses`, JSON.stringify({
      amount: randomAmount(),
      categoryId,
      description: randomItem(DESCRIPTIONS),
      expenseDate: randomDateWithinDays(30),
    }), { headers: JSON_HEADERS });
    check(res, { 'create expense: 201': (r) => r.status === 201 });
  } else if (roll < 0.70) {
    const res = http.get(`${apiBase}/expenses/summary`, { headers: JSON_HEADERS });
    check(res, { 'summary: 200': (r) => r.status === 200 });
  } else if (roll < 0.80) {
    const res = http.get(`${apiBase}/categories`, { headers: JSON_HEADERS });
    check(res, { 'categories: 200': (r) => r.status === 200 });
  } else if (roll < 0.85) {
    // Integer categoryId, but one that can't belong to anyone — passes the
    // Number.isInteger check, fails the DB lookup. Expected 400, not a bug.
    const res = http.post(`${apiBase}/expenses`, JSON.stringify({
      amount: randomAmount(),
      categoryId: 999999,
      expenseDate: randomDateWithinDays(30),
    }), { headers: JSON_HEADERS });
    check(res, { 'bad category: 400': (r) => r.status === 400 });
  } else if (roll < 0.90) {
    const res = http.post(`${apiBase}/expenses`, JSON.stringify({
      amount: randomAmount(),
      categoryId,
      expenseDate: 'not-a-date',
    }), { headers: JSON_HEADERS });
    check(res, { 'bad date: 400': (r) => r.status === 400 });
  } else if (roll < 0.95) {
    const res = http.post(`${apiBase}/expenses`, JSON.stringify({
      amount: -5,
      categoryId,
      expenseDate: randomDateWithinDays(30),
    }), { headers: JSON_HEADERS });
    check(res, { 'bad amount: 400': (r) => r.status === 400 });
  } else {
    // Bad auth: an explicit garbage session cookie for just this one request.
    // `params.cookies` overrides the VU's real jar for this call only — the
    // valid session every other branch relies on is untouched.
    const res = http.get(`${apiBase}/expenses`, {
      headers: JSON_HEADERS,
      cookies: { expense_token: 'invalid.token.here' },
    });
    check(res, { 'bad auth: 401': (r) => r.status === 401 });
  }
}
