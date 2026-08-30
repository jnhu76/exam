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
import { api } from "@/lib/api";
import { routes } from "@/lib/routes";

/**
 * Public invitation-acceptance page (issue 297). The token in the URL is the
 * credential: the server consumes it single-use and creates the account with
 * the invited role. On success the user is redirected to login; any invalid,
 * expired, or revoked token gets the same generic failure.
 */
export function InviteAcceptPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token") ?? "";
  const [username, setUsername] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  const validate = () => {
    const errors: Record<string, string> = {};
    if (!username.trim()) errors.username = t("auth.invite.usernameRequired");
    else if (username.trim().length < 3)
      errors.username = t("auth.invite.usernameTooShort");
    if (!name.trim()) errors.name = t("auth.invite.nameRequired");
    if (!password) errors.password = t("auth.invite.passwordRequired");
    else if (password.length < 8)
      errors.password = t("auth.invite.passwordTooShort");
    if (confirmPassword !== password)
      errors.confirmPassword = t("auth.invite.passwordMismatch");
    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!validate()) return;
    setSubmitting(true);
    try {
      await api.post("/api/auth/invitations/accept", {
        token,
        username: username.trim(),
        name: name.trim(),
        password,
      });
      setDone(true);
    } catch (err) {
      setError(
        err instanceof Error && err.message
          ? err.message
          : t("auth.invite.failed"),
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main
      data-testid="invite-accept-layout"
      className="flex min-h-screen items-center justify-center bg-background p-4 sm:p-6"
    >
      <PageContainer role="auth">
        <Card className="w-full">
          <CardHeader>
            <BrandHeader textClassName="text-foreground" />
          </CardHeader>
          <CardContent>
            {done ? (
              <div className="space-y-4" data-testid="invite-accept-success">
                <p className="type-secondary">
                  {t("auth.invite.successMessage")}
                </p>
                <Button
                  variant="primary"
                  className="w-full"
                  onClick={() => navigate(routes.login)}
                >
                  {t("auth.invite.goLogin")}
                </Button>
              </div>
            ) : (
              <form onSubmit={handleSubmit}>
                <FieldGroup
                  data-testid="invite-accept-field-group"
                  className="gap-4"
                >
                  <p className="type-secondary">
                    {t("auth.invite.description")}
                  </p>
                  <Field>
                    <Label htmlFor="username">
                      {t("auth.invite.usernameLabel")}
                    </Label>
                    <Input
                      id="username"
                      type="text"
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                      disabled={submitting}
                    />
                    <FieldError>{fieldErrors.username}</FieldError>
                  </Field>
                  <Field>
                    <Label htmlFor="name">{t("auth.invite.nameLabel")}</Label>
                    <Input
                      id="name"
                      type="text"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      disabled={submitting}
                    />
                    <FieldError>{fieldErrors.name}</FieldError>
                  </Field>
                  <Field>
                    <Label htmlFor="password">
                      {t("auth.invite.passwordLabel")}
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
                      {t("auth.invite.confirmPasswordLabel")}
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
                      ? t("auth.invite.submitting")
                      : t("auth.invite.submit")}
                  </Button>
                  <Link
                    to={routes.login}
                    className="type-secondary text-center hover:underline"
                  >
                    {t("auth.invite.backToLogin")}
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
