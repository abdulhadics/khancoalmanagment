import { randomBytes } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  decryptTotpSecret,
  deriveTotpEnrollmentSecret,
  encryptTotpSecret,
  parseAuthEncryptionKey,
  totpProvisioningData,
  verifyTotpStep,
} from "../../src/server/auth/totp";

// Public RFC 6238 test vector using the six least-significant digits.
const seed = Buffer.from("12345678901234567890", "ascii");

describe("authenticator codes", () => {
  it("accepts the standard value in the current and previous time-step window", () => {
    expect(verifyTotpStep(seed, "287082", new Date(59_000), null)).toBe(1n);
    expect(verifyTotpStep(seed, "287082", new Date(60_000), null)).toBe(1n);
    expect(verifyTotpStep(seed, "287082", new Date(90_000), null)).toBeNull();
  });

  it("rejects replay, malformed codes and codes outside the drift window", () => {
    expect(verifyTotpStep(seed, "287082", new Date(59_000), 1n)).toBeNull();
    expect(verifyTotpStep(seed, "287082\n", new Date(59_000), null)).toBeNull();
    expect(verifyTotpStep(seed, "ABCDEF", new Date(59_000), null)).toBeNull();
    expect(verifyTotpStep(seed, "287082", new Date(0), null)).toBe(1n);
  });

  it("provides Base32 and authenticator-compatible enrollment data", () => {
    const enrollment = totpProvisioningData(seed, "coal.owner");
    expect(enrollment.secret).toBe("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ");
    const uri = new URL(enrollment.uri);
    expect(uri.protocol).toBe("otpauth:");
    expect(uri.hostname).toBe("totp");
    expect(decodeURIComponent(uri.pathname)).toBe(
      "/KhanCoalSupplier:coal.owner",
    );
    expect(uri.searchParams.get("secret")).toBe(enrollment.secret);
    expect(uri.searchParams.get("period")).toBe("30");
  });
});

describe("authenticator secret protection", () => {
  it("requires a canonical base64url key of 32 bytes", () => {
    const key = randomBytes(32);
    expect(parseAuthEncryptionKey(key.toString("base64url"))).toEqual(key);
    expect(() => parseAuthEncryptionKey(undefined)).toThrow(
      /AUTH_ENCRYPTION_KEY/,
    );
    expect(() =>
      parseAuthEncryptionKey(`${key.toString("base64url")}=`),
    ).toThrow(/AUTH_ENCRYPTION_KEY/);
    expect(() =>
      parseAuthEncryptionKey(randomBytes(31).toString("base64url")),
    ).toThrow(/AUTH_ENCRYPTION_KEY/);
  });

  it("derives a unique enrollment seed from the challenge and the key", () => {
    const key = randomBytes(32);
    const token = randomBytes(32).toString("base64url");
    const enrolled = deriveTotpEnrollmentSecret(key, token);
    expect(enrolled).toEqual(deriveTotpEnrollmentSecret(key, token));
    expect(enrolled).not.toEqual(
      deriveTotpEnrollmentSecret(randomBytes(32), token),
    );
    expect(enrolled).not.toEqual(
      deriveTotpEnrollmentSecret(key, randomBytes(32).toString("base64url")),
    );
  });

  it("encrypts with unique IVs and rejects tampering or another user", () => {
    const key = randomBytes(32);
    const encrypted = encryptTotpSecret(seed, key, "user-one");
    expect(encrypted).not.toEqual(encryptTotpSecret(seed, key, "user-one"));
    expect(decryptTotpSecret(encrypted, key, "user-one")).toEqual(seed);
    expect(() => decryptTotpSecret(encrypted, key, "user-two")).toThrow();
    expect(() =>
      decryptTotpSecret(encrypted, randomBytes(32), "user-one"),
    ).toThrow();
    expect(() =>
      decryptTotpSecret(encrypted.subarray(1), key, "user-one"),
    ).toThrow();
    encrypted[encrypted.length - 1] ^= 1;
    expect(() => decryptTotpSecret(encrypted, key, "user-one")).toThrow();
  });
});
