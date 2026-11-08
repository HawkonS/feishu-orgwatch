import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ScrollText, Search } from "lucide-react";
import { get } from "../api";
import type { AuditLog, Paged } from "../lib/types";
import { formatDateTime } from "../lib/format";
import { Badge, Button, EmptyState, Input, LoadingBlock, PageHeader, Pagination } from "../components/ui";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../components/ui/table";

const PAGE_SIZES = [20, 50, 100];

const ACTION_LABELS: Record<string, string> = {
  "auth.login": "登录",
  "auth.logout": "退出登录",
  "auth.bootstrap": "初始化",
  "auth.feishu_login": "飞书登录",
  "auth.feishu_provision": "飞书自动开通",
  "auth.password_change": "修改密码",
  "settings.update": "更新设置",
  "settings.feishu_test": "测试飞书连接",
  "task.create": "创建任务",
  "task.update": "更新任务",
  "task.delete": "删除任务",
  "task.run": "手动执行任务",
  "run.cancel": "取消运行",
  "run.confirm": "确认隔离快照",
  "diff.inform": "发送知情卡片",
  "diff.inform_retry": "重试知情卡片",
  "diff.ack_self": "本人确认知情",
  "diff.ack_operator": "代确认知情",
  "diff.resolve": "差异结案",
  "diff.ignore": "忽略差异",
  "user.create": "创建用户",
  "user.update": "更新用户",
  "user.delete": "删除用户",
  "user.reset_password": "重置密码",
};

export default function Audit() {
  const [action, setAction] = useState("");
  const [actor, setActor] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  const query = useQuery({
    queryKey: ["audit", action, actor, page, pageSize],
    queryFn: () => {
      const params = new URLSearchParams({ pageSize: String(pageSize), page: String(page) });
      if (action.trim()) params.set("action", action.trim());
      if (actor.trim()) params.set("actor", actor.trim());
      return get<Paged<AuditLog>>(`/audit?${params.toString()}`);
    },
  });

  return (
    <div className="space-y-4">
      <PageHeader
        title="审计"
        description="登录、配置、巡查、发送与回执等操作留痕，记录不可通过接口修改。"
        actions={
          <Button variant="outline" size="sm" onClick={() => void query.refetch()} loading={query.isFetching}>
            刷新
          </Button>
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1 sm:flex-none">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
          <Input
            className="h-8 w-full pl-8 sm:w-60"
            placeholder="操作类型，如 diff.inform"
            value={action}
            onChange={(event) => {
              setAction(event.target.value);
              setPage(1);
            }}
          />
        </div>
        <Input
          className="h-8 w-44"
          placeholder="操作人显示名"
          value={actor}
          onChange={(event) => {
            setActor(event.target.value);
            setPage(1);
          }}
        />
        <Button
          variant="ghost"
          size="sm"
          className="h-8 text-xs"
          onClick={() => {
            setAction("");
            setActor("");
            setPage(1);
          }}
        >
          恢复默认
        </Button>
        <span className="ml-auto text-xs text-slate-500">共 {query.data?.total ?? 0} 条</span>
      </div>

      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
        {query.isLoading ? (
          <LoadingBlock />
        ) : query.isError ? (
          <div className="p-4 text-sm text-rose-600">审计日志加载失败，请确认管理员权限。</div>
        ) : !query.data?.items.length ? (
          <EmptyState title="暂无审计记录" icon={<ScrollText className="h-5 w-5" />} />
        ) : (
          <Table className="min-w-[980px]">
            <TableHeader>
              <TableRow className="bg-slate-50/60 hover:bg-slate-50/60">
                <TableHead className="w-40">时间</TableHead>
                <TableHead>操作</TableHead>
                <TableHead className="w-32">操作人</TableHead>
                <TableHead className="w-36">对象</TableHead>
                <TableHead className="w-32">IP</TableHead>
                <TableHead>详情</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {query.data.items.map((log) => (
                <TableRow key={log.id}>
                  <TableCell className="whitespace-nowrap text-xs text-slate-500">
                    {formatDateTime(log.createdAt)}
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-col gap-0.5">
                      <Badge tone="blue" className="w-fit">
                        {ACTION_LABELS[log.action] ?? log.action}
                      </Badge>
                      <span className="text-[11px] text-slate-400">{log.action}</span>
                    </div>
                  </TableCell>
                  <TableCell className="text-slate-700">{log.actorName ?? "-"}</TableCell>
                  <TableCell className="text-xs text-slate-500">
                    {log.targetType ? `${log.targetType} #${log.targetId}` : "-"}
                  </TableCell>
                  <TableCell className="text-xs text-slate-500">{log.ip ?? "-"}</TableCell>
                  <TableCell className="max-w-[320px] text-xs text-slate-500">
                    <span className="line-clamp-2 break-all">{log.detailJson ?? "-"}</span>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
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
