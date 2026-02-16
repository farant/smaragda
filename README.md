# Smaragda

Smaragda is an event-sourced ERP kernel built on Bun and SQLite. It provides a full-stack system for defining typed entities, enforcing state machines, running declarative business logic, managing workflows, and exposing everything over the Model Context Protocol (MCP) for AI agent interaction.

The project has three layers:

```
libraries.ts   Zero-dependency utility library (ULID, SQLite, Event Sourcing, HTTP, MCP)
     |
smaragda.ts    ERP kernel (entities, genera, actions, relationships, processes, palace...)
     |
server.ts      MCP server exposing the kernel over HTTP with OAuth
```

## The Memory Palace

The most distinctive feature of Smaragda is its **memory palace** — a spatial navigation layer that gives each workspace a persistent, explorable space. AI agents build the palace as they work — creating rooms, writing scrolls, placing NPCs with dialogue trees, and linking entities into the spatial layout. The result is a navigable, text-adventure-style representation of everything the agent has learned and organized.

**Rooms** have vivid narrative descriptions, numbered action menus, portals to other rooms, and scrolls pinned to the walls. Actions can navigate between rooms, query entities, or display static content. Room descriptions support live entity references (`*GenusName:EntityName*`) and portal links (`[room-slug]prose[/]`) that resolve to interactive elements.

**NPCs** are characters that live in rooms and carry branching dialogue trees. Each conversation node can reference entities, require previous nodes to be visited first, and unlock new dialogue paths — creating progressive disclosure of information through natural conversation.

**Scrolls** are dated notes attached to rooms — session logs, design decisions, reference material. They persist across sessions and give agents (and humans) a way to leave context for future visits.

Navigate the palace yourself at `http://localhost:3000/palace` when the server is running. The web interface provides a read-only view of rooms, scrolls, NPCs, entities, and tasks. Agents interact with the palace through the `palace_action` MCP tool using numbered actions or verb commands (`go`, `look`, `examine`, `talk`, `search`).

## Quick Start

Requires [Bun](https://bun.sh) v1.0+.

```bash
# Run the test suite
bun test

# Start the MCP server (creates smaragda.db in the current directory)
bun server.ts

# Browse the palace web UI
open http://localhost:3000/palace
```

The MCP server listens on port 3000 by default. Configure via environment variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | HTTP port |
| `DB_PATH` | `smaragda.db` | SQLite database path |
| `AUTH_TOKEN` | auto-generated | Bearer token for authentication |
| `ORIGIN` | `http://localhost:PORT` | Public origin for OAuth metadata |

## Philosophy

- **Single-file modules.** `libraries.ts` and `smaragda.ts` are each a single file organized into greppable sections. No build step, no bundler, no external dependencies beyond Bun built-ins.
- **Event sourcing everywhere.** All state is derived from an append-only log of immutable facts ("tessellae"). You can replay history, materialize state at any point in time, branch and merge, and sync between nodes.
- **Schema as data.** Entity types ("genera") are themselves stored as tessellae, so the type system is introspectable, evolvable, and version-controlled by the same mechanism that tracks entity state.
- **AI-native.** The MCP server exposes 85+ tools designed for Claude and other AI agents to create, query, and manage entities through structured tool calls.

## libraries.ts -- Utility Library

A zero-dependency utility library for Bun. Each section is self-contained and documented with a header comment block. Import what you need:

```ts
import { ulid, sqliteOpen, sqliteMigrate, esStore, mcpServer } from "./libraries";
```

### ULID

Universally Unique Lexicographically Sortable Identifiers. 128 bits as 26 Crockford base-32 characters. Monotonic within the same millisecond (increments the random portion instead of re-rolling). This is the ID scheme for every entity across every node.

```ts
const id = ulid();             // "01J5A3B7KC9QR0XVWT2MPD4GHN"
const ts = ulidTimestamp(id);  // 1720000000000 (ms since epoch)
```

### SQLite

Litestream-compatible database setup (WAL mode, busy timeout, foreign keys) and an append-only migration runner. Returns a raw `bun:sqlite` Database -- no wrapper, no ORM.

```ts
const db = sqliteOpen("./myapp.db");
sqliteMigrate(db, [
  "CREATE TABLE users (id TEXT PRIMARY KEY, name TEXT NOT NULL)",
  "ALTER TABLE users ADD COLUMN email TEXT",
]);
```

Migrations are tracked by index in a `_migrations` table. They are append-only -- no down migrations, matching the event-sourcing philosophy.

### Event Sourcing

Append-only event store backed by SQLite. Create named stores, append events to streams, replay them, fold into current state via a reducer, and track consumer high-water marks for sync.

```ts
const store = esStore(db, "accounts");
store.append("acct-1", "deposited", { amount: 100 });
const account = store.materialize("acct-1", reducer, {});
const hwm = store.hwmGet("sync-server");
```

Each store gets its own table pair (`{prefix}_events`, `{prefix}_hwm`). Sequence numbers are autoincrement integers for reliable watermark tracking.

> **Note:** This is a generic, reusable event-sourcing primitive. smaragda.ts does **not** use `esStore()` -- it builds its own tessella-based event store directly on SQLite with richer semantics (branching, genus-aware materialization, sync). smaragda only imports `ulid`, `sqliteOpen`, and `sqliteMigrate` from libraries.ts.

### HTTP

Utilities for `Bun.serve()`: CORS preflight handling, auto-JSON serialization of handler return values, structured error responses via `HttpError`, and body parsing with `httpJsonBody`.

```ts
Bun.serve({
  routes: {
    "/api/items/:id": {
      GET: httpHandler(async (req) => ({ id: req.params.id })),
    },
  },
  fetch: httpCors(httpNotFound),
});
```

### MCP (Model Context Protocol)

MCP server implementation with JSON-RPC dispatch, tool/resource registration, and Streamable HTTP transport. Protocol version 2025-11-25.

```ts
const server = mcpServer({ name: "my-tool", version: "1.0.0" });
server.tool("greet", {
  description: "Say hello",
  input: { type: "object", properties: { name: { type: "string" } } },
  handler: async ({ name }) => `Hello ${name}!`,
});
Bun.serve({
  routes: { "/mcp": { POST: server.httpTransport() } },
  fetch: httpCors(httpNotFound),
});
```

Tool handlers can return a string (auto-wrapped in text content) or a full `McpToolResult` for multi-part responses. Tool execution errors return `isError: true` in the result, not as JSON-RPC errors.

## smaragda.ts -- The ERP Kernel

The kernel is the heart of the system. It uses its own event-sourcing implementation built directly on SQLite (it does **not** use the generic `esStore()` from libraries.ts -- it only imports `ulid`, `sqliteOpen`, and `sqliteMigrate`). The two fundamental concepts are **res** and **tessellae**.

### Res and Tessellae

A **res** (short for "resource", plural "res") is the equivalent of an entity, aggregate, or record. Think of it as an identity with a history. Each res is identified by a ULID and belongs to a genus (its type). The `res` table stores the identity:

```sql
CREATE TABLE res (
  id TEXT PRIMARY KEY,           -- ULID
  genus_id TEXT NOT NULL,        -- what type of entity this is
  branch_id TEXT NOT NULL DEFAULT 'main',
  workspace_id TEXT,             -- multi-tenant isolation (added via migration)
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
```

A **tessella** (plural "tessellae", Latin for "tile") is a single immutable fact appended to a res's history. The metaphor is a mosaic: each tessella is a tile, and the complete picture (current state) is assembled by laying all the tiles in order. Tessellae are never updated or deleted -- you can only add new ones.

```sql
CREATE TABLE tessella (
  id INTEGER PRIMARY KEY AUTOINCREMENT,  -- global ordering for sync
  res_id TEXT NOT NULL,                  -- which res this fact belongs to
  branch_id TEXT NOT NULL DEFAULT 'main',
  type TEXT NOT NULL,                    -- e.g. "attribute_set", "status_changed"
  data TEXT NOT NULL,                    -- JSON payload
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  source TEXT                            -- origin tag for sync/merge dedup
);
```

A **reducer** is a pure function that folds tessellae into current state. `materialize(res_id)` replays all tessellae for a res in order through the reducer and returns the final state object.

```ts
const kernel = initKernel(":memory:");
const resId = createRes(kernel, genusId);
appendTessella(kernel, resId, "attribute_set", { key: "name", value: "prod-1" });
const state = materialize(kernel, resId);
// state = { name: "prod-1" }
```

Why Latin names? The system borrows from the biological taxonomy metaphor throughout (genus, species-like instances). "Res" and "tessella" are short, unambiguous, and don't collide with overloaded terms like "event", "entity", or "record".

### Core Data Model

The `defaultReducer` handles standard tessella types:

| Tessella Type | Effect |
|---|---|
| `created` | Resets state to `{}` |
| `attribute_set` | Sets `state[key] = value` |
| `attribute_removed` | Deletes `state[key]` |
| `status_changed` | Sets `state.status` |
| `feature_created` | Adds a sub-entity under `state.features` |
| `feature_attribute_set` | Sets an attribute on a feature |
| `feature_status_changed` | Changes a feature's status |
| `member_added` / `member_removed` | Manages relationship members |

Attributes are stored directly on state (`state.title`, `state.description`), not nested under `.attributes`.

### Genus System

Genera (singular: genus) are the type system. A genus defines:

- **Attributes** with types (`text`, `number`, `boolean`, `filetree`) and required flags
- **States** forming a state machine (exactly one marked `initial`)
- **Transitions** between states (with optional names)
- **Roles** for relationship genera (member type constraints and cardinality)
- **Meta** for free-form metadata (`name`, `kind`, `taxonomy_id`, `description`, etc.)

Genera are themselves res under `META_GENUS_ID` (a sentinel all-zeros ULID), so they're stored and versioned by the same tessella mechanism.

```ts
const serverGenus = defineEntityGenus(kernel, "Server", {
  attributes: [
    { name: "hostname", type: "text", required: true },
    { name: "provider", type: "text" },
  ],
  states: [
    { name: "provisioning", initial: true },
    { name: "active", initial: false },
    { name: "decommissioned", initial: false },
  ],
  transitions: [
    { from: "provisioning", to: "active" },
    { from: "active", to: "decommissioned" },
  ],
});
```

Schema evolution uses `evolveGenus()`, which is **additive-only**: it can append new attributes, states, and transitions to an existing genus, but never removes or modifies existing definitions. This constraint preserves backwards compatibility -- existing entities remain valid after evolution.

The `meta.kind` field discriminates genus types:

| Kind | Meaning |
|---|---|
| _(none)_ | Entity genus |
| `"action"` | Action genus |
| `"feature"` | Feature genus (sub-entities) |
| `"relationship"` | Relationship genus |
| `"process"` | Process workflow genus |
| `"serialization"` | Serialization template genus |

### Classification Hierarchy

Genera are organized into a three-level hierarchy:

```
Science  (top-level grouping, e.g. "Natural Sciences", "Humanities")
  |
Taxonomy  (category within a science, e.g. "Biology", "History")
  |
Genus  (entity type, e.g. "Species", "Historical Event")
```

Default science and default taxonomy are created at bootstrap. Every genus belongs to a taxonomy (defaulting to `DEFAULT_TAXONOMY_ID`). Taxonomies can be shared across sciences.

### Sentinel IDs

The system reserves a set of all-zeros ULIDs for built-in concepts. These are hardcoded constants that exist in every database from bootstrap, so code can reference them without lookup. The last two hex characters distinguish each sentinel:

| Constant | Suffix | Purpose |
|---|---|---|
| `META_GENUS_ID` | `00` | The genus of genera -- all genus definitions are res under this ID |
| `LOG_GENUS_ID` | `01` | Immutable log entries |
| `ERROR_GENUS_ID` | `02` | Errors with `open -> acknowledged` state machine |
| `TASK_GENUS_ID` | `03` | Built-in task entities |
| `BRANCH_GENUS_ID` | `04` | Branch metadata entities |
| `TAXONOMY_GENUS_ID` | `05` | Taxonomy definitions |
| `DEFAULT_TAXONOMY_ID` | `06` | The default taxonomy assigned to new genera |
| `CRON_SCHEDULE_GENUS_ID` | `07` | Cron schedule definitions |
| `WORKSPACE_GENUS_ID` | `08` | Workspace entities |
| `SCIENCE_GENUS_ID` | `09` | Science definitions |
| `DEFAULT_SCIENCE_ID` | `0A` | The default science created at bootstrap |
| `PALACE_ROOM_GENUS_ID` | `0B` | Palace room entities |
| `PALACE_SCROLL_GENUS_ID` | `0C` | Palace scroll entities |
| `PALACE_NPC_GENUS_ID` | `0D` | Palace NPC entities |

These sentinel entities are automatically filtered from user-facing lists (`listGenera`, `listEntities`) and excluded from sync (both sides bootstrap them independently).

### Features

Features are sub-entities that live within a parent entity's tessella stream. A feature genus defines attributes, states, and transitions, plus constraints on which parent statuses allow editing.

```ts
const pageGenus = defineFeatureGenus(kernel, "Page", {
  parent_genus_name: "Issue",
  attributes: [{ name: "page_number", type: "number", required: true }],
  states: [{ name: "draft", initial: true }, { name: "approved", initial: false }],
  transitions: [{ from: "draft", to: "approved" }],
  editable_parent_statuses: ["draft", "in_review"],
});
```

### Actions

Actions are declarative business logic. They define preconditions (required resource statuses), parameters, and a handler of side effects that execute atomically in a SQLite transaction.

```ts
const deployId = defineActionGenus(kernel, "deploy", {
  resources: [{ name: "server", genus_name: "Server", required_status: "active" }],
  parameters: [{ name: "version", type: "text", required: true }],
  handler: [
    { type: "set_attribute", res: "$res.server.id", key: "version", value: "$param.version" },
    { type: "transition_status", res: "$res.server.id", target: "deployed" },
    { type: "create_log", res: "$res.server.id", message: "Deployed $param.version" },
  ],
});
const result = executeAction(kernel, deployId, { server: entityId }, { version: "2.0" });
```

Handler substitution tokens: `$param.X` (parameter value), `$res.X.id` (bound resource ID), `$now` (ISO 8601 timestamp string via `new Date().toISOString()`). Side effect types: `set_attribute`, `transition_status`, `create_res`, `create_log`, `create_error`, `create_task`.

### Relationships

First-class typed many-to-many links between entities. Relationships are independent res with their own genus, attributes, states, and transitions. Roles define member type constraints and cardinality (`one`, `one_or_more`, `zero_or_more`).

```ts
const assignmentGenus = defineRelationshipGenus(kernel, "Assignment", {
  roles: [
    { name: "artist", valid_member_genera: ["Person"], cardinality: "one" },
    { name: "content", valid_member_genera: ["Issue"], cardinality: "one" },
  ],
  attributes: [{ name: "assigned_at", type: "text" }],
  states: [{ name: "active", initial: true }, { name: "completed", initial: false }],
  transitions: [{ from: "active", to: "completed" }],
});
```

A denormalized `relationship_member` index table enables fast reverse lookups.

### Health

Health evaluation checks an entity's materialized state against its genus definition:

- Missing required attributes
- Type mismatches
- Invalid status values
- Unacknowledged errors

The Error genus tracks persistent issues with an `open -> acknowledged` state machine, separate from the immutable Log genus.

### Tasks

Built-in task system with a sentinel Task genus. State machine: `pending -> claimed -> completed` (with `cancelled` reachable from pending or claimed, and direct `pending -> completed` for simple approval workflows).

```ts
const taskId = createTask(kernel, "Review layout", {
  description: "Check spacing and image placement",
  associated_res_id: issueId,
  priority: "high",
});
claimTask(kernel, taskId, { assigned_to: "claude" });
completeTask(kernel, taskId, "Approved");
```

### Processes

Multi-lane workflow engine. Process genera define workflow templates with:

- **Lanes**: parallel tracks of execution (e.g. "editorial", "art", "final")
- **Steps**: ordered units of work within lanes
  - `task_step`: creates a task and waits for completion
  - `action_step`: executes an action immediately
  - `fetch_step`: retrieves data (e.g. entity status)
  - `gate_step`: blocks until all named conditions are completed
  - `branch_step`: conditional routing -- reads an attribute from the context entity (`branch_condition`), looks it up in `branch_map` (a value-to-step-name mapping), and jumps to that step, skipping intermediate steps in the lane. Falls back to `branch_default` if no match.
- **Triggers**: how processes start (manual, action, condition, cron)

When `completeTask()` is called, the engine auto-advances any process instance that was waiting on that task.

```ts
const procGenus = defineProcessGenus(kernel, "Publication", {
  lanes: [
    { name: "editorial", position: 0 },
    { name: "art", position: 1 },
    { name: "final", position: 2 },
  ],
  steps: [
    { name: "review", type: "task_step", lane: "editorial", position: 0,
      task_title: "Review content" },
    { name: "convergence", type: "gate_step", lane: "final", position: 0,
      gate_conditions: ["editorial_approved", "art_approved"] },
    { name: "publish", type: "action_step", lane: "final", position: 1,
      action_name: "publish_issue" },
  ],
});
const instance = startProcess(kernel, procGenus, { context_res_id: issueId });
```

### Cron

Scheduled automation via cron expressions. Cron schedules are sentinel entities that trigger actions or processes on a recurring basis. Supports 5-field cron expressions plus `@daily`, `@hourly`, `@weekly`, `@monthly` aliases. Also supports one-time scheduled triggers via `createScheduledTrigger()`.

The server calls `tickCron()` every 60 seconds. Deduplication prevents double-firing within the same minute.

### Branches

Git-like branching for isolated changes. Create a branch, make changes, then merge back.

```ts
createBranch(kernel, "experiment");
switchBranch(kernel, "experiment");
setAttribute(kernel, entityId, "title", "New Title");
switchBranch(kernel, "main");
// main still has original title
mergeBranch(kernel, "experiment", "main");
// main now has "New Title"
```

Branch-aware materialization walks the parent chain. Merge uses a replay-on-merge strategy (copies tessellae from source to target with `source="merge:{name}"`). Conflict detection checks for res modified on both branches since the branch point.

Branch metadata lives as sentinel `BRANCH_GENUS_ID` entities always stored on "main". Genus operations always use "main"; entity operations route through `kernel.currentBranch`.

### Serialization

Export entities to file trees (markdown with frontmatter), edit externally, and import changes back as tessellae. Serialization targets are genera with `meta.kind = "serialization"`.

Templates use `{{entity.X}}` / `{{feature.X}}` delimiters. A `_manifest.json` file tracks entity-to-file mappings for round-trip import. Status fields are read-only during import (require `transitionStatus` instead).

```ts
const result = runSerialization(kernel, targetGenusId);
writeFiletree(result.filetree, "/tmp/export");
// ... edit files externally ...
const imported = importFiletree(kernel, "/tmp/export");
```

### Sync

Push/pull replication between kernels. Tracks watermarks in a `sync_state` table. Push extracts unpushed tessellae (excluding `sync:*` sources to prevent echo). Pull inserts data with source tagging for deduplication. Sentinel entities are excluded from sync -- both sides bootstrap them via `initKernel()`.

### Temporal Anchors

Attach year ranges to entities for timeline queries. Negative years represent BC dates. An index table enables fast range queries without materializing every entity.

```ts
setTemporalAnchor(kernel, entityId, { start_year: -3000, end_year: -2500, precision: "century" });
const timeline = queryTimeline(kernel, { start_year: -4000, end_year: -1000 });
```

### Palace

A spatial navigation layer giving AI agents a persistent "memory palace" for each workspace. Rooms have vivid descriptions, numbered actions, scrolls (dated notes), and portals (bidirectional links to other rooms).

Each room defines a list of **actions** that the agent sees as a numbered menu when entering. Actions have three types:

| Type | Purpose | Key Fields |
|---|---|---|
| `navigate` | Move to another room | `room` (target slug) |
| `query` | Call an MCP tool | `tool`, `tool_params` |
| `text` | Display static text | `content` |

When exposed through the MCP server, the server renders room actions as a numbered list (e.g. "1. Examine the map, 2. Enter the library"). The agent picks an action by number via the `palace_action` tool.

```ts
palaceBuildRoom(kernel, workspaceId, {
  slug: "great-hall",
  name: "Great Hall",
  description: "A vaulted entrance chamber with cracked marble floors...",
  actions: [
    { label: "Examine the map", type: "query", tool: "describe_system" },
    { label: "Enter the library", type: "navigate", room: "library" },
  ],
  portals: ["library"],
});
palaceWriteScroll(kernel, workspaceId, "great-hall", "Session Notes", "Explored the geology taxonomy...");
```

Rooms and scrolls are tessella-backed entities, enabling branching, audit trails, and the full event-sourcing toolkit.

**NPCs and dialogue trees.** Rooms can contain NPCs -- characters with a greeting message and a tree of dialogue nodes. Each `PalaceDialogueNode` has an `id`, `parent` (forming the tree), `prompt` (what the agent says), and `text` (the NPC's response). Nodes can reference entities (`entity_id`/`entity_ref`), require other nodes to be visited first (`requires`), and unlock new nodes when visited (`unlocks`). This creates branching conversations where information is progressively disclosed.

### Workspaces

Workspaces provide multi-tenant isolation. The `res` table has a `workspace_id` column, and most listing/querying operations automatically scope to `kernel.currentWorkspace`.

**Creating and switching.** `createWorkspace(kernel, name)` creates a workspace entity (under `WORKSPACE_GENUS_ID`). `switchWorkspace(kernel, workspace_id)` sets the active workspace on the kernel. Through the MCP server, the agent must call `set_workspace` before most other tools will work -- without a workspace, entity operations have no scope.

**Assigning entities.** Entities get a workspace at creation time (if `kernel.currentWorkspace` is set). Existing entities can be reassigned with `assignWorkspace(kernel, entity_id, workspace_id)`, or in bulk with `assignWorkspaceByGenus()` / `assignWorkspaceByTaxonomy()` (with an `unassigned_only` option to avoid overwriting).

**Relationship to classification.** Sciences are linked to workspaces, and taxonomies can be shared across workspaces. Genera (type definitions) are global -- they don't belong to a workspace. Entities (instances) belong to workspaces.

## server.ts -- MCP Server

The server exposes the full kernel over HTTP as an MCP server. Run with:

```bash
bun server.ts
```

### Configuration

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `3000` | HTTP port |
| `DB_PATH` | `smaragda.db` | SQLite database path |
| `AUTH_TOKEN` | auto-generated | Bearer token for authentication |
| `OAUTH_PASSWORD` | _(none)_ | Enables OAuth approval page |
| `ORIGIN` | `http://localhost:PORT` | Public origin for OAuth metadata |

### Authentication

Supports both static bearer tokens and full OAuth 2.0 with PKCE:

- **Static token**: `Authorization: Bearer <AUTH_TOKEN>`
- **OAuth**: Dynamic client registration at `/register`, authorization at `/authorize`, token exchange at `/token`

### Endpoints

| Path | Purpose |
|---|---|
| `/mcp` | MCP JSON-RPC endpoint (POST) |
| `/sync/pull` | Pull tessellae from server |
| `/sync/push` | Push tessellae to server |
| `/register` | OAuth dynamic client registration |
| `/authorize` | OAuth authorization |
| `/token` | OAuth token exchange |
| `/.well-known/oauth-*` | OAuth metadata discovery |

### Session Context

Each MCP session maintains workspace context, current branch, and palace navigation state. A `_session_id` is automatically injected into every tool call response and should be passed back on subsequent calls.

### Seed Data

The server seeds example genera on startup (idempotent via `evolveGenus`):

- **Server** genus with provisioning/active/deployed/decommissioned lifecycle
- **Issue** genus with editorial workflow (draft/in_review/approved/published/archived)
- **Page** feature genus for pages within issues
- **Person** genus for team members
- **Assignment** relationship genus linking people to issues
- **deploy** action for deploying versions to servers
- **Publication** process with editorial and art lanes
- **Markdown Export** serialization target for issues

### Tool Count

The server registers 85+ MCP tools organized by domain:

- **System**: `version`, `describe_system`
- **Workspaces**: `set_workspace`, `create_workspace`, `list_workspaces`, etc.
- **Classification**: `create_taxonomy`, `create_science`, `describe_taxonomy`, etc.
- **Genera**: `list_genera`, `define_entity_genus`, `evolve_genus`, `deprecate_genus`, etc.
- **Entities**: `create_entity`, `list_entities`, `get_entity`, `set_attribute`, `transition_status`, `batch_update`, etc.
- **Actions**: `define_action_genus`, `execute_action`, `list_available_actions`, `get_history`
- **Features**: `create_feature`, `set_feature_attribute`, `transition_feature_status`
- **Relationships**: `define_relationship_genus`, `create_relationship`, `get_relationships`, etc.
- **Health**: `get_health`, `list_unhealthy`, `acknowledge_error`, `list_errors`
- **Tasks**: `create_task`, `list_tasks`, `complete_task`
- **Processes**: `define_process_genus`, `start_process`, `get_process_status`, `list_processes`
- **Cron**: `create_cron_schedule`, `list_cron_schedules`, `trigger_cron`
- **Branches**: `create_branch`, `switch_branch`, `merge_branch`, `compare_branches`
- **Serialization**: `run_serialization`, `import_filetree`
- **Temporal**: `set_temporal_anchor`, `query_timeline`
- **Search**: `search_entities`
- **Palace**: `build_room`, `write_scroll`, `build_npc`, `add_dialogue`, `palace_action`

## Testing

Tests use Bun's built-in test runner with in-memory SQLite databases:

```bash
bun test                        # Run all tests
bun test smaragda.test.ts       # Run kernel tests only
bun test libraries.test.ts      # Run library tests only
```

- `libraries.test.ts` -- one `describe()` block per section
- `smaragda.test.ts` -- ~500+ tests covering the full kernel
- `sync-integration.test.ts` -- integration tests for push/pull sync

Tests use `beforeEach`/`afterEach` for kernel lifecycle management. All tests are self-contained with `:memory:` SQLite -- no fixtures, no external state.

## Architecture Decisions

**Why event sourcing?** Every state change is an immutable fact in the tessella log. This gives you: full audit trails, point-in-time materialization, branch-and-merge, sync between nodes, and the ability to evolve schemas without data migration.

**Why schema-as-data?** Genus definitions are stored as tessellae on genus res. This means the type system is introspectable at runtime, evolvable via `evolveGenus()` (additive-only), and version-controlled by the same mechanism that tracks entity state.

**Why single files?** Inspired by STB single-header libraries. Drop `libraries.ts` or `smaragda.ts` into any Bun project and import what you need. No package manager, no build step, no dependency tree.

**Why SQLite?** It's embedded, zero-config, and fast. WAL mode enables concurrent reads during writes. Litestream compatibility means you get free replication. The entire database is a single file you can copy, backup, or sync.

**Why MCP?** The Model Context Protocol is the standard for AI tool calling. Exposing the kernel as an MCP server means any MCP-compatible AI agent (Claude, etc.) can create schemas, manage entities, run workflows, and navigate the memory palace through structured tool calls.
