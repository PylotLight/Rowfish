import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { expect, test } from "bun:test";

const python = process.platform === "win32" ? "python" : "python3";
const helperPath = fileURLToPath(
  new URL("./alembic-model-compare.py", import.meta.url),
);
const pythonCheck = spawnSync(
  python,
  [
    "-c",
    `
import importlib.util, json, sys
spec = importlib.util.spec_from_file_location("rowfish_compare", sys.argv[1])
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
class Column:
    name = "email"
class AddColumnOp:
    schema = "public"
    table_name = "accounts"
    column = Column()
class CreateIndexOp:
    schema = "public"
    table_name = "accounts"
    index_name = "ix_accounts_email"
print(json.dumps([
    module.describe_operation(AddColumnOp()),
    module.describe_operation(CreateIndexOp()),
]))
`,
    helperPath,
  ],
  { encoding: "utf8" },
);

if (pythonCheck.error) {
  test.skip("Alembic model operation descriptions (Python 3 required)", () => {});
} else {
  test("Alembic model operation descriptions", () => {
    expect(pythonCheck.status).toBe(0);
    expect(JSON.parse(pythonCheck.stdout)).toEqual([
      {
        kind: "add-column",
        description: "Add column email to public.accounts",
      },
      {
        kind: "create-index",
        description: "Create index ix_accounts_email on public.accounts",
      },
    ]);
  });
}
