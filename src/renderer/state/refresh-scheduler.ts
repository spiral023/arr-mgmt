export type RefreshScheduler = {
  dispose: () => void;
  trigger: () => void;
};

export function createRefreshScheduler(
  refresh: () => void | Promise<void>,
  options: { minimumDelayMs: number },
): RefreshScheduler {
  let disposed = false;
  let pending = false;
  let running = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let lastStartedAt = Date.now();

  function clearScheduledTimer() {
    if (timer) {
      clearTimeout(timer);
      timer = undefined;
    }
  }

  function schedule() {
    if (disposed || running || timer) {
      return;
    }

    const elapsed = Date.now() - lastStartedAt;
    const waitMs = Math.max(0, options.minimumDelayMs - elapsed);
    timer = setTimeout(() => {
      timer = undefined;
      void run();
    }, waitMs);
  }

  async function run() {
    if (disposed || !pending) {
      return;
    }

    pending = false;
    running = true;
    lastStartedAt = Date.now();
    try {
      await refresh();
    } finally {
      running = false;
      if (pending) {
        schedule();
      }
    }
  }

  return {
    dispose: () => {
      disposed = true;
      clearScheduledTimer();
    },
    trigger: () => {
      if (disposed) {
        return;
      }
      pending = true;
      schedule();
    },
  };
}
