# ADR-0005: Authentication, Authorization and Secret-Handling Boundary

- Status: Accepted (frozen)
- Date: 2026-09-05
- Linear: [INH-312](https://linear.app/inhandy/issue/INH-312/freeze-authentication-authorization-and-secret-handling-boundary)
- Milestone: M0 - Architecture Contracts
- Depends on: ADR-0003. Coordinates with: ADR-0004. Blocks: ADR-0006, M1 (INH-328/333).

## Context

Login, provider credentials, and public sharing must have a frozen permission boundary
so no implementer decides sensitive data flow ad hoc. Current state: GitHub OAuth plus a
`LOCAL_DEV_USER` bypass; session cookie is HttpOnly + HMAC-signed (`server/session.ts`);
provider token is stored **plaintext** in `users.access_token` (`server/db.ts`) - this
must change.

## Decision

### D1. Account & session model

- A GitStars `User` is the account principal. Login via (a) GitHub OAuth or (b)
  `LOCAL_DEV_USER` dev bypass.
- Session: server-side row in `sessions` + HttpOnly cookie signed with HMAC
  (`SESSION_SECRET`), 30-day expiry, `Secure` in production (`COOKIE_SECURE`).
- Token lifecycle: session created at login, slid/refreshed on activity, deleted at
  logout and on revoke. Expired sessions pruned (`cleanExpiredSessions`).
- `LOCAL_DEV_USER` is **dev-only**: disabled unless explicitly set; production start
  logs a loud warning and refuses it when `NODE_ENV=production` unless
  `ALLOW_DEV_LOGIN=true` is set deliberately.

### D2. Three distinct secret classes (never conflated)

| Secret                  | Purpose                             | Storage                                           | Lifetime             | Reaches client?                                             |
| ----------------------- | ----------------------------------- | ------------------------------------------------- | -------------------- | ----------------------------------------------------------- |
| `SESSION_SECRET`        | sign/verify session cookie          | server env only                                   | static per deploy    | never                                                       |
| Provider access token   | call forge API as the user          | `provider_accounts.encrypted_token` (AES-256-GCM) | until revoke/refresh | never                                                       |
| Public share token (M5) | capability URL to a public snapshot | Hub store                                         | until revoke         | yes (in share URL) - grants read of sanitized snapshot only |

### D3. Provider token handling

- Encrypted at rest with AES-256-GCM; key `CREDENTIAL_KEY` (32 bytes). If absent,
  derive a key from `SESSION_SECRET` via HKDF (`ponytail:` derive-from-session-secret;
  require explicit CREDENTIAL_KEY in cloud profile).
- Minimal scope: GitHub `read:user user:email` for identity; `repo` additionally only
  when private repos / release assets are used. Request the least scope that satisfies
  the enabled capabilities (ADR-0002).
- Decrypted only in-memory into `ProviderConnectionContext.token` for a request; never
  written to logs, ordinary caches, `change_log`, or any client-synced table.
- Revoke: delete `provider_accounts.encrypted_token`, set `status='revoked'`, call the
  provider's grant-revoke endpoint where available. Memberships referencing the account
  become `provider_account_id=NULL` (SET NULL) but user state is preserved.
- Refresh: if the provider issues a refresh token, store it encrypted and refresh on
  expiry; otherwise re-auth.

### D4. Access control matrix

Principal x resource (all user-state queries are scoped `WHERE user_id = ?`):

| Resource                           | Anonymous         | Owner (authenticated) | Other user        | Share-token holder (M5) |
| ---------------------------------- | ----------------- | --------------------- | ----------------- | ----------------------- |
| Private repo metadata (from forge) | deny              | allow (via own token) | deny              | deny                    |
| SavedRepository / Note / status    | deny              | allow                 | deny              | deny                    |
| Tags / RepositoryTag               | deny              | allow                 | deny              | deny                    |
| List (private)                     | deny              | allow                 | deny              | deny                    |
| Public List snapshot               | allow (sanitized) | allow                 | allow (sanitized) | allow (sanitized)       |
| Preferences                        | deny              | allow                 | deny              | deny                    |
| Provider token (any form)          | deny              | deny (never returned) | deny              | deny                    |

Rules:

- Public share can NEVER read Note, private tags, or non-public List contents.
- Provider token is never returned by any endpoint, nor placed in a client-synced table.
- Every endpoint maps to a principal + permission rule (ADR-0006 endpoint ownership
  table); no endpoint is unscoped by default.

### D5. logout / revoke / device-lost

| Event                               | Server behavior                                                                       |
| ----------------------------------- | ------------------------------------------------------------------------------------- |
| logout                              | delete current session row + clear cookie; user state untouched                       |
| revoke provider                     | D3 revoke; memberships orphaned (SET NULL); SavedRepository/Lists/Notes preserved     |
| device lost / "sign out everywhere" | delete ALL sessions for the user; provider tokens untouched unless explicitly revoked |
| account delete (M6)                 | explicit, authenticated, exports first; cascades user-owned tables (ADR-0003 D3)      |

Session revoke and provider-credential revoke are **separate** operations with separate
endpoints and separate audit events.

### D6. Secret data-flow

```
Browser (untrusted)
  -- session cookie --> Hono middleware: verify HMAC -> load session -> userId in context
  -- API call --> route (ownership WHERE user_id=?)
                    -> provider adapter needs token?
                         -> credentials.ts: read encrypted_token -> AES-GCM decrypt (in-memory)
                         -> forge API (Authorization header)   [token never logged]
                    -> response: normalized DTO (NO token, NO raw provider secret)
  <-- sanitized JSON --
```

### D7. Audit events (minimal, no sensitive payload)

Recorded: `login`, `logout`, `session_revoke_all`, `provider_connect`,
`provider_revoke`, `export`, `import`, `list_publish`(M5), `account_delete`(M6).
Fields: `actor_id, action, entity_type, entity_id, outcome, request_id, ts`.
Never recorded: tokens, PATs, AI keys, Authorization headers, secret lengths, note/list
content, or any value that aids secret discovery (ARCHITECTURE.md 41).

### D8. Threat checklist + security acceptance tests

Threats: token leakage via logs/responses; cross-user read/write; public share leaking
private data; dev-login enabled in prod; CSRF on cookie auth; identity-conflict
destructive "repair" (forbidden, ARCHITECTURE.md 20).

Tests (implemented per ADR-0007):

1. Unauthenticated request to any user-state endpoint -> 401 UNAUTHENTICATED.
2. User A cannot read/write User B's SavedRepository/List/Tag/Note -> 403/404.
3. No endpoint response or log line contains a provider token (scan).
4. `encrypted_token` at rest is not plaintext (ciphertext != known token).
5. Public share payload excludes note/private tags/non-public list (M5 gate; contract test now).
6. Identity conflict aborts sync, deletes nothing (fail-closed).
7. Dev-login refused in production unless `ALLOW_DEV_LOGIN=true`.

## Acceptance (INH-312)

- Public share cannot read Note/private tag/non-public List: D4 + test 5.
- Provider token never enters a client-synced ordinary table: D2/D3 + tests 3-4.
- Session revoke vs provider credential revoke clearly separated: D5.
- Every endpoint maps to a principal + permission rule: D4 + ADR-0006 ownership table.
- Independent security review passes: D8 gate before M1 production use.
