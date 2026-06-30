import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  PORT: z.coerce.number().int().positive().default(4000),
  HOST: z.string().default("0.0.0.0"),
  CORS_ORIGIN: z.string().default("http://localhost:3000"),
  FRONTEND_URL: z.string().default("http://localhost:3001"),
  AUTH_TOKEN_TTL_MINUTES: z.coerce
    .number()
    .int()
    .positive()
    .default(15)
    .transform((value) => Math.min(value, 15)),
  SESSION_TTL_DAYS: z.coerce.number().int().positive().default(30),
  MAIL_TRANSPORT: z.enum(["smtp", "log"]).default(process.env.NODE_ENV === "test" ? "log" : "smtp"),
  MAIL_FROM: z.string().default("Abregi <no-reply@abregi.local>"),
  SMTP_HOST: z.string().default("127.0.0.1"),
  SMTP_PORT: z.coerce.number().int().positive().default(1025),
  SMTP_SECURE: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
  SMTP_USER: z.string().optional(),
  SMTP_PASSWORD: z.string().optional(),
  DOCUMENT_AI_PROVIDER: z.enum(["openai", "ollama"]).default("openai"),
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_MODEL: z.string().default("gpt-4.1-mini"),
  OLLAMA_BASE_URL: z.string().default("http://localhost:11434"),
  OLLAMA_MODEL: z.string().default("llava"),
});

export const env = envSchema.parse(process.env);
