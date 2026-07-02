import { type AppConfig, loadConfig } from "../config/env.ts";
import { LocalWorkspaceFilesystem } from "../services/local-workspace-filesystem.ts";
import {
  WorkspaceRegistry,
  type Clock,
  type WorkspaceIdFactory,
} from "../services/workspace-registry.ts";
import { InMemoryWorkspaceStore } from "../storage/in-memory-workspace-store.ts";
import {
  createRunnerSecurityServices,
  type RunnerSecurityServices,
} from "../security/index.ts";

export type AppServices = {
  workspaceStore: InMemoryWorkspaceStore;
  workspaceFilesystem: LocalWorkspaceFilesystem;
  workspaceRegistry: WorkspaceRegistry;
  security: RunnerSecurityServices;
};

export type CreateAppContextOptions = {
  config?: AppConfig;
  clock?: Clock;
  createWorkspaceId?: WorkspaceIdFactory;
};

export function createAppContext({
  config = loadConfig(),
  clock,
  createWorkspaceId,
}: CreateAppContextOptions = {}): AppServices {
  const workspaceStore = new InMemoryWorkspaceStore();
  const workspaceFilesystem = new LocalWorkspaceFilesystem({
    workspaceRoot: config.workspace.rootPath,
  });
  const workspaceRegistry = new WorkspaceRegistry({
    store: workspaceStore,
    filesystem: workspaceFilesystem,
    ...(clock === undefined ? {} : { clock }),
    ...(createWorkspaceId === undefined ? {} : { createId: createWorkspaceId }),
  });

  const security = createRunnerSecurityServices();

  return Object.freeze({
    workspaceStore,
    workspaceFilesystem,
    workspaceRegistry,
    security,
  });
}
