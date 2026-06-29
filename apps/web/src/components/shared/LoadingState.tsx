import { useTranslation } from "react-i18next";
import { LoaderCircle } from "lucide-react";
import { cn } from "@/lib/utils";

/** Centered loading indicator with a spinning icon and customizable label text. */
export function LoadingState({
  label,
  className,
}: {
  label?: string;
  className?: string;
}) {
  const { t } = useTranslation();
  const text = label ?? t("common.loadingState");
  return (
    <div
      role="status"
      aria-busy="true"
      className={cn(
        "flex flex-col items-center gap-3 p-8 text-center",
        className,
      )}
    >
      <LoaderCircle className="size-8 animate-spin text-muted-foreground" />
      <p className="text-sm text-muted-foreground">{text}</p>
    </div>
  );
}
