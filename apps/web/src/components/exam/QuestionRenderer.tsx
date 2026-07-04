import { useTranslation } from "react-i18next";
import { SingleChoiceInput } from "./SingleChoiceInput";
import { MultipleChoiceInput } from "./MultipleChoiceInput";
import { FillBlankInput } from "./FillBlankInput";
import { TrueFalseInput } from "./TrueFalseInput";
import { TextResponseInput } from "./TextResponseInput";
import type { CandidateQuestionSnapshot } from "@/lib/examTypes";

/**
 * Dispatches to the appropriate input component based on question type
 * (single_choice, multiple_choice, fill_blank, true_false, text_response).
 */
export function QuestionRenderer({
  question,
  answer,
  onChange,
  disabled = false,
}: {
  question: CandidateQuestionSnapshot;
  answer: unknown;
  onChange: (answer: unknown) => void;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  switch (question.type) {
    case "single_choice":
      return (
        <SingleChoiceInput
          options={question.options}
          value={answer as string | undefined}
          onChange={onChange}
          disabled={disabled}
        />
      );
    case "multiple_choice":
      return (
        <MultipleChoiceInput
          options={question.options}
          value={(answer as string[]) ?? []}
          onChange={onChange}
          disabled={disabled}
        />
      );
    case "fill_blank":
      return (
        <FillBlankInput
          content={question.content}
          blanks={Array.isArray(question.options) ? question.options : []}
          value={(answer as Record<string, string> | string | undefined) ?? {}}
          onChange={onChange}
          disabled={disabled}
        />
      );
    case "true_false":
      return (
        <TrueFalseInput
          value={answer as boolean | undefined}
          onChange={onChange}
          disabled={disabled}
        />
      );
    case "text_response":
      return (
        <TextResponseInput
          value={answer as string | undefined}
          onChange={onChange}
          disabled={disabled}
        />
      );
    default:
      return (
        <p className="text-sm text-destructive">
          {t("candidateRuntime.answer.unsupportedType", {
            type: question.type,
          })}
        </p>
      );
  }
}
