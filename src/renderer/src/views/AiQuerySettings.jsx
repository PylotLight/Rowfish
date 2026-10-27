import { useEffect, useState } from "react";
import { Check, KeyRound, LoaderCircle, Sparkles, Trash2 } from "lucide-react";
import "../components/ai-query.css";

const DEFAULT_SETTINGS = {
  endpoint: "https://api.openai.com/v1",
  model: "gpt-4.1-mini",
  enabled: false,
  hasApiKey: false,
  configured: false,
};

export default function AiQuerySettings() {
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [apiKey, setApiKey] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    let active = true;
    window.api.aiQuery
      .getSettings()
      .then((value) => {
        if (active) setSettings(value);
      })
      .catch((reason) => {
        if (active)
          setError(
            reason instanceof Error
              ? reason.message
              : "Could not load AI settings.",
          );
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const save = async (shouldTest = false) => {
    setBusy(shouldTest ? "test" : "save");
    setError("");
    setNotice("");
    try {
      const saved = await window.api.aiQuery.saveSettings({
        endpoint: settings.endpoint,
        model: settings.model,
        enabled: settings.enabled,
        apiKey,
      });
      setSettings(saved);
      setApiKey("");
      if (shouldTest) {
        const result = await window.api.aiQuery.testProvider();
        setNotice(result.message);
      } else {
        setNotice("AI query settings saved on this device.");
      }
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Could not save AI settings.",
      );
    } finally {
      setBusy("");
    }
  };

  const removeKey = async () => {
    setBusy("remove");
    setError("");
    setNotice("");
    try {
      const saved = await window.api.aiQuery.saveSettings({
        endpoint: settings.endpoint,
        model: settings.model,
        enabled: settings.enabled,
        clearApiKey: true,
      });
      setSettings(saved);
      setApiKey("");
      setNotice("Saved API key removed.");
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Could not remove the saved API key.",
      );
    } finally {
      setBusy("");
    }
  };

  if (loading) {
    return (
      <section className="settings-section ai-settings" aria-busy="true">
        <h2>AI query generation</h2>
        <p className="settings-description">Loading provider settings…</p>
      </section>
    );
  }

  return (
    <section className="settings-section ai-settings">
      <div className="ai-settings-heading">
        <span className="ai-feature-icon" aria-hidden="true">
          <Sparkles size={17} />
        </span>
        <div>
          <h2>AI query generation</h2>
          <p className="settings-description">
            Connect an OpenAI-compatible model to draft MongoDB filters and
            aggregation pipelines.
          </p>
        </div>
      </div>

      <div className="ai-privacy-note">
        <KeyRound size={15} aria-hidden="true" />
        <p>
          Rowfish sends requests only when you ask it to generate a query or
          explicitly choose Save &amp; test. Your prompt and schema metadata
          (database and collection names, field paths, and index definitions) go
          directly to this provider. Documents, sampled field values, database
          credentials, and your MongoDB URI are not sent. Your provider may
          retain requests or bill usage under its own policies; review those
          policies before enabling the connector.
        </p>
      </div>

      <label className="ai-enable-row">
        <span>
          <strong>Enable AI query generation</strong>
          <small>
            Off by default. Query generation stays disabled until you save this
            setting.
          </small>
        </span>
        <input
          type="checkbox"
          checked={settings.enabled}
          onChange={(event) =>
            setSettings((current) => ({
              ...current,
              enabled: event.target.checked,
            }))
          }
          aria-label="Enable AI query generation"
        />
      </label>

      <div className="ai-settings-fields">
        <label className="ai-settings-label">
          Provider endpoint
          <input
            type="url"
            value={settings.endpoint}
            onChange={(event) =>
              setSettings((current) => ({
                ...current,
                endpoint: event.target.value,
              }))
            }
            placeholder="https://api.openai.com/v1"
            autoComplete="url"
            spellCheck={false}
          />
          <small>
            Use a compatible /chat/completions API. Remote endpoints must use
            HTTPS; HTTP is limited to localhost.
          </small>
        </label>
        <label className="ai-settings-label">
          Model
          <input
            type="text"
            value={settings.model}
            onChange={(event) =>
              setSettings((current) => ({
                ...current,
                model: event.target.value,
              }))
            }
            placeholder="gpt-4.1-mini"
            autoComplete="off"
            spellCheck={false}
          />
        </label>
        <label className="ai-settings-label">
          API key{" "}
          <span className="ai-optional">(optional for local providers)</span>
          <input
            type="password"
            value={apiKey}
            onChange={(event) => setApiKey(event.target.value)}
            placeholder={
              settings.hasApiKey
                ? "A key is saved securely — leave blank to keep it"
                : "Enter provider API key"
            }
            autoComplete="new-password"
            spellCheck={false}
          />
          <small>
            Saved with the operating-system credential store. The key is never
            exposed to the query editor.
          </small>
        </label>
      </div>

      <div className="ai-settings-status" role="status">
        <span
          className={`ai-status-dot${settings.configured ? " ready" : ""}`}
          aria-hidden="true"
        />
        {settings.configured
          ? "Enabled and ready"
          : settings.enabled
            ? "Add a key for this remote endpoint, or use a local endpoint"
            : "Disabled"}
      </div>

      {error && (
        <p className="ai-settings-message error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="ai-settings-message success" role="status">
          <Check size={14} /> {notice}
        </p>
      )}

      <div className="ai-settings-actions">
        <button
          type="button"
          className="ai-primary-button"
          disabled={Boolean(busy)}
          onClick={() => void save(false)}
        >
          {busy === "save" ? (
            <LoaderCircle className="ai-spinner" size={14} />
          ) : null}
          Save settings
        </button>
        <button
          type="button"
          className="ai-secondary-button"
          disabled={Boolean(busy)}
          onClick={() => void save(true)}
        >
          {busy === "test" ? (
            <LoaderCircle className="ai-spinner" size={14} />
          ) : null}
          Save &amp; test
        </button>
        {settings.hasApiKey && (
          <button
            type="button"
            className="ai-danger-button"
            disabled={Boolean(busy)}
            onClick={() => void removeKey()}
          >
            {busy === "remove" ? (
              <LoaderCircle className="ai-spinner" size={14} />
            ) : (
              <Trash2 size={14} />
            )}
            Remove saved key
          </button>
        )}
      </div>
    </section>
  );
}
