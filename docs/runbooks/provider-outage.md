# Runbook: Provider outage / rate-limit storm

Covers: GitHub (or future GitLab/Gitee) API failures or 403/429 rate-limit storms
affecting sync, Repository View reads, or release downloads.

## Detection

- Metric: `sync_errors_total{class="provider_rate_limited"|"provider_error"}` rising.
- Logs: `sync_run` events with `outcome="error"`, `errorClass="provider_rate_limited"`.
- Client symptom: Library sync / Repository View shows RATE_LIMITED (429) with `resetAt`.

## Triage / isolation

1. Confirm scope: is the failure provider-wide (all users) or a single provider
   account (one user's token)? Check `auth_failures_total{reason=...}` and recent
   `sync_run` logs' `userRef` cardinality.
2. Check the provider's own status page (outage vs quota). `429` with `Retry-After`
   is quota, `5xx` from the forge is outage.
3. Server-side actions are read-only-safe: the sync engine advances per-resource
   cursors only on commit, so no data-integrity action is needed during an outage.

## Recovery

- Quota (429): wait for `resetAt`; the client retries with backoff automatically
  (ADR-0004 D7). No server action.
- Outage: nothing to fix server-side; users see stale cached metadata. When the
  provider recovers, sync resumes on the next user-triggered or reconnect-triggered
  run. Verify via `sync_total{outcome="ok"}` returning to baseline.

## Do NOT

- Do not reset `sync_states` cursors to force re-pull during an outage — it wastes
  the recovered quota and can trigger a full-reconcile storm.
- Do not disable the egress guard (`server/lib/egress.ts`) to "route around" an issue.
