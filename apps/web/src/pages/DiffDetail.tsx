import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { toast } from "sonner";
import {
  ArrowLeft,
  Bell,
  BellRing,
  Building2,
  CheckCircle2,
  Download,
  GitCompareArrows,
  Plus,
  Send,
  SlidersHorizontal,
  UserMinus,
  UserPlus,
  X,
} from "lucide-react";
import { get, post, errorMessage } from "../api";
import type { Change, Delivery, Diff, Inform, Paged, Person } from "../lib/types";
import { canOperate, useSession } from "../lib/session";
import {
  DIFF_STATUS_LABELS,
  DIFF_STATUS_TONE,
  SEVERITY_LABELS,
  SEVERITY_TONE,
  changeLabel,
  formatDateTime,
  statusLabel,
} from "../lib/format";
import {
  Avatar,
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  Field,
  Input,
  LoadingBlock,
  Modal,
  Pagination,
  Tabs,
  Textarea,
} from "../components/ui";

type Recipient = { type: "user" | "chat"; id: string; name: string };

function formatValue(value: unknown): string {
  if (value === null || value === undefined || value === "") return "-";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function changeValues(change: Change): { before: string; after: string } {
  const before = change.before as Record<string, unknown> | null;
  const after = change.after as Record<string, unknown> | null;
  switch (change.changeKind) {
    case "person_department_changed":
      return {
        before: ((before?.paths as string[]) ?? []).join("；") || "-",
        after: ((after?.paths as string[]) ?? []).join("；") || "-",
      };
    case "department_moved":
      return { before: String(before?.parentName ?? "-"), after: String(after?.parentName ?? "-") };
    case "department_leader_changed":
      return { before: String(before?.name ?? "空"), after: String(after?.name ?? "空") };
    case "person_status_changed":
      return { before: statusLabel(String(before ?? "")), after: statusLabel(String(after ?? "")) };
    case "person_added":
    case "department_added":
      return { before: "—", after: change.departmentPathAfter ?? "-" };
    case "person_removed":
    case "department_removed":
      return { before: change.departmentPathBefore ?? "-", after: "—" };
    default:
      return { before: formatValue(change.before), after: formatValue(change.after) };
  }
}

const DELIVERY_LABELS: Record<Delivery["status"], string> = {
  pending: "待发送",
  sent: "已发送",
  failed: "失败",
};

export default function DiffDetail() {
  const { id } = useParams();
  const diffId = Number(id);
  const { user } = useSession();
  const operator = canOperate(user);
  const admin = user?.role === "admin";
  const queryClient = useQueryClient();

  const [tab, setTab] = useState("all");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [informOpen, setInformOpen] = useState(false);
  const [recipients, setRecipients] = useState<Recipient[]>([]);
  const [note, setNote] = useState("");
  const [peopleQueryText, setPeopleQueryText] = useState("");
  const [emailInput, setEmailInput] = useState("");
  const [ignoreOpen, setIgnoreOpen] = useState(false);
  const [ignoreReason, setIgnoreReason] = useState("");

  const diffQuery = useQuery({
    queryKey: ["diff", diffId],
    queryFn: () => get<Diff>(`/diffs/${diffId}`),
  });
  const changesQuery = useQuery({
    queryKey: ["diff-changes", diffId, tab, q, page],
    queryFn: () => {
      const params = new URLSearchParams({ pageSize: "30", page: String(page) });
      if (tab !== "all") params.set("entityType", tab);
      if (q.trim()) params.set("q", q.trim());
      return get<Paged<Change>>(`/diffs/${diffId}/changes?${params.toString()}`);
    },
  });
  const informsQuery = useQuery({
    queryKey: ["diff-informs", diffId],
    queryFn: () => get<{ items: Inform[] }>(`/diffs/${diffId}/informs`),
  });
  const peopleSearch = useQuery({
    queryKey: ["inform-people", peopleQueryText],
    queryFn: () => get<Paged<Person>>(`/directory/people?pageSize=20&q=${encodeURIComponent(peopleQueryText)}`),
    enabled: informOpen,
  });
  const chatsQuery = useQuery({
    queryKey: ["inform-chats"],
    queryFn: () => get<{ items: Array<{ chatId: string; name: string }>; warning: string | null }>("/directory/chats"),
    enabled: informOpen,
  });

  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["diff", diffId] }),
      queryClient.invalidateQueries({ queryKey: ["diff-changes", diffId] }),
      queryClient.invalidateQueries({ queryKey: ["diff-informs", diffId] }),
      queryClient.invalidateQueries({ queryKey: ["diffs"] }),
    ]);
  };

  const sendInform = useMutation({
    mutationFn: () =>
      post(`/diffs/${diffId}/informs`, {
        recipients: recipients.map((item) => ({ type: item.type, id: item.id, name: item.name })),
        note: note.trim() || null,
      }),
    onSuccess: async () => {
      toast.success("知情卡片已发送");
      setInformOpen(false);
      setRecipients([]);
      setNote("");
      await refresh();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const ackSelf = useMutation({
    mutationFn: () => post(`/diffs/${diffId}/ack`),
    onSuccess: async () => {
      toast.success("已记录你的知情回执");
      await refresh();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const resolve = useMutation({
    mutationFn: (payload: { status: "acknowledged" | "ignored"; reason?: string }) =>
      post(`/diffs/${diffId}/resolve`, payload),
    onSuccess: async () => {
      toast.success("差异状态已更新");
      setIgnoreOpen(false);
      setIgnoreReason("");
      await refresh();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const retry = useMutation({
    mutationFn: (payload: { informId: number; deliveryId: number }) =>
      post(`/informs/${payload.informId}/retry`, { deliveryIds: [payload.deliveryId] }),
    onSuccess: async () => {
      toast.success("已重新发送");
      await refresh();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const ackDelivery = useMutation({
    mutationFn: (deliveryId: number) => post(`/diffs/${diffId}/deliveries/${deliveryId}/ack`),
    onSuccess: async () => {
      toast.success("已代标记知情");
      await refresh();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const diff = diffQuery.data;
  const selectedKeys = useMemo(() => new Set(recipients.map((item) => `${item.type}:${item.id}`)), [recipients]);

  const toggleRecipient = (recipient: Recipient) => {
    const key = `${recipient.type}:${recipient.id}`;
    setRecipients((previous) =>
      previous.some((item) => `${item.type}:${item.id}` === key)
        ? previous.filter((item) => `${item.type}:${item.id}` !== key)
        : [...previous, recipient],
    );
  };

  const addEmail = () => {
    const email = emailInput.trim().toLowerCase();
    if (!email.includes("@")) {
      toast.error("请输入有效邮箱");
      return;
    }
    if (!selectedKeys.has(`user:${email}`)) {
      setRecipients((previous) => [...previous, { type: "user", id: email, name: email }]);
    }
    setEmailInput("");
  };

  if (diffQuery.isLoading) return <LoadingBlock />;
  if (!diff) {
    return (
      <Card className="p-8 text-center">
        <p className="text-sm text-red-600">差异不存在或加载失败</p>
        <Link to="/diffs" className="mt-3 inline-block text-sm text-primary-600 hover:underline">
          返回差异列表
        </Link>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link
          to="/diffs"
          className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs font-medium text-slate-500 transition-colors hover:bg-white hover:text-slate-800"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          返回差异列表
        </Link>
        <div className="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto sm:flex-wrap sm:items-center">
          {diff.status !== "ignored" ? (
            <Button variant="outline" size="sm" onClick={() => setIgnoreOpen(true)}>
              忽略差异
            </Button>
          ) : null}
          {admin ? (
            <a
              href={`/api/diffs/${diff.id}/export.csv`}
              className="inline-flex h-8 items-center gap-1.5 rounded-md border border-slate-200 bg-white px-3 text-xs font-medium text-slate-700 shadow-sm transition-colors hover:border-slate-300 hover:bg-slate-50"
            >
              <Download className="h-3.5 w-3.5" />
              导出 CSV
            </a>
          ) : null}
          <Button
            variant="outline"
            size="sm"
            onClick={() => ackSelf.mutate()}
            loading={ackSelf.isPending}
            disabled={diff.status === "ignored"}
          >
            我已知情
          </Button>
          {operator ? (
            <Button size="sm" onClick={() => setInformOpen(true)} disabled={diff.status === "ignored"}>
              <BellRing className="h-3.5 w-3.5" />
              发送知情卡片
            </Button>
          ) : null}
        </div>
      </div>

      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-start justify-between gap-4 px-5 py-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={DIFF_STATUS_TONE[diff.status]} dot>
                {DIFF_STATUS_LABELS[diff.status]}
              </Badge>
              <Badge tone={SEVERITY_TONE[diff.severity]}>{SEVERITY_LABELS[diff.severity]}优先级</Badge>
              {diff.task?.name ? <Badge tone="gray">{diff.task.name}</Badge> : null}
            </div>
            <div className="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <h1 className="text-xl font-semibold leading-7 tracking-tight text-slate-900">
                差异 #{diff.id}
              </h1>
              <p className="text-xs text-slate-500">
                {formatDateTime(diff.createdAt)} 生成
                {diff.fromSnapshot && diff.toSnapshot
                  ? ` · 快照 #${diff.fromSnapshot.id} → #${diff.toSnapshot.id}`
                  : ""}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex min-w-[92px] items-center gap-2 rounded-md border border-slate-200 bg-slate-50/70 px-3 py-2">
              <Bell className="h-4 w-4 text-slate-400" aria-hidden="true" />
              <div>
                <p className="text-[10px] text-slate-500">已通知</p>
                <p className="text-sm font-semibold leading-5 text-slate-800">{diff.deliveryStats?.sent ?? 0}</p>
              </div>
            </div>
            <div className="flex min-w-[92px] items-center gap-2 rounded-md border border-emerald-100 bg-emerald-50/70 px-3 py-2">
              <CheckCircle2 className="h-4 w-4 text-emerald-500" aria-hidden="true" />
              <div>
                <p className="text-[10px] text-emerald-700">已知情</p>
                <p className="text-sm font-semibold leading-5 text-emerald-700">
                  {diff.deliveryStats?.acknowledged ?? 0}
                </p>
              </div>
            </div>
          </div>
        </div>
        <div className="grid grid-cols-2 border-t border-slate-100 bg-slate-50/40 md:grid-cols-4 md:divide-x md:divide-slate-100">
          <div className="flex items-center gap-3 px-5 py-3">
            <span className="flex h-8 w-8 items-center justify-center rounded-md bg-emerald-50 text-emerald-600">
              <UserPlus className="h-4 w-4" />
            </span>
            <div>
              <p className="text-[11px] text-slate-500">新增成员</p>
              <p className="text-lg font-semibold leading-6 text-emerald-600">+{diff.peopleAdded}</p>
            </div>
          </div>
          <div className="flex items-center gap-3 px-5 py-3">
            <span className="flex h-8 w-8 items-center justify-center rounded-md bg-rose-50 text-rose-500">
              <UserMinus className="h-4 w-4" />
            </span>
            <div>
              <p className="text-[11px] text-slate-500">离职 / 移出</p>
              <p className="text-lg font-semibold leading-6 text-rose-600">-{diff.peopleRemoved}</p>
            </div>
          </div>
          <div className="flex items-center gap-3 px-5 py-3">
            <span className="flex h-8 w-8 items-center justify-center rounded-md bg-primary-50 text-primary-700">
              <Building2 className="h-4 w-4" />
            </span>
            <div>
              <p className="text-[11px] text-slate-500">部门变化</p>
              <p className="text-lg font-semibold leading-6 text-slate-800">
                <span className="text-emerald-600">+{diff.departmentsAdded}</span>
                {diff.departmentsRemoved ? (
                  <>
                    <span className="mx-1 text-xs text-slate-300">/</span>
                    <span className="text-xs font-medium text-rose-500">-{diff.departmentsRemoved}</span>
                  </>
                ) : null}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3 px-5 py-3">
            <span className="flex h-8 w-8 items-center justify-center rounded-md bg-slate-100 text-slate-500">
              <SlidersHorizontal className="h-4 w-4" />
            </span>
            <div>
              <p className="text-[11px] text-slate-500">调整项</p>
              <p className="text-lg font-semibold leading-6 text-slate-800">
                {diff.peopleChanged + diff.departmentsChanged}
                <span className="ml-1 text-xs font-normal text-slate-400">项</span>
              </p>
            </div>
          </div>
        </div>
      </Card>

      {diff.ignoredReason ? (
        <div className="flex items-start gap-2 rounded-md bg-amber-50 px-4 py-3 text-xs text-amber-800 ring-1 ring-inset ring-amber-200/70">
          <span className="font-medium">已忽略：</span>
          {diff.ignoredReason}
        </div>
      ) : null}

      <Card>
        <CardHeader
          title="变更明细"
          description={`共 ${diff.totalChanges} 项`}
          icon={<GitCompareArrows className="h-4 w-4" />}
          className="border-b border-slate-100"
          actions={
            <Input
              value={q}
              onChange={(event) => {
                setQ(event.target.value);
                setPage(1);
              }}
              placeholder="搜索对象 / 部门"
              className="w-56"
            />
          }
        />
        <div className="px-5 pt-3">
          <Tabs
            value={tab}
            onChange={(value) => {
              setTab(value);
              setPage(1);
            }}
            items={[
              { value: "all", label: "全部", count: diff.totalChanges },
              { value: "person", label: "人员", count: diff.peopleAdded + diff.peopleRemoved + diff.peopleChanged },
              { value: "department", label: "部门", count: diff.departmentsAdded + diff.departmentsRemoved + diff.departmentsChanged },
            ]}
          />
        </div>

        {changesQuery.isLoading ? (
          <LoadingBlock />
        ) : !changesQuery.data?.items.length ? (
          <EmptyState title="没有变更明细" />
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[940px] text-sm">
                <thead className="border-b border-slate-100 bg-slate-50/60 text-left text-[11px] font-medium text-slate-500">
                  <tr>
                    <th className="px-5 py-2.5 font-medium">级别</th>
                    <th className="px-5 py-2.5 font-medium">变更</th>
                    <th className="px-5 py-2.5 font-medium">对象</th>
                    <th className="px-5 py-2.5 font-medium">变更前</th>
                    <th className="px-5 py-2.5 font-medium">变更后</th>
                    <th className="px-5 py-2.5 font-medium">部门路径</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {changesQuery.data.items.map((change) => {
                    const values = changeValues(change);
                    return (
                      <tr key={change.id} className="align-top transition-colors hover:bg-slate-50/70">
                        <td className="px-5 py-3">
                          <Badge tone={SEVERITY_TONE[change.severity]}>{SEVERITY_LABELS[change.severity]}</Badge>
                        </td>
                        <td className="whitespace-nowrap px-5 py-3 text-slate-700">{changeLabel(change.changeKind)}</td>
                        <td className="px-5 py-3">
                          <div className="flex items-center gap-2.5">
                            {change.entityType === "person" ? (
                              <Avatar name={change.entityName} size="sm" />
                            ) : (
                              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-slate-100 text-slate-500">
                                <Building2 className="h-3.5 w-3.5" />
                              </span>
                            )}
                            <div className="min-w-0">
                              <p className="truncate font-medium text-slate-800">{change.entityName}</p>
                              <p className="truncate text-[11px] text-slate-400">
                                {change.entityType === "person" ? "人员" : "部门"} · {change.entityKey}
                              </p>
                            </div>
                          </div>
                        </td>
                        <td className="max-w-[240px] px-5 py-3 text-slate-500">{values.before}</td>
                        <td className="max-w-[240px] px-5 py-3 font-medium text-slate-900">{values.after}</td>
                        <td className="max-w-[240px] px-5 py-3 text-xs text-slate-400">
                          {change.departmentPathAfter ?? change.departmentPathBefore ?? "-"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <Pagination
              page={page}
              pageSize={30}
              total={changesQuery.data.total}
              onChange={setPage}
            />
          </>
        )}
      </Card>

      <Card className="overflow-hidden">
        <CardHeader
          title="知情记录"
          description={`${informsQuery.data?.items.length ?? 0} 批 · 每批发送的收件人与回执状态`}
          icon={<Bell className="h-4 w-4" />}
          className="border-b border-slate-100"
          actions={
            operator ? (
              <Button variant="outline" size="sm" onClick={() => setInformOpen(true)} disabled={diff.status === "ignored"}>
                <Send className="h-3.5 w-3.5" />
                发送卡片
              </Button>
            ) : null
          }
        />
        {informsQuery.isLoading ? (
          <LoadingBlock />
        ) : !informsQuery.data?.items.length ? (
          <div className="flex flex-col items-center gap-1.5 px-5 py-9 text-center">
            <div className="flex h-10 w-10 items-center justify-center rounded-md bg-slate-50 text-slate-300 ring-1 ring-inset ring-slate-100">
              <Send className="h-4 w-4" />
            </div>
            <p className="text-sm font-medium text-slate-700">还没有发送过知情卡片</p>
            <p className="text-xs text-slate-400">选择知情人后发送飞书卡片，发送与回执状态会记录在这里。</p>
          </div>
        ) : (
          <div className="space-y-3 p-4">
            {informsQuery.data.items.map((inform, index) => (
              <div key={inform.id} className="overflow-hidden rounded-lg border border-slate-200">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 bg-slate-50/60 px-3 py-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-white text-[11px] font-semibold text-slate-500 ring-1 ring-inset ring-slate-200">
                      {index + 1}
                    </span>
                    <div className="min-w-0">
                      <p className="text-xs font-medium text-slate-800">批次 #{inform.id}</p>
                      <p className="text-[11px] text-slate-400">
                        {formatDateTime(inform.createdAt)} · {inform.deliveries.length} 个收件人
                      </p>
                    </div>
                  </div>
                  {inform.note ? (
                    <span className="max-w-full truncate text-[11px] text-slate-500" title={inform.note}>
                      说明：{inform.note}
                    </span>
                  ) : null}
                </div>
                <div className="divide-y divide-slate-100">
                  <div className="hidden grid-cols-[minmax(0,1fr)_56px_80px_90px_120px] gap-3 px-3 py-2 text-[10px] font-medium text-slate-400 sm:grid">
                    <span>收件人</span>
                    <span>类型</span>
                    <span>发送状态</span>
                    <span>知情状态</span>
                    <span className="text-right">操作</span>
                  </div>
                  {inform.deliveries.map((delivery) => (
                    <div
                      key={delivery.id}
                      className="grid grid-cols-1 gap-2 px-3 py-2.5 sm:grid-cols-[minmax(0,1fr)_56px_80px_90px_120px] sm:items-center sm:gap-3"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-xs font-medium text-slate-800">{delivery.recipientName}</p>
                        <p className="truncate text-[11px] text-slate-400">{delivery.recipientId}</p>
                        {delivery.errorMessage ? (
                          <p className="mt-0.5 max-w-full truncate text-[11px] text-rose-600">{delivery.errorMessage}</p>
                        ) : null}
                      </div>
                      <span className="text-[11px] text-slate-500 sm:text-xs">
                        {delivery.recipientType === "user" ? "个人" : "群聊"}
                      </span>
                      <span>
                        <Badge
                          tone={delivery.status === "sent" ? "green" : delivery.status === "failed" ? "red" : "gray"}
                        >
                          {DELIVERY_LABELS[delivery.status]}
                        </Badge>
                      </span>
                      <span>
                        {delivery.acknowledgedAt ? (
                          <Badge tone="green">
                            {delivery.acknowledgedVia === "operator" ? "管理员代确认" : "已知情"}
                          </Badge>
                        ) : delivery.recipientType === "chat" ? (
                          <span className="text-[11px] text-slate-400">群聊不回执</span>
                        ) : (
                          <span className="text-[11px] text-slate-400">待知情</span>
                        )}
                      </span>
                      <div className="flex flex-wrap items-center gap-1 sm:justify-end">
                        {delivery.status !== "sent" && operator ? (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => retry.mutate({ informId: inform.id, deliveryId: delivery.id })}
                            loading={retry.isPending}
                          >
                            重试
                          </Button>
                        ) : null}
                        {!delivery.acknowledgedAt && operator && delivery.recipientType === "user" ? (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => ackDelivery.mutate(delivery.id)}
                            loading={ackDelivery.isPending}
                          >
                            代确认
                          </Button>
                        ) : null}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Modal
        open={informOpen}
        onOpenChange={setInformOpen}
        title="发送知情卡片"
        description="选择知情人并发送飞书卡片，平台会记录发送与回执状态"
        width="max-w-2xl"
        footer={
          <>
            <Button variant="outline" onClick={() => setInformOpen(false)}>
              取消
            </Button>
            <Button
              onClick={() => sendInform.mutate()}
              loading={sendInform.isPending}
              disabled={!recipients.length}
            >
              发送给 {recipients.length} 个对象
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div>
            <p className="mb-1.5 text-sm font-medium text-slate-700">已选收件人</p>
            {recipients.length ? (
              <div className="flex flex-wrap gap-1.5">
                {recipients.map((recipient) => (
                  <span
                    key={`${recipient.type}:${recipient.id}`}
                    className="inline-flex items-center gap-1 rounded-full bg-primary-50 px-2 py-1 text-xs text-primary-700"
                  >
                    {recipient.type === "chat" ? "群 · " : ""}
                    {recipient.name}
                    <button
                      type="button"
                      aria-label="移除"
                      onClick={() =>
                        setRecipients((previous) =>
                          previous.filter((item) => !(item.type === recipient.type && item.id === recipient.id)),
                        )
                      }
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                ))}
              </div>
            ) : (
              <p className="text-xs text-slate-500">从下方选择人员或群聊，或输入邮箱</p>
            )}
          </div>

          <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
            <Input
              placeholder="搜索人员（姓名 / 邮箱）"
              value={peopleQueryText}
              onChange={(event) => setPeopleQueryText(event.target.value)}
            />
            <div className="flex gap-2">
              <Input
                placeholder="或输入邮箱"
                value={emailInput}
                onChange={(event) => setEmailInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    addEmail();
                  }
                }}
              />
              <Button variant="outline" onClick={addEmail} type="button">
                <Plus className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>

          <div className="max-h-48 overflow-y-auto rounded-lg border border-slate-200">
            {peopleSearch.isLoading ? (
              <LoadingBlock label="搜索中…" />
            ) : !peopleSearch.data?.items.length ? (
              <p className="px-3 py-4 text-xs text-slate-500">没有匹配的人员</p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {peopleSearch.data.items.map((person) => {
                  const key = `user:${person.openId}`;
                  const checked = selectedKeys.has(key);
                  return (
                    <li key={person.openId}>
                      <button
                        type="button"
                        onClick={() => toggleRecipient({ type: "user", id: person.openId, name: person.name })}
                        className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-slate-50"
                      >
                        <span className="min-w-0">
                          <span className="font-medium text-slate-800">{person.name}</span>
                          <span className="ml-2 text-xs text-slate-500">{person.email || person.enterpriseEmail || ""}</span>
                          <span className="block truncate text-[11px] text-slate-400">
                            {person.departmentPaths?.join("；") ?? ""}
                          </span>
                        </span>
                        <Badge tone={checked ? "blue" : "gray"}>{checked ? "已选" : "选择"}</Badge>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          <div>
            <p className="mb-1.5 text-sm font-medium text-slate-700">群聊</p>
            {chatsQuery.data?.warning ? (
              <p className="mb-1 text-xs text-amber-600">{chatsQuery.data.warning}</p>
            ) : null}
            <div className="flex flex-wrap gap-1.5">
              {(chatsQuery.data?.items ?? []).map((chat) => {
                const key = `chat:${chat.chatId}`;
                const checked = selectedKeys.has(key);
                return (
                  <button
                    key={chat.chatId}
                    type="button"
                    onClick={() => toggleRecipient({ type: "chat", id: chat.chatId, name: chat.name })}
                    className={`rounded-lg border px-2 py-1 text-xs ${
                      checked ? "border-primary-500 bg-primary-50 text-primary-700" : "border-slate-300 text-slate-600 hover:bg-slate-50"
                    }`}
                  >
                    {chat.name}
                  </button>
                );
              })}
              {!chatsQuery.data?.items.length && !chatsQuery.isLoading ? (
                <span className="text-xs text-slate-500">未读取到机器人所在群，可在设置中确认 im:chat:readonly 权限</span>
              ) : null}
            </div>
          </div>

          <Field label="说明（可选，显示在卡片里）">
            <Textarea value={note} onChange={(event) => setNote(event.target.value)} maxLength={500} placeholder="例如：请相关负责人确认并回复" />
          </Field>
        </div>
      </Modal>

      <Modal
        open={ignoreOpen}
        onOpenChange={setIgnoreOpen}
        title="忽略该差异"
        description="忽略后仍保留记录，但不会再提醒"
        footer={
          <>
            <Button variant="outline" onClick={() => setIgnoreOpen(false)}>
              取消
            </Button>
            <Button
              variant="danger"
              onClick={() => resolve.mutate({ status: "ignored", reason: ignoreReason })}
              loading={resolve.isPending}
              disabled={!ignoreReason.trim()}
            >
              确认忽略
            </Button>
          </>
        }
      >
        <Field label="忽略理由" hint="例如：测试数据、已知的人事调整">
          <Textarea value={ignoreReason} onChange={(event) => setIgnoreReason(event.target.value)} maxLength={500} />
        </Field>
      </Modal>
    </div>
  );
}
