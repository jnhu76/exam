import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { deriveMobileCardFields, MobileRecordList } from "./MobileRecordList";
import type { DataViewColumnDef } from "./DesktopDataTable";
import { RowActions } from "./RowActions";
import { Pencil, Trash2 } from "lucide-react";

interface Row {
  id: string;
  title: string;
  owner: string;
  count: number;
  tags: string;
}

/** Column fixture helpers — meta-only declarations, no cell renderers needed
 * for the pure mapping tests. */
function col(
  id: string,
  meta: NonNullable<DataViewColumnDef<Row>["meta"]>,
): DataViewColumnDef<Row> {
  return { id, meta };
}

describe("deriveMobileCardFields (frozen priority→slot mapping)", () => {
  it("maps role-default priorities onto the four card slots", () => {
    const fields = deriveMobileCardFields<Row>([
      col("title", { role: "primary-text" }),
      col("owner", { role: "secondary-text" }),
      col("status", { role: "status" }),
      col("score", { role: "score" }),
      col("created", { role: "date" }),
      col("tags", { role: "tag-list" }),
      col("kind", { role: "type" }),
      col("desc", { role: "description" }),
      col("edit", { role: "actions" }),
    ]);
    // Declaration order is preserved among PARTICIPATING fields.
    expect(fields.map((f) => f.id)).toEqual([
      "title",
      "owner",
      "status",
      "score",
      "created",
      "edit",
    ]);
    expect(fields.find((f) => f.id === "title")?.slot).toBe("primary");
    expect(fields.find((f) => f.id === "owner")?.slot).toBe("meta");
    expect(fields.find((f) => f.id === "status")?.slot).toBe("header");
    expect(fields.find((f) => f.id === "score")?.slot).toBe("header");
    expect(fields.find((f) => f.id === "created")?.slot).toBe("meta");
    expect(fields.find((f) => f.id === "edit")?.slot).toBe("actions");
  });

  it("omits low-priority columns even when their role defaults to high", () => {
    const fields = deriveMobileCardFields<Row>([
      col("title", { role: "primary-text", priority: "low" }),
      col("owner", { role: "secondary-text" }),
    ]);
    expect(fields.map((f) => f.id)).toEqual(["owner"]);
  });

  it("promotes a high-priority long-text column into the primary area", () => {
    const fields = deriveMobileCardFields<Row>([
      col("content", { role: "long-text", priority: "high" }),
    ]);
    expect(fields[0]?.slot).toBe("primary");
  });

  it("keeps a high-priority non-text column in the header cluster, not primary", () => {
    const fields = deriveMobileCardFields<Row>([
      col("kind", { role: "type", priority: "high" }),
    ]);
    expect(fields[0]?.slot).toBe("header");
  });

  it("preserves declaration order within a slot", () => {
    const fields = deriveMobileCardFields<Row>([
      col("status", { role: "status" }),
      col("score", { role: "score" }),
      col("created", { role: "date" }),
      col("updated", { role: "date" }),
    ]);
    expect(fields.filter((f) => f.slot === "header").map((f) => f.id)).toEqual([
      "status",
      "score",
    ]);
    expect(fields.filter((f) => f.slot === "meta").map((f) => f.id)).toEqual([
      "created",
      "updated",
    ]);
  });

  it("demotes a normal-priority primary-text column to the meta line", () => {
    const fields = deriveMobileCardFields<Row>([
      col("title", { role: "primary-text", priority: "normal" }),
    ]);
    expect(fields[0]?.slot).toBe("meta");
  });

  it("fails loud on a second actions column (dev/test)", () => {
    expect(() =>
      deriveMobileCardFields<Row>([
        col("a", { role: "actions" }),
        col("b", { role: "actions" }),
      ]),
    ).toThrow(/at most one actions column/);
  });

  it("derives the field id from accessorKey when id is absent", () => {
    const fields = deriveMobileCardFields<Row>([
      { accessorKey: "owner", meta: { role: "secondary-text" } },
    ]);
    expect(fields.map((f) => f.id)).toEqual(["owner"]);
  });
});

const columns: DataViewColumnDef<Row>[] = [
  {
    id: "title",
    meta: { role: "primary-text" },
    header: "Title",
    cell: ({ row }) => <span>{row.original.title}</span>,
  },
  {
    id: "kind",
    meta: { role: "type", priority: "high" },
    header: "Kind",
    cell: ({ row }) => <em>kind-{row.original.id}</em>,
  },
  {
    id: "count",
    meta: { role: "number" },
    header: "Count",
    cell: ({ row }) => row.original.count,
  },
  {
    id: "tags",
    meta: { role: "tag-list" },
    header: "Tags",
    cell: ({ row }) => <span>{row.original.tags}</span>,
  },
  {
    id: "actions",
    meta: { role: "actions" },
    header: "Actions",
    cell: ({ row }) => (
      <RowActions
        row={row.original}
        actions={[
          {
            id: "edit",
            label: `edit ${row.original.id}`,
            icon: Pencil,
            onSelect: () => {},
          },
          {
            id: "delete",
            label: `delete ${row.original.id}`,
            icon: Trash2,
            onSelect: () => {},
          },
        ]}
      />
    ),
  },
];

const rows: Row[] = [
  { id: "r1", title: "First row", owner: "a", count: 3, tags: "x,y" },
  { id: "r2", title: "Second row", owner: "b", count: 7, tags: "z" },
];

describe("MobileRecordList (derived mode)", () => {
  it("renders one card per row from the single-source columns", () => {
    render(
      <MobileRecordList columns={columns} rows={rows} getRowId={(r) => r.id} />,
    );
    const cards = document.querySelectorAll('[data-slot="mobile-record-card"]');
    expect(cards).toHaveLength(2);
    expect(screen.getByText("First row")).toBeInTheDocument();
    expect(screen.getByText("Second row")).toBeInTheDocument();
  });

  it("routes high fields to header/primary, normal to labeled meta, low omitted", () => {
    render(
      <MobileRecordList
        columns={columns}
        rows={[rows[0]!]}
        getRowId={(r) => r.id}
      />,
    );
    const card = document.querySelector('[data-slot="mobile-record-card"]')!;
    // high non-text → header cluster; low (tags) never rendered.
    expect(card.querySelector('[data-field-id="kind"]')).toBeInTheDocument();
    expect(card.querySelector('[data-field-id="tags"]')).toBeNull();
    // normal → meta line with its column label prefix.
    const metaField = card.querySelector(
      '[data-slot="mobile-record-card"] [data-field-id="count"], [data-field-id="count"]',
    );
    expect(metaField).toBeInTheDocument();
    expect(metaField!.textContent).toBe("Count: 3");
  });

  it("reuses the actions column declaration (RowActions) as the card actions slot", () => {
    render(
      <MobileRecordList
        columns={columns}
        rows={[rows[0]!]}
        getRowId={(r) => r.id}
      />,
    );
    const card = document.querySelector('[data-slot="mobile-record-card"]')!;
    const actionsSlot = card.querySelector('[data-slot="row-actions"]');
    expect(actionsSlot).toBeInTheDocument();
    expect(
      actionsSlot!.querySelector('[data-action-id="edit"]'),
    ).toBeInTheDocument();
  });

  it("activates the card through onRowClick", () => {
    const activated: string[] = [];
    render(
      <MobileRecordList
        columns={columns}
        rows={[rows[0]!]}
        getRowId={(r) => r.id}
        onRowClick={(row) => activated.push(row.id)}
      />,
    );
    fireEvent.click(screen.getByText("First row"));
    expect(activated).toEqual(["r1"]);
  });

  it("renders the error card and the empty card from body state", () => {
    const { rerender } = render(
      <MobileRecordList columns={columns} rows={[]} error="boom" />,
    );
    expect(screen.getByText("boom")).toBeInTheDocument();
    rerender(
      <MobileRecordList
        columns={columns}
        rows={[]}
        empty
        emptyTitle="No records"
        emptyDescription="Nothing here"
      />,
    );
    expect(screen.getByText("No records")).toBeInTheDocument();
    expect(screen.getByText("Nothing here")).toBeInTheDocument();
    // no record cards in either state
    expect(document.querySelectorAll("[data-field-id]").length).toBe(0);
  });
});
