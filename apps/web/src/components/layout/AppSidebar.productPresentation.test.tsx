import type { MeResponse } from "@exam/contracts";
import { permissionsForRole } from "@exam/authz";
import { SUPPORTED_PRODUCT_CAPABILITIES } from "@exam/domain";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";
import { ProductProjectionProvider } from "@/contexts/ProductProjectionContext";
import type { ProductProjection } from "@/lib/productProjection";
import { AppSidebar } from "./AppSidebar";
import { BrandProvider } from "./BrandProvider";
import { AuthProvider } from "@/contexts/AuthContext";

/**
 * W3.2 counterexamples (#678 / ADR-022 Phase 3, product-capability-composition.md
 * §4.4/§13): the navigation composes from TWO independent authorities —
 * actor permission (lib/capabilities.ts, unchanged) and the deployment's
 * product projection for capability-scoped OPTIONAL surfaces. The red line
 * is non-negotiable: obligation faces (待评分 pending manual grading, 恢复审查
 * recovery review, 监考处置 incident disposition, 成绩查询 result reads) stay
 * visible under ANY projection — an all-disabled or Minimal ceiling never
 * hides correctness work. The capability-scoped monitoring surface (监考工作台,
 * operator.monitoring) follows the projection. Nothing branches on the
 * preset/presentation name: the same allows() rule evaluates every
 * projection, so a bounded subset re-enabling the capability re-shows it.
 */
const admin: MeResponse = {
  id: "00000000-0000-4000-8000-000000000001",
  organizationId: "00000000-0000-4000-8000-000000000010",
  username: "admin",
  name: "管理员",
  role: "Admin",
  capabilities: [...permissionsForRole("Admin")],
};

const allDisabled: ProductProjection = {
  revision: 1,
  presentation: "standard",
  enabled: [],
};

const minimalProjection: ProductProjection = {
  revision: 1,
  presentation: "minimal",
  enabled: [
    "question.single_choice",
    "question.true_false",
    "question.text_response",
    "grading.manual",
    "admission.account",
    "result.publication",
  ],
};

const standardProjection: ProductProjection = {
  revision: 1,
  presentation: "standard",
  enabled: [...SUPPORTED_PRODUCT_CAPABILITIES],
};

function renderSidebar(projection: ProductProjection) {
  return render(
    <MemoryRouter initialEntries={["/admin/dashboard"]}>
      <AuthProvider initialUser={admin}>
        <BrandProvider>
          <ProductProjectionProvider initialProjection={projection}>
            <AppSidebar user={admin} collapsed={false} onLogout={() => {}} />
          </ProductProjectionProvider>
        </BrandProvider>
      </AuthProvider>
    </MemoryRouter>,
  );
}

describe("AppSidebar composition under the deployment projection (#678 W3.2)", () => {
  it("never hides obligation faces, even under an all-disabled ceiling", () => {
    renderSidebar(allDisabled);

    // Obligation faces: pending manual grading, recovery review, incident
    // disposition, result reads — reachable under EVERY projection.
    expect(screen.getByText("待评分")).toBeInTheDocument();
    expect(screen.getByText("恢复审查")).toBeInTheDocument();
    expect(screen.getByText("监考处置")).toBeInTheDocument();
    expect(screen.getByText("成绩查询")).toBeInTheDocument();
    // Business authoring entries stay (Minimal still authors exams).
    expect(screen.getByText("题目管理")).toBeInTheDocument();
    expect(screen.getByText("考试管理")).toBeInTheDocument();
  });

  it("hides only the capability-scoped monitoring surface under Minimal", () => {
    renderSidebar(minimalProjection);

    expect(screen.queryByText("监考工作台")).not.toBeInTheDocument();
    expect(screen.getByText("待评分")).toBeInTheDocument();
    expect(screen.getByText("恢复审查")).toBeInTheDocument();
    expect(screen.getByText("监考处置")).toBeInTheDocument();
  });

  it("keeps the monitoring surface when the deployment allows operator.monitoring", () => {
    renderSidebar(standardProjection);

    expect(screen.getByText("监考工作台")).toBeInTheDocument();
    expect(screen.getByText("待评分")).toBeInTheDocument();
  });
});
