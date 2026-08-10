import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config/env.js";

describe("configuration", () => {
  it("keeps every marketplace collector opt-in", () => {
    const config = loadConfig({ DATABASE_URL: "postgresql://user:pass@localhost:5432/db" });
    expect(config).toMatchObject({
      FACEBOOK_ENABLED: false,
      OLX_ENABLED: false,
      MERCADOLIVRE_ENABLED: false,
      MERCADOLIVRE_MODE: "web",
      STORE_RAW_PROVIDER_DATA: false,
    });
  });

  it("normalizes empty optional secrets and rejects unsafe configuration values", () => {
    expect(loadConfig({
      DATABASE_URL: "postgresql://user:pass@localhost:5432/db",
      LLM_API_KEY: "  ",
      TELEGRAM_BOT_TOKEN: "",
    })).toMatchObject({ LLM_API_KEY: undefined, TELEGRAM_BOT_TOKEN: undefined });
    expect(() => loadConfig({ DATABASE_URL: "https://example.com/db" })).toThrow("invalid_configuration");
    expect(() => loadConfig({ DATABASE_URL: "not a url" })).toThrow("invalid_configuration");
    expect(() => loadConfig({ DATABASE_URL: "postgresql://" })).toThrow("invalid_configuration");
    expect(() => loadConfig({ DATABASE_URL: "postgresql://user:pass@localhost/db", TELEGRAM_BOT_TOKEN: "invalid" })).toThrow("invalid_configuration");
    expect(() => loadConfig({ DATABASE_URL: "postgresql://user:pass@localhost/db", LLM_BASE_URL: "ftp://example.com" })).toThrow("invalid_configuration");
    expect(() => loadConfig({ DATABASE_URL: "postgresql://user:pass@localhost/db", FACEBOOK_STORAGE_STATE_PATH: " " })).toThrow("invalid_configuration");
    expect(() => loadConfig({ DATABASE_URL: "postgresql://user:pass@localhost/db", MERCADOLIVRE_REDIRECT_URI: "http://example.com/callback" })).toThrow("invalid_configuration");
    expect(loadConfig({ DATABASE_URL: "postgresql://user:pass@localhost/db", MERCADOLIVRE_REDIRECT_URI: "http://localhost:3000/callback" }).MERCADOLIVRE_REDIRECT_URI)
      .toBe("http://localhost:3000/callback");
  });
});
