# Runbook: Public Hub abuse spike

Covers: report floods, spam publications entering the Hub, enumeration attempts
against public share endpoints.

## Detection

- Metric: `publication_events_total{event="report"}` climbing unusually.
- Operator: complaint about a specific shared List (shareId in the report).
- Enumeration: many 404s from `/api/public/lists/*` / `/api/hub/lists/*` from one
  source (check `http_requests_total{status="404"}` and access logs).

## Triage / isolation

1. Inspect the reported publication's snapshot (GET /api/public/lists/:shareId as
   the operator) — decide spam/inappropriate/copyright.
2. Enumeration: verify the public id space is not guessable (shareIds are 128-bit
   base32, distinct from internal UUIDs); sustained 404 storms are rate-limit
   candidates (see INH-451 follow-up: per-IP limits on anonymous endpoints).

## Recovery

- Takedown: `POST /api/admin/publications/:shareId/takedown` with the configured
  `ADMIN_TOKEN`. Effect: snapshot becomes inaccessible (404), Hub listing
  disappears immediately (catalog only serves `status='active' AND hub_opt_in=1`),
  and an audit event is written. The user's private source list is untouched —
  communicate that to the reporter/owner.
- Restore: if a takedown was wrong, the operator re-publishes on the user's behalf
  is NOT possible; the owner re-publishes from their Lists UI (new audit trail).

## Do NOT

- Do not delete the user's private list or any user-state rows during takedown.
- Do not reveal whether a 404 shareId was revoked vs takedown vs unknown — the
  response body is intentionally identical (enumeration resistance).
