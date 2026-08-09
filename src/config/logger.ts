import pino, { type Logger } from "pino";
import type { AppConfig } from "./env.js";

const REDACTED_PATHS = [
  "*.password",
  "*.token",
  "*.accessToken",
  "*.apiKey",
  "config.MERCADOLIVRE_ACCESS_TOKEN",
  "config.MERCADOLIVRE_CLIENT_SECRET",
  "config.LLM_API_KEY",
  "config.TELEGRAM_BOT_TOKEN",
  "req.headers.authorization",
];

export function createLogger(config: Pick<AppConfig, "LOG_LEVEL">): Logger {
  return pino({
    level: config.LOG_LEVEL,
    redact: { paths: REDACTED_PATHS, censor: "[REDACTED]" },
    base: { service: "ai-deal-finder" },
  });
}
