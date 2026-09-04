import { useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "@/lib/api";
import { getApiErrorMessage } from "@/lib/apiErrors";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { FieldGroup, Field } from "@/components/shared/FieldGroup";
import { DEFAULT_PASSWORD_POLICY } from "@exam/contracts";

/**
 * Bare password change form with current/new/confirm fields and
 * minimum-length validation. The hosting page owns the section frame
 * (FormSection); this component owns only the form.
 *
 * Changing the password revokes every issued token for the account (durable
 * per-user credential epoch), so a successful change signs the user out:
 * the form performs an explicit logout + redirect to /login instead of
 * leaving the UI on a page whose next request would 401.
 */
export function PasswordChangeForm() {
  const { t } = useTranslation();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [changing, setChanging] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (newPassword !== confirmPassword) {
      toast.error(t("validation.passwordMismatch"));
      return;
    }
    if (newPassword.length < DEFAULT_PASSWORD_POLICY.minLength) {
      toast.error(
        t("validation.passwordMin", { min: DEFAULT_PASSWORD_POLICY.minLength }),
      );
      return;
    }
    setChanging(true);
    try {
      await api.patch<{ ok: true }>("/api/auth/me/password", {
        currentPassword,
        newPassword,
      });
      toast.success(t("validation.passwordChangeSuccess"));
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      await api.post("/api/auth/logout");
      window.location.assign("/login");
    } catch (err) {
      toast.error(
        getApiErrorMessage(err, t, t("validation.passwordChangeFailed")),
      );
    } finally {
      setChanging(false);
    }
  }

  return (
    <form className="max-w-sm" onSubmit={handleSubmit}>
      <FieldGroup>
        <Field>
          <Label htmlFor="current-password">
            {t("passwordChange.currentLabel")}
          </Label>
          <Input
            id="current-password"
            type="password"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            required
          />
        </Field>
        <Field>
          <Label htmlFor="new-password">{t("passwordChange.newLabel")}</Label>
          <Input
            id="new-password"
            type="password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            required
            minLength={DEFAULT_PASSWORD_POLICY.minLength}
          />
          <p className="type-metadata">
            {t("validation.passwordMinChars", {
              min: DEFAULT_PASSWORD_POLICY.minLength,
            })}
          </p>
        </Field>
        <Field>
          <Label htmlFor="confirm-password">
            {t("passwordChange.confirmLabel")}
          </Label>
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
          {changing ? t("passwordChange.saving") : t("passwordChange.button")}
        </Button>
      </FieldGroup>
    </form>
  );
}
