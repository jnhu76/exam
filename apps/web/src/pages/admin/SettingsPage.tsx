import { useState, useEffect, useCallback } from "react";
import { api } from "@/lib/api";
import { toast } from "sonner";
import { PageHeader } from "@/components/shared/PageHeader";
import { PlatformSettingsForm } from "@/components/settings/PlatformSettingsForm";
import { LoadingState } from "@/components/shared/LoadingState";
import { ErrorState } from "@/components/shared/ErrorState";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";

interface SettingsData {
  productName?: string;
  productSubtitle?: string;
  footerText?: string;
  organizationDisplayName?: string;
  timezone?: string;
}

export function SettingsPage() {
  const [settings, setSettings] = useState<SettingsData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [changingPassword, setChangingPassword] = useState(false);

  const loadSettings = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await api.get<SettingsData>("/api/admin/settings/branding");
      setSettings(data);
    } catch {
      setError("加载设置失败");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  async function handleSave(data: SettingsData) {
    setIsSaving(true);
    try {
      const updated = await api.patch<SettingsData>(
        "/api/admin/settings/branding",
        data,
      );
      setSettings(updated);
      window.dispatchEvent(new Event("branding:refresh"));
    } catch {
      // error handled by toast
    } finally {
      setIsSaving(false);
    }
  }

  if (isLoading) return <LoadingState />;
  if (error) return <ErrorState message={error} onRetry={loadSettings} />;

  return (
    <div className="space-y-6">
      <PageHeader title="平台与机构设置" />
      <PlatformSettingsForm
        defaultValues={settings ?? {}}
        onSave={handleSave}
        isLoading={isSaving}
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">修改密码</CardTitle>
        </CardHeader>
        <CardContent>
          <form
            className="max-w-sm space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              async function doChange() {
                if (newPassword !== confirmPassword) {
                  toast.error("两次输入的新密码不一致");
                  return;
                }
                setChangingPassword(true);
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
                  toast.error(
                    err instanceof Error ? err.message : "密码修改失败",
                  );
                } finally {
                  setChangingPassword(false);
                }
              }
              void doChange();
            }}
          >
            <div className="space-y-2">
              <Label htmlFor="current-password">当前密码</Label>
              <Input
                id="current-password"
                type="password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="new-password">新密码</Label>
              <Input
                id="new-password"
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                required
                minLength={6}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="confirm-password">确认新密码</Label>
              <Input
                id="confirm-password"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
                minLength={6}
              />
            </div>
            <Button type="submit" disabled={changingPassword}>
              {changingPassword ? "修改中..." : "修改密码"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
