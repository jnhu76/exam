import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";

/**
 * Displays a countdown timer that fires onTimeout when the deadline is reached.
 *
 * Single-line h-9 chip (#675): shares the Button system's control geometry
 * with the adjacent save indicator and submit button in the take-page
 * topbar, so the row renders at one consistent height.
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
  const [remaining, setRemaining] = useState(() =>
    getRemainingSeconds(deadlineAt, serverOffsetMs),
  );

  useEffect(() => {
    const interval = setInterval(() => {
      const seconds = getRemainingSeconds(deadlineAt, serverOffsetMs);
      setRemaining(seconds);
      if (seconds <= 0) {
        clearInterval(interval);
        onTimeout();
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [deadlineAt, onTimeout, serverOffsetMs]);

  const minutes = Math.floor(remaining / 60);
  const seconds = remaining % 60;
  const isLow = remaining <= 300;

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

/** Computes remaining seconds from a deadline ISO string to the server-adjusted now. */
function getRemainingSeconds(
  deadlineAt: string,
  serverOffsetMs: number,
): number {
  const diff = new Date(deadlineAt).getTime() - (Date.now() + serverOffsetMs);
  if (diff <= 0) return 0;
  return Math.floor(diff / 1000);
}
