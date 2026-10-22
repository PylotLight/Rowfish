#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

function parseArgs(args) {
  const options = { version: "", dryRun: false };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--version") options.version = args[++i] ?? "";
    else if (args[i] === "--dry-run") options.dryRun = true;
    else throw new Error(`Unknown argument: ${args[i]}`);
  }
  return options;
}

function stableVersion(value) {
  const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(value);
  if (!match)
    throw new Error(
      `Expected a stable semantic version (x.y.z), got: ${value}`,
    );
  return match.slice(1).map(Number);
}

function compare(a, b) {
  const left = stableVersion(a);
  const right = stableVersion(b);
  for (let i = 0; i < 3; i++)
    if (left[i] !== right[i]) return left[i] - right[i];
  return 0;
}

const { version: requested, dryRun } = parseArgs(process.argv.slice(2));
const packagePath = resolve(process.env.PACKAGE_JSON ?? "package.json");
const packageJson = JSON.parse(await readFile(packagePath, "utf8"));
const current = packageJson.devDependencies?.electron;
if (typeof current !== "string")
  throw new Error(
    "package.json devDependencies.electron must be a version string",
  );
let target = requested;
if (!target) {
  const response = await fetch("https://registry.npmjs.org/electron/latest", {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok)
    throw new Error(`npm registry request failed: HTTP ${response.status}`);
  target = (await response.json()).version;
}
stableVersion(target);
stableVersion(current);
if (compare(target, current) < 0)
  throw new Error(`Refusing Electron downgrade: ${current} -> ${target}`);
if (target === current) {
  console.log(JSON.stringify({ current, target, changed: false, dryRun }));
} else {
  console.log(JSON.stringify({ current, target, changed: true, dryRun }));
  if (!dryRun) {
    packageJson.devDependencies.electron = target;
    await writeFile(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`);
  }
}
