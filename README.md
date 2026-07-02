# Asagao Workspace

Asagao Workspace は、OpenAI Apps SDK と Model Context Protocol（MCP）サーバーを使って ChatGPT App を作るための最小構成のひな形です。

## 含まれているもの

- `/mcp` で公開される最小構成の Node.js MCP サーバー。
- ChatGPT Apps 用の小さな iframe UI リソース。
- 読み取り専用のスターターツール: `get_workspace_status`。
- Workspace lifecycle ツール: `create_workspace`、`list_workspaces`、`get_workspace`、`delete_workspace`。
- Workspace Runner の中核となる domain model: Workspace、Command Job、Artifact、Snapshot、Change Set。
- Workspace lifecycle 系ツールの contract schema、handler model、local workspace directory 管理。
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
│   └── adr/0001-layered-mcp-app.md
├── public/asagao-widget.html
├── scripts/check-syntax.ts
├── src/
│   ├── app/                 # MCP アプリの組み立てと共有 app context
│   ├── config/              # 環境変数・設定の読み込み
│   ├── domain/              # Workspace Runner の共通ドメイン契約
│   ├── filesystem/          # Workspace root / path traversal / symlink 境界
│   ├── http/                # HTTP + Streamable HTTP transport アダプタ
│   ├── runtime/             # プロセス起動境界
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

想定している拡張モデルについては [`docs/architecture.md`](docs/architecture.md) を参照してください。

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

この段階では process-local な Workspace record を作成・一覧・取得・削除できます。`create_workspace` は設定された workspace root 配下に workspace ごとの実ディレクトリを作成し、`delete_workspace` は対象 workspace directory だけを安全に削除してから record を `deleted` status へ遷移させます。

workspace root は環境変数で変更できます。

```text
ASAGAO_WORKSPACE_ROOT=.asagao/workspaces
```

`ASAGAO_WORKSPACE_ROOT` は相対パス・絶対パスの両方を受け付け、内部では絶対パスへ正規化されます。空文字、NUL byte、URL 形式、filesystem root そのものは拒否されます。workspace root が存在しない場合は作成し、directory ではない場合や書き込み不可の場合は明示的な filesystem error として扱います。

Workspace path の解決は `workspaceId + relativePath` の形に閉じ、root 外・workspace 外へ出る path traversal と、root 外へ抜ける symlink traversal を拒否します。ChatGPT-facing な tool output にはホスト側の絶対パスを露出しません。

repository clone、patch 適用、shell 実行、file read/write tool はまだ行いません。

## 新しいツールを追加する

1. `src/tools/<tool-name>/` の下に新しいディレクトリを作成する。
2. 純粋なデータ・モデルロジックを `model.ts` に置く。
3. Apps SDK の登録コードを `register.ts` に置く。
4. 登録関数を `src/tools/index.ts` に追加する。
5. `tests/` 配下にテストを追加または更新する。
6. ツールが境界、安全性の前提、実行時要件を変える場合は、この README と `docs/architecture.md` を更新する。

## 次のステップ

1. Runner 安全ポリシーと監査ログの基盤を追加する。
2. Workspace 内 file inspection tool を追加する。
3. apply_patch と git status/diff tool を追加する。
4. command job 基盤を追加する。
5. ツールモデルが安定してから状態の永続化を追加する。
6. 対象のホスティング基盤を選定してからデプロイ設定を追加する。
