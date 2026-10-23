import { useEffect, useMemo, useRef, useState } from "react";
import type { DatabaseRow } from "../../../shared/database";
import { distinctColumnValues, type ColumnFilter } from "../lib/column-filters";

export interface ColumnFilterMenuProps {
  column: string;
  rows: readonly DatabaseRow[];
  filter: ColumnFilter | undefined;
  position: { left: number; top: number };
  onChange: (filter: ColumnFilter) => void;
  onSort: (direction: 1 | -1) => void;
  onClose: () => void;
}

const EMPTY: ColumnFilter = { condition: "", excluded: [] };

/** Excel-style column menu: sort, a condition, and tick boxes for values. */
export default function ColumnFilterMenu({
  column,
  rows,
  filter = EMPTY,
  position,
  onChange,
  onSort,
  onClose,
}: ColumnFilterMenuProps): React.JSX.Element {
  const menu = useRef<HTMLDivElement>(null);
  const [valueSearch, setValueSearch] = useState("");
  const { values, truncated } = useMemo(
    () => distinctColumnValues(rows, column),
    [rows, column],
  );
  const excluded = useMemo(() => new Set(filter.excluded), [filter.excluded]);
  const shown = useMemo(() => {
    const needle = valueSearch.trim().toLocaleLowerCase();
    return needle
      ? values.filter((value) =>
          value.label.toLocaleLowerCase().includes(needle),
        )
      : values;
  }, [values, valueSearch]);
  const allShownTicked = shown.every((value) => !excluded.has(value.key));

  useEffect(() => {
    const onPointer = (event: MouseEvent): void => {
      if (!menu.current?.contains(event.target as Node)) onClose();
    };
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  // Keep the menu on screen near the header it opened from.
  const left = Math.max(8, Math.min(position.left, window.innerWidth - 288));
  const top = Math.max(8, Math.min(position.top, window.innerHeight - 420));

  function toggle(key: string): void {
    const next = new Set(excluded);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    onChange({ ...filter, excluded: [...next] });
  }

  function toggleShown(): void {
    const next = new Set(excluded);
    for (const value of shown) {
      if (allShownTicked) next.add(value.key);
      else next.delete(value.key);
    }
    onChange({ ...filter, excluded: [...next] });
  }

  return (
    <div
      ref={menu}
      className="db-column-menu"
      role="dialog"
      aria-label={`Filter ${column}`}
      style={{ left, top }}
    >
      <div className="db-column-menu-head">
        <b title={column}>{column}</b>
        <span>
          <button type="button" onClick={() => onSort(1)}>
            Sort ↑
          </button>
          <button type="button" onClick={() => onSort(-1)}>
            Sort ↓
          </button>
        </span>
      </div>
      <input
        autoFocus
        aria-label="Condition"
        placeholder="Contains… or >10, <=2026-01-01, !=x, =null"
        value={filter.condition}
        onChange={(event) =>
          onChange({ ...filter, condition: event.target.value })
        }
        onKeyDown={(event) => {
          if (event.key === "Enter") onClose();
        }}
      />
      {values.length > 8 && (
        <input
          aria-label="Search values"
          placeholder="Search values"
          value={valueSearch}
          onChange={(event) => setValueSearch(event.target.value)}
        />
      )}
      <label className="db-column-menu-all">
        <input
          type="checkbox"
          checked={allShownTicked}
          onChange={toggleShown}
        />
        <span>{valueSearch ? "All shown" : "Select all"}</span>
      </label>
      <div className="db-column-menu-values">
        {shown.map((value) => (
          <label key={value.key} title={value.label}>
            <input
              type="checkbox"
              checked={!excluded.has(value.key)}
              onChange={() => toggle(value.key)}
            />
            <span>{value.label}</span>
            <small>{value.count.toLocaleString()}</small>
          </label>
        ))}
        {!shown.length && <p>No matching values</p>}
      </div>
      {truncated && (
        <p className="db-column-menu-note">
          Showing the 500 most common values.
        </p>
      )}
      <div className="db-column-menu-actions">
        <button
          type="button"
          disabled={!filter.condition && !filter.excluded.length}
          onClick={() => onChange(EMPTY)}
        >
          Clear filter
        </button>
        <button type="button" className="primary" onClick={onClose}>
          Done
        </button>
      </div>
    </div>
  );
}
