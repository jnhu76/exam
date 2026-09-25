import { useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/shared/ErrorState";
import { PageContainer } from "@/components/shared/PageContainer";
import { adminLandingPath } from "@/lib/capabilities";
import { useAuth } from "@/hooks/useAuth";

/**
 * 403 / access-denied page for the admin console.
 *
 * Rendered by {@link AdminLayout} when an authenticated user with some console
 * capability reaches a `/admin/*` route whose capability they lack. The page
 * renders NO privileged content; it offers a deterministic "back to your
 * permitted console surface" action resolved from the actor's capability union
 * (not from a primary-role string).
 *
 * UX consistency only — the backend remains the authorization authority on
 * every route.
 */
export function AccessDeniedPage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const navigate = useNavigate();

  // Resolve the permitted landing surface from the capability union (active
  // assignments), never from a primary-role string; /login is the fallback only
  // when the actor has no permitted surface.
  const landing = user ? adminLandingPath(user) : null;

  return (
    <PageContainer role="admin-standard">
      <ErrorState
        message={t("adminRouteGuard.accessDenied")}
        extraAction={
          <Button
            type="button"
            size="sm"
            onClick={() => navigate(landing ?? "/login")}
          >
            {t("adminRouteGuard.backToPermitted")}
          </Button>
        }
      />
    </PageContainer>
  );
}
