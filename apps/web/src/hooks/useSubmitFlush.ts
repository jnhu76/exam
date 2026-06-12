import { useCallback, useEffect, useRef, useState } from "react";

const DEBOUNCE_MS = 1500;
const FLUSH_TIMEOUT_MS = 10_000;

export type SaveStatus = "idle" | "pending" | "inflight" | "saved" | "failed";

export interface FlushResult {
  pendingCount: number;
  failedQuestionIds: string[];
  timedOut: boolean;
}

interface PendingEntry {
  timer: ReturnType<typeof setTimeout>;
  save: () => Promise<void>;
}

export interface UseSubmitFlush {
  scheduleSave: (questionId: string, save: () => Promise<void>) => void;
  flush: () => Promise<FlushResult>;
  getQuestionStatus: (questionId: string) => SaveStatus;
  failedQuestionIds: string[];
}

export function useSubmitFlush(): UseSubmitFlush {
  const pendingRef = useRef(new Map<string, PendingEntry>());
  const inflightRef = useRef(new Map<string, Promise<void>>());
  const statusRef = useRef(new Map<string, SaveStatus>());
  const mountedRef = useRef(true);
  const [failedQuestionIds, setFailedQuestionIds] = useState<string[]>([]);
  const [, forceTick] = useState(0);

  const tick = useCallback(() => {
    if (!mountedRef.current) return;
    forceTick((n) => n + 1);
  }, []);

  const setStatus = useCallback(
    (questionId: string, status: SaveStatus) => {
      statusRef.current.set(questionId, status);
      if (!mountedRef.current) return;
      if (status === "failed") {
        setFailedQuestionIds((prev) =>
          prev.includes(questionId) ? prev : [...prev, questionId],
        );
      } else {
        setFailedQuestionIds((prev) => prev.filter((id) => id !== questionId));
      }
      tick();
    },
    [tick],
  );

  const runSave = useCallback(
    (questionId: string, save: () => Promise<void>): Promise<void> => {
      setStatus(questionId, "inflight");
      const promise = save()
        .then(() => {
          setStatus(questionId, "saved");
        })
        .catch(() => {
          setStatus(questionId, "failed");
        })
        .finally(() => {
          inflightRef.current.delete(questionId);
        });
      inflightRef.current.set(questionId, promise);
      return promise;
    },
    [setStatus],
  );

  const drainPending = useCallback(() => {
    for (const [questionId, entry] of pendingRef.current.entries()) {
      clearTimeout(entry.timer);
      pendingRef.current.delete(questionId);
      void runSave(questionId, entry.save);
    }
  }, [runSave]);

  const scheduleSave = useCallback(
    (questionId: string, save: () => Promise<void>) => {
      const existing = pendingRef.current.get(questionId);
      if (existing) clearTimeout(existing.timer);

      setStatus(questionId, "pending");

      const timer = setTimeout(() => {
        if (!mountedRef.current) return;
        pendingRef.current.delete(questionId);
        void runSave(questionId, save);
      }, DEBOUNCE_MS);

      pendingRef.current.set(questionId, { timer, save });
    },
    [runSave, setStatus],
  );

  const flush = useCallback(async (): Promise<FlushResult> => {
    const start = Date.now();
    let timedOut = false;

    while (true) {
      drainPending();

      if (inflightRef.current.size === 0 && pendingRef.current.size === 0) {
        break;
      }

      const remaining = FLUSH_TIMEOUT_MS - (Date.now() - start);
      if (remaining <= 0) {
        timedOut = true;
        break;
      }

      const inflightPromises = Array.from(inflightRef.current.values());
      const settledRound = Promise.allSettled(inflightPromises);
      const timeout = new Promise<"timeout">((resolve) => {
        setTimeout(() => resolve("timeout"), remaining);
      });

      const winner = await Promise.race([
        settledRound.then(() => "settled" as const),
        timeout,
      ]);

      if (winner === "timeout") {
        timedOut = true;
        break;
      }
    }

    const failed: string[] = [];
    let pendingCount = 0;
    const allTouchedIds = new Set<string>([
      ...statusRef.current.keys(),
      ...inflightRef.current.keys(),
      ...pendingRef.current.keys(),
    ]);
    for (const id of allTouchedIds) {
      const status = statusRef.current.get(id);
      if (status === "failed") {
        failed.push(id);
      } else if (status === "inflight" || status === "pending") {
        pendingCount += 1;
      }
    }

    return { pendingCount, failedQuestionIds: failed, timedOut };
  }, [drainPending]);

  const getQuestionStatus = useCallback(
    (questionId: string): SaveStatus =>
      statusRef.current.get(questionId) ?? "idle",
    [],
  );

  useEffect(() => {
    const pending = pendingRef.current;
    return () => {
      mountedRef.current = false;
      for (const entry of pending.values()) clearTimeout(entry.timer);
      pending.clear();
    };
  }, []);

  return { scheduleSave, flush, getQuestionStatus, failedQuestionIds };
}
