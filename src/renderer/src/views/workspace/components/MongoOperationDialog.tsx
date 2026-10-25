import { useState } from "react";
import type {
  DatabaseConnectionSummary,
  MongoBrowserCollection,
} from "../../../../../shared/database";
import type { MongoOperation } from "../workspace-helpers";

/** The dialog's form fields, handed to the workspace on submit. */
export interface MongoOperationFields {
  document: string;
  filter: string;
  update: string;
  many: boolean;
  upsert: boolean;
  indexKeys: string;
  uniqueIndex: boolean;
  indexName: string;
  collectionName: string;
  databaseName: string;
  createNewDatabase: boolean;
  confirmName: string;
  deleteConfirmed: boolean;
}

const OPERATION_TITLES: Record<MongoOperation, string> = {
  insert: "Insert document",
  update: "Update documents",
  delete: "Delete documents",
  "create-collection": "Create collection",
  "drop-collection": "Drop collection",
  "create-index": "Create index",
  "drop-index": "Drop index",
  "drop-database": "Drop database",
};

export default function MongoOperationDialog({
  operation,
  connection,
  activeDatabase,
  selectedDatabase,
  selectedCollection,
  fallbackCollection,
  prefill,
  busy,
  error,
  summary,
  onSubmit,
  onClose,
}: {
  operation: MongoOperation;
  /** The connection the operation was opened against. */
  connection: DatabaseConnectionSummary;
  /** The active connection's database, for display fallbacks. */
  activeDatabase: string;
  selectedDatabase: string;
  selectedCollection: MongoBrowserCollection | null;
  /** The active query's collection, for display fallbacks. */
  fallbackCollection: string;
  /** Field values the opener pre-filled over the open-time defaults. */
  prefill: Partial<MongoOperationFields>;
  busy: boolean;
  error: string;
  summary: string;
  onSubmit: (fields: MongoOperationFields) => void;
  onClose: () => void;
}): React.JSX.Element {
  // The workspace remounts this dialog (via key) each time an operation
  // opens, so these initial values are the open-time defaults with any
  // pre-filled fields applied.
  const [document, setDocument] = useState(prefill.document ?? "{}");
  const [filter, setFilter] = useState(prefill.filter ?? "");
  const [update, setUpdate] = useState(prefill.update ?? '{"$set":{}}');
  const [many, setMany] = useState(prefill.many ?? false);
  const [upsert, setUpsert] = useState(prefill.upsert ?? false);
  const [indexKeys, setIndexKeys] = useState(
    prefill.indexKeys ?? '{"field":1}',
  );
  const [uniqueIndex, setUniqueIndex] = useState(prefill.uniqueIndex ?? false);
  const [indexName, setIndexName] = useState(prefill.indexName ?? "");
  const [collectionName, setCollectionName] = useState(
    prefill.collectionName ??
      (operation === "drop-collection" ? (selectedCollection?.name ?? "") : ""),
  );
  const [databaseName, setDatabaseName] = useState(
    prefill.databaseName ?? (selectedDatabase || connection.database),
  );
  const [createNewDatabase, setCreateNewDatabase] = useState(
    prefill.createNewDatabase ?? false,
  );
  const [confirmName, setConfirmName] = useState(prefill.confirmName ?? "");
  const [deleteConfirmed, setDeleteConfirmed] = useState(
    prefill.deleteConfirmed ?? false,
  );

  function submit(): void {
    onSubmit({
      document,
      filter,
      update,
      many,
      upsert,
      indexKeys,
      uniqueIndex,
      indexName,
      collectionName,
      databaseName,
      createNewDatabase,
      confirmName,
      deleteConfirmed,
    });
  }

  return (
    <div
      className="db-modal-backdrop"
      onMouseDown={(event) => {
        if (event.target !== event.currentTarget) return;
        if (!busy) onClose();
      }}
    >
      <div
        className="db-connect-modal db-mongo-operation-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="mongo-operation-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="db-modal-head">
          <div>
            <span className="db-overline">MONGODB OPERATION</span>
            <h2 id="mongo-operation-title">{OPERATION_TITLES[operation]}</h2>
          </div>
          <button
            className="db-icon-button"
            aria-label="Close"
            disabled={busy}
            onClick={onClose}
          >
            ×
          </button>
        </div>
        <div className="db-mongo-operation-context">
          {operation === "create-collection" ? (
            <label className="db-form-field">
              <span>Database</span>
              <input
                value={databaseName}
                onChange={(event) => setDatabaseName(event.target.value)}
                maxLength={128}
              />
            </label>
          ) : (
            <div>
              <span>Database</span>
              <b>{databaseName || selectedDatabase || activeDatabase}</b>
            </div>
          )}
          {operation === "create-collection" ||
          operation === "drop-collection" ? (
            <label className="db-form-field">
              <span>Collection name</span>
              <input
                value={collectionName}
                onChange={(event) => setCollectionName(event.target.value)}
                maxLength={128}
                autoFocus
              />
            </label>
          ) : (
            operation !== "drop-database" && (
              <div>
                <span>Collection</span>
                <b>{selectedCollection?.name ?? fallbackCollection}</b>
              </div>
            )
          )}
        </div>
        {operation === "create-collection" && (
          <p className="db-modal-copy">
            A new database is created automatically when its first collection is
            created.
          </p>
        )}
        {operation === "insert" && (
          <label className="db-form-field">
            <span>Document (JSON / Extended JSON)</span>
            <textarea
              className="db-operation-json"
              rows={10}
              value={document}
              onChange={(event) => setDocument(event.target.value)}
              spellCheck={false}
            />
          </label>
        )}
        {(operation === "update" || operation === "delete") && (
          <>
            <label className="db-form-field">
              <span>Match filter (JSON)</span>
              <textarea
                className="db-operation-json"
                rows={5}
                value={filter}
                onChange={(event) => setFilter(event.target.value)}
                spellCheck={false}
                placeholder={'{ "_id": { "$oid": "..." } }'}
              />
            </label>
            {operation === "update" && (
              <label className="db-form-field">
                <span>Update operators (JSON)</span>
                <textarea
                  className="db-operation-json"
                  rows={5}
                  value={update}
                  onChange={(event) => setUpdate(event.target.value)}
                  spellCheck={false}
                  placeholder={'{ "$set": { "status": "ready" } }'}
                />
              </label>
            )}
            <div className="db-mongo-option-row">
              <label className="db-tls-toggle">
                <input
                  type="checkbox"
                  checked={many}
                  onChange={(event) => setMany(event.target.checked)}
                />
                <span>
                  <b>
                    {operation === "delete"
                      ? "Delete all matches"
                      : "Update all matches"}
                  </b>
                </span>
              </label>
              {operation === "update" && (
                <label className="db-tls-toggle">
                  <input
                    type="checkbox"
                    checked={upsert}
                    onChange={(event) => setUpsert(event.target.checked)}
                  />
                  <span>
                    <b>Upsert if none match</b>
                  </span>
                </label>
              )}
            </div>
            {operation === "delete" && (
              <label className="db-tls-toggle db-destructive-confirm">
                <input
                  type="checkbox"
                  checked={deleteConfirmed}
                  onChange={(event) => setDeleteConfirmed(event.target.checked)}
                />
                <span>
                  <b>
                    I reviewed the filter and want to delete matching documents.
                  </b>
                </span>
              </label>
            )}
          </>
        )}
        {operation === "create-index" && (
          <>
            <label className="db-form-field">
              <span>Index keys (JSON)</span>
              <textarea
                className="db-operation-json"
                rows={4}
                value={indexKeys}
                onChange={(event) => setIndexKeys(event.target.value)}
                spellCheck={false}
                placeholder={'{ "createdAt": -1 }'}
              />
            </label>
            <label className="db-tls-toggle">
              <input
                type="checkbox"
                checked={uniqueIndex}
                onChange={(event) => setUniqueIndex(event.target.checked)}
              />
              <span>
                <b>Unique index</b>
              </span>
            </label>
          </>
        )}
        {operation === "drop-index" && (
          <>
            <label className="db-form-field">
              <span>Index name</span>
              <input
                value={indexName}
                onChange={(event) => setIndexName(event.target.value)}
                maxLength={128}
                autoFocus
              />
            </label>
            <label className="db-tls-toggle db-destructive-confirm">
              <input
                type="checkbox"
                checked={deleteConfirmed}
                onChange={(event) => setDeleteConfirmed(event.target.checked)}
              />
              <span>
                <b>Queries relying on this index may slow down. Drop it.</b>
              </span>
            </label>
          </>
        )}
        {(operation === "drop-collection" || operation === "drop-database") && (
          <>
            <p className="db-query-error">
              This permanently drops{" "}
              {operation === "drop-database"
                ? "the database and all its collections"
                : "the collection and all its documents"}
              .
            </p>
            <label className="db-form-field">
              <span>
                Type{" "}
                {operation === "drop-database"
                  ? databaseName || selectedDatabase || activeDatabase
                  : collectionName}{" "}
                to confirm
              </span>
              <input
                value={confirmName}
                onChange={(event) => setConfirmName(event.target.value)}
                autoComplete="off"
              />
            </label>
          </>
        )}
        {error && (
          <div className="db-query-error" role="alert">
            {error}
          </div>
        )}
        {summary && <p className="db-results-summary">{summary}</p>}
        <div className="db-modal-actions">
          <button className="db-quiet-button" disabled={busy} onClick={onClose}>
            Cancel
          </button>
          <button
            className={
              operation === "delete" ||
              operation === "drop-collection" ||
              operation === "drop-database" ||
              operation === "drop-index"
                ? "db-cancel-button"
                : "db-run-button"
            }
            disabled={
              busy ||
              (operation === "create-collection" &&
                (!collectionName.trim() ||
                  (createNewDatabase && !databaseName.trim()))) ||
              (operation === "delete" &&
                (!filter.trim() ||
                  filter.trim() === "{}" ||
                  !deleteConfirmed)) ||
              (operation === "update" &&
                (!filter.trim() || filter.trim() === "{}")) ||
              (operation === "create-index" && !indexKeys.trim()) ||
              (operation === "drop-index" &&
                (!indexName.trim() || !deleteConfirmed)) ||
              (operation === "drop-collection" &&
                confirmName !== collectionName) ||
              (operation === "drop-database" &&
                confirmName !==
                  (databaseName || selectedDatabase || activeDatabase))
            }
            onClick={submit}
          >
            {busy
              ? "Working…"
              : operation === "delete" ||
                  operation === "drop-collection" ||
                  operation === "drop-database"
                ? "Confirm destructive action"
                : "Run operation"}
          </button>
        </div>
      </div>
    </div>
  );
}
