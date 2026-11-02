import {
  createContext,
  useContext,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useTranslation } from "react-i18next";
import { useOverflowObservation } from "@/hooks/useOverflowObservation";
import { cn } from "@/lib/utils";

/**
 * The keyboard-focus contract for horizontal rich-content scroll regions.
 *
 * A collapsed disclosure that actually clips its preview with
 * `overflow-hidden` must not admit focus into content the user cannot see
 * (WCAG 2.4.11), and focusing a nested scroller must never scroll the clipped
 * preview. The disclosure owner therefore provides `!clipped` here; the
 * default (true) keeps every other read surface unchanged, and a collapsed
 * preview that hides nothing stays focusable.
 */
export const ContentScrollFocusContext = createContext(true);

export type ContentScrollViewportProps = {
  children: ReactNode;
  /**
   * Math must never wrap: a wrapped formula is a different formula. This also
   * makes the viewport's intrinsic width correct before KaTeX's lazily-loaded
   * stylesheet applies (the fallback and the first styled frame agree), so the
   * initial overflow measurement cannot latch a false "fits".
   */
  nowrap?: boolean;
  /** Presentation classes owned by the content block. */
  className?: string;
} & (
  | {
      /** A display formula or a table. */
      kind: "block";
      labelKey: "content.scrollRegion.formula" | "content.scrollRegion.table";
    }
  | {
      /** An inline formula. */
      kind: "inline";
      labelKey: "content.scrollRegion.inlineFormula";
    }
  | {
      /** The code block's own `<pre>` (a single scroll owner). */
      kind: "code";
      labelKey: "content.scrollRegion.code";
    }
);

/**
 * The single horizontal scroll owner for rich content (#S2.4 / R2+R3+R4+R7).
 *
 * INVARIANT (layout): the viewport is a width-constrained child of its
 * content block. `min-w-0` + `max-w-full` make it shrink to the space the
 * surrounding layout actually gives it; without them a flex/grid ancestor's
 * automatic minimum size lets KaTeX, code or a table expand the viewport to
 * max-content and paint over the neighbouring cell. Overflow is handled HERE,
 * locally, never by widening the page or clipping the content away.
 *
 * INVARIANT (keyboard/ARIA): the viewport is an explicit tab stop only while
 * `useOverflowObservation` reports real horizontal overflow. Setting
 * `tabIndex={-1}` otherwise (rather than omitting the attribute) is deliberate:
 * Chrome's scroll-container focus heuristic would otherwise add every
 * overflowing scroller to the tab order even inside a clipped disclosure, and
 * would do so inconsistently across browsers. Short content therefore adds no
 * interaction burden, and a clipped collapsed preview admits no focus. When
 * focusable,
 * a short `group` label names the content type and the horizontal operation;
 * the label does not repeat the formula, and KaTeX's MathML remains the one
 * accessible copy (its HTML projection is aria-hidden).
 *
 * The measurement reuses the shared facts-only authority
 * (`useOverflowObservation`), the same owner the data-table surface uses. No
 * second overflow-detection policy is introduced here.
 */
export function ContentScrollViewport({
  kind,
  labelKey,
  children,
  nowrap = false,
  className,
}: ContentScrollViewportProps) {
  const { t } = useTranslation();
  const focusable = useContext(ContentScrollFocusContext);
  const ref = useRef<HTMLElement | null>(null);
  // KaTeX inline boxes measure ~2px of scrollable overflow from italic
  // correction / rounding even when nothing is missing. A threshold below
  // that would turn every inline formula into a tab stop and paint a
  // scrollbar into the middle of a paragraph. Only a real, readable amount of
  // hidden content may become an interaction.
  const observation = useOverflowObservation(ref, kind === "inline" ? 4 : 2);
  // Content/font re-measure (lazy KaTeX boundary + web font swap). The
  // viewport does not re-render when the lazy KaTeX chunk replaces its
  // fallback, and KaTeX's stylesheet can change the formula width without a
  // DOM mutation; a web-font swap can do the same to a table. Neither is
  // visible to the shared measurement effect in useOverflowObservation (the
  // observed boxes keep their size while the scrollable width grows). Every
  // signal only increments a revision; the shared measurement authority still
  // owns the facts.
  const [, setContentRevision] = useState(0);
  useLayoutEffect(() => {
    const region = ref.current;
    if (!region) return;
    let cancelled = false;
    const bump = () => {
      if (!cancelled) setContentRevision((revision) => revision + 1);
    };
    const bumpAfterFonts = () => {
      bump();
      if (typeof document !== "undefined" && document.fonts) {
        void document.fonts.ready.then(bump).catch(() => undefined);
      }
    };
    const observer =
      typeof MutationObserver === "undefined"
        ? null
        : new MutationObserver(bumpAfterFonts);
    observer?.observe(region, { childList: true, subtree: true });
    // The lazy KaTeX boundary inserts the rendered formula, then its
    // stylesheet/font can still change the measured width. `loadingdone`
    // catches the font that finishes after that insertion; `ready` covers a
    // font set already loading at mount. The guards keep jsdom safe.
    // Budget: one document-level listener per content block — the
    // ContentDocumentV1 node limit bounds the count, and there is no polling.
    if (typeof document !== "undefined" && document.fonts) {
      void document.fonts.ready.then(bump).catch(() => undefined);
      document.fonts.addEventListener?.("loadingdone", bumpAfterFonts);
      document.fonts.addEventListener?.("loadingerror", bumpAfterFonts);
    }
    return () => {
      cancelled = true;
      observer?.disconnect();
      document.fonts?.removeEventListener?.("loadingdone", bumpAfterFonts);
      document.fonts?.removeEventListener?.("loadingerror", bumpAfterFonts);
    };
    // `kind` changes replace the span/div/pre element; the observer must
    // attach to the new node rather than the detached one.
  }, [kind]);
  const interactive = focusable && observation.overflowing;

  // Always supply an explicit tabIndex: for a scroll container, the absence
  // of the attribute is NOT "not focusable" in current Chromium.
  const focusProps = interactive
    ? {
        tabIndex: 0,
        role: "group" as const,
        "aria-label": t(labelKey),
      }
    : { tabIndex: -1 };

  const viewportClassName = cn(
    "min-w-0 max-w-full overscroll-x-contain outline-none",
    // Visible, 3:1+ focus feedback (WCAG 2.4.7 / 1.4.11). An outline (not a
    // box-shadow ring) survives forced-colors mode. The parent no longer
    // clips horizontally when focus is allowed (AnswerDisclosure only clips
    // while it suppresses focus), so the 2px offset stays visible.
    "focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-primary",
    nowrap && "whitespace-nowrap",
    // Inline formulas live inside running text: a classic scrollbar would
    // change the line height and read as a layout fault. Keep the region
    // scrollable by keyboard and trackpad, hide the chrome, and let the
    // visible focus ring + the clipped edge be the affordance. Block content
    // keeps its native scrollbar.
    //
    // `align-middle` is not cosmetic: an inline-block's baseline is its bottom
    // margin edge, which lifts the formula relative to the line and inflates
    // the line box (measured 29.6px vs the 22.8px natural line). Middle keeps
    // the text position within 0.8px of the plain-inline reference.
    kind === "inline" &&
      "inline-block overflow-x-auto overflow-y-hidden align-middle [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
    kind === "block" && "my-2 block w-full overflow-x-auto",
    kind === "code" && "type-code my-2 block w-full overflow-x-auto",
    className,
  );

  const sharedProps = {
    ...focusProps,
    "data-slot": "content-scroll-viewport",
    "data-kind": kind,
    "data-overflowing": String(observation.overflowing),
    className: viewportClassName,
  };

  const setRef = (node: HTMLElement | null) => {
    ref.current = node;
  };

  if (kind === "inline") {
    return (
      <span ref={setRef} {...sharedProps}>
        {children}
      </span>
    );
  }
  if (kind === "code") {
    return (
      <pre ref={setRef} {...sharedProps}>
        {children}
      </pre>
    );
  }
  return (
    <div ref={setRef} {...sharedProps}>
      {children}
    </div>
  );
}
