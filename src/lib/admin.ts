export const ADMIN_EMAIL = "theooow@hotmail.com";

export function isAdminEmail(email: string): boolean {
  return email.toLowerCase() === ADMIN_EMAIL;
}
