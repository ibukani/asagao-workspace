# ADR 0001: レイヤー分けされた MCP app 構成

## Status

Accepted

## Context

初期 scaffold では、MCP サーバー作成、Apps SDK UI resource 登録、tool 登録、HTTP handling、CORS handling、process startup が単一の `server.js` に置かれていました。

使い捨ての MVP であれば、この形でも問題ありません。しかし、file tool、authentication、persistence、safety check、複数 UI resource、deployment-specific behavior を追加し始めると、この構成は拡張しづらくなります。

## Decision

レイヤー分けされた TypeScript 構成を使います。

- `server.js` は薄い process entrypoint のままにする。
- `src/runtime/` は startup と lifecycle を担当する。
- `src/http/` は HTTP routing と MCP transport handling を担当する。
- `src/app/` は MCP server composition を担当する。
- `src/ui/` は Apps SDK resource registration を担当する。
- `src/tools/` は tool registration と tool-specific な純粋 model logic を担当する。
- `src/config/` は environment parsing を担当する。
- `docs/` は architecture decision を記録する。

Tool module では、pure output-building/model logic と Apps SDK registration を分離します。これにより、MCP サーバーを起動せずに behavior をテストできます。

## Consequences

Positive:

- 新しい tool の置き場所が明確になる。
- HTTP transport と app behavior を独立して発展させられる。
- サーバーを起動しなくても config と tool behavior をテストできる。
- 将来の security、storage、service layer を、entrypoint を書き換えずに導入できる。

Tradeoffs:

- 最小構成の single-file scaffold よりも file 数が増える。
- TypeScript の型は runtime validation の代替ではないため、tool boundary では Zod schema を併用する。

## Follow-up

Tool surface が増えても schema と contract drift を抑えられるよう、TypeScript と Zod schema を併用します。
