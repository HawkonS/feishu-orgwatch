import { createHash } from "node:crypto";
import { normalizeEmail, normalizeName, normalizeOptional } from "../common/text.js";
import type { FetchResult, RawDepartment, RawPerson } from "../feishu/directory.fetcher.js";

export type DeptNode = {
  id: string;
  parentId: string;
  name: string;
  leaderOpenId: string | null;
  leaderOpenIds: string[];
  order: number;
  status: string;
  depth: number;
  path: string;
};

export type PersonNode = {
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
  departmentIds: string[];
};

export type SnapshotData = {
  rootDepartmentId: string;
  departments: Map<string, DeptNode>;
  people: Map<string, PersonNode>;
  hash: string;
};

function buildDepartments(raw: RawDepartment[]): Map<string, DeptNode> {
  const map = new Map<string, DeptNode>();
  for (const item of raw) {
    map.set(item.openDepartmentId, {
      id: item.openDepartmentId,
      parentId: item.parentOpenDepartmentId,
      name: normalizeName(item.name) || item.openDepartmentId,
      leaderOpenId: item.leaderOpenId,
      leaderOpenIds: item.leaderOpenIds.length ? item.leaderOpenIds : item.leaderOpenId ? [item.leaderOpenId] : [],
      order: item.order,
      status: item.status,
      depth: 0,
      path: "",
    });
  }
  // Resolve depth and human-readable path, tolerating missing parents and cycles.
  for (const node of map.values()) {
    const chain: DeptNode[] = [];
    const seen = new Set<string>();
    let current: DeptNode | undefined = node;
    while (current && !seen.has(current.id) && chain.length < 64) {
      seen.add(current.id);
      chain.unshift(current);
      current = map.get(current.parentId);
      if (current?.id === "0") break;
    }
    node.depth = Math.max(0, chain.length - 1);
    node.path = chain.map((item) => item.name).join(" / ");
  }
  return map;
}

function normalizePerson(item: RawPerson): PersonNode {
  return {
    openId: item.openId,
    unionId: normalizeOptional(item.unionId),
    userId: normalizeOptional(item.userId),
    name: normalizeName(item.name) || item.openId,
    email: normalizeEmail(item.email),
    enterpriseEmail: normalizeEmail(item.enterpriseEmail),
    jobTitle: normalizeOptional(item.jobTitle),
    employeeNo: normalizeOptional(item.employeeNo),
    status: item.status,
    isResigned: item.isResigned,
    isFrozen: item.isFrozen,
    avatarUrl: item.avatarUrl,
    departmentIds: [...new Set(item.departmentIds)].sort(),
  };
}

export function buildSnapshot(rootDepartmentId: string, result: FetchResult): SnapshotData {
  const departments = buildDepartments(result.departments);
  const people = new Map<string, PersonNode>();
  for (const item of result.people) {
    const person = normalizePerson(item);
    // Drop department references outside the fetched tree to keep paths stable.
    person.departmentIds = person.departmentIds.filter((id) => departments.has(id));
    people.set(person.openId, person);
  }

  const hashPayload = {
    root: rootDepartmentId,
    departments: [...departments.values()]
      .map((item) => [item.id, item.parentId, item.name, item.leaderOpenId, item.leaderOpenIds.slice().sort(), item.order, item.status])
      .sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
    people: [...people.values()]
      .map((item) => [
        item.openId,
        item.name,
        item.email,
        item.enterpriseEmail,
        item.jobTitle,
        item.employeeNo,
        item.status,
        item.departmentIds,
      ])
      .sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
  };
  const hash = createHash("sha256").update(JSON.stringify(hashPayload)).digest("hex");

  return { rootDepartmentId, departments, people, hash };
}

export function personDepartmentPaths(person: PersonNode, snapshot: SnapshotData): string[] {
  return person.departmentIds
    .map((id) => snapshot.departments.get(id)?.path)
    .filter((path): path is string => Boolean(path));
}

export function personDepartmentPath(person: PersonNode, snapshot: SnapshotData): string {
  const paths = personDepartmentPaths(person, snapshot);
  return paths.length ? paths.join("；") : "未分配部门";
}
