import type { EditorCommandDescriptor, EditorCommandId } from "./commands";

/**
 * Adaptive toolbar layout: the row's fit policy and the DOM facts it consumes
 * (contract §2, revised by the #699 / PR #752 corrective).
 *
 * INVARIANT: the toolbar row never scrolls horizontally and never wraps.
 * Commands that do not fit the row's CONTENT BOX move into the single overflow
 * menu, so the row's content is always inside its container. Two consequences
 * are load-bearing:
 *
 *   - The available width is the CONTAINER's width, never a viewport
 *     breakpoint. The same editor renders in a wide admin form, in a narrow
 *     candidate answer card, and in a half-width option row inside a flex row.
 *   - The row must not be sized by its own content (`contain-inline-size` on
 *     the row in RichEditorToolbar). Without inline-size containment a long row
 *     inflates an ancestor whose automatic minimum size is content-based (the
 *     `flex:1 1 0%` option row), and the measured "available" width would be
 *     that inflated width — a state the fit could never leave.
 */

/** Physical sizes of the real controls, read from the rendered row. */
export interface ToolbarRowGeometry {
  /** Outer width (border box + horizontal margins) per command control. */
  commandWidths: Partial<Record<EditorCommandId, number>>;
  /** Outer width of one group separator, horizontal margins included. */
  separatorWidth: number;
  /** Outer width of the overflow menu trigger. */
  triggerWidth: number;
  /** Column gap between adjacent row children. */
  gap: number;
}

/**
 * How many leading commands stay in the row; the rest move into the overflow
 * menu.
 *
 * Registry order IS the priority order (`COMMAND_GROUP_ORDER` — history →
 * inline → list → insert), so the high-frequency controls stay inline longest:
 * the row keeps the longest fitting prefix. When the whole catalogue fits there
 * is no overflow and therefore no trigger — a wide container keeps the complete
 * inline toolbar with no unnecessary menu.
 *
 * A container too narrow even for the trigger keeps zero inline commands: the
 * trigger is the only control that can still reach the catalogue, so it is the
 * last one to give up its space.
 */
export function resolveInlineCount(
  commands: readonly EditorCommandDescriptor[],
  availableWidth: number,
  geometry: ToolbarRowGeometry,
): number {
  if (rowWidth(commands, geometry, false) <= availableWidth)
    return commands.length;
  let count = 0;
  for (let candidate = 1; candidate <= commands.length; candidate += 1) {
    if (
      rowWidth(commands.slice(0, candidate), geometry, true) > availableWidth
    ) {
      break;
    }
    count = candidate;
  }
  return count;
}

/**
 * Width the row's children occupy: one control per command, a separator
 * wherever the visible prefix crosses a group boundary, the gaps between them,
 * and the trigger when the row overflows.
 */
function rowWidth(
  commands: readonly EditorCommandDescriptor[],
  geometry: ToolbarRowGeometry,
  withTrigger: boolean,
): number {
  const widths: number[] = [];
  let previousGroup: EditorCommandDescriptor["group"] | null = null;
  for (const command of commands) {
    if (previousGroup !== null && previousGroup !== command.group) {
      widths.push(geometry.separatorWidth);
    }
    widths.push(geometry.commandWidths[command.id] ?? 0);
    previousGroup = command.group;
  }
  if (withTrigger) widths.push(geometry.triggerWidth);
  if (widths.length === 0) return 0;
  return (
    widths.reduce((sum, width) => sum + width, 0) +
    geometry.gap * (widths.length - 1)
  );
}

/**
 * Reads the real control geometry the row must fit.
 *
 * `measureRow` is the off-layout copy of the row rendered by the toolbar (see
 * RichEditorToolbar): it holds one control per command at its natural size, so
 * the sizes are the rendered ones — not a second, hand-maintained width table.
 * `row` is the live flex row the geometry has to describe (it owns the gap).
 *
 * The AVAILABLE width is not read here: it is a container fact and belongs to
 * the repository's single measurement owner (`useOverflowObservation`, #445 P3
 * §8 / #601 Phase F), which the toolbar consumes like any other region.
 */
export function measureToolbarGeometry(
  row: HTMLElement,
  measureRow: HTMLElement,
): ToolbarRowGeometry {
  const commandWidths: Partial<Record<EditorCommandId, number>> = {};
  let separatorWidth = 0;
  let triggerWidth = 0;
  for (const child of measureRow.children) {
    if (!(child instanceof HTMLElement)) continue;
    const width = outerWidth(child);
    const commandId = child.dataset.fitCommand as EditorCommandId | undefined;
    if (commandId !== undefined) commandWidths[commandId] = width;
    else if (child.dataset.fitSeparator !== undefined) separatorWidth = width;
    else if (child.dataset.fitTrigger !== undefined) triggerWidth = width;
  }

  return {
    commandWidths,
    separatorWidth,
    triggerWidth,
    gap: parseFloat(getComputedStyle(row).columnGap) || 0,
  };
}

/** Layout space one control occupies: its box plus its horizontal margins. */
function outerWidth(element: HTMLElement): number {
  const style = getComputedStyle(element);
  const rect = element.getBoundingClientRect();
  return (
    rect.width +
    (parseFloat(style.marginLeft) || 0) +
    (parseFloat(style.marginRight) || 0)
  );
}
