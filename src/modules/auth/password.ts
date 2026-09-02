import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";

const KEY_LENGTH = 64;
const PARAMETERS = { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 } as const;

function deriveKey(password: string, salt: Buffer, length: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCallback(password, salt, length, PARAMETERS, (error, key) => error ? reject(error) : resolve(key));
  });
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await deriveKey(password, salt, KEY_LENGTH);
  return `scrypt$v=1$N=${PARAMETERS.N},r=${PARAMETERS.r},p=${PARAMETERS.p}$${salt.toString("base64url")}$${key.toString("base64url")}`;
}

export async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  const parts = encoded.split("$");
  if (parts.length !== 5 || parts[0] !== "scrypt" || parts[1] !== "v=1") return false;
  const salt = Buffer.from(parts[3], "base64url");
  const expected = Buffer.from(parts[4], "base64url");
  if (salt.length !== 16 || expected.length !== KEY_LENGTH) return false;
  const actual = await deriveKey(password, salt, expected.length);
  return timingSafeEqual(actual, expected);
}
