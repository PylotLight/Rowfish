import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

const MAX_FILES = 2000;
const MAX_FILE_BYTES = 256 * 1024;
const MAX_TOTAL_BYTES = 16 * 1024 * 1024;
const FIELDS = ["revision", "down_revision", "branch_labels", "depends_on"];

function removeComments(source) {
  let result = "";
  let quote = null;
  let triple = false;
  let escaped = false;
  for (let i = 0; i < source.length; i++) {
    const c = source[i];
    if (quote) {
      result += c;
      if (escaped) escaped = false;
      else if (c === "\\") escaped = true;
      else if (triple ? source.startsWith(quote.repeat(3), i) : c === quote) {
        if (triple) {
          result += source.slice(i + 1, i + 3);
          i += 2;
        }
        quote = null;
        triple = false;
      }
      continue;
    }
    if (c === "#") {
      while (i < source.length && source[i] !== "\n") i++;
      result += "\n";
      continue;
    }
    if (c === '"' || c === "'") {
      quote = c;
      triple = source.startsWith(c.repeat(3), i);
      if (triple) {
        result += c.repeat(3);
        i += 2;
      } else result += c;
      continue;
    }
    result += c;
  }
  return result;
}

function pythonString(text) {
  const q = text[0];
  if (text.length < 2 || text.at(-1) !== q)
    throw new Error("unterminated string literal");
  const body = text.slice(1, -1);
  if (q === '"') return JSON.parse(text);
  // JSON's escape rules cover the ordinary escapes used in Alembic metadata.
  const escaped = body.replace(/\\'/g, "'").replace(/\"/g, '\\"');
  return JSON.parse(`"${escaped}"`);
}

function parseLiteral(raw) {
  let i = 0;
  const ws = () => {
    while (/\s/.test(raw[i] ?? "")) i++;
  };
  function value() {
    ws();
    if (raw[i] === "N" && raw.slice(i, i + 4) === "None") {
      i += 4;
      return null;
    }
    if (raw[i] === "[" || raw[i] === "(") {
      const close = raw[i++] === "[" ? "]" : ")";
      const values = [];
      ws();
      if (raw[i] === close) {
        i++;
        return values;
      }
      while (i < raw.length) {
        values.push(value());
        ws();
        if (raw[i] === close) {
          i++;
          return values;
        }
        if (raw[i++] !== ",") throw new Error("expected comma in sequence");
        ws();
        if (raw[i] === close) {
          i++;
          return values;
        }
      }
      throw new Error("unterminated sequence");
    }
    if (raw[i] === "'" || raw[i] === '"') {
      const q = raw[i];
      let j = i + 1;
      let escaped = false;
      for (; j < raw.length; j++) {
        if (!escaped && raw[j] === q) break;
        if (!escaped && raw[j] === "\\") escaped = true;
        else escaped = false;
      }
      if (j >= raw.length) throw new Error("unterminated string literal");
      const str = pythonString(raw.slice(i, j + 1));
      i = j + 1;
      return str;
    }
    throw new Error("expected a string, None, tuple, or list literal");
  }
  const parsed = value();
  ws();
  if (i !== raw.length) throw new Error("unexpected content after literal");
  return parsed;
}

function extractAssignments(source) {
  const cleaned = removeComments(source);
  const lines = cleaned.split(/\r?\n/);
  const assignments = new Map();
  for (let lineNo = 0; lineNo < lines.length; lineNo++) {
    const line = lines[lineNo];
    if (!line.trim() || /^\s/.test(line)) continue;
    const match = line.match(
      /^(revision|down_revision|branch_labels|depends_on)\s*=\s*(.*)$/,
    );
    if (!match) continue;
    const field = match[1];
    let expression = match[2].trim();
    let balance = 0;
    let quote = null;
    let escaped = false;
    const scan = (text) => {
      for (const ch of text) {
        if (quote) {
          if (escaped) escaped = false;
          else if (ch === "\\") escaped = true;
          else if (ch === quote) quote = null;
        } else if (ch === "'" || ch === '"') quote = ch;
        else if ("([".includes(ch)) balance++;
        else if (") ]".replace(" ", "").includes(ch)) balance--;
      }
    };
    scan(expression);
    while (balance > 0 && lineNo + 1 < lines.length) {
      expression += ` ${lines[++lineNo].trim()}`;
      scan(lines[lineNo]);
    }
    if (assignments.has(field)) assignments.get(field).duplicate = true;
    else assignments.set(field, { expression, line: lineNo + 1 });
  }
  return assignments;
}

function normalizeRefs(value, field, errors) {
  if (value === null) return [];
  if (typeof value === "string") return [value];
  if (Array.isArray(value) && value.every((item) => typeof item === "string"))
    return value;
  errors.push(`${field} must be a string, None, or a tuple/list of strings`);
  return [];
}

function firstLineMessage(source) {
  const match = source.match(
    /^\s*(?:[rubfRUBF]{0,2})?('''|\"\"\"|'|\")([\s\S]*?)\1/,
  );
  return match ? match[2].split(/\r?\n/, 1)[0] : "";
}

function revisionHeads(nodes) {
  return nodes
    .filter(
      (node) =>
        node.revision &&
        !nodes.some((other) => other.down_revision.includes(node.revision)),
    )
    .map((node) => node.revision)
    .sort();
}

function sortGraph(nodes, errors) {
  const byId = new Map(
    nodes.filter((n) => n.revision).map((n) => [n.revision, n]),
  );
  const indegree = new Map(nodes.map((n) => [n.revision, 0]));
  const children = new Map(nodes.map((n) => [n.revision, []]));
  for (const node of nodes) {
    for (const parent of [...node.down_revision, ...node.depends_on]) {
      if (!byId.has(parent)) continue;
      indegree.set(node.revision, indegree.get(node.revision) + 1);
      children.get(parent).push(node.revision);
    }
  }
  const ready = nodes
    .filter((n) => n.revision && indegree.get(n.revision) === 0)
    .map((n) => n.revision)
    .sort();
  const ordered = [];
  while (ready.length) {
    const id = ready.shift();
    ordered.push(id);
    for (const child of children.get(id).sort()) {
      indegree.set(child, indegree.get(child) - 1);
      if (indegree.get(child) === 0) {
        ready.push(child);
        ready.sort();
      }
    }
  }
  const cyclic = nodes
    .filter((n) => n.revision && indegree.get(n.revision) > 0)
    .map((n) => n.revision)
    .sort();
  if (cyclic.length)
    errors.push(`cycle detected involving revisions: ${cyclic.join(", ")}`);
  return { ordered, cyclic };
}

/** Read and analyze literal Alembic revision metadata without executing Python. */
export async function analyzeAlembicVersionsDirectory(versionsDir) {
  const dir = path.resolve(versionsDir);
  const directoryStat = await stat(dir);
  if (!directoryStat.isDirectory())
    throw new Error("versionsDir must be a directory");
  const entries = await readdir(dir, { withFileTypes: true });
  const files = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".py"))
    .map((e) => e.name)
    .sort();
  if (files.length > MAX_FILES)
    throw new Error(`versions directory exceeds ${MAX_FILES} Python files`);
  const nodes = [];
  const errors = [];
  let totalBytes = 0;
  for (const filename of files) {
    const fullPath = path.join(dir, filename);
    const fileStat = await stat(fullPath);
    if (fileStat.size > MAX_FILE_BYTES) {
      errors.push(`${filename}: exceeds ${MAX_FILE_BYTES} byte limit`);
      continue;
    }
    totalBytes += fileStat.size;
    if (totalBytes > MAX_TOTAL_BYTES)
      throw new Error(
        `versions directory exceeds ${MAX_TOTAL_BYTES} total bytes`,
      );
    const source = await readFile(fullPath, "utf8");
    const assignments = extractAssignments(source);
    const nodeErrors = [];
    const values = {};
    for (const field of FIELDS) {
      const assignment = assignments.get(field);
      if (!assignment) {
        if (field === "revision")
          nodeErrors.push("missing revision assignment");
        continue;
      }
      if (assignment.duplicate)
        nodeErrors.push(`duplicate ${field} assignment`);
      try {
        values[field] = parseLiteral(assignment.expression);
      } catch (error) {
        nodeErrors.push(`malformed ${field} assignment: ${error.message}`);
      }
    }
    if (typeof values.revision !== "string" || !values.revision)
      nodeErrors.push("revision must be a non-empty string literal");
    for (const field of ["down_revision", "branch_labels", "depends_on"]) {
      if (field in values) normalizeRefs(values[field], field, nodeErrors);
    }
    const normalized = (field) =>
      field in values ? normalizeRefs(values[field], field, []) : [];
    nodes.push({
      revision: typeof values.revision === "string" ? values.revision : null,
      down_revision: normalized("down_revision"),
      branch_labels: normalized("branch_labels"),
      depends_on: normalized("depends_on"),
      message: firstLineMessage(source),
      filename,
      errors: nodeErrors,
    });
    errors.push(...nodeErrors.map((error) => `${filename}: ${error}`));
  }
  const ids = new Map();
  for (const node of nodes)
    if (node.revision) {
      if (ids.has(node.revision))
        errors.push(
          `duplicate revision id ${node.revision} in ${ids.get(node.revision)} and ${node.filename}`,
        );
      else ids.set(node.revision, node.filename);
    }
  const known = new Set(nodes.map((n) => n.revision).filter(Boolean));
  for (const node of nodes)
    for (const id of [...node.down_revision, ...node.depends_on]) {
      if (!known.has(id))
        errors.push(
          `${node.filename}: missing ${node.depends_on.includes(id) ? "dependency" : "parent"} revision ${id}`,
        );
    }
  const heads = revisionHeads(nodes);
  const { ordered, cyclic } = sortGraph(nodes, errors);
  return { nodes, heads, topologicalOrder: ordered, errors, cyclic };
}

/** Compare repository graph state with one or more database current revisions. */
export function compareAlembicRevisions(nodes, databaseRevisions) {
  const values = Array.isArray(databaseRevisions)
    ? databaseRevisions
    : databaseRevisions == null
      ? []
      : [databaseRevisions];
  const byId = new Map(
    nodes
      .filter((n) => typeof n.revision === "string")
      .map((n) => [n.revision, n]),
  );
  const unknownDatabaseRevisions = [
    ...new Set(values.filter((id) => !byId.has(id))),
  ].sort();
  const knownDatabaseRevisions = [
    ...new Set(values.filter((id) => byId.has(id))),
  ].sort();
  const applied = new Set();
  const visit = (id) => {
    if (!byId.has(id) || applied.has(id)) return;
    applied.add(id);
    const n = byId.get(id);
    for (const parent of [...(n.down_revision ?? []), ...(n.depends_on ?? [])])
      visit(parent);
  };
  knownDatabaseRevisions.forEach(visit);
  const repoHeads = revisionHeads(nodes);
  const pendingRevisions = nodes
    .map((n) => n.revision)
    .filter((id) => id && !applied.has(id))
    .sort();
  const diagnostics = [];
  if (unknownDatabaseRevisions.length)
    diagnostics.push(
      `unknown database revisions: ${unknownDatabaseRevisions.join(", ")}`,
    );
  if (knownDatabaseRevisions.length > 1)
    diagnostics.push("multiple database current revisions detected");
  const currentSets = knownDatabaseRevisions.map((id) => {
    const set = new Set();
    const walk = (rid) => {
      if (!byId.has(rid) || set.has(rid)) return;
      set.add(rid);
      const n = byId.get(rid);
      [...(n.down_revision ?? []), ...(n.depends_on ?? [])].forEach(walk);
    };
    walk(id);
    return set;
  });
  if (
    currentSets.some((set, i) =>
      currentSets
        .slice(i + 1)
        .some(
          (other) =>
            [...set].some((id) => !other.has(id)) &&
            [...other].some((id) => !set.has(id)),
        ),
    )
  )
    diagnostics.push("database current revisions are divergent");
  return {
    repoHeads,
    knownDatabaseRevisions,
    appliedAncestors: [...applied].sort(),
    pendingRevisions,
    unknownDatabaseRevisions,
    diagnostics,
  };
}
