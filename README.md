# Asagao Workspace

Asagao Workspace is a minimal scaffold for building a ChatGPT App with the OpenAI Apps SDK and a Model Context Protocol (MCP) server.

## What is included

- A minimal Node.js MCP server exposed at `/mcp`.
- A small iframe UI resource for ChatGPT Apps.
- One read-only starter tool: `get_workspace_status`.
- A layered source layout for future tools, authentication, persistence, and delivery concerns.
- Local development scripts for running, validating, and testing the server.
- MCP Inspector command for local tool testing.
- GitHub Actions CI for syntax checks and tests.
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
npm run verify
```

This runs syntax checks and the Node.js test suite.

Individual commands:

```bash
npm run check
npm test
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

## Architecture

The project intentionally separates the app into thin layers:

```text
.
├── .github/workflows/ci.yml
├── docs/
│   ├── architecture.md
│   └── adr/0001-layered-mcp-app.md
├── public/asagao-widget.html
├── scripts/check-syntax.js
├── src/
│   ├── app/                 # MCP app composition
│   ├── config/              # environment/config loading
│   ├── http/                # HTTP + Streamable HTTP transport adapter
│   ├── runtime/             # process startup boundary
│   ├── tools/               # MCP tool registry and tool modules
│   └── ui/                  # Apps SDK UI resource registration
├── tests/
├── AGENTS.md
├── package.json
├── server.js                # thin entrypoint
└── README.md
```

See [`docs/architecture.md`](docs/architecture.md) for the intended extension model.

## Development policy

Do not work directly on `main`. Create a feature branch for every change.

Architecture foundation branch:

```text
feat/app-architecture-foundation
```

Earlier minimal environment branch:

```text
feat/chatgpt-app-minimal-env
```

## Adding a new tool

1. Create a new directory under `src/tools/<tool-name>/`.
2. Put pure data/model logic in `model.js`.
3. Put Apps SDK registration code in `register.js`.
4. Add the registration function to `src/tools/index.js`.
5. Add or update tests under `tests/`.
6. Update this README and `docs/architecture.md` if the tool changes boundaries, safety assumptions, or runtime requirements.

## Next steps

1. Replace the starter `get_workspace_status` tool with the first real Asagao Workspace capability.
2. Decide whether the app needs authentication before exposing user-specific or write-capable tools.
3. Add state persistence only after the tool model is stable.
4. Add deployment configuration once the target hosting platform is selected.
