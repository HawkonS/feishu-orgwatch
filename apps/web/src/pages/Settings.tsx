import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  BellRing,
  GitCompareArrows,
  KeyRound,
  MessageSquare,
  RefreshCw,
  SlidersHorizontal,
} from "lucide-react";
import { get, post, errorMessage } from "../api";
import { useSession } from "../lib/session";
import type { SettingItem } from "../lib/types";
import {
  Button,
  Card,
  CardHeader,
  Field,
  Input,
  LoadingBlock,
  PageHeader,
  Switch,
} from "../components/ui";

const GROUPS = [
  { title: "飞书应用", description: "", prefix: "feishu.", icon: KeyRound },
  { title: "卡片与通知", description: "", prefix: "card.", icon: BellRing },
  { title: "差异规则", description: "", prefix: "diff.", icon: GitCompareArrows },
  { title: "同步与快照", description: "", prefix: "sync.", icon: SlidersHorizontal },
];

const GROUP_ICONS = {
  "feishu.": KeyRound,
  "card.": BellRing,
  "diff.": GitCompareArrows,
  "sync.": SlidersHorizontal,
} as const;

export default function Settings() {
  const { user } = useSession();
  const admin = user?.role === "admin";
  const queryClient = useQueryClient();
  const [values, setValues] = useState<Record<string, string>>({});

  const settingsQuery = useQuery({
    queryKey: ["settings"],
    queryFn: () =>
      get<{
        items: SettingItem[];
        siteName: string;
        copyright: string;
        publicBaseUrl: string;
        timezone: string;
      }>("/settings"),
  });

  const chatsQuery = useQuery({
    queryKey: ["settings-chats"],
    queryFn: () => get<{ items: Array<{ chatId: string; name: string }>; warning: string | null }>("/settings/chats"),
  });

  useEffect(() => {
    if (!settingsQuery.data) return;
    const next: Record<string, string> = {};
    for (const item of settingsQuery.data.items) {
      next[item.key] = item.kind === "secret" ? "" : item.value;
    }
    setValues(next);
  }, [settingsQuery.data]);

  const save = useMutation({
    mutationFn: () => {
      const payload: Record<string, string> = {};
      for (const item of settingsQuery.data?.items ?? []) {
        const value = values[item.key] ?? "";
        if (item.kind === "secret" && !value) continue;
        payload[item.key] = value;
      }
      return post("/settings", payload);
    },
    onSuccess: async () => {
      toast.success("设置已保存");
      await queryClient.invalidateQueries({ queryKey: ["settings"] });
      await queryClient.invalidateQueries({ queryKey: ["bootstrap-status"] });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const testConnection = useMutation({
    mutationFn: () => post<{ ok: boolean; rootDepartments: number }>("/settings/feishu/test"),
    onSuccess: (data) =>
      toast.success(`连接成功，根部门下读取到 ${data.rootDepartments} 个部门（仅预览 10 个）`),
    onError: (error) => toast.error(errorMessage(error)),
  });

  const items = settingsQuery.data?.items ?? [];
  const grouped = useMemo(
    () =>
      GROUPS.map((group) => ({
        ...group,
        items: items.filter((item) => item.key.startsWith(group.prefix)),
      })).filter((group) => group.items.length),
    [items],
  );

  if (settingsQuery.isLoading) return <LoadingBlock />;
  if (settingsQuery.isError) {
    return (
      <Card className="p-8 text-center text-sm text-red-600">设置加载失败，请确认当前账号具备权限</Card>
    );
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="设置"
        description={admin ? "飞书应用、通知与差异配置。" : "通知与差异配置。"}
        actions={
          <>
            {admin ? (
              <Button variant="outline" onClick={() => testConnection.mutate()} loading={testConnection.isPending}>
                <RefreshCw className="h-4 w-4" />
                测试连接
              </Button>
            ) : null}
            <Button onClick={() => save.mutate()} loading={save.isPending}>
              保存设置
            </Button>
          </>
        }
      />

      {grouped.map((group) => (
        <Card key={group.title}>
          <CardHeader
            title={group.title}
            description={group.description}
            icon={(() => {
              const Icon = GROUP_ICONS[group.prefix as keyof typeof GROUP_ICONS] ?? SlidersHorizontal;
              return <Icon className="h-4 w-4" />;
            })()}
          />
          <div className="grid gap-4 px-5 py-4 md:grid-cols-2">
            {group.items.map((item) => (
              <SettingField
                key={item.key}
                item={item}
                value={values[item.key] ?? ""}
                onChange={(value) => setValues((previous) => ({ ...previous, [item.key]: value }))}
              />
            ))}
          </div>
        </Card>
      ))}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="overflow-hidden lg:col-span-2">
          <CardHeader
            title="群聊"
            description="机器人已加入的群，发送知情卡片时可直接选择"
            icon={<MessageSquare className="h-4 w-4" />}
            actions={
              <Button variant="outline" size="sm" onClick={() => void chatsQuery.refetch()} loading={chatsQuery.isFetching}>
                刷新
              </Button>
            }
          />
          <div className="px-5 pb-5 text-sm">
            {chatsQuery.data?.warning ? (
              <p className="mb-2 rounded-lg bg-amber-50 px-3 py-2 text-[11px] text-amber-700">{chatsQuery.data.warning}</p>
            ) : null}
            {chatsQuery.data?.items.length ? (
              <ul className="flex flex-wrap gap-2">
                {chatsQuery.data.items.map((chat) => (
                  <li key={chat.chatId} className="flex items-center gap-2 rounded-lg bg-slate-50 px-2.5 py-1.5">
                    <MessageSquare className="h-3.5 w-3.5 text-slate-400" />
                    <span className="text-xs text-slate-700">{chat.name}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-xs leading-relaxed text-slate-500">暂无群聊，请确认机器人已加入群聊。</p>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}

function SettingField({
  item,
  value,
  onChange,
}: {
  item: SettingItem;
  value: string;
  onChange: (value: string) => void;
}) {
  if (item.kind === "boolean") {
    return (
      <div className="flex items-start justify-between gap-3 rounded-md border border-slate-200 px-3 py-2.5">
        <div>
          <p className="text-sm font-medium text-slate-700">{item.label}</p>
          {item.description ? (
            <p className="mt-0.5 text-xs leading-5 text-slate-500">{item.description}</p>
          ) : null}
        </div>
        <Switch checked={value === "true"} onChange={(checked) => onChange(checked ? "true" : "false")} label={item.label} />
      </div>
    );
  }
  return (
    <Field label={item.label} hint={item.description}>
      {item.kind === "secret" ? (
        <Input
          type="password"
          autoComplete="new-password"
          value={value}
          placeholder={item.configured ? "已配置，留空表示不修改" : "尚未配置"}
          onChange={(event) => onChange(event.target.value)}
        />
      ) : (
        <Input
          type={item.kind === "number" ? "number" : "text"}
          value={value}
          min={item.min}
          max={item.max}
          onChange={(event) => onChange(event.target.value)}
        />
      )}
    </Field>
  );
}
