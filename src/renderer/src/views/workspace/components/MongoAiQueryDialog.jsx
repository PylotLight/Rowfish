import { useEffect, useState } from "react";
import {
  AlertTriangle,
  Check,
  KeyRound,
  LoaderCircle,
  Sparkles,
  X,
} from "lucide-react";
import "../../../components/ai-query.css";

export default function MongoAiQueryDialog({
  connectionId,
  database,
  collection,
  initialMode,
  onClose,
  onApply,
  onOpenSettings,
}) {
  const [settings, setSettings] = useState(null);
  const [settingsError, setSettingsError] = useState("");
  const [mode, setMode] = useState(
    initialMode === "aggregate" ? "aggregate" : "find",
  );
  const [prompt, setPrompt] = useState("");
  const [consented, setConsented] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);

  useEffect(() => {
    let active = true;
    window.api.aiQuery
      .getSettings()
      .then((value) => {
        if (active) setSettings(value);
      })
      .catch((reason) => {
        if (active)
          setSettingsError(
            reason instanceof Error
              ? reason.message
              : "Could not read AI settings.",
          );
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key === "Escape" && !busy) onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [busy, onClose]);

  const generate = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    setResult(null);
    try {
      const generated = await window.api.aiQuery.generateMongoQuery({
        connectionId,
        database,
        collection,
        prompt,
        mode,
      });
      setResult(generated);
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Could not generate a MongoDB query.",
      );
    } finally {
      setBusy(false);
    }
  };

  const apply = () => {
    if (result) onApply(result);
  };

  return (
    <div className="ai-dialog-scrim">
      <section
        className="ai-query-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="ai-query-title"
      >
        <header className="ai-query-dialog-header">
          <span className="ai-feature-icon">
            <Sparkles size={17} aria-hidden="true" />
          </span>
          <div>
            <h2 id="ai-query-title">Generate MongoDB query</h2>
            <p>
              {database} <span aria-hidden="true">›</span> {collection}
            </p>
          </div>
          <button
            type="button"
            className="ai-dialog-close"
            disabled={busy}
            onClick={onClose}
            aria-label="Close query generator"
            title="Close"
          >
            <X size={17} />
          </button>
        </header>

        {result ? (
          <div className="ai-query-preview">
            <div className="ai-preview-heading">
              <div>
                <span className="ai-preview-eyebrow">
                  {result.mode === "aggregate"
                    ? "AGGREGATION PIPELINE"
                    : "FIND FILTER"}
                </span>
                <h3>Review before using</h3>
              </div>
              <span className="ai-preview-check">
                <Check size={14} /> Validated
              </span>
            </div>
            {result.explanation && (
              <p className="ai-preview-explanation">{result.explanation}</p>
            )}
            <pre className="ai-query-code">
              <code>{result.query}</code>
            </pre>
            <p className="ai-preview-warning">
              <AlertTriangle size={14} /> This only inserts the draft into the
              editor. Rowfish will not run it automatically.
            </p>
            <footer className="ai-dialog-actions">
              <button
                type="button"
                className="ai-secondary-button"
                onClick={() => {
                  setResult(null);
                  setError("");
                }}
              >
                Generate another
              </button>
              <button
                type="button"
                className="ai-primary-button"
                onClick={apply}
              >
                Use {result.mode === "aggregate" ? "pipeline" : "filter"}
              </button>
            </footer>
          </div>
        ) : settingsError ? (
          <div className="ai-dialog-body">
            <p className="ai-settings-message error" role="alert">
              {settingsError}
            </p>
            <footer className="ai-dialog-actions">
              <button
                type="button"
                className="ai-secondary-button"
                onClick={onClose}
              >
                Close
              </button>
            </footer>
          </div>
        ) : !settings ? (
          <div className="ai-dialog-loading">
            <LoaderCircle className="ai-spinner" size={18} /> Loading provider
            settings…
          </div>
        ) : !settings.configured ? (
          <div className="ai-dialog-body">
            <div className="ai-not-configured">
              <span className="ai-feature-icon">
                <Sparkles size={17} />
              </span>
              <h3>
                {settings.enabled
                  ? "Add a key for this provider"
                  : "Set up your provider first"}
              </h3>
              <p>
                {settings.enabled
                  ? "This remote endpoint needs an API key before Rowfish can generate queries. You can add one or choose a local endpoint in Settings."
                  : "AI query generation is off until you enable a provider in Settings. Rowfish does not ship with an AI service or send requests in the background."}
              </p>
            </div>
            <footer className="ai-dialog-actions">
              <button
                type="button"
                className="ai-secondary-button"
                onClick={onClose}
              >
                Not now
              </button>
              <button
                type="button"
                className="ai-primary-button"
                onClick={onOpenSettings}
              >
                Open AI settings
              </button>
            </footer>
          </div>
        ) : (
          <form className="ai-dialog-body" onSubmit={generate}>
            <label className="ai-mode-label">
              Query type
              <span
                className="ai-mode-choice"
                role="radiogroup"
                aria-label="MongoDB query type"
              >
                <button
                  type="button"
                  role="radio"
                  aria-checked={mode === "find"}
                  className={mode === "find" ? "selected" : ""}
                  onClick={() => {
                    setMode("find");
                    setResult(null);
                  }}
                >
                  Find filter
                </button>
                <button
                  type="button"
                  role="radio"
                  aria-checked={mode === "aggregate"}
                  className={mode === "aggregate" ? "selected" : ""}
                  onClick={() => {
                    setMode("aggregate");
                    setResult(null);
                  }}
                >
                  Aggregation
                </button>
              </span>
            </label>
            <label className="ai-prompt-label" htmlFor="ai-query-prompt">
              What should this query find or calculate?
            </label>
            <textarea
              id="ai-query-prompt"
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              maxLength={3000}
              placeholder={
                mode === "find"
                  ? "e.g. Find paid orders over $100 from this month"
                  : "e.g. Group orders by status and show count and average total"
              }
              autoFocus
              required
            />
            <div className="ai-prompt-count">{prompt.length}/3,000</div>
            <div className="ai-data-disclosure">
              <div className="ai-disclosure-title">
                <KeyRound size={13} aria-hidden="true" /> Sent to{" "}
                {settings.endpoint}
              </div>
              <p>
                Only your prompt, database and collection names, field paths,
                and index definitions. No documents, sampled field values,
                database credentials, or MongoDB URI. The provider may retain
                requests or bill usage under its own policies.
              </p>
              <label className="ai-consent-row">
                <input
                  type="checkbox"
                  checked={consented}
                  onChange={(event) => setConsented(event.target.checked)}
                />
                <span>
                  I agree to send this prompt and schema metadata to the
                  configured provider.
                </span>
              </label>
            </div>
            {error && (
              <p className="ai-settings-message error" role="alert">
                {error}
              </p>
            )}
            <footer className="ai-dialog-actions">
              <button
                type="button"
                className="ai-secondary-button"
                disabled={busy}
                onClick={onClose}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="ai-primary-button"
                disabled={busy || !prompt.trim() || !consented}
              >
                {busy ? (
                  <LoaderCircle className="ai-spinner" size={14} />
                ) : (
                  <Sparkles size={14} />
                )}
                {busy ? "Generating preview…" : "Generate preview"}
              </button>
            </footer>
          </form>
        )}
      </section>
    </div>
  );
}
