import { Module } from "@nestjs/common";
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from "@nestjs/core";
import { ConfigService } from "./config/config.service.js";
import { DatabaseService } from "./db/database.service.js";
import { AuditService } from "./audit/audit.service.js";
import { AuditController } from "./audit/audit.controller.js";
import { AuditReadInterceptor } from "./audit/audit-read.interceptor.js";
import { SettingsService } from "./settings/settings.service.js";
import { SettingsController } from "./settings/settings.controller.js";
import { FeishuClient } from "./feishu/feishu.client.js";
import { DirectoryFetcher } from "./feishu/directory.fetcher.js";
import { SnapshotService } from "./sync/snapshot.service.js";
import { SyncService } from "./sync/sync.service.js";
import { SchedulerService } from "./sync/scheduler.service.js";
import { RunsController } from "./sync/runs.controller.js";
import { TasksService } from "./tasks/tasks.service.js";
import { TasksController } from "./tasks/tasks.controller.js";
import { DiffService } from "./diff/diff.service.js";
import { DiffController } from "./diff/diff.controller.js";
import { InformService } from "./inform/inform.service.js";
import { DirectoryController } from "./directory/directory.controller.js";
import { AuthService } from "./auth/auth.service.js";
import { FeishuOAuthService } from "./auth/oauth.service.js";
import { AuthController } from "./auth/auth.controller.js";
import { AdminController } from "./auth/admin.controller.js";
import { AuthGuard } from "./auth/auth.guard.js";
import { HealthController } from "./health.controller.js";
import { AllExceptionsFilter } from "./common/exception.filter.js";
import { SystemService } from "./system/system.service.js";
import { SystemController } from "./system/system.controller.js";

@Module({
  controllers: [
    AuthController,
    AdminController,
    SettingsController,
    DirectoryController,
    RunsController,
    TasksController,
    DiffController,
    AuditController,
    SystemController,
    HealthController,
  ],
  providers: [
    ConfigService,
    DatabaseService,
    AuditService,
    SettingsService,
    FeishuClient,
    DirectoryFetcher,
    SnapshotService,
    SyncService,
    SchedulerService,
    TasksService,
    DiffService,
    InformService,
    AuthService,
    FeishuOAuthService,
    SystemService,
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_INTERCEPTOR, useClass: AuditReadInterceptor },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
  ],
})
export class AppModule {}
