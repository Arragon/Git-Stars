// server/testing/shareFixtures.ts
// Deterministic seed for the public Share/Hub smoke environment (INH-524).
// Builds every documented publication state — normal, empty, cross-provider,
// partial-unavailable, revoked, hub opted-in, link-only, takedown — using the
// real service functions so fixtures cannot drift from behavior. No provider
// network access is required: repositories are seeded directly.

import { getDb } from "../db.js";
import {
  publish,
  revoke,
  setHubOptIn,
  takedown,
} from "../services/publication.js";
import { seedRepository, seedUser } from "./bootstrap.js";

export interface ShareFixtureIds {
  userId: string;
  cookie: string;
  /** hub opted-in, normal content */
  hubNormal: string;
  /** hub opted-in, zero items */
  hubEmpty: string;
  /** hub opted-in, GitHub + Gitee mix (Gitee = unresolved provider) */
  hubCrossProvider: string;
  /** link-only (NOT in hub), contains a private repo → partial unavailable */
  linkOnlyPartial: string;
  /** revoked after publish */
  revoked: string;
  /** published then taken down by an operator */
  takenDown: string;
}

function seedRepoForUser(
  userId: string,
  i: number,
  visibility: "public" | "private",
): string {
  const db = getDb();
  seedRepository(db, `repo-fix-${i}`, {
    remoteId: String(500000 + i),
    name: `fixture-repo-${i}`,
    fullName: `fixture-org/fixture-repo-${i}`,
  });
  db.prepare("UPDATE repositories SET visibility = ? WHERE id = ?").run(
    visibility,
    `repo-fix-${i}`,
  );
  db.prepare(
    `INSERT INTO saved_repositories (id, user_id, repository_id, status, note, ai_tags, version, added_at, updated_at)
     VALUES (?, ?, ?, 'saved', ?, '[]', 1, '2026-01-01', '2026-01-01')`,
  ).run(`sr-fix-${i}`, userId, `repo-fix-${i}`, `private note ${i}`);
  return `sr-fix-${i}`;
}

function createList(
  userId: string,
  id: string,
  name: string,
  description: string,
): void {
  getDb()
    .prepare(
      `INSERT INTO lists (id, user_id, name, description, version, created_at, updated_at)
       VALUES (?, ?, ?, ?, 1, '2026-01-01', '2026-01-01')`,
    )
    .run(id, userId, name, description);
}

function addItem(listId: string, savedId: string, i: number): void {
  getDb()
    .prepare(
      `INSERT INTO list_items (id, list_id, saved_repository_id, position, position_key, note, version, created_at, updated_at)
       VALUES (?, ?, ?, 0, ?, 'list item note', 1, '2026-01-01', '2026-01-01')`,
    )
    .run(`item-fix-${listId}-${i}`, listId, savedId, `k${i}`);
}

/** Seed every fixture publication state. Returns ids + an auth cookie for the owner. */
export function seedShareFixtures(
  userId: string,
  makeCookie: (userId: string) => string,
): ShareFixtureIds {
  const db = getDb();
  seedUser(db, userId, "8001", "fixture-owner");

  seedRepoForUser(userId, 1, "public");
  seedRepoForUser(userId, 2, "public");
  seedRepoForUser(userId, 3, "private");

  // 1. hub opted-in, normal
  createList(userId, "list-fix-hub-normal", "Fixture: hub normal", "seeded");
  addItem("list-fix-hub-normal", "sr-fix-1", 1);
  publish(userId, "list-fix-hub-normal");
  setHubOptIn(userId, "list-fix-hub-normal", true);

  // 2. hub opted-in, empty
  createList(userId, "list-fix-hub-empty", "Fixture: hub empty", "seeded");
  publish(userId, "list-fix-hub-empty");
  setHubOptIn(userId, "list-fix-hub-empty", true);

  // 3. hub opted-in, cross-provider (gitee repo row exists but no adapter resolution)
  createList(
    userId,
    "list-fix-hub-cross",
    "Fixture: hub cross-provider",
    "seeded",
  );
  seedRepository(db, "repo-fix-gitee", {
    remoteId: "900001",
    name: "gitee-repo",
    fullName: "fixture-org/gitee-repo",
    provider: "gitee",
  });
  db.prepare(
    `INSERT INTO saved_repositories (id, user_id, repository_id, status, ai_tags, version, added_at, updated_at)
     VALUES ('sr-fix-gitee', ?, 'repo-fix-gitee', 'saved', '[]', 1, '2026-01-01', '2026-01-01')`,
  ).run(userId);
  addItem("list-fix-hub-cross", "sr-fix-1", 1);
  addItem("list-fix-hub-cross", "sr-fix-gitee", 2);
  publish(userId, "list-fix-hub-cross");
  setHubOptIn(userId, "list-fix-hub-cross", true);

  // 4. link-only, partial unavailable (contains a private repo)
  createList(
    userId,
    "list-fix-link-partial",
    "Fixture: link-only partial",
    "seeded",
  );
  addItem("list-fix-link-partial", "sr-fix-1", 1);
  addItem("list-fix-link-partial", "sr-fix-3", 2); // private
  publish(userId, "list-fix-link-partial");

  // 5. revoked
  createList(userId, "list-fix-revoked", "Fixture: revoked", "seeded");
  addItem("list-fix-revoked", "sr-fix-2", 1);
  publish(userId, "list-fix-revoked");
  revoke(userId, { listId: "list-fix-revoked" });

  // 6. taken down
  createList(userId, "list-fix-takedown", "Fixture: takedown", "seeded");
  addItem("list-fix-takedown", "sr-fix-2", 1);
  publish(userId, "list-fix-takedown");
  setHubOptIn(userId, "list-fix-takedown", true);
  const pub = db
    .prepare(
      "SELECT id FROM list_publications WHERE list_id = 'list-fix-takedown'",
    )
    .get() as unknown as { id: string };
  takedown(pub.id);

  const shareIdOf = (listId: string) => {
    const row = db
      .prepare("SELECT id FROM list_publications WHERE list_id = ?")
      .get(listId) as unknown as { id: string };
    return row.id;
  };

  return {
    userId,
    cookie: makeCookie(userId),
    hubNormal: shareIdOf("list-fix-hub-normal"),
    hubEmpty: shareIdOf("list-fix-hub-empty"),
    hubCrossProvider: shareIdOf("list-fix-hub-cross"),
    linkOnlyPartial: shareIdOf("list-fix-link-partial"),
    revoked: shareIdOf("list-fix-revoked"),
    takenDown: shareIdOf("list-fix-takedown"),
  };
}
