# Architecture

Asagao Workspace is structured as a small but extensible ChatGPT App built around a Model Context Protocol (MCP) server.

The current goal is not to add many capabilities early. The goal is to keep the extension points explicit so future file tools, authentication, persistence, safety checks, and UI screens can be added without turning the entrypoint into a monolith.

## Product direction

Asagao Workspace should be treated as a safe development Workspace Runner for ChatGPT, not as a generic GitHub App clone.

The app should focus on the capabilities that ChatGPT currently lacks inside the chat environment:

- isolated workspaces
- multi-file patch and artifact application
- command execution with asynchronous job polling
- command logs and validation evidence
- workspace diffs and git status
- snapshots and rollback
- patch, archive, or change-set export

Simple source-host operations such as listing issues, reading pull requests, posting comments, or editing GitHub metadata should stay outside the core product unless they are directly required to materialize a validated workspace change set.

See [`docs/workspace-runner-design.md`](workspace-runner-design.md) for the detailed design direction.

## Principles

1. Keep `server.js` thin.
2. Separate transport concerns from app/tool concerns.
3. Separate Apps SDK registration from pure domain/model logic.
4. Keep ChatGPT-facing tool contracts stable and structured.
5. Add write-capable or local-PC-capable tools only after an explicit safety design.
6. Prefer small modules that can be tested without starting an HTTP server.
7. Keep the core domain source-host agnostic. GitHub can be a source or destination, but the primary domain model should be Workspace, Command Job, Artifact, Snapshot, and Change Set.

## Layers

```text
server.js
  -> src/runtime/start-server.js
    -> src/http/create-http-server.js
      -> src/app/create-asagao-mcp-server.js
        -> src/ui/register-ui-resources.js
        -> src/tools/index.js
          -> src/tools/<tool>/register.js
             -> src/tools/<tool>/model.js
```

### Runtime layer

Location: `src/runtime/`

Owns process startup and lifecycle concerns. This is where future shutdown handling, signal handling, and observability startup hooks should live.

### HTTP layer

Location: `src/http/`

Owns HTTP routing, CORS, health checks, and MCP Streamable HTTP transport handling. It should not contain tool-specific business logic.

Future additions that belong here:

- production CORS policy
- request logging
- rate limiting
- health and readiness checks
- transport-level authentication hooks

### App composition layer

Location: `src/app/`

Owns the composition of the MCP server. It creates the MCP server and registers UI resources and tools. It should remain a wiring layer.

### Tool layer

Location: `src/tools/`

Each tool should use this pattern:

```text
src/tools/<tool-name>/
├── model.js      # pure data/model logic
└── register.js   # Apps SDK/MCP registration
```

`model.js` should be easy to test without running the server. `register.js` may import Apps SDK helpers and define schemas, annotations, metadata, and handlers.

### UI resource layer

Location: `src/ui/` and `public/`

`src/ui/` registers Apps SDK resources. `public/` stores static HTML/CSS/JS assets.

The UI should remain optional from the tool model's point of view. A tool should still return useful structured content even if no UI is rendered.

### Configuration layer

Location: `src/config/`

Owns environment parsing and defaults. Runtime code should consume a `config` object rather than reading `process.env` directly.

## Tool contract policy

Every tool should define:

- a concrete action-oriented name
- input schema
- output schema
- read/write annotations where applicable
- structured content for ChatGPT and UI consumers
- tests for pure output-building logic

Avoid generic names like `execute`, `run`, `do_task`, or `handle`.

## Safety boundary for future capabilities

Before adding filesystem, shell, network, or user-data tools, add a design document that covers:

- allowed operations
- denied operations
- permission model
- confirmation model
- audit logging
- data retention
- error behavior
- test cases for unsafe inputs

Until that exists, this project should avoid arbitrary local shell execution and broad filesystem access.

## Recommended next architecture milestones

1. Add a `src/security/` boundary before implementing write-capable tools.
2. Add a `src/storage/` boundary only when the first persistent state requirement is clear.
3. Add domain models for Workspace, Command Job, Artifact, Snapshot, and Change Set before implementing the real runner.
4. Add a `src/services/` boundary if tool handlers start sharing nontrivial app logic.
5. Add TypeScript once the tool surface grows beyond a few modules or schemas become difficult to maintain in plain JavaScript.
6. Add deployment-specific adapters only after choosing the hosting target.
