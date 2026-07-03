import { z } from "zod";
import { workspaceIdSchema } from "./workspace.ts";

export const workspaceFileEntryTypes = ["file", "directory", "symlink", "other"] as const;

export const workspaceFileEntryTypeSchema = z.enum(workspaceFileEntryTypes);

export const workspaceFileTreeEntrySchema = z
  .object({
    path: z.string().min(1),
    type: workspaceFileEntryTypeSchema,
    depth: z.number().int().nonnegative(),
    sizeBytes: z.number().int().nonnegative().optional(),
    modifiedAt: z.string().datetime().optional(),
  })
  .strict();

export const workspaceFileTreeLimitsSchema = z
  .object({
    maxDepth: z.number().int().nonnegative(),
    maxEntries: z.number().int().positive(),
  })
  .strict();

export const workspaceFileTreeDataSchema = z
  .object({
    workspaceId: workspaceIdSchema,
    rootPath: z.string().min(1),
    entries: z.array(workspaceFileTreeEntrySchema),
    truncated: z.boolean(),
    omittedCount: z.number().int().nonnegative(),
    limits: workspaceFileTreeLimitsSchema,
  })
  .strict();

export const workspaceTextFileReadSchema = z
  .object({
    path: z.string().min(1),
    encoding: z.literal("utf8"),
    binary: z.literal(false),
    sizeBytes: z.number().int().nonnegative(),
    startLine: z.number().int().positive(),
    endLine: z.number().int().nonnegative(),
    returnedLines: z.number().int().nonnegative(),
    returnedBytes: z.number().int().nonnegative(),
    scannedBytes: z.number().int().nonnegative(),
    truncated: z.boolean(),
    content: z.string(),
  })
  .strict();

export const workspaceReadFileLimitsSchema = z
  .object({
    maxLines: z.number().int().positive(),
    maxBytes: z.number().int().positive(),
  })
  .strict();

export const workspaceReadFileDataSchema = z
  .object({
    workspaceId: workspaceIdSchema,
    file: workspaceTextFileReadSchema,
    limits: workspaceReadFileLimitsSchema,
  })
  .strict();

export const workspaceSearchMatchSchema = z
  .object({
    path: z.string().min(1),
    lineNumber: z.number().int().positive(),
    lineText: z.string(),
    lineTruncated: z.boolean(),
    matchStart: z.number().int().nonnegative(),
    matchEnd: z.number().int().positive(),
  })
  .strict();

export const workspaceSearchSkippedFilesSchema = z
  .object({
    binary: z.number().int().nonnegative(),
    tooLarge: z.number().int().nonnegative(),
    denied: z.number().int().nonnegative(),
    ignored: z.number().int().nonnegative().optional(),
    unreadable: z.number().int().nonnegative(),
  })
  .strict();

export const workspaceSearchLimitsSchema = z
  .object({
    maxResults: z.number().int().positive(),
    maxFileBytes: z.number().int().positive(),
    maxLineTextBytes: z.number().int().positive(),
  })
  .strict();

export const workspaceSearchDataSchema = z
  .object({
    workspaceId: workspaceIdSchema,
    query: z.string().min(1),
    rootPath: z.string().min(1),
    caseSensitive: z.boolean(),
    matches: z.array(workspaceSearchMatchSchema),
    truncated: z.boolean(),
    searchedFiles: z.number().int().nonnegative(),
    skippedFiles: workspaceSearchSkippedFilesSchema,
    limits: workspaceSearchLimitsSchema,
  })
  .strict();

export type WorkspaceFileEntryType = z.infer<typeof workspaceFileEntryTypeSchema>;
export type WorkspaceFileTreeEntry = z.infer<typeof workspaceFileTreeEntrySchema>;
export type WorkspaceFileTreeData = z.infer<typeof workspaceFileTreeDataSchema>;
export type WorkspaceTextFileRead = z.infer<typeof workspaceTextFileReadSchema>;
export type WorkspaceReadFileData = z.infer<typeof workspaceReadFileDataSchema>;
export type WorkspaceSearchMatch = z.infer<typeof workspaceSearchMatchSchema>;
export type WorkspaceSearchData = z.infer<typeof workspaceSearchDataSchema>;
