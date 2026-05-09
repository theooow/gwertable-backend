import { env } from "../env.js";
import { sendMagicLinkEmail } from "../lib/mailer.js";
import { randomToken } from "../lib/token.js";
import { UnauthorizedError } from "../lib/errors.js";
import { AuthRepository } from "../repositories/auth.repository.js";
import type { AuthSessionDTO } from "../dto/auth.dto.js";

/**
 * Service métier pour le domaine authentification.
 * Orchestre le flux magic link : envoi, vérification, création de session.
 */
export class AuthService {
  constructor(private readonly authRepository: AuthRepository) {}

  /**
   * Déclenche l'envoi d'un lien de connexion par email.
   * Valide l'invitation si un token est fourni avant d'envoyer.
   *
   * @param email - Adresse email de l'utilisateur
   * @param inviteToken - Token d'invitation optionnel
   * @param baseUrl - URL de base du frontend pour construire le lien
   * @returns `{ ok: true, email }`
   * @throws {UnauthorizedError} Si l'invitation est invalide ou expirée
   */
  async requestLoginLink(
    email: string,
    inviteToken: string | undefined,
    baseUrl: string,
  ): Promise<{ ok: true; email: string }> {
    await this.authRepository.getValidInvitation(email, inviteToken);

    const token = randomToken();
    const expires = new Date(Date.now() + env.AUTH_TOKEN_TTL_MINUTES * 60 * 1000);

    await this.authRepository.createVerificationToken(email, token, expires);

    const url = new URL("/login/verify", baseUrl);
    url.searchParams.set("email", email);
    url.searchParams.set("token", token);
    if (inviteToken) url.searchParams.set("invite", inviteToken);

    await sendMagicLinkEmail({ email, url: url.toString() });

    return { ok: true, email };
  }

  /**
   * Vérifie un token de connexion et crée une session.
   *
   * @param email - Adresse email de l'utilisateur
   * @param token - Token de vérification reçu par email
   * @param inviteToken - Token d'invitation optionnel
   * @returns DTO de session avec les informations utilisateur
   * @throws {UnauthorizedError} Si le token est invalide ou expiré
   */
  async verify(
    email: string,
    token: string,
    inviteToken: string | undefined,
  ): Promise<AuthSessionDTO> {
    const now = new Date();
    const maxExpires = new Date(now.getTime() + env.AUTH_TOKEN_TTL_MINUTES * 60 * 1000);

    const consumed = await this.authRepository.consumeVerificationToken(
      email,
      token,
      now,
      maxExpires,
    );

    if (consumed !== 1) {
      throw new UnauthorizedError("Lien de connexion invalide ou expire");
    }

    const invitation = await this.authRepository.getValidInvitation(email, inviteToken);
    const user = await this.authRepository.findOrCreateUser(email, invitation);
    await this.authRepository.acceptInvitation(invitation, user.id);

    let workspaceId = user.defaultWorkspaceId;
    let role = user.role;
    let workspaceName = "";

    if (workspaceId) {
      const access = await this.authRepository.getWorkspaceAccess(user.id, workspaceId);
      if (access) {
        role = access.role;
        workspaceName = access.workspaceName;
      } else {
        workspaceName = (await this.authRepository.getWorkspaceName(workspaceId)) ?? "";
      }
    } else {
      const collaborator = await this.authRepository.findCollaboratorWorkspace(user.id);
      if (collaborator) {
        workspaceId = collaborator.workspaceId;
        role = collaborator.role;
        workspaceName = collaborator.workspace.name;
      }
    }

    const sessionToken = randomToken();
    const expires = new Date(Date.now() + env.SESSION_TTL_DAYS * 24 * 60 * 60 * 1000);
    await this.authRepository.createSession(user.id, sessionToken, expires);

    return {
      sessionToken,
      expires: expires.toISOString(),
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        image: user.image,
        role,
        personId: user.personId,
        workspaceId,
        workspaceName,
      },
    };
  }

  /**
   * Supprime la session courante (déconnexion).
   *
   * @param sessionToken - Token de la session à invalider, ou `null`
   * @returns `{ ok: true }`
   */
  async logout(sessionToken: string | null): Promise<{ ok: true }> {
    if (sessionToken) {
      await this.authRepository.deleteSession(sessionToken);
    }
    return { ok: true };
  }
}
