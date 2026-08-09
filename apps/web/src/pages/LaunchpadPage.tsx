import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router";
import type { LaunchpadState } from "@exam/contracts";
import { BrandHeader } from "@/components/layout/BrandHeader";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { useBranding } from "@/components/layout/BrandProvider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FieldError } from "@/components/shared/FieldError";
import { InlineErrorBanner } from "@/components/shared/InlineErrorBanner";
import { FieldGroup, Field } from "@/components/shared/FieldGroup";
import { PageContainer } from "@/components/shared/PageContainer";
import { api } from "@/lib/api";

/**
 * First-install launchpad page (P7-C1 C1.6).
 *
 * The operator configures LAUNCHPAD_SETUP_TOKEN on a fresh deployment; the
 * business administrator opens /launchpad and creates the first Admin (org +
 * credentials + setup code). Once the installation has EVER been initialized
 * (an organization or user exists) the launchpad is permanently COMPLETED and
 * this page only offers a link to /login — it never reopens, so the last Admin
 * being deleted cannot be used to take over a deployment.
 *
 * Mirrors the LoginPage visual role (auth card); routed at App top level,
 * OUTSIDE AdminLayout/ExamShell, as a sibling of /login.
 */
export function LaunchpadPage() {
  const { t } = useTranslation();
  const branding = useBranding();
  const navigate = useNavigate();

  const [status, setStatus] = useState<
    "loading" | "READY" | "OPERATOR_ACTIVATION_REQUIRED" | "COMPLETED"
  >("loading");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const [organizationName, setOrganizationName] = useState("");
  const [organizationDisplayName, setOrganizationDisplayName] = useState("");
  const [username, setUsername] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [setupToken, setSetupToken] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    let cancelled = false;
    api
      .get<{ state: LaunchpadState }>("/api/launchpad/status")
      .then((res) => {
        if (!cancelled) setStatus(res.state);
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setLoadError(
            error instanceof Error
              ? error.message
              : t("launchpad.statusFailed"),
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, [t]);

  const clearFieldError = (field: string) => {
    if (fieldErrors[field]) {
      setFieldErrors((prev) => ({ ...prev, [field]: "" }));
    }
  };

  const validate = () => {
    const errors: Record<string, string> = {};
    if (!organizationName.trim()) {
      errors.organizationName = t("launchpad.organizationNameRequired");
    }
    if (username.trim().length < 3) {
      errors.username = t("launchpad.usernameMinLength");
    }
    if (!name.trim()) {
      errors.name = t("launchpad.nameRequired");
    }
    if (password.length < 8) {
      errors.password = t("launchpad.passwordMinLength");
    }
    if (!setupToken.trim()) {
      errors.setupToken = t("launchpad.setupTokenRequired");
    }
    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;
    setSubmitError(null);
    setSubmitting(true);
    try {
      await api.post("/api/launchpad/bootstrap", {
        setupToken,
        organizationName: organizationName.trim(),
        ...(organizationDisplayName.trim()
          ? { organizationDisplayName: organizationDisplayName.trim() }
          : {}),
        username: username.trim(),
        name: name.trim(),
        password,
      });
      // No auto-login: bootstrap authority and authentication stay separate.
      navigate("/login", { state: { launchpadComplete: true } });
    } catch (error) {
      setSubmitError(
        error instanceof Error ? error.message : t("launchpad.submitFailed"),
      );
      setSubmitting(false);
    }
  };

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
            {branding.productSubtitle && (
              <p className="type-secondary mb-6">{branding.productSubtitle}</p>
            )}
            {status === "loading" && !loadError && (
              <p className="type-body">{t("launchpad.statusLoading")}</p>
            )}
            {loadError && <InlineErrorBanner>{loadError}</InlineErrorBanner>}
            {status === "OPERATOR_ACTIVATION_REQUIRED" && (
              <div className="flex flex-col gap-4">
                <p className="type-body">
                  {t("launchpad.operatorActivationRequiredBody")}
                </p>
                <Button
                  variant="secondary"
                  className="w-full"
                  onClick={() => navigate("/login")}
                >
                  {t("launchpad.goToLogin")}
                </Button>
              </div>
            )}
            {status === "COMPLETED" && (
              <div className="flex flex-col gap-4">
                <p className="type-body">{t("launchpad.completedBody")}</p>
                <Button
                  variant="primary"
                  className="w-full"
                  onClick={() => navigate("/login")}
                >
                  {t("launchpad.goToLogin")}
                </Button>
              </div>
            )}
            {status === "READY" && (
              <form onSubmit={handleSubmit}>
                <FieldGroup
                  data-testid="launchpad-field-group"
                  className="gap-4"
                >
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
                        clearFieldError("organizationName");
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
                      onChange={(e) =>
                        setOrganizationDisplayName(e.target.value)
                      }
                      disabled={submitting}
                    />
                  </Field>
                  <Field>
                    <Label htmlFor="launchpad-username">
                      {t("launchpad.usernameLabel")}
                    </Label>
                    <Input
                      id="launchpad-username"
                      type="text"
                      placeholder={t("launchpad.usernamePlaceholder")}
                      value={username}
                      onChange={(e) => {
                        setUsername(e.target.value);
                        clearFieldError("username");
                      }}
                      disabled={submitting}
                    />
                    <FieldError>{fieldErrors.username}</FieldError>
                  </Field>
                  <Field>
                    <Label htmlFor="launchpad-name">
                      {t("launchpad.nameLabel")}
                    </Label>
                    <Input
                      id="launchpad-name"
                      type="text"
                      placeholder={t("launchpad.namePlaceholder")}
                      value={name}
                      onChange={(e) => {
                        setName(e.target.value);
                        clearFieldError("name");
                      }}
                      disabled={submitting}
                    />
                    <FieldError>{fieldErrors.name}</FieldError>
                  </Field>
                  <Field>
                    <Label htmlFor="launchpad-password">
                      {t("launchpad.passwordLabel")}
                    </Label>
                    <Input
                      id="launchpad-password"
                      type="password"
                      placeholder={t("launchpad.passwordPlaceholder")}
                      value={password}
                      onChange={(e) => {
                        setPassword(e.target.value);
                        clearFieldError("password");
                      }}
                      disabled={submitting}
                    />
                    <FieldError>{fieldErrors.password}</FieldError>
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
                        clearFieldError("setupToken");
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
            )}
          </CardContent>
        </Card>
      </PageContainer>
    </main>
  );
}
