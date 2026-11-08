import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { get, post } from "../api";

export type Role = "admin" | "operator" | "viewer";

export type User = {
  id: number;
  username: string;
  displayName: string;
  email: string | null;
  role: Role;
  avatarUrl: string | null;
  feishuOpenId: string | null;
  feishuUnionId: string | null;
  source: string;
  hasPassword: boolean;
};

export type BootstrapStatus = {
  initialized: boolean;
  feishuLoginEnabled: boolean;
  siteName: string;
  copyright: string;
};

type SessionContextValue = {
  user: User | null;
  loading: boolean;
  refresh: () => Promise<void>;
  setUser: (user: User | null) => void;
  logout: () => Promise<void>;
};

const SessionContext = createContext<SessionContextValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const data = await get<{ user: User }>("/auth/me");
      setUser(data.user);
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const logout = useCallback(async () => {
    try {
      await post("/auth/logout");
    } finally {
      setUser(null);
    }
  }, []);

  const value = useMemo(() => ({ user, loading, refresh, setUser, logout }), [user, loading, refresh, logout]);
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionContextValue {
  const context = useContext(SessionContext);
  if (!context) throw new Error("useSession must be used inside SessionProvider");
  return context;
}

export type Meta = {
  build: string;
  updatedAt: string | null;
};

export function useMeta() {
  return useQuery({
    queryKey: ["meta"],
    queryFn: () => get<Meta>("/meta"),
    staleTime: 60_000,
    retry: false,
  });
}

export function useBootstrapStatus() {
  return useQuery({
    queryKey: ["bootstrap-status"],
    queryFn: () => get<BootstrapStatus>("/bootstrap/status"),
    staleTime: 30_000,
    retry: false,
  });
}

export const ROLE_LABELS: Record<Role, string> = {
  admin: "系统管理员",
  operator: "运营管理员",
  viewer: "普通账户",
};

export function canManage(user: User | null): boolean {
  return user?.role === "admin";
}

export function canOperate(user: User | null): boolean {
  return user?.role === "admin" || user?.role === "operator";
}
