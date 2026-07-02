import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const REPO_ROOT = new URL("..", import.meta.url).pathname;

const forbiddenDependencies = [
  {
    layer: "filesystem",
    directory: "src/filesystem",
    forbiddenPattern: /from\s+["'][^"']*\/tools\//,
    reason: "filesystem boundaries must not depend on tool contracts or handlers",
  },
  {
    layer: "services",
    directory: "src/services",
    forbiddenPattern: /from\s+["'][^"']*\/tools\//,
    reason: "services must not depend on tool contracts or handlers",
  },
  {
    layer: "storage",
    directory: "src/storage",
    forbiddenPattern: /from\s+["'][^"']*\/tools\//,
    reason: "storage must not depend on tool contracts or handlers",
  },
] as const;

test("lower-level layers do not import from tool modules", () => {
  for (const rule of forbiddenDependencies) {
    for (const filePath of collectTypeScriptFiles(join(REPO_ROOT, rule.directory))) {
      const source = readFileSync(filePath, "utf8");

      assert.equal(
        rule.forbiddenPattern.test(source),
        false,
        `${rule.layer} boundary violation in ${filePath}: ${rule.reason}`,
      );
    }
  }
});

function* collectTypeScriptFiles(path: string): Generator<string> {
  const stat = statSync(path);

  if (stat.isFile()) {
    if (path.endsWith(".ts")) {
      yield path;
    }
    return;
  }

  for (const entry of readdirSync(path, { withFileTypes: true })) {
    const entryPath = join(path, entry.name);
    if (entry.isDirectory()) {
      yield* collectTypeScriptFiles(entryPath);
      continue;
    }

    if (entry.isFile() && entry.name.endsWith(".ts")) {
      yield entryPath;
    }
  }
}
