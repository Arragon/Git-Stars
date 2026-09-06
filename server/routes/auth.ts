import { Hono } from "hono";
import { getCookie } from "hono/cookie";
import { randomUUID } from "node:crypto";
import { getDb } from "../db.js";
import { devLoginEnabled, env, githubOAuthConfigured } from "../env.js";
import {
  buildAuthorizeUrl,
  exchangeCodeForToken,
  fetchGitHubUser,
  GITHUB_OAUTH_SCOPES,
  GitHubApiError,
  GitHubRateLimitError,
} from "../github.js";
import {
  buildClearCookieHeader,
  buildCookieHeader,
  createSession,
  destroySessionByCookie,
  encodeCookieValue,
  SESSION_COOKIE_NAME,
} from "../session.js";
import { currentUser } from "../middleware/auth.js";
import { upsertProviderAccount } from "../services/credentials.js";

const OAUTH_STATE_TTL_MS = 5 * 60 * 1000;
const oauthStates = new Map<string, number>();

function issueState(): string {
  const now = Date.now();
  for (const [state, expiresAt] of oauthStates) {
    if (expiresAt < now) oauthStates.delete(state);
  }
  const state = randomUUID();
  oauthStates.set(state, now + OAUTH_STATE_TTL_MS);
  return state;
}

function consumeState(state: string | undefined | null): boolean {
  if (!state) return false;
  const expiresAt = oauthStates.get(state);
  if (!expiresAt) return false;
  oauthStates.delete(state);
  return expiresAt >= Date.now();
}

export function toSessionUser(row: {
  id: string;
  github_id: string;
  username: string;
  email: string | null;
  avatar_url: string | null;
  full_name: string | null;
  last_synced_at: string | null;
}) {
  return {
    id: row.id,
    github_id: row.github_id,
    username: row.username,
    email: row.email ?? undefined,
    avatar_url: row.avatar_url ?? undefined,
    full_name: row.full_name ?? undefined,
    last_synced_at: row.last_synced_at ?? undefined,
  };
}

function redirectUri(): string {
  return `${env.publicUrl}/api/auth/github/callback`;
}

// Upsert a user row keyed by github_id. Returns the user id, or throws on identity conflict
// (github_id already owned by a different users.id).
export function upsertUserByGithubId(input: {
  githubId: string;
  username: string;
  email?: string | null;
  avatarUrl?: string | null;
  fullName?: string | null;
}): { id: string; conflict: boolean } {
  const db = getDb();
  const existing = db
    .prepare("SELECT id FROM users WHERE github_id = ?")
    .get(input.githubId) as unknown as { id: string } | undefined;

  const nowIso = new Date().toISOString();

  if (existing) {
    db.prepare(
      `UPDATE users
       SET username = ?, email = COALESCE(?, email), avatar_url = COALESCE(?, avatar_url),
           full_name = COALESCE(?, full_name),
           last_login_at = ?, updated_at = ?
       WHERE id = ?`,
    ).run(
      input.username,
      input.email ?? null,
      input.avatarUrl ?? null,
      input.fullName ?? null,
      nowIso,
      nowIso,
      existing.id,
    );
    return { id: existing.id, conflict: false };
  }

  const id = randomUUID();
  try {
    db.prepare(
      `INSERT INTO users (id, github_id, username, email, avatar_url, full_name, last_login_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      input.githubId,
      input.username,
      input.email ?? null,
      input.avatarUrl ?? null,
      input.fullName ?? null,
      nowIso,
    );
    return { id, conflict: false };
  } catch (error) {
    // UNIQUE(github_id) race: another session inserted first. Re-read and report conflict if the id differs.
    const retry = db
      .prepare("SELECT id FROM users WHERE github_id = ?")
      .get(input.githubId) as unknown as { id: string } | undefined;
    if (retry && retry.id !== id) {
      return { id: retry.id, conflict: true };
    }
    throw error;
  }
}

export const authRoutes = new Hono();

authRoutes.get("/session", (c) => {
  const user = currentUser(c);
  return c.json({
    user: user ? toSessionUser(user) : null,
    devLoginEnabled,
    devLoginUsername: devLoginEnabled ? env.localDevUser : undefined,
    githubOAuthConfigured,
  });
});

authRoutes.post("/logout", (c) => {
  const cookie = getCookie(c, SESSION_COOKIE_NAME);
  destroySessionByCookie(cookie);
  c.header("Set-Cookie", buildClearCookieHeader());
  return c.json({ ok: true });
});

authRoutes.get("/github/login", (c) => {
  if (!githubOAuthConfigured) {
    return c.json(
      {
        code: "OAUTH_NOT_CONFIGURED",
        message:
          "GitHub OAuth is not configured on this server. Set GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET, or use LOCAL_DEV_USER.",
      },
      503,
    );
  }
  const state = issueState();
  const url = buildAuthorizeUrl(state, redirectUri());
  return c.redirect(url, 302);
});

authRoutes.get("/github/callback", async (c) => {
  const code = c.req.query("code");
  const state = c.req.query("state");
  const errorParam = c.req.query("error");

  if (errorParam) {
    return c.redirect(
      `/?error=oauth_denied&detail=${encodeURIComponent(errorParam)}`,
      302,
    );
  }
  if (!code || !consumeState(state)) {
    return c.redirect("/?error=oauth_state_invalid", 302);
  }

  try {
    const accessToken = await exchangeCodeForToken(code, redirectUri());
    const profile = await fetchGitHubUser(accessToken);
    const { id, conflict } = upsertUserByGithubId({
      githubId: String(profile.id),
      username: profile.login,
      email: profile.email,
      avatarUrl: profile.avatar_url,
      fullName: profile.name,
    });

    if (conflict) {
      return c.redirect("/?error=identity_conflict", 302);
    }

    // Store the provider token encrypted in the vault (ADR-0005 D3); never in users.access_token.
    upsertProviderAccount({
      userId: id,
      providerType: "github",
      host: "github.com",
      remoteUserId: String(profile.id),
      remoteUsername: profile.login,
      token: accessToken,
      scopes: GITHUB_OAUTH_SCOPES,
    });

    const session = createSession(id);
    c.header(
      "Set-Cookie",
      buildCookieHeader(encodeCookieValue(session.id), session.expiresAt),
    );
    return c.redirect("/library", 302);
  } catch (error) {
    if (error instanceof GitHubRateLimitError) {
      return c.redirect("/?error=github_rate_limit", 302);
    }
    if (error instanceof GitHubApiError) {
      return c.redirect(
        `/?error=${encodeURIComponent(error.code.toLowerCase())}`,
        302,
      );
    }
    console.error("[auth] GitHub callback failed:", error);
    return c.redirect("/?error=oauth_failed", 302);
  }
});

authRoutes.post("/dev-login", (c) => {
  if (!devLoginEnabled) {
    return c.json(
      {
        code: "DEV_LOGIN_DISABLED",
        message: "LOCAL_DEV_USER is not set; dev login is disabled.",
      },
      403,
    );
  }
  const username = env.localDevUser;
  const { id } = upsertUserByGithubId({
    githubId: `dev:${username}`,
    username,
    fullName: `${username} (local dev)`,
  });
  // Tokenless GitHub connection so public-data sync works in local dev (ADR-0005 D1).
  upsertProviderAccount({
    userId: id,
    providerType: "github",
    host: "github.com",
    remoteUserId: `dev:${username}`,
    remoteUsername: username,
    token: null,
    scopes: "",
  });
  const session = createSession(id);
  c.header(
    "Set-Cookie",
    buildCookieHeader(encodeCookieValue(session.id), session.expiresAt),
  );
  return c.json({
    ok: true,
    user: toSessionUser({
      id,
      github_id: `dev:${username}`,
      username,
      email: null,
      avatar_url: null,
      full_name: `${username} (local dev)`,
      last_synced_at: null,
    }),
  });
});
