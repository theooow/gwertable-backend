import nodemailer from "nodemailer";
import { env } from "../env.js";
import { EmailDeliveryError } from "./errors.js";
import { renderEmailHtml } from "./email-layout.js";
import { renderVolunteerEmail, type VolunteerEmailContent } from "./volunteer-email.js";

function createTransport() {
  return nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_SECURE,
    connectionTimeout: 15_000,
    greetingTimeout: 15_000,
    socketTimeout: 30_000,
    auth:
      env.SMTP_USER && env.SMTP_PASSWORD
        ? {
            user: env.SMTP_USER,
            pass: env.SMTP_PASSWORD,
          }
        : undefined,
  });
}

export const contractMailer = {
  async send(email: string, subject: string, text: string, html?: string) {
    // Never pretend that a verification code was delivered in production.
    if (env.MAIL_TRANSPORT === "log") throw new EmailDeliveryError("L’envoi SMTP doit être configuré pour signer une convention.");
    try { await createTransport().sendMail({ from: env.MAIL_FROM, to: email, subject, text, html }); }
    catch { throw new EmailDeliveryError("Email non envoyé. Réessayez depuis la convention."); }
  },
};

export async function sendVolunteerEmail(email: string, content: VolunteerEmailContent, deliveryId: string) {
  if (env.MAIL_TRANSPORT === "log") {
    console.info({ deliveryId, kind: content.kind }, "Volunteer email skipped (log transport)");
    return;
  }
  await createTransport().sendMail({ from: env.MAIL_FROM, to: email,
    messageId: `<volunteer-${deliveryId}@${new URL(env.FRONTEND_URL).hostname}>`,
    ...renderVolunteerEmail(content),
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

  const validity = `Valable ${env.AUTH_TOKEN_TTL_MINUTES} minutes`;
  const ignore = "Si vous n’êtes pas à l’origine de cette demande, ignorez cet email.";
  const subject = "Votre code de connexion Abregi";
  const text = [
    "Votre code de connexion Abregi :",
    "",
    code,
    "",
    `${validity}. Vous pouvez aussi vous connecter avec ce lien :`,
    url,
    "",
    ignore,
  ].join("\n");
  const html = renderEmailHtml({
    preheader: `${validity}.`,
    title: "Votre code de connexion",
    paragraphs: ["Saisissez ce code sur la page de connexion."],
    code: { value: code, caption: validity },
    action: { label: "Se connecter directement", url },
    notes: [ignore],
  });

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
