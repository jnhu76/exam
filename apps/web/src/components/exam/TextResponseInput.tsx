import { SubjectiveAnswerInput } from "./SubjectiveAnswerInput";

/**
 * Multi-line textarea input for `text_response` questions.
 *
 * Wraps `SubjectiveAnswerInput`, which already implements a textarea with
 * label, character count, and readOnly support. Newlines are preserved by
 * the underlying `<Textarea>` (native textarea behavior — no normalization).
 *
 * Protocol compliance (docs/architecture/exam-runtime.md §1.5/§1.6):
 * - newline-preserving on save/restore (default textarea behavior)
 * - read-only post-submit is driven by the `disabled` prop (mapped to
 *   SubjectiveAnswerInput's `readOnly`)
 * - no `dangerouslySetInnerHTML` (pure React text content)
 * - submitted values render with `white-space: pre-wrap` at the consumer
 *   (read-only display path is owned by the result view, not here, via
 *   ReadOnlyLongText / the type-long-response recipe)
 */
export function TextResponseInput({
  value,
  onChange,
  disabled = false,
}: {
  value: string | undefined;
  onChange: (answer: unknown) => void;
  disabled?: boolean;
}) {
  return (
    <SubjectiveAnswerInput
      value={value ?? ""}
      onChange={onChange}
      readOnly={disabled}
    />
  );
}
