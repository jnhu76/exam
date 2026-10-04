import { useEffect, useRef } from "react";

/**
 * Lazy bridge to the MathLive visual math field (#669 phase U contract §5).
 *
 * The runtime AND its fonts join the bundle only when the formula surface is
 * first opened — vite.config.ts keeps `mathlive` out of the eager vendor
 * chunk, and this module is reachable only from FormulaEditorDialog. Assets
 * resolve from the deployment's own bundle (LAN constraint): fonts via the
 * imported CSS @font-face rules, sounds disabled outright.
 */

type MathliveModule = typeof import("mathlive");

let mathlivePromise: Promise<MathliveModule> | null = null;

function loadMathlive(): Promise<MathliveModule> {
  mathlivePromise ??= Promise.all([
    import("mathlive"),
    import("mathlive/fonts.css"),
  ]).then(([runtime]) => {
    // Fonts load through the bundled @font-face CSS; the optional sound
    // assets have no candidate value in an exam runtime — never fetch them.
    runtime.MathfieldElement.soundsDirectory = null;
    return runtime;
  });
  return mathlivePromise;
}

export interface MathFormulaFieldProps {
  /** Initial latex. Applied once at mount; edits flow out via onInput. */
  initialLatex: string;
  /** Fires on every USER edit with the current latex (never on mount). */
  onInput: (latex: string) => void;
  onEscape: () => void;
  disabled?: boolean;
}

/**
 * The visual math editing field. The candidate types/edits math directly
 * (fractions, roots, exponents render as they are typed); the latex value is
 * a projection of the field, never displayed as a requirement to use it.
 */
export function MathFormulaField({
  initialLatex,
  onInput,
  onEscape,
  disabled = false,
}: MathFormulaFieldProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const fieldRef = useRef<import("mathlive").MathfieldElement | null>(null);

  useEffect(() => {
    let disposed = false;
    void loadMathlive().then(({ MathfieldElement }) => {
      const container = containerRef.current;
      if (disposed || !container) return;
      const field = new MathfieldElement();
      // Menu contents are editing-surface affordances outside the frozen
      // command contract — remove rather than expose unreviewed actions.
      field.menuItems = [];
      field.value = initialLatex;
      field.disabled = disabled;
      field.addEventListener("input", () => {
        onInput(field.value);
      });
      // MathLive handles Escape for its own popups (and marks the event
      // defaultPrevented); only when the key falls through does it close the
      // dialog — an unconfirmed draft must survive closing an in-field popup
      // (review U-R8).
      field.addEventListener("keydown", (event: KeyboardEvent) => {
        if (event.key === "Escape" && !event.defaultPrevented) onEscape();
      });
      container.appendChild(field);
      fieldRef.current = field;
      field.focus();
    });
    return () => {
      disposed = true;
      fieldRef.current?.remove();
      fieldRef.current = null;
    };
    // The field is created once per mounted surface; latex flows OUT through
    // onInput, never back in (the surface owns the draft state).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <div ref={containerRef} className="min-h-20" />;
}
