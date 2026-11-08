import * as cronParser from "cron-parser";
import { badRequest } from "../common/errors.js";

type AnyCron = {
  next: () => { toDate: () => Date };
};

function parse(expression: string, timezone: string, currentDate: Date): AnyCron {
  const module = cronParser as unknown as {
    CronExpressionParser?: { parse: (expression: string, options: unknown) => AnyCron };
    parser?: { parseExpression: (expression: string, options: unknown) => AnyCron };
  };
  if (!expression.trim()) throw badRequest("cron 表达式不能为空");
  try {
    if (module.CronExpressionParser) {
      return module.CronExpressionParser.parse(expression, { currentDate, tz: timezone });
    }
    if (module.parser) {
      return module.parser.parseExpression(expression, { currentDate, tz: timezone });
    }
  } catch (error) {
    throw badRequest(`cron 表达式无效：${(error as Error).message}`);
  }
  throw badRequest("当前运行时不支持 cron 解析，请检查依赖安装");
}

export function assertTimezone(timezone: string): string {
  const value = timezone.trim() || "Asia/Shanghai";
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format(new Date());
  } catch {
    throw badRequest(`时区无效：${value}`);
  }
  return value;
}

export function nextRuns(expression: string, timezone: string, from: Date, count: number): Date[] {
  const interval = parse(expression, assertTimezone(timezone), from);
  const result: Date[] = [];
  for (let index = 0; index < count; index += 1) {
    result.push(interval.next().toDate());
  }
  return result;
}

export function nextRun(expression: string, timezone: string, from: Date): Date {
  return nextRuns(expression, timezone, from, 1)[0] as Date;
}

export function validateCron(expression: string, timezone: string): { timezone: string; next: string[] } {
  const zone = assertTimezone(timezone);
  const runs = nextRuns(expression, zone, new Date(), 5);
  return { timezone: zone, next: runs.map((date) => date.toISOString()) };
}
