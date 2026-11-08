#!/usr/bin/env node
// 生成两版虚拟快照与一次差异，便于截图、演示和前端联调。
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const workspace = path.resolve(ROOT, process.env.ORGWATCH_WORKSPACE || ".");
const dbFile = path.join(workspace, "data/feishu-orgwatch.sqlite");

if (!existsSync(dbFile)) {
  console.error(`数据库不存在: ${dbFile}`);
  console.error("请先启动服务并用 hawkon 登录，再执行 npm run seed:demo。");
  process.exit(1);
}

const sqlite = new Database(dbFile);
sqlite.pragma("journal_mode = WAL");
sqlite.pragma("foreign_keys = ON");
migrate(drizzle(sqlite), { migrationsFolder: path.join(ROOT, "apps/server/drizzle") });

const existing = sqlite.prepare("select count(*) as count from snapshots").get();
if (Number(existing.count) > 0) {
  console.log("数据库中已有快照，为避免污染真实数据，seed:demo 不再写入。");
  sqlite.close();
  process.exit(0);
}

const now = Date.now();
const DAY = 24 * 60 * 60 * 1000;
const iso = (time) => new Date(time).toISOString();

const departments = {
  root: { id: "0", parent: "0", name: "根部门" },
  research: { id: "od_research", parent: "0", name: "研发部" },
  platform: { id: "od_platform", parent: "od_research", name: "平台组" },
  market: { id: "od_market", parent: "0", name: "市场部" },
  data: { id: "od_data", parent: "0", name: "数据部" },
};

const people = [
  { openId: "ou_demo_zhang", name: "张三", email: "zhang.san@example.com", title: "研发负责人", no: "E1001", depts: ["od_research"] },
  { openId: "ou_demo_li", name: "李四", email: "li.si@example.com", title: "工程师", no: "E1002", depts: ["od_research"] },
  { openId: "ou_demo_wang", name: "王五", email: "wang.wu@example.com", title: "工程师", no: "E1003", depts: ["od_platform"] },
  { openId: "ou_demo_zhao", name: "赵六", email: "zhao.liu@example.com", title: "市场专员", no: "E1004", depts: ["od_market"] },
  { openId: "ou_demo_qian", name: "钱八", email: "qian.ba@example.com", title: "市场经理", no: "E1005", depts: ["od_market"] },
  { openId: "ou_demo_sun", name: "孙七", email: "sun.qi@example.com", title: "数据工程师", no: "E1006", depts: ["od_data"] },
];

function insertSnapshot({ departments: deptList, people: personList, fetchedAt, status = "ok" }) {
  const snapshot = sqlite
    .prepare(
      "insert into snapshots (scope_root_department_id, run_id, fetched_at, content_hash, department_count, people_count, status, created_at) values (?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .run("0", null, fetchedAt, `demo-${Math.random().toString(16).slice(2)}`, deptList.length, personList.length, status, fetchedAt);
  const snapshotId = Number(snapshot.lastInsertRowid);

  const insertDept = sqlite.prepare(
    `insert into snapshot_departments (snapshot_id, open_department_id, parent_open_department_id, name, leader_open_id, "order", status, depth, path_names) values (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const [index, dept] of deptList.entries()) {
    const parent = deptList.find((item) => item.id === dept.parent);
    const path = dept.id === "0" ? dept.name : parent && parent.id !== "0" ? `${parent.name} / ${dept.name}` : dept.name;
    insertDept.run(snapshotId, dept.id, dept.parent, dept.name, dept.leader ?? null, index, "active", dept.parent === "0" ? 0 : 1, path);
  }

  const insertPerson = sqlite.prepare(
    "insert into snapshot_people (snapshot_id, open_id, union_id, user_id, name, email, enterprise_email, job_title, employee_no, status, is_resigned, is_frozen, avatar_url) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
  );
  const insertMembership = sqlite.prepare(
    "insert into snapshot_memberships (snapshot_id, open_id, open_department_id) values (?, ?, ?)",
  );
  for (const person of personList) {
    insertPerson.run(
      snapshotId,
      person.openId,
      `on_${person.openId}`,
      `uid_${person.openId}`,
      person.name,
      person.email,
      null,
      person.title,
      person.no,
      "active",
      0,
      0,
      null,
    );
    for (const deptId of person.depts) insertMembership.run(snapshotId, person.openId, deptId);
  }
  return snapshotId;
}

const baselineDepts = [departments.root, departments.research, departments.platform, departments.market];
const baselinePeople = people.filter((item) => item.openId !== "ou_demo_sun" && item.openId !== "ou_demo_zhang2");

const baseline = insertSnapshot({
  departments: baselineDepts,
  people: baselinePeople,
  fetchedAt: iso(now - 2 * DAY),
});

const currentDepts = [
  departments.root,
  { ...departments.research, name: "研发中心" },
  { ...departments.platform, parent: "0" },
  departments.market,
  departments.data,
];
const currentPeople = [
  people[0],
  people[2],
  { ...people[3], email: "zhao.liu2@example.com" },
  people[4],
  people[5],
].map((person) => (person.openId === "ou_demo_wang" ? { ...person, depts: ["od_research"] } : person));

const current = insertSnapshot({
  departments: currentDepts,
  people: currentPeople,
  fetchedAt: iso(now - 60 * 60 * 1000),
});

const changes = [
  {
    entityType: "person",
    changeKind: "person_removed",
    entityKey: "ou_demo_li",
    entityName: "李四",
    pathBefore: "研发部",
    pathAfter: null,
    severity: "high",
    before: { name: "李四", email: "li.si@example.com" },
    after: null,
  },
  {
    entityType: "person",
    changeKind: "person_added",
    entityKey: "ou_demo_sun",
    entityName: "孙七",
    pathBefore: null,
    pathAfter: "数据部",
    severity: "medium",
    before: null,
    after: { name: "孙七", email: "sun.qi@example.com" },
  },
  {
    entityType: "person",
    changeKind: "person_department_changed",
    entityKey: "ou_demo_wang",
    entityName: "王五",
    pathBefore: "研发部 / 平台组",
    pathAfter: "研发中心",
    severity: "high",
    before: { paths: ["研发部 / 平台组"] },
    after: { paths: ["研发中心"] },
  },
  {
    entityType: "person",
    changeKind: "person_email_changed",
    entityKey: "ou_demo_zhao",
    entityName: "赵六",
    pathBefore: "市场部",
    pathAfter: "市场部",
    severity: "medium",
    before: "zhao.liu@example.com",
    after: "zhao.liu2@example.com",
  },
  {
    entityType: "department",
    changeKind: "department_renamed",
    entityKey: "od_research",
    entityName: "研发中心",
    pathBefore: "研发部",
    pathAfter: "研发中心",
    severity: "medium",
    before: "研发部",
    after: "研发中心",
  },
  {
    entityType: "department",
    changeKind: "department_moved",
    entityKey: "od_platform",
    entityName: "平台组",
    pathBefore: "研发部 / 平台组",
    pathAfter: "平台组",
    severity: "medium",
    before: { parentId: "od_research", parentName: "研发部" },
    after: { parentId: "0", parentName: "根部门" },
  },
  {
    entityType: "department",
    changeKind: "department_added",
    entityKey: "od_data",
    entityName: "数据部",
    pathBefore: null,
    pathAfter: "数据部",
    severity: "info",
    before: null,
    after: { name: "数据部", parentId: "0" },
  },
];

const summary = {
  byKind: changes.reduce((acc, item) => ({ ...acc, [item.changeKind]: (acc[item.changeKind] ?? 0) + 1 }), {}),
  top: ["李四 离职或移出（原：研发部）", "王五 部门调整：研发部 / 平台组 → 研发中心", "新增部门：数据部（数据部）"],
};

const diff = sqlite
  .prepare(
    "insert into diffs (task_id, from_snapshot_id, to_snapshot_id, scope_root_department_id, status, severity, total_changes, people_added, people_removed, people_changed, departments_added, departments_removed, departments_changed, summary_json, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
  )
  .run(
    null,
    baseline,
    current,
    "0",
    "new",
    "high",
    changes.length,
    1,
    1,
    2,
    1,
    0,
    2,
    JSON.stringify(summary),
    iso(now - 30 * 60 * 1000),
    iso(now - 30 * 60 * 1000),
  );
const diffId = Number(diff.lastInsertRowid);

const insertChange = sqlite.prepare(
  "insert into changes (diff_id, entity_type, change_kind, entity_key, entity_name, department_path_before, department_path_after, field, before_json, after_json, severity, created_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
);
for (const item of changes) {
  insertChange.run(
    diffId,
    item.entityType,
    item.changeKind,
    item.entityKey,
    item.entityName,
    item.pathBefore,
    item.pathAfter,
    null,
    item.before === null ? null : JSON.stringify(item.before),
    item.after === null ? null : JSON.stringify(item.after),
    item.severity,
    iso(now - 30 * 60 * 1000),
  );
}

const run = sqlite
  .prepare(
    "insert into sync_runs (task_id, trigger, status, phase, started_at, finished_at, department_count, people_count, added_people, removed_people, changed_people, added_departments, removed_departments, changed_departments, snapshot_id, diff_id, requested_by) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
  )
  .run(
    null,
    "manual",
    "success",
    "done",
    iso(now - 32 * 60 * 1000),
    iso(now - 31 * 60 * 1000),
    currentDepts.length,
    currentPeople.length,
    1,
    1,
    2,
    1,
    0,
    2,
    current,
    diffId,
    null,
  );

const nextRun = new Date();
nextRun.setHours(9, 0, 0, 0);
if (nextRun.getTime() <= now) nextRun.setDate(nextRun.getDate() + 1);
while (nextRun.getDay() === 0 || nextRun.getDay() === 6) nextRun.setDate(nextRun.getDate() + 1);

const task = sqlite
  .prepare(
    "insert into watch_tasks (name, description, cron, timezone, enabled, root_department_id, retention_runs, created_by, last_run_at, next_run_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
  )
  .run(
    "每日组织架构巡查",
    "工作日 09:00 拉取通讯录快照并生成差异",
    "0 9 * * 1-5",
    "Asia/Shanghai",
    1,
    "0",
    60,
    null,
    iso(now - 32 * 60 * 1000),
    nextRun.toISOString(),
  );

sqlite.close();
console.log(
  `已完成演示数据: 快照 #${baseline}、#${current}，差异 #${diffId}（${changes.length} 项变更），运行 #${run.lastInsertRowid}，任务 #${task.lastInsertRowid}。`,
);
