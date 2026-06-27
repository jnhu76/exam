import { useState, useEffect, useCallback } from "react";
import type { UpdateBrandingRequest } from "@exam/contracts";
import { api } from "@/lib/api";
import { getApiErrorMessage } from "@/lib/apiErrors";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import { PageHeader } from "@/components/shared/PageHeader";
import { PlatformSettingsForm } from "@/components/settings/PlatformSettingsForm";
import { PasswordChangeForm } from "@/components/settings/PasswordChangeForm";
import { LoadingState } from "@/components/shared/LoadingState";
import { ErrorState } from "@/components/shared/ErrorState";
import { FormSection } from "@/components/shared/FormSection";
import { InlineErrorBanner } from "@/components/shared/InlineErrorBanner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FieldGroup, Field } from "@/components/shared/FieldGroup";
import { FieldError } from "@/components/shared/FieldError";

/** Branding settings data shape, reusing the contract type directly. */
type SettingsData = UpdateBrandingRequest;

/** Admin page for managing platform branding and the current admin's password. */
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

  /** Fetches the full organization settings from the aggregate API. */
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

  /** Saves updated branding settings and dispatches a global refresh event. */
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

  /** Saves the current admin's display name via the profile API. */
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
    <div className="flex flex-col gap-6">
      <PageHeader title="平台与机构设置" />
      <FormSection title="个人信息" description="编辑当前账号的显示姓名。">
        {profileError && <InlineErrorBanner>{profileError}</InlineErrorBanner>}
        <form className="max-w-sm" onSubmit={handleSaveProfile}>
          <FieldGroup>
            <Field>
              <Label htmlFor="profile-name">姓名</Label>
              <Input
                id="profile-name"
                value={profileName}
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
      </FormSection>
      <FormSection
        title="品牌设置"
        description="配置当前部署显示给用户的名称与页脚。"
      >
        {saveError && <InlineErrorBanner>{saveError}</InlineErrorBanner>}
        <PlatformSettingsForm
          initialValues={settings ?? undefined}
          onSave={handleSave}
          isLoading={isSaving}
        />
      </FormSection>
      <FormSection title="账号安全" description="修改当前账号的登录密码。">
        <PasswordChangeForm cardWrapper={false} />
      </FormSection>
    </div>
  );
}
