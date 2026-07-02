# Agent Instructions

This repository contains the Asagao Workspace ChatGPT App scaffold.

## Branching

- Do not work directly on `main`.
- Create a feature branch before changing files.
- Use focused branch names, for example `feat/add-workspace-file-tools` or `fix/mcp-health-check`.

## Runtime

- Use Node.js 22 or later.
- Use npm as the package manager.
- The process entrypoint is `server.js`, which imports TypeScript modules through Node.js type stripping.
- `server.js` must stay thin; put real implementation under `src/`.
- The local MCP endpoint is `http://localhost:8787/mcp` by default.

## Commands

Run these before committing changes:

```bash
npm install
npm run verify
```

For local manual testing:

```bash
npm run dev
npm run inspect
```

## Architecture boundaries

- `src/app/`: MCP app composition only. It wires resources and tools together.
- `src/config/`: environment and configuration loading.
- `src/domain/`: Workspace Runner domain models, Zod schemas, and common tool response envelopes.
- `src/http/`: HTTP server, CORS, request routing, and Streamable HTTP transport adapter.
- `src/runtime/`: process startup and lifecycle boundary.
- `src/tools/`: MCP tool modules. Each tool should keep pure model/data logic separate from Apps SDK registration.
- `src/ui/`: Apps SDK UI resource registration.
- `public/`: static UI assets served through Apps SDK resources.
- `tests/`: fast tests for config and pure tool behavior.
- `docs/`: architecture notes and ADRs.

## Adding a tool

1. Create `src/tools/<tool-name>/model.ts` for pure logic.
2. Create `src/tools/<tool-name>/register.ts` for Apps SDK registration.
3. Register it from `src/tools/index.ts`.
4. Add tests that cover the pure logic and any exported Zod contract.
5. Update `README.md`, `docs/architecture.md`, and relevant contract documentation when behavior or boundaries change.

## Development rules

- Keep the repository minimal until the first real app capability is decided.
- Do not commit secrets, tokens, API keys, OAuth client secrets, or local tunnel URLs.
- Do not add arbitrary local PC control, shell execution, or file-system write tools without an explicit safety design.
- Keep MCP tool names concrete and action-oriented.
- Keep ChatGPT-facing tool outputs structured and stable.
- Update documentation when adding or removing tools, scripts, environment variables, setup steps, or architectural boundaries.
- Prefer small, reviewable commits.

## Current scaffold

- `server.js` is a thin entrypoint.
- `src/app/create-asagao-mcp-server.ts` composes the MCP server.
- `src/domain/` defines Workspace Runner domain models, Zod schemas, and common tool response envelopes.
- `src/http/create-http-server.ts` owns HTTP routing and transport handling.
- `src/tools/workspace-status/` defines the starter tool.
- `src/tools/workspace-lifecycle/contracts.ts` defines the initial workspace lifecycle MCP tool contracts.
- `public/asagao-widget.html` defines the minimal ChatGPT iframe UI.
- `.github/workflows/ci.yml` runs verification on pull requests and pushes.
