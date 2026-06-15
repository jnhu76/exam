# Accessibility Rules

> 本文档定义项目的可访问性规则。所有 UI 实施必须遵守。

---

## 1. 基本原则

### 1.1 WCAG 2.1 AA 合规

项目目标是达到 WCAG 2.1 AA 级别合规。

### 1.2 核心规则

- 颜色不能是唯一状态信号
- 所有交互元素必须可键盘操作
- 所有表单必须有 label
- 所有图片必须有 alt 文本
- 所有对话框必须有 title / description

---

## 2. 按钮规则

### 2.1 Icon-only Button

icon-only button **必须有 accessible label**。

```tsx
// 正确
<Button aria-label="折叠侧栏">
  <ChevronLeft />
</Button>

// 错误
<Button>
  <ChevronLeft />
</Button>
```

### 2.2 按钮文本

- 按钮必须有明确的文本或 aria-label
- 图标按钮必须有 aria-label
- 按钮文本必须简洁明了

### 2.3 按钮状态

- disabled 按钮必须设置 `disabled` 属性
- loading 按钮必须显示 loading 状态
- 按钮必须有 focus 状态

---

## 3. 对话框规则

### 3.1 对话框标题

dialog **必须有 title / description**。

```tsx
// 正确
<Dialog>
  <DialogContent>
    <DialogHeader>
      <DialogTitle>确认交卷</DialogTitle>
      <DialogDescription>交卷后无法修改答案</DialogDescription>
    </DialogHeader>
  </DialogContent>
</Dialog>

// 错误
<Dialog>
  <DialogContent>
    <p>确认交卷？</p>
  </DialogContent>
</Dialog>
```

### 3.2 对话框关闭

- 对话框必须有关闭按钮
- 对话框必须支持 ESC 键关闭
- 对话框必须支持点击外部关闭

### 3.3 对话框焦点

- 对话框打开时焦点必须移到对话框内
- 对话框关闭时焦点必须回到触发元素
- 对话框内必须支持 Tab 键导航

---

## 4. 表单规则

### 4.1 表单 Label

form label **必须关联 input**。

```tsx
// 正确
<Label htmlFor="name">名称</Label>
<Input id="name" />

// 正确
<Label>名称</Label>
<Input />

// 错误
<span>名称</span>
<Input />
```

### 4.2 表单验证

- 错误信息必须可见
- 错误信息必须关联到对应的 input
- 错误信息必须有适当的 aria 属性

```tsx
// 正确
<div>
  <Label htmlFor="name">名称</Label>
  <Input id="name" aria-invalid={!!error} />
  {error && <p className="text-sm text-destructive">{error}</p>}
</div>
```

### 4.3 表单提交

- 提交按钮必须有 loading 状态
- 提交按钮在 loading 时必须 disabled
- 提交按钮必须有明确的文本

---

## 5. 颜色规则

### 5.1 颜色不能是唯一状态信号

```tsx
// 错误：只用颜色表示状态
<div className="bg-green-500">成功</div>
<div className="bg-red-500">失败</div>

// 正确：颜色 + 图标 + 文本
<StatusBadge status="graded" />
// StatusBadge 包含颜色 + 图标 + 文本
```

### 5.2 对比度

- 文本和背景的对比度必须达到 4.5:1
- 大文本和背景的对比度必须达到 3:1
- 使用项目定义的 semantic tokens，不要使用原始颜色

---

## 6. Focus 规则

### 6.1 Focus 状态

focus state **不能被移除**。

```tsx
// 错误
<button className="focus:outline-none">

// 正确
<button className="focus-visible:ring-3 focus-visible:ring-ring">
```

### 6.2 Focus 可见性

- 所有交互元素必须有可见的 focus 状态
- focus 状态必须有适当的 ring 或 border
- focus 状态必须有足够的对比度

### 6.3 Focus 顺序

- Tab 键顺序必须符合逻辑顺序
- 焦点不能被困在某个元素中
- 焦点必须可以移到所有交互元素

---

## 7. 键盘规则

### 7.1 Sidebar Collapse Button

sidebar collapse button **必须可键盘操作**。

```tsx
// 正确
<Button
  type="button"
  variant="ghost"
  size="icon"
  aria-label="折叠侧栏"
  onClick={onCollapse}
>
  <ChevronLeft />
</Button>

// 错误
<div onClick={onCollapse}>
  <ChevronLeft />
</div>
```

### 7.2 导航链接

- 导航链接必须支持 Tab 键
- 导航链接必须支持 Enter 键激活
- 导航链接必须有 focus 状态

### 7.3 表单元素

- 表单元素必须支持 Tab 键
- 表单元素必须支持 Enter 键提交
- 表单元素必须支持方向键选择

---

## 8. 图片规则

### 8.1 图片 Alt 文本

所有图片必须有 alt 文本。

```tsx
// 正确
<img src="logo.png" alt="平台 Logo" />

// 装饰性图片
<img src="decoration.png" alt="" aria-hidden="true" />
```

### 8.2 图标

- 图标必须有 aria-hidden="true"
- 图标按钮必须有 aria-label
- 图标不能是唯一的信息载体

```tsx
// 正确
<Button aria-label="删除">
  <Trash className="size-4" aria-hidden="true" />
</Button>

// 错误
<Button>
  <Trash className="size-4" />
</Button>
```

---

## 9. 表格规则

### 9.1 表格标题

- 表格必须有 `<caption>` 或 `aria-label`
- 表格列标题必须使用 `<th>`
- 表格行标题必须使用 `<th scope="row">`

### 9.2 表格排序

- 可排序列必须有排序状态提示
- 可排序列必须支持键盘操作
- 排序状态必须有 aria-label

### 9.3 表格分页

- 分页控件必须有 aria-label
- 当前页码必须有 aria-current="page"
- 分页控件必须支持键盘操作

---

## 10. 颜色语义

### 10.1 颜色含义

| 颜色 | 含义 | 用途 |
|------|------|------|
| primary | 主要操作 | 按钮、链接 |
| destructive | 危险操作 | 删除、作废 |
| success | 成功状态 | 已完成、已出分 |
| warning | 警告状态 | 断线、保存中 |
| muted | 次要信息 | 辅助文本、禁用状态 |

### 10.2 颜色使用

- 颜色必须和语义一致
- 颜色不能和语义冲突
- 颜色不能是唯一的信息载体
