import { describe, it, expect } from "vitest";
import {
  SPA_ROUTE_TEMPLATES,
  projectClientEventRoute,
} from "../clientEventRoute.js";

/** Deterministic xorshift PRNG so the fuzz corpus never flakes. */
function makeRng(seed: number): () => number {
  let s = seed | 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 0xffffffff;
  };
}

const ALPHABET = [
  "/admin",
  "/exam",
  "a",
  "b",
  "%2F",
  "%3F",
  "%252F",
  "?",
  "#",
  ":",
  "@",
  "\\",
  "\r",
  "\n",
  "\t",
  " ",
  ".",
  "..",
  "秘密",
  "🎉",
  "token=SECRET",
  "user:pass@evil.com",
  "data:text/html,X",
  "A",
  "NEW",
  "12345",
  "e3b0c442-2fc8-4570-b9f2-9a2807b1b1e1",
];

describe("SPA_ROUTE_TEMPLATES vocabulary", () => {
  it("declares only rooted, wildcard-free, distinct templates", () => {
    const seen = new Set<string>();
    for (const t of SPA_ROUTE_TEMPLATES) {
      expect(t.startsWith("/")).toBe(true);
      expect(t.includes("*")).toBe(false);
      expect(seen.has(t)).toBe(false);
      seen.add(t);
    }
    expect(seen.size).toBe(SPA_ROUTE_TEMPLATES.length);
  });

  it("is idempotent: every template projects to itself", () => {
    for (const t of SPA_ROUTE_TEMPLATES) {
      expect(projectClientEventRoute(t)).toBe(t);
    }
  });
});

describe("projectClientEventRoute — legitimate navigation (utility retention)", () => {
  const cases: Array<[string, string | null]> = [
    ["/login", "/login"],
    ["/reset-password", "/reset-password"],
    ["/admin", "/admin"],
    ["/admin/users", "/admin/users"],
    ["/admin/questions/new", "/admin/questions/new"],
    ["/admin/questions/123/edit", "/admin/questions/:id/edit"],
    ["/admin/exams/e3b0c442-2fc8-4570-b9f2-9a2807b1b1e1", "/admin/exams/:id"],
    [
      "/admin/exams/e3b0c442-2fc8-4570-b9f2-9a2807b1b1e1/proctor/monitor",
      "/admin/exams/:id/proctor/monitor",
    ],
    [
      "/admin/recovery/incidents/INC-2042",
      "/admin/recovery/incidents/:incidentId",
    ],
    ["/exam", "/exam"],
    ["/exam/list", "/exam/list"],
    ["/exam/e3b0c442-2fc8-4570-b9f2-9a2807b1b1e1/start", "/exam/:examId/start"],
    ["/exam/42/take", "/exam/:attemptId/take"],
    ["/exam/42/result", "/exam/:attemptId/result"],
    // Trailing slash and absolute URL normalize to the same template.
    ["/admin/users/", "/admin/users"],
    ["http://localhost:3000/admin/users", "/admin/users"],
    ["https://host.exam.local/exam/42/take", "/exam/:attemptId/take"],
  ];

  it.each(cases)("%s → %s", (input, expected) => {
    expect(projectClientEventRoute(input)).toBe(expected);
  });

  it("keeps the legitimate match rate over every declared template", () => {
    // Substitute a realistic dynamic id into every param segment of every
    // template — all 49 must still resolve to their own template. This pins
    // the investigation-utility claim: no legitimate SPA page loses its route.
    for (const t of SPA_ROUTE_TEMPLATES) {
      const concrete = t
        .split("/")
        .map((seg) => (seg.startsWith(":") ? "e3b0c442-2fc8" : seg))
        .join("/");
      expect(projectClientEventRoute(concrete)).toBe(t);
    }
  });
});

describe("projectClientEventRoute — #864 attack matrix (audit RT series)", () => {
  const cases: Array<[string, string | null]> = [
    // RT-3: plaintext secret in a path segment under a hostile or real root.
    ["/password-reset/EXAMAUDIT-CANARY-RT3", null],
    ["/exam/EXAMAUDIT-CANARY-RT3-SECRET/start", "/exam/:examId/start"],
    ["/admin/exams/EXAMAUDIT-CANARY-TAIL", "/admin/exams/:id"],
    // RT-4/5: query and fragment never reach storage.
    ["/exam/list?token=EXAMAUDIT-CANARY-RT4", "/exam/list"],
    ["/exam/list#EXAMAUDIT-CANARY-RT5", "/exam/list"],
    // RT-8: encoded smuggling — whole-form unknown → null; inside a param
    // slot the encoded bytes are dropped with the segment.
    ["/a%2Fb%3Ftoken%3DEXAMAUDIT-CANARY-RT8", null],
    ["/exam/a%2Fb%3Ftoken%3DEXAMAUDIT-CANARY-RT8/start", "/exam/:examId/start"],
    // Double encoding stays opaque in one segment (never re-decoded).
    ["/exam/%252F%253Ftoken%253DEXAMAUDIT-CANARY/start", "/exam/:examId/start"],
    // RT-12: http-form userinfo — only the pathname participates.
    [
      "http://user:EXAMAUDIT-CANARY-RT12@example.com/exam/7/take",
      "/exam/:attemptId/take",
    ],
    // RT-12B: opaque-scheme credentials (user:…@host/path) → fail closed.
    ["user:EXAMAUDIT-CANARY-RT12B@example.com/path", null],
    // RT-12C: non-http(s) schemes (data:, javascript:, mailto:, ftp:) → null.
    ["data:text/html,EXAMAUDIT-CANARY-RT12C", null],
    ["javascript:alert(1)", null],
    ["mailto:someone@example.com", null],
    ["ftp://example.com/exam/list", null],
    // RT-13/13B: malformed URL — no hand-trimmed fallback anymore.
    ["http://[?token=EXAMAUDIT-CANARY-RT13", null],
    ["http://[?token=EXAMAUDIT-CANARY-RT13B#x", null],
    // RT-14B: raw CRLF — URL parsing strips CR/LF; output is still a member
    // of the closed template set, so no control byte can reach storage.
    ["http://[\r\nEXAMAUDIT-CANARY-RT14B?x=y", null],
    ["/exam/a\r\nb/start", "/exam/:examId/start"],
    // Mixed case that matches no declared literal → null (fail closed).
    ["/EXAM/list", null],
    ["/Admin/users", null],
    ["/admin/USERS", null],
    // Unicode: a dynamic segment is dropped whole; an unknown root → null.
    ["/exam/考生编号/start", "/exam/:examId/start"],
    ["/考试/list", null],
    // Long payloads — bounded input, output is still a fixed template.
    ["/exam/" + "A".repeat(400) + "/start", "/exam/:examId/start"],
    // Unregistered routes → null (including near-miss real roots).
    ["/admin/nonexistent-page", null],
    ["/totally/unknown", null],
    ["/exam", "/exam"],
    ["/exam/SECRET-ONLY", null],
    // Structural edge cases.
    ["/", null],
    ["//", null],
    ["/admin//users", null],
    ["/exam//take", null],
    ["", null],
    [" ", null],
    ["admin/users", null], // relative garbage (pathname always starts with "/")
    ["//evil.com/admin/users", "/admin/users"], // host part can never persist
  ];

  it.each(cases)("%j → %j", (input, expected) => {
    expect(projectClientEventRoute(input)).toBe(expected);
  });

  it("returns null for null/undefined/non-string input", () => {
    expect(projectClientEventRoute(null)).toBeNull();
    expect(projectClientEventRoute(undefined)).toBeNull();
  });
});

describe("projectClientEventRoute — closed-output invariant", () => {
  const TEMPLATE_SET = new Set(SPA_ROUTE_TEMPLATES);

  const CORPUS: string[] = [
    "/password-reset/EXAMAUDIT-CANARY-RT3",
    "/a%2Fb%3Ftoken%3DEXAMAUDIT-CANARY-RT8",
    "user:EXAMAUDIT-CANARY@example.com/path",
    "data:text/html,EXAMAUDIT-CANARY",
    "http://[\r\nEXAMAUDIT-CANARY?x=y",
    "/exam/EXAMAUDIT-CANARY/start",
    "/admin/exams/EXAMAUDIT-CANARY",
    "/exam/%2e%2e/admin/users",
    "/admin/%2e%2e/exams/SECRET",
    "/exam/..%2f..%2fadmin/users/take",
    "/admin/users?token=EXAMAUDIT-CANARY",
    "/admin/users#EXAMAUDIT-CANARY",
    "/exam/list\t?token=X",
    "/exam/\u0000/start",
    "/exam/caf\u00e9/start",
  ];

  it("every corpus output is a declared template or null", () => {
    for (const input of CORPUS) {
      const out = projectClientEventRoute(input);
      expect(out === null || TEMPLATE_SET.has(out)).toBe(true);
    }
  });

  it("no corpus canary byte sequence survives into the output", () => {
    for (const input of CORPUS) {
      const out = projectClientEventRoute(input);
      if (out === null) continue;
      expect(out.includes("EXAMAUDIT-CANARY")).toBe(false);
      expect(out.includes("token=")).toBe(false);
      expect(out.includes("%2")).toBe(false);
    }
  });

  it("deterministic fuzz: 5000 adversarial composites never leave the closed set", () => {
    const rng = makeRng(0x5eed864);
    for (let n = 0; n < 5000; n++) {
      const parts: string[] = [];
      const len = 1 + Math.floor(rng() * 6);
      for (let k = 0; k < len; k++) {
        parts.push(ALPHABET[Math.floor(rng() * ALPHABET.length)]!);
      }
      const input = parts.join("");
      const out = projectClientEventRoute(input);
      expect(out === null || TEMPLATE_SET.has(out)).toBe(true);
    }
  });
});
