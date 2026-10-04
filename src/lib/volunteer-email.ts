import { renderEmailHtml } from "./email-layout.js";

export type VolunteerEmailContent = {
  kind: "REGISTERED" | "APPROVED" | "PLANNING" | "SHIFT_UPDATE" | "SWAP_REQUEST";
  fullName: string; eventName: string; associationName: string; logoUrl: string | null;
  portalUrl?: string; confirmationMessage?: string;
  primaryColor?: string | null;
};

const copy = {
  REGISTERED: { title: "Inscription reçue", cta: "", message: "Votre candidature a bien été reçue. Vous recevrez un email dès qu’elle sera validée." },
  APPROVED: { title: "Candidature validée", cta: "Ouvrir mon espace", message: "Votre planning et votre badge sont disponibles dans votre espace bénévole." },
  PLANNING: { title: "Vos créneaux sont prêts", cta: "Voir mes créneaux", message: "Acceptez ou refusez vos prochains horaires depuis votre espace bénévole." },
  SHIFT_UPDATE: { title: "Planning modifié", cta: "Ouvrir mon espace", message: "Un de vos postes a été affecté ou modifié. Vérifiez vos horaires et signez la convention mise à jour : chaque changement de mission demande une nouvelle signature." },
  SWAP_REQUEST: { title: "Demande d’échange de créneau", cta: "Répondre à la demande", message: "Un autre bénévole vous propose d’échanger un créneau. Acceptez ou refusez depuis votre espace bénévole." },
};
const PERSONAL_LINK = "Ce lien est personnel, ne le partagez pas.";

export function renderVolunteerEmail(data: VolunteerEmailContent) {
  const { title, cta } = copy[data.kind];
  const message = data.kind === "REGISTERED" && data.confirmationMessage ? data.confirmationMessage : copy[data.kind].message;
  const url = data.kind === "REGISTERED" ? undefined : data.portalUrl;
  const greeting = `Bonjour ${data.fullName},`;
  const subject = `${data.associationName} · ${title} · ${data.eventName}`;
  const text = [`${data.associationName} · ${data.eventName}`, "", greeting, "", message,
    ...(url ? ["", `${cta} : ${url}`, PERSONAL_LINK] : []), "", data.associationName].join("\n");
  const html = renderEmailHtml({
    preheader: `${title} · ${data.eventName}`, eyebrow: data.eventName, title, greeting, paragraphs: [message],
    action: url ? { label: cta, url } : undefined, notes: url ? [PERSONAL_LINK] : undefined,
    sender: { name: data.associationName, logoUrl: data.logoUrl }, accentColor: data.primaryColor,
  });
  return { subject, text, html };
}
