/**
 * Turns mongosh-style query text into Extended JSON that `EJSON.parse` reads.
 *
 * Accepts what people paste from the shell or Compass: unquoted keys
 * (`{status: "ready"}`), single quotes, trailing commas, comments,
 * `ObjectId("…")`, `ISODate("…")` / `new Date("…")`, `NumberLong`,
 * `NumberInt`, `NumberDecimal`, `UUID` and `/regex/flags`. Strict JSON and
 * Extended JSON (`{"$oid": "…"}`) pass through unchanged.
 */
export function normalizeMongoQuery(source: string): string {
  let out = "";
  let index = 0;
  const length = source.length;

  const fail = (message: string): never => {
    throw new Error(`${message} (at character ${index + 1}).`);
  };
  const lastSignificant = (): string => {
    for (let i = out.length - 1; i >= 0; i -= 1)
      if (!/\s/.test(out[i]!)) return out[i]!;
    return "";
  };
  const skipSpace = (): void => {
    while (index < length && /\s/.test(source[index]!)) index += 1;
  };
  const readString = (): string => {
    const quote = source[index]!;
    index += 1;
    let value = "";
    while (index < length && source[index] !== quote) {
      const char = source[index]!;
      if (char === "\\") {
        const next = source[index + 1];
        if (next === undefined) fail("Unfinished string");
        if (next === "'") value += "'";
        else
          value += JSON.parse(
            `"\\${next === "u" ? source.slice(index + 1, index + 6) : next}"`,
          );
        index += next === "u" ? 6 : 2;
        continue;
      }
      if (char === "\n") fail("Unfinished string");
      value += char;
      index += 1;
    }
    if (index >= length) fail("Unfinished string");
    index += 1;
    return value;
  };
  const readArgument = (): string | number | null => {
    skipSpace();
    const char = source[index];
    if (char === ")") return null;
    if (char === '"' || char === "'") return readString();
    const match = /^-?\d+(\.\d+)?([eE][-+]?\d+)?/.exec(source.slice(index));
    if (!match) fail("Expected a string or number argument");
    index += match![0].length;
    return Number(match![0]);
  };
  const readCall = (name: string): string => {
    skipSpace();
    if (source[index] !== "(") fail(`Expected ( after ${name}`);
    index += 1;
    const arg = readArgument();
    skipSpace();
    if (source[index] !== ")") fail(`${name}() takes one argument`);
    index += 1;
    const text = arg === null ? null : String(arg);
    switch (name) {
      case "ObjectId":
      case "ObjectID":
        if (!text || !/^[0-9a-fA-F]{24}$/.test(text))
          fail("ObjectId needs a 24-character hex string");
        return JSON.stringify({ $oid: text });
      case "ISODate":
      case "Date":
        return JSON.stringify({
          $date:
            text === null
              ? new Date().toISOString()
              : typeof arg === "number"
                ? new Date(arg).toISOString()
                : text,
        });
      case "NumberLong":
        if (text === null) fail("NumberLong needs a value");
        return JSON.stringify({ $numberLong: text });
      case "NumberInt":
        if (text === null || !Number.isInteger(Number(text)))
          fail("NumberInt needs an integer");
        return String(Number(text));
      case "NumberDecimal":
      case "Decimal128":
        if (text === null) fail("NumberDecimal needs a value");
        return JSON.stringify({ $numberDecimal: text });
      case "UUID":
        if (!text) fail("UUID needs a string");
        return JSON.stringify({ $uuid: text });
      default:
        return fail(`Unknown function ${name}`);
    }
  };
  const valuePosition = (): boolean => {
    const previous = lastSignificant();
    return (
      previous === "" ||
      previous === ":" ||
      previous === "," ||
      previous === "["
    );
  };

  while (index < length) {
    const char = source[index]!;
    if (/\s/.test(char)) {
      out += char;
      index += 1;
    } else if (char === "/" && source[index + 1] === "/") {
      while (index < length && source[index] !== "\n") index += 1;
    } else if (char === "/" && source[index + 1] === "*") {
      const end = source.indexOf("*/", index + 2);
      if (end < 0) fail("Unfinished comment");
      index = end + 2;
    } else if (char === "/" && valuePosition()) {
      index += 1;
      let pattern = "";
      let inClass = false;
      while (index < length) {
        const c = source[index]!;
        if (c === "\\") {
          pattern += c + (source[index + 1] ?? "");
          index += 2;
          continue;
        }
        if (c === "\n") fail("Unfinished regular expression");
        if (c === "[") inClass = true;
        else if (c === "]") inClass = false;
        else if (c === "/" && !inClass) break;
        pattern += c;
        index += 1;
      }
      if (index >= length) fail("Unfinished regular expression");
      index += 1;
      const flags = /^[a-z]*/.exec(source.slice(index))![0];
      index += flags.length;
      out += JSON.stringify({ $regex: pattern, $options: flags });
    } else if (char === '"' || char === "'") {
      out += JSON.stringify(readString());
    } else if (char === "}" || char === "]") {
      // Drop a trailing comma before the closing bracket.
      const trimmed = out.replace(/\s+$/, "");
      if (trimmed.endsWith(","))
        out = trimmed.slice(0, -1) + out.slice(trimmed.length);
      out += char;
      index += 1;
    } else if (/[A-Za-z_$]/.test(char)) {
      const word = /^[A-Za-z_$][\w$.]*/.exec(source.slice(index))![0];
      index += word.length;
      const rest = source.slice(index);
      if (/^\s*:/.test(rest) && lastSignificant() !== ":") {
        out += JSON.stringify(word);
      } else if (word === "true" || word === "false" || word === "null") {
        out += word;
      } else if (word === "undefined") {
        out += "null";
      } else if (word === "new") {
        skipSpace();
      } else {
        out += readCall(word);
      }
    } else {
      out += char;
      index += 1;
    }
  }
  return out;
}

/** Dotted field paths in a set of documents (nested objects, depth-limited). */
export function collectMongoFieldPaths(
  documents: readonly unknown[],
  { maxDepth = 3, maxFields = 300 } = {},
): string[] {
  const seen = new Set<string>();
  const visit = (value: unknown, prefix: string, depth: number): void => {
    if (seen.size >= maxFields) return;
    if (!value || typeof value !== "object" || Array.isArray(value)) return;
    // BSON values (ObjectId, Date, Decimal128…) are leaves, not documents.
    const proto = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null) return;
    for (const [key, child] of Object.entries(value)) {
      const path = prefix ? `${prefix}.${key}` : key;
      seen.add(path);
      if (depth < maxDepth) {
        const nested = Array.isArray(child)
          ? child.find((item) => item && typeof item === "object")
          : child;
        visit(nested, path, depth + 1);
      }
    }
  };
  for (const document of documents) visit(document, "", 1);
  return [...seen].slice(0, maxFields);
}
