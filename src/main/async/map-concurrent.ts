export async function mapConcurrent<TInput, TOutput>(
  items: TInput[],
  limit: number,
  mapper: (item: TInput, index: number) => Promise<TOutput>,
  options: { yieldEvery?: number } = {},
): Promise<TOutput[]> {
  if (items.length === 0) {
    return [];
  }

  const workerCount = Math.min(items.length, Math.max(1, Math.floor(limit)));
  const yieldEvery = Math.max(0, Math.floor(options.yieldEvery ?? 0));
  const results = new Array<TOutput>(items.length);
  let nextIndex = 0;
  let stopped = false;
  let firstError: unknown;

  async function runWorker(): Promise<void> {
    let processedSinceYield = 0;
    while (!stopped && nextIndex < items.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      try {
        results[currentIndex] = await mapper(items[currentIndex], currentIndex);
      } catch (error) {
        if (!stopped) firstError = error;
        stopped = true;
        return;
      }
      processedSinceYield += 1;
      if (yieldEvery > 0 && processedSinceYield >= yieldEvery && nextIndex < items.length) {
        processedSinceYield = 0;
        await yieldToEventLoop();
      }
    }
  }

  await Promise.all(Array.from({ length: workerCount }, () => runWorker()));
  if (stopped) throw firstError;
  return results;
}

function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}
