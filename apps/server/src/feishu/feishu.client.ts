import { Inject, Injectable } from "@nestjs/common";
import { ConfigService } from "../config/config.service.js";
import { SettingsService } from "../settings/settings.service.js";
import { ApiError, badRequest } from "../common/errors.js";

const RATE_LIMIT_CODES = new Set(["99991400", "99991401", "99991402", "99991403"]);
const AUTH_INVALID_CODES = new Set(["99991661", "99991663", "99991668"]);

export class FeishuApiError extends ApiError {
  readonly feishuCode: string;
  readonly retryable: boolean;

  constructor(feishuCode: string, message: string, retryable: boolean) {
    super(502, "FEISHU_API_ERROR", `飞书接口错误（${feishuCode}）：${message}`);
    this.feishuCode = feishuCode;
    this.retryable = retryable;
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

type RequestOptions = {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  query?: Record<string, string | number | undefined>;
  body?: unknown;
  timeoutMs?: number;
  maxRetries?: number;
};

@Injectable()
export class FeishuClient {
  private tokenCache?: { key: string; token: string; expiresAt: number };
  private lastRequestAt = 0;

  constructor(
    @Inject(ConfigService) private readonly config: ConfigService,
    @Inject(SettingsService) private readonly settings: SettingsService,
  ) {}

  private credentials() {
    const credentials = this.settings.getFeishu();
    if (!credentials.configured) {
      throw badRequest("请先在「设置」中填写飞书 App ID 与 App Secret");
    }
    return credentials;
  }

  private async pace(): Promise<void> {
    const gap = 100;
    const wait = this.lastRequestAt + gap - Date.now();
    if (wait > 0) await sleep(wait);
    this.lastRequestAt = Date.now();
  }

  async token(force = false): Promise<string> {
    const credentials = this.credentials();
    const key = `${credentials.appId}:${credentials.appSecret}`;
    if (!force && this.tokenCache && this.tokenCache.key === key && this.tokenCache.expiresAt > Date.now()) {
      return this.tokenCache.token;
    }
    const response = await this.rawRequest(
      `${credentials.apiBase}/open-apis/auth/v3/tenant_access_token/internal`,
      {
        method: "POST",
        body: { app_id: credentials.appId, app_secret: credentials.appSecret },
        timeoutMs: this.config.number("sync.request-timeout-ms", 15000),
      },
      null,
    );
    const data = response as {
      code?: number;
      msg?: string;
      tenant_access_token?: string;
      expire?: number;
    };
    if (data.code !== 0 || !data.tenant_access_token) {
      throw new FeishuApiError(String(data.code ?? "TOKEN_FAILED"), data.msg ?? "获取 tenant_access_token 失败", false);
    }
    this.tokenCache = {
      key,
      token: data.tenant_access_token,
      expiresAt: Date.now() + Math.max(60, (data.expire ?? 7200) - 60) * 1000,
    };
    return data.tenant_access_token;
  }

  private async rawRequest(url: string, options: RequestOptions, token: string | null): Promise<unknown> {
    const timeout = options.timeoutMs ?? this.config.number("sync.request-timeout-ms", 15000);
    await this.pace();
    const response = await fetch(url, {
      method: options.method ?? "GET",
      headers: {
        "content-type": "application/json; charset=utf-8",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: AbortSignal.timeout(timeout),
    });
    if (response.status === 429) {
      throw new FeishuApiError("HTTP_429", "请求频率超限", true);
    }
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new FeishuApiError(`HTTP_${response.status}`, text.slice(0, 300) || response.statusText, response.status >= 500);
    }
    return (await response.json()) as unknown;
  }

  private buildUrl(base: string, path: string, query?: RequestOptions["query"]): string {
    const url = new URL(path, `${base}/`);
    for (const [key, value] of Object.entries(query ?? {})) {
      if (value !== undefined && value !== "") url.searchParams.set(key, String(value));
    }
    return url.toString();
  }

  async request<T = Record<string, unknown>>(path: string, options: RequestOptions = {}): Promise<T> {
    const credentials = this.credentials();
    const url = this.buildUrl(credentials.apiBase, path, options.query);
    const maxRetries = options.maxRetries ?? 3;
    let authRetried = false;
    for (let attempt = 0; ; attempt += 1) {
      let token: string;
      try {
        token = await this.token();
      } catch (error) {
        if (attempt < maxRetries && error instanceof FeishuApiError && error.retryable) {
          await sleep(1000 * 2 ** attempt + Math.random() * 250);
          continue;
        }
        throw error;
      }
      try {
        const payload = (await this.rawRequest(url, options, token)) as {
          code?: number;
          msg?: string;
          data?: T;
        };
        if (payload.code === 0) return (payload.data ?? {}) as T;
        const code = String(payload.code ?? "UNKNOWN");
        if (RATE_LIMIT_CODES.has(code) && attempt < maxRetries) {
          await sleep(1000 * 2 ** attempt + Math.random() * 250);
          continue;
        }
        if (AUTH_INVALID_CODES.has(code) && !authRetried) {
          authRetried = true;
          this.tokenCache = undefined;
          await this.token(true);
          continue;
        }
        throw new FeishuApiError(code, payload.msg ?? "未知错误", RATE_LIMIT_CODES.has(code));
      } catch (error) {
        if (error instanceof FeishuApiError && error.retryable && attempt < maxRetries) {
          await sleep(1000 * 2 ** attempt + Math.random() * 250);
          continue;
        }
        throw error;
      }
    }
  }

  async paginate<T>(
    path: string,
    query: Record<string, string | number | undefined>,
    options: {
      pageSize?: number;
      maxPages?: number;
      maxItems?: number;
      shouldCancel?: () => boolean;
      onProgress?: (count: number) => void;
    } = {},
  ): Promise<T[]> {
    const items: T[] = [];
    const seenTokens = new Set<string>();
    let pageToken = "";
    const maxPages = options.maxPages ?? this.config.number("sync.max-pages", 2000);
    const pageSize = options.pageSize ?? 50;
    for (let page = 0; page < maxPages; page += 1) {
      if (options.shouldCancel?.()) throw new ApiError(499, "CANCELLED", "运行已取消");
      const data = await this.request<{
        items?: T[];
        has_more?: boolean;
        page_token?: string;
      }>(path, {
        query: { ...query, page_size: pageSize, page_token: pageToken || undefined },
      });
      const batch = data.items ?? [];
      items.push(...batch);
      if (options.maxItems && items.length > options.maxItems) {
        throw badRequest(`返回数据超过上限 ${options.maxItems}，请在设置中缩小巡查范围`);
      }
      options.onProgress?.(items.length);
      if (!data.has_more) break;
      const next = data.page_token ?? "";
      if (!next || seenTokens.has(next)) {
        throw new FeishuApiError("PAGINATION", "分页令牌异常，已中止抓取", false);
      }
      seenTokens.add(next);
      pageToken = next;
    }
    return items;
  }

  async sendCard(
    receiveIdType: "open_id" | "chat_id" | "email",
    receiveId: string,
    card: unknown,
  ): Promise<string> {
    const data = await this.request<{ message_id?: string }>("/open-apis/im/v1/messages", {
      method: "POST",
      query: { receive_id_type: receiveIdType },
      body: {
        receive_id: receiveId,
        msg_type: "interactive",
        content: JSON.stringify(card),
      },
      maxRetries: 2,
    });
    if (!data.message_id) {
      throw new FeishuApiError("NO_MESSAGE_ID", "飞书未返回 message_id", false);
    }
    return data.message_id;
  }

  async listChats(): Promise<Array<{ chatId: string; name: string }>> {
    const data = await this.request<{
      items?: Array<{ chat_id?: string; name?: string }>;
    }>("/open-apis/im/v1/chats", { query: { page_size: 50 } });
    return (data.items ?? [])
      .filter((item) => item.chat_id)
      .map((item) => ({ chatId: item.chat_id as string, name: item.name ?? item.chat_id as string }));
  }

  async testConnection(): Promise<{ ok: true; rootDepartments: number }> {
    const credentials = this.credentials();
    await this.token(true);
    const data = await this.request<{ items?: unknown[] }>(
      `/open-apis/contact/v3/departments/${encodeURIComponent(credentials.rootDepartmentId)}/children`,
      {
        query: { department_id_type: "open_department_id", fetch_child: "false", page_size: 10 },
      },
    );
    return { ok: true, rootDepartments: data.items?.length ?? 0 };
  }
}
