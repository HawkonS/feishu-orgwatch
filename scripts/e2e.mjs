#!/usr/bin/env node
// 轻量端到端冒烟：真实启动服务，走初始化、登录态、静态资源与关键 API。
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const serverEntry = path.join(ROOT, "apps/server/dist/main.js");
const webIndex = path.join(ROOT, "apps/web/dist/index.html");

if (!existsSync(serverEntry) || !existsSync(webIndex)) {
  console.error("缺少构建产物，请先执行 npm run build。");
  process.exit(1);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

const workspace = mkdtempSync(path.join(os.tmpdir(), "feishu-orgwatch-e2e-"));
const port = await freePort();
const baseUrl = `http://127.0.0.1:${port}`;
const logs = [];

const child = spawn(process.execPath, [serverEntry], {
  cwd: ROOT,
  env: {
    ...process.env,
    NODE_ENV: "production",
    ORGWATCH_WORKSPACE: workspace,
    ORGWATCH_APP_PORT: String(port),
    ORGWATCH_APP_HOST: "127.0.0.1",
    ORGWATCH_LOG_LEVEL: "error",
  },
  stdio: ["ignore", "pipe", "pipe"],
});
child.stdout.on("data", (chunk) => logs.push(String(chunk)));
child.stderr.on("data", (chunk) => logs.push(String(chunk)));

function fail(message) {
  console.error(`✖ ${message}`);
  console.error(logs.join("").slice(-3000));
  child.kill("SIGKILL");
  rmSync(workspace, { recursive: true, force: true });
  process.exit(1);
}

async function waitHealthy() {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      const response = await fetch(`${baseUrl}/api/health`);
      if (response.ok) return;
    } catch {
      // not ready yet
    }
    await sleep(200);
  }
  fail("服务未在预期时间内就绪");
}

let cookie = "";
async function call(pathname, options = {}) {
  const response = await fetch(`${baseUrl}/api${pathname}`, {
    method: options.method ?? "GET",
    headers: {
      "content-type": "application/json",
      "x-requested-with": "feishu-orgwatch",
      origin: baseUrl,
      ...(cookie ? { cookie } : {}),
      ...(options.headers ?? {}),
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const setCookie = response.headers.getSetCookie?.() ?? [];
  if (setCookie.length) cookie = setCookie[0].split(";")[0];
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null, headers: response.headers };
}

try {
  await waitHealthy();

  const root = await fetch(`${baseUrl}/`);
  const rootHtml = await root.text();
  if (root.status !== 200 || !rootHtml.includes("飞书组织架构巡查器")) fail("首页未正确返回");

  const deep = await fetch(`${baseUrl}/diffs/1`);
  if (deep.status !== 200) fail("SPA 深链未回退到 index.html");

  const csrf = await fetch(`${baseUrl}/api/auth/logout`, { method: "POST", headers: { origin: baseUrl } });
  if (csrf.status !== 403) fail("CSRF 防护未生效");

  const credentials = readFileSync(path.join(workspace, ".runtime/default-admin.txt"), "utf8");
  const generatedPassword = credentials.match(/^password=(.+)$/m)?.[1] ?? "";
  const login = await call("/auth/login", {
    method: "POST",
    body: { username: "hawkon", password: generatedPassword },
  });
  if (login.status !== 201) fail(`默认管理员登录失败: ${JSON.stringify(login.body)}`);

  const me = await call("/auth/me");
  if (me.body?.user?.role !== "admin") fail("管理员会话无效");

  const cron = await call("/tasks/validate-cron", {
    method: "POST",
    body: { cron: "0 9 * * *", timezone: "Asia/Shanghai" },
  });
  if (cron.status !== 201 || cron.body.next.length !== 5) fail("cron 校验失败");

  const task = await call("/tasks", {
    method: "POST",
    body: {
      name: "每日巡查",
      cron: "0 9 * * *",
      timezone: "Asia/Shanghai",
      rootDepartmentId: "0",
      enabled: true,
      retentionRuns: 30,
    },
  });
  if (task.status !== 201) fail(`创建任务失败: ${JSON.stringify(task.body)}`);

  const run = await call("/runs", { method: "POST", body: {} });
  if (run.status !== 400) fail("未配置飞书凭据时巡查应被拒绝");

  const diffs = await call("/diffs");
  if (diffs.status !== 200) fail("差异列表不可用");

  console.log("✔ 端到端冒烟通过：静态页面、深链、默认账号、cron、任务、巡查保护");
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
} finally {
  child.kill("SIGTERM");
  await new Promise((resolve) => {
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      resolve();
    }, 5000);
    child.on("exit", () => {
      clearTimeout(timer);
      resolve();
    });
  });
  rmSync(workspace, { recursive: true, force: true });
}
