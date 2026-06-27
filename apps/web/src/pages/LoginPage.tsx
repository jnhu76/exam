import { useState } from "react";
import { BrandHeader } from "@/components/layout/BrandHeader";
import { useBranding } from "@/components/layout/BrandProvider";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { FieldError } from "@/components/shared/FieldError";
import { FieldGroup, Field } from "@/components/shared/FieldGroup";

export function LoginPage() {
  const branding = useBranding();
  const { login, isSubmittingLogin, error } = useAuth();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const validate = () => {
    const errors: Record<string, string> = {};
    if (!username.trim()) errors.username = "请输入用户名";
    if (!password.trim()) errors.password = "请输入密码";
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
      className="flex min-h-screen items-center justify-center bg-background p-6"
    >
      <div className="w-full max-w-sm">
        <div className="mb-8 flex justify-center">
          <BrandHeader textClassName="text-foreground" />
        </div>

        {branding.productSubtitle && (
          <p className="mb-6 text-center text-sm text-muted-foreground">
            {branding.productSubtitle}
          </p>
        )}

        <form onSubmit={handleSubmit}>
          <FieldGroup data-testid="login-field-group" className="gap-5">
            <Field>
              <Label htmlFor="username">用户名</Label>
              <Input
                id="username"
                type="text"
                placeholder="请输入用户名"
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
              <Label htmlFor="password">密码</Label>
              <Input
                id="password"
                type="password"
                placeholder="请输入密码"
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
            {error && (
              <Alert variant="destructive" className="py-2">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
            <Button
              type="submit"
              variant="primary"
              className="w-full"
              disabled={isSubmittingLogin}
            >
              {isSubmittingLogin ? "登录中..." : "登录"}
            </Button>
          </FieldGroup>
        </form>
      </div>
    </main>
  );
}
