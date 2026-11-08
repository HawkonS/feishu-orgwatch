import { Inject, Controller, Get, Logger, Res } from "@nestjs/common";
import type { FastifyReply } from "fastify";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { ConfigService } from "./config/config.service.js";
import { DatabaseService } from "./db/database.service.js";
import { SyncService } from "./sync/sync.service.js";
import { SchedulerService } from "./sync/scheduler.service.js";
import { SystemService } from "./system/system.service.js";
import { Public } from "./auth/auth.guard.js";
import { nowIso } from "./common/text.js";

@Controller()
export class HealthController {
  private readonly logger = new Logger(HealthController.name);

  constructor(
    @Inject(ConfigService) private readonly config: ConfigService,
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(SyncService) private readonly sync: SyncService,
    @Inject(SchedulerService) private readonly scheduler: SchedulerService,
    @Inject(SystemService) private readonly system: SystemService,
  ) {}

  private version(): string {
    try {
      const pkg = JSON.parse(readFileSync(path.join(this.config.repoRoot, "package.json"), "utf8")) as {
        version?: string;
      };
      return pkg.version ?? "0.1.0";
    } catch {
      return "0.1.0";
    }
  }

  @Public()
  @Get("health")
  health() {
    const databaseOk = this.database.healthy();
    const lastRun = this.sync.lastRun();
    return {
      status: databaseOk ? "ok" : "degraded",
      database: databaseOk ? "ok" : "error",
      scheduler: {
        lastTickAt: this.scheduler.lastTickAt,
        running: this.sync.isBusy(),
      },
      lastRun: lastRun
        ? {
            id: lastRun.id,
            status: lastRun.status,
            startedAt: lastRun.startedAt,
            finishedAt: lastRun.finishedAt,
            diffId: lastRun.diffId,
          }
        : null,
      version: this.version(),
      time: nowIso(),
    };
  }

  @Public()
  @Get("meta")
  async meta() {
    const build = await this.system.buildInfo();
    return {
      name: "feishu-orgwatch",
      version: this.version(),
      build: build.build,
      updatedAt: build.updatedAt,
      siteName: this.config.siteName,
      copyright: this.config.copyright,
      timezone: this.config.timezone,
      node: process.version,
    };
  }

  @Public()
  @Get("openapi.yaml")
  openapi(@Res() reply: FastifyReply) {
    const file = path.join(this.config.docsDir, "openapi.yaml");
    if (!existsSync(file)) {
      return reply.code(404).send({ error: { code: "NOT_FOUND", message: "OpenAPI 文档不存在" } });
    }
    return reply.header("content-type", "application/yaml; charset=utf-8").send(readFileSync(file, "utf8"));
  }
}
