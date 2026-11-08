#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tsx = path.join(root, "node_modules/tsx/dist/cli.mjs");

if (!existsSync(tsx)) {
  console.error("[feishu-orgwatch] 未安装依赖，请先执行 npm ci。");
  process.exit(1);
}

const output = execFileSync(process.execPath, [tsx, path.join(root, "apps/server/src/config/generate.ts")], {
  cwd: root,
  env: process.env,
  encoding: "utf8",
  stdio: ["ignore", "pipe", "inherit"],
});

process.stdout.write(output);
