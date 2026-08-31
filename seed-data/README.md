# Seed data

`seed.js` drives the real API (signup/signin, create/edit/delete expenses)
across a handful of fake users, in rounds with a short delay between them, so
Prometheus's RED metrics and business counters have a non-flat history to
show in Grafana. No dependencies beyond Node's built-in `fetch` — plain
Node 18+.

Run it as a one-off container on the same network as the stack (`observability-net`,
set via `networks.default.name` in `../docker-compose.yml`), from the
`observability/` directory:

```
cd seed-data
docker run --rm --network observability-net -v "$PWD:/app" -w /app node:20-alpine node seed.js
```

Or, if you have Node installed locally and the backend port is reachable
(e.g. you're running the stack via `docker compose up` on the same host and
temporarily publish the backend port, or run this from inside another
container on the network):

```
API_BASE_URL=http://backend:4000 node seed.js
```

Tunables (env vars, all optional):

| Var | Default | Meaning |
|---|---|---|
| `API_BASE_URL` | `http://backend:4000` | backend base URL, reachable from wherever the script runs. Hits the backend directly, bypassing nginx — no `expense-frontend-nginx` span on the resulting traces. Set to `http://frontend/api` to route through nginx instead and get the full nginx→backend→mysql chain (still no browser span — that only exists in real browser JS). |
| `SEED_USERS` | `5` | number of fake users created/reused |
| `SEED_EXPENSES_PER_ROUND` | `4` | expenses created per user per round |
| `SEED_ROUNDS` | `10` | number of rounds |
| `SEED_DELAY_MS` | `3000` | delay between rounds, in ms |

Users are `seed-user-1@example.com` .. `seed-user-N@example.com` (password
`seedpassword123`) — the script signs them up on first run and signs in on
later runs, so it's safe to re-run.

After it finishes, wait a scrape interval or two (15s, per `prometheus.yml`)
and check:
- Prometheus (`:9090`) — `expenses_created_total`, `users_registered_total`, etc.
- Grafana (`:3000`) → Expense Tracker → "Expense Tracker Overview" dashboard.

## Concurrent load — `load-test.js`

`seed.js` runs users one round at a time — fine for putting a non-flat
history on a dashboard, but it never produces genuinely overlapping
requests. `load-test.js` does: every simulated user runs its own action loop
concurrently (`Promise.all`, not a round-robin), with a weighted mix of
actions (default 75% create / 20% edit / 5% delete) and randomized
"think time" between actions. Good for exercising exemplars, concurrent DB
load, or anything that only shows up under real parallel traffic.

```
cd seed-data
docker run --rm --network observability-net -v "$PWD:/app" -w /app node:20-alpine node load-test.js
```

Tunables (env vars, all optional):

| Var | Default | Meaning |
|---|---|---|
| `API_BASE_URL` | `http://backend:4000` | backend base URL — same direct-vs-`http://frontend/api` tradeoff as `seed.js`, see above |
| `LOAD_USERS` | `50` | number of concurrent simulated users |
| `LOAD_ITERATIONS` | `20` | actions per user |
| `LOAD_CREATE_PCT` | `75` | % of actions that create an expense |
| `LOAD_EDIT_PCT` | `20` | % of actions that edit one |
| `LOAD_DELETE_PCT` | `5` | % of actions that delete one (documentation only — the split is really `100 - CREATE - EDIT`) |
| `LOAD_MIN_THINK_MS` / `LOAD_MAX_THINK_MS` | `300` / `1500` | random delay range between one user's actions |

Users are `load-user-1@example.com` .. `load-user-N@example.com` (password
`loadpassword123`), separate from `seed.js`'s `seed-user-*` accounts so the
two scripts don't collide. Each user creates before editing/deleting anything
— early iterations always create regardless of the roll, since there's
nothing yet to act on otherwise.

Prints a summary on completion: total create/edit/delete counts and any
errors (e.g. a transient failure under load) with the failing user and
message.
