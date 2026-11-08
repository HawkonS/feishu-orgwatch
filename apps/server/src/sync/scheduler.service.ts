import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { and, eq, isNull, lt, lte, or } from "drizzle-orm";
import { DatabaseService } from "../db/database.service.js";
import { watchTasks, type TaskRow } from "../db/schema.js";
import { nowIso } from "../common/text.js";
import { SyncService } from "./sync.service.js";

const TICK_MS = 30_000;
const LOCK_MS = 15 * 60 * 1000;

@Injectable()
export class SchedulerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SchedulerService.name);
  private timer: NodeJS.Timeout | null = null;
  private ticking = false;
  lastTickAt: string | null = null;

  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(SyncService) private readonly sync: SyncService,
  ) {}

  onModuleInit(): void {
    this.recover();
    this.timer = setInterval(() => void this.tick(), TICK_MS);
    this.timer.unref?.();
    void this.tick();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private recover(): void {
    const now = nowIso();
    for (const task of this.database.db.select().from(watchTasks).all()) {
      if (task.lockedUntil && task.lockedUntil < now) {
        this.database.db.update(watchTasks).set({ lockedUntil: null }).where(eq(watchTasks.id, task.id)).run();
      }
      if (!task.nextRunAt) {
        const next = this.sync.scheduleNext(task.id, task.cron, task.timezone);
        this.database.db.update(watchTasks).set({ nextRunAt: next }).where(eq(watchTasks.id, task.id)).run();
      }
    }
  }

  async tick(): Promise<void> {
    if (this.ticking) return;
    this.ticking = true;
    try {
      const now = nowIso();
      const due = this.database.db
        .select()
        .from(watchTasks)
        .where(
          and(
            eq(watchTasks.enabled, true),
            lte(watchTasks.nextRunAt, now),
            or(isNull(watchTasks.lockedUntil), lt(watchTasks.lockedUntil, now)),
          ),
        )
        .all();
      for (const task of due) {
        if (this.sync.isBusy()) {
          this.logger.warn(`任务 ${task.id} 到期，但已有巡查在执行，本轮跳过`);
          continue;
        }
        const claimed = this.database.db
          .update(watchTasks)
          .set({ lockedUntil: new Date(Date.now() + LOCK_MS).toISOString() })
          .where(
            and(
              eq(watchTasks.id, task.id),
              or(isNull(watchTasks.lockedUntil), lt(watchTasks.lockedUntil, now)),
            ),
          )
          .run();
        if (Number(claimed.changes) !== 1) continue;
        void this.execute(task);
      }
    } catch (error) {
      this.logger.error(`调度器 tick 失败：${(error as Error).message}`);
    } finally {
      this.ticking = false;
      this.lastTickAt = nowIso();
    }
  }

  private async execute(task: TaskRow): Promise<void> {
    const overdue = task.nextRunAt ? Date.now() - Date.parse(task.nextRunAt) > 5 * 60 * 1000 : false;
    try {
      await this.sync.startRun({
        taskId: task.id,
        rootDepartmentId: task.rootDepartmentId,
        trigger: overdue ? "catchup" : "schedule",
        requestedBy: null,
      });
    } catch (error) {
      this.logger.error(`任务 ${task.id} 执行失败：${(error as Error).message}`);
    } finally {
      const next = this.sync.scheduleNext(task.id, task.cron, task.timezone);
      this.database.db
        .update(watchTasks)
        .set({ lastRunAt: nowIso(), nextRunAt: next, lockedUntil: null })
        .where(eq(watchTasks.id, task.id))
        .run();
    }
  }
}
