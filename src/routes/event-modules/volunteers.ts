import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { VolunteerRepository } from "../../repositories/volunteer.repository.js";
import { applicationSchema, cateringSchema, reviewSchema, shiftSchema, volunteerFormSchema } from "../../schemas/volunteer.js";

const repository = new VolunteerRepository();
const params = z.object({ eventId: z.string().min(1), id: z.string().min(1).optional() });
const tokenParams = z.object({ token: z.string().regex(/^[A-Za-z0-9_-]{43}$/) });

export async function volunteerRoutes(app: FastifyInstance) {
  const submissions = new Map<string, { count: number; until: number }>();
  const timer = setInterval(() => { for (const [key, value] of submissions) if (value.until <= Date.now()) submissions.delete(key); }, 60000);
  timer.unref();
  app.addHook("onClose", async () => clearInterval(timer));
  app.get("/api/public/volunteers/:token", async (req, reply) => {
    reply.header("Cache-Control", "no-store");
    return repository.publicForm(tokenParams.parse(req.params).token);
  });
  app.post("/api/public/volunteers/:token", { bodyLimit: 64 * 1024 }, async (req, reply) => {
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
    protectedRoutes.get("/api/events/:eventId/volunteers", async (req) => repository.overview(params.parse(req.params).eventId));
    protectedRoutes.put("/api/events/:eventId/volunteers/form", async (req) => repository.saveForm(params.parse(req.params).eventId, volunteerFormSchema.parse(req.body)));
    protectedRoutes.post("/api/events/:eventId/volunteers/form/rotate", async (req) => repository.rotateToken(params.parse(req.params).eventId));
    protectedRoutes.patch("/api/events/:eventId/volunteers/applications/:id", async (req) => {
      const { eventId, id } = params.parse(req.params);
      return repository.review(eventId, id!, reviewSchema.parse(req.body));
    });
    for (const resource of ["shifts", "services"] as const) {
      protectedRoutes.post(`/api/events/:eventId/volunteers/${resource}`, async (req, reply) => {
        const { eventId } = params.parse(req.params);
        return reply.code(201).send(await (resource === "shifts" ? repository.saveShift(eventId, undefined, shiftSchema.parse(req.body)) : repository.saveService(eventId, undefined, cateringSchema.parse(req.body))));
      });
      protectedRoutes.put(`/api/events/:eventId/volunteers/${resource}/:id`, async (req) => {
        const { eventId, id } = params.parse(req.params);
        return resource === "shifts" ? repository.saveShift(eventId, id, shiftSchema.parse(req.body)) : repository.saveService(eventId, id, cateringSchema.parse(req.body));
      });
      protectedRoutes.delete(`/api/events/:eventId/volunteers/${resource}/:id`, async (req) => {
        const { eventId, id } = params.parse(req.params);
        return resource === "shifts" ? repository.deleteShift(eventId, id!) : repository.deleteService(eventId, id!);
      });
    }
    protectedRoutes.put("/api/events/:eventId/volunteers/services/:id/bookings", async (req) => {
      const { eventId, id } = params.parse(req.params);
      const body = z.object({ applicationId: z.string().min(1), booked: z.boolean() }).parse(req.body);
      return repository.bookMeal(eventId, id!, body.applicationId, body.booked);
    });
    protectedRoutes.patch("/api/events/:eventId/volunteers/bookings/:id", async (req) => {
      const { eventId, id } = params.parse(req.params);
      return repository.serveMeal(eventId, id!, z.object({ served: z.boolean() }).parse(req.body).served);
    });
  });
}
