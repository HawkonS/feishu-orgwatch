import { Inject, Injectable } from "@nestjs/common";
import { and, asc, desc, eq, gte, like, lte, or, sql } from "drizzle-orm";
import { DatabaseService } from "../db/database.service.js";
import {
  changes as changesTable,
  diffs,
  informDeliveries,
  snapshots,
  syncRuns,
  watchTasks,
  type DiffRow,
} from "../db/schema.js";
import { notFound } from "../common/errors.js";
import { CHANGE_LABELS, describeChange, statusLabel, type Change, type ChangeKind } from "../sync/diff.engine.js";
import { csvCell, truncate } from "../common/text.js";
import type { PageQuery } from "../common/validation.js";

@Injectable()
export class DiffService {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  diffRow(diffId: number): DiffRow {
    const row = this.database.db.select().from(diffs).where(eq(diffs.id, diffId)).get();
    if (!row) throw notFound("差异不存在");
    return row;
  }

  list(
    query: PageQuery & {
      from?: string;
      to?: string;
      status?: string;
      severity?: string;
      taskId?: number;
      entityType?: "person" | "department";
      changeKind?: string;
      departmentId?: string;
      q?: string;
    },
  ) {
    const conditions = [];
    if (query.from) conditions.push(gte(diffs.createdAt, query.from));
    if (query.to) conditions.push(lte(diffs.createdAt, query.to));
    if (query.status) conditions.push(eq(diffs.status, query.status as DiffRow["status"]));
    if (query.severity) conditions.push(eq(diffs.severity, query.severity as DiffRow["severity"]));
    if (query.taskId) conditions.push(eq(diffs.taskId, query.taskId));
    if (query.entityType) {
      conditions.push(
        sql`exists (select 1 from changes c where c.diff_id = ${diffs.id} and c.entity_type = ${query.entityType})`,
      );
    }
    if (query.changeKind) {
      conditions.push(
        sql`exists (select 1 from changes c where c.diff_id = ${diffs.id} and c.change_kind = ${query.changeKind})`,
      );
    }
    if (query.departmentId) {
      const term = `%${query.departmentId}%`;
      conditions.push(
        sql`exists (select 1 from changes c where c.diff_id = ${diffs.id} and (c.department_path_after like ${term} or c.department_path_before like ${term}))`,
      );
    }
    if (query.q) {
      const term = `%${query.q.trim()}%`;
      conditions.push(
        sql`exists (select 1 from changes c where c.diff_id = ${diffs.id} and (c.entity_name like ${term} or c.department_path_after like ${term}))`,
      );
    }
    const where = conditions.length ? and(...conditions) : undefined;
    const items = this.database.db
      .select()
      .from(diffs)
      .where(where)
      .orderBy(desc(diffs.id))
      .limit(query.pageSize)
      .offset((query.page - 1) * query.pageSize)
      .all();
    const total = this.database.db
      .select({ count: sql<number>`count(*)` })
      .from(diffs)
      .where(where)
      .get();
    const statusRows = this.database.db
      .select({ status: diffs.status, count: sql<number>`count(*)` })
      .from(diffs)
      .groupBy(diffs.status)
      .all();
    const statusCounts = { new: 0, notified: 0, acknowledged: 0, ignored: 0 };
    for (const row of statusRows) statusCounts[row.status] = Number(row.count);
    return {
      items: items.map((item) => this.decorate(item)),
      total: Number(total?.count ?? 0),
      stats: statusCounts,
    };
  }

  private decorate(diff: DiffRow) {
    let summary: unknown = {};
    try {
      summary = JSON.parse(diff.summaryJson);
    } catch {
      summary = {};
    }
    return { ...diff, summary };
  }

  detail(diffId: number) {
    const diff = this.diffRow(diffId);
    const task = diff.taskId
      ? this.database.db.select({ id: watchTasks.id, name: watchTasks.name }).from(watchTasks).where(eq(watchTasks.id, diff.taskId)).get()
      : null;
    const fromSnapshot = diff.fromSnapshotId
      ? this.database.db.select().from(snapshots).where(eq(snapshots.id, diff.fromSnapshotId)).get()
      : null;
    const toSnapshot = this.database.db.select().from(snapshots).where(eq(snapshots.id, diff.toSnapshotId)).get();
    const deliveryRows = this.database.db
      .select({ status: informDeliveries.status, count: sql<number>`count(*)` })
      .from(informDeliveries)
      .where(eq(informDeliveries.diffId, diffId))
      .groupBy(informDeliveries.status)
      .all();
    const ackRow = this.database.db
      .select({ count: sql<number>`count(*)` })
      .from(informDeliveries)
      .where(and(eq(informDeliveries.diffId, diffId), sql`${informDeliveries.acknowledgedAt} is not null`))
      .get();
    const deliveries: Record<string, number> = { pending: 0, sent: 0, failed: 0 };
    for (const row of deliveryRows) deliveries[row.status] = Number(row.count);
    return {
      ...this.decorate(diff),
      task,
      fromSnapshot,
      toSnapshot,
      deliveryStats: {
        ...deliveries,
        acknowledged: Number(ackRow?.count ?? 0),
      },
    };
  }

  changes(
    diffId: number,
    query: PageQuery & {
      entityType?: "person" | "department";
      changeKind?: string;
      severity?: string;
      q?: string;
    },
  ) {
    this.diffRow(diffId);
    const conditions = [eq(changesTable.diffId, diffId)];
    if (query.entityType) conditions.push(eq(changesTable.entityType, query.entityType));
    if (query.changeKind) conditions.push(eq(changesTable.changeKind, query.changeKind));
    if (query.severity) conditions.push(eq(changesTable.severity, query.severity as DiffRow["severity"]));
    if (query.q) {
      const term = `%${query.q.trim()}%`;
      conditions.push(
        or(
          like(changesTable.entityName, term),
          like(changesTable.departmentPathAfter, term),
          like(changesTable.departmentPathBefore, term),
        )!,
      );
    }
    const where = and(...conditions);
    const items = this.database.db
      .select()
      .from(changesTable)
      .where(where)
      .orderBy(asc(changesTable.id))
      .limit(query.pageSize)
      .offset((query.page - 1) * query.pageSize)
      .all()
      .map((row) => ({
        ...row,
        before: row.beforeJson ? safeParse(row.beforeJson) : null,
        after: row.afterJson ? safeParse(row.afterJson) : null,
      }));
    const total = this.database.db
      .select({ count: sql<number>`count(*)` })
      .from(changesTable)
      .where(where)
      .get();
    return { items, total: Number(total?.count ?? 0) };
  }

  overview() {
    const snapshot = this.database.db
      .select()
      .from(snapshots)
      .where(eq(snapshots.status, "ok"))
      .orderBy(desc(snapshots.id))
      .limit(1)
      .get();
    const pending = this.database.db
      .select({ status: diffs.status, count: sql<number>`count(*)` })
      .from(diffs)
      .where(sql`${diffs.status} in ('new', 'notified')`)
      .groupBy(diffs.status)
      .all();
    const pendingCount = pending.reduce((sum, row) => sum + Number(row.count), 0);
    const diffStatusRows = this.database.db
      .select({ status: diffs.status, count: sql<number>`count(*)` })
      .from(diffs)
      .groupBy(diffs.status)
      .all();
    const diffStats = { new: 0, notified: 0, acknowledged: 0, ignored: 0 };
    for (const row of diffStatusRows) diffStats[row.status] = Number(row.count);
    const taskRows = this.database.db.select().from(watchTasks).all();
    const lastRun = this.database.db.select().from(syncRuns).orderBy(desc(syncRuns.id)).limit(1).get();
    const recentDiffs = this.database.db
      .select()
      .from(diffs)
      .orderBy(desc(diffs.id))
      .limit(5)
      .all()
      .map((item) => this.decorate(item));
    const recentRuns = this.database.db
      .select()
      .from(syncRuns)
      .orderBy(desc(syncRuns.id))
      .limit(5)
      .all();
    const recentChangeRows = this.database.db
      .select({
        id: changesTable.id,
        diffId: changesTable.diffId,
        entityType: changesTable.entityType,
        changeKind: changesTable.changeKind,
        entityKey: changesTable.entityKey,
        entityName: changesTable.entityName,
        departmentPathBefore: changesTable.departmentPathBefore,
        departmentPathAfter: changesTable.departmentPathAfter,
        field: changesTable.field,
        beforeJson: changesTable.beforeJson,
        afterJson: changesTable.afterJson,
        severity: changesTable.severity,
        createdAt: changesTable.createdAt,
        diffStatus: diffs.status,
      })
      .from(changesTable)
      .innerJoin(diffs, eq(changesTable.diffId, diffs.id))
      .orderBy(desc(changesTable.id))
      .limit(8)
      .all();
    const parseJson = (value: string | null): unknown => {
      if (!value) return null;
      try {
        return JSON.parse(value);
      } catch {
        return null;
      }
    };
    const recentChanges = recentChangeRows.map((row) => ({
      id: row.id,
      diffId: row.diffId,
      diffStatus: row.diffStatus,
      entityType: row.entityType,
      changeKind: row.changeKind,
      entityName: row.entityName,
      severity: row.severity,
      createdAt: row.createdAt,
      description: describeChange({
        entityType: row.entityType,
        changeKind: row.changeKind as ChangeKind,
        entityKey: row.entityKey,
        entityName: row.entityName,
        departmentPathBefore: row.departmentPathBefore,
        departmentPathAfter: row.departmentPathAfter,
        field: row.field,
        before: parseJson(row.beforeJson),
        after: parseJson(row.afterJson),
        severity: row.severity,
      } as Change),
    }));
    const since = new Date(Date.now() - 13 * 24 * 60 * 60 * 1000).toISOString();
    const trendRows = this.database.db
      .select({
        day: sql<string>`substr(${diffs.createdAt}, 1, 10)`,
        diffCount: sql<number>`count(*)`,
        peopleAdded: sql<number>`coalesce(sum(${diffs.peopleAdded}), 0)`,
        peopleRemoved: sql<number>`coalesce(sum(${diffs.peopleRemoved}), 0)`,
        peopleChanged: sql<number>`coalesce(sum(${diffs.peopleChanged}), 0)`,
      })
      .from(diffs)
      .where(gte(diffs.createdAt, since))
      .groupBy(sql`substr(${diffs.createdAt}, 1, 10)`)
      .all();
    const trendMap = new Map(trendRows.map((row) => [row.day, row]));
    const trend: Array<{
      day: string;
      diffCount: number;
      peopleAdded: number;
      peopleRemoved: number;
      peopleChanged: number;
    }> = [];
    for (let offset = 13; offset >= 0; offset -= 1) {
      const date = new Date(Date.now() - offset * 24 * 60 * 60 * 1000);
      const day = date.toISOString().slice(0, 10);
      const row = trendMap.get(day);
      trend.push({
        day,
        diffCount: Number(row?.diffCount ?? 0),
        peopleAdded: Number(row?.peopleAdded ?? 0),
        peopleRemoved: Number(row?.peopleRemoved ?? 0),
        peopleChanged: Number(row?.peopleChanged ?? 0),
      });
    }
    return {
      snapshot: snapshot ?? null,
      pendingCount,
      diffStats,
      tasks: {
        total: taskRows.length,
        enabled: taskRows.filter((task) => task.enabled).length,
        nextRunAt:
          taskRows
            .map((task) => task.nextRunAt)
            .filter((value): value is string => Boolean(value))
            .sort()[0] ?? null,
      },
      lastRun: lastRun ?? null,
      recentDiffs,
      recentRuns,
      recentChanges,
      trend,
    };
  }

  exportCsv(diffId: number): string {
    const diff = this.diffRow(diffId);
    const rows = this.database.db
      .select()
      .from(changesTable)
      .where(eq(changesTable.diffId, diffId))
      .orderBy(asc(changesTable.id))
      .all();
    const header = ["类型", "变更", "对象", "部门路径（变更前）", "部门路径（变更后）", "级别", "变更前", "变更后"];
    const lines = [header.map(csvCell).join(",")];
    for (const row of rows) {
      lines.push(
        [
          row.entityType === "person" ? "人员" : "部门",
          CHANGE_LABELS[row.changeKind as ChangeKind] ?? row.changeKind,
          row.entityName,
          row.departmentPathBefore ?? "",
          row.departmentPathAfter ?? "",
          row.severity,
          truncate(row.beforeJson ?? "", 800),
          truncate(row.afterJson ?? "", 800),
        ]
          .map(csvCell)
          .join(","),
      );
    }
    const meta = [
      `# 差异 #${diff.id}`,
      `# 生成时间：${diff.createdAt}`,
      `# 状态：${diff.status}（忽略原因：${diff.ignoredReason ?? "-"}）`,
      `# 变动：人员 +${diff.peopleAdded} -${diff.peopleRemoved} 调整 ${diff.peopleChanged}；部门 +${diff.departmentsAdded} -${diff.departmentsRemoved} 调整 ${diff.departmentsChanged}`,
      `# 状态说明：${statusLabel(diff.status)}`,
    ];
    return `${meta.join("\n")}\n${lines.join("\n")}\n`;
  }
}

function safeParse(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}
