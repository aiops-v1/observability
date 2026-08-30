# Prometheus cheat sheet

Run these in the Prometheus UI (`http://<host>:9090/graph`) under the
"Table" tab for instant values, or "Graph" for a time series. Grouped by
which container/exporter exposes the metric — matches the `job` label in
`prometheus.yml`.

## 0. Is everything even up?

```promql
up
```

Should return one row per scrape target (`expense-backend`, `mysql`,
`nginx-frontend`, `cadvisor`, `prometheus`), all value `1`. A `0` means that
target is down — check `docker compose logs <service>` for it.

```promql
up == 0
```

Quick way to see *only* the broken ones.

---

## 1. `expense-backend` (job=`expense-backend`, scraped from `backend:4000/metrics`)

### RED metrics (every HTTP request)

Request rate, by route:
```promql
sum(rate(http_requests_total[5m])) by (route)
```

Error rate (5xx only), by route:
```promql
sum(rate(http_requests_total{status_code=~"5.."}[5m])) by (route)
```

Error *ratio* (fraction of requests that are 5xx), overall:
```promql
sum(rate(http_requests_total{status_code=~"5.."}[5m]))
/ sum(rate(http_requests_total[5m]))
```

p95 latency, by route:
```promql
histogram_quantile(0.95, sum(rate(http_request_duration_seconds_bucket[5m])) by (le, route))
```

p50/median latency overall:
```promql
histogram_quantile(0.50, sum(rate(http_request_duration_seconds_bucket[5m])) by (le))
```

Requests by status code class (2xx vs 4xx vs 5xx):
```promql
sum(rate(http_requests_total[5m])) by (status_code)
```

### Business counters

Total signups / logins so far (instant, not a rate):
```promql
sum(users_registered_total)
sum(user_logins_total)
```

Signup rate over time:
```promql
rate(users_registered_total[5m])
```

Expenses created per second, by category:
```promql
sum(rate(expenses_created_total[5m])) by (category_name)
```

Total money recorded, by category (instant snapshot):
```promql
sum(expense_amount_rupees_total) by (category_name)
```

Which category is growing fastest right now:
```promql
topk(3, sum(rate(expense_amount_rupees_total[5m])) by (category_name))
```

### Node.js process health (from `collectDefaultMetrics`)

Event loop lag (a rising number = the process is struggling to keep up):
```promql
nodejs_eventloop_lag_seconds
```

Heap used:
```promql
nodejs_heap_size_used_bytes
```

CPU usage (seconds of CPU per second of wall time — 1.0 = fully saturating one core):
```promql
rate(process_cpu_user_seconds_total{job="expense-backend"}[5m])
```

---

## 2. `mysql` (job=`mysql`, scraped from `mysqld-exporter:9104`, backed by the `metrics_exporter` DB user)

Is MySQL itself reachable (from the exporter's point of view, not just the container):
```promql
mysql_up
```

Active connections:
```promql
mysql_global_status_threads_connected
```

Connections as a fraction of `max_connections` (watch for this approaching 1):
```promql
mysql_global_status_threads_connected / mysql_global_variables_max_connections
```

Queries per second:
```promql
rate(mysql_global_status_queries[5m])
```

Slow queries (cumulative counter — use rate to see if it's *currently* happening):
```promql
rate(mysql_global_status_slow_queries[5m])
```

InnoDB buffer pool usage (pages used vs total — low free space isn't
necessarily bad, but a lot of *dirty* pages plus high I/O is worth watching):
```promql
mysql_global_status_innodb_buffer_pool_pages_data / mysql_global_status_innodb_buffer_pool_pages_total
```

Uptime (seconds since MySQL last restarted — a sudden drop to a small number
means it crashed/restarted):
```promql
mysql_global_status_uptime
```

---

## 3. `nginx-frontend` (job=`nginx-frontend`, scraped from `frontend:8080/stub_status` — nginx's `stub_status` module has no per-route breakdown, only aggregate connection/request counts)

Requests per second (total, not broken down — that granularity lives in the
backend's `http_requests_total` instead):
```promql
rate(nginx_http_requests_total[5m])
```

Active connections right now:
```promql
nginx_connections_active
```

Connections currently reading / writing / waiting (waiting = idle
keep-alive, generally the largest and most normal of the three):
```promql
nginx_connections_reading
nginx_connections_writing
nginx_connections_waiting
```

---

## 4. `cadvisor` (job=`cadvisor`, per-container resource usage for everything in the stack)

CPU usage by container, as fraction of a core:
```promql
sum(rate(container_cpu_usage_seconds_total{name!=""}[5m])) by (name)
```

Memory usage by container:
```promql
container_memory_usage_bytes{name!=""}
```

Which container is using the most memory right now:
```promql
topk(5, container_memory_usage_bytes{name!=""})
```

Network received/transmitted, by container:
```promql
rate(container_network_receive_bytes_total{name!=""}[5m])
rate(container_network_transmit_bytes_total{name!=""}[5m])
```

Note: `name` on cadvisor's metrics is the actual Docker container name
(`mysql`, `backend`, `frontend`, etc. — matches `container_name:` in
`docker-compose.yml`), so these line up directly with `docker compose ps`.

---

## 5. `prometheus` (job=`prometheus`, Prometheus monitoring itself)

How long each scrape is taking, by job (should stay well under
`scrape_interval`, 15s):
```promql
scrape_duration_seconds
```

Samples ingested per second:
```promql
rate(prometheus_tsdb_head_samples_appended_total[5m])
```

---

## Quick "did the seed script do anything" check

After running `seed-data/seed.js`, this should be non-zero and increasing on
re-runs:
```promql
sum(expenses_created_total)
```

and this should show per-category movement over the last few minutes:
```promql
sum(rate(expenses_created_total[5m])) by (category_name)
```
