import type { SaveAnswerRejectReason } from "./attempt.js";

export const saveAnswerMessages: Record<SaveAnswerRejectReason, string> = {
  STALE_VERSION: "服务器上存在更新的答案版本",
  ATTEMPT_ALREADY_SUBMITTED: "考试已提交，不能继续保存答案",
  ATTEMPT_CLOSED: "考试已结束",
  DEADLINE_EXCEEDED: "考试时间已到",
};

export function getSaveAnswerMessage(reason: SaveAnswerRejectReason): string {
  return saveAnswerMessages[reason];
}
