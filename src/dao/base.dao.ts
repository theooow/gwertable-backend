import type { PrismaClient } from "@prisma/client";

/**
 * Classe de base pour tous les DAO (Data Access Objects).
 *
 * Fournit l'accès au client Prisma via injection de dépendance.
 * Pour les transactions, le repository instancie un DAO temporaire avec
 * le client transactionnel `tx` : `new XxxDao(tx).methode(...)`.
 */
export abstract class BaseDao {
  constructor(protected readonly prisma: PrismaClient) {}
}
