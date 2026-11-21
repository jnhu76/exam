import { act, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { permissionsForRole } from "@exam/authz";
import { AuthProvider } from "@/contexts/AuthContext";
import { OperationsPage } from "./OperationsPage";

// This file exercises the REAL API client (no @/lib/api mock): transport is
// controlled by stubbing global fetch with deferred responses that honor
// AbortSignal semantics — once a request's signal aborts, its queued response
// can never be processed (the browser-equivalent behavior). The witnesses
// here pin the #1032 requirement that a superseded request's late 401 can
// never reach the global login redirect, while the current session's 401
// still navigates.
//
// Delivered-response boundary: the client's 401 redirect runs synchronously
// inside the FIRST microtask continuation after `await fetch` resolves
// (requestWithMeta navigates BEFORE parsing the error body), while every
// abort() call site here (retry click, request deadline, unmount) executes
// in a later macrotask — and the microtask queue drains between tasks.
// EVIDENCE SCOPE: the executable witness below covers the abort-BEFORE-
// delivery path. The delivered-then-superseded ordering — a delivered 401
// navigates while the request is still current — rests on the static
// microtask argument above, not on a test. The shared client separately
// refuses the redirect for a request whose caller aborted before processing
// (`init.signal?.aborted`, R-WD-1/#1054); that staleness guard does not
// weaken the #1032 boundary: the current session's 401 witness below never
// aborts and still navigates.

interface FetchCall {
  url: string;
  signal: AbortSignal | undefined;
  respond: (response: Response) => void;
}

const calls: FetchCall[] = [];

function healthBody(cpu: number) {
  return JSON.stringify({ status: "ok", cpu, memory: 11, dbResponseMs: 3 });
}

function unauthorizedBody() {
  return JSON.stringify({
    error: { code: "AUTH_REQUIRED", message: "请先登录" },
  });
}

function jsonResponse(body: string, status: number) {
  return new Response(body, {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function healthCallsOnWire() {
  return calls.filter((c) => c.url.includes("/api/system/health"));
}

function renderOperations() {
  return render(
    <MemoryRouter initialEntries={["/admin/operations"]}>
      <Routes>
        <Route
          path="/login"
          element={<div data-testid="login-marker">登录页</div>}
        />
        <Route
          path="*"
          element={
            <AuthProvider
              initialUser={{
                id: "actor-1",
                username: "actor",
                name: "Actor",
                role: "Admin",
                organizationId: "org1",
                capabilities: [...permissionsForRole("Admin")],
              }}
            >
              <OperationsPage />
            </AuthProvider>
          }
        />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  calls.length = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      const signal = init?.signal ?? undefined;
      return new Promise<Response>((resolve, reject) => {
        const entry: FetchCall = {
          url: String(_input),
          signal,
          // Browser-faithful: a response landing after the signal aborted is
          // never processed — the fetch promise already rejected.
          respond: (response) => {
            if (!signal?.aborted) resolve(response);
          },
        };
        calls.push(entry);
        signal?.addEventListener("abort", () => {
          reject(new DOMException("Aborted", "AbortError"));
        });
      });
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("OperationsPage 401 redirect ownership through the real API client (#1032)", () => {
  it("the CURRENT session's 401 still navigates to /login", async () => {
    renderOperations();
    // Both sources' initial reads are on the wire.
    expect(healthCallsOnWire()).toHaveLength(1);

    // The current health read lands 401: the global client redirects.
    await act(async () => {
      calls
        .find((c) => c.url.includes("/api/system/health"))!
        .respond(jsonResponse(unauthorizedBody(), 401));
    });
    expect(await screen.findByTestId("login-marker")).toBeInTheDocument();
  });

  it("a superseded request's late 401 does not navigate: its signal is aborted through api.get", async () => {
    renderOperations();
    const firstHealth = healthCallsOnWire()[0]!;

    // Manual health retry supersedes the initial read — the old request's
    // signal must be forwarded through api.get and aborted.
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "重试健康读取" }));
    });
    const currentHealth = healthCallsOnWire()[1]!;
    expect(firstHealth.signal?.aborted).toBe(true);
    expect(currentHealth.signal?.aborted).toBe(false);

    // The aborted transport rejects (AbortError) — the real client re-throws
    // it without touching the global 401 redirect. The superseded read can no
    // longer deliver ANY response, including a 401.
    await act(async () => {
      await Promise.resolve();
    });

    // The current read succeeds: the page stays on /admin/operations with
    // fresh data and no login redirect ever fired.
    await act(async () => {
      currentHealth.respond(jsonResponse(healthBody(21), 200));
    });
    expect(await screen.findByText("21")).toBeInTheDocument();
    expect(screen.getByText("运维总览")).toBeInTheDocument();
    expect(screen.queryByTestId("login-marker")).not.toBeInTheDocument();
  });
});
