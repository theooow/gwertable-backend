import type { UsagePlan, UserRole, UserThemeMode, UserThemePreset } from "@prisma/client";

/**
 * Informations utilisateur renvoyées lors d'une authentification réussie.
 */
export type UserSessionDTO = {
  id: string;
  email: string;
  name: string | null;
  image: string | null;
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  postalCode: string | null;
  city: string | null;
  country: string | null;
  companyName: string | null;
  companyAddressLine1: string | null;
  companyAddressLine2: string | null;
  companyPostalCode: string | null;
  companyCity: string | null;
  companyCountry: string | null;
  companySiret: string | null;
  companyVatNumber: string | null;
  billingEmail: string | null;
  locale: string;
  currency: string;
  timezone: string;
  emailNotificationsEnabled: boolean;
  taskReminderNotificationsEnabled: boolean;
  eventReminderNotificationsEnabled: boolean;
  marketingNotificationsEnabled: boolean;
  themeMode: UserThemeMode;
  themePreset: UserThemePreset;
  themePrimaryColor: string | null;
  /** @deprecated Use workspaceRole. Kept while clients migrate. */
  role: UserRole;
  /** Role granted by the currently selected workspace. */
  workspaceRole: UserRole;
  usagePlan: UsagePlan;
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
