// Portable GitStars List format (INH-384, ARCHITECTURE.md 22-27, ADR-0001 D3).
// Isomorphic and framework-free: imported by both the client (preview) and the server
// (export/import engine). schema_version 0 (draft) until GitHub+GitLab round-trip is proven.

export const LIST_FORMAT = "gitstars-list";
export const LIST_SCHEMA_VERSION = 0;

const MAX_ITEMS = 20000;
const MAX_BYTES = 5 * 1024 * 1024;

// Fields that must NEVER appear in a portable item (local identity, credentials, sync state).
const FORBIDDEN_ITEM_FIELDS = [
  "id",
  "user_id",
  "uuid",
  "token",
  "access_token",
  "sync_state",
  "version",
  "repository_id",
  "saved_repository_id",
];

export interface ListItemSource {
  provider: string;
  host: string;
  remote_id: string;
  path?: string;
}

export interface ListExportItem {
  source: ListItemSource;
  note?: string;
  tags?: string[];
}

export interface ListExport {
  format: typeof LIST_FORMAT;
  schema_version: number;
  title: string;
  description?: string;
  exported_at?: string;
  items: ListExportItem[];
}

export interface ValidationResult {
  ok: boolean;
  errors: string[];
}

// Validate an untrusted parsed payload. Treats every field as unknown until checked.
export function validateListExport(input: unknown): ValidationResult {
  const errors: string[] = [];
  if (!input || typeof input !== "object")
    return { ok: false, errors: ["payload is not an object"] };
  const doc = input as Record<string, unknown>;

  if (doc.format !== LIST_FORMAT)
    errors.push(`format must be "${LIST_FORMAT}"`);
  if (doc.schema_version !== LIST_SCHEMA_VERSION)
    errors.push(`unsupported schema_version (expected ${LIST_SCHEMA_VERSION})`);
  if (typeof doc.title !== "string" || !doc.title.trim())
    errors.push("title is required");
  if (doc.description !== undefined && typeof doc.description !== "string")
    errors.push("description must be a string");

  if (!Array.isArray(doc.items)) {
    errors.push("items must be an array");
    return { ok: false, errors };
  }
  if (doc.items.length > MAX_ITEMS)
    errors.push(`too many items (max ${MAX_ITEMS})`);

  doc.items.forEach((raw, i) => {
    if (!raw || typeof raw !== "object") {
      errors.push(`item[${i}] is not an object`);
      return;
    }
    const item = raw as Record<string, unknown>;
    const src = item.source as Record<string, unknown> | undefined;
    if (!src || typeof src !== "object") {
      errors.push(`item[${i}].source is required`);
      return;
    }
    if (typeof src.provider !== "string" || !src.provider)
      errors.push(`item[${i}].source.provider is required`);
    if (typeof src.remote_id !== "string" || !src.remote_id)
      errors.push(`item[${i}].source.remote_id is required`);
    if (src.host !== undefined && typeof src.host !== "string")
      errors.push(`item[${i}].source.host must be a string`);
    if (item.note !== undefined && typeof item.note !== "string")
      errors.push(`item[${i}].note must be a string`);
    if (
      item.tags !== undefined &&
      (!Array.isArray(item.tags) ||
        item.tags.some((t) => typeof t !== "string"))
    ) {
      errors.push(`item[${i}].tags must be string[]`);
    }
    for (const field of FORBIDDEN_ITEM_FIELDS) {
      if (field in item) errors.push(`item[${i}] must not contain "${field}"`);
    }
  });

  return { ok: errors.length === 0, errors };
}

export interface SanitizeInput {
  provider: string;
  host: string;
  remoteId: string;
  path?: string;
  visibility?: string | null;
  note?: string | null;
  tags?: string[];
}

// Build portable items from internal rows: drop private repositories, drop empty fields,
// never emit local ids/credentials/sync state. AI summary is intentionally NOT portable in v0.
export function sanitizeItems(items: SanitizeInput[]): ListExportItem[] {
  const out: ListExportItem[] = [];
  for (const it of items) {
    if ((it.visibility ?? "public") === "private") continue; // never leak private repos
    const item: ListExportItem = {
      source: {
        provider: it.provider,
        host: it.host,
        remote_id: it.remoteId,
        ...(it.path ? { path: it.path } : {}),
      },
    };
    if (it.note) item.note = it.note;
    if (it.tags && it.tags.length > 0) item.tags = it.tags;
    out.push(item);
  }
  return out;
}

// Size-guarded parse + validate of raw untrusted text. No mutation, no fetching.
export function parseListExport(text: string): {
  doc?: ListExport;
  errors: string[];
} {
  if (typeof text !== "string" || text.length === 0)
    return { errors: ["empty payload"] };
  if (text.length > MAX_BYTES)
    return { errors: [`payload exceeds ${MAX_BYTES} bytes`] };
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { errors: ["invalid JSON"] };
  }
  const result = validateListExport(parsed);
  if (!result.ok) return { errors: result.errors };
  return { doc: parsed as ListExport, errors: [] };
}
