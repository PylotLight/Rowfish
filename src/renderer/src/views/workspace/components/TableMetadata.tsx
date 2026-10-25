import { KeyRound } from "lucide-react";
import type { PostgresTableDetails } from "../../../../../shared/database";

export default function TableMetadata({
  details,
  view,
}: {
  details: PostgresTableDetails;
  view: "structure" | "indexes";
}): React.JSX.Element {
  return (
    <>
      <h3>
        {details.schema}.{details.name}{" "}
        <span className="db-overline">{details.kind}</span>
      </h3>
      {view === "structure" ? (
        <table className="metadata-table">
          <thead>
            <tr>
              <th>Column</th>
              <th>Type</th>
              <th>Nullable</th>
              <th>Default</th>
            </tr>
          </thead>
          <tbody>
            {details.columns.map((column) => (
              <tr key={column.name}>
                <td>
                  {column.isPrimaryKey ? (
                    <span className="metadata-key">
                      <KeyRound size={12} />
                      {column.name}
                    </span>
                  ) : (
                    column.name
                  )}
                </td>
                <td>
                  <code>{column.dataType}</code>
                </td>
                <td>{column.nullable ? "Yes" : "No"}</td>
                <td>
                  <code>{column.defaultValue ?? "—"}</code>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <>
          <h3>Indexes ({details.indexes.length})</h3>
          <table className="metadata-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Definition</th>
                <th>Type</th>
              </tr>
            </thead>
            <tbody>
              {details.indexes.map((index) => (
                <tr key={index.name}>
                  <td>{index.name}</td>
                  <td>
                    <code>{index.definition}</code>
                  </td>
                  <td>
                    {index.primary
                      ? "Primary key"
                      : index.unique
                        ? "Unique"
                        : "Index"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <h3 style={{ marginTop: 22 }}>
            Constraints ({details.constraints.length})
          </h3>
          <table className="metadata-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Type</th>
                <th>Definition</th>
              </tr>
            </thead>
            <tbody>
              {details.constraints.map((constraint) => (
                <tr key={constraint.name}>
                  <td>{constraint.name}</td>
                  <td>{constraint.type}</td>
                  <td>
                    <code>{constraint.definition}</code>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </>
  );
}
