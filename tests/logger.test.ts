import { describe, expect, it } from "vitest";
import { sanitizeLogText } from "../src/config/logger.js";

describe("log sanitization", () => {
  it("redacts embedded tokens, authorization headers and database passwords", () => {
    const text = [
      "https://api.telegram.org/bot123456789:abcdefghijklmnopqrstuvwxyz/sendMessage",
      "Bearer sk-abcdefghijklmnopqrstuvwxyz",
      "postgresql://deal_finder:very-secret@postgres:5432/deal_finder",
    ].join(" ");
    const sanitized = sanitizeLogText(text);
    expect(sanitized).not.toContain("abcdefghijklmnopqrstuvwxyz");
    expect(sanitized).not.toContain("very-secret");
    expect(sanitized).toContain("[REDACTED]");
  });
});
