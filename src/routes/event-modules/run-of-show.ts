import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../../prisma.js";
import { runOfShowSchema, runOfShowSectionSchema, runOfShowTrackSchema } from "../../schemas/run-of-show.js";
import { RunOfShowDao } from "../../dao/run-of-show.dao.js";
import { RunOfShowRepository } from "../../repositories/run-of-show.repository.js";
import { RunOfShowService } from "../../services/run-of-show.service.js";

const eventParamsSchema = z.object({ eventId: z.string().min(1) });
const eventItemParamsSchema = z.object({ eventId: z.string().min(1), id: z.string().min(1) });
const idParamsSchema = z.object({ id: z.string().min(1) });

const service = new RunOfShowService(
  new RunOfShowRepository(new RunOfShowDao(prisma), prisma),
);

export async function runOfShowRoutes(fastify: FastifyInstance) {
  fastify.get("/api/events/:eventId/run-of-show", async (request) => {
    const { eventId } = eventParamsSchema.parse(request.params);
    return service.list(eventId, request.workspaceId, request.userRole);
  });

  fastify.get("/api/events/:eventId/run-of-show/tracks", async (request) => {
    const { eventId } = eventParamsSchema.parse(request.params);
    return service.listTracks(eventId, request.workspaceId, request.userRole);
  });

  fastify.post("/api/events/:eventId/run-of-show/tracks", async (request, reply) => {
    const { eventId } = eventParamsSchema.parse(request.params);
    const data = runOfShowTrackSchema.parse(request.body);
    const track = await service.createTrack(eventId, request.workspaceId, request.userRole, request.user!.id, data);
    return reply.status(201).send(track);
  });

  fastify.put("/api/run-of-show/tracks/:id", async (request) => {
    const { id } = idParamsSchema.parse(request.params);
    const data = runOfShowTrackSchema.parse(request.body);
    return service.updateTrack(id, request.workspaceId, request.userRole, request.user!.id, data);
  });

  fastify.delete("/api/run-of-show/tracks/:id", async (request) => {
    const { id } = idParamsSchema.parse(request.params);
    return service.deleteTrack(id, request.workspaceId, request.userRole, request.user!.id);
  });

  fastify.get("/api/events/:eventId/run-of-show/sections", async (request) => {
    const { eventId } = eventParamsSchema.parse(request.params);
    return service.listSections(eventId, request.workspaceId, request.userRole);
  });

  fastify.post("/api/events/:eventId/run-of-show/sections", async (request, reply) => {
    const { eventId } = eventParamsSchema.parse(request.params);
    const data = runOfShowSectionSchema.parse(request.body);
    const section = await service.createSection(eventId, request.workspaceId, request.userRole, request.user!.id, data);
    return reply.status(201).send(section);
  });

  fastify.put("/api/run-of-show/sections/:id", async (request) => {
    const { id } = idParamsSchema.parse(request.params);
    const data = runOfShowSectionSchema.parse(request.body);
    return service.updateSection(id, request.workspaceId, request.userRole, request.user!.id, data);
  });

  fastify.delete("/api/run-of-show/sections/:id", async (request) => {
    const { id } = idParamsSchema.parse(request.params);
    return service.deleteSection(id, request.workspaceId, request.userRole, request.user!.id);
  });

  fastify.post("/api/events/:eventId/run-of-show", async (request, reply) => {
    const { eventId } = eventParamsSchema.parse(request.params);
    const data = runOfShowSchema.parse(request.body);
    const item = await service.create(eventId, request.workspaceId, request.userRole, request.user!.id, data);
    return reply.status(201).send(item);
  });

  fastify.put("/api/events/:eventId/run-of-show/:id", async (request) => {
    const { eventId, id } = eventItemParamsSchema.parse(request.params);
    const data = runOfShowSchema.parse(request.body);
    return service.update(id, request.workspaceId, request.userRole, request.user!.id, data, eventId);
  });

  fastify.put("/api/run-of-show/:id", async (request) => {
    const { id } = idParamsSchema.parse(request.params);
    const data = runOfShowSchema.parse(request.body);
    return service.update(id, request.workspaceId, request.userRole, request.user!.id, data);
  });

  fastify.delete("/api/events/:eventId/run-of-show/:id", async (request) => {
    const { eventId, id } = eventItemParamsSchema.parse(request.params);
    return service.delete(id, request.workspaceId, request.userRole, request.user!.id, eventId);
  });

  fastify.delete("/api/run-of-show/:id", async (request) => {
    const { id } = idParamsSchema.parse(request.params);
    return service.delete(id, request.workspaceId, request.userRole, request.user!.id);
  });
}
