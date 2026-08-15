import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { env } from "../env.js";
import { ValidationError } from "./errors.js";

function key() {
  const raw = env.PDP_CREDENTIAL_ENCRYPTION_KEY;
  if (!raw) throw new ValidationError("La clé de chiffrement PDP n'est pas configurée");

  const bytes = /^[0-9a-f]{64}$/i.test(raw)
    ? Buffer.from(raw, "hex")
    : Buffer.from(raw, "base64");
  if (bytes.length !== 32) {
    throw new ValidationError("La clé de chiffrement PDP doit contenir exactement 32 octets");
  }
  return bytes;
}

/** Encrypt a secret for storage. The result contains IV, authentication tag and ciphertext. */
export function encryptCredential(value: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString("base64url");
}

export function decryptCredential(value: string) {
  const data = Buffer.from(value, "base64url");
  const iv = data.subarray(0, 12);
  const tag = data.subarray(12, 28);
  const ciphertext = data.subarray(28);
  const decipher = createDecipheriv("aes-256-gcm", key(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}
