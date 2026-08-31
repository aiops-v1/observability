# k6 load generation (Phase 4)

Spec: [`../../claude-phase-4.md`](../../claude-phase-4.md). Generates realistic
concurrent load against the running app — enough to produce real p50/p95/p99
distributions and exercise the MySQL connection pool (`DB_POOL_SIZE=10` in
`../docker-compose.yml`) — as opposed to `../seed-data/`, which exists to put
a non-flat history on dashboards, not to load-test anything.

Unlike `seed-data/*.js` (plain Node, run as a one-off container *on*
`observability-net`), k6 is **not** part of the Docker Compose stack and
should run from somewhere that isn't competing for resources with what it's
testing — your laptop, a separate small VM, or a dedicated EC2 instance next
to (not inside) the one running `docker compose up`.

## 1. Install k6

Not in `docker-compose.yml` on purpose (see above). Options:
- Native binary: https://k6.io/docs/get-started/installation/
- Or run it in a throwaway container instead of installing anything, e.g.:
  ```
  docker run --rm -i --network host -v "$PWD:/k6" -w /k6 grafana/k6 run -e BASE_URL=http://localhost -e PROFILE=baseline load-signup.js
  ```
  (`--network host` only makes sense when k6 and the app are on the same
  Linux host with `-p 80:80` published — on a genuinely separate machine, use
  the public IP/domain as `BASE_URL` instead and drop `--network host`.)

## 2. Two scripts, two traffic modes

| Script | Mode | Notes |
|---|---|---|
| `load-signup.js` | Fresh signup per VU | Every VU creates a brand-new account, then runs the request mix. `users` table grows every run. |
| `load-seeded.js` | Seeded pool | `setup()` creates (or reuses, on repeat runs — a 409 just means "already there") a fixed pool of `POOL_SIZE` accounts; each VU signs in as one, picked at random. Table doesn't grow across runs. |

Both share `lib/requestMix.js` for the actual request logic — only the
auth/setup step differs, per claude-phase-4.md §3.

Each VU authenticates **once**, not once per iteration (bcrypt is
deliberately slow — hammering `/auth/signup` every iteration would measure
bcrypt's cost, not the app). This works because k6 runs each VU as its own
isolated JS instance, so a module-scope variable (`sessionReady` in each
script) persists across that VU's iterations without needing `setup()` for
per-VU state — `setup()` here is used only for the one-time pool creation in
`load-seeded.js`.

## 3. Running it

Always target the app's **public URL through nginx** — never
`http://backend:4000` directly — so requests actually exercise
`nginx → backend → mysql` and the traces/logs this stack already produces
line up with what you're generating (see `expense-frontend-v1/nginx.conf`,
the `/api/` location).

```
cd observability/k6
k6 run -e BASE_URL=http://localhost -e PROFILE=baseline load-signup.js
```

- `BASE_URL` — defaults to `http://localhost`; set it to the host/IP/domain
  nginx is actually reachable on (e.g. an EC2 public IP) if k6 runs
  elsewhere.
- `PROFILE` — one of `baseline` (default), `soak`, `ramp`, `spike` — see
  `lib/profiles.js` for the exact stage definitions (mirrors
  claude-phase-4.md §4). **Always run `baseline` first** to confirm the
  pipeline works before anything heavier.
- `load-seeded.js` only: `POOL_SIZE` (default `20`) — number of accounts in
  the reused pool.

Run baseline against `load-seeded.js` instead of `load-signup.js` by just
swapping the filename — same env vars, same profiles.

## 4. What's actually sent

`lib/requestMix.js` rolls a weighted mix every iteration (claude-phase-4.md
§5), adapted to this app's real API — cookie-based auth (`AUTH_MODE=cookie`),
camelCase JSON fields, and the actual validation behavior in
`expense-backend-v1/src/routes/expenses.js`, not the generic example in the
spec:

| Request | Weight | Expected |
|---|---|---|
| `GET /expenses` | 30% | 200 |
| `POST /expenses` (valid) | 25% | 201 |
| `GET /expenses/summary` | 15% | 200 |
| `GET /categories` | 10% | 200 |
| `POST /expenses`, `categoryId: 999999` | 5% | 400 (integer, but no such category — a real DB lookup miss, not a validation error) |
| `POST /expenses`, `expenseDate: 'not-a-date'` | 5% | 400 |
| `POST /expenses`, `amount: -5` | 5% | 400 |
| `GET /expenses` with a garbage `expense_token` cookie | 5% | 401 |

The 400s/401 are **expected**, not failures — each `check()` asserts the
specific status code that request should produce. Because of this,
`options.thresholds` deliberately has no `http_req_failed` entry (k6's
default failure definition is "non-2xx," which these requests violate on
purpose); `checks: ['rate>0.95']` is the real pass/fail signal — did each
response match what was actually expected.

## 5. What to watch while a run is in progress

- **Grafana** — request rate / error rate / p95 latency climbing or
  stabilizing in the shape the chosen profile predicts (`ramp` should show a
  visibly climbing line, not a step function).
- **Tempo** — pick a few traces during peak load; confirm
  `expense-frontend-nginx` → `expense-backend` → the MySQL span are all still
  present and durations look sane (not silently failing to export under
  load).
- **Loki** — log volume should scale with request volume, and the
  deliberate 400/401s should show up as `warn`-level lines, not get dropped.
- **MySQL connection pool** — `mysql_global_status_threads_connected`
  (from `mysqld-exporter`) approaching `DB_POOL_SIZE=10` during `spike`
  specifically is the most likely thing to actually tell a story here.
- **k6's own summary** at the end (request counts, threshold pass/fail,
  latency percentiles) — read this before drawing conclusions from
  dashboards alone.

## 6. Explicitly out of scope

Same as claude-phase-4.md §8: no deliberate infrastructure failure injection
(that's a later phase, layered on top of this load), no browser-based load
testing (k6's separate browser module), no distributed/multi-machine k6
execution — 100 VUs from one k6 process is well within a single instance's
capacity at this scale.
