import type { Mock } from "vitest";

/**
 * Pure helpers for the per-file vi.mock("@/lib/api") factories of the
 * TakeExamPage test family. This module deliberately imports NOTHING from
 * the app: each suite's vi.mock factory dynamically imports it, and any
 * transitive import of "@/lib/api" (directly, or via AuthContext /
 * BrandProvider) would re-enter the very factory being executed and deadlock
 * the module graph. That is also why the fixture/provider helpers live in
 * TakeExamPage.testHarness.tsx and are only ever imported statically.
 *
 * OWNERSHIP: apiGet/apiPost are the caller's vi.hoisted spy instances and
 * postMeta the caller's mutable holder. Nothing here creates, stores, or
 * resets a mock instance — every mock and its beforeEach reset stay owned by
 * the importing test file.
 */

/**
 * The maximal-shape ApiError stub every suite's vi.mock("@/lib/api") factory
 * shares. INVARIANT (equivalence basis of the single shape): TakeExamPage
 * consumes ApiError only via instanceof / .status / .requestId
 * (classifyWireFailure and the save catch path); it never reads .message or
 * .serverMessage and does not import lib/apiErrors — the sole serverMessage
 * reader. Omitting constructor args therefore keeps behavior identical to a
 * reduced stub: requestId stays undefined and serverMessage is never read.
 */
export function makeApiErrorStub() {
  return class ApiError extends Error {
    readonly status: number;
    readonly message: string;
    readonly code?: string;
    readonly details?: unknown;
    readonly requestId?: string;
    readonly serverMessage?: string;
    constructor(
      status: number,
      message: string,
      code?: string,
      details?: unknown,
      requestId?: string,
      serverMessage?: string,
    ) {
      super(message);
      this.name = "ApiError";
      this.status = status;
      this.message = message;
      this.code = code;
      this.details = details;
      this.requestId = requestId;
      this.serverMessage = serverMessage ?? message;
    }
  };
}

/**
 * The api module half every suite's vi.mock("@/lib/api") factory returns:
 * get/post delegate to the file-owned spies, postWithMeta delegates to the
 * SAME apiPost spy so url/body/throw assertions stay single-sourced (#924),
 * and setNavigate is a no-op. `postMeta` is read at CALL time so per-test
 * header-id mutation stays observable; passing null pins the constant-null
 * "this suite never forges a header id" stance.
 */
export function createTakeApiModuleMock({
  apiGet,
  apiPost,
  postMeta,
}: {
  apiGet: Mock;
  apiPost: Mock;
  postMeta: { requestId: string | null } | null;
}) {
  return {
    api: {
      get: (...args: unknown[]) => apiGet(...args),
      post: (...args: unknown[]) => apiPost(...args),
      postWithMeta: async (...args: unknown[]) => ({
        data: await apiPost(...args),
        meta: { requestId: postMeta?.requestId ?? null },
      }),
    },
    setNavigate: () => {},
  };
}
