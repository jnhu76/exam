import { useState, useEffect } from "react";

/** Displays a countdown timer that fires onTimeout when the deadline is reached. */
export function ExamTimer({
  deadlineAt,
  onTimeout,
  serverOffsetMs = 0,
}: {
  deadlineAt: string;
  onTimeout: () => void;
  serverOffsetMs?: number;
}) {
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
      className={`flex h-8 items-center gap-2 rounded-[var(--admin-radius-sm)] border px-3 text-right ${isLow ? "border-destructive/30 bg-destructive/10 text-destructive" : "border-admin-border bg-card text-foreground"}`}
    >
      <span className="text-xs text-muted-foreground">剩余</span>
      <span className="font-mono text-sm font-bold tabular-nums">
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
