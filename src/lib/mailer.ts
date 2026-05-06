import nodemailer from "nodemailer";
import { env } from "../env.js";

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function createTransport() {
  return nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_SECURE,
    auth:
      env.SMTP_USER && env.SMTP_PASSWORD
        ? {
            user: env.SMTP_USER,
            pass: env.SMTP_PASSWORD,
          }
        : undefined,
  });
}

export async function sendMagicLinkEmail({ email, url }: { email: string; url: string }) {
  if (env.MAIL_TRANSPORT === "log") {
    console.info({ email, url }, "Magic login link email skipped");
    return;
  }

  const escapedUrl = escapeHtml(url);
  const subject = "Ton lien de connexion Abregi";
  const text = [
    "Bonjour,",
    "",
    "Voici ton lien de connexion Abregi :",
    url,
    "",
    `Ce lien expire dans ${env.AUTH_TOKEN_TTL_MINUTES} minutes.`,
    "",
    "Si tu n'es pas a l'origine de cette demande, ignore cet email.",
  ].join("\n");
  const html = `
    <p>Bonjour,</p>
    <p>Voici ton lien de connexion Abregi :</p>
    <p><a href="${escapedUrl}">Se connecter a Abregi</a></p>
    <p>Ce lien expire dans ${env.AUTH_TOKEN_TTL_MINUTES} minutes.</p>
    <p>Si tu n'es pas a l'origine de cette demande, ignore cet email.</p>
  `;

  await createTransport().sendMail({
    from: env.MAIL_FROM,
    to: email,
    subject,
    text,
    html,
  });
}
