import { cn } from "./ui";

export type TrendPoint = {
  day: string;
  diffCount: number;
  peopleAdded: number;
  peopleRemoved: number;
  peopleChanged: number;
};

const COLORS = {
  added: "#3370FF",
  removed: "#f43f5e",
  changed: "#fb923c",
};

export function TrendChart({ data, className }: { data: TrendPoint[]; className?: string }) {
  const width = 760;
  const height = 200;
  const paddingX = 28;
  const paddingTop = 18;
  const paddingBottom = 30;
  const values = data.map(
    (point) => point.peopleAdded + point.peopleRemoved + point.peopleChanged,
  );
  const max = Math.max(1, ...values);
  const slot = data.length ? (width - paddingX * 2) / data.length : 0;
  const barWidth = Math.max(6, Math.min(24, slot * 0.56));
  const plotHeight = height - paddingTop - paddingBottom;
  const barX = (index: number) => paddingX + slot * index + (slot - barWidth) / 2;
  const segmentHeight = (value: number) => (value / max) * plotHeight;
  const hasData = values.some((value) => value > 0);
  const labelIndexes = [0, Math.floor((data.length - 1) / 2), data.length - 1];

  return (
    <div className={cn("w-full", className)}>
      <svg viewBox={`0 0 ${width} ${height}`} className="h-auto w-full" role="img" aria-label="近 14 天变更趋势">
        {[0, 0.5, 1].map((ratio) => {
          const lineY = paddingTop + plotHeight * ratio;
          return (
            <line
              key={ratio}
              x1={paddingX}
              x2={width - paddingX}
              y1={lineY}
              y2={lineY}
              stroke="#e2e8f0"
              strokeDasharray="4 6"
              strokeWidth="1"
            />
          );
        })}

        {hasData ? (
          data.map((point, index) => {
            let bottom = height - paddingBottom;
            const total = point.peopleAdded + point.peopleRemoved + point.peopleChanged;
            return (
              <g key={point.day}>
                <title>
                  {point.day}：新增 {point.peopleAdded} / 移除 {point.peopleRemoved} / 调整{" "}
                  {point.peopleChanged}
                </title>
                {[
                  { value: point.peopleAdded, color: COLORS.added },
                  { value: point.peopleRemoved, color: COLORS.removed },
                  { value: point.peopleChanged, color: COLORS.changed },
                ].map((segment, segmentIndex) => {
                  const h = segmentHeight(segment.value);
                  if (!h) return null;
                  bottom -= h;
                  return (
                    <rect
                      key={segmentIndex}
                      x={barX(index)}
                      y={bottom}
                      width={barWidth}
                      height={h}
                      fill={segment.color}
                      rx="2"
                    />
                  );
                })}
                {total > 0 ? (
                  <text
                    x={barX(index) + barWidth / 2}
                    y={height - paddingBottom - segmentHeight(total) - 5}
                    textAnchor="middle"
                    fontSize="10"
                    className="fill-slate-500"
                  >
                    {total}
                  </text>
                ) : null}
              </g>
            );
          })
        ) : (
          <text x={width / 2} y={height / 2 - 4} textAnchor="middle" className="fill-slate-400" fontSize="12">
            最近 14 天没有变更
          </text>
        )}

        {labelIndexes.map((index) => (
          <text
            key={index}
            x={paddingX + slot * index + slot / 2}
            y={height - 8}
            textAnchor={index === 0 ? "start" : index === data.length - 1 ? "end" : "middle"}
            fontSize="10"
            className="fill-slate-400"
          >
            {data[index]?.day.slice(5).replace("-", "/")}
          </text>
        ))}
      </svg>
    </div>
  );
}
