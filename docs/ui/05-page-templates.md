# Page Templates

> 本文档定义项目的页面模板规则。所有 UI 实施必须遵守。

---

## 1. List Page（列表页）

### 1.1 结构

```
List Page
├── PageHeader (标题 + 操作按钮)
├── Toolbar / Filters (筛选工具栏)
├── DataTableShell (数据表格)
├── EmptyState (空状态)
├── ErrorState (错误状态)
└── LoadingState (加载状态)
```

### 1.2 组件职责

| 组件 | 职责 | 文件位置 |
|------|------|----------|
| PageHeader | 页面标题 + 操作按钮 | `components/shared/PageHeader.tsx` |
| Toolbar | 筛选工具栏 | 待实现 |
| DataTableShell | 数据表格壳 | 待实现 |
| EmptyState | 空状态 | `components/shared/EmptyState.tsx` |
| ErrorState | 错误状态 | `components/shared/ErrorState.tsx` |
| LoadingState | 加载状态 | `components/shared/LoadingState.tsx` |

### 1.3 实现规则

```tsx
function ListPage() {
  const { data, isLoading, error } = useData();

  if (isLoading) return <LoadingState />;
  if (error) return <ErrorState error={error} />;
  if (data.length === 0) return <EmptyState />;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="列表" actions={<Button>新建</Button>} />
      <Toolbar />
      <DataTableShell data={data} />
    </div>
  );
}
```

### 1.4 示例页面

- `admin/ExamPage.tsx` — 考试列表
- `admin/QuestionPage.tsx` — 题目列表
- `admin/UsersPage.tsx` — 用户列表
- `admin/CandidatesPage.tsx` — 考生列表
- `exam/ExamListPage.tsx` — 考试列表

---

## 2. Detail Page（详情页）

### 2.1 结构

```
Detail Page
├── PageHeader (标题 + 状态 + 操作按钮)
├── Main Content Area (主内容区)
│   ├── Stats Section (统计信息)
│   ├── Config Section (配置信息)
│   └── Tabs Section (标签页)
│       ├── Tab 1 (内容 1)
│       ├── Tab 2 (内容 2)
│       └── Tab 3 (内容 3)
└── Optional Right Panel (可选右侧面板)
    ├── Status Panel (状态面板)
    ├── Risk Panel (风险面板)
    └── Timeline Panel (时间线面板)
```

### 2.2 组件职责

| 组件 | 职责 | 文件位置 |
|------|------|----------|
| PageHeader | 页面标题 + 状态 + 操作按钮 | `components/shared/PageHeader.tsx` |
| StatsSection | 统计信息 | 待实现 |
| ConfigSection | 配置信息 | 待实现 |
| TabsSection | 标签页 | 使用 shadcn/ui tabs |
| StatusPanel | 状态面板 | 待实现 |
| RiskPanel | 风险面板 | 待实现 |
| TimelinePanel | 时间线面板 | 待实现 |

### 2.3 实现规则

```tsx
function DetailPage() {
  const { data, isLoading, error } = useData();

  if (isLoading) return <LoadingState />;
  if (error) return <ErrorState error={error} />;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={data.title}
        description={data.description}
        actions={<Button>编辑</Button>}
      />

      <div className="flex gap-6">
        <div className="flex-1">
          <StatsSection data={data} />
          <ConfigSection data={data} />
          <TabsSection>
            <TabsList>
              <TabsTrigger value="tab1">标签 1</TabsTrigger>
              <TabsTrigger value="tab2">标签 2</TabsTrigger>
            </TabsList>
            <TabsContent value="tab1">
              {/* 内容 1 */}
            </TabsContent>
            <TabsContent value="tab2">
              {/* 内容 2 */}
            </TabsContent>
          </TabsSection>
        </div>

        <div className="w-80">
          <StatusPanel status={data.status} />
          <TimelinePanel timeline={data.timeline} />
        </div>
      </div>
    </div>
  );
}
```

### 2.4 示例页面

- `admin/ExamDetailPage.tsx` — 考试详情
- `admin/AttemptDetailPage.tsx` — 答题详情

---

## 3. Form Page（表单页）

### 3.1 结构

```
Form Page
├── PageHeader (标题 + 操作按钮)
├── Form Section: Basic Information (基本信息)
│   ├── Field 1
│   ├── Field 2
│   └── Field 3
├── Form Section: Rules / Policy (规则/策略)
│   ├── Field 4
│   ├── Field 5
│   └── Field 6
├── Form Section: Visibility / Access (可见性/访问)
│   ├── Field 7
│   ├── Field 8
│   └── Field 9
└── Form Section: Actions (操作)
    ├── Button: Cancel
    └── Button: Submit
```

### 3.2 组件职责

| 组件 | 职责 | 文件位置 |
|------|------|----------|
| PageHeader | 页面标题 + 操作按钮 | `components/shared/PageHeader.tsx` |
| FormSection | 表单区块 | 待实现 |
| FieldGroup | 字段组 | `components/shared/FieldGroup.tsx` |
| FieldError | 字段错误 | `components/shared/FieldError.tsx` |

### 3.3 实现规则

```tsx
function FormPage() {
  const form = useForm();

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="新建" actions={<Button>取消</Button>} />

      <Form onSubmit={form.handleSubmit}>
        <FormSection title="基本信息">
          <FieldGroup>
            <Label>名称</Label>
            <Input {...form.register("name")} />
            <FieldError error={form.errors.name} />
          </FieldGroup>
        </FormSection>

        <FormSection title="规则/策略">
          <FieldGroup>
            <Label>策略</Label>
            <Select {...form.register("policy")}>
              {/* options */}
            </Select>
          </FieldGroup>
        </FormSection>

        <FormSection title="操作">
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline">取消</Button>
            <Button type="submit">提交</Button>
          </div>
        </FormSection>
      </Form>
    </div>
  );
}
```

### 3.4 示例页面

- `admin/ExamCreatePage.tsx` — 新建考试
- `admin/QuestionEditPage.tsx` — 编辑题目
- `admin/SettingsPage.tsx` — 平台设置

---

## 4. Exam Runtime Page（考试答题页）

### 4.1 结构

```
Exam Runtime Page
├── ExamShell
│   ├── ExamTopbar
│   │   ├── BrandMark (logo)
│   │   ├── Navigation (导航链接)
│   │   └── UserSection (用户信息 + 退出)
│   └── ExamContent
│       ├── Timer / Time State (倒计时)
│       ├── Save Status (保存状态)
│       ├── Question Navigator (题目导航)
│       ├── Question Content (题目内容)
│       ├── Answer Area (答题区)
│       └── Bottom Action Bar (底部操作栏)
└── Submit Confirmation Dialog (提交确认对话框)
```

### 4.2 组件职责

| 组件 | 职责 | 文件位置 |
|------|------|----------|
| ExamLayout | Shell 容器 | `components/layout/ExamLayout.tsx` |
| ExamTopbar | 顶部栏 | 待实现 |
| ExamTimer | 倒计时 | 待实现 |
| SaveIndicator | 保存状态 | 待实现 |
| QuestionNav | 题目导航 | 待实现 |
| QuestionContent | 题目内容 | 待实现 |
| AnswerArea | 答题区 | 待实现 |
| ActionBar | 底部操作栏 | 待实现 |

### 4.3 实现规则

```tsx
function TakeExamPage() {
  const { attempt, isLoading, error } = useAttempt();
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved" | "failed">("idle");

  if (isLoading) return <LoadingState />;
  if (error) return <ErrorState error={error} />;

  return (
    <div className="flex flex-col min-h-screen">
      {/* 顶部栏：倒计时 + 保存状态 */}
      <header className="flex items-center justify-between border-b bg-card px-6 py-3">
        <ExamTimer deadlineAt={attempt.deadlineAt} />
        <SaveIndicator status={saveStatus} />
      </header>

      {/* 主内容区：题目导航 + 答题区 */}
      <div className="flex flex-1">
        {/* 题目导航 */}
        <aside className="w-64 border-r bg-card p-4">
          <QuestionNav
            questions={attempt.questionSnapshot}
            currentIndex={currentIndex}
            onSelect={setCurrentIndex}
          />
        </aside>

        {/* 答题区 */}
        <main className="flex-1 p-6">
          <QuestionContent question={currentQuestion} />
          <AnswerArea
            question={currentQuestion}
            answer={currentAnswer}
            onChange={handleAnswerChange}
          />
        </main>
      </div>

      {/* 底部操作栏 */}
      <footer className="flex items-center justify-between border-t bg-card px-6 py-3">
        <Button variant="outline" onClick={handlePrevious}>上一题</Button>
        <Button variant="outline" onClick={handleNext}>下一题</Button>
        <Button onClick={handleSubmit}>交卷</Button>
      </footer>

      {/* 提交确认对话框 */}
      <SubmitConfirmationDialog
        open={showSubmitDialog}
        onConfirm={handleConfirmSubmit}
        onCancel={() => setShowSubmitDialog(false)}
      />
    </div>
  );
}
```

### 4.4 核心规则

- **client timer is cosmetic only**：客户端倒计时只是展示，服务端时间才是权威
- **server time remains authority**：交卷是否超时以服务端为准
- **Answer Save Protocol**：答案必须保存到服务器
- **Recovery / disrupted state**：断线后恢复答案和剩余时间

### 4.5 示例页面

- `exam/TakeExamPage.tsx` — 答题
- `exam/StartExamPage.tsx` — 开始考试
- `exam/ResultPage.tsx` — 结果

---

## 5. 状态页模板

### 5.1 Loading State

```tsx
function LoadingState() {
  return (
    <div className="flex flex-col gap-6 p-6">
      <Skeleton className="h-8 w-32" />
      <Skeleton className="h-32 w-full rounded-lg" />
      <Skeleton className="h-32 w-full rounded-lg" />
    </div>
  );
}
```

### 5.2 Error State

```tsx
function ErrorState({ error }: { error: Error }) {
  return (
    <div className="flex flex-col items-center justify-center gap-4 p-6">
      <AlertTriangle className="size-12 text-destructive" />
      <h2 className="text-lg font-semibold">出错了</h2>
      <p className="text-sm text-muted-foreground">{error.message}</p>
      <Button onClick={() => window.location.reload()}>重试</Button>
    </div>
  );
}
```

### 5.3 Empty State

```tsx
function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center gap-4 p-6">
      <Inbox className="size-12 text-muted-foreground" />
      <h2 className="text-lg font-semibold">暂无数据</h2>
      <p className="text-sm text-muted-foreground">没有找到任何记录</p>
      <Button>新建</Button>
    </div>
  );
}
```
