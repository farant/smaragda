# Smaragda MCP Server — Tool Reference

87 tools organized by category. All tools accept an optional `_session_id` parameter for workspace context persistence.

## Getting Started

| Tool | Description |
|------|-------------|
| `version` | Returns server name, version, and uptime. |
| `describe_system` | System overview. Default: compact (names + counts). `verbose=true` for full details. **`guide=true` for a getting-started tutorial with context-aware next steps.** |

---

## Workspaces

Workspaces are isolated scopes for organizing entities. Most tools require a workspace to be set.

| Tool | Description |
|------|-------------|
| `set_workspace` | Set current workspace for this session. All subsequent entity operations are scoped here. Optionally `link_science`/`unlink_science` to control visible genera. |
| `get_workspace` | Returns the current workspace, or null if none is set. |
| `create_workspace` | Create a new workspace. |
| `list_workspaces` | List all workspaces with entity counts. |
| `assign_workspace` | Assign entities to a workspace. Provide `entity_id` (single), `genus` (all of that genus), or `taxonomy` (all in that taxonomy). `unassigned_only=true` to skip already-assigned. |
| `delete_workspace` | Delete an empty workspace. Fails if it still contains entities. |
| `merge_workspaces` | Move all entities from source workspace to target, then delete the source. |

---

## Sciences & Taxonomies

Sciences group taxonomies; taxonomies group genera. This is the top-level organizational hierarchy.

### Sciences

| Tool | Description |
|------|-------------|
| `create_science` | Create a new science for grouping taxonomies (e.g., "Architecture", "Workflow"). |
| `list_sciences` | List all sciences with taxonomy counts. |
| `describe_science` | Returns a science and its taxonomies. |
| `archive_science` | Archive a science to freeze it. |
| `unarchive_science` | Unarchive a science to re-enable it. |

### Taxonomies

| Tool | Description |
|------|-------------|
| `create_taxonomy` | Create a new taxonomy for organizing genera (e.g., "Inventory", "Orders"). |
| `list_taxonomies` | List all taxonomies with genera counts. |
| `describe_taxonomy` | Full schema picture for a taxonomy: all genera grouped by type with entity counts. |
| `archive_taxonomy` | Archive a taxonomy — no new genera/entities, but existing data remains readable. |
| `unarchive_taxonomy` | Unarchive a taxonomy to re-enable creation. |
| `move_taxonomy` | Move a taxonomy to a different science. |
| `share_taxonomy` | Share a taxonomy with an additional science, making its genera visible under that science too. |
| `unshare_taxonomy` | Remove a taxonomy's sharing with a science. |

---

## Genera (Entity Types)

Genera define the schema for entities: attributes, states, and transitions.

### Entity Genera

| Tool | Description |
|------|-------------|
| `list_genera` | List all entity genera with attributes, states, and transitions. Filter by `taxonomy`. Deprecated genera excluded by default. |
| `define_entity_genus` | Define a new entity genus with attributes, states, and transitions (e.g., Product, Customer, Order). |
| `describe_genus` | Comprehensive documentation for a genus: attributes, full state machine with per-state actions, cross-references to features/relationships/actions/processes/serializations, and entity health stats. |
| `evolve_genus` | Idempotent additive evolution. Adds new attributes, states, or transitions without removing existing definitions. Also supports `templates` for palace v2 rendering (mention/glance/inspect). |
| `deprecate_genus` | Deprecate a genus to prevent new entity creation. Existing entities remain functional. |
| `restore_genus` | Restore a deprecated genus. |
| `move_genus` | Move a genus to a different taxonomy. |

### Feature Genera

| Tool | Description |
|------|-------------|
| `define_feature_genus` | Define a feature genus attached to a parent entity genus. Features are sub-entities (e.g., Variant on Product, LineItem on Order). |

### Relationship Genera

| Tool | Description |
|------|-------------|
| `define_relationship_genus` | Define a relationship genus linking entities with typed roles (e.g., "Supply" linking Supplier to Product). Requires at least 2 roles with genus constraints and cardinality. |
| `list_relationship_genera` | List all relationship genera with roles, attributes, states, and transitions. |

### Action Genera

| Tool | Description |
|------|-------------|
| `define_action_genus` | Define a reusable business action with typed resources, parameters, and side effects (e.g., "discontinue a Product by setting discontinued_at and transitioning to discontinued"). |

### Process Genera

| Tool | Description |
|------|-------------|
| `define_process_genus` | Define a multi-lane workflow with steps (tasks, gates, actions, fetches). Steps nested inside lanes; position implicit from array order. |
| `evolve_process_genus` | Evolve an existing process genus — add or modify lanes, steps, and triggers. Last-value-wins for re-defined steps/lanes. |

---

## Entities

| Tool | Description |
|------|-------------|
| `create_entity` | Create an entity of a given genus. Set initial attributes, features, and `target_status` to auto-traverse to a non-initial status. `compact=true` for minimal response. |
| `create_entities` | Create multiple entities in one call. |
| `list_entities` | List entities, optionally filtered by genus. Defaults to compact (id/genus/status/name). `compact=false` for full state. Supports `attribute_filters` for filtering by attribute values. |
| `get_entity` | Full details for a single entity: state, genus info, tessella count, available transitions. |
| `set_attribute` | Set an attribute on an entity. Validates against genus definition. |
| `transition_status` | Transition an entity to a new status. Validates against genus state machine. |
| `batch_update` | Bulk updates. Mode 1: `operations` array of explicit updates. Mode 2: `where` clause to match entities with `target_status` or `attribute+value` to apply. |
| `search_entities` | Search entities by content across all string attributes. Case-insensitive substring match. |
| `get_history` | Tessella history for an entity with action context. `diff=true` to show only changed fields per event. |

---

## Features (Sub-entities)

| Tool | Description |
|------|-------------|
| `create_feature` | Create a feature (sub-entity) on an entity. Features have their own genus, status, and attributes. |
| `set_feature_attribute` | Set an attribute on a feature. Validates against feature genus and checks parent entity status constraints. |
| `transition_feature_status` | Transition a feature to a new status. Validates against feature genus state machine and parent constraints. |
| `list_features` | List features on an entity, optionally filtered by feature genus. |

---

## Relationships

| Tool | Description |
|------|-------------|
| `create_relationship` | Create a relationship linking entities with typed roles. Validates member genera and cardinality. |
| `create_relationships` | Create multiple relationships in one call. |
| `get_relationship` | Full details for a single relationship: members, state, genus info. |
| `get_relationships` | List relationships an entity participates in, optionally filtered by relationship genus or role. |
| `list_relationships` | List relationships filtered by genus, member entity, role, or status. `compact=true` for id/name/members only. |

---

## Actions

| Tool | Description |
|------|-------------|
| `list_available_actions` | List actions available for an entity given its current state, and what parameters each requires. |
| `execute_action` | Execute a named action on an entity. Validates preconditions, runs side effects atomically, returns updated state. |

---

## Health & Errors

| Tool | Description |
|------|-------------|
| `get_health` | Health report for a single entity. Checks required attributes, attribute types, status validity, and unacknowledged errors. |
| `list_unhealthy` | List all unhealthy entities with their health issues. Optionally filter by genus. |
| `list_errors` | List error entities, optionally filtered by associated entity or status. |
| `acknowledge_error` | Acknowledge an error, transitioning it from "open" to "acknowledged". |

---

## Tasks

| Tool | Description |
|------|-------------|
| `create_task` | Create a task (work item) optionally associated with an entity. Tasks can be claimed and completed by humans or LLMs. |
| `list_tasks` | List tasks with optional filters. Returns summaries including status, priority, and associations. |
| `get_task` | Full details for a task including materialized context entities. |
| `complete_task` | Complete a task with optional result. Works from "pending" and "claimed". If part of a process, auto-advances the process. |

---

## Processes (Workflows)

| Tool | Description |
|------|-------------|
| `start_process` | Start a process instance from a process genus. Creates tasks for initial steps and begins auto-advancing. |
| `get_process_status` | Current status of a process instance: all step statuses enriched with lane/type/position from the definition. |
| `list_processes` | List process instances. Excludes completed/cancelled/failed by default — `include_finished` to see them. |

---

## Cron Scheduling

| Tool | Description |
|------|-------------|
| `create_cron_schedule` | Create a recurring schedule for actions or processes. Supports 5-field cron expressions and aliases (@daily, @hourly, @weekly, @monthly). |
| `list_cron_schedules` | List all cron schedules with status, expression, and last fire time. |
| `pause_cron` | Pause an active schedule. |
| `resume_cron` | Resume a paused schedule. |
| `trigger_cron` | Manually fire a schedule immediately, regardless of status or expression. |
| `schedule_trigger` | Schedule a one-time trigger at a specific future time. Provide `scheduled_at` (ISO) or `delay` (e.g., "90m", "2h", "1d"). Auto-retires after firing. |

---

## Branches

| Tool | Description |
|------|-------------|
| `create_branch` | Create a branch for isolated changes. Auto-switches to the new branch. |
| `switch_branch` | Switch to a different branch. |
| `list_branches` | List all branches with status. Shows current session branch. |
| `merge_branch` | Merge source into target. Detects conflicts unless `force=true`. |
| `compare_branches` | Compare materialized state of an entity across two branches. |

---

## Temporal

| Tool | Description |
|------|-------------|
| `set_temporal_anchor` | Attach a temporal anchor (year range) to an entity. Negative years for BC. Precision: exact, approximate, century, millennium. |
| `get_temporal_anchor` | Get the temporal anchor for an entity. |
| `remove_temporal_anchor` | Remove the temporal anchor from an entity. |
| `query_timeline` | Query entities by temporal anchors. Chronologically sorted within a year range. |

---

## Serialization

| Tool | Description |
|------|-------------|
| `run_serialization` | Export entities as a file tree (e.g., markdown). Optionally write files to disk. |
| `import_filetree` | Import a previously exported file tree back into the kernel. Diffs against current state and creates tessellae for changes. |

---

## Palace (Spatial Navigation)

The palace is a memory system — rooms with prose descriptions, interactive objects, and cross-session scrolls.

| Tool | Description |
|------|-------------|
| `build_room` | Create or replace a palace room. `merge=true` for incremental updates. `quiet=true` for minimal response. Supports **v2 markup**: `*GenusName:EntityName*` for entity refs, `*GenusName:EntityName\|alias*` for custom display text, `[room-slug]prose text[/]` for portal links. Unresolved refs are flagged in the response. |
| `write_scroll` | Write a dated note (scroll) in the current room. Scrolls persist across conversations. |
| `palace_action` | Execute a numbered action or verb command. **Verbs**: `look/l TARGET`, `examine/x TARGET`, `go TARGET`, `search/find QUERY`, `back/b`, `map/m`, `inventory/inv/i`. **Numbers**: 61-80 entity drilldown, 81-90 scroll read, 0=map, 91=inventory, 92=write scroll, 93=search, 94=teleport, 95=health, 96=back. |

### Palace v2 Markup

Embed live entity references and portal links in room descriptions:

```
*GenusName:EntityName*          → interactive entity ref (guillemets «Name»)
*GenusName:EntityName|alias*    → custom display text (alias shown inline)
[room-slug]prose text[/]        → portal to another room (arrow →)
```

Mention templates can be set on genera via `evolve_genus({ templates: { mention: "the {{name}} feature" } })` for natural prose rendering.

Verbs (`look`, `examine`) resolve targets against the room's manifest. Fuzzy matching: exact → prefix → substring → word-start.
