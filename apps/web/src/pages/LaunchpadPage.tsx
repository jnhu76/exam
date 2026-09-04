import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Navigate } from "react-router";
import { BrandHeader } from "@/components/layout/BrandHeader";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FieldError } from "@/components/shared/FieldError";
import { InlineErrorBanner } from "@/components/shared/InlineErrorBanner";
import { FieldGroup, Field } from "@/components/shared/FieldGroup";
import { PageContainer } from "@/components/shared/PageContainer";
import { api } from "@/lib/api";
import { getApiErrorMessage } from "@/lib/apiErrors";
import type {
  LaunchpadStatusResponse,
  LaunchpadBootstrapRequest,
} from "@exam/contracts";

/**
 * Launchpad first-install page (P7-C1).
 *
 * Initial installation ONLY: creates the first Admin and the internal
 * default organization via POST /api/launchpad/bootstrap. NOT signup, NOT
 * login, NOT Admin recovery. The role is NOT selectable — the server always
 * creates role = Admin.
 *
 * On mount it probes GET /api/launchpad/status. If the installation is
 * already initialized, it redirects to /login (a completed installation
 * never renders a Launchpad "completed" page). After a successful bootstrap
 * it also redirects to /login so the new Admin can log in normally.
 */
export function LaunchpadPage() {
  const { t } = useTranslation();

  const [statusState, setStatusState] = useState<
    "loading" | "uninitialized" | "initialized" | "error"
  >("loading");

  const [organizationName, setOrganizationName] = useState("");
  const [organizationDisplayName, setOrganizationDisplayName] = useState("");
  const [adminName, setAdminName] = useState("");
  const [adminUsername, setAdminUsername] = useState("");
  const [adminPassword, setAdminPassword] = useState("");
  const [setupToken, setSetupToken] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [submitError, setSubmitError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const status = await api.get<LaunchpadStatusResponse>(
          "/api/launchpad/status",
        );
        if (cancelled) return;
        setStatusState(status.initialized ? "initialized" : "uninitialized");
      } catch {
        if (cancelled) return;
        setStatusState("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Once initialized (or after a successful bootstrap), redirect to /login.
  if (statusState === "initialized" || done) {
    return <Navigate to="/login" replace />;
  }

  const validate = () => {
    const errors: Record<string, string> = {};
    if (!organizationName.trim())
      errors.organizationName = t("launchpad.organizationNameRequired");
    if (!adminName.trim()) errors.adminName = t("launchpad.adminNameRequired");
    if (!adminUsername.trim())
      errors.adminUsername = t("launchpad.adminUsernameRequired");
    if (!adminPassword.trim())
      errors.adminPassword = t("launchpad.adminPasswordRequired");
    if (!setupToken.trim())
      errors.setupToken = t("launchpad.setupTokenRequired");
    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;
    setSubmitting(true);
    setSubmitError("");
    try {
      const body: LaunchpadBootstrapRequest = {
        organizationName: organizationName.trim(),
        ...(organizationDisplayName.trim()
          ? { organizationDisplayName: organizationDisplayName.trim() }
          : {}),
        adminName: adminName.trim(),
        adminUsername: adminUsername.trim(),
        adminPassword,
        setupToken,
      };
      await api.post("/api/launchpad/bootstrap", body);
      setDone(true);
    } catch (err) {
      setSubmitError(
        getApiErrorMessage(err, t, t("launchpad.errors.bootstrapFailed")),
      );
    } finally {
      setSubmitting(false);
    }
  };

  // While the installation status is unknown, render the same shell so the
  // page does not flash empty before the redirect resolves.
  if (statusState === "loading") {
    return (
      <main
        data-testid="launchpad-layout"
        className="flex min-h-screen items-center justify-center bg-background p-4 sm:p-6"
      >
        <PageContainer role="auth">
          <Card className="w-full">
            <CardHeader>
              <BrandHeader textClassName="text-foreground" />
            </CardHeader>
            <CardContent />
          </Card>
        </PageContainer>
      </main>
    );
  }

  return (
    <main
      data-testid="launchpad-layout"
      className="flex min-h-screen items-center justify-center bg-background p-4 sm:p-6"
    >
      <PageContainer role="auth">
        <Card className="w-full">
          <CardHeader>
            <BrandHeader textClassName="text-foreground" />
          </CardHeader>
          <CardContent>
            <p className="type-section-title mb-2">{t("launchpad.title")}</p>
            <p className="type-secondary mb-6">{t("launchpad.subtitle")}</p>
            {statusState === "error" && (
              <InlineErrorBanner>
                {t("launchpad.errors.loadStatusFailed")}
              </InlineErrorBanner>
            )}
            <form onSubmit={handleSubmit}>
              <FieldGroup data-testid="launchpad-field-group" className="gap-4">
                <Field>
                  <Label htmlFor="organizationName">
                    {t("launchpad.organizationNameLabel")}
                  </Label>
                  <Input
                    id="organizationName"
                    type="text"
                    placeholder={t("launchpad.organizationNamePlaceholder")}
                    value={organizationName}
                    onChange={(e) => {
                      setOrganizationName(e.target.value);
                      if (fieldErrors.organizationName)
                        setFieldErrors((prev) => ({
                          ...prev,
                          organizationName: "",
                        }));
                    }}
                    disabled={submitting}
                  />
                  <FieldError>{fieldErrors.organizationName}</FieldError>
                </Field>
                <Field>
                  <Label htmlFor="organizationDisplayName">
                    {t("launchpad.organizationDisplayNameLabel")}
                  </Label>
                  <Input
                    id="organizationDisplayName"
                    type="text"
                    placeholder={t(
                      "launchpad.organizationDisplayNamePlaceholder",
                    )}
                    value={organizationDisplayName}
                    onChange={(e) => setOrganizationDisplayName(e.target.value)}
                    disabled={submitting}
                  />
                </Field>
                <Field>
                  <Label htmlFor="adminName">
                    {t("launchpad.adminNameLabel")}
                  </Label>
                  <Input
                    id="adminName"
                    type="text"
                    placeholder={t("launchpad.adminNamePlaceholder")}
                    value={adminName}
                    onChange={(e) => {
                      setAdminName(e.target.value);
                      if (fieldErrors.adminName)
                        setFieldErrors((prev) => ({ ...prev, adminName: "" }));
                    }}
                    disabled={submitting}
                  />
                  <FieldError>{fieldErrors.adminName}</FieldError>
                </Field>
                <Field>
                  <Label htmlFor="adminUsername">
                    {t("launchpad.adminUsernameLabel")}
                  </Label>
                  <Input
                    id="adminUsername"
                    type="text"
                    placeholder={t("launchpad.adminUsernamePlaceholder")}
                    value={adminUsername}
                    onChange={(e) => {
                      setAdminUsername(e.target.value);
                      if (fieldErrors.adminUsername)
                        setFieldErrors((prev) => ({
                          ...prev,
                          adminUsername: "",
                        }));
                    }}
                    disabled={submitting}
                  />
                  <FieldError>{fieldErrors.adminUsername}</FieldError>
                </Field>
                <Field>
                  <Label htmlFor="adminPassword">
                    {t("launchpad.adminPasswordLabel")}
                  </Label>
                  <Input
                    id="adminPassword"
                    type="password"
                    placeholder={t("launchpad.adminPasswordPlaceholder")}
                    value={adminPassword}
                    onChange={(e) => {
                      setAdminPassword(e.target.value);
                      if (fieldErrors.adminPassword)
                        setFieldErrors((prev) => ({
                          ...prev,
                          adminPassword: "",
                        }));
                    }}
                    disabled={submitting}
                  />
                  <FieldError>{fieldErrors.adminPassword}</FieldError>
                </Field>
                <Field>
                  <Label htmlFor="setupToken">
                    {t("launchpad.setupTokenLabel")}
                  </Label>
                  <Input
                    id="setupToken"
                    type="password"
                    placeholder={t("launchpad.setupTokenPlaceholder")}
                    value={setupToken}
                    onChange={(e) => {
                      setSetupToken(e.target.value);
                      if (fieldErrors.setupToken)
                        setFieldErrors((prev) => ({ ...prev, setupToken: "" }));
                    }}
                    disabled={submitting}
                  />
                  <FieldError>{fieldErrors.setupToken}</FieldError>
                </Field>
                {submitError && (
                  <InlineErrorBanner>{submitError}</InlineErrorBanner>
                )}
                <Button
                  type="submit"
                  variant="primary"
                  className="w-full"
                  disabled={submitting}
                >
                  {submitting
                    ? t("launchpad.submitting")
                    : t("launchpad.submit")}
                </Button>
              </FieldGroup>
            </form>
          </CardContent>
        </Card>
      </PageContainer>
    </main>
  );
}
