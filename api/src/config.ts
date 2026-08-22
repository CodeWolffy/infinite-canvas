import { resolve } from "node:path";
import { z } from "zod";

const booleanValue = z
  .enum(["true", "false"])
  .default("false")
  .transform((value) => value === "true");

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  HOST: z.string().default("0.0.0.0"),
  PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  TRUST_PROXY: booleanValue,
  DATABASE_URL: z.string().min(1),
  MIGRATIONS_DIR: z.string().optional(),
  CORS_ORIGIN: z.string().default("http://localhost:3000"),
  COOKIE_NAME: z.string().min(1).default("infinite_canvas_session"),
  COOKIE_SECURE: booleanValue,
  SESSION_DAYS: z.coerce.number().int().min(1).max(30).default(7),
  BOOTSTRAP_ADMIN_USERNAME: z.string().optional(),
  BOOTSTRAP_ADMIN_PASSWORD: z.string().min(10).max(128).optional(),
  BOOTSTRAP_ADMIN_DISPLAY_NAME: z.string().min(1).max(80).default("管理员"),
  CHANNEL_ENCRYPTION_KEY: z.string().min(32),
  MINIO_ENDPOINT: z.string().min(1),
  MINIO_PORT: z.coerce.number().int().min(1).max(65535).default(9000),
  MINIO_USE_SSL: booleanValue,
  MINIO_ACCESS_KEY: z.string().min(1),
  MINIO_SECRET_KEY: z.string().min(8),
  MINIO_BUCKET: z.string().min(3).max(63).default("infinite-canvas"),
  MAX_UPLOAD_BYTES: z.coerce.number().int().positive().default(20 * 1024 * 1024),
  MAX_GENERATED_BYTES: z.coerce.number().int().positive().default(50 * 1024 * 1024),
  IMAGE_WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(20).default(20),
  ORPHAN_MEDIA_GRACE_DAYS: z.coerce.number().int().min(1).max(365).default(7),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  const details = parsed.error.issues
    .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
    .join("; ");
  throw new Error(`环境变量配置错误：${details}`);
}

if (
  Boolean(parsed.data.BOOTSTRAP_ADMIN_USERNAME) !==
  Boolean(parsed.data.BOOTSTRAP_ADMIN_PASSWORD)
) {
  throw new Error("BOOTSTRAP_ADMIN_USERNAME 和 BOOTSTRAP_ADMIN_PASSWORD 必须同时配置");
}

export const config = {
  ...parsed.data,
  CORS_ORIGINS: parsed.data.CORS_ORIGIN.split(",")
    .map((origin) => origin.trim())
    .filter(Boolean),
  MIGRATIONS_DIR: parsed.data.MIGRATIONS_DIR
    ? resolve(parsed.data.MIGRATIONS_DIR)
    : resolve(process.cwd(), "drizzle"),
};
