import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  classifyOperationFailure,
  useRecoveryOperation,
} from "./useRecoveryOperation";
import { createContextSafeUuid } from "@/lib/uuid";

// Resettable UUID counter: each test starts from the same value so the exact
// minted-UUID assertion stays stable regardless of test order.
const uuidMock = vi.hoisted(() => {
  let uuidCounter = 0;
  return {
    createContextSafeUuid: vi.fn(() => {
      uuidCounter += 1;
      return `00000000-0000-4000-8000-${String(uuidCounter).padStart(12, "0")}`;
    }),
    resetUuidCounter: () => {
      uuidCounter = 0;
    },
  };
});

vi.mock("@/lib/uuid", () => ({
  createContextSafeUuid: uuidMock.createContextSafeUuid,
}));

describe("classifyOperationFailure", () => {
  it("treats status 0 (network) as indeterminate", () => {
    expect(classifyOperationFailure({ status: 0 })).toBe("indeterminate");
  });

  it("treats 5xx as indeterminate (server may have committed)", () => {
    expect(classifyOperationFailure({ status: 500 })).toBe("indeterminate");
    expect(classifyOperationFailure({ status: 503 })).toBe("indeterminate");
  });

  it("treats definitive 4xx as confirmed rejection", () => {
    expect(classifyOperationFailure({ status: 400 })).toBe(
      "confirmed_rejection",
    );
    expect(classifyOperationFailure({ status: 403 })).toBe(
      "confirmed_rejection",
    );
    expect(classifyOperationFailure({ status: 404 })).toBe(
      "confirmed_rejection",
    );
  });

  it("treats IDEMPOTENCY_CONFLICT as its own kind", () => {
    expect(
      classifyOperationFailure({ status: 409, code: "IDEMPOTENCY_CONFLICT" }),
    ).toBe("idempotency_conflict");
  });

  it("treats non-ApiError throws as indeterminate", () => {
    expect(classifyOperationFailure(new Error("boom"))).toBe("indeterminate");
  });
});

describe("useRecoveryOperation", () => {
  const submit = vi.fn();
  const onSuccess = vi.fn();
  const onConfirmedRejection = vi.fn();
  const onIndeterminate = vi.fn();

  beforeEach(() => {
    submit.mockReset();
    onSuccess.mockReset();
    onConfirmedRejection.mockReset();
    onIndeterminate.mockReset();
    submit.mockResolvedValue({ outcome: "applied" });
    uuidMock.resetUuidCounter();
  });

  function setup(options: { beforeSubmit?: (id: string) => boolean } = {}) {
    return renderHook(() =>
      useRecoveryOperation({
        submit,
        onSuccess,
        onConfirmedRejection,
        onIndeterminate,
        beforeSubmit: options.beforeSubmit,
      }),
    );
  }

  it("begins idle and mints an identity on begin()", () => {
    const { result } = setup();
    expect(result.current.phase).toBe("idle");
    expect(result.current.operationId).toBeNull();
    act(() => result.current.begin());
    expect(result.current.operationId).toBe(
      "00000000-0000-4000-8000-000000000001",
    );
    expect(result.current.phase).toBe("idle");
  });

  it("reuses the SAME operationId across retries until a confirmed outcome (J5-R0 §8.2)", async () => {
    const { result } = setup();
    act(() => result.current.begin());
    const first = result.current.operationId;
    submit.mockRejectedValueOnce({ status: 0 });

    await act(async () => {
      await result.current.run();
    });
    expect(result.current.phase).toBe("indeterminate");
    expect(result.current.operationId).toBe(first);
    expect(onIndeterminate).toHaveBeenCalledTimes(1);

    // Retry — same identity, no new mint.
    submit.mockResolvedValueOnce({ outcome: "applied" });
    await act(async () => {
      await result.current.run();
    });
    expect(submit).toHaveBeenCalledTimes(2);
    expect(submit.mock.calls[1]![0]).toBe(first);
    expect(onSuccess).toHaveBeenCalledTimes(1);
    expect(result.current.phase).toBe("idle");
    expect(result.current.operationId).toBeNull();
  });

  it("clears the identity on a confirmed rejection (definitive 4xx)", async () => {
    const { result } = setup();
    act(() => result.current.begin());
    const first = result.current.operationId;
    submit.mockRejectedValueOnce({ status: 404 });

    await act(async () => {
      await result.current.run();
    });
    expect(onConfirmedRejection).toHaveBeenCalledTimes(1);
    expect(result.current.phase).toBe("idle");
    expect(result.current.operationId).toBeNull();

    // A new begin() mints a FRESH identity (the old command is dead).
    act(() => result.current.begin());
    expect(result.current.operationId).not.toBe(first);
  });

  it("clears the identity on idempotency conflict (confirmed rejection)", async () => {
    const { result } = setup();
    act(() => result.current.begin());
    submit.mockRejectedValueOnce({
      status: 409,
      code: "IDEMPOTENCY_CONFLICT",
    });
    await act(async () => {
      await result.current.run();
    });
    expect(onConfirmedRejection).toHaveBeenCalledTimes(1);
    expect(result.current.phase).toBe("idle");
    expect(result.current.operationId).toBeNull();
  });

  it("restores a durable identity into indeterminate (reload recovery)", async () => {
    const { result } = setup();
    act(() => result.current.begin("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"));
    expect(result.current.operationId).toBe(
      "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    );
    expect(result.current.phase).toBe("indeterminate");
  });

  it("suppresses the POST when beforeSubmit returns false (fail-closed persistence)", async () => {
    const { result } = setup({ beforeSubmit: () => false });
    act(() => result.current.begin());
    await act(async () => {
      await result.current.run();
    });
    expect(submit).not.toHaveBeenCalled();
    expect(result.current.phase).toBe("idle");
    // Identity retained — a corrected retry reuses it (nothing was sent).
    expect(result.current.operationId).not.toBeNull();
  });

  it("begin() is a no-op while a session is active (identity must not drift)", async () => {
    const { result } = setup();
    act(() => result.current.begin());
    const first = result.current.operationId;
    submit.mockRejectedValueOnce({ status: 0 });
    await act(async () => {
      await result.current.run();
    });
    expect(result.current.phase).toBe("indeterminate");
    act(() => result.current.begin());
    expect(result.current.operationId).toBe(first);
  });

  it("run() is a no-op without an identity", async () => {
    const { result } = setup();
    await act(async () => {
      await result.current.run();
    });
    expect(submit).not.toHaveBeenCalled();
  });

  it("guards against double submit while submitting", async () => {
    let resolveSubmit: (v: unknown) => void = () => {};
    submit.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveSubmit = resolve;
        }),
    );
    const { result } = setup();
    act(() => result.current.begin());
    let firstRun: Promise<void>;
    act(() => {
      firstRun = result.current.run();
    });
    await act(async () => {
      await result.current.run();
    });
    expect(submit).toHaveBeenCalledTimes(1);
    await act(async () => {
      resolveSubmit({ outcome: "applied" });
      await firstRun;
    });
    expect(onSuccess).toHaveBeenCalledTimes(1);
  });

  it("reset() drops the session and the next begin() mints fresh", () => {
    const { result } = setup();
    act(() => result.current.begin());
    expect(result.current.operationId).not.toBeNull();
    act(() => result.current.reset());
    expect(result.current.phase).toBe("idle");
    expect(result.current.operationId).toBeNull();
  });
});
