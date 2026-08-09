import "dotenv/config";
import { z } from "zod";

const booleanFromEnv = z
  .enum(["true", "false"])
  .default("true")
  .transform((value) => value === "true");

const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  FACEBOOK_ENABLED: booleanFromEnv,
  FACEBOOK_STORAGE_STATE_PATH: z.string().default("./data/facebook-session.json"),
  FACEBOOK_MAX_LISTINGS_PER_RUN: z.coerce.number().int().positive().max(200).default(50),
  FACEBOOK_HEADLESS: booleanFromEnv,
  OLX_ENABLED: booleanFromEnv,
  OLX_STORAGE_STATE_PATH: z.string().default("./data/olx-session.json"),
  OLX_MAX_LISTINGS_PER_RUN: z.coerce.number().int().positive().max(200).default(50),
  OLX_HEADLESS: booleanFromEnv,
  MERCADOLIVRE_ENABLED: booleanFromEnv,
  MERCADOLIVRE_ACCESS_TOKEN: z.string().optional(),
  MERCADOLIVRE_CLIENT_ID: z.string().optional(),
  MERCADOLIVRE_CLIENT_SECRET: z.string().optional(),
  MERCADOLIVRE_REDIRECT_URI: z.string().optional(),
  MERCADOLIVRE_TOKEN_PATH: z.string().default("./data/mercadolivre-oauth.json"),
  MERCADOLIVRE_WEB_PROFILE_PATH: z.string().default("./data/mercadolivre-web-profile"),
  MERCADOLIVRE_WEB_STORAGE_STATE_PATH: z.string().default("./data/mercadolivre-web-session.json"),
  MERCADOLIVRE_WEB_HEADLESS: booleanFromEnv,
  MERCADOLIVRE_MAX_LISTINGS_PER_RUN: z.coerce.number().int().positive().max(200).default(50),
  LLM_PROVIDER: z.literal("openai-compatible").default("openai-compatible"),
  LLM_API_KEY: z.string().optional(),
  LLM_BASE_URL: z.string().url().default("https://api.openai.com/v1"),
  LLM_EXTRACTION_MODEL: z.string().optional(),
  LLM_ANALYSIS_MODEL: z.string().optional(),
  LLM_MAX_OUTPUT_TOKENS: z.coerce.number().int().positive().max(4_096).default(800),
  LLM_REASONING_EFFORT: z.enum(["none", "minimal", "low", "medium", "high"]).default("none"),
  TELEGRAM_BOT_TOKEN: z.string().optional(),
  TELEGRAM_CHAT_ID: z.string().optional(),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  SCHEDULER_ENABLED: booleanFromEnv,
  PROVIDER_REQUEST_TIMEOUT_MS: z.coerce.number().int().positive().default(30_000),
  LLM_REQUEST_TIMEOUT_MS: z.coerce.number().int().positive().default(90_000),
  DETAIL_FETCH_CONCURRENCY: z.coerce.number().int().positive().max(10).default(2),
  PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH: z.string().optional(),
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
