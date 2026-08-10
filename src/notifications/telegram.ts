import type { Logger } from "pino";
import { z } from "zod";
import type { ListingDetails } from "../marketplaces/types.js";
import type { DealAnalysis } from "../llm/types.js";
import type { MarketStatistics } from "../market-analysis/statistics.js";
import { isMarketplaceUrl } from "../marketplaces/types.js";
import { fetchWithRetry } from "../utils/http.js";

const telegramResponseSchema = z.discriminatedUnion("ok", [
  z.object({
    ok: z.literal(true),
    result: z.object({ message_id: z.number().int() }).passthrough(),
  }).passthrough(),
  z.object({ ok: z.literal(false) }).passthrough(),
]);

async function cancelResponseBody(response: Response): Promise<void> {
  await response.body?.cancel().catch(() => undefined);
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function money(value: number | null, currency: string | null): string {
  if (value === null) return "n/d";
  const normalizedCurrency = currency?.trim().toUpperCase();
  if (!normalizedCurrency || !/^[A-Z]{3}$/.test(normalizedCurrency)) return value.toLocaleString("pt-BR", { maximumFractionDigits: 2 });
  try { return value.toLocaleString("pt-BR", { style: "currency", currency: normalizedCurrency }); }
  catch { return value.toLocaleString("pt-BR", { maximumFractionDigits: 2 }); }
}

function truncate(value: string, maximum: number): string {
  return value.length <= maximum ? value : `${value.slice(0, maximum - 1)}…`;
}

function bullets(values: readonly string[], fallback: string): string {
  if (!values.length) return `• ${fallback}`;
  const visible = values.slice(0, 5).map((item) => `• ${escapeHtml(truncate(item, 180))}`);
  if (values.length > visible.length) visible.push(`• … e mais ${values.length - visible.length}`);
  return visible.join("\n");
}

function safeListingUrl(listing: ListingDetails): string | null {
  try {
    if (!isMarketplaceUrl(listing.source, listing.url)) return null;
    const url = new URL(listing.url);
    if (url.toString().length <= 600) return url.toString();
    url.search = "";
    url.hash = "";
    return url.toString().length <= 600 ? url.toString() : null;
  } catch { return null; }
}

export function formatDealNotification(
  listing: ListingDetails,
  score: number,
  analysis: DealAnalysis,
  market: MarketStatistics,
  differencePercent: number | null,
): string {
  const providerLines = (["facebook", "olx", "mercadolivre"] as const)
    .flatMap((source) => market.byProvider[source] ? [`${source}: <b>${money(market.byProvider[source]?.medianPrice ?? null, listing.currency)}</b>`] : []);
  const advantages = bullets(analysis.advantages, "Nenhum ponto adicional informado");
  const risks = bullets(analysis.risks, "Verificar condição e procedência");
  const listingUrl = safeListingUrl(listing);
  return [
    `🔥 <b>OPORTUNIDADE — ${score}/100</b>`,
    "",
    escapeHtml(truncate(listing.title, 240)),
    `<b>${money(listing.price, listing.currency)}</b>`,
    "",
    `📍 ${escapeHtml(listing.source.toUpperCase())}${listing.location ? ` — ${escapeHtml(truncate(listing.location, 160))}` : ""}`,
    "",
    "📊 <b>PREÇO DE MERCADO</b>",
    ...providerLines,
    `Mediana combinada: <b>${money(market.combined.medianPrice, listing.currency)}</b>`,
    `Amostra: ${market.combined.sampleSize} (${market.combined.confidence})`,
    `Diferença: <b>${differencePercent === null ? "n/d" : `${differencePercent.toFixed(1)}%`}</b>`,
    "",
    "✅ <b>Pontos positivos</b>", advantages,
    "", "⚠️ <b>Verificar</b>", risks,
    "", listingUrl ? `<a href="${escapeHtml(listingUrl)}">Abrir anúncio</a>` : "Link do anúncio indisponível",
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
    }, { timeoutMs: this.timeoutMs, retries: 0 });
    const status = response.status;
    if (!response.ok) {
      await cancelResponseBody(response);
      this.logger.error({ event: "notification_failed", status }, "Telegram notification failed");
      throw new Error(`telegram_http_error:${status}`);
    }
    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      await cancelResponseBody(response);
      this.logger.error({ event: "notification_failed", status }, "Telegram returned an invalid response");
      throw new Error("telegram_invalid_response");
    }
    const parsed = telegramResponseSchema.safeParse(payload);
    if (!parsed.success) {
      this.logger.error({ event: "notification_failed", status }, "Telegram returned an invalid response");
      throw new Error("telegram_invalid_response");
    }
    if (!parsed.data.ok) {
      this.logger.error({ event: "notification_failed", status }, "Telegram rejected the notification");
      throw new Error("telegram_api_error");
    }
  }
}
