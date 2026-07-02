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
8. filesystem、shell、network に触れる前に、domain model と tool contract を固定する。

## レイヤー

```text
server.js
  -> src/runtime/start-server.js
    -> src/http/create-http-server.js
      -> src/app/create-asagao-mcp-server.js
        -> src/ui/register-ui-resources.js
        -> src/tools/index.js
          -> src/tools/<tool>/register.js
             -> src/tools/<tool>/model.js
        -> src/domain/*.js
```

### Runtime layer

配置場所: `src/runtime/`

プロセス起動とライフサイクル上の関心事を担当します。将来の shutdown handling、signal handling、observability の起動 hook はここに置きます。

### HTTP layer

配置場所: `src/http/`

HTTP routing、CORS、health check、MCP Streamable HTTP transport の処理を担当します。ツール固有の business logic は含めません。

将来ここに置くもの:

- production CORS policy
- request logging
- rate limiting
- health check と readiness check
- transport-level authentication hook

### App composition layer

配置場所: `src/app/`

MCP サーバーの組み立てを担当します。MCP サーバーを作成し、UI リソースとツールを登録します。この層は wiring layer のままにします。

### Domain layer

配置場所: `src/domain/`

Workspace Runner の中核概念を source-host agnostic な pure model として定義します。この層では、filesystem 操作、shell 実行、network access、MCP 登録を行いません。

現時点で定義する model:

- `Workspace`
- `CommandJob`
- `ArtifactRef`
- `Snapshot`
- `ChangedFile` / `DiffStat` / `ChangeSet`
- 共通 tool result envelope と error result

この層は後続の store、registry、runner、exporter から共有される契約です。

### Tool layer

配置場所: `src/tools/`

各ツールは次の構成を使います。

```text
src/tools/<tool-name>/
├── model.js      # 純粋なデータ・モデルロジック
└── register.js   # Apps SDK/MCP 登録
```

`model.js` はサーバーを起動せずに簡単にテストできるようにします。`register.js` は Apps SDK helper を import し、schema、annotation、metadata、handler を定義してよい場所です。

Workspace lifecycle のように tool surface を先に固定したい場合は、`contracts.js` に input/output schema と tool 名を置き、handler 実装は後続 Issue で接続します。

### UI resource layer

配置場所: `src/ui/` と `public/`

`src/ui/` は Apps SDK resource を登録します。`public/` は静的な HTML/CSS/JS asset を置きます。

ツールモデルから見て UI は任意の存在にします。UI が描画されない場合でも、ツールは有用な structured content を返す必要があります。

### Configuration layer

配置場所: `src/config/`

環境変数の解析と既定値を担当します。Runtime code は `process.env` を直接読むのではなく、`config` object を受け取って利用します。

## Tool contract policy

すべてのツールは次を定義します。

- 具体的で action-oriented な名前
- input schema
- output schema
- 必要に応じた read/write annotation
- ChatGPT と UI consumer のための structured content
- 純粋な出力構築ロジックのテスト

`execute`、`run`、`do_task`、`handle` のような汎用的すぎる名前は避けます。

## Workspace lifecycle contracts

次の contract を `src/tools/workspace-lifecycle/contracts.js` で定義します。

```text
create_workspace
list_workspaces
get_workspace
delete_workspace
```

この段階では、schema と structured output の形だけを固定します。実際の workspace 作成、root directory の作成、patch 適用、shell 実行、clone は行いません。

共通 response は次の envelope を使います。

```js
{
  ok: boolean,
  result: object | null,
  error: {
    code: string,
    message: string,
    details: unknown | null,
    retryable: boolean,
  } | null,
  message: string | null,
  warnings: string[],
}
```

## 将来機能の safety boundary

filesystem、shell、network、user-data に関わるツールを追加する前に、次の内容を含む設計ドキュメントを追加します。

- 許可する操作
- 拒否する操作
- 権限モデル
- 確認モデル
- audit logging
- data retention
- error behavior
- unsafe input に対するテストケース

この設計が存在するまでは、任意のローカル shell 実行や広範な filesystem access は避けます。

## 推奨する次のアーキテクチャマイルストーン

1. Workspace lifecycle contract を in-memory registry に接続する。
2. 書き込み可能なツールを実装する前に `src/security/` 境界を追加する。
3. 最初の永続化要件が明確になってから `src/storage/` 境界を追加する。
4. 実際の runner を実装する前に、Workspace、Command Job、Artifact、Snapshot、Change Set の domain model を追加する。
5. tool handler が重要な app logic を共有し始めたら `src/services/` 境界を追加する。
6. ツールの surface が数個を超える、または plain JavaScript で schema と contract drift の維持が難しくなった段階で TypeScript を追加する。
7. ホスティング先を選定してから、deployment-specific adapter を追加する。
