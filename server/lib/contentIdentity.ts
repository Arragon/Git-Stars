import { createHash } from "node:crypto";

// M8-05: stable content identity for provider payloads (README today). The digest
// is computed server-side so a client can compare a cached copy against a fresh
// response without transferring or diffing the body itself.
export function sha256Hex(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}
