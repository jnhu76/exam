import { useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/shared/ErrorState";
import { adminLandingPath } from "@/lib/capabilities";
import { useAuth } from "@/hooks/useAuth";

/**
 * P4-C2 403 / Access-Denied page for the admin console.
 *
 * Rendered by {@link AdminLayout} when an authenticated user with some console
 * capability reaches a `/admin/*` route whose capability they lack (task §5.4).
 * The page renders NO privileged content; it offers a deterministic "back to
 * your permitted console surface" action resolved from the actor's capability
 * union (not from a primary-role string).
 *
 * Security note: this is UX consistency only. The backend remains the
 * authorization authority on every route.
 */
export function AccessDeniedPage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const navigate = useNavigate();

  // Resolve the actor's permitted default console surface from capabilities
  // (assignment-backed union), never from a primary-role string. Falls back to
  // /login only if the actor somehow has no permitted surface.
  const landing = user ? adminLandingPath(user) : null;

  return (
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
  );
}
