import { describe, expect, test } from "bun:test";
import {
  buildMongoQueryMessages,
  buildSqlQueryMessages,
  isLocalAiEndpoint,
  normalizeAiEndpoint,
  parseGeneratedMongoQuery,
  parseGeneratedSqlQuery,
} from "./ai-query.js";

describe("AI query connector helpers", () => {
  test("normalizes compatible HTTPS endpoints and local HTTP providers", () => {
    expect(normalizeAiEndpoint("https://api.openai.com/v1/")).toBe(
      "https://api.openai.com/v1",
    );
    expect(normalizeAiEndpoint("http://localhost:11434/v1/")).toBe(
      "http://localhost:11434/v1",
    );
    expect(isLocalAiEndpoint("http://127.0.0.1:11434/v1")).toBe(true);
    expect(isLocalAiEndpoint("https://api.openai.com/v1")).toBe(false);
  });

  test("rejects insecure remote URLs, credentials and URL parameters", () => {
    expect(() => normalizeAiEndpoint("http://provider.example/v1")).toThrow(
      "Plain HTTP is allowed only for a local provider",
    );
    expect(() =>
      normalizeAiEndpoint("https://user:secret@api.example/v1"),
    ).toThrow();
    expect(() =>
      normalizeAiEndpoint("https://api.example/v1?key=secret"),
    ).toThrow();
    expect(() => normalizeAiEndpoint("file:///tmp/provider")).toThrow();
  });

  test("builds prompt with names and schema metadata, not sample documents", () => {
    const messages = buildMongoQueryMessages({
      prompt: "Show paid orders",
      mode: "find",
      database: "shop",
      collection: "orders",
      fields: ["status", "total"],
      indexes: [{ keys: '{"status":1}', unique: false }],
    });
    const content = messages.map((message) => message.content).join("\n");
    expect(content).toContain("Show paid orders");
    expect(content).toContain('"fieldPaths":["status","total"]');
    expect(content).toContain("no document values");
    expect(content).not.toContain("sample-document-secret");
  });

  test("parses and validates a generated find filter", () => {
    expect(
      parseGeneratedMongoQuery(
        JSON.stringify({
          query: { status: "paid", total: { $gt: 100 } },
          explanation: "Filters paid orders over 100.",
        }),
        "find",
      ),
    ).toEqual({
      mode: "find",
      query: '{\n  "status": "paid",\n  "total": {\n    "$gt": 100\n  }\n}',
      explanation: "Filters paid orders over 100.",
    });
  });

  test("parses read-only pipelines and rejects disabled operators", () => {
    expect(
      parseGeneratedMongoQuery(
        '```json\n{"query":[{"$match":{"status":"paid"}},{"$limit":10}],"explanation":"Only matching rows."}\n```',
        "aggregate",
      ).query,
    ).toContain("$match");
    expect(() =>
      parseGeneratedMongoQuery(
        '{"query":[{"$out":"archive"}],"explanation":""}',
        "aggregate",
      ),
    ).toThrow("$out");
    expect(() =>
      parseGeneratedMongoQuery(
        '{"query":{"$expr":{"$function":{}}},"explanation":""}',
        "find",
      ),
    ).toThrow("operator disabled");
    expect(() =>
      parseGeneratedMongoQuery(
        '{"query":{"$where":"return true"},"explanation":""}',
        "find",
      ),
    ).toThrow("$where");
  });

  test("rejects malformed or oversized model output", () => {
    expect(() => parseGeneratedMongoQuery("not JSON", "find")).toThrow(
      "required JSON query response",
    );
    expect(() =>
      parseGeneratedMongoQuery(
        JSON.stringify({ query: "x".repeat(20_001), explanation: "" }),
        "find",
      ),
    ).toThrow("empty or too long");
  });

  test("builds PostgreSQL and SQLite prompts from schema identifiers only", () => {
    const tables = [
      {
        schema: "public",
        name: "orders",
        kind: "table",
        columns: ["id", "status", "total"],
        rows: [{ customer_email: "sample-row-secret" }],
      },
    ];
    for (const dialect of ["postgres", "sqlite"]) {
      const messages = buildSqlQueryMessages({
        prompt: "Find paid orders",
        dialect,
        tables,
      });
      const content = messages.map((message) => message.content).join("\n");
      expect(content).toContain(dialect === "sqlite" ? "SQLite" : "PostgreSQL");
      expect(content).toContain('"table":"orders"');
      expect(content).toContain('"columns":["id","status","total"]');
      expect(content).toContain("Find paid orders");
      expect(content).toContain("no row data");
      expect(content).not.toContain("sample-row-secret");
    }
  });

  test("parses SQL preview responses without running them", () => {
    const query =
      'SELECT id, total FROM "public"."orders" WHERE status = \'paid\';';
    expect(
      parseGeneratedSqlQuery(
        JSON.stringify({ query, explanation: "Returns paid orders." }),
        "postgres",
      ),
    ).toEqual({
      dialect: "postgres",
      query,
      explanation: "Returns paid orders.",
    });
    expect(
      parseGeneratedSqlQuery(
        '```json\n{"query":"SELECT name FROM users;","explanation":"SQLite query."}\n```',
        "sqlite",
      ).dialect,
    ).toBe("sqlite");
    expect(
      parseGeneratedSqlQuery(
        JSON.stringify({ query: "SELECT 'a;b';", explanation: "" }),
        "sqlite",
      ).query,
    ).toBe("SELECT 'a;b';");
    expect(() =>
      parseGeneratedSqlQuery(
        JSON.stringify({ query: "SELECT 1; SELECT 2;", explanation: "" }),
        "postgres",
      ),
    ).toThrow("exactly one statement");
    expect(() => parseGeneratedSqlQuery("not JSON", "sqlite")).toThrow(
      "required SQL query response",
    );
    expect(() => parseGeneratedSqlQuery("{}", "postgres")).toThrow(
      "empty or too long",
    );
    expect(() => parseGeneratedSqlQuery("{}", "mongodb")).toThrow(
      "Choose PostgreSQL or SQLite",
    );
  });
});
