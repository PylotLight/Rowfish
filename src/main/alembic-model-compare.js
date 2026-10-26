import { spawn } from "node:child_process";
import { access } from "node:fs/promises";
import path from "node:path";
import pythonHelper from "./alembic-model-compare.py?raw";

const RESULT_MARKER = "__ROWFISH_RESULT__";
const MAX_OUTPUT_BYTES = 4 * 1024 * 1024;
const TIMEOUT_MS = 60_000;

/** @typedef {import("../shared/database").AlembicModelComparison} AlembicModelComparison */

async function isExecutableFile(file) {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

async function chooseInterpreter(configPath, requestedPath) {
  if (requestedPath) {
    const resolved = path.resolve(requestedPath);
    if (!(await isExecutableFile(resolved)))
      throw new Error("The selected Python interpreter path does not exist.");
    return resolved;
  }
  const configDirectory = path.dirname(configPath);
  const roots = [
    configDirectory,
    path.dirname(configDirectory),
    path.dirname(path.dirname(configDirectory)),
  ];
  const candidates = [];
  for (const root of roots) {
    candidates.push(
      path.join(root, ".venv", "bin", "python"),
      path.join(root, "venv", "bin", "python"),
      path.join(root, ".venv", "Scripts", "python.exe"),
      path.join(root, "venv", "Scripts", "python.exe"),
    );
  }
  for (const candidate of candidates)
    if (await isExecutableFile(candidate)) return candidate;
  return process.platform === "win32" ? "python" : "python3";
}

function helperEnvironment() {
  const allowed = [
    "PATH",
    "HOME",
    "TMPDIR",
    "TMP",
    "TEMP",
    "LANG",
    "LC_ALL",
    "SYSTEMROOT",
    "WINDIR",
    "VIRTUAL_ENV",
  ];
  const environment = Object.fromEntries(
    allowed
      .filter((key) => process.env[key] !== undefined)
      .map((key) => [key, process.env[key]]),
  );
  environment.PYTHONUTF8 = "1";
  environment.PYTHONIOENCODING = "utf-8";
  return environment;
}

/**
 * @param {{configPath: string, pythonPath?: string, connection: Pick<import("../shared/database").DatabaseConnectionInput, "host" | "port" | "database" | "username" | "password" | "tls" | "sslMode">}} input
 * @returns {Promise<AlembicModelComparison>}
 */
export async function compareAlembicModelState({
  configPath,
  pythonPath = "",
  connection,
}) {
  const interpreter = await chooseInterpreter(configPath, pythonPath);
  return await new Promise((resolve, reject) => {
    const child = spawn(interpreter, ["-c", pythonHelper], {
      cwd: path.dirname(configPath),
      env: helperEnvironment(),
      shell: false,
      stdio: ["pipe", "pipe", "ignore"],
    });
    let stdout = "";
    let settled = false;
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      finish(new Error("Model comparison timed out after 60 seconds."));
    }, TIMEOUT_MS);
    const finish = (error, result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (error) reject(error);
      else resolve(result);
    };
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
      if (Buffer.byteLength(stdout) > MAX_OUTPUT_BYTES) {
        child.kill("SIGKILL");
        finish(
          new Error("Model comparison output exceeded the 4 MB safety limit."),
        );
      }
    });
    child.once("error", () =>
      finish(
        new Error(
          "Could not start Python. Select a project interpreter or install Python 3.",
        ),
      ),
    );
    child.once("close", (code) => {
      if (settled) return;
      const markerIndex = stdout.lastIndexOf(RESULT_MARKER);
      if (markerIndex < 0) {
        finish(
          new Error(
            "The Python environment returned no comparison result. Check that Alembic, SQLAlchemy, and a PostgreSQL driver are installed.",
          ),
        );
        return;
      }
      let result;
      try {
        result = JSON.parse(
          stdout.slice(markerIndex + RESULT_MARKER.length).trim(),
        );
      } catch {
        finish(
          new Error("The Python environment returned invalid comparison data."),
        );
        return;
      }
      if (code !== 0 || !result.ok) {
        finish(new Error(result.error || "Model comparison failed."));
        return;
      }
      const { ok: _ok, ...comparison } = result;
      finish(undefined, /** @type {AlembicModelComparison} */ (comparison));
    });
    child.stdin.on("error", () => undefined);
    child.stdin.end(JSON.stringify({ configPath, connection }));
  });
}
