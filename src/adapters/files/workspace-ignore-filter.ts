import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import ignore, { type Ignore } from "ignore";

export type WorkspaceIgnoreFilter = {
  ignores: (relativePath: string) => boolean;
};

export function createWorkspaceIgnoreFilter(workspaceDirectory: string): WorkspaceIgnoreFilter {
  const matcher = ignore();
  const gitignorePath = join(workspaceDirectory, ".gitignore");

  if (existsSync(gitignorePath)) {
    matcher.add(readFileSync(gitignorePath, "utf8"));
  }

  return new IgnoreWorkspaceFilter(matcher);
}

class IgnoreWorkspaceFilter implements WorkspaceIgnoreFilter {
  readonly #matcher: Ignore;

  constructor(matcher: Ignore) {
    this.#matcher = matcher;
  }

  ignores(relativePath: string): boolean {
    if (relativePath === ".") {
      return false;
    }

    return this.#matcher.ignores(relativePath) || this.#matcher.ignores(`${relativePath}/`);
  }
}
