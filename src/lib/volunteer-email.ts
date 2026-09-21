export type VolunteerEmailContent = {
  kind: "REGISTERED" | "APPROVED" | "PLANNING" | "SHIFT_UPDATE";
  fullName: string; eventName: string; associationName: string; logoUrl: string | null;
  portalUrl?: string; confirmationMessage?: string;
  primaryColor?: string | null;
};
const escape = (value: string) => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");

export function renderVolunteerEmail(data: VolunteerEmailContent) {
  const primaryColor = /^#[0-9a-f]{6}$/i.test(data.primaryColor ?? "") ? data.primaryColor! : "#0f766e";
  const channels = [1, 3, 5].map((offset) => {
    const value = parseInt(primaryColor.slice(offset, offset + 2), 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  const luminance = 0.2126 * channels[0]! + 0.7152 * channels[1]! + 0.0722 * channels[2]!;
  const buttonTextColor = luminance > 0.179 ? "#000000" : "#ffffff";
  // Keep text readable on white even when the workspace chooses a very light accent.
  const linkColor = luminance <= 0.183 ? primaryColor : "#172033";
  const title = { REGISTERED: "Inscription bien reçue", APPROVED: "Bienvenue dans l’équipe !", PLANNING: "Votre planning vous attend", SHIFT_UPDATE: "Votre planning a été modifié" }[data.kind];
  const message = data.kind === "REGISTERED"
    ? data.confirmationMessage || "Votre candidature a bien été reçue. Nous vous écrirons dès qu’elle sera validée."
    : data.kind === "APPROVED"
      ? "Votre candidature est validée. Retrouvez votre planning et votre badge dans votre espace personnel."
      : data.kind === "SHIFT_UPDATE" ? "Un de vos postes vient d’être affecté ou modifié. Retrouvez les nouveaux horaires dans votre espace personnel."
      : "Vos créneaux sont prêts. Rendez-vous dans votre espace personnel pour accepter ou refuser l’ensemble de vos horaires à venir.";
  const cta = data.kind === "PLANNING" ? "Valider mes créneaux" : "Accéder à mon espace";
  const url = data.kind === "REGISTERED" ? undefined : data.portalUrl;
  const subject = `${data.associationName} · ${title} · ${data.eventName}`;
  const text = [`${data.associationName} · ${data.eventName}`, "", `Bonjour ${data.fullName},`, "", message,
    ...(url ? ["", `${cta} : ${url}`, "Ce lien est personnel : conservez-le et ne le partagez pas."] : []), "", "Merci pour votre engagement !", data.associationName].join("\n");
  const html = `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;background:#f1f5f9;font-family:Arial,Helvetica,sans-serif;color:#172033">
<div style="display:none;max-height:0;overflow:hidden">${escape(title)} · ${escape(data.eventName)}</div>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td align="center" style="padding:32px 12px">
<table role="presentation" width="560" cellspacing="0" cellpadding="0" style="width:100%;max-width:560px;background:#fff;border-radius:20px;overflow:hidden">
<tr><td style="padding:28px 28px 20px;border-top:6px solid ${primaryColor};border-bottom:1px solid #e2e8f0">
${data.logoUrl ? `<img src="${escape(data.logoUrl)}" alt="${escape(data.associationName)}" width="120" style="display:block;max-width:120px;height:auto;margin-bottom:16px">` : ""}
<strong style="font-size:15px">${escape(data.associationName)}</strong></td></tr>
<tr><td style="padding:32px 28px"><p style="margin:0 0 12px;color:${linkColor};font-size:12px;font-weight:bold;letter-spacing:1px">${escape(data.eventName)}</p>
<h1 style="margin:0 0 24px;font-size:28px;line-height:1.2">${escape(title)}</h1>
<p style="font-size:16px;line-height:1.7">Bonjour ${escape(data.fullName)},</p>
<p style="font-size:16px;line-height:1.7;color:#475569">${escape(message)}</p>
${url ? `<table role="presentation" cellspacing="0" cellpadding="0" style="margin:28px 0"><tr><td bgcolor="${primaryColor}" style="border-radius:12px"><a href="${escape(url)}" style="display:inline-block;padding:16px 24px;color:${buttonTextColor};font-size:15px;font-weight:bold;text-decoration:none">${cta}</a></td></tr></table><p style="font-size:12px;line-height:1.6;color:#64748b">Ce lien est personnel : conservez-le et ne le partagez pas.<br>Si le bouton ne fonctionne pas :<br><a href="${escape(url)}" style="color:${linkColor};word-break:break-all">${escape(url)}</a></p>` : ""}
<p style="margin-top:28px;font-size:15px">Merci pour votre engagement !</p></td></tr>
<tr><td style="padding:20px 28px;background:#f8fafc;color:#64748b;font-size:12px">L’équipe ${escape(data.associationName)} · ${escape(data.eventName)}</td></tr>
</table></td></tr></table></body></html>`;
  return { subject, text, html };
}
