import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { BookOpen, GitCompareArrows, Search } from "lucide-react";
import { get } from "../api";
import type { Diff } from "../lib/types";
import {
  DIFF_STATUS_LABELS,
  DIFF_STATUS_TONE,
  SEVERITY_LABELS,
  SEVERITY_TONE,
  changeLabel,
  formatDateTime,
} from "../lib/format";
import {
  Badge,
  Button,
  EmptyState,
  Input,
  LoadingBlock,
  PageHeader,
  Pagination,
  Select,
  Tabs,
} from "../components/ui";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../components/ui/table";

type DiffListResponse = {
  items: Diff[];
  total: number;
  stats: { new: number; notified: number; acknowledged: number; ignored: number };
};

const PAGE_SIZES = [10, 20, 50];
const STATUSES = ["new", "notified", "acknowledged", "ignored"] as const;

function statsText(diff: Diff): string {
  const groups: string[] = [];
  const people: string[] = [];
  if (diff.peopleAdded) people.push(`+${diff.peopleAdded}`);
  if (diff.peopleRemoved) people.push(`-${diff.peopleRemoved}`);
  if (diff.peopleChanged) people.push(`调整 ${diff.peopleChanged}`);
  if (people.length) groups.push(`人员 ${people.join(" / ")}`);
  const departments: string[] = [];
  if (diff.departmentsAdded) departments.push(`+${diff.departmentsAdded}`);
  if (diff.departmentsRemoved) departments.push(`-${diff.departmentsRemoved}`);
  if (diff.departmentsChanged) departments.push(`调整 ${diff.departmentsChanged}`);
  if (departments.length) groups.push(`部门 ${departments.join(" / ")}`);
  return groups.join(" · ");
}

export default function Diffs() {
  const [status, setStatus] = useState("all");
  const [severity, setSeverity] = useState("");
  const [entityType, setEntityType] = useState("");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  const query = useQuery({
    queryKey: ["diffs", "list", status, severity, entityType, q, page, pageSize],
    queryFn: () => {
      const params = new URLSearchParams({ pageSize: String(pageSize), page: String(page) });
      if (status !== "all") params.set("status", status);
      if (severity) params.set("severity", severity);
      if (entityType) params.set("entityType", entityType);
      if (q.trim()) params.set("q", q.trim());
      return get<DiffListResponse>(`/diffs?${params.toString()}`);
    },
  });

  const stats = query.data?.stats;
  const allCount = stats ? stats.new + stats.notified + stats.acknowledged + stats.ignored : undefined;
  const reset = () => {
    setStatus("all");
    setSeverity("");
    setEntityType("");
    setQ("");
    setPage(1);
  };

  return (
    <div className="flex flex-col gap-4 lg:h-[calc(100vh-6.5rem)] lg:min-h-[640px]">
      <PageHeader
        title="差异"
        description="每次巡查与上一份快照比较后的变更记录。先确认差异，再选择该知道的人。"
        actions={
          <>
            <Link to="/guide">
              <Button variant="outline" size="sm">
                <BookOpen className="h-4 w-4" />
                监测说明
              </Button>
            </Link>
            <Button variant="outline" size="sm" onClick={() => void query.refetch()} loading={query.isFetching}>
              刷新
            </Button>
          </>
        }
      />

      <div className="flex shrink-0 flex-wrap items-center justify-between gap-3">
        <Tabs
          value={status}
          onChange={(value) => {
            setStatus(value);
            setPage(1);
          }}
          items={[
            { value: "all", label: "全部", count: allCount },
            ...STATUSES.map((value) => ({
              value,
              label: DIFF_STATUS_LABELS[value],
              count: stats?.[value],
            })),
          ]}
        />
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
            <Input
              className="h-8 w-52 pl-8"
              placeholder="搜索对象或部门"
              value={q}
              onChange={(event) => {
                setQ(event.target.value);
                setPage(1);
              }}
            />
          </div>
          <Select
            className="h-8 w-28 text-sm"
            value={severity}
            onChange={(event) => {
              setSeverity(event.target.value);
              setPage(1);
            }}
          >
            <option value="">全部级别</option>
            {Object.entries(SEVERITY_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}优先级
              </option>
            ))}
          </Select>
          <Select
            className="h-8 w-28 text-sm"
            value={entityType}
            onChange={(event) => {
              setEntityType(event.target.value);
              setPage(1);
            }}
          >
            <option value="">全部对象</option>
            <option value="person">人员</option>
            <option value="department">部门</option>
          </Select>
          <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={reset}>
            恢复默认
          </Button>
        </div>
      </div>

      <div className="flex min-h-[420px] flex-1 flex-col overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
        {query.isLoading ? (
          <div className="flex flex-1 items-center justify-center">
            <LoadingBlock />
          </div>
        ) : query.isError ? (
          <div className="flex flex-1 items-center justify-center text-sm text-rose-600">
            差异加载失败，请稍后重试。
          </div>
        ) : !query.data?.items.length ? (
          <div className="flex flex-1 items-center justify-center">
            <EmptyState
              title="没有符合条件的差异"
              description="调整筛选条件，或等待下一次巡查产生真实变更。"
              icon={<GitCompareArrows className="h-5 w-5" />}
            />
          </div>
        ) : (
          <div className="min-h-0 flex-1 overflow-auto">
            <Table className="min-w-[980px] table-fixed [&_td]:py-3.5">
              <colgroup>
                <col className="w-[16%]" />
                <col className="w-[10%]" />
                <col className="w-[8%]" />
                <col className="w-[40%]" />
                <col className="w-[16%]" />
                <col className="w-[10%]" />
              </colgroup>
              <TableHeader className="sticky top-0 z-10 bg-white">
                <TableRow className="bg-slate-50 hover:bg-slate-50">
                  <TableHead>差异</TableHead>
                  <TableHead>状态</TableHead>
                  <TableHead>级别</TableHead>
                  <TableHead>变更内容</TableHead>
                  <TableHead>生成时间</TableHead>
                  <TableHead className="text-right">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {query.data.items.map((diff) => {
                  const top = diff.summary?.top ?? [];
                  const byKind = Object.entries(diff.summary?.byKind ?? {});
                  return (
                    <TableRow key={diff.id}>
                      <TableCell>
                        <div className="flex items-start gap-2.5">
                          <span
                            className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${
                              diff.severity === "high"
                                ? "bg-rose-500"
                                : diff.severity === "medium"
                                  ? "bg-orange-400"
                                  : "bg-primary-500"
                            }`}
                          />
                          <div className="min-w-0">
                            <Link
                              to={`/diffs/${diff.id}`}
                              className="font-medium text-slate-800 hover:text-primary-700 hover:underline"
                            >
                              差异 #{diff.id}
                            </Link>
                            <p className="mt-0.5 truncate text-xs text-slate-500">
                              {diff.task?.name ?? "手动巡查"} · 共 {diff.totalChanges} 项
                            </p>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge tone={DIFF_STATUS_TONE[diff.status]} dot>
                          {DIFF_STATUS_LABELS[diff.status]}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge tone={SEVERITY_TONE[diff.severity]}>{SEVERITY_LABELS[diff.severity]}</Badge>
                      </TableCell>
                      <TableCell>
                        <div className="space-y-1">
                          {top.length ? (
                            top.slice(0, 2).map((line, index) => (
                              <p
                                key={`${diff.id}-${index}`}
                                className="truncate text-xs leading-5 text-slate-600"
                                title={line}
                              >
                                {line}
                              </p>
                            ))
                          ) : (
                            <p className="truncate text-xs text-slate-500">
                              {statsText(diff) || "暂无变更摘要"}
                            </p>
                          )}
                          {top.length > 2 ? (
                            <p className="text-[11px] text-slate-400">还有 {top.length - 2} 项变更</p>
                          ) : null}
                          {byKind.length ? (
                            <div className="flex flex-wrap gap-1 pt-0.5">
                              {byKind.slice(0, 3).map(([kind, count]) => (
                                <span
                                  key={kind}
                                  className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-500"
                                >
                                  {changeLabel(kind)} {count}
                                </span>
                              ))}
                            </div>
                          ) : null}
                        </div>
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-xs text-slate-500">
                        {formatDateTime(diff.createdAt)}
                      </TableCell>
                      <TableCell className="text-right">
                        <Link
                          to={`/diffs/${diff.id}`}
                          className="text-xs font-medium text-primary-700 hover:underline"
                        >
                          查看
                        </Link>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
        <Pagination
          page={page}
          pageSize={pageSize}
          total={query.data?.total ?? 0}
          onChange={setPage}
          onPageSizeChange={(next) => {
            setPageSize(next);
            setPage(1);
          }}
          pageSizeOptions={PAGE_SIZES}
        />
      </div>
    </div>
  );
}
