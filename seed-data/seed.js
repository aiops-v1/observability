// Generates realistic traffic against the expense-tracker API so Prometheus/
// Grafana have something to show: signups, signins, expense create/edit/delete,
// spread over several rounds so rate()/histogram panels aren't flat.
//
// Run inside the same Docker network as the backend (see README.md), e.g.:
//   docker run --rm --network observability-net -v "$PWD:/app" -w /app node:20-alpine node seed.js

const BASE_URL = process.env.API_BASE_URL || 'http://backend:4000';
const NUM_USERS = Number(process.env.SEED_USERS || 5);
const EXPENSES_PER_ROUND = Number(process.env.SEED_EXPENSES_PER_ROUND || 4);
const ROUNDS = Number(process.env.SEED_ROUNDS || 10);
const DELAY_MS = Number(process.env.SEED_DELAY_MS || 3000);

const DESCRIPTIONS = ['Groceries', 'Uber ride', 'Coffee', 'Movie tickets', 'Electricity bill', 'Lunch', 'Gym membership', 'Books', 'Flight ticket', 'Phone recharge'];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function randomItem(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function randomDateWithinDays(days) {
  const d = new Date();
  d.setDate(d.getDate() - Math.floor(Math.random() * days));
  return d.toISOString().slice(0, 10);
}

class Session {
  constructor(email, password, displayName) {
    this.email = email;
    this.password = password;
    this.displayName = displayName;
    this.cookie = null;
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
    if (setCookie) {
      this.cookie = setCookie.split(';')[0];
    }

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

  async categories() {
    const { status, data } = await this.request('GET', '/categories');
    if (status !== 200) throw new Error(`GET /categories failed: ${status}`);
    return data;
  }

  async createExpense(categoryId) {
    const { status, data } = await this.request('POST', '/expenses', {
      amount: Math.round((Math.random() * 5000 + 50) * 100) / 100,
      categoryId,
      description: randomItem(DESCRIPTIONS),
      expenseDate: randomDateWithinDays(30),
    });
    if (status !== 201) throw new Error(`POST /expenses failed: ${status} ${JSON.stringify(data)}`);
    return data;
  }

  async editExpense(expense, categoryId) {
    const { status } = await this.request('PUT', `/expenses/${expense.id}`, {
      amount: Math.round((Math.random() * 5000 + 50) * 100) / 100,
      categoryId,
      description: randomItem(DESCRIPTIONS),
      expenseDate: randomDateWithinDays(30),
    });
    if (status !== 200) throw new Error(`PUT /expenses/${expense.id} failed: ${status}`);
  }

  async deleteExpense(expense) {
    const { status } = await this.request('DELETE', `/expenses/${expense.id}`);
    if (status !== 204) throw new Error(`DELETE /expenses/${expense.id} failed: ${status}`);
  }
}

async function main() {
  const users = Array.from({ length: NUM_USERS }, (_, i) => new Session(
    `seed-user-${i + 1}@example.com`,
    'seedpassword123',
    `Seed User ${i + 1}`,
  ));

  console.log(`Logging in ${users.length} users against ${BASE_URL}...`);
  for (const user of users) {
    await user.ensureLoggedIn();
  }

  for (let round = 1; round <= ROUNDS; round++) {
    console.log(`Round ${round}/${ROUNDS}`);
    for (const user of users) {
      const categories = await user.categories();
      const created = [];

      for (let i = 0; i < EXPENSES_PER_ROUND; i++) {
        const category = randomItem(categories);
        created.push(await user.createExpense(category.id));
      }

      // Edit about a third of what was just created, delete about a sixth.
      for (const expense of created) {
        const roll = Math.random();
        if (roll < 0.33) {
          const category = randomItem(categories);
          await user.editExpense(expense, category.id);
        } else if (roll < 0.5) {
          await user.deleteExpense(expense);
        }
      }
    }
    if (round < ROUNDS) await sleep(DELAY_MS);
  }

  console.log('Done. Give Prometheus a scrape interval or two, then check Grafana.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
