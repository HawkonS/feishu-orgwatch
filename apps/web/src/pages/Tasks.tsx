import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  CalendarClock,
  Clock3,
  History,
  Pencil,
  Play,
  Plus,
  Sparkles,
  Trash2,
} from "lucide-react";
import { del, get, patch, post, errorMessage } from "../api";
import type { Paged, Run, Task } from "../lib/types";
import { canOperate, useSession } from "../lib/session";
import { RUN_STATUS_LABELS, RUN_STATUS_TONE, formatDateTime, relativeTime } from "../lib/format";
import {
  DEFAULT_SCHEDULE,
  ScheduleBuilder,
  buildCron,
  describeCron,
  parseCron,
  type ScheduleState,
} from "../components/ScheduleBuilder";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  Input,
  LoadingBlock,
  Modal,
  PageHeader,
  Select,
  Switch,
  Textarea,
} from "../components/ui";

type FormState = {
  name: string;
  description: string;
  cron: string;
  timezone: string;
  rootDepartmentId: string;
  retentionRuns: number;
  enabled: boolean;
};

const EMPTY_FORM: FormState = {
  name: "",
  description: "",
  cron: "0 9 * * *",
  timezone: "Asia/Shanghai",
  rootDepartmentId: "0",
  retentionRuns: 60,
  enabled: true,
};

const TIMEZONES = [
  "Asia/Shanghai",
  "Asia/Hong_Kong",
  "Asia/Tokyo",
  "Asia/Singapore",
  "UTC",
  "Europe/London",
  "America/New_York",
  "America/Los_Angeles",
];

export default function Tasks() {
  const { user } = useSession();
  const operator = canOperate(user);
  const queryClient = useQueryClient();
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Task | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [schedule, setSchedule] = useState<ScheduleState>(DEFAULT_SCHEDULE);
  const [preview, setPreview] = useState<string[] | null>(null);
  const [historyTask, setHistoryTask] = useState<Task | null>(null);

  const tasksQuery = useQuery({
    queryKey: ["tasks"],
    queryFn: () => get<{ items: Task[] }>("/tasks"),
    refetchInterval: 15_000,
  });

  const runsQuery = useQuery({
    queryKey: ["task-runs", historyTask?.id],
    queryFn: () => get<Paged<Run>>(`/tasks/${historyTask!.id}/runs?pageSize=20`),
    enabled: Boolean(historyTask),
    refetchInterval: 3000,
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["tasks"] });

  const save = useMutation({
    mutationFn: async () => {
      const payload = {
        name: form.name.trim(),
        description: form.description.trim() || null,
        cron: form.cron.trim(),
        timezone: form.timezone,
        rootDepartmentId: form.rootDepartmentId.trim() || "0",
        retentionRuns: Number(form.retentionRuns),
        enabled: form.enabled,
      };
      if (editing) return patch(`/tasks/${editing.id}`, payload);
      return post("/tasks", payload);
    },
    onSuccess: async () => {
      toast.success(editing ? "任务已更新" : "任务已创建");
      setFormOpen(false);
      setEditing(null);
      setPreview(null);
      await invalidate();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const remove = useMutation({
    mutationFn: (id: number) => del(`/tasks/${id}`),
    onSuccess: async () => {
      toast.success("任务已删除");
      await invalidate();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const toggle = useMutation({
    mutationFn: (payload: { id: number; enabled: boolean }) =>
      post(`/tasks/${payload.id}/enable`, { enabled: payload.enabled }),
    onSuccess: async () => invalidate(),
    onError: (error) => toast.error(errorMessage(error)),
  });

  const run = useMutation({
    mutationFn: (id: number) => post<{ runId: number }>(`/tasks/${id}/run`),
    onSuccess: async (data) => {
      toast.success(`巡查已开始（运行 #${data.runId}）`);
      await queryClient.invalidateQueries({ queryKey: ["overview"] });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const openCreate = () => {
    setEditing(null);
    setForm(EMPTY_FORM);
    setSchedule(parseCron(EMPTY_FORM.cron));
    setPreview(null);
    setFormOpen(true);
  };

  const openEdit = (task: Task) => {
    setEditing(task);
    setForm({
      name: task.name,
      description: task.description ?? "",
      cron: task.cron,
      timezone: task.timezone,
      rootDepartmentId: task.rootDepartmentId,
      retentionRuns: task.retentionRuns,
      enabled: task.enabled,
    });
    setSchedule(parseCron(task.cron));
    setPreview(null);
    setFormOpen(true);
  };

  const applySchedule = (next: ScheduleState) => {
    setSchedule(next);
    setForm((previous) => ({ ...previous, cron: buildCron(next) }));
    setPreview(null);
  };

  const validateCron = async () => {
    try {
      const data = await post<{ timezone: string; next: string[] }>("/tasks/validate-cron", {
        cron: form.cron,
        timezone: form.timezone,
      });
      setPreview(data.next);
      toast.success("cron 表达式有效");
    } catch (error) {
      setPreview(null);
      toast.error(errorMessage(error));
    }
  };

  const tasks = tasksQuery.data?.items ?? [];

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Schedules"
        title="巡查任务"
        description="按设定时间拉取组织架构快照并生成差异；到点后由服务内调度器执行。"
        actions={
          operator ? (
            <Button onClick={openCreate}>
              <Plus className="h-4 w-4" />
              新建任务
            </Button>
          ) : null
        }
      />

      {tasksQuery.isLoading ? (
        <Card>
          <LoadingBlock />
        </Card>
      ) : !tasks.length ? (
        <Card>
          <div className="px-6 py-14">
            <div className="mx-auto flex max-w-md flex-col items-center text-center">
              <div className="flex h-14 w-14 items-center justify-center rounded-lg bg-slate-100 text-slate-500">
                <CalendarClock className="h-6 w-6" />
              </div>
              <h3 className="mt-4 text-lg font-semibold tracking-tight text-slate-900">让巡查自动发生</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-slate-500">
                创建定时任务后，服务会按计划抓取快照并生成差异；有变化时在平台内通知你。
              </p>
              {operator ? (
                <Button className="mt-4" onClick={openCreate}>
                  <Plus className="h-4 w-4" />
                  创建第一个任务
                </Button>
              ) : null}
            </div>
          </div>
        </Card>
      ) : (
        <div className="grid gap-3">
          {tasks.map((task) => (
            <Card key={task.id} className="group overflow-hidden">
              <div className="flex flex-wrap items-start gap-4 p-5">
                <div
                  className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-md ring-1 ring-inset ${
                    task.enabled
                      ? "bg-primary-50 text-primary-600 ring-primary-100"
                      : "bg-slate-100 text-slate-400 ring-slate-200"
                  }`}
                >
                  <CalendarClock className="h-5 w-5" />
                </div>

                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[15px] font-semibold text-slate-900">{task.name}</span>
                    <Badge tone={task.enabled ? "green" : "gray"} dot>
                      {task.enabled ? "已启用" : "已停用"}
                    </Badge>
                    <Badge tone="gray">根部门 {task.rootDepartmentId}</Badge>
                  </div>
                  {task.description ? (
                    <p className="mt-1 text-xs leading-relaxed text-slate-500">{task.description}</p>
                  ) : null}

                  <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-slate-500">
                    <span className="inline-flex items-center gap-1.5">
                      <Clock3 className="h-3 w-3 text-slate-400" />
                      {describeCron(task.cron)}
                    </span>
                    <span>{task.timezone}</span>
                    <span>保留 {task.retentionRuns} 份快照</span>
                  </div>

                  <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px]">
                    <span className="rounded-lg bg-slate-50 px-2.5 py-1 text-slate-500 ring-1 ring-inset ring-slate-100">
                      下次执行{" "}
                      <span className="font-medium text-slate-700">
                        {task.enabled ? relativeTime(task.nextRunAt) : "已停用"}
                      </span>
                    </span>
                    <span className="rounded-lg bg-slate-50 px-2.5 py-1 text-slate-500 ring-1 ring-inset ring-slate-100">
                      上次执行 {task.lastRunAt ? formatDateTime(task.lastRunAt) : "从未"}
                    </span>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-1.5">
                  {operator ? (
                    <Switch
                      checked={task.enabled}
                      label={`启用 ${task.name}`}
                      onChange={(checked) => toggle.mutate({ id: task.id, enabled: checked })}
                    />
                  ) : null}
                  {operator ? (
                    <Button variant="outline" size="sm" onClick={() => run.mutate(task.id)} loading={run.isPending}>
                      <Play className="h-3.5 w-3.5" />
                      立即执行
                    </Button>
                  ) : null}
                  <Button variant="ghost" size="sm" onClick={() => setHistoryTask(task)}>
                    <History className="h-3.5 w-3.5" />
                    记录
                  </Button>
                  {operator ? (
                    <>
                      <Button variant="ghost" size="sm" onClick={() => openEdit(task)}>
                        <Pencil className="h-3.5 w-3.5" />
                        编辑
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-rose-600 hover:bg-rose-50 hover:text-rose-700"
                        onClick={() => {
                          if (window.confirm(`确定删除任务「${task.name}」？历史运行记录会保留。`)) remove.mutate(task.id);
                        }}
                        loading={remove.isPending}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </>
                  ) : null}
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      <Modal
        open={formOpen}
        onOpenChange={(open) => {
          setFormOpen(open);
          if (!open) {
            setEditing(null);
            setPreview(null);
          }
        }}
        title={editing ? `编辑任务「${editing.name}」` : "新建巡查任务"}
        description="选择执行频率和时间，系统会自动换算成调度规则。"
        width="max-w-2xl"
        footer={
          <>
            <Button variant="outline" onClick={() => setFormOpen(false)}>
              取消
            </Button>
            <Button onClick={() => save.mutate()} loading={save.isPending} disabled={!form.name.trim() || !form.cron.trim()}>
              {editing ? "保存" : "创建"}
            </Button>
          </>
        }
      >
        <div className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="任务名称">
              <Input
                value={form.name}
                onChange={(event) => setForm({ ...form, name: event.target.value })}
                placeholder="例如：每日组织架构巡查"
              />
            </Field>
            <Field label="根部门 ID" hint="0 表示全部组织">
              <Input
                value={form.rootDepartmentId}
                onChange={(event) => setForm({ ...form, rootDepartmentId: event.target.value })}
              />
            </Field>
          </div>

          <Field label="说明（可选）">
            <Textarea
              value={form.description}
              onChange={(event) => setForm({ ...form, description: event.target.value })}
              placeholder="这个任务负责的范围或注意事项"
              className="min-h-16"
            />
          </Field>

          <ScheduleBuilder value={schedule} onChange={applySchedule} />

          <div className="grid gap-4 sm:grid-cols-[220px_1fr]">
            <Field label="时区">
              <Select
                value={form.timezone}
                onChange={(event) => {
                  setForm({ ...form, timezone: event.target.value });
                  setPreview(null);
                }}
              >
                {[...new Set([form.timezone, ...TIMEZONES])].map((zone) => (
                  <option key={zone} value={zone}>
                    {zone}
                  </option>
                ))}
              </Select>
            </Field>
            <div className="flex items-end pb-1 text-xs text-slate-400">
              时区只影响触发时间，不影响快照内容。
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-4">
            <Button variant="outline" size="sm" onClick={() => void validateCron()}>
              验证并预览
            </Button>
            <label className="flex items-center gap-2 text-sm text-slate-600">
              <Switch checked={form.enabled} onChange={(checked) => setForm({ ...form, enabled: checked })} label="启用任务" />
              {editing ? "启用任务" : "创建后立即启用"}
            </label>
            <label className="ml-auto flex items-center gap-2 text-sm text-slate-600">
              保留快照
              <Input
                type="number"
                min={2}
                max={365}
                className="w-20"
                value={form.retentionRuns}
                onChange={(event) => setForm({ ...form, retentionRuns: Number(event.target.value) })}
              />
              份
            </label>
          </div>

          {preview ? (
            <div className="rounded-md bg-transparent p-4 ring-1 ring-inset ring-slate-100">
              <p className="flex items-center gap-1.5 text-[11px] font-medium text-slate-600">
                <Sparkles className="h-3.5 w-3.5 text-primary-500" />
                接下来 5 次执行（{form.timezone}）
              </p>
              <ol className="mt-2 space-y-1">
                {preview.map((item, index) => (
                  <li key={item} className="flex items-center gap-2 text-[11px] text-slate-500">
                    <span className="flex h-4 w-4 items-center justify-center rounded-full bg-white text-[9px] text-slate-400 ring-1 ring-slate-200">
                      {index + 1}
                    </span>
                    {formatDateTime(item)}
                  </li>
                ))}
              </ol>
            </div>
          ) : null}
        </div>
      </Modal>

      <Modal
        open={Boolean(historyTask)}
        onOpenChange={(open) => !open && setHistoryTask(null)}
        title={`运行记录 · ${historyTask?.name ?? ""}`}
        width="max-w-2xl"
      >
        {runsQuery.isLoading ? (
          <LoadingBlock />
        ) : !runsQuery.data?.items.length ? (
          <EmptyState title="还没有运行记录" />
        ) : (
          <ol className="relative space-y-4 border-l border-slate-200 pl-4">
            {runsQuery.data.items.map((item) => (
              <li key={item.id} className="relative">
                <span
                  className={`absolute -left-[21px] top-1 h-2.5 w-2.5 rounded-full ring-4 ring-white ${
                    item.status === "success"
                      ? "bg-emerald-500"
                      : item.status === "failed"
                        ? "bg-rose-500"
                        : item.status === "needs_review"
                          ? "bg-orange-500"
                          : item.status === "running"
                            ? "bg-primary-500 ow-pulse"
                            : "bg-slate-300"
                  }`}
                />
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-xs font-medium text-slate-800">
                    运行 #{item.id} · {formatDateTime(item.startedAt)}
                  </p>
                  <Badge tone={RUN_STATUS_TONE[item.status]}>{RUN_STATUS_LABELS[item.status]}</Badge>
                </div>
                <p className="mt-0.5 text-[11px] text-slate-500">
                  人员 {item.peopleCount} · 部门 {Math.max(0, item.departmentCount - 1)}
                  {item.diffId ? ` · 差异 #${item.diffId}` : ""}
                  {item.trigger === "catchup" ? " · 补跑" : ""}
                </p>
                {item.errorMessage ? <p className="mt-1 text-[11px] text-rose-600">{item.errorMessage}</p> : null}
              </li>
            ))}
          </ol>
        )}
      </Modal>
    </div>
  );
}
