export default function HelpDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}): React.JSX.Element | null {
  if (!open) return null;
  return (
    <div
      className="db-modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        className="db-modal compact-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Keyboard shortcuts"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="db-modal-head">
          <h2>Work a little faster</h2>
          <button className="db-icon-button" onClick={onClose}>
            ×
          </button>
        </div>
        <dl className="shortcut-list">
          <dt>Run selection / current statement</dt>
          <dd>Ctrl / ⌘ Enter</dd>
          <dt>Run entire editor</dt>
          <dd>Ctrl / ⌘ Shift Enter</dd>
          <dt>Save query to library</dt>
          <dd>Ctrl / ⌘ S</dd>
          <dt>New query tab</dt>
          <dd>Ctrl / ⌘ T</dd>
          <dt>Autocomplete</dt>
          <dd>Ctrl Space</dd>
          <dt>Format SQL</dt>
          <dd>Ctrl / ⌘ Shift F</dd>
          <dt>Inspect a result row</dt>
          <dd>Click row / Enter on focused row</dd>
        </dl>
        <p className="privacy-note">
          Drafts and query history stay on this device. Queries execute with the
          database user’s permissions. Use caution with writes; Rowfish does not
          automatically roll them back.
        </p>
      </section>
    </div>
  );
}
