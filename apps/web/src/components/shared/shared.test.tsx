import { act, fireEvent, render, screen } from "@testing-library/react";
import { Eye } from "lucide-react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ConfirmDialog } from "./ConfirmDialog";
import { DesktopDataTable } from "./DesktopDataTable";
import type { DataViewColumnDef } from "./DesktopDataTable";
import { MobileRecordList } from "./MobileRecordList";
import { DataTablePagination } from "./DataTablePagination";
import { DataTableShell } from "./DataTableShell";
import { DataToolbar } from "./DataToolbar";
import { EmptyState } from "./EmptyState";
import { ErrorState } from "./ErrorState";
import { FormSection } from "./FormSection";
import { FieldRow } from "./FieldGroup";
import { FieldStack, FormStack } from "./FormStack";
import { LoadingState } from "./LoadingState";
import { PageHeader } from "./PageHeader";
import { PageSection } from "./PageSection";
import { RowActions } from "./RowActions";
import { SaveIndicator } from "@/components/exam/SaveIndicator";
import { SearchInput } from "./SearchInput";
import { StatsCard } from "./StatsCard";
import { TagBadge } from "./TagBadge";

describe("PageHeader", () => {
  it("renders title", () => {
    render(<PageHeader title="考试管理" />);
    expect(
      screen.getByRole("heading", { name: "考试管理" }),
    ).toBeInTheDocument();
  });

  it("renders action slot when provided", () => {
    render(
      <PageHeader
        title="题目管理"
        actions={<button type="button">新建</button>}
      />,
    );
    expect(screen.getByRole("button", { name: "新建" })).toBeInTheDocument();
  });

  it("renders without actions slot", () => {
    render(<PageHeader title="成绩查询" />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("renders status slot when provided", () => {
    render(<PageHeader title="考试详情" status={<span>已发布</span>} />);
    expect(screen.getByText("已发布")).toBeInTheDocument();
  });

  it("uses the semantic page-title recipe", () => {
    const { container } = render(<PageHeader title="测试" />);
    const h1 = container.querySelector("h1");
    expect(h1).toHaveClass("type-page-title");
    expect(h1).not.toHaveClass("font-bold", "font-semibold");
  });

  it("renders the description through the page-description recipe", () => {
    const { container } = render(
      <PageHeader title="测试" description="说明文字" />,
    );
    expect(container.querySelector("p")).toHaveClass("type-page-description");
  });
});

describe("EmptyState", () => {
  it("renders icon, title, and description", () => {
    render(
      <EmptyState
        icon={<span data-testid="icon">📚</span>}
        title="暂无数据"
        description="还没有创建任何内容"
      />,
    );
    expect(screen.getByTestId("icon")).toBeInTheDocument();
    expect(screen.getByText("暂无数据")).toBeInTheDocument();
    expect(screen.getByText("还没有创建任何内容")).toBeInTheDocument();
  });

  it("renders optional action button", () => {
    render(
      <EmptyState
        icon={<span>📚</span>}
        title="空列表"
        description="请添加项目"
        action={<button type="button">添加</button>}
      />,
    );
    expect(screen.getByRole("button", { name: "添加" })).toBeInTheDocument();
  });

  it("renders without action button", () => {
    render(
      <EmptyState icon={<span>📚</span>} title="空" description="无内容" />,
    );
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("renders with default icon", () => {
    const { container } = render(
      <EmptyState title="暂无数据" description="没有可显示的内容" />,
    );
    expect(screen.getByText("暂无数据")).toBeInTheDocument();
    expect(container.querySelector("svg")).toBeInTheDocument();
  });

  it("hides the icon wrapper from assistive technology", () => {
    render(
      <EmptyState
        icon={<span data-testid="icon">📚</span>}
        title="空"
        description="无数据"
      />,
    );
    expect(screen.getByTestId("icon").parentElement).toHaveAttribute(
      "aria-hidden",
      "true",
    );
  });
});

describe("ConfirmDialog", () => {
  it("renders trigger button", () => {
    render(
      <ConfirmDialog
        trigger={<button type="button">删除</button>}
        title="确认删除"
        description="此操作不可撤销"
        onConfirm={() => {}}
      />,
    );
    expect(screen.getByRole("button", { name: "删除" })).toBeInTheDocument();
  });

  it("opens dialog and shows title and description on trigger click", async () => {
    render(
      <ConfirmDialog
        trigger={<button type="button">删除</button>}
        title="确认删除"
        description="此操作不可撤销"
        onConfirm={() => {}}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: "删除" }));

    expect(screen.getByText("确认删除")).toBeInTheDocument();
    expect(screen.getByText("此操作不可撤销")).toBeInTheDocument();
  });

  it("shows default confirm and cancel labels", async () => {
    render(
      <ConfirmDialog
        trigger={<button type="button">操作</button>}
        title="提示"
        description="确定要继续吗"
        onConfirm={() => {}}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: "操作" }));

    expect(screen.getByRole("button", { name: "确认" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "取消" })).toBeInTheDocument();
  });

  it("shows custom confirm and cancel labels", async () => {
    render(
      <ConfirmDialog
        trigger={<button type="button">操作</button>}
        title="提示"
        description="确定"
        confirmLabel="是"
        cancelLabel="否"
        onConfirm={() => {}}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: "操作" }));

    expect(screen.getByRole("button", { name: "是" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "否" })).toBeInTheDocument();
  });

  it("calls onConfirm when confirm button is clicked", async () => {
    const onConfirm = vi.fn();
    render(
      <ConfirmDialog
        trigger={<button type="button">删除</button>}
        title="确认"
        description="确定吗"
        onConfirm={onConfirm}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: "删除" }));
    await userEvent.click(screen.getByRole("button", { name: "确认" }));

    expect(onConfirm).toHaveBeenCalledOnce();
  });

  it("calls onCancel when cancel button is clicked", async () => {
    const onCancel = vi.fn();
    render(
      <ConfirmDialog
        trigger={<button type="button">操作</button>}
        title="提示"
        description="确定吗"
        onConfirm={() => {}}
        onCancel={onCancel}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: "操作" }));
    await userEvent.click(screen.getByRole("button", { name: "取消" }));

    expect(onCancel).toHaveBeenCalledOnce();
  });
});

describe("SearchInput", () => {
  it("calls onChange when typing", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();

    render(<SearchInput value="" onChange={onChange} placeholder="搜索用户" />);

    await user.type(screen.getByRole("searchbox"), "admin");

    expect(onChange).toHaveBeenCalled();
  });

  it("renders icon-only clear button with aria-label and calls onClear", async () => {
    const user = userEvent.setup();
    const onClear = vi.fn();

    render(<SearchInput value="admin" onChange={() => {}} onClear={onClear} />);

    const clearButton = screen.getByRole("button", { name: "清除搜索" });
    expect(clearButton).toBeInTheDocument();

    await user.click(clearButton);
    expect(onClear).toHaveBeenCalledOnce();
  });

  it("does not render clear button when empty", () => {
    render(<SearchInput value="" onChange={() => {}} />);
    expect(
      screen.queryByRole("button", { name: "清除搜索" }),
    ).not.toBeInTheDocument();
  });

  it("treats nullish values as an empty controlled input", () => {
    render(<SearchInput value={null} onChange={() => {}} />);

    expect(screen.getByRole("searchbox")).toHaveValue("");
    expect(
      screen.queryByRole("button", { name: "清除搜索" }),
    ).not.toBeInTheDocument();
  });
});

describe("TagBadge", () => {
  it("owns secondary tag semantics and compact geometry", () => {
    render(<TagBadge>safety</TagBadge>);

    expect(screen.getByText("safety")).toHaveAttribute(
      "data-tag-tone",
      "neutral",
    );
    expect(screen.getByText("safety")).toHaveAttribute(
      "data-tag-geometry",
      "compact",
    );
    // Weight is owned by the [data-slot=tag-badge] recipe (400), not by a
    // component utility (issue 577 m2 single-owner model).
    expect(screen.getByText("safety")).toHaveAttribute(
      "data-tag-variant",
      "default",
    );
    expect(screen.getByText("safety")).not.toHaveClass("font-normal");
  });
});

describe("RowActions", () => {
  it("renders typed declarations as the shared group surface", () => {
    render(
      <RowActions
        row={{ id: "1" }}
        actions={[
          {
            id: "view",
            label: "查看",
            icon: Eye,
            onSelect: () => {},
          },
        ]}
      />,
    );

    expect(screen.getByRole("group", { name: "行操作" })).toHaveAttribute(
      "data-slot",
      "row-actions",
    );
    expect(screen.getByRole("group", { name: "行操作" })).toHaveAttribute(
      "data-action-target",
      "responsive",
    );
    expect(screen.getByRole("group", { name: "行操作" })).toHaveClass("gap-1");
    expect(screen.getByRole("button", { name: "查看" })).toBeInTheDocument();
  });
});

describe("DataTablePagination", () => {
  it("renders totals and calls onPageChange", async () => {
    const user = userEvent.setup();
    const onPageChange = vi.fn();

    render(
      <DataTablePagination
        page={1}
        pageSize={10}
        total={25}
        onPageChange={onPageChange}
      />,
    );

    expect(screen.getByText("共 25 条，显示 1-10 条")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /下一页/ }));
    expect(onPageChange).toHaveBeenCalledWith(2);
  });

  it("marks current page with aria-current", () => {
    render(
      <DataTablePagination
        page={2}
        pageSize={10}
        total={25}
        onPageChange={() => {}}
      />,
    );

    expect(screen.getByRole("link", { name: "第 2 页" })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  it("normalizes non-positive page sizes", () => {
    render(
      <DataTablePagination
        page={1}
        pageSize={0}
        total={3}
        onPageChange={() => {}}
      />,
    );

    expect(screen.getByText("共 3 条，显示 1-1 条")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "第 1 页" })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });
});

describe("FormStack", () => {
  it("renders form and field stack content", () => {
    render(
      <FormStack>
        <FieldStack>
          <label htmlFor="name">名称</label>
          <input id="name" />
        </FieldStack>
      </FormStack>,
    );

    expect(screen.getByLabelText("名称")).toBeInTheDocument();
  });
});

describe("StatsCard", () => {
  it("renders label and value", () => {
    render(<StatsCard label="总考试数" value={42} />);
    expect(screen.getByText("总考试数")).toBeInTheDocument();
    expect(screen.getByText("42")).toBeInTheDocument();
  });

  it("renders string value", () => {
    render(<StatsCard label="通过率" value="85%" />);
    expect(screen.getByText("85%")).toBeInTheDocument();
  });

  it("renders trend indicator when provided", () => {
    render(<StatsCard label="参加人数" value={100} trend="+12 本月" />);
    expect(screen.getByText("+12 本月")).toBeInTheDocument();
  });

  it("renders without trend when not provided", () => {
    render(<StatsCard label="分数" value={90} />);
    expect(screen.queryByText(/\+/)).not.toBeInTheDocument();
  });

  it("owns the metric hierarchy and icon anchor", () => {
    render(
      <StatsCard
        label="考试总数"
        value={12}
        icon={<span aria-hidden="true">图</span>}
      />,
    );

    expect(screen.getByText("12")).toHaveClass("type-metric");
    expect(screen.getByText("图").parentElement).toHaveAttribute(
      "data-slot",
      "stats-card-icon",
    );
    expect(
      screen.getByText("12").closest('[data-slot="stats-card"]'),
    ).toHaveAttribute("data-depth", "flat");
    expect(
      screen.getByText("12").closest('[data-slot="stats-card"]'),
    ).toHaveClass("surface-content");
    expect(screen.getByText("图").parentElement).toHaveAttribute(
      "data-anchor-tone",
      "primary-soft",
    );
    expect(
      screen.getByText("12").closest('[data-slot="stats-card-content"]'),
    ).toHaveAttribute("data-slot", "stats-card-content");
  });
});

describe("SaveIndicator", () => {
  it("renders saving state", () => {
    render(<SaveIndicator status="saving" />);
    expect(screen.getByText("保存中...")).toBeInTheDocument();
  });

  it("renders saved state", () => {
    render(<SaveIndicator status="saved" />);
    expect(screen.getByText("已保存")).toBeInTheDocument();
  });

  it("renders error state", () => {
    render(<SaveIndicator status="error" />);
    expect(screen.getByText("保存失败")).toBeInTheDocument();
  });
});

describe("ErrorState", () => {
  it("renders error message", () => {
    render(<ErrorState message="加载失败" />);
    expect(screen.getByText("加载失败")).toBeInTheDocument();
  });

  it("renders retry button when onRetry is provided", () => {
    render(<ErrorState message="加载失败" onRetry={() => {}} />);
    expect(screen.getByRole("button", { name: "重试" })).toBeInTheDocument();
  });

  it("renders without retry button when onRetry is not provided", () => {
    render(<ErrorState message="出错了" />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("calls onRetry when retry button is clicked", async () => {
    const onRetry = vi.fn();
    render(<ErrorState message="加载失败" onRetry={onRetry} />);
    await userEvent.click(screen.getByRole("button", { name: "重试" }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it("has role alert for accessibility", () => {
    render(<ErrorState message="加载失败" />);
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });
});

describe("LoadingState", () => {
  it("renders loading indicator", () => {
    render(<LoadingState />);
    expect(screen.getByRole("status")).toBeInTheDocument();
  });

  it("renders with custom label", () => {
    render(<LoadingState label="加载题目中" />);
    expect(screen.getByText("加载题目中")).toBeInTheDocument();
  });

  it("renders default loading text when no label", () => {
    render(<LoadingState />);
    expect(screen.getByText("加载中...")).toBeInTheDocument();
  });

  it("sets aria-busy on container", () => {
    render(<LoadingState />);
    expect(screen.getByRole("status")).toHaveAttribute("aria-busy", "true");
  });
});

describe("PageSection", () => {
  it("renders title, description, content, and actions", () => {
    render(
      <PageSection
        title="基础信息"
        description="用于展示页面区块"
        actions={<button type="button">编辑</button>}
      >
        <p>区块内容</p>
      </PageSection>,
    );

    expect(
      screen.getByRole("heading", { name: "基础信息" }),
    ).toBeInTheDocument();
    expect(screen.getByText("用于展示页面区块")).toBeInTheDocument();
    expect(screen.getByText("区块内容")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "编辑" })).toBeInTheDocument();
  });

  it("renders footer slot when provided", () => {
    render(
      <PageSection title="操作记录" footer={<p>共 2 条</p>}>
        <p>记录列表</p>
      </PageSection>,
    );

    expect(screen.getByText("共 2 条")).toBeInTheDocument();
  });
});

describe("FormSection", () => {
  it("renders form section with description and fields", () => {
    render(
      <FormSection title="规则设置" description="配置提交规则">
        <label htmlFor="passing-score">通过分数</label>
        <input id="passing-score" />
      </FormSection>,
    );

    expect(
      screen.getByRole("heading", { name: "规则设置" }),
    ).toBeInTheDocument();
    expect(screen.getByText("配置提交规则")).toBeInTheDocument();
    expect(screen.getByLabelText("通过分数")).toBeInTheDocument();
  });

  it("renders action slot", () => {
    render(
      <FormSection
        title="可见范围"
        actions={<button type="button">重置</button>}
      >
        <p>字段</p>
      </FormSection>,
    );

    expect(screen.getByRole("button", { name: "重置" })).toBeInTheDocument();
  });
});

describe("FieldRow", () => {
  it("owns the two-field responsive grid (stack below sm, pair at sm+)", () => {
    render(
      <FieldRow>
        <p>甲</p>
        <p>乙</p>
      </FieldRow>,
    );
    const row = screen.getByText("甲").parentElement;
    expect(row).toHaveClass("flex", "flex-col", "gap-4");
    expect(row).toHaveClass("sm:grid", "sm:grid-cols-2");
  });
});

describe("DataToolbar", () => {
  it("renders toolbar content and actions", () => {
    render(
      <DataToolbar
        summary="共 3 条"
        actions={<button type="button">导入</button>}
      >
        <label htmlFor="keyword">关键词</label>
        <input id="keyword" />
      </DataToolbar>,
    );

    expect(
      screen.getByRole("toolbar", { name: "数据工具栏" }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("关键词")).toBeInTheDocument();
    expect(screen.getByText("共 3 条")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "导入" })).toBeInTheDocument();
    expect(screen.getByRole("toolbar")).toHaveAttribute(
      "data-toolbar-appearance",
      "quiet",
    );
    expect(screen.getByRole("toolbar")).not.toHaveClass("surface-content");
  });

  it("supports custom accessible label", () => {
    render(
      <DataToolbar aria-label="考试筛选">
        <button type="button">筛选</button>
      </DataToolbar>,
    );

    expect(
      screen.getByRole("toolbar", { name: "考试筛选" }),
    ).toBeInTheDocument();
  });

  it("renders the search slot as a governed region", () => {
    render(<DataToolbar search={<input aria-label="关键词" />} />);

    expect(screen.getByLabelText("关键词").parentElement).toHaveAttribute(
      "data-slot",
      "toolbar-search",
    );
  });
});

/**
 * The loading-footprint rule (#601 Phase F): the placeholder body is for a
 * load with nothing to show yet. A reload that already has rows — a page
 * change keeps the previous page's data until the next one arrives — must
 * keep rendering them: measured on /admin/questions, swapping them for the
 * single placeholder row collapsed the table for two frames, made the
 * document shorter than the viewport, and made the page's own scrollbar
 * disappear and reappear on every page change.
 */
interface FootprintRow {
  id: string;
  name: string;
  score: number;
}

const footprintColumns: DataViewColumnDef<FootprintRow>[] = [
  { id: "name", accessorKey: "name", meta: { role: "primary-text" } },
  { id: "score", accessorKey: "score", meta: { role: "score" } },
];

const footprintRows: FootprintRow[] = [
  { id: "1", name: "安全考试", score: 5 },
  { id: "2", name: "技能考试", score: 8 },
];

function renderFootprint(rows: FootprintRow[], loading: boolean) {
  return render(
    <DataTableShell>
      <DesktopDataTable
        columns={footprintColumns}
        data={rows}
        getRowId={(row) => row.id}
        loading={loading}
      />
    </DataTableShell>,
  );
}

describe("table loading footprint", () => {
  it("keeps the previous rows on screen while a reload is in flight", () => {
    renderFootprint(footprintRows, true);

    expect(screen.getByText("安全考试")).toBeInTheDocument();
    expect(screen.getByText("技能考试")).toBeInTheDocument();
    // The placeholder span row stays out of a body that has rows.
    expect(document.querySelector('[data-column-role="span"]')).toBeNull();
    expect(document.querySelector('[data-slot="table-body"]')).toHaveAttribute(
      "aria-busy",
      "true",
    );
  });

  it("renders the placeholder only for a load with nothing to show yet", () => {
    renderFootprint([], true);

    expect(document.querySelector('[data-column-role="span"]')).not.toBeNull();
    expect(screen.queryByText("安全考试")).not.toBeInTheDocument();
  });

  it("keeps the previous cards on screen in the mobile representation too", () => {
    render(
      <MobileRecordList
        columns={footprintColumns}
        rows={footprintRows}
        getRowId={(row) => row.id}
        loading
      />,
    );

    expect(screen.getByText("安全考试")).toBeInTheDocument();
    expect(
      document.querySelector('[data-slot="mobile-record-card"]'),
    ).not.toBeNull();
  });
});

describe("DataTableShell", () => {
  /**
   * Stubs the measurement facts of a scroll region. `offsetWidth`/the border
   * box mirror `clientWidth` (no classic scrollbar), so the observed content
   * box equals the region's layout width — the same relationship a browser
   * reports for a region that fits its content.
   */
  function setScrollMetrics(
    element: HTMLElement,
    metrics: {
      clientWidth: number;
      scrollWidth: number;
      scrollLeft: number;
      /** Fractional border-box width; defaults to clientWidth. */
      containerWidth?: number;
      /** Border-box width incl. a classic scrollbar; defaults to clientWidth. */
      offsetWidth?: number;
    },
  ) {
    Object.defineProperties(element, {
      getBoundingClientRect: {
        configurable: true,
        value: () => ({ width: metrics.containerWidth ?? metrics.clientWidth }),
      },
      offsetWidth: {
        configurable: true,
        get: () => metrics.offsetWidth ?? metrics.clientWidth,
      },
      clientWidth: { configurable: true, get: () => metrics.clientWidth },
      scrollWidth: { configurable: true, get: () => metrics.scrollWidth },
      scrollLeft: {
        configurable: true,
        get: () => metrics.scrollLeft,
        set: (value: number) => {
          metrics.scrollLeft = value;
        },
      },
    });
  }

  it("renders table content inside shell", () => {
    render(
      <DataTableShell title="考试列表" description="展示当前考试">
        <table>
          <tbody>
            <tr>
              <td>安全测评</td>
            </tr>
          </tbody>
        </table>
      </DataTableShell>,
    );

    expect(
      screen.getByRole("heading", { name: "考试列表" }),
    ).toBeInTheDocument();
    expect(screen.getByText("展示当前考试")).toBeInTheDocument();
    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(screen.getByText("安全测评")).toBeInTheDocument();
  });

  it("renders toolbar and footer slots", () => {
    render(
      <DataTableShell
        toolbar={<button type="button">刷新</button>}
        footer={<p>第 1 页</p>}
      >
        <table>
          <tbody>
            <tr>
              <td>结果</td>
            </tr>
          </tbody>
        </table>
      </DataTableShell>,
    );

    expect(screen.getByRole("button", { name: "刷新" })).toBeInTheDocument();
    expect(screen.getByText("第 1 页")).toBeInTheDocument();
  });

  it("keeps metadata in the title band instead of opening a controls band", () => {
    // #601 Phase F corrective: a lone count line is metadata, not a toolbar.
    // The pre-Phase-F shell rendered it right-aligned in the title band; a
    // controls band of its own would add a full-width empty row above the
    // table (regression caught on /admin/exams).
    render(
      <DataTableShell title="考试列表" meta={<span>共 20 场考试</span>}>
        <table aria-label="考试数据" />
      </DataTableShell>,
    );

    const shell = screen
      .getByRole("heading", { name: "考试列表" })
      .closest('[data-slot="admin-table-shell"]') as HTMLElement;
    const titleBand = shell.querySelector(
      '[data-slot="data-table-title-band"]',
    );
    const meta = shell.querySelector('[data-slot="data-table-title-meta"]');

    expect(meta).not.toBeNull();
    expect(meta?.textContent).toBe("共 20 场考试");
    expect(titleBand?.contains(meta)).toBe(true);
    expect(
      shell.querySelector('[data-slot="data-table-toolbar-band"]'),
    ).toBeNull();
  });

  it("owns a distinct header surface around the list title", () => {
    render(
      <DataTableShell title="考生列表">
        <table aria-label="考生数据" />
      </DataTableShell>,
    );

    const shell = screen
      .getByRole("heading", { name: "考生列表" })
      .closest('[data-slot="admin-table-shell"]');
    const header = screen.getByRole("heading", {
      name: "考生列表",
    }).parentElement?.parentElement;

    expect(shell).toHaveClass("surface-content", "overflow-hidden");
    expect(header).toHaveClass(
      "bg-surface",
      "border-b",
      "border-border-divider",
    );
  });

  it("owns local overflow and negotiates the archetype tier", () => {
    render(
      <DataTableShell archetype="log-diagnostic">
        <table aria-label="宽表格" />
      </DataTableShell>,
    );

    const scrollRegion = screen
      .getByRole("table", { name: "宽表格" })
      .closest('[data-slot="table-scroll-region"]');

    // jsdom has no layout: the hook's initial observation is unmeasured, so
    // the negotiation falls back to the archetype minTier (compact) — the
    // same deterministic initial state real browsers paint pre-measurement.
    // The region is the single carrier of the geometry vocabulary (#601
    // Phase F): archetype AND tier live there for both shell compositions.
    expect(scrollRegion).toHaveAttribute(
      "data-table-archetype",
      "log-diagnostic",
    );
    expect(scrollRegion).toHaveAttribute("data-table-tier", "compact");
    expect(scrollRegion).toHaveAttribute("data-overflow-owner", "local");
  });

  it("shows no affordance when content does not overflow", () => {
    render(
      <DataTableShell>
        <table aria-label="窄表格" />
      </DataTableShell>,
    );
    const region = screen
      .getByRole("table", { name: "窄表格" })
      .closest('[data-slot="table-scroll-region"]') as HTMLElement;
    setScrollMetrics(region, {
      clientWidth: 800,
      scrollWidth: 800,
      scrollLeft: 0,
    });
    act(() => window.dispatchEvent(new Event("resize")));

    expect(region).toHaveAttribute("data-overflowing", "false");
    expect(screen.queryByText(/滑动查看更多/)).not.toBeInTheDocument();
  });

  it("shows no affordance when a fractional content box rounds up to the content width", () => {
    // Measured regression on /admin/questions: the region's content box is
    // 1394.667px, so clientWidth and scrollWidth both round to 1395 while the
    // table fits exactly. The hint band must stay out of the DOM — deriving
    // overflow from `scrollWidth > contentWidth` reported overflow here and
    // rendered "向右滑动查看更多" over a table that fit.
    render(
      <DataTableShell>
        <table aria-label="刚好放下的表格" />
      </DataTableShell>,
    );
    const region = screen
      .getByRole("table", { name: "刚好放下的表格" })
      .closest('[data-slot="table-scroll-region"]') as HTMLElement;
    setScrollMetrics(region, {
      containerWidth: 1394.667,
      clientWidth: 1395,
      scrollWidth: 1395,
      scrollLeft: 0,
    });
    act(() => window.dispatchEvent(new Event("resize")));

    expect(region).toHaveAttribute("data-overflowing", "false");
    expect(
      document.querySelector('[data-slot="table-scroll-hint"]'),
    ).not.toBeInTheDocument();
    expect(
      document.querySelector('[data-slot="table-scroll-fade-right"]'),
    ).not.toBeInTheDocument();
  });

  it("tracks start, middle, and end scroll affordance states", () => {
    render(
      <DataTableShell>
        <table aria-label="可滚动表格" />
      </DataTableShell>,
    );
    const region = screen
      .getByRole("table", { name: "可滚动表格" })
      .closest('[data-slot="table-scroll-region"]') as HTMLElement;
    const metrics = { clientWidth: 500, scrollWidth: 900, scrollLeft: 0 };
    setScrollMetrics(region, metrics);
    act(() => window.dispatchEvent(new Event("resize")));
    expect(region).toHaveAttribute("data-overflowing", "true");
    expect(region).toHaveAttribute("data-scroll-start", "true");
    expect(region).toHaveAttribute("data-scroll-end", "false");
    expect(
      document.querySelector('[data-slot="table-scroll-fade-left"]'),
    ).not.toBeInTheDocument();
    expect(
      document.querySelector('[data-slot="table-scroll-fade-right"]'),
    ).toBeInTheDocument();

    metrics.scrollLeft = 180;
    fireEvent.scroll(region);
    expect(region).toHaveAttribute("data-scroll-start", "false");
    expect(region).toHaveAttribute("data-scroll-end", "false");
    expect(
      document.querySelector('[data-slot="table-scroll-fade-left"]'),
    ).toBeInTheDocument();
    expect(
      document.querySelector('[data-slot="table-scroll-fade-right"]'),
    ).toBeInTheDocument();

    metrics.scrollLeft = 400;
    fireEvent.scroll(region);
    expect(region).toHaveAttribute("data-scroll-start", "false");
    expect(region).toHaveAttribute("data-scroll-end", "true");
    expect(
      document.querySelector('[data-slot="table-scroll-fade-left"]'),
    ).toBeInTheDocument();
    expect(
      document.querySelector('[data-slot="table-scroll-fade-right"]'),
    ).not.toBeInTheDocument();
  });

  it("removes the affordance when resizing from overflowing to fitting", () => {
    render(
      <DataTableShell>
        <table aria-label="响应式表格" />
      </DataTableShell>,
    );
    const region = screen
      .getByRole("table", { name: "响应式表格" })
      .closest('[data-slot="table-scroll-region"]') as HTMLElement;
    const metrics = { clientWidth: 500, scrollWidth: 900, scrollLeft: 0 };
    setScrollMetrics(region, metrics);
    act(() => window.dispatchEvent(new Event("resize")));
    expect(region).toHaveAttribute("data-overflowing", "true");

    metrics.clientWidth = 900;
    act(() => window.dispatchEvent(new Event("resize")));
    expect(region).toHaveAttribute("data-overflowing", "false");
  });

  it("renders the overflow hint from container facts at any viewport width", () => {
    // issue 445 P3 §5.3: the hint is gated by container overflow facts only — the
    // former window.innerWidth < 640 gate is deleted, so a desktop-width
    // viewport with an overflowing table also shows the hint.
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: 1280,
    });
    render(
      <DataTableShell>
        <table aria-label="触摸表格" />
      </DataTableShell>,
    );
    const region = screen
      .getByRole("table", { name: "触摸表格" })
      .closest('[data-slot="table-scroll-region"]') as HTMLElement;
    const metrics = {
      clientWidth: 420,
      scrollWidth: 900,
      scrollLeft: 0,
    };
    setScrollMetrics(region, metrics);
    act(() => window.dispatchEvent(new Event("resize")));

    expect(screen.getByText("向右滑动查看更多")).toHaveClass(
      "pointer-events-none",
    );
    expect(screen.getByText("向右滑动查看更多")).toHaveAttribute(
      "data-scroll-direction",
      "right",
    );

    metrics.scrollLeft = 240;
    fireEvent.scroll(region);
    expect(screen.getByText("左右滑动查看更多")).toHaveAttribute(
      "data-scroll-direction",
      "both",
    );

    metrics.scrollLeft = 480;
    fireEvent.scroll(region);
    expect(screen.getByText("向左滑动查看更多")).toHaveAttribute(
      "data-scroll-direction",
      "left",
    );

    // A wide viewport does NOT re-gate the hint: overflowing is a container
    // fact, not a viewport policy.
    metrics.scrollLeft = 0;
    fireEvent.scroll(region);
    expect(screen.getByText("向右滑动查看更多")).toBeInTheDocument();
    expect(region).toHaveClass("overflow-x-auto");
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(
      document.documentElement.clientWidth,
    );
  });
});
