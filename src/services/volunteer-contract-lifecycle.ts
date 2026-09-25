import { createHash, randomBytes } from "node:crypto";
import type { Prisma, VolunteerContract } from "@prisma/client";
import { contractPdf } from "./volunteer-contract-pdf.js";

export const hash = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
const date = (value: Date) => value.toLocaleString("fr-FR", { dateStyle: "long", timeStyle: "short", timeZone: "Europe/Paris" });

export async function contractContext(tx: Prisma.TransactionClient, applicationId: string) {
  const app = await tx.volunteerApplication.findUniqueOrThrow({ where: { id: applicationId }, include: {
    person: true, event: { include: { venue: true, volunteerForm: true, workspace: { include: { legalEntity: true,
      members: { where: { role: "ADMIN" }, orderBy: { id: "asc" }, take: 1, include: { user: { select: { email: true } } } },
    } } } },
  } });
  const shifts = await tx.shift.findMany({ where: { eventId: app.eventId, assigneeId: app.personId }, orderBy: [{ startsAt: "asc" }, { id: "asc" }],
    select: { id: true, position: true, team: true, startsAt: true, endsAt: true, notes: true } });
  const { event } = app;
  const form = event.volunteerForm;
  const legal = event.workspace.legalEntity;
  const snapshot = {
    revision: app.contractRevision,
    organization: legal?.legalName || event.workspace.name,
    address: legal ? [legal.addressLine1, legal.addressLine2, legal.postalCode, legal.city, legal.countryCode].filter(Boolean).join(", ") : "",
    siret: legal?.siret ?? "",
    representative: form?.contractRepresentative || "L’équipe d’organisation",
    contact: form?.contractContact || event.workspace.members[0]?.user.email || "",
    retentionYears: form?.contractRetentionYears ?? 3,
    event: { id: event.id, name: event.name, startsAt: event.startsAt.toISOString(), endsAt: event.endsAt?.toISOString() ?? null,
      location: [event.venue?.name, event.venue?.address].filter(Boolean).join(" — ") || "Lieu à confirmer auprès de l’organisateur" },
    shifts: shifts.map((s) => ({ ...s, team: s.team ?? "", notes: s.notes ?? "", startsAt: s.startsAt.toISOString(), endsAt: s.endsAt.toISOString() })),
  };
  return { app, shifts, snapshot, assignmentHash: hash(JSON.stringify(snapshot)), eligible: app.status === "APPROVED" && !app.person.archivedAt && shifts.length > 0 };
}

export function contractContent(context: Awaited<ReturnType<typeof contractContext>>) {
  const { app, snapshot: s, shifts } = context;
  return `Convention de bénévolat

Les parties
Organisme : ${s.organization}${s.address ? `\nAdresse : ${s.address}` : ""}${s.siret ? `\nSIRET : ${s.siret}` : ""}
Représentant / référent : ${s.representative}
Contact de l’organisateur : ${s.contact || "Via le contact habituel de l’organisation"}
Bénévole : ${app.person.fullName}
Email : ${app.person.email ?? app.email ?? ""}

Objet et mission
La présente convention définit les conditions de participation bénévole à l’événement « ${s.event.name} ».
Lieu : ${s.event.location}
Événement du ${date(app.event.startsAt)} au ${date(app.event.endsAt ?? shifts.at(-1)!.endsAt)} (heure de Paris).
Les missions et créneaux convenus sont les suivants :
${shifts.map((shift) => `\nPoste : ${shift.position}${shift.team ? ` — Équipe : ${shift.team}` : ""}\nDu ${date(shift.startsAt)} au ${date(shift.endsAt)} (heure de Paris)${shift.notes ? `\nMission et consignes : ${shift.notes}` : ""}`).join("\n")}

Engagement bénévole
La participation est libre et non rémunérée, sans lien de subordination juridique. Le bénévole peut mettre fin à son engagement à tout moment et en informe si possible l’organisateur afin de faciliter l’organisation. Les créneaux ci-dessus correspondent à la disponibilité convenue entre les parties.

Accueil et conditions de participation
L’organisateur fournit les informations, les moyens et les consignes de sécurité nécessaires à la mission. Le bénévole respecte les personnes, les lieux et les règles de sécurité applicables ; il signale au contact de l’organisateur toute difficulté ou situation dangereuse. Les éventuels remboursements concernent uniquement les frais réels préalablement convenus et justifiés, sans rémunération de la participation.

Modification de la mission
Tout changement de poste, d’équipe, d’horaires ou de mission donne lieu à une nouvelle version de la convention à lire et à signer. La signature d’une version antérieure ne vaut pas acceptation des nouvelles affectations. Les exemplaires antérieurs et leurs preuves de signature sont conservés.

Données personnelles
${s.organization} est responsable du traitement des informations d’identité, de contact, d’affectation et des preuves de signature pour gérer et justifier cette convention. Le traitement repose sur l’exécution de la convention et l’intérêt légitime de l’organisateur à conserver la preuve de l’engagement.
Ces informations sont accessibles aux personnes habilitées de l’organisation et aux prestataires techniques nécessaires au service. Elles sont conservées pendant ${s.retentionYears} ans à compter de la fin de l’événement, puis supprimées ou anonymisées, sauf obligation légale ou litige nécessitant une conservation plus longue.
Pour exercer vos droits d’accès, de rectification, d’effacement, de limitation ou d’opposition dans les conditions applicables, contactez : ${s.contact || "le contact habituel de l’organisation"}. Vous pouvez également adresser une réclamation à la CNIL (www.cnil.fr).

Acceptation et signature
Le bénévole lit cette convention et confirme son accord par un code reçu à son adresse email. La signature porte sur le document identifié par son empreinte SHA-256. Une copie signée et son dossier de preuve sont disponibles dans son portail personnel.
Ce procédé constitue une signature électronique simple, sans certificat ni horodatage qualifié.`;
}

// Called in the same serializable transaction as planning changes. Signed records remain immutable.
export async function syncVolunteerContract(tx: Prisma.TransactionClient, eventId: string, personId: string) {
  const application = await tx.volunteerApplication.findUnique({ where: { eventId_personId: { eventId, personId } } });
  if (!application) return null;
  const context = await contractContext(tx, application.id);
  const latest = await tx.volunteerContract.findFirst({ where: { applicationId: application.id }, orderBy: [{ createdAt: "desc" }, { id: "desc" }] });
  if (context.eligible && latest?.assignmentHash === context.assignmentHash && latest.status !== "CANCELLED") return latest;
  await tx.volunteerContract.updateMany({ where: { applicationId: application.id, status: "PENDING" }, data: { status: "CANCELLED", codeHash: null, codeExpiresAt: null } });
  const email = context.app.person.email ?? application.email;
  if (!context.eligible || !email) {
    // An empty planning ends this version, even if exactly the same shift is later reassigned.
    const previous = latest?.snapshot as { revision?: number } | null;
    if (previous?.revision === application.contractRevision) await tx.volunteerApplication.update({ where: { id: application.id }, data: { contractRevision: { increment: 1 } } });
    return null;
  }
  const content = contractContent(context);
  const pdf = await contractPdf(content);
  return tx.volunteerContract.create({ data: {
    workspaceId: context.app.event.workspaceId, eventId, personId, applicationId: application.id,
    title: "Convention de bénévolat", eventName: context.app.event.name, signerName: context.app.person.fullName, signerEmail: email,
    content, snapshot: context.snapshot, assignmentHash: context.assignmentHash,
    sourcePdf: new Uint8Array(pdf), documentHash: hash(pdf), createdBy: "system",
    tokenHash: hash(randomBytes(32)), expiresAt: new Date(Date.now() + 30 * 86400000),
  } });
}

export async function isCurrentContract(tx: Prisma.TransactionClient, contract: VolunteerContract) {
  const context = await contractContext(tx, contract.applicationId);
  const latest = await tx.volunteerContract.findFirst({ where: { applicationId: contract.applicationId }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], select: { id: true } });
  return context.eligible && contract.assignmentHash === context.assignmentHash && latest?.id === contract.id && contract.status !== "CANCELLED";
}

export async function resolveContractToken(tx: Prisma.TransactionClient, token: string) {
  const tokenHash = hash(token);
  const direct = await tx.volunteerContract.findUnique({ where: { tokenHash } });
  if (direct && direct.expiresAt > new Date()) return direct;
  const access = await tx.volunteerContractAccess.findUnique({ where: { tokenHash }, include: { contract: { include: { application: { select: { accessToken: true } } } } } });
  if (!access || access.expiresAt <= new Date() || !access.contract.application.accessToken || hash(access.contract.application.accessToken) !== access.portalTokenHash) return null;
  return access.contract;
}
