import type { MeResponse } from "@exam/contracts";
import { render } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import { AuthProvider } from "@/contexts/AuthContext";
import { useCapability } from "./useCapability";

function makeUser(role: MeResponse["role"]): MeResponse {
  return {
    id: "u1",
    username: "u",
    name: "U",
    role,
    organizationId: "org",
  };
}

/** Renders a host that exercises useCapability and surfaces the result. */
function Probe({
  onCapability,
}: {
  onCapability: (c: ReturnType<typeof useCapability>) => void;
}) {
  const c = useCapability();
  onCapability(c);
  return null;
}

function renderWith(
  user: MeResponse | null,
  cb: (c: ReturnType<typeof useCapability>) => void,
) {
  let captured!: ReturnType<typeof useCapability>;
  render(
    <MemoryRouter>
      <AuthProvider initialUser={user}>
        <Probe
          onCapability={(c) => {
            captured = c;
            cb(c);
          }}
        />
      </AuthProvider>
    </MemoryRouter>,
  );
  return captured;
}

describe("RBAC-M9 useCapability (render HINT, not authorization)", () => {
  it("exposes the admin role and canShowManagement=true for an Admin", () => {
    const c = renderWith(makeUser("Admin"), () => {});
    expect(c.role).toBe("Admin");
    expect(c.canShowManagement).toBe(true);
  });

  it("canShowManagement=false for a non-Admin role (Teacher)", () => {
    const c = renderWith(makeUser("Teacher"), () => {});
    expect(c.role).toBe("Teacher");
    expect(c.canShowManagement).toBe(false);
  });

  it("returns role=null and canShowManagement=false with no session", () => {
    const c = renderWith(null, () => {});
    expect(c.role).toBeNull();
    expect(c.canShowManagement).toBe(false);
  });
});
