import { Inject, Injectable, type OnModuleInit } from "@nestjs/common";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import {
  closeSync,
  existsSync,
  fstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { ConfigService } from "../config/config.service.js";
import { DatabaseService } from "../db/database.service.js";
import { badRequest, conflict } from "../common/errors.js";
import { nowIso } from "../common/text.js";

const execFileAsync = promisify(execFile);
const ACTIVE_STATES = new Set(["queued", "running", "restarting"]);

export type UpdateState = {
  jobId: string | null;
  state: string;
  message: string;
  startedAt: string | null;
  updatedAt: string | null;
};

type UpdateCommit = {
  hash: string;
  author: string;
  date: string;
  subject: string;
};

@Injectable()
export class SystemService implements OnModuleInit {
  private readonly startedAt = new Date(Date.now() - process.uptime() * 1000).toISOString();

  constructor(
    @Inject(ConfigService) private readonly config: ConfigService,
    @Inject(DatabaseService) private readonly database: DatabaseService,
  ) {}

  onModuleInit() {
    // A systemd restart can terminate the update shell before it writes its
    // final state. The new backend proves the restart succeeded by booting.
    const state = this.readState();
    if (state.state === "restarting") {
      this.writeState({
        jobId: state.jobId,
        state: "succeeded",
        message: "服务已重启，更新完成",
        startedAt: state.startedAt,
        updatedAt: nowIso(),
      });
    }
  }

  private get stateFile(): string {
    return path.join(this.config.dataDir, "update-state.json");
  }

  private get logDir(): string {
    return this.config.logDir;
  }

  private async git(args: string[], timeout = 20_000): Promise<string> {
    try {
      const { stdout } = await execFileAsync("git", args, {
        cwd: this.config.repoRoot,
        timeout,
        maxBuffer: 1024 * 1024,
        env: {
          ...process.env,
          GIT_TERMINAL_PROMPT: "0",
          GIT_ASKPASS: "true",
        },
      });
      return String(stdout).trim();
    } catch (error) {
      const failure = error as { stderr?: string; message?: string; killed?: boolean };
      const raw = failure.stderr || failure.message || "未知错误";
      const message = failure.killed ? "操作超时" : raw.split("\n")[0];
      throw badRequest(`Git 操作失败：${message}`);
    }
  }

  private readPackageVersion(): string {
    try {
      const pkg = JSON.parse(readFileSync(path.join(this.config.repoRoot, "package.json"), "utf8")) as {
        version?: string;
      };
      return pkg.version ?? "unknown";
    } catch {
      return "unknown";
    }
  }

  private lastUpdateAt(): string | null {
    const candidates = [this.stateFile, path.join(this.config.runtimeDir, "update-state.json")];
    for (const file of candidates) {
      try {
        const parsed = JSON.parse(readFileSync(file, "utf8")) as { updatedAt?: unknown };
        if (typeof parsed.updatedAt === "string" && parsed.updatedAt) return parsed.updatedAt;
      } catch {
        // Try the next location.
      }
    }
    try {
      return statSync(path.join(this.config.logDir, "update.log")).mtime.toISOString();
    } catch {
      return null;
    }
  }

  async buildInfo(): Promise<{ build: string; updatedAt: string | null }> {
    try {
      const build = await this.git(["rev-parse", "--short=12", "HEAD"]);
      const commitAt = await this.git(["show", "-s", "--format=%cI", "HEAD"]);
      return { build, updatedAt: this.lastUpdateAt() ?? commitAt };
    } catch {
      return { build: "unknown", updatedAt: this.lastUpdateAt() };
    }
  }

  readState(): UpdateState {
    try {
      const parsed = JSON.parse(readFileSync(this.stateFile, "utf8")) as Partial<UpdateState>;
      return {
        jobId: typeof parsed.jobId === "string" ? parsed.jobId : null,
        state: typeof parsed.state === "string" ? parsed.state : "idle",
        message: typeof parsed.message === "string" ? parsed.message : "",
        startedAt: typeof parsed.startedAt === "string" ? parsed.startedAt : null,
        updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : null,
      };
    } catch {
      return { jobId: null, state: "idle", message: "", startedAt: null, updatedAt: null };
    }
  }

  private writeState(state: UpdateState): void {
    mkdirSync(this.config.dataDir, { recursive: true });
    writeFileSync(this.stateFile, `${JSON.stringify(state)}\n`, { mode: 0o600 });
  }

  async status() {
    let commit = "";
    let branch = "";
    let remote = "";
    try {
      commit = await this.git(["rev-parse", "HEAD"]);
      branch = await this.git(["rev-parse", "--abbrev-ref", "HEAD"]);
      remote = this.config.get("update.remote-url");
    } catch {
      // Status remains useful even when the deployment is not a git checkout.
    }
    const databaseOk = this.database.healthy();
    let databaseSize = 0;
    try {
      databaseSize = statSync(this.config.dbPath).size;
    } catch {
      databaseSize = 0;
    }
    return {
      version: this.readPackageVersion(),
      commit,
      shortCommit: commit.slice(0, 12),
      branch,
      remote,
      update: this.readState(),
      startedAt: this.startedAt,
      nodeVersion: process.version,
      pid: process.pid,
      port: this.config.port,
      environment: process.env.NODE_ENV === "production" ? "production" : "development",
      propertiesPath: this.config.propertiesPath,
      logDir: this.config.logDir,
      database: { ok: databaseOk, path: this.config.dbPath, size: databaseSize },
      logs: this.listLogs(),
    };
  }

  async check() {
    const branch = this.config.get("update.branch") || "main";
    const remoteUrl = this.config.get("update.remote-url").trim();
    if (!remoteUrl) throw badRequest("未配置 update.remote-url");
    await this.git(["fetch", "--prune", remoteUrl, branch], 20_000);
    const current = await this.git(["rev-parse", "HEAD"]);
    const latest = await this.git(["rev-parse", "FETCH_HEAD"]);
    const behind = Number(await this.git(["rev-list", "--count", "HEAD..FETCH_HEAD"]));
    const log = await this.git([
      "log",
      "--pretty=format:%h%x09%an%x09%ar%x09%s",
      "--max-count=30",
      "HEAD..FETCH_HEAD",
    ]);
    const commits: UpdateCommit[] = log
      ? log.split("\n").map((line) => {
          const [hash, author, date, ...subject] = line.split("\t");
          return { hash: hash ?? "", author: author ?? "", date: date ?? "", subject: subject.join("\t") };
        })
      : [];
    return {
      branch,
      current,
      latest,
      behind,
      updateAvailable: behind > 0,
      commits,
      checkedAt: nowIso(),
    };
  }

  async startUpdate() {
    const current = this.readState();
    if (ACTIVE_STATES.has(current.state)) throw conflict("已有更新任务正在执行");
    const dirty = await this.git(["status", "--porcelain", "--untracked-files=no"]);
    if (dirty) throw badRequest("工作区存在未提交改动，已停止自动更新");
    const script = path.join(this.config.repoRoot, "tools/update.sh");
    if (!existsSync(script)) throw badRequest("未找到 tools/update.sh");
    const branch = this.config.get("update.branch") || "main";
    const remoteUrl = this.config.get("update.remote-url").trim();
    if (!remoteUrl) throw badRequest("未配置 update.remote-url");
    const jobId = randomUUID();
    const startedAt = nowIso();
    this.writeState({
      jobId,
      state: "queued",
      message: "更新任务已创建，等待脚本启动",
      startedAt,
      updatedAt: startedAt,
    });
    const child = spawn("bash", [script, "--yes"], {
      cwd: this.config.repoRoot,
      detached: true,
      stdio: "ignore",
      env: {
        ...process.env,
        ORGWATCH_WORKSPACE: this.config.workspace,
        ORGWATCH_BRANCH: branch,
        ORGWATCH_REMOTE_URL: remoteUrl,
        ORGWATCH_UPDATE_STATE_FILE: this.stateFile,
        ORGWATCH_UPDATE_LOG_DIR: this.logDir,
        ORGWATCH_UPDATE_JOB_ID: jobId,
        ORGWATCH_UPDATE_STARTED_AT: startedAt,
        ORGWATCH_UPDATE_PORT: String(this.config.port),
      },
    });
    child.unref();
    return { jobId, state: "queued" };
  }

  listLogs() {
    if (!existsSync(this.logDir)) return [];
    return readdirSync(this.logDir)
      .filter((name) => name.endsWith(".log"))
      .map((name) => {
        const info = statSync(path.join(this.logDir, name));
        return { name, size: info.size, updatedAt: info.mtime.toISOString() };
      })
      .sort((a, b) => (a.name === "update.log" ? -1 : b.name === "update.log" ? 1 : a.name.localeCompare(b.name)));
  }

  tailLog(name: string, lines = 200) {
    const safeName = path.basename(name);
    if (safeName !== name || !safeName.endsWith(".log")) throw badRequest("日志文件名不合法");
    const fullPath = path.join(this.logDir, safeName);
    if (!existsSync(fullPath)) throw badRequest("日志文件不存在");
    const fd = openSync(fullPath, "r");
    try {
      const size = fstatSync(fd).size;
      const start = Math.max(0, size - 512 * 1024);
      const buffer = Buffer.alloc(size - start);
      readSync(fd, buffer, 0, buffer.length, start);
      const all = buffer.toString("utf8").split(/\r?\n/);
      const tail = all.slice(-Math.min(Math.max(lines, 20), 1000));
      return {
        name: safeName,
        size,
        updatedAt: statSync(fullPath).mtime.toISOString(),
        lines: tail,
      };
    } finally {
      closeSync(fd);
    }
  }
}
