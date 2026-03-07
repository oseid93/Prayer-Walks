import React, { createContext, useContext, useState, useEffect, useCallback } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/query-client";

interface AuthUser {
  id: string;
  username: string;
  displayName: string;
}

interface AuthContextType {
  user: AuthUser | null;
  isLoading: boolean;
  isNewUser: boolean;
  setIsNewUser: (val: boolean) => void;
  login: (username: string, password: string) => Promise<void>;
  register: (username: string, password: string, displayName: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isNewUser, setIsNewUser] = useState(false);

  const { data, isLoading } = useQuery<AuthUser | null>({
    queryKey: ["/api/auth/me"],
    retry: false,
    staleTime: Infinity,
  });

  useEffect(() => {
    if (data) {
      setUser(data);
    }
  }, [data]);

  const login = useCallback(async (username: string, password: string) => {
    const res = await apiRequest("POST", "/api/auth/login", { username, password });
    const userData = await res.json();
    setUser(userData);
    queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
  }, []);

  const register = useCallback(async (username: string, password: string, displayName: string) => {
    const res = await apiRequest("POST", "/api/auth/register", { username, password, displayName });
    const userData = await res.json();
    setUser(userData);
    setIsNewUser(true);
    queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
  }, []);

  const logout = useCallback(async () => {
    await apiRequest("POST", "/api/auth/logout");
    setUser(null);
    setIsNewUser(false);
    queryClient.clear();
  }, []);

  return (
    <AuthContext.Provider value={{ user, isLoading, isNewUser, setIsNewUser, login, register, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within AuthProvider");
  }
  return context;
}
