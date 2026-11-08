import type { ReactNode } from "react";
import { useBootstrapStatus } from "../lib/session";

export function AuthShell({ children }: { children: ReactNode }) {
  const { data: bootstrap } = useBootstrapStatus();
  const siteName = bootstrap?.siteName ?? "飞书组织架构巡查器";

  return (
    <div className="flex min-h-screen">
      <aside className="relative hidden overflow-hidden bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 lg:flex lg:w-[38%] lg:flex-col lg:items-center lg:justify-center">
        <div className="pointer-events-none absolute -left-20 -top-20 h-72 w-72 rounded-full bg-white/[0.04]" />
        <div className="pointer-events-none absolute -bottom-32 -right-16 h-96 w-96 rounded-full bg-white/[0.03]" />
        <div className="pointer-events-none absolute left-1/2 top-1/3 h-48 w-48 -translate-x-1/2 rounded-full bg-white/[0.02]" />

        <div className="relative z-10 flex flex-col items-center px-12 text-center">
          <div className="mb-6 flex h-16 w-16 items-center justify-center rounded-lg bg-white/10 ring-1 ring-white/20 backdrop-blur-sm">
            <img src="/logo.svg" alt="飞书组织架构巡查器" className="h-9 w-9" />
          </div>
          <h1 className="mb-3 text-2xl font-bold tracking-tight text-white">{siteName}</h1>
          <p className="max-w-xs text-sm leading-relaxed text-slate-400">
            把组织变化变成可追踪的知情闭环
          </p>
        </div>

        <p className="absolute bottom-6 text-xs text-slate-600">
          {bootstrap?.copyright ?? `© ${new Date().getFullYear()} ${siteName}`}
        </p>
      </aside>

      <div className="relative flex flex-1 flex-col items-center justify-center bg-white px-6 py-12">
        <div className="mb-10 flex flex-col items-center gap-3 lg:hidden">
          <div className="flex h-12 w-12 items-center justify-center rounded-md bg-primary-50 shadow-sm">
            <img src="/logo.svg" alt="logo" className="h-7 w-7" />
          </div>
          <span className="text-lg font-semibold tracking-tight text-slate-900">{siteName}</span>
        </div>

        <div className="w-full max-w-[360px]">{children}</div>

        <div className="absolute bottom-4 right-6 text-right text-xs text-slate-400">v0.1.0</div>
      </div>
    </div>
  );
}
