import { z } from "zod";

export type RouteDocumentation = {
  body?: z.ZodType;
  params?: z.ZodType;
  querystring?: z.ZodType;
  statusCodes?: number[];
};

declare module "fastify" {
  interface FastifyContextConfig {
    documentation?: RouteDocumentation;
  }
}

/** Documentation only: Zod in the handler remains responsible for validation. */
export function inputSchema(schema: z.ZodType) {
  return z.toJSONSchema(schema, {
    target: "openapi-3.0",
    io: "input",
    override({ zodSchema, jsonSchema }) {
      // Coerced numbers still benefit from numeric controls in the docs.
      if (zodSchema._zod.def.type === "number" && !jsonSchema.type) {
        Object.assign(jsonSchema, z.toJSONSchema(zodSchema, { target: "openapi-3.0" }));
      }
    },
  });
}
