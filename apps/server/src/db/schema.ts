import { sql } from "drizzle-orm";
import {
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

const now = sql`(strftime('%Y-%m-%dT%H:%M:%fZ','now'))`;

const timestamps = {
  createdAt: text("created_at").notNull().default(now),
  updatedAt: text("updated_at").notNull().default(now),
};

export const users = sqliteTable(
  "users",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    username: text("username").notNull(),
    displayName: text("display_name").notNull(),
    email: text("email"),
    passwordHash: text("password_hash"),
    role: text("role", { enum: ["admin", "operator", "viewer"] }).notNull().default("viewer"),
    feishuOpenId: text("feishu_open_id"),
    feishuUnionId: text("feishu_union_id"),
    feishuUserId: text("feishu_user_id"),
    avatarUrl: text("avatar_url"),
    status: text("status", { enum: ["active", "disabled"] }).notNull().default("active"),
    source: text("source").notNull().default("local"),
    lastLoginAt: text("last_login_at"),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("idx_users_username").on(table.username),
    uniqueIndex("idx_users_open_id").on(table.feishuOpenId),
    uniqueIndex("idx_users_union_id").on(table.feishuUnionId),
  ],
);

export const sessions = sqliteTable(
  "sessions",
  {
    id: text("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    expiresAt: text("expires_at").notNull(),
    ip: text("ip"),
    userAgent: text("user_agent"),
    lastSeenAt: text("last_seen_at"),
    createdAt: text("created_at").notNull().default(now),
  },
  (table) => [index("idx_sessions_user").on(table.userId), index("idx_sessions_expiry").on(table.expiresAt)],
);

export const loginAttempts = sqliteTable(
  "login_attempts",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    username: text("username").notNull(),
    ip: text("ip"),
    success: integer("success", { mode: "boolean" }).notNull().default(false),
    createdAt: text("created_at").notNull().default(now),
  },
  (table) => [index("idx_login_attempts_lookup").on(table.username, table.ip, table.createdAt)],
);

export const appSettings = sqliteTable("app_settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  isSecret: integer("is_secret", { mode: "boolean" }).notNull().default(false),
  updatedAt: text("updated_at").notNull().default(now),
});

export const watchTasks = sqliteTable(
  "watch_tasks",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    name: text("name").notNull(),
    description: text("description"),
    cron: text("cron").notNull(),
    timezone: text("timezone").notNull().default("Asia/Shanghai"),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
    rootDepartmentId: text("root_department_id").notNull().default("0"),
    retentionRuns: integer("retention_runs").notNull().default(60),
    createdBy: integer("created_by"),
    lastRunAt: text("last_run_at"),
    nextRunAt: text("next_run_at"),
    lockedUntil: text("locked_until"),
    ...timestamps,
  },
  (table) => [index("idx_tasks_due").on(table.enabled, table.nextRunAt)],
);

export const syncRuns = sqliteTable(
  "sync_runs",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    taskId: integer("task_id"),
    trigger: text("trigger", { enum: ["schedule", "manual", "catchup", "bootstrap"] }).notNull(),
    status: text("status", {
      enum: ["running", "success", "failed", "needs_review", "cancelled", "skipped"],
    })
      .notNull()
      .default("running"),
    phase: text("phase").notNull().default("token"),
    startedAt: text("started_at").notNull(),
    finishedAt: text("finished_at"),
    departmentCount: integer("department_count").notNull().default(0),
    peopleCount: integer("people_count").notNull().default(0),
    addedPeople: integer("added_people").notNull().default(0),
    removedPeople: integer("removed_people").notNull().default(0),
    changedPeople: integer("changed_people").notNull().default(0),
    addedDepartments: integer("added_departments").notNull().default(0),
    removedDepartments: integer("removed_departments").notNull().default(0),
    changedDepartments: integer("changed_departments").notNull().default(0),
    snapshotId: integer("snapshot_id"),
    diffId: integer("diff_id"),
    errorCode: text("error_code"),
    errorMessage: text("error_message"),
    cancelRequested: integer("cancel_requested", { mode: "boolean" }).notNull().default(false),
    requestedBy: integer("requested_by"),
  },
  (table) => [index("idx_runs_status").on(table.status, table.startedAt), index("idx_runs_task").on(table.taskId, table.startedAt)],
);

export const syncRunEvents = sqliteTable(
  "sync_run_events",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    runId: integer("run_id")
      .notNull()
      .references(() => syncRuns.id, { onDelete: "cascade" }),
    at: text("at").notNull(),
    level: text("level", { enum: ["info", "warn", "error"] }).notNull().default("info"),
    message: text("message").notNull(),
    detailJson: text("detail_json"),
  },
  (table) => [index("idx_run_events_run").on(table.runId, table.at)],
);

export const snapshots = sqliteTable(
  "snapshots",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    scopeRootDepartmentId: text("scope_root_department_id").notNull(),
    runId: integer("run_id"),
    fetchedAt: text("fetched_at").notNull(),
    contentHash: text("content_hash").notNull(),
    departmentCount: integer("department_count").notNull().default(0),
    peopleCount: integer("people_count").notNull().default(0),
    status: text("status", { enum: ["ok", "quarantined"] }).notNull().default("ok"),
    createdAt: text("created_at").notNull().default(now),
  },
  (table) => [index("idx_snapshots_scope").on(table.scopeRootDepartmentId, table.status, table.id)],
);

export const snapshotDepartments = sqliteTable(
  "snapshot_departments",
  {
    snapshotId: integer("snapshot_id")
      .notNull()
      .references(() => snapshots.id, { onDelete: "cascade" }),
    openDepartmentId: text("open_department_id").notNull(),
    parentOpenDepartmentId: text("parent_open_department_id").notNull().default("0"),
    name: text("name").notNull(),
    leaderOpenId: text("leader_open_id"),
    leaderOpenIds: text("leader_open_ids"),
    order: integer("order").notNull().default(0),
    status: text("status").notNull().default("active"),
    depth: integer("depth").notNull().default(0),
    pathNames: text("path_names").notNull().default(""),
  },
  (table) => [
    primaryKey({ columns: [table.snapshotId, table.openDepartmentId] }),
    index("idx_snapshot_departments_parent").on(table.snapshotId, table.parentOpenDepartmentId),
  ],
);

export const snapshotPeople = sqliteTable(
  "snapshot_people",
  {
    snapshotId: integer("snapshot_id")
      .notNull()
      .references(() => snapshots.id, { onDelete: "cascade" }),
    openId: text("open_id").notNull(),
    unionId: text("union_id"),
    userId: text("user_id"),
    name: text("name").notNull(),
    email: text("email"),
    enterpriseEmail: text("enterprise_email"),
    jobTitle: text("job_title"),
    employeeNo: text("employee_no"),
    status: text("status").notNull().default("active"),
    isResigned: integer("is_resigned", { mode: "boolean" }).notNull().default(false),
    isFrozen: integer("is_frozen", { mode: "boolean" }).notNull().default(false),
    avatarUrl: text("avatar_url"),
  },
  (table) => [
    primaryKey({ columns: [table.snapshotId, table.openId] }),
    index("idx_snapshot_people_email").on(table.snapshotId, table.email),
  ],
);

export const snapshotMemberships = sqliteTable(
  "snapshot_memberships",
  {
    snapshotId: integer("snapshot_id")
      .notNull()
      .references(() => snapshots.id, { onDelete: "cascade" }),
    openId: text("open_id").notNull(),
    openDepartmentId: text("open_department_id").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.snapshotId, table.openId, table.openDepartmentId] }),
    index("idx_memberships_department").on(table.snapshotId, table.openDepartmentId),
  ],
);

export const diffs = sqliteTable(
  "diffs",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    taskId: integer("task_id"),
    fromSnapshotId: integer("from_snapshot_id"),
    toSnapshotId: integer("to_snapshot_id").notNull(),
    scopeRootDepartmentId: text("scope_root_department_id").notNull(),
    status: text("status", { enum: ["new", "notified", "acknowledged", "ignored"] })
      .notNull()
      .default("new"),
    severity: text("severity", { enum: ["high", "medium", "low", "info"] })
      .notNull()
      .default("info"),
    totalChanges: integer("total_changes").notNull().default(0),
    peopleAdded: integer("people_added").notNull().default(0),
    peopleRemoved: integer("people_removed").notNull().default(0),
    peopleChanged: integer("people_changed").notNull().default(0),
    departmentsAdded: integer("departments_added").notNull().default(0),
    departmentsRemoved: integer("departments_removed").notNull().default(0),
    departmentsChanged: integer("departments_changed").notNull().default(0),
    summaryJson: text("summary_json").notNull().default("{}"),
    ignoredReason: text("ignored_reason"),
    resolvedBy: integer("resolved_by"),
    resolvedAt: text("resolved_at"),
    ...timestamps,
  },
  (table) => [
    index("idx_diffs_created").on(table.createdAt),
    index("idx_diffs_status").on(table.status, table.createdAt),
    index("idx_diffs_scope").on(table.scopeRootDepartmentId, table.toSnapshotId),
  ],
);

export const changes = sqliteTable(
  "changes",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    diffId: integer("diff_id")
      .notNull()
      .references(() => diffs.id, { onDelete: "cascade" }),
    entityType: text("entity_type", { enum: ["department", "person"] }).notNull(),
    changeKind: text("change_kind").notNull(),
    entityKey: text("entity_key").notNull(),
    entityName: text("entity_name").notNull(),
    departmentPathBefore: text("department_path_before"),
    departmentPathAfter: text("department_path_after"),
    field: text("field"),
    beforeJson: text("before_json"),
    afterJson: text("after_json"),
    severity: text("severity", { enum: ["high", "medium", "low", "info"] }).notNull(),
    createdAt: text("created_at").notNull().default(now),
  },
  (table) => [
    index("idx_changes_diff").on(table.diffId, table.entityType, table.changeKind),
    index("idx_changes_entity").on(table.diffId, table.entityKey),
  ],
);

export const informs = sqliteTable(
  "informs",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    diffId: integer("diff_id")
      .notNull()
      .references(() => diffs.id, { onDelete: "cascade" }),
    note: text("note"),
    changeIdsJson: text("change_ids_json"),
    createdBy: integer("created_by"),
    createdAt: text("created_at").notNull().default(now),
  },
  (table) => [index("idx_informs_diff").on(table.diffId, table.createdAt)],
);

export const informDeliveries = sqliteTable(
  "inform_deliveries",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    informId: integer("inform_id")
      .notNull()
      .references(() => informs.id, { onDelete: "cascade" }),
    diffId: integer("diff_id").notNull(),
    recipientType: text("recipient_type", { enum: ["user", "chat"] }).notNull(),
    recipientId: text("recipient_id").notNull(),
    recipientName: text("recipient_name").notNull(),
    channel: text("channel").notNull().default("feishu_card"),
    status: text("status", { enum: ["pending", "sent", "failed"] }).notNull().default("pending"),
    messageId: text("message_id"),
    errorCode: text("error_code"),
    errorMessage: text("error_message"),
    sentAt: text("sent_at"),
    acknowledgedAt: text("acknowledged_at"),
    acknowledgedBy: integer("acknowledged_by"),
    acknowledgedVia: text("acknowledged_via", { enum: ["self", "operator", "card"] }),
    createdAt: text("created_at").notNull().default(now),
  },
  (table) => [
    index("idx_deliveries_inform").on(table.informId),
    index("idx_deliveries_diff").on(table.diffId, table.recipientType, table.recipientId),
  ],
);

export const auditLogs = sqliteTable(
  "audit_logs",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    actorId: integer("actor_id"),
    actorName: text("actor_name"),
    action: text("action").notNull(),
    targetType: text("target_type"),
    targetId: text("target_id"),
    detailJson: text("detail_json"),
    ip: text("ip"),
    userAgent: text("user_agent"),
    createdAt: text("created_at").notNull().default(now),
  },
  (table) => [index("idx_audit_created").on(table.createdAt), index("idx_audit_action").on(table.action, table.createdAt)],
);

export type UserRow = typeof users.$inferSelect;
export type TaskRow = typeof watchTasks.$inferSelect;
export type RunRow = typeof syncRuns.$inferSelect;
export type SnapshotRow = typeof snapshots.$inferSelect;
export type DiffRow = typeof diffs.$inferSelect;
export type ChangeRow = typeof changes.$inferSelect;
export type InformRow = typeof informs.$inferSelect;
export type DeliveryRow = typeof informDeliveries.$inferSelect;
