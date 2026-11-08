import { Inject, Body, Controller, Get, Post } from "@nestjs/common";
import { ConfigService } from "../config/config.service.js";
import { OPERATOR_SETTING_KEYS, SettingsService } from "./settings.service.js";
import { FeishuClient } from "../feishu/feishu.client.js";
import { CurrentUser, Roles } from "../auth/auth.guard.js";
import type { SessionUser } from "../auth/auth.service.js";
import { AuditService } from "../audit/audit.service.js";
import { forbidden } from "../common/errors.js";

@Controller("settings")
export class SettingsController {
  constructor(
    @Inject(SettingsService) private readonly settings: SettingsService,
    @Inject(FeishuClient) private readonly client: FeishuClient,
    @Inject(ConfigService) private readonly config: ConfigService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  @Get()
  @Roles("admin", "operator")
  get(@CurrentUser() actor: SessionUser) {
    const items = this.settings.list();
    return {
      items: actor.role === "admin" ? items : items.filter((item) => OPERATOR_SETTING_KEYS.has(item.key)),
      siteName: this.config.siteName,
      copyright: this.config.copyright,
      publicBaseUrl: this.config.publicBaseUrl,
      timezone: this.config.timezone,
    };
  }

  @Post()
  @Roles("admin", "operator")
  update(@CurrentUser() actor: SessionUser, @Body() body: unknown) {
    const patch = (body ?? {}) as Record<string, unknown>;
    if (actor.role !== "admin") {
      const denied = Object.keys(patch).filter((key) => !OPERATOR_SETTING_KEYS.has(key));
      if (denied.length) throw forbidden(`运营管理员不能修改这些配置：${denied.join("、")}`);
    }
    this.settings.update(patch);
    this.audit.record({
      actorId: actor.id,
      actorName: actor.displayName,
      action: "settings.update",
      detail: { keys: Object.keys(patch) },
    });
    const items = this.settings.list();
    return {
      items: actor.role === "admin" ? items : items.filter((item) => OPERATOR_SETTING_KEYS.has(item.key)),
    };
  }

  @Post("feishu/test")
  @Roles("admin")
  async test(@CurrentUser() actor: SessionUser) {
    const result = await this.client.testConnection();
    this.audit.record({
      actorId: actor.id,
      actorName: actor.displayName,
      action: "settings.feishu_test",
      detail: result,
    });
    return result;
  }

  @Get("chats")
  @Roles("admin", "operator")
  async chats() {
    try {
      const items = await this.client.listChats();
      return { items, warning: null };
    } catch (error) {
      return {
        items: [],
        warning: `无法读取机器人所在群：${(error as Error).message}。可手工填写 chat_id。`,
      };
    }
  }
}
