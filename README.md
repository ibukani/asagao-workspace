# Asagao Workspace

Asagao Workspace is a minimal scaffold for building a ChatGPT App with the OpenAI Apps SDK and a Model Context Protocol (MCP) server.

## What is included

- A minimal Node.js MCP server exposed at `/mcp`.
- A small iframe UI resource for ChatGPT Apps.
- One read-only starter tool: `get_workspace_status`.
- Local development scripts for running and validating the server.
- MCP Inspector command for local tool testing.
- GitHub Actions CI for basic syntax checks.
- `AGENTS.md` so Codex and other coding agents know how to work in this repository.

## Requirements

- Node.js 22 or later
- npm

## Setup

```bash
npm install
```

## Run locally

```bash
npm run dev
```

The server listens on:

```text
http://localhost:8787/mcp
```

Health check:

```bash
curl http://localhost:8787/
```

## Validate

```bash
npm run check
```

## Test with MCP Inspector

```bash
npm run inspect
```

This opens the MCP Inspector against `http://localhost:8787/mcp`.

## Connect from ChatGPT during development

Expose the local server through an HTTPS tunnel, for example:

```bash
ngrok http 8787
```

Then register the connector URL in ChatGPT as:

```text
https://<your-tunnel-domain>/mcp
```

## Project structure

```text
.
├── .github/workflows/ci.yml
├── public/asagao-widget.html
├── AGENTS.md
├── package.json
├── server.js
└── README.md
```

## Development policy

Do not work directly on `main`. Create a feature branch for every change.

This initial environment was prepared on:

```text
feat/chatgpt-app-minimal-env
```

## Next steps

1. Replace the starter `get_workspace_status` tool with the first real Asagao Workspace capability.
2. Decide whether the app needs authentication before exposing user-specific or write-capable tools.
3. Add state persistence only after the tool model is stable.
4. Add deployment configuration once the target hosting platform is selected.
