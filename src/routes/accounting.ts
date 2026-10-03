import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../prisma.js";
import { fiscalYearSchema } from "../schemas/fiscal-year.js";
import { AccountingRepository } from "../repositories/accounting.repository.js";
import { AccountingService } from "../services/accounting.service.js";
import { recordRequestActivity } from "../lib/activity-recorder.js";

const idParamsSchema = z.object({ id: z.string().min(1) });
const eventParamsSchema = z.object({ eventId: z.string().min(1) });

const service = new AccountingService(new AccountingRepository(prisma));

export async function accountingRoutes(fastify: FastifyInstance) {
  fastify.get("/api/accounting/fiscal-years", { config: { documentation: {} } }, async (request) => {
    return service.listFiscalYears(request.workspaceId, request.userRole);
  });

  fastify.post("/api/accounting/fiscal-years", { config: { documentation: { body: fiscalYearSchema, statusCodes: [201] } } }, async (request, reply) => {
    const data = fiscalYearSchema.parse(request.body);
    const fiscalYear = await service.createFiscalYear(request.workspaceId, request.userRole, data);
    await recordRequestActivity(request, {
      type: "FISCAL_YEAR_CREATED", title: `Exercice comptable créé : ${fiscalYear.label}`,
      entityType: "FISCAL_YEAR", entityId: fiscalYear.id, notify: false,
    });
    return reply.code(201).send(fiscalYear);
  });

  fastify.put("/api/accounting/fiscal-years/:id", { config: { documentation: { params: idParamsSchema, body: fiscalYearSchema } } }, async (request) => {
    const { id } = idParamsSchema.parse(request.params);
    const data = fiscalYearSchema.parse(request.body);
    const fiscalYear = await service.updateFiscalYear(id, request.workspaceId, request.userRole, data);
    await recordRequestActivity(request, {
      type: "FISCAL_YEAR_UPDATED", title: `Exercice comptable modifié : ${fiscalYear.label}`,
      entityType: "FISCAL_YEAR", entityId: fiscalYear.id, notify: false,
    });
    return fiscalYear;
  });

  fastify.delete("/api/accounting/fiscal-years/:id", { config: { documentation: { params: idParamsSchema, statusCodes: [204] } } }, async (request, reply) => {
    const { id } = idParamsSchema.parse(request.params);
    await service.deleteFiscalYear(id, request.workspaceId, request.userRole);
    await recordRequestActivity(request, {
      type: "FISCAL_YEAR_DELETED", title: "Exercice comptable supprimé", entityType: "FISCAL_YEAR", entityId: id, notify: false,
    });
    return reply.code(204).send();
  });

  fastify.get("/api/accounting/fiscal-years/:id/report", { config: { documentation: { params: idParamsSchema } } }, async (request) => {
    const { id } = idParamsSchema.parse(request.params);
    return service.getReport(id, request.workspaceId, request.userRole);
  });

  fastify.post("/api/accounting/fiscal-years/:id/close", { config: { documentation: { params: idParamsSchema } } }, async (request) => {
    const { id } = idParamsSchema.parse(request.params);
    const fiscalYear = await service.closeFiscalYear(id, request.workspaceId, request.userRole, request.user!.id);
    await recordRequestActivity(request, {
      type: "FISCAL_YEAR_CLOSED", title: `Exercice comptable clôturé : ${fiscalYear.label}`,
      entityType: "FISCAL_YEAR", entityId: id,
    });
    return fiscalYear;
  });

  fastify.get("/api/accounting/fiscal-years/:id/fec", { config: { documentation: { params: idParamsSchema } } }, async (request, reply) => {
    const { id } = idParamsSchema.parse(request.params);
    const { fileName, content } = await service.exportFec(id, request.workspaceId, request.userRole);
    return reply
      .type("text/plain; charset=iso-8859-15")
      .header("content-disposition", `attachment; filename="${fileName}"`)
      .header("cache-control", "no-store")
      .send(content);
  });

  fastify.get("/api/accounting/fiscal-years/:id/pdf", { config: { documentation: { params: idParamsSchema } } }, async (request, reply) => {
    const { id } = idParamsSchema.parse(request.params);
    const { fileName, content } = await service.exportPdf(id, request.workspaceId, request.userRole);
    return reply
      .type("application/pdf")
      .header("content-disposition", `attachment; filename="${fileName}"`)
      .header("cache-control", "no-store")
      .send(content);
  });

  fastify.get("/api/events/:eventId/accounting", { config: { documentation: { params: eventParamsSchema } } }, async (request) => {
    const { eventId } = eventParamsSchema.parse(request.params);
    return service.getEventStatement(eventId, request.workspaceId, request.userRole);
  });
}
