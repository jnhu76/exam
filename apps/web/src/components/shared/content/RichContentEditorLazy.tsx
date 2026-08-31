import { lazy, Suspense } from "react";
import { useTranslation } from "react-i18next";
import type { ContentDocumentV1 } from "@exam/domain";

/**
 * Chunk boundary for the WYSIWYG editor (issue 301). ALL Tiptap/ProseMirror
 * imports live behind this lazy import: pages that never enter EDIT mode
 * (candidate READ, plain answers, grading READ) never download the editor
 * chunk. Loading shows an inert placeholder — no editor semantics are
 * available until the chunk resolves.
 */
const RichContentEditor = lazy(() => import("./RichContentEditor"));

/** Props for the lazy rich editor. */
export type RichContentEditorLazyProps = {
  initialDocument: ContentDocumentV1;
  onChange: (document: ContentDocumentV1) => void;
  disabled?: boolean;
  ariaLabel?: string;
};

export function RichContentEditorLazy(props: RichContentEditorLazyProps) {
  const { t } = useTranslation();
  return (
    <Suspense
      fallback={
        <div
          role="status"
          className="type-body min-h-32 w-full rounded-md border border-input bg-transparent px-3 py-2"
        >
          {t("content.editor.loading")}
        </div>
      }
    >
      <RichContentEditor {...props} />
    </Suspense>
  );
}
