import { describe, expect, test } from "bun:test";
import { BSON } from "mongodb";
import {
  cellSummary,
  childEntries,
  columnKinds,
  describeValue,
  documentFor,
  effectiveResultsView,
  formatDocument,
  jsonTokens,
  loadResultsView,
  parseJsonCell,
  rowAsDocument,
  saveResultsView,
  toPlain,
  toRelaxed,
  treeSummary,
  withoutId,
} from "./document-view";

const { EJSON, ObjectId, Int32, Long, Double, Decimal128, UUID, Timestamp } =
  BSON;

function canonical(document: Record<string, unknown>): Record<string, unknown> {
  return JSON.parse(EJSON.stringify(document, { relaxed: false }));
}

const sample = canonical({
  _id: new ObjectId("65a1f0c2e4b0a1b2c3d4e5f6"),
  name: "Ada",
  age: new Int32(36),
  score: new Double(9.5),
  big: Long.fromString("9007199254740993"),
  small: Long.fromNumber(42),
  price: Decimal128.fromString("19.99"),
  created: new Date("2024-01-02T03:04:05.000Z"),
  active: true,
  nothing: null,
  tags: ["a", "b", "c"],
  address: { city: "Melbourne", zip: "3000", geo: { lat: 1, lng: 2 } },
  uuid: new UUID("3b241101-e2bb-4255-8caf-4136c566a962"),
  pattern: /ab+c/i,
  ts: new Timestamp({ t: 10, i: 2 }),
});

describe("describeValue", () => {
  test("keeps BSON types from canonical EJSON", () => {
    expect(describeValue(sample._id)).toEqual({
      kind: "ObjectId",
      text: "ObjectId('65a1f0c2e4b0a1b2c3d4e5f6')",
    });
    expect(describeValue(sample.name)).toEqual({
      kind: "String",
      text: '"Ada"',
    });
    expect(describeValue(sample.age)).toEqual({ kind: "Int32", text: "36" });
    expect(describeValue(sample.score).kind).toBe("Double");
    expect(describeValue(sample.big)).toEqual({
      kind: "Int64",
      text: "9007199254740993",
    });
    expect(describeValue(sample.price)).toEqual({
      kind: "Decimal128",
      text: "19.99",
    });
    expect(describeValue(sample.created)).toEqual({
      kind: "Date",
      text: "2024-01-02T03:04:05.000Z",
    });
    expect(describeValue(sample.active).kind).toBe("Boolean");
    expect(describeValue(sample.nothing).kind).toBe("Null");
    expect(describeValue(sample.uuid)).toEqual({
      kind: "UUID",
      text: "UUID('3b241101-e2bb-4255-8caf-4136c566a962')",
    });
    expect(describeValue(sample.pattern)).toEqual({
      kind: "RegExp",
      text: "/ab+c/i",
    });
    expect(describeValue(sample.ts).text).toBe("Timestamp({ t: 10, i: 2 })");
  });

  test("summarises objects and arrays", () => {
    const tags = describeValue(sample.tags);
    const address = describeValue(sample.address);
    expect(tags).toMatchObject({ kind: "Array", count: 3 });
    expect(address).toMatchObject({ kind: "Object", count: 3 });
    expect(treeSummary(address)).toBe("Object (3)");
    expect(treeSummary(tags)).toBe("Array (3)");
    expect(cellSummary(address)).toBe("{} 3 fields");
    expect(cellSummary(tags)).toBe("[] 3 items");
    expect(cellSummary({ kind: "Array", text: "", count: 1 })).toBe(
      "[] 1 item",
    );
    expect(cellSummary({ kind: "Object", text: "", count: 1 })).toBe(
      "{} 1 field",
    );
  });

  test("plain JSON numbers infer int vs double", () => {
    expect(describeValue(3).kind).toBe("Int32");
    expect(describeValue(3.25).kind).toBe("Double");
  });

  test("wrappers have no children; objects and arrays do", () => {
    expect(childEntries(sample._id)).toEqual([]);
    expect(childEntries(sample.tags)).toEqual([
      ["0", "a"],
      ["1", "b"],
      ["2", "c"],
    ]);
    expect(childEntries(sample.address).map(([key]) => key)).toEqual([
      "city",
      "zip",
      "geo",
    ]);
  });
});

describe("relaxed and plain output", () => {
  test("relaxed EJSON round-trips through the driver", () => {
    const relaxed = toRelaxed(sample) as Record<string, unknown>;
    expect(relaxed.age).toBe(36);
    expect(relaxed.small).toBe(42);
    expect(relaxed.big).toEqual({ $numberLong: "9007199254740993" });
    expect(relaxed.created).toEqual({ $date: "2024-01-02T03:04:05.000Z" });
    expect(relaxed._id).toEqual({ $oid: "65a1f0c2e4b0a1b2c3d4e5f6" });
    const parsed = EJSON.parse(formatDocument(sample, "ejson")) as Record<
      string,
      unknown
    >;
    expect(String(parsed._id)).toBe("65a1f0c2e4b0a1b2c3d4e5f6");
    expect(parsed.created).toBeInstanceOf(Date);
  });

  test("plain JSON flattens ids and dates", () => {
    const plain = toPlain(sample) as Record<string, unknown>;
    expect(plain._id).toBe("65a1f0c2e4b0a1b2c3d4e5f6");
    expect(plain.created).toBe("2024-01-02T03:04:05.000Z");
    expect(plain.price).toBe("19.99");
    expect(plain.uuid).toBe("3b241101-e2bb-4255-8caf-4136c566a962");
    expect(plain.address).toEqual({
      city: "Melbourne",
      zip: "3000",
      geo: { lat: 1, lng: 2 },
    });
  });

  test("withoutId drops only _id", () => {
    expect(Object.keys(withoutId({ _id: 1, a: 2 }))).toEqual(["a"]);
  });
});

describe("row fallbacks", () => {
  test("parses JSON-looking cells only", () => {
    expect(parseJsonCell('{"a":1}')).toEqual({ a: 1 });
    expect(parseJsonCell("[1,2]")).toEqual([1, 2]);
    expect(parseJsonCell("[abc]")).toBeUndefined();
    expect(parseJsonCell("plain")).toBeUndefined();
    expect(parseJsonCell(12)).toBeUndefined();
  });

  test("documentFor prefers typed EJSON, falls back to cells", () => {
    const row = { _id: "abc", meta: '{"x":1}', n: 2 };
    expect(documentFor(row, null)).toEqual(rowAsDocument(row));
    expect(rowAsDocument(row)).toEqual({ _id: "abc", meta: { x: 1 }, n: 2 });
    expect(documentFor(row, '{"_id":{"$oid":"1"}}')).toEqual({
      _id: { $oid: "1" },
    });
    expect(documentFor(row, "not json")).toEqual(rowAsDocument(row));
  });
});

describe("columnKinds", () => {
  test("single kind, mixed, and ignores nulls", () => {
    const docs = [
      canonical({ _id: new ObjectId(), a: "x", b: new Int32(1), c: null }),
      canonical({ _id: new ObjectId(), a: "y", b: "two", c: { d: 1 } }),
    ];
    expect(columnKinds(["_id", "a", "b", "c", "missing"], docs)).toEqual({
      _id: "ObjectId",
      a: "String",
      b: "Mixed",
      c: "Object",
    });
  });

  test("plain whole and fractional numbers read as Double", () => {
    expect(columnKinds(["n"], [{ n: 1 }, { n: 1.5 }])).toEqual({
      n: "Double",
    });
  });
});

describe("results view preference", () => {
  test("explicit choice wins, else single mongo doc opens as list", () => {
    expect(effectiveResultsView("json", "mongodb", 1)).toBe("json");
    expect(effectiveResultsView(null, "mongodb", 1)).toBe("list");
    expect(effectiveResultsView(null, "mongodb", 2)).toBe("table");
    expect(effectiveResultsView(null, "postgres", 1)).toBe("table");
  });

  test("persists only known views", () => {
    const data = new Map<string, string>();
    const storage = {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => void data.set(key, value),
    };
    expect(loadResultsView(storage)).toBeNull();
    saveResultsView("list", storage);
    expect(loadResultsView(storage)).toBe("list");
    data.set("rowfish.results-view", "bogus");
    expect(loadResultsView(storage)).toBeNull();
  });
});

describe("jsonTokens", () => {
  test("splits keys, strings, numbers and literals", () => {
    const tokens = jsonTokens('{\n  "a": "b",\n  "n": -1.5e3,\n  "t": true\n}');
    expect(tokens.filter((token) => token.type)).toEqual([
      { text: '"a"', type: "key" },
      { text: '"b"', type: "string" },
      { text: '"n"', type: "key" },
      { text: "-1.5e3", type: "number" },
      { text: '"t"', type: "key" },
      { text: "true", type: "literal" },
    ]);
    expect(tokens.map((token) => token.text).join("")).toBe(
      '{\n  "a": "b",\n  "n": -1.5e3,\n  "t": true\n}',
    );
  });

  test("numbers inside strings stay strings", () => {
    const tokens = jsonTokens('"v1.2 true"');
    expect(tokens).toEqual([{ text: '"v1.2 true"', type: "string" }]);
  });
});
