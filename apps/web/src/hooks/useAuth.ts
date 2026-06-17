import { useAuthContext } from "@/contexts/AuthContext";

/** Convenience hook that returns the current authentication state and actions. */
export function useAuth() {
  return useAuthContext();
}
