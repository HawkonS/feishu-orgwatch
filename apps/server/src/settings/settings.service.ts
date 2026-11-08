import { Inject, Injectable, Logger } from "@nestjs/common";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { ConfigService } from "../config/config.service.js";
import { DatabaseService } from "../db/database.service.js";
import { appSettings } from "../db/schema.js";
import { badRequest } from "../common/errors.js";

export type SettingKind = "string" | "secret" | "number" | "boolean";

export type SettingSpec = {
  key: string;
  label: string;
  kind: SettingKind;
  defaultValue: string;
  description: string;
  min?: number;
  max?: number;
};

export const OPERATOR_SETTING_KEYS = new Set([
  "card.max-items",
  "diff.track-order",
  "diff.track-title",
  "diff.track-employee-no",
  "notify.auto-enabled",
  "notify.auto-recipients",
]);

export const SETTING_SPECS: SettingSpec[] = [
  {
    key: "feishu.app-id",
    label: "飞书 App ID",
    kind: "string",
    defaultValue: "",
    description: "",
  },
  {
    key: "feishu.app-secret",
    label: "飞书 App Secret",
    kind: "secret",
    defaultValue: "",
    description: "",
  },
  {
    key: "feishu.api-base",
    label: "飞书开放平台地址",
    kind: "string",
    defaultValue: "https://open.feishu.cn",
    description: "",
  },
  {
    key: "feishu.root-department-id",
    label: "默认根部门",
    kind: "string",
    defaultValue: "0",
    description: "0 表示全部组织",
  },
  {
    key: "feishu.auto-provision",
    label: "允许飞书扫码自动开通账号",
    kind: "boolean",
    defaultValue: "true",
    description: "",
  },
  {
    key: "feishu.allowed-email-domains",
    label: "自动开通邮箱域白名单",
    kind: "string",
    defaultValue: "",
    description: "",
  },
  {
    key: "card.title",
    label: "卡片标题",
    kind: "string",
    defaultValue: "组织架构变更提醒",
    description: "",
  },
  {
    key: "card.max-items",
    label: "卡片展示变更条数",
    kind: "number",
    defaultValue: "8",
    description: "",
    min: 1,
    max: 20,
  },
  {
    key: "diff.track-order",
    label: "追踪部门排序变化",
    kind: "boolean",
    defaultValue: "false",
    description: "",
  },
  {
    key: "diff.track-title",
    label: "追踪职位变化",
    kind: "boolean",
    defaultValue: "true",
    description: "",
  },
  {
    key: "diff.track-employee-no",
    label: "追踪工号变化",
    kind: "boolean",
    defaultValue: "true",
    description: "",
  },
  {
    key: "notify.auto-enabled",
    label: "检测到差异后自动发送",
    kind: "boolean",
    defaultValue: "false",
    description: "",
  },
  {
    key: "notify.auto-recipients",
    label: "自动通知收件人",
    kind: "string",
    defaultValue: "[]",
    description: "",
  },
  {
    key: "sync.retention-runs",
    label: "保留快照份数",
    kind: "number",
    defaultValue: "60",
    description: "至少保留 2 份",
    min: 2,
    max: 365,
  },
];

const SPEC_BY_KEY = new Map(SETTING_SPECS.map((spec) => [spec.key, spec]));

export type FeishuCredentials = {
  appId: string;
  appSecret: string;
  apiBase: string;
  rootDepartmentId: string;
  configured: boolean;
};

@Injectable()
export class SettingsService {
  private readonly logger = new Logger(SettingsService.name);

  constructor(
    @Inject(ConfigService) private readonly config: ConfigService,
    @Inject(DatabaseService) private readonly database: DatabaseService,
  ) {}

  private encrypt(value: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.config.secretKey, iv);
    const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `v1.${iv.toString("base64url")}.${tag.toString("base64url")}.${ciphertext.toString("base64url")}`;
  }

  private decrypt(value: string): string {
    const parts = value.split(".");
    if (parts.length !== 4 || parts[0] !== "v1") throw new Error("unsupported ciphertext");
    const iv = Buffer.from(parts[1] ?? "", "base64url");
    const tag = Buffer.from(parts[2] ?? "", "base64url");
    const ciphertext = Buffer.from(parts[3] ?? "", "base64url");
    const decipher = createDecipheriv("aes-256-gcm", this.config.secretKey, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
  }

  private defaultValue(spec: SettingSpec): string {
    const fromProperties = this.config.get(spec.key);
    return fromProperties || spec.defaultValue;
  }

  get(key: string): string {
    const spec = SPEC_BY_KEY.get(key);
    if (!spec) throw badRequest(`未知配置项: ${key}`);
    const row = this.database.db
      .select()
      .from(appSettings)
      .where(eq(appSettings.key, key))
      .get();
    if (!row) return this.defaultValue(spec);
    if (spec.kind === "secret") {
      try {
        return this.decrypt(row.value);
      } catch (error) {
        this.logger.warn(`无法解密配置项 ${key}，请重新录入：${(error as Error).message}`);
        return "";
      }
    }
    return row.value;
  }

  getNumber(key: string, fallback: number, min?: number, max?: number): number {
    const raw = this.get(key).trim();
    if (!raw) return fallback;
    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) return fallback;
    if (min !== undefined && parsed < min) return min;
    if (max !== undefined && parsed > max) return max;
    return parsed;
  }

  getBoolean(key: string, fallback: boolean): boolean {
    const value = this.get(key).toLowerCase();
    if (["1", "true", "yes", "on"].includes(value)) return true;
    if (["0", "false", "no", "off"].includes(value)) return false;
    return fallback;
  }

  validate(key: string, value: string): string {
    const spec = SPEC_BY_KEY.get(key);
    if (!spec) throw badRequest(`未知配置项: ${key}`);
    const trimmed = value.trim();
    if (spec.kind === "boolean" && !["true", "false"].includes(trimmed)) {
      throw badRequest(`${spec.label} 只能是 true 或 false`);
    }
    if (spec.kind === "number") {
      const number = Number(trimmed);
      if (!Number.isFinite(number)) throw badRequest(`${spec.label} 必须是数字`);
      if (spec.min !== undefined && number < spec.min) {
        throw badRequest(`${spec.label} 不得小于 ${spec.min}`);
      }
      if (spec.max !== undefined && number > spec.max) {
        throw badRequest(`${spec.label} 不得大于 ${spec.max}`);
      }
    }
    if (trimmed.length > 2000) throw badRequest(`${spec.label} 过长`);
    if (key === "notify.auto-recipients") {
      let parsed: unknown;
      try {
        parsed = JSON.parse(trimmed || "[]");
      } catch {
        throw badRequest("自动通知收件人格式不正确");
      }
      if (!Array.isArray(parsed) || parsed.length > 200) {
        throw badRequest("自动通知收件人必须是最多 200 项的数组");
      }
      const recipients = parsed.map((item) => {
        const value = item as { type?: string; id?: string; name?: string };
        if ((value.type !== "user" && value.type !== "chat") || !value.id?.trim()) {
          throw badRequest("自动通知收件人格式不正确");
        }
        return {
          type: value.type,
          id: value.id.trim(),
          name: value.name?.trim().slice(0, 200) || value.id.trim(),
        };
      });
      return JSON.stringify(recipients);
    }
    return trimmed;
  }

  update(patch: Record<string, unknown>): void {
    const entries = Object.entries(patch);
    if (!entries.length) throw badRequest("没有需要保存的配置");
    for (const [key, raw] of entries) {
      const spec = SPEC_BY_KEY.get(key);
      if (!spec) throw badRequest(`未知配置项: ${key}`);
      if (raw === undefined) continue;
      const text = this.validate(key, String(raw));
      const stored = spec.kind === "secret" ? this.encrypt(text) : text;
      const existing = this.database.db
        .select({ key: appSettings.key })
        .from(appSettings)
        .where(eq(appSettings.key, key))
        .get();
      const nowIso = new Date().toISOString();
      if (existing) {
        this.database.db
          .update(appSettings)
          .set({ value: stored, isSecret: spec.kind === "secret", updatedAt: nowIso })
          .where(eq(appSettings.key, key))
          .run();
      } else {
        this.database.db
          .insert(appSettings)
          .values({ key, value: stored, isSecret: spec.kind === "secret", updatedAt: nowIso })
          .run();
      }
    }
  }

  list(): Array<SettingSpec & { value: string; configured: boolean }> {
    return SETTING_SPECS.map((spec) => {
      const value = spec.kind === "secret" ? "" : this.get(spec.key);
      return {
        ...spec,
        value,
        configured: spec.kind === "secret" ? this.get(spec.key).length > 0 : true,
      };
    });
  }

  getFeishu(): FeishuCredentials {
    const appId = this.get("feishu.app-id");
    const appSecret = this.get("feishu.app-secret");
    const apiBase = (this.get("feishu.api-base") || "https://open.feishu.cn").replace(/\/+$/, "");
    const rootDepartmentId = this.get("feishu.root-department-id") || "0";
    return {
      appId,
      appSecret,
      apiBase,
      rootDepartmentId,
      configured: Boolean(appId && appSecret),
    };
  }

  feishuLoginEnabled(): boolean {
    return this.getFeishu().configured;
  }

  allowAutoProvision(email: string | null | undefined): boolean {
    if (!this.getBoolean("feishu.auto-provision", true)) return false;
    const domains = this.get("feishu.allowed-email-domains")
      .split(",")
      .map((item) => item.trim().toLowerCase())
      .filter(Boolean);
    if (!domains.length) return true;
    const domain = (email ?? "").split("@")[1]?.toLowerCase() ?? "";
    return Boolean(domain) && domains.includes(domain);
  }
}
