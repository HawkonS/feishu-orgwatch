import { truncate } from "../common/text.js";
import {
  personDepartmentPath,
  personDepartmentPaths,
  type PersonNode,
  type SnapshotData,
} from "./normalize.js";

export type Severity = "high" | "medium" | "low" | "info";
export type EntityType = "department" | "person";
export type ChangeKind =
  | "person_added"
  | "person_removed"
  | "person_name_changed"
  | "person_email_changed"
  | "person_title_changed"
  | "person_employee_no_changed"
  | "person_department_changed"
  | "person_status_changed"
  | "department_added"
  | "department_removed"
  | "department_renamed"
  | "department_moved"
  | "department_leader_changed"
  | "department_reordered"
  | "department_status_changed";

export type Change = {
  entityType: EntityType;
  changeKind: ChangeKind;
  entityKey: string;
  entityName: string;
  departmentPathBefore: string | null;
  departmentPathAfter: string | null;
  field: string | null;
  before: unknown;
  after: unknown;
  severity: Severity;
};

export type DiffOptions = {
  trackOrder: boolean;
  trackTitle: boolean;
  trackEmployeeNo: boolean;
};

export type DiffCounts = {
  total: number;
  peopleAdded: number;
  peopleRemoved: number;
  peopleChanged: number;
  departmentsAdded: number;
  departmentsRemoved: number;
  departmentsChanged: number;
};

export type DiffResult = {
  changes: Change[];
  counts: DiffCounts;
  severity: Severity;
  summary: {
    byKind: Record<string, number>;
    top: string[];
  };
};

export const CHANGE_LABELS: Record<ChangeKind, string> = {
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

const SEVERITY_RANK: Record<Severity, number> = { high: 3, medium: 2, low: 1, info: 0 };
const ENTITY_RANK: Record<EntityType, number> = { person: 0, department: 1 };

const primaryEmail = (person: PersonNode) => person.email ?? person.enterpriseEmail ?? null;

const deptName = (snapshot: SnapshotData, id: string) => snapshot.departments.get(id)?.name ?? id;

const personLabel = (person: PersonNode) => person.name || person.openId;

function leaderLabel(snapshot: SnapshotData, openId: string | null | undefined): string | null {
  if (!openId) return null;
  return snapshot.people.get(openId)?.name ?? openId;
}

function pathText(paths: string[]): string {
  return truncate(paths.length ? paths.join("；") : "未分配部门", 600);
}

function personPaths(person: PersonNode, snapshot: SnapshotData): string[] {
  return personDepartmentPaths(person, snapshot);
}

export function diffSnapshots(
  previous: SnapshotData | null,
  next: SnapshotData,
  options: DiffOptions,
): DiffResult {
  const changes: Change[] = [];
  const push = (change: Change) => changes.push(change);

  if (!previous) {
    for (const person of next.people.values()) {
      push({
        entityType: "person",
        changeKind: "person_added",
        entityKey: person.openId,
        entityName: personLabel(person),
        departmentPathBefore: null,
        departmentPathAfter: personDepartmentPath(person, next),
        field: null,
        before: null,
        after: { name: person.name, email: primaryEmail(person) },
        severity: "medium",
      });
    }
    for (const dept of next.departments.values()) {
      if (dept.id === "0") continue;
      push({
        entityType: "department",
        changeKind: "department_added",
        entityKey: dept.id,
        entityName: dept.name,
        departmentPathBefore: null,
        departmentPathAfter: dept.path,
        field: null,
        before: null,
        after: { name: dept.name, parentId: dept.parentId },
        severity: "info",
      });
    }
    return finalize(changes);
  }

  for (const [id, dept] of next.departments) {
    const before = previous.departments.get(id);
    if (!before) {
      push({
        entityType: "department",
        changeKind: "department_added",
        entityKey: id,
        entityName: dept.name,
        departmentPathBefore: null,
        departmentPathAfter: dept.path,
        field: null,
        before: null,
        after: { name: dept.name, parentId: dept.parentId, parentName: deptName(next, dept.parentId) },
        severity: "info",
      });
      continue;
    }
    if (before.name !== dept.name) {
      push({
        entityType: "department",
        changeKind: "department_renamed",
        entityKey: id,
        entityName: dept.name,
        departmentPathBefore: before.path,
        departmentPathAfter: dept.path,
        field: "name",
        before: before.name,
        after: dept.name,
        severity: "medium",
      });
    }
    if (before.parentId !== dept.parentId) {
      push({
        entityType: "department",
        changeKind: "department_moved",
        entityKey: id,
        entityName: dept.name,
        departmentPathBefore: before.path,
        departmentPathAfter: dept.path,
        field: "parent",
        before: { parentId: before.parentId, parentName: deptName(previous, before.parentId) },
        after: { parentId: dept.parentId, parentName: deptName(next, dept.parentId) },
        severity: "medium",
      });
    }
    const beforeLeaderIds = (before.leaderOpenIds?.length
      ? before.leaderOpenIds
      : before.leaderOpenId
        ? [before.leaderOpenId]
        : []
    )
      .slice()
      .sort();
    const afterLeaderIds = (dept.leaderOpenIds?.length
      ? dept.leaderOpenIds
      : dept.leaderOpenId
        ? [dept.leaderOpenId]
        : []
    )
      .slice()
      .sort();
    if (beforeLeaderIds.join(",") !== afterLeaderIds.join(",")) {
      push({
        entityType: "department",
        changeKind: "department_leader_changed",
        entityKey: id,
        entityName: dept.name,
        departmentPathBefore: before.path,
        departmentPathAfter: dept.path,
        field: "leader",
        before: {
          openIds: beforeLeaderIds,
          names: beforeLeaderIds.map((openId) => leaderLabel(previous, openId)),
        },
        after: {
          openIds: afterLeaderIds,
          names: afterLeaderIds.map((openId) => leaderLabel(next, openId)),
        },
        severity: "high",
      });
    }
    if (options.trackOrder && before.order !== dept.order) {
      push({
        entityType: "department",
        changeKind: "department_reordered",
        entityKey: id,
        entityName: dept.name,
        departmentPathBefore: before.path,
        departmentPathAfter: dept.path,
        field: "order",
        before: before.order,
        after: dept.order,
        severity: "low",
      });
    }
    if (before.status !== dept.status) {
      push({
        entityType: "department",
        changeKind: "department_status_changed",
        entityKey: id,
        entityName: dept.name,
        departmentPathBefore: before.path,
        departmentPathAfter: dept.path,
        field: "status",
        before: before.status,
        after: dept.status,
        severity: "medium",
      });
    }
  }

  for (const [id, before] of previous.departments) {
    if (next.departments.has(id)) continue;
    if (id === "0") continue;
    push({
      entityType: "department",
      changeKind: "department_removed",
      entityKey: id,
      entityName: before.name,
      departmentPathBefore: before.path,
      departmentPathAfter: null,
      field: null,
      before: { name: before.name, parentId: before.parentId },
      after: null,
      severity: "high",
    });
  }

  for (const [openId, person] of next.people) {
    const before = previous.people.get(openId);
    const afterPath = personDepartmentPath(person, next);
    if (!before) {
      push({
        entityType: "person",
        changeKind: "person_added",
        entityKey: openId,
        entityName: personLabel(person),
        departmentPathBefore: null,
        departmentPathAfter: afterPath,
        field: null,
        before: null,
        after: { name: person.name, email: primaryEmail(person) },
        severity: "medium",
      });
      continue;
    }
    const beforePath = personDepartmentPath(before, previous);

    if (before.name !== person.name) {
      push({
        entityType: "person",
        changeKind: "person_name_changed",
        entityKey: openId,
        entityName: personLabel(person),
        departmentPathBefore: beforePath,
        departmentPathAfter: afterPath,
        field: "name",
        before: before.name,
        after: person.name,
        severity: "medium",
      });
    }
    if (primaryEmail(before) !== primaryEmail(person)) {
      push({
        entityType: "person",
        changeKind: "person_email_changed",
        entityKey: openId,
        entityName: personLabel(person),
        departmentPathBefore: beforePath,
        departmentPathAfter: afterPath,
        field: "email",
        before: primaryEmail(before),
        after: primaryEmail(person),
        severity: "medium",
      });
    }
    if (options.trackTitle && before.jobTitle !== person.jobTitle) {
      push({
        entityType: "person",
        changeKind: "person_title_changed",
        entityKey: openId,
        entityName: personLabel(person),
        departmentPathBefore: beforePath,
        departmentPathAfter: afterPath,
        field: "title",
        before: before.jobTitle,
        after: person.jobTitle,
        severity: "low",
      });
    }
    if (options.trackEmployeeNo && before.employeeNo !== person.employeeNo) {
      push({
        entityType: "person",
        changeKind: "person_employee_no_changed",
        entityKey: openId,
        entityName: personLabel(person),
        departmentPathBefore: beforePath,
        departmentPathAfter: afterPath,
        field: "employeeNo",
        before: before.employeeNo,
        after: person.employeeNo,
        severity: "low",
      });
    }
    const beforeDepartments = [...before.departmentIds].sort();
    const afterDepartments = [...person.departmentIds].sort();
    if (beforeDepartments.join(",") !== afterDepartments.join(",")) {
      push({
        entityType: "person",
        changeKind: "person_department_changed",
        entityKey: openId,
        entityName: personLabel(person),
        departmentPathBefore: beforePath,
        departmentPathAfter: afterPath,
        field: "departments",
        before: { paths: personPaths(before, previous) },
        after: { paths: personPaths(person, next) },
        severity: "high",
      });
    }
    if (before.status !== person.status) {
      const becameInactive = person.status === "resigned" || person.status === "frozen";
      push({
        entityType: "person",
        changeKind: "person_status_changed",
        entityKey: openId,
        entityName: personLabel(person),
        departmentPathBefore: beforePath,
        departmentPathAfter: afterPath,
        field: "status",
        before: before.status,
        after: person.status,
        severity: becameInactive ? "high" : "medium",
      });
    }
  }

  for (const [openId, before] of previous.people) {
    if (next.people.has(openId)) continue;
    push({
      entityType: "person",
      changeKind: "person_removed",
      entityKey: openId,
      entityName: personLabel(before),
      departmentPathBefore: personDepartmentPath(before, previous),
      departmentPathAfter: null,
      field: null,
      before: { name: before.name, email: primaryEmail(before), status: before.status },
      after: null,
      severity: "high",
    });
  }

  return finalize(changes);
}

function finalize(input: Change[]): DiffResult {
  const changes = [...input].sort((a, b) => {
    const severity = SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity];
    if (severity !== 0) return severity;
    const entity = ENTITY_RANK[a.entityType] - ENTITY_RANK[b.entityType];
    if (entity !== 0) return entity;
    return `${a.departmentPathAfter ?? a.departmentPathBefore ?? ""}${a.entityName}`.localeCompare(
      `${b.departmentPathAfter ?? b.departmentPathBefore ?? ""}${b.entityName}`,
    );
  });

  const counts: DiffCounts = {
    total: changes.length,
    peopleAdded: 0,
    peopleRemoved: 0,
    peopleChanged: 0,
    departmentsAdded: 0,
    departmentsRemoved: 0,
    departmentsChanged: 0,
  };
  const changedPeople = new Set<string>();
  const changedDepartments = new Set<string>();
  const byKind: Record<string, number> = {};
  for (const change of changes) {
    byKind[change.changeKind] = (byKind[change.changeKind] ?? 0) + 1;
    if (change.changeKind === "person_added") counts.peopleAdded += 1;
    else if (change.changeKind === "person_removed") counts.peopleRemoved += 1;
    else if (change.entityType === "person") changedPeople.add(change.entityKey);
    if (change.changeKind === "department_added") counts.departmentsAdded += 1;
    else if (change.changeKind === "department_removed") counts.departmentsRemoved += 1;
    else if (change.entityType === "department") changedDepartments.add(change.entityKey);
  }
  counts.peopleChanged = changedPeople.size;
  counts.departmentsChanged = changedDepartments.size;

  const severity: Severity = changes.some((item) => item.severity === "high")
    ? "high"
    : changes.some((item) => item.severity === "medium")
      ? "medium"
      : changes.some((item) => item.severity === "low")
        ? "low"
        : "info";

  return {
    changes,
    counts,
    severity,
    summary: {
      byKind,
      top: changes.slice(0, 8).map(describeChange),
    },
  };
}

export function describeChange(change: Change): string {
  const path = change.departmentPathAfter ?? change.departmentPathBefore ?? "";
  const name = change.entityName;
  switch (change.changeKind) {
    case "person_added":
      return `${name} 加入（${path || "未分配部门"}）`;
    case "person_removed":
      return `${name} 离职或移出（原：${path || "未分配部门"}）`;
    case "person_name_changed":
      return `${name} 姓名变更：${String(change.before)} → ${String(change.after)}`;
    case "person_email_changed":
      return `${name} 邮箱变更：${String(change.before ?? "-")} → ${String(change.after ?? "-")}`;
    case "person_title_changed":
      return `${name} 职位变更：${String(change.before ?? "-")} → ${String(change.after ?? "-")}`;
    case "person_employee_no_changed":
      return `${name} 工号变更：${String(change.before ?? "-")} → ${String(change.after ?? "-")}`;
    case "person_department_changed": {
      const beforePaths = (change.before as { paths?: string[] } | null)?.paths ?? [];
      const afterPaths = (change.after as { paths?: string[] } | null)?.paths ?? [];
      return `${name} 部门调整：${pathText(beforePaths)} → ${pathText(afterPaths)}`;
    }
    case "person_status_changed":
      return `${name} 状态变更：${statusLabel(change.before)} → ${statusLabel(change.after)}`;
    case "department_added":
      return `新增部门：${name}（${path}）`;
    case "department_removed":
      return `部门删除：${name}（原：${path}）`;
    case "department_renamed":
      return `部门改名：${String(change.before)} → ${String(change.after)}`;
    case "department_moved": {
      const before = change.before as { parentName?: string } | null;
      const after = change.after as { parentName?: string } | null;
      return `部门调整：${name}（${before?.parentName ?? "-"} → ${after?.parentName ?? "-"}）`;
    }
    case "department_leader_changed": {
      const before = change.before as { names?: Array<string | null>; name?: string | null } | null;
      const after = change.after as { names?: Array<string | null>; name?: string | null } | null;
      const beforeText = before?.names?.length ? before.names.join("、") : before?.name ?? "空";
      const afterText = after?.names?.length ? after.names.join("、") : after?.name ?? "空";
      return `负责人变更：${name}（${beforeText} → ${afterText}）`;
    }
    case "department_reordered":
      return `部门排序调整：${name}`;
    case "department_status_changed":
      return `部门状态变更：${name}`;
    default:
      return `${name} ${change.changeKind}`;
  }
}

export function statusLabel(value: unknown): string {
  const text = String(value ?? "");
  if (text === "active") return "在职";
  if (text === "resigned") return "离职";
  if (text === "frozen") return "冻结";
  if (text === "deleted") return "已删除";
  return text || "-";
}
