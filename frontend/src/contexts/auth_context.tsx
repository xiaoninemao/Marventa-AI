"use client";

import { createContext, useContext, useState, useEffect, useCallback, useRef, type ReactNode } from "react";
import type { User, OrganizationDetails } from "@/types/auth";
import { login_user, register_user, verify_token, update_me, set_auth_token, clear_auth_token, fetch_organizations, create_organization, rename_organization, switch_organization } from "@/services/api_client";
import { apiError } from "@/i18n/errors";

interface AuthContextType {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, nickname?: string) => Promise<void>;
  logout: () => void;
  updateUser: (updates: { nickname?: string; avatar_url?: string }) => Promise<void>;
  organizations: OrganizationDetails[];
  organizationsLoading: boolean;
  organizationsError: string | null;
  organizationBusy: boolean;
  reloadOrganizations: () => void;
  createOrganization: (name: string) => Promise<void>;
  renameOrganization: (id: string, name: string) => Promise<void>;
  switchOrganization: (id: string) => Promise<void>;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, set_user] = useState<User | null>(null);
  const [loading, set_loading] = useState(true);
  const [organizations, setOrganizations] = useState<OrganizationDetails[]>([]);
  const [organizationsLoading, setOrganizationsLoading] = useState(false);
  const [organizationsError, setOrganizationsError] = useState<string | null>(null);
  const [organizationBusy, setOrganizationBusy] = useState(false);
  const [organizationRevision, setOrganizationRevision] = useState(0);
  const userIdRef = useRef<string | null>(null);
  const organizationMutationRef = useRef(false);
  const userId = user?.id;

  useEffect(() => {
    userIdRef.current = userId ?? null;
    if (!userId) {
      setOrganizations([]);
      setOrganizationsLoading(false);
      setOrganizationsError(null);
      return;
    }
    let active = true;
    setOrganizationsLoading(true);
    setOrganizationsError(null);
    fetch_organizations()
      .then((res) => {
        if (!res.success || !Array.isArray(res.data)) throw apiError(res.message || "Could not load organizations");
        if (active) setOrganizations(res.data);
      })
      .catch((error: unknown) => {
        if (active) setOrganizationsError(error instanceof Error ? error.message : "Could not load organizations");
      })
      .finally(() => { if (active) setOrganizationsLoading(false); });
    return () => { active = false; };
  }, [userId, organizationRevision]);

  const reloadOrganizations = useCallback(() => setOrganizationRevision((value) => value + 1), []);

  const mutateOrganization = useCallback(async (action: () => Promise<void>) => {
    if (organizationMutationRef.current) throw apiError("An organization update is already in progress");
    organizationMutationRef.current = true;
    setOrganizationBusy(true);
    try {
      await action();
    } finally {
      organizationMutationRef.current = false;
      setOrganizationBusy(false);
    }
  }, []);

  const createOrganization = useCallback(async (name: string) => {
    if (!userId) throw apiError("Unauthorized");
    await mutateOrganization(async () => {
      const res = await create_organization(name);
      if (!res.success || !res.data) throw apiError(res.message || "Could not create organization");
      if (userIdRef.current === userId) {
        setOrganizations((items) => [...items.filter((item) => item.id !== res.data.id), res.data]);
      }
    });
  }, [userId, mutateOrganization]);

  const renameOrganization = useCallback(async (id: string, name: string) => {
    if (!userId) throw apiError("Unauthorized");
    await mutateOrganization(async () => {
      const res = await rename_organization(id, name);
      if (!res.success || !res.data) throw apiError(res.message || "Could not rename organization");
      if (userIdRef.current === userId) {
        setOrganizations((items) => items.map((item) => item.id === id ? res.data : item));
        set_user((current) => current?.id === userId ? {
          ...current,
          default_organization: current.default_organization?.id === id ? res.data : current.default_organization,
          current_organization: current.current_organization?.id === id ? res.data : current.current_organization,
        } : current);
      }
    });
  }, [userId, mutateOrganization]);

  const switchOrganization = useCallback(async (id: string) => {
    if (!userId) throw apiError("Unauthorized");
    await mutateOrganization(async () => {
      const res = await switch_organization(id);
      if (!res.success || !res.data) throw apiError(res.message || "Could not switch organization");
      if (userIdRef.current === userId) {
        set_user((current) => current?.id === userId ? { ...current, current_organization: res.data } : current);
      }
    });
  }, [userId, mutateOrganization]);

  useEffect(() => {
    const token = localStorage.getItem("auth_token");
    if (!token) {
      set_loading(false);
      return;
    }
    set_auth_token(token);
    verify_token()
      .then((res) => {
        if (res.success && res.data) {
          userIdRef.current = res.data.id;
          set_user(res.data);
        } else {
          localStorage.removeItem("auth_token");
          clear_auth_token();
        }
      })
      .catch(() => {
        localStorage.removeItem("auth_token");
        clear_auth_token();
      })
      .finally(() => set_loading(false));
  }, []);

  const login = useCallback(async (login_str: string, password: string) => {
    const res = await login_user(login_str, password);
    if (!res.success || !res.data) {
      throw new Error(res.message || "Login failed");
    }
    localStorage.setItem("auth_token", res.data.access_token);
    set_auth_token(res.data.access_token);
    userIdRef.current = res.data.user.id;
    set_user(res.data.user);
  }, []);

  const register = useCallback(async (email: string, password: string, nickname = "") => {
    const res = await register_user(email, password, nickname);
    if (!res.success || !res.data) {
      throw new Error(res.message || "Registration failed");
    }
    localStorage.setItem("auth_token", res.data.access_token);
    set_auth_token(res.data.access_token);
    userIdRef.current = res.data.user.id;
    set_user(res.data.user);
  }, []);

  const logout = useCallback(() => {
    userIdRef.current = null;
    localStorage.removeItem("auth_token");
    clear_auth_token();
    set_user(null);
    // Don't call router.push here — each protected page's auth guard
    // handles redirect to / when user becomes null. Calling router.push
    // races with those guards (which use router.replace) and breaks navigation.
  }, []);

  const updateUser = useCallback(async (updates: { nickname?: string; avatar_url?: string }) => {
    const res = await update_me(updates);
    if (!res.success || !res.data) {
      throw new Error(res.message || "Update failed");
    }
    set_user(res.data);
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, login, register, logout, updateUser, organizations, organizationsLoading, organizationsError, organizationBusy, reloadOrganizations, createOrganization, renameOrganization, switchOrganization }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
