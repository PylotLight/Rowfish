export default function SaveQueryDialog({
  open,
  name,
  onNameChange,
  folder,
  onFolderChange,
  onSave,
  onClose,
}: {
  open: boolean;
  name: string;
  onNameChange: (value: string) => void;
  folder: string;
  onFolderChange: (value: string) => void;
  onSave: (title: string) => void;
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
      <form
        className="db-modal compact-modal"
        onClick={(event) => event.stopPropagation()}
        onSubmit={(event) => {
          event.preventDefault();
          const title = name.trim();
          if (!title) return;
          onSave(title);
        }}
        role="dialog"
        aria-modal="true"
        aria-label="Save query"
      >
        <div className="db-modal-head">
          <h2>Save to query library</h2>
          <button type="button" className="db-icon-button" onClick={onClose}>
            ×
          </button>
        </div>
        <label className="save-label">
          Query name
          <input
            autoFocus
            required
            value={name}
            onChange={(event) => onNameChange(event.target.value)}
            maxLength={100}
            placeholder="e.g. Monthly revenue"
          />
        </label>
        <label className="save-label">
          Folder
          <input
            value={folder}
            onChange={(event) => onFolderChange(event.target.value)}
            maxLength={80}
          />
        </label>
        <p className="privacy-note">
          SQL is stored locally, not encrypted. Avoid saving passwords or
          sensitive literals.
        </p>
        <button className="db-run-button" type="submit">
          Save query
        </button>
      </form>
    </div>
  );
}
