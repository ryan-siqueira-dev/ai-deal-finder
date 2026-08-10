import { chromium, type Browser, type BrowserContext, type Page } from "playwright";

export interface BrowserSessionOptions {
  headless: boolean;
  storageStatePath?: string;
  executablePath?: string;
}

export class BrowserSession {
  #browser: Browser | null = null;
  #context: BrowserContext | null = null;
  #initializing: Promise<BrowserContext> | null = null;
  #reloadRequested = false;
  #closed = false;

  public constructor(private readonly options: BrowserSessionOptions) {}

  async page(): Promise<Page> {
    if (this.#closed) throw new Error("browser_session_closed");
    if (this.#reloadRequested) await this.reset();
    return (await this.context()).newPage();
  }

  reloadOnNextPage(): void {
    this.#reloadRequested = true;
  }

  async close(): Promise<void> {
    this.#closed = true;
    await this.reset();
  }

  private async reset(): Promise<void> {
    await this.#initializing?.catch(() => undefined);
    const context = this.#context;
    const browser = this.#browser;
    this.#context = null;
    this.#browser = null;
    this.#initializing = null;
    this.#reloadRequested = false;
    const failures: unknown[] = [];
    try { await context?.close(); } catch (error) { failures.push(error); }
    try { await browser?.close(); } catch (error) { failures.push(error); }
    if (failures.length) throw new AggregateError(failures, "browser_session_close_failed");
  }

  private async context(): Promise<BrowserContext> {
    if (this.#closed) throw new Error("browser_session_closed");
    if (this.#context) return this.#context;
    if (!this.#initializing) {
      this.#initializing = this.createContext().finally(() => { this.#initializing = null; });
    }
    return this.#initializing;
  }

  private async createContext(): Promise<BrowserContext> {
    if (this.#closed) throw new Error("browser_session_closed");
    const browser = await chromium.launch({
      headless: this.options.headless,
      ...(this.options.executablePath ? { executablePath: this.options.executablePath } : {}),
    });
    if (this.#closed) {
      await browser.close().catch(() => undefined);
      throw new Error("browser_session_closed");
    }
    this.#browser = browser;
    try {
      const context = await browser.newContext({
        locale: "pt-BR",
        timezoneId: "America/Sao_Paulo",
        ...(this.options.storageStatePath ? { storageState: this.options.storageStatePath } : {}),
      });
      this.#context = context;
      return context;
    } catch (error) {
      this.#browser = null;
      await browser.close().catch(() => undefined);
      throw error;
    }
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
