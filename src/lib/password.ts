import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scryptAsync = promisify(scrypt);
const KEY_LENGTH = 64;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("base64url");
  const key = (await scryptAsync(password, salt, KEY_LENGTH)) as Buffer;
  return `scrypt:${salt}:${key.toString("base64url")}`;
}

export async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
  const [algorithm, salt, expectedKey] = storedHash.split(":");
  if (algorithm !== "scrypt" || !salt || !expectedKey) return false;

  const expected = Buffer.from(expectedKey, "base64url");
  const actual = (await scryptAsync(password, salt, expected.length)) as Buffer;
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
