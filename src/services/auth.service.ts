import { randomInt } from "node:crypto";
import { env } from "../env.js";
import { sendMagicLinkEmail } from "../lib/mailer.js";
import { randomToken } from "../lib/token.js";
import { UnauthorizedError } from "../lib/errors.js";
import { hashPassword, verifyPassword } from "../lib/password.js";
import { AuthRepository } from "../repositories/auth.repository.js";
import type { AuthSessionDTO } from "../dto/auth.dto.js";

type VerifyResult =
  | AuthSessionDTO
  | {
      requiresPasswordSetup: true;
      email: string;
      setupToken: string;
      expires: string;
    };

/**
 * Service métier pour le domaine authentification.
 * Orchestre le flux magic link : envoi, vérification, création de session.
 */
export class AuthService {
  constructor(private readonly authRepository: AuthRepository) {}

  async getLoginOptions(
    email: string,
    inviteToken: string | undefined,
    baseUrl: string,
  ): Promise<
    | {
        ok: true;
        email: string;
        hasPassword: true;
        accountName: string;
      }
    | {
        ok: true;
        email: string;
        hasPassword: false;
        codeSent: true;
      }
  > {
    await this.authRepository.getValidInvitation(email, inviteToken);

    const user = await this.authRepository.findUserByEmail(email);
    if (user?.passwordHash) {
      return {
        ok: true,
        email,
        hasPassword: true,
        accountName: user.name ?? user.email,
      };
    }

    await this.requestLoginLink(email, inviteToken, baseUrl);
    return { ok: true, email, hasPassword: false, codeSent: true };
  }

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
    const code = randomInt(100000, 1000000).toString();
    const expires = new Date(Date.now() + env.AUTH_TOKEN_TTL_MINUTES * 60 * 1000);

    await this.authRepository.createVerificationToken(email, token, expires);
    await this.authRepository.createVerificationToken(`code:${email}`, code, expires);

    const url = new URL("/login/verify", baseUrl);
    url.searchParams.set("email", email);
    url.searchParams.set("token", token);
    if (inviteToken) url.searchParams.set("invite", inviteToken);

    await sendMagicLinkEmail({ email, url: url.toString(), code });

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
  ): Promise<VerifyResult> {
    return this.verifyEmailToken(email, token, inviteToken, email);
  }

  async verifyCode(
    email: string,
    code: string,
    inviteToken: string | undefined,
  ): Promise<VerifyResult> {
    return this.verifyEmailToken(email, code, inviteToken, `code:${email}`);
  }

  async loginWithPassword(
    email: string,
    password: string,
    inviteToken: string | undefined,
  ): Promise<AuthSessionDTO> {
    const user = await this.authRepository.findUserByEmail(email);
    if (!user?.passwordHash || !(await verifyPassword(password, user.passwordHash))) {
      throw new UnauthorizedError("Email ou mot de passe invalide");
    }

    const invitation = await this.authRepository.getValidInvitation(email, inviteToken);
    const resolvedUser = invitation
      ? await this.authRepository.findOrCreateUser(email, invitation)
      : user;
    await this.authRepository.acceptInvitation(invitation, resolvedUser.id);

    return this.createSessionForUser(resolvedUser.id);
  }

  async setupPassword(email: string, token: string, password: string): Promise<AuthSessionDTO> {
    const now = new Date();
    const maxExpires = new Date(now.getTime() + env.AUTH_TOKEN_TTL_MINUTES * 60 * 1000);

    const consumed = await this.authRepository.consumeVerificationToken(
      `password-setup:${email}`,
      token,
      now,
      maxExpires,
    );

    if (consumed !== 1) {
      throw new UnauthorizedError("Verification de mot de passe invalide ou expiree");
    }

    const user = await this.authRepository.findUserByEmail(email);
    if (!user) throw new UnauthorizedError("Utilisateur introuvable");

    await this.authRepository.updatePasswordHash(user.id, await hashPassword(password));
    return this.createSessionForUser(user.id);
  }

  private async verifyEmailToken(
    email: string,
    token: string,
    inviteToken: string | undefined,
    identifier: string,
  ): Promise<VerifyResult> {
    const now = new Date();
    const maxExpires = new Date(now.getTime() + env.AUTH_TOKEN_TTL_MINUTES * 60 * 1000);

    const consumed = await this.authRepository.consumeVerificationToken(
      identifier,
      token,
      now,
      maxExpires,
    );

    if (consumed !== 1) {
      throw new UnauthorizedError("Lien ou code de connexion invalide ou expire");
    }

    const invitation = await this.authRepository.getValidInvitation(email, inviteToken);
    const user = await this.authRepository.findOrCreateUser(email, invitation);
    const verifiedUser = await this.authRepository.markEmailVerified(user.id);
    await this.authRepository.acceptInvitation(invitation, verifiedUser.id);

    if (!verifiedUser.passwordHash) {
      const setupToken = randomToken();
      const expires = new Date(Date.now() + env.AUTH_TOKEN_TTL_MINUTES * 60 * 1000);
      await this.authRepository.createVerificationToken(
        `password-setup:${email}`,
        setupToken,
        expires,
      );

      return {
        requiresPasswordSetup: true,
        email,
        setupToken,
        expires: expires.toISOString(),
      };
    }

    return this.createSessionForUser(verifiedUser.id);
  }

  private async createSessionForUser(userId: string): Promise<AuthSessionDTO> {
    const user = await this.authRepository.findUserById(userId);
    if (!user) throw new UnauthorizedError("Utilisateur introuvable");

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
        firstName: user.firstName,
        lastName: user.lastName,
        phone: user.phone,
        addressLine1: user.addressLine1,
        addressLine2: user.addressLine2,
        postalCode: user.postalCode,
        city: user.city,
        country: user.country,
        companyName: user.companyName,
        companyAddressLine1: user.companyAddressLine1,
        companyAddressLine2: user.companyAddressLine2,
        companyPostalCode: user.companyPostalCode,
        companyCity: user.companyCity,
        companyCountry: user.companyCountry,
        companySiret: user.companySiret,
        companyVatNumber: user.companyVatNumber,
        billingEmail: user.billingEmail,
        locale: user.locale,
        currency: user.currency,
        timezone: user.timezone,
        emailNotificationsEnabled: user.emailNotificationsEnabled,
        taskReminderNotificationsEnabled: user.taskReminderNotificationsEnabled,
        eventReminderNotificationsEnabled: user.eventReminderNotificationsEnabled,
        marketingNotificationsEnabled: user.marketingNotificationsEnabled,
        themeMode: user.themeMode,
        themePreset: user.themePreset,
        themePrimaryColor: user.themePrimaryColor,
        role,
        usagePlan: user.usagePlan,
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
