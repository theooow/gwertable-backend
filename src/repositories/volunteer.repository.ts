import { createHash, randomBytes } from "node:crypto";
import type { Prisma, PrismaClient } from "@prisma/client";
import { setTimeout as delay } from "node:timers/promises";
import type { FastifyRequest } from "fastify";
import { prisma } from "../prisma.js";
import { requireCan } from "../lib/permissions.js";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "../lib/errors.js";
import { availabilityPeriodSchema, questionSchema, intervalSchema, type ApplicationInput, type FormInput, type ReviewInput, type ShiftInput, type CateringInput } from "../schemas/volunteer.js";
import { suggestVolunteerAssignments } from "../services/volunteer-planning.service.js";
import { contractPdf } from "../services/volunteer-contract-pdf.js";

// Serializable transactions prevent concurrent approvals or assignments from
// exceeding meal capacities, duplicating contacts, or double-booking a person.
export async function volunteerTransaction<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>, db: PrismaClient = prisma): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try { return await db.$transaction(fn, { isolationLevel: "Serializable" }); }
    catch (error) {
      // Prisma can surface the same error through different runtime classes.
      // Back off so the competing transaction has time to commit before retrying.
      if (error instanceof Error && "code" in error && (error.code === "P2034" || error.code === "P2002")) {
        if (attempt >= 4) throw new ConflictError("Une modification concurrente est en cours. Réessayez dans un instant.");
        await delay(25 * 2 ** attempt + Math.floor(Math.random() * 25));
        continue;
      }
      throw error;
    }
  }
}
const transaction = volunteerTransaction;

export class VolunteerRepository {
  private async queueShiftEmail(tx: Prisma.TransactionClient, eventId: string, personId: string, shiftId: string, version: number) {
    const app = await tx.volunteerApplication.findFirst({ where: { eventId, personId, status: "APPROVED" } });
    if (!app) return;
    await tx.volunteerEmail.createMany({ data: [{ applicationId: app.id, kind: "SHIFT_UPDATE", dedupeKey: `shift:${shiftId}:${version}` }], skipDuplicates: true });
  }
  async authorize(request: FastifyRequest, eventId: string) {
    const event = await prisma.event.findFirst({ where: { id: eventId, workspaceId: request.workspaceId } });
    if (!event) throw new NotFoundError("Événement introuvable");
    if (request.eventScoped) {
      const collaborator = await prisma.eventCollaborator.findFirst({ where: {
        eventId, workspaceId: request.workspaceId, acceptedAt: { not: null },
        OR: [{ userId: request.user!.id }, { email: request.user!.email }],
      } });
      if (!collaborator) throw new ForbiddenError("Accès refusé");
      requireCan(collaborator.role, "volunteer.manage");
    } else requireCan(request.userRole, "volunteer.manage");
    return event;
  }

  async overview(eventId: string) {
    const [form, applications, shifts, services, event] = await Promise.all([
      prisma.volunteerForm.findUnique({ where: { eventId } }),
      prisma.volunteerApplication.findMany({ where: { eventId }, orderBy: { createdAt: "desc" }, include: { meals: true, person: { select: { fullName: true, email: true, phone: true } } } }),
      prisma.shift.findMany({ where: { eventId }, orderBy: { startsAt: "asc" }, include: { assignee: { select: { id: true, fullName: true } } } }),
      prisma.cateringService.findMany({ where: { eventId }, orderBy: { startsAt: "asc" }, include: { bookings: true } }),
      prisma.event.findUniqueOrThrow({ where: { id: eventId }, select: { name: true, startsAt: true, endsAt: true } }),
    ]);
    const busySlots = await prisma.shift.findMany({
      where: { eventId: { not: eventId }, assigneeId: { in: [...new Set([...applications.map((a) => a.personId), ...shifts.flatMap((s) => s.assigneeId ? [s.assigneeId] : [])])] } },
      select: { assigneeId: true, startsAt: true, endsAt: true },
    });
    return { form, applications: applications.map(({ person, ...application }) => ({
      ...application, fullName: person.fullName, email: person.email ?? application.email ?? "", phone: person.phone ?? application.phone,
    })), shifts, services, event, busySlots };
  }

  saveForm(eventId: string, data: FormInput) {
    return prisma.volunteerForm.upsert({ where: { eventId },
      create: { ...data, eventId, token: randomBytes(32).toString("base64url") }, update: data });
  }
  rotateToken(eventId: string) {
    return prisma.volunteerForm.update({ where: { eventId }, data: { token: randomBytes(32).toString("base64url") } });
  }

  private async openForm(token: string, db: Prisma.TransactionClient = prisma) {
    const form = await db.volunteerForm.findUnique({ where: { token }, include: {
      event: { select: { id: true, name: true, startsAt: true, endsAt: true, workspaceId: true, status: true, workspace: { select: { name: true, logoUrl: true, emailPrimaryColor: true } } } },
    } });
    if (!form || !form.published || (form.closesAt && form.closesAt <= new Date()) || ["DONE", "ARCHIVED"].includes(form.event.status)) {
      throw new NotFoundError("Ce formulaire est fermé ou indisponible");
    }
    return form;
  }

  async publicForm(token: string) {
    const form = await this.openForm(token);
    const services = await prisma.cateringService.findMany({ where: { eventId: form.eventId }, orderBy: { startsAt: "asc" }, select: { id: true, label: true, startsAt: true } });
    return { title: form.title, description: form.description, collectPhone: form.collectPhone,
      availabilityPeriods: form.availabilityPeriods, organization: form.event.workspace,
      collectDietary: form.collectDietary, teams: form.teams, questions: form.questions,
      closesAt: form.closesAt, event: { name: form.event.name, startsAt: form.event.startsAt, endsAt: form.event.endsAt }, services };
  }

  async submit(token: string, data: ApplicationInput) {
    return transaction(async (tx) => {
      const form = await this.openForm(token, tx);
      const periods = availabilityPeriodSchema.array().parse(form.availabilityPeriods);
      if (data.availability.some((v) => !periods.some((p) => p.startsAt === v.startsAt && p.endsAt === v.endsAt))) {
        throw new ValidationError("Sélectionnez les périodes proposées par l’organisation. Actualisez le formulaire si elles ont changé.");
      }
      const availability = periods.filter((p) => data.availability.some((v) => v.startsAt === p.startsAt && v.endsAt === p.endsAt)).map(({ startsAt, endsAt }) => ({ startsAt, endsAt }));
      const questions = questionSchema.array().parse(form.questions);
      const answers = questions.map((q) => {
        const value = data.answers[q.id] ?? (q.type === "checkbox" ? false : "");
        if (q.type === "checkbox" ? typeof value !== "boolean" : typeof value !== "string") throw new ValidationError(`Réponse invalide : ${q.label}`);
        if (q.required && !value) throw new ValidationError(`Réponse requise : ${q.label}`);
        if (q.type === "select" && value && !q.options.includes(String(value))) throw new ValidationError(`Choix invalide : ${q.label}`);
        return { id: q.id, label: q.label, value };
      });
      if (data.preferredTeams.some((t) => !form.teams.includes(t))) throw new ValidationError("Équipe inconnue");
      const mealIds = [...new Set(data.mealIds)];
      if (await tx.cateringService.count({ where: { eventId: form.eventId, id: { in: mealIds } } }) !== mealIds.length) throw new ValidationError("Repas inconnu");
      // Same response for repeat submissions: never disclose existing personal data
      // and never let an anonymous retry overwrite a reviewed application.
      const existing = await tx.volunteerApplication.findUnique({ where: { eventId_email: { eventId: form.eventId, email: data.email } } });
      if (existing) return { message: form.confirmationMessage };
      let person = await tx.person.findFirst({ where: { workspaceId: form.event.workspaceId, email: { equals: data.email, mode: "insensitive" } } });
      if (!person) person = await tx.person.create({ data: {
        workspaceId: form.event.workspaceId, fullName: data.fullName, email: data.email,
        phone: form.collectPhone ? data.phone : "", tags: ["bénévole"],
      } });
      if (await tx.volunteerApplication.findUnique({ where: { eventId_personId: { eventId: form.eventId, personId: person.id } } })) return { message: form.confirmationMessage };
      const application = await tx.volunteerApplication.create({ data: {
        eventId: form.eventId, personId: person.id, email: data.email, fullName: data.fullName,
        phone: form.collectPhone ? data.phone : "", dietary: form.collectDietary ? data.dietary : "",
        preferredTeams: [...new Set(data.preferredTeams)], availability, answers, notes: data.notes,
        meals: { create: mealIds.map((serviceId) => ({ serviceId })) },
      } });
      await tx.volunteerEmail.create({ data: { applicationId: application.id, kind: "REGISTERED", dedupeKey: `registered:${application.id}` } });
      return { message: form.confirmationMessage };
    });
  }

  async syncParticipant(tx: Prisma.TransactionClient, participant: { eventId: string; personId: string; roles: string[]; dietary: string | null }) {
    const { eventId, personId, dietary } = participant;
    let application = await tx.volunteerApplication.findUnique({ where: { eventId_personId: { eventId, personId } } });
    if (!participant.roles.includes("VOLUNTEER")) {
      if (application?.status === "APPROVED") await this.reviewInTransaction(tx, eventId, application.id, {
        status: "CANCELLED", team: application.team, internalNotes: application.internalNotes,
      });
      return;
    }
    if (!application) {
      const person = await tx.person.findUniqueOrThrow({ where: { id: personId } });
      application = await tx.volunteerApplication.create({ data: {
        eventId, personId, email: null, fullName: person.fullName, phone: person.phone ?? "", consentAt: null,
        dietary: dietary ?? "",
      } });
    }
    await this.reviewInTransaction(tx, eventId, application.id, {
      status: "APPROVED", team: application.team, internalNotes: application.internalNotes, dietary: dietary ?? "",
    });
  }

  async review(eventId: string, id: string, data: ReviewInput) {
    return transaction((tx) => this.reviewInTransaction(tx, eventId, id, data));
  }

  private async reviewInTransaction(tx: Prisma.TransactionClient, eventId: string, id: string, data: ReviewInput) {
      const app = await tx.volunteerApplication.findFirst({ where: { id, eventId }, include: { meals: { include: { service: true } } } });
      if (!app) throw new NotFoundError("Candidature introuvable");
      if (data.availability && data.status === "APPROVED") {
        const assigned = await tx.shift.findMany({ where: { eventId, assigneeId: app.personId } });
        if (assigned.some((s) => !data.availability!.some((v) => new Date(v.startsAt) <= s.startsAt && new Date(v.endsAt) >= s.endsAt))) throw new ConflictError("Ces disponibilités excluent un créneau déjà affecté. Modifiez d’abord le planning.");
      }
      if (data.status === "APPROVED") {
        const person = await tx.person.findUniqueOrThrow({ where: { id: app.personId } });
        if (person.archivedAt) throw new ConflictError("Restaurez d’abord ce contact dans le carnet");
        for (const meal of app.meals) await this.checkCapacity(tx, meal.service, app.id);
        const existing = await tx.eventParticipant.findUnique({ where: { eventId_personId: { eventId, personId: app.personId } } });
        await tx.eventParticipant.upsert({ where: { eventId_personId: { eventId, personId: app.personId } },
          create: { eventId, personId: app.personId, roles: ["VOLUNTEER"], dietary: data.dietary ?? app.dietary, rsvpStatus: "YES" },
          update: { roles: [...new Set([...(existing?.roles ?? []), "VOLUNTEER" as const])], dietary: data.dietary ?? app.dietary },
        });
      } else if (app.status === "APPROVED") {
        if (app.meals.some((m) => m.servedAt)) throw new ConflictError("Annulez le pointage des repas avant de retirer la validation");
        await tx.shift.updateMany({ where: { eventId, assigneeId: app.personId }, data: { assigneeId: null, reminderSentAt: null, confirmationStatus: "PENDING", confirmationVersion: { increment: 1 } } });
        const participant = await tx.eventParticipant.findUnique({ where: { eventId_personId: { eventId, personId: app.personId } } });
        if (participant) {
          const roles = participant.roles.filter((r) => r !== "VOLUNTEER");
          if (roles.length) await tx.eventParticipant.update({ where: { id: participant.id }, data: { roles } });
          else await tx.eventParticipant.delete({ where: { id: participant.id } });
        }
      }
      const updated = await tx.volunteerApplication.update({ where: { id }, data: { ...data, reviewedAt: data.status === "PENDING" ? null : new Date(),
        ...(data.status === "APPROVED" ? { accessToken: app.accessToken || randomBytes(32).toString("base64url"), badgeToken: app.badgeToken || randomBytes(32).toString("base64url") } : {}),
        ...(data.status !== "APPROVED" ? { accessToken: null, badgeToken: null, checkedInAt: null } : {}),
      } });
      if (data.status === "APPROVED" && app.status !== "APPROVED") {
        await tx.volunteerEmail.create({ data: { applicationId: id, kind: "APPROVED", dedupeKey: `approved:${id}:${updated.accessToken}` } });

        // Auto-generate contract asynchronously outside the transaction
        Promise.resolve().then(async () => {
          try {
            const event = await prisma.event.findUniqueOrThrow({ where: { id: eventId }, include: { workspace: true } });
            const person = await prisma.person.findUniqueOrThrow({ where: { id: app.personId } });
            const email = person.email ?? app.email;
            if (email) {
              const content = `Convention de bénévolat\n\nOrganisme : ${event.workspace.name}\nReprésentant : L'équipe d'organisation\n\nBénévole : ${person.fullName}\nEmail : ${email}\nÉvénement : ${event.name}\nDébut : ${event.startsAt.toISOString()}\nFin : ${event.endsAt?.toISOString() ?? "Non précisée"}\n\nLe bénévole s'engage à participer à l'événement dans le respect des règles de l'organisation. L'association s'engage à fournir les conditions nécessaires au bon déroulement de la mission.\n\nÉmise par le représentant désigné, qui déclare être habilité à engager l’organisme.\nSignature électronique simple du bénévole par code email.`;
              const pdf = await contractPdf(content);
              await prisma.volunteerContract.create({ data: {
                workspaceId: event.workspaceId, eventId, personId: app.personId, applicationId: app.id,
                title: "Convention de bénévolat", eventName: event.name, signerName: person.fullName, signerEmail: email,
                content, sourcePdf: new Uint8Array(pdf), documentHash: createHash("sha256").update(pdf).digest("hex"), createdBy: "system",
                tokenHash: createHash("sha256").update(randomBytes(32)).digest("hex"), expiresAt: new Date(Date.now() + 30 * 86400000),
              } });
            }
          } catch (err) {
            console.error("Failed to auto-generate volunteer contract:", err);
          }
        });
      }
      return updated;
  }

  private async checkCapacity(tx: Prisma.TransactionClient, service: { id: string; capacity: number | null }, applicationId: string) {
    if (service.capacity === null) return;
    const count = await tx.cateringBooking.count({ where: { serviceId: service.id, applicationId: { not: applicationId }, application: { status: "APPROVED" } } });
    if (count >= service.capacity) throw new ConflictError("La capacité de ce repas est atteinte");
  }

  saveShift(eventId: string, id: string | undefined, data: ShiftInput) {
    return transaction(async (tx) => {
      const current = id ? await tx.shift.findFirst({ where: { id, eventId } }) : null;
      if (id && !current) throw new NotFoundError("Créneau introuvable");
      if (data.assigneeId) {
        const app = await tx.volunteerApplication.findFirst({ where: { eventId, personId: data.assigneeId, status: "APPROVED", person: { archivedAt: null } } });
        if (!app) throw new ValidationError("Seul un bénévole validé peut être affecté");
        const intervals = intervalSchema.array().parse(app.availability);
        if (!intervals.some((v) => v.startsAt <= data.startsAt && v.endsAt >= data.endsAt)) throw new ConflictError("Créneau hors des disponibilités du bénévole");
        if (await tx.shift.findFirst({ where: { id: id ? { not: id } : undefined, assigneeId: data.assigneeId, startsAt: { lt: new Date(data.endsAt) }, endsAt: { gt: new Date(data.startsAt) } } })) throw new ConflictError("Ce bénévole est déjà affecté sur ces horaires");
      }
      const changed = current && (current.assigneeId !== data.assigneeId || current.startsAt.toISOString() !== data.startsAt || current.endsAt.toISOString() !== data.endsAt || current.position !== data.position || (current.team ?? "") !== data.team);
      if (changed || (current && data.swapAllowed === false)) await tx.volunteerSwap.updateMany({ where: { status: "PENDING", OR: [{ sourceShiftId: id }, { targetShiftId: id }] }, data: { status: "DECLINED" } });
      if (id) {
        const updated = await tx.shift.update({ where: { id }, data: { ...data, reminderSentAt: null, ...(changed ? { confirmationStatus: "PENDING", confirmationVersion: { increment: 1 } } : {}) } });
        if (updated.assigneeId && changed) await this.queueShiftEmail(tx, eventId, updated.assigneeId, updated.id, updated.confirmationVersion);
        return updated;
      }
      const created = await tx.shift.create({ data: { ...data, eventId } });
      if (created.assigneeId) await this.queueShiftEmail(tx, eventId, created.assigneeId, created.id, created.confirmationVersion);
      return created;
    });
  }
  createShifts(eventId: string, data: ShiftInput, count: number) {
    return transaction(async (tx) => {
      if (data.assigneeId) throw new ValidationError("Créez les postes à pourvoir avant de les affecter");
      return tx.shift.createMany({ data: Array.from({ length: count }, () => ({ ...data, eventId })) });
    });
  }

  private async checkAssignment(tx: Prisma.TransactionClient, eventId: string, shift: { startsAt: Date; endsAt: Date }, personId: string, excluded: string[] = []) {
    const application = await tx.volunteerApplication.findFirst({ where: { eventId, personId, status: "APPROVED", person: { archivedAt: null } } });
    if (!application) throw new ConflictError("Le bénévole doit être validé");
    if (!intervalSchema.array().parse(application.availability).some((v) => new Date(v.startsAt) <= shift.startsAt && new Date(v.endsAt) >= shift.endsAt)) throw new ConflictError("Créneau hors des disponibilités du bénévole");
    if (await tx.shift.findFirst({ where: { id: { notIn: excluded }, assigneeId: personId, startsAt: { lt: shift.endsAt }, endsAt: { gt: shift.startsAt } } })) throw new ConflictError("Ce bénévole est déjà affecté sur ces horaires");
  }

  async previewAssignments(eventId: string) {
    const applications = await prisma.volunteerApplication.findMany({ where: { eventId, status: "APPROVED", person: { archivedAt: null } } });
    const shifts = await prisma.shift.findMany({ where: { eventId, assigneeId: null }, orderBy: { startsAt: "asc" } });
    if (shifts.length > 200) throw new ValidationError("L’IA prend en charge 200 créneaux à pourvoir maximum par proposition");
    if (!shifts.length) return { assignments: [], unfilled: 0 };
    const occupied = await prisma.shift.findMany({ where: { assigneeId: { in: applications.map((a) => a.personId) } } });
    const candidates = shifts.map((s) => ({ shiftId: s.id, position: s.position, team: s.team, startsAt: s.startsAt, endsAt: s.endsAt,
      candidates: applications.filter((a) => intervalSchema.array().parse(a.availability).some((v) => new Date(v.startsAt) <= s.startsAt && new Date(v.endsAt) >= s.endsAt)
        && !occupied.some((o) => o.assigneeId === a.personId && o.startsAt < s.endsAt && o.endsAt > s.startsAt))
        .map((a) => ({ personId: a.personId, preferred: !!s.team && (a.team === s.team || a.preferredTeams.includes(s.team)), hours: occupied.filter((o) => o.assigneeId === a.personId).reduce((n, o) => n + (o.endsAt.getTime() - o.startsAt.getTime()) / 3600000, 0) })) }));
    if (candidates.every((s) => !s.candidates.length)) return { assignments: [], unfilled: shifts.length };
    const suggestions = await suggestVolunteerAssignments(candidates);
    const assignments: typeof suggestions = [];
    for (const proposal of suggestions) {
      const slot = candidates.find((s) => s.shiftId === proposal.shiftId);
      if (!slot?.candidates.some((a) => a.personId === proposal.personId)) continue;
      if (assignments.some((a) => { const other = candidates.find((s) => s.shiftId === a.shiftId)!; return a.personId === proposal.personId && other.startsAt < slot.endsAt && other.endsAt > slot.startsAt; })) continue;
      assignments.push(proposal);
    }
    return { assignments, unfilled: shifts.length - assignments.length };
  }

  applyAssignments(eventId: string, assignments: { shiftId: string; personId: string }[]) {
    return transaction(async (tx) => {
      for (const assignment of assignments) {
        const shift = await tx.shift.findFirst({ where: { id: assignment.shiftId, eventId, assigneeId: null } });
        if (!shift) throw new ConflictError("Le planning a changé. Générez une nouvelle proposition.");
        await this.checkAssignment(tx, eventId, shift, assignment.personId);
        const updated = await tx.shift.update({ where: { id: shift.id }, data: { assigneeId: assignment.personId, reminderSentAt: null, confirmationStatus: "PENDING", confirmationVersion: { increment: 1 } } });
        await this.queueShiftEmail(tx, eventId, assignment.personId, updated.id, updated.confirmationVersion);
      }
      return { count: assignments.length };
    });
  }

  issueBadge(eventId: string, id: string, rotate = false) {
    return transaction(async (tx) => {
      const application = await tx.volunteerApplication.findFirst({ where: { id, eventId, status: "APPROVED", person: { archivedAt: null } } });
      if (!application) throw new NotFoundError("Bénévole validé introuvable");
      return tx.volunteerApplication.update({ where: { id }, data: {
        accessToken: !rotate && application.accessToken || randomBytes(32).toString("base64url"),
        badgeToken: !rotate && application.badgeToken || randomBytes(32).toString("base64url"),
      }, select: { accessToken: true, badgeToken: true } });
    });
  }

  checkIn(eventId: string, badgeToken: string, present: boolean) {
    return transaction(async (tx) => {
      const application = await tx.volunteerApplication.findFirst({ where: { eventId, badgeToken, status: "APPROVED", person: { archivedAt: null } }, include: { person: true } });
      if (!application) throw new NotFoundError("Badge invalide pour cet événement");
      const updated = await tx.volunteerApplication.update({ where: { id: application.id }, data: { checkedInAt: present ? application.checkedInAt ?? new Date() : null } });
      return { fullName: application.person.fullName, checkedInAt: updated.checkedInAt };
    });
  }

  private async portalApplication(token: string, tx: Prisma.TransactionClient = prisma) {
    const application = await tx.volunteerApplication.findFirst({ where: { accessToken: token, status: "APPROVED", person: { archivedAt: null }, event: { status: { notIn: ["DONE", "ARCHIVED"] } } }, include: { person: true, event: true } });
    if (!application) throw new NotFoundError("Ce lien personnel est indisponible");
    return application;
  }

  async portal(token: string) {
    const application = await this.portalApplication(token);
    const shifts = await prisma.shift.findMany({ where: { eventId: application.eventId, assigneeId: application.personId }, orderBy: { startsAt: "asc" } });
    const alternatives = await prisma.shift.findMany({ where: { eventId: application.eventId, swapAllowed: true, assigneeId: { not: application.personId }, startsAt: { gt: new Date() }, assignee: { volunteerApplications: { some: { eventId: application.eventId, status: "APPROVED" } } } }, select: { id: true, position: true, team: true, startsAt: true, endsAt: true } });
    const swaps = await prisma.volunteerSwap.findMany({ where: { application: { eventId: application.eventId }, OR: [{ applicationId: application.id }, { targetPersonId: application.personId }] }, orderBy: { createdAt: "desc" }, take: 100 });
    const related = await prisma.shift.findMany({ where: { eventId: application.eventId, id: { in: swaps.flatMap((s) => [s.sourceShiftId, s.targetShiftId]) } }, select: { id: true, position: true, startsAt: true, endsAt: true } });
    const contract = await prisma.volunteerContract.findFirst({ where: { applicationId: application.id }, orderBy: { createdAt: "desc" } });
    
    // Compute link to signature page if a tokenHash exists. But tokenHash is hashed. Oh wait, the link needs `token`. We can't reverse `tokenHash`.
    // Wait, VolunteerContract schema has a tokenHash. How does the frontend get the token?
    // In `volunteer-contract.repository.ts`, `invite` creates a new token and sends it.
    // If we want the volunteer to access the contract from the portal directly, we can't use the email token because we don't have it.
    // Actually, if they are authenticated in the portal via `application.accessToken`, we can just let them view/sign it through a new API, OR we can generate a temporary contract access token on the fly, OR we just generate a signature token.
    return { fullName: application.person.fullName, team: application.team, badgeToken: application.badgeToken, checkedInAt: application.checkedInAt, eventName: application.event.name,
      planningResponse: application.planningResponse, planningRespondedAt: application.planningRespondedAt,
      shifts: shifts.map(({ id, position, team, startsAt, endsAt, notes, confirmationStatus, confirmationVersion, swapAllowed }) => ({ id, position, team, startsAt, endsAt, notes, confirmationStatus, confirmationVersion, swapAllowed })), alternatives,
      swaps: swaps.map((s) => ({ id: s.id, status: s.status, incoming: s.targetPersonId === application.personId, source: related.find((v) => v.id === s.sourceShiftId), target: related.find((v) => v.id === s.targetShiftId) })),
      contract: contract ? { id: contract.id, status: contract.status, signedAt: contract.signedAt } : null,
    };
  }

  async getContractToken(token: string) {
    return transaction(async (tx) => {
      const application = await this.portalApplication(token, tx);
      const contract = await tx.volunteerContract.findFirst({ where: { applicationId: application.id }, orderBy: { createdAt: "desc" } });
      if (!contract) throw new NotFoundError("Aucune convention n'est associée à cette candidature.");
      const contractToken = randomBytes(32).toString("base64url");
      const tokenHash = createHash("sha256").update(contractToken).digest("hex");
      await tx.volunteerContract.update({ where: { id: contract.id }, data: { tokenHash, expiresAt: new Date(Date.now() + 30 * 86400000) } });
      return { token: contractToken };
    });
  }

  notifyPlanning(eventId: string) {
    return transaction(async (tx) => {
      const applications = await tx.volunteerApplication.findMany({ where: { eventId, status: "APPROVED", person: { archivedAt: null } }, include: { person: true } });
      let count = 0;
      let missingEmail = 0;
      for (const app of applications) {
        const shifts = await tx.shift.findMany({ where: { eventId, assigneeId: app.personId, startsAt: { gt: new Date() }, confirmationStatus: "PENDING" }, orderBy: { id: "asc" } });
        if (!shifts.length) continue;
        if (!app.email && !app.person.email) { missingEmail++; continue; }
        if (!app.accessToken) await tx.volunteerApplication.update({ where: { id: app.id }, data: { accessToken: randomBytes(32).toString("base64url"), badgeToken: app.badgeToken || randomBytes(32).toString("base64url") } });
        const version = createHash("sha256").update(JSON.stringify(shifts.map((s) => [s.id, s.confirmationVersion]))).digest("hex");
        const queued = await tx.volunteerEmail.createMany({ data: [{ applicationId: app.id, kind: "PLANNING", dedupeKey: `planning:${app.id}:${version}` }], skipDuplicates: true });
        count += queued.count;
      }
      return { count, missingEmail };
    });
  }

  respondPlanning(token: string, accept: boolean, versions: { id: string; version: number }[]) {
    return transaction(async (tx) => {
      const app = await this.portalApplication(token, tx);
      const shifts = await tx.shift.findMany({ where: { eventId: app.eventId, assigneeId: app.personId, startsAt: { gt: new Date() } } });
      const submitted = new Map(versions.map((v) => [v.id, v.version]));
      if (!shifts.length || submitted.size !== versions.length || shifts.length !== versions.length || shifts.some((s) => submitted.get(s.id) !== s.confirmationVersion)) {
        throw new ConflictError("Le planning a changé. Actualisez puis répondez à l’ensemble de vos horaires à venir.");
      }
      if (!accept && shifts.some((shift) => shift.confirmationStatus === "ACCEPTED")) throw new ConflictError("Vous avez déjà accepté votre planning. Contactez l’organisation si vous devez modifier vos disponibilités.");
      if (accept) for (const shift of shifts) await this.checkAssignment(tx, app.eventId, shift, app.personId, [shift.id]);
      const ids = shifts.map((s) => s.id);
      if (!accept) await tx.volunteerSwap.updateMany({ where: { status: "PENDING", OR: [{ sourceShiftId: { in: ids } }, { targetShiftId: { in: ids } }] }, data: { status: "DECLINED" } });
      await tx.shift.updateMany({ where: { id: { in: ids } }, data: { confirmationStatus: accept ? "ACCEPTED" : "DECLINED",
        ...(!accept ? { assigneeId: null, reminderSentAt: null, confirmationVersion: { increment: 1 } } : {}),
      } });
      await tx.volunteerApplication.update({ where: { id: app.id }, data: { planningResponse: accept ? "ACCEPTED" : "DECLINED", planningRespondedAt: new Date() } });
      return { ok: true };
    });
  }

  requestSwap(token: string, sourceShiftId: string, targetShiftId: string) {
    return transaction(async (tx) => {
      const application = await this.portalApplication(token, tx);
      const source = await tx.shift.findFirst({ where: { id: sourceShiftId, eventId: application.eventId, assigneeId: application.personId, startsAt: { gt: new Date() } } });
      const target = await tx.shift.findFirst({ where: { id: targetShiftId, eventId: application.eventId, startsAt: { gt: new Date() } } });
      if (!source || !target?.assigneeId || target.assigneeId === application.personId) throw new ConflictError("Choisissez deux créneaux futurs affectés à des bénévoles différents");
      if (!source.swapAllowed || !target.swapAllowed) throw new ConflictError("L’organisation a interdit les échanges pour l’un de ces créneaux");
      await this.checkAssignment(tx, application.eventId, target, application.personId, [source.id]);
      await this.checkAssignment(tx, application.eventId, source, target.assigneeId, [target.id]);
      if (await tx.volunteerSwap.findFirst({ where: { status: "PENDING", OR: [{ sourceShiftId: { in: [source.id, target.id] } }, { targetShiftId: { in: [source.id, target.id] } }] } })) throw new ConflictError("Une demande est déjà en attente pour l’un de ces créneaux");
      const targetApplication = await tx.volunteerApplication.findFirstOrThrow({ where: { eventId: application.eventId, personId: target.assigneeId, status: "APPROVED" } });
      const targetAccessToken = targetApplication.accessToken || randomBytes(32).toString("base64url");
      if (!targetApplication.accessToken) await tx.volunteerApplication.update({ where: { id: targetApplication.id }, data: { accessToken: targetAccessToken, badgeToken: targetApplication.badgeToken || randomBytes(32).toString("base64url") } });
      const swap = await tx.volunteerSwap.create({ data: { applicationId: application.id, sourceShiftId, targetShiftId, targetPersonId: target.assigneeId } });
      await tx.volunteerEmail.create({ data: { applicationId: targetApplication.id, kind: "SWAP_REQUEST", dedupeKey: `swap:${swap.id}` } });
      return swap;
    });
  }

  respondSwap(token: string, id: string, accept: boolean) {
    return transaction(async (tx) => {
      const application = await this.portalApplication(token, tx);
      const swap = await tx.volunteerSwap.findFirst({ where: { id, status: "PENDING", application: { eventId: application.eventId } }, include: { application: true } });
      if (!swap || (swap.targetPersonId !== application.personId && (accept || swap.applicationId !== application.id))) throw new NotFoundError("Demande introuvable");
      if (accept) {
        const source = await tx.shift.findFirst({ where: { id: swap.sourceShiftId, eventId: application.eventId, assigneeId: swap.application.personId, startsAt: { gt: new Date() } } });
        const target = await tx.shift.findFirst({ where: { id: swap.targetShiftId, eventId: application.eventId, assigneeId: application.personId, startsAt: { gt: new Date() } } });
        if (!source || !target) throw new ConflictError("Le planning a changé. Refusez cette demande puis créez-en une nouvelle.");
        if (!source.swapAllowed || !target.swapAllowed) throw new ConflictError("L’organisation a interdit les échanges pour l’un de ces créneaux");
        await this.checkAssignment(tx, application.eventId, target, swap.application.personId, [source.id]);
        await this.checkAssignment(tx, application.eventId, source, application.personId, [target.id]);
        const sourceUpdated = await tx.shift.update({ where: { id: source.id }, data: { assigneeId: application.personId, reminderSentAt: null, confirmationStatus: "PENDING", confirmationVersion: { increment: 1 } } });
        const targetUpdated = await tx.shift.update({ where: { id: target.id }, data: { assigneeId: swap.application.personId, reminderSentAt: null, confirmationStatus: "PENDING", confirmationVersion: { increment: 1 } } });
        await this.queueShiftEmail(tx, application.eventId, application.personId, sourceUpdated.id, sourceUpdated.confirmationVersion);
        await this.queueShiftEmail(tx, application.eventId, swap.application.personId, targetUpdated.id, targetUpdated.confirmationVersion);
      }
      return tx.volunteerSwap.update({ where: { id }, data: { status: accept ? "ACCEPTED" : "DECLINED" } });
    });
  }
  async deleteShift(eventId: string, id: string) {
    if (!(await prisma.shift.deleteMany({ where: { id, eventId } })).count) throw new NotFoundError("Créneau introuvable");
    return { ok: true };
  }
  saveService(eventId: string, id: string | undefined, data: CateringInput) {
    return transaction(async (tx) => {
      if (id) {
        if (!await tx.cateringService.findFirst({ where: { id, eventId } })) throw new NotFoundError("Repas introuvable");
        const count = await tx.cateringBooking.count({ where: { serviceId: id, application: { status: "APPROVED" } } });
        if (data.capacity !== null && data.capacity < count) throw new ConflictError("La capacité est inférieure au nombre de repas confirmés");
        return tx.cateringService.update({ where: { id }, data });
      }
      return tx.cateringService.create({ data: { ...data, eventId } });
    });
  }
  deleteService(eventId: string, id: string) {
    return transaction(async (tx) => {
      if (await tx.cateringBooking.count({ where: { serviceId: id, service: { eventId } } })) throw new ConflictError("Retirez les inscriptions à ce repas avant de le supprimer");
      if (!(await tx.cateringService.deleteMany({ where: { id, eventId } })).count) throw new NotFoundError("Repas introuvable");
      return { ok: true };
    });
  }
  bookMeal(eventId: string, serviceId: string, applicationId: string, booked: boolean) {
    return transaction(async (tx) => {
      const service = await tx.cateringService.findFirst({ where: { id: serviceId, eventId } });
      const app = await tx.volunteerApplication.findFirst({ where: { id: applicationId, eventId } });
      if (!service || !app) throw new NotFoundError("Repas ou candidature introuvable");
      if (booked) {
        if (app.status === "APPROVED") await this.checkCapacity(tx, service, applicationId);
        return tx.cateringBooking.upsert({ where: { serviceId_applicationId: { serviceId, applicationId } }, create: { serviceId, applicationId }, update: {} });
      }
      if (await tx.cateringBooking.findFirst({ where: { serviceId, applicationId, servedAt: { not: null } } })) throw new ConflictError("Annulez le pointage avant de retirer ce repas");
      await tx.cateringBooking.deleteMany({ where: { serviceId, applicationId } });
      return { ok: true };
    });
  }
  serveMeal(eventId: string, id: string, served: boolean) {
    return transaction(async (tx) => {
      const booking = await tx.cateringBooking.findFirst({ where: { id, service: { eventId }, application: { eventId, status: "APPROVED" } } });
      if (!booking) throw new NotFoundError("Réservation confirmée introuvable");
      return tx.cateringBooking.update({ where: { id }, data: { servedAt: served ? booking.servedAt ?? new Date() : null } });
    });
  }
}
