import type { TFunction } from "i18next";
import { instantToLocalInput, localInputToInstant } from "./dateTime";

/** i18next's translation function; callers pass `t` straight through. */
export type ScheduleFieldTranslateFn = TFunction;

/**
 * Resolution of one schedule wall clock for exam authoring (#971 F-20).
 *
 * `unchanged` is the edit-preservation contract: the current input value is
 * byte-identical to the scheduling-zone fill-back of the stored instant, so
 * the caller must send the ORIGINAL instant (seconds and DST-overlap side
 * included) instead of re-converting the wall clock.
 */
export type ScheduleFieldStatus =
  | "empty"
  | "unchanged"
  | "ok"
  | "dst-gap"
  | "ambiguous"
  | "invalid";

export interface ScheduleFieldResolution {
  status: ScheduleFieldStatus;
  /** ok → resolved instant; unchanged → the original instant; else null. */
  instant: string | null;
  changed: boolean;
}

/**
 * Resolves one `datetime-local` wall clock against the optional stored
 * instant (edit) through the scheduling seam in `timeZone`. Wall clocks
 * without a unique resolution (DST gap/overlap, impossible dates) never
 * snap to a side — the caller surfaces `scheduleFieldHint` and blocks.
 */
export function resolveScheduleField(
  currentWall: string,
  originalInstant: string | null,
  timeZone: string,
): ScheduleFieldResolution {
  if (
    originalInstant &&
    instantToLocalInput(originalInstant, timeZone) === currentWall
  ) {
    return { status: "unchanged", instant: originalInstant, changed: false };
  }
  if (!currentWall) {
    return { status: "empty", instant: null, changed: true };
  }
  const resolution = localInputToInstant(currentWall, timeZone);
  return resolution.kind === "unique"
    ? { status: "ok", instant: resolution.instant, changed: true }
    : { status: resolution.kind, instant: null, changed: true };
}

/**
 * Understandable field message for a wall clock that does not resolve to a
 * unique instant in the scheduling zone; the message names the zone. Null
 * for statuses that need no hint (empty/unchanged/ok).
 */
export function scheduleFieldHint(
  status: ScheduleFieldStatus,
  timeZone: string,
  t: ScheduleFieldTranslateFn,
): string | null {
  switch (status) {
    case "dst-gap":
      return t("admin.forms.exam.scheduleDstGap", { timeZone });
    case "ambiguous":
      return t("admin.forms.exam.scheduleDstAmbiguous", { timeZone });
    case "invalid":
      return t("admin.forms.exam.scheduleInvalid");
    default:
      return null;
  }
}
