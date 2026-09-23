import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { VolunteerRepository } from "../../repositories/volunteer.repository.js";
import { applicationSchema, cateringSchema, reviewSchema, shiftSchema, volunteerFormSchema } from "../../schemas/volunteer.js";
import { assignmentsSchema } from "../../services/volunteer-planning.service.js";

const repository = new VolunteerRepository();
const params = z.object({ eventId: z.string().min(1), id: z.string().min(1).optional() });
const tokenParams = z.object({ token: z.string().regex(/^[A-Za-z0-9_-]{43}$/) });

export async function volunteerRoutes(app: FastifyInstance) {
  const submissions = new Map<string, { count: number; until: number }>();
  const timer = setInterval(() => { for (const [key, value] of submissions) if (value.until <= Date.now()) submissions.delete(key); }, 60000);
  timer.unref();
  app.addHook("onClose", async () => clearInterval(timer));
  app.get("/api/public/volunteers/portal/:token", { config: { documentation: { params: tokenParams } } }, async (req, reply) => {
    reply.header("Cache-Control", "no-store");
    return repository.portal(tokenParams.parse(req.params).token);
  });
  app.patch("/api/public/volunteers/portal/:token/planning", { config: { documentation: { params: tokenParams, body: z.object({ accept: z.boolean(), shifts: z.array(z.object({ id: z.string().min(1), version: z.number().int().nonnegative() })).min(1).max(1000) }) } } }, async (req, reply) => {
    reply.header("Cache-Control", "no-store");
    const { token } = tokenParams.parse(req.params);
    const { accept, shifts } = z.object({ accept: z.boolean(), shifts: z.array(z.object({ id: z.string().min(1), version: z.number().int().nonnegative() })).min(1).max(1000) }).parse(req.body);
    return repository.respondPlanning(token, accept, shifts);
  });
  app.post("/api/public/volunteers/portal/:token/swaps", { config: { documentation: { body: z.object({ sourceShiftId: z.string().min(1), targetShiftId: z.string().min(1) }), params: tokenParams } } }, async (req, reply) => {
    reply.header("Cache-Control", "no-store");
    const body = z.object({ sourceShiftId: z.string().min(1), targetShiftId: z.string().min(1) }).parse(req.body);
    return repository.requestSwap(tokenParams.parse(req.params).token, body.sourceShiftId, body.targetShiftId);
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
    const result = await repository.submit(token, applicationSchema.parse(req.body));
    return reply.code(201).send(result);
  });
  app.register(async (protectedRoutes) => {
    protectedRoutes.addHook("preHandler", async (req) => { await repository.authorize(req, params.parse(req.params).eventId); });
    protectedRoutes.get("/api/events/:eventId/volunteers", { config: { documentation: { params: params } } }, async (req) => repository.overview(params.parse(req.params).eventId));
    protectedRoutes.post("/api/events/:eventId/volunteers/shifts/batch", { config: { documentation: { body: z.object({ shift: shiftSchema, count: z.number().int().min(1).max(100) }), params: params, statusCodes: [201] } } }, async (req, reply) => {
      const { shift, count } = z.object({ shift: shiftSchema, count: z.number().int().min(1).max(100) }).parse(req.body);
      return reply.code(201).send(await repository.createShifts(params.parse(req.params).eventId, shift, count));
    });
    protectedRoutes.post("/api/events/:eventId/volunteers/assignments/preview", { config: { documentation: { params: params } } }, async (req) => repository.previewAssignments(params.parse(req.params).eventId));
    protectedRoutes.post("/api/events/:eventId/volunteers/assignments/notify", { config: { documentation: { params: params } } }, async (req) => repository.notifyPlanning(params.parse(req.params).eventId));
    protectedRoutes.post("/api/events/:eventId/volunteers/assignments/apply", { config: { documentation: { params: params, body: assignmentsSchema } } }, async (req) => repository.applyAssignments(params.parse(req.params).eventId, assignmentsSchema.parse(req.body)));
    protectedRoutes.post("/api/events/:eventId/volunteers/applications/:id/badge", { config: { documentation: { params: params, body: z.object({ rotate: z.boolean().default(false) }) } } }, async (req) => {
      const { eventId, id } = params.parse(req.params);
      return repository.issueBadge(eventId, id!, z.object({ rotate: z.boolean().default(false) }).parse(req.body ?? {}).rotate);
    });
    protectedRoutes.post("/api/events/:eventId/volunteers/check-in", { config: { documentation: { body: z.object({ badgeToken: z.string().regex(/^[A-Za-z0-9_-]{43}$/), present: z.boolean().default(true) }), params: params } } }, async (req) => {
      const body = z.object({ badgeToken: z.string().regex(/^[A-Za-z0-9_-]{43}$/), present: z.boolean().default(true) }).parse(req.body);
      return repository.checkIn(params.parse(req.params).eventId, body.badgeToken, body.present);
    });
    protectedRoutes.put("/api/events/:eventId/volunteers/form", { config: { documentation: { params: params, body: volunteerFormSchema } } }, async (req) => repository.saveForm(params.parse(req.params).eventId, volunteerFormSchema.parse(req.body)));
    protectedRoutes.post("/api/events/:eventId/volunteers/form/rotate", { config: { documentation: { params: params } } }, async (req) => repository.rotateToken(params.parse(req.params).eventId));
    protectedRoutes.patch("/api/events/:eventId/volunteers/applications/:id", { config: { documentation: { params: params, body: reviewSchema } } }, async (req) => {
      const { eventId, id } = params.parse(req.params);
      return repository.review(eventId, id!, reviewSchema.parse(req.body));
    });
    for (const resource of ["shifts", "services"] as const) {
      protectedRoutes.post(`/api/events/:eventId/volunteers/${resource}`, { config: { documentation: { params: params, body: resource === "shifts" ? shiftSchema : cateringSchema, statusCodes: [201] } } }, async (req, reply) => {
        const { eventId } = params.parse(req.params);
        return reply.code(201).send(await (resource === "shifts" ? repository.saveShift(eventId, undefined, shiftSchema.parse(req.body)) : repository.saveService(eventId, undefined, cateringSchema.parse(req.body))));
      });
      protectedRoutes.put(`/api/events/:eventId/volunteers/${resource}/:id`, { config: { documentation: { params: params, body: resource === "shifts" ? shiftSchema : cateringSchema } } }, async (req) => {
        const { eventId, id } = params.parse(req.params);
        return resource === "shifts" ? repository.saveShift(eventId, id, shiftSchema.parse(req.body)) : repository.saveService(eventId, id, cateringSchema.parse(req.body));
      });
      protectedRoutes.delete(`/api/events/:eventId/volunteers/${resource}/:id`, { config: { documentation: { params: params } } }, async (req) => {
        const { eventId, id } = params.parse(req.params);
        return resource === "shifts" ? repository.deleteShift(eventId, id!) : repository.deleteService(eventId, id!);
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
