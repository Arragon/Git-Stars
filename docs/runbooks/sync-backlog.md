# Runbook: Sync backlog / slow change feed

Covers: users' change feeds lagging (clients pulling large backlogs) or the sync
engine running long (large GitHub accounts).

## Detection

- `sync_run` logs with long durations or `batchCount` at the page cap (20 pages).
- Clients repeatedly pulling `GET /api/changes` with `hasMore=true` for many pages.
- DB: `SELECT COUNT(*) FROM change_log;` growing without bound; tombstone retention
  growth (deletion events are retained for offline clients by design, ADR-0004 D2).

## Triage / isolation

1. Check whether backlog is per-user (a huge star count) or systemic (feed fan-out
   from an import event). Imports emit per-entity changes by design.
2. Confirm the change feed is keeping up: `nextCursor` progression per pull vs
   `change_log` MAX(seq) for the user.

## Recovery

- Per-user large initial backlog: expected on first bootstrap; clients paginate at
  200/batch until caught up. No server action.
- change_log growth: a retention job (hard purge of tombstones past the
  compatibility window) is the designed lever (ADR-0004 D2). It is not yet
  implemented; until then, monitor disk usage of `data/gitstars.db` and schedule a
  maintenance window if it grows unboundedly.

## Do NOT

- Do not truncate `change_log` manually: clients' cursors would jump past deleted
  entries only safely via the retention design (cursor invalidation + full re-pull),
  not via ad-hoc deletion. Manual truncation will strand clients at a valid-but-holey
  cursor and silently desync their replicas.
