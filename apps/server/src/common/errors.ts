export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const badRequest = (message: string, details?: unknown) =>
  new ApiError(400, "BAD_REQUEST", message, details);

export const unauthorized = (message = "请先登录") =>
  new ApiError(401, "UNAUTHORIZED", message);

export const forbidden = (message = "没有权限执行该操作") =>
  new ApiError(403, "FORBIDDEN", message);

export const notFound = (message = "资源不存在") =>
  new ApiError(404, "NOT_FOUND", message);

export const conflict = (message: string) =>
  new ApiError(409, "CONFLICT", message);

export const tooManyRequests = (message: string) =>
  new ApiError(429, "TOO_MANY_REQUESTS", message);

export const setupRequired = () =>
  new ApiError(428, "SETUP_REQUIRED", "系统尚未初始化，请先完成管理员设置");

export type ErrorBody = {
  error: { code: string; message: string; details?: unknown };
};
