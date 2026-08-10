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

export function sanitizeLogText(value: string): string {
  return value
    .replace(/\bBearer\s+[A-Za-z0-9._~+\/-]+=*/gi, "Bearer [REDACTED]")
    .replace(/\bbot\d+:[A-Za-z0-9_-]{20,}\b/g, "bot[REDACTED]")
    .replace(/\b\d+:[A-Za-z0-9_-]{20,}\b/g, "[REDACTED_TELEGRAM_TOKEN]")
    .replace(/\bsk-[A-Za-z0-9_-]{16,}\b/g, "[REDACTED_API_KEY]")
    .replace(/(postgres(?:ql)?:\/\/[^:\s/]+:)[^@\s]+@/gi, "$1[REDACTED]@");
}

function sanitizeLogValue(value: unknown): unknown {
  if (typeof value === "string") return sanitizeLogText(value);
  if (Array.isArray(value)) return value.map(sanitizeLogValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, sanitizeLogValue(item)]));
  }
  return value;
}

export function createLogger(config: Pick<AppConfig, "LOG_LEVEL">): Logger {
  return pino({
    level: config.LOG_LEVEL,
    redact: { paths: REDACTED_PATHS, censor: "[REDACTED]" },
    serializers: {
      err: (error: unknown) => sanitizeLogValue(pino.stdSerializers.err(error as Error)),
    },
    base: { service: "ai-deal-finder" },
  });
}
