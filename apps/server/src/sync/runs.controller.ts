import { Inject, Body, Controller, Get, Param, ParseIntPipe, Post, Query } from "@nestjs/common";
import { z } from "zod";
import { SyncService } from "../sync/sync.service.js";
import { CurrentUser, Roles } from "../auth/auth.guard.js";
import type { SessionUser } from "../auth/auth.service.js";
import { pageQuerySchema, parseWith } from "../common/validation.js";

const startSchema = z.object({
  taskId: z.number().int().positive().optional().nullable(),
  rootDepartmentId: z.string().max(128).optional(),
});

const listSchema = pageQuerySchema.extend({
  status: z.string().max(32).optional(),
  taskId: z.coerce.number().int().positive().optional(),
});

@Controller("runs")
export class RunsController {
  constructor(@Inject(SyncService) private readonly sync: SyncService) {}

  @Post()
  @Roles("operator")
  start(@CurrentUser() user: SessionUser, @Body() body: unknown) {
    const input = parseWith(startSchema, body);
    const result = this.sync.startDetached({
      taskId: input.taskId ?? null,
      rootDepartmentId: input.rootDepartmentId,
      trigger: "manual",
      requestedBy: user.id,
    });
    return { runId: result.runId };
  }

  @Get()
  list(@Query() query: unknown) {
    const parsed = parseWith(listSchema, query);
    return this.sync.listRuns(parsed);
  }

  @Get(":id")
  detail(@Param("id", ParseIntPipe) id: number) {
    return this.sync.getRun(id);
  }

  @Post(":id/cancel")
  @Roles("operator")
  cancel(@CurrentUser() user: SessionUser, @Param("id", ParseIntPipe) id: number) {
    return { run: this.sync.cancel(id, user.id, user.displayName) };
  }

  @Post(":id/confirm")
  @Roles("admin")
  async confirm(@CurrentUser() user: SessionUser, @Param("id", ParseIntPipe) id: number) {
    return { run: await this.sync.confirmRun(id, user.id, user.displayName) };
  }
}
