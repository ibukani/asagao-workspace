# Agent Instructions

This repository contains the Asagao Workspace ChatGPT App scaffold.

## Branching

- Do not work directly on `main`.
- Create a feature branch before changing files.
- Use focused branch names, for example `feat/add-workspace-file-tools` or `fix/mcp-health-check`.

## Runtime

- Use Node.js 22 or later.
- Use npm as the package manager.
- The MCP server entrypoint is `server.js`.
- The local MCP endpoint is `http://localhost:8787/mcp` by default.

## Commands

Run these before committing changes:

```bash
npm install
npm run check
```

For local manual testing:

```bash
npm run dev
npm run inspect
```

## Development rules

- Keep the repository minimal until the first real app capability is decided.
- Do not commit secrets, tokens, API keys, OAuth client secrets, or local tunnel URLs.
- Do not add arbitrary local PC control, shell execution, or file-system write tools without an explicit safety design.
- Keep MCP tool names concrete and action-oriented.
- Update `README.md` when adding or removing tools, scripts, environment variables, or setup steps.
- Prefer small, reviewable commits.

## Current scaffold

- `server.js` defines the MCP server and starter tool.
- `public/asagao-widget.html` defines the minimal ChatGPT iframe UI.
- `.github/workflows/ci.yml` runs a syntax check on pull requests and pushes.
