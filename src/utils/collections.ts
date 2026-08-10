export async function mapWithConcurrency<T, R>(
  values: readonly T[],
  concurrency: number,
  mapper: (value: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (!Number.isInteger(concurrency) || concurrency < 1) throw new RangeError("concurrency_must_be_a_positive_integer");
  const results = new Array<R>(values.length);
  const errors: Array<{ index: number; error: unknown }> = [];
  let cursor = 0;
  async function worker(): Promise<void> {
    while (cursor < values.length) {
      const index = cursor++;
      const value = values[index];
      if (value !== undefined) {
        try { results[index] = await mapper(value, index); }
        catch (error) { errors.push({ index, error }); }
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, worker));
  if (errors.length) {
    throw new AggregateError(
      errors.map(({ error }) => error),
      `map_with_concurrency_failed:${errors.map(({ index }) => index).join(",")}`,
    );
  }
  return results;
}

export function uniqueBy<T>(values: readonly T[], key: (value: T) => string): T[] {
  const seen = new Set<string>();
  return values.filter((value) => {
    const itemKey = key(value);
    if (seen.has(itemKey)) return false;
    seen.add(itemKey);
    return true;
  });
}
