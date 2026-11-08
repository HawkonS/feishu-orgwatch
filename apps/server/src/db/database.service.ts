import { Inject, Injectable, OnModuleDestroy } from "@nestjs/common";
import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import path from "node:path";
import { ConfigService } from "../config/config.service.js";
import * as schema from "./schema.js";

export type AppDatabase = BetterSQLite3Database<typeof schema>;

@Injectable()
export class DatabaseService implements OnModuleDestroy {
  readonly sqlite: Database.Database;
  readonly db: AppDatabase;

  constructor(@Inject(ConfigService) private readonly config: ConfigService) {
    this.sqlite = new Database(config.dbPath);
    this.sqlite.pragma("journal_mode = WAL");
    this.sqlite.pragma("foreign_keys = ON");
    this.sqlite.pragma("busy_timeout = 5000");
    this.sqlite.pragma("synchronous = NORMAL");
    this.db = drizzle(this.sqlite, { schema });
    migrate(this.db, {
      migrationsFolder: path.join(config.repoRoot, "apps/server/drizzle"),
    });
  }

  transaction<T>(fn: () => T): T {
    return this.sqlite.transaction(fn)();
  }

  healthy(): boolean {
    try {
      this.sqlite.prepare("select 1 as ok").get();
      return true;
    } catch {
      return false;
    }
  }

  backupTo(file: string): void {
    this.sqlite.prepare("VACUUM INTO ?").run(file);
  }

  onModuleDestroy(): void {
    this.sqlite.close();
  }
}

export { schema };
