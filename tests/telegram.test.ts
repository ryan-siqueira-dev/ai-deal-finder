import pino from "pino";
import { afterEach, describe, expect, it, vi } from "vitest";
import { formatDealNotification, TelegramNotifier } from "../src/notifications/telegram.js";
import { calculateMarketStatistics } from "../src/market-analysis/statistics.js";
import { listingFixture } from "./fixtures/listings.js";

describe("Telegram notifications", () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it("keeps HTML messages safe and below Telegram's size limit", () => {
    const longItem = `<script>alert("x")</script>${"x".repeat(600)}`;
    const message = formatDealNotification(
      listingFixture({ title: longItem, url: "https://olx.com.br/item/1?a=%22x%22&b=2" }),
      90,
      { score: 90, verdict: "excellent_deal", advantages: Array(10).fill(longItem), risks: Array(10).fill(longItem), reason: "ok" },
      calculateMarketStatistics([{ id: "a", source: "olx", price: 1_500 }]),
      -20,
    );
    expect(message.length).toBeLessThanOrEqual(4_096);
    expect(message).not.toContain("<script>");
    expect(message).toContain("&lt;script&gt;");
    expect(message).toContain("&amp;b=2");
  });

  it("does not retry a sendMessage POST automatically", async () => {
    const cancel = vi.fn().mockResolvedValue(undefined);
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      body: { cancel },
    } as unknown as Response);
    vi.stubGlobal("fetch", fetchMock);
    const notifier = new TelegramNotifier("123456789:abcdefghijklmnopqrstuvwxyz", "123", 1_000, pino({ level: "silent" }));
    await expect(notifier.send("test")).rejects.toThrow("telegram_http_error:503");
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("requires a valid Telegram success envelope and consumes it", async () => {
    const response = new Response(JSON.stringify({ ok: true, result: { message_id: 1 } }), { status: 200 });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));
    const notifier = new TelegramNotifier("123456789:abcdefghijklmnopqrstuvwxyz", "123", 1_000, pino({ level: "silent" }));
    await expect(notifier.send("test")).resolves.toBeUndefined();
    expect(response.bodyUsed).toBe(true);
  });

  it("does not mark an ok:false response as sent or expose its description", async () => {
    const secret = "bot123456789:SECRET_PAYLOAD_MUST_NOT_LEAK";
    const response = new Response(JSON.stringify({ ok: false, description: secret }), { status: 200 });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));
    const notifier = new TelegramNotifier("123456789:abcdefghijklmnopqrstuvwxyz", "123", 1_000, pino({ level: "silent" }));
    const request = notifier.send("test");
    await expect(request).rejects.toThrow("telegram_api_error");
    await expect(request).rejects.not.toThrow(secret);
    expect(response.bodyUsed).toBe(true);
  });

  it("rejects malformed success responses after consuming the body", async () => {
    const response = new Response("not-json", { status: 200 });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));
    const notifier = new TelegramNotifier("123456789:abcdefghijklmnopqrstuvwxyz", "123", 1_000, pino({ level: "silent" }));
    await expect(notifier.send("test")).rejects.toThrow("telegram_invalid_response");
    expect(response.bodyUsed).toBe(true);
  });

  it("does not render a marketplace link that points to another domain", () => {
    const message = formatDealNotification(
      listingFixture({ url: "https://phishing.example/fake" }),
      80,
      { score: 80, verdict: "good", advantages: [], risks: [], reason: "ok" },
      calculateMarketStatistics([]),
      null,
    );
    expect(message).toContain("Link do anúncio indisponível");
    expect(message).not.toContain("phishing.example");
  });
});
