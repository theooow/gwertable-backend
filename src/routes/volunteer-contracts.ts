import type { FastifyInstance, FastifyReply } from "fastify";
import type { VolunteerContract } from "@prisma/client";
import { z } from "zod";
import { VolunteerContractRepository, sha256 } from "../repositories/volunteer-contract.repository.js";
import { contractInput, signatureInput, SIGNATURE_CONSENT } from "../schemas/volunteer-contract.js";
import { ConflictError } from "../lib/errors.js";

const repository = new VolunteerContractRepository();
const publicParams = z.object({ token: z.string().regex(/^[A-Za-z0-9_-]{43}$/) });
const downloadParams = z.object({ format: z.enum(["source", "pdf", "proof"]) });

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
  for (const kind of ["events", "people"] as const) {
    const key = kind === "events" ? "eventId" : "personId";
    const base = `/api/${kind}/:${key}/volunteers/contracts`;
    const params = z.object({ [key]: z.string().min(1), id: z.string().optional() });
    app.get(base, { config: { documentation: { params } } }, async (req, reply) => {
      reply.header("Cache-Control", "no-store");
      return repository.list(req, { [key]: params.parse(req.params)[key]! });
    });
    app.get(`${base}/:id/:format`, { config: { documentation: { params: params.extend({ format: downloadParams.shape.format }) } } }, async (req, reply) => {
      const p = params.parse(req.params);
      return download(await repository.managed(req, p.id!, { [key]: p[key]! }), downloadParams.parse(req.params).format, reply);
    });
  }
  const base = "/api/events/:eventId/volunteers/contracts";
  const params = z.object({ eventId: z.string().min(1), id: z.string().optional() });
  app.post(base, { config: { documentation: { params, body: contractInput, statusCodes: [201] } } }, async (req, reply) => reply.code(201).send(await repository.create(req, params.parse(req.params).eventId, contractInput.parse(req.body))));
  for (const action of ["invite", "cancel"] as const) app.post(`${base}/:id/${action}`, { config: { documentation: { params } } }, async (req) => {
    const p = params.parse(req.params);
    return repository[action](await repository.managed(req, p.id!, { eventId: p.eventId }));
  });

  const publicBase = "/api/public/volunteers/contracts/:token";
  app.register(async (publicRoutes) => {
    publicRoutes.addHook("onRequest", async (_req, reply) => {
      reply.header("Cache-Control", "no-store").header("Referrer-Policy", "no-referrer").header("X-Robots-Tag", "noindex, nofollow");
    });
    publicRoutes.get(publicBase, { config: { documentation: { params: publicParams } } }, async (req) => {
      const c = await repository.publicContract(publicParams.parse(req.params).token);
      return { title: c.title, content: c.content, signerName: c.signerName, emailHint: c.signerEmail.replace(/^(.).*(@.*)$/, "$1***$2"), status: c.status, signedAt: c.signedAt, documentHash: c.documentHash, consent: SIGNATURE_CONSENT };
    });
    publicRoutes.get(`${publicBase}/:format`, { config: { documentation: { params: publicParams.extend(downloadParams.shape) } } }, async (req, reply) => download(await repository.publicContract(publicParams.parse(req.params).token), downloadParams.parse(req.params).format, reply));
    publicRoutes.post(`${publicBase}/code`, { config: { documentation: { params: publicParams } } }, async (req) => repository.code(publicParams.parse(req.params).token));
    publicRoutes.post(`${publicBase}/sign`, { config: { documentation: { params: publicParams, body: signatureInput } } }, async (req) => repository.sign(publicParams.parse(req.params).token, signatureInput.parse(req.body), req));
  });
}
