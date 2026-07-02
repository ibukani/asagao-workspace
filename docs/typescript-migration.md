# TypeScript 移行計画

Asagao Workspace の tool surface が増える前に、JavaScript から TypeScript へ段階的に移行する。

## 目的

- MCP tool contract と domain model の型安全性を高める。
- `zod` schema と実装の drift を減らす。
- filesystem、command job、artifact export などの安全境界を実装する前に、型で扱える domain boundary を作る。
- 後続の Workspace Runner 実装で、input/output contract をレビューしやすくする。

## 現在の方針

TypeScript tooling は導入済みで、アプリ本体、テスト、Workspace Runner の contract は `.ts` で管理する。

- `server.js` は薄い Node entrypoint として残す。
- 実装、テスト、スクリプトは TypeScript を基本にする。
- `npm run verify` は syntax check、typecheck、test を実行する。
- Workspace Runner の domain model と MCP tool contract は Zod schema と TypeScript type を同じ module から export する。

## 推奨ステップ

1. 新規 module は `.ts` で追加する。
2. `server.js` は thin entrypoint のまま維持する。
3. domain model / service / storage は TypeScript 前提で設計する。
4. Node.js の native TypeScript 実行で扱えない構文を避け、`tsc --noEmit` で strict typecheck する。
5. `allowJs` は `server.js` を含めるためだけに残し、実装 module は `.ts` に寄せる。

## 非目標

- TypeScript 移行と Workspace Runner の実機能実装を同じ PR に混ぜない。
- filesystem 操作、shell 実行、patch 適用などの安全設計が必要な機能はこの PR では追加しない。

## 完了条件

- `npm run verify` が TypeScript typecheck を含む。
- `server.js` の薄い entrypoint から TypeScript module を起動できる。
- Workspace Runner の domain contract は `.ts` module としてレビューできる。
