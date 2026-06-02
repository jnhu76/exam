import { PasswordChangeForm } from "@/components/settings/PasswordChangeForm";

export function ExamSettingsPage() {
  return (
    <div className="mx-auto max-w-2xl space-y-6 p-6">
      <h1 className="text-2xl font-semibold">账号设置</h1>
      <PasswordChangeForm />
    </div>
  );
}
