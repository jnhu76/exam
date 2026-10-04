import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { MathRenderer } from "@/components/shared/content/MathRenderer";
import { MathFormulaField } from "./MathFormulaField";

/**
 * The ONE candidate formula surface (#679, contract §5). Opens from the
 * toolbar 公式 command (insert) and from clicking/Enter-activating an existing
 * formula atom (re-edit); both paths converge on the same canonical latex
 * value inside the existing math nodes.
 *
 * NO-OP POLICY (contract §5.2): MathLive normalizes latex on import, so the
 * draft value alone proves nothing. A confirm only reports an edit when the
 * user actually interacted with the field AND the resulting latex differs
 * from the originally opened source — viewing a formula can never mutate it,
 * dirty the answer, or bump the save version.
 */

/**
 * Pure decision of the no-op policy; exported for the policy regressions.
 * `userEdited` must reflect genuine user interaction with the field.
 * A mode flip (行内 ↔ 独立显示) is a semantic edit even when the latex text
 * is unchanged; for an insert, anything non-blank applies.
 */
export function shouldApplyFormulaEdit(
  target: FormulaDialogTarget | null,
  currentLatex: string,
  userEdited: boolean,
  display: boolean,
): boolean {
  if (target === null) return currentLatex.trim().length > 0;
  return (
    (userEdited && currentLatex !== target.latex) || display !== target.display
  );
}

export interface FormulaDialogTarget {
  /** The atom's current latex; "" for an insert. */
  latex: string;
  /** True when editing a blockMath (独立显示) atom. */
  display: boolean;
  /** Document position of the targeted atom (re-edit); absent for inserts. */
  pos?: number;
  /** Node size of the targeted atom (re-edit conversions replace this range). */
  nodeSize?: number;
}

export interface FormulaEditorDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** null → insert a new formula; otherwise re-edit the targeted atom. */
  target: FormulaDialogTarget | null;
  /**
   * Whether the 独立显示 mode persists in the current context. Inside list
   * items / table cells the canonical adapter downgrades blockMath to
   * inlineMath (#673 C14), so the choice must be disabled there instead of
   * silently downgrading on save.
   */
  blockAllowed: boolean;
  onConfirm: (latex: string, display: boolean) => void;
}

export function FormulaEditorDialog({
  open,
  onOpenChange,
  target,
  blockAllowed,
  onConfirm,
}: FormulaEditorDialogProps) {
  const { t } = useTranslation();
  const [latex, setLatex] = useState("");
  const [userEdited, setUserEdited] = useState(false);
  const [display, setDisplay] = useState(false);
  const [expertOpen, setExpertOpen] = useState(false);

  // Each open re-arms the surface from the targeted atom (or an empty insert);
  // closing always disarms so a stale draft can never leak into the next open.
  useEffect(() => {
    if (open) {
      setLatex(target?.latex ?? "");
      setUserEdited(false);
      setDisplay(target?.display ?? false);
      setExpertOpen(false);
    }
  }, [open, target]);

  // What the confirm would persist in this context (raw choice clamped to
  // the downgrade constraint); the preview shows the PERSISTED form.
  const persistedDisplay = display && blockAllowed;
  const isEdit = target !== null;

  function confirm() {
    // Policy gate: an unedited open closes without any editor transaction.
    // The RAW display choice is what defines "no change" — clamping it to the
    // blockAllowed context here would read a 独立显示 atom opened in a
    // downgrade context as "mode flipped" and mutate it on a zero-edit
    // confirm (review U-R1). applyFormula coerces the persisted mode to the
    // context when a real edit is applied.
    if (shouldApplyFormulaEdit(target, latex, userEdited, display)) {
      onConfirm(latex, display && blockAllowed);
    }
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md" data-testid="formula-dialog">
        <DialogHeader>
          <DialogTitle>
            {isEdit
              ? t("content.formula.editTitle")
              : t("content.formula.insertTitle")}
          </DialogTitle>
          <DialogDescription>
            {t("content.formula.description")}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <MathFormulaField
            key={`${open}-${target?.latex ?? ""}`}
            initialLatex={latex}
            onInput={(value) => {
              setUserEdited(true);
              setLatex(value);
            }}
            onEscape={() => onOpenChange(false)}
          />

          <div className="flex flex-wrap items-center gap-2">
            <span className="type-secondary">
              {t("content.formula.modeLabel")}
            </span>
            <label className="inline-flex cursor-pointer items-center gap-1.5">
              <input
                type="radio"
                name="formula-display-mode"
                checked={!display}
                onChange={() => setDisplay(false)}
              />
              <span className="type-body">
                {t("content.formula.modeInline")}
              </span>
            </label>
            <label
              className={`inline-flex items-center gap-1.5 ${
                blockAllowed
                  ? "cursor-pointer"
                  : "cursor-not-allowed opacity-50"
              }`}
              title={
                blockAllowed
                  ? undefined
                  : t("content.formula.modeBlockUnavailableHint")
              }
            >
              <input
                type="radio"
                name="formula-display-mode"
                checked={display}
                onChange={() => setDisplay(true)}
                disabled={!blockAllowed}
                aria-disabled={!blockAllowed}
              />
              <span className="type-body">
                {t("content.formula.modeBlock")}
              </span>
            </label>
          </div>
          {!blockAllowed && (
            <p className="type-secondary" role="note">
              {t("content.formula.modeBlockUnavailableHint")}
            </p>
          )}

          <div>
            <Button
              type="button"
              variant="ghost"
              size="xs"
              onClick={() => setExpertOpen((v) => !v)}
              aria-expanded={expertOpen}
              data-testid="formula-expert-toggle"
            >
              {expertOpen
                ? t("content.formula.expertHide")
                : t("content.formula.expertShow")}
            </Button>
            {expertOpen && (
              <div className="mt-2 flex flex-col gap-2">
                <Label htmlFor="formula-expert-source">
                  {t("content.formula.expertLabel")}
                </Label>
                <textarea
                  id="formula-expert-source"
                  className="type-code min-h-20 w-full rounded-md border border-input bg-transparent px-3 py-2 outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
                  value={latex}
                  onChange={(e) => {
                    setUserEdited(true);
                    setLatex(e.target.value);
                  }}
                  data-testid="formula-expert-source"
                />
                <div className="flex flex-col gap-1">
                  <span className="type-metadata">
                    {t("content.formula.previewLabel")}
                  </span>
                  <div
                    className="rounded-md border border-border bg-card px-3 py-2"
                    data-testid="formula-expert-preview"
                  >
                    {latex.trim() ? (
                      <MathRenderer
                        latex={latex}
                        displayMode={persistedDisplay}
                      />
                    ) : (
                      <span className="type-secondary">
                        {t("content.formula.previewEmpty")}
                      </span>
                    )}
                  </div>
                  <span className="type-metadata" role="status">
                    {t("content.formula.renderWarningNote")}
                  </span>
                </div>
              </div>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
          >
            {t("content.formula.cancel")}
          </Button>
          <Button type="button" onClick={confirm} data-testid="formula-confirm">
            {t("content.formula.confirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
