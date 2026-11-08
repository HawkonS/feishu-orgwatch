import { Inject, Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "../config/config.service.js";
import { FeishuClient } from "./feishu.client.js";
import { ApiError } from "../common/errors.js";

export type RawDepartment = {
  openDepartmentId: string;
  parentOpenDepartmentId: string;
  name: string;
  leaderOpenId: string | null;
  leaderOpenIds: string[];
  order: number;
  status: string;
};

export type RawPerson = {
  openId: string;
  unionId: string | null;
  userId: string | null;
  name: string;
  email: string | null;
  enterpriseEmail: string | null;
  jobTitle: string | null;
  employeeNo: string | null;
  status: string;
  isResigned: boolean;
  isFrozen: boolean;
  avatarUrl: string | null;
  departmentIds: string[];
};

export type FetchResult = {
  departments: RawDepartment[];
  people: RawPerson[];
  warnings: string[];
};

type FeishuDepartment = {
  open_department_id?: string;
  department_id?: string;
  parent_department_id?: string;
  name?: string;
  leader_user_id?: string;
  leaders?: Array<{ leaderID?: string; leaderType?: number }>;
  order?: string | number;
  status?: { is_deleted?: boolean };
};

type FeishuUser = {
  open_id?: string;
  union_id?: string;
  user_id?: string;
  name?: string;
  email?: string;
  enterprise_email?: string;
  job_title?: string;
  employee_no?: string;
  avatar?: { avatar_72?: string; avatar_240?: string; avatar_640?: string; avatar_origin?: string };
  avatar_url?: string;
  avatar_thumb?: string;
  department_ids?: string[];
  status?: {
    is_activated?: boolean;
    is_resigned?: boolean;
    is_frozen?: boolean;
    is_exited?: boolean;
  };
};

export type FetchOptions = {
  rootDepartmentId: string;
  shouldCancel?: () => boolean;
  onProgress?: (phase: "departments" | "people" | "enrich", count: number) => void;
};

@Injectable()
export class DirectoryFetcher {
  private readonly logger = new Logger(DirectoryFetcher.name);

  constructor(
    @Inject(FeishuClient) private readonly client: FeishuClient,
    @Inject(ConfigService) private readonly config: ConfigService,
  ) {}

  private pickAvatar(item: FeishuUser): string | null {
    return (
      item.avatar?.avatar_72 ??
      item.avatar?.avatar_240 ??
      item.avatar?.avatar_640 ??
      item.avatar?.avatar_origin ??
      item.avatar_url ??
      item.avatar_thumb ??
      null
    );
  }

  private mapDepartment(item: FeishuDepartment): RawDepartment | null {
    const id = item.open_department_id ?? item.department_id;
    if (!id) return null;
    const leaderOpenIds = (item.leaders ?? [])
      .slice()
      .sort((a, b) => (a.leaderType ?? 99) - (b.leaderType ?? 99))
      .map((leader) => leader.leaderID)
      .filter((value): value is string => Boolean(value));
    const primary = item.leader_user_id ?? leaderOpenIds[0] ?? null;
    if (primary && !leaderOpenIds.includes(primary)) leaderOpenIds.unshift(primary);
    return {
      openDepartmentId: id,
      parentOpenDepartmentId: item.parent_department_id ?? "0",
      name: (item.name ?? "").normalize("NFKC").trim() || id,
      leaderOpenId: primary,
      leaderOpenIds,
      order: Number(item.order ?? 0) || 0,
      status: item.status?.is_deleted ? "deleted" : "active",
    };
  }

  private mapPerson(item: FeishuUser, extraDepartmentId: string): RawPerson | null {
    if (!item.open_id) return null;
    const departmentIds = new Set(item.department_ids ?? []);
    departmentIds.add(extraDepartmentId);
    const isResigned = Boolean(item.status?.is_resigned || item.status?.is_exited);
    const isFrozen = Boolean(item.status?.is_frozen);
    return {
      openId: item.open_id,
      unionId: item.union_id ?? null,
      userId: item.user_id ?? null,
      name: (item.name ?? "").normalize("NFKC").trim() || item.open_id,
      email: item.email ?? null,
      enterpriseEmail: item.enterprise_email ?? null,
      jobTitle: item.job_title ?? null,
      employeeNo: item.employee_no ?? null,
      status: isResigned ? "resigned" : isFrozen ? "frozen" : "active",
      isResigned,
      isFrozen,
      avatarUrl: this.pickAvatar(item),
      departmentIds: [...departmentIds].filter((id) => Boolean(id)),
    };
  }

  async fetch(options: FetchOptions): Promise<FetchResult> {
    const warnings: string[] = [];
    const maxDepartments = this.config.number("sync.max-departments", 10000);
    const maxPeople = this.config.number("sync.max-people", 100000);
    const concurrency = Math.min(8, Math.max(1, this.config.number("sync.concurrency", 4)));
    const root = options.rootDepartmentId || "0";

    const departmentItems = await this.client.paginate<FeishuDepartment>(
      `/open-apis/contact/v3/departments/${encodeURIComponent(root)}/children`,
      { department_id_type: "open_department_id", fetch_child: "true" },
      {
        maxItems: maxDepartments,
        shouldCancel: options.shouldCancel,
        onProgress: (count) => options.onProgress?.("departments", count),
      },
    );

    const departments = new Map<string, RawDepartment>();
    for (const item of departmentItems) {
      const mapped = this.mapDepartment(item);
      if (mapped) departments.set(mapped.openDepartmentId, mapped);
    }

    if (root !== "0") {
      const detail = await this.client.request<{ department?: FeishuDepartment }>(
        `/open-apis/contact/v3/departments/${encodeURIComponent(root)}`,
        { query: { department_id_type: "open_department_id" } },
      );
      const mapped = detail.department ? this.mapDepartment(detail.department) : null;
      if (mapped) {
        departments.set(root, { ...mapped, parentOpenDepartmentId: "0" });
      }
    } else {
      departments.set("0", {
        openDepartmentId: "0",
        parentOpenDepartmentId: "0",
        name: "根部门",
        leaderOpenId: null,
        leaderOpenIds: [],
        order: 0,
        status: "active",
      });
    }

    const scopeDepartmentIds = new Set<string>([root, ...departments.keys()]);
    const people = new Map<string, RawPerson>();

    let cursor = 0;
    const ids = [...scopeDepartmentIds];
    const workers = Array.from({ length: Math.min(concurrency, ids.length) }, async () => {
      for (;;) {
        const index = cursor;
        cursor += 1;
        if (index >= ids.length) return;
        const departmentId = ids[index] as string;
        if (options.shouldCancel?.()) throw new ApiError(499, "CANCELLED", "运行已取消");
        const rows = await this.client.paginate<FeishuUser>(
          "/open-apis/contact/v3/users/find_by_department",
          {
            department_id: departmentId,
            department_id_type: "open_department_id",
            user_id_type: "open_id",
          },
          {
            maxItems: maxPeople,
            shouldCancel: options.shouldCancel,
            onProgress: (count) => options.onProgress?.("people", people.size + count),
          },
        );
        for (const row of rows) {
          const mapped = this.mapPerson(row, departmentId);
          if (!mapped) continue;
          const existing = people.get(mapped.openId);
          if (!existing) {
            people.set(mapped.openId, mapped);
            continue;
          }
          const merged = new Set([...existing.departmentIds, ...mapped.departmentIds]);
          existing.departmentIds = [...merged];
          existing.email ??= mapped.email;
          existing.enterpriseEmail ??= mapped.enterpriseEmail;
          existing.jobTitle ??= mapped.jobTitle;
          existing.employeeNo ??= mapped.employeeNo;
        }
        if (people.size > maxPeople) {
          throw new ApiError(
            400,
            "DIRECTORY_TOO_LARGE",
            `人员数量超过上限 ${maxPeople}，请在设置中缩小巡查范围`,
          );
        }
      }
    });
    await Promise.all(workers);

    const needsEnrich = [...people.values()]
      .filter((person) => (!person.email && !person.enterpriseEmail) || !person.avatarUrl)
      .slice(0, 200);
    if (needsEnrich.length) {
      try {
        for (let index = 0; index < needsEnrich.length; index += 50) {
          const chunk = needsEnrich.slice(index, index + 50);
          const data = await this.client.request<{ items?: FeishuUser[] }>(
            "/open-apis/contact/v3/users/batch",
            {
              method: "POST",
              query: { user_id_type: "open_id" },
              body: { user_ids: chunk.map((item) => item.openId) },
            },
          );
          for (const item of data.items ?? []) {
            if (!item.open_id) continue;
            const person = people.get(item.open_id);
            if (!person) continue;
            person.email = person.email ?? item.email ?? null;
            person.enterpriseEmail = person.enterpriseEmail ?? item.enterprise_email ?? null;
            person.jobTitle = person.jobTitle ?? item.job_title ?? null;
            person.employeeNo = person.employeeNo ?? item.employee_no ?? null;
            person.avatarUrl = person.avatarUrl ?? this.pickAvatar(item);
          }
          options.onProgress?.("enrich", index + chunk.length);
        }
      } catch (error) {
        const message = `字段补齐失败，已使用列表数据继续：${(error as Error).message}`;
        this.logger.warn(message);
        warnings.push(message);
      }
    }

    return {
      departments: [...departments.values()],
      people: [...people.values()],
      warnings,
    };
  }
}
