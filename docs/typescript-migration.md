# TypeScript 移行計画

Asagao Workspace の tool surface が増える前に、JavaScript から TypeScript へ段階的に移行する。

## 目的

- MCP tool contract と domain model の型安全性を高める。
- `zod` schema と実装の drift を減らす。
- filesystem、command job、artifact export などの安全境界を実装する前に、型で扱える domain boundary を作る。
- 後続の Workspace Runner 実装で、input/output contract をレビューしやすくする。

## 方針

最初の PR では、既存の JavaScript 実装を壊さず TypeScript tooling を導入する。

- `typescript` を devDependency に追加する。
- `tsconfig.json` を追加する。
- `npm run typecheck` を追加する。
- `npm run verify` に typecheck を含める。
- 既存の `.js` は `allowJs` で取り込み、後続 PR で段階的に `.ts` へ移行する。

## 推奨ステップ

1. TypeScript tooling を導入する。
2. `src/config/` と `src/runtime/` のような依存の少ない boundary から `.ts` 化する。
3. `src/http/` を `.ts` 化する。
4. `src/app/` と `src/ui/` を `.ts` 化する。
5. `src/tools/` を tool ごとに `.ts` 化する。
6. domain model / service / storage を追加する前に TypeScript 前提で設計する。
7. `allowJs` を段階的に外し、最終的に `checkJs` ではなく `.ts` の strict typecheck に寄せる。

## 非目標

- この PR だけで全ファイルを `.ts` に変換しない。
- TypeScript 移行と Workspace Runner の実機能実装を同じ PR に混ぜない。
- filesystem 操作、shell 実行、patch 適用などの安全設計が必要な機能はこの PR では追加しない。

## 完了条件

- `npm run verify` が TypeScript typecheck を含む。
- 既存の JavaScript scaffold が動作する状態を維持する。
- 後続 PR でファイル単位の `.ts` 移行を進められる。
