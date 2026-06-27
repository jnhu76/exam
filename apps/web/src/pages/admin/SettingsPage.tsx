import { useState, useEffect, useCallback } from "react";
import type { UpdateBrandingRequest } from "@exam/contracts";
import { api } from "@/lib/api";
import { getApiErrorMessage } from "@/lib/apiErrors";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import { PlatformSettingsForm } from "@/components/settings/PlatformSettingsForm";
import { PasswordChangeForm } from "@/components/settings/PasswordChangeForm";
import { LoadingState } from "@/components/shared/LoadingState";
import { ErrorState } from "@/components/shared/ErrorState";
import { InlineErrorBanner } from "@/components/shared/InlineErrorBanner";
import { AdminShell, AdminShellHeader } from "@/components/admin";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FieldGroup, Field } from "@/components/shared/FieldGroup";
import { FieldError } from "@/components/shared/FieldError";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

type SettingsData = UpdateBrandingRequest;

export function SettingsPage() {
  const { user, updateProfile } = useAuth();
  const [settings, setSettings] = useState<SettingsData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [profileName, setProfileName] = useState("");
  const [profileError, setProfileError] = useState("");
  const [savingProfile, setSavingProfile] = useState(false);

  const loadSettings = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await api.get<SettingsData>("/api/admin/settings");
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

  useEffect(() => {
    setProfileName(user?.name ?? "");
  }, [user]);

  async function handleSave(data: SettingsData) {
    const filtered = Object.fromEntries(
      Object.entries(data).filter(([, v]) => v !== ""),
    );
    setIsSaving(true);
    setSaveError(null);
    try {
      const updated = await api.patch<SettingsData>(
        "/api/admin/settings/branding",
        filtered,
      );
      setSettings(updated);
      window.dispatchEvent(new Event("branding:refresh"));
    } catch (err) {
      setSaveError(getApiErrorMessage(err, "保存设置失败，请稍后重试"));
    } finally {
      setIsSaving(false);
    }
  }

  async function handleSaveProfile(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = profileName.trim();
    if (!trimmed) {
      setProfileError("请输入姓名");
      return;
    }
    setSavingProfile(true);
    setProfileError("");
    try {
      await updateProfile(trimmed);
      toast.success("个人信息已更新");
    } catch (err) {
      setProfileError(getApiErrorMessage(err, "保存失败，请稍后重试"));
    } finally {
      setSavingProfile(false);
    }
  }

  if (isLoading) return <LoadingState />;
  if (error) return <ErrorState message={error} onRetry={loadSettings} />;
  if (!user) return <ErrorState message="请先登录" onRetry={loadSettings} />;

  return (
    <AdminShell>
      <AdminShellHeader title="平台与机构设置" />
      <Tabs defaultValue="profile">
        <TabsList>
          <TabsTrigger value="profile">个人信息</TabsTrigger>
          <TabsTrigger value="branding">品牌设置</TabsTrigger>
          <TabsTrigger value="security">账号安全</TabsTrigger>
        </TabsList>

        <TabsContent value="profile">
          {profileError && (
            <InlineErrorBanner>{profileError}</InlineErrorBanner>
          )}
          <form className="max-w-sm" onSubmit={handleSaveProfile}>
            <FieldGroup>
              <Field>
                <Label htmlFor="profile-name">姓名</Label>
                <Input
                  id="profile-name"
                  value={profileName}
                  maxLength={100}
                  onChange={(e) => {
                    setProfileName(e.target.value);
                    if (profileError) setProfileError("");
                  }}
                />
                <FieldError>{profileError}</FieldError>
              </Field>
              <Button
                type="submit"
                disabled={savingProfile}
                data-testid="profile-save-btn"
              >
                {savingProfile ? "保存中..." : "保存"}
              </Button>
            </FieldGroup>
          </form>
        </TabsContent>

        <TabsContent value="branding">
          {saveError && <InlineErrorBanner>{saveError}</InlineErrorBanner>}
          <PlatformSettingsForm
            initialValues={settings ?? undefined}
            onSave={handleSave}
            isLoading={isSaving}
          />
        </TabsContent>

        <TabsContent value="security">
          <PasswordChangeForm cardWrapper={false} />
        </TabsContent>
      </Tabs>
    </AdminShell>
  );
}
