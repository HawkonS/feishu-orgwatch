import type { FastifyRequest } from "fastify";
import type { SessionUser } from "../auth/auth.service.js";

declare module "fastify" {
  interface FastifyRequest {
    user?: SessionUser;
  }
}

export type RequestMeta = { ip?: string; userAgent?: string };

export function requestMeta(request: FastifyRequest): RequestMeta {
  const agent = request.headers["user-agent"];
  return {
    ip: request.ip,
    userAgent: typeof agent === "string" ? agent : undefined,
  };
}

export function currentToken(request: FastifyRequest): string | undefined {
  const cookies = (request as FastifyRequest & { cookies?: Record<string, string> }).cookies;
  return cookies?.feishu_orgwatch_session;
}
