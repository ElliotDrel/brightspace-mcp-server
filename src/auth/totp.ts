import { createHmac } from "node:crypto";

interface TotpEnrollment {
  secret: Buffer;
  algorithm: "sha1" | "sha256" | "sha512";
  digits: number;
  period: number;
}

function parseEnrollment(uri: string): TotpEnrollment {
  let url: URL;
  try { url = new URL(uri); } catch { throw new Error("Invalid authenticator enrollment URI."); }
  const secret = url.searchParams.get("secret")?.toUpperCase().replace(/\s/g, "") ?? "";
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  if (url.protocol !== "otpauth:" || url.hostname !== "totp" || !/^[A-Z2-7]+=*$/.test(secret)) {
    throw new Error("Invalid authenticator enrollment URI.");
  }
  const raw = secret.replace(/=+$/, "");
  let bits = 0, buffer = 0;
  const bytes: number[] = [];
  for (const char of raw) {
    buffer = (buffer << 5) | alphabet.indexOf(char);
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((buffer >>> bits) & 255);
      buffer &= (1 << bits) - 1;
      buffer &= (1 << bits) - 1;
    }
  }
  const algorithm = (url.searchParams.get("algorithm") ?? "SHA1").toLowerCase();
  const digits = Number(url.searchParams.get("digits") ?? "6");
  const period = Number(url.searchParams.get("period") ?? "30");
  if (bytes.length < 10 || buffer !== 0 || !["sha1", "sha256", "sha512"].includes(algorithm)
    || ![6, 7, 8].includes(digits) || !Number.isSafeInteger(period) || period <= 0) {
    throw new Error("Invalid authenticator enrollment URI.");
  }
  return { secret: Buffer.from(bytes), algorithm: algorithm as TotpEnrollment["algorithm"], digits, period };
}

/** Accept the same setup key or otpauth URI as the Purdue SSO extension. */
export function normalizeTotpEnrollment(input: string, username: string): string {
  const trimmed = input.trim();
  const key = trimmed.toUpperCase().replace(/\s/g, "");
  const uri = trimmed.startsWith("otpauth://") ? trimmed
    : `otpauth://totp/${encodeURIComponent(`Purdue:${username}`)}?secret=${key}&issuer=Purdue`;
  parseEnrollment(uri);
  return uri;
}

export function secondsUntilFreshCode(uri: string, now = Date.now()): number {
  const { period } = parseEnrollment(uri);
  return period - (now / 1000 % period);
}

export function generateTotp(uri: string, now = Date.now()): string {
  const { secret, algorithm, digits, period } = parseEnrollment(uri);
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(now / 1000 / period)));
  const digest = createHmac(algorithm, secret).update(counter).digest();
  const offset = digest[digest.length - 1]! & 15;
  const value = (digest.readUInt32BE(offset) & 0x7fffffff) % 10 ** digits;
  return String(value).padStart(digits, "0");
}
