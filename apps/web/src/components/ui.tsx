import * as Dialog from "@radix-ui/react-dialog";
import * as SelectPrimitive from "@radix-ui/react-select";
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { Check, ChevronDown, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, Loader2, X } from "lucide-react";
import { Children, isValidElement, useEffect, useState } from "react";
import type {
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
  TextareaHTMLAttributes,
} from "react";

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cn("h-4 w-4 animate-spin", className)} aria-hidden />;
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "outline" | "ghost" | "danger";
  size?: "sm" | "md";
  loading?: boolean;
};

export function Button({
  className,
  variant = "primary",
  size = "md",
  loading,
  disabled,
  children,
  ...props
}: ButtonProps) {
  return (
    <button
      className={cn(
        "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-600/30 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50",
        size === "sm" ? "h-8 px-3 text-xs" : "h-9 px-4",
        variant === "primary" && "bg-primary-700 text-white shadow-sm hover:bg-primary-800",
        variant === "secondary" && "bg-slate-100 text-slate-900 hover:bg-slate-200",
        variant === "outline" &&
          "border border-slate-200 bg-white text-slate-700 shadow-sm hover:bg-slate-50 hover:text-slate-900",
        variant === "ghost" && "text-slate-600 hover:bg-slate-100 hover:text-slate-900",
        variant === "danger" && "bg-rose-600 text-white shadow-sm hover:bg-rose-700",
        className,
      )}
      disabled={disabled || loading}
      {...props}
    >
      {loading ? <Spinner /> : null}
      {children}
    </button>
  );
}

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        "flex h-9 w-full rounded-md border border-slate-200 bg-white px-3 py-1 text-sm shadow-sm transition-colors placeholder:text-slate-400 focus-visible:border-primary-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-600/15 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:opacity-60",
        className,
      )}
      {...props}
    />
  );
}

export function Textarea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={cn(
        "flex min-h-20 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm shadow-sm transition-colors placeholder:text-slate-400 focus-visible:border-primary-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-600/15",
        className,
      )}
      {...props}
    />
  );
}

export function Select({
  className,
  children,
  value,
  onChange,
  disabled,
  placeholder = "请选择",
}: {
  className?: string;
  children?: ReactNode;
  value?: string;
  onChange?: (event: { target: { value: string } }) => void;
  disabled?: boolean;
  placeholder?: string;
}) {
  const options: Array<{ value: string; label: ReactNode; disabled?: boolean }> = [];
  Children.forEach(children, (child) => {
    if (!isValidElement<{ value?: string | number; children?: ReactNode; disabled?: boolean }>(child)) return;
    options.push({
      value: String(child.props.value ?? ""),
      label: child.props.children,
      disabled: child.props.disabled,
    });
  });
  const emptyValue = "__empty__";
  const current = options.find((option) => option.value === String(value ?? ""));
  return (
    <SelectPrimitive.Root
      value={current ? (current.value === "" ? emptyValue : current.value) : emptyValue}
      onValueChange={(next) => onChange?.({ target: { value: next === emptyValue ? "" : next } })}
      disabled={disabled}
    >
      <SelectPrimitive.Trigger
        className={cn(
          "flex h-9 w-full items-center justify-between gap-2 rounded-md border border-slate-200 bg-white px-3 py-1 text-left text-sm shadow-sm transition-colors hover:border-slate-300 focus-visible:border-primary-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-600/15 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400",
          className,
        )}
      >
        <span className={cn("truncate", !current && "text-slate-400")}>{current?.label ?? placeholder}</span>
        <SelectPrimitive.Icon asChild>
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-slate-400" />
        </SelectPrimitive.Icon>
      </SelectPrimitive.Trigger>
      <SelectPrimitive.Portal>
        <SelectPrimitive.Content
          position="popper"
          sideOffset={4}
          className="z-[90] max-h-72 min-w-[var(--radix-select-trigger-width)] overflow-hidden rounded-md border border-slate-200 bg-white p-1 shadow-lg"
        >
          <SelectPrimitive.Viewport>
            {options.map((option) => (
              <SelectPrimitive.Item
                key={option.value || emptyValue}
                value={option.value === "" ? emptyValue : option.value}
                disabled={option.disabled}
                className="relative flex cursor-pointer select-none items-center rounded px-2 py-1.5 pr-8 text-sm text-slate-700 outline-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50 data-[highlighted]:bg-slate-100"
              >
                <SelectPrimitive.ItemText>{option.label}</SelectPrimitive.ItemText>
                <SelectPrimitive.ItemIndicator className="absolute right-2">
                  <Check className="h-3.5 w-3.5 text-primary-600" />
                </SelectPrimitive.ItemIndicator>
              </SelectPrimitive.Item>
            ))}
            {options.length === 0 ? (
              <p className="px-2 py-1.5 text-xs text-slate-400">暂无选项</p>
            ) : null}
          </SelectPrimitive.Viewport>
        </SelectPrimitive.Content>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
  );
}

export function Field({
  label,
  hint,
  error,
  children,
  className,
}: {
  label?: string;
  hint?: string;
  error?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={cn("block space-y-1.5", className)}>
      {label ? <span className="block text-sm font-medium text-slate-700">{label}</span> : null}
      {children}
      {error ? <span className="block text-xs text-rose-600">{error}</span> : null}
      {!error && hint ? <span className="block text-xs leading-5 text-slate-500">{hint}</span> : null}
    </label>
  );
}

export function Switch({
  checked,
  onChange,
  disabled,
  label,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  label?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-600/30 focus-visible:ring-offset-2 disabled:opacity-50",
        checked ? "bg-primary-700" : "bg-slate-300",
      )}
    >
      <span
        className={cn(
          "inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform",
          checked ? "translate-x-4" : "translate-x-0.5",
        )}
      />
    </button>
  );
}

type Tone = "gray" | "blue" | "green" | "red" | "orange" | "yellow" | "purple";

const TONE_CLASSES: Record<Tone, string> = {
  gray: "border-transparent bg-slate-100 text-slate-600",
  blue: "border-transparent bg-primary-50 text-primary-800",
  green: "border-transparent bg-emerald-50 text-emerald-700",
  red: "border-transparent bg-rose-50 text-rose-700",
  orange: "border-transparent bg-orange-50 text-orange-700",
  yellow: "border-transparent bg-amber-50 text-amber-700",
  purple: "border-transparent bg-violet-50 text-violet-700",
};

const DOT_CLASSES: Record<Tone, string> = {
  gray: "bg-slate-400",
  blue: "bg-primary-600",
  green: "bg-emerald-500",
  red: "bg-rose-500",
  orange: "bg-orange-500",
  yellow: "bg-amber-500",
  purple: "bg-violet-500",
};

export function Badge({
  children,
  tone = "gray",
  className,
  dot,
}: {
  children: ReactNode;
  tone?: Tone;
  className?: string;
  dot?: boolean;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs font-medium",
        TONE_CLASSES[tone],
        className,
      )}
    >
      {dot ? <span className={cn("h-1.5 w-1.5 rounded-full", DOT_CLASSES[tone])} /> : null}
      {children}
    </span>
  );
}

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn("rounded-lg border border-slate-200 bg-white text-slate-900 shadow-sm", className)}>
      {children}
    </div>
  );
}

export function CardHeader({
  title,
  description,
  actions,
  className,
  icon,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  className?: string;
  icon?: ReactNode;
}) {
  return (
    <div className={cn("flex flex-wrap items-start justify-between gap-3 px-4 py-3.5 sm:px-5", className)}>
      <div className="flex min-w-0 items-start gap-2.5">
        {icon ? (
          <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-slate-100 text-slate-500">
            {icon}
          </span>
        ) : null}
        <div className="min-w-0">
          <h3 className="text-sm font-semibold tracking-tight text-slate-900">{title}</h3>
          {description ? <p className="mt-0.5 text-xs leading-5 text-slate-500">{description}</p> : null}
        </div>
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function Modal({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  width = "max-w-lg",
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  width?: string;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-slate-950/40 backdrop-blur-[2px]" />
        <Dialog.Content
          className={cn(
            "fixed left-1/2 top-1/2 z-50 flex max-h-[90vh] w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl focus:outline-none",
            width,
          )}
        >
          <div className="flex shrink-0 items-start justify-between gap-4 border-b border-slate-100 px-6 py-4">
            <div className="min-w-0">
              <Dialog.Title className="text-base font-semibold leading-6 tracking-tight text-slate-900">
                {title}
              </Dialog.Title>
              {description ? (
                <Dialog.Description className="mt-0.5 text-xs leading-5 text-slate-500">
                  {description}
                </Dialog.Description>
              ) : null}
            </div>
            <Dialog.Close asChild>
              <button
                type="button"
                aria-label="关闭"
                className="-mr-1 rounded-md p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-600/30"
              >
                <X className="h-4 w-4" />
              </button>
            </Dialog.Close>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">{children}</div>
          {footer ? (
            <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-slate-100 bg-slate-50/60 px-6 py-3.5">
              {footer}
            </div>
          ) : null}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export function Tabs({
  items,
  value,
  onChange,
}: {
  items: Array<{ value: string; label: string; count?: number }>;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="inline-flex max-w-full items-center gap-0.5 overflow-x-auto rounded-lg bg-slate-100 p-1 text-slate-500">
      {items.map((item) => (
        <button
          key={item.value}
          type="button"
          onClick={() => onChange(item.value)}
          className={cn(
            "inline-flex shrink-0 items-center gap-1.5 rounded-md px-3 py-1 text-sm font-medium transition-all",
            value === item.value
              ? "bg-white text-slate-900 shadow-sm"
              : "text-slate-500 hover:text-slate-800",
          )}
        >
          {item.label}
          {typeof item.count === "number" ? (
            <span
              className={cn(
                "rounded px-1.5 py-0.5 text-[10px] tabular-nums",
                value === item.value ? "bg-slate-100 text-slate-600" : "bg-slate-200/70 text-slate-500",
              )}
            >
              {item.count}
            </span>
          ) : null}
        </button>
      ))}
    </div>
  );
}

export function EmptyState({
  title,
  description,
  action,
  icon,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-14 text-center">
      <div className="mb-1 flex h-10 w-10 items-center justify-center rounded-lg bg-slate-100 text-slate-400">
        {icon}
      </div>
      <p className="text-sm font-medium text-slate-800">{title}</p>
      {description ? <p className="max-w-md text-xs leading-5 text-slate-500">{description}</p> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="flex flex-col items-center gap-2 px-6 py-10 text-center">
      <p className="text-sm text-rose-600">{message}</p>
      {onRetry ? (
        <Button variant="outline" size="sm" onClick={onRetry}>
          重试
        </Button>
      ) : null}
    </div>
  );
}

export function LoadingBlock({ label = "加载中…" }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 px-6 py-12 text-sm text-slate-500">
      <Spinner />
      {label}
    </div>
  );
}

function paginationItems(page: number, totalPages: number): Array<number | "start" | "end"> {
  if (totalPages <= 7) return Array.from({ length: totalPages }, (_, index) => index + 1);
  if (page <= 4) return [1, 2, 3, 4, 5, "end", totalPages];
  if (page >= totalPages - 3) {
    return [1, "start", totalPages - 4, totalPages - 3, totalPages - 2, totalPages - 1, totalPages];
  }
  return [1, "start", page - 1, page, page + 1, "end", totalPages];
}

export function Pagination({
  page,
  pageSize,
  total,
  onChange,
  onPageSizeChange,
  pageSizeOptions,
  pageSizeControl,
}: {
  page: number;
  pageSize: number;
  total: number;
  onChange: (page: number) => void;
  onPageSizeChange?: (pageSize: number) => void;
  pageSizeOptions?: number[];
  pageSizeControl?: ReactNode;
}) {
  const pages = Math.max(1, Math.ceil(total / Math.max(1, pageSize)));
  const start = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const end = Math.min(page * pageSize, total);
  const iconButton = "h-8 w-8 p-0";

  return (
    <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-slate-100 px-4 py-3 text-xs text-slate-500">
      <div className="flex items-center gap-3">
        <span className="whitespace-nowrap">
          显示 {start}-{end}，共 {total} 条
        </span>
        {pageSizeControl ??
          (onPageSizeChange && pageSizeOptions?.length ? (
            <label className="hidden items-center gap-1.5 sm:flex">
              每页
              <select
                value={pageSize}
                onChange={(event) => onPageSizeChange(Number(event.target.value))}
                className="h-8 rounded-md border border-slate-200 bg-white px-2 text-xs shadow-sm focus-visible:border-primary-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-600/15"
                aria-label="每页条数"
              >
                {pageSizeOptions.map((option) => (
                  <option key={option} value={option}>
                    {option} 条
                  </option>
                ))}
              </select>
            </label>
          ) : null)}
      </div>

      <div className="flex items-center gap-1">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className={iconButton}
          disabled={page <= 1}
          onClick={() => onChange(1)}
          aria-label="第一页"
        >
          <ChevronsLeft className="h-3.5 w-3.5" />
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className={iconButton}
          disabled={page <= 1}
          onClick={() => onChange(page - 1)}
          aria-label="上一页"
        >
          <ChevronLeft className="h-3.5 w-3.5" />
        </Button>

        <div className="hidden items-center gap-1 sm:flex">
          {paginationItems(page, pages).map((item) =>
            typeof item === "number" ? (
              <Button
                key={item}
                type="button"
                variant={item === page ? "secondary" : "ghost"}
                size="sm"
                className={cn("h-8 w-8 p-0 text-xs", item === page && "pointer-events-none font-semibold")}
                onClick={() => onChange(item)}
                aria-label={`第 ${item} 页`}
                aria-current={item === page ? "page" : undefined}
              >
                {item}
              </Button>
            ) : (
              <span key={item} className="w-5 text-center text-slate-400" aria-hidden>
                …
              </span>
            ),
          )}
        </div>

        <Button
          type="button"
          variant="outline"
          size="sm"
          className={iconButton}
          disabled={page >= pages}
          onClick={() => onChange(page + 1)}
          aria-label="下一页"
        >
          <ChevronRight className="h-3.5 w-3.5" />
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className={iconButton}
          disabled={page >= pages}
          onClick={() => onChange(pages)}
          aria-label="最后一页"
        >
          <ChevronsRight className="h-3.5 w-3.5" />
        </Button>
        <span className="hidden whitespace-nowrap pl-1 text-xs text-slate-500 sm:inline">
          第 {page} / {pages} 页
        </span>
      </div>
    </div>
  );
}

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
  eyebrow?: string;
}) {
  return (
    <header className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-200 pb-4">
      <div className="min-w-0">
        <h1 className="truncate text-xl font-semibold leading-7 tracking-tight text-slate-900">{title}</h1>
        {description ? <p className="mt-1 text-sm leading-5 text-slate-500">{description}</p> : null}
      </div>
      {actions ? (
        <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:shrink-0">{actions}</div>
      ) : null}
    </header>
  );
}

export function StatCard({
  label,
  value,
  hint,
  icon,
  onClick,
}: {
  label: string;
  value: ReactNode;
  hint?: string;
  icon?: ReactNode;
  tone?: Tone;
  onClick?: () => void;
}) {
  return (
    <div
      className={cn(
        "group flex items-center gap-2.5 rounded-lg border border-slate-200 bg-white px-3 py-3 shadow-sm transition sm:gap-3.5 sm:px-4 sm:py-4",
        onClick && "cursor-pointer hover:-translate-y-0.5 hover:shadow-md",
      )}
      onClick={onClick}
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
    >
      {icon ? (
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-slate-100 text-slate-500 transition group-hover:bg-primary-50 group-hover:text-primary-700 sm:h-10 sm:w-10">
          {icon}
        </div>
      ) : null}
      <div className="min-w-0 flex-1">
        <div className="text-xs text-slate-500">{label}</div>
        <div className="mt-0.5 flex items-baseline gap-1.5">
          <span className="text-xl font-semibold tabular-nums tracking-tight text-slate-900 sm:text-2xl">
            {value}
          </span>
          {hint ? <span className="truncate text-xs text-slate-500">{hint}</span> : null}
        </div>
      </div>
    </div>
  );
}

const AVATAR_PALETTES = [
  "bg-slate-100 text-slate-600",
  "bg-primary-50 text-primary-800",
  "bg-amber-50 text-amber-700",
  "bg-violet-50 text-violet-700",
  "bg-rose-50 text-rose-700",
  "bg-sky-50 text-sky-700",
];

export function Avatar({
  name,
  src,
  size = "md",
  className,
}: {
  name: string;
  src?: string | null;
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src]);
  const index = [...name].reduce((sum, char) => sum + char.codePointAt(0)!, 0) % AVATAR_PALETTES.length;
  const dimensions = cn(
    "shrink-0 rounded-full",
    size === "sm" && "h-7 w-7 text-[11px]",
    size === "md" && "h-9 w-9 text-xs",
    size === "lg" && "h-12 w-12 text-base",
  );

  if (src && !failed) {
    return (
      <img
        src={src}
        alt={name}
        loading="lazy"
        referrerPolicy="no-referrer"
        onError={() => setFailed(true)}
        className={cn(dimensions, "bg-slate-100 object-cover", className)}
      />
    );
  }

  return (
    <span
      className={cn(
        dimensions,
        "inline-flex items-center justify-center font-medium",
        AVATAR_PALETTES[index],
        className,
      )}
    >
      {name.trim().slice(0, 1) || "?"}
    </span>
  );
}
