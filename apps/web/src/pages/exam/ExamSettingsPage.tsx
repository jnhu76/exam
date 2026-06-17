import { PasswordChangeForm } from "@/components/settings/PasswordChangeForm";

/** Account settings page where the candidate can change their password. */
export function ExamSettingsPage() {
  return (
    <div className="mx-auto max-w-2xl flex flex-col gap-6 p-6">
      <h1 className="text-2xl font-semibold">账号设置</h1>
      <PasswordChangeForm />
    </div>
  );
}
