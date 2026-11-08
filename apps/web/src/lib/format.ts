export type Severity = "high" | "medium" | "low" | "info";
export type DiffStatus = "new" | "notified" | "acknowledged" | "ignored";
export type RunStatus = "running" | "success" | "failed" | "needs_review" | "cancelled" | "skipped";

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

export function formatDate(value: string | null | undefined): string {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

export function relativeTime(value: string | null | undefined): string {
  if (!value) return "从未";
  const date = new Date(value).getTime();
  if (Number.isNaN(date)) return "-";
  const diff = Date.now() - date;
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;
  const format = new Intl.RelativeTimeFormat("zh-CN", { numeric: "auto" });
  if (Math.abs(diff) < minute) return "刚刚";
  if (Math.abs(diff) < hour) return format.format(-Math.round(diff / minute), "minute");
  if (Math.abs(diff) < day) return format.format(-Math.round(diff / hour), "hour");
  return format.format(-Math.round(diff / day), "day");
}

export const SEVERITY_LABELS: Record<Severity, string> = {
  high: "高",
  medium: "中",
  low: "低",
  info: "提示",
};

export const SEVERITY_TONE: Record<Severity, "red" | "orange" | "blue" | "gray"> = {
  high: "red",
  medium: "orange",
  low: "blue",
  info: "gray",
};

export const DIFF_STATUS_LABELS: Record<DiffStatus, string> = {
  new: "待通知",
  notified: "已通知",
  acknowledged: "已知情",
  ignored: "已忽略",
};

export const DIFF_STATUS_TONE: Record<DiffStatus, "blue" | "orange" | "green" | "gray"> = {
  new: "blue",
  notified: "orange",
  acknowledged: "green",
  ignored: "gray",
};

export const RUN_STATUS_LABELS: Record<RunStatus, string> = {
  running: "执行中",
  success: "成功",
  failed: "失败",
  needs_review: "待确认",
  cancelled: "已取消",
  skipped: "已跳过",
};

export const RUN_STATUS_TONE: Record<RunStatus, "blue" | "green" | "red" | "orange" | "gray"> = {
  running: "blue",
  success: "green",
  failed: "red",
  needs_review: "orange",
  cancelled: "gray",
  skipped: "gray",
};

export const CHANGE_LABELS: Record<string, string> = {
  person_added: "新增成员",
  person_removed: "离职或移出",
  person_name_changed: "姓名变更",
  person_email_changed: "邮箱变更",
  person_title_changed: "职位变更",
  person_employee_no_changed: "工号变更",
  person_department_changed: "部门调整",
  person_status_changed: "在职状态变更",
  department_added: "新增部门",
  department_removed: "部门删除",
  department_renamed: "部门改名",
  department_moved: "部门调整上级",
  department_leader_changed: "负责人变更",
  department_reordered: "部门排序调整",
  department_status_changed: "部门状态变更",
};

export function changeLabel(kind: string): string {
  return CHANGE_LABELS[kind] ?? kind;
}

export function statusLabel(value: string): string {
  if (value === "active") return "在职";
  if (value === "resigned") return "离职";
  if (value === "frozen") return "冻结";
  if (value === "deleted") return "已删除";
  return value || "-";
}

export function displayEmail(item: { email?: string | null; enterpriseEmail?: string | null }): string {
  return item.email || item.enterpriseEmail || "-";
}

export function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}
