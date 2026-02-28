# Load Testing with k6

## Install

```bash
# Mac
brew install k6

# Ubuntu/Debian
sudo gpg -k
sudo gpg --no-default-keyring --keyring /usr/share/keyrings/k6-archive-keyring.gpg \
  --keyserver hkp://keyserver.ubuntu.com:80 --recv-keys C5AD17C747E3415A3642D57D77C6C491D6AC1D69
echo "deb [signed-by=/usr/share/keyrings/k6-archive-keyring.gpg] https://dl.k6.io/deb stable main" \
  | sudo tee /etc/apt/sources.list.d/k6.list
sudo apt-get update && sudo apt-get install k6
```

## Run order

Always run in this order — don't run stress before smoke passes.

### 1. Smoke test (run first — 30 seconds)

Verifies all endpoints respond correctly with 1 user.

```bash
k6 run \
  -e EMAIL=obaidurapu12@gmail.com \
  -e PASS=yourpassword \
  -e BASE=http://localhost:3000 \
  k6/smoke.js
```

**Pass criteria:** All checks green, 0 errors, p95 < 500ms

---

### 2. Load test (normal traffic — ~8 minutes)

Ramps to 50 concurrent users. Simulates real daily usage.

```bash
k6 run \
  -e EMAIL=obaidurapu12@gmail.com \
  -e PASS=yourpassword \
  k6/load.js
```

**Pass criteria:** p99 < 1000ms, error rate < 1%

---

### 3. Stress test (find breaking point — ~10 minutes)

Ramps to 300 users. Watch where p99 starts climbing.

```bash
k6 run \
  -e EMAIL=obaidurapu12@gmail.com \
  -e PASS=yourpassword \
  k6/stress.js
```

**Watch for:** The VU count where p99 exceeds 1s — that's your current limit.

---

### 4. Spike test (burst traffic — ~2 minutes)

Instant jump to 200 users — simulates a flash sale or viral moment.

```bash
k6 run \
  -e EMAIL=obaidurapu12@gmail.com \
  -e PASS=yourpassword \
  k6/spike.js
```

**Watch for:** Error rate — if it spikes above 10%, add more connection pooling or caching.

---

## Reading results

```
✓ conversations 200 ............ 100%
✓ has data field ............... 100%

checks.........................: 100.00% ✓ 4820  ✗ 0
data_received..................: 12 MB   34 kB/s
data_sent......................: 890 kB  2.5 kB/s
http_req_duration..............: avg=45ms  min=12ms  med=38ms  max=890ms p(90)=78ms p(95)=102ms p(99)=234ms
http_req_failed................: 0.00%   ✓ 0      ✗ 4820
vus............................: 50      min=1     max=50
```

| Metric            | What it means                    | Target   |
| ----------------- | -------------------------------- | -------- |
| `p(95)`           | 95% of requests faster than this | < 300ms  |
| `p(99)`           | 99% of requests faster than this | < 1000ms |
| `http_req_failed` | % of requests that errored       | < 1%     |
| `checks`          | % of assertions that passed      | 100%     |

---

## Common bottlenecks and fixes

| Symptom                      | Likely cause                                   | Fix                                 |
| ---------------------------- | ---------------------------------------------- | ----------------------------------- |
| p99 > 1s on `/conversations` | Missing DB index on `org_id + last_message_at` | Add composite index                 |
| Errors spike at 100+ VUs     | DB connection pool exhausted                   | Increase pool size or add PgBouncer |
| Memory climbs during load    | Memory leak in a service                       | Check for unclosed DB connections   |
| p99 fine but p100 spikes     | Occasional slow query                          | Check `maxQueryExecutionTime` logs  |
