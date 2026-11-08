import { useState, type FormEvent } from "react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { errorMessage, patch } from "../api";
import { useSession, ROLE_LABELS } from "../lib/session";
import { Avatar, Button, Card, Field, Input, PageHeader } from "../components/ui";

export default function Account() {
  const { user, refresh } = useSession();
  const [currentPassword, setCurrentPassword] = useState("");
  const [nextPassword, setNextPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  const changePassword = useMutation({
    mutationFn: () => patch("/auth/password", { currentPassword, nextPassword }),
    onSuccess: async () => {
      setCurrentPassword("");
      setNextPassword("");
      setConfirmPassword("");
      setError(null);
      toast.success("密码已修改，其他设备上的登录已失效");
      await refresh();
    },
    onError: (caught) => setError(errorMessage(caught)),
  });

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    if (!user?.hasPassword) return;
    if (!currentPassword) {
      setError("请输入当前密码");
      return;
    }
    if (nextPassword.length < 12) {
      setError("新密码至少需要 12 个字符");
      return;
    }
    if (nextPassword !== confirmPassword) {
      setError("两次输入的新密码不一致");
      return;
    }
    if (nextPassword === currentPassword) {
      setError("新密码不能与当前密码相同");
      return;
    }
    changePassword.mutate();
  }

  if (!user) return null;

  return (
    <div className="max-w-2xl space-y-4">
      <PageHeader title="个人设置" description="修改登录密码" />

      <Card>
        {!user.hasPassword ? (
          <div className="px-5 py-8 text-center">
            <p className="text-sm font-medium text-slate-800">该账号使用飞书扫码登录</p>
            <p className="mt-1 text-xs leading-5 text-slate-500">没有本地密码，无需修改。</p>
          </div>
        ) : (
          <form onSubmit={submit}>
            <div className="flex items-center gap-3 border-b border-slate-100 px-5 py-4">
              <Avatar name={user.displayName} src={user.avatarUrl} size="md" />
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-slate-900">{user.displayName}</p>
                <p className="mt-0.5 truncate text-xs text-slate-500">
                  @{user.username} · {ROLE_LABELS[user.role]}
                </p>
              </div>
            </div>

            <div className="space-y-4 px-5 py-5">
              <Field label="当前密码">
                <Input
                  type="password"
                  autoComplete="current-password"
                  value={currentPassword}
                  onChange={(event) => setCurrentPassword(event.target.value)}
                />
              </Field>

              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="新密码" hint="至少 12 个字符">
                  <Input
                    type="password"
                    autoComplete="new-password"
                    value={nextPassword}
                    onChange={(event) => setNextPassword(event.target.value)}
                  />
                </Field>
                <Field label="确认新密码">
                  <Input
                    type="password"
                    autoComplete="new-password"
                    value={confirmPassword}
                    onChange={(event) => setConfirmPassword(event.target.value)}
                  />
                </Field>
              </div>

              {error ? (
                <p className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
                  {error}
                </p>
              ) : null}

              <div className="flex items-center justify-between gap-4 pt-1">
                <p className="text-xs leading-5 text-slate-400">修改后其他设备上的登录会失效。</p>
                <Button type="submit" loading={changePassword.isPending}>
                  保存
                </Button>
              </div>
            </div>
          </form>
        )}
      </Card>
    </div>
  );
}
