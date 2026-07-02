# ADR 0001: Layered MCP app structure

## Status

Accepted

## Context

The initial scaffold placed MCP server creation, Apps SDK UI resource registration, tool registration, HTTP handling, CORS handling, and process startup in a single `server.js` file.

That shape is acceptable for a throwaway MVP, but it becomes hard to extend once the app adds file tools, authentication, persistence, safety checks, multiple UI resources, or deployment-specific behavior.

## Decision

Use a layered JavaScript structure:

- `server.js` remains a thin process entrypoint.
- `src/runtime/` owns startup and lifecycle.
- `src/http/` owns HTTP routing and MCP transport handling.
- `src/app/` owns MCP server composition.
- `src/ui/` owns Apps SDK resource registration.
- `src/tools/` owns tool registration and tool-specific pure model logic.
- `src/config/` owns environment parsing.
- `docs/` records architectural decisions.

Tool modules should separate pure output-building/model logic from Apps SDK registration so behavior can be tested without starting the MCP server.

## Consequences

Positive:

- New tools have an obvious place to live.
- HTTP transport and app behavior can evolve independently.
- Tests can cover config and tool behavior without booting the server.
- Future security, storage, and service layers can be introduced without rewriting the entrypoint.

Tradeoffs:

- There are more files than a minimal single-file scaffold.
- Plain JavaScript cannot enforce all interface boundaries at compile time.

## Follow-up

Consider moving to TypeScript when the tool surface grows enough that schema and contract drift becomes a real maintenance cost.
