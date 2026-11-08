import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Check,
  Copy,
  Download,
  KeyRound,
  Pencil,
  Power,
  Search,
  Trash2,
  UserCog,
  UserPlus,
} from "lucide-react";
import { del, get, patch, post, errorMessage } from "../api";
import { useSession, type Role } from "../lib/session";
import { formatDateTime } from "../lib/format";
import {
  Avatar,
  Badge,
  Button,
  EmptyState,
  Field,
  Input,
  LoadingBlock,
  Modal,
  PageHeader,
  Pagination,
  Select,
} from "../components/ui";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../components/ui/table";

type AdminUser = {
  id: number;
  username: string;
  displayName: string;
  email: string | null;
  avatarUrl: string | null;
  role: Role;
  status: "active" | "disabled";
  source: string;
  lastLoginAt: string | null;
  createdAt: string;
};

type UsersResponse = {
  items: AdminUser[];
  total: number;
  page: number;
  pageSize: number;
  stats: { total: number; active: number; admins: number; disabled: number };
};

type Candidate = {
  openId: string;
  name: string;
  email: string | null;
  jobTitle: string | null;
  avatarUrl: string | null;
  status: string;
  imported: boolean;
  linkedUsername: string | null;
};

type CandidatesResponse = { snapshot: { id: number } | null; items: Candidate[] };

const ROLE_LABELS: Record<Role, string> = { admin: "系统管理员", operator: "运营管理员", viewer: "普通账户" };
const ROLE_OPTIONS = [
  { value: "all", label: "全部角色" },
  { value: "admin", label: "系统管理员" },
  { value: "operator", label: "运营管理员" },
  { value: "viewer", label: "普通账户" },
];
const PAGE_SIZES = [10, 20, 50, 100];

type FormState = {
  displayName: string;
  username: string;
  email: string;
  role: Role;
  status: "active" | "disabled";
  password: string;
};

const EMPTY_FORM: FormState = {
  displayName: "",
  username: "",
  email: "",
  role: "viewer",
  status: "active",
  password: "",
};

export default function UsersAdmin() {
  const { user: currentUser } = useSession();
  const queryClient = useQueryClient();
  const [queryInput, setQueryInput] = useState("");
  const [query, setQuery] = useState("");
  const [role, setRole] = useState("all");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<AdminUser | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [deleteTarget, setDeleteTarget] = useState<AdminUser | null>(null);
  const [resetTarget, setResetTarget] = useState<AdminUser | null>(null);
  const [resetResult, setResetResult] = useState<{ user: AdminUser; password: string } | null>(null);

  const [importOpen, setImportOpen] = useState(false);
  const [importQuery, setImportQuery] = useState("");
  const [candidateQuery, setCandidateQuery] = useState("");
  const [selectedCandidates, setSelectedCandidates] = useState<Set<string>>(new Set());
  const [importRole, setImportRole] = useState<Role>("viewer");

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setQuery(queryInput.trim());
      setPage(1);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [queryInput]);

  useEffect(() => {
    const timer = window.setTimeout(() => setCandidateQuery(importQuery.trim()), 300);
    return () => window.clearTimeout(timer);
  }, [importQuery]);

  const usersQuery = useQuery({
    queryKey: ["admin-users", page, pageSize, query, role],
    queryFn: () => {
      const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
      if (query) params.set("q", query);
      if (role !== "all") params.set("role", role);
      return get<UsersResponse>(`/admin/users?${params.toString()}`);
    },
  });

  const candidatesQuery = useQuery({
    queryKey: ["feishu-candidates", candidateQuery],
    queryFn: () => {
      const params = candidateQuery ? `?q=${encodeURIComponent(candidateQuery)}` : "";
      return get<CandidatesResponse>(`/admin/users/feishu-candidates${params}`);
    },
    enabled: importOpen,
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["admin-users"] });

  const save = useMutation({
    mutationFn: async () => {
      if (editing) {
        return patch(`/admin/users/${editing.id}`, {
          displayName: form.displayName.trim(),
          email: form.email.trim() || null,
          role: form.role,
          status: form.status,
        });
      }
      return post("/admin/users", {
        username: form.username.trim(),
        displayName: form.displayName.trim(),
        email: form.email.trim() || null,
        role: form.role,
        password: form.password,
      });
    },
    onSuccess: async () => {
      toast.success(editing ? "用户已更新" : "用户已创建");
      setFormOpen(false);
      setEditing(null);
      await invalidate();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const importUsers = useMutation({
    mutationFn: () =>
      post<{ created: Array<{ username: string }>; skipped: Array<{ name: string }> }>("/admin/users/import", {
        openIds: [...selectedCandidates],
        role: importRole,
      }),
    onSuccess: async (data) => {
      toast.success(
        `已导入 ${data.created.length} 人${data.skipped.length ? `，跳过 ${data.skipped.length} 人` : ""}`,
      );
      setImportOpen(false);
      setSelectedCandidates(new Set());
      setImportQuery("");
      await invalidate();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const remove = useMutation({
    mutationFn: (id: number) => del(`/admin/users/${id}`),
    onSuccess: async () => {
      toast.success("用户已删除");
      setDeleteTarget(null);
      await invalidate();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const resetPassword = useMutation({
    mutationFn: (id: number) => post<{ password: string }>(`/admin/users/${id}/reset-password`, {}),
    onSuccess: async (data) => {
      const target = resetTarget;
      setResetTarget(null);
      if (target) setResetResult({ user: target, password: data.password });
      await invalidate();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const toggleStatus = useMutation({
    mutationFn: (target: AdminUser) =>
      patch(`/admin/users/${target.id}`, {
        status: target.status === "active" ? "disabled" : "active",
      }),
    onSuccess: async (_data, target) => {
      toast.success(target.status === "active" ? "用户已停用" : "用户已启用");
      await invalidate();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const openCreate = () => {
    setEditing(null);
    setForm(EMPTY_FORM);
    setFormOpen(true);
  };

  const openEdit = (user: AdminUser) => {
    setEditing(user);
    setForm({
      displayName: user.displayName,
      username: user.username,
      email: user.email ?? "",
      role: user.role,
      status: user.status,
      password: "",
    });
    setFormOpen(true);
  };

  const openImport = () => {
    setImportQuery("");
    setCandidateQuery("");
    setSelectedCandidates(new Set());
    setImportRole("viewer");
    setImportOpen(true);
  };

  const toggleCandidate = (openId: string, imported: boolean) => {
    if (imported) return;
    setSelectedCandidates((previous) => {
      const next = new Set(previous);
      if (next.has(openId)) next.delete(openId);
      else next.add(openId);
      return next;
    });
  };

  const stats = usersQuery.data?.stats;
  const items = usersQuery.data?.items ?? [];
  const isSelf = (user: AdminUser) => user.id === currentUser?.id;
  const candidates = candidatesQuery.data?.items ?? [];
  const selectable = candidates.filter((candidate) => !candidate.imported);

  return (
    <div className="flex flex-col gap-4 lg:h-[calc(100vh-6.5rem)] lg:min-h-[640px]">
      <PageHeader
        title="用户管理"
        description="管理账号、角色和访问状态。"
        actions={
          <>
            <Button variant="outline" size="sm" onClick={openImport}>
              <Download className="h-4 w-4" />
              从飞书导入
            </Button>
            <Button size="sm" onClick={openCreate}>
              <UserPlus className="h-4 w-4" />
              新增用户
            </Button>
          </>
        }
      />

      <div className="flex shrink-0 flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1 sm:flex-none">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
          <Input
            value={queryInput}
            onChange={(event) => setQueryInput(event.target.value)}
            placeholder="搜索姓名、用户名或邮箱"
            className="h-8 w-full pl-8 sm:w-72"
          />
        </div>
        <Select
          value={role}
          onChange={(event) => {
            setRole(event.target.value);
            setPage(1);
          }}
          className="h-8 w-32 text-sm"
        >
          {ROLE_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </Select>
        <Button
          variant="ghost"
          size="sm"
          className="h-8 text-xs"
          onClick={() => {
            setQueryInput("");
            setQuery("");
            setRole("all");
            setPage(1);
          }}
        >
          恢复默认
        </Button>
        <div className="ml-auto flex items-center gap-3 text-xs text-slate-500">
          <span>共 {stats?.total ?? 0} 人</span>
          <span>启用 {stats?.active ?? 0}</span>
          <span>系统管理员 {stats?.admins ?? 0}</span>
        </div>
      </div>

      <div className="flex min-h-[420px] flex-1 flex-col overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
        {usersQuery.isLoading ? (
          <div className="flex flex-1 items-center justify-center">
            <LoadingBlock />
          </div>
        ) : usersQuery.isError ? (
          <div className="flex flex-1 items-center justify-center text-sm text-rose-600">
            用户加载失败，请稍后重试。
          </div>
        ) : !items.length ? (
          <div className="flex flex-1 items-center justify-center">
            <EmptyState
              title={query || role !== "all" ? "没有匹配的用户" : "还没有用户"}
              description={query || role !== "all" ? "调整筛选条件后再试。" : "创建本地账号，或从飞书导入成员。"}
              icon={<UserCog className="h-5 w-5" />}
            />
          </div>
        ) : (
          <div className="min-h-0 flex-1 overflow-auto">
            <Table className="min-w-[920px] table-fixed [&_td]:py-3">
              <colgroup>
                <col className="w-[26%]" />
                <col className="w-[16%]" />
                <col className="w-[12%]" />
                <col className="w-[10%]" />
                <col className="w-[8%]" />
                <col className="w-[18%]" />
                <col className="w-[10%]" />
              </colgroup>
              <TableHeader className="sticky top-0 z-10 bg-white">
                <TableRow className="bg-slate-50 hover:bg-slate-50">
                  <TableHead>用户</TableHead>
                  <TableHead>用户名</TableHead>
                  <TableHead>角色</TableHead>
                  <TableHead>状态</TableHead>
                  <TableHead>来源</TableHead>
                  <TableHead>最后登录</TableHead>
                  <TableHead className="text-right">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((user) => (
                  <TableRow key={user.id}>
                    <TableCell>
                      <div className="flex items-center gap-2.5">
                        <Avatar name={user.displayName} src={user.avatarUrl} size="sm" />
                        <div className="min-w-0">
                          <p className="truncate font-medium text-slate-800">{user.displayName}</p>
                          <p className="truncate text-xs text-slate-500">{user.email || "-"}</p>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="truncate text-slate-600">
                      {user.username}
                      {isSelf(user) ? <Badge tone="blue" className="ml-2">我</Badge> : null}
                    </TableCell>
                    <TableCell>
                      <Badge tone={user.role === "admin" ? "blue" : user.role === "operator" ? "purple" : "gray"}>
                        {ROLE_LABELS[user.role]}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge tone={user.status === "active" ? "green" : "gray"} dot>
                        {user.status === "active" ? "启用" : "停用"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs text-slate-500">
                      {user.source === "feishu" ? "飞书" : "本地"}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-xs text-slate-500">
                      {user.lastLoginAt ? formatDateTime(user.lastLoginAt) : "从未"}
                    </TableCell>
                    <TableCell>
                      <div className="flex justify-end gap-0.5">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 w-7 p-0"
                          title="编辑"
                          aria-label="编辑"
                          onClick={() => openEdit(user)}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 w-7 p-0"
                          title="重置密码"
                          aria-label="重置密码"
                          onClick={() => setResetTarget(user)}
                        >
                          <KeyRound className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 w-7 p-0"
                          title={user.status === "active" ? "停用" : "启用"}
                          aria-label={user.status === "active" ? "停用" : "启用"}
                          disabled={isSelf(user)}
                          onClick={() => toggleStatus.mutate(user)}
                        >
                          <Power className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 w-7 p-0 text-rose-600 hover:bg-rose-50 hover:text-rose-700"
                          title="删除"
                          aria-label="删除"
                          disabled={isSelf(user)}
                          onClick={() => setDeleteTarget(user)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
        <Pagination
          page={page}
          pageSize={pageSize}
          total={usersQuery.data?.total ?? 0}
          onChange={setPage}
          onPageSizeChange={(next) => {
            setPageSize(next);
            setPage(1);
          }}
          pageSizeOptions={PAGE_SIZES}
        />
      </div>

      <Modal
        open={formOpen}
        onOpenChange={(open) => {
          setFormOpen(open);
          if (!open) setEditing(null);
        }}
        title={editing ? `编辑用户「${editing.displayName}」` : "新增用户"}
        width="max-w-xl"
        footer={
          <>
            <Button variant="outline" onClick={() => setFormOpen(false)}>
              取消
            </Button>
            <Button
              onClick={() => save.mutate()}
              loading={save.isPending}
              disabled={
                !form.displayName.trim() ||
                (!editing && (!form.username.trim() || form.password.length < 12))
              }
            >
              {editing ? "保存" : "创建"}
            </Button>
          </>
        }
      >
        <div className="space-y-5">
          <div className="flex items-center gap-3 rounded-lg bg-slate-50 px-4 py-3">
            <Avatar name={form.displayName || form.username || "?"} src={editing?.avatarUrl} size="md" />
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-slate-800">
                {form.displayName || "新用户"}
              </p>
              <p className="truncate text-xs text-slate-500">
                {editing ? `@${editing.username}` : "本地账号"}
              </p>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="显示名称">
              <Input
                value={form.displayName}
                onChange={(event) => setForm({ ...form, displayName: event.target.value })}
              />
            </Field>
            <Field label="登录用户名" hint={editing ? "用户名不可修改" : "3–32 位字母、数字、下划线、点或短横线"}>
              <Input
                value={form.username}
                disabled={Boolean(editing)}
                onChange={(event) => setForm({ ...form, username: event.target.value })}
              />
            </Field>
          </div>

          <Field label="邮箱（可选）">
            <Input
              type="email"
              value={form.email}
              onChange={(event) => setForm({ ...form, email: event.target.value })}
            />
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="角色">
              <Select
                value={form.role}
                onChange={(event) => setForm({ ...form, role: event.target.value as Role })}
                disabled={Boolean(editing && isSelf(editing))}
              >
                {(["admin", "operator", "viewer"] as Role[]).map((roleOption) => (
                  <option key={roleOption} value={roleOption}>
                    {ROLE_LABELS[roleOption]}
                  </option>
                ))}
              </Select>
            </Field>
            {editing ? (
              <Field label="状态">
                <Select
                  value={form.status}
                  onChange={(event) => setForm({ ...form, status: event.target.value as FormState["status"] })}
                  disabled={isSelf(editing)}
                >
                  <option value="active">启用</option>
                  <option value="disabled">停用</option>
                </Select>
              </Field>
            ) : (
              <Field label="初始密码" hint="至少 12 位">
                <Input
                  type="password"
                  value={form.password}
                  onChange={(event) => setForm({ ...form, password: event.target.value })}
                />
              </Field>
            )}
          </div>

          {editing && isSelf(editing) ? (
            <p className="text-xs text-slate-400">不能修改自己的角色或状态。</p>
          ) : null}
        </div>
      </Modal>

      <Modal
        open={importOpen}
        onOpenChange={(open) => {
          setImportOpen(open);
          if (!open) setSelectedCandidates(new Set());
        }}
        title="从飞书导入用户"
        description="从最新组织架构快照中选择成员，导入后通过飞书登录。"
        width="max-w-2xl"
        footer={
          <>
            <div className="mr-auto flex items-center gap-2 text-xs text-slate-500">
              角色
              <Select
                className="h-8 w-28 text-xs"
                value={importRole}
                onChange={(event) => setImportRole(event.target.value as Role)}
              >
                {(["viewer", "operator", "admin"] as Role[]).map((roleOption) => (
                  <option key={roleOption} value={roleOption}>
                    {ROLE_LABELS[roleOption]}
                  </option>
                ))}
              </Select>
            </div>
            <Button variant="outline" onClick={() => setImportOpen(false)}>
              取消
            </Button>
            <Button
              onClick={() => importUsers.mutate()}
              loading={importUsers.isPending}
              disabled={!selectedCandidates.size}
            >
              导入 {selectedCandidates.size ? `${selectedCandidates.size} 人` : ""}
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
            <Input
              value={importQuery}
              onChange={(event) => setImportQuery(event.target.value)}
              placeholder="搜索姓名、邮箱或工号"
              className="h-9 pl-8"
            />
          </div>

          <div className="max-h-[360px] overflow-y-auto rounded-md border border-slate-200">
            {candidatesQuery.isLoading ? (
              <LoadingBlock />
            ) : !candidates.length ? (
              <p className="px-4 py-10 text-center text-sm text-slate-500">
                没有匹配的飞书成员，请确认已执行过巡查。
              </p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {candidates.map((candidate) => {
                  const selected = selectedCandidates.has(candidate.openId);
                  return (
                    <li key={candidate.openId}>
                      <button
                        type="button"
                        disabled={candidate.imported}
                        onClick={() => toggleCandidate(candidate.openId, candidate.imported)}
                        className={`flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors ${
                          candidate.imported
                            ? "cursor-not-allowed opacity-60"
                            : selected
                              ? "bg-primary-50/60"
                              : "hover:bg-slate-50"
                        }`}
                      >
                        <span
                          className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                            selected
                              ? "border-primary-600 bg-primary-600 text-white"
                              : "border-slate-300 bg-white"
                          }`}
                        >
                          {selected ? <Check className="h-3 w-3" /> : null}
                        </span>
                        <Avatar name={candidate.name} src={candidate.avatarUrl} size="sm" />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium text-slate-800">{candidate.name}</p>
                          <p className="truncate text-xs text-slate-500">
                            {candidate.email || "-"}
                            {candidate.jobTitle ? ` · ${candidate.jobTitle}` : ""}
                          </p>
                        </div>
                        {candidate.imported ? (
                          <Badge tone="gray">已导入</Badge>
                        ) : candidate.linkedUsername ? (
                          <span className="text-[11px] text-slate-400">@{candidate.linkedUsername}</span>
                        ) : null}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          <div className="flex items-center justify-between text-xs text-slate-500">
            <span>已选 {selectedCandidates.size} 人</span>
            <button
              type="button"
              className="text-primary-700 hover:underline"
              onClick={() =>
                setSelectedCandidates((previous) => {
                  if (previous.size === selectable.length) return new Set();
                  return new Set(selectable.map((candidate) => candidate.openId));
                })
              }
            >
              {selectedCandidates.size === selectable.length && selectable.length ? "取消全选" : "全选未导入成员"}
            </button>
          </div>
        </div>
      </Modal>

      <Modal
        open={Boolean(deleteTarget)}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title="删除用户"
        description={deleteTarget ? `确定删除「${deleteTarget.displayName}（${deleteTarget.username}）」？该操作不可恢复。` : ""}
        footer={
          <>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>
              取消
            </Button>
            <Button
              variant="danger"
              onClick={() => deleteTarget && remove.mutate(deleteTarget.id)}
              loading={remove.isPending}
            >
              确认删除
            </Button>
          </>
        }
      >
        <p className="text-sm text-slate-600">删除后该账号的会话会立即失效，历史审计记录保持不动。</p>
      </Modal>

      <Modal
        open={Boolean(resetTarget)}
        onOpenChange={(open) => !open && setResetTarget(null)}
        title="重置密码"
        description={
          resetTarget ? `将为「${resetTarget.displayName}（${resetTarget.username}）」生成临时密码。` : ""
        }
        footer={
          <>
            <Button variant="outline" onClick={() => setResetTarget(null)}>
              取消
            </Button>
            <Button
              onClick={() => resetTarget && resetPassword.mutate(resetTarget.id)}
              loading={resetPassword.isPending}
            >
              生成临时密码
            </Button>
          </>
        }
      >
        <p className="text-sm text-slate-600">临时密码只显示一次，请复制后转交用户并提醒修改。</p>
      </Modal>

      <Modal
        open={Boolean(resetResult)}
        onOpenChange={(open) => !open && setResetResult(null)}
        title="临时密码已生成"
        description={resetResult ? `${resetResult.user.displayName}（${resetResult.user.username}）` : ""}
        footer={
          <>
            <Button
              variant="outline"
              onClick={async () => {
                if (!resetResult) return;
                await navigator.clipboard.writeText(resetResult.password).catch(() => undefined);
                toast.success("密码已复制");
              }}
            >
              <Copy className="h-4 w-4" />
              复制密码
            </Button>
            <Button onClick={() => setResetResult(null)}>
              <Check className="h-4 w-4" />
              完成
            </Button>
          </>
        }
      >
        <div className="rounded-md border bg-slate-50 px-3 py-3 font-mono text-sm">{resetResult?.password}</div>
        <p className="mt-2 text-xs text-slate-500">关闭后无法再次查看。</p>
      </Modal>
    </div>
  );
}
