import assert from "node:assert/strict";
import test from "node:test";
import { buildSnapshot, type SnapshotData } from "../src/sync/normalize.js";
import { diffSnapshots, type ChangeKind } from "../src/sync/diff.engine.js";
import { nextRuns, validateCron } from "../src/sync/cron.js";
import { buildDiffCard } from "../src/feishu/card.builder.js";
import type { FetchResult, RawDepartment, RawPerson } from "../src/feishu/directory.fetcher.js";

const options = { trackOrder: false, trackTitle: true, trackEmployeeNo: true };

function person(
  openId: string,
  name: string,
  departmentIds: string[],
  patch: Partial<RawPerson> = {},
): RawPerson {
  return {
    openId,
    unionId: `on_${openId}`,
    userId: `uid_${openId}`,
    name,
    email: `${openId}@example.com`,
    enterpriseEmail: null,
    jobTitle: "工程师",
    employeeNo: openId,
    status: "active",
    isResigned: false,
    isFrozen: false,
    avatarUrl: null,
    departmentIds,
    ...patch,
  };
}

function dept(
  id: string,
  parentId: string,
  name: string,
  patch: Partial<RawDepartment> = {},
): RawDepartment {
  return {
    openDepartmentId: id,
    parentOpenDepartmentId: parentId,
    name,
    leaderOpenId: null,
    leaderOpenIds: patch.leaderOpenId ? [patch.leaderOpenId] : [],
    order: 0,
    status: "active",
    ...patch,
  };
}

function snapshot(departments: RawDepartment[], people: RawPerson[], root = "0"): SnapshotData {
  const result: FetchResult = { departments, people, warnings: [] };
  return buildSnapshot(root, result);
}

function kinds(changes: ReturnType<typeof diffSnapshots>["changes"]): ChangeKind[] {
  return changes.map((change) => change.changeKind);
}

const baseDepartments = [
  dept("0", "0", "根部门"),
  dept("d1", "0", "研发部", { leaderOpenId: "u1" }),
  dept("d2", "d1", "平台组"),
  dept("d3", "0", "市场部"),
];
const basePeople = [
  person("u1", "张三", ["d1"]),
  person("u2", "李四", ["d1"]),
  person("u3", "王五", ["d2"]),
  person("u4", "赵六", ["d3"], { jobTitle: "专员" }),
];

test("identical directories produce no changes", () => {
  const before = snapshot(baseDepartments, basePeople);
  const after = snapshot(baseDepartments, basePeople);
  const result = diffSnapshots(before, after, options);
  assert.equal(result.counts.total, 0);
  assert.equal(result.severity, "info");
});

test("whitespace, email case and department order do not produce changes", () => {
  const before = snapshot(baseDepartments, basePeople);
  const after = snapshot(
    [...baseDepartments].reverse(),
    basePeople.map((item) => ({
      ...item,
      name: ` ${item.name} `,
      email: (item.email ?? "").toUpperCase(),
      departmentIds: [...item.departmentIds].reverse(),
    })),
  );
  const result = diffSnapshots(before, after, options);
  assert.equal(result.counts.total, 0);
});

test("detects people added and removed", () => {
  const before = snapshot(baseDepartments, basePeople);
  const after = snapshot(baseDepartments, [...basePeople.filter((item) => item.openId !== "u2"), person("u6", "孙七", ["d3"])]);
  const result = diffSnapshots(before, after, options);
  const found = kinds(result.changes);
  assert.ok(found.includes("person_removed"));
  assert.ok(found.includes("person_added"));
  assert.equal(result.counts.peopleRemoved, 1);
  assert.equal(result.counts.peopleAdded, 1);
  const removed = result.changes.find((change) => change.changeKind === "person_removed");
  assert.equal(removed?.entityName, "李四");
  assert.match(removed?.departmentPathBefore ?? "", /研发部/);
});

test("detects department rename, move, leader change and added department", () => {
  const before = snapshot(baseDepartments, basePeople);
  const after = snapshot(
    [
      dept("0", "0", "根部门"),
      dept("d1", "0", "研发中心", { leaderOpenId: "u3" }),
      dept("d2", "0", "平台组"),
      dept("d3", "0", "市场部"),
      dept("d4", "0", "数据部"),
    ],
    basePeople,
  );
  const result = diffSnapshots(before, after, options);
  const found = kinds(result.changes);
  assert.ok(found.includes("department_renamed"));
  assert.ok(found.includes("department_moved"));
  assert.ok(found.includes("department_leader_changed"));
  assert.ok(found.includes("department_added"));
  assert.equal(result.severity, "high");
});

test("detects person department move, email, title and employee number changes", () => {
  const before = snapshot(baseDepartments, basePeople);
  const after = snapshot(
    baseDepartments,
    basePeople.map((item) => {
      if (item.openId === "u3") return { ...item, departmentIds: ["d1"] };
      if (item.openId === "u4") return { ...item, email: "zhao2@example.com", jobTitle: "主管" };
      if (item.openId === "u1") return { ...item, employeeNo: "E1001" };
      return item;
    }),
  );
  const result = diffSnapshots(before, after, options);
  const found = kinds(result.changes);
  assert.ok(found.includes("person_department_changed"));
  assert.ok(found.includes("person_email_changed"));
  assert.ok(found.includes("person_title_changed"));
  assert.ok(found.includes("person_employee_no_changed"));
  const moved = result.changes.find((change) => change.changeKind === "person_department_changed");
  assert.ok(JSON.stringify(moved?.before).includes("平台组"));
  assert.ok(JSON.stringify(moved?.after).includes("研发部"));
});

test("removed person suppresses field changes", () => {
  const before = snapshot(baseDepartments, basePeople);
  const after = snapshot(
    baseDepartments,
    basePeople.filter((item) => item.openId !== "u1"),
  );
  const result = diffSnapshots(before, after, options);
  const forPerson = result.changes.filter((change) => change.entityKey === "u1");
  assert.deepEqual(
    forPerson.map((change) => change.changeKind),
    ["person_removed"],
  );
});

test("resigned status is high severity", () => {
  const before = snapshot(baseDepartments, basePeople);
  const after = snapshot(
    baseDepartments,
    basePeople.map((item) =>
      item.openId === "u2" ? { ...item, status: "resigned", isResigned: true } : item,
    ),
  );
  const result = diffSnapshots(before, after, options);
  const statusChange = result.changes.find((change) => change.changeKind === "person_status_changed");
  assert.equal(statusChange?.severity, "high");
});

test("department order is ignored unless enabled", () => {
  const before = snapshot(baseDepartments, basePeople);
  const after = snapshot(
    baseDepartments.map((item) => (item.openDepartmentId === "d1" ? { ...item, order: 99 } : item)),
    basePeople,
  );
  assert.equal(diffSnapshots(before, after, options).counts.total, 0);
  const tracked = diffSnapshots(before, after, { ...options, trackOrder: true });
  assert.ok(kinds(tracked.changes).includes("department_reordered"));
});

test("first snapshot reports additions against an empty baseline", () => {
  const after = snapshot(baseDepartments, basePeople);
  const result = diffSnapshots(null, after, options);
  assert.equal(result.counts.peopleAdded, 4);
  assert.ok(result.counts.departmentsAdded >= 3);
});

test("cron validation returns five future occurrences in the configured timezone", () => {
  const result = validateCron("0 9 * * 1-5", "Asia/Shanghai");
  assert.equal(result.next.length, 5);
  const runs = nextRuns("0 9 * * *", "Asia/Shanghai", new Date("2026-11-04T00:00:00.000Z"), 2);
  assert.equal(runs[0]?.toISOString(), "2026-11-04T01:00:00.000Z");
  assert.equal(runs[1]?.toISOString(), "2026-11-05T01:00:00.000Z");
});

test("card escapes user content and truncates overflow", () => {
  const card = buildDiffCard({
    title: "组织架构变更提醒",
    siteName: "feishu-orgwatch",
    publicBaseUrl: "https://example.com",
    diffId: 1,
    counts: {
      total: 2,
      peopleAdded: 1,
      peopleRemoved: 1,
      peopleChanged: 0,
      departmentsAdded: 0,
      departmentsRemoved: 0,
      departmentsChanged: 0,
    },
    changes: [
      {
        entityType: "person",
        changeKind: "person_added",
        entityKey: "u1",
        entityName: "<script>alert(1)</script>",
        departmentPathBefore: null,
        departmentPathAfter: "研发部",
        field: null,
        before: null,
        after: null,
        severity: "medium",
      },
    ],
    note: "请知悉",
    maxItems: 1,
    timeText: "2026-11-04 09:00",
  });
  const text = JSON.stringify(card);
  assert.ok(!text.includes("<script>"));
  assert.ok(text.includes("&lt;script&gt;"));
  assert.ok(text.includes("/diffs/1"));
});
