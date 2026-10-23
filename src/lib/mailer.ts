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
  const greeting = `Bonjour ${customerName},`;
  const message = `Vous trouverez votre facture ${number} en pièce jointe.`;
  const html = renderEmailHtml({ preheader: message, title: `Facture ${number}`, greeting, paragraphs: [message] });
  try { await createTransport().sendMail({ from: env.MAIL_FROM, to: email, subject: `Facture ${number}`, text: `${greeting}\n\n${message}`, html, attachments: [{ filename: `${number}.pdf`, content: pdf, contentType: "application/pdf" }] }); }
  catch { throw new EmailDeliveryError("Impossible d'envoyer la facture par email"); }
}

export type BudgetTrialReminder = { email: string; resumeUrl: string; unsubscribeUrl: string; eventName: string | null; breakEvenTickets: number | null };

export async function sendBudgetTrialReminderEmail({ email, resumeUrl, unsubscribeUrl, eventName, breakEvenTickets }: BudgetTrialReminder) {
  if (env.MAIL_TRANSPORT === "log") {
    console.info({ email, resumeUrl }, "Budget trial reminder skipped (log transport)");
    return;
  }
  const subject = "Vous n’avez pas finalisé votre création de compte";
  const hook = breakEvenTickets !== null
    ? `Votre budget d’essai${eventName ? ` pour « ${eventName} »` : ""} est prêt : l’équilibre est atteint à ${breakEvenTickets} billets vendus.`
    : "Votre dashboard budget d’essai vous attend : quelques chiffres suffisent pour savoir si votre événement sera rentable.";
  const next = "Créez votre compte pour le retrouver tel quel, suivre vos dépenses réelles et ne plus finir dans le rouge.";
  const optOut = "Vous recevez cet unique rappel car vous avez essayé le dashboard budget d’Abregi.";
  const text = [hook, "", next, "", `Reprendre mon budget : ${resumeUrl}`, "", optOut, `Ne plus recevoir de rappel : ${unsubscribeUrl}`].join("\n");
  const html = renderEmailHtml({
    preheader: hook,
    title: "Votre budget vous attend",
    paragraphs: [hook, next],
    action: { label: "Reprendre mon budget", url: resumeUrl },
    notes: [optOut, `Ne plus recevoir de rappel : ${unsubscribeUrl}`],
  });
  await createTransport().sendMail({
    from: env.MAIL_FROM, to: email, subject, text, html,
    headers: { "List-Unsubscribe": `<${unsubscribeUrl}>` },
  });
}

export async function sendInactivityWarningEmail({ email, loginUrl, deletionDate }: { email: string; loginUrl: string; deletionDate: Date }) {
  if (env.MAIL_TRANSPORT === "log") {
    console.info({ email }, "Inactivity warning skipped (log transport)");
    return;
  }
  const date = deletionDate.toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Paris" });
  const subject = "Votre compte Abregi sera supprimé faute d’activité";
  const hook = `Vous ne vous êtes pas connecté à Abregi depuis bientôt trois ans. Sans connexion de votre part, votre compte sera supprimé le ${date}.`;
  const detail = "Si vous êtes le dernier membre de votre espace, ses contacts, bénévoles et documents seront effacés ; les événements ne seront conservés que sous forme anonyme. Pensez à exporter ce dont vous avez besoin.";
  const keep = "Pour conserver votre compte, il suffit de vous connecter.";
  const text = [hook, "", detail, "", keep, `Me connecter : ${loginUrl}`].join("\n");
  const html = renderEmailHtml({
    preheader: hook,
    title: "Votre compte va être supprimé",
    paragraphs: [hook, detail, keep],
    action: { label: "Me connecter", url: loginUrl },
  });
  await createTransport().sendMail({ from: env.MAIL_FROM, to: email, subject, text, html });
}

export type BillingIssue = "payment_failed" | "suspended";

/** Sent by Abregi itself so the customer is warned even when Stripe's own dunning emails are off. */
export async function sendBillingIssueEmail({ email, issue, settingsUrl }: { email: string; issue: BillingIssue; settingsUrl: string }) {
  if (env.MAIL_TRANSPORT === "log") {
    console.info({ email, issue }, "Billing issue email skipped (log transport)");
    return;
  }
  const failed = issue === "payment_failed";
  const subject = failed ? "Le paiement de ton abonnement Abregi a échoué" : "Ton abonnement Abregi est suspendu";
  const hook = failed
    ? "Le dernier prélèvement de ton abonnement Abregi n’a pas abouti. Ton accès reste ouvert pendant que nous retentons le paiement automatiquement."
    : "Malgré plusieurs tentatives, le paiement de ton abonnement n’a pas pu être encaissé : ton abonnement est suspendu et l’accès à ton espace est bloqué.";
  const next = failed
    ? "Pour éviter une suspension, mets à jour ta carte depuis tes paramètres d’abonnement."
    : "Tes événements, contacts et budgets sont conservés : reprends un abonnement depuis Abregi pour les retrouver.";
  const label = failed ? "Mettre à jour ma carte" : "Reprendre mon abonnement";
  const text = [hook, "", next, "", `${label} : ${settingsUrl}`].join("\n");
  const html = renderEmailHtml({ preheader: hook, title: subject, paragraphs: [hook, next], action: { label, url: settingsUrl } });
  await createTransport().sendMail({ from: env.MAIL_FROM, to: email, subject, text, html });
}

