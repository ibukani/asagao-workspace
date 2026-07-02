# アーキテクチャ

Asagao Workspace は、Model Context Protocol（MCP）サーバーを中心に構成された、小さくても拡張しやすい ChatGPT App です。

現時点の目的は、早い段階から多くの機能を追加することではありません。将来、ファイル操作ツール、認証、永続化、安全性チェック、UI 画面を追加しても、エントリポイントがモノリス化しないように、拡張ポイントを明示しておくことを目的としています。

## プロダクトの方向性

Asagao Workspace は、汎用的な GitHub App の複製ではなく、ChatGPT のための安全な開発用 Workspace Runner として扱います。

このアプリは、現在の ChatGPT のチャット環境内では不足している次の能力に集中します。

- 分離された workspace
- 複数ファイルにまたがる patch と artifact の適用
- 非同期ジョブポーリング付きのコマンド実行
- コマンドログと検証証跡
- workspace の diff と git status
- snapshot と rollback
- patch、archive、または change set の export

Issue の一覧取得、Pull Request の読み取り、コメント投稿、GitHub メタデータ編集のような単純なソースホスト操作は、検証済み workspace change set を具体化するために直接必要でない限り、コアプロダクトの外に置きます。

詳細な設計方針は [`docs/workspace-runner-design.md`](workspace-runner-design.md) を参照してください。

## 原則

1. `server.js` は薄く保つ。
2. transport の関心事と app/tool の関心事を分離する。
3. Apps SDK 登録と純粋なドメイン・モデルロジックを分離する。
4. ChatGPT から見える tool contract は安定した構造にする。
5. 書き込み可能またはローカル PC 操作に近いツールは、明示的な安全設計の後に追加する。
6. HTTP サーバーを起動せずにテストできる小さなモジュールを優先する。
7. コアドメインは source host に依存しないように保つ。GitHub は source または destination になり得るが、主要なドメインモデルは Workspace、Command Job、Artifact、Snapshot、Change Set とする。

## レイヤー

```text
server.js
  -> src/runtime/start-server.ts
    -> src/http/create-http-server.ts
      -> src/app/create-app-context.ts
        -> src/services/workspace-registry.ts
          -> src/storage/in-memory-workspace-store.ts
      -> src/app/create-asagao-mcp-server.ts
        -> src/ui/register-ui-resources.ts
        -> src/tools/index.ts
          -> src/tools/<tool>/register.ts
             -> src/tools/<tool>/model.ts
```

### Runtime layer

配置場所: `src/runtime/`

プロセス起動とライフサイクル上の関心事を担当します。将来の shutdown handling、signal handling、observability の起動 hook はここに置きます。

### HTTP layer

配置場所: `src/http/`

HTTP routing、CORS、health check、MCP Streamable HTTP transport の処理を担当します。ツール固有の business logic は含めません。

`createAsagaoHttpServer` はプロセス内で共有される app context を一度作り、MCP request ごとに生成される MCP server へ同じ services を注入します。これにより、Streamable HTTP transport が request ごとに server instance を作っても、in-memory Workspace registry は同一プロセス内で共有されます。

将来ここに置くもの:

- production CORS policy
- request logging
- rate limiting
- health check と readiness check
- transport-level authentication hook

### App composition layer

配置場所: `src/app/`

MCP サーバーの組み立てと、共有 app context の作成を担当します。MCP server 自体は request ごとに生成されても、`create-app-context.ts` で作った services は HTTP server の lifetime に紐づきます。この層は wiring layer のままにします。

### Service layer

配置場所: `src/services/`

application-level な状態遷移と workflow を担当します。現在は `WorkspaceRegistry` が in-memory store を使って Workspace record を管理し、`WorkspaceLifecycleService` が TTL / dirty / busy / reusable 判定、claim/reset/clean の Phase 1 service boundary、audit 接続を担当します。

`WorkspaceRegistry` の現時点の責務:

- Workspace ID を生成する。
- Workspace を `ready` status の in-memory record として作成する。
- Workspace を一覧・取得する。
- Workspace を物理削除せず、`deleted` status に遷移させる。
- TTL metadata を Workspace model に反映する。

### Storage layer

配置場所: `src/storage/`

保存境界を担当します。現在は `InMemoryWorkspaceStore` のみを提供し、永続 DB は使いません。

削除済み Workspace は store から消さずに残します。`listWorkspaces()` は既定で `deleted` を除外し、`includeDeleted: true` のときだけ削除済み record も返します。`getWorkspace()` は削除済み record も返せるため、削除状態の確認が可能です。

### Tool layer

配置場所: `src/tools/`

各ツールは次の構成を使います。

```text
src/tools/<tool-name>/
├── contracts.ts  # tool 名、input/output schema
├── model.ts      # 純粋なデータ・モデルロジック
└── register.ts   # Apps SDK/MCP 登録
```

`model.ts` はサーバーを起動せずに簡単にテストできるようにします。`register.ts` は Apps SDK helper を import し、schema、annotation、metadata、handler を定義してよい場所です。

### Domain layer

配置場所: `src/domain/`

Workspace Runner の共通 model、Zod schema、tool response envelope を定義します。この層は filesystem、shell、registry 永続化を実行せず、tool contract と service 実装から共有される型境界を提供します。Workspace の pure model helper は、初期作成と `deleted` への状態遷移を検証済み schema に通して返します。


### Security boundary layer

配置場所: `src/security/`

Workspace Runner の file、patch、command、artifact、lifecycle 操作に対する policy 判定、secret default deny、log masking、audit event model を担当します。この層は tool handler、HTTP transport、process runtime の wiring に依存せず、domain model と純粋な policy/audit contract を提供します。

初期 policy は保守的です。internet policy の既定値は `none`、secret は標準では注入せず、command execution は `deny_all` から始めます。patch application、file write/delete、artifact export/delete も明示 policy なしでは許可しません。

### UI resource layer

配置場所: `src/ui/` と `public/`

`src/ui/` は Apps SDK resource を登録します。`public/` は静的な HTML/CSS/JS asset を置きます。

ツールモデルから見て UI は任意の存在にします。UI が描画されない場合でも、ツールは有用な structured content を返す必要があります。

### Configuration layer

配置場所: `src/config/`

環境変数の解析と既定値を担当します。Runtime code は `process.env` を直接読むのではなく、`config` object を受け取って利用します。`ASAGAO_WORKSPACE_ROOT` は相対パス・絶対パスの両方を受け付け、内部では絶対パスへ正規化します。空文字、NUL byte、URL 形式、filesystem root そのものは拒否します。workspace root が存在しない場合は作成し、directory ではない場合や書き込み不可の場合は明示的な filesystem error として扱います。

### Filesystem boundary layer

配置場所: `src/filesystem/`

Workspace root と workspace 内 path の解決を担当します。ChatGPT-facing tool は host の絶対パスを直接扱わず、`workspaceId + relativePath` を境界へ渡します。この層は workspace root 外、workspace directory 外、prefix 偽装、root 外へ抜ける symlink traversal を拒否します。

## Tool contract policy

すべてのツールは次を定義します。

- 具体的で action-oriented な名前
- input schema
- output schema
- 必要に応じた read/write annotation
- ChatGPT と UI consumer のための structured content
- 純粋な出力構築ロジックのテスト

`execute`、`run`、`do_task`、`handle` のような汎用的すぎる名前は避けます。

## Workspace lifecycle tools

次の tool を `src/tools/workspace-lifecycle/` で定義・登録します。

```text
create_workspace
list_workspaces
get_workspace
delete_workspace
get_workspace_lifecycle
```

この段階では、process-local な Workspace record と local workspace directory を扱います。`create_workspace` は設定された workspace root 配下に workspace directory を作成し、`delete_workspace` は対象 workspace directory だけを削除してから record を `deleted` status へ遷移させます。`get_workspace_lifecycle` は TTL 切れ、dirty/busy marker、blocker、再利用可能性を返します。Phase 1 の `reset_workspace` / `clean_workspace` / `claim_workspace` は tool として公開せず、後続実装から使える service boundary と audit 接続に留めます。patch 適用、shell 実行、repository clone、git reset / git clean の実処理は行いません。

共通 response は `ok: true` のとき `data` を持ち、`ok: false` のとき `error` を持つ stable envelope を使います。

## 将来機能の safety boundary

`src/security/` の boundary が、filesystem、shell、network、user-data に関わるツールを追加する前の共通安全契約です。新しい runner 操作は、実際の副作用を起こす前にこの boundary の policy を参照し、必要に応じて audit event を記録します。追加の設計では、次の内容を維持・拡張します。

- 許可する操作
- 拒否する操作
- 権限モデル
- 確認モデル
- audit logging
- data retention
- error behavior
- unsafe input に対するテストケース
- workspace relative path の正規化と `..` / 絶対パス / drive prefix / NUL byte の fail-closed 拒否

この boundary と具体的な operation policy が存在しない状態で、任意のローカル shell 実行や広範な filesystem access は追加しません。

## 推奨する次のアーキテクチャマイルストーン

1. Workspace 内 file inspection tool を追加する。
2. git status / workspace diff tool を追加し、lifecycle の dirty marker を実データへ接続する。
3. apply_patch tool を追加し、patch 適用後の dirty marker を更新する。
4. command job 基盤を追加し、lifecycle の busy marker を実行状態へ接続する。
5. TypeScript と Zod schema を使い、schema と contract drift を早期に検出できる状態を保つ。
6. ホスティング先を選定してから、deployment-specific adapter を追加する。
