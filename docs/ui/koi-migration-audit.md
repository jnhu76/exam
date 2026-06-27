# Koi-UI Migration Audit

- Scanned: 503 files
- Total issues: 51

## Legacy Components (should use AdminShell/AdminStatusTag): 32 issues

- `apps/web/src/components/shared/DataTableShell.tsx:8` — export function DataTableShell({
- `apps/web/src/components/shared/DataToolbar.tsx:8` — export function DataToolbar({
- `apps/web/src/components/shared/ListToolbar.tsx:4` — /** Props for the ListToolbar component. */
- `apps/web/src/components/shared/ListToolbar.tsx:5` — type ListToolbarProps = {
- `apps/web/src/components/shared/ListToolbar.tsx:18` — export function ListToolbar({
- `apps/web/src/components/shared/ListToolbar.tsx:25` — }: ListToolbarProps) {
- `apps/web/src/components/shared/PageHeader.tsx:8` — export function PageHeader({
- `apps/web/src/components/shared/consistency.test.tsx:6` — import { PageHeader } from "./PageHeader";
- `apps/web/src/components/shared/consistency.test.tsx:38` — describe("PageHeader", () => {
- `apps/web/src/components/shared/consistency.test.tsx:40` — const { container } = render(<PageHeader title="测试" />);
- `apps/web/src/components/shared/shared.test.tsx:9` — import { DataTableShell } from "./DataTableShell";
- `apps/web/src/components/shared/shared.test.tsx:10` — import { DataToolbar } from "./DataToolbar";
- `apps/web/src/components/shared/shared.test.tsx:16` — import { ListToolbar } from "./ListToolbar";
- `apps/web/src/components/shared/shared.test.tsx:18` — import { PageHeader } from "./PageHeader";
- `apps/web/src/components/shared/shared.test.tsx:25` — describe("PageHeader", () => {
- `apps/web/src/components/shared/shared.test.tsx:27` — render(<PageHeader title="考试管理" />);
- `apps/web/src/components/shared/shared.test.tsx:35` — <PageHeader
- `apps/web/src/components/shared/shared.test.tsx:44` — render(<PageHeader title="成绩查询" />);
- `apps/web/src/components/shared/shared.test.tsx:49` — render(<PageHeader title="考试详情" status={<span>已发布</span>} />);
- `apps/web/src/components/shared/shared.test.tsx:244` — describe("ListToolbar", () => {
- ... and 12 more

## Badge variant= (should use AdminStatusTag): 12 issues

- `apps/web/src/components/exam/ExamTopbar.tsx:41` — <Badge variant="outline" className="gap-1.5">
- `apps/web/src/components/exam/QuestionHeader.tsx:32` — <Badge variant="secondary">{typeLabel}</Badge>
- `apps/web/src/components/exam/QuestionHeader.tsx:33` — <Badge variant="outline">{score} 分</Badge>
- `apps/web/src/pages/admin/AttemptDetailPage.tsx:676` — <Badge variant="outline">
- `apps/web/src/pages/admin/ExamCreatePage.tsx:266` — <Badge variant="outline">
- `apps/web/src/pages/admin/ExamCreatePage.tsx:333` — <Badge variant="outline">
- `apps/web/src/pages/admin/ExamEditPage.tsx:305` — <Badge variant="outline">
- `apps/web/src/pages/admin/ExamEditPage.tsx:368` — <Badge variant="outline">
- `apps/web/src/pages/admin/ExamMonitoringPage.tsx:396` — <Badge variant="secondary" className={`shrink-0 ${color}`}>
- `apps/web/src/pages/admin/QuestionImportPage.tsx:277` — <Badge variant="outline">
- `apps/web/src/pages/admin/UsersPage.tsx:206` — <Badge variant="outline">
- `apps/web/src/pages/exam/ExamListPage.tsx:94` — <Badge variant="default" data-testid="exam-best-score">

## space-x/y (should use gap-): 7 issues

- `apps/web/src/components/exam/ExamConfigForm.tsx:422` — <div className="space-y-2">
- `apps/web/src/components/ui/avatar.tsx:76` — "group/avatar-group flex -space-x-2 *:data-[slot=avatar]:ring-2 *:data-[slot=avatar]:ring-background",
- `apps/web/src/components/ui/calendar.tsx:46` — month_grid: "w-full border-collapse space-y-1",
- `apps/web/src/pages/admin/GradingDetailPage.tsx:184` — <div className="space-y-4">
- `apps/web/src/pages/admin/GradingDetailPage.tsx:185` — <div className="space-y-2">
- `apps/web/src/pages/admin/GradingDetailPage.tsx:194` — <div className="space-y-2">
- `apps/web/src/pages/admin/GradingDetailPage.tsx:216` — <div className="space-y-2">

## w-N h-N same value (should use size-N): 0 issues ✅

## Hardcoded colors (should use tokens): 0 issues ✅

## Koi-UI references (informational): 0 issues ✅
