import type { ArrClientConfig, FetchLike } from "./arr-types";

type QueryValue = string | number | boolean;

export class ArrApiClient {
  private readonly apiBaseUrl: string;
  private readonly apiKey: string;
  private readonly fetchImpl: FetchLike;

  constructor(config: ArrClientConfig) {
    this.apiBaseUrl = normalizeApiBaseUrl(config.baseUrl);
    this.apiKey = config.apiKey;
    this.fetchImpl = config.fetchImpl ?? fetch;
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
