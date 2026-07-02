# Workspace Runner Design

This document summarizes the intended product and architecture direction for Asagao Workspace.

Asagao Workspace should not become a generic GitHub operation wrapper. Its core role is to provide ChatGPT with a safe, isolated, inspectable development workspace that can apply multi-file changes, run commands, validate results, and export the resulting change set.

## Product position

Asagao Workspace is a ChatGPT App backed by an MCP server and an external Workspace Runner.

```text
ChatGPT
  -> reasoning, planning, review, patch authoring, repair decisions

ChatGPT App / MCP Server
  -> tool contracts, authentication, workspace APIs, structured results, optional UI

Workspace Runner
  -> clone, patch application, file inspection, command execution, logs, artifacts, diff, snapshots

Source host, for example GitHub
  -> repository source of truth, branches, pull requests, CI, reviews
```

The important boundary is that Asagao Workspace is a runner and change-set manager, not a replacement for a source host.

## Goals

- Let ChatGPT work with repositories that need real execution environments, such as Rust, Node.js, Python, or mixed-language projects.
- Let ChatGPT apply and validate multi-file changes as a single change set instead of struggling with one-file-at-a-time upload flows.
- Support patch, script, archive, and later change-set based workflows.
- Run long commands asynchronously and return stable job identifiers.
- Return structured command status, logs, diffs, artifacts, and safety metadata.
- Keep the GitHub integration limited to what is required to materialize or export validated workspace changes.
- Keep the design source-host agnostic so GitHub, GitLab, Bitbucket, zip export, and patch export can share the same internal model.

## Non-goals

- Do not duplicate simple GitHub App or GitHub MCP operations such as listing issues, posting issue comments, reading pull request reviews, or browsing repositories.
- Do not make GitHub the core domain model.
- Do not expose arbitrary local PC control.
- Do not expose broad filesystem or shell execution without a sandbox, policy model, and audit trail.
- Do not make ChatGPT responsible for manually uploading individual repository files.

## Core domain model

### Workspace

A workspace is an isolated working copy plus runtime metadata.

Important fields:

```ts
interface Workspace {
  workspaceId: string;
  status: "creating" | "ready" | "failed" | "deleted";
  source?: RepositorySource;
  baseCommit?: string;
  currentCommit?: string;
  defaultBranch?: string;
  workingBranch?: string;
  runtimeProfile: RuntimeProfile;
  internetPolicy: InternetPolicy;
  createdAt: string;
  expiresAt?: string;
}
```

### Change Set

A change set is the main product concept. It represents a coherent set of workspace modifications and the evidence attached to them.

```ts
interface ChangeSet {
  changeSetId: string;
  workspaceId: string;
  baseCommit?: string;
  changedFiles: ChangedFile[];
  diffstat: DiffStat;
  patchArtifactId?: string;
  testEvidence: CommandEvidence[];
  generatedArtifacts: ArtifactRef[];
  suggestedCommitMessage?: string;
  suggestedPullRequestBody?: string;
  riskLevel?: "low" | "medium" | "high";
}
```

The change set should be usable without GitHub. It can later be exported as a patch, zip archive, git bundle, branch push, or pull request.

### Command Job

Long-running commands must be asynchronous.

```ts
interface CommandJob {
  jobId: string;
  workspaceId: string;
  status: "queued" | "running" | "succeeded" | "failed" | "cancelled" | "timed_out";
  command: string[];
  cwd?: string;
  startedAt?: string;
  finishedAt?: string;
  exitCode?: number;
  logCursor?: string;
}
```

Commands should be represented as argument arrays, not shell strings, unless a specific shell mode is intentionally added later.

## Tool boundary policy

Asagao Workspace tools should be action-oriented and tied to workspace execution, validation, or export.

### Keep out of scope when possible

These are better handled by a dedicated GitHub App, GitHub MCP, or the source host UI:

- list GitHub issues
- list pull requests
- post issue comments
- read pull request review comments
- edit pull request body
- manage notifications
- upload single files to GitHub one by one

### Keep in scope

These are central to Asagao Workspace:

- create and delete isolated workspaces
- clone a repository into a workspace
- apply a patch, patch series, or archive into a workspace
- inspect workspace file tree and selected files
- run commands inside the workspace
- poll command status and logs
- snapshot and restore workspace state
- produce workspace diff and diffstat
- export patch, patch series, zip archive, or git bundle
- prepare a commit-ready change set

GitHub push or pull request creation can be added later, but only as a destination for a validated change set, not as the core product model.

## Proposed MCP tools

### Workspace lifecycle

```text
create_workspace
list_workspaces
get_workspace
delete_workspace
```

`create_workspace` should accept optional repository information:

```ts
interface CreateWorkspaceInput {
  repoUrl?: string;
  branch?: string;
  baseRef?: string;
  workspaceName?: string;
  runtimeProfile?: "rust" | "python" | "node" | "generic";
  internetPolicy?: "none" | "package_registry" | "full";
  ttlMinutes?: number;
}
```

The response should include `workspaceId`, status, base commit, working branch, and expiration metadata.

### Workspace inspection

```text
get_file_tree
read_file
read_files_batch
search_workspace
get_git_status
get_workspace_diff
```

`get_workspace_diff` is a first-class tool because ChatGPT needs to inspect the actual result of patches and command-driven modifications.

### Patch and artifact input

```text
apply_patch
apply_patch_series
upload_artifact
apply_artifact
```

MVP can start with `apply_patch`.

Important response fields:

- whether the patch applied
- conflicts
- changed files
- diffstat
- resulting git status
- diagnostics for failed hunks

### Command execution

```text
run_command
get_command_status
get_command_logs
cancel_command
```

`run_command` should return a `jobId` immediately. Status and logs should be separate tools so long-running commands can be polled safely.

### Snapshot and rollback

```text
create_snapshot
list_snapshots
restore_snapshot
rollback_last_patch
```

Snapshots are important because ChatGPT-generated patches can fail or make the repository worse before they get better.

### Export

```text
export_patch
export_patch_series
export_workspace_archive
export_git_bundle
prepare_change_set
```

The export tools should allow a user or another tool to take the validated work elsewhere.

## Recommended MVP

The first useful version should avoid broad GitHub automation and focus on the runner loop.

```text
create_workspace
list_workspaces
delete_workspace
apply_patch
run_command
get_command_status
get_command_logs
cancel_command
get_file_tree
read_file
get_git_status
get_workspace_diff
create_snapshot
restore_snapshot
export_patch
export_workspace_archive
```

This is enough to support the core loop:

```text
1. Create workspace from repository or empty template.
2. ChatGPT produces a patch or script.
3. Apply patch or artifact.
4. Run validation command.
5. Poll status and logs.
6. Inspect diff and git status.
7. Repair with another patch if needed.
8. Export patch or archive.
```

## Safety requirements

Any file, command, repository, network, or artifact tool must be designed as a sandboxed operation.

Minimum requirements:

- workspace-level isolation
- non-root execution
- CPU, memory, disk, and timeout limits
- explicit internet policy
- no default access to user secrets
- explicit secret injection if secrets are ever supported
- secret masking in logs
- path traversal protection
- symlink handling policy
- patch preflight validation
- repository URL allow/deny policy
- command policy and audit logging
- workspace TTL and cleanup
- artifact size limits
- structured error reporting

The default internet policy should not be full internet access. Recommended policy levels:

```text
none
package_registry
full
```

`package_registry` should be considered for practical builds while still avoiding unrestricted network access.

## UI opportunities

The MCP tools should be useful without UI, but a ChatGPT App iframe can improve review workflows.

Useful UI panels:

- workspace status
- file tree
- changed file list
- diff viewer
- command log viewer
- command status panel
- artifact download panel
- conflict report
- change-set summary

The UI should consume structured tool results instead of becoming the source of truth.

## GitHub integration policy

GitHub integration should be minimal and change-set oriented.

Allowed later additions:

```text
clone_repository
checkout_branch
create_working_branch
prepare_commit
commit_change_set
push_change_set
```

Potentially allowed after the change-set model is stable:

```text
create_pull_request_from_change_set
```

Avoid building simple GitHub wrappers that are already handled by existing GitHub tools.

## Milestones

### Milestone 1: Local scaffold and contracts

- Keep the existing MCP scaffold minimal.
- Add domain-level models for workspace, command job, artifact, snapshot, and change set.
- Add tool contract tests before implementing real execution.

### Milestone 2: Safe local runner prototype

- Implement workspace creation in a controlled local directory.
- Implement patch application.
- Implement asynchronous command jobs.
- Implement status and log polling.
- Add strict timeouts and cleanup.

### Milestone 3: Diff and export

- Implement git status and workspace diff.
- Implement patch export.
- Implement zip archive export.
- Add snapshot and restore.

### Milestone 4: Repository source support

- Add repository clone support.
- Return base commit and branch metadata.
- Add repository URL policy.
- Add runtime profiles for Rust, Python, Node.js, and generic projects.

### Milestone 5: Change-set workflow

- Implement `prepare_change_set`.
- Attach command evidence and artifacts to change sets.
- Generate commit message and pull request body suggestions.
- Keep GitHub push and pull request creation optional.

## Design summary

Asagao Workspace should be designed as:

```text
A safe development Workspace Runner for ChatGPT.
It applies multi-file changes, runs validation commands, captures evidence,
produces diffs and artifacts, and exports validated change sets.
```

It should not be designed as:

```text
A general GitHub App clone or a collection of simple GitHub API wrappers.
```

The main product value is giving ChatGPT an execution and change-set layer that it currently lacks, while keeping source-host operations delegated to tools that already handle them well.
