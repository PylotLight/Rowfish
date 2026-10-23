import { describe, expect, test } from "bun:test";
import {
  mongoCompletionAt,
  type MongoCompletionOptions,
} from "./mongo-completion";

const fields = ["_id", "status", "total", "customer.name", "items"];
const find: MongoCompletionOptions = { mode: "find", fields };
const agg: MongoCompletionOptions = {
  mode: "aggregate",
  fields,
  collections: ["orders", "customers"],
};

/** Completes at the `|` marker. */
function at(source: string, options: MongoCompletionOptions) {
  const pos = source.indexOf("|");
  return mongoCompletionAt(source.replace("|", ""), pos, options);
}
const labels = (source: string, options: MongoCompletionOptions) =>
  at(source, options)?.options.map((item) => item.label) ?? [];

describe("mongo completion", () => {
  test("top-level find keys: fields and logical operators", () => {
    const list = labels("{ | }", find);
    expect(list).toContain("status");
    expect(list).toContain("customer.name");
    expect(list).toContain("$or");
    expect(list).not.toContain("$gt");
  });

  test("operators under a field", () => {
    const list = labels("{ total: { $g| } }", find);
    expect(list.slice(0, 2)).toEqual(["$gt", "$gte"]);
    expect(list).not.toContain("status");
  });

  test("typing a quoted key replaces through the auto-closed quote", () => {
    const source = '{ "sta|" }';
    const result = at(source, find)!;
    expect(result.options[0]!.label).toBe("status");
    expect(result.from).toBe(2);
    expect(result.to).toBe(7);
    expect(result.options[0]!.snippet).toBe('"status": ${}');
  });

  test("value suggestions in find", () => {
    const list = labels("{ status: | }", find);
    expect(list).toContain('{ "$in": [] }');
    expect(list).toContain('ObjectId("…")');
  });

  test("pipeline stages", () => {
    expect(labels("[ | ]", agg)).toContain("$match");
    expect(labels("[{ $| }]", agg)).toContain("$lookup");
    const lookup = at("[{ $loo| }]", agg)!.options[0]!;
    expect(lookup.snippet).toContain('"from"');
  });

  test("$match behaves like find", () => {
    expect(labels("[{ $match: { | } }]", agg)).toContain("status");
    expect(labels("[{ $match: { total: { | } } }]", agg)).toContain("$lte");
  });

  test("accumulators inside $group outputs and field paths in values", () => {
    expect(labels('[{ $group: { _id: "$status", n: { | } } }]', agg)).toContain(
      "$sum",
    );
    expect(labels('[{ $group: { _id: "$st|" } }]', agg)[0]).toBe("$status");
  });

  test("$lookup keys and collection names", () => {
    expect(labels("[{ $lookup: { | } }]", agg)).toContain("foreignField");
    expect(labels('[{ $lookup: { from: "c|" } }]', agg)).toEqual(["customers"]);
  });

  test("$sort suggests directions", () => {
    expect(labels("[{ $sort: { | } }]", agg)).toContain("total");
    expect(labels("[{ $sort: { total: | } }]", agg)).toEqual(["-1", "1"]);
  });

  test("nothing inside ordinary find strings", () => {
    expect(at('{ status: "rea|" }', find)).toBeNull();
  });
});
