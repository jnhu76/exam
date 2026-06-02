import { useState, useEffect, useCallback } from "react";
import { api } from "@/lib/api";
import { PageHeader } from "@/components/shared/PageHeader";
import { PlatformSettingsForm } from "@/components/settings/PlatformSettingsForm";
import { PasswordChangeForm } from "@/components/settings/PasswordChangeForm";
import { LoadingState } from "@/components/shared/LoadingState";
import { ErrorState } from "@/components/shared/ErrorState";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";

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
      <Tabs defaultValue="branding">
        <TabsList>
          <TabsTrigger value="branding">品牌设置</TabsTrigger>
          <TabsTrigger value="security">账号安全</TabsTrigger>
        </TabsList>
        <TabsContent value="branding">
          <PlatformSettingsForm
            defaultValues={settings ?? {}}
            onSave={handleSave}
            isLoading={isSaving}
          />
        </TabsContent>
        <TabsContent value="security">
          <PasswordChangeForm />
        </TabsContent>
      </Tabs>
    </div>
  );
}
