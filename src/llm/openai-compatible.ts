import type { Logger } from "pino";
import { z } from "zod";
import { fetchWithRetry } from "../utils/http.js";
import {
  dealAnalysisSchema,
  extractedListingDataSchema,
  type DealAnalysis,
  type DealAnalysisInput,
  type ExtractedListingData,
  type LLMProvider,
  type ListingExtractionInput,
} from "./types.js";

const chatResponseSchema = z.object({
  choices: z.array(z.object({ message: z.object({ content: z.string().nullable() }) })).min(1),
});

export interface OpenAICompatibleOptions {
  apiKey: string;
  baseUrl: string;
  extractionModel: string;
  analysisModel: string;
  timeoutMs: number;
}

export class OpenAICompatibleProvider implements LLMProvider {
  readonly extractionModel: string;
  readonly analysisModel: string;

  public constructor(private readonly options: OpenAICompatibleOptions, private readonly logger: Logger) {
    this.extractionModel = options.extractionModel;
    this.analysisModel = options.analysisModel;
  }

  async extractListingData(input: ListingExtractionInput): Promise<ExtractedListingData> {
    const prompt = [
      "Extraia somente informações explicitamente presentes no anúncio. Não transforme alegações do vendedor em fatos verificados.",
      `Categoria: ${input.category}`,
      `Marketplace: ${input.listing.source}`,
      `Título: ${input.listing.title}`,
      `Descrição: ${input.listing.description ?? ""}`,
      `Atributos: ${JSON.stringify(input.listing.attributes)}`,
      `Extração determinística existente: ${JSON.stringify(input.deterministicExtraction.data)}`,
      'Retorne JSON no formato {"data": object, "confidence": number de 0 a 1}.',
    ].join("\n");
    return this.requestValidated(this.extractionModel, prompt, extractedListingDataSchema);
  }

  async analyzeDeal(input: DealAnalysisInput): Promise<DealAnalysis> {
    const prompt = [
      "Avalie riscos e vantagens deste anúncio usando os dados fornecidos. O score da LLM é apenas uma parcela do score final.",
      "Não afirme que leilão, sinistro, condição ou autenticidade foram verificados quando são apenas texto do vendedor.",
      `Anúncio: ${JSON.stringify({ source: input.marketplace, title: input.listing.title, price: input.listing.price, description: input.listing.description })}`,
      `Dados estruturados: ${JSON.stringify(input.structured.data)}`,
      `Histórico: ${JSON.stringify(input.priceHistory)}`,
      `Estatísticas: ${JSON.stringify(input.market)}`,
      `Score determinístico: ${input.deterministicScore}`,
      `Critérios: ${JSON.stringify(input.searchCriteria)}`,
      'Retorne JSON: {"score":0-100,"verdict":"bad|weak|fair|good|excellent_deal","advantages":[],"risks":[],"reason":"..."}.',
    ].join("\n");
    return this.requestValidated(this.analysisModel, prompt, dealAnalysisSchema);
  }

  private async requestValidated<T>(model: string, prompt: string, schema: z.ZodType<T>): Promise<T> {
    let invalidOutput: string | null = null;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const repairInstruction = invalidOutput
        ? `\nA resposta anterior não validou. Corrija e retorne apenas JSON válido. Resposta anterior: ${invalidOutput.slice(0, 3000)}`
        : "";
      const content = await this.chat(model, prompt + repairInstruction);
      invalidOutput = content;
      try {
        const parsedJson: unknown = JSON.parse(content);
        const parsed = schema.safeParse(parsedJson);
        if (parsed.success) return parsed.data;
        this.logger.warn({ event: "llm_invalid_schema", model, issues: parsed.error.issues }, "LLM response failed validation");
      } catch (error) {
        this.logger.warn({ event: "llm_invalid_json", model, err: error }, "LLM returned invalid JSON");
      }
    }
    throw new Error("llm_response_invalid_after_repair");
  }

  private async chat(model: string, prompt: string): Promise<string> {
    const url = new URL("chat/completions", this.options.baseUrl.endsWith("/") ? this.options.baseUrl : `${this.options.baseUrl}/`);
    const response = await fetchWithRetry(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${this.options.apiKey}`, "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ model, temperature: 0.1, response_format: { type: "json_object" }, messages: [{ role: "user", content: prompt }] }),
    }, { timeoutMs: this.options.timeoutMs, retries: 1, baseDelayMs: 750 });
    if (!response.ok) throw new Error(`llm_http_error:${response.status}:${(await response.text()).slice(0, 500)}`);
    const parsed = chatResponseSchema.safeParse(await response.json());
    if (!parsed.success) throw new Error(`llm_invalid_api_response:${parsed.error.message}`);
    const content = parsed.data.choices[0]?.message.content;
    if (!content) throw new Error("llm_empty_response");
    return content;
  }
}
