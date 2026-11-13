import {
  createContext,
  useCallback,
  useContext,
  useLayoutEffect,
  useRef,
  type ReactNode,
  type RefObject,
} from "react";
import { useNavigate } from "react-router";

/**
 * Shell-level leave guard (#971 F-01).
 *
 * The candidate shell (ExamLayout) owns the Exam-controlled exits from the
 * take page: the exam-list NavLink, the account-settings item, the logout
 * item, and notification navigation. The ACTIVE take page registers a
 * {@link LeaveGuard} through this context; the shell consults it BEFORE any
 * exit navigation. The guard runs the page's own save contract (the existing
 * per-question serial save queue + flush) and only lets the navigation
 * proceed once the server has confirmed the edits — or after the candidate
 * explicitly confirmed abandoning them.
 *
 * Router note: the app uses `BrowserRouter`, whose mode has no data-router
 * blocker (`useBlocker` requires `createBrowserRouter`/`RouterProvider`).
 * This seam covers the Exam-controlled exits; native Back/Forward and hard
 * unload are NOT Exam-controlled under the current routing and are a
 * documented tradeoff (crash/hard-refresh persistence is #827).
 */

/** The active page's answer to "may the shell navigate away right now?". */
export interface LeaveGuard {
  /**
   * Resolves true when navigation may proceed. Resolves false to keep the
   * candidate on the page (save failed/timed out and the candidate chose to
   * stay, or another in-flight flow owns the page's next location).
   */
  confirmLeave: () => Promise<boolean>;
}

const LeaveGuardContext = createContext<RefObject<LeaveGuard | null> | null>(
  null,
);

/**
 * Provided by the candidate shell. Admin pages render without it: consumers
 * there get a passthrough (no guard registered → navigate directly).
 */
export function LeaveGuardProvider({ children }: { children: ReactNode }) {
  const guardRef = useRef<LeaveGuard | null>(null);
  return (
    <LeaveGuardContext.Provider value={guardRef}>
      {children}
    </LeaveGuardContext.Provider>
  );
}

/**
 * Registers the calling page as the shell's leave guard. The handler is kept
 * in a ref updated on every render; the shell always reaches the LATEST
 * handler through a stable proxy registered once (layout effect, so the
 * guard exists before paint — an exit click can never observe a paint window
 * without it).
 */
export function useRegisterLeaveGuard(guard: LeaveGuard | null): void {
  const guardRef = useContext(LeaveGuardContext);
  const guardValueRef = useRef<LeaveGuard | null>(guard);
  guardValueRef.current = guard;
  const stableRef = useRef<LeaveGuard | null>(null);
  if (stableRef.current === null) {
    stableRef.current = {
      confirmLeave: () =>
        guardValueRef.current?.confirmLeave() ?? Promise.resolve(true),
    };
  }
  useLayoutEffect(() => {
    if (!guardRef) return;
    guardRef.current = stableRef.current;
    return () => {
      guardRef.current = null;
    };
  }, [guardRef]);
}

/**
 * The shell's guarded-exit seam. Resolves after the guard allows the exit;
 * never navigates when the guard declines. Outside a provider (admin
 * shell), it navigates directly.
 */
export function useGuardedExit(): (to: string) => Promise<void> {
  const confirmLeave = useConfirmLeave();
  const navigate = useNavigate();
  return useCallback(
    async (to: string) => {
      if (!(await confirmLeave())) return;
      navigate(to);
    },
    [confirmLeave, navigate],
  );
}

/**
 * The guard query WITHOUT navigation — for exits whose own command performs
 * the navigation (logout navigates to /login itself). Outside a provider it
 * always allows the exit.
 */
export function useConfirmLeave(): () => Promise<boolean> {
  const guardRef = useContext(LeaveGuardContext);
  return useCallback(async () => {
    const guard = guardRef?.current ?? null;
    if (!guard) return true;
    return guard.confirmLeave();
  }, [guardRef]);
}
