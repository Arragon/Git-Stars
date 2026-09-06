# ADR-0004: Sync Protocol, Versioning and Conflict Semantics

- Status: Accepted (frozen)
- Date: 2026-09-05
- Linear: [INH-310](https://linear.app/inhandy/issue/INH-310/freeze-sync-protocol-versioning-and-conflict-semantics)
- Milestone: M0 - Architecture Contracts
- Depends on: ADR-0003. Blocks: ADR-0006 (API), ADR-0008 (platform), M1 (INH-340).

## Context

The server is authoritative; clients cache and (later) write offline. Downstream
implementers must not invent conflict semantics. Scope note: this effort is
**Web-only**, so the offline client write queue itself is M4; but the _server-side_
protocol (versioning, change feed, idempotency, tombstones, conflict rules) is built in
M1 (INH-340) so M4 clients have a frozen target.

## Decision

### D1. Sync units and what is versioned

| Unit                                 | Versioned?        | Synced to client?    | Authority  |
| ------------------------------------ | ----------------- | -------------------- | ---------- |
| SavedRepository (status, note, ai)   | yes               | yes                  | user state |
| List                                 | yes               | yes                  | user state |
| ListItem (membership + order + note) | yes               | yes                  | user state |
| Tag / RepositoryTag                  | yes (set)         | yes                  | user state |
| Preference                           | yes               | yes                  | user state |
| Repository (provider metadata)       | no (server cache) | read-only projection | server     |
| RemoteMembership                     | server-managed    | read-only projection | server     |

Provider metadata is not client-synced as user state; clients read it through the
Repository projection. This keeps rebuildable data out of the conflict domain.

### D2. Versioning, cursor, tombstone, idempotency

- Each user-state row has `version INTEGER`, incremented on every committed mutation.
- Global per-user monotonic feed: `change_log.seq` (AUTOINCREMENT). Client pull cursor
  = last seen `seq`. `GET /api/changes?since=<seq>` returns ordered changes.
- Entity `etag` = `"<entity_id>:<version>"`; used for `If-Match` conditional writes.
- Deletion = **tombstone**: set `deleted_at`, bump `version`, emit `change_log op=deleted`.
  Tombstones are retained through the compatibility window so offline clients learn of
  the delete; hard purge only by retention job.
- Client mutation id = `Idempotency-Key` header. Server stores `(key,user_id)->response`
  in `idempotency_keys`; a replay returns the stored response without re-applying.

### D3. Offline queue, replay, partial failure (client contract; implemented M4)

- Client persists mutations locally with a client-generated `Idempotency-Key` and the
  `etag` it was based on.
- Replay order: per-entity FIFO; across entities, order by client timestamp then
  entity type priority (ListItem order ops after List existence ops).
- Duplicate submit: deduped server-side by `Idempotency-Key`.
- Partial failure: a batch mutation returns per-item results; the client advances its
  local cursor only for items the server committed. Server never advances `change_log`
  for an uncommitted write.
- Recovery: on reconnect, client pulls `changes?since=cursor`, reconciles, then replays
  pending mutations.

### D4. Conflict matrix (per-entity; NOT blanket last-write-wins)

| Entity / field                   | Strategy                                                                                                                                                     | Rationale                                 |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------- |
| SavedRepository.note             | version-guarded LWW (`If-Match`); stale -> 409 VERSION_CONFLICT, client re-fetches & re-applies                                                              | single author per user; note is free text |
| SavedRepository.status           | version-guarded LWW                                                                                                                                          | small enum                                |
| List.name/description            | version-guarded LWW                                                                                                                                          |                                           |
| ListItem membership (add/remove) | **set semantics, idempotent**: add=insert-if-absent, remove=tombstone; concurrent add+remove resolved by higher `version` (remove wins tie)                  | avoids duplicate rows on replay           |
| ListItem order (position)        | **fractional indexing**; concurrent reorder -> server applies by `version`, last committed order op wins for the affected positions; positions re-normalized | deterministic, order-mergeable            |
| Tag / RepositoryTag              | set semantics, idempotent add/remove                                                                                                                         | duplicates harmless                       |
| Preference                       | field-level merge (JSON shallow-merge) then version bump                                                                                                     | keys are independent                      |

Rule: `409 VERSION_CONFLICT` is the only signal a client needs to detect a stale base;
the server never silently overwrites a newer version with an older one.

### D5. Protocol versioning and too-old clients

- Header `X-GitStars-Protocol-Version: <int>`. Server supports `N` and `N-1`.
- Older than `N-1` -> `426 STALE_CLIENT` (structured, ADR-0006) with `minimum` version;
  server does not mutate and does not lose data.
- Additive changes (new optional fields/entity types) do not bump `N`. Breaking changes
  bump `N` and require a deprecation window (ADR-0006).

### D6. Request/response examples

Pull changes:

```
GET /api/changes?since=1042&limit=200
200 ->
{ "changes": [
    {"seq":1043,"entityType":"saved_repository","entityId":"...","op":"updated","version":7},
    {"seq":1044,"entityType":"list_item","entityId":"...","op":"deleted","version":3}
  ],
  "nextCursor": 1044, "hasMore": false, "protocolVersion": 1 }
```

Idempotent mutation with version guard:

```
PUT /api/library/{savedRepositoryId}
If-Match: "sr-123:6"
Idempotency-Key: 7b1e...
{ "note": "great reference impl", "status": "saved" }

200 -> { "id":"sr-123", "version":7, "etag":"\"sr-123:7\"" }        # applied
200 -> (replay of same Idempotency-Key) stored response, no re-apply
409 -> { "code":"VERSION_CONFLICT", "message":"...", "details":{"current":"sr-123:9"}, "request_id":"..." }
```

### D7. Failure/retry state machine

```
IDLE -> PULL(since cursor)
  PULL ok -> RECONCILE(local replica)
  RECONCILE -> REPLAY(pending mutations, per-entity FIFO)
    REPLAY item:
      applied            -> advance local cursor, drop from queue
      409 VERSION_CONFLICT -> re-pull entity, re-apply or surface to user, keep queued
      426 STALE_CLIENT   -> halt replay, prompt upgrade (no data loss)
      429 RATE_LIMITED   -> backoff to resetAt, retry same item (idempotency key unchanged)
      5xx / NETWORK      -> bounded retry w/ backoff; on exhaustion keep queued, mark offline
  all items terminal -> IDLE
```

### D8. Conformance test cases (spec; implemented per ADR-0007)

1. Replay same `Idempotency-Key` -> single effect, no duplicate ListItem/Tag.
2. Offline delete then reconnect -> tombstone observed, deterministic end state.
3. Two clients concurrently edit Note -> one 200, one 409; final = higher version.
4. Two clients concurrently reorder a List -> deterministic merged order.
5. Stale protocol client -> 426, no mutation, no data loss.
6. Partial batch failure -> only committed items advance the feed.

## Acceptance (INH-310)

- Replaying a mutation does not duplicate ListItem/Tag relations: D2 idempotency + D4 set semantics.
- Offline delete then online has a deterministic result: D2 tombstone + D7 + case 2.
- Concurrent Note/List-order edits have predictable, testable results: D4 + cases 3-4.
- Server can reject too-old protocol without breaking data: D5 + case 5.
- Every conflict strategy has at least one failure/recovery test: D8.
