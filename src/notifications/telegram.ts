import type { Logger } from "pino";
import type { ListingDetails } from "../marketplaces/types.js";
import type { DealAnalysis } from "../llm/types.js";
import type { MarketStatistics } from "../market-analysis/statistics.js";
import { fetchWithRetry } from "../utils/http.js";

function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function money(value: number | null): string { return value === null ? "n/d" : value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }); }

export function formatDealNotification(
  listing: ListingDetails,
  score: number,
  analysis: DealAnalysis,
  market: MarketStatistics,
  differencePercent: number | null,
): string {
  const providerLines = (["facebook", "olx", "mercadolivre"] as const)
    .flatMap((source) => market.byProvider[source] ? [`${source}: <b>${money(market.byProvider[source]?.medianPrice ?? null)}</b>`] : []);
  const advantages = analysis.advantages.map((item) => `• ${escapeHtml(item)}`).join("\n") || "• Nenhum ponto adicional informado";
  const risks = analysis.risks.map((item) => `• ${escapeHtml(item)}`).join("\n") || "• Verificar condição e procedência";
  return [
    `🔥 <b>OPORTUNIDADE — ${score}/100</b>`,
    "",
    escapeHtml(listing.title),
    `<b>${money(listing.price)}</b>`,
    "",
    `📍 ${escapeHtml(listing.source.toUpperCase())}${listing.location ? ` — ${escapeHtml(listing.location)}` : ""}`,
    "",
    "📊 <b>PREÇO DE MERCADO</b>",
    ...providerLines,
    `Mediana combinada: <b>${money(market.combined.medianPrice)}</b>`,
    `Amostra: ${market.combined.sampleSize} (${market.combined.confidence})`,
    `Diferença: <b>${differencePercent === null ? "n/d" : `${differencePercent.toFixed(1)}%`}</b>`,
    "",
    "✅ <b>Pontos positivos</b>", advantages,
    "", "⚠️ <b>Verificar</b>", risks,
    "", `<a href="${escapeHtml(listing.url)}">Abrir anúncio</a>`,
  ].join("\n");
}

export class TelegramNotifier {
  public constructor(
    private readonly token: string,
    private readonly chatId: string,
    private readonly timeoutMs: number,
    private readonly logger: Logger,
  ) {}

  async send(text: string): Promise<void> {
    const url = `https://api.telegram.org/bot${this.token}/sendMessage`;
    const response = await fetchWithRetry(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: this.chatId, text, parse_mode: "HTML", disable_web_page_preview: false }),
    }, { timeoutMs: this.timeoutMs, retries: 1 });
    if (!response.ok) {
      this.logger.error({ event: "notification_failed", status: response.status }, "Telegram notification failed");
      throw new Error(`telegram_http_error:${response.status}`);
    }
  }
}
