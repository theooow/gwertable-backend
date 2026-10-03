import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../prisma.js";
import { fiscalYearSchema } from "../schemas/fiscal-year.js";
import { AccountingRepository } from "../repositories/accounting.repository.js";
import { AccountingService } from "../services/accounting.service.js";

const idParamsSchema = z.object({ id: z.string().min(1) });

const service = new AccountingService(new AccountingRepository(prisma));

export async function accountingRoutes(fastify: FastifyInstance) {
  fastify.get("/api/accounting/fiscal-years", { config: { documentation: {} } }, async (request) => {
    return service.listFiscalYears(request.workspaceId, request.userRole);
  });

  fastify.post("/api/accounting/fiscal-years", { config: { documentation: { body: fiscalYearSchema, statusCodes: [201] } } }, async (request, reply) => {
    const data = fiscalYearSchema.parse(request.body);
    return reply.code(201).send(await service.createFiscalYear(request.workspaceId, request.userRole, data));
  });

  fastify.put("/api/accounting/fiscal-years/:id", { config: { documentation: { params: idParamsSchema, body: fiscalYearSchema } } }, async (request) => {
    const { id } = idParamsSchema.parse(request.params);
    const data = fiscalYearSchema.parse(request.body);
    return service.updateFiscalYear(id, request.workspaceId, request.userRole, data);
  });

  fastify.delete("/api/accounting/fiscal-years/:id", { config: { documentation: { params: idParamsSchema, statusCodes: [204] } } }, async (request, reply) => {
    const { id } = idParamsSchema.parse(request.params);
    await service.deleteFiscalYear(id, request.workspaceId, request.userRole);
    return reply.code(204).send();
  });

  fastify.get("/api/accounting/fiscal-years/:id/report", { config: { documentation: { params: idParamsSchema } } }, async (request) => {
    const { id } = idParamsSchema.parse(request.params);
    return service.getReport(id, request.workspaceId, request.userRole);
  });

  fastify.post("/api/accounting/fiscal-years/:id/close", { config: { documentation: { params: idParamsSchema } } }, async (request) => {
    const { id } = idParamsSchema.parse(request.params);
    return service.closeFiscalYear(id, request.workspaceId, request.userRole, request.user!.id);
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
}
