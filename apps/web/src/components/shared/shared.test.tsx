import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ConnectionIndicator } from "./ConnectionIndicator";
import { ConfirmDialog } from "./ConfirmDialog";
import { EmptyState } from "./EmptyState";
import { PageHeader } from "./PageHeader";
import { SaveIndicator } from "@/components/exam/SaveIndicator";
import { StatsCard } from "./StatsCard";

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
});

describe("ConnectionIndicator", () => {
  it("renders connected status", () => {
    render(<ConnectionIndicator status="connected" />);
    expect(screen.getByText("连接正常")).toBeInTheDocument();
  });

  it("renders degraded status", () => {
    render(<ConnectionIndicator status="degraded" />);
    expect(screen.getByText("连接不稳定")).toBeInTheDocument();
  });

  it("renders offline status", () => {
    render(<ConnectionIndicator status="offline" />);
    expect(screen.getByText("连接已断开")).toBeInTheDocument();
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
