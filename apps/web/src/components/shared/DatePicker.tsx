import * as React from "react";
import { useTranslation } from "react-i18next";
import { format } from "date-fns";
import { zhCN } from "date-fns/locale";
import { CalendarIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AppIcon } from "@/components/shared/AppIcon";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

export interface DatePickerProps {
  /** Currently selected date (controlled). `undefined` = nothing selected. */
  value?: Date;
  /** Called when the user picks a date (or clears it). */
  onChange: (date: Date | undefined) => void;
  /** Accessible label for the trigger button. */
  "aria-label"?: string;
  /** Placeholder shown when no date is selected. Defaults to `common.date.placeholder`. */
  placeholder?: string;
  className?: string;
}

/**
 * Single-date picker built from shadcn `Popover` + `Calendar` (react-day-picker
 * v10). Used in pairs (from / to) for the audit-log date-range filter.
 *
 * Selecting an already-selected day clears the value (toggle), which gives a
 * lightweight "clear" affordance inside the popover.
 */
export function DatePicker({
  value,
  onChange,
  placeholder,
  className,
  ...aria
}: DatePickerProps) {
  const { t } = useTranslation();
  const [open, setOpen] = React.useState(false);
  const resolvedPlaceholder = placeholder ?? t("common.date.placeholder");
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          className={cn(
            "w-[160px] justify-start text-left font-normal",
            !value && "text-muted-foreground",
            className,
          )}
          {...aria}
        >
          <AppIcon icon={CalendarIcon} size="inline" className="mr-2" />
          {value ? format(value, "yyyy-MM-dd") : resolvedPlaceholder}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="single"
          locale={zhCN}
          selected={value}
          onSelect={(next) => {
            onChange(next);
            setOpen(false);
          }}
          autoFocus
        />
      </PopoverContent>
    </Popover>
  );
}
