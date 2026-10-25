import { useEffect, useRef, useState } from "react";
import { ChevronRight } from "lucide-react";
import type { MongoBrowserCollection } from "../../../../../shared/database";
import {
  MONGO_DETAILS_KEY,
  type MongoOperation,
  type RunState,
} from "../workspace-helpers";
import type { MongoOperationFields } from "./MongoOperationDialog";

/**
 * The MongoDB collection bar: the selected collection's summary line, the
 * insert/update actions, the more menu (create index, delete, drop) and the
 * expandable index/validator/options details. Owns its open/closed
 * preference (persisted) and the more menu's outside-click/Escape close.
 */
export default function MongoCollectionBar({
  collection,
  database,
  runState,
  mongoOperationBusy,
  onOpenOperation,
}: {
  collection: MongoBrowserCollection;
  database: string;
  runState: RunState;
  mongoOperationBusy: boolean;
  onOpenOperation: (
    operation: MongoOperation,
    prefill?: Partial<MongoOperationFields>,
  ) => void;
}): React.JSX.Element {
  /** Indexes, validator and options under the bar; folded by default. */
  const [detailsOpen, setDetailsOpen] = useState(() => {
    try {
      return localStorage.getItem(MONGO_DETAILS_KEY) === "open";
    } catch {
      return false;
    }
  });
  const [moreOpen, setMoreOpen] = useState(false);
  const moreRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!moreOpen) return;
    const close = (event: MouseEvent): void => {
      if (!moreRef.current?.contains(event.target as Node)) setMoreOpen(false);
    };
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") setMoreOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", onKey);
    };
  }, [moreOpen]);
  function toggleDetails(): void {
    setDetailsOpen((open) => {
      try {
        localStorage.setItem(MONGO_DETAILS_KEY, open ? "closed" : "open");
      } catch {
        // Only a display preference.
      }
      return !open;
    });
  }
  return (
    <section
      className="db-mongo-details"
      aria-label="MongoDB collection details"
    >
      <div className="db-mongo-details-bar">
        <button
          type="button"
          className="db-mongo-details-toggle"
          aria-expanded={detailsOpen}
          onClick={() => toggleDetails()}
          title={
            detailsOpen
              ? "Hide collection details"
              : "Show indexes, validator and options"
          }
        >
          <ChevronRight
            size={13}
            className={detailsOpen ? "open" : undefined}
            aria-hidden="true"
          />
          <strong>
            {database}.{collection.name}
          </strong>
          <span>
            {collection.type}
            {collection.estimatedDocuments !== undefined
              ? ` · ~${collection.estimatedDocuments.toLocaleString()} docs`
              : ""}{" "}
            · {(collection.indexes ?? []).length} indexes
          </span>
        </button>
        <div className="db-mongo-actions">
          <button
            className="db-quiet-button"
            disabled={runState !== "idle" || mongoOperationBusy}
            onClick={() => onOpenOperation("insert")}
          >
            ＋ Insert
          </button>
          <button
            className="db-quiet-button"
            disabled={runState !== "idle" || mongoOperationBusy}
            onClick={() => onOpenOperation("update")}
          >
            Update
          </button>
          <div className="db-mongo-more" ref={moreRef}>
            <button
              className="db-quiet-button"
              aria-label="More collection actions"
              aria-haspopup="menu"
              aria-expanded={moreOpen}
              disabled={mongoOperationBusy}
              onClick={() => setMoreOpen((open) => !open)}
            >
              ⋯
            </button>
            {moreOpen && (
              <div className="db-mongo-more-menu" role="menu">
                <button
                  role="menuitem"
                  onClick={() => {
                    setMoreOpen(false);
                    onOpenOperation("create-index");
                  }}
                >
                  ＋ Create index
                </button>
                <div className="db-mongo-more-label">Danger zone</div>
                <button
                  role="menuitem"
                  className="danger"
                  disabled={runState !== "idle"}
                  onClick={() => {
                    setMoreOpen(false);
                    onOpenOperation("delete");
                  }}
                >
                  Delete documents…
                </button>
                <button
                  role="menuitem"
                  className="danger"
                  onClick={() => {
                    setMoreOpen(false);
                    onOpenOperation("drop-collection");
                  }}
                >
                  Drop collection…
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
      {detailsOpen && (
        <>
          {(collection.indexes?.length ?? 0) > 0 && (
            <div className="db-mongo-indexes">
              {collection.indexes?.map((index) => (
                <div className="db-mongo-index" key={index.name}>
                  <span>
                    <b>{index.name}</b>
                    {index.unique ? " · unique" : ""}
                    {index.expireAfterSeconds !== undefined
                      ? ` · TTL ${index.expireAfterSeconds}s`
                      : ""}
                    <code>{index.keys}</code>
                  </span>
                  {index.name !== "_id_" && (
                    <button
                      className="db-inline-add danger"
                      title={`Drop index ${index.name}`}
                      aria-label={`Drop index ${index.name}`}
                      onClick={() => {
                        onOpenOperation("drop-index", {
                          indexName: index.name,
                        });
                      }}
                    >
                      ×
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
          {collection.validator && (
            <details className="db-mongo-validator">
              <summary>Collection validator</summary>
              <code>{collection.validator}</code>
            </details>
          )}
          {collection.options && (
            <details className="db-mongo-validator">
              <summary>Collection options</summary>
              <code>{collection.options}</code>
            </details>
          )}
        </>
      )}
    </section>
  );
}
