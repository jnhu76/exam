import { useState, useEffect } from "react";

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
  const isLow = remaining < 300;

  return (
    <span
      className={`font-mono text-lg font-bold ${isLow ? "text-red-600" : ""}`}
    >
      {String(minutes).padStart(2, "0")}:{String(seconds).padStart(2, "0")}
    </span>
  );
}

function getRemainingSeconds(deadlineAt: string): number {
  const diff = new Date(deadlineAt).getTime() - Date.now();
  if (diff <= 0) return 0;
  return Math.floor(diff / 1000);
}
