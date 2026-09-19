import { randomBytes } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { setTimeout as delay } from "node:timers/promises";
import type { FastifyRequest } from "fastify";
import { prisma } from "../prisma.js";
import { requireCan } from "../lib/permissions.js";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "../lib/errors.js";
import { questionSchema, intervalSchema, type ApplicationInput, type FormInput, type ReviewInput, type ShiftInput, type CateringInput } from "../schemas/volunteer.js";

// Serializable transactions prevent concurrent approvals or assignments from
// exceeding meal capacities, duplicating contacts, or double-booking a person.
async function transaction<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try { return await prisma.$transaction(fn, { isolationLevel: "Serializable" }); }
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

export class VolunteerRepository {
  async authorize(request: FastifyRequest, eventId: string) {
    const event = await prisma.event.findFirst({ where: { id: eventId, workspaceId: request.workspaceId } });
    if (!event) throw new NotFoundError("Événement introuvable");
    if (request.eventScoped) {
      const collaborator = await prisma.eventCollaborator.findFirst({ where: {
        eventId, workspaceId: request.workspaceId, acceptedAt: { not: null },
        OR: [{ userId: request.user!.id }, { email: request.user!.email }],
      } });
      if (!collaborator || !["ADMIN", "ORGANIZER"].includes(collaborator.role)) throw new ForbiddenError("Accès refusé");
    } else requireCan(request.userRole, "event.write");
    return event;
  }

  async overview(eventId: string) {
    const [form, applications, shifts, services] = await Promise.all([
      prisma.volunteerForm.findUnique({ where: { eventId } }),
      prisma.volunteerApplication.findMany({ where: { eventId }, orderBy: { createdAt: "desc" }, include: { meals: true } }),
      prisma.shift.findMany({ where: { eventId }, orderBy: { startsAt: "asc" }, include: { assignee: { select: { id: true, fullName: true } } } }),
      prisma.cateringService.findMany({ where: { eventId }, orderBy: { startsAt: "asc" }, include: { bookings: true } }),
    ]);
    return { form, applications, shifts, services };
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
      event: { select: { id: true, name: true, startsAt: true, endsAt: true, workspaceId: true, status: true } },
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
      collectDietary: form.collectDietary, teams: form.teams, questions: form.questions,
      closesAt: form.closesAt, event: { name: form.event.name, startsAt: form.event.startsAt, endsAt: form.event.endsAt }, services };
  }

  async submit(token: string, data: ApplicationInput) {
    return transaction(async (tx) => {
      const form = await this.openForm(token, tx);
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
      await tx.volunteerApplication.create({ data: {
        eventId: form.eventId, personId: person.id, email: data.email, fullName: data.fullName,
        phone: form.collectPhone ? data.phone : "", dietary: form.collectDietary ? data.dietary : "",
        preferredTeams: [...new Set(data.preferredTeams)], availability: data.availability, answers, notes: data.notes,
        meals: { create: mealIds.map((serviceId) => ({ serviceId })) },
      } });
      return { message: form.confirmationMessage };
    });
  }

  async review(eventId: string, id: string, data: ReviewInput) {
    return transaction(async (tx) => {
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
        await tx.shift.updateMany({ where: { eventId, assigneeId: app.personId }, data: { assigneeId: null, reminderSentAt: null } });
        const participant = await tx.eventParticipant.findUnique({ where: { eventId_personId: { eventId, personId: app.personId } } });
        if (participant) {
          const roles = participant.roles.filter((r) => r !== "VOLUNTEER");
          if (roles.length) await tx.eventParticipant.update({ where: { id: participant.id }, data: { roles } });
          else await tx.eventParticipant.delete({ where: { id: participant.id } });
        }
      }
      return tx.volunteerApplication.update({ where: { id }, data: { ...data, reviewedAt: data.status === "PENDING" ? null : new Date() } });
    });
  }

  private async checkCapacity(tx: Prisma.TransactionClient, service: { id: string; capacity: number | null }, applicationId: string) {
    if (service.capacity === null) return;
    const count = await tx.cateringBooking.count({ where: { serviceId: service.id, applicationId: { not: applicationId }, application: { status: "APPROVED" } } });
    if (count >= service.capacity) throw new ConflictError("La capacité de ce repas est atteinte");
  }

  saveShift(eventId: string, id: string | undefined, data: ShiftInput) {
    return transaction(async (tx) => {
      if (id && !await tx.shift.findFirst({ where: { id, eventId } })) throw new NotFoundError("Créneau introuvable");
      if (data.assigneeId) {
        const app = await tx.volunteerApplication.findFirst({ where: { eventId, personId: data.assigneeId, status: "APPROVED", person: { archivedAt: null } } });
        if (!app) throw new ValidationError("Seul un bénévole validé peut être affecté");
        const intervals = intervalSchema.array().parse(app.availability);
        if (!intervals.some((v) => v.startsAt <= data.startsAt && v.endsAt >= data.endsAt)) throw new ConflictError("Créneau hors des disponibilités du bénévole");
        if (await tx.shift.findFirst({ where: { id: id ? { not: id } : undefined, assigneeId: data.assigneeId, startsAt: { lt: new Date(data.endsAt) }, endsAt: { gt: new Date(data.startsAt) } } })) throw new ConflictError("Ce bénévole est déjà affecté sur ces horaires");
      }
      return id ? tx.shift.update({ where: { id }, data: { ...data, reminderSentAt: null } }) : tx.shift.create({ data: { ...data, eventId } });
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
