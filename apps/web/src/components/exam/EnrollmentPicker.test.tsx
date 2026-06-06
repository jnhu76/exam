import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { EnrollmentPicker } from "./EnrollmentPicker";

const candidates = [
  { id: "c1", userId: "u1", name: "张三", username: "zhangsan", fields: {} },
  { id: "c2", userId: "u2", name: "李四", username: "lisi", fields: {} },
  { id: "c3", userId: "u3", name: "张伟", username: "zhangwei", fields: {} },
  { id: "c4", userId: "u4", name: "王五", username: "wangwu", fields: {} },
  { id: "c5", userId: "u5", name: "赵六", username: "zhaoliu", fields: {} },
];

describe("EnrollmentPicker", () => {
  it("renders search input with placeholder", () => {
    render(
      <EnrollmentPicker
        candidates={candidates}
        enrolledCandidateIds={new Set()}
        selectedIds={new Set()}
        onSelectionChange={() => {}}
      />,
    );

    expect(screen.getByPlaceholderText("搜索考生")).toBeInTheDocument();
  });

  it("shows all candidates by default", () => {
    render(
      <EnrollmentPicker
        candidates={candidates}
        enrolledCandidateIds={new Set()}
        selectedIds={new Set()}
        onSelectionChange={() => {}}
      />,
    );

    expect(screen.getByText("张三")).toBeInTheDocument();
    expect(screen.getByText("李四")).toBeInTheDocument();
    expect(screen.getByText("张伟")).toBeInTheDocument();
    expect(screen.getByText("王五")).toBeInTheDocument();
    expect(screen.getByText("赵六")).toBeInTheDocument();
  });

  it("filters candidates by name when searching", async () => {
    render(
      <EnrollmentPicker
        candidates={candidates}
        enrolledCandidateIds={new Set()}
        selectedIds={new Set()}
        onSelectionChange={() => {}}
      />,
    );

    await userEvent.type(screen.getByPlaceholderText("搜索考生"), "张");

    expect(screen.getByText("张三")).toBeInTheDocument();
    expect(screen.getByText("张伟")).toBeInTheDocument();
    expect(screen.queryByText("李四")).not.toBeInTheDocument();
    expect(screen.queryByText("王五")).not.toBeInTheDocument();
    expect(screen.queryByText("赵六")).not.toBeInTheDocument();
  });

  it("filters candidates by username when searching", async () => {
    render(
      <EnrollmentPicker
        candidates={candidates}
        enrolledCandidateIds={new Set()}
        selectedIds={new Set()}
        onSelectionChange={() => {}}
      />,
    );

    await userEvent.type(screen.getByPlaceholderText("搜索考生"), "zhang");

    expect(screen.getByText("张三")).toBeInTheDocument();
    expect(screen.getByText("张伟")).toBeInTheDocument();
    expect(screen.queryByText("李四")).not.toBeInTheDocument();
  });

  it("shows '已添加' label for enrolled candidates", () => {
    render(
      <EnrollmentPicker
        candidates={candidates}
        enrolledCandidateIds={new Set(["c2", "c4"])}
        selectedIds={new Set()}
        onSelectionChange={() => {}}
      />,
    );

    const enrolledLabels = screen.getAllByText("已添加");
    expect(enrolledLabels).toHaveLength(2);
  });

  it("disables checkboxes for enrolled candidates", () => {
    render(
      <EnrollmentPicker
        candidates={candidates}
        enrolledCandidateIds={new Set(["c2"])}
        selectedIds={new Set()}
        onSelectionChange={() => {}}
      />,
    );

    const checkboxes = screen.getAllByRole("checkbox");
    const enrolledCheckbox = checkboxes.find(
      (cb) => (cb as HTMLInputElement).disabled,
    );
    expect(enrolledCheckbox).toBeTruthy();
  });

  it("renders select all checkbox", () => {
    render(
      <EnrollmentPicker
        candidates={candidates}
        enrolledCandidateIds={new Set()}
        selectedIds={new Set()}
        onSelectionChange={() => {}}
      />,
    );

    expect(screen.getByRole("checkbox", { name: /全选/ })).toBeInTheDocument();
  });

  it("select all toggles non-enrolled visible candidates", async () => {
    const onChange = vi.fn();
    render(
      <EnrollmentPicker
        candidates={candidates}
        enrolledCandidateIds={new Set(["c2"])}
        selectedIds={new Set()}
        onSelectionChange={onChange}
      />,
    );

    await userEvent.click(screen.getByRole("checkbox", { name: /全选/ }));

    expect(onChange).toHaveBeenCalledWith(new Set(["c1", "c3", "c4", "c5"]));
  });

  it("clicking individual checkbox calls onSelectionChange", async () => {
    const onChange = vi.fn();
    render(
      <EnrollmentPicker
        candidates={candidates}
        enrolledCandidateIds={new Set()}
        selectedIds={new Set()}
        onSelectionChange={onChange}
      />,
    );

    await userEvent.click(screen.getByText("张三"));

    expect(onChange).toHaveBeenCalledWith(new Set(["c1"]));
  });

  it("select all respects search filter", async () => {
    const onChange = vi.fn();
    render(
      <EnrollmentPicker
        candidates={candidates}
        enrolledCandidateIds={new Set()}
        selectedIds={new Set()}
        onSelectionChange={onChange}
      />,
    );

    await userEvent.type(screen.getByPlaceholderText("搜索考生"), "张");
    await userEvent.click(screen.getByRole("checkbox", { name: /全选/ }));

    expect(onChange).toHaveBeenCalledWith(new Set(["c1", "c3"]));
  });

  it("shows load more button when hasMore is true", () => {
    render(
      <EnrollmentPicker
        candidates={candidates}
        enrolledCandidateIds={new Set()}
        selectedIds={new Set()}
        onSelectionChange={() => {}}
        hasMore
        onLoadMore={() => {}}
      />,
    );

    expect(
      screen.getByRole("button", { name: /加载更多/ }),
    ).toBeInTheDocument();
  });

  it("does not show load more button when hasMore is false", () => {
    render(
      <EnrollmentPicker
        candidates={candidates}
        enrolledCandidateIds={new Set()}
        selectedIds={new Set()}
        onSelectionChange={() => {}}
      />,
    );

    expect(
      screen.queryByRole("button", { name: /加载更多/ }),
    ).not.toBeInTheDocument();
  });

  it("calls onLoadMore when load more button is clicked", async () => {
    const onLoadMore = vi.fn();
    render(
      <EnrollmentPicker
        candidates={candidates}
        enrolledCandidateIds={new Set()}
        selectedIds={new Set()}
        onSelectionChange={() => {}}
        hasMore
        onLoadMore={onLoadMore}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: /加载更多/ }));

    expect(onLoadMore).toHaveBeenCalledOnce();
  });

  it("shows loading indicator when isLoadingMore is true", () => {
    render(
      <EnrollmentPicker
        candidates={candidates}
        enrolledCandidateIds={new Set()}
        selectedIds={new Set()}
        onSelectionChange={() => {}}
        hasMore
        onLoadMore={() => {}}
        isLoadingMore
      />,
    );

    expect(screen.getByText("加载中...")).toBeInTheDocument();
  });
});
