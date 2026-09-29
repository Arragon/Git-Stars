# Performance Baseline (INH-481)

Measured: 2026-09-29, Node 22, in-memory SQLite, real Hono handlers (no network),
Apple Silicon (darwin arm64). Re-run with:

```
npm run bench
```

Method: each endpoint is exercised against seeded representative datasets
(small 200 saved / 300 feed entries; medium 2000 / 2000; large 5000 / 5000),
after 3 warmup iterations, reporting p50/p95/p99 over N samples (200/50/20 by
dataset size). The bench script (`scripts/bench.ts`) seeds deterministic data and
calls the same route handlers the server mounts.

## Results

| dataset | endpoint                       | p50 (ms) | p95 (ms) | p99 (ms) |
| ------- | ------------------------------ | -------- | -------- | -------- |
| small   | GET /api/library (200 saved)   | 0.61     | 0.79     | 1.06     |
| small   | GET /api/lists/:id (20 items)  | 0.06     | 0.07     | 0.11     |
| small   | GET /api/changes (200/page)    | 0.52     | 0.58     | 0.76     |
| small   | GET /api/preferences           | 0.01     | 0.02     | 0.03     |
| medium  | GET /api/library (2000 saved)  | 5.98     | 6.67     | 7.23     |
| medium  | GET /api/lists/:id (50 items)  | 0.09     | 0.10     | 0.11     |
| medium  | GET /api/changes (200/page)    | 0.58     | 0.60     | 0.61     |
| medium  | GET /api/preferences           | 0.02     | 0.02     | 0.02     |
| large   | GET /api/library (5000 saved)  | 15.35    | 18.47    | 18.47    |
| large   | GET /api/lists/:id (200 items) | 0.29     | 0.31     | 0.31     |
| large   | GET /api/changes (200/page)    | 0.79     | 0.86     | 0.86     |
| large   | GET /api/preferences           | 0.01     | 0.02     | 0.02     |

## Reading

- All hot paths scale linearly with dataset size and stay in single-digit to low
  tens of milliseconds — no N+1 patterns (tag attachment and publication counts use
  one batched query each; list items are one JOIN with an index on
  `(list_id, position_key)`).
- The change feed with per-entity payload enrichment stays sub-millisecond p50 per
  200-entry page even at 5000 entries.
- GET /api/library at 5000 saved repositories (~15ms p50) is the widest path; it is
  an unpaginated full-list response by product design today. If Library grows past
  ~10k rows, add cursor pagination (ADR-0006 D3) before optimizing queries.

## Provider call amplification guards (already in place)

- `server/providers/shared/http.ts` performs in-flight request dedupe and bounded
  retry with backoff, so UI-triggered concurrent reads cannot multiply provider
  calls; the SSRF guard (`server/lib/egress.ts`) validates every outbound URL.
- Repository metadata is a server-side cache (`repositories` table,
  `metadata_fetched_at`), and `/api/repositories/:id?refresh=1` is the only
  on-demand refresh path — re-renders do not re-fetch providers.

## Known limits

- Numbers are in-process; end-to-end latency over HTTP adds serialization/socket
  overhead. The regression signal is the relative p95 movement between runs, not
  absolute milliseconds.
