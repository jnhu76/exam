/**
 * P4-C3 Teacher E2E fixture helper.
 *
 * Creates a Teacher account through the SUPPORTED Admin product interface
 * (POST /api/users { role: "Teacher" }) — NOT by direct DB insertion
 * (P4-G-01 / task §6.2). Admin authenticates via the real /api/auth/login
 * flow; the Teacher is then logged in through the real /login UI via
 * {@link loginAsTeacher}.
 *
 * No default Teacher is added to demo-seed.ts / e2e-seed.ts (task §6.2
 * forbids it). Each spec call mints a unique Teacher identity so repeated
 * runs / shards do not collide.
 */
import type { APIRequestContext } from "@playwright/test";
import { adminApiToken } from "./flow";

const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:3000";

/** Default password for E2E Teacher fixtures (rate-limit-disabled E2E env). */
export const TEACHER_PASSWORD = "teacher123";

export interface TeacherFixture {
  username: string;
  password: string;
  name: string;
  userId: string;
}

/**
 * Log a Teacher fixture in over the API and return its auth-token. Mirrors
 * candidateApiToken/adminApiToken but for an ad-hoc Teacher identity created
 * by {@link createTeacherViaApi}.
 */
export async function teacherApiToken(
  request: APIRequestContext,
  teacher: { username: string; password: string },
): Promise<string> {
  for (let attempt = 1; attempt <= 5; attempt++) {
    const res = await request.post(`${BASE_URL}/api/auth/login`, {
      data: { username: teacher.username, password: teacher.password },
    });
    if (res.status() === 429) {
      if (attempt === 5) throw new Error("teacher login rate-limited");
      await new Promise((r) => setTimeout(r, 1000 * attempt));
      continue;
    }
    if (!res.ok()) {
      throw new Error(`teacher API login failed: ${res.status()}`);
    }
    const token = res.headers()["set-cookie"]?.match(/auth-token=([^;]+)/)?.[1];
    if (!token) throw new Error("teacher API login returned no auth-token");
    return token;
  }
  throw new Error("teacher login exhausted retries");
}

/**
 * Create a Teacher via POST /api/users { role: "Teacher" } authenticated as
 * Admin (the supported product interface). Returns the new user's identity.
 *
 * The route is the real Admin user-creation surface: it writes the users row
 * + the primary active Teacher assignment + syncs users.role, exactly as a
 * human Admin would via UsersPage. This is the product path P4-G-01 requires
 * be proven end-to-end.
 */
export async function createTeacherViaApi(
  request: APIRequestContext,
  options: { name?: string; usernamePrefix?: string } = {},
): Promise<TeacherFixture> {
  const stamp = Date.now();
  const rand = Math.random().toString(36).slice(2, 6);
  const username = `${options.usernamePrefix ?? "e2e-teacher"}-${stamp}-${rand}`;
  const name = options.name ?? `E2E教师${rand}`;
  const password = TEACHER_PASSWORD;

  const adminToken = await adminApiToken(request);
  const res = await request.post(`${BASE_URL}/api/users`, {
    headers: { Cookie: `auth-token=${adminToken}` },
    data: { username, password, name, role: "Teacher" },
  });
  if (!res.ok()) {
    throw new Error(
      `create Teacher via POST /api/users failed: ${res.status()} ${await res.text()}`,
    );
  }
  const body = (await res.json()) as { id: string };
  return { username, password, name, userId: body.id };
}
