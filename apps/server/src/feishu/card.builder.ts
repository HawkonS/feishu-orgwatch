import { escapeCardText, truncate } from "../common/text.js";
import { describeChange, type Change, type DiffCounts, type Severity } from "../sync/diff.engine.js";

export type CardInput = {
  title: string;
  siteName: string;
  publicBaseUrl: string;
  diffId: number;
  counts: DiffCounts;
  changes: Change[];
  note?: string | null;
  maxItems: number;
  timeText: string;
  taskName?: string | null;
};

const SEVERITY_COLOR: Record<Severity, string> = {
  high: "red",
  medium: "orange",
  low: "blue",
  info: "grey",
};

function changeLine(change: Change): string {
  const color = SEVERITY_COLOR[change.severity] ?? "grey";
  return `<font color='${color}'>●</font> ${escapeCardText(truncate(describeChange(change), 220))}`;
}

export function buildDiffCard(input: CardInput): Record<string, unknown> {
  const shown = input.changes.slice(0, input.maxItems);
  const remaining = Math.max(0, input.changes.length - shown.length);
  const severity = input.changes.some((item) => item.severity === "high")
    ? "high"
    : input.changes.some((item) => item.severity === "medium")
      ? "medium"
      : input.changes.some((item) => item.severity === "low")
        ? "low"
        : "info";
  const baseUrl = input.publicBaseUrl.replace(/\/+$/, "");
  const taskText = input.taskName ? escapeCardText(input.taskName) : "手动巡查";
  const detailLines = shown.length
    ? shown.map(changeLine).join("\n")
    : "本次未发现变更。";
  const moreText =
    remaining > 0
      ? `\n<font color='grey'>还有 ${remaining} 项变更，请前往平台查看</font>`
      : "";

  const peopleTotal = input.counts.peopleAdded + input.counts.peopleRemoved + input.counts.peopleChanged;
  const departmentTotal =
    input.counts.departmentsAdded + input.counts.departmentsRemoved + input.counts.departmentsChanged;

  const part = (label: string, value: number, color: "green" | "red" | "orange") =>
    value > 0 ? `<font color='${color}'>${label} ${value}</font>` : null;
  const statLines: string[] = [];
  if (peopleTotal > 0) {
    const parts = [
      part("新增", input.counts.peopleAdded, "green"),
      part("移除", input.counts.peopleRemoved, "red"),
      part("调整", input.counts.peopleChanged, "orange"),
    ].filter(Boolean);
    if (parts.length) statLines.push(`**人员变动**\n${parts.join(" · ")}`);
  }
  if (departmentTotal > 0) {
    const parts = [
      part("新增", input.counts.departmentsAdded, "green"),
      part("移除", input.counts.departmentsRemoved, "red"),
      part("调整", input.counts.departmentsChanged, "orange"),
    ].filter(Boolean);
    if (parts.length) statLines.push(`**部门变动**\n${parts.join(" · ")}`);
  }

  const elements: Array<Record<string, unknown>> = [
    {
      tag: "div",
      text: {
        tag: "lark_md",
        content: `<font color='grey'>${escapeCardText(input.timeText)} · ${taskText}</font>\n\n**本次巡查检测到 ${input.counts.total} 项组织变更**`,
      },
    },
    ...(statLines.length
      ? [
          {
            tag: "div",
            text: {
              tag: "lark_md",
              content: statLines.join("\n\n"),
            },
          },
        ]
      : []),
    { tag: "hr" },
    {
      tag: "div",
      text: {
        tag: "lark_md",
        content: `**变更明细**\n${detailLines}${moreText}`,
      },
    },
    {
      tag: "action",
      actions: [
        {
          tag: "button",
          text: { tag: "plain_text", content: "查看详情并确认知情" },
          type: "primary",
          url: `${baseUrl}/diffs/${input.diffId}`,
        },
      ],
    },
  ];

  if (input.note) {
    elements.push({
      tag: "div",
      text: {
        tag: "lark_md",
        content: `<font color='grey'>**说明**：${escapeCardText(truncate(input.note, 300))}</font>`,
      },
    });
  }

  elements.push({
    tag: "note",
    elements: [
      {
        tag: "plain_text",
        content: `${escapeCardText(input.siteName)} · ${escapeCardText(input.timeText)}`,
      },
    ],
  });

  return {
    config: { wide_screen_mode: true, enable_forward: true },
    header: {
      template: SEVERITY_COLOR[severity],
      title: { tag: "plain_text", content: escapeCardText(truncate(input.title, 60)) },
    },
    elements,
  };
}
