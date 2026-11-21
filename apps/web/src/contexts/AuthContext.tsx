import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type {
  LoginRequest,
  LoginResponse,
  MeResponse,
  UpdateProfileRequest,
} from "@exam/contracts";
import { useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import { api, setNavigate } from "@/lib/api";
import { defaultLandingPath } from "@/lib/capabilities";

/** User shape returned by the /api/auth/me endpoint. */
type SessionUser = MeResponse;

/** Public interface of the authentication context value. */
export interface AuthContextValue {
  user: SessionUser | null;
  isLoading: boolean;
  isRestoringSession: boolean;
  isSubmittingLogin: boolean;
  error: string | null;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  updateProfile: (name: string) => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

/**
 * Provides authentication state and actions (login, logout) to the
 * component tree. Optionally restores an existing session on mount.
 */
export function AuthProvider({
  children,
  initialUser = null,
  restoreSession = false,
}: {
  children: ReactNode;
  initialUser?: SessionUser | null;
  restoreSession?: boolean;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [user, setUser] = useState<SessionUser | null>(initialUser);
  const [isRestoringSession, setIsRestoringSession] = useState(
    restoreSession && !initialUser,
  );
  const [isSubmittingLogin, setIsSubmittingLogin] = useState(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isLoading = isRestoringSession || isSubmittingLogin || isLoggingOut;

  // Session generation: every commit that supersedes the anonymous restore
  // probe (login/logout success, effect teardown) bumps the epoch. A probe may
  // write user/restore state only while its captured epoch is still current
  // (R-WD-1, #1054). The abort withdraws the api layer's authority to redirect
  // on the superseded request's behalf.
  const sessionEpochRef = useRef(0);
  const restoreProbeAbortRef = useRef<AbortController | null>(null);

  function supersedeRestoreProbe() {
    sessionEpochRef.current += 1;
    restoreProbeAbortRef.current?.abort();
    restoreProbeAbortRef.current = null;
  }

  useEffect(() => {
    setNavigate(navigate);
    return () => setNavigate(() => {});
  }, [navigate]);

  useEffect(() => {
    if (!restoreSession || initialUser) return;
    const epoch = sessionEpochRef.current;
    const controller = new AbortController();
    restoreProbeAbortRef.current = controller;
    setIsRestoringSession(true);
    api
      .get<MeResponse>("/api/auth/me", { signal: controller.signal })
      .then((nextUser) => {
        if (sessionEpochRef.current === epoch) setUser(nextUser);
      })
      .catch(() => {
        if (sessionEpochRef.current === epoch) setUser(null);
      })
      .finally(() => {
        if (sessionEpochRef.current === epoch) setIsRestoringSession(false);
      });
    return () => {
      // Unmount or dependency change ends this probe's write eligibility too,
      // so a StrictMode double-invoke cannot let the first probe write.
      sessionEpochRef.current += 1;
      controller.abort();
      if (restoreProbeAbortRef.current === controller) {
        restoreProbeAbortRef.current = null;
      }
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
      supersedeRestoreProbe();
      setIsRestoringSession(false);
      setUser(nextUser);
      navigate(defaultLandingPath(nextUser));
    } catch (e) {
      setError(e instanceof Error ? e.message : t("auth.errors.loginFailed"));
    } finally {
      setIsSubmittingLogin(false);
    }
  }

  async function logout() {
    setIsLoggingOut(true);
    setError(null);
    try {
      await api.post<void>("/api/auth/logout");
      supersedeRestoreProbe();
      setIsRestoringSession(false);
      setUser(null);
      navigate("/login");
    } catch (e) {
      setError(e instanceof Error ? e.message : t("auth.errors.logoutFailed"));
    } finally {
      setIsLoggingOut(false);
    }
  }

  async function updateProfile(name: string) {
    setError(null);
    try {
      const updated = await api.patch<MeResponse, UpdateProfileRequest>(
        "/api/auth/me/profile",
        { name },
      );
      setUser(updated);
    } catch (e) {
      const message =
        e instanceof Error ? e.message : t("auth.errors.updateFailed");
      setError(message);
      throw e;
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
        updateProfile,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

/** Hook to access the auth context; must be used inside AuthProvider. */
export function useAuthContext(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within AuthProvider");
  }
  return context;
}
