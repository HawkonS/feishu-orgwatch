import { Inject, Injectable } from "@nestjs/common";
import { and, desc, eq, gte, lte, sql } from "drizzle-orm";
import { DatabaseService } from "../db/database.service.js";
import { auditLogs } from "../db/schema.js";
import { nowIso } from "../common/text.js";
import type { PageQuery } from "../common/validation.js";

export type AuditInput = {
  actorId?: number | null;
  actorName?: string | null;
  action: string;
  targetType?: string | null;
  targetId?: string | number | null;
  detail?: unknown;
  ip?: string | null;
  userAgent?: string | null;
};

@Injectable()
export class AuditService {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  record(input: AuditInput): void {
    this.database.db
      .insert(auditLogs)
      .values({
        actorId: input.actorId ?? null,
        actorName: input.actorName ?? null,
        action: input.action,
        targetType: input.targetType ?? null,
        targetId: input.targetId === undefined || input.targetId === null ? null : String(input.targetId),
        detailJson: input.detail === undefined ? null : JSON.stringify(input.detail),
        ip: input.ip ?? null,
        userAgent: input.userAgent ?? null,
        createdAt: nowIso(),
      })
      .run();
  }

  list(query: PageQuery & { action?: string; actor?: string; from?: string; to?: string }) {
    const conditions = [];
    if (query.action) conditions.push(eq(auditLogs.action, query.action));
    if (query.actor) conditions.push(eq(auditLogs.actorName, query.actor));
    if (query.from) conditions.push(gte(auditLogs.createdAt, query.from));
    if (query.to) conditions.push(lte(auditLogs.createdAt, query.to));
    const where = conditions.length ? and(...conditions) : undefined;
    const items = this.database.db
      .select()
      .from(auditLogs)
      .where(where)
      .orderBy(desc(auditLogs.id))
      .limit(query.pageSize)
      .offset((query.page - 1) * query.pageSize)
      .all();
    const total = this.database.db
      .select({ count: sql<number>`count(*)` })
      .from(auditLogs)
      .where(where)
      .get();
    return { items, total: Number(total?.count ?? 0) };
  }
}
