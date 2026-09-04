import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { useTranslation } from "react-i18next";
import { BrandHeader } from "@/components/layout/BrandHeader";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FieldError } from "@/components/shared/FieldError";
import { InlineErrorBanner } from "@/components/shared/InlineErrorBanner";
import { FieldGroup, Field } from "@/components/shared/FieldGroup";
import { PageContainer } from "@/components/shared/PageContainer";
import { getApiErrorMessage } from "@/lib/apiErrors";
import { api } from "@/lib/api";
import { routes } from "@/lib/routes";

/**
 * Public password-reset consumption page (issue 297). The token in the URL is the
 * credential; it is consumed single-use server-side. Invalid, expired, or
 * already-used tokens (including tokens burned by deactivation) all get the
 * same generic failure.
 */
export function ResetPasswordPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token") ?? "";
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  const validate = () => {
    const errors: Record<string, string> = {};
    if (!password) errors.password = t("auth.reset.passwordRequired");
    else if (password.length < 8)
      errors.password = t("auth.reset.passwordTooShort");
    if (confirmPassword !== password)
      errors.confirmPassword = t("auth.reset.passwordMismatch");
    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!validate()) return;
    setSubmitting(true);
    try {
      await api.post("/api/auth/password-reset/consume", {
        token,
        password,
      });
      setDone(true);
    } catch (err) {
      setError(getApiErrorMessage(err, t, t("auth.reset.failed")));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main
      data-testid="reset-password-layout"
      className="flex min-h-screen items-center justify-center bg-background p-4 sm:p-6"
    >
      <PageContainer role="auth">
        <Card className="w-full">
          <CardHeader>
            <BrandHeader textClassName="text-foreground" />
          </CardHeader>
          <CardContent>
            {done ? (
              <div className="space-y-4" data-testid="reset-password-success">
                <p className="type-secondary">
                  {t("auth.reset.successMessage")}
                </p>
                <Button
                  variant="primary"
                  className="w-full"
                  onClick={() => navigate(routes.login)}
                >
                  {t("auth.reset.goLogin")}
                </Button>
              </div>
            ) : (
              <form onSubmit={handleSubmit}>
                <FieldGroup
                  data-testid="reset-password-field-group"
                  className="gap-4"
                >
                  <p className="type-secondary">
                    {t("auth.reset.description")}
                  </p>
                  <Field>
                    <Label htmlFor="password">
                      {t("auth.reset.passwordLabel")}
                    </Label>
                    <Input
                      id="password"
                      type="password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      disabled={submitting}
                    />
                    <FieldError>{fieldErrors.password}</FieldError>
                  </Field>
                  <Field>
                    <Label htmlFor="confirmPassword">
                      {t("auth.reset.confirmPasswordLabel")}
                    </Label>
                    <Input
                      id="confirmPassword"
                      type="password"
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      disabled={submitting}
                    />
                    <FieldError>{fieldErrors.confirmPassword}</FieldError>
                  </Field>
                  {error && <InlineErrorBanner>{error}</InlineErrorBanner>}
                  <Button
                    type="submit"
                    variant="primary"
                    className="w-full"
                    disabled={submitting || !token}
                  >
                    {submitting
                      ? t("auth.reset.submitting")
                      : t("auth.reset.submit")}
                  </Button>
                  <Link
                    to={routes.login}
                    className="type-secondary text-center hover:underline"
                  >
                    {t("auth.reset.backToLogin")}
                  </Link>
                </FieldGroup>
              </form>
            )}
          </CardContent>
        </Card>
      </PageContainer>
    </main>
  );
}
