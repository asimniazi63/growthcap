import { randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { decryptSecret, encryptSecret } from "./secrets";

const KEY_ENV = "TOKEN_ENCRYPTION_KEY";
let saved: string | undefined;

beforeEach(() => {
  saved = process.env[KEY_ENV];
  process.env[KEY_ENV] = randomBytes(32).toString("base64");
});

afterEach(() => {
  if (saved === undefined) delete process.env[KEY_ENV];
  else process.env[KEY_ENV] = saved;
});

describe("encryptSecret and decryptSecret", () => {
  it("round-trips a token", () => {
    const sealed = encryptSecret("shpat_example_token");
    expect(decryptSecret(sealed)).toBe("shpat_example_token");
  });

  it("round-trips an empty string and non-ASCII text", () => {
    expect(decryptSecret(encryptSecret(""))).toBe("");
    expect(decryptSecret(encryptSecret("tøken-✓"))).toBe("tøken-✓");
  });

  it("stores version 1 and keeps the plaintext out of every field", () => {
    const sealed = encryptSecret("shpat_example_token");
    expect(sealed.v).toBe(1);
    expect(JSON.stringify(sealed)).not.toContain("shpat_example_token");
  });

  it("uses a fresh iv each time, so the same plaintext encrypts differently", () => {
    const a = encryptSecret("same");
    const b = encryptSecret("same");
    expect(a.iv).not.toBe(b.iv);
    expect(a.data).not.toBe(b.data);
  });

  it("throws on an unknown key version", () => {
    const sealed = encryptSecret("x");
    expect(() => decryptSecret({ ...sealed, v: 99 })).toThrow(/version 99/i);
  });

  it("throws when the ciphertext has been tampered with", () => {
    const sealed = encryptSecret("a long enough token to have several bytes");
    const bytes = Buffer.from(sealed.data, "base64");
    bytes[0] = bytes[0]! ^ 0xff;
    expect(() => decryptSecret({ ...sealed, data: bytes.toString("base64") })).toThrow();
  });

  it("throws when the auth tag has been tampered with", () => {
    const sealed = encryptSecret("token");
    const tag = Buffer.from(sealed.tag, "base64");
    tag[0] = tag[0]! ^ 0xff;
    expect(() => decryptSecret({ ...sealed, tag: tag.toString("base64") })).toThrow();
  });

  it("throws when decrypting with a different key", () => {
    const sealed = encryptSecret("token");
    process.env[KEY_ENV] = randomBytes(32).toString("base64");
    expect(() => decryptSecret(sealed)).toThrow();
  });

  it("throws a clear error when the key is missing", () => {
    delete process.env[KEY_ENV];
    expect(() => encryptSecret("x")).toThrow(/TOKEN_ENCRYPTION_KEY/);
  });

  it("throws a clear error when the key is not 32 bytes", () => {
    process.env[KEY_ENV] = randomBytes(16).toString("base64");
    expect(() => encryptSecret("x")).toThrow(/32 bytes/);
  });
});
