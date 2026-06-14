import { fireEvent, render, screen } from "@testing-library/react";
import type { ColumnDef } from "@tanstack/react-table";
import { describe, expect, it } from "vitest";
import { DataTable } from "../../src/renderer/components/DataTable";

type RowData = {
  id: string;
  title: string;
};

describe("DataTable", () => {
  it("selects a contiguous row range when a checkbox is shift-clicked", async () => {
    const rows: RowData[] = [
      { id: "one", title: "One" },
      { id: "two", title: "Two" },
      { id: "three", title: "Three" },
    ];
    const columns: Array<ColumnDef<RowData, unknown>> = [
      {
        cell: ({ row }) => (
          <input
            aria-label={`Select ${row.original.title}`}
            checked={row.getIsSelected()}
            onChange={row.getToggleSelectedHandler()}
            type="checkbox"
          />
        ),
        header: "Select",
        id: "select",
      },
      { accessorKey: "title", header: "Title" },
    ];

    render(
      <DataTable
        bulkActions={() => null}
        columns={columns}
        data={rows}
        getRowId={(row) => row.id}
        title="Rows"
      />,
    );

    fireEvent.click(screen.getByRole("checkbox", { name: "Select One" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Select Three" }), { shiftKey: true });

    expect(screen.getByText("3 selected")).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Select Two" })).toBeChecked();
  });

  it("selects all filtered rows from the header checkbox", () => {
    const rows: RowData[] = [
      { id: "one", title: "One" },
      { id: "two", title: "Two" },
    ];
    const columns: Array<ColumnDef<RowData, unknown>> = [
      {
        cell: ({ row }) => (
          <input
            aria-label={`Select ${row.original.title}`}
            checked={row.getIsSelected()}
            onChange={row.getToggleSelectedHandler()}
            type="checkbox"
          />
        ),
        enableSorting: false,
        header: ({ table }) => (
          <input
            aria-label="Select all rows"
            checked={table.getIsAllRowsSelected()}
            onChange={table.getToggleAllRowsSelectedHandler()}
            type="checkbox"
          />
        ),
        id: "select",
      },
      { accessorKey: "title", header: "Title" },
    ];

    render(
      <DataTable
        bulkActions={() => null}
        columns={columns}
        data={rows}
        getRowId={(row) => row.id}
        title="Rows"
      />,
    );

    fireEvent.click(screen.getByRole("checkbox", { name: "Select all rows" }));

    expect(screen.getByText("2 selected")).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Select One" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Select Two" })).toBeChecked();
  });

  it("does not mount every row when the data set is large", () => {
    const rows: RowData[] = Array.from({ length: 500 }, (_, index) => ({
      id: String(index),
      title: `Row ${index}`,
    }));
    const columns: Array<ColumnDef<RowData, unknown>> = [{ accessorKey: "title", header: "Title" }];

    render(<DataTable columns={columns} data={rows} getRowId={(row) => row.id} title="Rows" />);

    expect(screen.getAllByRole("row").length).toBeLessThan(120);
    expect(screen.queryByText("Row 499")).not.toBeInTheDocument();
  });

  it("can hide and show optional columns", () => {
    const rows: RowData[] = [{ id: "one", title: "One" }];
    const columns: Array<ColumnDef<RowData, unknown>> = [
      { accessorKey: "title", header: "Title" },
      { accessorKey: "id", header: "Internal ID" },
    ];

    render(
      <DataTable
        columns={columns}
        data={rows}
        enableColumnVisibility
        getRowId={(row) => row.id}
        title="Rows"
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Show or hide columns" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Internal ID" }));

    expect(screen.queryByRole("columnheader", { name: /Internal ID/ })).not.toBeInTheDocument();
  });
});
