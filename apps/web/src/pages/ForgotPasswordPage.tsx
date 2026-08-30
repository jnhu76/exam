import { useState } from "react";
import { Link, useNavigate } from "react-router";
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
import { api } from "@/lib/api";
import { routes } from "@/lib/routes";

/**
 * Public forgot-password page (issue 297). Asks for the login username and sends
 * a reset link to the address stored on the account. The response is
 * uniform by contract (anti-enumeration), so the page always shows the same
 * generic confirmation — it must never hint whether the account exists.
 */
export function ForgotPasswordPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [username, setUsername] = useState("");
  const [fieldError, setFieldError] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!username.trim()) {
      setFieldError(t("auth.forgot.usernameRequired"));
      return;
    }
    setFieldError("");
    setSubmitting(true);
    try {
      await api.post("/api/auth/password-reset/request", {
        username: username.trim(),
      });
      setSent(true);
    } catch (err) {
      setError(
        err instanceof Error && err.message
          ? err.message
          : t("auth.forgot.failed"),
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main
      data-testid="forgot-password-layout"
      className="flex min-h-screen items-center justify-center bg-background p-4 sm:p-6"
    >
      <PageContainer role="auth">
        <Card className="w-full">
          <CardHeader>
            <BrandHeader textClassName="text-foreground" />
          </CardHeader>
          <CardContent>
            {sent ? (
              <div className="space-y-4" data-testid="forgot-password-sent">
                <p className="type-secondary">{t("auth.forgot.sentMessage")}</p>
                <Button
                  variant="primary"
                  className="w-full"
                  onClick={() => navigate(routes.login)}
                >
                  {t("auth.forgot.backToLogin")}
                </Button>
              </div>
            ) : (
              <form onSubmit={handleSubmit}>
                <FieldGroup
                  data-testid="forgot-password-field-group"
                  className="gap-4"
                >
                  <p className="type-secondary">
                    {t("auth.forgot.description")}
                  </p>
                  <Field>
                    <Label htmlFor="username">
                      {t("auth.forgot.usernameLabel")}
                    </Label>
                    <Input
                      id="username"
                      type="text"
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                      disabled={submitting}
                    />
                    <FieldError>{fieldError}</FieldError>
                  </Field>
                  {error && <InlineErrorBanner>{error}</InlineErrorBanner>}
                  <Button
                    type="submit"
                    variant="primary"
                    className="w-full"
                    disabled={submitting}
                  >
                    {submitting
                      ? t("auth.forgot.submitting")
                      : t("auth.forgot.submit")}
                  </Button>
                  <Link
                    to={routes.login}
                    className="type-secondary text-center hover:underline"
                  >
                    {t("auth.forgot.backToLogin")}
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
