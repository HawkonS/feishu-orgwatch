import { useEffect, useRef, useState } from "react";
import { useForm, type FieldErrors } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useNavigate, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { Eye, EyeOff } from "lucide-react";
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
  const feishuErrorShown = useRef(false);
  const feishuError = search.get("feishu_error");
  const redirectParam = search.get("redirect") ?? "/";
  const redirect = redirectParam.startsWith("/") && !redirectParam.startsWith("//") ? redirectParam : "/";

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { username: "", password: "" },
  });

  useEffect(() => {
    if (!feishuError || feishuErrorShown.current) return;
    feishuErrorShown.current = true;
    toast.error("飞书登录失败，请重试或使用本地账号");
  }, [feishuError]);

  const onInvalid = (errors: FieldErrors<FormValues>) => {
    const message = errors.username?.message ?? errors.password?.message;
    if (message) toast.error(String(message));
  };

  const onSubmit = async (values: FormValues) => {
    try {
      const data = await post<{ user: User }>("/auth/login", values);
      setUser(data.user);
      toast.success(`欢迎回来，${data.user.displayName}`);
      navigate(redirect, { replace: true });
    } catch (caught) {
      toast.error(errorMessage(caught));
    }
  };

  return (
    <AuthShell>
      <div className="mb-8">
        <h2 className="text-xl font-semibold tracking-tight text-slate-900">欢迎回来</h2>
        <p className="mt-1.5 text-sm text-slate-500">请登录您的账号以继续</p>
      </div>

      <form onSubmit={form.handleSubmit(onSubmit, onInvalid)} className="space-y-5" noValidate>
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
        </div>

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

    </AuthShell>
  );
}
