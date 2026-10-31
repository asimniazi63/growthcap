import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

// AES-256-GCM for Shopify tokens at rest. Every field is base64. `v` names the key that sealed the value.
export interface EncryptedSecret {
  v: number;
  iv: string;
  tag: string;
  data: string;
}

const CURRENT_VERSION = 1;
const IV_BYTES = 12;
const KEY_BYTES = 32;

// The one place keys are looked up by version. Version 1 is TOKEN_ENCRYPTION_KEY. To rotate, add a version 2
// key here (for example TOKEN_ENCRYPTION_KEY_V2), seal new values with it and keep v1 for reading old ones.
function keyForVersion(version: number): Buffer {
  if (version !== 1) throw new Error(`Unknown encryption key version ${version}`);
  const raw = process.env.TOKEN_ENCRYPTION_KEY;
  if (!raw) throw new Error("TOKEN_ENCRYPTION_KEY is not set");
  const key = Buffer.from(raw, "base64");
  if (key.length !== KEY_BYTES) {
    throw new Error(`TOKEN_ENCRYPTION_KEY must decode to ${KEY_BYTES} bytes (got ${key.length})`);
  }
  return key;
}

export function encryptSecret(plain: string): EncryptedSecret {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", keyForVersion(CURRENT_VERSION), iv);
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return {
    v: CURRENT_VERSION,
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    data: data.toString("base64"),
  };
}

export function decryptSecret(s: EncryptedSecret): string {
  const decipher = createDecipheriv("aes-256-gcm", keyForVersion(s.v), Buffer.from(s.iv, "base64"));
  decipher.setAuthTag(Buffer.from(s.tag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(s.data, "base64")), decipher.final()]).toString("utf8");
}
