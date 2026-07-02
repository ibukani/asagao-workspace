# Asagao Workspace

Asagao Workspace は、OpenAI Apps SDK と Model Context Protocol（MCP）サーバーを使って ChatGPT App を作るための最小構成のひな形です。

## 含まれているもの

- `/mcp` で公開される最小構成の Node.js MCP サーバー。
- ChatGPT Apps 用の小さな iframe UI リソース。
- 読み取り専用のスターターツール: `get_workspace_status`。
- Workspace Runner の中核となる domain model: Workspace、Command Job、Artifact、Snapshot、Change Set。
- Workspace lifecycle 系ツールの contract schema: `create_workspace`、`list_workspaces`、`get_workspace`、`delete_workspace`。
- 共通 tool result envelope と error result の pure model。
- 将来のツール、認証、永続化、配信まわりの関心事に拡張しやすいレイヤー分けされたソース構成。
- サーバーの起動、検証、テストを行うローカル開発用スクリプト。
- ローカルでツールを確認するための MCP Inspector コマンド。
- 構文チェックとテストを実行する GitHub Actions CI。
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

このコマンドは構文チェックと Node.js のテストスイートを実行します。

個別に実行する場合:

```bash
npm run check
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
│   └── adr/0001-layered-mcp-app.md
├── public/asagao-widget.html
├── scripts/check-syntax.js
├── src/
│   ├── app/                 # MCP アプリの組み立て
│   ├── config/              # 環境変数・設定の読み込み
│   ├── domain/              # Workspace Runner の純粋な domain model
│   ├── http/                # HTTP + Streamable HTTP transport アダプタ
│   ├── runtime/             # プロセス起動境界
│   ├── tools/               # MCP ツールレジストリと各ツールモジュール
│   └── ui/                  # Apps SDK UI リソース登録
├── tests/
├── AGENTS.md
├── package.json
├── server.js                # 薄いエントリポイント
└── README.md
```

想定している拡張モデルについては [`docs/architecture.md`](docs/architecture.md) を参照してください。

## Workspace Runner contracts

`src/domain/` には、実 filesystem 操作や shell 実行を行わない pure model を置きます。

現時点で定義している中核モデル:

- `Workspace`
- `CommandJob`
- `ArtifactRef`
- `Snapshot`
- `ChangedFile` / `DiffStat` / `ChangeSet`
- 共通 tool result envelope

`src/tools/workspace-lifecycle/contracts.js` には、次の lifecycle 系 tool contract を定義しています。

- `create_workspace`
- `list_workspaces`
- `get_workspace`
- `delete_workspace`

この段階では contract と schema のみを固定しており、実際の workspace 作成、filesystem 操作、shell 実行はまだ行いません。

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

## 新しいツールを追加する

1. `src/tools/<tool-name>/` の下に新しいディレクトリを作成する。
2. 純粋なデータ・モデルロジックを `model.js` に置く。
3. Apps SDK の登録コードを `register.js` に置く。
4. 登録関数を `src/tools/index.js` に追加する。
5. `tests/` 配下にテストを追加または更新する。
6. ツールが境界、安全性の前提、実行時要件を変える場合は、この README と `docs/architecture.md` を更新する。

## 次のステップ

1. Workspace lifecycle contract を in-memory registry に接続する。
2. ユーザー固有または書き込み可能なツールを公開する前に、認証が必要かどうかを決める。
3. Config 可能な workspace root と安全な path 境界を追加する。
4. ツールモデルが安定してから状態の永続化を追加する。
5. 対象のホスティング基盤を選定してからデプロイ設定を追加する。
