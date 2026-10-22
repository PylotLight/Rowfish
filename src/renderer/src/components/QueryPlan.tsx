import { useState } from "react";
import { ChevronDown, ChevronRight, GitBranch } from "lucide-react";
import { parsePlanResult, type PlanNode } from "../lib/postgres-tools";
import "./postgres-tools.css";

function PlanTree({ node }: { node: PlanNode }): React.JSX.Element {
  const [open, setOpen] = useState(true);
  const subject = [node.schema, node.relation].filter(Boolean).join(".");
  return (
    <li className="pg-plan-node">
      <div className="pg-plan-row">
        {node.children.length ? (
          <button
            type="button"
            aria-label={`${open ? "Collapse" : "Expand"} ${node.nodeType}`}
            aria-expanded={open}
            onClick={() => setOpen(!open)}
          >
            {open ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
          </button>
        ) : (
          <span className="pg-plan-leaf" />
        )}
        <div className="pg-plan-operator">
          <strong>{node.nodeType}</strong>
          {subject && (
            <span>
              {subject}
              {node.alias && node.alias !== node.relation
                ? ` as ${node.alias}`
                : ""}
            </span>
          )}
        </div>
        <span className="pg-plan-metric">
          <small>Cost</small>
          {node.startupCost ?? "?"}…{node.totalCost ?? "?"}
        </span>
        <span className="pg-plan-metric">
          <small>Est. rows</small>
          {node.planRows?.toLocaleString() ?? "?"}
        </span>
      </div>
      {open && node.children.length > 0 && (
        <ul>
          {node.children.map((child, index) => (
            <PlanTree key={`${child.nodeType}-${index}`} node={child} />
          ))}
        </ul>
      )}
    </li>
  );
}

function rawPlanJson(result: unknown): string {
  let document = result;
  if (document && typeof document === "object" && "QUERY PLAN" in document)
    document = document["QUERY PLAN"];
  if (typeof document === "string") {
    const text = document;
    try {
      document = JSON.parse(text);
    } catch {
      return text;
    }
  }
  return JSON.stringify(document, null, 2) ?? "";
}

export default function QueryPlan({
  result,
}: {
  result: unknown;
}): React.JSX.Element {
  const plan = parsePlanResult(result);
  return (
    <section className="pg-query-plan" aria-label="Query execution plan">
      <header className="pg-plan-heading">
        <span className="pg-plan-icon">
          <GitBranch size={20} />
        </span>
        <div>
          <h3>Estimated query plan</h3>
          <p>
            Planner estimates only · no ANALYZE · costs are not milliseconds
          </p>
        </div>
      </header>
      {plan ? (
        <ul className="pg-plan-tree" aria-label="Plan operators">
          <PlanTree node={plan} />
        </ul>
      ) : (
        <p role="status">
          The server plan could not be parsed. Inspect the raw result below;
          very large plan cells may be truncated.
        </p>
      )}
      <details className="pg-plan-raw">
        <summary>Raw EXPLAIN result JSON</summary>
        <pre>{rawPlanJson(result)}</pre>
      </details>
    </section>
  );
}
