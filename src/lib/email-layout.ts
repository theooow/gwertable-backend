import { env } from "../env.js";

export type EmailLayout = {
  preheader: string;
  title: string;
  paragraphs: string[];
  eyebrow?: string;
  greeting?: string;
  code?: { value: string; caption: string };
  action?: { label: string; url: string };
  notes?: string[];
  /** Workspace branding; Abregi branding is used when absent. */
  sender?: { name: string; logoUrl: string | null };
  accentColor?: string | null;
};

const ABREGI_ACCENT = "#a51e58";
const INK = "#252b36";
const BODY = "#414956";
const MUTED = "#657080";
const BORDER = "#e0e4e9";
const FONT = "'Segoe UI',Arial,Helvetica,sans-serif";
const MONO = "ui-monospace,SFMono-Regular,Menlo,Consolas,'Courier New',monospace";

export const escapeHtml = (value: string) => value
  .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");

export function emailAccent(color?: string | null) {
  const accent = /^#[0-9a-f]{6}$/i.test(color ?? "") ? color! : ABREGI_ACCENT;
  const channels = [1, 3, 5].map((offset) => {
    const value = parseInt(accent.slice(offset, offset + 2), 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  const luminance = 0.2126 * channels[0]! + 0.7152 * channels[1]! + 0.0722 * channels[2]!;
  // Keep text readable on white even when the workspace chooses a very light accent.
  return { accent, onAccent: luminance > 0.179 ? "#000000" : "#ffffff", link: luminance <= 0.183 ? accent : INK };
}

const abregiLogo = (width: number) =>
  `<img src="${escapeHtml(`${env.FRONTEND_URL}/images/png/abregi_typo_jazzberry.png`)}" alt="Abregi" width="${width}" style="display:block;width:${width}px;height:auto;border:0">`;

export function renderEmailHtml(layout: EmailLayout): string {
  const { accent, onAccent, link } = emailAccent(layout.accentColor);
  const paragraph = (text: string) => `<p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:${BODY}">${escapeHtml(text)}</p>`;
  const header = layout.sender
    ? layout.sender.logoUrl
      ? `<img src="${escapeHtml(layout.sender.logoUrl)}" alt="${escapeHtml(layout.sender.name)}" width="96" style="display:block;max-width:96px;height:auto;border:0">`
      : `<strong style="font-size:15px;color:${INK}">${escapeHtml(layout.sender.name)}</strong>`
    : abregiLogo(104);
  const code = layout.code ? `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:8px 0 24px"><tr>
<td align="center" style="padding:20px 16px;background:#f8eaf0;border:1px solid #efd3df;border-radius:8px">
<div style="font-family:${MONO};font-size:32px;line-height:1.2;font-weight:700;letter-spacing:8px;padding-left:8px;color:#8b1849">${escapeHtml(layout.code.value)}</div>
<div style="margin-top:8px;font-size:13px;color:${MUTED}">${escapeHtml(layout.code.caption)}</div></td></tr></table>` : "";
  const action = layout.action ? `<table role="presentation" cellspacing="0" cellpadding="0" style="margin:8px 0 24px"><tr>
<td bgcolor="${accent}" style="border-radius:6px"><a href="${escapeHtml(layout.action.url)}" style="display:inline-block;padding:12px 20px;color:${onAccent};font-size:15px;font-weight:600;text-decoration:none;border-radius:6px">${escapeHtml(layout.action.label)}</a></td></tr></table>
<p style="margin:0 0 16px;font-size:13px;line-height:1.6;color:${MUTED}">Si le bouton ne fonctionne pas, copiez ce lien dans votre navigateur :<br><a href="${escapeHtml(layout.action.url)}" style="color:${link};word-break:break-all">${escapeHtml(layout.action.url)}</a></p>` : "";
  const notes = layout.notes?.length
    ? `<p style="margin:24px 0 0;padding-top:16px;border-top:1px solid ${BORDER};font-size:13px;line-height:1.6;color:${MUTED}">${layout.notes.map(escapeHtml).join("<br>")}</p>`
    : "";
  const footer = layout.sender
    ? `Envoyé par ${escapeHtml(layout.sender.name)} avec Abregi.`
    : "Email envoyé automatiquement par Abregi. Merci de ne pas y répondre.";

  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(layout.title)}</title></head>
<body style="margin:0;padding:0;background:#f7f8fa;font-family:${FONT};color:${INK}">
<div style="display:none;max-height:0;overflow:hidden">${escapeHtml(layout.preheader)}</div>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f7f8fa"><tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="520" cellspacing="0" cellpadding="0" style="width:100%;max-width:520px">
<tr><td style="padding:0 4px 16px">${header}</td></tr>
<tr><td style="background:#ffffff;border:1px solid ${BORDER};border-top:3px solid ${accent};border-radius:8px;padding:32px 28px">
${layout.eyebrow ? `<p style="margin:0 0 8px;font-size:13px;font-weight:600;color:${link}">${escapeHtml(layout.eyebrow)}</p>` : ""}
<h1 style="margin:0 0 20px;font-size:20px;line-height:1.3;font-weight:600;color:${INK}">${escapeHtml(layout.title)}</h1>
${layout.greeting ? paragraph(layout.greeting) : ""}${layout.paragraphs.map(paragraph).join("")}
${code}${action}${notes}
</td></tr>
<tr><td style="padding:16px 4px 0;font-size:12px;line-height:1.6;color:${MUTED}">${footer}</td></tr>
</table></td></tr></table></body></html>`;
}
