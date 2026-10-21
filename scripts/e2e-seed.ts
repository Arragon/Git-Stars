// Deterministic E2E seed: one dev user, one public repo, one saved row with a note,
// and one list. Runs before the E2E web server starts.
process.env.SESSION_SECRET ||= "e2e-only-not-a-real-secret";

const { initDb, resetDbForTests } = await import("../server/db.js");

const USER = "e2e-user";
const db = initDb(process.env.DATABASE_PATH ?? "./tmp/e2e.db");

db.prepare(
  `INSERT INTO users (id, github_id, username) VALUES (?, 'dev:e2e', 'e2e')
   ON CONFLICT(github_id) DO NOTHING`,
).run(USER);
db.prepare(
  `INSERT OR IGNORE INTO repositories
     (id, provider_type, host, remote_id, canonical_key, namespace_path, name, web_url,
      description, visibility, primary_language, stars_count, forks_count, status, created_at, updated_at)
   VALUES ('e2e-repo', 'github', 'github.com', '424242', 'github:github.com/e2e/demo',
           'e2e', 'demo', 'https://github.com/e2e/demo', 'E2E demo repository', 'public',
           'TypeScript', 42, 7, 'active', '2026-01-01', '2026-01-01')`,
).run();
db.prepare(
  `INSERT OR IGNORE INTO saved_repositories
     (id, user_id, repository_id, status, note, ai_tags, version, added_at, updated_at)
   VALUES ('e2e-saved', ?, 'e2e-repo', 'saved', 'seed note', '["e2e"]', 1, '2026-01-01', '2026-01-01')`,
).run(USER);
db.prepare(
  `INSERT OR IGNORE INTO lists (id, user_id, name, description, version, created_at, updated_at)
   VALUES ('e2e-list', ?, 'E2E list', '', 1, '2026-01-01', '2026-01-01')`,
).run(USER);
db.prepare(
  `INSERT OR IGNORE INTO list_items
     (id, list_id, saved_repository_id, position, position_key, note, version, created_at, updated_at)
   VALUES ('e2e-item', 'e2e-list', 'e2e-saved', 0, 'm', NULL, 1, '2026-01-01', '2026-01-01')`,
).run();

resetDbForTests(null);
console.log("[e2e-seed] ready");
