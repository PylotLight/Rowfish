import { Copy, Eye, EyeOff } from "lucide-react";
import type { Dispatch, SetStateAction } from "react";
import type {
  DatabaseConnectionInput,
  PostgresSslMode,
} from "../../../../../shared/database";
import {
  POSTGRES_SSL_MODES,
  resolvePostgresSslMode,
  sslModeEncrypts,
  maskConnectionStringPassword,
} from "../../../../../shared/database-helpers";
import { kindDefaults, kindLabel } from "../workspace-helpers";

/**
 * The connect / edit-saved-connection dialog. Presentational: the workspace
 * owns the form state and the connect/test/save handlers; this component
 * renders the dialog and reports interactions back through its props.
 */
export default function ConnectionDialog({
  form,
  onFormChange,
  onUpdateForm,
  onTestFailureChange,
  uriMode,
  onSwitchMode,
  detectedKind,
  revealUri,
  onRevealUriChange,
  uriCopied,
  onCopyConnectionString,
  onConnectionStringChange,
  onChooseSqliteFile,
  connectionStringStatus,
  generatedConnectionString,
  saveProfile,
  onSaveProfileChange,
  editingProfileId,
  testFailure,
  onSaveWithoutTesting,
  saveBusy,
  connectionError,
  connectBusy,
  connecting,
  onConnect,
  onTestAndSave,
  onClose,
  connectionStringBlocked,
}: {
  form: DatabaseConnectionInput;
  onFormChange: Dispatch<SetStateAction<DatabaseConnectionInput>>;
  onUpdateForm: <K extends keyof DatabaseConnectionInput>(
    key: K,
    value: DatabaseConnectionInput[K],
  ) => void;
  onTestFailureChange: (value: string) => void;
  uriMode: boolean;
  onSwitchMode: (useString: boolean) => void;
  detectedKind: DatabaseConnectionInput["kind"] | null;
  revealUri: boolean;
  onRevealUriChange: (value: boolean) => void;
  uriCopied: boolean;
  onCopyConnectionString: (value: string) => void;
  /** The parent's URI handler: kind detection plus field parsing. */
  onConnectionStringChange: (value: string) => void;
  onChooseSqliteFile: () => void;
  connectionStringStatus: { text: string; error: boolean } | null;
  generatedConnectionString: string;
  saveProfile: boolean;
  onSaveProfileChange: (value: boolean) => void;
  editingProfileId: string | null;
  testFailure: string;
  onSaveWithoutTesting: (source: "save" | "anyway") => void;
  saveBusy: "" | "test" | "save" | "anyway";
  connectionError: string;
  connectBusy: boolean;
  connecting: boolean;
  onConnect: () => void;
  onTestAndSave: () => void;
  onClose: () => void;
  connectionStringBlocked: boolean;
}): React.JSX.Element {
  return (
    <div
      className="db-modal-backdrop"
      onMouseDown={(event) => {
        if (event.target !== event.currentTarget) return;
        if (!connectBusy) onClose();
      }}
    >
      <div
        className="db-connect-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="db-connect-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="db-modal-head">
          <div>
            <span className="db-overline">
              {editingProfileId ? "SAVED CONNECTION" : "NEW DATA SOURCE"}
            </span>
            <h2 id="db-connect-title">
              {editingProfileId ? "Edit connection" : "Connect a database"}
            </h2>
          </div>
          <button
            className="db-icon-button"
            aria-label="Close"
            disabled={connectBusy}
            onClick={onClose}
          >
            ×
          </button>
        </div>
        <p className="db-modal-copy">
          Saved connection details stay on this computer. Passwords are
          encrypted with the operating system credential store.
        </p>
        <div className="db-form-grid">
          <label className="db-form-field full">
            <span>Connection name</span>
            <input
              value={form.name}
              onChange={(event) => onUpdateForm("name", event.target.value)}
              maxLength={80}
              autoFocus
            />
          </label>
          <div
            className="db-connect-mode full"
            role="radiogroup"
            aria-label="How to connect"
          >
            {(
              [
                [true, "Connection string"],
                [false, "Manual"],
              ] as const
            ).map(([useString, label]) => (
              <button
                key={label}
                type="button"
                role="radio"
                aria-checked={uriMode === useString}
                className={uriMode === useString ? "active" : undefined}
                disabled={connectBusy || (useString && form.kind === "sqlite")}
                onClick={() => onSwitchMode(useString)}
              >
                {label}
              </button>
            ))}
          </div>
          {uriMode ? (
            <div className="db-form-field full">
              <div className="db-uri-label-row">
                <label htmlFor="db-connection-string">Connection string</label>
                <span
                  className={`db-kind-badge${detectedKind ? ` ${detectedKind}` : " unknown"}`}
                  aria-live="polite"
                  data-testid="detected-kind"
                >
                  {detectedKind
                    ? `Detected: ${kindLabel(detectedKind)}`
                    : "Type not detected"}
                </span>
              </div>
              <div className="db-uri-input-row">
                <input
                  id="db-connection-string"
                  type={revealUri ? "text" : "password"}
                  value={form.connectionString ?? ""}
                  onChange={(event) =>
                    onConnectionStringChange(event.target.value)
                  }
                  placeholder="postgresql://user:password@host:5432/db or mongodb+srv://…"
                  autoComplete="off"
                  spellCheck={false}
                />
                <button
                  type="button"
                  className="db-icon-button"
                  aria-label={
                    revealUri
                      ? "Hide connection string"
                      : "Show connection string"
                  }
                  title={revealUri ? "Hide" : "Show"}
                  onClick={() => onRevealUriChange(!revealUri)}
                >
                  {revealUri ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
                <button
                  type="button"
                  className="db-icon-button"
                  aria-label="Copy connection string"
                  title={uriCopied ? "Copied" : "Copy"}
                  disabled={!form.connectionString?.trim()}
                  onClick={() =>
                    onCopyConnectionString((form.connectionString ?? "").trim())
                  }
                >
                  <Copy size={14} />
                </button>
              </div>
              {connectionStringStatus && (
                <small
                  className={`db-uri-hint${connectionStringStatus.error ? " error" : ""}`}
                  role={connectionStringStatus.error ? "alert" : undefined}
                >
                  {connectionStringStatus.text}
                </small>
              )}
            </div>
          ) : (
            <>
              <label className="db-form-field">
                <span>Database type</span>
                <select
                  value={form.kind}
                  onChange={(event) => {
                    const kind = event.target
                      .value as DatabaseConnectionInput["kind"];
                    onTestFailureChange("");
                    onFormChange((current) => ({
                      ...current,
                      ...kindDefaults(kind),
                      kind,
                      serverMode: false,
                      connectionString: "",
                    }));
                  }}
                >
                  <option value="postgres">PostgreSQL</option>
                  <option value="mongodb">MongoDB</option>
                  <option value="sqlite">SQLite</option>
                </select>
              </label>
              {form.kind !== "sqlite" && (
                <>
                  <label className="db-form-field">
                    <span>Host</span>
                    <input
                      value={form.host}
                      onChange={(event) =>
                        onUpdateForm("host", event.target.value)
                      }
                      placeholder="localhost"
                      autoComplete="off"
                    />
                  </label>
                  <label className="db-form-field">
                    <span>Port</span>
                    <input
                      type="number"
                      min={1}
                      max={65535}
                      value={form.port}
                      onChange={(event) =>
                        onUpdateForm("port", Number(event.target.value))
                      }
                    />
                  </label>
                </>
              )}
              {form.kind === "postgres" && (
                <label className="db-form-field">
                  <span>
                    Database{" "}
                    {form.serverMode && (
                      <small>not required for server browser</small>
                    )}
                  </span>
                  <input
                    value={form.serverMode ? "" : form.database}
                    onChange={(event) =>
                      onUpdateForm("database", event.target.value)
                    }
                    placeholder={
                      form.serverMode
                        ? "Browse all accessible databases"
                        : "Database name"
                    }
                    disabled={form.serverMode}
                    autoComplete="off"
                  />
                </label>
              )}
              {form.kind === "mongodb" && (
                <label className="db-form-field">
                  <span>Database</span>
                  <input
                    value={form.database}
                    onChange={(event) =>
                      onUpdateForm("database", event.target.value)
                    }
                    autoComplete="off"
                  />
                </label>
              )}
              {form.kind === "sqlite" && (
                <div className="db-form-field full">
                  <label htmlFor="sqlite-database-file">
                    SQLite database file
                  </label>
                  <div className="db-uri-input-row">
                    <input
                      id="sqlite-database-file"
                      value={form.database}
                      onChange={(event) =>
                        onUpdateForm("database", event.target.value)
                      }
                      placeholder="Choose an existing .db or .sqlite file"
                      autoComplete="off"
                    />
                    <button
                      type="button"
                      className="db-quiet-button"
                      disabled={connectBusy}
                      onClick={onChooseSqliteFile}
                    >
                      Browse…
                    </button>
                  </div>
                  <small>
                    Opens a local database file; SQL changes affect that file
                    directly.
                  </small>
                </div>
              )}
              {!uriMode && form.kind !== "sqlite" && (
                <label className="db-form-field">
                  <span>
                    Username <small>optional</small>
                  </span>
                  <input
                    value={form.username}
                    onChange={(event) =>
                      onUpdateForm("username", event.target.value)
                    }
                    autoComplete="username"
                  />
                </label>
              )}
              {!uriMode && form.kind !== "sqlite" && (
                <label className="db-form-field">
                  <span>
                    Password <small>optional</small>
                  </span>
                  <input
                    type="password"
                    value={form.password}
                    onChange={(event) =>
                      onUpdateForm("password", event.target.value)
                    }
                    autoComplete="new-password"
                  />
                </label>
              )}
              {form.kind === "postgres" && (
                <label className="db-form-field">
                  <span>
                    SSL mode{" "}
                    <small>
                      {
                        POSTGRES_SSL_MODES.find(
                          (mode) => mode.value === resolvePostgresSslMode(form),
                        )?.hint
                      }
                    </small>
                  </span>
                  <select
                    aria-label="SSL mode"
                    value={resolvePostgresSslMode(form)}
                    onChange={(event) => {
                      const sslMode = event.target.value as PostgresSslMode;
                      onTestFailureChange("");
                      onFormChange((current) => ({
                        ...current,
                        sslMode,
                        tls: sslModeEncrypts(sslMode),
                      }));
                    }}
                  >
                    {POSTGRES_SSL_MODES.map((mode) => (
                      <option key={mode.value} value={mode.value}>
                        {mode.label}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {form.kind !== "sqlite" && (
                <div className="db-form-field full">
                  <span>
                    Connection string <small>updates as you type</small>
                  </span>
                  <div className="db-uri-input-row">
                    <code
                      className="db-uri-preview"
                      aria-label="Generated connection string, password hidden"
                    >
                      {maskConnectionStringPassword(generatedConnectionString)}
                    </code>
                    <button
                      type="button"
                      className="db-icon-button"
                      aria-label="Copy connection string"
                      title={uriCopied ? "Copied" : "Copy"}
                      onClick={() =>
                        onCopyConnectionString(generatedConnectionString)
                      }
                    >
                      <Copy size={14} />
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
        {form.kind === "postgres" && (
          <label className="db-tls-toggle">
            <input
              type="checkbox"
              checked={form.serverMode}
              onChange={(event) =>
                onUpdateForm("serverMode", event.target.checked)
              }
            />
            <span>
              <b>Browse all databases on this server</b>
              <small>
                Uses the postgres maintenance database and lists databases this
                user can connect to. It does not grant additional access.
              </small>
            </span>
          </label>
        )}
        {!uriMode && form.kind === "mongodb" && (
          <label className="db-tls-toggle">
            <input
              type="checkbox"
              checked={form.tls}
              onChange={(event) => onUpdateForm("tls", event.target.checked)}
            />
            <span>
              <b>Require TLS</b>
              <small>Verify the server certificate</small>
            </span>
          </label>
        )}
        {!editingProfileId && (
          <label className="db-tls-toggle">
            <input
              type="checkbox"
              checked={saveProfile}
              onChange={(event) => onSaveProfileChange(event.target.checked)}
            />
            <span>
              <b>Save this connection</b>
              <small>When connecting, keep it between app sessions</small>
            </span>
          </label>
        )}
        {testFailure && (
          <div className="db-query-error" role="alert">
            Test failed: {testFailure}
            <div className="db-save-anyway">
              <span>Save it anyway and connect when the server is up.</span>
              <button
                type="button"
                className="db-quiet-button"
                disabled={connectBusy}
                onClick={() => onSaveWithoutTesting("anyway")}
              >
                {saveBusy === "anyway" ? (
                  <>
                    <span className="db-spinner small" /> Saving…
                  </>
                ) : (
                  "Save anyway"
                )}
              </button>
            </div>
          </div>
        )}
        {connectionError && (
          <div className="db-query-error" role="alert">
            {connectionError}
          </div>
        )}
        <div className="db-modal-actions">
          {!editingProfileId && (
            <button
              type="button"
              className="db-quiet-button db-save-untested"
              title="Save the profile without connecting"
              disabled={connectBusy || connectionStringBlocked}
              onClick={() => onSaveWithoutTesting("save")}
            >
              {saveBusy === "save" ? (
                <>
                  <span className="db-spinner small" /> Saving…
                </>
              ) : (
                "Save without testing"
              )}
            </button>
          )}
          <button
            className="db-quiet-button"
            disabled={connectBusy}
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            type="button"
            className="db-quiet-button"
            title="Test the connection, then save it"
            disabled={connectBusy || connectionStringBlocked}
            onClick={onTestAndSave}
          >
            {saveBusy === "test" ? (
              <>
                <span className="db-spinner small" /> Testing…
              </>
            ) : (
              "Test & Save"
            )}
          </button>
          {editingProfileId ? (
            <button
              className="db-run-button"
              disabled={connectBusy || connectionStringBlocked}
              onClick={() => onSaveWithoutTesting("save")}
            >
              {saveBusy === "save" ? (
                <>
                  <span className="db-spinner small" /> Saving…
                </>
              ) : (
                "Save"
              )}
            </button>
          ) : (
            <button
              className="db-run-button"
              disabled={connectBusy || connectionStringBlocked}
              onClick={onConnect}
            >
              {connecting ? (
                <>
                  <span className="db-spinner small" /> Connecting…
                </>
              ) : (
                "Connect"
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
