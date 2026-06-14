export interface AdaptivePoolControls {
  /** Signal that the current item hit throttling/overload; the pool drops to its safe limit. */
  reportThrottle: (reason?: unknown) => void;
}

export interface AdaptivePoolOptions {
  /** Concurrency the pool starts at. */
  initialLimit: number;
  /** Concurrency the pool drops to (and stays at) after the first throttle signal. */
  safeLimit: number;
  /** Invoked once, when the pool downshifts from initialLimit to safeLimit. */
  onDownshift?: (newLimit: number, reason: unknown) => void;
}

export interface AdaptivePoolResult {
  /** Highest number of workers that ran concurrently — the observed parallelism. */
  peakActive: number;
  /** Concurrency limit in force when the run ended. */
  finalLimit: number;
  /** Whether a throttle signal forced a downshift. */
  downshifted: boolean;
}

/**
 * Pull-based concurrency pool with a limit that can shrink mid-run. Items are pulled lazily (never
 * eagerly scheduled), so when a worker throws — e.g. a budget block — the run stops without starting
 * the remaining items. A worker can call {@link AdaptivePoolControls.reportThrottle} to make the pool
 * drop to its safe limit for the rest of the run; in-flight workers finish, new ones only start once
 * active workers fall below the reduced limit.
 */
export async function mapAdaptive<T>(
  items: T[],
  options: AdaptivePoolOptions,
  worker: (item: T, index: number, controls: AdaptivePoolControls) => Promise<void>,
): Promise<AdaptivePoolResult> {
  const initialLimit = Math.max(1, Math.floor(options.initialLimit));
  const safeLimit = Math.max(1, Math.min(Math.floor(options.safeLimit), initialLimit));

  let limit = initialLimit;
  let active = 0;
  let peak = 0;
  let nextIndex = 0;
  let downshifted = false;
  let stopped = false;
  let firstError: unknown;

  const controls: AdaptivePoolControls = {
    reportThrottle: (reason) => {
      if (!downshifted && limit > safeLimit) {
        limit = safeLimit;
        downshifted = true;
        options.onDownshift?.(limit, reason);
      }
    },
  };

  return new Promise<AdaptivePoolResult>((resolve, reject) => {
    const settleIfDone = (): void => {
      if (active !== 0 || (!stopped && nextIndex < items.length)) {
        return;
      }
      if (firstError !== undefined) {
        reject(firstError);
      } else {
        resolve({ peakActive: peak, finalLimit: limit, downshifted });
      }
    };

    const pump = (): void => {
      while (!stopped && active < limit && nextIndex < items.length) {
        const index = nextIndex;
        nextIndex += 1;
        active += 1;
        if (active > peak) {
          peak = active;
        }
        void Promise.resolve()
          .then(() => worker(items[index], index, controls))
          .catch((error: unknown) => {
            if (firstError === undefined) {
              firstError = error;
            }
            stopped = true;
          })
          .finally(() => {
            active -= 1;
            if (!stopped) {
              pump();
            }
            settleIfDone();
          });
      }
      settleIfDone();
    };

    if (items.length === 0) {
      resolve({ peakActive: 0, finalLimit: limit, downshifted });
      return;
    }
    pump();
  });
}
