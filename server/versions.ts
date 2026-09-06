// Single source of truth for independently-tracked versions (ADR-0006 D6).
// App version, DB schema version, sync/API protocol version and List format version are
// separate concepts and must never be conflated (ARCHITECTURE.md 32).

export const APP_VERSION = "0.1.0";
export const MIN_APP_VERSION = "0.1.0";

// Sync/API protocol version. Server accepts PROTOCOL_VERSION and PROTOCOL_VERSION-1
// (ADR-0004 D5); older clients get 426 STALE_CLIENT.
export const PROTOCOL_VERSION = 1;
export const MIN_PROTOCOL_VERSION = 1;

// Portable List draft schema version (INH-384); stays 0 until GitHub+GitLab round-trip.
export const LIST_SCHEMA_VERSION = 0;
