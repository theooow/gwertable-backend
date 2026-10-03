import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { VolunteerRepository } from "../../repositories/volunteer.repository.js";
import { applicationSchema, cateringSchema, reviewSchema, shiftSchema, volunteerFormSchema } from "../../schemas/volunteer.js";
import { assignmentsSchema } from "../../services/volunteer-planning.service.js";
import { recordActivity, recordRequestActivity, type RequestActivityInput } from "../../lib/activity-recorder.js";

const repository = new VolunteerRepository();
const params = z.object({ eventId: z.string().min(1), id: z.string().min(1).optional() });
const tokenParams = z.object({ token: z.string().regex(/^[A-Za-z0-9_-]{43}$/) });
const reviewLabels = { PENDING: "remise en attente", APPROVED: "validée", REJECTED: "refusée", CANCELLED: "annulée" } as const;

async function recordPortalActivity(req: FastifyRequest, token: string, activity: (fullName: string) => Pick<RequestActivityInput, "type" | "title">) {
  const context = await repository.portalActivityContext(token);
  if (!context) return;
  await recordActivity({
    ...activity(context.fullName),
    workspaceId: context.workspaceId, eventId: context.eventId, entityType: "VOLUNTEER", entityId: context.id,
  }, req.log);
}

export async function volunteerRoutes(app: FastifyInstance) {
  const submissions = new Map<string, { count: number; until: number }>();
  const timer = setInterval(() => { for (const [key, value] of submissions) if (value.until <= Date.now()) submissions.delete(key); }, 60000);
  timer.unref();
  app.addHook("onClose", async () => clearInterval(timer));
  app.get("/api/public/volunteers/portal/:token", { config: { documentation: { params: tokenParams } } }, async (req, reply) => {
    reply.header("Cache-Control", "no-store");
    return repository.portal(tokenParams.parse(req.params).token);
  });
  app.post("/api/public/volunteers/portal/:token/contract", { config: { documentation: { params: tokenParams, statusCodes: [200] } } }, async (req, reply) => {
    reply.header("Cache-Control", "no-store");
    return repository.getContractToken(tokenParams.parse(req.params).token);
  });
  app.patch("/api/public/volunteers/portal/:token/planning", { config: { documentation: { params: tokenParams, body: z.object({ accept: z.boolean(), shifts: z.array(z.object({ id: z.string().min(1), version: z.number().int().nonnegative() })).min(1).max(1000) }) } } }, async (req, reply) => {
    reply.header("Cache-Control", "no-store");
    const { token } = tokenParams.parse(req.params);
    const { accept, shifts } = z.object({ accept: z.boolean(), shifts: z.array(z.object({ id: z.string().min(1), version: z.number().int().nonnegative() })).min(1).max(1000) }).parse(req.body);
    const result = await repository.respondPlanning(token, accept, shifts);
    await recordPortalActivity(req, token, (fullName) => ({
      type: "VOLUNTEER_PLANNING_ANSWERED",
      title: `${fullName} a ${accept ? "accepté" : "refusé"} son planning`,
    }));
    return result;
  });
  app.post("/api/public/volunteers/portal/:token/swaps", { config: { documentation: { body: z.object({ sourceShiftId: z.string().min(1), targetShiftId: z.string().min(1) }), params: tokenParams } } }, async (req, reply) => {
    reply.header("Cache-Control", "no-store");
    const body = z.object({ sourceShiftId: z.string().min(1), targetShiftId: z.string().min(1) }).parse(req.body);
    const { token } = tokenParams.parse(req.params);
    const swap = await repository.requestSwap(token, body.sourceShiftId, body.targetShiftId);
    await recordPortalActivity(req, token, (fullName) => ({ type: "VOLUNTEER_SWAP_REQUESTED", title: `${fullName} demande un échange de créneau` }));
    return swap;
  });
  app.patch("/api/public/volunteers/portal/:token/swaps/:id", { config: { documentation: { params: tokenParams.extend({ id: z.string().min(1) }), body: z.object({ accept: z.boolean() }) } } }, async (req, reply) => {
    reply.header("Cache-Control", "no-store");
    const { token, id } = tokenParams.extend({ id: z.string().min(1) }).parse(req.params);
    return repository.respondSwap(token, id, z.object({ accept: z.boolean() }).parse(req.body).accept);
  });
  app.get("/api/public/volunteers/:token", { config: { documentation: { params: tokenParams } } }, async (req, reply) => {
    reply.header("Cache-Control", "no-store");
    return repository.publicForm(tokenParams.parse(req.params).token);
  });
  app.post("/api/public/volunteers/:token", { config: { documentation: { params: tokenParams, body: applicationSchema, statusCodes: [429,201] } }, bodyLimit: 64 * 1024 }, async (req, reply) => {
    const token = tokenParams.parse(req.params).token;
    const key = `${token}:${req.ip}`;
    const now = Date.now();
    const bucket = submissions.get(key);
    if (bucket && bucket.until > now && bucket.count >= 60) return reply.code(429).header("Retry-After", "60").send({ message: "Trop de demandes. Réessayez dans une minute." });
    if (submissions.size >= 10000 && !bucket) return reply.code(429).header("Retry-After", "60").send({ message: "Réessayez dans une minute." });
    submissions.set(key, { count: bucket && bucket.until > now ? bucket.count + 1 : 1, until: bucket && bucket.until > now ? bucket.until : now + 60000 });
    const { message, application } = await repository.submit(token, applicationSchema.parse(req.body));
    if (application) {
      await recordActivity({
        workspaceId: application.workspaceId, eventId: application.eventId,
        type: "VOLUNTEER_APPLIED", title: `Nouvelle candidature bénévole : ${application.fullName}`,
        entityType: "VOLUNTEER", entityId: application.id,
      }, req.log);
    }
    return reply.code(201).send({ message });
  });
  app.register(async (protectedRoutes) => {
    protectedRoutes.addHook("preHandler", async (req) => { await repository.authorize(req, params.parse(req.params).eventId); });
    protectedRoutes.get("/api/events/:eventId/volunteers", { config: { documentation: { params: params } } }, async (req) => repository.overview(params.parse(req.params).eventId));
    protectedRoutes.post("/api/events/:eventId/volunteers/shifts/batch", { config: { documentation: { body: z.object({ shift: shiftSchema, count: z.number().int().min(1).max(100) }), params: params, statusCodes: [201] } } }, async (req, reply) => {
      const { shift, count } = z.object({ shift: shiftSchema, count: z.number().int().min(1).max(100) }).parse(req.body);
      const { eventId } = params.parse(req.params);
      const result = await repository.createShifts(eventId, shift, count);
      await recordRequestActivity(req, {
        eventId, type: "VOLUNTEER_SHIFT_CREATED", title: `${count} créneau(x) créé(s) : ${shift.position}`,
        entityType: "VOLUNTEER_SHIFT", notify: false,
      });
      return reply.code(201).send(result);
    });
    protectedRoutes.post("/api/events/:eventId/volunteers/assignments/preview", { config: { documentation: { params: params } } }, async (req) => repository.previewAssignments(params.parse(req.params).eventId));
    protectedRoutes.post("/api/events/:eventId/volunteers/assignments/notify", { config: { documentation: { params: params } } }, async (req) => {
      const { eventId } = params.parse(req.params);
      const result = await repository.notifyPlanning(eventId);
      await recordRequestActivity(req, {
        eventId, type: "VOLUNTEER_PLANNING_SENT", title: `Planning envoyé à ${result.count} bénévole(s)`, entityType: "VOLUNTEER_SHIFT",
      });
      return result;
    });
    protectedRoutes.post("/api/events/:eventId/volunteers/assignments/apply", { config: { documentation: { params: params, body: assignmentsSchema } } }, async (req) => {
      const { eventId } = params.parse(req.params);
      const result = await repository.applyAssignments(eventId, assignmentsSchema.parse(req.body));
      await recordRequestActivity(req, {
        eventId, type: "VOLUNTEER_ASSIGNMENTS_APPLIED", title: `${result.count} affectation(s) appliquée(s) au planning`, entityType: "VOLUNTEER_SHIFT",
      });
      return result;
    });
    protectedRoutes.post("/api/events/:eventId/volunteers/applications/:id/badge", { config: { documentation: { params: params, body: z.object({ rotate: z.boolean().default(false) }) } } }, async (req) => {
      const { eventId, id } = params.parse(req.params);
      return repository.issueBadge(eventId, id!, z.object({ rotate: z.boolean().default(false) }).parse(req.body ?? {}).rotate);
    });
    protectedRoutes.post("/api/events/:eventId/volunteers/check-in", { config: { documentation: { body: z.object({ badgeToken: z.string().regex(/^[A-Za-z0-9_-]{43}$/), present: z.boolean().default(true) }), params: params } } }, async (req) => {
      const body = z.object({ badgeToken: z.string().regex(/^[A-Za-z0-9_-]{43}$/), present: z.boolean().default(true) }).parse(req.body);
      const { eventId } = params.parse(req.params);
      const result = await repository.checkIn(eventId, body.badgeToken, body.present);
      await recordRequestActivity(req, {
        eventId, type: "VOLUNTEER_CHECKED_IN",
        title: body.present ? `Arrivée enregistrée : ${result.fullName}` : `Arrivée annulée : ${result.fullName}`,
        entityType: "VOLUNTEER", notify: false,
      });
      return result;
    });
    protectedRoutes.put("/api/events/:eventId/volunteers/form", { config: { documentation: { params: params, body: volunteerFormSchema } } }, async (req) => {
      const { eventId } = params.parse(req.params);
      const form = await repository.saveForm(eventId, volunteerFormSchema.parse(req.body));
      await recordRequestActivity(req, {
        eventId, type: "VOLUNTEER_FORM_UPDATED", title: "Formulaire de candidature bénévole modifié", entityType: "VOLUNTEER_FORM", notify: false,
      });
      return form;
    });
    protectedRoutes.post("/api/events/:eventId/volunteers/form/rotate", { config: { documentation: { params: params } } }, async (req) => {
      const { eventId } = params.parse(req.params);
      const form = await repository.rotateToken(eventId);
      await recordRequestActivity(req, {
        eventId, type: "VOLUNTEER_FORM_UPDATED", title: "Lien public de candidature renouvelé", entityType: "VOLUNTEER_FORM", notify: false,
      });
      return form;
    });
    protectedRoutes.patch("/api/events/:eventId/volunteers/applications/:id", { config: { documentation: { params: params, body: reviewSchema } } }, async (req) => {
      const { eventId, id } = params.parse(req.params);
      const application = await repository.review(eventId, id!, reviewSchema.parse(req.body));
      await recordRequestActivity(req, {
        eventId, type: "VOLUNTEER_APPLICATION_REVIEWED",
        title: `Candidature ${reviewLabels[application.status]} : ${application.fullName}`,
        entityType: "VOLUNTEER", entityId: application.id,
      });
      return application;
    });
    for (const resource of ["shifts", "services"] as const) {
      protectedRoutes.post(`/api/events/:eventId/volunteers/${resource}`, { config: { documentation: { params: params, body: resource === "shifts" ? shiftSchema : cateringSchema, statusCodes: [201] } } }, async (req, reply) => {
        const { eventId } = params.parse(req.params);
        if (resource === "shifts") {
          const shift = await repository.saveShift(eventId, undefined, shiftSchema.parse(req.body));
          await recordRequestActivity(req, {
            eventId, type: "VOLUNTEER_SHIFT_CREATED", title: `Créneau bénévole créé : ${shift.position}`,
            entityType: "VOLUNTEER_SHIFT", entityId: shift.id, notify: false,
          });
          return reply.code(201).send(shift);
        }
        const meal = await repository.saveService(eventId, undefined, cateringSchema.parse(req.body));
        await recordRequestActivity(req, {
          eventId, type: "VOLUNTEER_MEAL_CREATED", title: `Repas bénévole créé : ${meal.label}`,
          entityType: "VOLUNTEER_MEAL", entityId: meal.id, notify: false,
        });
        return reply.code(201).send(meal);
      });
      protectedRoutes.put(`/api/events/:eventId/volunteers/${resource}/:id`, { config: { documentation: { params: params, body: resource === "shifts" ? shiftSchema : cateringSchema } } }, async (req) => {
        const { eventId, id } = params.parse(req.params);
        if (resource === "shifts") {
          const shift = await repository.saveShift(eventId, id, shiftSchema.parse(req.body));
          await recordRequestActivity(req, {
            eventId, type: "VOLUNTEER_SHIFT_UPDATED", title: `Créneau bénévole modifié : ${shift.position}`,
            entityType: "VOLUNTEER_SHIFT", entityId: shift.id, notify: false,
          });
          return shift;
        }
        const meal = await repository.saveService(eventId, id, cateringSchema.parse(req.body));
        await recordRequestActivity(req, {
          eventId, type: "VOLUNTEER_MEAL_UPDATED", title: `Repas bénévole modifié : ${meal.label}`,
          entityType: "VOLUNTEER_MEAL", entityId: meal.id, notify: false,
        });
        return meal;
      });
      protectedRoutes.delete(`/api/events/:eventId/volunteers/${resource}/:id`, { config: { documentation: { params: params } } }, async (req) => {
        const { eventId, id } = params.parse(req.params);
        const result = resource === "shifts" ? await repository.deleteShift(eventId, id!) : await repository.deleteService(eventId, id!);
        await recordRequestActivity(req, resource === "shifts"
          ? { eventId, type: "VOLUNTEER_SHIFT_DELETED", title: "Créneau bénévole supprimé", entityType: "VOLUNTEER_SHIFT", notify: false }
          : { eventId, type: "VOLUNTEER_MEAL_DELETED", title: "Repas bénévole supprimé", entityType: "VOLUNTEER_MEAL", notify: false });
        return result;
      });
    }
    protectedRoutes.put("/api/events/:eventId/volunteers/services/:id/bookings", { config: { documentation: { params: params, body: z.object({ applicationId: z.string().min(1), booked: z.boolean() }) } } }, async (req) => {
      const { eventId, id } = params.parse(req.params);
      const body = z.object({ applicationId: z.string().min(1), booked: z.boolean() }).parse(req.body);
      return repository.bookMeal(eventId, id!, body.applicationId, body.booked);
    });
    protectedRoutes.patch("/api/events/:eventId/volunteers/bookings/:id", { config: { documentation: { params: params, body: z.object({ served: z.boolean() }) } } }, async (req) => {
      const { eventId, id } = params.parse(req.params);
      return repository.serveMeal(eventId, id!, z.object({ served: z.boolean() }).parse(req.body).served);
    });
  });
}
