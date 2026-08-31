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
// already has a valid session (see load-signup.js / load-seeded.js).
// `cookieHeader` is the literal `expense_token=...` string captured at
// signup/signin time — see lib/session.js for why it's passed explicitly
// rather than relying on k6's automatic jar. Weights mirror
// claude-phase-4.md §5, adapted to this app's real API: cookie auth (not
// Bearer), camelCase body fields, and the actual validation
// messages/status codes from expense-backend-v1/src/routes/expenses.js.
export function runMix(apiBase, categories, cookieHeader) {
  const roll = Math.random();
  const categoryId = categories.length > 0 ? randomItem(categories).id : 1;
  const headers = { ...JSON_HEADERS, Cookie: cookieHeader };

  if (roll < 0.30) {
    const res = http.get(`${apiBase}/expenses`, { headers });
    check(res, { 'list expenses: 200': (r) => r.status === 200 });
  } else if (roll < 0.55) {
    const res = http.post(`${apiBase}/expenses`, JSON.stringify({
      amount: randomAmount(),
      categoryId,
      description: randomItem(DESCRIPTIONS),
      expenseDate: randomDateWithinDays(30),
    }), { headers });
    check(res, { 'create expense: 201': (r) => r.status === 201 });
  } else if (roll < 0.70) {
    const res = http.get(`${apiBase}/expenses/summary`, { headers });
    check(res, { 'summary: 200': (r) => r.status === 200 });
  } else if (roll < 0.80) {
    const res = http.get(`${apiBase}/categories`, { headers });
    check(res, { 'categories: 200': (r) => r.status === 200 });
  } else if (roll < 0.85) {
    // Integer categoryId, but one that can't belong to anyone — passes the
    // Number.isInteger check, fails the DB lookup. Expected 400, not a bug.
    const res = http.post(`${apiBase}/expenses`, JSON.stringify({
      amount: randomAmount(),
      categoryId: 999999,
      expenseDate: randomDateWithinDays(30),
    }), { headers });
    check(res, { 'bad category: 400': (r) => r.status === 400 });
  } else if (roll < 0.90) {
    const res = http.post(`${apiBase}/expenses`, JSON.stringify({
      amount: randomAmount(),
      categoryId,
      expenseDate: 'not-a-date',
    }), { headers });
    check(res, { 'bad date: 400': (r) => r.status === 400 });
  } else if (roll < 0.95) {
    const res = http.post(`${apiBase}/expenses`, JSON.stringify({
      amount: -5,
      categoryId,
      expenseDate: randomDateWithinDays(30),
    }), { headers });
    check(res, { 'bad amount: 400': (r) => r.status === 400 });
  } else {
    // Bad auth: a garbage session cookie for just this one request — the
    // valid cookieHeader every other branch uses is untouched.
    const res = http.get(`${apiBase}/expenses`, {
      headers: { ...JSON_HEADERS, Cookie: 'expense_token=invalid.token.here' },
    });
    check(res, { 'bad auth: 401': (r) => r.status === 401 });
  }
}
