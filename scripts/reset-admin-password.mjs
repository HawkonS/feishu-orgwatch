#!/usr/bin/env node
// 重置管理员密码；直接改写 SQLite 并吊销该账号的会话。
import { existsSync, readFileSync, unlinkSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes, scryptSync } from "node:crypto";
import { createInterface } from "node:readline/promises";
import Database from "better-sqlite3";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
let username = "";
let passwordFromStdin = false;
let password = "";
let enable = false;
let assumeYes = false;

for (let index = 0; index < args.length; index += 1) {
  const arg = args[index];
  if (arg === "--user" || arg === "-u") {
    username = args[++index] ?? "";
  } else if (arg === "--password" || arg === "-p") {
    password = args[++index] ?? "";
  } else if (arg === "--password-stdin") {
    passwordFromStdin = true;
  } else if (arg === "--enable") {
    enable = true;
  } else if (arg === "--yes" || arg === "-y") {
    assumeYes = true;
  } else if (arg === "--help" || arg === "-h") {
    console.log(`用法: tools/reset_admin_password.sh [选项] [用户名]

  用户名                  要重置的管理员账号；省略时自动选择唯一的管理员
  --user, -u <用户名>      同上
  --password, -p <密码>    直接指定新密码；不指定则随机生成临时密码
  --password-stdin         从标准输入读取新密码
  --enable                 同时恢复被停用的账号
  --yes, -y                跳过确认
`);
    process.exit(0);
  } else if (!arg.startsWith("-") && !username) {
    username = arg;
  } else {
    console.error(`未知参数: ${arg}`);
    process.exit(2);
  }
}

const workspace = path.resolve(ROOT, process.env.ORGWATCH_WORKSPACE || ".");
const dbFile = path.join(workspace, "data/feishu-orgwatch.sqlite");

if (!existsSync(dbFile)) {
  console.error(`数据库不存在: ${dbFile}，请先启动一次服务完成初始化。`);
  process.exit(1);
}

if (passwordFromStdin) {
  password = readFileSync(0, "utf8").trim();
}

if (password && (password.length < 12 || password.length > 256)) {
  console.error("密码长度必须为 12–256 个字符。");
  process.exit(1);
}

const db = new Database(dbFile);
db.pragma("foreign_keys = ON");

let user;
if (username) {
  user = db.prepare("select id, username, role, status from users where username = ?").get(username);
  if (!user) {
    const rows = db.prepare("select username, role from users order by id").all();
    console.error(`账号 ${username} 不存在。现有账号：`);
    for (const row of rows) console.error(`  - ${row.username} (${row.role})`);
    db.close();
    process.exit(1);
  }
} else {
  const admins = db.prepare("select id, username, role, status from users where role = 'admin' order by id").all();
  if (!admins.length) {
    console.error("数据库中没有管理员账号。");
    db.close();
    process.exit(1);
  }
  if (admins.length > 1) {
    console.error(`检测到多个管理员（${admins.map((row) => row.username).join("、")}），请指定用户名。`);
    db.close();
    process.exit(1);
  }
  user = admins[0];
}

if (user.role !== "admin") {
  console.error(`${user.username} 不是管理员，拒绝重置。`);
  db.close();
  process.exit(1);
}

if (!assumeYes && process.stdin.isTTY) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = (await rl.question(`将重置 ${user.username} 的密码并注销其现有会话，继续？[y/N] `)).trim();
  rl.close();
  if (!/^y(es)?$/i.test(answer)) {
    console.log("已取消，密码未更改。");
    db.close();
    process.exit(0);
  }
}

if (!password) password = randomBytes(12).toString("base64url");

const salt = randomBytes(16).toString("hex");
const hash = scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1 }).toString("hex");
const passwordHash = `scrypt$${salt}$${hash}`;
const now = new Date().toISOString();

db.transaction(() => {
  db.prepare("update users set password_hash = ?, updated_at = ? where id = ?").run(passwordHash, now, user.id);
  if (enable) {
    db.prepare("update users set status = 'active', updated_at = ? where id = ?").run(now, user.id);
  }
  db.prepare("delete from sessions where user_id = ?").run(user.id);
})();

db.close();
const credentialFile = path.join(workspace, ".runtime/default-admin.txt");
try {
  if (existsSync(credentialFile) && readFileSync(credentialFile, "utf8").includes(`username=${user.username}\n`)) {
    unlinkSync(credentialFile);
  }
} catch {
  // Best effort; the reset password below is still authoritative.
}
console.log(`已重置账号 ${user.username} 的密码，并吊销其全部会话。`);
console.log(`临时密码: ${password}`);
console.log("请登录后尽快修改密码；如服务正在运行，密码立即生效。");
