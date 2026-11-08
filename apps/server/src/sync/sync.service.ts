import { Inject, Injectable, Logger } from "@nestjs/common";
import { and, desc, eq, sql } from "drizzle-orm";
import { ConfigService } from "../config/config.service.js";
import { DatabaseService } from "../db/database.service.js";
import {
  changes as changesTable,
  diffs,
  syncRunEvents,
  syncRuns,
  type RunRow,
} from "../db/schema.js";
import { ApiError, badRequest, conflict, notFound } from "../common/errors.js";
import { nowIso } from "../common/text.js";
import type { PageQuery } from "../common/validation.js";
import { DirectoryFetcher } from "../feishu/directory.fetcher.js";
import { SettingsService } from "../settings/settings.service.js";
import { AuditService } from "../audit/audit.service.js";
import { InformService, type RecipientInput } from "../inform/inform.service.js";
import type { SessionUser } from "../auth/auth.service.js";
import { diffSnapshots, type DiffResult, type DiffOptions } from "./diff.engine.js";
import { buildSnapshot } from "./normalize.js";
import { SnapshotService } from "./snapshot.service.js";
import { nextRun } from "./cron.js";

export type Trigger = "schedule" | "manual" | "catchup" | "bootstrap";

const SYSTEM_ACTOR: SessionUser = {
  id: 0,
  username: "system",
  displayName: "系统自动通知",
  email: null,
  role: "operator",
  avatarUrl: null,
  feishuOpenId: null,
  feishuUnionId: null,
  source: "system",
  hasPassword: false,
};

export type StartRunInput = {
  taskId?: number | null;
  rootDepartmentId?: string;
  trigger: Trigger;
  requestedBy?: number | null;
};

@Injectable()
export class SyncService {
  private readonly logger = new Logger(SyncService.name);
  private activeRunId: number | null = null;

  constructor(
    @Inject(ConfigService) private readonly config: ConfigService,
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(SettingsService) private readonly settings: SettingsService,
    @Inject(DirectoryFetcher) private readonly fetcher: DirectoryFetcher,
    @Inject(SnapshotService) private readonly snapshots: SnapshotService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(InformService) private readonly informs: InformService,
  ) {}

  isBusy(): boolean {
    return this.activeRunId !== null;
  }

  activeId(): number | null {
    return this.activeRunId;
  }

  private runRow(runId: number): RunRow {
    const row = this.database.db.select().from(syncRuns).where(eq(syncRuns.id, runId)).get();
    if (!row) throw notFound("巡查运行不存在");
    return row;
  }

  private patchRun(runId: number, patch: Partial<typeof syncRuns.$inferInsert>): void {
    this.database.db.update(syncRuns).set(patch).where(eq(syncRuns.id, runId)).run();
  }

  private event(runId: number, level: "info" | "warn" | "error", message: string, detail?: unknown): void {
    this.database.db
      .insert(syncRunEvents)
      .values({
        runId,
        at: nowIso(),
        level,
        message,
        detailJson: detail === undefined ? null : JSON.stringify(detail),
      })
      .run();
  }

  private isCancelled(runId: number): boolean {
    const row = this.database.db
      .select({ cancelRequested: syncRuns.cancelRequested })
      .from(syncRuns)
      .where(eq(syncRuns.id, runId))
      .get();
    return Boolean(row?.cancelRequested);
  }

  private diffOptions(): DiffOptions {
    return {
      trackOrder: this.settings.getBoolean("diff.track-order", false),
      trackTitle: this.settings.getBoolean("diff.track-title", true),
      trackEmployeeNo: this.settings.getBoolean("diff.track-employee-no", true),
    };
  }

  private prepare(input: StartRunInput): { runId: number; scope: string } {
    if (this.activeRunId !== null) {
      throw conflict("已有巡查任务正在执行，请等待结束后再试");
    }
    const credentials = this.settings.getFeishu();
    if (!credentials.configured) {
      throw badRequest("请先在「设置」中配置飞书 App ID 与 App Secret");
    }
    const scope = (input.rootDepartmentId || credentials.rootDepartmentId || "0").trim() || "0";
    const inserted = this.database.db
      .insert(syncRuns)
      .values({
        taskId: input.taskId ?? null,
        trigger: input.trigger,
        status: "running",
        phase: "token",
        startedAt: nowIso(),
        requestedBy: input.requestedBy ?? null,
      })
      .run();
    const runId = Number(inserted.lastInsertRowid);
    this.activeRunId = runId;
    this.event(runId, "info", `开始巡查，根部门 ${scope}`);
    return { runId, scope };
  }

  async startRun(input: StartRunInput): Promise<RunRow> {
    const { runId, scope } = this.prepare(input);
    await this.execute(runId, input, scope);
    return this.runRow(runId);
  }

  startDetached(input: StartRunInput): { runId: number } {
    const { runId, scope } = this.prepare(input);
    void this.execute(runId, input, scope).catch((error: unknown) => {
      this.logger.error(`后台巡查异常：${error instanceof Error ? error.message : String(error)}`);
    });
    return { runId };
  }

  private async execute(runId: number, input: StartRunInput, scope: string): Promise<void> {
    try {
      this.patchRun(runId, { phase: "departments" });
      const fetched = await this.fetcher.fetch({
        rootDepartmentId: scope,
        shouldCancel: () => this.isCancelled(runId),
        onProgress: (phase, count) => {
          if (phase === "departments") {
            this.patchRun(runId, { phase: "departments", departmentCount: count });
          } else if (phase === "people") {
            this.patchRun(runId, { phase: "people", peopleCount: count });
          } else {
            this.patchRun(runId, { phase: "enrich" });
          }
        },
      });
      for (const warning of fetched.warnings) {
        this.event(runId, "warn", warning);
      }

      this.patchRun(runId, { phase: "snapshot" });
      const data = buildSnapshot(scope, fetched);
      this.event(
        runId,
        "info",
        `抓取完成：${data.departments.size - 1} 个部门、${data.people.size} 名人员`,
      );

      const previous = this.snapshots.latestOk(scope);
      const snapshotId = this.snapshots.create(runId, data, "ok");
      this.patchRun(runId, {
        snapshotId,
        departmentCount: data.departments.size,
        peopleCount: data.people.size,
      });

      let diffId: number | null = null;
      let result: DiffResult | null = null;
      if (previous) {
        this.patchRun(runId, { phase: "diff" });
        const previousData = this.snapshots.load(previous.id);
        result = diffSnapshots(previousData, data, this.diffOptions());
        if (result.counts.total > 0) {
          diffId = this.createDiff(previous.id, snapshotId, scope, input.taskId ?? null, result);
          this.event(runId, "info", `生成差异 #${diffId}，共 ${result.counts.total} 项变更`);
        } else {
          this.event(runId, "info", "未发现差异");
        }
      }

      if (diffId) await this.autoNotify(diffId, runId);

      this.patchRun(runId, {
        status: "success",
        phase: "done",
        finishedAt: nowIso(),
        diffId,
        addedPeople: result?.counts.peopleAdded ?? 0,
        removedPeople: result?.counts.peopleRemoved ?? 0,
        changedPeople: result?.counts.peopleChanged ?? 0,
        addedDepartments: result?.counts.departmentsAdded ?? 0,
        removedDepartments: result?.counts.departmentsRemoved ?? 0,
        changedDepartments: result?.counts.departmentsChanged ?? 0,
      });
      this.event(runId, "info", "巡查完成");

      try {
        this.snapshots.prune(
          scope,
          this.settings.getNumber("sync.retention-runs", 60, 2, 365),
          this.config.number("sync.retention-days", 90),
        );
      } catch (error) {
        this.logger.warn(`清理历史快照失败：${(error as Error).message}`);
      }
    } catch (error) {
      const cancelled = error instanceof ApiError && error.code === "CANCELLED";
      const message = error instanceof Error ? error.message : String(error);
      this.patchRun(runId, {
        status: cancelled ? "cancelled" : "failed",
        phase: cancelled ? "cancelled" : "failed",
        finishedAt: nowIso(),
        errorCode: error instanceof ApiError ? error.code : "RUN_FAILED",
        errorMessage: message,
      });
      this.event(runId, cancelled ? "warn" : "error", cancelled ? "运行已取消" : `巡查失败：${message}`);
      if (!cancelled) this.logger.error(`巡查失败：${message}`);
    } finally {
      this.activeRunId = null;
    }
  }

  private autoNotifyRecipients(): RecipientInput[] {
    try {
      const parsed = JSON.parse(this.settings.get("notify.auto-recipients") || "[]") as unknown;
      if (!Array.isArray(parsed)) return [];
      return parsed
        .slice(0, 200)
        .map((item): RecipientInput | null => {
          const value = item as { type?: string; id?: string; name?: string };
          if ((value.type !== "user" && value.type !== "chat") || !value.id?.trim()) return null;
          return {
            type: value.type,
            id: value.id.trim(),
            name: value.name?.trim().slice(0, 200) || value.id.trim(),
          };
        })
        .filter((item): item is RecipientInput => item !== null);
    } catch {
      return [];
    }
  }

  private async autoNotify(diffId: number, runId: number): Promise<void> {
    if (!this.settings.getBoolean("notify.auto-enabled", false)) return;
    const recipients = this.autoNotifyRecipients();
    if (!recipients.length) {
      this.event(runId, "warn", "自动通知已启用，但没有配置收件人");
      return;
    }
    try {
      const result = await this.informs.inform(
        diffId,
        {
          recipients,
          note: "检测到组织变更，系统自动发送",
        },
        SYSTEM_ACTOR,
      );
      const sent = result.deliveries.filter((delivery) => delivery.status === "sent").length;
      const failed = result.deliveries.length - sent;
      this.event(
        runId,
        failed ? "warn" : "info",
        `自动通知完成：成功 ${sent} 个，失败 ${failed} 个`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.event(runId, "warn", `自动通知失败：${message}`);
      this.logger.warn(`差异 #${diffId} 自动通知失败：${message}`);
    }
  }

  private createDiff(
    fromSnapshotId: number,
    toSnapshotId: number,
    scope: string,
    taskId: number | null,
    result: DiffResult,
  ): number {
    const createdAt = nowIso();
    return this.database.transaction(() => {
      const inserted = this.database.db
        .insert(diffs)
        .values({
          taskId,
          fromSnapshotId,
          toSnapshotId,
          scopeRootDepartmentId: scope,
          status: "new",
          severity: result.severity,
          totalChanges: result.counts.total,
          peopleAdded: result.counts.peopleAdded,
          peopleRemoved: result.counts.peopleRemoved,
          peopleChanged: result.counts.peopleChanged,
          departmentsAdded: result.counts.departmentsAdded,
          departmentsRemoved: result.counts.departmentsRemoved,
          departmentsChanged: result.counts.departmentsChanged,
          summaryJson: JSON.stringify(result.summary),
          createdAt,
          updatedAt: createdAt,
        })
        .run();
      const diffId = Number(inserted.lastInsertRowid);
      const rows = result.changes.map((change) => ({
        diffId,
        entityType: change.entityType,
        changeKind: change.changeKind,
        entityKey: change.entityKey,
        entityName: change.entityName,
        departmentPathBefore: change.departmentPathBefore,
        departmentPathAfter: change.departmentPathAfter,
        field: change.field,
        beforeJson: change.before === undefined ? null : JSON.stringify(change.before),
        afterJson: change.after === undefined ? null : JSON.stringify(change.after),
        severity: change.severity,
        createdAt,
      }));
      for (let index = 0; index < rows.length; index += 100) {
        this.database.db.insert(changesTable).values(rows.slice(index, index + 100)).run();
      }
      return diffId;
    });
  }

  async confirmRun(runId: number, actorId: number, actorName: string): Promise<RunRow> {
    const run = this.runRow(runId);
    if (run.status !== "needs_review" || !run.snapshotId) {
      throw badRequest("该运行不在待确认状态");
    }
    const snapshot = this.snapshots.get(run.snapshotId);
    if (!snapshot || snapshot.status !== "quarantined") {
      throw badRequest("快照不存在或已确认");
    }
    const previous = this.snapshots.latestOk(snapshot.scopeRootDepartmentId, snapshot.id);
    const previousData = previous ? this.snapshots.load(previous.id) : null;
    const nextData = this.snapshots.load(snapshot.id);
    if (!nextData) throw notFound("快照数据不存在");
    this.snapshots.setStatus(snapshot.id, "ok");
    const result = diffSnapshots(previousData, nextData, this.diffOptions());
    let diffId: number | null = null;
    if (result.counts.total > 0) {
      diffId = this.createDiff(
        previous?.id ?? snapshot.id,
        snapshot.id,
        snapshot.scopeRootDepartmentId,
        run.taskId,
        result,
      );
    }
    this.patchRun(runId, {
      status: "success",
      phase: "done",
      finishedAt: nowIso(),
      diffId,
      errorCode: null,
      errorMessage: null,
      addedPeople: result.counts.peopleAdded,
      removedPeople: result.counts.peopleRemoved,
      changedPeople: result.counts.peopleChanged,
      addedDepartments: result.counts.departmentsAdded,
      removedDepartments: result.counts.departmentsRemoved,
      changedDepartments: result.counts.departmentsChanged,
    });
    this.event(runId, "info", `管理员确认隔离快照${diffId ? `，生成差异 #${diffId}` : "，未发现差异"}`);
    this.audit.record({
      actorId,
      actorName,
      action: "run.confirm",
      targetType: "sync_run",
      targetId: runId,
      detail: { diffId },
    });
    return this.runRow(runId);
  }

  cancel(runId: number, actorId: number, actorName: string): RunRow {
    const run = this.runRow(runId);
    if (run.status !== "running") throw badRequest("只能取消正在运行的巡查");
    this.patchRun(runId, { cancelRequested: true });
    this.event(runId, "warn", "收到取消请求，将在当前分页结束后停止");
    this.audit.record({
      actorId,
      actorName,
      action: "run.cancel",
      targetType: "sync_run",
      targetId: runId,
    });
    return this.runRow(runId);
  }

  getRun(runId: number) {
    const run = this.runRow(runId);
    const events = this.database.db
      .select()
      .from(syncRunEvents)
      .where(eq(syncRunEvents.runId, runId))
      .orderBy(syncRunEvents.id)
      .all();
    return { run, events };
  }

  listRuns(query: PageQuery & { status?: string; taskId?: number }) {
    const conditions = [];
    if (query.status) conditions.push(eq(syncRuns.status, query.status as RunRow["status"]));
    if (query.taskId) conditions.push(eq(syncRuns.taskId, query.taskId));
    const where = conditions.length ? and(...conditions) : undefined;
    const items = this.database.db
      .select()
      .from(syncRuns)
      .where(where)
      .orderBy(desc(syncRuns.id))
      .limit(query.pageSize)
      .offset((query.page - 1) * query.pageSize)
      .all();
    const total = this.database.db
      .select({ count: sql<number>`count(*)` })
      .from(syncRuns)
      .where(where)
      .get();
    return { items, total: Number(total?.count ?? 0) };
  }

  lastRun() {
    return this.database.db.select().from(syncRuns).orderBy(desc(syncRuns.id)).limit(1).get();
  }

  scheduleNext(taskId: number, cron: string, timezone: string): string | null {
    try {
      return nextRun(cron, timezone, new Date()).toISOString();
    } catch (error) {
      this.logger.warn(`任务 ${taskId} 的 cron 无法计算下次执行：${(error as Error).message}`);
      return null;
    }
  }
}
