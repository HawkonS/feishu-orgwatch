import { z } from "zod";
import { badRequest } from "./errors.js";

export function parseWith<T extends z.ZodTypeAny>(schema: T, value: unknown): z.infer<T> {
  const result = schema.safeParse(value);
  if (!result.success) {
    const issue = result.error.issues[0];
    const path = issue?.path.length ? issue.path.join(".") : "body";
    throw badRequest(`${path}: ${issue?.message ?? "参数不合法"}`, result.error.flatten());
  }
  return result.data;
}

export const pageQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(500).default(50),
});

export type PageQuery = z.infer<typeof pageQuerySchema>;

export type Paged<T> = {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
};

export function paged<T>(items: T[], total: number, query: PageQuery): Paged<T> {
  return { items, total, page: query.page, pageSize: query.pageSize };
}

export function offsetOf(query: PageQuery): number {
  return (query.page - 1) * query.pageSize;
}
