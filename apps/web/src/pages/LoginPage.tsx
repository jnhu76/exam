import { useState } from "react";
import { useTranslation } from "react-i18next";
import { BrandHeader } from "@/components/layout/BrandHeader";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { useBranding } from "@/components/layout/BrandProvider";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FieldError } from "@/components/shared/FieldError";
import { InlineErrorBanner } from "@/components/shared/InlineErrorBanner";
import { FieldGroup, Field } from "@/components/shared/FieldGroup";
import { PageContainer } from "@/components/shared/PageContainer";

/**
 * Login page with username/password form, field validation,
 * and branding header. Redirects to the appropriate dashboard on success.
 */
export function LoginPage() {
  const { t } = useTranslation();
  const branding = useBranding();
  const { login, isSubmittingLogin, error } = useAuth();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const validate = () => {
    const errors: Record<string, string> = {};
    if (!username.trim()) errors.username = t("auth.login.usernameRequired");
    if (!password.trim()) errors.password = t("auth.login.passwordRequired");
    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;
    await login(username, password);
  };

  return (
    <main
      data-testid="login-layout"
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
            <form onSubmit={handleSubmit}>
              <FieldGroup data-testid="login-field-group" className="gap-4">
                <Field>
                  <Label htmlFor="username">
                    {t("auth.login.usernameLabel")}
                  </Label>
                  <Input
                    id="username"
                    type="text"
                    placeholder={t("auth.login.usernamePlaceholder")}
                    value={username}
                    onChange={(e) => {
                      setUsername(e.target.value);
                      if (fieldErrors.username)
                        setFieldErrors((prev) => ({ ...prev, username: "" }));
                    }}
                    disabled={isSubmittingLogin}
                  />
                  <FieldError>{fieldErrors.username}</FieldError>
                </Field>
                <Field>
                  <Label htmlFor="password">
                    {t("auth.login.passwordLabel")}
                  </Label>
                  <Input
                    id="password"
                    type="password"
                    placeholder={t("auth.login.passwordPlaceholder")}
                    value={password}
                    onChange={(e) => {
                      setPassword(e.target.value);
                      if (fieldErrors.password)
                        setFieldErrors((prev) => ({ ...prev, password: "" }));
                    }}
                    disabled={isSubmittingLogin}
                  />
                  <FieldError>{fieldErrors.password}</FieldError>
                </Field>
                {error && <InlineErrorBanner>{error}</InlineErrorBanner>}
                <Button
                  type="submit"
                  variant="primary"
                  className="w-full"
                  disabled={isSubmittingLogin}
                >
                  {isSubmittingLogin
                    ? t("auth.login.submitting")
                    : t("auth.login.submit")}
                </Button>
              </FieldGroup>
            </form>
          </CardContent>
        </Card>
      </PageContainer>
    </main>
  );
}
