import * as React from "react";
import {
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
} from "lucide-react";
import {
  DayButton,
  DayPicker,
  getDefaultClassNames,
  type DayButtonProps,
} from "react-day-picker";
import { cn } from "@/lib/utils";
import { Button, buttonVariants } from "@/components/ui/button";

/**
 * shadcn new-york style calendar wrapper around react-day-picker v10.
 *
 * Adapted to the v10 component API: `DayButton` props are
 * `{ day, modifiers } & ButtonHTMLAttributes` (no `variant`), and
 * `captionLayout` accepts "label" | "dropdown" | "dropdown-months" |
 * "dropdown-years".
 */
function Calendar({
  className,
  classNames,
  showOutsideDays = true,
  captionLayout = "label",
  buttonVariant = "ghost",
  ...props
}: React.ComponentProps<typeof DayPicker> & {
  buttonVariant?: React.ComponentProps<typeof Button>["variant"];
}) {
  const defaultClassNames = getDefaultClassNames();

  return (
    <DayPicker
      captionLayout={captionLayout}
      className={cn("bg-background group/calendar p-3", className)}
      classNames={{
        months: "flex flex-col gap-4",
        month: "flex flex-col gap-4",
        month_caption:
          "flex justify-center h-9 mx-10 items-center text-sm font-medium",
        caption_label: "flex h-9 items-center gap-1 font-medium text-sm",
        month_grid: "w-full border-collapse space-y-1",
        weekdays: "flex",
        weekday:
          "text-muted-foreground rounded-md w-8 font-normal text-[0.8rem]",
        week: "flex w-full mt-2",
        week_number_header:
          "w-8 justify-center flex text-muted-foreground font-normal text-[0.8rem]",
        week_number:
          "text-muted-foreground rounded-md w-8 justify-center flex font-normal text-[0.8rem]",
        day: "relative p-0 text-center text-sm group/day [&:first-child[data-selected=true]_button]:rounded-l-md [&:last-child[data-selected=true]_button]:rounded-r-md",
        range_start:
          "bg-accent [&>button]:bg-primary [&>button]:text-primary-foreground [&>button]:rounded-r-none",
        range_middle: "[&>button]:rounded-none",
        range_end:
          "bg-accent [&>button]:bg-primary [&>button]:text-primary-foreground [&>button]:rounded-l-none",
        today: "bg-accent rounded-md data-[selected=true]:rounded-none",
        outside: "text-muted-foreground aria-selected:text-muted-foreground",
        disabled: "text-muted-foreground opacity-50",
        hidden: "invisible",
        ...classNames,
      }}
      components={{
        Chevron: ({ orientation }) => {
          if (orientation === "left") {
            return <ChevronLeftIcon className="h-4 w-4" />;
          }
          if (orientation === "right") {
            return <ChevronRightIcon className="h-4 w-4" />;
          }
          return <ChevronDownIcon className="h-4 w-4" />;
        },
        DayButton: (dayButtonProps) => (
          <CalendarDayButton variant={buttonVariant} {...dayButtonProps} />
        ),
      }}
      showOutsideDays={showOutsideDays}
      {...props}
    />
  );
}

function CalendarDayButton({
  className,
  variant,
  day,
  modifiers,
  ...props
}: DayButtonProps & {
  variant?: React.ComponentProps<typeof Button>["variant"];
}) {
  // `day` and `modifiers` are required by the underlying DayButton signature
  // but not consumed here — forward to the default renderer.
  void day;
  void modifiers;
  return (
    <DayButton
      className={cn(
        buttonVariants({ variant }),
        "aspect-square w-9 p-0 font-normal data-[selected=true]:bg-primary data-[selected=true]:text-primary-foreground data-[selected=true]:opacity-100 group/day/button:data-[selected=true]:bg-primary group/day/button:data-[selected=true]:text-primary-foreground data-[selected=true]:rounded-md group/day/button:data-[selected=true]:rounded-md",
        className,
      )}
      day={day}
      modifiers={modifiers}
      {...props}
    />
  );
}

export { Calendar, CalendarDayButton };
