import { createWriteStream } from "node:fs";
import { basename } from "node:path";
import { pipeline } from "node:stream/promises";
import { ZipFile } from "yazl";
import { AdapterError, ADAPTER_ERROR_CODES } from "../errors.ts";
import type { ArchiveWriter, ArchiveWriteRequest, ArchiveWriteResult } from "./archive-writer.ts";

export class YazlArchiveWriter implements ArchiveWriter {
  async writeZip(request: ArchiveWriteRequest): Promise<ArchiveWriteResult> {
    const zipFile = new ZipFile();
    let totalBytes = 0;

    try {
      for (const entry of request.entries) {
        const archivePath = normalizeArchivePath(entry.archivePath);
        zipFile.addFile(entry.absolutePath, archivePath);
        totalBytes += entry.sizeBytes;
      }

      zipFile.end();
      await pipeline(zipFile.outputStream, createWriteStream(request.destinationPath, { flags: "wx" }));

      return {
        destinationPath: request.destinationPath,
        entriesWritten: request.entries.length,
        totalBytes,
      };
    } catch (error) {
      throw new AdapterError({
        operation: "archive.write_zip",
        code: ADAPTER_ERROR_CODES.archiveFailed,
        message: "ZIP archive writing failed.",
        details: {
          destinationName: basename(request.destinationPath),
          entries: request.entries.length,
        },
        cause: error,
      });
    }
  }
}

function normalizeArchivePath(path: string): string {
  const normalized = path.replaceAll("\\", "/").replace(/^\/+/, "");
  if (normalized.length === 0 || normalized.includes("\0") || normalized.split("/").includes("..")) {
    throw new AdapterError({
      operation: "archive.normalize_path",
      code: ADAPTER_ERROR_CODES.archiveFailed,
      message: "Archive entry path is invalid.",
    });
  }

  return normalized;
}
