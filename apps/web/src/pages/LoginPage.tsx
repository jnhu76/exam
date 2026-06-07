import { useState } from "react";
import { BrandHeader } from "@/components/layout/BrandHeader";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { useBranding } from "@/components/layout/BrandProvider";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FieldError } from "@/components/shared/FieldError";

export function LoginPage() {
  const branding = useBranding();
  const { login, isLoading, error } = useAuth();
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
      <Card className="w-full max-w-sm">
        <CardHeader>
          <BrandHeader />
        </CardHeader>
        <CardContent>
          {branding.productSubtitle && (
            <p className="text-sm text-muted-foreground mb-6">
              {branding.productSubtitle}
            </p>
          )}
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
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
                disabled={isLoading}
              />
              <FieldError>{fieldErrors.username}</FieldError>
            </div>
            <div className="space-y-2">
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
                disabled={isLoading}
              />
              <FieldError>{fieldErrors.password}</FieldError>
            </div>
            {error && (
              <div
                role="alert"
                className="text-sm text-destructive bg-destructive/10 p-2 rounded"
              >
                {error}
              </div>
            )}
            <Button type="submit" className="w-full" disabled={isLoading}>
              {isLoading ? "登录中..." : "登录"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
