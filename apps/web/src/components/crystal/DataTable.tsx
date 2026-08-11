import {
  flexRender,
  getCoreRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type RowData,
  type SortingState,
} from '@tanstack/react-table';
import { useState } from 'react';
import { cx } from '../../lib/cx';
import { Icon } from './Icon';

/**
 * Extra information every column carries beyond how to render it.
 *
 * `lead` marks the column that names the record — it becomes the card heading
 * on a phone and carries the row's link. `secondary` columns drop out of the
 * card entirely, which is how an eight-column table becomes a four-field card
 * without a second component existing anywhere.
 */
declare module '@tanstack/react-table' {
  /* eslint-disable @typescript-eslint/no-unused-vars */
  interface ColumnMeta<TData extends RowData, TValue> {
    /** Shown as the cell's label once the header row disappears on a phone. */
    label: string;
    lead?: boolean;
    secondary?: boolean;
    num?: boolean;
  }
  /* eslint-enable @typescript-eslint/no-unused-vars */
}

interface DataTableProps<T> {
  data: T[];
  /* eslint-disable-next-line @typescript-eslint/no-explicit-any -- TanStack's
     own guidance: a heterogeneous column list cannot share one value type. */
  columns: Array<ColumnDef<T, any>>;
  getRowId: (row: T) => string;
  /** Opening a row is a real button, so a keyboard can reach every record. */
  onRowOpen?: (row: T) => void;
  rowLabel?: (row: T) => string;
  /** Names the table for screen readers. Rendered visually hidden. */
  caption: string;
  empty: React.ReactNode;
  toolbar?: React.ReactNode;
  pageSize?: number;
  initialSort?: SortingState;
}

export function DataTable<T>({
  data,
  columns,
  getRowId,
  onRowOpen,
  rowLabel,
  caption,
  empty,
  toolbar,
  pageSize = 12,
  initialSort = [],
}: DataTableProps<T>): React.ReactElement {
  const [sorting, setSorting] = useState<SortingState>(initialSort);

  const table = useReactTable({
    data,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getRowId: (row) => getRowId(row),
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    initialState: { pagination: { pageIndex: 0, pageSize } },
  });

  const rows = table.getRowModel().rows;
  const pageCount = table.getPageCount();
  const { pageIndex } = table.getState().pagination;
  const total = data.length;

  if (!total) {
    return (
      <div className="stack">
        {toolbar}
        {empty}
      </div>
    );
  }

  return (
    <div className="tablewrap cards">
      {toolbar && <div className="tabletop">{toolbar}</div>}
      <div className="tablescroll">
        <table className="dt">
          <caption className="sr-only">{caption}</caption>
          <thead>
            {table.getHeaderGroups().map((group) => (
              <tr key={group.id}>
                {group.headers.map((header) => {
                  const sortable = header.column.getCanSort();
                  const dir = header.column.getIsSorted();
                  const meta = header.column.columnDef.meta;
                  return (
                    <th
                      key={header.id}
                      className={cx(sortable && 'sortable', meta?.num && 'num')}
                      data-dir={dir || undefined}
                      aria-sort={dir === 'asc' ? 'ascending' : dir === 'desc' ? 'descending' : 'none'}
                      scope="col"
                    >
                      {sortable ? (
                        <button
                          type="button"
                          onClick={header.column.getToggleSortingHandler()}
                          style={{
                            background: 'none',
                            border: 'none',
                            font: 'inherit',
                            color: 'inherit',
                            letterSpacing: 'inherit',
                            textTransform: 'inherit',
                            cursor: 'pointer',
                            padding: 0,
                          }}
                        >
                          {flexRender(header.column.columnDef.header, header.getContext())}
                          <span className="sortic" aria-hidden="true">
                            <i className="up" />
                            <i className="dn" />
                          </span>
                        </button>
                      ) : (
                        flexRender(header.column.columnDef.header, header.getContext())
                      )}
                    </th>
                  );
                })}
              </tr>
            ))}
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className={cx(onRowOpen && 'linked')}>
                {row.getVisibleCells().map((cell, index) => {
                  const meta = cell.column.columnDef.meta;
                  const content = flexRender(cell.column.columnDef.cell, cell.getContext());
                  const isLink = onRowOpen && index === 0;
                  return (
                    <td
                      key={cell.id}
                      data-label={meta?.label}
                      data-lead={meta?.lead ? '' : undefined}
                      data-secondary={meta?.secondary ? '' : undefined}
                      className={cx(meta?.num && 'num')}
                    >
                      {isLink ? (
                        <button
                          type="button"
                          className="dt-rowlink"
                          // Lets a panel that opened from this row hand focus
                          // back to it, even after the table has re-rendered.
                          data-row-open={row.id}
                          onClick={() => onRowOpen(row.original)}
                        >
                          {content}
                          <span className="sr-only">
                            {rowLabel ? ` — ${rowLabel(row.original)}` : ' — open details'}
                          </span>
                        </button>
                      ) : (
                        content
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {pageCount > 1 && (
        <div className="tablefoot">
          <span className="mono" style={{ fontSize: '11px', color: 'var(--text-3)' }}>
            Showing {pageIndex * pageSize + 1}—{Math.min((pageIndex + 1) * pageSize, total)} of{' '}
            {total}
          </span>
          <nav className="pager" aria-label="Pagination">
            <button
              type="button"
              onClick={() => table.previousPage()}
              disabled={!table.getCanPreviousPage()}
              aria-label="Previous page"
            >
              <Icon name="chev-left" size="sm" />
            </button>
            {Array.from({ length: pageCount }, (_, i) => (
              <button
                key={i}
                type="button"
                className={cx(i === pageIndex && 'on')}
                aria-current={i === pageIndex ? 'page' : undefined}
                aria-label={`Page ${i + 1}`}
                onClick={() => table.setPageIndex(i)}
              >
                {i + 1}
              </button>
            ))}
            <button
              type="button"
              onClick={() => table.nextPage()}
              disabled={!table.getCanNextPage()}
              aria-label="Next page"
            >
              <Icon name="chev-right" size="sm" />
            </button>
          </nav>
        </div>
      )}
    </div>
  );
}
