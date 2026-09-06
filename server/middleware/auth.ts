import type { Context, MiddlewareHandler } from "hono";
import { getCookie } from "hono/cookie";
import { readSession, SESSION_COOKIE_NAME } from "../session.js";
import { getDb } from "../db.js";
import { apiError } from "../httpErrors.js";

export interface AuthUser {
  id: string;
  github_id: string;
  username: string;
  email: string | null;
  avatar_url: string | null;
  full_name: string | null;
  last_synced_at: string | null;
  last_login_at: string | null;
}

// Hono Variables type for authenticated routes
export type AuthedVariables = {
  userId: string;
  user: AuthUser;
};

export type AuthedContext = Context<{ Variables: AuthedVariables }>;

function loadUser(userId: string): AuthUser | null {
  const row = getDb()
    .prepare(
      `SELECT id, github_id, username, email, avatar_url, full_name,
              last_synced_at, last_login_at
       FROM users WHERE id = ?`,
    )
    .get(userId) as unknown as AuthUser | undefined;
  return row ?? null;
}

export function currentUser(c: Context): AuthUser | null {
  const cookie = getCookie(c, SESSION_COOKIE_NAME);
  const session = readSession(cookie);
  if (!session) return null;
  return loadUser(session.user_id);
}

export const requireUser: MiddlewareHandler<{
  Variables: AuthedVariables;
}> = async (c, next) => {
  const user = currentUser(c);
  if (!user) {
    return apiError(c, 401, "UNAUTHENTICATED", "Authentication required");
  }
  c.set("userId", user.id);
  c.set("user", user);
  await next();
};
