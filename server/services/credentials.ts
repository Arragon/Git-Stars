import { randomUUID } from "node:crypto";
import { getDb } from "../db.js";
import { decryptSecret, encryptSecret } from "../crypto.js";

// Provider-account (forge connection) store + credential vault access (ADR-0003 D2,
// ADR-0005 D3). Tokens are encrypted at rest via server/crypto.ts and never returned,
// logged, or written to change_log.

export interface ProviderAccountView {
  id: string;
  provider_type: string;
  host: string;
  remote_user_id: string | null;
  remote_username: string | null;
  status: string;
  scopes: string;
  has_token: boolean;
  last_verified_at: string | null;
  created_at: string;
  updated_at: string;
}

interface ProviderAccountRow {
  id: string;
  provider_type: string;
  host: string;
  remote_user_id: string | null;
  remote_username: string | null;
  status: string;
  scopes: string;
  encrypted_token: string | null;
  last_verified_at: string | null;
  created_at: string;
  updated_at: string;
}

function toView(row: ProviderAccountRow): ProviderAccountView {
  return {
    id: row.id,
    provider_type: row.provider_type,
    host: row.host,
    remote_user_id: row.remote_user_id,
    remote_username: row.remote_username,
    status: row.status,
    scopes: row.scopes,
    has_token: Boolean(row.encrypted_token),
    last_verified_at: row.last_verified_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export interface UpsertProviderAccountInput {
  userId: string;
  providerType: string;
  host: string;
  remoteUserId?: string | null;
  remoteUsername?: string | null;
  token?: string | null;
  scopes?: string | null;
  id?: string; // explicit id (used by migration backfill for determinism)
}

// Create-or-update a forge connection. Token (if given) is encrypted at rest.
export function upsertProviderAccount(
  input: UpsertProviderAccountInput,
): ProviderAccountView {
  const db = getDb();
  const nowIso = new Date().toISOString();
  const remoteUserId = input.remoteUserId ?? null;
  const existing = db
    .prepare(
      `SELECT * FROM provider_accounts
       WHERE user_id = ? AND provider_type = ? AND host = ? AND COALESCE(remote_user_id,'') = COALESCE(?,'')`,
    )
    .get(
      input.userId,
      input.providerType,
      input.host,
      remoteUserId,
    ) as unknown as ProviderAccountRow | undefined;

  const encryptedToken = input.token ? encryptSecret(input.token) : null;

  if (existing) {
    db.prepare(
      `UPDATE provider_accounts
       SET remote_username = COALESCE(?, remote_username),
           status = 'active',
           scopes = COALESCE(?, scopes),
           encrypted_token = COALESCE(?, encrypted_token),
           token_updated_at = CASE WHEN ? IS NULL THEN token_updated_at ELSE ? END,
           last_verified_at = ?,
           updated_at = ?
       WHERE id = ?`,
    ).run(
      input.remoteUsername ?? null,
      input.scopes ?? null,
      encryptedToken,
      encryptedToken,
      encryptedToken ? nowIso : null,
      nowIso,
      nowIso,
      existing.id,
    );
    const row = db
      .prepare("SELECT * FROM provider_accounts WHERE id = ?")
      .get(existing.id) as unknown as ProviderAccountRow;
    return toView(row);
  }

  const id = input.id ?? randomUUID();
  db.prepare(
    `INSERT INTO provider_accounts
       (id, user_id, provider_type, host, remote_user_id, remote_username, status, scopes,
        encrypted_token, token_updated_at, last_verified_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    input.userId,
    input.providerType,
    input.host,
    remoteUserId,
    input.remoteUsername ?? null,
    input.scopes ?? "",
    encryptedToken,
    encryptedToken ? nowIso : null,
    nowIso,
    nowIso,
    nowIso,
  );
  const row = db
    .prepare("SELECT * FROM provider_accounts WHERE id = ?")
    .get(id) as unknown as ProviderAccountRow;
  return toView(row);
}

// Decrypt the active token for a user's provider connection, or null if absent.
export function getProviderToken(
  userId: string,
  providerType: string,
): string | null {
  const row = getDb()
    .prepare(
      `SELECT encrypted_token FROM provider_accounts
       WHERE user_id = ? AND provider_type = ? AND status = 'active' AND encrypted_token IS NOT NULL
       ORDER BY last_verified_at DESC LIMIT 1`,
    )
    .get(userId, providerType) as unknown as
    { encrypted_token: string } | undefined;
  if (!row?.encrypted_token) return null;
  try {
    return decryptSecret(row.encrypted_token);
  } catch {
    // Corrupt/undecryptable token: fail closed (no token) rather than crash the request.
    return null;
  }
}

export function listProviderAccounts(userId: string): ProviderAccountView[] {
  const rows = getDb()
    .prepare(
      "SELECT * FROM provider_accounts WHERE user_id = ? ORDER BY created_at ASC",
    )
    .all(userId) as unknown as ProviderAccountRow[];
  return rows.map(toView);
}

// Revoke: wipe the encrypted token and mark the account revoked. Memberships referencing
// this account are orphaned by FK (SET NULL) but user knowledge is preserved (ADR-0005 D5).
export function revokeProviderAccount(
  userId: string,
  providerType: string,
  host?: string,
): number {
  const db = getDb();
  const nowIso = new Date().toISOString();
  const result = host
    ? db
        .prepare(
          `UPDATE provider_accounts SET encrypted_token = NULL, token_updated_at = NULL, status = 'revoked', updated_at = ?
           WHERE user_id = ? AND provider_type = ? AND host = ?`,
        )
        .run(nowIso, userId, providerType, host)
    : db
        .prepare(
          `UPDATE provider_accounts SET encrypted_token = NULL, token_updated_at = NULL, status = 'revoked', updated_at = ?
           WHERE user_id = ? AND provider_type = ?`,
        )
        .run(nowIso, userId, providerType);
  return Number(result.changes);
}
