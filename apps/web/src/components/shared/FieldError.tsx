import type { ReactNode } from "react";

export function FieldError({ children }: { children?: ReactNode }) {
  if (!children) return null;
  return (
    <p role="alert" className="mt-1 text-xs text-destructive">
      {children}
    </p>
  );
}
