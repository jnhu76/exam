import { useTranslation } from "react-i18next";
import { PasswordChangeForm } from "@/components/settings/PasswordChangeForm";
import { FormSection } from "@/components/shared/FormSection";
import { PageContainer } from "@/components/shared/PageContainer";

/** Account settings page where the candidate can change their password. */
export function ExamSettingsPage() {
  const { t } = useTranslation();
  return (
    <PageContainer role="candidate" className="flex flex-col gap-6">
      <h1 className="type-page-title">{t("examSettings.title")}</h1>
      <FormSection title={t("passwordChange.title")}>
        <PasswordChangeForm />
      </FormSection>
    </PageContainer>
  );
}
