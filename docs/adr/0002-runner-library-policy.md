# ADR 0002: Runner 外部ライブラリ導入と adapter 境界

## Status

Accepted

## Context

Asagao Workspace は、ChatGPT が安全な workspace 内で複数ファイル変更を適用し、コマンドを実行し、検証結果・diff・artifact を structured result として確認できるようにする Workspace Runner です。

今後の Runner 実装では、次の低レベル処理が必要になります。

- process execution / timeout / cancel / stdout-stderr capture
- command job queue / concurrency control
- workspace locking
- git status / diff / clone / apply
- `.gitignore` compatible traversal
- binary/text detection
- artifact content type detection
- archive generation
- patch / diff handling
- command log normalization
- runtime diagnostics logging

これらを各 tool handler や service が個別に手書きすると、重複実装、失敗時の semantics のばらつき、security boundary 漏れ、audit event の欠落が起きやすくなります。一方で、Asagao Workspace の中核である security boundary、audit event、Workspace lifecycle、Change Set model、MCP tool contract は外部ライブラリへ委譲してはいけません。

## Decision

外部ライブラリは積極的に検討しますが、利用箇所を adapter / service 境界の内側に閉じ込めます。

- 外部ライブラリを MCP tool handler から直接呼ばない。
- library-specific な型、例外、metadata を ChatGPT-facing MCP tool contract に漏らさない。
- filesystem / command / git / artifact / lifecycle 操作は、実処理の前に必ず `src/security/` の policy を通す。
- 副作用を伴う操作は audit event を記録できる境界から呼び出す。
- runtime diagnostics logger と audit event model を分離する。
- shell string を前提にした API を標準にしない。command は argument array を基本にする。
- 失敗時は Asagao 側の structured error に正規化する。
- ライブラリ導入時は成功ケースだけでなく、失敗、timeout、cancel、large output、binary、ignored path、policy deny をテストで固定する。

この ADR は方針を固定します。実際の dependency 追加、adapter 実装、既存実装の置き換えは Issue #36 で扱います。

## Library classification

### MVP で導入する候補

| 領域 | 候補 | 用途 | 境界 |
|---|---|---|---|
| command execution | `execa` | timeout、cancel、stdout/stderr capture、fixed-argument command execution | `ProcessRunner` adapter |
| job queue / concurrency | `p-queue` | command job、clone、artifact generation の in-process concurrency control | `JobQueue` adapter |
| file traversal | `fast-glob` | file tree、search、archive target collection、non-git clean | `WorkspaceTraversal` adapter |
| ignore filter | `ignore` | `.gitignore` compatible filtering | `WorkspaceIgnoreFilter` helper / traversal adapter |
| archive generation | `yazl` | workspace archive export 用 ZIP writer | `ArchiveWriter` adapter |
| runtime diagnostics logging | `pino` | server diagnostics、structured runtime logging | `DiagnosticsLogger` adapter |

### 導入を強く検討する候補

| 領域 | 候補 | 判断方針 |
|---|---|---|
| git operations | `simple-git` | clone / status / diff / branch / base commit 取得で adapter 経由なら採用を検討する |
| git CLI semantics | `git` CLI via `execa` | `git apply --check` / `git apply` / `git diff --binary` のように CLI semantics を優先したい操作で第一候補にする |
| binary/text detection | `istextorbinary` | read/search/diff/archive で text と binary を分ける必要が強くなったら導入する |
| content type detection | `file-type` | artifact や binary metadata の MIME type 推定に使う。text/binary 判定とは用途を分ける |
| command log normalization | Node.js `util.stripVTControlCharacters` / `strip-ansi` | まず Node 標準で足りるか確認し、不足時のみ `strip-ansi` を追加する |
| diff / patch utility | `diff` / jsdiff | UI表示や補助的 diff 処理が必要な場合のみ使う。patch適用は原則 `git apply` semantics を優先する |

### 将来検討候補

| 領域 | 候補 | 判断方針 |
|---|---|---|
| workspace locking | `proper-lockfile` | multi-process runner、remote runner、shared workspace root を扱う段階で検討する。MVP は in-memory lock で足りる可能性がある |
| cache helper | `lru-cache` | metadata / computed result cache の policy が固まるまで導入しない |

### 原則非採用または慎重に扱う候補

| 候補 | 方針 |
|---|---|
| `shelljs` | shell string 依存が強くなりやすいため原則採用しない |
| `rimraf` | Node.js `fs.rm` と Asagao 側 path guard で足りる限り採用しない |
| `fs-extra` | filesystem safety boundary が曖昧になりやすいため、必要性が明確になるまで採用しない |

## Adapter boundary

Issue #36 では、少なくとも次の境界を用意します。物理ディレクトリ名は実装時に調整してよいですが、責務は分離します。

```text
src/adapters/process/      # execa or child_process を隠蔽する ProcessRunner
src/adapters/queue/        # p-queue を隠蔽する JobQueue
src/adapters/git/          # git CLI / simple-git を隠蔽する GitAdapter
src/adapters/files/        # fast-glob / ignore / binary 判定を隠蔽する traversal helpers
src/adapters/archive/      # yazl を隠蔽する ArchiveWriter
src/adapters/logging/      # pino を隠蔽する DiagnosticsLogger
```

`src/services/` は workflow と domain-level use case を担当します。`src/adapters/` は外部ライブラリや低レベル I/O の違いを吸収します。`src/security/` は policy / audit boundary として独立させ、adapter が security policy の source of truth にならないようにします。

## Policy boundary

外部ライブラリを導入しても、次の判断は Asagao 側で維持します。

- workspace root / workspace-relative path の正規化
- path traversal、absolute path、drive prefix、NUL byte の fail-closed 拒否
- symlink traversal policy
- command allowlist / denylist
- internet policy
- secret default deny
- repository URL allow / deny policy
- artifact size limit
- patch preflight required policy
- reset / clean / reuse lifecycle policy
- audit event schema
- MCP tool input / output schema

## Structured error policy

adapter は library-specific error をそのまま投げず、Asagao の structured error へ変換します。

最低限、次の情報を保持します。

- stable error code
- human-readable message
- operation name
- workspace id if available
- command / git subcommand if safe to expose
- exit code or signal if available
- stdout/stderr truncation metadata if relevant
- retryable / policy-denied / user-actionable かどうかの分類

secret、host absolute path、token、環境変数値は error payload や audit metadata に含めません。

## Issue adaptation

| Issue | この ADR に基づく実装・監査方針 |
|---|---|
| #9 `apply_patch` | patch parser / applicator を自前で再実装せず、`git apply --check` / `git apply` semantics を `GitAdapter` 経由で使う |
| #10 `get_git_status` / `get_workspace_diff` | 既存の git invocation を `GitAdapter` へ寄せ、complex git semantics を自前 parser で増やしすぎない |
| #11 command job | `ProcessRunner` と `JobQueue` を前提にし、shell string ではなく argument array を維持する |
| #12 command logs / cancel | process lifecycle、cancel、timeout、raw/display log、ANSI normalization を adapter/service 境界で整理する |
| #13 snapshot / restore | git workspace は git semantics、non-git workspace は traversal / archive 方針と接続する |
| #14 export | patch export は git diff、archive export は `ArchiveWriter`、対象収集は ignore-aware traversal に接続する |
| #15 repository clone | clone / branch / base commit / default branch 取得を `GitAdapter` に閉じ込め、repository policy は Asagao 側で維持する |
| #16 prepare_change_set | Change Set model は自前で維持し、diff / command evidence / artifact は adapter 結果を取り込む |
| #19 file inspection | 既存実装を #36 で監査し、必要なら `fast-glob` / `ignore` / binary detector へ置き換える |
| #20 security / audit | runtime diagnostics logger と audit event model を分離し、policy を外部ライブラリへ委譲しない |
| #23 workspace reuse | reset / clean / dirty / busy / cache policy を git adapter、traversal adapter、queue / lock 方針へ接続する |
| #36 shared library adapters | dependency 追加、adapter 実装、#10 / #19 既存実装監査を担当する |

## Consequences

Positive:

- Runner の低レベル処理を再発明しにくくなる。
- tool contract と library semantics の結合を避けられる。
- security / audit / lifecycle の source of truth を Asagao 側に維持できる。
- #9 以降の Runner 実装で再利用できる adapter 境界が明確になる。

Tradeoffs:

- adapter layer の file 数と test 数は増える。
- ライブラリ追加時に dependency review と structured error 設計が必要になる。
- MVP 初期では既存の簡易実装と adapter 化された実装が一時的に混在する可能性がある。

## Follow-up

- Issue #36 で dependency を追加し、adapter 境界を実装する。
- Issue #36 で #10 / #19 の既存実装を監査し、必要なら adapter 化または follow-up Issue を作る。
- 新しい Runner Issue を作る場合は、この ADR と [`docs/runner-library-policy.md`](../runner-library-policy.md) の採用基準を参照する。
