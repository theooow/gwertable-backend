import { config } from "dotenv";

config({ path: ".env.test" });
config();

process.env.NODE_ENV ??= "test";
process.env.DATABASE_URL ??= "postgresql://postgres:postgres@localhost:5432/abregi_test?schema=public";
process.env.CORS_ORIGIN ??= "http://localhost:3000";
process.env.FRONTEND_URL ??= "http://localhost:3000";
process.env.MAIL_TRANSPORT ??= "log";
process.env.STRIPE_SECRET_KEY ??= "sk_test_abregi";
process.env.STRIPE_WEBHOOK_SECRET ??= "whsec_abregi_test";
