import type { LoadAttemptResponse } from "@exam/contracts";

/** A single question snapshot item as received by candidates during an exam attempt. */
export type CandidateQuestionSnapshot =
  LoadAttemptResponse["questionSnapshot"][number];
