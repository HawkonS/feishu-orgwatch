import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import {
  AlertCircle,
  ArrowRight,
  Ban,
  BellRing,
  Building2,
  CheckCircle2,
  GitCompareArrows,
  Loader2,
  Network,
  Play,
  Plus,
  RefreshCw,
  UserRound,
  Users,
  XCircle,
} from "lucide-react";
import { get, post, errorMessage } from "../api";
import { canManage, canOperate, useSession } from "../lib/session";
import type { Diff, Run, Snapshot } from "../lib/types";
import {
  DIFF_STATUS_LABELS,
  DIFF_STATUS_TONE,
  RUN_STATUS_LABELS,
  RUN_STATUS_TONE,
  formatDateTime,
  relativeTime,
} from "../lib/format";
import { TrendChart, type TrendPoint } from "../components/TrendChart";
import {
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  LoadingBlock,
  PageHeader,
  StatCard,
} from "../components/ui";

type RecentChange = {
  id: number;
  diffId: number;
  diffStatus: Diff["status"];
  entityType: "person" | "department";
  changeKind: string;
  entityName: string;
  severity: "high" | "medium" | "low" | "info";
  createdAt: string;
  description: string;
};

type Overview = {
  snapshot: Snapshot | null;
  pendingCount: number;
  diffStats: { new: number; notified: number; acknowledged: number; ignored: number };
  tasks: { total: number; enabled: number; nextRunAt: string | null };
  lastRun: Run | null;
  recentDiffs: Diff[];
  recentRuns: Run[];
  recentChanges: RecentChange[];
  trend: TrendPoint[];
};

function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 6) return "夜深了";
  if (hour < 12) return "早上好";
  if (hour < 18) return "下午好";
  return "晚上好";
}

const SEVERITY_DOT: Record<RecentChange["severity"], string> = {
  high: "bg-rose-500",
  medium: "bg-orange-400",
  low: "bg-primary-500",
  info: "bg-slate-400",
};

const STATUS_COLOR: Record<keyof Overview["diffStats"], string> = {
  new: "bg-primary-500",
  notified: "bg-orange-400",
  acknowledged: "bg-emerald-500",
  ignored: "bg-slate-300",
};

export default function Dashboard() {
  const { user } = useSession();
  const queryClient = useQueryClient();
  const [starting, setStarting] = useState(false);

  const overviewQuery = useQuery({
    queryKey: ["overview"],
    queryFn: () => get<Overview>("/overview"),
    refetchInterval: 5000,
  });

  const overview = overviewQuery.data;
  const snapshot = overview?.snapshot ?? null;
  const lastRun = overview?.lastRun ?? null;
  const running = lastRun?.status === "running";
  const admin = canManage(user);

  const totals = useMemo(() => {
    const trend = overview?.trend ?? [];
    return {
      added: trend.reduce((sum, point) => sum + point.peopleAdded, 0),
      removed: trend.reduce((sum, point) => sum + point.peopleRemoved, 0),
      changed: trend.reduce((sum, point) => sum + point.peopleChanged, 0),
    };
  }, [overview?.trend]);

  const diffStats = overview?.diffStats ?? { new: 0, notified: 0, acknowledged: 0, ignored: 0 };
  const totalDiffs = diffStats.new + diffStats.notified + diffStats.acknowledged + diffStats.ignored;

  const startRun = async () => {
    setStarting(true);
    try {
      await post<{ runId: number }>("/runs", {});
      toast.success("巡查已开始，结果会自动刷新");
      await queryClient.invalidateQueries({ queryKey: ["overview"] });
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setStarting(false);
    }
  };

  if (overviewQuery.isLoading) return <LoadingBlock label="正在加载概览…" />;

  return (
    <div className="flex flex-col gap-4 lg:h-[calc(100vh-6.5rem)] lg:min-h-[720px]">
      <PageHeader
        title={`${greeting()}，${user?.displayName ?? ""}`}
        description="个人工作台 · 查看组织最近的变化与待处理事项"
        actions={
          <>
            {canOperate(user) ? (
              <Link to="/tasks">
                <Button variant="outline" size="sm">
                  <Plus className="h-4 w-4" />
                  新建任务
                </Button>
              </Link>
            ) : null}
            {canOperate(user) ? (
              <Button size="sm" onClick={() => void startRun()} loading={starting || running}>
                <Play className="h-4 w-4" />
                {running ? "巡查执行中…" : "立即巡查"}
              </Button>
            ) : null}
          </>
        }
      />

      {!snapshot ? (
        <Card className="p-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="max-w-xl">
              <h2 className="text-base font-semibold">还没有组织架构快照</h2>
              <p className="mt-1 text-sm leading-6 text-slate-500">
                配置飞书自建应用后执行一次巡查，系统会保存第一份快照；之后的巡查只会展示真实差异。
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                {admin ? (
                  <Link to="/settings">
                    <Button variant="outline" size="sm">
                      配置飞书应用
                      <ArrowRight className="h-3.5 w-3.5" />
                    </Button>
                  </Link>
                ) : null}
                {canOperate(user) ? (
                  <Button size="sm" onClick={() => void startRun()} loading={starting}>
                    立即巡查
                  </Button>
                ) : null}
              </div>
            </div>
            <ol className="space-y-1.5 text-xs text-slate-500">
              {["填写 App ID / Secret", "测试连接并巡查", "创建定时任务"].map((step, index) => (
                <li key={step} className="flex items-center gap-2">
                  <span className="flex h-5 w-5 items-center justify-center rounded-full border border-slate-200 text-[10px] text-slate-500">
                    {index + 1}
                  </span>
                  {step}
                </li>
              ))}
            </ol>
          </div>
        </Card>
      ) : null}

      <div className="grid shrink-0 grid-cols-2 gap-4 xl:grid-cols-4">
        <StatCard
          label="在职人员"
          value={snapshot?.peopleCount ?? "-"}
          hint={snapshot ? `快照于 ${relativeTime(snapshot.fetchedAt)}` : "等待首次巡查"}
          icon={<Users className="h-4 w-4" />}
        />
        <StatCard
          label="部门数量"
          value={snapshot ? Math.max(0, snapshot.departmentCount - 1) : "-"}
          hint="不含根部门"
          icon={<Network className="h-4 w-4" />}
        />
        <StatCard
          label="待知情差异"
          value={overview?.pendingCount ?? "-"}
          hint="待通知 + 已通知未回执"
          icon={<BellRing className="h-4 w-4" />}
        />
        <StatCard
          label="最近巡查"
          value={lastRun ? relativeTime(lastRun.startedAt) : "从未"}
          hint={running ? "正在执行" : lastRun ? RUN_STATUS_LABELS[lastRun.status] : "尚未执行巡查"}
          icon={<RefreshCw className={running ? "h-4 w-4 animate-spin" : "h-4 w-4"} />}
        />
      </div>

      <div className="grid min-h-0 flex-1 gap-4 lg:grid-rows-2">
        <div className="grid min-h-0 gap-4 lg:grid-cols-2">
          <Card className="flex min-h-0 flex-col">
            <CardHeader
              title="变更趋势"
              description={`近 14 天 · ${totals.added + totals.removed + totals.changed} 项人员变更`}
              actions={
                <div className="flex items-center gap-3 text-[11px] text-slate-500">
                  <span className="flex items-center gap-1.5">
                    <span className="h-1.5 w-1.5 rounded-full bg-primary-600" />
                    新增
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="h-1.5 w-1.5 rounded-full bg-rose-500" />
                    移除
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="h-1.5 w-1.5 rounded-full bg-orange-400" />
                    调整
                  </span>
                </div>
              }
            />
            <div className="flex min-h-0 flex-1 items-center px-3 pb-1">
              <TrendChart data={overview?.trend ?? []} className="w-full" />
            </div>
            <div className="grid grid-cols-3 border-t border-slate-100 px-4 py-2.5 text-center">
              {[
                { label: "新增", value: totals.added, color: "text-primary-700" },
                { label: "移除", value: totals.removed, color: "text-rose-600" },
                { label: "调整", value: totals.changed, color: "text-orange-600" },
              ].map((item) => (
                <div key={item.label}>
                  <p className="text-[11px] text-slate-500">{item.label}</p>
                  <p className={`mt-0.5 text-sm font-semibold tabular-nums ${item.color}`}>{item.value}</p>
                </div>
              ))}
            </div>
          </Card>

          <Card className="flex min-h-0 flex-col">
            <CardHeader title="差异状态" description="全部差异的知情进度" />
            <div className="min-h-0 flex-1 px-4 py-3">
              <div className="flex items-baseline gap-2">
                <span className="text-3xl font-semibold tabular-nums">{totalDiffs}</span>
                <span className="text-xs text-slate-500">条差异</span>
              </div>
              <div className="mt-4 space-y-3">
                {(Object.keys(diffStats) as Array<keyof typeof diffStats>).map((status) => {
                  const value = diffStats[status];
                  const percent = totalDiffs ? Math.round((value / totalDiffs) * 100) : 0;
                  return (
                    <div key={status}>
                      <div className="flex items-center justify-between text-xs">
                        <span className="flex items-center gap-2 text-slate-600">
                          <span className={`h-1.5 w-1.5 rounded-full ${STATUS_COLOR[status]}`} />
                          {DIFF_STATUS_LABELS[status]}
                        </span>
                        <span className="tabular-nums text-slate-500">{value}</span>
                      </div>
                      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-slate-100">
                        <div className={`h-full rounded-full ${STATUS_COLOR[status]}`} style={{ width: `${percent}%` }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

          </Card>
        </div>

        <div className="grid min-h-0 gap-4 lg:grid-cols-2">
          <Card className="flex min-h-0 flex-col overflow-hidden">
            <CardHeader
              title="最近变更"
              description={overview?.recentChanges?.length ? "最近生成的具体变更" : undefined}
              actions={
                <Link to="/diffs" className="text-xs text-primary-700 hover:underline">
                  查看更多
                </Link>
              }
            />
            {!overview?.recentChanges?.length ? (
              <EmptyState
                title="还没有变更"
                description="巡查发现真实变更后，会在这里展示具体变更内容。"
                icon={<GitCompareArrows className="h-5 w-5" />}
              />
            ) : (
              <ul className="min-h-0 flex-1 divide-y divide-slate-100 overflow-y-auto border-t border-slate-100">
                {overview.recentChanges.slice(0, 4).map((change) => (
                  <li key={change.id}>
                    <Link
                      to={`/diffs/${change.diffId}`}
                      className="flex items-start gap-3 px-4 py-3 transition-colors hover:bg-slate-50"
                    >
                      <span
                        className={`relative flex h-9 w-9 shrink-0 items-center justify-center rounded-md ${
                          change.entityType === "person"
                            ? "bg-primary-50 text-primary-700"
                            : "bg-slate-100 text-slate-500"
                        }`}
                      >
                        {change.entityType === "person" ? (
                          <UserRound className="h-4 w-4" />
                        ) : (
                          <Building2 className="h-4 w-4" />
                        )}
                        <span className={`absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full ring-2 ring-white ${SEVERITY_DOT[change.severity]}`} />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="line-clamp-2 text-sm leading-5 text-slate-700">{change.description}</p>
                        <p className="mt-1 text-[11px] text-slate-400">
                          差异 #{change.diffId} · {relativeTime(change.createdAt)}
                        </p>
                      </div>
                      <Badge tone={DIFF_STATUS_TONE[change.diffStatus]}>{DIFF_STATUS_LABELS[change.diffStatus]}</Badge>
                      <ArrowRight className="mt-1 h-3.5 w-3.5 shrink-0 text-slate-300" />
                    </Link>
                  </li>
                ))}
              </ul>
            )}

          </Card>

          <Card className="flex min-h-0 flex-col overflow-hidden">
            <CardHeader
              title="巡查动态"
              description="最近几次巡查结果"
              actions={
                <Link to="/tasks" className="text-xs text-primary-700 hover:underline">
                  查看更多
                </Link>
              }
            />
            {!overview?.recentRuns.length ? (
              <EmptyState
                title="还没有巡查记录"
                description="点击「立即巡查」或创建一个定时任务。"
                icon={<RefreshCw className="h-5 w-5" />}
              />
            ) : (
              <ul className="min-h-0 flex-1 divide-y divide-slate-100 overflow-y-auto border-t border-slate-100">
                {overview.recentRuns.slice(0, 3).map((run) => (
                  <li key={run.id} className="flex items-center gap-3 px-4 py-3">
                    <RunStatusIcon status={run.status} />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-medium">巡查 #{run.id}</span>
                        <Badge tone={RUN_STATUS_TONE[run.status]}>{RUN_STATUS_LABELS[run.status]}</Badge>
                        {run.trigger === "catchup" ? <span className="text-xs text-slate-500">补跑</span> : null}
                      </div>
                      <p className="mt-0.5 text-xs text-slate-500">
                        {formatDateTime(run.startedAt)} · 人员 {run.peopleCount} · 部门{" "}
                        {Math.max(0, run.departmentCount - 1)}
                      </p>
                    </div>
                    {run.diffId ? (
                      <Link to={`/diffs/${run.diffId}`} className="text-xs text-primary-700 hover:underline">
                        查看差异
                      </Link>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}

          </Card>
        </div>
      </div>
    </div>
  );
}

function RunStatusIcon({ status }: { status: Run["status"] }) {
  const config: Record<
    Run["status"],
    { icon: typeof CheckCircle2; className: string }
  > = {
    success: { icon: CheckCircle2, className: "bg-emerald-50 text-emerald-600" },
    failed: { icon: XCircle, className: "bg-rose-50 text-rose-600" },
    cancelled: { icon: Ban, className: "bg-slate-100 text-slate-500" },
    needs_review: { icon: AlertCircle, className: "bg-amber-50 text-amber-600" },
    running: { icon: Loader2, className: "bg-primary-50 text-primary-700" },
    skipped: { icon: AlertCircle, className: "bg-slate-100 text-slate-500" },
  };
  const item = config[status];
  const Icon = item.icon;
  return (
    <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-md ${item.className}`}>
      <Icon className={`h-4 w-4 ${status === "running" ? "animate-spin" : ""}`} />
    </span>
  );
}
