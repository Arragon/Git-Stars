import {
  createCipheriv,
  createDecipheriv,
  hkdfSync,
  randomBytes,
} from "node:crypto";
import { env } from "./env.js";

// Pure AES-256-GCM secret encryption for the credential vault (ADR-0005 D2/D3).
// No database imports here so this module can be used by migrations without an import cycle.
//
// Key resolution: CREDENTIAL_KEY (64 hex chars, or base64 of 32 bytes) if provided;
// otherwise HKDF-derived from SESSION_SECRET.
// ponytail: derive-from-SESSION_SECRET is fine for the local profile; the cloud profile
// should set an explicit CREDENTIAL_KEY from a secret manager.

const HKDF_SALT = "gitstars-credential-v1";
const HKDF_INFO = "provider-token-encryption";

let cachedKey: Buffer | null = null;

function resolveKey(): Buffer {
  const raw = env.credentialKey;
  if (raw) {
    const fromHex = Buffer.from(raw, "hex");
    if (fromHex.length === 32) return fromHex;
    const fromB64 = Buffer.from(raw, "base64");
    if (fromB64.length === 32) return fromB64;
    // fall through to derivation if the provided key is not 32 bytes
  }
  const derived = hkdfSync(
    "sha256",
    Buffer.from(env.sessionSecret, "utf8"),
    Buffer.from(HKDF_SALT, "utf8"),
    Buffer.from(HKDF_INFO, "utf8"),
    32,
  );
  return Buffer.from(derived);
}

function getKey(): Buffer {
  if (!cachedKey) cachedKey = resolveKey();
  return cachedKey;
}

// Test hook: clear the memoized key (e.g. after changing env in a test).
export function resetCredentialKeyCache(): void {
  cachedKey = null;
}

// Output format: "v1:<iv b64>:<tag b64>:<ciphertext b64>"
export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", getKey(), iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return [
    "v1",
    iv.toString("base64"),
    tag.toString("base64"),
    ciphertext.toString("base64"),
  ].join(":");
}

export function decryptSecret(payload: string): string {
  const parts = payload.split(":");
  if (parts.length !== 4 || parts[0] !== "v1") {
    throw new Error("Unsupported credential payload format");
  }
  const [, ivB64, tagB64, dataB64] = parts;
  const decipher = createDecipheriv(
    "aes-256-gcm",
    getKey(),
    Buffer.from(ivB64, "base64"),
  );
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(dataB64, "base64")),
    decipher.final(),
  ]).toString("utf8");
}
