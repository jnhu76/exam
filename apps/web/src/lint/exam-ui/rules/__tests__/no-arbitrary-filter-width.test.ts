import { ruleTester } from "../../ruleTester";
import rule from "../no-arbitrary-filter-width";

/**
 * no-arbitrary-filter-width tests (issue 458, P3 §C toolbar).
 *
 * The rule is import-anchored (fires only in files importing DataToolbar) and
 * JSX-descendant-aware (fires only for filter controls INSIDE <DataToolbar>).
 */
const ANCHORED_IMPORT =
  'import { DataToolbar, ToolbarFilter } from "@/components/shared/DataToolbar";\n';

ruleTester().run("no-arbitrary-filter-width", rule, {
  valid: [
    // 1. Semantic tier, no page width.
    `${ANCHORED_IMPORT}<DataToolbar><ToolbarFilter size="narrow"><SelectTrigger /></ToolbarFilter></DataToolbar>`,
    // 2. Standard utilities on controls are fine (w-full is not arbitrary).
    `${ANCHORED_IMPORT}<DataToolbar><SelectTrigger className="w-full" /></DataToolbar>`,
    // 3. Same element WITHOUT the DataToolbar import is not in scope.
    `<DataToolbar><SelectTrigger className="w-[180px]" /></DataToolbar>`,
    // 4. A control OUTSIDE DataToolbar (form/dialog) keeps structural widths.
    `${ANCHORED_IMPORT}<div><SelectTrigger className="w-[200px]" /></div>`,
    // 5. Non-control elements inside the toolbar may own structural widths.
    `${ANCHORED_IMPORT}<DataToolbar><span className="min-w-[5.5rem]" /></DataToolbar>`,
    // 6. A DataToolbar imported but controls used in a sibling component.
    `${ANCHORED_IMPORT}<div><DataToolbar><SomePanel /></DataToolbar><SelectTrigger className="w-[150px]" /></div>`,
    // 7. Named width utilities are not arbitrary.
    `${ANCHORED_IMPORT}<DataToolbar><SelectTrigger className="sm:w-72" /></DataToolbar>`,
  ],
  invalid: [
    // A. The canonical offender from the issue.
    {
      code: `${ANCHORED_IMPORT}<DataToolbar><SelectTrigger className="w-[180px]" /></DataToolbar>`,
      errors: [
        { messageId: "noArbitraryFilterWidth", data: { token: "w-[180px]" } },
      ],
    },
    // B. Responsive-prefixed arbitrary width.
    {
      code: `${ANCHORED_IMPORT}<DataToolbar><SelectTrigger className="w-auto lg:w-[150px]" /></DataToolbar>`,
      errors: [
        {
          messageId: "noArbitraryFilterWidth",
          data: { token: "lg:w-[150px]" },
        },
      ],
    },
    // C. Bare <input> filter inside the toolbar.
    {
      code: `${ANCHORED_IMPORT}<DataToolbar><input className="w-[180px]" /></DataToolbar>`,
      errors: [
        { messageId: "noArbitraryFilterWidth", data: { token: "w-[180px]" } },
      ],
    },
    // D. Shared TagFilterSelect used inside the toolbar.
    {
      code: `${ANCHORED_IMPORT}<DataToolbar><TagFilterSelect className="w-[180px]" /></DataToolbar>`,
      errors: [
        { messageId: "noArbitraryFilterWidth", data: { token: "w-[180px]" } },
      ],
    },
    // E. Input primitive with an arbitrary rem width.
    {
      code: `${ANCHORED_IMPORT}<DataToolbar><Input className="w-[11.25rem]" /></DataToolbar>`,
      errors: [
        {
          messageId: "noArbitraryFilterWidth",
          data: { token: "w-[11.25rem]" },
        },
      ],
    },
    // F. Nested inside a fragment within the toolbar.
    {
      code: `${ANCHORED_IMPORT}<DataToolbar><><SelectTrigger className="w-[150px]" /></></DataToolbar>`,
      errors: [
        { messageId: "noArbitraryFilterWidth", data: { token: "w-[150px]" } },
      ],
    },
  ],
});
