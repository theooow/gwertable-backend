import type { Prisma } from "@prisma/client";

const sensitive = /password|token|secret|authorization|cookie|credential|api.?key|^code$|file|base64|^data$|image|attachment/i;
const maxBytes = 32 * 1024;

function clean(value: unknown, depth = 0): Prisma.InputJsonValue {
  if (depth > 12) return "[profondeur limitée]";
  if (value == null) return "[vide]";
  if (typeof value === "string") {
    // Free text can contain credentials and signed URLs too.
    return value.replace(/Bearer\s+[^\s"<>]+/gi, "Bearer [masqué]")
      .replace(/([?&](?:[^=&\s]*(?:token|secret|key|code|password)[^=&\s]*)=)[^&\s"<>]*/gi, "$1[masqué]")
      .slice(0, maxBytes);
  }
  if (typeof value === "number") return Number.isFinite(value) ? value : "[non fini]";
  if (typeof value === "boolean") return value;
  if (Buffer.isBuffer(value)) return "[binaire omis]";
  if (Array.isArray(value)) return value.slice(0, 100).map((item) => clean(item, depth + 1));
  if (typeof value === "object") return Object.fromEntries(Object.entries(value).slice(0, 100)
    .map(([key, entry]) => [key, sensitive.test(key) ? "[masqué]" : clean(entry, depth + 1)]));
  return "[contenu omis]";
}

export function sanitizeLog(value: unknown): Prisma.InputJsonValue {
  const result = clean(value);
  if (Buffer.byteLength(JSON.stringify(result)) > maxBytes) return "[contenu omis : limite de 32 Ko]";
  return result;
}

export function logAction(method: string, route: string, status: number): string | null {
  if (status >= 400 || !["POST", "PUT", "PATCH", "DELETE"].includes(method)) return null;
  const names: Record<string, string> = {
    "POST /api/auth/register": "Compte créé",
    "POST /api/events": "Événement créé",
    "POST /api/auth/password/login": "Connexion",
    "POST /api/auth/verify": "Connexion",
    "POST /api/auth/verify-code": "Connexion",
    "POST /api/auth/logout": "Déconnexion",
    "POST /api/auth/login-link": "Lien de connexion demandé",
    "PATCH /api/admin/users/:userId/plan": "Forfait modifié",
  };
  return names[`${method} ${route}`] ?? `${({ POST: "Création / action", PUT: "Modification", PATCH: "Modification", DELETE: "Suppression" })[method]} · ${route}`;
}
