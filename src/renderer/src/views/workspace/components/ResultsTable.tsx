import { ListFilter } from "lucide-react";
import type { RefObject } from "react";
import type { DatabaseRow } from "../../../../../shared/database";
import {
  isColumnFilterActive,
  type ColumnFilter,
  type ColumnFilters,
} from "../../../lib/column-filters";
import { isSameRow } from "../../../lib/row-editor";
import { ROW_HEIGHT, ROW_INDEX_WIDTH } from "../workspace-helpers";
import ColumnFilterMenu from "../../../components/ColumnFilterMenu";
import type { RowSource } from "../../../components/RowSidePanel";

/**
 * The virtualized results grid. Presentational: the workspace owns the
 * sort/filter/width state and the row-windowing math; this component
 * renders the header, the visible row window (with spacer rows) and the
 * open column filter menu.
 */
export default function ResultsTable({
  columns,
  windowedRows,
  firstVisible,
  lastVisible,
  visibleRowCount,
  tableWidth,
  widthOf,
  mongoColumnKinds,
  sort,
  columnFilters,
  filterMenu,
  filterMenuRows,
  inspectedRow,
  rowSource,
  cellText,
  scrollElement,
  onScroll,
  onSortColumn,
  onFilterMenuToggle,
  onFilterChange,
  onMenuSort,
  onCloseFilterMenu,
  onResizeStart,
  onAutoFit,
  onInspect,
}: {
  columns: string[];
  windowedRows: DatabaseRow[];
  firstVisible: number;
  lastVisible: number;
  visibleRowCount: number;
  tableWidth: number;
  widthOf: (column: string) => number;
  mongoColumnKinds: Record<string, string>;
  sort: { column: string; direction: 1 | -1 } | null;
  columnFilters: ColumnFilters;
  filterMenu: { column: string; left: number; top: number } | null;
  filterMenuRows: DatabaseRow[];
  inspectedRow: DatabaseRow | null;
  rowSource: RowSource | null;
  cellText: (row: DatabaseRow, column: string) => string;
  scrollElement: RefObject<HTMLDivElement | null>;
  onScroll: (viewport: { top: number; height: number }) => void;
  onSortColumn: (column: string) => void;
  onFilterMenuToggle: (
    column: string,
    position: { left: number; top: number },
  ) => void;
  onFilterChange: (column: string, filter: ColumnFilter) => void;
  onMenuSort: (column: string, direction: 1 | -1) => void;
  onCloseFilterMenu: () => void;
  onResizeStart: (
    event: React.PointerEvent<HTMLSpanElement>,
    column: string,
  ) => void;
  onAutoFit: (event: React.MouseEvent<HTMLSpanElement>, column: string) => void;
  onInspect: (row: DatabaseRow) => void;
}): React.JSX.Element {
  return (
    <div
      className="db-table-scroll"
      ref={scrollElement}
      onScroll={(event) =>
        onScroll({
          top: event.currentTarget.scrollTop,
          height: event.currentTarget.clientHeight,
        })
      }
    >
      <table className="db-result-table sized" style={{ width: tableWidth }}>
        <colgroup>
          <col style={{ width: ROW_INDEX_WIDTH }} />
          {columns.map((column) => (
            <col key={column} style={{ width: widthOf(column) }} />
          ))}
          <col />
        </colgroup>
        <thead>
          <tr>
            <th className="db-row-index-head">#</th>
            {columns.map((column) => (
              <th
                key={column}
                title={`Sort ${column}`}
                className={
                  isColumnFilterActive(columnFilters[column])
                    ? "filtered"
                    : undefined
                }
              >
                <button
                  className="db-column-filter-button"
                  title={`Filter ${column}`}
                  aria-label={`Filter ${column}`}
                  aria-expanded={filterMenu?.column === column}
                  onClick={(event) => {
                    event.stopPropagation();
                    const box = event.currentTarget.getBoundingClientRect();
                    onFilterMenuToggle(column, {
                      left: box.left - 240,
                      top: box.bottom + 4,
                    });
                  }}
                >
                  <ListFilter size={11} />
                </button>
                <button onClick={() => onSortColumn(column)}>
                  <b className="db-col-label">
                    {column}
                    {mongoColumnKinds[column] && (
                      <>
                        {" "}
                        <small className="db-col-type">
                          {mongoColumnKinds[column]}
                        </small>
                      </>
                    )}
                  </b>
                  <span>
                    {sort?.column === column
                      ? sort.direction === 1
                        ? " ↑"
                        : " ↓"
                      : " ↕"}
                  </span>
                </button>
                <span
                  className="db-col-resizer"
                  role="separator"
                  aria-orientation="vertical"
                  aria-label={`Resize ${column}`}
                  title="Drag to resize · double-click to fit"
                  onPointerDown={(event) => onResizeStart(event, column)}
                  onDoubleClick={(event) => onAutoFit(event, column)}
                  onClick={(event) => event.stopPropagation()}
                />
              </th>
            ))}
            <th className="db-col-filler" aria-hidden="true" />
          </tr>
        </thead>
        <tbody>
          {firstVisible > 0 && (
            <tr aria-hidden="true" className="db-spacer-row">
              <td
                colSpan={columns.length + 2}
                style={{ height: firstVisible * ROW_HEIGHT }}
              />
            </tr>
          )}
          {windowedRows.map((row, offset) => {
            const index = firstVisible + offset;
            const selected =
              row === inspectedRow ||
              !!(
                inspectedRow &&
                rowSource &&
                isSameRow(rowSource.details, row, inspectedRow)
              );
            return (
              <tr
                key={index}
                className={selected ? "selected-row" : ""}
                tabIndex={0}
                aria-selected={selected}
                onClick={() => onInspect(row)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    onInspect(row);
                  }
                }}
                title="Click to inspect or edit row"
              >
                <td className="db-row-index">{index + 1}</td>
                {columns.map((column) => {
                  const text = cellText(row, column);
                  const nested =
                    row[column] !== null &&
                    text !== String(row[column] ?? "NULL");
                  return (
                    <td
                      key={column}
                      className={
                        row[column] === null
                          ? "null-cell"
                          : nested
                            ? "nested-cell"
                            : ""
                      }
                      title={String(row[column] ?? "")}
                    >
                      {text}
                    </td>
                  );
                })}
                <td className="db-col-filler" />
              </tr>
            );
          })}
          {lastVisible < visibleRowCount && (
            <tr aria-hidden="true" className="db-spacer-row">
              <td
                colSpan={columns.length + 2}
                style={{
                  height: (visibleRowCount - lastVisible) * ROW_HEIGHT,
                }}
              />
            </tr>
          )}
        </tbody>
      </table>
      {filterMenu && columns.includes(filterMenu.column) && (
        <ColumnFilterMenu
          column={filterMenu.column}
          rows={filterMenuRows}
          filter={columnFilters[filterMenu.column]}
          position={filterMenu}
          onChange={(filter) => onFilterChange(filterMenu.column, filter)}
          onSort={(direction) => onMenuSort(filterMenu.column, direction)}
          onClose={onCloseFilterMenu}
        />
      )}
    </div>
  );
}
