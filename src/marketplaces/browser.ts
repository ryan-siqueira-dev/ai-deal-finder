import { chromium, type Browser, type BrowserContext, type Page } from "playwright";

export interface BrowserSessionOptions {
  headless: boolean;
  storageStatePath?: string;
  executablePath?: string;
}

export class BrowserSession {
  #browser: Browser | null = null;
  #context: BrowserContext | null = null;

  public constructor(private readonly options: BrowserSessionOptions) {}

  async page(): Promise<Page> {
    if (!this.#browser) this.#browser = await chromium.launch({
      headless: this.options.headless,
      ...(this.options.executablePath ? { executablePath: this.options.executablePath } : {}),
    });
    if (!this.#context) {
      this.#context = await this.#browser.newContext({
        locale: "pt-BR",
        timezoneId: "America/Sao_Paulo",
        ...(this.options.storageStatePath ? { storageState: this.options.storageStatePath } : {}),
      });
    }
    return this.#context.newPage();
  }

  async close(): Promise<void> {
    await this.#context?.close();
    await this.#browser?.close();
    this.#context = null;
    this.#browser = null;
  }
}

export async function progressiveScroll(page: Page, rounds = 6, delayMs = 700): Promise<void> {
  let previousHeight = 0;
  for (let round = 0; round < rounds; round += 1) {
    const height = await page.evaluate(() => document.body.scrollHeight);
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(delayMs);
    if (height === previousHeight) break;
    previousHeight = height;
  }
}
