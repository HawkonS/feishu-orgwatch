import { Inject, CanActivate, ExecutionContext, Injectable, SetMetadata, createParamDecorator } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { FastifyRequest } from "fastify";
import { ApiError, forbidden, unauthorized } from "../common/errors.js";
import { currentToken } from "../common/http.js";
import { AuthService, type Role, type SessionUser } from "./auth.service.js";

export const IS_PUBLIC = "feishu-orgwatch:public";
export const ROLES_KEY = "feishu-orgwatch:roles";

export const Public = () => SetMetadata(IS_PUBLIC, true);
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);

export const CurrentUser = createParamDecorator((_data: unknown, context: ExecutionContext): SessionUser => {
  const request = context.switchToHttp().getRequest<FastifyRequest>();
  if (!request.user) throw unauthorized();
  return request.user;
});

const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(AuthService) private readonly auth: AuthService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    this.assertCsrf(request);
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [
      context.getHandler(),
      context.getClass(),
    ]);
    const user = this.auth.userFromToken(currentToken(request));
    if (user) request.user = user;
    if (isPublic) return true;
    if (!user) throw unauthorized();
    const roles = this.reflector.getAllAndOverride<Role[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (roles?.length) this.auth.requireRole(user, roles);
    return true;
  }

  private assertCsrf(request: FastifyRequest): void {
    if (!MUTATING_METHODS.has(request.method)) return;
    const header = request.headers["x-requested-with"];
    if (header !== "feishu-orgwatch") {
      throw new ApiError(403, "CSRF_REQUIRED", "缺少请求来源校验，请通过平台页面操作");
    }
    const origin = request.headers.origin;
    if (!origin) return;
    let originHost: string;
    try {
      originHost = new URL(origin).hostname;
    } catch {
      throw forbidden("请求来源不合法");
    }
    const host = String(request.headers.host ?? "").split(":")[0];
    if (originHost && host && originHost !== host) {
      throw forbidden("请求来源与当前站点不一致");
    }
  }
}
