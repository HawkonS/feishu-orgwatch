import { Inject, Controller, Get, Query } from "@nestjs/common";
import { z } from "zod";
import { AuditService } from "./audit.service.js";
import { Roles } from "../auth/auth.guard.js";
import { pageQuerySchema, parseWith } from "../common/validation.js";

const querySchema = pageQuerySchema.extend({
  action: z.string().max(64).optional(),
  actor: z.string().max(64).optional(),
  from: z.string().optional(),
  to: z.string().optional(),
});

@Controller("audit")
@Roles("admin")
export class AuditController {
  constructor(@Inject(AuditService) private readonly audit: AuditService) {}

  @Get()
  list(@Query() query: unknown) {
    const parsed = parseWith(querySchema, query);
    return this.audit.list(parsed);
  }
}
