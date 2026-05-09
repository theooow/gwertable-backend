import type { UserRole } from "@prisma/client";

/**
 * Informations utilisateur renvoyées lors d'une authentification réussie.
 */
export type UserSessionDTO = {
  id: string;
  email: string;
  name: string | null;
  image: string | null;
  role: UserRole;
  personId: string | null;
  workspaceId: string | null | undefined;
  workspaceName: string;
};

/**
 * Réponse complète d'une vérification de token (connexion réussie).
 */
export type AuthSessionDTO = {
  sessionToken: string;
  expires: string;
  user: UserSessionDTO;
};
