import { createHash, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import type { FastifyRequest } from "fastify";
import type { VolunteerContract } from "@prisma/client";
import type { z } from "zod";
import { prisma } from "../prisma.js";
import { env } from "../env.js";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "../lib/errors.js";
import { requireCan } from "../lib/permissions.js";
import { contractMailer } from "../lib/mailer.js";
import { renderContractCodeEmail, renderContractInvitationEmail } from "../lib/contract-email.js";
import { VolunteerRepository, volunteerTransaction } from "./volunteer.repository.js";
import { contractInput, signatureInput, SIGNATURE_CONSENT } from "../schemas/volunteer-contract.js";
import { contractContext, contractContent, isCurrentContract, resolveContractToken } from "../services/volunteer-contract-lifecycle.js";
import { contractPdf } from "../services/volunteer-contract-pdf.js";
import { recordActivity } from "../lib/activity-recorder.js";

export const sha256 = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
const volunteers = new VolunteerRepository();
const selectSummary = { id: true, eventId: true, personId: true, title: true, eventName: true, signerName: true, signerEmail: true, status: true, createdAt: true, expiresAt: true, signedAt: true, invitationSentAt: true, documentHash: true, signedPdfHash: true } as const;
const normalizeName = (name: string) => name.normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase("fr");

export class VolunteerContractRepository {
  async list(request: FastifyRequest, scope: { eventId?: string; personId?: string }) {
    if (scope.eventId) await volunteers.authorize(request, scope.eventId);
    else {
      if (request.eventScoped) throw new ForbiddenError("Accès réservé au carnet de contacts");
      requireCan(request.userRole, "person.read");
      if (!await prisma.person.findFirst({ where: { id: scope.personId!, workspaceId: request.workspaceId } })) throw new NotFoundError("Contact introuvable");
    }
    return prisma.volunteerContract.findMany({ where: { workspaceId: request.workspaceId, ...scope }, select: selectSummary, orderBy: { createdAt: "desc" } });
  }

  async create(request: FastifyRequest, eventId: string, data: z.infer<typeof contractInput>) {
    const event = await volunteers.authorize(request, eventId);
    return volunteerTransaction(async (tx) => {
      const application = await tx.volunteerApplication.findFirst({ where: { id: data.applicationId, eventId, status: "APPROVED" }, include: { person: true } });
      if (!application) throw new ValidationError("Sélectionnez une candidature validée.");
      const email = application.person.email ?? application.email;
      if (!email) throw new ValidationError("Renseignez l’email du bénévole dans sa fiche contact.");
      const context = await contractContext(tx, application.id);
      if (!context.eligible) throw new ValidationError("Affectez au moins un créneau au bénévole avant de créer sa convention.");
      const content = contractContent(context) + `\n\nConditions complémentaires\nOrganisme : ${data.organization}\nReprésentant : ${data.representative}\n${data.terms}`;
      const pdf = await contractPdf(content);
      return tx.volunteerContract.create({ data: {
        workspaceId: request.workspaceId, eventId, personId: application.personId, applicationId: application.id,
        title: data.title, eventName: event.name, signerName: application.person.fullName, signerEmail: email,
        assignmentHash: context.assignmentHash, snapshot: context.snapshot,
        content, sourcePdf: new Uint8Array(pdf), documentHash: sha256(pdf), createdBy: request.user!.id,
        tokenHash: sha256(randomBytes(32)), expiresAt: new Date(Date.now() + 30 * 86400000),
      }, select: selectSummary });
    });
  }

  async managed(request: FastifyRequest, id: string, scope: { eventId?: string; personId?: string }) {
    // Authorize the scope before resolving the identifier to prevent cross-event access.
    await this.list(request, scope);
    const contract = await prisma.volunteerContract.findFirst({ where: { id, workspaceId: request.workspaceId, ...scope } });
    if (!contract) throw new NotFoundError("Convention introuvable");
    return contract;
  }

  async invite(contract: VolunteerContract) {
    if (!await isCurrentContract(prisma, contract)) throw new ConflictError("Le planning a changé. La convention actuelle est disponible dans le portail bénévole.");
    const token = randomBytes(32).toString("base64url");
    const tokenHash = sha256(token);
    const now = new Date();
    const changed = await prisma.volunteerContract.updateMany({ where: {
      id: contract.id, status: "PENDING", OR: [{ invitationSentAt: null }, { invitationSentAt: { lte: new Date(Date.now() - 60000) } }],
    }, data: { tokenHash, expiresAt: new Date(Date.now() + 30 * 86400000), invitationSentAt: now, codeHash: null, codeExpiresAt: null } });
    if (!changed.count) throw new ConflictError("Convention déjà signée, annulée ou invitation envoyée il y a moins d’une minute.");
    try {
      const email = renderContractInvitationEmail(contract, `${env.FRONTEND_URL}/volunteers/contracts/${token}`);
      await contractMailer.send(contract.signerEmail, email.subject, email.text, email.html);
    } catch (error) {
      await prisma.volunteerContract.updateMany({ where: { id: contract.id, status: "PENDING", tokenHash }, data: { invitationSentAt: null, tokenHash: sha256(randomBytes(32)) } });
      throw error;
    }
    return { ok: true };
  }

  async cancel(contract: VolunteerContract) {
    const result = await prisma.volunteerContract.updateMany({ where: { id: contract.id, status: "PENDING" }, data: { status: "CANCELLED", codeHash: null } });
    if (!result.count) throw new ConflictError("Cette convention ne peut plus être annulée.");
    return { ok: true };
  }

  async publicContract(token: string) {
    const contract = await resolveContractToken(prisma, token);
    if (!contract || !await isCurrentContract(prisma, contract)) throw new NotFoundError("Ce lien est expiré ou indisponible. Contactez l’organisateur.");
    return contract;
  }

  async code(token: string) {
    const contract = await this.publicContract(token);
    const code = randomInt(0, 1000000).toString().padStart(6, "0");
    const codeHash = sha256(`${token}:${contract.documentHash}:${code}`);
    const now = new Date();
    const updated = await prisma.volunteerContract.updateMany({ where: {
      id: contract.id, tokenHash: contract.tokenHash, status: "PENDING", codeSends: { lt: 10 },
      OR: [{ codeSentAt: null }, { codeSentAt: { lte: new Date(Date.now() - 60000) } }],
    }, data: { codeHash, codeSentAt: now, codeExpiresAt: new Date(Date.now() + 10 * 60000), codeAttempts: 0, codeSends: { increment: 1 } } });
    if (!updated.count) throw new ConflictError("Patientez une minute entre deux codes. Maximum 10 envois par convention ; contactez l’organisateur si nécessaire.");
    const email = renderContractCodeEmail(contract, code);
    try { await contractMailer.send(contract.signerEmail, email.subject, email.text, email.html); }
    catch (error) {
      await prisma.volunteerContract.updateMany({ where: { id: contract.id, status: "PENDING", codeHash }, data: { codeHash: null, codeExpiresAt: null } });
      throw error;
    }
    return { ok: true };
  }

  async sign(token: string, input: z.infer<typeof signatureInput>, request: Pick<FastifyRequest, "ip" | "headers" | "log">) {
    // Invalid attempts must commit, not roll back with the HTTP validation error.
    const result = await volunteerTransaction(async (tx) => {
      const contract = await resolveContractToken(tx, token);
      if (!contract || contract.status !== "PENDING" || !await isCurrentContract(tx, contract)) return { error: "Convention indisponible ou déjà signée." };
      if (input.documentHash !== contract.documentHash) return { error: "Le document a changé. Rechargez la page." };
      if (!contract.codeHash || !contract.codeExpiresAt || contract.codeExpiresAt <= new Date() || contract.codeAttempts >= 5) return { error: "Code expiré ou bloqué. Demandez un nouveau code." };
      await tx.volunteerContract.update({ where: { id: contract.id }, data: { codeAttempts: { increment: 1 } } });
      if (!timingSafeEqual(Buffer.from(contract.codeHash, "hex"), Buffer.from(sha256(`${token}:${contract.documentHash}:${input.code}`), "hex"))) return { error: "Code incorrect." };
      if (normalizeName(input.name) !== normalizeName(contract.signerName)) return { error: "Saisissez le nom indiqué sur la convention. En cas d’erreur, contactez l’organisateur." };
      if (sha256(Buffer.from(contract.sourcePdf)) !== contract.documentHash) throw new ConflictError("Intégrité du document non vérifiable.");
      const signedAt = new Date();
      const evidence = {
        version: 2, eventId: contract.eventId, applicationId: contract.applicationId,
        assignmentHash: contract.assignmentHash, snapshot: contract.snapshot,
        method: "EMAIL_OTP_SIMPLE", contractId: contract.id, documentHash: contract.documentHash,
        documentHashAlgorithm: "SHA-256", signerName: input.name, signerEmail: contract.signerEmail,
        consent: SIGNATURE_CONSENT, signedAt: signedAt.toISOString(), codeSentAt: contract.codeSentAt!.toISOString(),
        invitationSentAt: contract.invitationSentAt?.toISOString() ?? null,
        issuedAt: contract.createdAt.toISOString(), issuedBy: contract.createdBy,
        ip: request.ip, userAgent: (request.headers["user-agent"] ?? "").slice(0, 1000),
        notice: "Signature électronique simple. Horodatage serveur, sans certificat ni horodatage qualifié. L’adresse IP est celle observée par le serveur et peut être celle du proxy.",
      };
      const proof = `Convention : ${contract.id}\nSignataire : ${input.name}\nEmail vérifié : ${contract.signerEmail}\nSignée le : ${signedAt.toISOString()}\nÉmise le : ${evidence.issuedAt}\nÉmise par : ${evidence.issuedBy}\nCode envoyé le : ${evidence.codeSentAt}\nAdresse IP observée : ${evidence.ip}\n\n${SIGNATURE_CONSENT}\n\nEmpreinte SHA-256 du PDF présenté :\n${contract.documentHash}\n\n${evidence.notice}`;
      const pdf = await contractPdf(contract.content, proof);
      await tx.volunteerContract.update({ where: { id: contract.id }, data: { status: "SIGNED", signedAt, evidence, signedPdf: new Uint8Array(pdf), signedPdfHash: sha256(pdf), codeHash: null, codeExpiresAt: null } });
      return { contract };
    });
    if ("error" in result) throw new ValidationError(result.error!);
    const { contract } = result;
    await recordActivity({
      workspaceId: contract.workspaceId, eventId: contract.eventId,
      type: "VOLUNTEER_CONTRACT_SIGNED", title: `Convention signée par ${contract.signerName}`, body: contract.title,
      entityType: "VOLUNTEER_CONTRACT", entityId: contract.id,
    }, request.log);
    return { ok: true };
  }
}
