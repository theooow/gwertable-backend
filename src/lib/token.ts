import { randomBytes } from "node:crypto";

/**
 * Génère un token aléatoire cryptographiquement sûr en base64url.
 *
 * @param bytes - Nombre d'octets aléatoires à générer (32 par défaut)
 * @returns Token encodé en base64url
 */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}
