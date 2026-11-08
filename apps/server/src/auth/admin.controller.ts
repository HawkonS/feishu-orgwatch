import { Inject, Body, Controller, Delete, Get, Param, ParseIntPipe, Patch, Post, Query } from "@nestjs/common";
import { z } from "zod";
import { AuthService, type Role, type SessionUser } from "../auth/auth.service.js";
import { CurrentUser, Roles } from "../auth/auth.guard.js";
import { badRequest } from "../common/errors.js";
import { pageQuerySchema, parseWith } from "../common/validation.js";
import { AuditService } from "../audit/audit.service.js";

const roleSchema = z.enum(["admin", "operator", "viewer"]);

const createSchema = z.object({
  username: z.string().min(3).max(32),
  displayName: z.string().min(1).max(64),
  email: z.string().email().max(200).optional().nullable(),
  role: roleSchema.default("viewer"),
  password: z.string().min(12).max(256),
});

const patchSchema = z.object({
  displayName: z.string().min(1).max(64).optional(),
  email: z.string().email().max(200).nullable().optional(),
  role: roleSchema.optional(),
  status: z.enum(["active", "disabled"]).optional(),
});

const listSchema = pageQuerySchema.extend({
  q: z.string().max(100).optional(),
  role: roleSchema.optional(),
});

const candidatesSchema = z.object({
  q: z.string().max(100).optional(),
});

const importSchema = z.object({
  openIds: z.array(z.string().min(1)).min(1).max(50),
  role: roleSchema.default("viewer"),
});

const resetSchema = z.object({
  password: z.string().min(12).max(256).optional(),
});

@Controller("admin")
@Roles("admin")
export class AdminController {
  constructor(
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  @Get("users")
  list(@Query() query: unknown) {
    const parsed = parseWith(listSchema, query);
    return this.auth.listUsers(parsed);
  }

  @Get("users/feishu-candidates")
  feishuCandidates(@Query() query: unknown) {
    const parsed = parseWith(candidatesSchema, query);
    return this.auth.feishuCandidates(parsed.q);
  }

  @Post("users/import")
  importFeishu(@CurrentUser() actor: SessionUser, @Body() body: unknown) {
    const input = parseWith(importSchema, body);
    const result = this.auth.importFeishuUsers(input.openIds, input.role as Role);
    this.audit.record({
      actorId: actor.id,
      actorName: actor.displayName,
      action: "user.import",
      targetType: "user",
      targetId: null,
      detail: {
        role: input.role,
        created: result.created.length,
        skipped: result.skipped.length,
        usernames: result.created.map((user) => user.username),
      },
    });
    return result;
  }

  @Post("users")
  create(@CurrentUser() actor: SessionUser, @Body() body: unknown) {
    const input = parseWith(createSchema, body);
    const user = this.auth.createUser({ ...input, role: input.role as Role });
    this.audit.record({
      actorId: actor.id,
      actorName: actor.displayName,
      action: "user.create",
      targetType: "user",
      targetId: user?.id ?? null,
      detail: { username: input.username, role: input.role },
    });
    return { user };
  }

  @Patch("users/:id")
  update(
    @CurrentUser() actor: SessionUser,
    @Param("id", ParseIntPipe) id: number,
    @Body() body: unknown,
  ) {
    const patch = parseWith(patchSchema, body);
    if (id === actor.id && (patch.role || patch.status)) {
      throw badRequest("不能修改自己的角色或停用自己");
    }
    const user = this.auth.updateUser(id, patch);
    this.audit.record({
      actorId: actor.id,
      actorName: actor.displayName,
      action: "user.update",
      targetType: "user",
      targetId: id,
      detail: patch,
    });
    return { user };
  }

  @Delete("users/:id")
  remove(@CurrentUser() actor: SessionUser, @Param("id", ParseIntPipe) id: number) {
    this.auth.deleteUser(id, actor.id);
    this.audit.record({
      actorId: actor.id,
      actorName: actor.displayName,
      action: "user.delete",
      targetType: "user",
      targetId: id,
    });
    return { ok: true };
  }

  @Post("users/:id/reset-password")
  resetPassword(
    @CurrentUser() actor: SessionUser,
    @Param("id", ParseIntPipe) id: number,
    @Body() body: unknown,
  ) {
    const input = parseWith(resetSchema, body);
    const result = this.auth.resetPassword(id, input.password);
    this.audit.record({
      actorId: actor.id,
      actorName: actor.displayName,
      action: "user.reset_password",
      targetType: "user",
      targetId: id,
    });
    return result;
  }
}
