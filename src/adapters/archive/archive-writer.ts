export type ArchiveEntry = {
  absolutePath: string;
  archivePath: string;
  sizeBytes: number;
  sha256?: string;
  modifiedAt?: string;
};

export type ArchiveWriteRequest = {
  destinationPath: string;
  entries: readonly ArchiveEntry[];
};

export type ArchiveWriteResult = {
  destinationPath: string;
  entriesWritten: number;
  totalBytes: number;
};

export type ArchiveWriter = {
  writeZip: (request: ArchiveWriteRequest) => Promise<ArchiveWriteResult>;
};
