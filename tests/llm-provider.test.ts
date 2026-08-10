import pino from "pino";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OpenAICompatibleProvider } from "../src/llm/openai-compatible.js";
import { listingFixture } from "./fixtures/listings.js";

describe("OpenAICompatibleProvider", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("applies OpenRouter cost controls without exposing the prompt", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify({ data: { year: 2015 }, confidence: 0.9 }) } }],
      usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120, cost: 0.00001 },
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    const provider = new OpenAICompatibleProvider({
      apiKey: "test-key",
      baseUrl: "https://openrouter.ai/api/v1",
      extractionModel: "qwen/qwen3.7-flash",
      analysisModel: "deepseek/deepseek-v4-flash",
      timeoutMs: 5_000,
      maxOutputTokens: 800,
      reasoningEffort: "none",
    }, pino({ level: "silent" }));

    await provider.extractListingData({
      listing: listingFixture({ title: "BMW 320i 2015" }),
      category: "vehicle",
      deterministicExtraction: { category: "vehicle", data: { year: 2015 }, extractionConfidence: 0.8 },
    });

    const request = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const body = JSON.parse(String(request.body)) as Record<string, unknown>;
    expect(body).toMatchObject({
      model: "qwen/qwen3.7-flash",
      max_tokens: 800,
      reasoning: { effort: "none", exclude: true },
      response_format: { type: "json_object" },
      provider: { require_parameters: true },
    });
  });
});
