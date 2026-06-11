import { useState, useEffect, useCallback } from "react";
import type { UpdateBrandingRequest } from "@exam/contracts";
import { api } from "@/lib/api";
import { PageHeader } from "@/components/shared/PageHeader";
import { PlatformSettingsForm } from "@/components/settings/PlatformSettingsForm";
import { PasswordChangeForm } from "@/components/settings/PasswordChangeForm";
import { LoadingState } from "@/components/shared/LoadingState";
import { ErrorState } from "@/components/shared/ErrorState";
import { FormSection } from "@/components/shared/FormSection";

type SettingsData = UpdateBrandingRequest;

export function SettingsPage() {
  const [settings, setSettings] = useState<SettingsData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

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
    const filtered = Object.fromEntries(
      Object.entries(data).filter(([, v]) => v !== ""),
    );
    setIsSaving(true);
    try {
      const updated = await api.patch<SettingsData>(
        "/api/admin/settings/branding",
        filtered,
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
    <div className="flex flex-col gap-6">
      <PageHeader title="平台与机构设置" />
      <FormSection
        title="品牌设置"
        description="配置当前部署显示给用户的名称与页脚。"
      >
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
