/**
 * Context-aware suggestions for the MongoDB query editor. Pure text analysis
 * (no CodeMirror) so it can be unit tested; SqlEditor adapts the result.
 */

export interface MongoCompletionOptions {
  mode: "find" | "aggregate";
  /** Dotted field paths known for the current collection. */
  fields: readonly string[];
  /** Collections in the current database (for $lookup.from). */
  collections?: readonly string[];
}

export interface MongoSuggestion {
  label: string;
  /** CodeMirror snippet template (`${}` placeholders); defaults to label. */
  snippet?: string;
  type: "property" | "keyword" | "function" | "constant" | "variable" | "text";
  detail?: string;
  info?: string;
  boost?: number;
}

export interface MongoCompletionResult {
  from: number;
  to: number;
  options: MongoSuggestion[];
}

type Op = [name: string, value: string, info: string];

const QUERY_FIELD_OPS: Op[] = [
  ["$eq", "${}", "Equal to"],
  ["$ne", "${}", "Not equal to"],
  ["$gt", "${}", "Greater than"],
  ["$gte", "${}", "Greater than or equal"],
  ["$lt", "${}", "Less than"],
  ["$lte", "${}", "Less than or equal"],
  ["$in", "[${}]", "Matches any value in the array"],
  ["$nin", "[${}]", "Matches none of the values"],
  ["$exists", "${true}", "Field is present (true) or missing (false)"],
  ["$type", '"${string}"', "BSON type, e.g. string, int, date, objectId"],
  ["$regex", '"${}", "$options": "${i}"', "Regular expression match"],
  ["$not", "{ ${} }", "Negates an operator expression"],
  ["$elemMatch", "{ ${} }", "An array element matches all conditions"],
  ["$size", "${0}", "Array has exactly this many elements"],
  ["$all", "[${}]", "Array contains all values"],
  ["$mod", "[${2}, ${0}]", "Field % divisor == remainder"],
];
const QUERY_TOP_OPS: Op[] = [
  ["$and", "[{ ${} }]", "All conditions match"],
  ["$or", "[{ ${} }]", "Any condition matches"],
  ["$nor", "[{ ${} }]", "No condition matches"],
  ["$expr", "{ ${} }", "Aggregation expression, e.g. compare two fields"],
  ["$text", '{ "$search": "${}" }', "Full-text search (needs a text index)"],
  ["$jsonSchema", "{ ${} }", "Validate against a JSON Schema"],
];
const STAGES: Op[] = [
  ["$match", "{ ${} }", "Filter documents (same syntax as find)"],
  ["$project", "{ ${} }", "Pick, drop or compute fields"],
  ["$addFields", "{ ${} }", "Add computed fields"],
  ["$set", "{ ${} }", "Alias of $addFields"],
  ["$unset", '"${field}"', "Remove fields"],
  [
    "$group",
    '{ "_id": "$${field}", "${count}": { "$sum": 1 } }',
    "Group and aggregate",
  ],
  ["$sort", '{ "${field}": ${-1} }', "Sort (1 ascending, -1 descending)"],
  ["$limit", "${20}", "Keep the first n documents"],
  ["$skip", "${0}", "Skip n documents"],
  ["$count", '"${count}"', "Count documents into one field"],
  ["$unwind", '"$${field}"', "One document per array element"],
  [
    "$lookup",
    '{ "from": "${collection}", "localField": "${field}", "foreignField": "${_id}", "as": "${joined}" }',
    "Left join another collection",
  ],
  ["$facet", '{ "${name}": [${}] }', "Run several pipelines at once"],
  [
    "$bucket",
    '{ "groupBy": "$${field}", "boundaries": [${}], "default": "other" }',
    "Bucket by ranges",
  ],
  ["$sortByCount", '"$${field}"', "Group by value and count, sorted"],
  [
    "$replaceRoot",
    '{ "newRoot": "$${field}" }',
    "Promote an embedded document",
  ],
  ["$sample", '{ "size": ${10} }', "Random sample"],
  [
    "$densify",
    '{ "field": "${field}", "range": { "step": 1, "bounds": "full" } }',
    "Fill gaps in a sequence",
  ],
  [
    "$setWindowFields",
    '{ "sortBy": { "${field}": 1 }, "output": { ${} } }',
    "Window functions",
  ],
  [
    "$geoNear",
    '{ "near": ${}, "distanceField": "${distance}" }',
    "Sort by distance (must be first)",
  ],
];
const ACCUMULATORS: Op[] = [
  ["$sum", '"$${field}"', "Total (use 1 to count)"],
  ["$avg", '"$${field}"', "Average"],
  ["$min", '"$${field}"', "Smallest value"],
  ["$max", '"$${field}"', "Largest value"],
  ["$first", '"$${field}"', "Value from the first document"],
  ["$last", '"$${field}"', "Value from the last document"],
  ["$push", '"$${field}"', "Array of all values"],
  ["$addToSet", '"$${field}"', "Array of distinct values"],
  ["$count", "{}", "Number of documents in the group"],
  [
    "$top",
    '{ "sortBy": { "${field}": -1 }, "output": "$${field}" }',
    "Top document by sort",
  ],
];
const EXPRESSIONS: Op[] = [
  ["$concat", '["$${field}", "${}"]', "Join strings"],
  ["$cond", '{ "if": ${}, "then": ${}, "else": ${} }', "If / then / else"],
  ["$ifNull", '["$${field}", ${}]', "Fallback for null or missing"],
  ["$eq", '["$${field}", ${}]', "Equal"],
  ["$gt", '["$${field}", ${}]', "Greater than"],
  ["$lt", '["$${field}", ${}]', "Less than"],
  ["$and", "[${}]", "All true"],
  ["$or", "[${}]", "Any true"],
  ["$size", '"$${field}"', "Array length"],
  [
    "$filter",
    '{ "input": "$${field}", "as": "item", "cond": ${} }',
    "Filter an array",
  ],
  [
    "$map",
    '{ "input": "$${field}", "as": "item", "in": ${} }',
    "Transform an array",
  ],
  ["$toString", '"$${field}"', "Convert to string"],
  ["$toDate", '"$${field}"', "Convert to date"],
  [
    "$dateToString",
    '{ "format": "${%Y-%m-%d}", "date": "$${field}" }',
    "Format a date",
  ],
  [
    "$dateTrunc",
    '{ "date": "$${field}", "unit": "${day}" }',
    "Round a date down",
  ],
  ["$add", '["$${field}", ${}]', "Add numbers or ms to a date"],
  ["$subtract", '["$${field}", ${}]', "Subtract"],
  ["$multiply", '["$${field}", ${}]', "Multiply"],
  ["$divide", '["$${field}", ${}]', "Divide"],
  ["$round", '["$${field}", ${2}]', "Round to n places"],
  ["$arrayElemAt", '["$${field}", ${0}]', "Element at index"],
  ["$literal", "${}", "Use a value as-is"],
];
const LOOKUP_KEYS: Op[] = [
  ["from", '"${collection}"', "Collection to join"],
  ["localField", '"${field}"', "Field in this collection"],
  ["foreignField", '"${field}"', "Field in the joined collection"],
  ["as", '"${joined}"', "Output array field"],
  ["let", "{ ${} }", "Variables for the sub-pipeline"],
  ["pipeline", "[${}]", "Sub-pipeline on the joined collection"],
];
const FIND_VALUES: MongoSuggestion[] = [
  {
    label: '{ "$in": [] }',
    snippet: '{ "$in": [${}] }',
    type: "keyword",
    info: "Any of these values",
  },
  {
    label: '{ "$exists": true }',
    snippet: '{ "$exists": ${true} }',
    type: "keyword",
    info: "Field is present",
  },
  {
    label: '{ "$gte": … }',
    snippet: '{ "$gte": ${} }',
    type: "keyword",
    info: "Range, add $lt for an upper bound",
  },
  {
    label: '{ "$regex": … }',
    snippet: '{ "$regex": "${}", "$options": "i" }',
    type: "keyword",
    info: "Case-insensitive pattern",
  },
  {
    label: '{ "$ne": … }',
    snippet: '{ "$ne": ${} }',
    type: "keyword",
    info: "Not equal",
  },
  {
    label: 'ObjectId("…")',
    snippet: 'ObjectId("${}")',
    type: "function",
    info: "Match an _id",
  },
  {
    label: 'ISODate("…")',
    snippet: 'ISODate("${2026-01-01T00:00:00Z}")',
    type: "function",
    info: "A date",
  },
  { label: "true", type: "constant" },
  { label: "false", type: "constant" },
  { label: "null", type: "constant", info: "Null or missing" },
];

interface Frame {
  char: "{" | "[";
  key: string | null;
}

interface Scan {
  stack: Frame[];
  /** Last significant character before the token. */
  previous: string;
  /** Key whose value is being written, when previous is ":". */
  key: string | null;
}

/** Walks the text up to `end`, tracking bracket nesting and the key each object sits under. */
function scan(text: string, end: number): Scan {
  const stack: Frame[] = [];
  let previous = "";
  let lastWord: string | null = null;
  let key: string | null = null;
  let i = 0;
  while (i < end) {
    const char = text[i]!;
    if (/\s/.test(char)) {
      i += 1;
      continue;
    }
    if (char === "/" && text[i + 1] === "/") {
      while (i < end && text[i] !== "\n") i += 1;
      continue;
    }
    if (char === "/" && text[i + 1] === "*") {
      const close = text.indexOf("*/", i + 2);
      i = close < 0 ? end : close + 2;
      continue;
    }
    if (char === '"' || char === "'") {
      let j = i + 1;
      let value = "";
      while (j < end && text[j] !== char) {
        if (text[j] === "\\") j += 1;
        else value += text[j];
        j += 1;
      }
      i = j + 1;
      lastWord = value;
      previous = '"';
      continue;
    }
    if (/[A-Za-z_$0-9.-]/.test(char)) {
      const word = /^[\w$.-]+/.exec(text.slice(i, end))![0];
      i += word.length;
      lastWord = word;
      previous = "w";
      continue;
    }
    if (char === ":") key = lastWord;
    if (char === "{" || char === "[") {
      stack.push({ char, key: previous === ":" ? key : null });
    } else if (char === "}" || char === "]") {
      stack.pop();
    }
    previous = char;
    i += 1;
  }
  return { stack, previous, key: previous === ":" ? key : null };
}

function opSuggestions(
  ops: Op[],
  type: MongoSuggestion["type"],
  boost = 0,
): MongoSuggestion[] {
  return ops.map(([name, value, info]) => ({
    label: name,
    snippet: `"${name}": ${value}`,
    type,
    info,
    boost,
  }));
}

function fieldSuggestions(
  fields: readonly string[],
  boost = 1,
): MongoSuggestion[] {
  return fields.map((field) => ({
    label: field,
    snippet: `"${field}": \${}`,
    type: "property",
    boost: field === "_id" ? boost - 0.5 : boost,
  }));
}

export function mongoCompletionAt(
  text: string,
  pos: number,
  options: MongoCompletionOptions,
): MongoCompletionResult | null {
  const before = text.slice(0, pos);
  const token = /(["']?)([\w$.]*)$/.exec(before)!;
  const quote = token[1]!;
  const word = token[2]!;
  const from = pos - token[0].length;
  const after = text.slice(pos);
  const closingQuote = quote && after.startsWith(quote) ? 1 : 0;
  const { stack, previous, key } = scan(text, from);
  const top = stack.at(-1);
  const keys = stack.map((frame) => frame.key);
  const inMatch = keys.includes("$match");
  const aggregate = options.mode === "aggregate";

  const result = (
    list: MongoSuggestion[],
    plainValues = false,
  ): MongoCompletionResult | null => {
    // Prefix matches first, then anything containing what was typed.
    const typed = word.toLowerCase();
    const filtered = typed
      ? [
          ...list.filter((item) => item.label.toLowerCase().startsWith(typed)),
          ...list.filter(
            (item) =>
              !item.label.toLowerCase().startsWith(typed) &&
              item.label.toLowerCase().includes(typed.replace(/^\$/, "")),
          ),
        ]
      : list;
    if (!filtered.length) return null;
    // Keys are inserted as "key": … so a following colon would double up.
    const nextColon = /^["']?\s*:/.test(after);
    return {
      from,
      to: pos + closingQuote,
      options:
        plainValues || !nextColon
          ? filtered
          : filtered.map((item) => ({ ...item, snippet: `"${item.label}"` })),
    };
  };

  // A string value: "$field" references in aggregation, collection names for $lookup.from.
  if (
    quote &&
    (previous === ":" || previous === "[" || previous === ",") &&
    !(top?.char === "{" && previous !== ":")
  ) {
    if (key === "from" && top?.key === "$lookup")
      return result(
        (options.collections ?? []).map((name) => ({
          label: name,
          snippet: `"${name}"`,
          type: "variable",
        })),
        true,
      );
    if (aggregate && (word.startsWith("$") || !word))
      return result(
        options.fields.map((field) => ({
          label: `$${field}`,
          snippet: `"$${field}"`,
          type: "variable",
          info: "Field path",
        })),
        true,
      );
    return null;
  }

  // Key position inside an object.
  if (top?.char === "{" && (previous === "{" || previous === ",")) {
    const parent = top.key;
    const grandparent = stack.at(-2)?.key ?? null;
    const typingOperator = word.startsWith("$");
    let list: MongoSuggestion[];
    if (aggregate && stack.length === 2 && stack[0]!.char === "[") {
      list = opSuggestions(STAGES, "keyword", 2);
    } else if (parent === "$lookup") {
      list = opSuggestions(LOOKUP_KEYS, "property", 2);
    } else if (aggregate && grandparent === "$group" && !inMatch) {
      list = opSuggestions(ACCUMULATORS, "function", 2);
    } else if (aggregate && parent === "$group") {
      list = [
        {
          label: "_id",
          snippet: '"_id": "$${field}"',
          type: "property",
          info: "Group key",
          boost: 2,
        },
      ];
    } else if (!aggregate || inMatch) {
      const nestedUnderField =
        parent !== null && !parent.startsWith("$") && parent !== "$match";
      const ops = nestedUnderField
        ? opSuggestions(QUERY_FIELD_OPS, "keyword", 1)
        : opSuggestions(QUERY_TOP_OPS, "keyword", 0);
      list = nestedUnderField
        ? ops
        : [...fieldSuggestions(options.fields), ...ops];
      if (parent === "$elemMatch")
        list = [
          ...fieldSuggestions(options.fields),
          ...opSuggestions(QUERY_FIELD_OPS, "keyword"),
        ];
    } else if (["$sort", "$project", "$unset"].includes(parent ?? "")) {
      list = fieldSuggestions(options.fields).map((item) => ({
        ...item,
        snippet: `"${item.label}": \${${parent === "$sort" ? "-1" : "1"}}`,
      }));
    } else {
      list = [
        ...fieldSuggestions(options.fields),
        ...opSuggestions(EXPRESSIONS, "function"),
      ];
    }
    if (typingOperator)
      list = list.filter((item) => item.label.startsWith("$"));
    return result(list);
  }

  // Value position.
  if (previous === ":") {
    if (quote) return null;
    if (top?.key === "$sort")
      return result(
        [
          { label: "-1", type: "constant", info: "Descending" },
          { label: "1", type: "constant", info: "Ascending" },
        ],
        true,
      );
    if (!aggregate || inMatch) return result(FIND_VALUES, true);
    if (word.startsWith("$") || !word)
      return result(
        options.fields.map((field) => ({
          label: `$${field}`,
          snippet: `"$${field}"`,
          type: "variable",
          info: "Field path",
        })),
        true,
      );
    return null;
  }

  // A new pipeline stage.
  if (
    aggregate &&
    top?.char === "[" &&
    stack.length === 1 &&
    (previous === "[" || previous === ",")
  ) {
    return result(
      STAGES.map(([name, value, info]) => ({
        label: name,
        snippet: `{ "${name}": ${value} }`,
        type: "keyword",
        info,
      })),
      true,
    );
  }
  return null;
}
