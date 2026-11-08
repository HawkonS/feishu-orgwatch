import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useNavigate, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { AlertCircle, Eye, EyeOff } from "lucide-react";
import { post, errorMessage } from "../api";
import { useBootstrapStatus, useSession, type User } from "../lib/session";
import { Button, Input } from "../components/ui";
import { AuthShell } from "../components/AuthShell";

const schema = z.object({
  username: z.string().min(1, "请输入账号"),
  password: z.string().min(1, "请输入密码"),
});

type FormValues = z.infer<typeof schema>;

export default function Login() {
  const { setUser } = useSession();
  const { data: bootstrap } = useBootstrapStatus();
  const navigate = useNavigate();
  const [search] = useSearchParams();
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(
    search.get("feishu_error") ? "飞书登录失败，请重试或使用本地账号" : null,
  );
  const redirectParam = search.get("redirect") ?? "/";
  const redirect = redirectParam.startsWith("/") && !redirectParam.startsWith("//") ? redirectParam : "/";

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { username: "", password: "" },
  });

  const onSubmit = async (values: FormValues) => {
    setError(null);
    try {
      const data = await post<{ user: User }>("/auth/login", values);
      setUser(data.user);
      toast.success(`欢迎回来，${data.user.displayName}`);
      navigate(redirect, { replace: true });
    } catch (caught) {
      setError(errorMessage(caught));
    }
  };

  return (
    <AuthShell>
      <div className="mb-8">
        <h2 className="text-xl font-semibold tracking-tight text-slate-900">欢迎回来</h2>
        <p className="mt-1.5 text-sm text-slate-500">请登录您的账号以继续</p>
      </div>

      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5" noValidate>
        <div className="space-y-1.5">
          <label htmlFor="username" className="text-sm font-medium text-slate-700">
            账号
          </label>
          <Input
            id="username"
            autoComplete="username"
            placeholder="请输入账号"
            className="h-11 rounded-lg border-slate-200 transition-shadow focus-visible:ring-2"
            {...form.register("username")}
          />
          {form.formState.errors.username ? (
            <p className="text-xs text-rose-600">{form.formState.errors.username.message}</p>
          ) : null}
        </div>

        <div className="space-y-1.5">
          <label htmlFor="password" className="text-sm font-medium text-slate-700">
            密码
          </label>
          <div className="relative">
            <Input
              id="password"
              type={showPassword ? "text" : "password"}
              autoComplete="current-password"
              placeholder="请输入密码"
              className="h-11 rounded-lg border-slate-200 pr-10 transition-shadow focus-visible:ring-2"
              {...form.register("password")}
            />
            <button
              type="button"
              tabIndex={-1}
              aria-label={showPassword ? "隐藏密码" : "显示密码"}
              onClick={() => setShowPassword((value) => !value)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
            >
              {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
          {form.formState.errors.password ? (
            <p className="text-xs text-rose-600">{form.formState.errors.password.message}</p>
          ) : null}
        </div>

        {error ? (
          <div className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
            <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            {error}
          </div>
        ) : null}

        <Button
          type="submit"
          className="h-11 w-full rounded-lg text-sm font-medium shadow-sm"
          loading={form.formState.isSubmitting}
        >
          登录
        </Button>
      </form>

      {bootstrap?.feishuLoginEnabled ? (
        <>
          <div className="relative my-6">
            <div className="absolute inset-0 flex items-center">
              <span className="w-full border-t border-slate-200" />
            </div>
            <div className="relative flex justify-center text-xs">
              <span className="bg-white px-3 text-slate-400">或</span>
            </div>
          </div>
          <a
            href={`/api/auth/feishu/start?redirect=${encodeURIComponent(redirect)}`}
            className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white text-sm font-medium text-slate-700 shadow-sm transition-colors hover:bg-slate-50"
          >
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" aria-hidden>
              <path d="M4.93 4.93l5.66 5.66-2.83 2.83-5.66-5.66a4 4 0 012.83-2.83z" fill="#3370FF" />
              <path d="M19.07 4.93l-5.66 5.66 2.83 2.83 5.66-5.66a4 4 0 00-2.83-2.83z" fill="#3370FF" />
              <path d="M4.93 19.07l5.66-5.66 2.83 2.83-5.66 5.66a4 4 0 01-2.83-2.83z" fill="#3370FF" />
              <path d="M19.07 19.07l-5.66-5.66-2.83 2.83 5.66 5.66a4 4 0 002.83-2.83z" fill="#3370FF" />
            </svg>
            飞书登录
          </a>
        </>
      ) : null}

      <p className="mt-6 text-center text-xs text-slate-400">账号与凭据只保存在本机 SQLite 中</p>
    </AuthShell>
  );
}
