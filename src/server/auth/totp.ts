import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

const secretBytes = 20;
const ivBytes = 12;
const tagBytes = 16;
const issuer = "KhanCoalSupplier";

export const TOTP_KEY_ID = "v1";

export function parseAuthEncryptionKey(value: string | undefined): Buffer {
  if (value && /^[A-Za-z0-9_-]{43}$/.test(value)) {
    const key = Buffer.from(value, "base64url");
    if (key.length === 32 && key.toString("base64url") === value) return key;
  }
  throw new Error(
    "AUTH_ENCRYPTION_KEY must contain 32 base64url-encoded bytes.",
  );
}

export function deriveTotpEnrollmentSecret(key: Buffer, token: string): Buffer {
  // A short-lived random challenge provides a unique, reproducible seed.
  return createHmac("sha256", key)
    .update("khancoal/totp/enrollment/v1\0")
    .update(token)
    .digest()
    .subarray(0, secretBytes);
}

function encodeBase32(input: Buffer): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let value = 0;
  let bits = 0;
  let encoded = "";

  for (const byte of input) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      encoded += alphabet[(value >>> bits) & 31];
    }
  }
  if (bits > 0) encoded += alphabet[(value << (5 - bits)) & 31];
  return encoded;
}

export function totpProvisioningData(secret: Buffer, account: string) {
  const encoded = encodeBase32(secret);
  const label = encodeURIComponent(`${issuer}:${account}`);
  const params = new URLSearchParams({
    secret: encoded,
    issuer,
    algorithm: "SHA1",
    digits: "6",
    period: "30",
  });
  return { secret: encoded, uri: `otpauth://totp/${label}?${params}` };
}

function credentialBinding(userId: string): Buffer {
  return Buffer.from(`khancoal/totp/${TOTP_KEY_ID}\0${userId}`, "utf8");
}

export function encryptTotpSecret(secret: Buffer, key: Buffer, userId: string) {
  const iv = randomBytes(ivBytes);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(credentialBinding(userId));
  const encrypted = Buffer.concat([cipher.update(secret), cipher.final()]);
  return Uint8Array.from(Buffer.concat([iv, cipher.getAuthTag(), encrypted]));
}

export function decryptTotpSecret(
  value: Uint8Array,
  key: Buffer,
  userId: string,
) {
  if (value.length !== ivBytes + tagBytes + secretBytes) {
    throw new Error("Invalid authenticator enrollment.");
  }
  const iv = value.subarray(0, ivBytes);
  const tag = value.subarray(ivBytes, ivBytes + tagBytes);
  const encrypted = value.subarray(ivBytes + tagBytes);
  const cipher = createDecipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(credentialBinding(userId));
  cipher.setAuthTag(tag);
  return Buffer.concat([cipher.update(encrypted), cipher.final()]);
}

function totpCode(secret: Buffer, step: bigint): Buffer {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(step);
  const digest = createHmac("sha1", secret).update(counter).digest();
  const offset = digest[digest.length - 1] & 15;
  const value = (digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000;
  return Buffer.from(value.toString().padStart(6, "0"), "ascii");
}

export function verifyTotpStep(
  secret: Buffer,
  code: string,
  now: Date,
  lastAcceptedStep: bigint | null,
): bigint | null {
  if (code.length !== 6 || !/^[0-9]{6}$/.test(code)) return null;
  const step = BigInt(Math.floor(now.getTime() / 30_000));
  const submitted = Buffer.from(code, "ascii");
  for (const candidate of [step, step - 1n, step + 1n]) {
    if (
      candidate >= 0n &&
      (lastAcceptedStep === null || candidate > lastAcceptedStep) &&
      timingSafeEqual(totpCode(secret, candidate), submitted)
    ) {
      return candidate;
    }
  }
  return null;
}
