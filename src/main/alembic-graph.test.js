import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  analyzeAlembicVersionsDirectory,
  compareAlembicRevisions,
} from "./alembic-graph.js";

let root;
async function versions(files) {
  root = await mkdtemp(path.join(os.tmpdir(), "alembic-graph-"));
  const dir = path.join(root, "versions");
  await mkdir(dir);
  for (const [name, source] of Object.entries(files))
    await writeFile(path.join(dir, name), source);
  return dir;
}
afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true });
  root = undefined;
});

describe("analyzeAlembicVersionsDirectory", () => {
  test("orders a linear history deterministically and compares applied ancestors", async () => {
    const dir = await versions({
      "02.py": `revision = 'b'\ndown_revision = 'a'\n`,
      "01.py": `revision = 'a'\ndown_revision = None\n`,
      "03.py": `revision = 'c'\ndown_revision = 'b'\n`,
    });
    const graph = await analyzeAlembicVersionsDirectory(dir);
    expect(graph.topologicalOrder).toEqual(["a", "b", "c"]);
    expect(graph.heads).toEqual(["c"]);
    expect(graph.errors).toEqual([]);
    expect(compareAlembicRevisions(graph.nodes, "b")).toMatchObject({
      appliedAncestors: ["a", "b"],
      pendingRevisions: ["c"],
    });
  });

  test("handles parallel branches, multiple heads, and a mergepoint", async () => {
    const dir = await versions({
      "root.py": `revision='root'\ndown_revision=None`,
      "left.py": `revision='left'\ndown_revision='root'\nbranch_labels=('left_branch',)`,
      "right.py": `revision='right'\ndown_revision='root'\nbranch_labels=['right_branch']`,
      "merge.py": `revision='merge'\ndown_revision=('left','right')`,
    });
    const graph = await analyzeAlembicVersionsDirectory(dir);
    expect(graph.topologicalOrder).toEqual(["root", "left", "right", "merge"]);
    expect(graph.heads).toEqual(["merge"]);
    expect(
      graph.nodes.find((n) => n.revision === "left").branch_labels,
    ).toEqual(["left_branch"]);
  });

  test("keeps dependency-only revisions as branch heads", async () => {
    const dir = await versions({
      "base.py": `revision='base'\ndown_revision=None`,
      "dependent.py": `revision='dependent'\ndown_revision=None\ndepends_on='base'`,
    });
    const graph = await analyzeAlembicVersionsDirectory(dir);
    expect(graph.topologicalOrder).toEqual(["base", "dependent"]);
    expect(graph.heads).toEqual(["base", "dependent"]);
  });

  test("reports several known database currents and unknown values", async () => {
    const dir = await versions({
      "base.py": `revision='base'\ndown_revision=None`,
      "a.py": `revision='a'\ndown_revision='base'`,
      "b.py": `revision='b'\ndown_revision='base'`,
    });
    const graph = await analyzeAlembicVersionsDirectory(dir);
    const state = compareAlembicRevisions(graph.nodes, ["a", "b", "missing"]);
    expect(state.repoHeads).toEqual(["a", "b"]);
    expect(state.knownDatabaseRevisions).toEqual(["a", "b"]);
    expect(state.appliedAncestors).toEqual(["a", "b", "base"]);
    expect(state.pendingRevisions).toEqual([]);
    expect(state.unknownDatabaseRevisions).toEqual(["missing"]);
    expect(state.diagnostics.join(" ")).toContain("unknown database revisions");
  });

  test("detects missing parent and dependency ids", async () => {
    const dir = await versions({
      "orphan.py": `revision='orphan'\ndown_revision='gone'\ndepends_on='also_gone'`,
    });
    const graph = await analyzeAlembicVersionsDirectory(dir);
    expect(graph.errors.join(" ")).toContain("missing parent revision gone");
    expect(graph.errors.join(" ")).toContain(
      "missing dependency revision also_gone",
    );
  });

  test("detects duplicate revision identifiers", async () => {
    const dir = await versions({
      "a.py": `revision='same'\ndown_revision=None`,
      "b.py": `revision='same'\ndown_revision=None`,
    });
    expect(
      (await analyzeAlembicVersionsDirectory(dir)).errors.join(" "),
    ).toContain("duplicate revision id same");
  });

  test("detects a cycle", async () => {
    const dir = await versions({
      "a.py": `revision='a'\ndown_revision='b'`,
      "b.py": `revision='b'\ndown_revision='a'`,
    });
    const graph = await analyzeAlembicVersionsDirectory(dir);
    expect(graph.cyclic).toEqual(["a", "b"]);
    expect(graph.errors.join(" ")).toContain("cycle detected");
  });

  test("parses literal tuple/list metadata and ignores comments and string noise", async () => {
    const dir = await versions({
      "root.py": `"""Root message"""\nrevision = 'root' # down_revision = 'fake'\ndown_revision = None\n# revision = 'noise'\nnoise = "revision = 'also-noise' # not syntax"`,
      "merge.py": `revision = 'm'\ndown_revision = ('root',)\nbranch_labels = ['one', 'two']\ndepends_on = ('root',)`,
    });
    const graph = await analyzeAlembicVersionsDirectory(dir);
    expect(graph.nodes.find((n) => n.revision === "root").message).toBe(
      "Root message",
    );
    expect(graph.nodes.find((n) => n.revision === "m")).toMatchObject({
      down_revision: ["root"],
      branch_labels: ["one", "two"],
      depends_on: ["root"],
    });
    expect(graph.errors).toEqual([]);
  });

  test("reports malformed and nonliteral assignments, and incomplete revisions", async () => {
    const dir = await versions({
      "dynamic.py": `revision = make_revision()\ndown_revision = BASE`,
      "incomplete.py": `down_revision = None`,
    });
    const graph = await analyzeAlembicVersionsDirectory(dir);
    expect(graph.errors.join(" ")).toContain("malformed revision assignment");
    expect(graph.errors.join(" ")).toContain(
      "malformed down_revision assignment",
    );
    expect(graph.errors.join(" ")).toContain("missing revision assignment");
  });
});
