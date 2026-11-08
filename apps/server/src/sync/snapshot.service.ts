import { Inject, Injectable } from "@nestjs/common";
import { and, desc, eq, inArray, lt, sql } from "drizzle-orm";
import { DatabaseService } from "../db/database.service.js";
import {
  diffs,
  snapshotDepartments,
  snapshotMemberships,
  snapshotPeople,
  snapshots,
} from "../db/schema.js";
import type { DeptNode, PersonNode, SnapshotData } from "./normalize.js";
import { nowIso } from "../common/text.js";

@Injectable()
export class SnapshotService {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  latestOk(scopeRootDepartmentId: string, beforeId?: number) {
    const conditions = [eq(snapshots.scopeRootDepartmentId, scopeRootDepartmentId), eq(snapshots.status, "ok")];
    if (beforeId !== undefined) conditions.push(lt(snapshots.id, beforeId));
    return this.database.db
      .select()
      .from(snapshots)
      .where(and(...conditions))
      .orderBy(desc(snapshots.id))
      .limit(1)
      .get();
  }

  get(snapshotId: number) {
    return this.database.db.select().from(snapshots).where(eq(snapshots.id, snapshotId)).get();
  }

  load(snapshotId: number): SnapshotData | null {
    const snapshot = this.get(snapshotId);
    if (!snapshot) return null;
    const departments = new Map<string, DeptNode>();
    const rows = this.database.db
      .select()
      .from(snapshotDepartments)
      .where(eq(snapshotDepartments.snapshotId, snapshotId))
      .all();
    for (const row of rows) {
      departments.set(row.openDepartmentId, {
        id: row.openDepartmentId,
        parentId: row.parentOpenDepartmentId,
        name: row.name,
        leaderOpenId: row.leaderOpenId,
        leaderOpenIds: row.leaderOpenIds
          ? (JSON.parse(row.leaderOpenIds) as string[])
          : row.leaderOpenId
            ? [row.leaderOpenId]
            : [],
        order: row.order,
        status: row.status,
        depth: row.depth,
        path: row.pathNames,
      });
    }
    const people = new Map<string, PersonNode>();
    const peopleRows = this.database.db
      .select()
      .from(snapshotPeople)
      .where(eq(snapshotPeople.snapshotId, snapshotId))
      .all();
    for (const row of peopleRows) {
      people.set(row.openId, {
        openId: row.openId,
        unionId: row.unionId,
        userId: row.userId,
        name: row.name,
        email: row.email,
        enterpriseEmail: row.enterpriseEmail,
        jobTitle: row.jobTitle,
        employeeNo: row.employeeNo,
        status: row.status,
        isResigned: row.isResigned,
        isFrozen: row.isFrozen,
        avatarUrl: row.avatarUrl,
        departmentIds: [],
      });
    }
    const membershipRows = this.database.db
      .select()
      .from(snapshotMemberships)
      .where(eq(snapshotMemberships.snapshotId, snapshotId))
      .all();
    for (const row of membershipRows) {
      const person = people.get(row.openId);
      if (person) person.departmentIds.push(row.openDepartmentId);
    }
    for (const person of people.values()) person.departmentIds.sort();
    return {
      rootDepartmentId: snapshot.scopeRootDepartmentId,
      departments,
      people,
      hash: snapshot.contentHash,
    };
  }

  create(
    runId: number,
    data: SnapshotData,
    status: "ok" | "quarantined",
  ): number {
    return this.database.transaction(() => {
      const inserted = this.database.db
        .insert(snapshots)
        .values({
          scopeRootDepartmentId: data.rootDepartmentId,
          runId,
          fetchedAt: nowIso(),
          contentHash: data.hash,
          departmentCount: data.departments.size,
          peopleCount: data.people.size,
          status,
        })
        .run();
      const snapshotId = Number(inserted.lastInsertRowid);

      const departmentRows = [...data.departments.values()].map((item) => ({
        snapshotId,
        openDepartmentId: item.id,
        parentOpenDepartmentId: item.parentId,
        name: item.name,
        leaderOpenId: item.leaderOpenId,
        leaderOpenIds: JSON.stringify(item.leaderOpenIds),
        order: item.order,
        status: item.status,
        depth: item.depth,
        pathNames: item.path,
      }));
      for (const chunk of chunked(departmentRows, 80)) {
        this.database.db.insert(snapshotDepartments).values(chunk).run();
      }

      const personRows = [...data.people.values()].map((item) => ({
        snapshotId,
        openId: item.openId,
        unionId: item.unionId,
        userId: item.userId,
        name: item.name,
        email: item.email,
        enterpriseEmail: item.enterpriseEmail,
        jobTitle: item.jobTitle,
        employeeNo: item.employeeNo,
        status: item.status,
        isResigned: item.isResigned,
        isFrozen: item.isFrozen,
        avatarUrl: item.avatarUrl,
      }));
      for (const chunk of chunked(personRows, 50)) {
        this.database.db.insert(snapshotPeople).values(chunk).run();
      }

      const membershipRows: Array<{
        snapshotId: number;
        openId: string;
        openDepartmentId: string;
      }> = [];
      for (const person of data.people.values()) {
        for (const departmentId of person.departmentIds) {
          membershipRows.push({
            snapshotId,
            openId: person.openId,
            openDepartmentId: departmentId,
          });
        }
      }
      for (const chunk of chunked(membershipRows, 300)) {
        this.database.db.insert(snapshotMemberships).values(chunk).run();
      }

      return snapshotId;
    });
  }

  setStatus(snapshotId: number, status: "ok" | "quarantined"): void {
    this.database.db.update(snapshots).set({ status }).where(eq(snapshots.id, snapshotId)).run();
  }

  prune(scopeRootDepartmentId: string, keepRuns: number, keepDays: number): number {
    const referenced = new Set<number>();
    for (const row of this.database.db
      .select({ fromSnapshotId: diffs.fromSnapshotId, toSnapshotId: diffs.toSnapshotId })
      .from(diffs)
      .where(eq(diffs.scopeRootDepartmentId, scopeRootDepartmentId))
      .all()) {
      if (row.fromSnapshotId) referenced.add(row.fromSnapshotId);
      if (row.toSnapshotId) referenced.add(row.toSnapshotId);
    }
    const keep = new Set<number>(referenced);
    const recent = this.database.db
      .select({ id: snapshots.id })
      .from(snapshots)
      .where(and(eq(snapshots.scopeRootDepartmentId, scopeRootDepartmentId), eq(snapshots.status, "ok")))
      .orderBy(desc(snapshots.id))
      .limit(Math.max(2, keepRuns))
      .all();
    for (const row of recent) keep.add(row.id);
    const latest = this.database.db
      .select({ id: snapshots.id })
      .from(snapshots)
      .where(eq(snapshots.scopeRootDepartmentId, scopeRootDepartmentId))
      .orderBy(desc(snapshots.id))
      .limit(1)
      .get();
    if (latest) keep.add(latest.id);

    const cutoff = new Date(Date.now() - Math.max(1, keepDays) * 24 * 60 * 60 * 1000).toISOString();
    const candidates = this.database.db
      .select({ id: snapshots.id })
      .from(snapshots)
      .where(and(eq(snapshots.scopeRootDepartmentId, scopeRootDepartmentId), lt(snapshots.createdAt, cutoff)))
      .all()
      .map((row) => row.id)
      .filter((id) => !keep.has(id));
    if (!candidates.length) return 0;
    let removed = 0;
    for (const chunk of chunked(candidates, 200)) {
      const result = this.database.db.delete(snapshots).where(inArray(snapshots.id, chunk)).run();
      removed += Number(result.changes);
    }
    return removed;
  }

  counts(): { snapshots: number } {
    const row = this.database.db.select({ count: sql<number>`count(*)` }).from(snapshots).get();
    return { snapshots: Number(row?.count ?? 0) };
  }
}

function chunked<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}
