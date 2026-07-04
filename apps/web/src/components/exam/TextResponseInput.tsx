import { SubjectiveAnswerInput } from "./SubjectiveAnswerInput";

/**
 * Multi-line textarea input for `text_response` questions (P3-MOD-P0-2).
 *
 * Wraps `SubjectiveAnswerInput`, which already implements a textarea with
 * label, character count, and readOnly support. Newlines are preserved by
 * the underlying `<Textarea>` (native textarea behavior — no normalization).
 *
 * Protocol compliance (exam-protocol.md §8.2):
 * - newline-preserving on save/restore (default textarea behavior)
 * - read-only post-submit is driven by the `disabled` prop
 * - no `dangerouslySetInnerHTML` (pure React text content)
 * - submitted values render with `white-space: pre-wrap` at the consumer
 *   (read-only display path is owned by the result view, not here)
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
      value={value}
      onChange={onChange}
      readOnly={disabled}
    />
  );
}
