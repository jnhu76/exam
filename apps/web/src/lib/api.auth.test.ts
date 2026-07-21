import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { api } from "./api";
import type { LoginRequest, LoginResponse } from "@exam/contracts";

/**
 * HTTP-boundary contract for the login API client.
 *
 * The component test (`pages/LoginPage.test.tsx`) mocks the `api` module and
 * owns form state / navigation behavior. This test owns the **client/server
 * wire contract**: the HTTP method, endpoint, request payload shape, and the
 * success / error response mapping through the real `request<T>` path. MSW is
 * the HTTP boundary — no `api` module mocking here.
 */

const LOGIN_URL = "/api/auth/login";

const server = setupServer();

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe("login API client wire contract", () => {
  it("sends a POST to /api/auth/login with a JSON { username, password } body", async () => {
    let capturedRequest: Request | undefined;
    server.use(
      http.post(LOGIN_URL, async ({ request }) => {
        capturedRequest = request.clone();
        return HttpResponse.json(adminLoginResponse());
      }),
    );

    await api.post<LoginResponse, LoginRequest>(LOGIN_URL, {
      username: "admin",
      password: "secret",
    });

    expect(capturedRequest?.method).toBe("POST");
    expect(capturedRequest?.headers.get("content-type")).toBe(
      "application/json",
    );
    expect(await capturedRequest?.json()).toEqual({
      username: "admin",
      password: "secret",
    });
  });

  it("maps a successful response to the LoginResponse shape", async () => {
    server.use(
      http.post(LOGIN_URL, () => HttpResponse.json(adminLoginResponse())),
    );

    const result = await api.post<LoginResponse, LoginRequest>(LOGIN_URL, {
      username: "admin",
      password: "secret",
    });

    expect(result).toEqual(adminLoginResponse());
    expect(result.id).toEqual(expect.any(String));
    expect(result.role).toBe("Admin");
    expect(Array.isArray(result.capabilities)).toBe(true);
  });

  it("maps a 401 INVALID_CREDENTIALS response to an ApiError carrying the code", async () => {
    server.use(
      http.post(
        LOGIN_URL,
        () =>
          new HttpResponse(
            JSON.stringify({
              error: {
                code: "INVALID_CREDENTIALS",
                message: "Invalid username or password",
              },
            }),
            { status: 401, headers: { "content-type": "application/json" } },
          ),
      ),
    );

    await expect(
      api.post<LoginResponse, LoginRequest>(LOGIN_URL, {
        username: "admin",
        password: "wrong",
      }),
    ).rejects.toMatchObject({
      name: "ApiError",
      status: 401,
      code: "INVALID_CREDENTIALS",
    });
  });

  it("does not send a body when none is supplied (no Content-Type header)", async () => {
    let capturedRequest: Request | undefined;
    server.use(
      http.post(LOGIN_URL, ({ request }) => {
        capturedRequest = request.clone();
        return new HttpResponse(null, { status: 204 });
      }),
    );

    await api.post<void>(LOGIN_URL);

    expect(capturedRequest?.headers.get("content-type")).toBeNull();
  });
});

function adminLoginResponse(): LoginResponse {
  return {
    id: "00000000-0000-4000-8000-000000000001",
    username: "admin",
    name: "Admin",
    role: "Admin",
    organizationId: "00000000-0000-4000-8000-000000000000",
    capabilities: ["exam.view", "exam.create"],
  };
}
