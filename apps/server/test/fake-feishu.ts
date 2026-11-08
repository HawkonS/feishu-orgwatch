import http from "node:http";
import { AddressInfo } from "node:net";

export type FakeDept = {
  id: string;
  parentId: string;
  name: string;
  leaderOpenId?: string | null;
  leaderOpenIds?: string[];
  order?: number;
  status?: string;
};

export type FakeUser = {
  openId: string;
  unionId?: string | null;
  userId?: string | null;
  name: string;
  email?: string | null;
  enterpriseEmail?: string | null;
  jobTitle?: string | null;
  employeeNo?: string | null;
  status?: string;
  departmentIds: string[];
  avatarUrl?: string | null;
};

export type FakeFeishu = {
  url: string;
  messages: Array<{ receiveIdType: string; body: Record<string, unknown> }>;
  setData: (departments: FakeDept[], users: FakeUser[]) => void;
  close: () => Promise<void>;
};

export async function startFakeFeishu(initial: {
  departments: FakeDept[];
  users: FakeUser[];
  pageSize?: number;
}): Promise<FakeFeishu> {
  let departments = initial.departments;
  let users = initial.users;
  const pageSize = initial.pageSize ?? 0;
  const messages: FakeFeishu["messages"] = [];

  const server = http.createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://localhost");
    const send = (payload: unknown, status = 200) => {
      response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
      response.end(JSON.stringify(payload));
    };
    const ok = (data: unknown) => send({ code: 0, msg: "ok", data });

    const paginate = <T>(items: T[]) => {
      const token = Number(url.searchParams.get("page_token") ?? "0");
      const size = pageSize > 0 ? pageSize : items.length || 1;
      const start = Number.isFinite(token) ? token : 0;
      const slice = items.slice(start, start + size);
      const next = start + slice.length;
      return {
        items: slice,
        has_more: next < items.length,
        page_token: next < items.length ? String(next) : undefined,
      };
    };

    const readBody = async (): Promise<Record<string, unknown>> => {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(chunk as Buffer);
      const text = Buffer.concat(chunks).toString("utf8");
      if (!text) return {};
      try {
        return JSON.parse(text) as Record<string, unknown>;
      } catch {
        return {};
      }
    };

    if (url.pathname === "/open-apis/auth/v3/tenant_access_token/internal") {
      await readBody();
      return send({ code: 0, msg: "ok", tenant_access_token: "fake-tenant-token", expire: 7200 });
    }

    const childrenMatch = url.pathname.match(/^\/open-apis\/contact\/v3\/departments\/([^/]+)\/children$/);
    if (childrenMatch) {
      const parentId = decodeURIComponent(childrenMatch[1] as string);
      const fetchChild = url.searchParams.get("fetch_child") === "true";
      const scoped = departments.filter((item) => {
        if (fetchChild) return true;
        return item.parentId === parentId;
      });
      return ok(
        paginate(
          scoped.map((item) => ({
            open_department_id: item.id,
            parent_department_id: item.parentId,
            name: item.name,
            leader_user_id: item.leaderOpenId ?? undefined,
            leaders: (item.leaderOpenIds ?? (item.leaderOpenId ? [item.leaderOpenId] : [])).map((leaderID) => ({
              leaderID,
              leaderType: 1,
            })),
            order: String(item.order ?? 0),
            status: { is_deleted: item.status === "deleted" },
          })),
        ),
      );
    }

    const departmentMatch = url.pathname.match(/^\/open-apis\/contact\/v3\/departments\/([^/]+)$/);
    if (departmentMatch) {
      const id = decodeURIComponent(departmentMatch[1] as string);
      const item = departments.find((entry) => entry.id === id);
      if (!item) return send({ code: 40004, msg: "department not found" });
      return ok({
        department: {
          open_department_id: item.id,
          parent_department_id: item.parentId,
          name: item.name,
          leader_user_id: item.leaderOpenId ?? undefined,
          leaders: (item.leaderOpenIds ?? (item.leaderOpenId ? [item.leaderOpenId] : [])).map((leaderID) => ({
            leaderID,
            leaderType: 1,
          })),
          order: String(item.order ?? 0),
          status: { is_deleted: item.status === "deleted" },
        },
      });
    }

    if (url.pathname === "/open-apis/contact/v3/users/find_by_department") {
      const departmentId = url.searchParams.get("department_id") ?? "";
      const scoped = users.filter((item) => item.departmentIds.includes(departmentId));
      return ok(
        paginate(
          scoped.map((item) => ({
            open_id: item.openId,
            union_id: item.unionId ?? undefined,
            user_id: item.userId ?? undefined,
            name: item.name,
            email: item.email ?? undefined,
            enterprise_email: item.enterpriseEmail ?? undefined,
            job_title: item.jobTitle ?? undefined,
            employee_no: item.employeeNo ?? undefined,
            avatar: item.avatarUrl ? { avatar_72: item.avatarUrl } : undefined,
            department_ids: item.departmentIds,
            status: {
              is_resigned: item.status === "resigned",
              is_frozen: item.status === "frozen",
              is_activated: item.status !== "resigned",
            },
          })),
        ),
      );
    }

    if (url.pathname === "/open-apis/contact/v3/users/batch") {
      const body = await readBody();
      const ids = Array.isArray(body.user_ids) ? (body.user_ids as string[]) : [];
      return ok({
        items: users
          .filter((item) => ids.includes(item.openId))
          .map((item) => ({
            open_id: item.openId,
            name: item.name,
            email: item.email ?? undefined,
            enterprise_email: item.enterpriseEmail ?? undefined,
            job_title: item.jobTitle ?? undefined,
            employee_no: item.employeeNo ?? undefined,
          })),
      });
    }

    if (url.pathname === "/open-apis/im/v1/messages") {
      const body = await readBody();
      messages.push({
        receiveIdType: url.searchParams.get("receive_id_type") ?? "",
        body,
      });
      return ok({ message_id: `om_${messages.length}` });
    }

    if (url.pathname === "/open-apis/im/v1/chats") {
      return ok({
        items: [{ chat_id: "oc_test_chat", name: "组织架构变化通知群" }],
        has_more: false,
      });
    }

    return send({ code: 40400, msg: `unhandled ${url.pathname}` }, 404);
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo;

  return {
    url: `http://127.0.0.1:${address.port}`,
    messages,
    setData: (nextDepartments, nextUsers) => {
      departments = nextDepartments;
      users = nextUsers;
    },
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}
