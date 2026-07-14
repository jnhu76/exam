import { useTranslation } from "react-i18next";
import { PasswordChangeForm } from "@/components/settings/PasswordChangeForm";

/** Account settings page where the candidate can change their password. */
export function ExamSettingsPage() {
  const { t } = useTranslation();
  return (
    <div className="mx-auto max-w-2xl flex flex-col gap-6 p-6">
      <h1 className="type-page-title">{t("examSettings.title")}</h1>
      <PasswordChangeForm />
    </div>
  );
}
