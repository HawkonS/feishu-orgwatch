import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { BellRing, Mail, MessageSquare, Search, Users, X } from "lucide-react";
import { get, post, errorMessage } from "../api";
import type { Person, SettingItem } from "../lib/types";
import {
  Button,
  Card,
  CardHeader,
  Input,
  LoadingBlock,
  PageHeader,
  Switch,
} from "../components/ui";

type Recipient = { type: "user" | "chat"; id: string; name: string };
type SettingsResponse = { items: SettingItem[] };
type PeopleResponse = { items: Person[]; total: number };
type ChatsResponse = { items: Array<{ chatId: string; name: string }>; warning: string | null };

function parseRecipients(value: string | undefined): Recipient[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((item) => {
        const value = item as { type?: string; id?: string; name?: string };
        if ((value.type !== "user" && value.type !== "chat") || !value.id) return null;
        return { type: value.type, id: value.id, name: value.name || value.id };
      })
      .filter((item): item is Recipient => Boolean(item));
  } catch {
    return [];
  }
}

export default function Notifications() {
  const queryClient = useQueryClient();
  const [enabled, setEnabled] = useState(false);
  const [recipients, setRecipients] = useState<Recipient[]>([]);
  const [query, setQuery] = useState("");
  const [email, setEmail] = useState("");
  const [loaded, setLoaded] = useState(false);

  const settingsQuery = useQuery({
    queryKey: ["settings"],
    queryFn: () => get<SettingsResponse>("/settings"),
  });

  const chatsQuery = useQuery({
    queryKey: ["notification-chats"],
    queryFn: () => get<ChatsResponse>("/directory/chats"),
  });

  const peopleQuery = useQuery({
    queryKey: ["notification-people", query],
    queryFn: () =>
      get<PeopleResponse>(`/directory/people?q=${encodeURIComponent(query.trim())}&pageSize=20`),
    enabled: query.trim().length > 0,
  });

  useEffect(() => {
    if (!settingsQuery.data || loaded) return;
    const values = new Map(settingsQuery.data.items.map((item) => [item.key, item.value]));
    setEnabled(values.get("notify.auto-enabled") === "true");
    setRecipients(parseRecipients(values.get("notify.auto-recipients")));
    setLoaded(true);
  }, [settingsQuery.data, loaded]);

  const selected = useMemo(() => new Set(recipients.map((item) => `${item.type}:${item.id}`)), [recipients]);
  const peopleCount = recipients.filter((item) => item.type === "user").length;
  const chatCount = recipients.filter((item) => item.type === "chat").length;

  const toggle = (recipient: Recipient) => {
    const key = `${recipient.type}:${recipient.id}`;
    setRecipients((previous) =>
      previous.some((item) => `${item.type}:${item.id}` === key)
        ? previous.filter((item) => `${item.type}:${item.id}` !== key)
        : [...previous, recipient],
    );
  };

  const addEmail = () => {
    const value = email.trim().toLowerCase();
    if (!value.includes("@")) {
      toast.error("请输入有效邮箱");
      return;
    }
    if (!selected.has(`user:${value}`)) {
      setRecipients((previous) => [...previous, { type: "user", id: value, name: value }]);
    }
    setEmail("");
  };

  const save = useMutation({
    mutationFn: () =>
      post("/settings", {
        "notify.auto-enabled": enabled ? "true" : "false",
        "notify.auto-recipients": JSON.stringify(recipients),
      }),
    onSuccess: async () => {
      toast.success("变更通知设置已保存");
      await queryClient.invalidateQueries({ queryKey: ["settings"] });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  if (settingsQuery.isLoading) return <LoadingBlock />;
  if (settingsQuery.isError) {
    return <Card className="p-8 text-center text-sm text-rose-600">通知设置加载失败</Card>;
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="变更通知"
        description="巡查发现新差异后，自动发送飞书知情卡片给指定的人或群。"
        actions={
          <Button
            onClick={() => {
              if (enabled && !recipients.length) {
                toast.error("请先选择至少一个收件人");
                return;
              }
              save.mutate();
            }}
            loading={save.isPending}
          >
            保存设置
          </Button>
        }
      />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <div className="space-y-4">
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-4 px-5 py-4">
          <div className="flex items-start gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-primary-50 text-primary-700">
              <BellRing className="h-4 w-4" />
            </span>
            <div>
              <p className="text-sm font-semibold text-slate-900">自动发送知情卡片</p>
              <p className="mt-0.5 text-xs leading-5 text-slate-500">
                新差异生成后自动发送；手动发送仍然可用。
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 text-sm text-slate-600">
            <Switch checked={enabled} onChange={setEnabled} label="自动发送知情卡片" />
            {enabled ? "已启用" : "未启用"}
          </div>
        </div>
      </Card>

      <Card>
        <CardHeader
          title="发送给谁"
          description={`已选 ${peopleCount} 个人、${chatCount} 个群`}
          icon={<Users className="h-4 w-4" />}
          actions={
            recipients.length ? (
              <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setRecipients([])}>
                清空
              </Button>
            ) : null
          }
        />
        <div className="border-t border-slate-100 px-5 py-4">
          {recipients.length ? (
            <div className="mb-4 flex flex-wrap gap-1.5">
              {recipients.map((recipient) => (
                <span
                  key={`${recipient.type}:${recipient.id}`}
                  className="inline-flex items-center gap-1 rounded-md border border-primary-100 bg-primary-50 px-2 py-1 text-xs text-primary-700"
                >
                  {recipient.type === "chat" ? <MessageSquare className="h-3 w-3" /> : null}
                  {recipient.name}
                  <button
                    type="button"
                    aria-label={`移除 ${recipient.name}`}
                    className="ml-0.5 rounded p-0.5 hover:bg-primary-100"
                    onClick={() => toggle(recipient)}
                  >
                    <X className="h-3 w-3" />
                  </button>
                </span>
              ))}
            </div>
          ) : (
            <p className="mb-4 text-xs text-slate-400">还没有收件人</p>
          )}

          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索姓名或邮箱"
              className="h-9 pl-8"
            />
            {query.trim() ? (
              <div className="absolute z-20 mt-1 max-h-64 w-full overflow-y-auto rounded-md border border-slate-200 bg-white py-1 shadow-lg">
                {peopleQuery.isLoading ? (
                  <p className="px-3 py-6 text-center text-xs text-slate-400">搜索中…</p>
                ) : !peopleQuery.data?.items.length ? (
                  <p className="px-3 py-6 text-center text-xs text-slate-400">没有匹配的成员</p>
                ) : (
                  peopleQuery.data.items.map((person) => {
                    const active = selected.has(`user:${person.openId}`);
                    return (
                      <button
                        key={person.openId}
                        type="button"
                        onClick={() => {
                          toggle({ type: "user", id: person.openId, name: person.name });
                          setQuery("");
                        }}
                        className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left hover:bg-slate-50"
                      >
                        <span className="min-w-0">
                          <span className="text-sm font-medium text-slate-800">{person.name}</span>
                          <span className="ml-2 text-xs text-slate-500">
                            {person.email || person.enterpriseEmail || ""}
                          </span>
                        </span>
                        <span className={`text-xs ${active ? "text-primary-700" : "text-slate-400"}`}>
                          {active ? "已选" : "选择"}
                        </span>
                      </button>
                    );
                  })
                )}
              </div>
            ) : null}
          </div>

          <div className="mt-3 flex gap-2">
            <Input
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  addEmail();
                }
              }}
              placeholder="或输入邮箱"
              className="h-9"
            />
            <Button variant="outline" size="sm" className="h-9 shrink-0" onClick={addEmail}>
              <Mail className="h-3.5 w-3.5" />
              添加
            </Button>
          </div>

          <div className="mt-5 border-t border-slate-100 pt-4">
            <p className="text-xs font-medium text-slate-600">群聊</p>
            {chatsQuery.data?.warning ? (
              <p className="mt-2 text-xs text-amber-700">{chatsQuery.data.warning}</p>
            ) : null}
            {!chatsQuery.data?.items.length ? (
              <p className="mt-2 text-xs text-slate-400">暂无群聊，请确认机器人已加入群聊。</p>
            ) : (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {chatsQuery.data.items.map((chat) => {
                  const active = selected.has(`chat:${chat.chatId}`);
                  return (
                    <button
                      key={chat.chatId}
                      type="button"
                      onClick={() => toggle({ type: "chat", id: chat.chatId, name: chat.name })}
                      className={`inline-flex items-center gap-1 rounded-md border px-2.5 py-1.5 text-xs transition-colors ${
                        active
                          ? "border-primary-400 bg-primary-50 text-primary-700"
                          : "border-slate-200 text-slate-600 hover:bg-slate-50"
                      }`}
                    >
                      <MessageSquare className="h-3 w-3" />
                      {chat.name}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </Card>

      <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-xs leading-5 text-slate-500">
        仅在新差异生成时发送；未发现差异、巡查失败或未启用时不会发送。
      </div>
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader title="发送预览" description="收件人看到的卡片样式" icon={<BellRing className="h-4 w-4" />} />
            <div className="border-t border-slate-100 bg-slate-50/60 p-4">
              <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
                <div className="flex items-center gap-2">
                  <span className="flex h-7 w-7 items-center justify-center rounded bg-primary-50 text-primary-700">
                    <BellRing className="h-3.5 w-3.5" />
                  </span>
                  <span className="text-sm font-semibold text-slate-800">组织架构变更提醒</span>
                </div>
                <p className="mt-3 text-xs leading-5 text-slate-500">
                  巡查发现新的组织变更，请查看详情并确认知情。
                </p>
                <div className="mt-3 flex flex-wrap gap-1.5 text-[11px] text-slate-500">
                  <span className="rounded bg-slate-100 px-1.5 py-0.5">人员变动</span>
                  <span className="rounded bg-slate-100 px-1.5 py-0.5">部门变动</span>
                </div>
                <div className="mt-3 inline-flex rounded-md bg-primary-600 px-3 py-1.5 text-xs font-medium text-white">
                  查看详情
                </div>
              </div>
              <p className="mt-3 text-xs text-slate-500">
                将发送给 {peopleCount} 个人、{chatCount} 个群
              </p>
            </div>
          </Card>

          <Card>
            <CardHeader title="触发规则" />
            <ul className="space-y-2 border-t border-slate-100 px-5 py-4 text-xs leading-5 text-slate-600">
              <li>仅在巡查生成新差异时发送</li>
              <li>无差异、巡查失败或未启用时不发送</li>
              <li>发送记录为「系统自动通知」，可在审计中查看</li>
            </ul>
          </Card>
        </div>
      </div>
    </div>
  );
}
