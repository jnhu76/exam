import { useState, useEffect, useCallback } from "react";
import type { UpdateBrandingRequest } from "@exam/contracts";
import { useTranslation } from "react-i18next";
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
  const { t } = useTranslation();
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
      setError(t("admin.settings.loadDataFailed"));
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
      setSaveError(
        getApiErrorMessage(err, t, t("admin.settings.brandSection.saveFailed")),
      );
    } finally {
      setIsSaving(false);
    }
  }

  /** Saves the current admin's display name via the profile API. */
  async function handleSaveProfile(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = profileName.trim();
    if (!trimmed) {
      setProfileError(
        t("admin.settings.profileSection.validation.nameRequired"),
      );
      return;
    }
    setSavingProfile(true);
    setProfileError("");
    try {
      await updateProfile(trimmed);
      toast.success(t("admin.settings.profileSection.feedback.updateSuccess"));
    } catch (err) {
      setProfileError(
        getApiErrorMessage(
          err,
          t,
          t("admin.settings.profileSection.feedback.saveFailed"),
        ),
      );
    } finally {
      setSavingProfile(false);
    }
  }

  if (isLoading) return <LoadingState />;
  if (error) return <ErrorState message={error} onRetry={loadSettings} />;
  if (!user)
    return (
      <ErrorState
        message={t("admin.settings.loginRequired")}
        onRetry={loadSettings}
      />
    );

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t("admin.settings.pageTitle")} />
      <FormSection
        title={t("admin.settings.profileSection.title")}
        description={t("admin.settings.profileSection.description")}
      >
        {profileError && <InlineErrorBanner>{profileError}</InlineErrorBanner>}
        <form className="max-w-sm" onSubmit={handleSaveProfile}>
          <FieldGroup>
            <Field>
              <Label htmlFor="profile-name">
                {t("admin.settings.profileSection.nameLabel")}
              </Label>
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
              {savingProfile
                ? t("admin.settings.actions.saving")
                : t("admin.settings.actions.save")}
            </Button>
          </FieldGroup>
        </form>
      </FormSection>
      <FormSection
        title={t("admin.settings.brandSection.title")}
        description={t("admin.settings.brandSection.description")}
      >
        {saveError && <InlineErrorBanner>{saveError}</InlineErrorBanner>}
        <PlatformSettingsForm
          initialValues={settings ?? undefined}
          onSave={handleSave}
          isLoading={isSaving}
        />
      </FormSection>
      <FormSection
        title={t("admin.settings.securitySection.title")}
        description={t("admin.settings.securitySection.description")}
      >
        <PasswordChangeForm />
      </FormSection>
    </div>
  );
}
