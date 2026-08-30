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
| `API_BASE_URL` | `http://backend:4000` | backend base URL, reachable from wherever the script runs |
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
