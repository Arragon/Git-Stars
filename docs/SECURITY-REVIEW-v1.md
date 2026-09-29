# GitStars v1 Release Security Review (INH-489)

- Date: 2026-09-29
- Scope: auth/session, provider credentials, public sharing & Hub, README/markdown
  sanitization, client storage, account deletion, egress. Independent threat-surface
  review; dependency scanning used only as auxiliary input.
- Decision: **PASS** — no High-impact findings open. Accepted/low risks listed below
  with mitigations. Items that cannot be verified in this environment are marked
  External-Block and are not claimed as verified.

## Method

Per-surface code review against ADR-0005 (authn/authz/secret handling), ADR-0004
(protocol), ADR-0006 (error envelope), plus the automated gates below. Every finding
had to be reproducible by an existing test or a targeted manual check; checklist-only
claims were rejected.

## Automated evidence (all green at review time)

- `npm test` — 250/250 pass, including the security-relevant suites:
  - `server/lib/obs.test.ts` — redaction regression gate (synthetic tokens/notes never
    reach log output), stable non-reversible `userRef`, error classification.
  - `server/lib/egress.test.ts` — SSRF guard: https-only, public DNS hosts only;
    IP literals (incl. `169.254.169.254`, `[::1]`) and loopback/private names rejected.
  - `server/routes/changes.test.ts` — change feed payload sanitation (user-scoped).
  - `server/routes/shareSmoke.test.ts` + `server/services/publication.test.ts` —
    CI-blocking privacy scan: no notes/tags/user ids/credentials in any public
    snapshot or Hub catalog payload; enumeration resistance (identical 404 bodies
    for unknown/revoked/takedown); takedown removes Hub + public access while the
    private list survives.
  - `server/services/accountDeletion.test.ts` — token-hash-only storage, wrong-token
    rejection, full inventory purge, session invalidation, injected mid-deletion
    failure → full rollback and clean retry (no orphan publications).
  - `server/routes/auth.test.ts`, `server/domain.test.ts` — identity-conflict and
    session behavior.
- `npm run api:check` — contract valid (39 paths); the OpenAPI error-code catalog can
  only grow (diff gate).
- Mimosa deep scan (2026-09-29): 0 High findings; 12 inconclusive "role/permission
  check not statically observable" hypotheses — each route was verified to scope by
  `user_id` (see A1/A2 below). Dependency advisory match: 5 packages / 36 offline
  advisories — context-only; online review is External-Block (see E1).

## Surface review

### A. Auth, sessions, authorization

- Cookie value is `<sessionId>.<HMAC-SHA256(sessionId)>`; signature compared with
  `timingSafeEqual` (`server/session.ts`). HttpOnly + SameSite=Lax + Secure
  (config-controlled). DB-backed with expiry + hourly cleanup; logout destroys the
  row. Fixation: a fresh session id is created at login; no session is accepted
  before it exists server-side.
- Every user-state route scopes by `user_id` in the WHERE clause (library, lists,
  tags, preferences, providers, publications, changes) — spot-verified across
  `server/routes/*.ts`; 404 (not 403) for foreign ids to avoid existence leaks.
- Admin takedown: `ADMIN_TOKEN` compared via `timingSafeEqual`; unset → 503
  ADMIN_NOT_CONFIGURED (never a permissive default).
- Dev login is gated by `LOCAL_DEV_USER` and disabled in production unless
  `ALLOW_DEV_LOGIN=true`.

### B. Provider credentials

- Tokens stored AES-256-GCM (`v1:<iv>:<tag>:<ct>`) in `provider_accounts.encrypted_token`
  (`server/crypto.ts`); plaintext wiped in migration v1; key = `CREDENTIAL_KEY` or
  HKDF(SESSION_SECRET) — documented local-profile tradeoff (see L2).
- Tokens never appear in API responses (provider list/revoke expose metadata only) and
  never reach the client for downloads (asset download is server-proxied).
- All outbound fetches pass `assertEgressUrl` (SSRF guard) — enforced inside the fetch
  wrappers and explicitly at the OAuth exchange sites.
- Revoke deletes the vault row (FK/cascade) and the provider-side revocation is a
  documented user action (runbook: credential-issue.md).
- Log redaction denylist + token-shape scrubbing with tests (`obs.ts`); metrics use
  low-cardinality labels only (no repository URLs / emails).

### C. Public sharing & Hub

- Snapshot is a sanitized copy built server-side; private repos become order-preserving
  `{unavailable:true}` markers; notes/tags/AI data/user ids/internal saved-repo UUIDs
  are absent (privacy-scan tests fail CI otherwise). Share ids are 26-char Crockford
  base32 of 128 random bits — not enumerable, not the internal list UUID.
- Revoked/takedown/unknown share ids answer the same 404 code+message (enumeration
  resistance), reports answer 202 even for unknown ids.
- Hub catalog serves only `status='active' AND hub_opt_in=1`; revoke/takedown removes
  from catalog immediately. Takedown blocks owner republish (409) so an operator
  decision cannot be silently undone; audit_events record publish/unpublish/report/
  takedown/account_deleted (non-sensitive fields only).
- Abuse controls: per-user limits (publish 10/h, import 20/h), per-IP limits (report
  5/h, anonymous reads 120/h), standard 429 envelope with retryAfterSec.

### D. Untrusted content rendering

- README markdown: escape-everything-then-apply-subset (`src/lib/markdown.ts`); links
  restricted to `https?://`, `rel="noopener noreferrer"`; attribute breakout impossible
  because quotes are escaped before formatting; code fences escaped. Tests:
  `src/lib/markdown.test.ts`.

### E. Client storage

- Session lives only in an HttpOnly cookie; no secrets in JS storage. IndexedDB holds
  the user-state replica and mutation queue — the user's own data on their own device;
  provider tokens are never sent to the client. The `PlatformAdapter` web
  implementation declares `secureStorage() = null` by contract (ADR-0008 D4).
- Accepted risk L1 below covers the BYO AI key.

### F. Account deletion & publication cleanup

- Two-step (token-hashed) confirmation; single-transaction execution with FK cascades
  - explicit purge of non-FK rows; mid-deletion failure → full rollback, retry-safe;
    public share/Hub entries die atomically with the account. Tests prove each claim.

## Findings

| ID  | Severity       | Finding                                                                                                          | Disposition                                                                                                             |
| --- | -------------- | ---------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| L1  | Low / Accepted | BYO AI key stored in `localStorage` (`useAiConfigStore`), used for client-side AI calls                          | User's own key on their own device; feature is opt-in; documented. Revisit if AI moves server-side.                     |
| L2  | Low            | Credential key HKDF-derived from `SESSION_SECRET` when `CREDENTIAL_KEY` unset                                    | Acceptable for local/self-hosted profile; documented in `crypto.ts` and release checklist to set an explicit key.       |
| L3  | Low            | Rate limiter is in-memory (per-process)                                                                          | Matches the single-node deployment contract; swap point documented in `rateLimit.ts`.                                   |
| I1  | Info           | change-feed payloads include the user's own note content                                                         | Inherent to offline sync; authenticated per-user feed, redaction rules apply to logs not to the user's own client data. |
| E1  | External-Block | Online dependency-advisory review; store/signing/notarization (canceled platforms per ADR-0008); real-device E2E | Cannot be verified in this environment; not claimed as done.                                                            |

No High-impact findings. Blocking conditions for a future release: any privacy-scan,
enumeration-resistance, or redaction test regression.

## Release decision

**PASS** for the web-committed v1 (ADR-0008), with the release pipeline (INH-494)
producing unsigned-test artifacts only until real signing credentials exist
(External-Block, E1).
