import type { UserRole } from "@prisma/client";
import { requireCan } from "../lib/permissions.js";
import { WorkspaceRepository, type AccountUpdateInput } from "../repositories/workspace.repository.js";

/**
 * Service métier pour le domaine workspace.
 * Applique les contrôles de permissions avant de déléguer au {@link WorkspaceRepository}.
 */
export class WorkspaceService {
  constructor(private readonly workspaceRepository: WorkspaceRepository) {}

  /**
   * Retourne les données publiques de l'espace de travail (token Shotgun masqué).
   *
   * @param workspaceId - Identifiant de l'espace de travail
   */
  async getWorkspace(workspaceId: string) {
    return this.workspaceRepository.getWorkspace(workspaceId);
  }

  /**
   * Met à jour les paramètres de l'espace de travail.
   *
   * @param workspaceId - Identifiant de l'espace de travail
   * @param role - Rôle de l'utilisateur courant
   * @param name - Nouveau nom
   * @param shotgunOrganizerId - Identifiant organisateur Shotgun
   * @param shotgunApiToken - Token API Shotgun
   * @throws {ForbiddenError} Si le rôle ne permet pas la gestion des utilisateurs
   */
  async updateWorkspace(
    workspaceId: string,
    role: UserRole,
    name: string,
    shotgunOrganizerId: string | undefined,
    shotgunApiToken: string | undefined,
  ) {
    requireCan(role, "user.manage");
    return this.workspaceRepository.updateWorkspace(
      workspaceId,
      name,
      shotgunOrganizerId,
      shotgunApiToken,
    );
  }

  /**
   * Crée un nouvel espace de travail pour l'utilisateur courant.
   *
   * @param userId - Identifiant de l'utilisateur (devient ADMIN)
   * @param name - Nom de l'espace
   */
  async createWorkspace(userId: string, name: string) {
    return this.workspaceRepository.createWorkspace(userId, name);
  }

  /**
   * Supprime l'espace de travail courant.
   *
   * @param workspaceId - Identifiant de l'espace à supprimer
   * @param role - Rôle de l'utilisateur courant
   * @param currentUserId - Identifiant de l'utilisateur courant
   * @param confirmName - Nom de confirmation
   * @throws {ForbiddenError} Si le rôle ne permet pas la gestion des utilisateurs
   */
  async deleteWorkspace(
    workspaceId: string,
    role: UserRole,
    currentUserId: string,
    confirmName: string,
  ) {
    requireCan(role, "user.manage");
    return this.workspaceRepository.deleteWorkspace(workspaceId, currentUserId, confirmName);
  }

  /**
   * Retourne tous les espaces de travail accessibles par l'utilisateur.
   *
   * @param userId - Identifiant de l'utilisateur
   * @param email - Email de l'utilisateur
   * @param currentWorkspaceId - Identifiant de l'espace courant (pour le flag `current`)
   */
  async listWorkspaces(userId: string, email: string, currentWorkspaceId: string) {
    const workspaces = await this.workspaceRepository.listAccessibleWorkspaces(userId, email);
    return workspaces.map((ws) => ({ ...ws, current: ws.id === currentWorkspaceId }));
  }

  /**
   * Retourne les événements pour lesquels l'utilisateur est collaborateur.
   *
   * @param role - Rôle de l'utilisateur courant
   * @param userId - Identifiant de l'utilisateur
   * @param email - Email de l'utilisateur
   * @throws {ForbiddenError} Si le rôle ne permet pas la lecture des événements
   */
  async listInvitedEvents(role: UserRole, userId: string, email: string) {
    requireCan(role, "event.read");
    return this.workspaceRepository.listInvitedEvents(userId, email);
  }

  /**
   * Retourne les membres et invitations en attente.
   *
   * @param workspaceId - Identifiant de l'espace de travail
   * @param role - Rôle de l'utilisateur courant
   * @throws {ForbiddenError} Si le rôle ne permet pas la gestion des utilisateurs
   */
  async getMembers(workspaceId: string, role: UserRole) {
    requireCan(role, "user.manage");
    return this.workspaceRepository.getMembers(workspaceId);
  }

  /**
   * Met à jour le rôle d'un membre.
   *
   * @param memberId - Identifiant du membre
   * @param workspaceId - Identifiant de l'espace de travail
   * @param role - Rôle de l'utilisateur courant
   * @param newRole - Nouveau rôle à assigner
   * @throws {ForbiddenError} Si le rôle ne permet pas la gestion des utilisateurs
   */
  async updateMemberRole(
    memberId: string,
    workspaceId: string,
    role: UserRole,
    newRole: UserRole,
  ) {
    requireCan(role, "user.manage");
    return this.workspaceRepository.updateMemberRole(memberId, workspaceId, newRole);
  }

  /**
   * Retire un membre de l'espace de travail.
   *
   * @param memberId - Identifiant du membre
   * @param workspaceId - Identifiant de l'espace de travail
   * @param role - Rôle de l'utilisateur courant
   * @param currentUserId - Identifiant de l'utilisateur courant
   * @throws {ForbiddenError} Si le rôle ne permet pas la gestion des utilisateurs
   */
  async removeMember(memberId: string, workspaceId: string, role: UserRole, currentUserId: string) {
    requireCan(role, "user.manage");
    return this.workspaceRepository.removeMember(memberId, workspaceId, currentUserId);
  }

  /**
   * Crée ou renouvelle une invitation.
   *
   * @param workspaceId - Identifiant de l'espace de travail
   * @param role - Rôle de l'utilisateur courant
   * @param email - Email de l'invité
   * @param inviteRole - Rôle à assigner à l'invité
   * @throws {ForbiddenError} Si le rôle ne permet pas la gestion des utilisateurs
   */
  async createInvitation(
    workspaceId: string,
    role: UserRole,
    email: string,
    inviteRole: UserRole,
  ) {
    requireCan(role, "user.manage");
    return this.workspaceRepository.createInvitation(workspaceId, email, inviteRole);
  }

  /**
   * Accepte une invitation workspace ou événement.
   *
   * @param inviteToken - Token de l'invitation
   * @param userId - Identifiant de l'utilisateur
   * @param userEmail - Email de l'utilisateur
   */
  async acceptInvitation(inviteToken: string, userId: string, userEmail: string) {
    return this.workspaceRepository.acceptInvitation(inviteToken, userId, userEmail);
  }

  /**
   * Met à jour le profil utilisateur.
   *
   * @param userId - Identifiant de l'utilisateur
   * @param data - Champs compte a mettre a jour
   */
  async updateAccount(userId: string, data: AccountUpdateInput) {
    return this.workspaceRepository.updateAccount(userId, data);
  }

  /**
   * Supprime le compte utilisateur.
   *
   * @param userId - Identifiant de l'utilisateur
   * @param workspaceId - Identifiant de l'espace courant
   * @param userRole - Rôle de l'utilisateur
   * @param confirmEmail - Email de confirmation
   * @param actualEmail - Email réel du compte
   * @throws {ValidationError} Si la confirmation ne correspond pas
   */
  async deleteAccount(
    userId: string,
    workspaceId: string,
    userRole: UserRole,
    confirmEmail: string,
    actualEmail: string,
  ) {
    const { ValidationError } = await import("../lib/errors.js");
    if (confirmEmail !== actualEmail) {
      throw new ValidationError("La confirmation doit correspondre a l'email du compte");
    }
    return this.workspaceRepository.deleteAccount(userId, workspaceId, userRole);
  }

  /**
   * Bascule l'espace de travail par défaut de l'utilisateur.
   *
   * @param userId - Identifiant de l'utilisateur
   * @param workspaceId - Identifiant du nouvel espace par défaut
   */
  async switchWorkspace(userId: string, workspaceId: string) {
    return this.workspaceRepository.switchWorkspace(userId, workspaceId);
  }

  /**
   * Transfère les contacts d'un espace source vers l'espace courant.
   *
   * @param sourceWorkspaceId - Identifiant de l'espace source
   * @param targetWorkspaceId - Identifiant de l'espace cible
   * @param excludedPersonIds - Identifiants des personnes à exclure
   * @param role - Rôle de l'utilisateur courant
   * @param userId - Identifiant de l'utilisateur
   * @param userEmail - Email de l'utilisateur
   * @throws {ForbiddenError} Si le rôle ne permet pas l'écriture sur les personnes
   */
  async transferContacts(
    sourceWorkspaceId: string,
    targetWorkspaceId: string,
    excludedPersonIds: string[],
    role: UserRole,
    userId: string,
    userEmail: string,
  ) {
    requireCan(role, "person.write");
    return this.workspaceRepository.transferContacts(
      sourceWorkspaceId,
      targetWorkspaceId,
      excludedPersonIds,
      userId,
      userEmail,
    );
  }
}
