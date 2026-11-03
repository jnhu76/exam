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
  /**
   * Viewport band (CSS px) the MathLive virtual keyboard currently occupies,
   * 0 when hidden. MathLive pins the keyboard to the browser viewport and only
   * compensates document flow (body padding-bottom), so a fixed-position
   * modal has to reserve the band itself (#882).
   */
  onKeyboardInsetChange?: (inset: number) => void;
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
  onKeyboardInsetChange,
  disabled = false,
}: MathFormulaFieldProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const fieldRef = useRef<import("mathlive").MathfieldElement | null>(null);

  useEffect(() => {
    let disposed = false;
    let detachKeyboard: (() => void) | undefined;
    void loadMathlive().then(({ MathfieldElement }) => {
      const container = containerRef.current;
      if (disposed || !container) return;
      const field = new MathfieldElement();
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
      // The custom element upgrades on connection — value and focus are only
      // legal AFTER appendChild ("Mathfield not mounted" otherwise). The
      // initial value is applied on the connected instance; focus lands on
      // the next frame so the upgraded field owns its key handling first.
      container.appendChild(field);
      // Menu contents are editing-surface affordances outside the frozen
      // command contract — remove rather than expose unreviewed actions.
      // Set on the CONNECTED element: pre-connect option writes route through
      // MathLive's deferred-state replay, which can trip pre-mount getters.
      field.menuItems = [];
      field.value = initialLatex;
      fieldRef.current = field;

      // OWNERSHIP: the keyboard is a singleton shared by every mathfield in
      // the document, so its band is observed on the MathLive keyboard object
      // (its documented event target) and reported for the lifetime of THIS
      // field only. `virtual-keyboard-toggle` covers show/hide (a hide does
      // not rewrite the geometry it reports), `geometrychange` covers the
      // keyboard being resized or its layout swapped while open.
      const keyboard = window.mathVirtualKeyboard;
      const reportInset = () => {
        if (disposed) return;
        onKeyboardInsetChange?.(
          keyboard.visible ? Math.round(keyboard.boundingRect.height) : 0,
        );
      };
      keyboard.addEventListener("virtual-keyboard-toggle", reportInset);
      keyboard.addEventListener("geometrychange", reportInset);
      // INITIAL SYNC: a field mounted while the keyboard is ALREADY visible
      // (dialog reopened inside MathLive's hide window, or a remount) observes
      // no transition event, so without this the band stays unreserved and
      // the footer reopens under the keyboard (#882).
      reportInset();
      detachKeyboard = () => {
        keyboard.removeEventListener("virtual-keyboard-toggle", reportInset);
        keyboard.removeEventListener("geometrychange", reportInset);
      };

      requestAnimationFrame(() => {
        if (!disposed) {
          try {
            field.focus();
          } catch {
            // A lost upgrade race must never crash the surface — the field
            // remains focusable by click/keyboard.
          }
        }
      });
    });
    return () => {
      disposed = true;
      detachKeyboard?.();
      // The surface is unmounting with the dialog: no band may stay reserved.
      onKeyboardInsetChange?.(0);
      fieldRef.current?.remove();
      fieldRef.current = null;
    };
    // The field is created once per mounted surface; latex flows OUT through
    // onInput, never back in (the surface owns the draft state).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <div ref={containerRef} className="min-h-20" />;
}
