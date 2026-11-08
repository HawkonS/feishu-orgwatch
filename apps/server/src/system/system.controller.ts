import { Controller, Get, Inject, Param, Post, Query } from "@nestjs/common";
import { CurrentUser, Roles } from "../auth/auth.guard.js";
import type { SessionUser } from "../auth/auth.service.js";
import { AuditService } from "../audit/audit.service.js";
import { SystemService } from "./system.service.js";

@Controller("admin/system")
@Roles("admin")
export class SystemController {
  constructor(
    @Inject(SystemService) private readonly system: SystemService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  @Get("status")
  status() {
    return this.system.status();
  }

  @Post("check")
  check() {
    return this.system.check();
  }

  @Post("update")
  async update(@CurrentUser() actor: SessionUser) {
    const result = await this.system.startUpdate();
    this.audit.record({
      actorId: actor.id,
      actorName: actor.displayName,
      action: "system.update",
      targetType: "system",
      detail: { jobId: result.jobId },
    });
    return result;
  }

  @Get("update/status")
  updateStatus() {
    return this.system.readState();
  }

  @Get("logs")
  logs() {
    return { items: this.system.listLogs() };
  }

  @Get("logs/:name")
  log(@Param("name") name: string, @Query("lines") lines?: string) {
    const count = Number(lines ?? 200);
    return this.system.tailLog(name, Number.isFinite(count) ? count : 200);
  }
}
