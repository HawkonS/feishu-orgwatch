import { useState, type ReactNode } from "react";
import { NavLink, Outlet } from "react-router-dom";
import {
  BellRing,
  BookOpen,
  GitCompareArrows,
  LayoutDashboard,
  ListChecks,
  LogOut,
  Menu,
  Network,
  RefreshCw,
  ScrollText,
  ChevronDown,
  Settings as SettingsIcon,
  UserCog,
  X,
} from "lucide-react";
import { useBootstrapStatus, useMeta, useSession, ROLE_LABELS, type Role } from "../lib/session";
import { formatDateTime } from "../lib/format";
import { Avatar, cn } from "./ui";

const NAV_SECTIONS: Array<{
  title: string;
  items: Array<{
    to: string;
    label: string;
    icon: typeof LayoutDashboard;
    end?: boolean;
    roles?: Role[];
  }>;
}> = [
  {
    title: "工作台",
    items: [{ to: "/", label: "概览", icon: LayoutDashboard, end: true }],
  },
  {
    title: "组织",
    items: [{ to: "/directory", label: "架构", icon: Network }],
  },
  {
    title: "变更",
    items: [
      { to: "/diffs", label: "差异", icon: GitCompareArrows },
      { to: "/notifications", label: "通知", icon: BellRing, roles: ["admin", "operator"] },
      { to: "/tasks", label: "任务", icon: ListChecks, roles: ["admin", "operator"] },
    ],
  },
  {
    title: "系统",
    items: [
      { to: "/settings", label: "设置", icon: SettingsIcon, roles: ["admin", "operator"] },
      { to: "/admin/users", label: "账号", icon: UserCog, roles: ["admin"] },
      { to: "/audit", label: "审计", icon: ScrollText, roles: ["admin"] },
      { to: "/admin/system", label: "更新", icon: RefreshCw, roles: ["admin"] },
      { to: "/guide", label: "说明", icon: BookOpen },
    ],
  },
];

function NavItem({
  item,
  onNavigate,
}: {
  item: { to: string; label: string; icon: typeof LayoutDashboard; end?: boolean };
  onNavigate?: () => void;
}) {
  const Icon = item.icon;
  return (
    <NavLink
      to={item.to}
      end={item.end}
      onClick={onNavigate}
      className={({ isActive }) =>
        cn(
          "relative flex items-center gap-3 rounded-md px-3 py-2.5 text-sm text-slate-700 transition-colors hover:bg-slate-100 hover:text-slate-900",
          isActive &&
            "bg-slate-100 font-medium text-primary-800 before:absolute before:inset-y-1.5 before:left-0 before:w-0.5 before:rounded-full before:bg-primary-700 hover:bg-slate-100",
        )
      }
    >
      <Icon className="h-4 w-4 shrink-0" />
      <span>{item.label}</span>
    </NavLink>
  );
}

function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  const { user } = useSession();
  const { data: bootstrap } = useBootstrapStatus();
  const { data: meta } = useMeta();

  return (
    <div className="flex h-full flex-col select-none">
      <div className="flex-1 overflow-y-auto py-3">
        {NAV_SECTIONS.map((section) => ({
          ...section,
          items: section.items.filter((item) => !item.roles || (user && item.roles.includes(user.role))),
        }))
          .filter((section) => section.items.length)
          .map((section) => (
          <div key={section.title} className="mt-3 first:mt-0">
            <div className="px-3">
              <div className="px-2 py-1.5 text-[11px] font-semibold font-medium text-slate-400">
                {section.title}
              </div>
            </div>
            <div className="mt-0.5 flex flex-col gap-0.5 px-3">
              {section.items.map((item) => (
                <NavItem key={item.to} item={item} onNavigate={onNavigate} />
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="shrink-0 px-4 py-3 text-center text-[11px] leading-relaxed text-slate-400">
        <div className="font-mono">{meta?.build ? `构建 ${meta.build}` : "构建 -"}</div>
        <div className="mt-0.5">{meta?.updatedAt ? `更新于 ${formatDateTime(meta.updatedAt)}` : "更新于 -"}</div>
      </div>
    </div>
  );
}

export function Layout({ children }: { children?: ReactNode }) {
  const { user, logout } = useSession();
  const { data: bootstrap } = useBootstrapStatus();
  const [open, setOpen] = useState(false);

  return (
    <div className="flex h-screen flex-col bg-white">
      <header className="flex h-14 shrink-0 items-center border-b border-slate-200 bg-white px-4 shadow-sm md:px-6">
        <div className="md:hidden">
          <button
            type="button"
            className="inline-flex h-9 w-9 items-center justify-center rounded-md text-slate-600 hover:bg-slate-100"
            aria-label="打开菜单"
            onClick={() => setOpen(true)}
          >
            <Menu className="h-5 w-5" />
          </button>
        </div>

        <div className="flex min-w-0 items-center gap-2 md:mr-auto">
          <img src="/logo.svg" alt="" className="hidden h-7 w-7 rounded-md md:block" />
          <span className="min-w-0 max-w-[45vw] truncate text-[15px] font-semibold">
            {bootstrap?.siteName ?? "飞书组织架构巡查器"}
          </span>
        </div>

        <div className="ml-auto flex items-center gap-3 text-sm md:gap-5">
          {user ? (
            <NavLink
              to="/account"
              title="个人设置"
              aria-label="个人设置"
              className="group inline-flex min-w-0 items-center gap-2 rounded-full py-1 pl-1 pr-1.5 text-slate-700 transition-colors hover:bg-slate-50"
            >
              <Avatar name={user.displayName} src={user.avatarUrl} size="sm" />
              <span className="hidden max-w-28 truncate text-sm sm:inline">{user.displayName}</span>
              <span className="hidden text-xs text-slate-400 md:inline">{ROLE_LABELS[user.role]}</span>
              <ChevronDown className="h-3 w-3 text-slate-300 transition-colors group-hover:text-slate-400" />
            </NavLink>
          ) : null}
          <button
            type="button"
            onClick={() => void logout()}
            className="inline-flex items-center gap-1 text-slate-500 transition-colors hover:text-slate-900"
          >
            <LogOut className="h-4 w-4 md:hidden" />
            <span className="hidden md:inline">退出</span>
          </button>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        <aside className="hidden w-56 shrink-0 flex-col overflow-y-auto border-r border-slate-200 bg-white md:flex">
          <SidebarContent />
        </aside>

        <main className="min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto px-3 py-3 sm:px-4 sm:py-4 md:px-6 md:py-5">
          <div className="ow-rise">{children ?? <Outlet />}</div>
        </main>
      </div>

      {open ? (
        <div className="fixed inset-0 z-40 md:hidden">
          <div className="absolute inset-0 bg-black/50" onClick={() => setOpen(false)} />
          <div className="absolute inset-y-0 left-0 w-[260px] border-r border-slate-200 bg-white shadow-lg">
            <div className="flex h-14 items-center justify-between border-b border-slate-200 px-4">
              <div className="flex items-center gap-2">
                <img src="/logo.svg" alt="" className="h-6 w-6 rounded" />
                <span className="text-sm font-semibold">{bootstrap?.siteName ?? "飞书组织架构巡查器"}</span>
              </div>
              <button
                type="button"
                aria-label="关闭菜单"
                onClick={() => setOpen(false)}
                className="rounded-md p-1 text-slate-500 hover:bg-slate-100"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <SidebarContent onNavigate={() => setOpen(false)} />
          </div>
        </div>
      ) : null}
    </div>
  );
}
