import { z } from "zod";
import { createPrefixedIdSchema, isoDateTimeSchema } from "./common.ts";
import { workspaceIdSchema } from "./workspace.ts";

export const artifactKinds = ["file", "archive", "log", "diff"] as const;

export const artifactKindSchema = z.enum(artifactKinds);
export const artifactIdSchema = createPrefixedIdSchema("art");

export const artifactSchema = z
  .object({
    artifactId: artifactIdSchema,
    workspaceId: workspaceIdSchema,
    kind: artifactKindSchema,
    name: z.string().min(1),
    createdAt: isoDateTimeSchema,
  })
  .strict();

export type ArtifactKind = z.infer<typeof artifactKindSchema>;
export type Artifact = z.infer<typeof artifactSchema>;
