import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import type { LoginRequest, LoginResponse, MeResponse } from "@exam/contracts";
import { useNavigate } from "react-router";
import { api, setNavigate } from "@/lib/api";

type SessionUser = MeResponse;

export interface AuthContextValue {
  user: SessionUser | null;
  isLoading: boolean;
  isRestoringSession: boolean;
  isSubmittingLogin: boolean;
  error: string | null;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function dashboardFor(user: SessionUser): string {
  return user.role === "Candidate" ? "/exam/list" : "/admin/dashboard";
}

export function AuthProvider({
  children,
  initialUser = null,
  restoreSession = false,
}: {
  children: ReactNode;
  initialUser?: SessionUser | null;
  restoreSession?: boolean;
}) {
  const navigate = useNavigate();
  const [user, setUser] = useState<SessionUser | null>(initialUser);
  const [isRestoringSession, setIsRestoringSession] = useState(
    restoreSession && !initialUser,
  );
  const [isSubmittingLogin, setIsSubmittingLogin] = useState(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isLoading = isRestoringSession || isSubmittingLogin || isLoggingOut;

  useEffect(() => {
    setNavigate(navigate);
    return () => setNavigate(() => {});
  }, [navigate]);

  useEffect(() => {
    if (!restoreSession || initialUser) return;
    let active = true;
    setIsRestoringSession(true);
    api
      .get<MeResponse>("/api/auth/me")
      .then((nextUser) => {
        if (active) setUser(nextUser);
      })
      .catch(() => {
        if (active) setUser(null);
      })
      .finally(() => {
        if (active) setIsRestoringSession(false);
      });
    return () => {
      active = false;
    };
  }, [initialUser, restoreSession]);

  async function login(username: string, password: string) {
    setIsSubmittingLogin(true);
    setError(null);
    try {
      const nextUser = await api.post<LoginResponse, LoginRequest>(
        "/api/auth/login",
        { username, password },
      );
      setUser(nextUser);
      navigate(dashboardFor(nextUser));
    } catch (e) {
      setError(e instanceof Error ? e.message : "登录失败");
    } finally {
      setIsSubmittingLogin(false);
    }
  }

  async function logout() {
    setIsLoggingOut(true);
    setError(null);
    try {
      await api.post<void>("/api/auth/logout");
      setUser(null);
      navigate("/login");
    } catch (e) {
      setError(e instanceof Error ? e.message : "退出失败");
    } finally {
      setIsLoggingOut(false);
    }
  }

  return (
    <AuthContext.Provider
      value={{
        user,
        isLoading,
        isRestoringSession,
        isSubmittingLogin,
        error,
        login,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuthContext(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within AuthProvider");
  }
  return context;
}
