import { PageContainer } from "@/components/shared/PageContainer";

/** Placeholder page displayed for routes not yet implemented. */
export function PlaceholderPage() {
  // i18n-copy-allow: temporary — placeholder page awaiting implementation; remove with the page
  const message = "页面将在后续任务中实现。";
  return (
    <PageContainer role="admin-standard">
      <div className="type-secondary">{message}</div>
    </PageContainer>
  );
}
