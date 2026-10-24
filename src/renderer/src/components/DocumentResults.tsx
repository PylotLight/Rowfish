import { memo, useCallback, useEffect, useRef, useState } from "react";
import {
  Check,
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
  Copy,
  CopyPlus,
  FileJson,
  PanelRight,
  Pencil,
  Trash2,
} from "lucide-react";
import type { DatabaseRow } from "../../../shared/database";
import {
  childEntries,
  describeValue,
  formatDocument,
  isNestedKind,
  jsonTokens,
  treeSummary,
} from "../lib/document-view";

/** Cards rendered per step; more mount as the list scrolls near its end. */
const PAGE = 40;
/** Fields / items shown per level before a "show more" button. */
const FIELD_PAGE = 30;
/** Expand-all stops after this many nested nodes so huge docs stay usable. */
const EXPAND_ALL_LIMIT = 1_500;
/** JSON text above this length renders without syntax colours. */
const HIGHLIGHT_LIMIT = 60_000;
const SEP = "\u0000";

const rowKeys = new WeakMap<DatabaseRow, number>();
let nextRowKey = 0;
/** Stable React key per row object, so sorting keeps each card's state. */
function rowKey(row: DatabaseRow): number {
  let key = rowKeys.get(row);
  if (key === undefined) rowKeys.set(row, (key = nextRowKey++));
  return key;
}

export interface DocumentActions {
  onInspect: (row: DatabaseRow) => void;
  onEdit?: (row: DatabaseRow) => void;
  onClone?: (row: DatabaseRow) => void;
  onDelete?: (row: DatabaseRow) => void;
}

type Props = DocumentActions & {
  view: "list" | "json";
  rows: readonly DatabaseRow[];
  documentOf: (row: DatabaseRow) => Record<string, unknown>;
  selectedRow: DatabaseRow | null;
  /** Changes when a new result arrives, so the list starts from the top. */
  resetKey: string;
};

export default function DocumentResults({
  view,
  rows,
  documentOf,
  selectedRow,
  resetKey,
  onInspect,
  onEdit,
  onClone,
  onDelete,
}: Props): React.JSX.Element {
  const [limit, setLimit] = useState(PAGE);
  // Stable callbacks keep memoised cards from re-rendering on every parent render.
  const latest = useRef({ onInspect, onEdit, onClone, onDelete });
  latest.current = { onInspect, onEdit, onClone, onDelete };
  const inspect = useCallback(
    (row: DatabaseRow) => latest.current.onInspect(row),
    [],
  );
  const edit = useCallback(
    (row: DatabaseRow) => latest.current.onEdit?.(row),
    [],
  );
  const clone = useCallback(
    (row: DatabaseRow) => latest.current.onClone?.(row),
    [],
  );
  const remove = useCallback(
    (row: DatabaseRow) => latest.current.onDelete?.(row),
    [],
  );
  const scroller = useRef<HTMLDivElement>(null);
  const sentinel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    setLimit(PAGE);
    if (scroller.current) scroller.current.scrollTop = 0;
  }, [resetKey, view]);
  const more = rows.length > limit;
  useEffect(() => {
    const target = sentinel.current;
    if (!target || !more) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting))
          setLimit((current) => current + PAGE);
      },
      { root: scroller.current, rootMargin: "800px 0px" },
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, [more, limit]);
  return (
    <div
      className={`db-doc-scroll ${view === "json" ? "json" : "list"}`}
      ref={scroller}
      data-testid="document-results"
    >
      {rows.slice(0, limit).map((row, index) => (
        <DocumentCard
          key={rowKey(row)}
          row={row}
          index={index}
          view={view}
          document={documentOf(row)}
          selected={row === selectedRow}
          onInspect={inspect}
          onEdit={onEdit ? edit : undefined}
          onClone={onClone ? clone : undefined}
          onDelete={onDelete ? remove : undefined}
        />
      ))}
      {more && (
        <div className="db-doc-more" ref={sentinel}>
          <button onClick={() => setLimit((current) => current + PAGE * 5)}>
            Showing {limit.toLocaleString()} of {rows.length.toLocaleString()} ·
            show more
          </button>
        </div>
      )}
    </div>
  );
}

type CardProps = DocumentActions & {
  row: DatabaseRow;
  index: number;
  view: "list" | "json";
  document: Record<string, unknown>;
  selected: boolean;
};

function collectPaths(
  value: unknown,
  prefix: string,
  into: Set<string>,
): boolean {
  for (const [key, child] of childEntries(value)) {
    if (!isNestedKind(describeValue(child).kind)) continue;
    if (into.size >= EXPAND_ALL_LIMIT) return false;
    const path = prefix ? `${prefix}${SEP}${key}` : key;
    into.add(path);
    if (!collectPaths(child, path, into)) return false;
  }
  return true;
}

const DocumentCard = memo(function DocumentCard({
  row,
  index,
  view,
  document,
  selected,
  onInspect,
  onEdit,
  onClone,
  onDelete,
}: CardProps): React.JSX.Element {
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [copied, setCopied] = useState<"" | "ejson" | "json">("");
  const toggle = useCallback((path: string) => {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(path)) {
        for (const item of current)
          if (item === path || item.startsWith(`${path}${SEP}`))
            next.delete(item);
      } else next.add(path);
      return next;
    });
  }, []);
  const anyExpanded = expanded.size > 0;
  const toggleAll = (): void => {
    if (anyExpanded) return setExpanded(new Set());
    const paths = new Set<string>();
    collectPaths(document, "", paths);
    setExpanded(paths);
  };
  const copy = (format: "ejson" | "json"): void => {
    void navigator.clipboard
      ?.writeText(formatDocument(document, format))
      .then(() => {
        setCopied(format);
        window.setTimeout(() => setCopied(""), 1_200);
      })
      .catch(() => undefined);
  };
  const hasId = "_id" in document;
  return (
    <article
      className={`db-doc-card${selected ? " selected" : ""}`}
      aria-label={`Document ${index + 1}`}
    >
      <div className="db-doc-actions">
        {view === "list" && (
          <button
            title={anyExpanded ? "Collapse all fields" : "Expand all fields"}
            aria-label={
              anyExpanded ? "Collapse all fields" : "Expand all fields"
            }
            onClick={toggleAll}
          >
            {anyExpanded ? (
              <ChevronsDownUp size={13} />
            ) : (
              <ChevronsUpDown size={13} />
            )}
          </button>
        )}
        <button
          title="Copy document as EJSON"
          aria-label="Copy document as EJSON"
          onClick={() => copy("ejson")}
        >
          {copied === "ejson" ? <Check size={13} /> : <Copy size={13} />}
        </button>
        <button
          title="Copy as plain JSON (ids and dates as strings)"
          aria-label="Copy as plain JSON"
          onClick={() => copy("json")}
        >
          {copied === "json" ? <Check size={13} /> : <FileJson size={13} />}
        </button>
        <button
          title="Inspect in row details"
          aria-label="Inspect document"
          onClick={() => onInspect(row)}
        >
          <PanelRight size={13} />
        </button>
        {onEdit && hasId && (
          <button
            title="Edit document"
            aria-label="Edit document"
            onClick={() => onEdit(row)}
          >
            <Pencil size={13} />
          </button>
        )}
        {onClone && (
          <button
            title="Clone document"
            aria-label="Clone document"
            onClick={() => onClone(row)}
          >
            <CopyPlus size={13} />
          </button>
        )}
        {onDelete && hasId && (
          <button
            className="danger"
            title="Delete document"
            aria-label="Delete document"
            onClick={() => onDelete(row)}
          >
            <Trash2 size={13} />
          </button>
        )}
      </div>
      <span className="db-doc-index">{index + 1}</span>
      {view === "json" ? (
        <JsonBlock document={document} />
      ) : (
        <div className="db-doc-tree" role="tree">
          <Fields
            value={document}
            prefix=""
            depth={0}
            expanded={expanded}
            toggle={toggle}
          />
        </div>
      )}
    </article>
  );
});

function Fields({
  value,
  prefix,
  depth,
  expanded,
  toggle,
}: {
  value: unknown;
  prefix: string;
  depth: number;
  expanded: ReadonlySet<string>;
  toggle: (path: string) => void;
}): React.JSX.Element {
  const [shown, setShown] = useState(FIELD_PAGE);
  const entries = childEntries(value);
  return (
    <>
      {entries.slice(0, shown).map(([key, child]) => {
        const path = prefix ? `${prefix}${SEP}${key}` : key;
        return (
          <Field
            key={key}
            name={key}
            value={child}
            path={path}
            depth={depth}
            expanded={expanded}
            toggle={toggle}
          />
        );
      })}
      {entries.length > shown && (
        <button
          className="db-doc-show-more"
          style={{ paddingLeft: depth * 16 + 18 }}
          onClick={() => setShown((current) => current + FIELD_PAGE * 4)}
        >
          Show {Math.min(FIELD_PAGE * 4, entries.length - shown)} more of{" "}
          {(entries.length - shown).toLocaleString()} fields
        </button>
      )}
    </>
  );
}

function Field({
  name,
  value,
  path,
  depth,
  expanded,
  toggle,
}: {
  name: string;
  value: unknown;
  path: string;
  depth: number;
  expanded: ReadonlySet<string>;
  toggle: (path: string) => void;
}): React.JSX.Element {
  const info = describeValue(value);
  const nested = isNestedKind(info.kind);
  const open = nested && expanded.has(path);
  return (
    <div
      className="db-doc-field"
      role="treeitem"
      aria-expanded={nested ? open : undefined}
    >
      <div className="db-doc-line" style={{ paddingLeft: depth * 16 }}>
        {nested ? (
          <button
            className={`db-doc-caret${open ? " open" : ""}`}
            aria-label={`${open ? "Collapse" : "Expand"} ${name}`}
            onClick={() => toggle(path)}
          >
            <ChevronRight size={11} />
          </button>
        ) : (
          <span className="db-doc-caret-space" />
        )}
        <span className="db-doc-key">{name}</span>
        <span className="db-doc-colon">:</span>
        {nested ? (
          <button
            className="db-doc-summary"
            tabIndex={-1}
            onClick={() => toggle(path)}
          >
            {treeSummary(info)}
          </button>
        ) : (
          <span
            className={`db-doc-value kind-${info.kind}`}
            title={`${info.kind} · ${info.text}`}
          >
            {info.text}
          </span>
        )}
      </div>
      {open && (
        <div role="group">
          <Fields
            value={value}
            prefix={path}
            depth={depth + 1}
            expanded={expanded}
            toggle={toggle}
          />
        </div>
      )}
    </div>
  );
}

function JsonBlock({
  document,
}: {
  document: Record<string, unknown>;
}): React.JSX.Element {
  const text = formatDocument(document, "ejson");
  return (
    <pre className="db-doc-json">
      {text.length > HIGHLIGHT_LIMIT
        ? text
        : jsonTokens(text).map((token, index) =>
            token.type ? (
              <span key={index} className={`json-${token.type}`}>
                {token.text}
              </span>
            ) : (
              token.text
            ),
          )}
    </pre>
  );
}
