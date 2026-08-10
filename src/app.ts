import type { Logger } from "pino";
import type { AppConfig } from "./config/env.js";
import { createLogger } from "./config/logger.js";
import { CategoryAnalyzerRegistry } from "./categories/registry.js";
import { ElectronicsAnalyzer } from "./categories/electronics/analyzer.js";
import { GenericAnalyzer } from "./categories/generic/analyzer.js";
import { GPUAnalyzer } from "./categories/gpu/analyzer.js";
import { NotebookAnalyzer } from "./categories/notebook/analyzer.js";
import { VehicleAnalyzer } from "./categories/vehicle/analyzer.js";
import { MarketplaceRegistry } from "./marketplaces/registry.js";
import { FacebookMarketplaceProvider } from "./marketplaces/facebook/provider.js";
import { OlxProvider } from "./marketplaces/olx/provider.js";
import { MercadoLivreProvider } from "./marketplaces/mercadolivre/provider.js";
import { MercadoLivreWebProvider } from "./marketplaces/mercadolivre/web-provider.js";
import { OpenAICompatibleProvider } from "./llm/openai-compatible.js";
import type { LLMProvider } from "./llm/types.js";
import { TelegramNotifier } from "./notifications/telegram.js";
import { ListingRepository } from "./listings/repository.js";
import { SearchRunner } from "./jobs/search-runner.js";
import { InMemoryJobLock } from "./jobs/lock.js";
import { SearchScheduler } from "./jobs/scheduler.js";

export interface Application {
  logger: Logger;
  marketplaces: MarketplaceRegistry;
  analyzers: CategoryAnalyzerRegistry;
  runner: SearchRunner;
  scheduler: SearchScheduler;
  shutdown(): Promise<void>;
}

export function createApplication(config: AppConfig): Application {
  const logger = createLogger(config);
  const marketplaces = new MarketplaceRegistry();
  const mercadoLivreTokenOptions = {
    accessToken: config.MERCADOLIVRE_ACCESS_TOKEN,
    clientId: config.MERCADOLIVRE_CLIENT_ID,
    clientSecret: config.MERCADOLIVRE_CLIENT_SECRET,
    tokenPath: config.MERCADOLIVRE_TOKEN_PATH,
    timeoutMs: config.PROVIDER_REQUEST_TIMEOUT_MS,
  };
  if (config.MERCADOLIVRE_ENABLED) {
    marketplaces.register(config.MERCADOLIVRE_MODE === "web"
      ? new MercadoLivreWebProvider(
        config.MERCADOLIVRE_WEB_PROFILE_PATH,
        config.MERCADOLIVRE_WEB_STORAGE_STATE_PATH,
        config.MERCADOLIVRE_WEB_HEADLESS,
        config.MERCADOLIVRE_MAX_LISTINGS_PER_RUN,
        config.PROVIDER_REQUEST_TIMEOUT_MS,
        logger,
        mercadoLivreTokenOptions,
        config.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
      )
      : new MercadoLivreProvider(
        mercadoLivreTokenOptions,
        config.PROVIDER_REQUEST_TIMEOUT_MS,
        logger,
        config.MERCADOLIVRE_MAX_LISTINGS_PER_RUN,
        config.STORE_RAW_PROVIDER_DATA,
      ));
  }
  if (config.OLX_ENABLED) marketplaces.register(new OlxProvider(config.OLX_STORAGE_STATE_PATH, config.OLX_HEADLESS, config.OLX_MAX_LISTINGS_PER_RUN, config.PROVIDER_REQUEST_TIMEOUT_MS, logger, config.STORE_RAW_PROVIDER_DATA, config.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH));
  if (config.FACEBOOK_ENABLED) marketplaces.register(new FacebookMarketplaceProvider(config.FACEBOOK_STORAGE_STATE_PATH, config.FACEBOOK_HEADLESS, config.FACEBOOK_MAX_LISTINGS_PER_RUN, config.PROVIDER_REQUEST_TIMEOUT_MS, logger, config.STORE_RAW_PROVIDER_DATA, config.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH));

  const analyzers = new CategoryAnalyzerRegistry();
  analyzers.register(new GenericAnalyzer());
  analyzers.register(new ElectronicsAnalyzer());
  analyzers.register(new GPUAnalyzer());
  analyzers.register(new NotebookAnalyzer());
  analyzers.register(new VehicleAnalyzer());

  let llm: LLMProvider | null = null;
  if (config.LLM_API_KEY && config.LLM_EXTRACTION_MODEL && config.LLM_ANALYSIS_MODEL) {
    llm = new OpenAICompatibleProvider({
      apiKey: config.LLM_API_KEY,
      baseUrl: config.LLM_BASE_URL,
      extractionModel: config.LLM_EXTRACTION_MODEL,
      analysisModel: config.LLM_ANALYSIS_MODEL,
      timeoutMs: config.LLM_REQUEST_TIMEOUT_MS,
      maxOutputTokens: config.LLM_MAX_OUTPUT_TOKENS,
      reasoningEffort: config.LLM_REASONING_EFFORT,
    }, logger);
  } else logger.warn({ event: "llm_disabled" }, "LLM is not fully configured; deterministic analysis remains available");

  const telegram = config.TELEGRAM_BOT_TOKEN && config.TELEGRAM_CHAT_ID
    ? new TelegramNotifier(config.TELEGRAM_BOT_TOKEN, config.TELEGRAM_CHAT_ID, config.PROVIDER_REQUEST_TIMEOUT_MS, logger)
    : null;
  if (!telegram) logger.warn({ event: "telegram_disabled" }, "Telegram is not fully configured; notifications are disabled");

  const runner = new SearchRunner(marketplaces, analyzers, new ListingRepository(), llm, telegram, logger, {
    detailConcurrency: config.DETAIL_FETCH_CONCURRENCY,
    defaultLimit: Math.max(config.FACEBOOK_MAX_LISTINGS_PER_RUN, config.OLX_MAX_LISTINGS_PER_RUN, config.MERCADOLIVRE_MAX_LISTINGS_PER_RUN),
    comparableMaxAgeDays: config.COMPARABLE_MAX_AGE_DAYS,
  });
  const scheduler = new SearchScheduler(runner, new InMemoryJobLock(), logger);
  return {
    logger, marketplaces, analyzers, runner, scheduler,
    async shutdown(): Promise<void> {
      runner.requestStop();
      const results = await Promise.allSettled([scheduler.stop(), marketplaces.close()]);
      const failures = results.filter((result): result is PromiseRejectedResult => result.status === "rejected");
      if (failures.length) throw new AggregateError(failures.map((failure) => failure.reason), "application_shutdown_failed");
    },
  };
}
