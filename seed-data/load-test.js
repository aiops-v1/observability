// Simulates LOAD_USERS concurrent users hitting the API with a weighted mix
// of actions (default: 75% create, 20% edit, 5% delete) — unlike seed.js,
// which runs users one round at a time, every user here runs its own
// independent loop concurrently via Promise.all, so Prometheus/Tempo see
// genuinely overlapping requests instead of a steady round-robin trickle.
// Good for exercising exemplars, concurrent-request behavior, and anything
// that only shows up under real parallel load.
//
// Run inside the same Docker network as the backend (see ./README.md), e.g.:
//   docker run --rm --network observability-net -v "$PWD:/app" -w /app node:20-alpine node load-test.js

const BASE_URL = process.env.API_BASE_URL || 'http://backend:4000';
const NUM_USERS = Number(process.env.LOAD_USERS || 50);
const ITERATIONS_PER_USER = Number(process.env.LOAD_ITERATIONS || 20);
const MIN_THINK_MS = Number(process.env.LOAD_MIN_THINK_MS || 300);
const MAX_THINK_MS = Number(process.env.LOAD_MAX_THINK_MS || 1500);

// Cumulative thresholds out of 100: create covers [0, CREATE_PCT), edit
// covers [CREATE_PCT, CREATE_PCT + EDIT_PCT), delete covers the rest.
const CREATE_PCT = Number(process.env.LOAD_CREATE_PCT || 75);
const EDIT_PCT = Number(process.env.LOAD_EDIT_PCT || 20);
// DELETE_PCT is implied (100 - CREATE_PCT - EDIT_PCT) — not read directly,
// kept only so the intent is visible alongside the other two.
const DELETE_PCT = Number(process.env.LOAD_DELETE_PCT || 5);

const DESCRIPTIONS = ['Groceries', 'Uber ride', 'Coffee', 'Movie tickets', 'Electricity bill', 'Lunch', 'Gym membership', 'Books', 'Flight ticket', 'Phone recharge'];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function randomItem(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function randomThinkTime() {
  return MIN_THINK_MS + Math.random() * (MAX_THINK_MS - MIN_THINK_MS);
}

function randomDateWithinDays(days) {
  const d = new Date();
  d.setDate(d.getDate() - Math.floor(Math.random() * days));
  return d.toISOString().slice(0, 10);
}

const stats = { create: 0, edit: 0, delete: 0, errors: 0 };

class Session {
  constructor(email, password, displayName) {
    this.email = email;
    this.password = password;
    this.displayName = displayName;
    this.cookie = null;
    this.categories = [];
    // Expenses this user has created and not yet deleted — edit/delete pick
    // from here, never from other users' data.
    this.myExpenses = [];
  }

  async request(method, path, body) {
    const res = await fetch(`${BASE_URL}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(this.cookie ? { Cookie: this.cookie } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    const setCookie = res.headers.get('set-cookie');
    if (setCookie) this.cookie = setCookie.split(';')[0];

    const text = await res.text();
    const data = text ? JSON.parse(text) : null;
    return { status: res.status, data };
  }

  async ensureLoggedIn() {
    const signup = await this.request('POST', '/auth/signup', {
      email: this.email,
      password: this.password,
      displayName: this.displayName,
    });
    if (signup.status === 201) return;

    const signin = await this.request('POST', '/auth/signin', {
      email: this.email,
      password: this.password,
    });
    if (signin.status !== 200) {
      throw new Error(`signin failed for ${this.email}: ${signin.status} ${JSON.stringify(signin.data)}`);
    }
  }

  async loadCategories() {
    const { status, data } = await this.request('GET', '/categories');
    if (status !== 200) throw new Error(`GET /categories failed: ${status}`);
    this.categories = data;
  }

  async create() {
    const category = randomItem(this.categories);
    const { status, data } = await this.request('POST', '/expenses', {
      amount: Math.round((Math.random() * 5000 + 50) * 100) / 100,
      categoryId: category.id,
      description: randomItem(DESCRIPTIONS),
      expenseDate: randomDateWithinDays(30),
    });
    if (status !== 201) throw new Error(`POST /expenses failed: ${status} ${JSON.stringify(data)}`);
    this.myExpenses.push(data);
    stats.create++;
  }

  async edit() {
    const expense = randomItem(this.myExpenses);
    const category = randomItem(this.categories);
    const { status } = await this.request('PUT', `/expenses/${expense.id}`, {
      amount: Math.round((Math.random() * 5000 + 50) * 100) / 100,
      categoryId: category.id,
      description: randomItem(DESCRIPTIONS),
      expenseDate: randomDateWithinDays(30),
    });
    if (status !== 200) throw new Error(`PUT /expenses/${expense.id} failed: ${status}`);
    stats.edit++;
  }

  async delete() {
    const index = Math.floor(Math.random() * this.myExpenses.length);
    const [expense] = this.myExpenses.splice(index, 1);
    const { status } = await this.request('DELETE', `/expenses/${expense.id}`);
    if (status !== 204) throw new Error(`DELETE /expenses/${expense.id} failed: ${status}`);
    stats.delete++;
  }

  async runLoop(iterations) {
    for (let i = 0; i < iterations; i++) {
      try {
        // Nothing to edit/delete yet (early iterations) — create instead of
        // erroring, so the weighting only applies once there's real data to
        // act on.
        const roll = Math.random() * 100;
        if (this.myExpenses.length === 0 || roll < CREATE_PCT) {
          await this.create();
        } else if (roll < CREATE_PCT + EDIT_PCT) {
          await this.edit();
        } else {
          await this.delete();
        }
      } catch (err) {
        stats.errors++;
        console.error(`[${this.email}] ${err.message}`);
      }
      await sleep(randomThinkTime());
    }
  }
}

async function main() {
  console.log(
    `Spinning up ${NUM_USERS} concurrent users against ${BASE_URL}, ` +
    `${ITERATIONS_PER_USER} actions each ` +
    `(${CREATE_PCT}% create / ${EDIT_PCT}% edit / ${DELETE_PCT}% delete)...`
  );

  const users = Array.from({ length: NUM_USERS }, (_, i) => new Session(
    `load-user-${i + 1}@example.com`,
    'loadpassword123',
    `Load User ${i + 1}`,
  ));

  // Login + category load run concurrently too — 50 simultaneous
  // signups/signins is itself part of the realistic load, not just setup.
  await Promise.all(users.map(async (user) => {
    await user.ensureLoggedIn();
    await user.loadCategories();
  }));

  console.log('All users logged in — starting concurrent action loops...');
  const start = Date.now();
  await Promise.all(users.map((user) => user.runLoop(ITERATIONS_PER_USER)));
  const durationSec = ((Date.now() - start) / 1000).toFixed(1);

  console.log(
    `Done in ${durationSec}s. ` +
    `create=${stats.create} edit=${stats.edit} delete=${stats.delete} errors=${stats.errors}`
  );
  console.log('Give Prometheus/Tempo a scrape interval or two, then check Grafana.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
