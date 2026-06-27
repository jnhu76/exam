import * as React from "react"
import * as TabsPrimitive from "@radix-ui/react-tabs"

import { cn } from "@/lib/utils"

function Tabs({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Root>) {
  return (
    <TabsPrimitive.Root
      data-slot="tabs"
      className={cn("group/tabs flex gap-2 data-[orientation=horizontal]:flex-col", className)}
      {...props}
    />
  )
}

function TabsList({
  className,
  variant = "default",
  ...props
}: React.ComponentProps<typeof TabsPrimitive.List> & {
  variant?: "default" | "line"
}) {
  return (
    <TabsPrimitive.List
      data-slot="tabs-list"
      data-variant={variant}
      className={cn(
        "group/tabs-list inline-flex w-fit items-center justify-center",
        variant === "default" && "gap-1 rounded-[var(--admin-radius)] border border-admin-border bg-card p-1",
        variant === "line" && "gap-1 rounded-none bg-transparent",
        className,
      )}
      {...props}
    />
  )
}

function TabsTrigger({
  className,
  variant = "default",
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Trigger> & {
  variant?: "default" | "line"
}) {
  return (
    <TabsPrimitive.Trigger
      data-slot="tabs-trigger"
      data-variant={variant}
      className={cn(
        "relative inline-flex items-center justify-center gap-1.5 whitespace-nowrap px-3 py-1.5 text-sm font-medium transition-colors outline-none",
        "text-muted-foreground hover:text-foreground",
        "focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50",
        "disabled:pointer-events-none disabled:opacity-50",
        variant === "default" && [
          "rounded-[6px] border border-transparent",
          "data-[state=active]:border-primary data-[state=active]:bg-primary-soft data-[state=active]:text-primary data-[state=active]:shadow-none",
        ],
        variant === "line" && [
          "rounded-none border-b-2 border-transparent bg-transparent px-4 py-2",
          "data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:text-foreground",
        ],
        "[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        className,
      )}
      {...props}
    />
  )
}

function TabsContent({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Content>) {
  return (
    <TabsPrimitive.Content
      data-slot="tabs-content"
      className={cn("flex-1 outline-none", className)}
      {...props}
    />
  )
}

export { Tabs, TabsList, TabsTrigger, TabsContent }
