import { Input, Select } from "./ui";

export type ScheduleMode = "daily" | "weekdays" | "weekly" | "monthly" | "interval" | "custom";

export type ScheduleState = {
  mode: ScheduleMode;
  hour: number;
  minute: number;
  weekdays: number[];
  monthDay: number;
  intervalHours: number;
  customCron: string;
};

const WEEKDAYS = [
  { value: 1, label: "周一" },
  { value: 2, label: "周二" },
  { value: 3, label: "周三" },
  { value: 4, label: "周四" },
  { value: 5, label: "周五" },
  { value: 6, label: "周六" },
  { value: 7, label: "周日" },
];

export const DEFAULT_SCHEDULE: ScheduleState = {
  mode: "daily",
  hour: 9,
  minute: 0,
  weekdays: [1],
  monthDay: 1,
  intervalHours: 6,
  customCron: "0 9 * * *",
};

function timeText(hour: number, minute: number): string {
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

export function buildCron(state: ScheduleState): string {
  switch (state.mode) {
    case "daily":
      return `${state.minute} ${state.hour} * * *`;
    case "weekdays":
      return `${state.minute} ${state.hour} * * 1-5`;
    case "weekly": {
      const days = [...new Set(state.weekdays)].sort((a, b) => a - b);
      return `${state.minute} ${state.hour} * * ${days.length ? days.join(",") : "1"}`;
    }
    case "monthly":
      return `${state.minute} ${state.hour} ${state.monthDay} * *`;
    case "interval":
      return `0 */${Math.min(23, Math.max(1, state.intervalHours))} * * *`;
    case "custom":
      return state.customCron.trim() || "0 9 * * *";
  }
}

export function parseCron(cron: string): ScheduleState {
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) return { ...DEFAULT_SCHEDULE, mode: "custom", customCron: cron };
  const minuteRaw = parts[0]!;
  const hourRaw = parts[1]!;
  const dayRaw = parts[2]!;
  const monthRaw = parts[3]!;
  const weekdayRaw = parts[4]!;
  const minute = Number(minuteRaw);
  const hour = Number(hourRaw);
  if (
    minuteRaw === "0" &&
    /^\*\/\d+$/.test(hourRaw ?? "") &&
    dayRaw === "*" &&
    monthRaw === "*" &&
    weekdayRaw === "*"
  ) {
    const intervalHours = Number(hourRaw.slice(2));
    if (Number.isFinite(intervalHours) && intervalHours > 0) {
      return { ...DEFAULT_SCHEDULE, mode: "interval", intervalHours };
    }
  }
  if (!Number.isInteger(minute) || !Number.isInteger(hour) || minute < 0 || minute > 59 || hour < 0 || hour > 23) {
    return { ...DEFAULT_SCHEDULE, mode: "custom", customCron: cron };
  }
  if (dayRaw !== "*" && monthRaw === "*" && weekdayRaw === "*") {
    const monthDay = Number(dayRaw);
    if (Number.isInteger(monthDay) && monthDay >= 1 && monthDay <= 31) {
      return { ...DEFAULT_SCHEDULE, mode: "monthly", hour, minute, monthDay };
    }
  }
  if (weekdayRaw === "1-5") {
    return { ...DEFAULT_SCHEDULE, mode: "weekdays", hour, minute };
  }
  if (dayRaw === "*" && monthRaw === "*" && weekdayRaw === "*") {
    return { ...DEFAULT_SCHEDULE, mode: "daily", hour, minute };
  }
  if (dayRaw === "*" && monthRaw === "*" && /^[1-7](,[1-7])*$/.test(weekdayRaw ?? "")) {
    const weekdays = weekdayRaw.split(",").map(Number);
    return { ...DEFAULT_SCHEDULE, mode: "weekly", hour, minute, weekdays };
  }
  return { ...DEFAULT_SCHEDULE, mode: "custom", customCron: cron };
}

export function describeCron(cron: string): string {
  const state = parseCron(cron);
  const time = timeText(state.hour, state.minute);
  switch (state.mode) {
    case "daily":
      return `每天 ${time}`;
    case "weekdays":
      return `工作日 ${time}`;
    case "weekly": {
      const days = state.weekdays
        .slice()
        .sort((a, b) => a - b)
        .map((day) => WEEKDAYS.find((item) => item.value === day)?.label ?? `周${day}`)
        .join("、");
      return `每${days} ${time}`;
    }
    case "monthly":
      return `每月 ${state.monthDay} 日 ${time}`;
    case "interval":
      return `每 ${state.intervalHours} 小时`;
    case "custom":
      return `自定义规则（${cron}）`;
  }
}

export function ScheduleBuilder({
  value,
  onChange,
}: {
  value: ScheduleState;
  onChange: (next: ScheduleState) => void;
}) {
  const update = (patch: Partial<ScheduleState>) => onChange({ ...value, ...patch });
  const showTime = value.mode !== "interval" && value.mode !== "custom";
  const hours = Array.from({ length: 24 }, (_, index) => index);
  const minutes = Array.from({ length: 60 }, (_, index) => index);

  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50/50 p-4">
      <p className="text-sm font-medium text-slate-700">执行频率</p>
      <div className="mt-2 grid grid-cols-3 gap-1.5 sm:grid-cols-6">
        {[
          { value: "daily" as const, label: "每天" },
          { value: "weekdays" as const, label: "工作日" },
          { value: "weekly" as const, label: "每周" },
          { value: "monthly" as const, label: "每月" },
          { value: "interval" as const, label: "按间隔" },
          { value: "custom" as const, label: "自定义" },
        ].map((item) => (
          <button
            key={item.value}
            type="button"
            onClick={() =>
              update({
                mode: item.value,
                ...(item.value === "custom" ? { customCron: buildCron(value) } : {}),
              })
            }
            className={`h-8 rounded-md border text-xs transition-colors ${
              value.mode === item.value
                ? "border-primary-300 bg-white font-medium text-primary-700 shadow-sm"
                : "border-slate-200 bg-white/60 text-slate-600 hover:bg-white"
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>

      {value.mode === "weekdays" ? (
        <p className="mt-3 text-[11px] text-slate-500">工作日为周一至周五，遇到法定节假日不会自动跳过。</p>
      ) : null}

      {showTime ? (
        <div className="mt-4 flex flex-wrap items-center gap-2 text-sm text-slate-600">
          <span>执行时间</span>
          <Select
            className="h-9 w-20"
            value={String(value.hour)}
            onChange={(event) => update({ hour: Number(event.target.value) })}
          >
            {hours.map((hour) => (
              <option key={hour} value={hour}>
                {String(hour).padStart(2, "0")}
              </option>
            ))}
          </Select>
          <span className="text-slate-400">:</span>
          <Select
            className="h-9 w-20"
            value={String(value.minute)}
            onChange={(event) => update({ minute: Number(event.target.value) })}
          >
            {minutes.map((minute) => (
              <option key={minute} value={minute}>
                {String(minute).padStart(2, "0")}
              </option>
            ))}
          </Select>
        </div>
      ) : null}

      {value.mode === "weekly" ? (
        <div className="mt-4">
          <p className="text-xs text-slate-500">选择星期</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {WEEKDAYS.map((day) => {
              const active = value.weekdays.includes(day.value);
              return (
                <button
                  key={day.value}
                  type="button"
                  onClick={() => {
                    const next = active
                      ? value.weekdays.filter((item) => item !== day.value)
                      : [...value.weekdays, day.value];
                    update({ weekdays: next.length ? next : [day.value] });
                  }}
                  className={`h-8 rounded-md border px-3 text-xs transition-colors ${
                    active
                      ? "border-primary-300 bg-primary-50 font-medium text-primary-700"
                      : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                  }`}
                >
                  {day.label}
                </button>
              );
            })}
          </div>
        </div>
      ) : null}

      {value.mode === "monthly" ? (
        <div className="mt-4 flex items-center gap-2 text-sm text-slate-600">
          <span>每月</span>
          <Select
            className="h-9 w-20"
            value={String(value.monthDay)}
            onChange={(event) => update({ monthDay: Number(event.target.value) })}
          >
            {Array.from({ length: 31 }, (_, index) => index + 1).map((day) => (
              <option key={day} value={day}>
                {day}
              </option>
            ))}
          </Select>
          <span>日</span>
        </div>
      ) : null}

      {value.mode === "interval" ? (
        <div className="mt-4 flex items-center gap-2 text-sm text-slate-600">
          <span>每</span>
          <Select
            className="h-9 w-20"
            value={String(value.intervalHours)}
            onChange={(event) => update({ intervalHours: Number(event.target.value) })}
          >
            {Array.from({ length: 23 }, (_, index) => index + 1).map((hour) => (
              <option key={hour} value={hour}>
                {hour}
              </option>
            ))}
          </Select>
          <span>小时执行一次</span>
        </div>
      ) : null}

      {value.mode === "custom" ? (
        <div className="mt-4">
          <p className="mb-1.5 text-xs text-slate-500">cron 表达式（分 时 日 月 周）</p>
          <Input
            value={value.customCron}
            onChange={(event) => update({ customCron: event.target.value })}
            className="font-mono text-xs"
            placeholder="0 9 * * 1-5"
          />
        </div>
      ) : null}

      <p className="mt-4 border-t border-slate-200 pt-3 text-xs text-slate-500">
        将按 <span className="font-medium text-slate-700">{describeCron(buildCron(value))}</span> 执行
      </p>
    </div>
  );
}
