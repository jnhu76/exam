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
  clearLabel?: string;
  containerClassName?: string;
};

/**
 * Search input with a leading search icon and an optional clear button.
 * Accepts controlled value/onChange and supports placeholder customization.
 */
export function SearchInput({
  value,
  onChange,
  onClear,
  placeholder = "搜索",
  disabled = false,
  clearLabel = "清除搜索",
  className,
  containerClassName,
  ...props
}: SearchInputProps) {
  const safeValue = value ?? "";
  const canClear = safeValue.length > 0 && !disabled;

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
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        className={cn("pr-9 pl-9", className)}
        {...props}
      />
      {canClear && (
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label={clearLabel}
          className="absolute top-1/2 right-2 -translate-y-1/2"
          onClick={onClear ?? (() => onChange(""))}
        >
          <XIcon data-icon="inline-start" aria-hidden="true" />
        </Button>
      )}
    </div>
  );
}
