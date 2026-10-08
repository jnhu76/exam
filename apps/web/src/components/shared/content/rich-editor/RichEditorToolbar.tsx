import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { Editor } from "@tiptap/core";
import { useTranslation } from "react-i18next";
import { MoreHorizontal } from "lucide-react";
import { useEditorState } from "@tiptap/react";
import { AppIcon } from "@/components/shared/AppIcon";
import { Button } from "@/components/ui/button";
import { useOverflowObservation } from "@/hooks/useOverflowObservation";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { EditorCommandDescriptor, EditorCommandId } from "./commands";
import { measureToolbarGeometry, resolveInlineCount } from "./toolbarFit";

/**
 * The candidate editor command bar (contract §2–§3, §10). Pure presentation
 * over the command catalogue: grouping, active/disabled state, tooltips,
 * adaptive overflow, and the ARIA toolbar pattern live here; command
 * semantics live exclusively in the descriptors.
 *
 * Overflow (contract §2, revised by the #699 / PR #752 corrective): the row is
 * sized by its CONTAINER, not by a viewport breakpoint, and never scrolls
 * horizontally. `resolveInlineCount` keeps the longest fitting prefix of the
 * registry inline and the rest render in the single 更多 menu, so every command
 * is reachable exactly once — inline or in the menu — with the same enabled /
 * active / execute semantics read from the same state.
 *
 * Accessibility: ONE tab stop with roving Arrow/Home/End focus — a keyboard
 * user tabbing between prompt and canvas crosses the toolbar in a single stop
 * instead of one per control. The roving order holds exactly the controls
 * rendered in the row, the menu trigger included; collapsed commands have no
 * control there and are reached through the trigger.
 */

type ToolbarState = Record<
  EditorCommandId,
  { active: boolean; enabled: boolean }
>;

function buildToolbarState(
  editor: Editor,
  commands: readonly EditorCommandDescriptor[],
): ToolbarState {
  const state = {} as ToolbarState;
  for (const command of commands) {
    state[command.id] = {
      active: command.isActive(editor),
      enabled: command.isEnabled(editor),
    };
  }
  return state;
}

const IS_APPLE_PLATFORM =
  typeof navigator !== "undefined" &&
  /Mac|iPhone|iPad/.test(navigator.platform);

/** Renders the neutral "Mod+" binding for the active platform. */
function displayShortcut(shortcut: string): string {
  return shortcut.replace("Mod+", IS_APPLE_PLATFORM ? "⌘" : "Ctrl+");
}

/** aria-keyshortcuts token for the active platform. */
function ariaShortcut(shortcut: string): string {
  return shortcut.replace("Mod+", IS_APPLE_PLATFORM ? "Meta+" : "Control+");
}

const TOOLBAR_KEYS: Record<string, "next" | "prev" | "first" | "last"> = {
  ArrowRight: "next",
  ArrowLeft: "prev",
  Home: "first",
  End: "last",
};

/** Roving stop of the overflow menu trigger; commands use their own ids. */
const OVERFLOW_TRIGGER = "overflow-menu";
type RovingId = EditorCommandId | typeof OVERFLOW_TRIGGER;

export function RichEditorToolbar({
  editor,
  commands,
  disabled,
}: {
  editor: Editor | null;
  commands: readonly EditorCommandDescriptor[];
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  // One subscription re-evaluates every command on selection/doc changes
  // (contract §3) — the toolbar never relies on mutation-only updates, and both
  // surfaces (row and menu) read their state from this one projection.
  const state = useEditorState({
    editor,
    selector: ({ editor: current }) =>
      current ? buildToolbarState(current, commands) : null,
  });
  // null = not measured yet: the whole catalogue renders inline until the row
  // has been measured (jsdom and other layout-less environments stay here).
  const [inlineCount, setInlineCount] = useState<number | null>(null);
  const [focusId, setFocusId] = useState<RovingId>(
    commands[0]?.id ?? OVERFLOW_TRIGGER,
  );
  const rowRef = useRef<HTMLDivElement | null>(null);
  const measureRowRef = useRef<HTMLDivElement | null>(null);
  const controlRefs = useRef(new Map<RovingId, HTMLButtonElement | null>());
  // The control that currently owns DOM focus — the fact a resize must not
  // silently drop when it collapses that control into the menu.
  const focusOwnerRef = useRef<RovingId | null>(null);

  // The row's available width is a CONTAINER fact, so it comes from the
  // repository's single container-measurement owner (#445 P3 §8 / #601 Phase F)
  // rather than a second observer or a breakpoint. The observed element is the
  // bare flex row (no padding, no border), so its exact content width IS the
  // space the controls must fit — no box arithmetic in between.
  const observation = useOverflowObservation(rowRef);
  const availableWidth = observation.contentWidth;

  const inlineCommands = useMemo(
    () => commands.slice(0, inlineCount ?? commands.length),
    [commands, inlineCount],
  );
  const overflowCommands = useMemo(
    () => commands.slice(inlineCount ?? commands.length),
    [commands, inlineCount],
  );
  const rovingIds = useMemo<RovingId[]>(() => {
    const ids: RovingId[] = inlineCommands.map((command) => command.id);
    if (overflowCommands.length > 0) ids.push(OVERFLOW_TRIGGER);
    return ids;
  }, [inlineCommands, overflowCommands]);

  const commandState = (id: RovingId | undefined) =>
    id === undefined || id === OVERFLOW_TRIGGER ? null : state?.[id];

  // ONE viable tab stop (review U-R5): when the parked control is disabled
  // (e.g. undo on a fresh document), the single tabIndex=0 moves to the first
  // enabled control — a disabled button is skipped by Tab entirely, which
  // would otherwise make the whole toolbar unreachable by keyboard. The menu
  // trigger is never disabled, so an overflowing row always has a tab stop.
  const parkedId = rovingIds.includes(focusId) ? focusId : rovingIds[0];
  const parkedEnabled =
    parkedId === OVERFLOW_TRIGGER ||
    (Boolean(commandState(parkedId)?.enabled) && !disabled);
  const tabStopId =
    !state || parkedEnabled
      ? parkedId
      : rovingIds.find(
          (id) => id === OVERFLOW_TRIGGER || Boolean(commandState(id)?.enabled),
        );

  const measure = useCallback(() => {
    const row = rowRef.current;
    const measureRow = measureRowRef.current;
    if (!row || !measureRow) return;
    const next = resolveInlineCount(
      commands,
      availableWidth,
      measureToolbarGeometry(row, measureRow),
    );
    setInlineCount((previous) => (previous === next ? previous : next));
  }, [commands, availableWidth]);

  useLayoutEffect(() => {
    measure();
  }, [measure]);

  const moveFocus = useCallback(
    (action: "next" | "prev" | "first" | "last", from: RovingId) => {
      const delta = action === "prev" ? -1 : 1;
      let index =
        action === "first"
          ? 0
          : action === "last"
            ? rovingIds.length - 1
            : rovingIds.indexOf(from) + delta;
      while (index >= 0 && index < rovingIds.length) {
        const id = rovingIds[index];
        if (id === undefined) return;
        const target = controlRefs.current.get(id);
        // Collapsed commands have no control in the row, and disabled controls
        // cannot take focus: the roving tab stop only ever lands on a control
        // the user can actually operate.
        if (target && !target.disabled) {
          target.focus();
          focusOwnerRef.current = id;
          setFocusId(id);
          return;
        }
        index += delta;
      }
    },
    [rovingIds],
  );

  useLayoutEffect(() => {
    const owner = focusOwnerRef.current;
    if (owner === null || rovingIds.includes(owner)) return;
    // A narrower container moved the focused command into the menu, so its
    // control is gone from the row. Park focus on the trigger that now owns
    // the command instead of letting it fall to <body>; a deliberate move
    // elsewhere (editor, page control) is left untouched.
    const active = document.activeElement;
    if (active !== null && active !== document.body) return;
    const fallback: RovingId | undefined =
      overflowCommands.length > 0
        ? OVERFLOW_TRIGGER
        : rovingIds[rovingIds.length - 1];
    if (fallback === undefined) return;
    const target = controlRefs.current.get(fallback);
    if (!target) return;
    target.focus();
    focusOwnerRef.current = fallback;
    setFocusId(fallback);
  }, [rovingIds, overflowCommands]);

  function registerControl(id: RovingId, element: HTMLButtonElement | null) {
    if (element) controlRefs.current.set(id, element);
    else controlRefs.current.delete(id);
  }

  function toolbarKeys(id: RovingId) {
    return (event: React.KeyboardEvent) => {
      const action = TOOLBAR_KEYS[event.key];
      if (!action) return;
      event.preventDefault();
      moveFocus(action, id);
    };
  }

  function commandButton(command: EditorCommandDescriptor): React.ReactNode {
    const commandStateForId = state?.[command.id];
    const enabled = Boolean(commandStateForId?.enabled) && !disabled;
    const active = Boolean(commandStateForId?.active);
    const label = t(command.labelKey as never) as string;
    return (
      <Tooltip key={command.id}>
        <TooltipTrigger asChild>
          <Button
            ref={(element) => registerControl(command.id, element)}
            type="button"
            variant="ghost"
            size="icon-sm"
            tabIndex={command.id === tabStopId ? 0 : -1}
            aria-label={label}
            aria-pressed={command.kind === "toggle" ? active : undefined}
            aria-keyshortcuts={
              command.shortcut ? ariaShortcut(command.shortcut) : undefined
            }
            disabled={!enabled}
            data-active={active || undefined}
            data-command-id={command.id}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => command.execute(editor as Editor)}
            onFocus={() => {
              focusOwnerRef.current = command.id;
              setFocusId(command.id);
            }}
            onKeyDown={toolbarKeys(command.id)}
            className="data-[active]:bg-muted data-[active]:text-foreground"
          >
            <AppIcon icon={command.icon} size="inline" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          {label}
          {command.shortcut ? ` (${displayShortcut(command.shortcut)})` : ""}
        </TooltipContent>
      </Tooltip>
    );
  }

  const rowControls: React.ReactNode[] = [];
  let previousGroup: EditorCommandDescriptor["group"] | null = null;
  for (const command of inlineCommands) {
    if (previousGroup !== null && previousGroup !== command.group) {
      rowControls.push(
        <div
          key={`sep-${command.group}`}
          aria-hidden="true"
          className="mx-1 h-5 w-px bg-border"
        />,
      );
    }
    rowControls.push(commandButton(command));
    previousGroup = command.group;
  }

  // Off-layout copy of the row, read only for control geometry. It holds EVERY
  // command — not just the visible ones — because the widths that decide the
  // split must be readable in any state: a collapsed command has no control in
  // the row, so measuring only what is rendered could never grow the row back.
  // It is not a second toolbar: same registry, no handlers, no tooltips, no tab
  // stops, aria-hidden, and zero layout footprint (0×0 clipped box, absolutely
  // positioned so it never enters an ancestor's intrinsic size).
  const measureControls: React.ReactNode[] = [];
  let measureGroup: EditorCommandDescriptor["group"] | null = null;
  for (const command of commands) {
    if (measureGroup !== null && measureGroup !== command.group) {
      measureControls.push(
        <div
          key={`measure-sep-${command.group}`}
          aria-hidden="true"
          data-fit-separator
          className="mx-1 h-5 w-px bg-border"
        />,
      );
    }
    measureControls.push(
      <Button
        key={`measure-${command.id}`}
        type="button"
        variant="ghost"
        size="icon-sm"
        tabIndex={-1}
        aria-hidden="true"
        data-fit-command={command.id}
      >
        <AppIcon icon={command.icon} size="inline" />
      </Button>,
    );
    measureGroup = command.group;
  }
  measureControls.push(
    <Button
      key="measure-overflow"
      type="button"
      variant="ghost"
      size="icon-sm"
      tabIndex={-1}
      aria-hidden="true"
      data-fit-trigger
    >
      <AppIcon icon={MoreHorizontal} size="inline" />
    </Button>,
  );

  return (
    <TooltipProvider>
      {/* INVARIANT (#699): the row never wraps and never scrolls — the commands
          that do not fit render in the menu below instead. `contain-inline-size`
          keeps the row's width a fact about its CONTAINER: without it, a long
          row inflates a content-sized ancestor (the flex:1 option row) and the
          measured available width would be the inflated one. -mx-1/p-1 keeps
          the controls' focus rings inside the container's clip boundary at the
          same visual position (#683); the pair is one rule.

          The inner row is the observed region: bare (no padding, no border), so
          its content width is exactly the space the controls must fit. */}
      <div
        role="toolbar"
        aria-orientation="horizontal"
        aria-label={t("content.editor.toolbarLabel")}
        className="relative -mx-1 contain-inline-size p-1"
      >
        <div ref={rowRef} className="flex flex-nowrap items-center gap-0.5">
          {rowControls}
          {overflowCommands.length > 0 && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  ref={(element) => registerControl(OVERFLOW_TRIGGER, element)}
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  tabIndex={OVERFLOW_TRIGGER === tabStopId ? 0 : -1}
                  aria-label={t("content.editor.moreCommands")}
                  onMouseDown={(e) => e.preventDefault()}
                  onFocus={() => {
                    focusOwnerRef.current = OVERFLOW_TRIGGER;
                    setFocusId(OVERFLOW_TRIGGER);
                  }}
                  onKeyDown={toolbarKeys(OVERFLOW_TRIGGER)}
                >
                  <AppIcon icon={MoreHorizontal} size="inline" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {overflowCommands.map((command) => (
                  <DropdownMenuItem
                    key={command.id}
                    disabled={disabled || !state?.[command.id].enabled}
                    data-active={state?.[command.id].active || undefined}
                    aria-pressed={
                      command.kind === "toggle"
                        ? state?.[command.id].active
                        : undefined
                    }
                    aria-keyshortcuts={
                      command.shortcut
                        ? ariaShortcut(command.shortcut)
                        : undefined
                    }
                    onMouseDown={(e) => e.preventDefault()}
                    onSelect={() => command.execute(editor as Editor)}
                  >
                    <AppIcon icon={command.icon} size="inline" />
                    {t(command.labelKey as never) as string}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
        <div
          aria-hidden="true"
          className="pointer-events-none invisible absolute left-0 top-0 h-0 w-0 overflow-hidden"
        >
          <div
            ref={measureRowRef}
            className="flex w-max flex-nowrap items-center gap-0.5 p-1"
          >
            {measureControls}
          </div>
        </div>
      </div>
    </TooltipProvider>
  );
}
