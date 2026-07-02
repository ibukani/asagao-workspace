import { statSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

const TARGETS = ["server.js", "scripts", "src", "tests"];

for (const target of TARGETS) {
  for (const filePath of collectJavaScriptFiles(target)) {
    execFileSync(process.execPath, ["--check", filePath], { stdio: "inherit" });
  }
}

function* collectJavaScriptFiles(path) {
  let stat;

  try {
    stat = statSync(path);
  } catch (error) {
    if (error?.code === "ENOENT") {
      return;
    }
    throw error;
  }

  if (stat.isFile()) {
    if (path.endsWith(".js")) {
      yield path;
    }
    return;
  }

  if (!stat.isDirectory()) {
    return;
  }

  for (const entry of readdirSync(path, { withFileTypes: true })) {
    const entryPath = join(path, entry.name);
    if (entry.isDirectory()) {
      yield* collectJavaScriptFiles(entryPath);
      continue;
    }

    if (entry.isFile() && entry.name.endsWith(".js")) {
      yield entryPath;
    }
  }
}
