import type { ArrClientConfig, ArrRequestRateLimiter, FetchLike, ArrPage, ArrHistory, ArrQueueItem } from "./arr-types";

type QueryValue = string | number | boolean;

export class ArrRateLimiter implements ArrRequestRateLimiter {
  private starts: number[] = [];
  private queue: Promise<void> = Promise.resolve();

  constructor(private readonly options: { maxRequests: number; windowMs: number }) {}

  async waitForSlot(signal?: AbortSignal): Promise<void> {
    signal?.throwIfAborted();
    const pending = this.queue.then(() => this.takeSlot(signal));
    this.queue = pending.catch(() => undefined);
    await pending;
  }

  private async takeSlot(signal?: AbortSignal): Promise<void> {
    while (true) {
      signal?.throwIfAborted();
      const now = Date.now();
      this.starts = this.starts.filter((startedAt) => now - startedAt < this.options.windowMs);

      if (this.starts.length < this.options.maxRequests) {
        this.starts.push(now);
        return;
      }

      const oldest = this.starts[0];
      const waitMs = Math.max(1, this.options.windowMs - (now - oldest));
      await delay(waitMs, signal);
    }
  }
}

const sharedArrRateLimiter = new ArrRateLimiter({ maxRequests: 5, windowMs: 1000 });
const metadataLimiters = new Map<string, ArrRateLimiter>();

export class ArrApiClient {
  private readonly apiBaseUrl: string;
  private readonly apiKey: string;
  private readonly fetchImpl: FetchLike;
  private readonly rateLimiter: ArrRequestRateLimiter;
  private readonly metadataLimiter: ArrRequestRateLimiter;
  private readonly timeoutMs: number;
  private readonly signal?: AbortSignal;

  constructor(config: ArrClientConfig) {
    this.apiBaseUrl = normalizeApiBaseUrl(config.baseUrl);
    this.apiKey = config.apiKey;
    this.fetchImpl = config.fetchImpl ?? fetch;
    this.rateLimiter = config.rateLimiter ?? sharedArrRateLimiter;
    if (!metadataLimiters.has(this.apiBaseUrl)) {
      metadataLimiters.set(this.apiBaseUrl, new ArrRateLimiter({ maxRequests: 8, windowMs: 1000 }));
    }
    this.metadataLimiter = config.rateLimiter ?? metadataLimiters.get(this.apiBaseUrl)!;
    this.timeoutMs = config.timeoutMs ?? 120_000;
    this.signal = config.signal;
  }

  async getHistorySince(date: string): Promise<ArrHistory[]> {
    const rows = await this.getArray<ArrHistory>("/history/since", { date });
    if (rows.some((row) => !row || !Number.isSafeInteger(row.id) || !Number.isFinite(Date.parse(row.date)) || typeof row.eventType !== "string")) {
      throw new Error("Invalid ARR history; analysis cursor was not advanced");
    }
    return rows;
  }

  getQueue(page = 1, pageSize = 100): Promise<ArrPage<ArrQueueItem>> {
    return this.getPage<ArrQueueItem>("/queue", { page, pageSize });
  }

  parseReleaseName(title: string): Promise<unknown> { return this.get("/parse", { title }); }

  protected async getArray<T>(path: string, query?: Record<string, QueryValue>): Promise<T[]> {
    const result = await this.get<unknown>(path, query);
    if (!Array.isArray(result)) throw new Error(`Invalid ARR response: ${path} expected an array`);
    return result as T[];
  }

  protected async getEntity<T extends { id: number }>(path: string, expectedId: number): Promise<T> {
    const result = await this.get<T>(path);
    if (!result || result.id !== expectedId) throw new Error(`Invalid ARR response: ${path} returned an unexpected ID`);
    return result;
  }

  protected async getPage<T>(path: string, query?: Record<string, QueryValue>): Promise<ArrPage<T>> {
    const result = await this.get<ArrPage<T>>(path, query);
    if (!result || !Array.isArray(result.records) || !Number.isSafeInteger(result.totalRecords) || result.totalRecords < 0) {
      throw new Error(`Invalid ARR response: ${path} expected a paginated result`);
    }
    return result;
  }

  protected get<T>(path: string, query?: Record<string, QueryValue>): Promise<T> {
    return this.request<T>("GET", path, { query });
  }

  protected post<T>(path: string, body: unknown): Promise<T> {
    return this.request<T>("POST", path, { body });
  }

  private async request<T>(
    method: "GET" | "POST",
    path: string,
    options: { query?: Record<string, QueryValue>; body?: unknown } = {}
  ): Promise<T> {
    const url = this.buildUrl(path, options.query);
    const init: RequestInit = {
      method,
      headers: {
        "X-Api-Key": this.apiKey,
        Accept: "application/json"
      }
    };

    if (options.body !== undefined) {
      init.body = JSON.stringify(options.body);
      init.headers = {
        ...init.headers,
        "Content-Type": "application/json"
      };
    }

    const expensive = method === "POST" || normalizePath(path) === "/release";
    this.signal?.throwIfAborted();
    await (expensive ? this.rateLimiter : this.metadataLimiter).waitForSlot(this.signal);
    this.signal?.throwIfAborted();
    const timeout = AbortSignal.timeout(this.timeoutMs);
    // A dispatched POST may already have changed ARR. Let it finish so its result is recorded.
    init.signal = method === "GET" && this.signal ? AbortSignal.any([timeout, this.signal]) : timeout;
    const response = await this.fetchImpl(url, init);

    if (!response.ok) {
      throw new Error(`ARR request failed: ${method} ${normalizePath(path)} returned ${response.status}`);
    }

    if (response.status === 204) {
      return undefined as T;
    }

    const text = await response.text();
    if (text.length === 0) {
      return undefined as T;
    }

    return JSON.parse(text) as T;
  }

  private buildUrl(path: string, query?: Record<string, QueryValue>): string {
    const normalizedPath = normalizePath(path).replace(/^\//, "");
    const url = new URL(`${this.apiBaseUrl}/${normalizedPath}`);

    for (const [key, value] of Object.entries(query ?? {})) {
      url.searchParams.set(key, String(value));
    }

    return url.toString();
  }
}

function normalizeApiBaseUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim().replace(/\/+$/, "");
  const withoutApiBase = trimmed.replace(/\/api\/v3$/i, "");
  return `${withoutApiBase}/api/v3`;
}

function normalizePath(path: string): string {
  return path.startsWith("/") ? path : `/${path}`;
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    signal?.throwIfAborted();
    const onAbort = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      reject(signal?.reason);
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
