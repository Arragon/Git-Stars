# Runbook: Provider credential issue

Covers: a user's stored provider token becoming invalid/revoked, token decryption
failure, or suspected credential exposure.

## Detection

- Logs: `sync_run` with `errorClass="provider_unauthorized"` for a stable `userRef`.
- Client symptom: sync fails with UNAUTHORIZED (401-class from the provider).
- Decryption failure: `provider_accounts.encrypted_token` unreadable raises on token
  load — typically after `SESSION_SECRET`/`CREDENTIAL_KEY` changed.

## Triage / isolation

1. Token invalid at the provider (user revoked it, or changed password): the user
   must reconnect the provider account (POST /api/providers/:type/revoke then OAuth
   connect). Server data is unaffected — only provider-scoped reads fail.
2. Decryption failure after a secret rotation: the encryption key is `CREDENTIAL_KEY`
   or HKDF-derived from `SESSION_SECRET` (server/crypto.ts). Rotating `SESSION_SECRET`
   also invalidates sessions (30-day sliding). Restoring the previous value restores
   decryptability.
3. Suspected exposure: a provider token that appeared in logs or a bug report.

## Recovery

- Invalid token: user-initiated reconnect. Verify via a successful `sync_run`.
- Exposure: force the token out of use — revoke the provider account server-side
  (`DELETE` the `provider_accounts` row for that user; FK-cascades are scoped), have
  the user re-auth, and have the user invalidate the token at the provider (GitHub →
  Settings → Applications). Confirm the token string no longer appears anywhere:
  logs are redacted by `server/lib/obs.ts` (`redactFields`), verified by its tests.

## Do NOT

- Do not write tokens into tickets/issues; redact with the same rules as obs.ts.
- Do not "fix" decryption failures by disabling encryption.
