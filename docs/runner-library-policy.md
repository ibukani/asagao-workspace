# Runner library policy

このドキュメントは、Asagao Workspace の Runner 実装で外部ライブラリを使うときの実務上の判断基準をまとめます。方針決定そのものは [ADR 0002](adr/0002-runner-library-policy.md) に記録します。

## 目的

Asagao Workspace は、ChatGPT が安全な workspace 内で patch 適用、command 実行、検証、diff 確認、artifact export、Change Set 作成を行えるようにする Workspace Runner です。

Runner の低レベル処理は、既存ライブラリを適切に使いながら、Asagao 固有の security / audit / lifecycle / tool contract と分離して扱います。

## 基本原則

- 外部ライブラリを Workspace Runner の source of truth にしない。
- library-specific な型や error を MCP tool output に出さない。
- security policy、audit event、Workspace lifecycle、Change Set model をライブラリへ委譲しない。
- shell string ではなく argument array を command API の基本にする。
- tool handler から外部ライブラリを直接呼ばず、adapter / service 境界に閉じ込める。
- timeout、cancel、large output、binary、ignored path、policy deny などの失敗ケースをテストで固定する。
- lockfile 更新と `npm run verify` を伴う。

## 採用候補一覧

### MVP で導入する候補

| Package | Primary adapter | 使う場面 |
|---|---|---|
| `execa` | `ProcessRunner` | fixed-argument command、git CLI invocation、timeout、cancel、stdout/stderr capture |
| `p-queue` | `JobQueue` | command job、clone、archive generation の in-process concurrency control |
| `fast-glob` | `WorkspaceTraversal` | file tree、search、archive target collection、non-git clean |
| `ignore` | `WorkspaceIgnoreFilter` | `.gitignore` compatible ignore filtering |
| `yazl` | `ArchiveWriter` | ZIP archive export |
| `pino` | `DiagnosticsLogger` | runtime diagnostics、structured server logging |

### 導入を強く検討する候補

| Package / API | 判断基準 |
|---|---|
| `simple-git` | clone / branch / remote metadata の実装で `git` CLI via `execa` より明確に扱いやすい場合に採用する |
| `git` CLI via `execa` | `git apply --check`、`git apply`、`git diff --binary` のように CLI semantics をそのまま使う操作で優先する |
| `istextorbinary` | 簡易 NUL byte 判定で不足する実例が出たら導入する |
| `file-type` | artifact metadata と binary MIME type 推定が必要になったら導入する |
| Node.js `util.stripVTControlCharacters` | ANSI escape code 除去が Node 標準で十分なら追加 dependency を避ける |
| `strip-ansi` | Node 標準で不足する場合のみ導入する |
| `diff` / jsdiff | UI表示や補助的 diff 処理が必要な場合のみ採用する。patch適用には使わない |

### 将来検討候補

| Package | 検討タイミング |
|---|---|
| `proper-lockfile` | multi-process runner、remote runner、shared workspace root が現実の要件になったとき |
| `lru-cache` | metadata / computed result cache の保持・破棄 policy が固まったとき |

### 原則非採用または慎重に扱う候補

| Package | 理由 |
|---|---|
| `shelljs` | shell string 前提になりやすく、command policy と相性が悪い |
| `rimraf` | Node.js `fs.rm` と Asagao の path guard で足りる限り不要 |
| `fs-extra` | filesystem 操作の安全境界が曖昧になりやすい |

## 推奨 adapter contracts

### ProcessRunner

- executable と args を分けて受け取る。
- timeout、cancel signal、stdout/stderr capture、output truncation を扱う。
- exit code、signal、timed out、cancelled、spawn failure を structured result に変換する。
- user input を shell string として実行しない。

### GitAdapter

- 許可された git operation だけを fixed argument で実行する。
- `status`、`diff`、`apply --check`、`apply`、`clone`、`rev-parse`、`branch` などを operation 単位で公開する。
- git failure を stable error に変換する。
- `git apply` 系は CLI semantics を重視して `git` CLI via `execa` を第一候補にする。

### WorkspaceTraversal

- workspace root から外へ出ない path を受け取る。
- `fast-glob` と `ignore` を使う場合でも、security denied prefix は Asagao policy 側で維持する。
- traversal result に omitted / skipped / truncated metadata を含める。

### ArchiveWriter

- archive target collection と ZIP writing を分離する。
- archive に含めた file list、size、sha256、content type metadata を返せる余地を残す。
- `.git`、ignored files、generated artifacts、logs、snapshots を含めるかどうかを policy で決める。

### DiagnosticsLogger

- runtime diagnostics を structured log として出す。
- audit event とは別の model として扱う。
- secret redaction / log masking policy と接続する。
- audit event の source of truth にはしない。

## Issue 別の適用方針

| Issue | 適用方針 |
|---|---|
| #9 apply_patch | `git apply --check` / `git apply` を `GitAdapter` 経由にする。patch parser の自前再実装は避ける |
| #10 git status / workspace diff | 既存実装を #36 で監査し、git invocation と parser を adapter 境界へ寄せる |
| #11 command job | `ProcessRunner` と `JobQueue` を使える前提で設計する |
| #12 command logs / cancel | cancel / timeout / log cursor / log normalization を process adapter と log service に分ける |
| #13 snapshot / restore | git workspace と non-git workspace の方針を分け、traversal / archive policy と接続する |
| #14 export_patch / archive | patch は git diff、archive は `ArchiveWriter`、対象収集は ignore-aware traversal に寄せる |
| #15 repository clone | repository URL validation は Asagao policy、clone 実処理は `GitAdapter` に分ける |
| #16 prepare_change_set | Change Set は Asagao domain model、diff / evidence / artifact は adapter 結果を取り込む |
| #19 file inspection | `fast-glob` / `ignore` / `istextorbinary` / `file-type` の導入可否を #36 で監査する |
| #20 security / audit | `pino` diagnostics と audit event を分離し、外部ライブラリに policy を委譲しない |
| #23 workspace reuse | dirty / reset / clean / busy / cache policy を git / traversal / queue / locking 方針へ接続する |
| #36 shared adapters | このドキュメントを実装基準として dependency 追加と adapter 整備を行う |

## 実装時の順序

```text
#35 policy docs / ADR
-> #36 shared dependency + adapter contracts
-> #10 / #19 existing implementation audit
-> #9 apply_patch
-> #11 / #12 command job and logs
-> #23 Phase 2 reset / clean / reuse
-> #14 export_patch / archive
-> #16 prepare_change_set
-> #15 repository clone
```

## Review checklist

- [ ] 外部ライブラリが tool handler から直接呼ばれていない。
- [ ] policy check が adapter 実行前に行われている。
- [ ] 副作用を伴う操作が audit event を記録できる。
- [ ] runtime diagnostics log と audit event が混同されていない。
- [ ] library-specific error が structured error に変換されている。
- [ ] MCP tool contract に library-specific 型が漏れていない。
- [ ] shell string 前提になっていない。
- [ ] timeout、cancel、large output、binary、ignored path、policy deny のテストがある。
- [ ] `npm run verify` が成功している。
