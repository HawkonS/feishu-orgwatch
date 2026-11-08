import { Link } from "react-router-dom";
import {
  BellRing,
  BookOpen,
  Building2,
  EyeOff,
  GitCompareArrows,
  Image as ImageIcon,
  ListOrdered,
  Mail,
  SlidersHorizontal,
  UserRound,
  Users,
} from "lucide-react";
import { canOperate, useSession } from "../lib/session";
import { Badge, Button, Card, CardHeader, PageHeader } from "../components/ui";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../components/ui/table";

type Severity = "high" | "medium" | "low" | "info";

const SEVERITY_LABEL: Record<Severity, string> = {
  high: "高",
  medium: "中",
  low: "低",
  info: "提示",
};
const SEVERITY_TONE: Record<Severity, "red" | "orange" | "blue" | "gray"> = {
  high: "red",
  medium: "orange",
  low: "blue",
  info: "gray",
};

const PERSON_RULES: Array<{ name: string; rule: string; level: Severity | "high-medium" }> = [
  { name: "新增成员", rule: "open_id 首次出现在当前巡查范围内", level: "medium" },
  { name: "离职或移出", rule: "上一份快照里存在，本次快照中消失", level: "high" },
  { name: "姓名变更", rule: "姓名归一化后与上一份快照不同", level: "medium" },
  { name: "邮箱变更", rule: "主要邮箱不同；个人邮箱优先，其次企业邮箱", level: "medium" },
  { name: "部门调整", rule: "所属部门集合发生新增、移除或替换", level: "high" },
  { name: "在职状态变更", rule: "在职 / 冻结 / 离职之间发生变化", level: "high-medium" },
  { name: "职位变更", rule: "默认开启，可在「设置 → 差异规则」关闭", level: "low" },
  { name: "工号变更", rule: "默认开启，可在「设置 → 差异规则」关闭", level: "low" },
];

const DEPARTMENT_RULES: Array<{ name: string; rule: string; level: Severity }> = [
  { name: "新增部门", rule: "上一份快照中没有这个 open_department_id", level: "info" },
  { name: "部门删除", rule: "上一份快照中存在，本次消失", level: "high" },
  { name: "部门改名", rule: "部门名称归一化后不同", level: "medium" },
  { name: "调整上级", rule: "parent_open_department_id 发生变化", level: "medium" },
  { name: "负责人变更", rule: "主负责人或负责人列表变化（含设为空）", level: "high" },
  { name: "部门状态变更", rule: "部门状态由正常变为已删除等", level: "medium" },
  { name: "排序调整", rule: "默认关闭；开启后才记录部门 order 变化", level: "low" },
];

const IGNORED = [
  { icon: ImageIcon, title: "头像变化", text: "头像只用于人员展示，不参与差异比较。" },
  { icon: ListOrdered, title: "成员在部门内的顺序", text: "人员按 open_id 与部门集合归一化，顺序变化不算差异。" },
  { icon: ListOrdered, title: "部门排序", text: "默认忽略；需要时可在设置中显式开启低优先级追踪。" },
  { icon: Mail, title: "邮箱大小写", text: "统一 trim + 小写后再比较，大小写变化不产生差异。" },
  { icon: UserRound, title: "姓名空格与全半角", text: "NFKC 归一化并折叠空白，格式差异不算改名。" },
  { icon: EyeOff, title: "未采集的飞书字段", text: "手机号、性别、地址等没有进入快照，也不会被比较。" },
];

export default function Guide() {
  const { user } = useSession();
  const operator = canOperate(user);

  return (
    <div className="space-y-4">
      <PageHeader
        title="监测说明"
        description="巡查只比较影响组织协作的稳定字段，而不是飞书里的每一次刷新。"
        actions={
          <>
            <Link to="/diffs">
              <Button variant="outline" size="sm">
                <GitCompareArrows className="h-4 w-4" />
                查看差异
              </Button>
            </Link>
            {operator ? (
              <Link to="/settings">
                <Button size="sm">
                  <SlidersHorizontal className="h-4 w-4" />
                  差异规则设置
                </Button>
              </Link>
            ) : null}
          </>
        }
      />

      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-start gap-4 p-5">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-primary-50 text-primary-700">
            <BookOpen className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-base font-semibold tracking-tight text-slate-900">15 类变更会被记录</h2>
              <Badge tone="blue">人员 8 类</Badge>
              <Badge tone="gray">部门 7 类</Badge>
            </div>
            <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-500">
              系统会把每次巡查的快照与上一份快照逐项比较。只有下面列出的字段发生变化，才会生成差异、进入通知与知情流程；
              其余刷新会被忽略，避免排序、头像和格式变化制造噪音。
            </p>
          </div>
        </div>
        <div className="grid gap-px border-t border-slate-100 bg-slate-100 sm:grid-cols-3">
          {[
            { label: "首次巡查", text: "只建立基线快照，不生成差异" },
            { label: "之后每次巡查", text: "与上一份快照比较，只记录真实变更" },
            { label: "通知前", text: "可在差异详情选择知情人和群聊" },
          ].map((item) => (
            <div key={item.label} className="bg-white px-5 py-3">
              <p className="text-[11px] font-medium text-slate-400">{item.label}</p>
              <p className="mt-1 text-sm text-slate-700">{item.text}</p>
            </div>
          ))}
        </div>
      </Card>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card className="overflow-hidden">
          <CardHeader
            title="人员变更"
            description="以 open_id 识别同一个人，比较 8 个稳定字段"
            icon={<Users className="h-4 w-4" />}
          />
          <RuleTable rows={PERSON_RULES} />
        </Card>

        <Card className="overflow-hidden">
          <CardHeader
            title="部门变更"
            description="以 open_department_id 识别部门，比较 7 个字段"
            icon={<Building2 className="h-4 w-4" />}
          />
          <RuleTable rows={DEPARTMENT_RULES} />
        </Card>
      </div>

      <Card className="overflow-hidden">
        <CardHeader
          title="不会被判定为变更"
          description="这些差异即使飞书侧发生变化，也不会生成差异或发送卡片"
          icon={<EyeOff className="h-4 w-4" />}
        />
        <div className="grid gap-px border-t border-slate-100 bg-slate-100 sm:grid-cols-2 lg:grid-cols-3">
          {IGNORED.map((item) => (
            <div key={item.title} className="flex gap-3 bg-white px-5 py-4">
              <item.icon className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
              <div className="min-w-0">
                <p className="text-sm font-medium text-slate-800">{item.title}</p>
                <p className="mt-0.5 text-xs leading-5 text-slate-500">{item.text}</p>
              </div>
            </div>
          ))}
        </div>
      </Card>

      <div>
        <Card className="overflow-hidden">
          <CardHeader
            title="通知与知情"
            description="差异不会自动打扰所有人，由操作人选择收件人"
            icon={<BellRing className="h-4 w-4" />}
          />
          <div className="space-y-3 border-t border-slate-100 px-5 py-4">
            {[
              { step: "1", title: "生成差异", text: "状态为「待通知」，可在详情查看前后值。" },
              { step: "2", title: "选择知情人", text: "按人或多选群聊发送飞书卡片，卡片带详情深链。" },
              { step: "3", title: "回执闭环", text: "本人点「我已知情」，或管理员代确认；也可忽略。" },
            ].map((item) => (
              <div key={item.step} className="flex gap-3">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-primary-200 bg-primary-50 text-[11px] font-medium text-primary-700">
                  {item.step}
                </span>
                <div>
                  <p className="text-sm font-medium text-slate-800">{item.title}</p>
                  <p className="mt-0.5 text-xs leading-5 text-slate-500">{item.text}</p>
                </div>
              </div>
            ))}
            <p className="border-t border-slate-100 pt-3 text-xs leading-5 text-slate-400">
              发送、重试、代确认与忽略都会写入审计日志。
            </p>
          </div>
        </Card>
      </div>

      <Card className="overflow-hidden">
        <CardHeader
          title="比较前会先做归一化"
          description="这些处理不会改变展示内容，只用于消除无意义差异"
          icon={<SlidersHorizontal className="h-4 w-4" />}
        />
        <div className="grid gap-3 border-t border-slate-100 px-5 py-4 sm:grid-cols-2 lg:grid-cols-4">
          {[
            { title: "邮箱", text: "trim + 转小写" },
            { title: "姓名", text: "NFKC + 折叠空白" },
            { title: "职位 / 工号", text: "trim 后比较" },
            { title: "部门集合", text: "按 open_department_id 排序" },
          ].map((item) => (
            <div key={item.title} className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2.5">
              <p className="text-xs font-medium text-slate-800">{item.title}</p>
              <p className="mt-0.5 font-mono text-[11px] text-slate-500">{item.text}</p>
            </div>
          ))}
        </div>
      </Card>

      <p className="px-1 pb-2 text-xs leading-5 text-slate-400">
        想调整追踪范围？运营管理员或系统管理员可以前往{" "}
        {operator ? (
          <Link to="/settings" className="text-primary-700 hover:underline">
            设置 → 差异规则
          </Link>
        ) : (
          "设置 → 差异规则"
        )}{" "}
        开启或关闭部门排序、职位与工号。修改只影响之后生成的差异，历史差异保持原样。
      </p>
    </div>
  );
}

function RuleTable({ rows }: { rows: Array<{ name: string; rule: string; level: Severity | "high-medium" }> }) {
  return (
    <Table className="min-w-[560px]">
      <TableHeader>
        <TableRow className="bg-slate-50/60 hover:bg-slate-50/60">
          <TableHead className="w-32">变更</TableHead>
          <TableHead>识别规则</TableHead>
          <TableHead className="w-20">级别</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={row.name}>
            <TableCell className="text-sm font-medium text-slate-800">{row.name}</TableCell>
            <TableCell className="text-xs leading-5 text-slate-500">{row.rule}</TableCell>
            <TableCell>
              {row.level === "high-medium" ? (
                <span className="flex gap-1">
                  <Badge tone="red">高</Badge>
                  <Badge tone="orange">中</Badge>
                </span>
              ) : (
                <Badge tone={SEVERITY_TONE[row.level]}>{SEVERITY_LABEL[row.level]}</Badge>
              )}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
