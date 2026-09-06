import "dotenv/config";

function required(name: string): string {
  const value = process.env[name];
  if (!value || !value.trim()) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value.trim();
}

function optional(name: string, fallback = ""): string {
  const value = process.env[name];
  return value && value.trim() ? value.trim() : fallback;
}

function optionalNumber(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw || !raw.trim()) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function optionalBool(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (!raw || !raw.trim()) return fallback;
  const normalized = raw.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return fallback;
}

export const env = {
  nodeEnv: optional("NODE_ENV", "development"),
  port: optionalNumber("PORT", 3001),
  databasePath: optional("DATABASE_PATH", "./data/gitstars.db"),
  sessionSecret: required("SESSION_SECRET"),
  publicUrl: optional(
    "PUBLIC_URL",
    `http://localhost:${optionalNumber("PORT", 3001)}`,
  ).replace(/\/$/, ""),
  cookieSecure: optionalBool("COOKIE_SECURE", false),
  githubClientId: optional("GITHUB_CLIENT_ID"),
  githubClientSecret: optional("GITHUB_CLIENT_SECRET"),
  localDevUser: optional("LOCAL_DEV_USER"),
  // Credential vault key (ADR-0005 D3). Optional; derived from SESSION_SECRET when unset.
  credentialKey: optional("CREDENTIAL_KEY"),
  // Dev-login is refused in production unless this is explicitly true (ADR-0005 D1).
  allowDevLogin: optionalBool("ALLOW_DEV_LOGIN", false),
};

export const isProduction = env.nodeEnv === "production";
export const githubOAuthConfigured = Boolean(
  env.githubClientId && env.githubClientSecret,
);
export const devLoginEnabled =
  Boolean(env.localDevUser) && (!isProduction || env.allowDevLogin);
