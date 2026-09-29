// scripts/bench.ts
// Repeatable performance baseline for the hot API paths (INH-481).
// Runs the real Hono sub-apps against an in-memory SQLite seeded with
// representative datasets, measures per-endpoint latency percentiles.
//
// Usage: npm run bench   (or: npx tsx scripts/bench.ts)
// Contract-safe: does not modify behavior; results are printed, never asserted.

import { performance } from "node:perf_hooks";
import {
  bootstrapDb,
  cookieFor,
  seedUser,
  seedRepository,
  teardownDb,
} from "../server/testing/bootstrap.js";
import { getDb } from "../server/db.js";
import { recordChange } from "../server/services/mutations.js";
import { libraryRoutes } from "../server/routes/library.js";
import { listRoutes } from "../server/routes/lists.js";
import { preferenceRoutes } from "../server/routes/preferences.js";
import { changesRoutes } from "../server/routes/changes.js";

interface Dataset {
  label: string;
  savedRepos: number;
  lists: number;
  itemsPerList: number;
  changeLogEntries: number;
}

const DATASETS: Dataset[] = [
  {
    label: "small",
    savedRepos: 200,
    lists: 5,
    itemsPerList: 20,
    changeLogEntries: 300,
  },
  {
    label: "medium",
    savedRepos: 2000,
    lists: 20,
    itemsPerList: 50,
    changeLogEntries: 2000,
  },
  {
    label: "large",
    savedRepos: 5000,
    lists: 30,
    itemsPerList: 200,
    changeLogEntries: 5000,
  },
];

const ITERATIONS = { small: 200, medium: 50, large: 20 } as const;

function seed(dataset: Dataset, userId: string): void {
  const db = getDb();
  const insertSaved = db.prepare(
    `INSERT INTO saved_repositories (id, user_id, repository_id, status, note, ai_tags, version, added_at, updated_at)
     VALUES (?, ?, ?, 'saved', NULL, '[]', 1, '2026-01-01', '2026-01-01')`,
  );
  const insertTag = db.prepare(
    "INSERT OR IGNORE INTO tags (id, user_id, name, created_at) VALUES (?, ?, ?, '2026-01-01')",
  );
  const insertRepoTag = db.prepare(
    "INSERT INTO repository_tags (tag_id, saved_repository_id, created_at) VALUES (?, ?, '2026-01-01')",
  );
  const insertList = db.prepare(
    `INSERT INTO lists (id, user_id, name, description, version, created_at, updated_at)
     VALUES (?, ?, ?, '', 1, '2026-01-01', '2026-01-01')`,
  );
  const insertItem = db.prepare(
    `INSERT INTO list_items (id, list_id, saved_repository_id, position, position_key, version, created_at, updated_at)
     VALUES (?, ?, ?, 0, ?, 1, '2026-01-01', '2026-01-01')`,
  );

  // Distinct repository per saved row (identity = provider+host+remoteId).
  for (let i = 0; i < dataset.savedRepos; i++) {
    const repoId = `repo-bench-${i}`;
    seedRepository(db, repoId, {
      remoteId: String(100000 + i),
      name: `repo-${i}`,
      fullName: `bench-org/repo-${i}`,
    });
    const savedId = `sr-bench-${i}`;
    insertSaved.run(savedId, userId, repoId);
    if (i % 5 === 0) {
      insertTag.run(`tag-bench-${i % 20}`, userId, `tag-${i % 20}`);
      insertRepoTag.run(`tag-bench-${i % 20}`, savedId);
    }
  }

  let savedIdx = 0;
  for (let l = 0; l < dataset.lists; l++) {
    const listId = `list-bench-${l}`;
    insertList.run(listId, userId, `List ${l}`);
    for (
      let it = 0;
      it < dataset.itemsPerList && savedIdx < dataset.savedRepos;
      it++, savedIdx++
    ) {
      insertItem.run(
        `item-${l}-${it}`,
        listId,
        `sr-bench-${savedIdx}`,
        `key-${String(it).padStart(6, "0")}`,
      );
    }
  }

  for (let i = 0; i < dataset.changeLogEntries; i++) {
    recordChange(
      userId,
      "saved_repository",
      `sr-bench-${i % dataset.savedRepos}`,
      "updated",
      2,
    );
  }
}

function percentiles(samples: number[]): {
  p50: number;
  p95: number;
  p99: number;
} {
  const sorted = [...samples].sort((a, b) => a - b);
  const at = (p: number) =>
    sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
  return { p50: at(50), p95: at(95), p99: at(99) };
}

async function bench(
  name: string,
  run: () => Promise<unknown>,
  iterations: number,
): Promise<{ p50: number; p95: number; p99: number }> {
  // warmup
  for (let i = 0; i < 3; i++) await run();
  const samples: number[] = [];
  for (let i = 0; i < iterations; i++) {
    const start = performance.now();
    await run();
    samples.push(performance.now() - start);
  }
  return percentiles(samples);
}

async function main(): Promise<void> {
  const results: string[] = [];
  const header = "| dataset | endpoint | p50 (ms) | p95 (ms) | p99 (ms) |";
  results.push(header, "| --- | --- | --- | --- | --- |");

  for (const dataset of DATASETS) {
    const db = bootstrapDb();
    const USER = "bench-user";
    seedUser(db, USER, "9001", "bench");
    seed(dataset, USER);
    const cookie = { headers: { cookie: cookieFor(USER) } };
    const iters = ITERATIONS[dataset.label as keyof typeof ITERATIONS];

    const library = await bench(
      "library",
      () => libraryRoutes.request("/", cookie),
      iters,
    );
    results.push(
      `| ${dataset.label} | GET /api/library (${dataset.savedRepos} saved) | ${library.p50.toFixed(2)} | ${library.p95.toFixed(2)} | ${library.p99.toFixed(2)} |`,
    );

    const listDetail = await bench(
      "list detail",
      () => listRoutes.request("/list-bench-0", cookie),
      iters,
    );
    results.push(
      `| ${dataset.label} | GET /api/lists/:id (${dataset.itemsPerList} items) | ${listDetail.p50.toFixed(2)} | ${listDetail.p95.toFixed(2)} | ${listDetail.p99.toFixed(2)} |`,
    );

    const changes = await bench(
      "changes",
      () => changesRoutes.request("/?since=0&limit=200", cookie),
      iters,
    );
    results.push(
      `| ${dataset.label} | GET /api/changes (200/page) | ${changes.p50.toFixed(2)} | ${changes.p95.toFixed(2)} | ${changes.p99.toFixed(2)} |`,
    );

    const prefs = await bench(
      "preferences",
      () => preferenceRoutes.request("/", cookie),
      iters,
    );
    results.push(
      `| ${dataset.label} | GET /api/preferences | ${prefs.p50.toFixed(2)} | ${prefs.p95.toFixed(2)} | ${prefs.p99.toFixed(2)} |`,
    );

    teardownDb();
  }

  console.log(results.join("\n"));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
