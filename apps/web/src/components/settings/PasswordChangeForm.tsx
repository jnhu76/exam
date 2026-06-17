import { useState } from "react";
import { api } from "@/lib/api";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { FieldGroup, Field } from "@/components/shared/FieldGroup";
import { DEFAULT_PASSWORD_POLICY } from "@exam/contracts";

/**
 * Password change form with current/new/confirm fields and minimum-length
 * validation. Optionally wraps in a Card or renders as a bare <form>.
 */
export function PasswordChangeForm({
  cardWrapper = true,
}: {
  cardWrapper?: boolean;
}) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [changing, setChanging] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (newPassword !== confirmPassword) {
      toast.error("两次输入的新密码不一致");
      return;
    }
    if (newPassword.length < DEFAULT_PASSWORD_POLICY.minLength) {
      toast.error(`新密码至少 ${DEFAULT_PASSWORD_POLICY.minLength} 位`);
      return;
    }
    setChanging(true);
    try {
      await api.patch<{ ok: true }>("/api/auth/me/password", {
        currentPassword,
        newPassword,
      });
      toast.success("密码修改成功");
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "密码修改失败");
    } finally {
      setChanging(false);
    }
  }

  const form = (
    <form className="max-w-sm" onSubmit={handleSubmit}>
      <FieldGroup>
        <Field>
          <Label htmlFor="current-password">当前密码</Label>
          <Input
            id="current-password"
            type="password"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            required
          />
        </Field>
        <Field>
          <Label htmlFor="new-password">新密码</Label>
          <Input
            id="new-password"
            type="password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            required
            minLength={DEFAULT_PASSWORD_POLICY.minLength}
          />
          <p className="text-xs text-muted-foreground">
            至少 {DEFAULT_PASSWORD_POLICY.minLength} 位
          </p>
        </Field>
        <Field>
          <Label htmlFor="confirm-password">确认新密码</Label>
          <Input
            id="confirm-password"
            type="password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            required
            minLength={DEFAULT_PASSWORD_POLICY.minLength}
          />
        </Field>
        <Button type="submit" disabled={changing}>
          {changing ? "修改中..." : "修改密码"}
        </Button>
      </FieldGroup>
    </form>
  );

  if (!cardWrapper) return form;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">修改密码</CardTitle>
      </CardHeader>
      <CardContent>{form}</CardContent>
    </Card>
  );
}
