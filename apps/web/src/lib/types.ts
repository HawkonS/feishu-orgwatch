export type Snapshot = {
  id: number;
  scopeRootDepartmentId: string;
  runId: number | null;
  fetchedAt: string;
  contentHash: string;
  departmentCount: number;
  peopleCount: number;
  status: "ok" | "quarantined";
  createdAt: string;
};

export type Diff = {
  id: number;
  taskId: number | null;
  fromSnapshotId: number | null;
  toSnapshotId: number;
  scopeRootDepartmentId: string;
  status: "new" | "notified" | "acknowledged" | "ignored";
  severity: "high" | "medium" | "low" | "info";
  totalChanges: number;
  peopleAdded: number;
  peopleRemoved: number;
  peopleChanged: number;
  departmentsAdded: number;
  departmentsRemoved: number;
  departmentsChanged: number;
  summaryJson: string;
  summary?: { byKind?: Record<string, number>; top?: string[] };
  ignoredReason: string | null;
  resolvedBy: number | null;
  resolvedAt: string | null;
  createdAt: string;
  updatedAt: string;
  task?: { id: number; name: string } | null;
  fromSnapshot?: Snapshot | null;
  toSnapshot?: Snapshot | null;
  deliveryStats?: { pending: number; sent: number; failed: number; acknowledged: number };
};

export type Change = {
  id: number;
  diffId: number;
  entityType: "person" | "department";
  changeKind: string;
  entityKey: string;
  entityName: string;
  departmentPathBefore: string | null;
  departmentPathAfter: string | null;
  field: string | null;
  before: unknown;
  after: unknown;
  severity: "high" | "medium" | "low" | "info";
  createdAt: string;
};

export type Person = {
  openId: string;
  unionId: string | null;
  userId: string | null;
  name: string;
  email: string | null;
  enterpriseEmail: string | null;
  jobTitle: string | null;
  employeeNo: string | null;
  status: string;
  isResigned: boolean;
  isFrozen: boolean;
  avatarUrl: string | null;
  departmentPaths?: string[];
};

export type Department = {
  id: string;
  parentId: string;
  name: string;
  leaderOpenId: string | null;
  leaderName?: string | null;
  leaderEmail?: string | null;
  leaderJobTitle?: string | null;
  leaderAvatarUrl?: string | null;
  leaderOpenIds?: string[];
  leaders?: Array<{
    openId: string;
    name: string;
    email: string | null;
    jobTitle: string | null;
    avatarUrl: string | null;
    status: string;
    isMember: boolean;
    isPrimary: boolean;
  }>;
  order: number;
  status: string;
  depth: number;
  path: string;
  memberCount: number;
  directMemberCount?: number;
};

export type Run = {
  id: number;
  taskId: number | null;
  trigger: string;
  status: "running" | "success" | "failed" | "needs_review" | "cancelled" | "skipped";
  phase: string;
  startedAt: string;
  finishedAt: string | null;
  departmentCount: number;
  peopleCount: number;
  addedPeople: number;
  removedPeople: number;
  changedPeople: number;
  addedDepartments: number;
  removedDepartments: number;
  changedDepartments: number;
  snapshotId: number | null;
  diffId: number | null;
  errorCode: string | null;
  errorMessage: string | null;
  cancelRequested: boolean;
};

export type RunEvent = {
  id: number;
  runId: number;
  at: string;
  level: "info" | "warn" | "error";
  message: string;
  detailJson: string | null;
};

export type Task = {
  id: number;
  name: string;
  description: string | null;
  cron: string;
  timezone: string;
  enabled: boolean;
  rootDepartmentId: string;
  retentionRuns: number;
  createdBy: number | null;
  lastRunAt: string | null;
  nextRunAt: string | null;
  lockedUntil: string | null;
  createdAt: string;
  updatedAt: string;
};

export type Delivery = {
  id: number;
  informId: number;
  diffId: number;
  recipientType: "user" | "chat";
  recipientId: string;
  recipientName: string;
  channel: string;
  status: "pending" | "sent" | "failed";
  messageId: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  sentAt: string | null;
  acknowledgedAt: string | null;
  acknowledgedBy: number | null;
  acknowledgedVia: "self" | "operator" | "card" | null;
  createdAt: string;
};

export type Inform = {
  id: number;
  diffId: number;
  note: string | null;
  changeIdsJson: string | null;
  createdBy: number | null;
  createdAt: string;
  deliveries: Delivery[];
};

export type AuditLog = {
  id: number;
  actorId: number | null;
  actorName: string | null;
  action: string;
  targetType: string | null;
  targetId: string | null;
  detailJson: string | null;
  ip: string | null;
  userAgent: string | null;
  createdAt: string;
};

export type Paged<T> = {
  items: T[];
  total: number;
  page?: number;
  pageSize?: number;
};

export type SettingItem = {
  key: string;
  label: string;
  kind: "string" | "secret" | "number" | "boolean";
  defaultValue: string;
  description: string;
  value: string;
  configured: boolean;
  min?: number;
  max?: number;
};
