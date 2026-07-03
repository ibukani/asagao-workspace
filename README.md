# Asagao Workspace

Asagao Workspace は、OpenAI Apps SDK と Model Context Protocol（MCP）サーバーを使って ChatGPT App を作るための最小構成のひな形です。

## 含まれているもの

- `/mcp` で公開される最小構成の Node.js MCP サーバー。
- ChatGPT Apps 用の小さな iframe UI リソース。
- 読み取り専用のスターターツール: `get_workspace_status`。
- Workspace lifecycle ツール: `create_workspace`、`list_workspaces`、`get_workspace`、`delete_workspace`、`get_workspace_lifecycle`。
- Workspace inspection ツール: `get_file_tree`、`read_file`、`search_workspace`。
- Workspace git inspection ツール: `get_git_status`、`get_workspace_diff`。
- Workspace patch ツール: `apply_patch`。
- Runner library policy と ADR: 低レベル処理を外部ライブラリに寄せつつ、adapter / security / audit 境界を維持する方針。
- Workspace Runner の中核となる domain model: Workspace、Command Job、Artifact、Snapshot、Change Set。
- Workspace lifecycle 系ツールの contract schema、handler model、local workspace directory 管理、TTL / dirty / busy / reusable 判定境界。
- Runner 操作向けの security boundary、workspace policy、command policy、lifecycle policy、audit event model、log masking 拡張点。
- 共通 tool result envelope と error result の pure model。
- 将来のツール、認証、永続化、配信まわりの関心事に拡張しやすいレイヤー分けされたソース構成。
- サーバーの起動、検証、テストを行うローカル開発用スクリプト。
- ローカルでツールを確認するための MCP Inspector コマンド。
- 構文チェック、TypeScript typecheck、テストを実行する GitHub Actions CI。
- Codex などのコーディングエージェントがこのリポジトリで作業するための `AGENTS.md`。

## 必要要件

- Node.js 22 以降
- npm

## セットアップ

```bash
npm install
```

## ローカル実行

```bash
npm run dev
```

サーバーは次の URL で待ち受けます。

```text
http://localhost:8787/mcp
```

ヘルスチェック:

```bash
curl http://localhost:8787/
```

## 検証

```bash
npm run verify
```

このコマンドは構文チェック、TypeScript typecheck、Node.js のテストスイートを実行します。

個別に実行する場合:

```bash
npm run check
npm run typecheck
npm test
```

## MCP Inspector でテストする

```bash
npm run inspect
```

このコマンドは `http://localhost:8787/mcp` に対して MCP Inspector を開きます。

## 開発中に ChatGPT から接続する

ローカルサーバーを HTTPS トンネル経由で公開します。例:

```bash
ngrok http 8787
```

その後、ChatGPT には次のコネクタ URL を登録します。

```text
https://<your-tunnel-domain>/mcp
```

## アーキテクチャ

このプロジェクトでは、アプリを意図的に薄いレイヤーへ分離しています。

```text
.
├── .github/workflows/ci.yml
├── docs/
│   ├── architecture.md
│   ├── runner-library-policy.md
│   └── adr/
│       ├── 0001-layered-mcp-app.md
│       └── 0002-runner-library-policy.md
├── public/asagao-widget.html
├── scripts/check-syntax.ts
├── src/
│   ├── app/                 # MCP アプリの組み立てと共有 app context
│   ├── config/              # 環境変数・設定の読み込み
│   ├── domain/              # Workspace Runner の共通ドメイン契約
│   ├── filesystem/          # Workspace root / path traversal / symlink 境界
│   ├── http/                # HTTP + Streamable HTTP transport アダプタ
│   ├── adapters/            # 外部ライブラリ・低レベルI/Oを隠蔽する境界（#36で実体化）
│   ├── runtime/             # プロセス起動境界
│   ├── security/            # Runner policy / audit / secret default deny 境界
│   ├── services/            # Workspace registry などの application service
│   ├── storage/             # in-memory store などの保存境界
│   ├── tools/               # MCP ツールレジストリと各ツールモジュール
│   └── ui/                  # Apps SDK UI リソース登録
├── tests/
├── AGENTS.md
├── package.json
├── server.js                # 薄いエントリポイント
└── README.md
```

想定している拡張モデルについては [`docs/architecture.md`](docs/architecture.md) を参照してください。Runner 実装で使う外部ライブラリと adapter 境界の方針は [`docs/runner-library-policy.md`](docs/runner-library-policy.md) と [`docs/adr/0002-runner-library-policy.md`](docs/adr/0002-runner-library-policy.md) に記録しています。

## 開発ポリシー

`main` で直接作業しないでください。変更ごとに feature branch を作成してください。

アーキテクチャ基盤ブランチ:

```text
feat/app-architecture-foundation
```

以前の最小環境ブランチ:

```text
feat/chatgpt-app-minimal-env
```

## Workspace lifecycle tools

`src/tools/workspace-lifecycle/` には、次の lifecycle 系 tool contract と handler model を定義しています。

- `create_workspace`
- `list_workspaces`
- `get_workspace`
- `delete_workspace`
- `get_workspace_lifecycle`

この段階では process-local な Workspace record を作成・一覧・取得・削除でき、`get_workspace_lifecycle` で TTL 切れ、dirty/busy marker、blocker、再利用可能性を structured result として確認できます。`create_workspace` は設定された workspace root 配下に workspace ごとの実ディレクトリを作成し、`delete_workspace` は対象 workspace directory だけを安全に削除してから record を `deleted` status へ遷移させます。`reset_workspace` / `clean_workspace` / `claim_workspace` は Phase 1 では ChatGPT-facing tool として公開せず、後続実装が再利用できる service boundary と audit 接続として扱います。

workspace root は環境変数で変更できます。

```text
ASAGAO_WORKSPACE_ROOT=.asagao/workspaces
```

`ASAGAO_WORKSPACE_ROOT` は相対パス・絶対パスの両方を受け付け、内部では絶対パスへ正規化されます。空文字、NUL byte、URL 形式、filesystem root そのものは拒否されます。workspace root が存在しない場合は作成し、directory ではない場合や書き込み不可の場合は明示的な filesystem error として扱います。

Workspace path の解決は `workspaceId + relativePath` の形に閉じ、root 外・workspace 外へ出る path traversal と、root 外へ抜ける symlink traversal を拒否します。ChatGPT-facing な tool output にはホスト側の絶対パスを露出しません。

repository clone、shell 実行、file write tool、git reset / git clean の実処理はまだ行いません。patch 適用は `apply_patch` が git workspace 向けに担当します。

## Workspace inspection tools

`src/tools/workspace-inspection/` には、Workspace 内のファイルを読み取り専用で検査する tool contract と handler model を定義しています。

- `get_file_tree`
- `read_file`
- `search_workspace`

これらの tool は `workspaceId + workspace-relative path` に閉じて動作します。ホスト側の絶対パスは tool output に含めません。path traversal、絶対パス、Windows drive prefix、NUL byte、workspace 外へ抜ける symlink traversal は fail-closed で拒否します。

`get_file_tree` は flat list + `depth` の形式で file tree を返します。`.git/`、`node_modules/`、`.asagao/` など workspace file policy の denied prefix は省略され、symlink は辿らず `symlink` entry として扱います。`maxDepth` と `maxEntries` によって取得量を制限します。

`read_file` は UTF-8 text file のみを返します。`startLine`、`maxLines`、`maxBytes` を受け取り、binary file と directory / symlink / other file type は本文を返さず structured failure にします。`maxBytes` は workspace file policy の `maxReadBytes` と hard limit の小さい方で上限化されます。

`search_workspace` は Phase 1 では regex ではなく literal keyword search です。UTF-8 text file のみを対象にし、binary、too-large、denied、unreadable file は skip count として返します。`maxResults`、`maxFileBytes`、match line snippet の上限で response size を制限します。

`read_files_batch` は Issue #19 Phase 1 では公開しません。単一 `read_file` の policy、audit、上限、binary handling を安定させてから、必要であれば後続Issueで batch API と aggregate limit を設計します。

## Workspace git inspection tools

`src/tools/workspace-git/` には、Workspace 内の git work tree を読み取り専用で検査する tool contract と handler model を定義しています。

- `get_git_status`
- `get_workspace_diff`

これらの tool は fixed-argument の `git` invocation だけを使い、任意 shell command は実行しません。`src/security/` の git operation policy を通し、audit event を記録します。ChatGPT-facing な structured result には workspace-relative path だけを含め、ホスト側の絶対パスは返しません。`.git/` の直接 file read は引き続き file policy で拒否されますが、git inspection tool は git command 経由で status / diff を取得できます。

`get_git_status` は branch、HEAD commit、clean 判定、changed files、file ごとの status、staged / unstaged / untracked / conflicted flag、`maxFiles` による truncation metadata を返します。非 git workspace は曖昧な空結果ではなく `not_git_workspace` の structured failure として扱います。

`get_workspace_diff` は changed files、diffstat、必要に応じて patch 本文を返します。patch 本文は `maxPatchBytes` と git policy の `maxPatchBytes` で上限化され、巨大 diff でも result envelope が壊れないよう `patch.truncated` と `patch.omittedReason` を返します。deleted file は deleted status と通常の git patch、binary file は `binary: true` として扱い、untracked text file は new file patch を生成します。

## Workspace patch tools

`src/tools/workspace-patch/` には、ChatGPT が生成した unified git patch を workspace に適用する tool contract と handler model を定義しています。

- `apply_patch`

`apply_patch` は `workspaceId`、`patch`、任意の `expectedBaseCommit`、`mode` を受け取ります。`mode: "check"` では `git apply --check` semantics による preflight のみを行い、`mode: "apply"` では preflight 成功後に `git apply` を実行します。patch 本文は `ProcessRunner` の stdin 経由で渡し、shell string として実行しません。

patch 操作は `WorkspacePatchService` を通り、patch policy、audit event、workspace-relative path 正規化、denied prefix、workspace 外へ抜ける symlink traversal の検査を行います。成功時は changed files、diffstat、resulting git status、diagnostics を返し、lifecycle dirty marker を更新します。壊れた patch、base commit mismatch、unsafe path、patch size 超過は適用前に structured diagnostics として返します。patch 適用前 snapshot の作成は #13 に委譲し、現時点では `snapshotCreated: false` と `snapshotPolicy: "deferred_to_issue_13"` を返します。

## Runner library policy

Runner の低レベル処理は、必要に応じて外部ライブラリを使います。ただし、ライブラリは Asagao Workspace の security boundary、audit event、Workspace lifecycle、Change Set model、MCP tool contract を置き換えません。

Issue #36 で MVP dependency と adapter 境界を導入済みです。採用した dependency と主な閉じ込め先は次の通りです。

- command execution: `execa` → `src/adapters/process/ProcessRunner`
- job queue / concurrency control: `p-queue` → `src/adapters/queue/JobQueue`
- file traversal: `fast-glob` → `src/adapters/files/WorkspaceTraversal`
- `.gitignore` compatible filtering: `ignore` → `src/adapters/files/WorkspaceIgnoreFilter`
- archive generation: `yazl` → `src/adapters/archive/ArchiveWriter`
- runtime diagnostics logging: `pino` → `src/adapters/logging/DiagnosticsLogger`

`simple-git`、`istextorbinary`、`file-type`、`strip-ansi` は Issue #36 では追加していません。git 操作は `execa` 経由の fixed-argument `git` CLI adapter に寄せ、command log normalization は Node.js 標準の `util.stripVTControlCharacters` を使います。`proper-lockfile` と `lru-cache` は将来検討、`shelljs`、`rimraf`、`fs-extra` は原則非採用または慎重に扱います。

外部ライブラリは tool handler から直接呼ばず、`src/adapters/` または service 境界に閉じ込めます。filesystem、command、git、artifact、lifecycle 操作は policy と audit event を通し、runtime diagnostics logger と audit event model は分離します。

## Runner security boundary

`src/security/` は、将来の file、patch、command、artifact、lifecycle 操作が共有する安全境界です。現在は実行ツール本体ではなく、次の基盤を提供します。

- workspace 単位の security policy。
- `none`、`package_registry`、`full` の internet policy。既定値は `none`。
- command allowlist / denylist policy。既定値は `deny_all`。
- secret を標準では注入しない policy。
- git status / diff inspection、patch apply、lifecycle claim/reset/clean 操作を含む audit event の共通形式と recorder interface。
- audit metadata や command log に適用できる log masking extension point。

repository clone、shell 実行、file write tool、git reset / git clean の実処理はまだ行いません。patch 適用は `apply_patch` が git workspace 向けに担当します。これらを追加する場合は、実際の副作用を起こす前に `src/security/` の policy を参照し、audit event を記録する必要があります。


## 新しいツールを追加する

1. `src/tools/<tool-name>/` の下に新しいディレクトリを作成する。
2. 純粋なデータ・モデルロジックを `model.ts` に置く。
3. Apps SDK の登録コードを `register.ts` に置く。
4. 登録関数を `src/tools/index.ts` に追加する。
5. `tests/` 配下にテストを追加または更新する。
6. ツールが境界、安全性の前提、実行時要件を変える場合は、この README と `docs/architecture.md` を更新する。

## 次のステップ

1. command job 基盤を追加し、`ProcessRunner` / `JobQueue` と busy marker を接続する。
2. command log cursor と cancel semantics を実装する。
3. #23 Phase 2 で reset / clean / reuse の実処理と cache policy を完成させる。
4. #13 snapshot / restore と `apply_patch` の rollback story を接続する。
5. #14 export_patch / archive と #16 prepare_change_set を実装する。
6. 対象のホスティング基盤を選定してからデプロイ設定を追加する。
