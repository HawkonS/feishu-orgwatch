import { Inject, Injectable, Logger } from "@nestjs/common";
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { ConfigService } from "../config/config.service.js";
import { SettingsService } from "../settings/settings.service.js";
import { ApiError, badRequest } from "../common/errors.js";
import type { FeishuProfile } from "./auth.service.js";

const OAUTH_BASE = "https://accounts.feishu.cn/open-apis/authen/v1/authorize";
const OAUTH_COOKIE = "feishu_orgwatch_oauth";

type OAuthState = {
  state: string;
  verifier: string;
  redirect: string;
  expiresAt: number;
};

@Injectable()
export class FeishuOAuthService {
  private readonly logger = new Logger(FeishuOAuthService.name);

  constructor(
    @Inject(ConfigService) private readonly config: ConfigService,
    @Inject(SettingsService) private readonly settings: SettingsService,
  ) {}

  get cookieName(): string {
    return OAUTH_COOKIE;
  }

  redirectUri(): string {
    return `${this.config.publicBaseUrl}/api/auth/feishu/callback`;
  }

  private sign(payload: string): string {
    return createHmac("sha256", this.config.secretKey).update(payload).digest("base64url");
  }

  private sanitizeRedirect(value: string | undefined): string {
    if (!value || !value.startsWith("/") || value.startsWith("//")) return "/";
    return value;
  }

  createAuthorization(redirect: string | undefined): { url: string; cookie: string } {
    const credentials = this.settings.getFeishu();
    if (!credentials.configured) throw badRequest("尚未配置飞书应用凭据");
    const state = randomBytes(24).toString("base64url");
    const verifier = randomBytes(32).toString("base64url");
    const challenge = createHash("sha256").update(verifier).digest("base64url");
    const payload: OAuthState = {
      state,
      verifier,
      redirect: this.sanitizeRedirect(redirect),
      expiresAt: Date.now() + 10 * 60 * 1000,
    };
    const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
    const url = new URL(OAUTH_BASE);
    url.searchParams.set("app_id", credentials.appId);
    url.searchParams.set("redirect_uri", this.redirectUri());
    url.searchParams.set("response_type", "code");
    url.searchParams.set("state", state);
    url.searchParams.set("code_challenge", challenge);
    url.searchParams.set("code_challenge_method", "S256");
    return { url: url.toString(), cookie: `${encoded}.${this.sign(encoded)}` };
  }

  readState(cookieValue: string | undefined, state: string): OAuthState {
    if (!cookieValue) throw badRequest("登录状态已失效，请重新发起飞书登录");
    const [encoded, signature] = cookieValue.split(".");
    if (!encoded || !signature) throw badRequest("登录状态格式不正确");
    const expected = this.sign(encoded);
    const a = Buffer.from(signature);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      throw badRequest("登录状态校验失败，请重新发起飞书登录");
    }
    const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as OAuthState;
    if (payload.expiresAt < Date.now()) throw badRequest("登录状态已过期，请重新发起飞书登录");
    if (payload.state !== state) throw badRequest("登录状态不匹配，请重新发起飞书登录");
    return payload;
  }

  async exchange(code: string, verifier: string): Promise<FeishuProfile> {
    const credentials = this.settings.getFeishu();
    if (!credentials.configured) throw badRequest("尚未配置飞书应用凭据");
    const tokenResponse = await fetch(`${credentials.apiBase}/open-apis/authen/v2/oauth/token`, {
      method: "POST",
      headers: { "content-type": "application/json; charset=utf-8" },
      body: JSON.stringify({
        grant_type: "authorization_code",
        client_id: credentials.appId,
        client_secret: credentials.appSecret,
        code,
        redirect_uri: this.redirectUri(),
        code_verifier: verifier,
      }),
      signal: AbortSignal.timeout(15000),
    });
    const tokenPayload = (await tokenResponse.json().catch(() => ({}))) as {
      code?: number | string;
      msg?: string;
      access_token?: string;
      data?: { access_token?: string };
    };
    const accessToken = tokenPayload.access_token ?? tokenPayload.data?.access_token;
    if (!accessToken) {
      this.logger.warn(`飞书 OAuth 换取 token 失败：${tokenPayload.code ?? "?"} ${tokenPayload.msg ?? ""}`);
      throw new ApiError(502, "FEISHU_OAUTH_FAILED", "飞书授权失败，请重试");
    }
    const userResponse = await fetch(`${credentials.apiBase}/open-apis/authen/v1/user_info`, {
      headers: { authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(15000),
    });
    const userPayload = (await userResponse.json().catch(() => ({}))) as {
      code?: number;
      msg?: string;
      data?: {
        open_id?: string;
        union_id?: string;
        user_id?: string;
        name?: string;
        en_name?: string;
        email?: string;
        enterprise_email?: string;
        avatar_url?: string;
        avatar_thumb?: string;
      };
    };
    const data = userPayload.data;
    if (userPayload.code !== 0 || !data?.open_id) {
      this.logger.warn(`飞书 OAuth 获取用户信息失败：${userPayload.code ?? "?"} ${userPayload.msg ?? ""}`);
      throw new ApiError(502, "FEISHU_OAUTH_FAILED", "飞书授权失败，请重试");
    }
    return {
      openId: data.open_id,
      unionId: data.union_id ?? null,
      userId: data.user_id ?? null,
      name: data.name ?? data.en_name ?? data.open_id,
      email: data.email ?? data.enterprise_email ?? null,
      avatarUrl: data.avatar_url ?? data.avatar_thumb ?? null,
    };
  }
}
