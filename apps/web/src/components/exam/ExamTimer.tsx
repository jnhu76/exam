import { useState, useEffect } from "react";

/** Displays a countdown timer that fires onTimeout when the deadline is reached. */
export function ExamTimer({
  deadlineAt,
  onTimeout,
}: {
  deadlineAt: string;
  onTimeout: () => void;
}) {
  const [remaining, setRemaining] = useState(() =>
    getRemainingSeconds(deadlineAt),
  );

  useEffect(() => {
    const interval = setInterval(() => {
      const seconds = getRemainingSeconds(deadlineAt);
      setRemaining(seconds);
      if (seconds <= 0) {
        clearInterval(interval);
        onTimeout();
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [deadlineAt, onTimeout]);

  const minutes = Math.floor(remaining / 60);
  const seconds = remaining % 60;
  const isLow = remaining <= 300;

  return (
    <div
      className={`rounded-md border px-3 py-1.5 text-right ${isLow ? "border-destructive/30 bg-destructive/10 text-destructive" : "border-border bg-card text-foreground"}`}
    >
      <div className="text-[11px] font-medium leading-none text-muted-foreground">
        剩余时间
      </div>
      <span className="font-mono text-xl font-bold leading-tight tabular-nums">
        {String(minutes).padStart(2, "0")}:{String(seconds).padStart(2, "0")}
      </span>
    </div>
  );
}

/** Computes remaining seconds from a deadline ISO string to now. */
function getRemainingSeconds(deadlineAt: string): number {
  const diff = new Date(deadlineAt).getTime() - Date.now();
  if (diff <= 0) return 0;
  return Math.floor(diff / 1000);
}
