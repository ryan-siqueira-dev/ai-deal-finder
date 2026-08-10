import "dotenv/config";
import { z } from "zod";

function booleanFromEnv(defaultValue: boolean) {
  return z
    .enum(["true", "false"])
    .default(String(defaultValue) as "true" | "false")
    .transform((value) => value === "true");
}

const optionalTrimmedString = z.preprocess(
  (value) => typeof value === "string" && value.trim() === "" ? undefined : value,
  z.string().trim().min(1).optional(),
);
const requiredPath = z.string().trim().min(1);
const httpUrl = z.string().trim().url().refine((value) => {
  try { return ["http:", "https:"].includes(new URL(value).protocol); }
  catch { return false; }
}, "must use HTTP or HTTPS");
const oauthRedirectUrl = httpUrl.refine((value) => {
  const parsed = new URL(value);
  return parsed.protocol === "https:" || ["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname);
}, "must use HTTPS unless it points to localhost");

const databaseUrlSchema = z.string().trim().superRefine((value, context) => {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    context.addIssue({ code: "custom", message: "must be a valid PostgreSQL URL" });
    return;
  }
  if (parsed.protocol !== "postgresql:" && parsed.protocol !== "postgres:") {
    context.addIssue({ code: "custom", message: "must be a PostgreSQL URL" });
  }
  if (!parsed.hostname || parsed.pathname === "" || parsed.pathname === "/") {
    context.addIssue({ code: "custom", message: "must include a database host and name" });
  }
});

const envSchema = z.object({
  DATABASE_URL: databaseUrlSchema,
  FACEBOOK_ENABLED: booleanFromEnv(false),
  FACEBOOK_STORAGE_STATE_PATH: requiredPath.default("./data/facebook-session.json"),
  FACEBOOK_MAX_LISTINGS_PER_RUN: z.coerce.number().int().positive().max(200).default(50),
  FACEBOOK_HEADLESS: booleanFromEnv(true),
  OLX_ENABLED: booleanFromEnv(false),
  OLX_STORAGE_STATE_PATH: requiredPath.default("./data/olx-session.json"),
  OLX_MAX_LISTINGS_PER_RUN: z.coerce.number().int().positive().max(200).default(50),
  OLX_HEADLESS: booleanFromEnv(true),
  MERCADOLIVRE_ENABLED: booleanFromEnv(false),
  MERCADOLIVRE_MODE: z.enum(["api", "web"]).default("web"),
  MERCADOLIVRE_ACCESS_TOKEN: optionalTrimmedString,
  MERCADOLIVRE_CLIENT_ID: optionalTrimmedString,
  MERCADOLIVRE_CLIENT_SECRET: optionalTrimmedString,
  MERCADOLIVRE_REDIRECT_URI: z.preprocess(
    (value) => typeof value === "string" && value.trim() === "" ? undefined : value,
    oauthRedirectUrl.optional(),
  ),
  MERCADOLIVRE_TOKEN_PATH: requiredPath.default("./data/mercadolivre-oauth.json"),
  MERCADOLIVRE_WEB_PROFILE_PATH: requiredPath.default("./data/mercadolivre-web-profile"),
  MERCADOLIVRE_WEB_STORAGE_STATE_PATH: requiredPath.default("./data/mercadolivre-web-session.json"),
  MERCADOLIVRE_WEB_HEADLESS: booleanFromEnv(true),
  MERCADOLIVRE_MAX_LISTINGS_PER_RUN: z.coerce.number().int().positive().max(200).default(50),
  LLM_PROVIDER: z.literal("openai-compatible").default("openai-compatible"),
  LLM_API_KEY: optionalTrimmedString,
  LLM_BASE_URL: httpUrl.default("https://api.openai.com/v1"),
  LLM_EXTRACTION_MODEL: optionalTrimmedString,
  LLM_ANALYSIS_MODEL: optionalTrimmedString,
  LLM_MAX_OUTPUT_TOKENS: z.coerce.number().int().positive().max(4_096).default(800),
  LLM_REASONING_EFFORT: z.enum(["none", "minimal", "low", "medium", "high"]).default("none"),
  TELEGRAM_BOT_TOKEN: z.preprocess(
    (value) => typeof value === "string" && value.trim() === "" ? undefined : value,
    z.string().trim().regex(/^\d+:[A-Za-z0-9_-]{20,}$/).optional(),
  ),
  TELEGRAM_CHAT_ID: z.preprocess(
    (value) => typeof value === "string" && value.trim() === "" ? undefined : value,
    z.string().trim().regex(/^(?:-?\d+|@[A-Za-z][A-Za-z0-9_]{4,})$/).optional(),
  ),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  SCHEDULER_ENABLED: booleanFromEnv(true),
  PROVIDER_REQUEST_TIMEOUT_MS: z.coerce.number().int().positive().max(600_000).default(30_000),
  LLM_REQUEST_TIMEOUT_MS: z.coerce.number().int().positive().max(600_000).default(90_000),
  DETAIL_FETCH_CONCURRENCY: z.coerce.number().int().positive().max(10).default(2),
  COMPARABLE_MAX_AGE_DAYS: z.coerce.number().int().positive().max(365).default(30),
  STORE_RAW_PROVIDER_DATA: booleanFromEnv(false),
  PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH: optionalTrimmedString,
});

export type AppConfig = z.infer<typeof envSchema>;

export function loadConfig(environment: NodeJS.ProcessEnv = process.env): AppConfig {
  const result = envSchema.safeParse(environment);
  if (!result.success) {
    const details = result.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ");
    throw new Error(`invalid_configuration: ${details}`);
  }
  return result.data;
}
