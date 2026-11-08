import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  ArrowUpCircle,
  RefreshCw,
  Server,
  Terminal,
} from "lucide-react";
import { get, post, errorMessage } from "../api";
import { relativeTime } from "../lib/format";
import {
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  LoadingBlock,
  Modal,
  PageHeader,
  Select,
  Switch,
  Tabs,
} from "../components/ui";

type LogFile = { name: string; size: number; updatedAt: string };
type UpdateState = {
  jobId: string | null;
  state: "idle" | "queued" | "running" | "restarting" | "succeeded" | "failed" | string;
  message: string;
  startedAt: string | null;
  updatedAt: string | null;
};
type SystemStatus = {
  version: string;
  commit: string;
  shortCommit: string;
  branch: string;
  remote: string;
  update: UpdateState;
  startedAt: string;
  nodeVersion: string;
  pid: number;
  port: number;
  environment: string;
  propertiesPath: string;
  logDir: string;
  database: { ok: boolean; path: string; size: number };
  logs: LogFile[];
};
type CheckResult = {
  branch: string;
  current: string;
  latest: string;
  behind: number;
  updateAvailable: boolean;
  commits: Array<{ hash: string; author: string; date: string; subject: string }>;
  checkedAt: string;
};
type LogTail = { name: string; size: number; updatedAt: string; lines: string[] };

const ACTIVE = new Set(["queued", "running", "restarting"]);

function formatLogLine(line: string): string {
  if (!line.startsWith("{")) return line;
  try {
    const entry = JSON.parse(line) as {
      time?: number;
      level?: number;
      msg?: string;
      req?: { method?: string; url?: string };
      res?: { statusCode?: number };
    };
    const levelMap: Record<number, string> = { 10: "TRACE", 20: "DEBUG", 30: "INFO", 40: "WARN", 50: "ERROR", 60: "FATAL" };
    const time = entry.time
      ? new Date(entry.time).toLocaleTimeString("zh-CN", { hour12: false })
      : "";
    const request = entry.req ? `${entry.req.method ?? ""} ${entry.req.url ?? ""}`.trim() : "";
    const status = entry.res?.statusCode ? `→ ${entry.res.statusCode}` : "";
    return [time, levelMap[entry.level ?? 0] ?? entry.level, request, entry.msg, status]
      .filter(Boolean)
      .join(" ");
  } catch {
    return line;
  }
}

function formatDuration(startedAt: string): string {
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000));
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (days > 0) return `${days}天${hours}小时${minutes}分钟`;
  if (hours > 0) return `${hours}小时${minutes}分钟`;
  if (minutes > 0) return `${minutes}分钟`;
  return `${seconds}秒`;
}

function formatBytes(bytes: number): string {
  if (!bytes) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

const STATE_LABEL: Record<string, string> = {
  idle: "空闲",
  queued: "等待开始",
  running: "更新中",
  restarting: "重启中",
  succeeded: "已完成",
  failed: "失败",
};

export default function SystemUpdate() {
  const queryClient = useQueryClient();
  const [check, setCheck] = useState<CheckResult | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [tab, setTab] = useState("status");
  const [logName, setLogName] = useState("server.log");
  const [autoRefresh, setAutoRefresh] = useState(false);
  const logRef = useRef<HTMLPreElement>(null);

  const statusQuery = useQuery({
    queryKey: ["system-status"],
    queryFn: () => get<SystemStatus>("/admin/system/status"),
    refetchInterval: (query) => (ACTIVE.has(query.state.data?.update.state ?? "") ? 2000 : 5000),
    retry: 2,
    retryDelay: 1000,
  });

  const status = statusQuery.data;
  const update = status?.update;
  const active = ACTIVE.has(update?.state ?? "");

  const logsQuery = useQuery({
    queryKey: ["system-log", logName],
    queryFn: () => get<LogTail>(`/admin/system/logs/${encodeURIComponent(logName)}?lines=300`),
    enabled: tab === "logs",
    refetchInterval: tab === "logs" && autoRefresh ? 2000 : false,
    retry: 1,
  });

  useEffect(() => {
    if (!status?.logs.length) return;
    if (!status.logs.some((log) => log.name === logName)) {
      setLogName(status.logs.find((log) => log.name === "update.log")?.name ?? status.logs[0]!.name);
    }
  }, [status?.logs, logName]);

  useEffect(() => {
    if (active && status?.logs.some((log) => log.name === "update.log")) {
      setLogName("update.log");
    }
  }, [active, status?.logs]);

  useEffect(() => {
    if (!logsQuery.data) return;
    requestAnimationFrame(() => {
      if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
    });
  }, [logsQuery.data]);

  const checkMutation = useMutation({
    mutationFn: () => post<CheckResult>("/admin/system/check"),
    onSuccess: (result) => {
      setCheck(result);
      toast.success(result.updateAvailable ? `发现 ${result.behind} 个新提交` : "当前已是最新版本");
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const updateMutation = useMutation({
    mutationFn: () => post<{ jobId: string }>("/admin/system/update"),
    onSuccess: async () => {
      setConfirmOpen(false);
      toast.success("更新任务已启动，服务会在构建完成后重启");
      await queryClient.invalidateQueries({ queryKey: ["system-status"] });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const stateTone =
    update?.state === "succeeded"
      ? "green"
      : update?.state === "failed"
        ? "red"
        : active
          ? "orange"
          : "gray";

  return (
    <div className="space-y-4">
      <PageHeader title="系统更新" description="查看服务状态并执行系统维护操作。状态每 5 秒自动刷新。" />

      <Tabs
        value={tab}
        onChange={setTab}
        items={[
          { value: "status", label: "状态" },
          { value: "logs", label: "日志" },
        ]}
      />

      {tab === "status" ? (
        <div className="space-y-4">
          {statusQuery.isError ? (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              服务暂时不可达，可能正在重启；页面会继续尝试连接。
            </div>
          ) : null}

          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader
                title="运行状态"
                description="当前实例与数据存储"
                icon={<Server className="h-4 w-4" />}
                actions={
                  <Badge tone="green" dot>
                    运行中
                  </Badge>
                }
              />
              <div className="border-t border-slate-100 px-5 py-4">
                <div className="flex flex-wrap items-end justify-between gap-4">
                  <div>
                    <p className="text-xl font-semibold tracking-tight text-slate-900">
                      {status?.environment === "production" ? "生产模式" : "开发模式"}
                    </p>
                    <p className="mt-1 text-xs text-slate-500">
                      Node {status?.nodeVersion ?? "-"} · 单实例
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-[11px] text-slate-500">运行时长</p>
                    <p className="mt-1 text-sm font-medium tabular-nums text-slate-800">
                      {status ? formatDuration(status.startedAt) : "-"}
                    </p>
                  </div>
                </div>

                <dl className="mt-5 grid gap-x-6 gap-y-3 border-t border-slate-100 pt-4 text-sm sm:grid-cols-2">
                  <div>
                    <dt className="text-[11px] text-slate-500">后端进程</dt>
                    <dd className="mt-1 text-slate-700">
                      PID {status?.pid ?? "-"} · 端口 {status?.port ?? "-"}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-[11px] text-slate-500">数据库</dt>
                    <dd className="mt-1 flex items-center gap-2 text-slate-700">
                      SQLite
                      <Badge tone={status?.database.ok ? "green" : "red"}>
                        {status?.database.ok ? "正常" : "异常"}
                      </Badge>
                      <span className="text-xs text-slate-400">{status ? formatBytes(status.database.size) : "-"}</span>
                    </dd>
                  </div>
                </dl>
              </div>
            </Card>

            <Card>
              <CardHeader
                title="系统更新"
                description="从远程分支检查并升级"
                icon={<ArrowUpCircle className="h-4 w-4" />}
                actions={
                  <Badge tone={stateTone as "green" | "red" | "orange" | "gray"} dot>
                    {STATE_LABEL[update?.state ?? "idle"] ?? update?.state}
                  </Badge>
                }
              />
              <div className="border-t border-slate-100 px-5 py-4">
                <div>
                  <p className="text-[11px] text-slate-500">当前构建</p>
                  <p className="mt-1 font-mono text-xl font-semibold tracking-tight text-slate-900">
                    {status?.shortCommit ?? "-"}
                  </p>
                  <p className="mt-1 truncate text-xs text-slate-500">分支 {status?.branch ?? "-"}</p>
                </div>

                <div className="mt-4 flex flex-wrap gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-28"
                    onClick={() => checkMutation.mutate()}
                    disabled={active || checkMutation.isPending}
                  >
                    <RefreshCw className={`h-3.5 w-3.5 ${checkMutation.isPending ? "animate-spin" : ""}`} />
                    检查更新
                  </Button>
                  <Button size="sm" onClick={() => setConfirmOpen(true)} disabled={active}>
                    <ArrowUpCircle className="h-3.5 w-3.5" />
                    系统升级
                  </Button>
                </div>

                <p
                  className={`mt-3 text-xs leading-5 ${
                    update?.state === "failed" ? "text-rose-600" : "text-slate-500"
                  }`}
                >
                  {!update || update.state === "idle"
                    ? "尚未执行系统更新。"
                    : update.state === "succeeded"
                      ? `上次更新已完成${update.updatedAt ? ` · ${relativeTime(update.updatedAt)}` : ""}`
                      : `${update.message || STATE_LABEL[update.state] || update.state}${
                          update.updatedAt ? ` · ${relativeTime(update.updatedAt)}` : ""
                        }`}
                </p>
              </div>
            </Card>
          </div>

          <Card>
            <CardHeader
              title="远程更新"
              description="从配置的远程仓库拉取最新提交"
              actions={
                check ? (
                  <Badge tone={check.updateAvailable ? "orange" : "green"}>
                    {check.updateAvailable ? `落后 ${check.behind} 个提交` : "已是最新"}
                  </Badge>
                ) : null
              }
            />
            <div className="border-t border-slate-100 px-5 py-4">
              {!check ? (
                <p className="text-sm text-slate-500">还没有检查远程版本。</p>
              ) : check.commits.length ? (
                <ol className="divide-y divide-slate-100">
                  {check.commits.map((commit) => (
                    <li key={commit.hash} className="flex items-start gap-3 py-2.5 text-sm">
                      <span className="mt-0.5 rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] text-slate-500">
                        {commit.hash}
                      </span>
                      <div className="min-w-0">
                        <p className="truncate text-slate-700">{commit.subject}</p>
                        <p className="mt-0.5 text-xs text-slate-400">
                          {commit.author} · {commit.date}
                        </p>
                      </div>
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="text-sm text-slate-500">当前分支已是最新版本。</p>
              )}
              {!status?.remote ? (
                <p className="mt-3 text-xs text-amber-700">未配置远程仓库，请在 properties 设置 `update.remote-url`。</p>
              ) : null}
            </div>
          </Card>
        </div>
      ) : (
        <Card className="overflow-hidden">
          <CardHeader
            title="运行日志"
            description="切换到日志页后才会读取，自动刷新默认关闭"
            icon={<Terminal className="h-4 w-4" />}
            actions={
              <div className="flex flex-wrap items-center gap-2">
                <Select
                  className="h-8 w-36 text-xs"
                  value={logName}
                  onChange={(event) => setLogName(event.target.value)}
                >
                  {status?.logs.map((log) => (
                    <option key={log.name} value={log.name}>
                      {log.name}
                    </option>
                  ))}
                </Select>
                <label className="flex items-center gap-1.5 text-xs text-slate-500">
                  <Switch checked={autoRefresh} onChange={setAutoRefresh} label="自动刷新" />
                  自动刷新
                </label>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8"
                  onClick={() => void logsQuery.refetch()}
                  loading={logsQuery.isFetching}
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                  刷新
                </Button>
              </div>
            }
          />
          {logsQuery.isLoading ? (
            <LoadingBlock />
          ) : logsQuery.isError ? (
            <EmptyState title="日志读取失败" description="服务可能正在重启，稍后重试。" icon={<Terminal className="h-5 w-5" />} />
          ) : (
            <pre
              ref={logRef}
              className="h-[440px] overflow-auto whitespace-pre-wrap break-words bg-slate-950 px-4 py-3 font-mono text-[11px] leading-5 text-slate-200"
            >
              {logsQuery.data?.lines.map(formatLogLine).join("\n") || "暂无日志"}
            </pre>
          )}
        </Card>
      )}

      <Modal
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="执行系统升级？"
        description="系统会拉取最新代码、安装依赖、构建并重启服务，期间短暂无法访问。"
        footer={
          <>
            <Button variant="outline" onClick={() => setConfirmOpen(false)}>
              取消
            </Button>
            <Button onClick={() => updateMutation.mutate()} loading={updateMutation.isPending}>
              确认升级
            </Button>
          </>
        }
      >
        <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-900">
          更新前请确认工作区没有未提交改动，并确保当前账号可以执行 git、npm 和重启服务。
        </div>
      </Modal>
    </div>
  );
}
