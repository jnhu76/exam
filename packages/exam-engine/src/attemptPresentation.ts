import type { ControlFlags, QuestionSnapshot } from "@exam/domain";

/**
 * #294 — injectable RNG seam. Returns a number in [0, 1). Production uses
 * Math.random; tests inject a fixed sequence so permutations are proven
 * deterministically instead of by probability.
 */
export type RandomSource = () => number;

/** Fisher–Yates on a copy. Never mutates the input array. */
function shuffledCopy<T>(items: readonly T[], rng: RandomSource): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i -= 1) {
    // rng is contractually [0, 1), so j ∈ [0, i]. Zero/one-element arrays
    // skip the loop entirely (no negative index, no division).
    const j = Math.floor(rng() * (i + 1));
    const tmp = result[i]!;
    result[i] = result[j]!;
    result[j] = tmp;
  }
  return result;
}

const CHOICE_TYPES: ReadonlySet<string> = new Set([
  "single_choice",
  "multiple_choice",
]);

/**
 * #294 — materialize the per-attempt presentation order from the published
 * exam snapshot. Called ONLY at new-attempt creation; resume/restore replay
 * the frozen `attempt.questionSnapshot` and never call this again.
 *
 * - shuffleQuestions: reorders the question array and renormalizes
 *   `order` to 0..n-1 so array order === order-field order.
 * - shuffleOptions: reorders `options[]` for single_choice/multiple_choice
 *   only; fill_blank/true_false/text_response have no option-order semantic
 *   and stay unchanged (mixed exams are legal).
 * - Both dimensions are independent; a false flag preserves that
 *   dimension's published order.
 *
 * INVARIANT: identity never moves. originalQuestionId, option.id,
 * standardAnswer, gradingRule, score, rubric, and content are copied
 * verbatim — order is presentation state only.
 *
 * INVARIANT: the published snapshot is never mutated. Questions and option
 * arrays are copied before any shuffle, so no other attempt and no exam
 * truth can observe this attempt's draw.
 */
export function materializeAttemptPresentation(
  publishedSnapshot: readonly QuestionSnapshot[],
  controlFlags: ControlFlags,
  rng: RandomSource = Math.random,
): QuestionSnapshot[] {
  let questions = publishedSnapshot.map((q) => ({
    ...q,
    options: [...q.options],
  }));

  if (controlFlags.shuffleQuestions) {
    questions = shuffledCopy(questions, rng).map((q, index) => ({
      ...q,
      order: index,
    }));
  }

  if (controlFlags.shuffleOptions) {
    questions = questions.map((q) =>
      CHOICE_TYPES.has(q.type)
        ? { ...q, options: shuffledCopy(q.options, rng) }
        : q,
    );
  }

  return questions;
}
