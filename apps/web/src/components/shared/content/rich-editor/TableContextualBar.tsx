import type { Editor } from "@tiptap/core";
import { useTranslation } from "react-i18next";
import { AppIcon } from "@/components/shared/AppIcon";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  ArrowDown,
  ArrowUp,
  ArrowLeftToLine,
  ArrowRightToLine,
  Rows3,
  Columns3,
  Table2,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

/**
 * Contextual table structure controls (contract §6). Rendered only while the
 * caret is inside a table. Every operation is a current Tiptap table command
 * whose result the canonical adapter persists as-is; merge/split/header have
 * no control here because the grammar cannot persist them.
 */

interface TableCommandDescriptor {
  id: string;
  labelKey: string;
  icon: LucideIcon;
  destructive?: boolean;
  run(editor: Editor): void;
}

const TABLE_COMMANDS: readonly TableCommandDescriptor[] = [
  {
    id: "add-row-above",
    labelKey: "content.table.addRowAbove",
    icon: ArrowUp,
    run: (editor) => {
      editor.chain().focus().addRowBefore().run();
    },
  },
  {
    id: "add-row-below",
    labelKey: "content.table.addRowBelow",
    icon: ArrowDown,
    run: (editor) => {
      editor.chain().focus().addRowAfter().run();
    },
  },
  {
    id: "add-column-left",
    labelKey: "content.table.addColumnLeft",
    icon: ArrowLeftToLine,
    run: (editor) => {
      editor.chain().focus().addColumnBefore().run();
    },
  },
  {
    id: "add-column-right",
    labelKey: "content.table.addColumnRight",
    icon: ArrowRightToLine,
    run: (editor) => {
      editor.chain().focus().addColumnAfter().run();
    },
  },
  {
    id: "delete-row",
    labelKey: "content.table.deleteRow",
    icon: Rows3,
    run: (editor) => {
      editor.chain().focus().deleteRow().run();
    },
  },
  {
    id: "delete-column",
    labelKey: "content.table.deleteColumn",
    icon: Columns3,
    run: (editor) => {
      editor.chain().focus().deleteColumn().run();
    },
  },
  {
    id: "delete-table",
    labelKey: "content.table.deleteTable",
    icon: Table2,
    destructive: true,
    run: (editor) => {
      editor.chain().focus().deleteTable().run();
    },
  },
];

/**
 * The contextual bar. `enabled` mirrors the editor's editable state; the bar
 * is a deliberate contextual strip, not toolbar wrap (contract §2).
 */
export function TableContextualBar({
  editor,
  disabled,
}: {
  editor: Editor | null;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  if (!editor || !editor.isActive("table")) return null;

  return (
    <TooltipProvider>
      <div
        role="group"
        aria-label={t("content.table.controlsLabel")}
        data-testid="table-contextual-bar"
        className="flex flex-nowrap items-center gap-0.5 rounded-md border border-border bg-card px-1 py-0.5"
      >
        {TABLE_COMMANDS.map((command) => (
          <Tooltip key={command.id}>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="xs"
                disabled={disabled}
                aria-label={t(command.labelKey as never) as string}
                data-testid={`table-cmd-${command.id}`}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => command.run(editor)}
                className={
                  command.destructive ? "hover:text-destructive" : undefined
                }
              >
                <AppIcon icon={command.icon} size="inline" />
                <span className="hidden md:inline">
                  {t(command.labelKey as never) as string}
                </span>
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              {t(command.labelKey as never) as string}
            </TooltipContent>
          </Tooltip>
        ))}
      </div>
    </TooltipProvider>
  );
}
