import axios from "axios";

export class ApiError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(message: string, code: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.status = status;
  }
}

export const api = axios.create({
  baseURL: "/api",
  withCredentials: true,
  timeout: 30_000,
  headers: { "X-Requested-With": "feishu-orgwatch" },
});

api.interceptors.response.use(
  (response) => response,
  (error: unknown) => {
    if (axios.isAxiosError(error)) {
      const body = error.response?.data as { error?: { code?: string; message?: string } } | undefined;
      return Promise.reject(
        new ApiError(
          body?.error?.message ?? (error.code === "ECONNABORTED" ? "请求超时，请稍后重试" : error.message),
          body?.error?.code ?? "NETWORK_ERROR",
          error.response?.status ?? 0,
        ),
      );
    }
    return Promise.reject(error);
  },
);

export async function get<T>(url: string, config?: Parameters<typeof api.get>[1]): Promise<T> {
  const response = await api.get<T>(url, config);
  return response.data;
}

export async function post<T>(url: string, body?: unknown): Promise<T> {
  const response = await api.post<T>(url, body ?? {});
  return response.data;
}

export async function patch<T>(url: string, body?: unknown): Promise<T> {
  const response = await api.patch<T>(url, body ?? {});
  return response.data;
}

export async function del<T>(url: string): Promise<T> {
  const response = await api.delete<T>(url);
  return response.data;
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

export function isUnauthorized(error: unknown): boolean {
  return error instanceof ApiError && error.status === 401;
}
