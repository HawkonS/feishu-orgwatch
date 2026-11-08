import { Inject, Injectable } from "@nestjs/common";
import { desc, eq } from "drizzle-orm";
import { DatabaseService } from "../db/database.service.js";
import { watchTasks, type TaskRow } from "../db/schema.js";
import { badRequest, notFound } from "../common/errors.js";
import { nowIso } from "../common/text.js";
import { AuditService } from "../audit/audit.service.js";
import type { SessionUser } from "../auth/auth.service.js";
import { SyncService } from "../sync/sync.service.js";
import { validateCron } from "../sync/cron.js";

export type TaskInput = {
  name: string;
  description?: string | null;
  cron: string;
  timezone: string;
  rootDepartmentId: string;
  enabled: boolean;
  retentionRuns: number;
};

@Injectable()
export class TasksService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(SyncService) private readonly sync: SyncService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  list() {
    return this.database.db.select().from(watchTasks).orderBy(desc(watchTasks.id)).all();
  }

  get(id: number): TaskRow {
    const row = this.database.db.select().from(watchTasks).where(eq(watchTasks.id, id)).get();
    if (!row) throw notFound("任务不存在");
    return row;
  }

  create(input: TaskInput, actor: SessionUser) {
    const next = validateCron(input.cron, input.timezone).next[0] ?? null;
    const inserted = this.database.db
      .insert(watchTasks)
      .values({
        name: input.name.trim(),
        description: input.description?.trim() || null,
        cron: input.cron.trim(),
        timezone: input.timezone,
        enabled: input.enabled,
        rootDepartmentId: input.rootDepartmentId || "0",
        retentionRuns: input.retentionRuns,
        createdBy: actor.id,
        nextRunAt: input.enabled ? next : null,
      })
      .run();
    const task = this.get(Number(inserted.lastInsertRowid));
    this.audit.record({
      actorId: actor.id,
      actorName: actor.displayName,
      action: "task.create",
      targetType: "task",
      targetId: task.id,
      detail: { name: task.name, cron: task.cron },
    });
    return task;
  }

  update(id: number, patch: Partial<TaskInput>, actor: SessionUser) {
    const task = this.get(id);
    const cron = patch.cron?.trim() ?? task.cron;
    const timezone = patch.timezone ?? task.timezone;
    const enabled = patch.enabled ?? task.enabled;
    const needsSchedule = patch.cron !== undefined || patch.timezone !== undefined || patch.enabled !== undefined;
    let nextRunAt = task.nextRunAt;
    if (needsSchedule) {
      if (!enabled) {
        nextRunAt = null;
      } else {
        const next = validateCron(cron, timezone).next[0] ?? null;
        if (!next) throw badRequest("cron 无法计算下次执行时间");
        nextRunAt = next;
      }
    }
    this.database.db
      .update(watchTasks)
      .set({
        name: patch.name?.trim() ?? task.name,
        description: patch.description !== undefined ? patch.description?.trim() || null : task.description,
        cron,
        timezone,
        enabled,
        rootDepartmentId: patch.rootDepartmentId ?? task.rootDepartmentId,
        retentionRuns: patch.retentionRuns ?? task.retentionRuns,
        nextRunAt,
        updatedAt: nowIso(),
      })
      .where(eq(watchTasks.id, id))
      .run();
    const updated = this.get(id);
    this.audit.record({
      actorId: actor.id,
      actorName: actor.displayName,
      action: "task.update",
      targetType: "task",
      targetId: id,
      detail: { fields: Object.keys(patch) },
    });
    return updated;
  }

  remove(id: number, actor: SessionUser) {
    const task = this.get(id);
    this.database.db.delete(watchTasks).where(eq(watchTasks.id, id)).run();
    this.audit.record({
      actorId: actor.id,
      actorName: actor.displayName,
      action: "task.delete",
      targetType: "task",
      targetId: id,
      detail: { name: task.name },
    });
    return { ok: true };
  }

  setEnabled(id: number, enabled: boolean, actor: SessionUser) {
    return this.update(id, { enabled }, actor);
  }

  runNow(id: number, actor: SessionUser) {
    const task = this.get(id);
    const { runId } = this.sync.startDetached({
      taskId: task.id,
      rootDepartmentId: task.rootDepartmentId,
      trigger: "manual",
      requestedBy: actor.id,
    });
    this.audit.record({
      actorId: actor.id,
      actorName: actor.displayName,
      action: "task.run",
      targetType: "task",
      targetId: id,
      detail: { runId },
    });
    return { runId };
  }

  validate(cron: string, timezone: string) {
    return validateCron(cron, timezone);
  }
}
