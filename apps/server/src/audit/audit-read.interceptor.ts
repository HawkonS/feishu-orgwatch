import { CallHandler, ExecutionContext, Inject, Injectable, NestInterceptor } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { Observable } from "rxjs";
import { tap } from "rxjs/operators";
import { AuditService } from "./audit.service.js";

type ReadAudit = {
  action: string;
  targetType: string;
};

const READ_PATHS: Array<{ prefix: string; audit: ReadAudit }> = [
  { prefix: "/api/directory", audit: { action: "directory.read", targetType: "directory" } },
  { prefix: "/api/diffs", audit: { action: "diff.read", targetType: "diff" } },
  { prefix: "/api/overview", audit: { action: "overview.read", targetType: "overview" } },
  { prefix: "/api/runs", audit: { action: "run.read", targetType: "run" } },
  { prefix: "/api/tasks", audit: { action: "task.read", targetType: "task" } },
  { prefix: "/api/admin/users", audit: { action: "user.list", targetType: "user" } },
  { prefix: "/api/settings", audit: { action: "settings.read", targetType: "settings" } },
  { prefix: "/api/audit", audit: { action: "audit.read", targetType: "audit" } },
  { prefix: "/api/admin/system/logs", audit: { action: "system.logs.read", targetType: "system" } },
];

function readAuditFor(pathname: string): ReadAudit | null {
  if (pathname.endsWith("/export.csv")) {
    return { action: "diff.export", targetType: "diff" };
  }
  for (const item of READ_PATHS) {
    if (pathname === item.prefix || pathname.startsWith(`${item.prefix}/`)) return item.audit;
  }
  return null;
}

/**
 * Record access to sensitive read endpoints. Mutations already audit
 * themselves in their controllers; this closes the "who viewed the directory"
 * gap without logging health checks, status polling, or auth/me.
 */
@Injectable()
export class AuditReadInterceptor implements NestInterceptor {
  constructor(@Inject(AuditService) private readonly audit: AuditService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    if (request.method !== "GET") return next.handle();

    const pathname = request.url.split("?")[0] ?? "";
    const user = request.user;
    const audit = readAuditFor(pathname);
    if (!user || !audit) return next.handle();

    return next.handle().pipe(
      tap(() => {
        try {
          this.audit.record({
            actorId: user.id,
            actorName: user.displayName,
            action: audit.action,
            targetType: audit.targetType,
            targetId: pathname,
            detail: { method: "GET" },
            ip: request.ip,
            userAgent: typeof request.headers["user-agent"] === "string" ? request.headers["user-agent"] : null,
          });
        } catch {
          // An audit write must never turn a successful read into a 500.
        }
      }),
    );
  }
}
