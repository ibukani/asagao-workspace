# Workspace Runner 設計

このドキュメントは、Asagao Workspace のプロダクトとアーキテクチャの方向性をまとめたものです。

Asagao Workspace は、汎用的な GitHub 操作ラッパーになるべきではありません。コアの役割は、ChatGPT に対して、安全で分離され、検査可能な開発 workspace を提供することです。その workspace では、複数ファイルにまたがる変更を適用し、コマンドを実行し、結果を検証し、最終的な change set を export できます。

## プロダクト上の位置づけ

Asagao Workspace は、MCP サーバーと外部 Workspace Runner に支えられた ChatGPT App です。

```text
ChatGPT
  -> reasoning、planning、review、patch authoring、repair decision

ChatGPT App / MCP Server
  -> tool contract、authentication、workspace API、structured result、任意の UI

Workspace Runner
  -> clone、patch application、file inspection、command execution、log、artifact、diff、snapshot

Source host（例: GitHub）
  -> repository source of truth、branch、pull request、CI、review
```

重要な境界は、Asagao Workspace が runner と change-set manager であり、source host の代替ではないことです。

## 目標

- Rust、Node.js、Python、または複数言語が混在するプロジェクトのように、実行環境が必要なリポジトリで ChatGPT が作業できるようにする。
- ChatGPT が 1 ファイルずつアップロードする flow に苦戦するのではなく、複数ファイルの変更を単一の change set として適用・検証できるようにする。
- patch、script、archive、および将来的な change-set based workflow を支援する。
- 長時間実行されるコマンドを非同期で実行し、安定した job identifier を返す。
- コマンド状態、ログ、diff、artifact、安全性メタデータを structured data として返す。
- GitHub integration は、検証済み workspace change を具体化または export するために必要な範囲に限定する。
- 設計を source-host agnostic に保ち、GitHub、GitLab、Bitbucket、zip export、patch export が同じ internal model を共有できるようにする。

## 非目標

- issue の一覧取得、issue comment の投稿、pull request review の読み取り、repository browsing のような単純な GitHub App / GitHub MCP 操作を重複実装しない。
- GitHub を core domain model にしない。
- 任意のローカル PC 操作を公開しない。
- sandbox、policy model、audit trail がない状態で、広範な filesystem や shell execution を公開しない。
- ChatGPT にリポジトリファイルを 1 つずつ手動アップロードさせる設計にしない。

## コアドメインモデル

### Workspace

Workspace は、分離された working copy と runtime metadata です。

重要な field:

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

Change Set は、このプロダクトの中心概念です。workspace に加えられた一貫した変更群と、それに紐づく証跡を表します。

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

Change Set は GitHub なしで利用できるべきです。将来的には patch、zip archive、git bundle、branch push、pull request として export できます。

### Command Job

長時間実行されるコマンドは非同期である必要があります。

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

特定の shell mode を意図的に追加するまでは、command は shell string ではなく argument array として表現します。

## Tool boundary policy

Asagao Workspace の tool は、workspace execution、validation、export に結びついた action-oriented なものにします。

### 可能な限り scope 外に置くもの

次の操作は、専用の GitHub App、GitHub MCP、または source host UI に任せる方が適切です。

- GitHub issue の一覧取得
- pull request の一覧取得
- issue comment の投稿
- pull request review comment の読み取り
- pull request body の編集
- notification の管理
- GitHub へ単一ファイルを 1 つずつ upload する操作

### scope 内に置くもの

次の操作は Asagao Workspace の中心です。

- 分離された workspace の作成と削除
- repository を workspace に clone する
- patch、patch series、archive を workspace に適用する
- workspace の file tree と選択された file を調べる
- workspace 内で command を実行する
- command status と log を poll する
- workspace state の snapshot と restore
- workspace diff と diffstat の生成
- patch、patch series、zip archive、git bundle の export
- commit-ready な change set の準備

GitHub push や pull request 作成は後から追加できます。ただし、それらは検証済み change set の destination であり、core product model ではありません。

## 提案する MCP tool

### Workspace lifecycle

```text
create_workspace
list_workspaces
get_workspace
delete_workspace
```

`create_workspace` は任意の repository 情報を受け取れるようにします。

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

response には `workspaceId`、status、base commit、working branch、expiration metadata を含めます。

### Workspace inspection

```text
get_file_tree
read_file
read_files_batch
search_workspace
get_git_status
get_workspace_diff
```

ChatGPT は patch や command によって生じた実際の結果を確認する必要があるため、`get_workspace_diff` は第一級の tool とします。

### Patch and artifact input

```text
apply_patch
apply_patch_series
upload_artifact
apply_artifact
```

MVP は `apply_patch` から始められます。

重要な response field:

- patch が適用できたか
- conflict
- changed files
- diffstat
- resulting git status
- failed hunk に対する diagnostic

### Command execution

```text
run_command
get_command_status
get_command_logs
cancel_command
```

`run_command` は即座に `jobId` を返します。長時間実行される command を安全に poll できるように、status と log は別 tool にします。

### Snapshot and rollback

```text
create_snapshot
list_snapshots
restore_snapshot
rollback_last_patch
```

ChatGPT が生成した patch は、改善される前に失敗したり repository を悪化させたりする可能性があるため、snapshot は重要です。

### Export

```text
export_patch
export_patch_series
export_workspace_archive
export_git_bundle
prepare_change_set
```

export tool により、ユーザーまたは別の tool は検証済みの作業結果を別の場所へ持ち出せます。

## 推奨 MVP

最初に有用な version では、広範な GitHub automation を避け、runner loop に集中します。

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

これだけで次の core loop を支援できます。

```text
1. Repository または空 template から workspace を作成する。
2. ChatGPT が patch または script を生成する。
3. Patch または artifact を適用する。
4. Validation command を実行する。
5. Status と log を poll する。
6. Diff と git status を確認する。
7. 必要に応じて別の patch で修復する。
8. Patch または archive を export する。
```

## Safety requirements

file、command、repository、network、artifact に関わる tool は、すべて sandboxed operation として設計する必要があります。

最低要件:

- workspace-level isolation
- non-root execution
- CPU、memory、disk、timeout の制限
- explicit internet policy
- user secret への default access を持たないこと
- secret を将来サポートする場合は explicit secret injection にすること
- log 内の secret masking
- path traversal protection
- symlink handling policy
- patch preflight validation
- repository URL allow/deny policy
- command policy と audit logging
- workspace TTL と cleanup
- artifact size limit
- structured error reporting

default internet policy は full internet access にしないでください。推奨する policy level:

```text
none
package_registry
full
```

`package_registry` は、実用的な build を可能にしつつ unrestricted network access を避けるための選択肢として扱います。

## UI opportunities

MCP tool は UI なしでも有用であるべきですが、ChatGPT App iframe により review workflow を改善できます。

有用な UI panel:

- workspace status
- file tree
- changed file list
- diff viewer
- command log viewer
- command status panel
- artifact download panel
- conflict report
- change-set summary

UI は source of truth になるのではなく、structured tool result を consume するべきです。

## GitHub integration policy

GitHub integration は最小限にし、change-set oriented にします。

将来的に追加可能なもの:

```text
clone_repository
checkout_branch
create_working_branch
prepare_commit
commit_change_set
push_change_set
```

change-set model が安定した後に追加を検討できるもの:

```text
create_pull_request_from_change_set
```

既存の GitHub tool がすでに扱える単純な GitHub wrapper は作らないようにします。

## Milestones

### Milestone 1: Local scaffold and contracts

- 既存の MCP scaffold は最小構成のまま保つ。
- workspace、command job、artifact、snapshot、change set の domain-level model を追加する。
- 実際の execution を実装する前に tool contract test を追加する。

### Milestone 2: Safe local runner prototype

- 制御された local directory で workspace creation を実装する。
- patch application を実装する。
- asynchronous command job を実装する。
- status と log polling を実装する。
- strict timeout と cleanup を追加する。

### Milestone 3: Diff and export

- git status と workspace diff を実装する。
- patch export を実装する。
- zip archive export を実装する。
- snapshot と restore を追加する。

### Milestone 4: Repository source support

- repository clone support を追加する。
- base commit と branch metadata を返す。
- repository URL policy を追加する。
- Rust、Python、Node.js、generic project 向け runtime profile を追加する。

### Milestone 5: Change-set workflow

- `prepare_change_set` を実装する。
- command evidence と artifact を change set に紐づける。
- commit message と pull request body の候補を生成する。
- GitHub push と pull request 作成は任意機能として保つ。

## Design summary

Asagao Workspace は次のように設計します。

```text
ChatGPT のための安全な開発用 Workspace Runner。
複数ファイルの変更を適用し、validation command を実行し、証跡を記録し、
diff と artifact を生成し、検証済み change set を export する。
```

次のようには設計しません。

```text
汎用 GitHub App clone、または単純な GitHub API wrapper の集合。
```

主要なプロダクト価値は、ChatGPT に現在不足している実行レイヤーと change-set レイヤーを提供しつつ、source-host operation はそれを得意とする既存 tool に委譲することです。
