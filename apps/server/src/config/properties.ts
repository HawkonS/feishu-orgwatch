import { randomBytes } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

export type PropertySpec = {
  key: string;
  value: string;
  comment: string;
  secret?: boolean;
};

export const PROPERTY_SPECS: PropertySpec[] = [
  { key: "app.site-name", value: "飞书组织架构巡查器", comment: "页面标题与卡片署名" },
  { key: "app.copyright", value: "© 2026 HawkonS", comment: "页面页脚版权文本，留空则不显示" },
  { key: "app.host", value: "0.0.0.0", comment: "监听地址" },
  { key: "app.port", value: "18080", comment: "监听端口（API 与前端共用）" },
  {
    key: "app.public-base-url",
    value: "http://127.0.0.1:18080",
    comment: "外部访问地址，用于飞书卡片里的详情链接",
  },
  { key: "app.timezone", value: "Asia/Shanghai", comment: "展示时区与默认任务时区" },
  { key: "bootstrap.admin-username", value: "hawkon", comment: "首次启动自动创建的默认管理员用户名" },
  { key: "bootstrap.admin-password", value: "", comment: "默认管理员初始密码；留空自动生成随机密码并写入 .runtime/default-admin.txt" },
  { key: "bootstrap.admin-display-name", value: "Hawkon", comment: "默认管理员显示名称" },
  { key: "update.remote-url", value: "https://github.com/HawkonS/feishu-orgwatch.git", comment: "系统更新拉取的 Git 仓库地址" },
  { key: "update.branch", value: "main", comment: "系统更新跟踪的分支" },
  {
    key: "app.workspace",
    value: ".",
    comment: "数据目录（SQLite、密钥、日志、运行状态），相对路径基于仓库根目录",
  },
  { key: "feishu.app-id", value: "", comment: "飞书自建应用 App ID，也可在平台设置页填写" },
  {
    key: "feishu.app-secret",
    value: "",
    comment: "飞书自建应用 App Secret，也可在平台设置页填写（加密保存）",
    secret: true,
  },
  { key: "feishu.api-base", value: "https://open.feishu.cn", comment: "飞书开放平台地址" },
  { key: "feishu.root-department-id", value: "0", comment: "默认巡查根部门 ID，0 表示全部" },
  { key: "sync.request-timeout-ms", value: "15000", comment: "单次飞书请求超时（毫秒）" },
  { key: "sync.concurrency", value: "4", comment: "通讯录抓取并发数" },
  { key: "sync.max-departments", value: "10000", comment: "单次快照部门上限" },
  { key: "sync.max-people", value: "100000", comment: "单次快照人员上限" },
  { key: "sync.retention-runs", value: "60", comment: "保留最近多少份成功快照（至少 2）" },
  { key: "sync.retention-days", value: "90", comment: "快照最长保留天数" },
  { key: "security.secret-key", value: "", comment: "凭据加密密钥（base64 32 字节），留空自动生成 data/secret.key", secret: true },
  { key: "security.cookie-secure", value: "auto", comment: "会话 Cookie 是否仅 HTTPS：auto 跟随 app.public-base-url，也可强制 true/false" },
  { key: "security.trust-proxy", value: "false", comment: "反向代理场景设为 true 以读取真实客户端 IP" },
  { key: "log.level", value: "info", comment: "日志级别：fatal/error/warn/info/debug/trace" },
];

export function parseProperties(text: string): Record<string, string> {
  const values: Record<string, string> = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#") || line.startsWith(";")) continue;
    const index = line.indexOf("=");
    if (index <= 0) continue;
    const key = line.slice(0, index).trim();
    const value = line.slice(index + 1).trim();
    if (key) values[key] = value;
  }
  return values;
}

export function envKeyFor(propertyKey: string): string {
  if (propertyKey === "app.workspace") return "ORGWATCH_WORKSPACE";
  return `ORGWATCH_${propertyKey.toUpperCase().replace(/[.-]/g, "_")}`;
}

export function envOverrides(env: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const overrides: Record<string, string> = {};
  for (const spec of PROPERTY_SPECS) {
    const envKey = envKeyFor(spec.key);
    const value = env[envKey];
    if (value !== undefined && value !== "") overrides[spec.key] = value;
  }
  return overrides;
}

export function renderProperties(existing: Record<string, string>): string {
  const used = new Set<string>();
  const lines: string[] = [
    "# feishu-orgwatch 配置",
    "# 首次启动自动生成；缺失项会自动补齐。该文件包含敏感信息，不要提交到 Git。",
    "# 环境变量 ORGWATCH_<KEY> 可覆盖对应配置，例如 ORGWATCH_APP_PORT 覆盖 app.port。",
    "",
  ];
  for (const spec of PROPERTY_SPECS) {
    const value = existing[spec.key] ?? spec.value;
    used.add(spec.key);
    lines.push(`# ${spec.comment}`);
    lines.push(`${spec.key}=${value}`);
    lines.push("");
  }
  for (const [key, value] of Object.entries(existing)) {
    if (used.has(key)) continue;
    lines.push(`${key}=${value}`);
  }
  return `${lines.join("\n").trimEnd()}\n`;
}

export function ensureSecretKey(
  workspace: string,
  configured: string,
  onGenerated?: (file: string) => void,
): Buffer {
  const value = configured.trim();
  if (value) {
    const buffer = Buffer.from(value, "base64");
    if (buffer.length !== 32) throw new Error("security.secret-key 必须是 base64 编码的 32 字节密钥");
    return buffer;
  }
  const dataDir = path.join(workspace, "data");
  mkdirSync(dataDir, { recursive: true });
  const file = path.join(dataDir, "secret.key");
  if (existsSync(file)) {
    const buffer = Buffer.from(readFileSync(file, "utf8").trim(), "base64");
    if (buffer.length === 32) return buffer;
  }
  const generated = randomBytes(32);
  writeFileSync(file, `${generated.toString("base64")}\n`, { mode: 0o600 });
  chmodSync(file, 0o600);
  onGenerated?.(file);
  return generated;
}
