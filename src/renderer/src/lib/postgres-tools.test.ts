import { describe, expect, test } from "bun:test";
import {
  buildExplainQuery,
  parsePlanResult,
  postgresDiagnostics,
} from "./postgres-tools";

describe("PostgreSQL tools", () => {
  test("wraps one supported query in plain JSON EXPLAIN, never ANALYZE", () => {
    expect(buildExplainQuery("SELECT * FROM widgets;")).toBe(
      "EXPLAIN (FORMAT JSON) SELECT * FROM widgets",
    );
    expect(() => buildExplainQuery("SELECT 1; SELECT 2")).toThrow(
      /exactly one/,
    );
    expect(() => buildExplainQuery("EXPLAIN ANALYZE SELECT 1")).toThrow();
    expect(() => buildExplainQuery("CREATE TABLE x AS SELECT 1")).toThrow();
    expect(() => buildExplainQuery("EXECUTE dangerous()")).toThrow();
  });
  test("preserves quoted semicolons and rejects unsupported or incomplete SQL", () => {
    expect(
      buildExplainQuery("-- inspect only\nSELECT ';' AS literal;"),
    ).toContain("SELECT ';' AS literal");
    expect(() => buildExplainQuery("DELETE FROM widgets")).toThrow();
    expect(() =>
      buildExplainQuery("EXPLAIN (ANALYZE true) SELECT 1"),
    ).toThrow();
    expect(() => buildExplainQuery("SELECT 'unterminated")).toThrow();
    expect(() => buildExplainQuery("-- no statement")).toThrow();
  });
  test("parses the serialized JSON cell returned by the worker", () => {
    const cell = JSON.stringify([
      { Plan: { "Node Type": "Result", "Total Cost": 0.01, "Plan Rows": 1 } },
    ]);
    expect(parsePlanResult({ "QUERY PLAN": cell })).toMatchObject({
      nodeType: "Result",
      totalCost: 0.01,
      planRows: 1,
    });
    expect(parsePlanResult({ "QUERY PLAN": cell.slice(0, 15) })).toBeNull();
    expect(parsePlanResult({ "QUERY PLAN": null })).toBeNull();
  });
  test("parses PostgreSQL JSON plan hierarchically", () => {
    const plan = parsePlanResult([
      {
        "QUERY PLAN": [
          {
            Plan: {
              "Node Type": "Seq Scan",
              "Relation Name": "widgets",
              "Total Cost": 8,
              "Plan Rows": 3,
              Plans: [
                {
                  "Node Type": "Index Scan",
                  "Relation Name": "parts",
                  "Startup Cost": 0.2,
                  "Total Cost": 2,
                  "Plan Rows": 1,
                },
              ],
            },
          },
        ],
      },
    ]);
    expect(plan).toMatchObject({
      nodeType: "Seq Scan",
      relation: "widgets",
      totalCost: 8,
      planRows: 3,
      children: [{ nodeType: "Index Scan", relation: "parts" }],
    });
    expect(parsePlanResult("not json")).toBeNull();
  });
  test("offers bounded read-only catalog/statistics diagnostics as draft queries", () => {
    expect(postgresDiagnostics.map(({ id }) => id)).toEqual([
      "sessions",
      "sizes",
      "index-usage",
      "blocking",
    ]);
    const requiredSql = {
      sessions: [
        "FROM pg_stat_activity",
        "datname = current_database()",
        "pid <> pg_backend_pid()",
        "LIMIT 100;",
      ],
      sizes: [
        "FROM pg_catalog.pg_statio_user_tables",
        "pg_total_relation_size(relid)",
        "LIMIT 100;",
      ],
      "index-usage": [
        "FROM pg_catalog.pg_stat_user_indexes",
        "ORDER BY idx_scan ASC",
        "LIMIT 200;",
      ],
      blocking: [
        "FROM pg_catalog.pg_stat_activity AS blocked",
        "pg_blocking_pids(blocked.pid)",
        "blocked.datname = current_database()",
        "LIMIT 100;",
      ],
    };
    for (const { sql } of postgresDiagnostics) {
      const id = postgresDiagnostics.find((item) => item.sql === sql)!.id;
      for (const invariant of requiredSql[id]) expect(sql).toContain(invariant);
      expect(sql).not.toMatch(
        /\b(?:INSERT|UPDATE|DELETE|DROP|CREATE|ALTER)\b/i,
      );
    }
  });
});
