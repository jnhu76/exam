import { SingleChoiceInput } from "./SingleChoiceInput";
import { MultipleChoiceInput } from "./MultipleChoiceInput";
import { FillBlankInput } from "./FillBlankInput";
import { TrueFalseInput } from "./TrueFalseInput";
import type { CandidateQuestionSnapshot } from "@/lib/examTypes";

export function QuestionRenderer({
  question,
  answer,
  onChange,
}: {
  question: CandidateQuestionSnapshot;
  answer: unknown;
  onChange: (answer: unknown) => void;
}) {
  switch (question.type) {
    case "single_choice":
      return (
        <SingleChoiceInput
          options={question.options}
          value={answer as string | undefined}
          onChange={onChange}
        />
      );
    case "multiple_choice":
      return (
        <MultipleChoiceInput
          options={question.options}
          value={(answer as string[]) ?? []}
          onChange={onChange}
        />
      );
    case "fill_blank":
      return (
        <FillBlankInput
          blanks={question.options}
          value={(answer as Record<string, string>) ?? {}}
          onChange={onChange}
        />
      );
    case "true_false":
      return (
        <TrueFalseInput
          value={answer as boolean | undefined}
          onChange={onChange}
        />
      );
  }
}
