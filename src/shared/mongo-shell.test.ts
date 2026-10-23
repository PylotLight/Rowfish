import { describe, expect, test } from "bun:test";
import { BSON } from "mongodb";
import { normalizeMongoQuery } from "./mongo-shell";
import { parseMongoFilter, parseMongoPipeline } from "./database-helpers";

const { EJSON, ObjectId, BSONRegExp } = BSON;
type ObjectId = InstanceType<typeof ObjectId>;
type BSONRegExp = InstanceType<typeof BSONRegExp>;

const parse = (source: string) => EJSON.parse(normalizeMongoQuery(source));

describe("normalizeMongoQuery", () => {
  test("leaves strict JSON alone", () => {
    const source = '{ "status": "ready", "total": { "$gt": 5 } }';
    expect(JSON.parse(normalizeMongoQuery(source))).toEqual(JSON.parse(source));
  });

  test("quotes bare keys, single quotes and drops trailing commas", () => {
    expect(
      JSON.parse(
        normalizeMongoQuery(
          "{ status: 'ready', total: { $gte: 5, }, 'address.city': \"Melb\", }",
        ),
      ),
    ).toEqual({
      status: "ready",
      total: { $gte: 5 },
      "address.city": "Melb",
    });
    expect(JSON.parse(normalizeMongoQuery("{ address.city: 'x' }"))).toEqual({
      "address.city": "x",
    });
  });

  test("turns shell helpers into BSON values", () => {
    const id = "65f1c0ffee0000000000abcd";
    const doc = parse(
      `{ _id: ObjectId("${id}"), at: { $gte: ISODate("2026-01-01T00:00:00Z") }, made: new Date('2026-02-01'), n: NumberLong("9007199254740993"), i: NumberInt(4) }`,
    ) as Record<string, unknown>;
    expect(doc._id).toBeInstanceOf(ObjectId);
    expect((doc._id as ObjectId).toHexString()).toBe(id);
    expect((doc.at as Record<string, unknown>).$gte).toBeInstanceOf(Date);
    expect(doc.made).toBeInstanceOf(Date);
    expect(doc.i).toBe(4);
  });

  test("reads Extended JSON $oid as an ObjectId", () => {
    const doc = parse('{ "_id": { "$oid": "65f1c0ffee0000000000abcd" } }') as {
      _id: unknown;
    };
    expect(doc._id).toBeInstanceOf(ObjectId);
  });

  test("regex literals", () => {
    const doc = parse("{ name: /^ac[/]me\\/x/i }") as { name: unknown };
    expect(doc.name).toBeInstanceOf(BSONRegExp);
    expect((doc.name as BSONRegExp).pattern).toBe("^ac[/]me\\/x");
    expect((doc.name as BSONRegExp).options).toBe("i");
  });

  test("comments and pipelines", () => {
    expect(
      JSON.parse(
        normalizeMongoQuery(`[
          // only ready ones
          { $match: { status: 'ready' } },
          /* newest */ { $sort: { at: -1 } },
        ]`),
      ),
    ).toEqual([{ $match: { status: "ready" } }, { $sort: { at: -1 } }]);
  });

  test("keeps string contents that look like syntax", () => {
    expect(
      JSON.parse(normalizeMongoQuery(`{ note: "a: b, // not a comment }" }`)),
    ).toEqual({ note: "a: b, // not a comment }" });
  });

  test("explains bad helpers", () => {
    expect(() => normalizeMongoQuery('{ _id: ObjectId("nope") }')).toThrow(
      "24-character hex",
    );
    expect(() => normalizeMongoQuery("{ x: Foo(1) }")).toThrow(
      "Unknown function Foo",
    );
  });

  test("validators accept shell syntax and still block $where", () => {
    expect(parseMongoFilter("{ status: 'ready' }")).toEqual({
      status: "ready",
    });
    expect(parseMongoPipeline("[{ $limit: 5 }]")).toEqual([{ $limit: 5 }]);
    expect(parseMongoFilter("  ")).toEqual({});
    expect(parseMongoPipeline("")).toEqual([]);
    expect(() => parseMongoFilter("{ $where: 'this.a' }")).toThrow("$where");
    expect(() => parseMongoFilter("{ status: ")).toThrow(
      "Could not read the MongoDB query",
    );
  });
});
