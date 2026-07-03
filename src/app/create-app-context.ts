import { type AppConfig, loadConfig } from "../config/env.ts";
import { LocalGitAdapter } from "../adapters/git/index.ts";
import { LocalWorkspaceTraversal } from "../adapters/files/index.ts";
import { YazlArchiveWriter, type ArchiveWriter } from "../adapters/archive/index.ts";
import { PinoDiagnosticsLogger, type DiagnosticsLogger } from "../adapters/logging/index.ts";
import { ExecaProcessRunner, type ProcessRunner } from "../adapters/process/index.ts";
import { PQueueJobQueue, type JobQueue } from "../adapters/queue/index.ts";
import { LocalWorkspaceFilesystem } from "../services/local-workspace-filesystem.ts";
import { WorkspaceInspectionService } from "../services/workspace-inspection-service.ts";
import { WorkspaceGitService } from "../services/workspace-git-service.ts";
import { WorkspaceLifecycleService } from "../services/workspace-lifecycle-service.ts";
import { WorkspacePatchService } from "../services/workspace-patch-service.ts";
import { CommandJobService } from "../services/command-job-service.ts";
import {
  WorkspaceRegistry,
  type Clock,
  type WorkspaceIdFactory,
} from "../services/workspace-registry.ts";
import { InMemoryWorkspaceStore } from "../storage/in-memory-workspace-store.ts";
import { InMemoryWorkspaceLifecycleStore } from "../storage/in-memory-workspace-lifecycle-store.ts";
import { InMemoryCommandJobStore } from "../storage/in-memory-command-job-store.ts";
import {
  createRunnerSecurityServices,
  type RunnerSecurityServices,
} from "../security/index.ts";

export type AppServices = {
  diagnosticsLogger: DiagnosticsLogger;
  processRunner: ProcessRunner;
  jobQueue: JobQueue;
  archiveWriter: ArchiveWriter;
  workspaceStore: InMemoryWorkspaceStore;
  workspaceFilesystem: LocalWorkspaceFilesystem;
  workspaceRegistry: WorkspaceRegistry;
  workspaceLifecycleStore: InMemoryWorkspaceLifecycleStore;
  commandJobStore: InMemoryCommandJobStore;
  workspaceLifecycleService: WorkspaceLifecycleService;
  workspaceInspectionService: WorkspaceInspectionService;
  workspaceGitService: WorkspaceGitService;
  workspacePatchService: WorkspacePatchService;
  commandJobService: CommandJobService;
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
  const commandJobStore = new InMemoryCommandJobStore();
  const workspaceRegistry = new WorkspaceRegistry({
    store: workspaceStore,
    filesystem: workspaceFilesystem,
    ...(clock === undefined ? {} : { clock }),
    ...(createWorkspaceId === undefined ? {} : { createId: createWorkspaceId }),
  });

  const security = createRunnerSecurityServices();
  const diagnosticsLogger = new PinoDiagnosticsLogger({ logMasker: security.logMasker });
  const processRunner = new ExecaProcessRunner();
  const jobQueue = new PQueueJobQueue();
  const gitAdapter = new LocalGitAdapter(processRunner);
  const traversal = new LocalWorkspaceTraversal();
  const archiveWriter = new YazlArchiveWriter();
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
    traversal,
    ...(clock === undefined ? {} : { clock }),
  });
  const workspaceGitService = new WorkspaceGitService({
    workspaceRegistry,
    workspaceFilesystem,
    security,
    gitAdapter,
    ...(clock === undefined ? {} : { clock }),
  });
  const workspacePatchService = new WorkspacePatchService({
    workspaceRegistry,
    workspaceFilesystem,
    security,
    gitAdapter,
    workspaceLifecycleService,
    ...(clock === undefined ? {} : { clock }),
  });
  const commandJobService = new CommandJobService({
    workspaceRegistry,
    workspaceFilesystem,
    security,
    processRunner,
    jobQueue,
    jobStore: commandJobStore,
    workspaceLifecycleService,
    diagnosticsLogger,
    ...(clock === undefined ? {} : { clock }),
  });

  return Object.freeze({
    diagnosticsLogger,
    processRunner,
    jobQueue,
    archiveWriter,
    workspaceStore,
    workspaceFilesystem,
    workspaceRegistry,
    workspaceLifecycleStore,
    commandJobStore,
    workspaceLifecycleService,
    workspaceInspectionService,
    workspaceGitService,
    workspacePatchService,
    commandJobService,
    security,
  });
}
