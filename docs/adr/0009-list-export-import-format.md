# ADR-0009: Portable Lists/Library Export-Import Format (Draft v0)

- Status: Accepted (frozen as schema_version 0 / draft; v1 freeze is a later L4 gate)
- Date: 2026-09-05
- Linear: [INH-384](https://linear.app/inhandy/project/gitstars-bcf16dc90545) (Freeze portable Lists/Library export-import format)
- Milestone: M3 - Library & Lists
- Depends on: ADR-0002 (identity), ADR-0003 (data model). Implemented by `src/lib/list-format.ts`, `server/services/listsIo.ts`.

## Context

Lists must be portable across GitStars instances and across forges without leaking local
identity, credentials, or private data (ARCHITECTURE.md 22-27). The format stays a draft
(schema_version 0) until a GitHub+GitLab round-trip is proven; v1 is frozen later.

## Decision

### D1. Document shape

```json
{
  "format": "gitstars-list",
  "schema_version": 0,
  "title": "My list",
  "description": "optional",
  "exported_at": "2026-09-05T00:00:00.000Z",
  "items": [
    {
      "source": {
        "provider": "github",
        "host": "github.com",
        "remote_id": "1",
        "path": "honojs/hono"
      },
      "note": "optional",
      "tags": ["web"]
    }
  ]
}
```

- Portable identity is `source = {provider, host, remote_id, path?}` (ADR-0002 D1). Local
  UUIDs are never portable identity.
- `note` and `tags` are the only user-knowledge fields carried. AI summary is NOT portable
  in v0 (ARCHITECTURE.md 24); it can become an explicit export option later.

### D2. Forbidden fields (hard rejection)

An item must not contain: `id`, `user_id`, `uuid`, `token`, `access_token`, `sync_state`,
`version`, `repository_id`, `saved_repository_id`. Presence is a validation error. The
document must not contain credentials or internal config.

### D3. Sanitization on export

`sanitizeItems` drops private repositories entirely (never leak name/url/note/tags/path of
a private repo), drops empty fields, and emits only the portable shape. Export is a
read-only projection of a List's SavedRepository members.

### D4. Import pipeline (untrusted input)

```
size limit (5 MB) -> JSON parse -> schema validate -> semantic validate -> sanitize
  -> preview (dry-run, no mutation) -> explicit confirm -> import
```

- Validation treats every field as unknown; malformed/oversized payloads are rejected
  before any DB mutation.
- Preview classifies each item as `existing` (user already saved it), `new` (resolvable),
  or `unresolved` (unknown provider). Nothing is written during preview.
- Commit is idempotent: re-importing the same list does not duplicate repositories,
  SavedRepositories, or ListItems (natural-key dedupe).
- Unknown-provider items are RETAINED as repositories with `status='unresolved'` (never
  silently discarded), so they display and can be resolved later.
- No raw HTML/script execution; no automatic remote fetching from the manifest.

### D5. Round-trip guarantee

Exporting a List and importing it into another user/instance reproduces the same set of
portable items (minus private repos), with notes and tags intact. Verified by
`server/services/listsIo.test.ts` (GitHub-only, mixed GitHub+GitLab, duplicate import,
unknown provider, private exclusion, malformed/forbidden-field rejection).

### D6. Versioning

`schema_version` 0 is a draft. Additive optional fields do not bump it. v1 is frozen only
after GitHub+GitLab round-trip and an L4 protocol review (ARCHITECTURE.md 23); after v1,
future versions must still read v1.

## Acceptance (INH-384)

- Portable identity uses provider/host/remote_id, not local UUIDs: D1.
- Private data and forbidden fields cannot enter an export: D2/D3 + tests.
- Unknown-provider items are representable and retained: D4 + test.
- Malformed/oversized input is rejected before mutation: D4 + test.
- Round-trip is deterministic and idempotent: D5 + tests.
