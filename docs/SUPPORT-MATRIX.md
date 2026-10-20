# GitStars · Support Matrix & Verified Scope

Verified: 2026-10-19 · code baseline `8a7b988` + M7 batch · source of truth for
"what actually works". Update this file whenever a capability changes; point docs at it
instead of restating support claims.

## 1. Client platforms

| Platform                       | Status                    | Evidence                                                              |
| ------------------------------ | ------------------------- | --------------------------------------------------------------------- |
| Web (desktop & mobile browser) | **Committed / supported** | `src/App.tsx` routes; `docs/adr/0008-v1-client-platform-matrix.md` D1 |
| Windows desktop                | Deferred / not built      | INH-462 Canceled                                                      |
| macOS desktop                  | Deferred / not built      | INH-466 Canceled                                                      |
| Native mobile                  | Deferred / not built      | INH-472 Canceled                                                      |

No native client exists in this repository. Do not describe desktop/mobile as
"partial support" — they are **not implemented**.

## 2. Repository providers

| Provider | Status                                                                                    | Evidence                                                                                       |
| -------- | ----------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| GitHub   | **Supported** (read: metadata, README, tree, file, releases, assets, search, stars/forks) | `server/providers/github/index.ts` capabilities; runtime `server/index.ts` health              |
| GitLab   | **Not implemented** — fail-closed stub                                                    | `server/providers/gitlab/index.ts` throws `PROVIDER_NOT_IMPLEMENTED`; capabilities all `false` |
| Gitee    | **Not implemented** — fail-closed stub                                                    | `server/providers/gitee/index.ts` throws `PROVIDER_NOT_IMPLEMENTED`; capabilities all `false`  |

GitLab/Gitee are registered only so the UI degrades honestly. Do not claim partial
support: every method fails closed and `/api/health` reports them as not configured.
A real second provider is tracked as the M10-B work package.

## 3. Runtime & deployment

| Item               | Requirement / behaviour                                                                            |
| ------------------ | -------------------------------------------------------------------------------------------------- |
| Node.js            | 22+ (`node:sqlite`); CI pins Node 22                                                               |
| Database           | SQLite, WAL mode, default `data/gitstars.db`                                                       |
| Process model      | Single process serves `/api/*` and the built SPA (`dist/`)                                         |
| Production install | `npm ci --omit=dev` then `npm start` (runtime deps include `tsx`/`cross-env`)                      |
| Backup             | `PRAGMA wal_checkpoint(TRUNCATE)` + copy `db`/`-wal`/`-shm`; see `scripts/drill-backup-restore.ts` |
| Schema upgrades    | Additive, versioned (`server/migrations.ts`); newer DB than binary → startup exits 1               |

## 4. Environment variables

Sourced from `server/env.ts` (the only authority).

| Variable               | Required | Default                       | Purpose                                                   |
| ---------------------- | -------- | ----------------------------- | --------------------------------------------------------- |
| `SESSION_SECRET`       | **Yes**  | —                             | Session cookie signing + credential-key derivation        |
| `CREDENTIAL_KEY`       | No       | derived from `SESSION_SECRET` | Provider token encryption key                             |
| `PORT`                 | No       | `3001`                        | HTTP port                                                 |
| `DATABASE_PATH`        | No       | `./data/gitstars.db`          | SQLite file                                               |
| `PUBLIC_URL`           | No       | `http://localhost:<PORT>`     | OAuth callback base                                       |
| `COOKIE_SECURE`        | No       | `false`                       | Set `true` behind HTTPS                                   |
| `GITHUB_CLIENT_ID`     | No       | —                             | GitHub OAuth app id                                       |
| `GITHUB_CLIENT_SECRET` | No       | —                             | GitHub OAuth app secret                                   |
| `LOCAL_DEV_USER`       | No       | —                             | Enables dev login for one public account                  |
| `ALLOW_DEV_LOGIN`      | No       | `false`                       | Allows dev login when `NODE_ENV=production`               |
| `ADMIN_TOKEN`          | No       | —                             | Bearer token for admin takedown; empty disables admin API |

## 5. Explicit non-goals (current baseline)

- No native clients, no PWA/service worker, no offline content download beyond the
  client cache.
- No MCP/agent interop, no Hub curation/subscription, no second real provider.
- No team collaboration, no cloud-hosted multi-tenant service.

These map to M9–M11 conditional work packages and are **not** part of the trusted
baseline.
