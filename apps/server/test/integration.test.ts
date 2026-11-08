import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import fastifyCookie from "@fastify/cookie";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { AppModule } from "../src/app.module.js";
import { startFakeFeishu, type FakeDept, type FakeUser } from "./fake-feishu.js";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

type ApiResult = { status: number; body: any };

function createClient(baseUrl: string) {
  let cookie = "";
  return {
    get cookie() {
      return cookie;
    },
    async call(pathname: string, init: { method?: string; body?: unknown; headers?: Record<string, string> } = {}): Promise<ApiResult> {
      const response = await fetch(`${baseUrl}/api${pathname}`, {
        method: init.method ?? "GET",
        headers: {
          "content-type": "application/json",
          "x-requested-with": "feishu-orgwatch",
          origin: baseUrl,
          ...(cookie ? { cookie } : {}),
          ...(init.headers ?? {}),
        },
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
      });
      const setCookies = response.headers.getSetCookie?.() ?? [];
      if (setCookies.length) cookie = setCookies[0]!.split(";")[0]!;
      const text = await response.text();
      return { status: response.status, body: text ? JSON.parse(text) : null };
    },
  };
}

async function waitRun(client: ReturnType<typeof createClient>, runId: number) {
  for (let index = 0; index < 120; index += 1) {
    const result = await client.call(`/runs/${runId}`);
    const run = result.body?.run;
    if (run && run.status !== "running") return run;
    await sleep(100);
  }
  throw new Error(`run ${runId} did not finish in time`);
}

const departments: FakeDept[] = [
  { id: "d1", parentId: "0", name: "研发部", leaderOpenId: "u1", leaderOpenIds: ["u1", "u4"] },
  { id: "d2", parentId: "d1", name: "平台组" },
  { id: "d3", parentId: "0", name: "市场部" },
];

const people: FakeUser[] = [
  { openId: "u1", name: "张三", email: "zhang@example.com", jobTitle: "负责人", employeeNo: "E1", departmentIds: ["d1"], avatarUrl: "https://example.com/avatar/u1.png" },
  { openId: "u2", name: "李四", email: "li@example.com", jobTitle: "工程师", employeeNo: "E2", departmentIds: ["d1"] },
  { openId: "u3", name: "王五", email: "wang@example.com", jobTitle: "工程师", employeeNo: "E3", departmentIds: ["d2"] },
  { openId: "u4", name: "赵六", email: "zhao@example.com", jobTitle: "专员", employeeNo: "E4", departmentIds: ["d3"] },
];

test("end to end: default admin, sync, diff, inform, ack, rbac", async () => {
  const workspace = mkdtempSync(path.join(os.tmpdir(), "feishu-orgwatch-test-"));
  process.env.ORGWATCH_WORKSPACE = workspace;
  process.env.ORGWATCH_LOG_LEVEL = "error";
  const fake = await startFakeFeishu({ departments, users: people, pageSize: 2 });
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({ logger: false }),
    { logger: ["error"] },
  );
  await app.register(fastifyCookie as never);
  app.setGlobalPrefix("api");
  await app.init();
  await app.listen({ port: 0, host: "127.0.0.1" });
  const baseUrl = (await app.getUrl()).replace(/\/$/, "");
  const admin = createClient(baseUrl);

  try {
    const credentials = readFileSync(path.join(workspace, ".runtime/default-admin.txt"), "utf8");
    const generatedPassword = credentials.match(/^password=(.+)$/m)?.[1] ?? "";
    assert.ok(generatedPassword.length >= 12);
    const setup = await admin.call("/auth/login", {
      method: "POST",
      body: { username: "hawkon", password: generatedPassword },
    });
    assert.equal(setup.status, 201);
    assert.equal(setup.body.user.role, "admin");

    const me = await admin.call("/auth/me");
    assert.equal(me.body.user.username, "hawkon");

    const rejected = await fetch(`${baseUrl}/api/auth/logout`, { method: "POST", headers: { origin: baseUrl } });
    assert.equal(rejected.status, 403);
    const csrfBody = await rejected.json();
    assert.equal(csrfBody.error.code, "CSRF_REQUIRED");

    const settings = await admin.call("/settings", {
      method: "POST",
      body: {
        "feishu.app-id": "cli_test",
        "feishu.app-secret": "test-secret",
        "feishu.api-base": fake.url,
        "feishu.root-department-id": "0",
      },
    });
    assert.equal(settings.status, 201);
    const secretRow = settings.body.items.find((item: { key: string }) => item.key === "feishu.app-secret");
    assert.equal(secretRow.value, "");
    assert.equal(secretRow.configured, true);
    assert.ok(!JSON.stringify(settings.body).includes("test-secret"));

    const testConnection = await admin.call("/settings/feishu/test", { method: "POST", body: {} });
    assert.equal(testConnection.status, 201);
    assert.equal(testConnection.body.ok, true);

    const firstRun = await admin.call("/runs", { method: "POST", body: {} });
    assert.equal(firstRun.status, 201);
    const first = await waitRun(admin, firstRun.body.runId);
    assert.equal(first.status, "success");
    assert.equal(first.diffId, null);

    const directory = await admin.call("/directory/people?pageSize=100");
    assert.equal(directory.body.total, 4);
    assert.ok(directory.body.items.some((item: { name: string }) => item.name === "王五"));

    const departmentsResponse = await admin.call("/directory/departments");
    const research = departmentsResponse.body.items.find((item: { id: string }) => item.id === "d1");
    assert.equal(research.memberCount, 3);
    assert.equal(research.directMemberCount, 2);
    assert.equal(research.leaderName, "张三");
    assert.equal(research.leaderEmail, "zhang@example.com");
    assert.equal(research.leaderJobTitle, "负责人");
    assert.equal(research.leaders.length, 2);
    assert.deepEqual(
      research.leaders.map((leader: { name: string; isMember: boolean; isPrimary: boolean }) => [
        leader.name,
        leader.isMember,
        leader.isPrimary,
      ]),
      [
        ["张三", true, true],
        ["赵六", false, false],
      ],
    );
    const subtree = await admin.call("/directory/people?departmentId=d1&pageSize=100");
    assert.equal(subtree.body.total, 3);
    const direct = await admin.call("/directory/people?departmentId=d1&direct=1&pageSize=100");
    assert.equal(direct.body.total, 2);
    const avatarPerson = directory.body.items.find((item: { name: string }) => item.name === "张三");
    assert.equal(avatarPerson.avatarUrl, "https://example.com/avatar/u1.png");

    fake.setData(
      [
        { id: "d1", parentId: "0", name: "研发中心", leaderOpenId: "u3" },
        { id: "d2", parentId: "0", name: "平台组" },
        { id: "d3", parentId: "0", name: "市场部" },
        { id: "d4", parentId: "0", name: "数据部" },
      ],
      [
        { openId: "u1", name: "张三", email: "zhang@example.com", jobTitle: "负责人", employeeNo: "E1", departmentIds: ["d1"], avatarUrl: "https://example.com/avatar/u1.png" },
        { openId: "u3", name: "王五", email: "wang@example.com", jobTitle: "工程师", employeeNo: "E3", departmentIds: ["d1"] },
        { openId: "u4", name: "赵六", email: "zhao2@example.com", jobTitle: "专员", employeeNo: "E4", departmentIds: ["d3"] },
        { openId: "u6", name: "孙七", email: "sun@example.com", jobTitle: "工程师", employeeNo: "E6", departmentIds: ["d4"] },
      ],
    );

    const secondRun = await admin.call("/runs", { method: "POST", body: {} });
    const second = await waitRun(admin, secondRun.body.runId);
    assert.equal(second.status, "success");
    assert.ok(second.diffId, "second run should produce a diff");

    const diff = await admin.call(`/diffs/${second.diffId}`);
    assert.equal(diff.body.status, "new");
    assert.ok(diff.body.totalChanges >= 5);

    const overview = await admin.call("/overview");
    assert.equal(overview.status, 200);
    assert.equal(overview.body.trend.length, 14);
    assert.equal(typeof overview.body.diffStats.new, "number");
    assert.ok(overview.body.recentDiffs.length >= 1);
    assert.ok(overview.body.recentChanges.length >= 1);
    assert.equal(typeof overview.body.recentChanges[0]?.description, "string");

    const changes = await admin.call(`/diffs/${second.diffId}/changes?pageSize=200`);
    const kinds = new Set(changes.body.items.map((item: { changeKind: string }) => item.changeKind));
    for (const expected of [
      "person_added",
      "person_removed",
      "person_department_changed",
      "person_email_changed",
      "department_renamed",
      "department_moved",
      "department_added",
      "department_leader_changed",
    ]) {
      assert.ok(kinds.has(expected), `missing change kind ${expected}`);
    }

    const csv = await fetch(`${baseUrl}/api/diffs/${second.diffId}/export.csv`, {
      headers: { cookie: admin.cookie, origin: baseUrl, "x-requested-with": "feishu-orgwatch" },
    });
    assert.equal(csv.status, 200);
    assert.match(csv.headers.get("content-type") ?? "", /text\/csv/);
    assert.match(await csv.text(), /人员/);

    const informed = await admin.call(`/diffs/${second.diffId}/informs`, {
      method: "POST",
      body: {
        recipients: [{ type: "user", id: "u1", name: "张三" }],
        note: "请确认",
      },
    });
    assert.equal(informed.status, 201);
    assert.equal(informed.body.deliveries.length, 1);
    assert.equal(informed.body.deliveries[0].status, "sent");
    assert.equal(fake.messages.length, 1);
    assert.equal(fake.messages[0]?.receiveIdType, "open_id");
    const card = JSON.parse(String(fake.messages[0]?.body.content));
    assert.ok(JSON.stringify(card).includes(`/diffs/${second.diffId}`));

    const afterSend = await admin.call(`/diffs/${second.diffId}`);
    assert.equal(afterSend.body.status, "notified");

    const deliveryId = informed.body.deliveries[0].id;
    const acknowledged = await admin.call(`/diffs/${second.diffId}/deliveries/${deliveryId}/ack`, {
      method: "POST",
      body: {},
    });
    assert.equal(acknowledged.status, 201);
    const refreshed = await admin.call(`/diffs/${second.diffId}`);
    assert.equal(refreshed.body.status, "acknowledged");

    const audit = await admin.call("/audit?pageSize=100");
    const actions = new Set(audit.body.items.map((item: { action: string }) => item.action));
    assert.ok(actions.has("diff.inform"));
    assert.ok(actions.has("diff.ack_operator"));

    const created = await admin.call("/admin/users", {
      method: "POST",
      body: {
        username: "viewer1",
        displayName: "只读用户",
        role: "viewer",
        password: "ViewerPass123!",
      },
    });
    assert.equal(created.status, 201);
    const viewer = createClient(baseUrl);
    const login = await viewer.call("/auth/login", {
      method: "POST",
      body: { username: "viewer1", password: "ViewerPass123!" },
    });
    assert.equal(login.status, 201);
    const forbidden = await viewer.call("/runs", { method: "POST", body: {} });
    assert.equal(forbidden.status, 403);
    const readable = await viewer.call("/diffs");
    assert.equal(readable.status, 200);

    const operatorCreated = await admin.call("/admin/users", {
      method: "POST",
      body: {
        username: "operator1",
        displayName: "运营管理员",
        role: "operator",
        password: "OperatorPass123!",
      },
    });
    assert.equal(operatorCreated.status, 201);
    const operatorClient = createClient(baseUrl);
    const operatorLogin = await operatorClient.call("/auth/login", {
      method: "POST",
      body: { username: "operator1", password: "OperatorPass123!" },
    });
    assert.equal(operatorLogin.status, 201);
    const operatorTasks = await operatorClient.call("/tasks");
    assert.equal(operatorTasks.status, 200);
    const operatorSettings = await operatorClient.call("/settings");
    assert.equal(operatorSettings.status, 200);
    assert.ok(operatorSettings.body.items.some((item: { key: string }) => item.key === "card.max-items"));
    assert.ok(operatorSettings.body.items.some((item: { key: string }) => item.key === "notify.auto-enabled"));
    assert.ok(!operatorSettings.body.items.some((item: { key: string }) => item.key === "feishu.app-id"));
    const operatorSettingUpdate = await operatorClient.call("/settings", {
      method: "POST",
      body: { "diff.track-order": "true" },
    });
    assert.equal(operatorSettingUpdate.status, 201);
    const operatorForbiddenSetting = await operatorClient.call("/settings", {
      method: "POST",
      body: { "card.title": "forbidden" },
    });
    assert.equal(operatorForbiddenSetting.status, 403);
    const operatorUsers = await operatorClient.call("/admin/users");
    assert.equal(operatorUsers.status, 403);
    const operatorSystem = await operatorClient.call("/admin/system/status");
    assert.equal(operatorSystem.status, 403);

    const viewerTasks = await viewer.call("/tasks");
    assert.equal(viewerTasks.status, 403);
    const viewerSettings = await viewer.call("/settings");
    assert.equal(viewerSettings.status, 403);
    const viewerSystem = await viewer.call("/admin/system/status");
    assert.equal(viewerSystem.status, 403);
    const viewerInform = await viewer.call(`/diffs/${second.diffId}/informs`, {
      method: "POST",
      body: { recipients: [{ type: "user", id: "u1", name: "张三" }] },
    });
    assert.equal(viewerInform.status, 403);
    const viewerIgnore = await viewer.call(`/diffs/${second.diffId}/resolve`, {
      method: "POST",
      body: { status: "ignored", reason: "普通账户处理" },
    });
    assert.equal(viewerIgnore.status, 201);

    const candidates = await admin.call("/admin/users/feishu-candidates?q=王五");
    assert.equal(candidates.status, 200);
    assert.equal(candidates.body.items.length, 1);
    assert.equal(candidates.body.items[0].imported, false);

    const imported = await admin.call("/admin/users/import", {
      method: "POST",
      body: { openIds: ["u3"], role: "viewer" },
    });
    assert.equal(imported.status, 201);
    assert.equal(imported.body.created.length, 1);
    assert.equal(imported.body.created[0].displayName, "王五");

    const importedAgain = await admin.call("/admin/users/import", {
      method: "POST",
      body: { openIds: ["u3"], role: "viewer" },
    });
    assert.equal(importedAgain.status, 201);
    assert.equal(importedAgain.body.created.length, 0);
    assert.equal(importedAgain.body.skipped.length, 1);

    const users = await admin.call("/admin/users?pageSize=10");
    assert.equal(users.status, 200);
    assert.ok(users.body.total >= 2);
    assert.ok(users.body.stats.admins >= 1);
    const viewerRow = users.body.items.find((item: { username: string }) => item.username === "viewer1");
    assert.ok(viewerRow);
    assert.ok(users.body.items.some((item: { source: string }) => item.source === "feishu"));

    const renamed = await admin.call(`/admin/users/${viewerRow.id}`, {
      method: "PATCH",
      body: { displayName: "只读用户二号" },
    });
    assert.equal(renamed.status, 200);
    assert.equal(renamed.body.user.displayName, "只读用户二号");

    const autoSettings = await admin.call("/settings", {
      method: "POST",
      body: {
        "notify.auto-enabled": "true",
        "notify.auto-recipients": JSON.stringify([{ type: "user", id: "u1", name: "张三" }]),
      },
    });
    assert.equal(autoSettings.status, 201);

    const messagesBefore = fake.messages.length;
    fake.setData(
      [{ id: "d1", parentId: "0", name: "研发中心" }],
      [
        {
          openId: "u1",
          name: "张三",
          email: "zhang@example.com",
          jobTitle: "负责人",
          employeeNo: "E1",
          departmentIds: ["d1"],
          avatarUrl: "https://example.com/avatar/u1.png",
        },
      ],
    );
    const autoRun = await admin.call("/runs", { method: "POST", body: {} });
    const autoResult = await waitRun(admin, autoRun.body.runId);
    assert.equal(autoResult.status, "success");
    assert.ok(autoResult.diffId);
    const autoDiff = await admin.call(`/diffs/${autoResult.diffId}`);
    assert.equal(autoDiff.body.status, "notified");
    const autoInforms = await admin.call(`/diffs/${autoResult.diffId}/informs`);
    assert.equal(autoInforms.body.items.length, 1);
    assert.equal(autoInforms.body.items[0].deliveries[0].status, "sent");
    assert.ok(fake.messages.length >= messagesBefore + 1);

    const selfDelete = await admin.call("/admin/users/1", { method: "DELETE" });
    assert.equal(selfDelete.status, 400);
  } catch (error) {
    console.error("E2E_ERROR", error);
    throw error;
  } finally {
    await app.close();
    await fake.close();
    rmSync(workspace, { recursive: true, force: true });
  }
});
