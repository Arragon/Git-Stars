// Reset the ephemeral E2E database without deleting files: rename them aside so the run
// starts from the same seed even in environments that intercept filesystem deletes.
import { mkdirSync, renameSync } from "node:fs";

mkdirSync("./tmp", { recursive: true });
const stamp = Date.now();
for (const suffix of ["", "-wal", "-shm", "-journal"]) {
  try {
    renameSync(`./tmp/e2e.db${suffix}`, `./tmp/e2e-${stamp}.db${suffix}`);
  } catch {
    // file does not exist — nothing to reset
  }
}
