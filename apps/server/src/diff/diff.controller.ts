import { Inject, Body, Controller, Get, Param, ParseIntPipe, Post, Query, Res } from "@nestjs/common";
import type { FastifyReply } from "fastify";
import { z } from "zod";
import { DiffService } from "./diff.service.js";
import { InformService } from "../inform/inform.service.js";
import { CurrentUser, Roles } from "../auth/auth.guard.js";
import type { SessionUser } from "../auth/auth.service.js";
import { pageQuerySchema, parseWith } from "../common/validation.js";

const listSchema = pageQuerySchema.extend({
  from: z.string().optional(),
  to: z.string().optional(),
  status: z.enum(["new", "notified", "acknowledged", "ignored"]).optional(),
  severity: z.enum(["high", "medium", "low", "info"]).optional(),
  taskId: z.coerce.number().int().positive().optional(),
  entityType: z.enum(["person", "department"]).optional(),
  changeKind: z.string().max(64).optional(),
  departmentId: z.string().max(200).optional(),
  q: z.string().max(100).optional(),
});

const changesSchema = pageQuerySchema.extend({
  entityType: z.enum(["person", "department"]).optional(),
  changeKind: z.string().max(64).optional(),
  severity: z.enum(["high", "medium", "low", "info"]).optional(),
  q: z.string().max(100).optional(),
});

const informSchema = z.object({
  recipients: z
    .array(
      z.object({
        type: z.enum(["user", "chat"]),
        id: z.string().min(1).max(200),
        name: z.string().max(200).optional().nullable(),
      }),
    )
    .min(1)
    .max(200),
  note: z.string().max(500).optional().nullable(),
  changeIds: z.array(z.number().int().positive()).max(5000).optional(),
});

const resolveSchema = z.object({
  status: z.enum(["acknowledged", "ignored"]),
  reason: z.string().max(500).optional().nullable(),
});

const retrySchema = z.object({
  deliveryIds: z.array(z.number().int().positive()).max(200).optional(),
});

@Controller()
export class DiffController {
  constructor(
    @Inject(DiffService) private readonly diffs: DiffService,
    @Inject(InformService) private readonly informs: InformService,
  ) {}

  @Get("overview")
  overview() {
    return this.diffs.overview();
  }

  @Get("diffs")
  list(@Query() query: unknown) {
    const parsed = parseWith(listSchema, query);
    return this.diffs.list(parsed);
  }

  @Get("diffs/:id")
  detail(@Param("id", ParseIntPipe) id: number) {
    return this.diffs.detail(id);
  }

  @Get("diffs/:id/changes")
  changes(@Param("id", ParseIntPipe) id: number, @Query() query: unknown) {
    const parsed = parseWith(changesSchema, query);
    return this.diffs.changes(id, parsed);
  }

  @Get("diffs/:id/export.csv")
  @Roles("admin")
  exportCsv(@Param("id", ParseIntPipe) id: number, @Res() reply: FastifyReply) {
    const csv = this.diffs.exportCsv(id);
    return reply
      .header("content-type", "text/csv; charset=utf-8")
      .header("content-disposition", `attachment; filename="diff-${id}.csv"`)
      .send(`\uFEFF${csv}`);
  }

  @Post("diffs/:id/informs")
  @Roles("operator")
  inform(
    @CurrentUser() user: SessionUser,
    @Param("id", ParseIntPipe) id: number,
    @Body() body: unknown,
  ) {
    const input = parseWith(informSchema, body);
    return this.informs.inform(id, input, user);
  }

  @Get("diffs/:id/informs")
  listInforms(@Param("id", ParseIntPipe) id: number) {
    return this.informs.listInforms(id);
  }

  @Post("informs/:id/retry")
  @Roles("operator")
  retry(
    @CurrentUser() user: SessionUser,
    @Param("id", ParseIntPipe) id: number,
    @Body() body: unknown,
  ) {
    const input = parseWith(retrySchema, body);
    return this.informs.retry(id, input.deliveryIds, user);
  }

  @Post("diffs/:id/ack")
  ackSelf(@CurrentUser() user: SessionUser, @Param("id", ParseIntPipe) id: number) {
    return this.informs.ackSelf(id, user);
  }

  @Post("diffs/:id/deliveries/:deliveryId/ack")
  @Roles("operator")
  ackDelivery(
    @CurrentUser() user: SessionUser,
    @Param("deliveryId", ParseIntPipe) deliveryId: number,
  ) {
    return this.informs.ackDelivery(deliveryId, user);
  }

  @Post("diffs/:id/resolve")
  resolve(
    @CurrentUser() user: SessionUser,
    @Param("id", ParseIntPipe) id: number,
    @Body() body: unknown,
  ) {
    const input = parseWith(resolveSchema, body);
    return this.informs.resolve(id, input.status, input.reason ?? null, user);
  }
}
