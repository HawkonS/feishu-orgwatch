/** Text helpers shared by the diff engine, card builder and exports. */

export function normalizeName(value: string | null | undefined): string {
  return (value ?? "").normalize("NFKC").replace(/\s+/g, " ").trim();
}

export function normalizeEmail(value: string | null | undefined): string | null {
  const trimmed = (value ?? "").trim().toLowerCase();
  return trimmed.length ? trimmed : null;
}

export function normalizeOptional(value: string | null | undefined): string | null {
  const trimmed = (value ?? "").normalize("NFKC").trim();
  return trimmed.length ? trimmed : null;
}

export function escapeCardText(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\r\n?/g, "\n");
}

export function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, Math.max(0, max - 1))}…`;
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function formatDateTime(iso: string | null | undefined, timeZone = "Asia/Shanghai"): string {
  if (!iso) return "-";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

export function csvCell(value: unknown): string {
  const text = value === null || value === undefined ? "" : String(value);
  const guarded = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return `"${guarded.replace(/"/g, '""')}"`;
}

export function jsonArray(value: unknown): unknown[] {
  if (!Array.isArray(value)) return [];
  return value;
}
