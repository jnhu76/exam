import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { MoreVertical, type LucideIcon } from "lucide-react";
import { AppIcon } from "./AppIcon";
import { ConfirmDialog } from "./ConfirmDialog";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

export type RowActionTone = "default" | "destructive";

/**
 * Typed semantic declaration of one table row action (P3 §3 (issue 445) — the
 * action capacity contract). Representation is derived from the declaration
 * list by COUNT alone (never width, never label text): N ≤ 2 actions render
 * inline as icon buttons; N > 2 renders exactly one primary inline plus a
 * kebab with every other action. Inline text buttons are not part of the
 * vocabulary — the label lives in aria-label (inline) or menu item text
 * (kebab).
 */
export interface RowActionDeclaration<TRow = unknown> {
  /** Stable identifier — test/audit anchor, emitted as data-action-id. */
  id: string;
  /** Resolved i18n copy: aria-label when inline, menu text when in the kebab. */
  label: string;
  /** Required — the inline representation vocabulary is icon-only. */
  icon: LucideIcon;
  /**
   * destructive ⇒ confirm is required (dev error otherwise) and menu items
   * use destructive styling.
   */
  tone?: RowActionTone;
  /** reason ⇒ tooltip on the inline control (ExamPage precedent). */
  disabled?: boolean | { reason: string };
  /** ≤1; none declared ⇒ the first declaration is primary. */
  primary?: boolean;
  confirm?: {
    title: string;
    description: string;
    confirmLabel?: string;
    destructive?: boolean;
  };
  /** Activation. RowActions stops propagation so clickable rows stay inert. */
  onSelect?: (row: TRow) => void;
}

function isDisabled<TRow>(action: RowActionDeclaration<TRow>): boolean {
  return action.disabled !== undefined && action.disabled !== false;
}

function disabledReason<TRow>(
  action: RowActionDeclaration<TRow>,
): string | undefined {
  return typeof action.disabled === "object"
    ? action.disabled.reason
    : undefined;
}

function contractViolations<TRow>(
  actions: RowActionDeclaration<TRow>[],
): string[] {
  const violations: string[] = [];
  const primaryCount = actions.filter((a) => a.primary).length;
  if (primaryCount > 1) {
    violations.push(
      `at most one primary action may be declared (found ${primaryCount})`,
    );
  }
  for (const action of actions) {
    if (action.tone === "destructive" && !action.confirm) {
      violations.push(`destructive action "${action.id}" must declare confirm`);
    }
  }
  return violations;
}

/**
 * Horizontal action group for table rows, rendered from typed declarations.
 *
 * INVARIANT: representation is a pure function of the declaration list —
 * count triggers the kebab (N > 2 ⇒ exactly one primary inline + one kebab
 * trigger, i.e. two inline controls no matter how large N grows), the first
 * (or explicitly primary) action stays inline, and disabled actions keep
 * their slot so geometry never changes while a row's actions toggle. With the
 * icon-only vocabulary the inline bound is two buttons (incl. the kebab),
 * which is what the contract-bound actions-column width (6rem fine / 7.5rem
 * coarse) is derived from.
 */
export function RowActions<TRow>({
  actions,
  row,
  className,
  "aria-label": ariaLabel,
}: {
  actions: RowActionDeclaration<TRow>[];
  row: TRow;
  className?: string;
  "aria-label"?: string;
}) {
  const { t } = useTranslation();
  const [confirming, setConfirming] =
    useState<RowActionDeclaration<TRow> | null>(null);
  // Unique per instance so describedby ids stay valid across table rows.
  const instanceId = useId();

  if (import.meta.env.DEV) {
    const violations = contractViolations(actions);
    if (violations.length > 0) {
      throw new Error(
        `RowActions contract violation: ${violations.join("; ")}`,
      );
    }
  }

  const explicitPrimaryIndex = actions.findIndex((a) => a.primary);
  const primary =
    actions.length === 0
      ? undefined
      : (actions[explicitPrimaryIndex === -1 ? 0 : explicitPrimaryIndex] ??
        actions[0]);
  const useOverflow = actions.length > 2;
  const inlineActions = useOverflow
    ? actions.filter((a) => a === primary)
    : actions;
  const overflowActions = useOverflow
    ? actions.filter((a) => a !== primary)
    : [];

  const activate = (action: RowActionDeclaration<TRow>) => {
    if (action.confirm) setConfirming(action);
    else action.onSelect?.(row);
  };

  const renderInline = (action: RowActionDeclaration<TRow>) => {
    const button = (
      <Button
        key={action.id}
        type="button"
        size="icon"
        variant="ghost"
        aria-label={action.label}
        data-action-id={action.id}
        disabled={isDisabled(action)}
        onClick={(event) => {
          event.stopPropagation();
          if (!action.confirm) action.onSelect?.(row);
        }}
      >
        <AppIcon icon={action.icon} size="inline" />
      </Button>
    );
    const reason = disabledReason(action);
    if (action.confirm) {
      const confirmed = (
        <ConfirmDialog
          key={action.id}
          trigger={button}
          title={action.confirm.title}
          description={action.confirm.description}
          confirmLabel={action.confirm.confirmLabel}
          destructive={
            action.confirm.destructive ?? action.tone === "destructive"
          }
          onConfirm={() => action.onSelect?.(row)}
        />
      );
      return reason ? withTooltip(action, confirmed) : confirmed;
    }
    return reason ? withTooltip(action, button) : button;
  };

  /** Disabled-with-reason keeps hover/focus tooltip reachability without a
   * real button hit target (the span carries the tab stop). Own provider so
   * consumers need no TooltipProvider ancestor for optional reasons. */
  function withTooltip(
    action: RowActionDeclaration<TRow>,
    child: React.ReactNode,
  ) {
    return (
      <TooltipProvider key={action.id}>
        <Tooltip>
          <TooltipTrigger asChild>
            <span tabIndex={0} aria-label={action.label}>
              {child}
            </span>
          </TooltipTrigger>
          <TooltipContent>{disabledReason(action)}</TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

  return (
    <div
      role="group"
      aria-label={ariaLabel ?? t("common.rowActions")}
      data-slot="row-actions"
      data-action-target="responsive"
      className={cn("flex items-center justify-end gap-1", className)}
    >
      {inlineActions.map(renderInline)}
      {overflowActions.length > 0 && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              aria-label={t("common.moreActions")}
              data-action-id="overflow-menu"
            >
              <AppIcon icon={MoreVertical} size="inline" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {overflowActions.map((action) => {
              const reason = disabledReason(action);
              // A disabled item must keep its authoritative reason perceivable
              // and accessible inside the kebab too (HTML title is neither a
              // reliable keyboard nor a screen-reader contract). Rendering the
              // reason as explicit secondary text inside the item keeps it
              // visible AND in the accessibility tree; aria-describedby ties
              // the description to the item. Native `disabled` keeps Radix
              // non-activation (no onSelect) semantics.
              const reasonId = `${instanceId}-${action.id}-reason`;
              return (
                <DropdownMenuItem
                  key={action.id}
                  data-action-id={action.id}
                  variant={
                    action.tone === "destructive" ? "destructive" : "default"
                  }
                  disabled={isDisabled(action)}
                  aria-describedby={reason ? reasonId : undefined}
                  onSelect={() => activate(action)}
                >
                  <AppIcon icon={action.icon} size="inline" />
                  {action.label}
                  {reason && (
                    <span
                      id={reasonId}
                      data-disabled-reason
                      className="ml-auto type-metadata"
                    >
                      {reason}
                    </span>
                  )}
                </DropdownMenuItem>
              );
            })}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
      {confirming?.confirm && (
        <ConfirmDialog
          open
          onOpenChange={(open) => {
            if (!open) setConfirming(null);
          }}
          title={confirming.confirm.title}
          description={confirming.confirm.description}
          confirmLabel={confirming.confirm.confirmLabel}
          destructive={
            confirming.confirm.destructive ?? confirming.tone === "destructive"
          }
          onConfirm={() => {
            confirming.onSelect?.(row);
            setConfirming(null);
          }}
        />
      )}
    </div>
  );
}
