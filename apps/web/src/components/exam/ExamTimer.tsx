import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

/**
 * Displays a countdown timer that fires onTimeout when the deadline passes.
 *
 * Single-line h-9 chip (#675): shares the Button system's control geometry
 * with the adjacent save indicator and submit button in the take-page
 * topbar, so the row renders at one consistent height.
 *
 * INVARIANT (ADR-006/ADR-026): display rounding and expiry detection are
 * separate concerns. The MM:SS value floors the remaining time, so a
 * sub-second remainder legitimately displays 00:00 BEFORE the deadline; that
 * display value must never drive onTimeout. Expiry compares the UNROUNDED
 * server-adjusted time difference (adjustedNow >= deadlineAt, matching the
 * server's strict deadline comparison), and onTimeout reports each deadlineAt
 * value at most once per mount lifetime — across interval re-binds from
 * onTimeout/serverOffsetMs updates, piled-up or throttled background ticks,
 * and StrictMode double-mounts. The parent's deadline episode guard remains
 * the cross-trigger convergence point; this component only guarantees it
 * never manufactures a duplicate or a premature report.
 */
export function ExamTimer({
  deadlineAt,
  onTimeout,
  serverOffsetMs = 0,
}: {
  deadlineAt: string;
  onTimeout: () => void;
  serverOffsetMs?: number;
}) {
  const { t } = useTranslation();
  const deadlineMs = useMemo(
    () => new Date(deadlineAt).getTime(),
    [deadlineAt],
  );
  const [displaySeconds, setDisplaySeconds] = useState(() =>
    toDisplaySeconds(remainingMs(deadlineMs, serverOffsetMs)),
  );
  // The deadline value this component has already reported as expired.
  // Keyed by the deadline timestamp (not a boolean) so a changed deadlineAt
  // re-arms naturally, while an identity-only re-bind of the same deadline
  // cannot re-fire it.
  const reportedDeadlineRef = useRef<number | null>(null);

  useEffect(() => {
    // Immediate check on every (re)bind: covers mount-when-expired, a
    // deadline/offset change that flips expiry, and the first tick after a
    // throttled background-tab restore — without waiting a full interval.
    const check = () => {
      const diff = remainingMs(deadlineMs, serverOffsetMs);
      setDisplaySeconds(toDisplaySeconds(diff));
      // INVARIANT: expiry uses the unrounded difference. A tick landing at
      // D−500ms displays 00:00 (floored) and must NOT fire.
      if (diff <= 0 && reportedDeadlineRef.current !== deadlineMs) {
        reportedDeadlineRef.current = deadlineMs;
        onTimeout();
      }
    };
    check();
    const interval = setInterval(check, 1000);
    return () => clearInterval(interval);
  }, [deadlineMs, onTimeout, serverOffsetMs]);

  const minutes = Math.floor(displaySeconds / 60);
  const seconds = displaySeconds % 60;
  const isLow = displaySeconds <= 300;

  return (
    <div
      role="timer"
      aria-label={t("candidateRuntime.timer.remaining")}
      className={`inline-flex h-9 items-center gap-1.5 rounded-md border px-3 ${isLow ? "border-destructive/30 bg-destructive/10 text-destructive" : "border-border bg-card text-foreground"}`}
    >
      <span className="type-metadata">
        {t("candidateRuntime.timer.remaining")}
      </span>
      <span className="type-numeric font-mono text-sm font-medium">
        {String(minutes).padStart(2, "0")}:{String(seconds).padStart(2, "0")}
      </span>
    </div>
  );
}

/** Unrounded server-adjusted time remaining before the deadline, in ms. */
function remainingMs(deadlineMs: number, serverOffsetMs: number): number {
  return deadlineMs - (Date.now() + serverOffsetMs);
}

/** Display projection of a raw ms remainder: floors, clamped at zero. */
function toDisplaySeconds(diffMs: number): number {
  if (diffMs <= 0) return 0;
  return Math.floor(diffMs / 1000);
}
