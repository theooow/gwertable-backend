import type { FastifyInstance, FastifyReply } from "fastify";
import type { VolunteerContract } from "@prisma/client";
import { z } from "zod";
import { VolunteerContractRepository, sha256 } from "../repositories/volunteer-contract.repository.js";
import { contractInput, signatureInput, SIGNATURE_CONSENT } from "../schemas/volunteer-contract.js";
import { ConflictError } from "../lib/errors.js";

const repository = new VolunteerContractRepository();
const publicParams = z.object({ token: z.string().regex(/^[A-Za-z0-9_-]{43}$/) });
const downloadParams = z.object({ format: z.enum(["source", "pdf", "proof"]) });
const eventParams = z.object({ eventId: z.string().min(1) });
const personParams = z.object({ personId: z.string().min(1) });
const eventContractParams = eventParams.extend({ id: z.string().min(1) });
const eventDownloadParams = eventContractParams.extend(downloadParams.shape);
const personDownloadParams = personParams.extend({ id: z.string().min(1), ...downloadParams.shape });

function download(contract: VolunteerContract, format: "source" | "pdf" | "proof", reply: FastifyReply) {
  if (format !== "source" && contract.status !== "SIGNED") throw new ConflictError("Cette convention n’est pas encore signée.");
  reply.header("Cache-Control", "no-store");
  reply.header("X-Content-Type-Options", "nosniff");
  reply.header("Content-Disposition", `attachment; filename="convention-${contract.id}-${format}.${format === "proof" ? "json" : "pdf"}"`);
  if (format === "proof") return reply.type("application/json").send({ evidence: contract.evidence, signedPdfHash: contract.signedPdfHash });
  const bytes = Buffer.from(format === "source" ? contract.sourcePdf : contract.signedPdf!);
  if (sha256(bytes) !== (format === "source" ? contract.documentHash : contract.signedPdfHash)) throw new ConflictError("Intégrité du PDF non vérifiable.");
  return reply.type("application/pdf").send(bytes);
}

export async function volunteerContractRoutes(app: FastifyInstance) {
  app.get("/api/events/:eventId/volunteers/contracts", { config: { documentation: { params: eventParams } } }, async (req, reply) => {
    reply.header("Cache-Control", "no-store");
    return repository.list(req, eventParams.parse(req.params));
  });
  app.get("/api/people/:personId/volunteers/contracts", { config: { documentation: { params: personParams } } }, async (req, reply) => {
    reply.header("Cache-Control", "no-store");
    return repository.list(req, personParams.parse(req.params));
  });
  app.get("/api/events/:eventId/volunteers/contracts/:id/:format", { config: { documentation: { params: eventDownloadParams } } }, async (req, reply) => {
    const { eventId, id, format } = eventDownloadParams.parse(req.params);
    return download(await repository.managed(req, id, { eventId }), format, reply);
  });
  app.get("/api/people/:personId/volunteers/contracts/:id/:format", { config: { documentation: { params: personDownloadParams } } }, async (req, reply) => {
    const { personId, id, format } = personDownloadParams.parse(req.params);
    return download(await repository.managed(req, id, { personId }), format, reply);
  });
  app.post("/api/events/:eventId/volunteers/contracts", { config: { documentation: { params: eventParams, body: contractInput, statusCodes: [201] } } }, async (req, reply) => reply.code(201).send(await repository.create(req, eventParams.parse(req.params).eventId, contractInput.parse(req.body))));
  app.post("/api/events/:eventId/volunteers/contracts/:id/invite", { config: { documentation: { params: eventContractParams } } }, async (req) => {
    const { eventId, id } = eventContractParams.parse(req.params);
    return repository.invite(await repository.managed(req, id, { eventId }));
  });
  app.post("/api/events/:eventId/volunteers/contracts/:id/cancel", { config: { documentation: { params: eventContractParams } } }, async (req) => {
    const { eventId, id } = eventContractParams.parse(req.params);
    return repository.cancel(await repository.managed(req, id, { eventId }));
  });

  app.register(async (publicRoutes) => {
    publicRoutes.addHook("onRequest", async (_req, reply) => {
      reply.header("Cache-Control", "no-store").header("Referrer-Policy", "no-referrer").header("X-Robots-Tag", "noindex, nofollow");
    });
    publicRoutes.get("/api/public/volunteers/contracts/:token", { config: { documentation: { params: publicParams } } }, async (req) => {
      const c = await repository.publicContract(publicParams.parse(req.params).token);
      return { title: c.title, content: c.content, signerName: c.signerName, emailHint: c.signerEmail.replace(/^(.).*(@.*)$/, "$1***$2"), status: c.status, signedAt: c.signedAt, documentHash: c.documentHash, consent: SIGNATURE_CONSENT };
    });
    publicRoutes.get("/api/public/volunteers/contracts/:token/:format", { config: { documentation: { params: publicParams.extend(downloadParams.shape) } } }, async (req, reply) => download(await repository.publicContract(publicParams.parse(req.params).token), downloadParams.parse(req.params).format, reply));
    publicRoutes.post("/api/public/volunteers/contracts/:token/code", { config: { documentation: { params: publicParams } } }, async (req) => repository.code(publicParams.parse(req.params).token));
    publicRoutes.post("/api/public/volunteers/contracts/:token/sign", { config: { documentation: { params: publicParams, body: signatureInput } } }, async (req) => repository.sign(publicParams.parse(req.params).token, signatureInput.parse(req.body), req));
  });
}
