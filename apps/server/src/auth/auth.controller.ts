import { Inject, Body, Controller, Get, Patch, Post, Query, Req, Res } from "@nestjs/common";
import type { FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { AuthService, SESSION_COOKIE, type SessionUser } from "./auth.service.js";
import { CurrentUser, Public } from "./auth.guard.js";
import { FeishuOAuthService } from "./oauth.service.js";
import { ConfigService } from "../config/config.service.js";
import { parseWith } from "../common/validation.js";
import { requestMeta } from "../common/http.js";
import { AuditService } from "../audit/audit.service.js";

const loginSchema = z.object({
  username: z.string().min(1).max(64),
  password: z.string().min(1).max(256),
});

const passwordSchema = z.object({
  currentPassword: z.string().min(1).max(256),
  nextPassword: z.string().min(12).max(256),
});

@Controller()
export class AuthController {
  constructor(
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(FeishuOAuthService) private readonly oauth: FeishuOAuthService,
    @Inject(ConfigService) private readonly config: ConfigService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  private setSessionCookie(reply: FastifyReply, token: string): void {
    reply.setCookie(SESSION_COOKIE, token, {
      path: "/",
      httpOnly: true,
      sameSite: "lax",
      secure: this.config.cookieSecure,
      maxAge: 7 * 24 * 60 * 60,
    });
  }

  private clearSessionCookie(reply: FastifyReply): void {
    reply.clearCookie(SESSION_COOKIE, { path: "/" });
  }

  @Public()
  @Get("bootstrap/status")
  status() {
    return this.auth.bootstrapStatus();
  }

  @Public()
  @Post("auth/login")
  login(
    @Body() body: unknown,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const input = parseWith(loginSchema, body);
    const result = this.auth.login(input, requestMeta(request));
    this.setSessionCookie(reply, result.token);
    return { user: result.user };
  }

  @Public()
  @Post("auth/logout")
  logout(@Req() request: FastifyRequest, @Res({ passthrough: true }) reply: FastifyReply) {
    const cookies = (request as FastifyRequest & { cookies?: Record<string, string> }).cookies;
    this.auth.revokeToken(cookies?.[SESSION_COOKIE]);
    this.clearSessionCookie(reply);
    return { ok: true };
  }

  @Get("auth/me")
  me(@CurrentUser() user: SessionUser) {
    return { user };
  }

  @Patch("auth/password")
  changePassword(
    @CurrentUser() user: SessionUser,
    @Body() body: unknown,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const input = parseWith(passwordSchema, body);
    this.auth.changePassword(user.id, input.currentPassword, input.nextPassword);
    const token = this.auth.createSession(user.id, requestMeta(request));
    this.setSessionCookie(reply, token);
    return { ok: true };
  }

  @Public()
  @Get("auth/feishu/status")
  feishuStatus() {
    return { enabled: this.auth.bootstrapStatus().feishuLoginEnabled };
  }

  @Public()
  @Get("auth/feishu/start")
  feishuStart(
    @Query("redirect") redirect: string | undefined,
    @Res() reply: FastifyReply,
  ) {
    const authorization = this.oauth.createAuthorization(redirect);
    reply.setCookie(this.oauth.cookieName, authorization.cookie, {
      path: "/api/auth/feishu",
      httpOnly: true,
      sameSite: "lax",
      secure: this.config.cookieSecure,
      maxAge: 10 * 60,
    });
    return reply.redirect(authorization.url);
  }

  @Public()
  @Get("auth/feishu/callback")
  async feishuCallback(
    @Query("code") code: string | undefined,
    @Query("state") state: string | undefined,
    @Req() request: FastifyRequest,
    @Res() reply: FastifyReply,
  ) {
    const cookies = (request as FastifyRequest & { cookies?: Record<string, string> }).cookies;
    const cookieValue = cookies?.[this.oauth.cookieName];
    reply.clearCookie(this.oauth.cookieName, { path: "/api/auth/feishu" });
    try {
      if (!code || !state) throw new Error("missing code or state");
      const payload = this.oauth.readState(cookieValue, state);
      const profile = await this.oauth.exchange(code, payload.verifier);
      const user = this.auth.findOrCreateFeishuUser(profile);
      const token = this.auth.createSession(user.id, requestMeta(request));
      this.setSessionCookie(reply, token);
      this.audit.record({
        actorId: user.id,
        actorName: user.displayName,
        action: "auth.feishu_login",
        targetType: "user",
        targetId: user.id,
        ip: request.ip,
      });
      return reply.redirect(payload.redirect || "/");
    } catch (error) {
      request.log.warn({ err: error }, "feishu oauth callback failed");
      return reply.redirect("/login?feishu_error=1");
    }
  }
}
