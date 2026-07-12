import type { ReactNode } from "react";

/** Props for the FieldError component. */
type FieldErrorProps = {
  children?: ReactNode;
  /**
   * Optional id forwarded to the root error element. Use it to give the error
   * node a stable identifier so an owning control's `aria-describedby` can
   * reference it. Omitted entirely when children are falsy (no node renders),
   * so a dangling `aria-describedby` reference can never be left behind.
   */
  id?: string;
};

/** Renders a form field validation error message, or nothing if no children. */
export function FieldError({ children, id }: FieldErrorProps) {
  if (!children) return null;
  return (
    <p role="alert" id={id} className="mt-1 text-xs text-destructive">
      {children}
    </p>
  );
}
