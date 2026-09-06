import { ruleTester } from "../../ruleTester";
import rule from "../no-dialog-spatial-override";

/**
 * no-dialog-spatial-override tests (P3 §12 dialog contract, issue 459).
 *
 * The rule is import-anchored: it only fires in files that import
 * DialogContent / AlertDialogContent from the ui primitives.
 */
const ANCHORED_IMPORT = `import { DialogContent } from "@/components/ui/dialog";\n`;

ruleTester().run("no-dialog-spatial-override", rule, {
  valid: [
    // 1. Size vocabulary, no geometry utilities.
    `${ANCHORED_IMPORT}<DialogContent size="lg">x</DialogContent>`,
    // 2. Non-spatial className is fine.
    `${ANCHORED_IMPORT}<DialogContent className="p-0">x</DialogContent>`,
    // 3. Same element name WITHOUT the ui/dialog import is not the primitive.
    `<DialogContent className="max-w-2xl">x</DialogContent>`,
    // 4. Other elements may own their own geometry.
    `${ANCHORED_IMPORT}<div className="max-h-48 overflow-auto">x</div>`,
    // 5. Purely dynamic className.
    `${ANCHORED_IMPORT}<DialogContent className={dyn}>x</DialogContent>`,
  ],
  invalid: [
    // A. Bare max-w override.
    {
      code: `${ANCHORED_IMPORT}<DialogContent className="max-w-sm">x</DialogContent>`,
      errors: [
        { messageId: "noDialogSpatialOverride", data: { token: "max-w-sm" } },
      ],
    },
    // B. Responsive-prefixed variant.
    {
      code: `${ANCHORED_IMPORT}<DialogContent className="sm:max-w-lg">x</DialogContent>`,
      errors: [
        {
          messageId: "noDialogSpatialOverride",
          data: { token: "sm:max-w-lg" },
        },
      ],
    },
    // C. Page-local scroll contract on the content.
    {
      code: `${ANCHORED_IMPORT}<DialogContent className="max-h-[80vh] overflow-y-auto">x</DialogContent>`,
      errors: [
        {
          messageId: "noDialogSpatialOverride",
          data: { token: "max-h-[80vh]" },
        },
        {
          messageId: "noDialogSpatialOverride",
          data: { token: "overflow-y-auto" },
        },
      ],
    },
    // D. AlertDialogContent anchored via the alert-dialog import.
    {
      code: `import { AlertDialogContent } from "@/components/ui/alert-dialog";\n<AlertDialogContent className="max-w-2xl">x</AlertDialogContent>`,
      errors: [
        {
          messageId: "noDialogSpatialOverride",
          data: { token: "max-w-2xl" },
        },
      ],
    },
  ],
});
