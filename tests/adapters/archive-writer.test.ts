import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { YazlArchiveWriter } from "../../src/adapters/archive/index.ts";

test("YazlArchiveWriter writes ZIP files through the archive adapter", async () => {
  const parent = mkdtempSync(join(tmpdir(), "asagao-archive-"));
  try {
    const source = join(parent, "README.md");
    const destination = join(parent, "workspace.zip");
    writeFileSync(source, "hello\n");

    const writer = new YazlArchiveWriter();
    const result = await writer.writeZip({
      destinationPath: destination,
      entries: [{ absolutePath: source, archivePath: "README.md", sizeBytes: statSync(source).size }],
    });

    assert.equal(result.entriesWritten, 1);
    assert.equal(result.totalBytes, 6);
    assert.equal(existsSync(destination), true);
    assert.equal(readFileSync(destination).subarray(0, 2).toString("utf8"), "PK");
  } finally {
    rmSync(parent, { recursive: true, force: true });
  }
});
