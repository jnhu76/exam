import type { LoadAttemptResponse } from "@exam/contracts";

export type CandidateQuestionSnapshot =
  LoadAttemptResponse["questionSnapshot"][number];
