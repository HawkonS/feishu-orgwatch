import { Inject, Injectable, type OnModuleInit } from "@nestjs/common";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { ConfigService } from "../config/config.service.js";
import { DatabaseService } from "../db/database.service.js";
import {
  changes as changesTable,
  diffs,
  informDeliveries,
  informs,
  snapshots,
  snapshotPeople,
  watchTasks,
  type DeliveryRow,
  type DiffRow,
} from "../db/schema.js";
import { ApiError, badRequest, notFound } from "../common/errors.js";
import { formatDateTime, nowIso, truncate } from "../common/text.js";
import { FeishuClient } from "../feishu/feishu.client.js";
import { buildDiffCard } from "../feishu/card.builder.js";
import { SettingsService } from "../settings/settings.service.js";
import { AuditService } from "../audit/audit.service.js";
import type { SessionUser } from "../auth/auth.service.js";
import type { DiffCounts } from "../sync/diff.engine.js";
import type { Change } from "../sync/diff.engine.js";

export type RecipientInput = {
  type: "user" | "chat";
  id: string;
  name?: string | null;
};

export type InformInput = {
  recipients: RecipientInput[];
  note?: string | null;
  changeIds?: number[];
};

@Injectable()
export class InformService implements OnModuleInit {
  constructor(
    @Inject(ConfigService) private readonly config: ConfigService,
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(SettingsService) private readonly settings: SettingsService,
    @Inject(FeishuClient) private readonly client: FeishuClient,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  private diffRow(diffId: number): DiffRow {
    const row = this.database.db.select().from(diffs).where(eq(diffs.id, diffId)).get();
    if (!row) throw notFound("差异不存在");
    return row;
  }

  private changesFor(diffId: number, changeIds?: number[]): Change[] {
    const rows = this.database.db
      .select()
      .from(changesTable)
      .where(
        changeIds && changeIds.length
          ? and(eq(changesTable.diffId, diffId), inArray(changesTable.id, changeIds))
          : eq(changesTable.diffId, diffId),
      )
      .orderBy(changesTable.id)
      .all();
    return rows.map((row) => ({
      entityType: row.entityType,
      changeKind: row.changeKind as Change["changeKind"],
      entityKey: row.entityKey,
      entityName: row.entityName,
      departmentPathBefore: row.departmentPathBefore,
      departmentPathAfter: row.departmentPathAfter,
      field: row.field,
      before: row.beforeJson ? JSON.parse(row.beforeJson) : null,
      after: row.afterJson ? JSON.parse(row.afterJson) : null,
      severity: row.severity,
    }));
  }

  private countsOf(diff: DiffRow): DiffCounts {
    return {
      total: diff.totalChanges,
      peopleAdded: diff.peopleAdded,
      peopleRemoved: diff.peopleRemoved,
      peopleChanged: diff.peopleChanged,
      departmentsAdded: diff.departmentsAdded,
      departmentsRemoved: diff.departmentsRemoved,
      departmentsChanged: diff.departmentsChanged,
    };
  }

  private buildCard(diff: DiffRow, changes: Change[], note?: string | null) {
    const task = diff.taskId
      ? this.database.db.select({ name: watchTasks.name }).from(watchTasks).where(eq(watchTasks.id, diff.taskId)).get()
      : undefined;
    return buildDiffCard({
      title: this.settings.get("card.title"),
      siteName: this.config.siteName,
      publicBaseUrl: this.config.publicBaseUrl,
      diffId: diff.id,
      counts: this.countsOf(diff),
      changes,
      note: note ?? null,
      maxItems: this.settings.getNumber("card.max-items", 8, 1, 20),
      timeText: formatDateTime(diff.createdAt, this.config.timezone),
      taskName: task?.name ?? null,
    });
  }

  private resolveRecipient(recipient: RecipientInput, latestSnapshotId: number | null) {
    const id = recipient.id.trim();
    if (!id) throw badRequest("收件人 ID 不能为空");
    if (recipient.type === "chat") {
      return {
        type: "chat" as const,
        id,
        name: recipient.name?.trim() || id,
        receiveIdType: "chat_id" as const,
      };
    }
    let name = recipient.name?.trim() || id;
    if (latestSnapshotId) {
      const row = this.database.db
        .select({ name: snapshotPeople.name })
        .from(snapshotPeople)
        .where(and(eq(snapshotPeople.snapshotId, latestSnapshotId), eq(snapshotPeople.openId, id)))
        .get();
      if (row?.name) name = row.name;
    }
    const isEmail = id.includes("@");
    return {
      type: "user" as const,
      id: isEmail ? id.toLowerCase() : id,
      name,
      receiveIdType: isEmail ? ("email" as const) : ("open_id" as const),
    };
  }

  private latestSnapshotId(scope: string): number | null {
    const row = this.database.db
      .select({ id: snapshots.id })
      .from(snapshots)
      .where(and(eq(snapshots.scopeRootDepartmentId, scope), eq(snapshots.status, "ok")))
      .orderBy(desc(snapshots.id))
      .limit(1)
      .get();
    return row?.id ?? null;
  }

  async inform(diffId: number, input: InformInput, actor: SessionUser) {
    const diff = this.diffRow(diffId);
    if (diff.status === "ignored") throw badRequest("该差异已忽略，不能发送通知");
    const recipients = input.recipients ?? [];
    if (!recipients.length) throw badRequest("请至少选择一个收件人");
    if (recipients.length > 200) throw badRequest("单次最多 200 个收件人");
    const changes = this.changesFor(diffId, input.changeIds);
    if (!changes.length) throw badRequest("该差异没有可通知的变更");

    const card = this.buildCard(diff, changes, input.note);
    const snapshotId = this.latestSnapshotId(diff.scopeRootDepartmentId);

    type Resolved = {
      type: "user" | "chat";
      id: string;
      name: string;
      receiveIdType: "open_id" | "chat_id" | "email";
    };
    const deduped = new Map<string, Resolved>();
    for (const recipient of recipients) {
      const resolved = this.resolveRecipient(recipient, snapshotId);
      deduped.set(`${resolved.type}:${resolved.id}`, resolved);
    }

    const informRow = this.database.db
      .insert(informs)
      .values({
        diffId,
        note: input.note?.slice(0, 500) ?? null,
        changeIdsJson: input.changeIds?.length ? JSON.stringify(input.changeIds) : null,
        createdBy: actor.id,
        createdAt: nowIso(),
      })
      .run();
    const informId = Number(informRow.lastInsertRowid);

    const deliveries: DeliveryRow[] = [];
    for (const recipient of deduped.values()) {
      const inserted = this.database.db
        .insert(informDeliveries)
        .values({
          informId,
          diffId,
          recipientType: recipient.type,
          recipientId: recipient.id,
          recipientName: recipient.name,
          channel: "feishu_card",
          status: "pending",
          createdAt: nowIso(),
        })
        .run();
      const row = this.database.db
        .select()
        .from(informDeliveries)
        .where(eq(informDeliveries.id, Number(inserted.lastInsertRowid)))
        .get();
      if (row) deliveries.push(row);
    }

    await this.sendAll(deliveries, card);

    this.recomputeStatus(diffId, actor.id);
    const sent = Number(
      this.database.db
        .select({ count: sql<number>`count(*)` })
        .from(informDeliveries)
        .where(
          and(
            eq(informDeliveries.informId, informId),
            eq(informDeliveries.status, "sent"),
          ),
        )
        .get()?.count ?? 0,
    );
    this.audit.record({
      actorId: actor.id,
      actorName: actor.displayName,
      action: "diff.inform",
      targetType: "diff",
      targetId: diffId,
      detail: { informId, recipients: deliveries.length, sent },
    });
    return this.informDetail(informId);
  }

  onModuleInit() {
    // Repair diffs that were notified before the send path started updating status.
    this.database.db
      .update(diffs)
      .set({ status: "notified", updatedAt: nowIso() })
      .where(
        and(
          eq(diffs.status, "new"),
          sql`EXISTS (SELECT 1 FROM inform_deliveries d WHERE d.diff_id = ${diffs.id} AND d.status = 'sent')`,
        ),
      )
      .run();
  }

  private async sendAll(deliveries: DeliveryRow[], card: Record<string, unknown>): Promise<void> {
    const queue = [...deliveries];
    const workers = Array.from({ length: Math.min(3, queue.length) }, async () => {
      for (;;) {
        const delivery = queue.shift();
        if (!delivery) return;
        await this.sendOne(delivery, card);
      }
    });
    await Promise.all(workers);
  }

  private sendOne(delivery: DeliveryRow, card: Record<string, unknown>): Promise<void> {
    const receiveIdType =
      delivery.recipientType === "chat"
        ? "chat_id"
        : delivery.recipientId.includes("@")
          ? "email"
          : "open_id";
    try {
      return this.client
        .sendCard(receiveIdType, delivery.recipientId, card)
        .then((messageId) => {
          this.database.db
            .update(informDeliveries)
            .set({ status: "sent", messageId, sentAt: nowIso(), errorCode: null, errorMessage: null })
            .where(eq(informDeliveries.id, delivery.id))
            .run();
        })
        .catch((error: unknown) => {
          const code = error instanceof ApiError ? error.code : "SEND_FAILED";
          const message = truncate(error instanceof Error ? error.message : String(error), 500);
          this.database.db
            .update(informDeliveries)
            .set({ status: "failed", errorCode: code, errorMessage: message })
            .where(eq(informDeliveries.id, delivery.id))
            .run();
        });
    } catch (error) {
      const code = error instanceof ApiError ? error.code : "SEND_FAILED";
      const message = truncate(error instanceof Error ? error.message : String(error), 500);
      this.database.db
        .update(informDeliveries)
        .set({ status: "failed", errorCode: code, errorMessage: message })
        .where(eq(informDeliveries.id, delivery.id))
        .run();
      return Promise.resolve();
    }
  }

  async retry(informId: number, deliveryIds: number[] | undefined, actor: SessionUser) {
    const inform = this.database.db.select().from(informs).where(eq(informs.id, informId)).get();
    if (!inform) throw notFound("通知批次不存在");
    const diff = this.diffRow(inform.diffId);
    const rows = this.database.db
      .select()
      .from(informDeliveries)
      .where(
        deliveryIds && deliveryIds.length
          ? and(eq(informDeliveries.informId, informId), inArray(informDeliveries.id, deliveryIds))
          : eq(informDeliveries.informId, informId),
      )
      .all()
      .filter((row) => row.status !== "sent");
    if (!rows.length) return { retried: 0 };
    const changeIds = inform.changeIdsJson ? (JSON.parse(inform.changeIdsJson) as number[]) : undefined;
    const card = this.buildCard(diff, this.changesFor(diff.id, changeIds), inform.note);
    await this.sendAll(rows, card);
    this.recomputeStatus(diff.id, actor.id);
    this.audit.record({
      actorId: actor.id,
      actorName: actor.displayName,
      action: "diff.inform_retry",
      targetType: "diff",
      targetId: diff.id,
      detail: { informId, count: rows.length },
    });
    return { retried: rows.length, items: rows.map((row) => row.id) };
  }

  informDetail(informId: number) {
    const inform = this.database.db.select().from(informs).where(eq(informs.id, informId)).get();
    if (!inform) throw notFound("通知批次不存在");
    const deliveries = this.database.db
      .select()
      .from(informDeliveries)
      .where(eq(informDeliveries.informId, informId))
      .orderBy(informDeliveries.id)
      .all();
    return { inform, deliveries };
  }

  listInforms(diffId: number) {
    this.diffRow(diffId);
    const rows = this.database.db
      .select()
      .from(informs)
      .where(eq(informs.diffId, diffId))
      .orderBy(desc(informs.id))
      .all();
    return {
      items: rows.map((inform) => ({
        ...inform,
        deliveries: this.database.db
          .select()
          .from(informDeliveries)
          .where(eq(informDeliveries.informId, inform.id))
          .orderBy(informDeliveries.id)
          .all(),
      })),
    };
  }

  ackSelf(diffId: number, user: SessionUser) {
    this.diffRow(diffId);
    const deliveries = this.database.db
      .select()
      .from(informDeliveries)
      .where(and(eq(informDeliveries.diffId, diffId), eq(informDeliveries.recipientType, "user")))
      .all();
    const matched = deliveries.filter((delivery) => {
      if (delivery.acknowledgedAt) return false;
      if (user.feishuOpenId && delivery.recipientId === user.feishuOpenId) return true;
      if (user.email && delivery.recipientId.toLowerCase() === user.email.toLowerCase()) return true;
      return delivery.recipientId === user.username;
    });
    if (!matched.length) {
      throw notFound("没有找到与当前账号匹配的待确认知情记录");
    }
    const at = nowIso();
    for (const delivery of matched) {
      this.database.db
        .update(informDeliveries)
        .set({ acknowledgedAt: at, acknowledgedBy: user.id, acknowledgedVia: "self" })
        .where(eq(informDeliveries.id, delivery.id))
        .run();
    }
    this.recomputeStatus(diffId, user.id);
    this.audit.record({
      actorId: user.id,
      actorName: user.displayName,
      action: "diff.ack_self",
      targetType: "diff",
      targetId: diffId,
      detail: { count: matched.length },
    });
    return { acknowledged: matched.length };
  }

  ackDelivery(deliveryId: number, actor: SessionUser) {
    const delivery = this.database.db
      .select()
      .from(informDeliveries)
      .where(eq(informDeliveries.id, deliveryId))
      .get();
    if (!delivery) throw notFound("知情记录不存在");
    this.database.db
      .update(informDeliveries)
      .set({
        acknowledgedAt: nowIso(),
        acknowledgedBy: actor.id,
        acknowledgedVia: "operator",
      })
      .where(eq(informDeliveries.id, deliveryId))
      .run();
    this.recomputeStatus(delivery.diffId, actor.id);
    this.audit.record({
      actorId: actor.id,
      actorName: actor.displayName,
      action: "diff.ack_operator",
      targetType: "inform_delivery",
      targetId: deliveryId,
    });
    return { ok: true };
  }

  resolve(diffId: number, status: "acknowledged" | "ignored", reason: string | null, actor: SessionUser) {
    const diff = this.diffRow(diffId);
    if (status === "ignored" && !reason?.trim()) {
      throw badRequest("忽略差异必须填写理由");
    }
    this.database.db
      .update(diffs)
      .set({
        status,
        ignoredReason: status === "ignored" ? reason?.trim().slice(0, 500) ?? null : diff.ignoredReason,
        resolvedBy: actor.id,
        resolvedAt: nowIso(),
        updatedAt: nowIso(),
      })
      .where(eq(diffs.id, diffId))
      .run();
    this.audit.record({
      actorId: actor.id,
      actorName: actor.displayName,
      action: status === "ignored" ? "diff.ignore" : "diff.resolve",
      targetType: "diff",
      targetId: diffId,
      detail: { reason: reason ?? null },
    });
    return { ok: true };
  }

  recomputeStatus(diffId: number, actorId: number): void {
    const diff = this.diffRow(diffId);
    if (diff.status === "ignored") return;
    const deliveries = this.database.db
      .select()
      .from(informDeliveries)
      .where(and(eq(informDeliveries.diffId, diffId), eq(informDeliveries.recipientType, "user")))
      .all();
    const hasSent = this.database.db
      .select({ count: sql<number>`count(*)` })
      .from(informDeliveries)
      .where(and(eq(informDeliveries.diffId, diffId), eq(informDeliveries.status, "sent")))
      .get();
    const sent = Number(hasSent?.count ?? 0);
    if (deliveries.length > 0 && deliveries.every((delivery) => delivery.acknowledgedAt)) {
      this.database.db
        .update(diffs)
        .set({ status: "acknowledged", resolvedBy: actorId, resolvedAt: nowIso(), updatedAt: nowIso() })
        .where(eq(diffs.id, diffId))
        .run();
      return;
    }
    if (sent > 0 && diff.status === "new") {
      this.database.db
        .update(diffs)
        .set({ status: "notified", updatedAt: nowIso() })
        .where(eq(diffs.id, diffId))
        .run();
    }
  }
}
