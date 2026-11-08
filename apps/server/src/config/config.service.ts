import { Injectable } from "@nestjs/common";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  PROPERTY_SPECS,
  envOverrides,
  ensureSecretKey,
  parseProperties,
} from "./properties.js";

const CONFIG_DIR = path.dirname(fileURLToPath(import.meta.url));

export const REPO_ROOT = path.resolve(CONFIG_DIR, "../../../..");

@Injectable()
export class ConfigService {
  readonly repoRoot = REPO_ROOT;
  readonly workspace: string;
  readonly dataDir: string;
  readonly runtimeDir: string;
  readonly logDir: string;
  readonly dbPath: string;
  readonly tokenPath: string;
  readonly lockPath: string;
  readonly propertiesPath: string;
  readonly webDist: string;
  readonly docsDir: string;
  readonly secretKey: Buffer;
  readonly isProduction: boolean;
  private readonly values: Record<string, string>;

  constructor() {
    this.propertiesPath = path.join(this.repoRoot, "feishu-orgwatch.properties");
    const defaults = Object.fromEntries(PROPERTY_SPECS.map((item) => [item.key, item.value]));
    const fileValues = existsSync(this.propertiesPath)
      ? parseProperties(readFileSync(this.propertiesPath, "utf8"))
      : {};
    this.values = { ...defaults, ...fileValues, ...envOverrides(process.env) };
    this.isProduction = process.env.NODE_ENV === "production";

    const rawWorkspace = this.values["app.workspace"] || ".";
    this.workspace = path.resolve(this.repoRoot, rawWorkspace);
    this.dataDir = path.join(this.workspace, "data");
    this.runtimeDir = path.join(this.workspace, ".runtime");
    this.logDir = path.join(this.runtimeDir, "logs");
    this.dbPath = path.join(this.dataDir, "feishu-orgwatch.sqlite");
    this.tokenPath = path.join(this.runtimeDir, "initial-admin-token");
    this.lockPath = path.join(this.runtimeDir, "server.lock");
    this.webDist = path.join(this.repoRoot, "apps/web/dist");
    this.docsDir = path.join(this.repoRoot, "docs");

    for (const dir of [this.workspace, this.dataDir, this.runtimeDir, this.logDir]) {
      mkdirSync(dir, { recursive: true });
    }
    this.secretKey = ensureSecretKey(
      this.workspace,
      this.values["security.secret-key"] ?? "",
      (file) => {
        process.stderr.write(
          `[feishu-orgwatch] 已生成凭据加密密钥：${file}，请与数据库一起备份。\n`,
        );
      },
    );
  }

  get(key: string): string {
    return this.values[key] ?? "";
  }

  number(key: string, fallback: number): number {
    const raw = this.get(key).trim();
    if (!raw) return fallback;
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  boolean(key: string, fallback: boolean): boolean {
    const value = this.get(key).toLowerCase();
    if (["1", "true", "yes", "on"].includes(value)) return true;
    if (["0", "false", "no", "off"].includes(value)) return false;
    return fallback;
  }

  get host(): string {
    return this.get("app.host") || "0.0.0.0";
  }

  get port(): number {
    const port = this.number("app.port", 18080);
    return port >= 1 && port <= 65535 ? port : 18080;
  }

  get publicBaseUrl(): string {
    const configured = this.get("app.public-base-url").replace(/\/+$/, "");
    if (configured) return configured;
    return `http://127.0.0.1:${this.port}`;
  }

  get timezone(): string {
    return this.get("app.timezone") || "Asia/Shanghai";
  }

  get siteName(): string {
    return this.get("app.site-name") || "飞书组织架构巡查器";
  }

  get copyright(): string {
    return this.get("app.copyright");
  }

  get logLevel(): string {
    return this.get("log.level") || "info";
  }

  get trustProxy(): boolean {
    return this.boolean("security.trust-proxy", false);
  }

  get cookieSecure(): boolean {
    const value = this.get("security.cookie-secure").toLowerCase();
    if (value === "true") return true;
    if (value === "false") return false;
    return this.isProduction;
  }

  get properties(): Record<string, string> {
    return { ...this.values };
  }

  get feishuDefaults(): { appId: string; appSecret: string; apiBase: string; rootDepartmentId: string } {
    return {
      appId: this.get("feishu.app-id"),
      appSecret: this.get("feishu.app-secret"),
      apiBase: this.get("feishu.api-base") || "https://open.feishu.cn",
      rootDepartmentId: this.get("feishu.root-department-id") || "0",
    };
  }
}

export const ConfigServiceToken = ConfigService;
export type { ConfigService as ConfigServiceType };

export function createConfigService(): ConfigService {
  const service = new ConfigService();
  return service;
}

export function configProvider() {
  return { provide: ConfigService, useFactory: () => new ConfigService() };
}

