import { Inject, Injectable, Logger } from "@nestjs/common";
import { createHash, randomBytes, randomUUID, scryptSync, timingSafeEqual } from "node:crypto";
import { chmodSync, existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { and, desc, eq, gte, inArray, like, or, sql } from "drizzle-orm";
import { ConfigService } from "../config/config.service.js";
import { DatabaseService } from "../db/database.service.js";
import { loginAttempts, sessions, snapshotPeople, snapshots, users, type UserRow } from "../db/schema.js";
import { ApiError, badRequest, conflict, forbidden, tooManyRequests, unauthorized } from "../common/errors.js";
import { nowIso } from "../common/text.js";
import { SettingsService } from "../settings/settings.service.js";
import { AuditService } from "../audit/audit.service.js";

export type Role = "admin" | "operator" | "viewer";

export type SessionUser = {
  id: number;
  username: string;
  displayName: string;
  email: string | null;
  role: Role;
  avatarUrl: string | null;
  feishuOpenId: string | null;
  feishuUnionId: string | null;
};

export type FeishuProfile = {
  openId: string;
  unionId: string | null;
  userId: string | null;
  name: string;
  email: string | null;
  avatarUrl: string | null;
};

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const SESSION_TOUCH_MS = 5 * 60 * 1000;

export const SESSION_COOKIE = "feishu_orgwatch_session";

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    @Inject(ConfigService) private readonly config: ConfigService,
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(SettingsService) private readonly settings: SettingsService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {
    this.ensureDefaultAdmin();
  }

  private userCount(): number {
    const row = this.database.db.select({ count: sql<number>`count(*)` }).from(users).get();
    return Number(row?.count ?? 0);
  }

  isInitialized(): boolean {
    return this.userCount() > 0;
  }

  private get defaultAdminFile(): string {
    return path.join(this.config.runtimeDir, "default-admin.txt");
  }

  private removeBootstrapToken(): void {
    if (existsSync(this.config.tokenPath)) unlinkSync(this.config.tokenPath);
  }

  private writeDefaultAdminCredentials(username: string, password: string): void {
    const file = this.defaultAdminFile;
    writeFileSync(file, `username=${username}\npassword=${password}\n`, { mode: 0o600 });
    chmodSync(file, 0o600);
  }

  private removeDefaultAdminCredentials(username: string): void {
    const file = this.defaultAdminFile;
    if (!existsSync(file)) return;
    try {
      const content = readFileSync(file, "utf8");
      if (content.includes(`username=${username}\n`)) unlinkSync(file);
    } catch {
      // Best effort: a remaining credential file is still mode 0600.
    }
  }

  private ensureDefaultAdmin(): void {
    if (this.isInitialized()) {
      this.removeBootstrapToken();
      return;
    }
    const username = this.config.get("bootstrap.admin-username").trim() || "hawkon";
    const displayName = this.config.get("bootstrap.admin-display-name").trim() || "Hawkon";
    const configuredPassword = this.config.get("bootstrap.admin-password").trim();
    const generated = configuredPassword.length < 12 || configuredPassword.length > 256;
    const password = generated ? randomBytes(12).toString("base64url") : configuredPassword;
    const safeUsername = /^[A-Za-z0-9_.-]{3,32}$/.test(username) ? username : "hawkon";
    const inserted = this.database.db
      .insert(users)
      .values({
        username: safeUsername,
        displayName: displayName.slice(0, 64),
        passwordHash: this.hashPassword(password),
        role: "admin",
        source: "local",
        status: "active",
      })
      .run();
    const userId = Number(inserted.lastInsertRowid);
    this.audit.record({
      actorId: userId,
      actorName: displayName,
      action: "auth.bootstrap",
      targetType: "user",
      targetId: userId,
      detail: { source: "default", passwordGenerated: generated },
    });
    this.removeBootstrapToken();
    if (generated) {
      this.writeDefaultAdminCredentials(safeUsername, password);
      this.logger.warn(
        `已创建默认系统管理员 ${safeUsername}；随机初始密码见 ${this.defaultAdminFile}，请登录后立即修改`,
      );
    } else {
      this.logger.warn(`已创建默认系统管理员 ${safeUsername}，请登录后立即修改默认密码`);
    }
  }

  bootstrapStatus() {
    return {
      initialized: this.isInitialized(),
      feishuLoginEnabled: this.settings.feishuLoginEnabled(),
      siteName: this.config.siteName,
      copyright: this.config.copyright,
    };
  }

  hashPassword(password: string): string {
    this.assertPassword(password);
    const salt = randomBytes(16).toString("hex");
    const derived = scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1 });
    return `scrypt$${salt}$${derived.toString("hex")}`;
  }

  private assertPassword(password: string): void {
    if (typeof password !== "string" || password.length < 12 || password.length > 256) {
      throw badRequest("密码长度必须为 12–256 个字符");
    }
  }

  verifyPassword(password: string, encoded: string | null): boolean {
    if (!encoded) return false;
    const parts = encoded.split("$");
    if (parts.length !== 3 || parts[0] !== "scrypt") return false;
    const salt = parts[1] as string;
    const expected = Buffer.from(parts[2] as string, "hex");
    const actual = scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1 });
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  }

  private userRow(userId: number): UserRow {
    const row = this.database.db.select().from(users).where(eq(users.id, userId)).get();
    if (!row) throw unauthorized("账号不存在");
    return row;
  }

  private toSessionUser(row: UserRow): SessionUser {
    return {
      id: row.id,
      username: row.username,
      displayName: row.displayName,
      email: row.email,
      role: row.role,
      avatarUrl: row.avatarUrl,
      feishuOpenId: row.feishuOpenId,
      feishuUnionId: row.feishuUnionId,
    };
  }

  login(input: { username: string; password: string }, meta: { ip?: string; userAgent?: string }) {
    const username = input.username.trim();
    this.assertNotLocked(username, meta.ip);
    const row = this.database.db.select().from(users).where(eq(users.username, username)).get();
    const success = Boolean(row && row.passwordHash && this.verifyPassword(input.password, row.passwordHash));
    this.database.db
      .insert(loginAttempts)
      .values({ username, ip: meta.ip ?? null, success, createdAt: nowIso() })
      .run();
    if (!success || !row) {
      throw unauthorized("用户名或密码不正确");
    }
    if (row.status !== "active") throw forbidden("账号已被停用");
    this.database.db.update(users).set({ lastLoginAt: nowIso() }).where(eq(users.id, row.id)).run();
    const token = this.createSession(row.id, meta);
    this.audit.record({
      actorId: row.id,
      actorName: row.displayName,
      action: "auth.login",
      targetType: "user",
      targetId: row.id,
      ip: meta.ip,
      userAgent: meta.userAgent,
    });
    return { user: this.toSessionUser(row), token };
  }

  private assertNotLocked(username: string, ip: string | undefined): void {
    const since = new Date(Date.now() - 15 * 60 * 1000).toISOString();
    const row = this.database.db
      .select({ count: sql<number>`count(*)` })
      .from(loginAttempts)
      .where(
        and(
          eq(loginAttempts.username, username),
          eq(loginAttempts.success, false),
          gte(loginAttempts.createdAt, since),
          ip ? eq(loginAttempts.ip, ip) : undefined,
        ),
      )
      .get();
    if (Number(row?.count ?? 0) >= 5) {
      throw tooManyRequests("登录失败次数过多，请 15 分钟后再试");
    }
  }

  createSession(userId: number, meta: { ip?: string; userAgent?: string }): string {
    const token = randomBytes(32).toString("base64url");
    const tokenHash = createHash("sha256").update(token).digest("hex");
    const now = nowIso();
    this.database.db
      .insert(sessions)
      .values({
        id: randomUUID(),
        userId,
        tokenHash,
        expiresAt: new Date(Date.now() + SESSION_TTL_MS).toISOString(),
        ip: meta.ip ?? null,
        userAgent: meta.userAgent ?? null,
        lastSeenAt: now,
        createdAt: now,
      })
      .run();
    return token;
  }

  userFromToken(token: string | undefined): SessionUser | null {
    if (!token) return null;
    const tokenHash = createHash("sha256").update(token).digest("hex");
    const row = this.database.db
      .select({ session: sessions, user: users })
      .from(sessions)
      .innerJoin(users, eq(users.id, sessions.userId))
      .where(eq(sessions.tokenHash, tokenHash))
      .get();
    if (!row) return null;
    if (row.session.expiresAt <= nowIso()) {
      this.database.db.delete(sessions).where(eq(sessions.id, row.session.id)).run();
      return null;
    }
    if (row.user.status !== "active") return null;
    if (!row.session.lastSeenAt || Date.now() - Date.parse(row.session.lastSeenAt) > SESSION_TOUCH_MS) {
      this.database.db
        .update(sessions)
        .set({ lastSeenAt: nowIso() })
        .where(eq(sessions.id, row.session.id))
        .run();
    }
    return this.toSessionUser(row.user);
  }

  revokeToken(token: string | undefined): void {
    if (!token) return;
    const tokenHash = createHash("sha256").update(token).digest("hex");
    this.database.db.delete(sessions).where(eq(sessions.tokenHash, tokenHash)).run();
  }

  changePassword(userId: number, currentPassword: string, nextPassword: string): void {
    const row = this.userRow(userId);
    if (!row.passwordHash || !this.verifyPassword(currentPassword, row.passwordHash)) {
      throw badRequest("当前密码不正确");
    }
    this.assertPassword(nextPassword);
    this.database.db
      .update(users)
      .set({ passwordHash: this.hashPassword(nextPassword), updatedAt: nowIso() })
      .where(eq(users.id, userId))
      .run();
    this.database.db.delete(sessions).where(eq(sessions.userId, userId)).run();
    this.removeDefaultAdminCredentials(row.username);
    this.audit.record({
      actorId: userId,
      actorName: row.displayName,
      action: "auth.password_change",
      targetType: "user",
      targetId: userId,
    });
  }

  findOrCreateFeishuUser(profile: FeishuProfile): SessionUser {
    const existing = [
      profile.unionId
        ? this.database.db.select().from(users).where(eq(users.feishuUnionId, profile.unionId)).get()
        : undefined,
      this.database.db.select().from(users).where(eq(users.feishuOpenId, profile.openId)).get(),
      profile.email
        ? this.database.db
            .select()
            .from(users)
            .where(eq(sql`lower(${users.email})`, profile.email.toLowerCase()))
            .get()
        : undefined,
    ].find(Boolean);
    if (existing) {
      if (existing.status !== "active") throw forbidden("账号已被停用，请联系管理员");
      this.database.db
        .update(users)
        .set({
          feishuOpenId: existing.feishuOpenId ?? profile.openId,
          feishuUnionId: existing.feishuUnionId ?? profile.unionId,
          feishuUserId: existing.feishuUserId ?? profile.userId,
          avatarUrl: profile.avatarUrl ?? existing.avatarUrl,
          lastLoginAt: nowIso(),
          updatedAt: nowIso(),
        })
        .where(eq(users.id, existing.id))
        .run();
      return this.toSessionUser(this.userRow(existing.id));
    }
    if (!this.settings.allowAutoProvision(profile.email)) {
      throw forbidden("账号未开通，请联系管理员在用户管理中创建账号");
    }
    const inserted = this.database.db
      .insert(users)
      .values({
        username: `feishu_${profile.openId.slice(-12)}`,
        displayName: profile.name || profile.openId,
        email: profile.email,
        role: "viewer",
        feishuOpenId: profile.openId,
        feishuUnionId: profile.unionId,
        feishuUserId: profile.userId,
        avatarUrl: profile.avatarUrl,
        source: "feishu",
        status: "active",
        lastLoginAt: nowIso(),
      })
      .run();
    const userId = Number(inserted.lastInsertRowid);
    this.audit.record({
      actorId: userId,
      actorName: profile.name,
      action: "auth.feishu_provision",
      targetType: "user",
      targetId: userId,
    });
    return this.toSessionUser(this.userRow(userId));
  }

  listUsers(query: { page: number; pageSize: number; q?: string; role?: Role }) {
    const conditions = [];
    if (query.q) {
      const term = `%${query.q.trim()}%`;
      conditions.push(
        or(like(users.username, term), like(users.displayName, term), like(users.email, term))!,
      );
    }
    if (query.role) conditions.push(eq(users.role, query.role));
    const where = conditions.length ? and(...conditions) : undefined;
    const items = this.database.db
      .select({
        id: users.id,
        username: users.username,
        displayName: users.displayName,
        email: users.email,
        avatarUrl: users.avatarUrl,
        role: users.role,
        status: users.status,
        source: users.source,
        lastLoginAt: users.lastLoginAt,
        createdAt: users.createdAt,
      })
      .from(users)
      .where(where)
      .orderBy(desc(users.id))
      .limit(query.pageSize)
      .offset((query.page - 1) * query.pageSize)
      .all();
    const total = this.database.db
      .select({ count: sql<number>`count(*)` })
      .from(users)
      .where(where)
      .get();
    const stats = this.database.db
      .select({
        total: sql<number>`count(*)`,
        active: sql<number>`sum(case when ${users.status} = 'active' then 1 else 0 end)`,
        admins: sql<number>`sum(case when ${users.role} = 'admin' then 1 else 0 end)`,
        disabled: sql<number>`sum(case when ${users.status} = 'disabled' then 1 else 0 end)`,
      })
      .from(users)
      .get();
    return {
      items,
      total: Number(total?.count ?? 0),
      page: query.page,
      pageSize: query.pageSize,
      stats: {
        total: Number(stats?.total ?? 0),
        active: Number(stats?.active ?? 0),
        admins: Number(stats?.admins ?? 0),
        disabled: Number(stats?.disabled ?? 0),
      },
    };
  }

  feishuCandidates(q?: string) {
    const snapshot = this.database.db
      .select({ id: snapshots.id })
      .from(snapshots)
      .where(eq(snapshots.status, "ok"))
      .orderBy(desc(snapshots.id))
      .limit(1)
      .get();
    if (!snapshot) return { snapshot: null, items: [] };
    const conditions = [
      eq(snapshotPeople.snapshotId, snapshot.id),
      eq(snapshotPeople.status, "active"),
    ];
    if (q?.trim()) {
      const term = `%${q.trim()}%`;
      conditions.push(
        or(
          like(snapshotPeople.name, term),
          like(snapshotPeople.email, term),
          like(snapshotPeople.enterpriseEmail, term),
          like(snapshotPeople.employeeNo, term),
        )!,
      );
    }
    const people = this.database.db
      .select()
      .from(snapshotPeople)
      .where(and(...conditions))
      .orderBy(snapshotPeople.name)
      .limit(40)
      .all();
    const linkedRows = this.database.db
      .select({ username: users.username, email: users.email, feishuOpenId: users.feishuOpenId })
      .from(users)
      .all();
    const linkedOpenIds = new Set(linkedRows.map((row) => row.feishuOpenId).filter(Boolean));
    const linkedEmails = new Set(
      linkedRows.map((row) => row.email?.trim().toLowerCase()).filter((value): value is string => Boolean(value)),
    );
    const linkedByName = new Map(
      linkedRows
        .filter((row) => row.feishuOpenId && row.username)
        .map((row) => [row.feishuOpenId!, row.username]),
    );
    return {
      snapshot,
      items: people.map((person) => {
        const email = person.email ?? person.enterpriseEmail;
        const normalizedEmail = email?.trim().toLowerCase();
        const importedByOpenId = linkedOpenIds.has(person.openId);
        const importedByEmail = normalizedEmail ? linkedEmails.has(normalizedEmail) : false;
        return {
          openId: person.openId,
          name: person.name,
          email,
          jobTitle: person.jobTitle,
          avatarUrl: person.avatarUrl,
          status: person.status,
          imported: importedByOpenId || importedByEmail,
          linkedUsername: importedByOpenId ? linkedByName.get(person.openId) ?? null : null,
        };
      }),
    };
  }

  importFeishuUsers(openIds: string[], role: Role) {
    const uniqueIds = [...new Set(openIds)].slice(0, 50);
    if (!uniqueIds.length) throw badRequest("请选择要导入的成员");
    const snapshot = this.database.db
      .select({ id: snapshots.id })
      .from(snapshots)
      .where(eq(snapshots.status, "ok"))
      .orderBy(desc(snapshots.id))
      .limit(1)
      .get();
    if (!snapshot) throw badRequest("还没有可用的组织架构快照，请先执行一次巡查");
    const people = this.database.db
      .select()
      .from(snapshotPeople)
      .where(
        and(
          eq(snapshotPeople.snapshotId, snapshot.id),
          inArray(snapshotPeople.openId, uniqueIds),
          eq(snapshotPeople.status, "active"),
        ),
      )
      .all();
    const existing = this.database.db.select().from(users).all();
    const existingOpenIds = new Set(existing.map((row) => row.feishuOpenId).filter(Boolean));
    const existingEmails = new Set(
      existing.map((row) => row.email?.trim().toLowerCase()).filter((value): value is string => Boolean(value)),
    );
    const existingUsernames = new Set(existing.map((row) => row.username));
    const created: Array<{ id: number; username: string; displayName: string }> = [];
    const skipped: Array<{ name: string; reason: string }> = [];

    this.database.transaction(() => {
      for (const person of people) {
        const email = person.email ?? person.enterpriseEmail;
        const normalizedEmail = email?.trim().toLowerCase() ?? null;
        if (existingOpenIds.has(person.openId)) {
          skipped.push({ name: person.name, reason: "飞书账号已导入" });
          continue;
        }
        if (normalizedEmail && existingEmails.has(normalizedEmail)) {
          skipped.push({ name: person.name, reason: "邮箱已存在" });
          continue;
        }
        const base = this.uniqueUsername(person, existingUsernames);
        const inserted = this.database.db
          .insert(users)
          .values({
            username: base,
            displayName: person.name,
            email,
            role,
            passwordHash: null,
            feishuOpenId: person.openId,
            feishuUnionId: person.unionId,
            feishuUserId: person.userId,
            avatarUrl: person.avatarUrl,
            source: "feishu",
            status: "active",
          })
          .run();
        existingUsernames.add(base);
        if (normalizedEmail) existingEmails.add(normalizedEmail);
        existingOpenIds.add(person.openId);
        created.push({
          id: Number(inserted.lastInsertRowid),
          username: base,
          displayName: person.name,
        });
      }
    });
    return { created, skipped };
  }

  private uniqueUsername(
    person: { openId: string; email: string | null; enterpriseEmail: string | null; employeeNo: string | null },
    existing: Set<string>,
  ): string {
    const email = person.email ?? person.enterpriseEmail;
    const raw = (email?.split("@")[0] || person.employeeNo || `feishu-${person.openId.slice(-6)}`)
      .normalize("NFKC")
      .toLowerCase()
      .replace(/[^a-z0-9_.-]/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 28);
    const base = raw.length >= 3 ? raw : `u-${raw || person.openId.slice(-6)}`;
    let candidate = base;
    let suffix = 2;
    while (existing.has(candidate)) {
      candidate = `${base}-${suffix}`;
      suffix += 1;
    }
    return candidate;
  }

  createUser(input: {
    username: string;
    displayName: string;
    email?: string | null;
    role: Role;
    password: string;
  }) {
    if (!/^[A-Za-z0-9_.-]{3,32}$/.test(input.username)) {
      throw badRequest("用户名只能包含字母、数字、下划线、点和短横线，长度 3–32");
    }
    const exists = this.database.db.select().from(users).where(eq(users.username, input.username)).get();
    if (exists) throw conflict("用户名已存在");
    const inserted = this.database.db
      .insert(users)
      .values({
        username: input.username,
        displayName: input.displayName.trim() || input.username,
        email: input.email ?? null,
        role: input.role,
        passwordHash: this.hashPassword(input.password),
        source: "local",
        status: "active",
      })
      .run();
    return this.database.db
      .select({ id: users.id, username: users.username, displayName: users.displayName, role: users.role })
      .from(users)
      .where(eq(users.id, Number(inserted.lastInsertRowid)))
      .get();
  }

  updateUser(
    userId: number,
    patch: {
      displayName?: string;
      email?: string | null;
      role?: Role;
      status?: "active" | "disabled";
    },
  ) {
    const row = this.userRow(userId);
    const update: Partial<typeof users.$inferInsert> = { updatedAt: nowIso() };
    if (patch.displayName !== undefined) update.displayName = patch.displayName.trim();
    if (patch.email !== undefined) update.email = patch.email?.trim() || null;
    if (patch.role) update.role = patch.role;
    if (patch.status) update.status = patch.status;
    this.database.db.update(users).set(update).where(eq(users.id, userId)).run();
    if (patch.status === "disabled") {
      this.database.db.delete(sessions).where(eq(sessions.userId, userId)).run();
    }
    return this.database.db
      .select({
        id: users.id,
        username: users.username,
        displayName: users.displayName,
        email: users.email,
        avatarUrl: users.avatarUrl,
        role: users.role,
        status: users.status,
        source: users.source,
        lastLoginAt: users.lastLoginAt,
        createdAt: users.createdAt,
      })
      .from(users)
      .where(eq(users.id, row.id))
      .get();
  }

  deleteUser(userId: number, actorId: number): void {
    const row = this.userRow(userId);
    if (row.id === actorId) throw badRequest("不能删除当前登录账号");
    if (row.role === "admin") {
      const admins = this.database.db
        .select({ count: sql<number>`count(*)` })
        .from(users)
        .where(eq(users.role, "admin"))
        .get();
      if (Number(admins?.count ?? 0) <= 1) throw badRequest("至少需要保留一个管理员");
    }
    this.database.db.delete(sessions).where(eq(sessions.userId, userId)).run();
    this.database.db.delete(users).where(eq(users.id, userId)).run();
  }

  resetPassword(userId: number, password?: string): { password: string } {
    this.userRow(userId);
    const next = password && password.length ? password : randomBytes(9).toString("base64url");
    this.assertPassword(next);
    this.database.db
      .update(users)
      .set({ passwordHash: this.hashPassword(next), updatedAt: nowIso() })
      .where(eq(users.id, userId))
      .run();
    this.database.db.delete(sessions).where(eq(sessions.userId, userId)).run();
    return { password: next };
  }

  requireRole(user: SessionUser, roles: Role[]): void {
    if (user.role === "admin") return;
    if (!roles.includes(user.role)) throw forbidden();
  }

  assertInitialized(): void {
    if (!this.isInitialized()) {
      throw new ApiError(428, "SETUP_REQUIRED", "系统尚未初始化，请先完成管理员设置");
    }
  }
}
