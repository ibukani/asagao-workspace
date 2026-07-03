import { closeSync, openSync, readSync } from "node:fs";

export function isBinaryFile(absolutePath: string): boolean {
  const fd = openSync(absolutePath, "r");
  const buffer = Buffer.alloc(8_192);

  try {
    const bytesRead = readSync(fd, buffer, 0, buffer.length, 0);
    return buffer.subarray(0, bytesRead).includes(0);
  } finally {
    closeSync(fd);
  }
}
