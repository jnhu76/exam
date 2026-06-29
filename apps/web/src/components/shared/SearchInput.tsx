import { useTranslation } from "react-i18next";
import { SearchIcon, XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/** Props for the SearchInput component. */
type SearchInputProps = Omit<
  React.ComponentProps<typeof Input>,
  "value" | "onChange" | "type"
> & {
  value?: string | null;
  onChange: (value: string) => void;
  onClear?: () => void;
  placeholder?: string;
  clearLabel?: string;
  containerClassName?: string;
};

/**
 * Search input with a leading search icon and an optional clear button.
 * Accepts controlled value/onChange and supports placeholder customization.
 * Defaults resolve from `common.search.*` i18n keys; explicit props win.
 */
export function SearchInput({
  value,
  onChange,
  onClear,
  placeholder,
  disabled = false,
  clearLabel,
  className,
  containerClassName,
  ...props
}: SearchInputProps) {
  const { t } = useTranslation();
  const safeValue = value ?? "";
  const canClear = safeValue.length > 0 && !disabled;
  const resolvedPlaceholder = placeholder ?? t("common.search.placeholder");
  const resolvedClearLabel = clearLabel ?? t("common.search.clearLabel");

  return (
    <div className={cn("relative min-w-0", containerClassName)}>
      <SearchIcon
        data-icon="inline-start"
        aria-hidden="true"
        className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
      />
      <Input
        type="search"
        value={safeValue}
        disabled={disabled}
        placeholder={resolvedPlaceholder}
        onChange={(event) => onChange(event.target.value)}
        className={cn("pr-9 pl-9", className)}
        {...props}
      />
      {canClear && (
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label={resolvedClearLabel}
          className="absolute top-1/2 right-2 -translate-y-1/2"
          onClick={onClear ?? (() => onChange(""))}
        >
          <XIcon data-icon="inline-start" aria-hidden="true" />
        </Button>
      )}
    </div>
  );
}
