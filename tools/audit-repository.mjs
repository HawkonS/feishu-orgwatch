#!/usr/bin/env node
// 只读仓库审查：确认敏感文件未入库，并扫描常见凭据特征。
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const git = (...args) =>
  execFileSync("git", ["-c", `safe.directory=${ROOT}`, "-C", ROOT, ...args], { encoding: "utf8" });

const forbiddenPath = (name) =>
  name
    .split("/")
    .some((part) =>
      /^(?:node_modules|dist|coverage|data|\.runtime|logs|backups|test-results|playwright-report|\.env(?!\.example$).*|feishu-orgwatch\.properties.*)$/.test(
        part,
      ),
    ) ||
  /\.(?:sqlite(?:3)?(?:-.*)?|db(?:-.*)?|log|pid|pem|key|p12|pfx|jks|keystore|crt|cer|bak|backup|tgz|zip|tar(?:\.gz)?)$/i.test(
    name,
  );

const signatures = [
  ["private key", /-----BEGIN (?:RSA |EC |OPENSSH |DSA |ENCRYPTED )?PRIVATE KEY-----/],
  ["GitHub token", /\b(?:gh[pousr]_[A-Za-z0-9]{24,}|github_pat_[A-Za-z0-9_]{40,})\b/],
  ["cloud access key", /\b(?:AKIA[A-Z0-9]{16}|LTAI[A-Za-z0-9]{16,}|AKID[A-Za-z0-9]{28,})\b/],
  ["Feishu app secret", /\bcli_[a-z0-9]{16,}\b.*\b[A-Za-z0-9]{32}\b/],
  ["credential in URL", /https?:\/\/[^\s/@"'<>]+:[^\s/@"'<>]+@/],
  ["personal workspace path", /\/(?:Users|home)\/[A-Za-z0-9._-]+\/(?:Desktop|Documents|Project|projects)\//],
];

let files = [];
try {
  files = [
    ...new Set(
      git("ls-files", "--cached", "--others", "--exclude-standard", "-z")
        .split("\0")
        .filter(Boolean),
    ),
  ].sort();
} catch {
  console.error("✖ 当前目录不是 Git 仓库，无法执行仓库审查。");
  process.exit(1);
}

const findings = [];
for (const name of files) {
  if (forbiddenPath(name)) {
    findings.push({ file: name, reason: "敏感或被忽略的文件不应提交" });
    continue;
  }
  let bytes;
  try {
    bytes = readFileSync(path.join(ROOT, name));
  } catch {
    continue;
  }
  if (bytes.includes(0)) continue;
  bytes
    .toString("utf8")
    .split(/\r?\n/)
    .forEach((line, index) => {
      for (const [reason, regex] of signatures) {
        if (regex.test(line)) findings.push({ file: name, line: index + 1, reason });
      }
    });
}

if (findings.length) {
  console.error("✖ 仓库审查发现以下问题：");
  for (const finding of findings) {
    console.error(`  - ${finding.file}${finding.line ? `:${finding.line}` : ""} — ${finding.reason}`);
  }
  process.exit(1);
}

console.log(`✔ 仓库审查通过（检查 ${files.length} 个文件）。`);
