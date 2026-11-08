import { Inject, Body, Controller, Delete, Get, Param, ParseIntPipe, Patch, Post, Query } from "@nestjs/common";
import { z } from "zod";
import { TasksService } from "./tasks.service.js";
import { CurrentUser, Roles } from "../auth/auth.guard.js";
import type { SessionUser } from "../auth/auth.service.js";
import { pageQuerySchema, parseWith } from "../common/validation.js";
import { SyncService } from "../sync/sync.service.js";

const taskSchema = z.object({
  name: z.string().min(1).max(64),
  description: z.string().max(500).optional().nullable(),
  cron: z.string().min(1).max(120),
  timezone: z.string().min(1).max(64).default("Asia/Shanghai"),
  rootDepartmentId: z.string().min(1).max(128).default("0"),
  enabled: z.boolean().default(true),
  retentionRuns: z.number().int().min(2).max(365).default(60),
});

const patchSchema = taskSchema.partial();

const validateSchema = z.object({
  cron: z.string().min(1).max(120),
  timezone: z.string().min(1).max(64).default("Asia/Shanghai"),
});

const enableSchema = z.object({ enabled: z.boolean() });

const runsSchema = pageQuerySchema;

@Controller("tasks")
@Roles("admin", "operator")
export class TasksController {
  constructor(
    @Inject(TasksService) private readonly tasks: TasksService,
    @Inject(SyncService) private readonly sync: SyncService,
  ) {}

  @Get()
  list() {
    return { items: this.tasks.list() };
  }

  @Post()
  create(@CurrentUser() user: SessionUser, @Body() body: unknown) {
    const input = parseWith(taskSchema, body);
    return { task: this.tasks.create(input, user) };
  }

  @Post("validate-cron")
  validate(@Body() body: unknown) {
    const input = parseWith(validateSchema, body);
    return this.tasks.validate(input.cron, input.timezone);
  }

  @Get(":id")
  get(@Param("id", ParseIntPipe) id: number) {
    return { task: this.tasks.get(id) };
  }

  @Patch(":id")
  update(
    @CurrentUser() user: SessionUser,
    @Param("id", ParseIntPipe) id: number,
    @Body() body: unknown,
  ) {
    const patch = parseWith(patchSchema, body);
    return { task: this.tasks.update(id, patch, user) };
  }

  @Delete(":id")
  remove(@CurrentUser() user: SessionUser, @Param("id", ParseIntPipe) id: number) {
    return this.tasks.remove(id, user);
  }

  @Post(":id/enable")
  enable(
    @CurrentUser() user: SessionUser,
    @Param("id", ParseIntPipe) id: number,
    @Body() body: unknown,
  ) {
    const input = parseWith(enableSchema, body);
    return { task: this.tasks.setEnabled(id, input.enabled, user) };
  }

  @Post(":id/run")
  run(@CurrentUser() user: SessionUser, @Param("id", ParseIntPipe) id: number) {
    return this.tasks.runNow(id, user);
  }

  @Get(":id/runs")
  runs(@Param("id", ParseIntPipe) id: number, @Query() query: unknown) {
    const parsed = parseWith(runsSchema, query);
    this.tasks.get(id);
    return this.sync.listRuns({ ...parsed, taskId: id });
  }
}
