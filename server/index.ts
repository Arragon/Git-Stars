import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import type { Context } from "hono";
import { logger } from "hono/logger";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { getDb, initDb } from "./db.js";
import {
  devLoginEnabled,
  env,
  githubOAuthConfigured,
  isProduction,
} from "./env.js";
import { cleanExpiredSessions } from "./session.js";
import { latestSchemaVersion, readSchemaVersion } from "./migrations.js";
import {
  APP_VERSION,
  LIST_SCHEMA_VERSION,
  MIN_APP_VERSION,
  MIN_PROTOCOL_VERSION,
  PROTOCOL_VERSION,
} from "./versions.js";
import { authRoutes } from "./routes/auth.js";
import { projectRoutes } from "./routes/projects.js";
import { syncRoutes } from "./routes/sync.js";
import { activityRoutes } from "./routes/activity.js";
import { collectionRoutes } from "./routes/collections.js";
import { libraryRoutes } from "./routes/library.js";
import { listRoutes } from "./routes/lists.js";
import { tagRoutes } from "./routes/tags.js";
import { preferenceRoutes } from "./routes/preferences.js";
import { providerRoutes } from "./routes/providers.js";
import { changesRoutes } from "./routes/changes.js";
import { repositoryRoutes } from "./routes/repositories.js";
import { discoverRoutes } from "./routes/discover.js";
import { publicationRoutes } from "./routes/publications.js";
import { publicRoutes } from "./routes/public.js";
import { hubRoutes } from "./routes/hub.js";
import { adminRoutes } from "./routes/admin.js";
import { accountRoutes } from "./routes/account.js";
import type { AuthedVariables } from "./middleware/auth.js";
import {
  classifyError,
  incrementMetric,
  log,
  logRequest,
  userRef,
} from "./lib/obs.js";

const app = new Hono();

app.use("*", logger());

// Request id (ADR-0006 D4): echo a client-provided id or generate one, and expose it on the
// response. Error bodies report the client-provided id when present.
app.use("/api/*", async (c, next) => {
  const requestId = c.req.header("X-Request-Id") || randomUUID();
  c.header("X-Request-Id", requestId);
  await next();
});

// Structured audit-safe request log + low-cardinality metrics (INH-485). Path is
// logged without query strings; user identity is an anonymous HMAC-derived ref.
app.use("/api/*", async (c, next) => {
  const start = Date.now();
  await next();
  const status = c.res.status;
  // `app` is an untyped Hono instance (mixed auth/anon routers): read the
  // session-scoped variable through a typed context view. Anonymous requests
  // have no userId — log them without a userRef.
  const userId = (c as unknown as Context<{ Variables: AuthedVariables }>).get(
    "userId",
  );
  const userRefValue = typeof userId === "string" ? userRef(userId) : undefined;
  logRequest({
    requestId: c.res.headers.get("X-Request-Id") ?? "",
    method: c.req.method,
    path: c.req.path,
    status,
    durationMs: Date.now() - start,
    ...(userRefValue ? { userRef: userRefValue } : {}),
  });
  if (status >= 400) {
    incrementMetric({
      name: "http_errors_total",
      labels: { class: status >= 500 ? "server" : "client" },
    });
  }
});

// Protocol version guard (ADR-0004 D5): reject too-old clients without mutating any data.
app.use("/api/*", async (c, next) => {
  const raw = c.req.header("X-GitStars-Protocol-Version");
  if (raw && /^\d+$/.test(raw) && Number(raw) < MIN_PROTOCOL_VERSION) {
    return c.json(
      {
        code: "STALE_CLIENT",
        message: "Client protocol version is too old",
        details: { minimum: MIN_PROTOCOL_VERSION },
        request_id: c.req.header("X-Request-Id"),
      },
      426,
    );
  }
  await next();
});

app.get("/api/health", (c) => {
  let schemaVersion: number | null = null;
  try {
    schemaVersion = readSchemaVersion(getDb());
  } catch {
    schemaVersion = null;
  }
  return c.json({
    ok: true,
    env: env.nodeEnv,
    nodeVersion: process.version,
    appVersion: APP_VERSION,
    schemaVersion,
    expectedSchemaVersion: latestSchemaVersion(),
    schemaCompat:
      schemaVersion !== null && schemaVersion === latestSchemaVersion(),
    minAppVersion: MIN_APP_VERSION,
    listSchemaVersion: LIST_SCHEMA_VERSION,
    protocolVersion: PROTOCOL_VERSION,
    providers: {
      github: { configured: githubOAuthConfigured || devLoginEnabled },
      gitlab: { configured: false },
      gitee: { configured: false },
    },
  });
});

app.route("/api/auth", authRoutes);
app.route("/api/projects", projectRoutes);
app.route("/api/sync", syncRoutes);
app.route("/api/github/activity", activityRoutes);
app.route("/api/collections", collectionRoutes);
// New authoritative domain surface (ADR-0006 D1)
app.route("/api/library", libraryRoutes);
app.route("/api/lists", listRoutes);
app.route("/api/tags", tagRoutes);
app.route("/api/preferences", preferenceRoutes);
app.route("/api/providers", providerRoutes);
app.route("/api/changes", changesRoutes);
app.route("/api/repositories", repositoryRoutes);
app.route("/api/discover", discoverRoutes);
// M5 sharing & hub surface (ADR-0006 D1: principal anon | user | admin)
app.route("/api", publicationRoutes);
app.route("/api", publicRoutes);
app.route("/api", hubRoutes);
app.route("/api", adminRoutes);
// Account ownership surface (INH-476: export + deletion)
app.route("/api/account", accountRoutes);

app.notFound((c) => {
  if (c.req.path.startsWith("/api/")) {
    return c.json(
      {
        code: "NOT_FOUND",
        message: `No route for ${c.req.method} ${c.req.path}`,
        request_id: c.req.header("X-Request-Id"),
      },
      404,
    );
  }
  return c.text("Not Found", 404);
});

app.onError((err, c) => {
  // Structured, classified, redacted error telemetry (INH-485): distinguishes
  // provider failure / db / auth / validation / conflict / internal classes so
  // runbooks can route the response without inspecting payloads.
  const errorClass = classifyError(err);
  incrementMetric({
    name: "unhandled_errors_total",
    labels: { class: errorClass },
  });
  log("error", "unhandled_error", {
    requestId: c.req.header("X-Request-Id"),
    path: c.req.path,
    errorClass,
    errorMessage: err instanceof Error ? err.message : String(err),
  });
  if (c.req.path.startsWith("/api/")) {
    return c.json(
      {
        code: "INTERNAL_ERROR",
        message: "Internal server error",
        request_id: c.req.header("X-Request-Id"),
      },
      500,
    );
  }
  return c.text("Internal Server Error", 500);
});

if (isProduction) {
  const distDir = resolve(process.cwd(), "dist");
  if (!existsSync(distDir)) {
    console.warn(
      `[server] dist/ not found at ${distDir}; run "npm run build" first. Serving API only.`,
    );
  } else {
    app.use("/*", serveStatic({ root: "./dist" }));
    // SPA fallback: any non-API, non-asset GET goes to index.html
    app.get("*", serveStatic({ path: "./dist/index.html" }));
  }
}

initDb();

// Schema compatibility guard (ARCHITECTURE.md 12/32): refuse to run against a database that is
// newer than this app build; migrations only ever move the schema forward.
const dbSchemaVersion = readSchemaVersion(getDb());
if (dbSchemaVersion !== null && dbSchemaVersion > latestSchemaVersion()) {
  console.error(
    `[server] Database schema_version ${dbSchemaVersion} is newer than this app supports (${latestSchemaVersion()}). ` +
      `Refusing to start to avoid unsafe writes; upgrade the app or restore a compatible database.`,
  );
  process.exit(1);
}

cleanExpiredSessions();
const cleanupTimer = setInterval(
  () => {
    try {
      cleanExpiredSessions();
    } catch (error) {
      console.error("[server] session cleanup failed:", error);
    }
  },
  60 * 60 * 1000,
);
cleanupTimer.unref?.();

serve({ fetch: app.fetch, port: env.port }, (info) => {
  console.log(
    `[server] GitStars backend listening on http://localhost:${info.port}`,
  );
  console.log(`[server] Environment: ${env.nodeEnv}`);
  console.log(
    `[server] Database: ${resolve(env.databasePath)} (schema_version=${dbSchemaVersion})`,
  );
  if (!env.githubClientId) {
    console.log("[server] GITHUB_CLIENT_ID not set — OAuth login disabled.");
  }
  if (devLoginEnabled) {
    console.log(
      `[server] LOCAL_DEV_USER=${env.localDevUser} — dev login enabled at POST /api/auth/dev-login`,
    );
  }
  if (isProduction && env.localDevUser && !env.allowDevLogin) {
    console.warn(
      "[server] LOCAL_DEV_USER is set but dev login is disabled in production (set ALLOW_DEV_LOGIN=true to override).",
    );
  }
});
