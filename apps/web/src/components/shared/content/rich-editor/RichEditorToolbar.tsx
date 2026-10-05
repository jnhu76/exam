import { useCallback, useRef, useState } from "react";
import type { Editor } from "@tiptap/core";
import { useTranslation } from "react-i18next";
import { MoreHorizontal } from "lucide-react";
import { useEditorState } from "@tiptap/react";
import { AppIcon } from "@/components/shared/AppIcon";
import { Button } from "@/components/ui/button";
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
import {
  COMMAND_GROUP_ORDER,
  OVERFLOW_COMMAND_IDS,
  type EditorCommandDescriptor,
  type EditorCommandId,
} from "./commands";

/**
 * The candidate editor command bar (contract §2–§3, §10). Pure presentation
 * over the command catalogue: grouping, active/disabled state, tooltips,
 * responsive overflow, and the ARIA toolbar pattern live here; command
 * semantics live exclusively in the descriptors.
 *
 * Accessibility: ONE tab stop with roving Arrow/Home/End focus — a keyboard
 * user tabbing between prompt and canvas crosses the toolbar in a single
 * stop instead of one per control. The narrow-viewport overflow buttons are
 * display:none at narrow widths; roving focus skips them there and reaches
 * them inline at wide widths.
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
  // (contract §3) — the toolbar never relies on mutation-only updates.
  const state = useEditorState({
    editor,
    selector: ({ editor: current }) =>
      current ? buildToolbarState(current, commands) : null,
  });
  const [focusIndex, setFocusIndex] = useState(0);
  const buttonRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const inRowCommands = commands.filter((c) => !OVERFLOW_COMMAND_IDS.has(c.id));
  const overflowCommands = commands.filter((c) =>
    OVERFLOW_COMMAND_IDS.has(c.id),
  );
  const orderedCommands = [...inRowCommands, ...overflowCommands];

  // ONE viable tab stop (review U-R5): when the parked control is disabled
  // (e.g. undo on a fresh document), the single tabIndex=0 moves to the first
  // enabled control — a disabled button is skipped by Tab entirely, which
  // would otherwise make the whole toolbar unreachable by keyboard.
  const firstEnabledIndex = orderedCommands.findIndex(
    (c) => !disabled && state?.[c.id].enabled,
  );
  const parkedCommand = orderedCommands[focusIndex];
  const tabStopIndex =
    !state || (parkedCommand && state[parkedCommand.id]?.enabled)
      ? focusIndex
      : firstEnabledIndex;

  const moveFocus = useCallback(
    (action: string, from: number) => {
      const delta = action === "prev" ? -1 : 1;
      let index =
        action === "first"
          ? 0
          : action === "last"
            ? orderedCommands.length - 1
            : from + delta;
      while (index >= 0 && index < orderedCommands.length) {
        const target = buttonRefs.current[index];
        // display:none (narrow overflow) and disabled controls cannot take focus.
        if (target && !target.disabled && target.offsetParent !== null) {
          target.focus();
          setFocusIndex(index);
          return;
        }
        index += delta;
      }
    },
    [orderedCommands.length],
  );

  function commandButton(
    command: EditorCommandDescriptor,
    index: number,
  ): React.ReactNode {
    const commandState = state?.[command.id];
    const enabled = Boolean(commandState?.enabled) && !disabled;
    const active = Boolean(commandState?.active);
    const label = t(command.labelKey as never) as string;
    return (
      <Tooltip key={command.id}>
        <TooltipTrigger asChild>
          <Button
            ref={(el) => {
              buttonRefs.current[index] = el;
            }}
            type="button"
            variant="ghost"
            size="icon-sm"
            tabIndex={index === tabStopIndex ? 0 : -1}
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
            onKeyDown={(e) => {
              const action = TOOLBAR_KEYS[e.key];
              if (action) {
                e.preventDefault();
                moveFocus(action, index);
              }
            }}
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

  const rowButtons: React.ReactNode[] = [];
  let previousGroup: EditorCommandDescriptor["group"] | null = null;
  inRowCommands.forEach((command) => {
    const index = orderedCommands.indexOf(command);
    if (previousGroup !== null && previousGroup !== command.group) {
      rowButtons.push(
        <div
          key={`sep-${command.group}`}
          aria-hidden="true"
          className="mx-1 h-5 w-px bg-border"
        />,
      );
    }
    rowButtons.push(commandButton(command, index));
    previousGroup = command.group;
  });

  return (
    <TooltipProvider>
      <div
        role="toolbar"
        aria-orientation="horizontal"
        aria-label={t("content.editor.toolbarLabel")}
        data-testid="rich-editor-toolbar"
        className="flex flex-nowrap items-center gap-0.5"
      >
        {rowButtons}
        {/* Narrow viewports: low-frequency insert commands collapse into the
            overflow menu; the primary row never wraps (contract §2). */}
        <div className="sm:hidden">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={t("content.editor.moreCommands")}
                data-testid="toolbar-overflow-trigger"
                onMouseDown={(e) => e.preventDefault()}
              >
                <AppIcon icon={MoreHorizontal} size="inline" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
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
                  onMouseDown={(e) => e.preventDefault()}
                  onSelect={() => command.execute(editor as Editor)}
                >
                  <AppIcon icon={command.icon} size="inline" />
                  {t(command.labelKey as never) as string}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        {/* Wide viewports: the overflow commands render inline at the row end. */}
        <div className="hidden items-center gap-0.5 sm:flex">
          {overflowCommands.map((command) =>
            commandButton(command, orderedCommands.indexOf(command)),
          )}
        </div>
      </div>
    </TooltipProvider>
  );
}
