import { vi } from "vitest";
import type { ReactNode } from "react";
import { MemoryRouter, useNavigate } from "react-router";
import type {
  CandidateTakeSnapshot,
  ClientEvent,
  MeResponse,
} from "@exam/contracts";
import { permissionsForRole } from "@exam/authz";
import { AuthProvider } from "@/contexts/AuthContext";
import { BrandProvider } from "@/components/layout/BrandProvider";
import { ClientEventBuffer } from "@/lib/clientEventBuffer";
import { setBuffer } from "@/lib/logger";

/**
 * Shared, deliberately narrow test harness for the TakeExamPage test family:
 * snapshot-fixture constructors, the telemetry recording buffer, the
 * candidate session, the navigate probe, and the provider stack.
 *
 * OWNERSHIP: mock lifecycle stays in the test files — no vi.fn() instance,
 * mutable response holder, response sequence, timer mode, or
 * vi.mock/vi.hoisted call lives here. The api-module mock helpers live in
 * TakeExamPage.apiMockHarness.ts precisely because this module transitively
 * imports "@/lib/api" (via AuthContext/BrandProvider) and must therefore
 * never be imported from inside a vi.mock("@/lib/api") factory.
 */

/** The authoritative snapshot timeline shared verbatim by the seven suites. */
export const NOW = "2026-07-04T10:00:00.000Z";
export const DEADLINE = "2026-07-04T11:00:00.000Z";

export type SnapshotQuestion = CandidateTakeSnapshot["questions"][number];

/** single_choice fixture; the prompt is per-file scenario copy — explicit. */
export function singleChoiceQuestion(
  id: string,
  { prompt }: { prompt: string },
): SnapshotQuestion {
  return {
    id,
    type: "single_choice",
    prompt,
    promptDocument: null,
    answerMode: "plain",
    options: [
      { id: "opt-a", content: "A", contentDocument: null },
      { id: "opt-b", content: "B", contentDocument: null },
    ],
    inputMode: "choice",
    maxScore: 10,
    answerValue: null,
    answerSource: "none",
  };
}

export function fillBlankQuestion(id: string): SnapshotQuestion {
  return {
    id,
    type: "fill_blank",
    prompt: `填空 ${id}`,
    promptDocument: null,
    answerMode: "plain",
    options: [],
    inputMode: "single_line",
    maxScore: 10,
    answerValue: null,
    answerSource: "none",
  };
}

/**
 * Single-authority skeleton for CandidateTakeSnapshot fixtures. Only fields
 * verbatim-identical across all seven suites are fixed here. INVARIANT:
 * timingMode (timed_window mounts ExamTimer and drives the F16 deadline
 * family; untimed isolates it) and questions are per-file scenario choices
 * and must be passed explicitly — no implied default. lockReason is
 * deliberately absent from the skeleton; a fixture that needs the explicit
 * `lockReason: undefined` key passes it in overrides.
 */
export function buildTakeSnapshot(
  options: {
    timingMode: CandidateTakeSnapshot["timingMode"];
    questions: SnapshotQuestion[];
  } & Partial<Omit<CandidateTakeSnapshot, "timingMode" | "questions">>,
): CandidateTakeSnapshot {
  const { timingMode, questions, ...overrides } = options;
  return {
    attemptId: "att-1",
    examId: "exam-1",
    attemptStatus: "in_progress",
    gradingStatus: "auto_graded",
    isEditable: true,
    canStart: false,
    canResume: false,
    canSave: true,
    canSubmit: true,
    resultVisibility: "hidden",
    answerVisibility: "hidden",
    submittedAt: null,
    serverNow: NOW,
    effectiveDeadline: DEADLINE,
    serverRevision: NOW,
    timingMode,
    questions,
    ...overrides,
  };
}

/**
 * The frozen post-terminal snapshot an authoritative re-read returns:
 * submitted attempt, capabilities closed, and the server's frozen answer
 * (opt-a, answerSource "submitted") winning over stale local edits (B17).
 */
export function submittedFrozenSnapshot(
  options: { timingMode: CandidateTakeSnapshot["timingMode"] } & Partial<
    Omit<CandidateTakeSnapshot, "timingMode">
  >,
): CandidateTakeSnapshot {
  const { timingMode, ...overrides } = options;
  return buildTakeSnapshot({
    timingMode,
    questions: [
      {
        ...singleChoiceQuestion("q1", { prompt: "选择一项" }),
        answerValue: "opt-a",
        answerSource: "submitted",
      },
    ],
    attemptStatus: "submitted",
    isEditable: false,
    canSave: false,
    canSubmit: false,
    lockReason: "submitted",
    submittedAt: NOW,
    ...overrides,
  });
}

/** Recording buffer: captures every event the page pushes for persistence. */
export function installRecordingBuffer() {
  const send = vi.fn(async (events: ClientEvent[]) => ({
    acknowledgedCount: events.length,
    rejected: [],
  }));
  setBuffer(
    new ClientEventBuffer({
      send,
      batchSize: 100,
      flushIntervalMs: 0,
    }),
  );
  return send;
}

/** All persisted exam_telemetry records with the given event name. */
export function telemetryEvents(
  send: ReturnType<typeof vi.fn>,
  name: string,
): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = [];
  for (const call of send.mock.calls) {
    for (const ev of call[0] as Array<Record<string, unknown>>) {
      if (ev.kind === "exam_telemetry" && ev.name === name) out.push(ev);
    }
  }
  return out;
}

/** The candidate session every suite mounts AuthProvider with. */
export function candidateUser(): MeResponse {
  return {
    id: "c1",
    username: "candidate",
    name: "Candidate",
    role: "Candidate",
    organizationId: "org1",
    capabilities: [...permissionsForRole("Candidate")],
  };
}

/** Hands the router's navigate() to the test (route-change scenario). */
export function NavigateProbe({
  register,
}: {
  register: (nav: (to: string) => void) => void;
}) {
  register(useNavigate());
  return null;
}

/**
 * The provider stack shared verbatim by all seven suites:
 * MemoryRouter(initialEntries=[initialPath]) → AuthProvider(candidateUser())
 * → BrandProvider → children. Routes, location probes, and each renderPage's
 * return-value shape stay per-file — in-tree click navigation vs programmatic
 * navigate() is part of what individual suites test.
 */
export function takeExamProviders({
  initialPath,
  children,
}: {
  initialPath: string;
  children: ReactNode;
}) {
  return (
    <MemoryRouter initialEntries={[initialPath]}>
      <AuthProvider initialUser={candidateUser()}>
        <BrandProvider>{children}</BrandProvider>
      </AuthProvider>
    </MemoryRouter>
  );
}
