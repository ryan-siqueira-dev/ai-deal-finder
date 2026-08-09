export interface JobLock {
  withLock<T>(key: string, operation: () => Promise<T>): Promise<T | null>;
}

export class InMemoryJobLock implements JobLock {
  readonly #running = new Set<string>();

  async withLock<T>(key: string, operation: () => Promise<T>): Promise<T | null> {
    if (this.#running.has(key)) return null;
    this.#running.add(key);
    try { return await operation(); }
    finally { this.#running.delete(key); }
  }
}
