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
  name: string;
  status: "creating" | "ready" | "failed" | "deleted";
  source: EmptyWorkspaceSource | GitWorkspaceSource;
  baseCommit?: string | null;
  currentCommit?: string | null;
  defaultBranch?: string | null;
  workingBranch?: string | null;
  runtimeProfile: RuntimeProfile;
  internetPolicy: InternetPolicy;
  createdAt: string;
  updatedAt: string;
  expiresAt: string | null;
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
get_workspace_lifecycle
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

response には Workspace record を含めます。Issue #8 の段階では、Workspace は process-local な in-memory record として扱いつつ、設定された workspace root 配下に workspace ごとの filesystem directory を作成します。#23 Phase 1 では `get_workspace_lifecycle` が TTL 切れ、dirty/busy marker、blocker、再利用可能性を返します。repository clone、shell 実行、git reset / git clean の実処理はまだ行いません。patch 適用は `apply_patch` が担当します。削除時は対象 workspace directory だけを安全に削除してから、record を `deleted` status へ遷移させます。

### Workspace inspection

```text
get_file_tree
read_file
search_workspace
get_git_status
get_workspace_diff
```

Issue #19 では、`get_file_tree`、`read_file`、`search_workspace` を読み取り専用 tool として実装します。`get_file_tree` は flat list + depth で取得量を制限し、`read_file` は UTF-8 text file のみを line / byte limit 付きで返し、`search_workspace` は Phase 1 では literal keyword search のみを提供します。`read_files_batch` は aggregate response limit と partial failure semantics を別途設計するため、この phase では公開しません。

Issue #10 では、ChatGPT が patch 適用後や command 実行後の実際の変更結果を確認できるように、`get_git_status` と `get_workspace_diff` を読み取り専用の git inspection tool として実装します。`get_git_status` は changed files と per-file status を返し、`get_workspace_diff` は changed files、diffstat、size-limited patch body を返します。binary、deleted、untracked、非 git workspace、巨大 diff は structured metadata / structured failure として扱います。

### Patch and artifact input

```text
apply_patch
apply_patch_series
upload_artifact
apply_artifact
```

MVP は `apply_patch` から始めます。`apply_patch` は `git apply --numstat -z`、`git apply --check`、`git apply` の fixed-argument adapter 境界を使い、patch parser / applicator を自前再実装しません。`mode: "check"` は preflight のみ、`mode: "apply"` は preflight 成功後に適用します。

重要な response field:

- patch が適用できたか
- preflight / apply の structured diagnostics
- checked files と changed files
- diffstat
- resulting git status
- expectedBaseCommit mismatch
- unsafe path / denied prefix / symlink traversal の拒否理由

### Command execution

```text
run_command
get_command_status
get_command_logs
cancel_command
```

Issue #11 の MVP では `run_command` と `get_command_status` を実装します。`run_command` は command 完了を待たずに `jobId` を返し、長時間実行される command の状態は `get_command_status` で poll します。command input は shell string ではなく `string[]` の argument array に限定し、workspace policy の allowlist と denylist を通過したものだけを実行します。`cwd` は workspace root または workspace-relative path に限定し、timeout は必須入力として扱います。

実行は `CommandJobService` が process-local `CommandJobStore`、`ProcessRunner`、`JobQueue`、workspace lifecycle service、security boundary、audit recorder、diagnostics logger を接続します。status は `queued`、`running`、`succeeded`、`failed`、`timed_out`、`cancelled` を返し、stdout/stderr、exit code、signal、elapsed time、truncation metadata を job record に保存します。同一 workspace の command は queue adapter で直列化し、実行中は busy marker を立てます。

`get_command_logs`、incremental log cursor、`cancel_command` は #12 で扱います。

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

file、git、command、repository、network、artifact に関わる tool は、すべて sandboxed operation として設計する必要があります。

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


## Runner security policy and audit boundary

Runner の file、patch、command、artifact、lifecycle 操作は、実装前に `src/security/` の security boundary を経由できる形にします。この boundary は実際の sandbox そのものではなく、runner 操作が共有する policy contract、default deny 方針、監査 event model、log masking 拡張点を提供します。

### Workspace security policy

Workspace ごとの policy は次の関心事を分離します。

- `internetPolicy`: `none`、`package_registry`、`full` のいずれか。既定値は `none`。
- `secrets`: secret は標準では注入しない。`injectByDefault` は常に `false`。
- `command`: command execution は既定で `deny_all`。明示的な allowlist がある場合のみ許可できる。
- `file`: read/list/search は policy で明示され、write/delete は既定で拒否される。`relativePath` は `src/security/` 境界で POSIX 形式へ正規化され、絶対パス、drive prefix、NUL byte、`..` segment は fail-closed で拒否される。
- `patch`: `apply_patch` は preflight 必須、path safety、audit 前提で許可する。patch series と rollback は後続 issue まで許可しない。
- `artifact`: artifact create/read は許可可能だが、delete/export は既定で拒否される。
- `lifecycle`: lifecycle inspection と Phase 1 の claim/reset/clean service boundary を policy と audit の対象にする。

### Command policy

command は shell string ではなく argument array として評価します。`bash`、`sh`、`powershell`、`sudo`、`ssh`、`curl`、`wget` などは初期 denylist に含めます。denylist は allowlist より優先されます。

### Audit event

Runner 操作は、次の共通 event type を記録できるようにします。

```text
policy_evaluated
operation_started
operation_succeeded
operation_failed
operation_denied
```

Audit event は `workspaceId`、operation kind、action、actor、decision、reason code、metadata を含む共通形式にします。永続化はこの段階では要求せず、最初は in-memory recorder と noop recorder を用意します。

### Log masking

secret を標準注入しない方針とは別に、将来 secret を明示注入する場合に備えて log masking の extension point を置きます。audit metadata や command log に secret value が混入した場合、masker を差し替えて redaction できるようにします。

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
- `apply_patch` を起点に patch application を実装する。
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


## Local workspace filesystem boundary

`create_workspace` は process-local な Workspace record に加えて、設定された `ASAGAO_WORKSPACE_ROOT` 配下に workspace ごとの local directory を作成します。workspace root が存在しない場合は作成し、directory ではない場合や書き込み不可の場合は明示的な filesystem error として扱います。`delete_workspace` は対象 workspace directory だけを削除し、root 外の path、workspace 外の path、root 外へ抜ける symlink traversal は拒否します。`get_workspace_lifecycle` は host の絶対パスを返さず、Workspace record と派生 lifecycle snapshot のみを返します。ChatGPT-facing な操作は host の絶対パスではなく `workspaceId + relativePath` を使います。
