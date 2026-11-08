import { Inject, Controller, Get, Param, Query } from "@nestjs/common";
import { and, desc, eq, inArray, like, or, sql } from "drizzle-orm";
import { z } from "zod";
import { DatabaseService } from "../db/database.service.js";
import {
  changes as changesTable,
  diffs,
  snapshotDepartments,
  snapshotMemberships,
  snapshotPeople,
  snapshots,
} from "../db/schema.js";
import { notFound } from "../common/errors.js";
import { SettingsService } from "../settings/settings.service.js";
import { FeishuClient } from "../feishu/feishu.client.js";
import { pageQuerySchema, parseWith } from "../common/validation.js";

const peopleSchema = pageQuerySchema.extend({
  q: z.string().max(100).optional(),
  departmentId: z.string().max(200).optional(),
  direct: z.enum(["0", "1"]).optional(),
  snapshotId: z.coerce.number().int().positive().optional(),
});

const departmentsSchema = z.object({
  snapshotId: z.coerce.number().int().positive().optional(),
});

@Controller("directory")
export class DirectoryController {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(SettingsService) private readonly settings: SettingsService,
    @Inject(FeishuClient) private readonly client: FeishuClient,
  ) {}

  private resolveSnapshot(snapshotId?: number) {
    if (snapshotId) {
      const row = this.database.db.select().from(snapshots).where(eq(snapshots.id, snapshotId)).get();
      if (!row) throw notFound("快照不存在");
      return row;
    }
    const scope = this.settings.get("feishu.root-department-id") || "0";
    const row = this.database.db
      .select()
      .from(snapshots)
      .where(and(eq(snapshots.scopeRootDepartmentId, scope), eq(snapshots.status, "ok")))
      .orderBy(desc(snapshots.id))
      .limit(1)
      .get();
    if (!row) throw notFound("还没有可用的组织架构快照，请先执行一次巡查");
    return row;
  }

  @Get("snapshot")
  snapshot(@Query() query: unknown) {
    const parsed = parseWith(departmentsSchema, query);
    const snapshot = this.resolveSnapshot(parsed.snapshotId);
    return { snapshot };
  }

  @Get("departments")
  departments(@Query() query: unknown) {
    const parsed = parseWith(departmentsSchema, query);
    const snapshot = this.resolveSnapshot(parsed.snapshotId);
    const departments = this.database.db
      .select()
      .from(snapshotDepartments)
      .where(eq(snapshotDepartments.snapshotId, snapshot.id))
      .all();
    const peopleRows = this.database.db
      .select({
        openId: snapshotPeople.openId,
        name: snapshotPeople.name,
        email: snapshotPeople.email,
        enterpriseEmail: snapshotPeople.enterpriseEmail,
        jobTitle: snapshotPeople.jobTitle,
        avatarUrl: snapshotPeople.avatarUrl,
        status: snapshotPeople.status,
      })
      .from(snapshotPeople)
      .where(eq(snapshotPeople.snapshotId, snapshot.id))
      .all();
    const personById = new Map(peopleRows.map((row) => [row.openId, row]));
    const memberRows = this.database.db
      .select({
        departmentId: snapshotMemberships.openDepartmentId,
        openId: snapshotMemberships.openId,
      })
      .from(snapshotMemberships)
      .where(eq(snapshotMemberships.snapshotId, snapshot.id))
      .all();
    const directMembers = new Map<string, Set<string>>();
    for (const row of memberRows) {
      const set = directMembers.get(row.departmentId) ?? new Set<string>();
      set.add(row.openId);
      directMembers.set(row.departmentId, set);
    }
    const children = new Map<string, string[]>();
    for (const row of departments) {
      const list = children.get(row.parentOpenDepartmentId) ?? [];
      list.push(row.openDepartmentId);
      children.set(row.parentOpenDepartmentId, list);
    }
    const subtreeMembers = new Map<string, Set<string>>();
    const collect = (id: string, seen: Set<string>): Set<string> => {
      const cached = subtreeMembers.get(id);
      if (cached) return cached;
      if (seen.has(id)) return new Set();
      seen.add(id);
      const set = new Set(directMembers.get(id) ?? []);
      for (const child of children.get(id) ?? []) {
        for (const person of collect(child, seen)) set.add(person);
      }
      seen.delete(id);
      subtreeMembers.set(id, set);
      return set;
    };
    for (const row of departments) collect(row.openDepartmentId, new Set());
    return {
      snapshot,
      rootMemberCount: directMembers.get("0")?.size ?? 0,
      items: departments
        .map((row) => {
          const leaderOpenIds = row.leaderOpenIds
            ? (JSON.parse(row.leaderOpenIds) as string[])
            : row.leaderOpenId
              ? [row.leaderOpenId]
              : [];
          const subtree = subtreeMembers.get(row.openDepartmentId);
          const leaders = leaderOpenIds.map((openId) => {
            const profile = personById.get(openId);
            return {
              openId,
              name: profile?.name ?? openId,
              email: profile?.email ?? profile?.enterpriseEmail ?? null,
              jobTitle: profile?.jobTitle ?? null,
              avatarUrl: profile?.avatarUrl ?? null,
              status: profile?.status ?? "unknown",
              isMember: subtree?.has(openId) ?? false,
              isPrimary: openId === row.leaderOpenId,
            };
          });
          return {
            id: row.openDepartmentId,
            parentId: row.parentOpenDepartmentId,
            name: row.name,
            leaderOpenId: row.leaderOpenId,
            leaderOpenIds,
            leaders,
            leaderName: leaders[0]?.name ?? null,
            leaderEmail: leaders[0]?.email ?? null,
            leaderJobTitle: leaders[0]?.jobTitle ?? null,
            leaderAvatarUrl: leaders[0]?.avatarUrl ?? null,
            order: row.order,
            status: row.status,
            depth: row.depth,
            path: row.pathNames,
            directMemberCount: directMembers.get(row.openDepartmentId)?.size ?? 0,
            memberCount: subtree?.size ?? 0,
          };
        })
        .sort((a, b) => a.path.localeCompare(b.path, "zh-CN")),
    };
  }

  @Get("people")
  people(@Query() query: unknown) {
    const parsed = parseWith(peopleSchema, query);
    const snapshot = this.resolveSnapshot(parsed.snapshotId);
    const conditions = [eq(snapshotPeople.snapshotId, snapshot.id)];
    if (parsed.q) {
      const term = `%${parsed.q.trim()}%`;
      conditions.push(
        or(
          like(snapshotPeople.name, term),
          like(snapshotPeople.email, term),
          like(snapshotPeople.enterpriseEmail, term),
          like(snapshotPeople.employeeNo, term),
          like(snapshotPeople.jobTitle, term),
        )!,
      );
    }
    if (parsed.departmentId) {
      const departmentIds = [parsed.departmentId];
      if (parsed.direct !== "1") {
        const rows = this.database.db
          .select({
            id: snapshotDepartments.openDepartmentId,
            parentId: snapshotDepartments.parentOpenDepartmentId,
          })
          .from(snapshotDepartments)
          .where(eq(snapshotDepartments.snapshotId, snapshot.id))
          .all();
        const children = new Map<string, string[]>();
        for (const row of rows) {
          const list = children.get(row.parentId) ?? [];
          list.push(row.id);
          children.set(row.parentId, list);
        }
        const stack = [...departmentIds];
        const seen = new Set<string>();
        while (stack.length) {
          const id = stack.pop()!;
          if (seen.has(id)) continue;
          seen.add(id);
          departmentIds.push(...(children.get(id) ?? []));
          stack.push(...(children.get(id) ?? []));
        }
      }
      conditions.push(
        sql`exists (select 1 from snapshot_memberships m where m.snapshot_id = ${snapshot.id} and m.open_id = ${snapshotPeople.openId} and m.open_department_id in (${sql.join(departmentIds.map((id) => sql`${id}`), sql`, `)}))`,
      );
    }
    const where = and(...conditions);
    let leaderIds: string[] = [];
    if (parsed.departmentId) {
      const department = this.database.db
        .select({
          leaderOpenId: snapshotDepartments.leaderOpenId,
          leaderOpenIds: snapshotDepartments.leaderOpenIds,
        })
        .from(snapshotDepartments)
        .where(
          and(
            eq(snapshotDepartments.snapshotId, snapshot.id),
            eq(snapshotDepartments.openDepartmentId, parsed.departmentId),
          ),
        )
        .get();
      leaderIds = department?.leaderOpenIds
        ? (JSON.parse(department.leaderOpenIds) as string[])
        : department?.leaderOpenId
          ? [department.leaderOpenId]
          : [];
    }
    const orderBy = leaderIds.length
      ? [
          sql`case when ${snapshotPeople.openId} in (${sql.join(leaderIds.map((id) => sql`${id}`), sql`, `)}) then 0 else 1 end`,
          snapshotPeople.name,
        ]
      : [snapshotPeople.name];
    const rows = this.database.db
      .select()
      .from(snapshotPeople)
      .where(where)
      .orderBy(...orderBy)
      .limit(parsed.pageSize)
      .offset((parsed.page - 1) * parsed.pageSize)
      .all();
    const total = this.database.db
      .select({ count: sql<number>`count(*)` })
      .from(snapshotPeople)
      .where(where)
      .get();
    const openIds = rows.map((row) => row.openId);
    const memberships = openIds.length
      ? this.database.db
          .select()
          .from(snapshotMemberships)
          .where(
            and(
              eq(snapshotMemberships.snapshotId, snapshot.id),
              inArray(snapshotMemberships.openId, openIds),
            ),
          )
          .all()
      : [];
    const departmentIds = [...new Set(memberships.map((row) => row.openDepartmentId))];
    const departmentRows = departmentIds.length
      ? this.database.db
          .select()
          .from(snapshotDepartments)
          .where(
            and(
              eq(snapshotDepartments.snapshotId, snapshot.id),
              inArray(snapshotDepartments.openDepartmentId, departmentIds),
            ),
          )
          .all()
      : [];
    const pathById = new Map(departmentRows.map((row) => [row.openDepartmentId, row.pathNames]));
    const byPerson = new Map<string, string[]>();
    for (const row of memberships) {
      const list = byPerson.get(row.openId) ?? [];
      const path = pathById.get(row.openDepartmentId);
      if (path) list.push(path);
      byPerson.set(row.openId, list);
    }
    return {
      snapshot,
      total: Number(total?.count ?? 0),
      page: parsed.page,
      pageSize: parsed.pageSize,
      items: rows.map((row) => ({
        ...row,
        departmentPaths: (byPerson.get(row.openId) ?? []).sort(),
      })),
    };
  }

  @Get("people/:openId")
  person(@Param("openId") openId: string, @Query() query: unknown) {
    const parsed = parseWith(departmentsSchema, query);
    const snapshot = this.resolveSnapshot(parsed.snapshotId);
    const person = this.database.db
      .select()
      .from(snapshotPeople)
      .where(and(eq(snapshotPeople.snapshotId, snapshot.id), eq(snapshotPeople.openId, openId)))
      .get();
    if (!person) throw notFound("人员不存在或不在当前快照中");
    const memberships = this.database.db
      .select()
      .from(snapshotMemberships)
      .where(
        and(eq(snapshotMemberships.snapshotId, snapshot.id), eq(snapshotMemberships.openId, openId)),
      )
      .all();
    const departmentIds = memberships.map((row) => row.openDepartmentId);
    const departmentRows = departmentIds.length
      ? this.database.db
          .select()
          .from(snapshotDepartments)
          .where(
            and(
              eq(snapshotDepartments.snapshotId, snapshot.id),
              inArray(snapshotDepartments.openDepartmentId, departmentIds),
            ),
          )
          .all()
      : [];
    const history = this.database.db
      .select({
        change: changesTable,
        diffCreatedAt: diffs.createdAt,
        diffStatus: diffs.status,
        diffId: diffs.id,
      })
      .from(changesTable)
      .innerJoin(diffs, eq(diffs.id, changesTable.diffId))
      .where(eq(changesTable.entityKey, openId))
      .orderBy(desc(changesTable.id))
      .limit(20)
      .all();
    return {
      snapshot,
      person,
      departments: departmentRows.map((row) => ({
        id: row.openDepartmentId,
        name: row.name,
        path: row.pathNames,
      })),
      history: history.map((row) => ({
        ...row.change,
        diffCreatedAt: row.diffCreatedAt,
        diffStatus: row.diffStatus,
        diffId: row.diffId,
      })),
    };
  }

  @Get("chats")
  async chats() {
    try {
      return { items: await this.client.listChats(), warning: null };
    } catch (error) {
      return {
        items: [],
        warning: `无法读取机器人所在群：${(error as Error).message}。可手工填写 chat_id。`,
      };
    }
  }
}
