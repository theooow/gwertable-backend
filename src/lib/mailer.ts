import nodemailer from "nodemailer";
import { env } from "../env.js";
import { EmailDeliveryError } from "./errors.js";

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

export async function sendMagicLinkEmail({
  email,
  url,
  code,
}: {
  email: string;
  url: string;
  code: string;
}) {
  if (env.MAIL_TRANSPORT === "log") {
    console.info({ email, url, code }, "Login email skipped");
    return;
  }

  const escapedUrl = escapeHtml(url);
  const escapedCode = escapeHtml(code);
  const subject = "Ton code de connexion Abregi";
  const text = [
    "Bonjour,",
    "",
    "Voici ton code de connexion Abregi :",
    code,
    "",
    "Tu peux aussi utiliser ce lien :",
    url,
    "",
    `Ce code expire dans ${env.AUTH_TOKEN_TTL_MINUTES} minutes.`,
    "",
    "Si tu n'es pas a l'origine de cette demande, ignore cet email.",
  ].join("\n");
  const html = `
    <p>Bonjour,</p>
    <p>Voici ton code de connexion Abregi :</p>
    <p style="font-size:24px;font-weight:700;letter-spacing:4px">${escapedCode}</p>
    <p>Tu peux aussi utiliser ce lien :</p>
    <p><a href="${escapedUrl}">Se connecter a Abregi</a></p>
    <p>Ce code expire dans ${env.AUTH_TOKEN_TTL_MINUTES} minutes.</p>
    <p>Si tu n'es pas a l'origine de cette demande, ignore cet email.</p>
  `;

  try {
    await createTransport().sendMail({
      from: env.MAIL_FROM,
      to: email,
      subject,
      text,
      html,
    });
  } catch (cause) {
    throw new EmailDeliveryError("Impossible d'envoyer le lien de connexion par email");
  }
}

export async function sendInvoiceEmail({ email, customerName, number, pdf }: { email: string; customerName: string; number: string; pdf: Buffer }) {
  if (env.MAIL_TRANSPORT === "log") { console.info({ email, number }, "Invoice email skipped"); return; }
  try { await createTransport().sendMail({ from: env.MAIL_FROM, to: email, subject: `Facture ${number}`, text: `Bonjour ${customerName},\n\nVeuillez trouver votre facture ${number} en pièce jointe.`, attachments: [{ filename: `${number}.pdf`, content: pdf, contentType: "application/pdf" }] }); }
  catch { throw new EmailDeliveryError("Impossible d'envoyer la facture par email"); }
}
