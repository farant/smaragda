# bun-libraries

A single-file, zero-dependency utility library for Bun scripts. Inspired by STB single-header libraries.

## Philosophy

- **One file. No build step.** `libraries.ts` is the source of truth. It is not generated or concatenated from smaller files. You edit it directly.
- **Zero external dependencies.** Only Bun built-ins and Node APIs available in Bun.
- **Copy-friendly.** Drop `libraries.ts` into any project and import what you need.

## File Structure

`libraries.ts` is organized into sections using greppable header comments:

```
// ============================================================================
// SECTION: Section Name
// ============================================================================
```

Each section begins with a **library doc block** and then the implementation:

```
// ============================================================================
// SECTION: Section Name
// ============================================================================
//
// Summary:
//   Brief description of what this library does and when you'd reach for it.
//
// Usage:
//   const server = mcpServer({ name: "my-tool", version: "1.0.0" });
//   server.tool("greet", { name: z.string() }, async ({ name }) => {
//     return { content: [{ type: "text", text: `Hello ${name}` }] };
//   });
//   server.serve();
//
// Bun built-ins:
//   - bun:sqlite — Raw Database class. No migration runner, no WAL-by-default,
//     no typed query helpers. You end up writing the same boilerplate every time.
//
// Design notes:
//   - The SSE transport buffers messages because <reason>.
//   - We avoid X in favor of Y because <tradeoff>.
//
```

The four parts of the doc block:
1. **Summary** — what it is and when to use it (2-3 sentences max).
2. **Usage** — a realistic, copy-pasteable code example showing the primary workflow.
3. **Bun built-ins** — which Bun/Node standard modules are relevant, and a short explanation of what gap this library fills over using them directly.
4. **Design notes** — non-obvious implementation decisions, tradeoffs, or gotchas. Only include if there's something worth calling out. Skip this section for straightforward libraries.

After the doc block, implementation follows this order:
1. Types and interfaces
2. Constants
3. Core functions
4. Convenience / shorthand functions

To find a section: `grep "^// SECTION:" libraries.ts`

### Sections (current)

| Section | Purpose |
|---------|---------|
| `SQLite` | Litestream-compatible setup (WAL, pragmas) and migration runner. Thin layer — consumers use `bun:sqlite` Database directly after setup. |
| `Event Sourcing` | Append-only event store on SQLite. Replay, materialize, high-water mark tracking. The core "entity database" primitive. |
| `HTTP` | Routing, JSON responses, error handling, CORS on top of `Bun.serve()`. |
| `MCP` | MCP protocol — JSON-RPC, stdio/SSE transport, tool/resource registration. |
| `Sync` | Push/pull sync protocol, watermark tracking. Builds on Event Sourcing HWMs. |

### smaragda.ts Sections

`smaragda.ts` uses the same section header convention. Find sections: `grep "^// SECTION:" smaragda.ts`

| Section | Purpose |
|---------|---------|
| `Tessella Store` | Append-only event store: res, tessellae, replay, materialize. |
| `Genus` | Type system for entities: attributes, states, transitions, roles. Includes Science → Taxonomy → Genus hierarchy for classification. |
| `Actions` | Declarative business logic: preconditions, parameters, side-effect handlers. |
| `Relationships` | Typed many-to-many links between entities with role-based membership. |
| `Health` | Automated health evaluation and error tracking for entities. |
| `Tasks` | Task management: create, claim, complete, cancel. |
| `Processes` | Multi-lane workflows with task steps, fetch steps, gate steps, and action steps. |
| `Cron` | Scheduled automation: cron expressions, recurring action/process triggers, tick engine. |
| `Branches` | Branch-and-merge for isolated changes with conflict detection. |
| `Serialization` | Export entities to file trees (markdown), edit externally, import changes back as tessellae. |
| `Sync` | Push/pull sync between kernels with watermark tracking. |
| `Palace` | Spatial navigation: rooms, scrolls, portals for persistent memory-palace navigation. |

## Naming Conventions

- All exported functions use camelCase.
- Types/interfaces use PascalCase.
- Section-internal helpers are prefixed with `_` and not exported.
- Related functions share a prefix matching their section (e.g., `mcpServer()`, `mcpTool()`, `sqliteOpen()`, `sqliteMigrate()`).

## Export Style

Everything is a named export. Consumers can use either style:
```ts
import { mcpServer, sqliteOpen } from './libraries'
import * as lib from './libraries'
```

## Testing

- Tests live in this folder as `libraries.test.ts`.
- One `describe()` block per section, mirroring the section names.
- Run with: `bun test`
- Tests should be self-contained — no fixtures, no external state. Use in-memory SQLite, temp directories, etc.

## Development Workflow

When modifying `libraries.ts`:
1. Identify the target section via grep or the table above.
2. Make changes within that section's boundaries.
3. Run `bun test` to verify nothing broke.
4. If adding a new public function, add a corresponding test.

When adding a new section:
1. Add the section header comment block.
2. Update the table in this file.
3. Create a corresponding `describe()` block in `libraries.test.ts`.
