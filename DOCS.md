# Smaragda MCP Server -- Agent Documentation

This document is written for an AI agent that has just connected to the Smaragda MCP server and sees 85+ tools. It explains what the system is, how to orient yourself, what each tool does, common workflows, and the mistakes that will trip you up.

## What Is Smaragda?

Smaragda is an event-sourced knowledge management kernel. Everything in the system -- every entity, every type definition, every fact -- is stored as an immutable append-only log entry called a **tessella**. The current state of anything is derived by replaying its tessellae through a reducer.

The server exposes the kernel over the Model Context Protocol (MCP) as structured tool calls. You interact with it entirely through these tools -- there is no other interface.

**Version**: 0.12.0

## Core Concepts

Before calling any tools, understand these six ideas:

### 1. Res and Tessellae

A **res** (resource, plural "res") is an entity -- an identity with a history. Each res has a ULID and belongs to a genus (its type).

A **tessella** (plural "tessellae") is a single immutable fact appended to a res's history. Tessellae are never updated or deleted. The current state of a res is produced by replaying all its tessellae in order through a reducer.

Common tessella types: `created`, `attribute_set`, `attribute_removed`, `status_changed`, `feature_created`, `feature_attribute_set`, `feature_status_changed`, `member_added`, `member_removed`.

### 2. Genera (The Type System)

A **genus** (plural "genera") is a type definition. It specifies:
- **Attributes**: typed fields (`text`, `number`, `boolean`, `filetree`) with optional required flags
- **States**: a finite state machine with exactly one `initial` state
- **Transitions**: allowed state changes (optionally named)
- **Roles**: for relationship genera only -- member type constraints and cardinality

Genera are themselves stored as tessellae, so they are versioned and introspectable. Schema evolution via `evolve_genus` is **additive-only**: you can add attributes, states, and transitions, but never remove or modify existing ones.

There are several kinds of genera, discriminated by `meta.kind`:

| Kind | Purpose |
|------|---------|
| _(none)_ | Entity genus -- the standard kind |
| `action` | Declarative business logic with side effects |
| `feature` | Sub-entities within a parent entity |
| `relationship` | Typed many-to-many links between entities |
| `process` | Multi-lane workflow templates |
| `serialization` | Export templates for file trees |

### 3. Classification Hierarchy

Genera are organized into three levels:

```
Science  (top-level grouping, e.g. "Natural Sciences")
  Taxonomy  (category, e.g. "Biology")
    Genus  (entity type, e.g. "Species")
```

A default science and default taxonomy exist at bootstrap. Every genus belongs to a taxonomy. Taxonomies can be shared across sciences.

### 4. Workspaces

Workspaces provide multi-tenant isolation. **Most tools require a workspace to be set.** Without one, entity operations have no scope and will fail or return empty results.

- Genera (type definitions) are global -- they do not belong to a workspace
- Entities (instances) belong to workspaces
- Sciences are linked to workspaces to control which genera are visible

### 5. Session Context

Every tool has a `_session_id` input parameter automatically injected by the server. On your first call, omit it -- the server generates a UUID for you. On every subsequent call, pass the `_session_id` value from the previous response to maintain:
- Current workspace
- Current branch
- Palace navigation state (current room, action menu, history)

**Where it appears**: `_session_id` is a field injected into every JSON tool response at the top level, alongside the tool's normal output fields. For example, a `set_workspace` response looks like `{ "workspace_id": "...", "name": "...", "_session_id": "abc-123" }`. If a tool returns plain text instead of JSON (rare), the session ID will not be present in the output -- but the server still tracks it internally and will include it in the next JSON response.

If you lose the session ID, you lose your navigation context and the server allocates a fresh one on your next call.

### 6. Attribute Storage

Attributes are stored **directly on state** -- `state.title`, `state.description`, not `state.attributes.title`. Feature attributes work the same way.

## Getting Started

Follow these four steps in order:

### Step 1: Orient

```
describe_system({ guide: true })
```

This returns a context-aware getting-started guide that adapts to your current state:

- **No workspace set**: Tells you to call `set_workspace` and lists available workspaces.
- **Workspace set, no genera defined**: Shows how to define your first entity genus or link a science to import existing genera. Lists available sciences if any exist.
- **Genera exist**: Shows a schema summary with entity counts grouped by genus, plus active process and task counts.
- **Palace section**: If no rooms exist, shows how to build your first room (including v2 markup syntax). If rooms exist, shows a verb reference card.
- **Quick reference**: Key tool names for common operations.

This is the single best tool to call when you are disoriented or starting a new session.

### Step 2: Set a Workspace

```
list_workspaces()
set_workspace({ workspace: "My Project" })
```

Or create one:

```
create_workspace({ name: "My Project" })
set_workspace({ workspace: "My Project" })
```

When you call `set_workspace`, one of two things happens:

**If the workspace has a palace**, you are automatically placed in the entry room. The response looks like:
```json
{
  "workspace_id": "...",
  "name": "My Project",
  "sciences": ["Natural Sciences"],
  "branch": "main",
  "palace": "<rendered room text with description, actions, scrolls, notices>",
  "_session_id": "..."
}
```
The `palace` field contains the full rendered room -- read it to see your actions, scrolls, and any server notices.

**If no palace exists**, you get a bootstrap payload:
```json
{
  "workspace_id": "...",
  "name": "My Project",
  "sciences": ["Natural Sciences"],
  "branch": "main",
  "palace": null,
  "bootstrap": {
    "tutorial": "Getting started guide text...",
    "workspace_summary": "Overview of entities and genera...",
    "prompt": "Suggested next steps...",
    "available_genera": ["Server", "Issue", "Person"]
  },
  "_session_id": "..."
}
```
Read the `bootstrap.tutorial` and `bootstrap.prompt` fields for guidance on what to do next.

### Step 3: Survey the Schema

These three tools serve different purposes -- pick the right one:

| Tool | When to use | Returns |
|------|-------------|---------|
| `describe_system()` | Quick orientation. "What exists in this workspace?" | Names + entity counts for each genus. Task/process summaries. Compact by default. |
| `describe_system({ verbose: true })` | Full details. "Show me everything." | All of the above plus full attribute/state definitions, sciences, taxonomies. |
| `list_genera()` | Schema reference. "What types are defined?" | All entity genera with their full definitions (attributes, states, transitions). |
| `describe_genus({ genus: "Server" })` | Deep dive. "Tell me everything about this one type." | Full genus definition plus cross-references: per-state available actions, related features, relationships, processes, serializations, health statistics. |

**Decision guide**: Start with `describe_system()` to see the landscape. Use `describe_genus` when you need to understand one type deeply (e.g., before creating entities or defining actions). Use `list_genera()` when you need the raw schema for multiple types at once.

### Step 4: Start Working

Create entities, define genera, navigate the palace, or complete tasks -- depending on what the workspace needs.

## Tool Reference

### System

| Tool | Purpose |
|------|---------|
| `version` | Server name, version, uptime |
| `describe_system` | System overview. Default compact (names + counts). `verbose=true` for full details. `guide=true` for getting-started tutorial |

### Workspaces

| Tool | Purpose |
|------|---------|
| `set_workspace` | Set current workspace (required before most operations). Optionally `link_science`/`unlink_science` |
| `get_workspace` | Current workspace for this session |
| `create_workspace` | Create a new workspace |
| `list_workspaces` | All workspaces with entity counts |
| `assign_workspace` | Assign entities to a workspace (by entity_id, genus, or taxonomy) |
| `delete_workspace` | Delete an empty workspace |
| `merge_workspaces` | Move all entities from source to target, then delete source |

### Classification

| Tool | Purpose |
|------|---------|
| `create_taxonomy` | Create a taxonomy for grouping genera |
| `list_taxonomies` | All taxonomies with genus counts |
| `describe_taxonomy` | Full schema picture: all genera grouped by type |
| `archive_taxonomy` | Freeze a taxonomy (no new genera/entities) |
| `unarchive_taxonomy` | Re-enable a frozen taxonomy |
| `create_science` | Create a science for grouping taxonomies |
| `list_sciences` | All sciences with taxonomy counts |
| `describe_science` | Science details with its taxonomies |
| `archive_science` | Freeze a science |
| `unarchive_science` | Re-enable a frozen science |
| `move_taxonomy` | Move a taxonomy to a different science |
| `share_taxonomy` | Share a taxonomy with an additional science |
| `unshare_taxonomy` | Remove taxonomy sharing |
| `move_genus` | Move a genus to a different taxonomy |

### Genera (Type Definitions)

| Tool | Purpose |
|------|---------|
| `list_genera` | All entity genera with definitions. Filter by `taxonomy`, `include_deprecated` |
| `describe_genus` | Comprehensive docs: attributes, state machine with per-state actions, cross-references to features/relationships/actions/processes |
| `define_entity_genus` | Define a new entity type with attributes, states, transitions |
| `define_feature_genus` | Define a sub-entity type attached to a parent genus |
| `define_relationship_genus` | Define a relationship type with roles (at least 2) |
| `define_action_genus` | Define declarative business logic with resources, parameters, handler |
| `define_process_genus` | Define a multi-lane workflow |
| `evolve_genus` | Add attributes/states/transitions to existing genus (additive-only) |
| `evolve_process_genus` | Add/modify lanes, steps, triggers on a process genus |
| `deprecate_genus` | Prevent new entity creation, existing entities unaffected |
| `restore_genus` | Undo deprecation |

### Entities

| Tool | Purpose |
|------|---------|
| `create_entity` | Create entity of a genus. Set initial attributes, features, target_status |
| `create_entities` | Batch create multiple entities in one call |
| `list_entities` | List entities, filter by genus/status/attributes. `compact` for id/status/name |
| `get_entity` | Full details: state, health, transitions, actions, features, relationships, pending tasks |
| `set_attribute` | Set an attribute on an entity |
| `transition_status` | Move entity to a new status (validates state machine) |
| `batch_update` | Bulk operations: explicit array or WHERE clause. Supports auto-traverse via BFS |
| `search_entities` | Full-text search across entity attributes |
| `get_history` | Tessella history with action context. `diff=true` for changed-fields-only |

### Features (Sub-Entities)

| Tool | Purpose |
|------|---------|
| `create_feature` | Create a feature on a parent entity |
| `list_features` | List features on an entity, filter by feature genus |
| `set_feature_attribute` | Set attribute on a feature (validates parent status constraints) |
| `transition_feature_status` | Transition a feature's status |

### Relationships

| Tool | Purpose |
|------|---------|
| `define_relationship_genus` | Define a relationship type with roles and cardinality |
| `create_relationship` | Create a relationship instance linking entities by role |
| `get_relationships` | Get all relationships for an entity |
| `get_relationship` | Get a specific relationship by ID |
| `list_relationships` | List relationships, filter by genus/member/status |

### Actions (Business Logic)

| Tool | Purpose |
|------|---------|
| `define_action_genus` | Define action with resources, parameters, handler side effects |
| `list_available_actions` | Actions available for an entity given its current state |
| `execute_action` | Run an action -- validates preconditions, executes side effects atomically |

### Health and Errors

| Tool | Purpose |
|------|---------|
| `get_health` | Health report for a single entity |
| `list_unhealthy` | All unhealthy entities (missing required attrs, type mismatches, invalid status) |
| `list_errors` | Error entities, filter by associated entity or status |
| `acknowledge_error` | Transition error from `open` to `acknowledged` |

### Tasks

| Tool | Purpose |
|------|---------|
| `create_task` | Create a work item, optionally linked to an entity |
| `list_tasks` | Tasks with filters: status, entity, priority, agent type, process |
| `get_task` | Full task details with enriched associated/context entities |
| `complete_task` | Complete a task (auto-advances process if task is part of one) |

### Processes (Workflows)

| Tool | Purpose |
|------|---------|
| `define_process_genus` | Define workflow with lanes and steps (task, action, gate, fetch, branch) |
| `evolve_process_genus` | Add/modify lanes and steps |
| `start_process` | Start a process instance, optionally linked to a context entity |
| `get_process_status` | Current state of all steps in a process instance |
| `list_processes` | Process instances. `include_finished=true` to see completed/failed |

### Cron (Scheduled Automation)

| Tool | Purpose |
|------|---------|
| `create_cron_schedule` | Recurring schedule (5-field cron or @daily/@hourly/@weekly/@monthly) |
| `list_cron_schedules` | All schedules with status and last fire time |
| `pause_cron` | Pause a schedule |
| `resume_cron` | Resume a paused schedule |
| `trigger_cron` | Fire a schedule immediately |
| `schedule_trigger` | One-time future trigger (by ISO timestamp or delay like "90m", "2h") |

### Branches

| Tool | Purpose |
|------|---------|
| `create_branch` | Create isolated branch (auto-switches to it) |
| `switch_branch` | Switch active branch |
| `list_branches` | All branches with status |
| `merge_branch` | Merge source into target (conflict detection, `force=true` to override) |
| `compare_branches` | Diff entity state across two branches |

### Serialization

| Tool | Purpose |
|------|---------|
| `run_serialization` | Export entities to file tree (markdown). Optionally write to disk |
| `import_filetree` | Import edited files back, creating tessellae for changes |

### Temporal Anchors

| Tool | Purpose |
|------|---------|
| `set_temporal_anchor` | Attach year range to entity (negative for BC) |
| `get_temporal_anchor` | Get anchor for an entity |
| `remove_temporal_anchor` | Remove anchor |
| `query_timeline` | Query entities chronologically by year range |

### Palace (Spatial Navigation)

| Tool | Purpose |
|------|---------|
| `build_room` | Create or update a palace room. `merge=true` for incremental updates |
| `write_scroll` | Write a dated note in the current room (persists across sessions) |
| `build_npc` | Create/update an NPC with dialogue tree. `merge=true` for incremental |
| `add_dialogue` | Append dialogue nodes to an existing NPC |
| `palace_action` | Execute numbered action or verb command in current room |

## The Palace

The palace is a spatial navigation layer that gives each workspace a persistent "memory palace." It is the primary interface for exploration-oriented work.

### Why It Matters

The palace provides continuity across agent sessions. When you enter a workspace, you land in the entry room and see:
- A vivid description of the room
- Numbered actions (query data, navigate to other rooms, read text)
- Server-placed notices (running processes, unhealthy entities, pending tasks)
- NPCs present in the room
- Scrolls (dated notes from previous sessions)

The previous agent built this palace. You inherit it, use it, and leave it better for the next agent.

### Entering the Palace

`set_workspace` automatically enters the palace if one exists. You land in the entry room.

### Navigating

There are three ways to interact:

**Numbered actions** (via `palace_action`):
- `1-N`: Room-specific actions (defined by the room builder). A room can define up to 60 custom actions.
- `61-80`: View entity details from last query result. These numbers only appear after a query action returns results.
- `81-90`: Read scrolls. Only appear when the room has scrolls.
- `0`: View palace map
- `91`: Check inventory (scrolls in current room)
- `92`: Write a scroll (redirects to `write_scroll`)
- `93`: Search palace and entities (requires `params`)
- `94`: Teleport to room by name/slug (requires `params`)
- `95`: Palace health check (use `params: "repair"` to auto-fix stale refs)
- `96`: Go back to previous room
- `97`: Delete a room (requires `params` with slug)

The gaps between ranges are intentional. Numbers 1-60 are reserved for room-specific actions (most rooms use far fewer). The 61-80 and 81-90 ranges are contextual -- they only appear in the action menu when there are query results or scrolls to display, respectively. The 91-97 range is always available as global utility actions. This separation prevents collisions: a room with 15 actions will never conflict with scroll or entity-drilldown numbering.

**Verb commands** (via `palace_action({ verb: "..." })`):
- `look TARGET` / `l TARGET` -- glance at an entity (brief summary)
- `examine TARGET` / `x TARGET` -- inspect entity (full details + relationships)
- `go TARGET` -- navigate to a portal/room
- `talk NPC_NAME` / `t NPC_NAME` -- start NPC conversation
- `search QUERY` / `find QUERY` -- search palace and entities
- `back` / `b` -- go to previous room
- `map` / `m` -- view palace map
- `inventory` / `inv` / `i` -- check room inventory

**NPC conversations**: When talking to an NPC, numbered actions switch to dialogue options. Pick 1-N for dialogue, 0 to step away.

### Portals vs Navigate Actions

These are two separate mechanisms that serve different purposes:

**Portals** are metadata on the room definition (the `portals` array in `build_room`). They are used by:
- The **palace map** (action 0) -- portals define the edges in the map graph
- The **`go` verb** -- `palace_action({ verb: "go warehouse" })` resolves the target against portals (and v2 markup portal refs)
- **Palace health** (action 95) -- disconnected rooms (no portals, not the entry room) are flagged as issues
- **v2 markup** -- `[room-slug]link text[/]` in descriptions creates portal links that also feed into `go` resolution

**Navigate actions** are numbered menu items in the room's `actions` array with `type: "navigate"`. They appear as numbered options (1-N) and move you to the target room when selected.

In practice, you typically want both: a navigate action (so the room's numbered menu includes "Enter the warehouse" as option 3) and a portal entry (so the map shows the connection and `go warehouse` works). They serve complementary purposes -- navigate actions are for the numbered menu, portals are for the map/go/health system.

### Building Rooms

```
build_room({
  slug: "hall-of-geology",
  name: "Hall of Geology",
  description: "Rough-hewn stone walls display *GeologicalPeriod:Cambrian* alongside a case of *Mineral:Quartz|sparkling quartz*. A [fossil-gallery]darkened archway[/] leads deeper.",
  actions: [
    { label: "Survey geological periods", type: "query", tool: "list_entities", tool_params: { genus: "GeologicalPeriod" } },
    { label: "Examine minerals", type: "query", tool: "list_entities", tool_params: { genus: "Mineral" } },
    { label: "Enter the fossil gallery", type: "navigate", room: "fossil-gallery" },
  ],
  portals: ["fossil-gallery", "great-hall"]
})
```

### v2 Markup in Descriptions

Room descriptions support live entity references and portal links:

- `*GenusName:EntityName*` -- interactive entity reference (use `look` and `examine` verbs)
- `*GenusName:EntityName|alias*` -- entity ref with custom display text
- `[room-slug]prose text[/]` -- portal link to another room

The server resolves these at render time. Unresolved refs are flagged in the response.

### Scrolls

Scrolls are dated notes that persist across sessions. They are the primary mechanism for cross-session communication.

```
write_scroll({ title: "Session Notes", body: "Explored the geology taxonomy, added 15 mineral entities..." })
```

Read scrolls via numbered actions (81-90) or `inventory` (action 91).

### NPCs and Dialogue Trees

NPCs live in rooms and have dialogue trees with progressive disclosure. Each dialogue node has:
- `id`: unique identifier
- `parent`: parent node ID (or "root" for top-level options)
- `prompt`: what the agent sees as a selectable option
- `text`: the NPC's response
- `entity_id`/`entity_ref`: optional entity to display alongside response
- `requires`: session tags needed to see this option
- `unlocks`: session tags granted when this node is visited

### Palace Health

Call `palace_action({ action: 95 })` to check palace health:
- Genera without query actions (data exists but no room queries it)
- Dead navigate actions (point to nonexistent rooms)
- Stale portals
- Disconnected rooms (no portals, not entry)
- Empty rooms (no actions)
- Text actions with no content

Use `palace_action({ action: 95, params: "repair" })` to auto-fix stale references.

## Common Workflows

### Define a Schema and Create Entities

```
define_entity_genus({
  name: "Product",
  description: "Physical product in inventory",
  attributes: [
    { name: "name", type: "text", required: true },
    { name: "sku", type: "text", required: true },
    { name: "price", type: "number" }
  ],
  states: [
    { name: "draft", initial: true },
    { name: "active" },
    { name: "discontinued" }
  ],
  transitions: [
    { from: "draft", to: "active", name: "Publish" },
    { from: "active", to: "discontinued", name: "Discontinue" }
  ]
})

create_entity({
  genus: "Product",
  attributes: { name: "Widget A", sku: "WDG-001", price: 29.99 }
})
```

### Batch Operations with WHERE Clause

```
batch_update({
  where: "genus = 'Product' AND status = 'draft'",
  target_status: "active"
})

batch_update({
  where: "genus = 'Product' AND status = 'active'",
  attribute: "price",
  value: 0
})
```

The WHERE clause supports `field = 'value'`, `field LIKE '%value%'`, combined with AND. No OR, no nested expressions, no numeric comparisons.

### Auto-Traverse via BFS

When you specify `target_status` in `create_entity`, `create_entities`, or `batch_update`, the system does not require a direct transition from the current state. Instead, it uses **breadth-first search** over the genus's state machine graph to find the shortest path of transitions and executes each one automatically.

For example, given a genus with states `draft -> in_review -> approved -> published`:
- `create_entity({ genus: "Issue", target_status: "published" })` creates the entity in `draft` (the initial state), then automatically transitions through `in_review`, then `approved`, then `published` -- four states traversed via three transitions, all in one call.
- `batch_update({ where: "genus = 'Issue' AND status = 'draft'", target_status: "approved" })` finds each matching entity and transitions it `draft -> in_review -> approved`.

If no path exists (e.g., the state machine has no route from the current state to the target), the operation fails with an error.

### Define and Execute an Action

```
define_action_genus({
  name: "discontinue",
  description: "Discontinue a product",
  resources: [{ name: "product", genus_name: "Product", required_status: "active" }],
  parameters: [{ name: "reason", type: "text", required: true }],
  handler: [
    { type: "set_attribute", res: "$res.product.id", key: "discontinued_reason", value: "$param.reason" },
    { type: "transition_status", res: "$res.product.id", target: "discontinued" },
    { type: "create_log", res: "$res.product.id", message: "Discontinued: $param.reason" }
  ]
})

execute_action({
  action: "discontinue",
  entity_id: "01ABC...",
  params: { reason: "Low demand" }
})
```

Handler tokens: `$res.X.id` (bound resource ID), `$param.X` (parameter value), `$now` (ISO timestamp).

Side effect types: `set_attribute`, `transition_status`, `create_res`, `create_log`, `create_error`, `create_task`.

### Create a Relationship

```
define_relationship_genus({
  name: "Supply",
  roles: [
    { name: "supplier", valid_member_genera: ["Vendor"], cardinality: "one" },
    { name: "product", valid_member_genera: ["Product"], cardinality: "one_or_more" }
  ],
  states: [{ name: "active", initial: true }, { name: "ended" }],
  transitions: [{ from: "active", to: "ended" }]
})

create_relationship({
  genus: "Supply",
  members: { supplier: "VENDOR_ID", product: "PRODUCT_ID" }
})
```

For roles with `one_or_more` or `zero_or_more` cardinality, you can pass an array of entity IDs:

```
create_relationship({
  genus: "Supply",
  members: { supplier: "VENDOR_ID", product: ["PRODUCT_ID_1", "PRODUCT_ID_2", "PRODUCT_ID_3"] }
})
```

Each entity in the array is added as a separate member under that role. The kernel accepts both single IDs and arrays.

Cardinality values: `one`, `one_or_more`, `zero_or_more`.

### Start a Process

```
define_process_genus({
  name: "Product Launch",
  lanes: [
    { name: "marketing", steps: [
      { name: "write_copy", type: "task_step", title: "Write marketing copy" },
      { name: "review_copy", type: "task_step", title: "Review copy" }
    ]},
    { name: "engineering", steps: [
      { name: "finalize_sku", type: "task_step", title: "Finalize SKU and pricing" }
    ]},
    { name: "final", steps: [
      { name: "convergence", type: "gate_step", conditions: ["review_copy", "finalize_sku"] },
      { name: "go_live", type: "action_step", action_name: "publish_product" }
    ]}
  ]
})

start_process({ process: "Product Launch", context_entity_id: "PRODUCT_ID" })
```

Step types: `task_step` (creates task, waits), `action_step` (executes immediately), `gate_step` (waits for conditions), `fetch_step` (reads data), `branch_step` (conditional routing).

When you call `complete_task` for a process task, the process auto-advances.

### Branching for Isolated Changes

```
create_branch({ name: "experiment" })
-- now on "experiment" branch
set_attribute({ entity_id: "...", attribute: "price", value: 0 })
-- changes are isolated
switch_branch({ name: "main" })
-- main still has original price
merge_branch({ source: "experiment" })
-- main now has the changes
```

### Build a Palace Room with Live Entity Refs

```
build_room({
  slug: "product-hall",
  name: "Product Hall",
  description: "Glass cases line the walls, each displaying a product. *Product:Widget A* sits prominently in the center. Through a [warehouse]loading dock doorway[/] you glimpse stacked shelves.",
  actions: [
    { label: "Browse all products", type: "query", tool: "list_entities", tool_params: { genus: "Product" } },
    { label: "Check inventory health", type: "query", tool: "list_unhealthy", tool_params: { genus: "Product" } },
    { label: "Enter warehouse", type: "navigate", room: "warehouse" }
  ],
  portals: ["warehouse", "great-hall"]
})
```

Then navigate with verbs:
```
palace_action({ verb: "look Widget A" })       -- brief summary
palace_action({ verb: "examine Widget A" })    -- full details
palace_action({ verb: "go warehouse" })        -- navigate
```

## Name Resolution

Most tools accept both names and IDs for genera, taxonomies, sciences, workspaces, and other named entities. The server resolves names case-insensitively. If a name is not found, it tries the input as a raw ID.

Examples:
- `genus: "Server"` resolves to the Server genus ID
- `taxonomy: "Default"` resolves to the Default taxonomy
- `workspace: "My Project"` resolves to the workspace ID

## Error Handling

When a tool call throws an exception, the server catches it and returns a successful JSON-RPC response with `isError: true`:

```json
{
  "content": [{ "type": "text", "text": "No entity found with ID 01ABC..." }],
  "isError": true
}
```

This is not a protocol-level error. The MCP transport is fine -- the tool simply failed. The `text` field contains the thrown exception's message. JSON-RPC error codes (like `-32602`) are reserved for protocol-level issues (unknown method, invalid params, parse errors) and indicate a bug in how you called the tool, not a business logic failure.

**What to do when you see `isError: true`**:
- Read the error message -- it usually says exactly what went wrong (missing workspace, entity not found, invalid status transition, etc.)
- Retrying the same call with the same inputs will get the same error. Fix the underlying issue first.
- Common causes: no workspace set, entity ID does not exist, invalid state transition, required attribute missing, genus name not found.

## Important Gotchas

1. **Set a workspace first.** Almost every entity operation requires a workspace. Without one, `create_entity`, `set_attribute`, `transition_status`, and most other tools will throw an error. Call `set_workspace` before doing anything.

2. **Genera are global, entities are scoped.** Genus definitions (types) exist outside workspaces. When you define a genus, it is available in every workspace. Entities (instances) are scoped to the workspace that was active when they were created.

3. **Evolve is additive-only.** `evolve_genus` can only add new attributes, states, and transitions. It cannot rename, modify, or remove existing definitions. If you need to "remove" an attribute, it simply stops being used -- old entities still have it.

4. **Attributes live directly on state.** When reading or setting attributes, use `state.title`, not `state.attributes.title`. The same applies to features.

5. **Exactly one initial state.** When defining genera with states, exactly one state must be marked `initial: true`. Omitting this or marking multiple states as initial will cause an error.

6. **Auto-traverse with target_status.** `create_entity`, `create_entities`, and `batch_update` support `target_status` -- the system uses BFS to find the shortest path through the state machine and executes each transition automatically. You do not need to manually step through intermediate states. See the "Auto-Traverse via BFS" workflow above for details.

7. **Actions require correct status.** If an action has `required_status: "active"` and the entity is in "draft", the action will fail. Check `list_available_actions` or look at the `available_actions` in `get_entity` output.

8. **Process tasks auto-advance.** When you `complete_task` on a task that belongs to a process, the process engine automatically advances to the next step. Do not manually advance process steps.

9. **Feature editing is gated by parent status.** Feature genera can specify `editable_parent_statuses`. If the parent entity is not in one of those statuses, feature modifications will fail.

10. **Palace session state.** The palace tracks your current room, navigation history, last query results, and NPC conversation state in the session. Losing your `_session_id` resets all of this.

11. **build_room non-merge requires all fields.** A non-merge `build_room` call requires `name`, `description`, and `actions`. Use `merge=true` for incremental updates that preserve existing actions and portals.

12. **Scroll numbers are 81-90.** Scrolls in a room are accessed via numbered actions 81-90, not 1-10. Entity drilldown from query results uses 61-80. See "Navigating" above for the full numbering scheme.

13. **WHERE clause syntax is limited.** `batch_update` WHERE clauses only support `field = 'value'`, `field LIKE '%value%'`, combined with AND. No OR, no nested expressions, no numeric comparisons.

14. **Relationship genus requires 2+ roles.** You cannot define a relationship with fewer than two roles.

15. **The Error genus has its own state machine.** Errors are not immutable like logs. They have an `open -> acknowledged` lifecycle. Use `acknowledge_error` to resolve them.

16. **Cron ticks every 60 seconds.** The server calls `tickCron()` on a 60-second interval. Deduplication prevents double-firing within the same minute. Use `trigger_cron` for immediate manual fire.

17. **Branches reset palace navigation.** When you `create_branch` or `switch_branch`, palace navigation state is cleared. You will need to re-enter the palace via `set_workspace` or navigate manually.

## Seed Data

The server seeds these genera on startup (idempotent via `evolveGenus`):

| Genus | Kind | Description |
|-------|------|-------------|
| Server | entity | provisioning -> active -> deployed -> decommissioned |
| Issue | entity | draft -> in_review -> approved -> published -> archived |
| Page | feature | Sub-entity of Issue. draft -> layout_complete -> approved |
| Person | entity | active <-> inactive |
| Assignment | relationship | Links Person to Issue. Roles: artist, content |
| Device | entity | Sync client. active -> deactivated |
| deploy | action | Deploys a version to an active Server |
| submit_for_review | action | Submits a draft Issue for review |
| publish_issue | action | Publishes an approved Issue |
| Publication | process | Editorial + art lanes converging at gate before publish |
| Markdown Export | serialization | Exports Issues with Pages to markdown files |

These exist in the Default taxonomy under the Default science. They serve as working examples of the schema system and can be used directly or ignored.

**Science scoping and seed visibility**: When you link a science to a workspace via `set_workspace({ workspace: "...", link_science: "My Science" })`, `describe_system` filters the visible genera to only those belonging to taxonomies within the linked sciences. Since the seed genera live in the Default taxonomy (under the Default science), linking a custom science with its own taxonomies will effectively hide the seed genera from `describe_system` output for that workspace. The seed genera still exist globally and can still be used -- they just do not appear in the workspace's schema overview. If no science is linked to a workspace, all genera are visible.

This means you can cleanly separate concerns: link only the sciences relevant to a workspace, and the seed data stays out of the way. If you want to use the seed genera alongside your own, link the Default science to your workspace.

## Quick Reference Card

```
# First steps
describe_system({ guide: true })
list_workspaces()
set_workspace({ workspace: "NAME" })

# Schema
define_entity_genus({ name: "...", attributes: [...], states: [...], transitions: [...] })
evolve_genus({ genus: "...", attributes: [...] })
list_genera()
describe_genus({ genus: "..." })

# Entities
create_entity({ genus: "...", attributes: { ... } })
create_entities({ entities: [{ genus: "...", attributes: { ... } }, ...] })
list_entities({ genus: "..." })
get_entity({ entity_id: "..." })
set_attribute({ entity_id: "...", attribute: "key", value: "val" })
transition_status({ entity_id: "...", target_status: "active" })
batch_update({ where: "genus = 'X' AND status = 'draft'", target_status: "active" })
search_entities({ query: "search text" })

# Actions
define_action_genus({ name: "...", resources: [...], parameters: [...], handler: [...] })
execute_action({ action: "...", entity_id: "...", params: { ... } })

# Palace
build_room({ slug: "...", name: "...", description: "...", actions: [...] })
palace_action({ action: 1 })          -- numbered action
palace_action({ verb: "look THING" })  -- verb command
write_scroll({ title: "...", body: "..." })
palace_action({ action: 0 })           -- view map
palace_action({ action: 95 })          -- palace health

# Tasks and processes
create_task({ title: "...", entity_id: "..." })
complete_task({ task_id: "..." })
start_process({ process: "...", context_entity_id: "..." })
get_process_status({ process_id: "..." })
```
