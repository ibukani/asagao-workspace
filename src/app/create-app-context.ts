import { type AppConfig, loadConfig } from "../config/env.ts";
import { LocalWorkspaceFilesystem } from "../services/local-workspace-filesystem.ts";
import { WorkspaceInspectionService } from "../services/workspace-inspection-service.ts";
import { WorkspaceGitService } from "../services/workspace-git-service.ts";
import { WorkspaceLifecycleService } from "../services/workspace-lifecycle-service.ts";
import {
  WorkspaceRegistry,
  type Clock,
  type WorkspaceIdFactory,
} from "../services/workspace-registry.ts";
import { InMemoryWorkspaceStore } from "../storage/in-memory-workspace-store.ts";
import { InMemoryWorkspaceLifecycleStore } from "../storage/in-memory-workspace-lifecycle-store.ts";
import {
  createRunnerSecurityServices,
  type RunnerSecurityServices,
} from "../security/index.ts";

export type AppServices = {
  workspaceStore: InMemoryWorkspaceStore;
  workspaceFilesystem: LocalWorkspaceFilesystem;
  workspaceRegistry: WorkspaceRegistry;
  workspaceLifecycleStore: InMemoryWorkspaceLifecycleStore;
  workspaceLifecycleService: WorkspaceLifecycleService;
  workspaceInspectionService: WorkspaceInspectionService;
  workspaceGitService: WorkspaceGitService;
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
  const workspaceLifecycleStore = new InMemoryWorkspaceLifecycleStore();
  const workspaceRegistry = new WorkspaceRegistry({
    store: workspaceStore,
    filesystem: workspaceFilesystem,
    ...(clock === undefined ? {} : { clock }),
    ...(createWorkspaceId === undefined ? {} : { createId: createWorkspaceId }),
  });

  const security = createRunnerSecurityServices();
  const workspaceLifecycleService = new WorkspaceLifecycleService({
    workspaceRegistry,
    lifecycleStore: workspaceLifecycleStore,
    security,
    ...(clock === undefined ? {} : { clock }),
  });
  const workspaceInspectionService = new WorkspaceInspectionService({
    workspaceRegistry,
    workspaceFilesystem,
    security,
    ...(clock === undefined ? {} : { clock }),
  });
  const workspaceGitService = new WorkspaceGitService({
    workspaceRegistry,
    workspaceFilesystem,
    security,
    ...(clock === undefined ? {} : { clock }),
  });

  return Object.freeze({
    workspaceStore,
    workspaceFilesystem,
    workspaceRegistry,
    workspaceLifecycleStore,
    workspaceLifecycleService,
    workspaceInspectionService,
    workspaceGitService,
    security,
  });
}
