import type { ArrClientConfig, ArrRequestRateLimiter, FetchLike } from "./arr-types";

type QueryValue = string | number | boolean;

export class ArrRateLimiter implements ArrRequestRateLimiter {
  private starts: number[] = [];
  private queue: Promise<void> = Promise.resolve();

  constructor(private readonly options: { maxRequests: number; windowMs: number }) {}

  async waitForSlot(): Promise<void> {
    const pending = this.queue.then(() => this.takeSlot());
    this.queue = pending.catch(() => undefined);
    await pending;
  }

  private async takeSlot(): Promise<void> {
    while (true) {
      const now = Date.now();
      this.starts = this.starts.filter((startedAt) => now - startedAt < this.options.windowMs);

      if (this.starts.length < this.options.maxRequests) {
        this.starts.push(now);
        return;
      }

      const oldest = this.starts[0];
      const waitMs = Math.max(1, this.options.windowMs - (now - oldest));
      await delay(waitMs);
    }
  }
}

const sharedArrRateLimiter = new ArrRateLimiter({ maxRequests: 5, windowMs: 1000 });

export class ArrApiClient {
  private readonly apiBaseUrl: string;
  private readonly apiKey: string;
  private readonly fetchImpl: FetchLike;
  private readonly rateLimiter: ArrRequestRateLimiter;

  constructor(config: ArrClientConfig) {
    this.apiBaseUrl = normalizeApiBaseUrl(config.baseUrl);
    this.apiKey = config.apiKey;
    this.fetchImpl = config.fetchImpl ?? fetch;
    this.rateLimiter = config.rateLimiter ?? sharedArrRateLimiter;
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

    await this.rateLimiter.waitForSlot();
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

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
