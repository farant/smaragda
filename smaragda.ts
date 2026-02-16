// ============================================================================
// smaragda.ts — ERP kernel module for the Smaragda system
// ============================================================================
//
// Modules:
//
//   Tessella Store   Append-only tessella store on SQLite. Create res (entities),
//                    append tessellae (facts), replay them, and materialize state
//                    at any point in time.
//                    Exports: initKernel, getRes, createRes, appendTessella,
//                             replay, materialize, defaultReducer
//                    Types:   Kernel, Res, Tessella, ReplayOptions,
//                             MaterializeOptions, AppendOptions, TessellaReducer
//
//   Genus            Schema-as-res: genus definitions stored as tessellae.
//                    Genus-aware entity creation, attribute validation, and
//                    state machine enforcement.
//                    Exports: genusReducer, getGenusDef, defineEntityGenus,
//                             createEntity, setAttribute, transitionStatus,
//                             findTransitionPath, listGenera, listEntities,
//                             findGenusByName, deprecateGenus, restoreGenus,
//                             createTaxonomy, listTaxonomies, findTaxonomyByName,
//                             describeTaxonomy, META_GENUS_ID, TAXONOMY_GENUS_ID,
//                             DEFAULT_TAXONOMY_ID,
//                             createWorkspace, listWorkspaces, findWorkspaceByName,
//                             switchWorkspace, WORKSPACE_GENUS_ID
//                    Types:   GenusAttributeType, GenusAttributeDef,
//                             GenusStateDef, GenusTransitionDef, GenusDef,
//                             GenusSummary, EntitySummary, ListEntitiesOptions,
//                             TaxonomySummary, TaxonomyDescription, WorkspaceSummary
//
//   Features         Sub-entities living in a parent's tessella stream.
//                    Feature genera define attributes, states, and transitions
//                    with parent status constraints.
//                    Exports: defineFeatureGenus, createFeature,
//                             setFeatureAttribute, transitionFeatureStatus,
//                             listFeatureGenera, findFeatureGenusByName,
//                             getFeatureGenusForEntityGenus
//                    Types:   DefineFeatureGenusOptions, FeatureGenusSummary
//
//   Actions          Declarative business logic as genus-like schemas. Actions
//                    define preconditions, parameters, and side effect handlers.
//                    Exports: actionReducer, getActionDef, defineActionGenus,
//                             recordInput, executeAction, listActionGenera,
//                             findActionByName, findActionsByTargetGenus,
//                             getHistory, LOG_GENUS_ID
//                    Types:   ActionResourceDef, ActionParameterDef, SideEffect,
//                             ActionDef, DefineActionGenusOptions, Input,
//                             ActionTaken, ExecuteActionResult, HistoryEntry,
//                             ActionGenusSummary
//
//   Relationships    First-class relationships linking entities with typed roles.
//                    Relationships are independent res with their own genus,
//                    attributes, states, and transitions.
//                    Exports: defineRelationshipGenus, createRelationship,
//                             addMember, removeMember, getRelationshipsForEntity,
//                             getRelatedEntities, listRelationshipGenera,
//                             findRelationshipGenusByName
//                    Types:   GenusRoleDef, DefineRelationshipGenusOptions,
//                             RelationshipSummary, RelationshipGenusSummary
//
//   Health           Health evaluation and error tracking. Pure-function health
//                    checks against genus definitions, a dedicated Error genus
//                    for persisting issues, and evolveGenus for idempotent
//                    schema changes.
//                    Exports: evolveGenus, evaluateHealth, evaluateHealthByGenus,
//                             listUnhealthy, createError, acknowledgeError,
//                             listErrors, ERROR_GENUS_ID
//                    Types:   HealthIssue, HealthReport, EvolveGenusOptions,
//                             ErrorSummary
//
//   Tasks            Built-in task system for structured work items. Tasks are
//                    a sentinel genus with pending/claimed/completed/cancelled
//                    state machine. Actions can create tasks via side effects.
//                    Exports: createTask, claimTask, completeTask, cancelTask,
//                             listTasks, TASK_GENUS_ID
//                    Types:   TaskSummary, CreateTaskOptions
//
//   Processes         Multi-lane workflow engine. Process genera define workflow
//                    templates with lanes, ordered steps, gates, and triggers.
//                    Process instances auto-advance when tasks complete.
//                    Exports: defineProcessGenus, startProcess, cancelProcess,
//                             getProcessStatus, getProcessDef, listProcessGenera,
//                             findProcessGenusByName, listProcesses
//                    Types:   ProcessStepType, ProcessStepDef, ProcessLaneDef,
//                             ProcessTriggerDef, ProcessDef, ProcessInstanceState,
//                             ProcessSummary, ProcessGenusSummary
//
//   Branches         Branch and merge for isolated changes. Create a branch,
//                    make changes, then merge back. Branch-aware materialization
//                    walks the parent chain. Merge replays tessellae onto target.
//                    Exports: createBranch, switchBranch, listBranches,
//                             findBranchByName, mergeBranch, discardBranch,
//                             detectConflicts, compareBranches, BRANCH_GENUS_ID
//                    Types:   BranchSummary, MergeResult, ConflictInfo
//
//   Sync             Push/pull sync between kernels. Watermark tracking,
//                    unpushed tessella extraction, and pulled data insertion
//                    with source tagging for deduplication.
//                    Exports: getSyncState, setSyncState, getUnpushedTessellae,
//                             getUnpushedRes, insertPulledData
//                    Types:   SyncPullData, SyncPushData, SyncPushResult
//
//   Temporal Anchors  Attach year ranges to entities for timeline queries.
//                    Uses an index table for fast range queries.
//                    Exports: setTemporalAnchor, getTemporalAnchor,
//                             removeTemporalAnchor, queryTimeline
//                    Types:   TemporalAnchor, TimelineEntry, QueryTimelineOptions
//
//   Palace           Spatial navigation layer for workspaces. Rooms with
//                    actions and scrolls give Claude persistent memory-palace
//                    navigation across conversations.
//                    Exports: palaceBuildRoom, palaceGetRoom, palaceGetEntryRoom,
//                             palaceListRooms, palaceHasPalace, palaceWriteScroll,
//                             palaceGetScrolls, palaceDeleteRoom
//                    Types:   PalaceAction, PalaceRoom, PalaceScroll,
//                             PalaceBuildRoomDef, PalaceScrollsResult
//
// Usage:
//   import { initKernel, createRes, appendTessella, replay, materialize } from "./smaragda";
//   import { defineEntityGenus, createEntity, setAttribute, transitionStatus } from "./smaragda";
//
// Find a module: grep "^// SECTION:" smaragda.ts
// ============================================================================

import { Database } from "bun:sqlite";
import { mkdirSync, writeFileSync, readdirSync, statSync, readFileSync, existsSync } from "fs";
import { join, basename } from "path";
import { ulid, sqliteOpen, sqliteMigrate } from "./libraries";

// ============================================================================
// SECTION: Tessella Store
// ============================================================================
//
// Summary:
//   Append-only tessella store backed by SQLite. Create res (entities), append
//   tessellae (immutable facts) to them, replay history, and materialize state
//   at any point in time via a reducer fold.
//
// Usage:
//   const kernel = initKernel(":memory:");
//   const resId = createRes(kernel, "server");
//   appendTessella(kernel, resId, "attribute_set", { key: "name", value: "prod-1" });
//   appendTessella(kernel, resId, "attribute_set", { key: "provider", value: "DO" });
//   const history = replay(kernel, resId);
//   const state = materialize(kernel, resId);
//   kernel.db.close();
//
// Bun built-ins:
//   - bun:sqlite — raw Database class. This section adds: res/tessella schema,
//     branch-aware append with RETURNING, replay with filtering, point-in-time
//     materialize via reducer fold, and sync-friendly indexes.
//
// Design notes:
//   - Tessella ids are INTEGER AUTOINCREMENT for guaranteed monotonic ordering
//     and efficient range queries (replay after id N, materialize up to id N).
//   - Res ids are ULIDs for global uniqueness across nodes.
//   - branch_id on both res and tessella supports future branching/merging.
//   - The default reducer handles a standard set of tessella types (created,
//     attribute_set, attribute_removed, status_changed). Pass a custom reducer
//     to materialize() for domain-specific logic.
//   - sqliteMigrate uses db.run() which only executes one statement in
//     bun:sqlite, so the migration is split into individual statements.
//

// --- Types ---

export interface Kernel {
  db: Database;
  path: string;
  currentBranch: string;
  currentWorkspace: string | null;
}

export interface Res {
  id: string;
  genus_id: string;
  branch_id: string;
  created_at: string;
}

export interface Tessella {
  id: number;
  res_id: string;
  branch_id: string;
  type: string;
  data: any;
  created_at: string;
  source: string | null;
}

export interface ReplayOptions {
  branch_id?: string;
  types?: string[];
  after?: number;
  limit?: number;
}

export interface MaterializeOptions {
  branch_id?: string;
  upTo?: number;
  reducer?: TessellaReducer;
}

export interface AppendOptions {
  branch_id?: string;
  source?: string;
}

export type TessellaReducer = (state: Record<string, unknown>, tessella: Tessella) => Record<string, unknown>;

// --- Migrations ---

const _MIGRATIONS: string[] = [
  `CREATE TABLE res (
    id TEXT PRIMARY KEY,
    genus_id TEXT NOT NULL,
    branch_id TEXT NOT NULL DEFAULT 'main',
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  )`,
  `CREATE TABLE tessella (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    res_id TEXT NOT NULL,
    branch_id TEXT NOT NULL DEFAULT 'main',
    type TEXT NOT NULL,
    data TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    source TEXT
  )`,
  `CREATE INDEX idx_tessella_replay ON tessella(res_id, branch_id, id)`,
  `CREATE INDEX idx_tessella_sync ON tessella(branch_id, id)`,
  `CREATE TABLE input (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL CHECK(type IN ('push', 'pull')),
    source TEXT NOT NULL,
    data TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    branch_id TEXT NOT NULL DEFAULT 'main'
  )`,
  `CREATE TABLE action_taken (
    id TEXT PRIMARY KEY,
    action_genus_id TEXT NOT NULL,
    input_id TEXT NOT NULL,
    resources TEXT NOT NULL,
    params TEXT NOT NULL,
    tessellae_ids TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    branch_id TEXT NOT NULL DEFAULT 'main'
  )`,
  `CREATE TABLE relationship_member (
    relationship_id TEXT NOT NULL,
    role TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    branch_id TEXT NOT NULL DEFAULT 'main'
  )`,
  `CREATE INDEX idx_relationship_member_entity ON relationship_member(entity_id, branch_id)`,
  `CREATE INDEX idx_relationship_member_rel ON relationship_member(relationship_id, branch_id)`,
  `CREATE TABLE IF NOT EXISTS sync_state (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS serialization_run (
    id TEXT PRIMARY KEY,
    target_genus_id TEXT NOT NULL,
    direction TEXT NOT NULL,
    entity_ids TEXT NOT NULL,
    output_path TEXT,
    tessellae_created INTEGER DEFAULT 0,
    branch_id TEXT DEFAULT 'main',
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  )`,
  `ALTER TABLE res ADD COLUMN workspace_id TEXT`,
  `CREATE INDEX idx_res_workspace ON res(workspace_id)`,
  `CREATE TABLE palace_room (
    workspace_id TEXT NOT NULL,
    slug TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT NOT NULL,
    entry INTEGER NOT NULL DEFAULT 0,
    actions TEXT NOT NULL DEFAULT '[]',
    portals TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    PRIMARY KEY (workspace_id, slug)
  )`,
  `CREATE TABLE palace_scroll (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL,
    room_slug TEXT NOT NULL,
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  )`,
  `CREATE INDEX idx_palace_scroll_room ON palace_scroll(workspace_id, room_slug)`,
  `ALTER TABLE palace_room ADD COLUMN version INTEGER NOT NULL DEFAULT 1`,
  `CREATE TABLE temporal_anchor (
    res_id TEXT PRIMARY KEY,
    start_year INTEGER NOT NULL,
    end_year INTEGER,
    precision TEXT NOT NULL DEFAULT 'approximate',
    calendar_note TEXT,
    workspace_id TEXT
  )`,
  `CREATE INDEX idx_temporal_anchor_year ON temporal_anchor(start_year, end_year)`,
  `CREATE INDEX idx_temporal_anchor_workspace ON temporal_anchor(workspace_id)`,
  `CREATE TABLE palace_room_index (
    workspace_id TEXT NOT NULL,
    slug TEXT NOT NULL,
    branch_id TEXT NOT NULL DEFAULT 'main',
    res_id TEXT NOT NULL,
    entry INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (workspace_id, slug, branch_id)
  )`,
  `CREATE TABLE palace_scroll_index (
    res_id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL,
    room_id TEXT NOT NULL,
    branch_id TEXT NOT NULL DEFAULT 'main',
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  )`,
  `CREATE INDEX idx_palace_scroll_index_room ON palace_scroll_index(workspace_id, room_id, branch_id)`,
  `SELECT 1`, // migration marker for _migratePalaceToTessellae — actual migration runs in code
  `CREATE TABLE palace_npc_index (
    workspace_id TEXT NOT NULL,
    slug TEXT NOT NULL,
    room_slug TEXT NOT NULL,
    branch_id TEXT NOT NULL DEFAULT 'main',
    res_id TEXT NOT NULL,
    PRIMARY KEY (workspace_id, slug, branch_id)
  )`,
  `CREATE INDEX idx_palace_npc_room ON palace_npc_index(workspace_id, room_slug, branch_id)`,
];

// --- Internal helpers ---

function _rowToTessella(row: any): Tessella {
  return {
    id: row.id,
    res_id: row.res_id,
    branch_id: row.branch_id,
    type: row.type,
    data: JSON.parse(row.data),
    created_at: row.created_at,
    source: row.source,
  };
}

// --- Core functions ---

export function initKernel(path: string): Kernel {
  const db = sqliteOpen(path);
  sqliteMigrate(db, _MIGRATIONS);
  const kernel: Kernel = { db, path, currentBranch: "main", currentWorkspace: null };
  _bootstrapMetaGenus(kernel);
  _bootstrapLogGenus(kernel);
  _bootstrapErrorGenus(kernel);
  _bootstrapTaskGenus(kernel);
  _evolveTaskGenus(kernel);
  _bootstrapBranchGenus(kernel);
  _bootstrapScienceGenus(kernel);
  _bootstrapTaxonomyGenus(kernel);
  _evolveTaxonomyGenus(kernel);
  _bootstrapCronScheduleGenus(kernel);
  _evolveCronScheduleGenus(kernel);
  _bootstrapWorkspaceGenus(kernel);
  _bootstrapPalaceRoomGenus(kernel);
  _bootstrapPalaceScrollGenus(kernel);
  _bootstrapPalaceNpcGenus(kernel);
  _migratePalaceToTessellae(kernel);
  return kernel;
}

export function getRes(kernel: Kernel, id: string): Res {
  const row = kernel.db.query("SELECT * FROM res WHERE id = ?").get(id) as any;
  if (!row) throw new Error(`Res not found: ${id}`);
  return row as Res;
}

export function createRes(
  kernel: Kernel,
  genus_id: string,
  branch_id: string = "main",
  workspace_id?: string | null,
): string {
  const id = ulid();
  if (workspace_id) {
    kernel.db.run(
      "INSERT INTO res (id, genus_id, branch_id, workspace_id) VALUES (?, ?, ?, ?)",
      [id, genus_id, branch_id, workspace_id],
    );
  } else {
    kernel.db.run(
      "INSERT INTO res (id, genus_id, branch_id) VALUES (?, ?, ?)",
      [id, genus_id, branch_id],
    );
  }
  appendTessella(kernel, id, "created", {}, { branch_id });
  return id;
}

export function appendTessella(
  kernel: Kernel,
  res_id: string,
  type: string,
  data: unknown,
  opts: AppendOptions = {},
): Tessella {
  const branch_id = opts.branch_id ?? "main";
  const source = opts.source ?? null;
  const row = kernel.db.query(
    "INSERT INTO tessella (res_id, branch_id, type, data, source) VALUES (?, ?, ?, ?, ?) RETURNING *",
  ).get(res_id, branch_id, type, JSON.stringify(data), source) as any;
  return _rowToTessella(row);
}

export function replay(kernel: Kernel, res_id: string, opts: ReplayOptions = {}): Tessella[] {
  const branch_id = opts.branch_id ?? "main";
  const after = opts.after ?? -1;
  const types = opts.types;
  const limit = opts.limit;

  let sql = "SELECT * FROM tessella WHERE res_id = ? AND branch_id = ? AND id > ?";
  const params: any[] = [res_id, branch_id, after];

  if (types !== undefined && types.length > 0) {
    sql += ` AND type IN (${types.map(() => "?").join(", ")})`;
    params.push(...types);
  }

  sql += " ORDER BY id ASC";

  if (limit !== undefined) {
    sql += " LIMIT ?";
    params.push(limit);
  }

  const rows = kernel.db.query(sql).all(...params) as any[];
  return rows.map(_rowToTessella);
}

export function materialize(
  kernel: Kernel,
  res_id: string,
  opts: MaterializeOptions = {},
): Record<string, unknown> {
  const branch_id = opts.branch_id ?? "main";
  const upTo = opts.upTo;
  const reducer = opts.reducer ?? defaultReducer;

  let tessellae: Tessella[];
  if (branch_id === "main") {
    let sql = "SELECT * FROM tessella WHERE res_id = ? AND branch_id = 'main'";
    const params: any[] = [res_id];
    if (upTo !== undefined) {
      sql += " AND id <= ?";
      params.push(upTo);
    }
    sql += " ORDER BY id ASC";
    tessellae = (kernel.db.query(sql).all(...params) as any[]).map(_rowToTessella);
  } else {
    tessellae = _collectBranchTessellae(kernel, res_id, branch_id, upTo);
  }

  return tessellae.reduce((state, t) => reducer(state, t), {} as Record<string, unknown>);
}

function _collectBranchTessellae(
  kernel: Kernel,
  res_id: string,
  branch_name: string,
  upTo?: number,
): Tessella[] {
  // Walk the parent chain to build OR clauses
  const chain: { branch_id: string; branch_point: number | null }[] = [];
  let current = branch_name;
  while (current !== "main") {
    const branchEntity = _findBranchByName(kernel, current);
    if (!branchEntity) break;
    chain.push({ branch_id: current, branch_point: branchEntity.branch_point });
    current = branchEntity.parent_branch ?? "main";
  }

  // Build the SQL
  const clauses: string[] = [];
  const params: any[] = [res_id];

  // Main clause: all tessellae up to the earliest branch point in chain
  const mainLimit = chain.length > 0 ? chain[chain.length - 1].branch_point : null;
  if (mainLimit !== null) {
    clauses.push("(branch_id = 'main' AND id <= ?)");
    params.push(mainLimit);
  } else {
    clauses.push("(branch_id = 'main')");
  }

  // Each branch in the chain
  for (let i = chain.length - 1; i >= 0; i--) {
    clauses.push(`(branch_id = ?)`);
    params.push(chain[i].branch_id);
  }

  let sql = `SELECT * FROM tessella WHERE res_id = ? AND (${clauses.join(" OR ")})`;
  if (upTo !== undefined) {
    sql += " AND id <= ?";
    params.push(upTo);
  }
  sql += " ORDER BY id ASC";

  return (kernel.db.query(sql).all(...params) as any[]).map(_rowToTessella);
}

export function defaultReducer(state: Record<string, unknown>, tessella: Tessella): Record<string, unknown> {
  switch (tessella.type) {
    case "created":
      return {};
    case "attribute_set": {
      const { key, value } = tessella.data as { key: string; value: unknown };
      return { ...state, [key]: value };
    }
    case "attribute_removed": {
      const { key } = tessella.data as { key: string };
      const next = { ...state };
      delete next[key];
      return next;
    }
    case "status_changed": {
      const { status } = tessella.data as { status: unknown };
      return { ...state, status };
    }
    case "feature_created": {
      const { feature_id, feature_genus_id } = tessella.data as { feature_id: string; feature_genus_id: string };
      const features = { ...(state.features as Record<string, Record<string, unknown>> ?? {}) };
      features[feature_id] = { genus_id: feature_genus_id };
      return { ...state, features };
    }
    case "feature_attribute_set": {
      const { feature_id, key, value } = tessella.data as { feature_id: string; key: string; value: unknown };
      const features = { ...(state.features as Record<string, Record<string, unknown>> ?? {}) };
      features[feature_id] = { ...features[feature_id], [key]: value };
      return { ...state, features };
    }
    case "feature_status_changed": {
      const { feature_id, status } = tessella.data as { feature_id: string; status: string };
      const features = { ...(state.features as Record<string, Record<string, unknown>> ?? {}) };
      features[feature_id] = { ...features[feature_id], status };
      return { ...state, features };
    }
    case "member_added": {
      const { role, entity_id } = tessella.data as { role: string; entity_id: string };
      const members = { ...(state.members as Record<string, string[]> ?? {}) };
      members[role] = [...(members[role] ?? []), entity_id];
      return { ...state, members };
    }
    case "member_removed": {
      const { role, entity_id } = tessella.data as { role: string; entity_id: string };
      const members = { ...(state.members as Record<string, string[]> ?? {}) };
      members[role] = (members[role] ?? []).filter((id) => id !== entity_id);
      return { ...state, members };
    }
    default:
      return state;
  }
}

// ============================================================================
// SECTION: Genus
// ============================================================================
//
// Summary:
//   Schema-as-res: genus definitions are stored as tessellae on genus res.
//   Enables genus-aware entity creation, attribute type validation, and
//   state machine transition enforcement.
//
// Usage:
//   const kernel = initKernel(":memory:");
//   const serverGenus = defineEntityGenus(kernel, "Server", {
//     attributes: [
//       { name: "ip_address", type: "text", required: true },
//       { name: "provider", type: "text", required: false },
//     ],
//     states: [
//       { name: "provisioning", initial: true },
//       { name: "active", initial: false },
//       { name: "decommissioned", initial: false },
//     ],
//     transitions: [
//       { from: "provisioning", to: "active" },
//       { from: "active", to: "decommissioned" },
//     ],
//   });
//   const entityId = createEntity(kernel, serverGenus);
//   setAttribute(kernel, entityId, "ip_address", "10.0.0.1");
//   transitionStatus(kernel, entityId, "active");
//
// Bun built-ins:
//   - bun:sqlite — genus definitions stored in the same res/tessella tables.
//     This section adds: genus reducer, definition helpers, validation logic,
//     and state machine enforcement.
//
// Design notes:
//   - The meta-genus (genus of genera) uses a sentinel all-zeros ULID
//     "00000000000000000000000000" and references itself as its own genus_id.
//   - getGenusDef materializes on every call. No caching for Demo 2.
//     TODO: add in-memory cache for Demo 3 (server hot path).
//   - GenusDef uses Record<string, ...> for attributes/states (O(1) lookup).
//     Transitions stay as array (queried by from/to pair).
//

// --- Types ---

export type GenusAttributeType = "text" | "number" | "boolean" | "filetree";

export interface GenusAttributeDef {
  name: string;
  type: GenusAttributeType;
  required: boolean;
  default_value?: unknown;
}

export interface GenusStateDef {
  name: string;
  initial: boolean;
}

export interface GenusTransitionDef {
  from: string;
  to: string;
  name?: string;
}

export interface GenusRoleDef {
  name: string;
  valid_member_genera: string[];
  cardinality: "one" | "one_or_more" | "zero_or_more";
}

export interface GenusDef {
  attributes: Record<string, GenusAttributeDef>;
  states: Record<string, GenusStateDef>;
  transitions: GenusTransitionDef[];
  roles: Record<string, GenusRoleDef>;
  meta: Record<string, unknown>;
  initialState: string | null;
}

export interface DefineGenusOptions {
  attributes?: Omit<GenusAttributeDef, "required" | "default_value"> & { required?: boolean; default_value?: unknown }[];
  states?: GenusStateDef[];
  transitions?: GenusTransitionDef[];
  meta?: Record<string, unknown>;
  taxonomy_id?: string;
}

// --- Constants ---

export const META_GENUS_ID = "00000000000000000000000000";
export const LOG_GENUS_ID = "00000000000000000000000001";
export const ERROR_GENUS_ID = "00000000000000000000000002";
export const TASK_GENUS_ID = "00000000000000000000000003";
export const BRANCH_GENUS_ID = "00000000000000000000000004";
export const TAXONOMY_GENUS_ID = "00000000000000000000000005";
export const DEFAULT_TAXONOMY_ID = "00000000000000000000000006";
export const CRON_SCHEDULE_GENUS_ID = "00000000000000000000000007";
export const WORKSPACE_GENUS_ID = "00000000000000000000000008";
export const SCIENCE_GENUS_ID = "00000000000000000000000009";
export const DEFAULT_SCIENCE_ID = "0000000000000000000000000A";
export const PALACE_ROOM_GENUS_ID = "0000000000000000000000000B";
export const PALACE_SCROLL_GENUS_ID = "0000000000000000000000000C";
export const PALACE_NPC_GENUS_ID = "0000000000000000000000000D";

// --- Internal helpers ---

function _bootstrapMetaGenus(kernel: Kernel): void {
  const existing = kernel.db.query("SELECT id FROM res WHERE id = ?").get(META_GENUS_ID) as any;
  if (existing) return;

  kernel.db.run(
    "INSERT INTO res (id, genus_id, branch_id) VALUES (?, ?, ?)",
    [META_GENUS_ID, META_GENUS_ID, "main"],
  );
  appendTessella(kernel, META_GENUS_ID, "created", {});
  appendTessella(kernel, META_GENUS_ID, "genus_meta_set", { key: "name", value: "genus" });
}

function _bootstrapLogGenus(kernel: Kernel): void {
  const existing = kernel.db.query("SELECT id FROM res WHERE id = ?").get(LOG_GENUS_ID) as any;
  if (existing) return;

  kernel.db.run(
    "INSERT INTO res (id, genus_id, branch_id) VALUES (?, ?, ?)",
    [LOG_GENUS_ID, META_GENUS_ID, "main"],
  );
  appendTessella(kernel, LOG_GENUS_ID, "created", {});
  appendTessella(kernel, LOG_GENUS_ID, "genus_meta_set", { key: "name", value: "Log" });
  appendTessella(kernel, LOG_GENUS_ID, "genus_meta_set", { key: "kind", value: "entity" });
  appendTessella(kernel, LOG_GENUS_ID, "genus_attribute_defined", {
    name: "message", type: "text", required: true,
  });
  appendTessella(kernel, LOG_GENUS_ID, "genus_attribute_defined", {
    name: "severity", type: "text", required: false,
  });
  appendTessella(kernel, LOG_GENUS_ID, "genus_attribute_defined", {
    name: "associated_res_id", type: "text", required: false,
  });
}

function _bootstrapErrorGenus(kernel: Kernel): void {
  const existing = kernel.db.query("SELECT id FROM res WHERE id = ?").get(ERROR_GENUS_ID) as any;
  if (existing) return;

  kernel.db.run(
    "INSERT INTO res (id, genus_id, branch_id) VALUES (?, ?, ?)",
    [ERROR_GENUS_ID, META_GENUS_ID, "main"],
  );
  appendTessella(kernel, ERROR_GENUS_ID, "created", {});
  appendTessella(kernel, ERROR_GENUS_ID, "genus_meta_set", { key: "name", value: "Error" });
  appendTessella(kernel, ERROR_GENUS_ID, "genus_meta_set", { key: "kind", value: "entity" });
  appendTessella(kernel, ERROR_GENUS_ID, "genus_attribute_defined", {
    name: "message", type: "text", required: true,
  });
  appendTessella(kernel, ERROR_GENUS_ID, "genus_attribute_defined", {
    name: "severity", type: "text", required: false,
  });
  appendTessella(kernel, ERROR_GENUS_ID, "genus_attribute_defined", {
    name: "associated_res_id", type: "text", required: false,
  });
  appendTessella(kernel, ERROR_GENUS_ID, "genus_attribute_defined", {
    name: "acknowledged_at", type: "text", required: false,
  });
  appendTessella(kernel, ERROR_GENUS_ID, "genus_state_defined", {
    name: "open", initial: true,
  });
  appendTessella(kernel, ERROR_GENUS_ID, "genus_state_defined", {
    name: "acknowledged", initial: false,
  });
  appendTessella(kernel, ERROR_GENUS_ID, "genus_transition_defined", {
    from: "open", to: "acknowledged",
  });
}

function _bootstrapTaskGenus(kernel: Kernel): void {
  const existing = kernel.db.query("SELECT id FROM res WHERE id = ?").get(TASK_GENUS_ID) as any;
  if (existing) return;

  kernel.db.run(
    "INSERT INTO res (id, genus_id, branch_id) VALUES (?, ?, ?)",
    [TASK_GENUS_ID, META_GENUS_ID, "main"],
  );
  appendTessella(kernel, TASK_GENUS_ID, "created", {});
  appendTessella(kernel, TASK_GENUS_ID, "genus_meta_set", { key: "name", value: "Task" });
  appendTessella(kernel, TASK_GENUS_ID, "genus_meta_set", { key: "kind", value: "entity" });
  appendTessella(kernel, TASK_GENUS_ID, "genus_attribute_defined", {
    name: "title", type: "text", required: true,
  });
  appendTessella(kernel, TASK_GENUS_ID, "genus_attribute_defined", {
    name: "description", type: "text", required: false,
  });
  appendTessella(kernel, TASK_GENUS_ID, "genus_attribute_defined", {
    name: "associated_res_id", type: "text", required: false,
  });
  appendTessella(kernel, TASK_GENUS_ID, "genus_attribute_defined", {
    name: "context_res_ids", type: "text", required: false,
  });
  appendTessella(kernel, TASK_GENUS_ID, "genus_attribute_defined", {
    name: "target_agent_type", type: "text", required: false,
  });
  appendTessella(kernel, TASK_GENUS_ID, "genus_attribute_defined", {
    name: "priority", type: "text", required: false,
  });
  appendTessella(kernel, TASK_GENUS_ID, "genus_attribute_defined", {
    name: "assigned_to", type: "text", required: false,
  });
  appendTessella(kernel, TASK_GENUS_ID, "genus_attribute_defined", {
    name: "claimed_at", type: "text", required: false,
  });
  appendTessella(kernel, TASK_GENUS_ID, "genus_attribute_defined", {
    name: "completed_at", type: "text", required: false,
  });
  appendTessella(kernel, TASK_GENUS_ID, "genus_attribute_defined", {
    name: "result", type: "text", required: false,
  });
  appendTessella(kernel, TASK_GENUS_ID, "genus_state_defined", {
    name: "pending", initial: true,
  });
  appendTessella(kernel, TASK_GENUS_ID, "genus_state_defined", {
    name: "claimed", initial: false,
  });
  appendTessella(kernel, TASK_GENUS_ID, "genus_state_defined", {
    name: "completed", initial: false,
  });
  appendTessella(kernel, TASK_GENUS_ID, "genus_state_defined", {
    name: "cancelled", initial: false,
  });
  appendTessella(kernel, TASK_GENUS_ID, "genus_transition_defined", {
    from: "pending", to: "claimed",
  });
  appendTessella(kernel, TASK_GENUS_ID, "genus_transition_defined", {
    from: "pending", to: "completed",
  });
  appendTessella(kernel, TASK_GENUS_ID, "genus_transition_defined", {
    from: "pending", to: "cancelled",
  });
  appendTessella(kernel, TASK_GENUS_ID, "genus_transition_defined", {
    from: "claimed", to: "completed",
  });
  appendTessella(kernel, TASK_GENUS_ID, "genus_transition_defined", {
    from: "claimed", to: "cancelled",
  });
  appendTessella(kernel, TASK_GENUS_ID, "genus_transition_defined", {
    from: "claimed", to: "pending",
  });
}

function _bootstrapBranchGenus(kernel: Kernel): void {
  const existing = kernel.db.query("SELECT id FROM res WHERE id = ?").get(BRANCH_GENUS_ID) as any;
  if (existing) return;

  kernel.db.run(
    "INSERT INTO res (id, genus_id, branch_id) VALUES (?, ?, ?)",
    [BRANCH_GENUS_ID, META_GENUS_ID, "main"],
  );
  appendTessella(kernel, BRANCH_GENUS_ID, "created", {});
  appendTessella(kernel, BRANCH_GENUS_ID, "genus_meta_set", { key: "name", value: "Branch" });
  appendTessella(kernel, BRANCH_GENUS_ID, "genus_meta_set", { key: "kind", value: "entity" });
  appendTessella(kernel, BRANCH_GENUS_ID, "genus_attribute_defined", {
    name: "name", type: "text", required: true,
  });
  appendTessella(kernel, BRANCH_GENUS_ID, "genus_attribute_defined", {
    name: "parent_branch", type: "text", required: false,
  });
  appendTessella(kernel, BRANCH_GENUS_ID, "genus_attribute_defined", {
    name: "branch_point", type: "number", required: false,
  });
  appendTessella(kernel, BRANCH_GENUS_ID, "genus_state_defined", {
    name: "active", initial: true,
  });
  appendTessella(kernel, BRANCH_GENUS_ID, "genus_state_defined", {
    name: "merged", initial: false,
  });
  appendTessella(kernel, BRANCH_GENUS_ID, "genus_state_defined", {
    name: "discarded", initial: false,
  });
  appendTessella(kernel, BRANCH_GENUS_ID, "genus_transition_defined", {
    from: "active", to: "merged",
  });
  appendTessella(kernel, BRANCH_GENUS_ID, "genus_transition_defined", {
    from: "active", to: "discarded",
  });

  // Create the "main" branch entity on "main"
  const mainBranchId = createRes(kernel, BRANCH_GENUS_ID, "main");
  appendTessella(kernel, mainBranchId, "attribute_set", { key: "name", value: "main" });
  appendTessella(kernel, mainBranchId, "status_changed", { status: "active" });
}

function _bootstrapScienceGenus(kernel: Kernel): void {
  const existing = kernel.db.query("SELECT id FROM res WHERE id = ?").get(SCIENCE_GENUS_ID) as any;
  if (existing) return;

  // Create the Science genus definition
  kernel.db.run(
    "INSERT INTO res (id, genus_id, branch_id) VALUES (?, ?, ?)",
    [SCIENCE_GENUS_ID, META_GENUS_ID, "main"],
  );
  appendTessella(kernel, SCIENCE_GENUS_ID, "created", {});
  appendTessella(kernel, SCIENCE_GENUS_ID, "genus_meta_set", { key: "name", value: "Science" });
  appendTessella(kernel, SCIENCE_GENUS_ID, "genus_attribute_defined", {
    name: "name", type: "text", required: true,
  });
  appendTessella(kernel, SCIENCE_GENUS_ID, "genus_attribute_defined", {
    name: "description", type: "text", required: false,
  });
  appendTessella(kernel, SCIENCE_GENUS_ID, "genus_state_defined", {
    name: "active", initial: true,
  });
  appendTessella(kernel, SCIENCE_GENUS_ID, "genus_state_defined", {
    name: "archived", initial: false,
  });
  appendTessella(kernel, SCIENCE_GENUS_ID, "genus_transition_defined", {
    from: "active", to: "archived",
  });
  appendTessella(kernel, SCIENCE_GENUS_ID, "genus_transition_defined", {
    from: "archived", to: "active",
  });

  // Create the default science entity
  kernel.db.run(
    "INSERT INTO res (id, genus_id, branch_id) VALUES (?, ?, ?)",
    [DEFAULT_SCIENCE_ID, SCIENCE_GENUS_ID, "main"],
  );
  appendTessella(kernel, DEFAULT_SCIENCE_ID, "created", {});
  appendTessella(kernel, DEFAULT_SCIENCE_ID, "attribute_set", { key: "name", value: "Default" });
  appendTessella(kernel, DEFAULT_SCIENCE_ID, "attribute_set", { key: "description", value: "Default science for all taxonomies" });
  appendTessella(kernel, DEFAULT_SCIENCE_ID, "status_changed", { status: "active" });
}

function _bootstrapTaxonomyGenus(kernel: Kernel): void {
  const existing = kernel.db.query("SELECT id FROM res WHERE id = ?").get(TAXONOMY_GENUS_ID) as any;
  if (existing) return;

  // Create the Taxonomy genus definition
  kernel.db.run(
    "INSERT INTO res (id, genus_id, branch_id) VALUES (?, ?, ?)",
    [TAXONOMY_GENUS_ID, META_GENUS_ID, "main"],
  );
  appendTessella(kernel, TAXONOMY_GENUS_ID, "created", {});
  appendTessella(kernel, TAXONOMY_GENUS_ID, "genus_meta_set", { key: "name", value: "Taxonomy" });
  appendTessella(kernel, TAXONOMY_GENUS_ID, "genus_attribute_defined", {
    name: "name", type: "text", required: true,
  });
  appendTessella(kernel, TAXONOMY_GENUS_ID, "genus_attribute_defined", {
    name: "description", type: "text", required: false,
  });
  appendTessella(kernel, TAXONOMY_GENUS_ID, "genus_state_defined", {
    name: "active", initial: true,
  });
  appendTessella(kernel, TAXONOMY_GENUS_ID, "genus_state_defined", {
    name: "archived", initial: false,
  });
  appendTessella(kernel, TAXONOMY_GENUS_ID, "genus_transition_defined", {
    from: "active", to: "archived",
  });

  // Create the default taxonomy entity
  kernel.db.run(
    "INSERT INTO res (id, genus_id, branch_id) VALUES (?, ?, ?)",
    [DEFAULT_TAXONOMY_ID, TAXONOMY_GENUS_ID, "main"],
  );
  appendTessella(kernel, DEFAULT_TAXONOMY_ID, "created", {});
  appendTessella(kernel, DEFAULT_TAXONOMY_ID, "attribute_set", { key: "name", value: "Default" });
  appendTessella(kernel, DEFAULT_TAXONOMY_ID, "attribute_set", { key: "description", value: "Default taxonomy for all genera" });
  appendTessella(kernel, DEFAULT_TAXONOMY_ID, "attribute_set", { key: "science_id", value: DEFAULT_SCIENCE_ID });
  appendTessella(kernel, DEFAULT_TAXONOMY_ID, "status_changed", { status: "active" });
}

function _evolveTaxonomyGenus(kernel: Kernel): void {
  evolveGenus(kernel, TAXONOMY_GENUS_ID, {
    attributes: [
      { name: "science_id", type: "text", required: false },
      { name: "shared_science_ids", type: "text", required: false },
    ],
    transitions: [{ from: "archived", to: "active" }],
  });
  // Rename "Domain" → "Ontology" → "Taxonomy" for existing databases
  const def = getGenusDef(kernel, TAXONOMY_GENUS_ID);
  if (def.meta.name === "Domain" || def.meta.name === "Ontology") {
    appendTessella(kernel, TAXONOMY_GENUS_ID, "genus_meta_set", { key: "name", value: "Taxonomy" });
  }
  // Set science_id on default taxonomy if not already set
  const defaultState = materialize(kernel, DEFAULT_TAXONOMY_ID);
  if (!defaultState.science_id) {
    appendTessella(kernel, DEFAULT_TAXONOMY_ID, "attribute_set", { key: "science_id", value: DEFAULT_SCIENCE_ID });
  }
}

function _bootstrapCronScheduleGenus(kernel: Kernel): void {
  const existing = kernel.db.query("SELECT id FROM res WHERE id = ?").get(CRON_SCHEDULE_GENUS_ID) as any;
  if (existing) return;

  kernel.db.run(
    "INSERT INTO res (id, genus_id, branch_id) VALUES (?, ?, ?)",
    [CRON_SCHEDULE_GENUS_ID, META_GENUS_ID, "main"],
  );
  appendTessella(kernel, CRON_SCHEDULE_GENUS_ID, "created", {});
  appendTessella(kernel, CRON_SCHEDULE_GENUS_ID, "genus_meta_set", { key: "name", value: "CronSchedule" });
  appendTessella(kernel, CRON_SCHEDULE_GENUS_ID, "genus_meta_set", { key: "kind", value: "entity" });
  appendTessella(kernel, CRON_SCHEDULE_GENUS_ID, "genus_attribute_defined", {
    name: "name", type: "text", required: true,
  });
  appendTessella(kernel, CRON_SCHEDULE_GENUS_ID, "genus_attribute_defined", {
    name: "expression", type: "text", required: true,
  });
  appendTessella(kernel, CRON_SCHEDULE_GENUS_ID, "genus_attribute_defined", {
    name: "target_type", type: "text", required: true,
  });
  appendTessella(kernel, CRON_SCHEDULE_GENUS_ID, "genus_attribute_defined", {
    name: "target_genus_id", type: "text", required: true,
  });
  appendTessella(kernel, CRON_SCHEDULE_GENUS_ID, "genus_attribute_defined", {
    name: "target_config", type: "text", required: false,
  });
  appendTessella(kernel, CRON_SCHEDULE_GENUS_ID, "genus_attribute_defined", {
    name: "last_fired_at", type: "text", required: false,
  });
  appendTessella(kernel, CRON_SCHEDULE_GENUS_ID, "genus_state_defined", {
    name: "active", initial: true,
  });
  appendTessella(kernel, CRON_SCHEDULE_GENUS_ID, "genus_state_defined", {
    name: "paused", initial: false,
  });
  appendTessella(kernel, CRON_SCHEDULE_GENUS_ID, "genus_state_defined", {
    name: "retired", initial: false,
  });
  appendTessella(kernel, CRON_SCHEDULE_GENUS_ID, "genus_transition_defined", {
    from: "active", to: "paused",
  });
  appendTessella(kernel, CRON_SCHEDULE_GENUS_ID, "genus_transition_defined", {
    from: "paused", to: "active",
  });
  appendTessella(kernel, CRON_SCHEDULE_GENUS_ID, "genus_transition_defined", {
    from: "active", to: "retired",
  });
  appendTessella(kernel, CRON_SCHEDULE_GENUS_ID, "genus_transition_defined", {
    from: "paused", to: "retired",
  });
}

function _evolveCronScheduleGenus(kernel: Kernel): void {
  evolveGenus(kernel, CRON_SCHEDULE_GENUS_ID, {
    attributes: [{ name: "scheduled_at", type: "text", required: false }],
  });
}

function _evolveTaskGenus(kernel: Kernel): void {
  evolveGenus(kernel, TASK_GENUS_ID, {
    attributes: [
      { name: "step_name", type: "text", required: false },
      { name: "lane_name", type: "text", required: false },
    ],
  });
}

function _bootstrapWorkspaceGenus(kernel: Kernel): void {
  const existing = kernel.db.query("SELECT id FROM res WHERE id = ?").get(WORKSPACE_GENUS_ID) as any;
  if (existing) return;

  kernel.db.run(
    "INSERT INTO res (id, genus_id, branch_id) VALUES (?, ?, ?)",
    [WORKSPACE_GENUS_ID, META_GENUS_ID, "main"],
  );
  appendTessella(kernel, WORKSPACE_GENUS_ID, "created", {});
  appendTessella(kernel, WORKSPACE_GENUS_ID, "genus_meta_set", { key: "name", value: "Workspace" });
  appendTessella(kernel, WORKSPACE_GENUS_ID, "genus_attribute_defined", {
    name: "name", type: "text", required: true,
  });
  appendTessella(kernel, WORKSPACE_GENUS_ID, "genus_attribute_defined", {
    name: "description", type: "text", required: false,
  });
  appendTessella(kernel, WORKSPACE_GENUS_ID, "genus_state_defined", {
    name: "active", initial: true,
  });
  appendTessella(kernel, WORKSPACE_GENUS_ID, "genus_state_defined", {
    name: "archived", initial: false,
  });
  appendTessella(kernel, WORKSPACE_GENUS_ID, "genus_transition_defined", {
    from: "active", to: "archived",
  });
  appendTessella(kernel, WORKSPACE_GENUS_ID, "genus_transition_defined", {
    from: "archived", to: "active",
  });
}

function _bootstrapPalaceRoomGenus(kernel: Kernel): void {
  const existing = kernel.db.query("SELECT id FROM res WHERE id = ?").get(PALACE_ROOM_GENUS_ID) as any;
  if (existing) return;

  kernel.db.run(
    "INSERT INTO res (id, genus_id, branch_id) VALUES (?, ?, ?)",
    [PALACE_ROOM_GENUS_ID, META_GENUS_ID, "main"],
  );
  appendTessella(kernel, PALACE_ROOM_GENUS_ID, "created", {});
  appendTessella(kernel, PALACE_ROOM_GENUS_ID, "genus_meta_set", { key: "name", value: "Palace Room" });
  appendTessella(kernel, PALACE_ROOM_GENUS_ID, "genus_attribute_defined", { name: "slug", type: "text", required: true });
  appendTessella(kernel, PALACE_ROOM_GENUS_ID, "genus_attribute_defined", { name: "name", type: "text", required: true });
  appendTessella(kernel, PALACE_ROOM_GENUS_ID, "genus_attribute_defined", { name: "description", type: "text", required: true });
  appendTessella(kernel, PALACE_ROOM_GENUS_ID, "genus_attribute_defined", { name: "entry", type: "boolean" });
  appendTessella(kernel, PALACE_ROOM_GENUS_ID, "genus_attribute_defined", { name: "actions", type: "filetree" });
  appendTessella(kernel, PALACE_ROOM_GENUS_ID, "genus_attribute_defined", { name: "portals", type: "filetree" });
  appendTessella(kernel, PALACE_ROOM_GENUS_ID, "genus_attribute_defined", { name: "version", type: "number" });
  appendTessella(kernel, PALACE_ROOM_GENUS_ID, "genus_state_defined", { name: "active", initial: true });
  appendTessella(kernel, PALACE_ROOM_GENUS_ID, "genus_state_defined", { name: "archived", initial: false });
  appendTessella(kernel, PALACE_ROOM_GENUS_ID, "genus_transition_defined", { from: "active", to: "archived" });
  appendTessella(kernel, PALACE_ROOM_GENUS_ID, "genus_transition_defined", { from: "archived", to: "active" });
}

function _bootstrapPalaceScrollGenus(kernel: Kernel): void {
  const existing = kernel.db.query("SELECT id FROM res WHERE id = ?").get(PALACE_SCROLL_GENUS_ID) as any;
  if (existing) return;

  kernel.db.run(
    "INSERT INTO res (id, genus_id, branch_id) VALUES (?, ?, ?)",
    [PALACE_SCROLL_GENUS_ID, META_GENUS_ID, "main"],
  );
  appendTessella(kernel, PALACE_SCROLL_GENUS_ID, "created", {});
  appendTessella(kernel, PALACE_SCROLL_GENUS_ID, "genus_meta_set", { key: "name", value: "Palace Scroll" });
  appendTessella(kernel, PALACE_SCROLL_GENUS_ID, "genus_attribute_defined", { name: "room_id", type: "text", required: true });
  appendTessella(kernel, PALACE_SCROLL_GENUS_ID, "genus_attribute_defined", { name: "title", type: "text", required: true });
  appendTessella(kernel, PALACE_SCROLL_GENUS_ID, "genus_attribute_defined", { name: "body", type: "text", required: true });
  appendTessella(kernel, PALACE_SCROLL_GENUS_ID, "genus_state_defined", { name: "active", initial: true });
}

function _bootstrapPalaceNpcGenus(kernel: Kernel): void {
  const existing = kernel.db.query("SELECT id FROM res WHERE id = ?").get(PALACE_NPC_GENUS_ID) as any;
  if (existing) return;

  kernel.db.run(
    "INSERT INTO res (id, genus_id, branch_id) VALUES (?, ?, ?)",
    [PALACE_NPC_GENUS_ID, META_GENUS_ID, "main"],
  );
  appendTessella(kernel, PALACE_NPC_GENUS_ID, "created", {});
  appendTessella(kernel, PALACE_NPC_GENUS_ID, "genus_meta_set", { key: "name", value: "Palace NPC" });
  appendTessella(kernel, PALACE_NPC_GENUS_ID, "genus_attribute_defined", { name: "slug", type: "text", required: true });
  appendTessella(kernel, PALACE_NPC_GENUS_ID, "genus_attribute_defined", { name: "name", type: "text", required: true });
  appendTessella(kernel, PALACE_NPC_GENUS_ID, "genus_attribute_defined", { name: "description", type: "text", required: true });
  appendTessella(kernel, PALACE_NPC_GENUS_ID, "genus_attribute_defined", { name: "room_slug", type: "text", required: true });
  appendTessella(kernel, PALACE_NPC_GENUS_ID, "genus_attribute_defined", { name: "greeting", type: "text", required: true });
  appendTessella(kernel, PALACE_NPC_GENUS_ID, "genus_attribute_defined", { name: "dialogue", type: "filetree" });
  appendTessella(kernel, PALACE_NPC_GENUS_ID, "genus_state_defined", { name: "active", initial: true });
  appendTessella(kernel, PALACE_NPC_GENUS_ID, "genus_state_defined", { name: "archived", initial: false });
  appendTessella(kernel, PALACE_NPC_GENUS_ID, "genus_transition_defined", { from: "active", to: "archived" });
  appendTessella(kernel, PALACE_NPC_GENUS_ID, "genus_transition_defined", { from: "archived", to: "active" });
}

function _validateAttributeType(value: unknown, expected: GenusAttributeType): boolean {
  switch (expected) {
    case "text": return typeof value === "string";
    case "number": return typeof value === "number";
    case "boolean": return typeof value === "boolean";
    case "filetree": return typeof value === "object" && value !== null;
    default: return true; // forward compat for unknown types
  }
}

// --- Core functions ---

export function genusReducer(state: Record<string, unknown>, tessella: Tessella): Record<string, unknown> {
  switch (tessella.type) {
    case "created":
      return { attributes: {}, states: {}, transitions: [], roles: {}, meta: {} };
    case "genus_attribute_defined": {
      const def = tessella.data as GenusAttributeDef;
      const attributes = { ...(state.attributes as Record<string, GenusAttributeDef>), [def.name]: def };
      return { ...state, attributes };
    }
    case "genus_state_defined": {
      const def = tessella.data as GenusStateDef;
      const states = { ...(state.states as Record<string, GenusStateDef>), [def.name]: def };
      return { ...state, states };
    }
    case "genus_transition_defined": {
      const def = tessella.data as GenusTransitionDef;
      const existing = state.transitions as GenusTransitionDef[];
      const idx = existing.findIndex((t) => t.from === def.from && t.to === def.to);
      const transitions = idx >= 0
        ? existing.map((t, i) => (i === idx ? def : t))
        : [...existing, def];
      return { ...state, transitions };
    }
    case "genus_role_defined": {
      const def = tessella.data as GenusRoleDef;
      const roles = { ...(state.roles as Record<string, GenusRoleDef>), [def.name]: def };
      return { ...state, roles };
    }
    case "genus_meta_set": {
      let { key, value } = tessella.data as { key: string; value: unknown };
      if (key === "domain_id" || key === "ontology_id") key = "taxonomy_id"; // backwards compat
      const meta = { ...(state.meta as Record<string, unknown>), [key]: value };
      return { ...state, meta };
    }
    default:
      return state;
  }
}

export function getGenusDef(kernel: Kernel, genus_id: string): GenusDef {
  const raw = materialize(kernel, genus_id, { branch_id: "main", reducer: genusReducer });
  const attributes = (raw.attributes as Record<string, GenusAttributeDef>) ?? {};
  const states = (raw.states as Record<string, GenusStateDef>) ?? {};
  const transitions = (raw.transitions as GenusTransitionDef[]) ?? [];
  const roles = (raw.roles as Record<string, GenusRoleDef>) ?? {};
  const meta = (raw.meta as Record<string, unknown>) ?? {};

  let initialState: string | null = null;
  for (const s of Object.values(states)) {
    if (s.initial) {
      initialState = s.name;
      break;
    }
  }

  return { attributes, states, transitions, roles, meta, initialState };
}

export function getEntityDisplayName(kernel: Kernel, entityId: string): string {
  const state = materialize(kernel, entityId, { branch_id: kernel.currentBranch });
  const resRow = getRes(kernel, entityId);
  const genusDef = getGenusDef(kernel, resRow.genus_id);
  const displayAttr = genusDef.meta.display_attribute as string | undefined;
  if (displayAttr && typeof state[displayAttr] === "string") return state[displayAttr] as string;
  if (typeof state.name === "string") return state.name;
  if (typeof state.title === "string") return state.title;
  for (const [k, v] of Object.entries(state)) {
    if (k === "status" || k === "genus_id" || typeof v !== "string") continue;
    return v.length > 80 ? v.slice(0, 80) + "..." : v;
  }
  return entityId;
}

export function validateAttributes(
  attributes: { name: string; type: string; required?: boolean; default_value?: unknown }[],
): void {
  const VALID_TYPES: string[] = ["text", "number", "boolean", "filetree"];
  const seen = new Set<string>();
  for (const attr of attributes) {
    const lower = attr.name.toLowerCase();
    if (seen.has(lower)) {
      throw new Error(`Duplicate attribute name: "${attr.name}"`);
    }
    seen.add(lower);
    if (!VALID_TYPES.includes(attr.type)) {
      throw new Error(`Invalid attribute type "${attr.type}" for "${attr.name}". Valid types: ${VALID_TYPES.join(", ")}`);
    }
  }
}

export function validateStateMachine(
  states: { name: string; initial?: boolean }[],
  transitions: { from: string; to: string; name?: string }[],
): void {
  const stateNames = new Set<string>();
  const initialStates: string[] = [];
  for (const s of states) {
    const lower = s.name.toLowerCase();
    if (stateNames.has(lower)) {
      throw new Error(`Duplicate state name: "${s.name}"`);
    }
    stateNames.add(lower);
    if (s.initial) initialStates.push(s.name);
  }
  if (initialStates.length === 0) {
    throw new Error("State machine must have exactly one initial state");
  }
  if (initialStates.length > 1) {
    throw new Error(`State machine has multiple initial states: ${initialStates.join(", ")}`);
  }
  for (const t of transitions) {
    if (!stateNames.has(t.from.toLowerCase())) {
      throw new Error(`Transition references undefined state: "${t.from}"`);
    }
    if (!stateNames.has(t.to.toLowerCase())) {
      throw new Error(`Transition references undefined state: "${t.to}"`);
    }
  }
}

function _validateActionTokens(
  value: unknown,
  resourceNames: Set<string>,
  parameterNames: Set<string>,
  path: string,
): void {
  if (typeof value === "string") {
    for (const match of value.matchAll(/\$res\.(\w+)\.id/g)) {
      if (!resourceNames.has(match[1])) {
        throw new Error(`Handler references undefined resource "${match[1]}" at ${path}. Available resources: ${[...resourceNames].join(", ") || "(none)"}`);
      }
    }
    for (const match of value.matchAll(/\$param\.(\w+)/g)) {
      if (!parameterNames.has(match[1])) {
        throw new Error(`Handler references undefined parameter "${match[1]}" at ${path}. Available parameters: ${[...parameterNames].join(", ") || "(none)"}`);
      }
    }
    return;
  }
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      _validateActionTokens(value[i], resourceNames, parameterNames, `${path}[${i}]`);
    }
    return;
  }
  if (value !== null && typeof value === "object") {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      _validateActionTokens(v, resourceNames, parameterNames, `${path}.${k}`);
    }
  }
}

export function validateActionHandler(
  handler: SideEffect[],
  resourceNames: string[],
  parameterNames: string[],
): void {
  const resSet = new Set(resourceNames);
  const paramSet = new Set(parameterNames);

  const VALID_TYPES = new Set(["set_attribute", "transition_status", "create_res", "create_log", "create_error", "create_task"]);
  const REQUIRED_FIELDS: Record<string, string[]> = {
    set_attribute: ["res", "key", "value"],
    transition_status: ["res", "target"],
    create_res: ["genus_name"],
    create_log: ["message"],
    create_error: ["message"],
    create_task: ["title"],
  };

  for (let i = 0; i < handler.length; i++) {
    const effect = handler[i];
    if (!VALID_TYPES.has(effect.type)) {
      throw new Error(`Unknown side effect type: "${effect.type}" at index ${i}. Valid types: ${[...VALID_TYPES].join(", ")}`);
    }
    const required = REQUIRED_FIELDS[effect.type];
    for (const field of required) {
      if (effect[field] === undefined) {
        throw new Error(`Side effect [${i}] (${effect.type}) missing required field: "${field}"`);
      }
    }
    _validateActionTokens(effect, resSet, paramSet, `handler[${i}]`);
  }
}

export function validateProcessDefinition(
  lanes: { name: string }[],
  steps: { name: string; type: string; lane: string; gate_conditions?: string[] }[],
): void {
  if (lanes.length === 0) {
    throw new Error("Process must have at least one lane");
  }
  const laneNames = new Set<string>();
  for (const lane of lanes) {
    const lower = lane.name.toLowerCase();
    if (laneNames.has(lower)) {
      throw new Error(`Duplicate lane name: "${lane.name}"`);
    }
    laneNames.add(lower);
  }
  if (steps.length === 0) {
    throw new Error("Process must have at least one step");
  }
  const VALID_STEP_TYPES = new Set(["task_step", "action_step", "gate_step", "fetch_step", "branch_step"]);
  const stepNames = new Set<string>();
  for (const step of steps) {
    const lower = step.name.toLowerCase();
    if (stepNames.has(lower)) {
      throw new Error(`Duplicate step name: "${step.name}"`);
    }
    stepNames.add(lower);
    if (!VALID_STEP_TYPES.has(step.type)) {
      throw new Error(`Invalid step type "${step.type}" for step "${step.name}". Valid types: ${[...VALID_STEP_TYPES].join(", ")}`);
    }
    if (!laneNames.has(step.lane.toLowerCase())) {
      throw new Error(`Step "${step.name}" references undefined lane: "${step.lane}"`);
    }
    if (step.type === "gate_step") {
      if (!step.gate_conditions || step.gate_conditions.length === 0) {
        throw new Error(`Gate step "${step.name}" must have at least one condition`);
      }
      for (const cond of step.gate_conditions) {
        if (!stepNames.has(cond.toLowerCase())) {
          throw new Error(`Gate step "${step.name}" references undefined step in conditions: "${cond}"`);
        }
      }
    }
  }
}

export function defineEntityGenus(
  kernel: Kernel,
  name: string,
  opts: DefineGenusOptions = {},
): string {
  const effectiveOntologyId = opts.taxonomy_id ?? DEFAULT_TAXONOMY_ID;
  _checkTaxonomyNotArchived(kernel, effectiveOntologyId);

  const genusId = createRes(kernel, META_GENUS_ID);
  appendTessella(kernel, genusId, "genus_meta_set", { key: "name", value: name });
  appendTessella(kernel, genusId, "genus_meta_set", { key: "taxonomy_id", value: effectiveOntologyId });

  if (opts.attributes) {
    for (const attr of opts.attributes) {
      appendTessella(kernel, genusId, "genus_attribute_defined", {
        name: attr.name,
        type: attr.type,
        required: attr.required ?? false,
        ...(attr.default_value !== undefined ? { default_value: attr.default_value } : {}),
      });
    }
  }

  if (opts.states) {
    for (const st of opts.states) {
      appendTessella(kernel, genusId, "genus_state_defined", st);
    }
  }

  if (opts.transitions) {
    for (const tr of opts.transitions) {
      appendTessella(kernel, genusId, "genus_transition_defined", tr);
    }
  }

  if (opts.meta) {
    for (const [key, value] of Object.entries(opts.meta)) {
      appendTessella(kernel, genusId, "genus_meta_set", { key, value });
    }
  }

  return genusId;
}

export function createEntity(kernel: Kernel, genus_id: string, branch_id?: string): string {
  const effectiveBranch = branch_id ?? kernel.currentBranch;
  // Validate genus exists
  const genusRow = kernel.db.query("SELECT id FROM res WHERE id = ?").get(genus_id) as any;
  if (!genusRow) {
    throw new Error(`Genus not found: ${genus_id}`);
  }

  const genusDef = getGenusDef(kernel, genus_id);
  if (genusDef.meta.deprecated === true) {
    throw new Error(`Cannot create entity: genus "${genusDef.meta.name}" is deprecated`);
  }
  const ontologyId = (genusDef.meta.taxonomy_id as string) ?? DEFAULT_TAXONOMY_ID;
  _checkTaxonomyNotArchived(kernel, ontologyId);

  const entityId = createRes(kernel, genus_id, effectiveBranch, kernel.currentWorkspace);

  // Set initial status from genus state machine
  if (genusDef.initialState) {
    appendTessella(kernel, entityId, "status_changed", { status: genusDef.initialState }, { branch_id: effectiveBranch });
  }

  return entityId;
}

export function setAttribute(
  kernel: Kernel,
  res_id: string,
  key: string,
  value: unknown,
  opts: AppendOptions = {},
): Tessella {
  // Look up entity's genus
  const resRow = kernel.db.query("SELECT genus_id FROM res WHERE id = ?").get(res_id) as any;
  if (!resRow) {
    throw new Error(`Res not found: ${res_id}`);
  }

  const genusDef = getGenusDef(kernel, resRow.genus_id);

  // Validate attribute exists in genus
  const attrDef = genusDef.attributes[key];
  if (!attrDef) {
    const validAttrs = Object.keys(genusDef.attributes).join(", ");
    throw new Error(`Attribute "${key}" is not defined on genus "${genusDef.meta.name}". Valid attributes: ${validAttrs}`);
  }

  // Validate type
  if (!_validateAttributeType(value, attrDef.type)) {
    throw new Error(`Type mismatch for attribute "${key}": expected ${attrDef.type}, got ${typeof value}`);
  }

  const effectiveOpts = { ...opts, branch_id: opts.branch_id ?? kernel.currentBranch };
  return appendTessella(kernel, res_id, "attribute_set", { key, value }, effectiveOpts);
}

export function transitionStatus(
  kernel: Kernel,
  res_id: string,
  target_status: string,
  opts: AppendOptions = {},
): Tessella {
  // Look up entity's genus
  const resRow = kernel.db.query("SELECT genus_id FROM res WHERE id = ?").get(res_id) as any;
  if (!resRow) {
    throw new Error(`Res not found: ${res_id}`);
  }

  const genusDef = getGenusDef(kernel, resRow.genus_id);

  // Validate target state exists
  if (!genusDef.states[target_status]) {
    const validStates = Object.keys(genusDef.states).join(", ");
    throw new Error(`State "${target_status}" is not defined on genus "${genusDef.meta.name}". Valid states: ${validStates}`);
  }

  // Get current status
  const effectiveBranch = opts.branch_id ?? kernel.currentBranch;
  const state = materialize(kernel, res_id, { branch_id: effectiveBranch });
  const currentStatus = state.status as string | undefined;

  if (!currentStatus) {
    throw new Error(`Entity "${res_id}" (genus "${genusDef.meta.name}") has no current status`);
  }

  // Validate transition exists
  const valid = genusDef.transitions.some(
    (t) => t.from === currentStatus && t.to === target_status,
  );
  if (!valid) {
    const validTargets = genusDef.transitions.filter(t => t.from === currentStatus).map(t => t.to);
    throw new Error(
      `No valid transition from "${currentStatus}" to "${target_status}". Valid transitions from "${currentStatus}": ${validTargets.length > 0 ? validTargets.join(", ") : "(none)"}`,
    );
  }

  return appendTessella(kernel, res_id, "status_changed", { status: target_status }, { ...opts, branch_id: effectiveBranch });
}

export function findTransitionPath(genusDef: GenusDef, from: string, to: string): string[] | null {
  if (from === to) return [];
  // BFS over transitions
  const visited = new Set<string>([from]);
  const queue: { state: string; path: string[] }[] = [{ state: from, path: [] }];
  while (queue.length > 0) {
    const { state, path } = queue.shift()!;
    for (const t of genusDef.transitions) {
      if (t.from === state && !visited.has(t.to)) {
        const newPath = [...path, t.to];
        if (t.to === to) return newPath;
        visited.add(t.to);
        queue.push({ state: t.to, path: newPath });
      }
    }
  }
  return null;
}

// --- Genus query helpers ---

export interface GenusSummary {
  id: string;
  name: string;
  def: GenusDef;
}

export interface EntitySummary {
  id: string;
  genus_id: string;
  created_at: string;
  state: Record<string, unknown>;
}

export interface TaxonomySummary {
  id: string;
  name: string;
  description: string;
  status: string;
}

export interface TaxonomyDescription {
  id: string;
  name: string;
  description: string;
  status: string;
  entity_genera: { id: string; name: string; entity_count: number; def: GenusDef }[];
  feature_genera: { id: string; name: string; parent_genus_name: string; def: GenusDef }[];
  relationship_genera: { id: string; name: string; def: GenusDef }[];
  action_genera: { id: string; name: string; def: ActionDef }[];
  process_genera: { id: string; name: string; def: ProcessDef }[];
  serialization_genera: { id: string; name: string; def: SerializationDef }[];
}

export interface ScienceSummary {
  id: string;
  name: string;
  description: string;
  status: string;
}

export interface ScienceDescription {
  id: string;
  name: string;
  description: string;
  status: string;
  taxonomies: TaxonomySummary[];
}

export interface AttributeFilter {
  key: string;
  op: "eq" | "contains";
  value: unknown;
}

export interface ListEntitiesOptions {
  genus_id?: string;
  status?: string;
  limit?: number;
  offset?: number;
  workspace_id?: string;
  all_workspaces?: boolean;
  only_workspace?: boolean;
  attribute_filters?: AttributeFilter[];
}

export interface DefineFeatureGenusOptions {
  parent_genus_name: string;
  attributes?: (Omit<GenusAttributeDef, "required" | "default_value"> & { required?: boolean; default_value?: unknown })[];
  states?: GenusStateDef[];
  transitions?: GenusTransitionDef[];
  editable_parent_statuses?: string[];
  meta?: Record<string, unknown>;
  taxonomy_id?: string;
}

export interface FeatureGenusSummary {
  id: string;
  name: string;
  parent_genus_name: string;
  def: GenusDef;
}

export function listGenera(kernel: Kernel, opts?: { taxonomy_id?: string; include_deprecated?: boolean }): GenusSummary[] {
  const rows = kernel.db.query(
    "SELECT id FROM res WHERE genus_id = ? AND id != ? AND id != ? AND id != ? AND id != ? AND id != ? AND id != ? AND id != ? AND id != ? AND id != ? AND id != ? AND id != ? AND id != ? ORDER BY created_at ASC",
  ).all(META_GENUS_ID, META_GENUS_ID, LOG_GENUS_ID, ERROR_GENUS_ID, TASK_GENUS_ID, BRANCH_GENUS_ID, TAXONOMY_GENUS_ID, CRON_SCHEDULE_GENUS_ID, WORKSPACE_GENUS_ID, SCIENCE_GENUS_ID, PALACE_ROOM_GENUS_ID, PALACE_SCROLL_GENUS_ID, PALACE_NPC_GENUS_ID) as { id: string }[];

  return rows.map((row) => {
    const def = getGenusDef(kernel, row.id);
    return { id: row.id, name: (def.meta.name as string) ?? "", def };
  }).filter((g) => {
    if (g.def.meta.kind === "action" || g.def.meta.kind === "feature" || g.def.meta.kind === "relationship" || g.def.meta.kind === "process" || g.def.meta.kind === "serialization") return false;
    if (opts?.taxonomy_id && (g.def.meta.taxonomy_id ?? DEFAULT_TAXONOMY_ID) !== opts.taxonomy_id) return false;
    if (!opts?.include_deprecated && g.def.meta.deprecated === true) return false;
    return true;
  });
}

export function listEntities(kernel: Kernel, opts: ListEntitiesOptions = {}): EntitySummary[] {
  let sql = "SELECT id, genus_id, created_at FROM res WHERE genus_id != ? AND genus_id != ? AND genus_id != ? AND genus_id != ? AND genus_id != ? AND genus_id != ? AND genus_id != ? AND genus_id != ? AND genus_id != ?";
  const params: any[] = [META_GENUS_ID, BRANCH_GENUS_ID, TAXONOMY_GENUS_ID, CRON_SCHEDULE_GENUS_ID, WORKSPACE_GENUS_ID, SCIENCE_GENUS_ID, PALACE_ROOM_GENUS_ID, PALACE_SCROLL_GENUS_ID, PALACE_NPC_GENUS_ID];

  if (opts.genus_id) {
    sql += " AND genus_id = ?";
    params.push(opts.genus_id);
  }

  // Workspace filtering
  if (!opts.all_workspaces) {
    const effectiveWorkspace = opts.workspace_id ?? kernel.currentWorkspace;
    if (effectiveWorkspace) {
      if (opts.only_workspace) {
        sql += " AND workspace_id = ?";
      } else {
        sql += " AND (workspace_id = ? OR workspace_id IS NULL)";
      }
      params.push(effectiveWorkspace);
    }
  }

  sql += " ORDER BY created_at ASC";

  if (opts.limit !== undefined) {
    sql += " LIMIT ?";
    params.push(opts.limit);
  }

  if (opts.offset !== undefined) {
    sql += " OFFSET ?";
    params.push(opts.offset);
  }

  const rows = kernel.db.query(sql).all(...params) as { id: string; genus_id: string; created_at: string }[];

  return rows.map((row) => {
    const state = materialize(kernel, row.id, { branch_id: kernel.currentBranch });
    return { id: row.id, genus_id: row.genus_id, created_at: row.created_at, state };
  }).filter((e) => {
    if (opts.status && e.state.status !== opts.status) return false;
    if (opts.attribute_filters) {
      for (const filter of opts.attribute_filters) {
        const attrValue = e.state[filter.key];
        if (filter.op === "eq") {
          if (attrValue !== filter.value) return false;
        } else if (filter.op === "contains") {
          if (typeof attrValue !== "string" || typeof filter.value !== "string") return false;
          if (!attrValue.toLowerCase().includes(filter.value.toLowerCase())) return false;
        }
      }
    }
    return true;
  });
}

export interface SearchEntitiesOptions {
  query: string;
  genus_id?: string;
  limit?: number;
  workspace_id?: string;
  all_workspaces?: boolean;
}

export interface SearchResult {
  id: string;
  genus_id: string;
  genus_name: string;
  created_at: string;
  state: Record<string, unknown>;
  matched_attributes: string[];
}

const _SEARCH_SKIP_KEYS = new Set(["status", "features", "members"]);

export function searchEntities(
  kernel: Kernel,
  opts: SearchEntitiesOptions,
): SearchResult[] {
  const entities = listEntities(kernel, {
    genus_id: opts.genus_id,
    workspace_id: opts.workspace_id,
    all_workspaces: opts.all_workspaces,
  });

  const queryLower = opts.query.toLowerCase();
  const results: SearchResult[] = [];

  for (const entity of entities) {
    const matched: string[] = [];
    for (const [key, value] of Object.entries(entity.state)) {
      if (_SEARCH_SKIP_KEYS.has(key)) continue;
      if (typeof value === "string" && value.toLowerCase().includes(queryLower)) {
        matched.push(key);
      }
    }
    if (matched.length > 0) {
      const genusDef = getGenusDef(kernel, entity.genus_id);
      results.push({
        id: entity.id,
        genus_id: entity.genus_id,
        genus_name: (genusDef.meta.name as string) ?? "",
        created_at: entity.created_at,
        state: entity.state,
        matched_attributes: matched,
      });
      if (opts.limit !== undefined && results.length >= opts.limit) break;
    }
  }

  return results;
}

export function findGenusByName(kernel: Kernel, name: string): string | null {
  const rows = kernel.db.query(
    "SELECT id FROM res WHERE genus_id = ? ORDER BY created_at ASC",
  ).all(META_GENUS_ID) as { id: string }[];
  const lower = name.toLowerCase();
  for (const row of rows) {
    const def = getGenusDef(kernel, row.id);
    if (((def.meta.name as string) ?? "").toLowerCase() === lower) {
      return row.id;
    }
  }
  return null;
}

// --- Taxonomy functions ---

export function createTaxonomy(kernel: Kernel, name: string, description?: string, science_id?: string): string {
  const id = createEntity(kernel, TAXONOMY_GENUS_ID);
  setAttribute(kernel, id, "name", name);
  if (description) {
    setAttribute(kernel, id, "description", description);
  }
  setAttribute(kernel, id, "science_id", science_id ?? DEFAULT_SCIENCE_ID);
  return id;
}

export function listTaxonomies(kernel: Kernel): TaxonomySummary[] {
  const rows = kernel.db.query(
    "SELECT id FROM res WHERE genus_id = ? ORDER BY created_at ASC",
  ).all(TAXONOMY_GENUS_ID) as { id: string }[];

  return rows.map((row) => {
    const state = materialize(kernel, row.id);
    return {
      id: row.id,
      name: (state.name as string) ?? "",
      description: (state.description as string) ?? "",
      status: (state.status as string) ?? "",
    };
  });
}

export function findTaxonomyByName(kernel: Kernel, name: string): string | null {
  const taxonomies = listTaxonomies(kernel);
  const lower = name.toLowerCase();
  const match = taxonomies.find((d) => d.name.toLowerCase() === lower);
  return match ? match.id : null;
}

export function describeTaxonomy(kernel: Kernel, taxonomy_id: string): TaxonomyDescription {
  const state = materialize(kernel, taxonomy_id);

  const entityGenera = listGenera(kernel, { taxonomy_id }).map((g) => ({
    id: g.id,
    name: g.name,
    entity_count: listEntities(kernel, { genus_id: g.id }).length,
    def: g.def,
  }));

  const featureGenera = listFeatureGenera(kernel, { taxonomy_id }).map((g) => ({
    id: g.id,
    name: g.name,
    parent_genus_name: g.parent_genus_name,
    def: g.def,
  }));

  const relationshipGenera = listRelationshipGenera(kernel, { taxonomy_id }).map((g) => ({
    id: g.id,
    name: g.name,
    def: g.def,
  }));

  const actionGenera = listActionGenera(kernel, { taxonomy_id }).map((g) => ({
    id: g.id,
    name: g.name,
    def: g.def,
  }));

  const processGenera = listProcessGenera(kernel, { taxonomy_id }).map((g) => ({
    id: g.id,
    name: g.name,
    def: g.def,
  }));

  const serializationGenera = listSerializationGenera(kernel, { taxonomy_id }).map((g) => ({
    id: g.id,
    name: g.name,
    def: g.def,
  }));

  return {
    id: taxonomy_id,
    name: (state.name as string) ?? "",
    description: (state.description as string) ?? "",
    status: (state.status as string) ?? "",
    entity_genera: entityGenera,
    feature_genera: featureGenera,
    relationship_genera: relationshipGenera,
    action_genera: actionGenera,
    process_genera: processGenera,
    serialization_genera: serializationGenera,
  };
}

// --- Science functions ---

export function createScience(kernel: Kernel, name: string, description?: string): string {
  const id = createEntity(kernel, SCIENCE_GENUS_ID);
  setAttribute(kernel, id, "name", name);
  if (description) {
    setAttribute(kernel, id, "description", description);
  }
  return id;
}

export function listSciences(kernel: Kernel): ScienceSummary[] {
  const rows = kernel.db.query(
    "SELECT id FROM res WHERE genus_id = ? ORDER BY created_at ASC",
  ).all(SCIENCE_GENUS_ID) as { id: string }[];

  return rows.map((row) => {
    const state = materialize(kernel, row.id);
    return {
      id: row.id,
      name: (state.name as string) ?? "",
      description: (state.description as string) ?? "",
      status: (state.status as string) ?? "",
    };
  });
}

export function findScienceByName(kernel: Kernel, name: string): string | null {
  const sciences = listSciences(kernel);
  const lower = name.toLowerCase();
  const match = sciences.find((s) => s.name.toLowerCase() === lower);
  return match ? match.id : null;
}

export function describeScience(kernel: Kernel, science_id: string): ScienceDescription {
  const state = materialize(kernel, science_id);
  const allTaxonomies = listTaxonomies(kernel);
  const taxonomies: (TaxonomySummary & { shared?: boolean })[] = [];
  for (const t of allTaxonomies) {
    const tState = materialize(kernel, t.id);
    if ((tState.science_id as string ?? DEFAULT_SCIENCE_ID) === science_id) {
      taxonomies.push(t);
    } else if (tState.shared_science_ids) {
      let shared: string[] = [];
      try { shared = JSON.parse(tState.shared_science_ids as string); } catch {}
      if (shared.includes(science_id)) {
        taxonomies.push({ ...t, shared: true });
      }
    }
  }

  return {
    id: science_id,
    name: (state.name as string) ?? "",
    description: (state.description as string) ?? "",
    status: (state.status as string) ?? "",
    taxonomies,
  };
}

function _checkScienceNotArchived(kernel: Kernel, science_id: string): void {
  const state = materialize(kernel, science_id);
  if (state.status === "archived") {
    throw new Error(`Science "${state.name}" is archived`);
  }
}

// --- Workspace functions ---

export interface WorkspaceSummary {
  id: string;
  name: string;
  description: string | null;
  status: string;
  entity_count: number;
}

export function createWorkspace(kernel: Kernel, name: string, description?: string): string {
  const savedWorkspace = kernel.currentWorkspace;
  kernel.currentWorkspace = null;
  try {
    const id = createEntity(kernel, WORKSPACE_GENUS_ID);
    setAttribute(kernel, id, "name", name);
    if (description) {
      setAttribute(kernel, id, "description", description);
    }
    return id;
  } finally {
    kernel.currentWorkspace = savedWorkspace;
  }
}

export function listWorkspaces(kernel: Kernel): WorkspaceSummary[] {
  const rows = kernel.db.query(
    "SELECT id FROM res WHERE genus_id = ? ORDER BY created_at ASC",
  ).all(WORKSPACE_GENUS_ID) as { id: string }[];

  return rows.map((row) => {
    const state = materialize(kernel, row.id);
    const countRow = kernel.db.query(
      "SELECT COUNT(*) as cnt FROM res WHERE workspace_id = ?",
    ).get(row.id) as { cnt: number };
    return {
      id: row.id,
      name: (state.name as string) ?? "",
      description: (state.description as string) ?? null,
      status: (state.status as string) ?? "",
      entity_count: countRow.cnt,
    };
  });
}

export function findWorkspaceByName(kernel: Kernel, name: string): string | null {
  const workspaces = listWorkspaces(kernel);
  const lower = name.toLowerCase();
  const match = workspaces.find((w) => w.name.toLowerCase() === lower);
  return match ? match.id : null;
}

export function switchWorkspace(kernel: Kernel, workspace_id: string | null): void {
  kernel.currentWorkspace = workspace_id;
}

export function assignWorkspace(kernel: Kernel, entity_id: string, workspace_id: string): void {
  const res = kernel.db.query("SELECT id FROM res WHERE id = ?").get(entity_id) as any;
  if (!res) throw new Error(`Entity not found: ${entity_id}`);
  kernel.db.run("UPDATE res SET workspace_id = ? WHERE id = ?", [workspace_id, entity_id]);
}

export function assignWorkspaceByGenus(kernel: Kernel, genus_id: string, workspace_id: string, opts?: { unassigned_only?: boolean }): number {
  if (opts?.unassigned_only) {
    const result = kernel.db.run(
      "UPDATE res SET workspace_id = ? WHERE genus_id = ? AND workspace_id IS NULL",
      [workspace_id, genus_id],
    );
    return result.changes;
  }
  const result = kernel.db.run(
    "UPDATE res SET workspace_id = ? WHERE genus_id = ? AND (workspace_id IS NULL OR workspace_id != ?)",
    [workspace_id, genus_id, workspace_id],
  );
  return result.changes;
}

export function assignWorkspaceByTaxonomy(kernel: Kernel, taxonomy_id: string, workspace_id: string, opts?: { unassigned_only?: boolean }): number {
  const genera = listGenera(kernel, { taxonomy_id });
  let total = 0;
  for (const g of genera) {
    total += assignWorkspaceByGenus(kernel, g.id, workspace_id, opts);
  }
  return total;
}

export function deleteWorkspace(kernel: Kernel, workspace_id: string): void {
  const res = getRes(kernel, workspace_id);
  if (res.genus_id !== WORKSPACE_GENUS_ID) throw new Error(`"${workspace_id}" is not a workspace`);
  const count = (kernel.db.query("SELECT COUNT(*) as cnt FROM res WHERE workspace_id = ?")
    .get(workspace_id) as { cnt: number }).cnt;
  if (count > 0) throw new Error("Workspace is not empty — reassign or delete entities first");
  kernel.db.run("DELETE FROM tessella WHERE res_id = ?", [workspace_id]);
  kernel.db.run("DELETE FROM res WHERE id = ?", [workspace_id]);
  if (kernel.currentWorkspace === workspace_id) kernel.currentWorkspace = null;
}

export function mergeWorkspaces(kernel: Kernel, source_id: string, target_id: string): number {
  const srcRes = getRes(kernel, source_id);
  if (srcRes.genus_id !== WORKSPACE_GENUS_ID) throw new Error("Source is not a workspace");
  const tgtRes = getRes(kernel, target_id);
  if (tgtRes.genus_id !== WORKSPACE_GENUS_ID) throw new Error("Target is not a workspace");
  const result = kernel.db.run(
    "UPDATE res SET workspace_id = ? WHERE workspace_id = ?",
    [target_id, source_id],
  );
  deleteWorkspace(kernel, source_id);
  return result.changes;
}

export function backfillRelationshipWorkspaces(kernel: Kernel): { assigned: number; skipped: number; conflicts: string[] } {
  // Find all relationships with no workspace
  const rels = kernel.db.query(
    "SELECT r.id FROM res r INNER JOIN res g ON r.genus_id = g.id WHERE r.workspace_id IS NULL AND r.genus_id != ? AND r.genus_id != ? AND r.genus_id != ? AND r.genus_id != ? AND r.genus_id != ? AND r.genus_id != ? AND r.genus_id != ? AND r.genus_id != ? AND r.genus_id != ?",
  ).all(META_GENUS_ID, BRANCH_GENUS_ID, TAXONOMY_GENUS_ID, CRON_SCHEDULE_GENUS_ID, WORKSPACE_GENUS_ID, SCIENCE_GENUS_ID, PALACE_ROOM_GENUS_ID, PALACE_SCROLL_GENUS_ID, PALACE_NPC_GENUS_ID) as { id: string }[];

  let assigned = 0;
  let skipped = 0;
  const conflicts: string[] = [];

  for (const rel of rels) {
    // Check if this is actually a relationship by looking for members
    const members = kernel.db.query(
      "SELECT DISTINCT entity_id FROM relationship_member WHERE relationship_id = ? AND branch_id = 'main'",
    ).all(rel.id) as { entity_id: string }[];

    if (members.length === 0) continue; // not a relationship or no members

    // Collect workspaces from member entities
    const workspaces = new Set<string>();
    for (const m of members) {
      const row = kernel.db.query("SELECT workspace_id FROM res WHERE id = ?").get(m.entity_id) as any;
      if (row?.workspace_id) workspaces.add(row.workspace_id);
    }

    if (workspaces.size === 1) {
      const wsId = [...workspaces][0];
      kernel.db.run("UPDATE res SET workspace_id = ? WHERE id = ?", [wsId, rel.id]);
      assigned++;
    } else if (workspaces.size > 1) {
      conflicts.push(rel.id);
      skipped++;
    } else {
      skipped++; // all members unassigned too
    }
  }

  return { assigned, skipped, conflicts };
}

export function inferWorkspaceSciences(kernel: Kernel): { workspace: string; sciences: string[] }[] {
  const workspaces = listWorkspaces(kernel);
  const results: { workspace: string; sciences: string[] }[] = [];

  for (const ws of workspaces) {
    // Skip workspaces that already have sciences linked
    const existing = getWorkspaceScienceIds(kernel, ws.id);
    if (existing.length > 0) continue;

    // Find all genera that have entities in this workspace
    const genusRows = kernel.db.query(
      "SELECT DISTINCT genus_id FROM res WHERE workspace_id = ?",
    ).all(ws.id) as { genus_id: string }[];

    // Walk genus → taxonomy → science
    const scienceIds = new Set<string>();
    for (const row of genusRows) {
      // Skip system genera
      if ([META_GENUS_ID, BRANCH_GENUS_ID, TAXONOMY_GENUS_ID, CRON_SCHEDULE_GENUS_ID, WORKSPACE_GENUS_ID, SCIENCE_GENUS_ID, LOG_GENUS_ID, ERROR_GENUS_ID, TASK_GENUS_ID, PALACE_ROOM_GENUS_ID, PALACE_SCROLL_GENUS_ID, PALACE_NPC_GENUS_ID].includes(row.genus_id)) continue;
      try {
        const genusDef = getGenusDef(kernel, row.genus_id);
        const taxonomyId = (genusDef.meta.taxonomy_id as string) ?? DEFAULT_TAXONOMY_ID;
        const taxState = materialize(kernel, taxonomyId);
        const scienceId = (taxState.science_id as string) ?? DEFAULT_SCIENCE_ID;
        if (scienceId !== DEFAULT_SCIENCE_ID) {
          scienceIds.add(scienceId);
        }
      } catch { /* skip if genus/taxonomy missing */ }
    }

    if (scienceIds.size > 0) {
      for (const sid of scienceIds) {
        addWorkspaceScience(kernel, ws.id, sid);
      }
      results.push({ workspace: ws.name, sciences: [...scienceIds] });
    }
  }

  return results;
}

export function getWorkspaceScienceIds(kernel: Kernel, workspace_id: string): string[] {
  const state = materialize(kernel, workspace_id);
  if (!state.science_ids) return [];
  try { return JSON.parse(state.science_ids as string); } catch { return []; }
}

export function addWorkspaceScience(kernel: Kernel, workspace_id: string, science_id: string): void {
  const res = getRes(kernel, workspace_id);
  if (res.genus_id !== WORKSPACE_GENUS_ID) throw new Error(`"${workspace_id}" is not a workspace`);
  getRes(kernel, science_id); // validate exists
  const ids = getWorkspaceScienceIds(kernel, workspace_id);
  if (ids.includes(science_id)) return;
  ids.push(science_id);
  appendTessella(kernel, workspace_id, "attribute_set", { key: "science_ids", value: JSON.stringify(ids) });
}

export function removeWorkspaceScience(kernel: Kernel, workspace_id: string, science_id: string): void {
  const res = getRes(kernel, workspace_id);
  if (res.genus_id !== WORKSPACE_GENUS_ID) throw new Error(`"${workspace_id}" is not a workspace`);
  const ids = getWorkspaceScienceIds(kernel, workspace_id).filter((id) => id !== science_id);
  appendTessella(kernel, workspace_id, "attribute_set", { key: "science_ids", value: JSON.stringify(ids) });
}

export function getWorkspaceTaxonomyIds(kernel: Kernel, workspace_id: string): string[] {
  const scienceIds = getWorkspaceScienceIds(kernel, workspace_id);
  if (scienceIds.length === 0) return [];
  const allTaxonomies = listTaxonomies(kernel);
  const taxIds = new Set<string>();
  for (const t of allTaxonomies) {
    const tState = materialize(kernel, t.id);
    const primaryScience = (tState.science_id as string) ?? DEFAULT_SCIENCE_ID;
    if (scienceIds.includes(primaryScience)) {
      taxIds.add(t.id);
    } else if (tState.shared_science_ids) {
      let shared: string[] = [];
      try { shared = JSON.parse(tState.shared_science_ids as string); } catch {}
      if (shared.some((sid) => scienceIds.includes(sid))) {
        taxIds.add(t.id);
      }
    }
  }
  return [...taxIds];
}

export function moveTaxonomy(kernel: Kernel, taxonomy_id: string, target_science_id: string): void {
  const res = getRes(kernel, taxonomy_id);
  if (res.genus_id !== TAXONOMY_GENUS_ID) throw new Error(`"${taxonomy_id}" is not a taxonomy`);
  _checkScienceNotArchived(kernel, target_science_id);
  setAttribute(kernel, taxonomy_id, "science_id", target_science_id);
}

export function shareTaxonomy(kernel: Kernel, taxonomy_id: string, science_id: string): void {
  const res = getRes(kernel, taxonomy_id);
  if (res.genus_id !== TAXONOMY_GENUS_ID) throw new Error(`"${taxonomy_id}" is not a taxonomy`);
  _checkScienceNotArchived(kernel, science_id);
  const state = materialize(kernel, taxonomy_id);
  if ((state.science_id as string) === science_id) {
    throw new Error("Cannot share with the taxonomy's own science — it already belongs there");
  }
  let shared: string[] = [];
  if (state.shared_science_ids) {
    try { shared = JSON.parse(state.shared_science_ids as string); } catch {}
  }
  if (shared.includes(science_id)) return; // already shared
  shared.push(science_id);
  setAttribute(kernel, taxonomy_id, "shared_science_ids", JSON.stringify(shared));
}

export function unshareTaxonomy(kernel: Kernel, taxonomy_id: string, science_id: string): void {
  const res = getRes(kernel, taxonomy_id);
  if (res.genus_id !== TAXONOMY_GENUS_ID) throw new Error(`"${taxonomy_id}" is not a taxonomy`);
  const state = materialize(kernel, taxonomy_id);
  let shared: string[] = [];
  if (state.shared_science_ids) {
    try { shared = JSON.parse(state.shared_science_ids as string); } catch {}
  }
  shared = shared.filter((id) => id !== science_id);
  setAttribute(kernel, taxonomy_id, "shared_science_ids", JSON.stringify(shared));
}

export function moveGenus(kernel: Kernel, genus_id: string, target_taxonomy_id: string): void {
  getGenusDef(kernel, genus_id);
  _checkTaxonomyNotArchived(kernel, target_taxonomy_id);
  appendTessella(kernel, genus_id, "genus_meta_set", { key: "taxonomy_id", value: target_taxonomy_id });
}

// --- Feature functions ---

function _checkTaxonomyNotArchived(kernel: Kernel, taxonomy_id: string): void {
  const state = materialize(kernel, taxonomy_id);
  if (state.status === "archived") {
    throw new Error(`Taxonomy "${state.name}" is archived`);
  }
}

function _checkFeatureEditable(kernel: Kernel, parent_res_id: string, feature_genus_id: string): void {
  const featureDef = getGenusDef(kernel, feature_genus_id);
  const editableStatuses = featureDef.meta.editable_parent_statuses as string[] | undefined;
  if (!editableStatuses || editableStatuses.length === 0) return;

  const parentState = materialize(kernel, parent_res_id);
  const parentStatus = parentState.status as string | undefined;
  if (!parentStatus || !editableStatuses.includes(parentStatus)) {
    throw new Error(
      `Feature not editable: parent status "${parentStatus}" is not in [${editableStatuses.join(", ")}]`,
    );
  }
}

export function defineFeatureGenus(
  kernel: Kernel,
  name: string,
  opts: DefineFeatureGenusOptions,
): string {
  const effectiveOntologyId = opts.taxonomy_id ?? DEFAULT_TAXONOMY_ID;
  _checkTaxonomyNotArchived(kernel, effectiveOntologyId);

  const genusId = createRes(kernel, META_GENUS_ID);
  appendTessella(kernel, genusId, "genus_meta_set", { key: "name", value: name });
  appendTessella(kernel, genusId, "genus_meta_set", { key: "kind", value: "feature" });
  appendTessella(kernel, genusId, "genus_meta_set", { key: "parent_genus_name", value: opts.parent_genus_name });
  appendTessella(kernel, genusId, "genus_meta_set", { key: "taxonomy_id", value: effectiveOntologyId });

  if (opts.editable_parent_statuses) {
    appendTessella(kernel, genusId, "genus_meta_set", { key: "editable_parent_statuses", value: opts.editable_parent_statuses });
  }

  if (opts.attributes) {
    for (const attr of opts.attributes) {
      appendTessella(kernel, genusId, "genus_attribute_defined", {
        name: attr.name,
        type: attr.type,
        required: attr.required ?? false,
        ...(attr.default_value !== undefined ? { default_value: attr.default_value } : {}),
      });
    }
  }

  if (opts.states) {
    for (const st of opts.states) {
      appendTessella(kernel, genusId, "genus_state_defined", st);
    }
  }

  if (opts.transitions) {
    for (const tr of opts.transitions) {
      appendTessella(kernel, genusId, "genus_transition_defined", tr);
    }
  }

  if (opts.meta) {
    for (const [key, value] of Object.entries(opts.meta)) {
      appendTessella(kernel, genusId, "genus_meta_set", { key, value });
    }
  }

  return genusId;
}

export function createFeature(
  kernel: Kernel,
  parent_res_id: string,
  feature_genus_id: string,
  opts?: { attributes?: Record<string, unknown>; branch_id?: string },
): string {
  const branch_id = opts?.branch_id ?? kernel.currentBranch;

  // Validate parent res exists and get its genus
  const parentRes = getRes(kernel, parent_res_id);
  const parentDef = getGenusDef(kernel, parentRes.genus_id);
  const parentGenusName = (parentDef.meta.name as string) ?? "";

  // Validate feature genus exists and is a feature
  const featureDef = getGenusDef(kernel, feature_genus_id);
  if (featureDef.meta.kind !== "feature") {
    throw new Error(`Genus "${feature_genus_id}" is not a feature genus`);
  }

  // Validate parent genus matches
  const expectedParent = featureDef.meta.parent_genus_name as string;
  if (expectedParent.toLowerCase() !== parentGenusName.toLowerCase()) {
    throw new Error(
      `Feature genus expects parent "${expectedParent}", got "${parentGenusName}"`,
    );
  }

  // Validate all attributes upfront before appending any tessellae
  if (opts?.attributes) {
    for (const [key, value] of Object.entries(opts.attributes)) {
      const attrDef = featureDef.attributes[key];
      if (!attrDef) {
        throw new Error(`Attribute "${key}" is not defined on feature genus "${featureDef.meta.name}". Valid attributes: ${Object.keys(featureDef.attributes).join(", ") || "(none)"}`);
      }
      if (!_validateAttributeType(value, attrDef.type)) {
        throw new Error(`Type mismatch for attribute "${key}": expected ${attrDef.type}, got ${typeof value}`);
      }
    }
  }

  // Generate feature_id
  const feature_id = ulid();

  // Append feature_created
  appendTessella(kernel, parent_res_id, "feature_created", {
    feature_id,
    feature_genus_id,
  }, { branch_id });

  // Set initial status if genus has one
  if (featureDef.initialState) {
    appendTessella(kernel, parent_res_id, "feature_status_changed", {
      feature_id,
      status: featureDef.initialState,
    }, { branch_id });
  }

  // Append validated attributes
  if (opts?.attributes) {
    for (const [key, value] of Object.entries(opts.attributes)) {
      appendTessella(kernel, parent_res_id, "feature_attribute_set", {
        feature_id,
        key,
        value,
      }, { branch_id });
    }
  }

  return feature_id;
}

export function setFeatureAttribute(
  kernel: Kernel,
  parent_res_id: string,
  feature_id: string,
  key: string,
  value: unknown,
  opts: AppendOptions = {},
): Tessella {
  const effectiveBranch = opts.branch_id ?? kernel.currentBranch;
  // Validate parent res exists
  getRes(kernel, parent_res_id);

  // Materialize parent to verify feature exists
  const parentState = materialize(kernel, parent_res_id, { branch_id: effectiveBranch });
  const features = parentState.features as Record<string, Record<string, unknown>> | undefined;
  if (!features || !features[feature_id]) {
    throw new Error(`Feature not found: ${feature_id}`);
  }

  const featureState = features[feature_id];
  const feature_genus_id = featureState.genus_id as string;

  // Check parent status constraint
  _checkFeatureEditable(kernel, parent_res_id, feature_genus_id);

  // Validate attribute against feature genus
  const featureDef = getGenusDef(kernel, feature_genus_id);
  const attrDef = featureDef.attributes[key];
  if (!attrDef) {
    throw new Error(`Attribute "${key}" is not defined on feature genus "${featureDef.meta.name}". Valid attributes: ${Object.keys(featureDef.attributes).join(", ") || "(none)"}`);
  }
  if (!_validateAttributeType(value, attrDef.type)) {
    throw new Error(`Type mismatch for attribute "${key}": expected ${attrDef.type}, got ${typeof value}`);
  }

  return appendTessella(kernel, parent_res_id, "feature_attribute_set", {
    feature_id,
    key,
    value,
  }, { ...opts, branch_id: effectiveBranch });
}

export function transitionFeatureStatus(
  kernel: Kernel,
  parent_res_id: string,
  feature_id: string,
  target_status: string,
  opts: AppendOptions = {},
): Tessella {
  const effectiveBranch = opts.branch_id ?? kernel.currentBranch;
  // Validate parent res exists
  getRes(kernel, parent_res_id);

  // Materialize parent to verify feature exists
  const parentState = materialize(kernel, parent_res_id, { branch_id: effectiveBranch });
  const features = parentState.features as Record<string, Record<string, unknown>> | undefined;
  if (!features || !features[feature_id]) {
    throw new Error(`Feature not found: ${feature_id}`);
  }

  const featureState = features[feature_id];
  const feature_genus_id = featureState.genus_id as string;

  // Check parent status constraint
  _checkFeatureEditable(kernel, parent_res_id, feature_genus_id);

  // Validate transition against feature genus
  const featureDef = getGenusDef(kernel, feature_genus_id);

  if (!featureDef.states[target_status]) {
    throw new Error(`State "${target_status}" is not defined on feature genus "${featureDef.meta.name}". Valid states: ${Object.keys(featureDef.states).join(", ") || "(none)"}`);
  }

  const currentStatus = featureState.status as string | undefined;
  if (!currentStatus) {
    throw new Error(`Feature "${feature_id}" has no current status`);
  }

  const valid = featureDef.transitions.some(
    (t) => t.from === currentStatus && t.to === target_status,
  );
  if (!valid) {
    const validTargets = featureDef.transitions.filter(t => t.from === currentStatus).map(t => t.to);
    throw new Error(
      `No valid transition from "${currentStatus}" to "${target_status}". Valid transitions from "${currentStatus}": ${validTargets.length > 0 ? validTargets.join(", ") : "(none)"}`,
    );
  }

  return appendTessella(kernel, parent_res_id, "feature_status_changed", {
    feature_id,
    status: target_status,
  }, { ...opts, branch_id: effectiveBranch });
}

export function listFeatureGenera(kernel: Kernel, opts?: { taxonomy_id?: string }): FeatureGenusSummary[] {
  const rows = kernel.db.query(
    "SELECT id FROM res WHERE genus_id = ? AND id != ? AND id != ? ORDER BY created_at ASC",
  ).all(META_GENUS_ID, META_GENUS_ID, LOG_GENUS_ID) as { id: string }[];

  const results: FeatureGenusSummary[] = [];
  for (const row of rows) {
    const def = getGenusDef(kernel, row.id);
    if (def.meta.kind === "feature") {
      if (opts?.taxonomy_id && (def.meta.taxonomy_id ?? DEFAULT_TAXONOMY_ID) !== opts.taxonomy_id) continue;
      results.push({
        id: row.id,
        name: (def.meta.name as string) ?? "",
        parent_genus_name: (def.meta.parent_genus_name as string) ?? "",
        def,
      });
    }
  }
  return results;
}

export function findFeatureGenusByName(kernel: Kernel, name: string): string | null {
  const genera = listFeatureGenera(kernel);
  const lower = name.toLowerCase();
  const match = genera.find((g) => g.name.toLowerCase() === lower);
  return match ? match.id : null;
}

export function getFeatureGenusForEntityGenus(kernel: Kernel, entity_genus_name: string): FeatureGenusSummary[] {
  const genera = listFeatureGenera(kernel);
  const lower = entity_genus_name.toLowerCase();
  return genera.filter((g) => g.parent_genus_name.toLowerCase() === lower);
}

// ============================================================================
// SECTION: Actions
// ============================================================================
//
// Summary:
//   Declarative business logic defined as genus-like schemas. Actions specify
//   preconditions (required resource statuses), parameters, and a handler of
//   side effects. executeAction validates, runs effects atomically, and logs.
//
// Usage:
//   const deployId = defineActionGenus(kernel, "deploy", {
//     resources: [{ name: "server", genus_name: "Server", required_status: "active" }],
//     parameters: [{ name: "version", type: "text", required: true }],
//     handler: [
//       { type: "set_attribute", res: "$res.server.id", key: "version", value: "$param.version" },
//       { type: "transition_status", res: "$res.server.id", target: "deployed" },
//     ],
//   });
//   const result = executeAction(kernel, deployId, { server: entityId }, { version: "2.0" });
//
// Design notes:
//   - Action genera are res under META_GENUS_ID with meta.kind = "action".
//   - Handler substitution supports $param.X, $res.X.id, and $now tokens.
//   - Side effects execute in a single SQLite transaction for atomicity.
//   - executeAction never throws; returns { error } on failure.
//

// --- Types ---

export interface ActionResourceDef {
  name: string;
  genus_name: string;
  required_status?: string;
}

export interface ActionParameterDef {
  name: string;
  type: GenusAttributeType;
  required: boolean;
}

export interface SideEffect {
  type: "set_attribute" | "transition_status" | "create_res" | "create_log" | "create_error" | "create_task";
  [key: string]: unknown;
}

export interface ActionDef {
  resources: Record<string, ActionResourceDef>;
  parameters: Record<string, ActionParameterDef>;
  handler: SideEffect[];
  meta: Record<string, unknown>;
}

export interface DefineActionGenusOptions {
  resources?: ActionResourceDef[];
  parameters?: ActionParameterDef[];
  handler?: SideEffect[];
  meta?: Record<string, unknown>;
  taxonomy_id?: string;
}

export interface Input {
  id: string;
  type: string;
  source: string;
  data: any;
  created_at: string;
  branch_id: string;
}

export interface ActionTaken {
  id: string;
  action_genus_id: string;
  input_id: string;
  resources: Record<string, string>;
  params: Record<string, unknown>;
  tessellae_ids: number[];
  created_at: string;
  branch_id: string;
}

export interface ExecuteActionResult {
  action_taken?: ActionTaken;
  tessellae?: Tessella[];
  error?: string;
}

export interface HistoryEntry {
  tessella: Tessella;
  action_taken?: ActionTaken;
}

export interface ActionGenusSummary {
  id: string;
  name: string;
  def: ActionDef;
}

// --- Core functions ---

export function actionReducer(state: Record<string, unknown>, tessella: Tessella): Record<string, unknown> {
  switch (tessella.type) {
    case "created":
      return { resources: {}, parameters: {}, handler: [], meta: {} };
    case "action_resource_defined": {
      const def = tessella.data as ActionResourceDef;
      const resources = { ...(state.resources as Record<string, ActionResourceDef>), [def.name]: def };
      return { ...state, resources };
    }
    case "action_parameter_defined": {
      const def = tessella.data as ActionParameterDef;
      const parameters = { ...(state.parameters as Record<string, ActionParameterDef>), [def.name]: def };
      return { ...state, parameters };
    }
    case "action_handler_defined": {
      const { handler } = tessella.data as { handler: SideEffect[] };
      return { ...state, handler };
    }
    case "genus_meta_set": {
      let { key, value } = tessella.data as { key: string; value: unknown };
      if (key === "domain_id" || key === "ontology_id") key = "taxonomy_id"; // backwards compat
      const meta = { ...(state.meta as Record<string, unknown>), [key]: value };
      return { ...state, meta };
    }
    default:
      return state;
  }
}

export function getActionDef(kernel: Kernel, action_genus_id: string): ActionDef {
  const raw = materialize(kernel, action_genus_id, { branch_id: "main", reducer: actionReducer });
  return {
    resources: (raw.resources as Record<string, ActionResourceDef>) ?? {},
    parameters: (raw.parameters as Record<string, ActionParameterDef>) ?? {},
    handler: (raw.handler as SideEffect[]) ?? [],
    meta: (raw.meta as Record<string, unknown>) ?? {},
  };
}

export function defineActionGenus(
  kernel: Kernel,
  name: string,
  opts: DefineActionGenusOptions = {},
): string {
  const effectiveOntologyId = opts.taxonomy_id ?? DEFAULT_TAXONOMY_ID;
  _checkTaxonomyNotArchived(kernel, effectiveOntologyId);

  const genusId = createRes(kernel, META_GENUS_ID);
  appendTessella(kernel, genusId, "genus_meta_set", { key: "name", value: name });
  appendTessella(kernel, genusId, "genus_meta_set", { key: "kind", value: "action" });
  appendTessella(kernel, genusId, "genus_meta_set", { key: "taxonomy_id", value: effectiveOntologyId });

  if (opts.resources) {
    for (const res of opts.resources) {
      appendTessella(kernel, genusId, "action_resource_defined", res);
    }
  }

  if (opts.parameters) {
    for (const param of opts.parameters) {
      appendTessella(kernel, genusId, "action_parameter_defined", param);
    }
  }

  if (opts.handler) {
    appendTessella(kernel, genusId, "action_handler_defined", { handler: opts.handler });
  }

  if (opts.meta) {
    for (const [key, value] of Object.entries(opts.meta)) {
      appendTessella(kernel, genusId, "genus_meta_set", { key, value });
    }
  }

  return genusId;
}

export function recordInput(
  kernel: Kernel,
  type: "push" | "pull",
  source: string,
  data: unknown,
  branch_id: string = "main",
): Input {
  const id = ulid();
  const row = kernel.db.query(
    "INSERT INTO input (id, type, source, data, branch_id) VALUES (?, ?, ?, ?, ?) RETURNING *",
  ).get(id, type, source, JSON.stringify(data), branch_id) as any;
  return { ...row, data: JSON.parse(row.data) };
}

// --- Internal helpers ---

function _substituteParams(
  value: unknown,
  context: { params: Record<string, unknown>; resources: Record<string, string>; now: string },
): unknown {
  if (typeof value === "string") {
    // Check if the entire string is a single token — preserve typed value
    const paramMatch = value.match(/^\$param\.(\w+)$/);
    if (paramMatch) return context.params[paramMatch[1]];

    const resMatch = value.match(/^\$res\.(\w+)\.id$/);
    if (resMatch) return context.resources[resMatch[1]];

    if (value === "$now") return context.now;

    // Embedded substitution — coerce to string
    return value
      .replace(/\$param\.(\w+)/g, (_, k) => String(context.params[k] ?? ""))
      .replace(/\$res\.(\w+)\.id/g, (_, k) => String(context.resources[k] ?? ""))
      .replace(/\$now/g, context.now);
  }

  if (Array.isArray(value)) {
    return value.map((v) => _substituteParams(v, context));
  }

  if (value !== null && typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      result[k] = _substituteParams(v, context);
    }
    return result;
  }

  return value;
}

function _executeSideEffects(
  kernel: Kernel,
  effects: SideEffect[],
  context: { params: Record<string, unknown>; resources: Record<string, string>; now: string },
): Tessella[] {
  const tessellae: Tessella[] = [];

  for (const effect of effects) {
    const substituted = _substituteParams(effect, context) as Record<string, unknown>;
    const type = substituted.type as string;

    switch (type) {
      case "set_attribute": {
        const t = setAttribute(kernel, substituted.res as string, substituted.key as string, substituted.value);
        tessellae.push(t);
        break;
      }
      case "transition_status": {
        const t = transitionStatus(kernel, substituted.res as string, substituted.target as string);
        tessellae.push(t);
        break;
      }
      case "create_res": {
        const genusName = substituted.genus_name as string;
        const genusId = findGenusByName(kernel, genusName);
        if (!genusId) throw new Error(`Genus not found: ${genusName}`);
        const entityId = createEntity(kernel, genusId);
        const attrs = (substituted.attributes ?? {}) as Record<string, unknown>;
        for (const [k, v] of Object.entries(attrs)) {
          const t = setAttribute(kernel, entityId, k, v);
          tessellae.push(t);
        }
        break;
      }
      case "create_log": {
        const entityId = createEntity(kernel, LOG_GENUS_ID);
        const msg = substituted.message as string;
        const severity = (substituted.severity as string) ?? "info";
        const associatedRes = substituted.res as string;
        tessellae.push(setAttribute(kernel, entityId, "message", msg));
        tessellae.push(setAttribute(kernel, entityId, "severity", severity));
        if (associatedRes) {
          tessellae.push(setAttribute(kernel, entityId, "associated_res_id", associatedRes));
        }
        break;
      }
      case "create_error": {
        const entityId = createEntity(kernel, ERROR_GENUS_ID);
        const msg = substituted.message as string;
        const severity = (substituted.severity as string) ?? "error";
        const associatedRes = substituted.res as string;
        tessellae.push(setAttribute(kernel, entityId, "message", msg));
        tessellae.push(setAttribute(kernel, entityId, "severity", severity));
        if (associatedRes) {
          tessellae.push(setAttribute(kernel, entityId, "associated_res_id", associatedRes));
        }
        break;
      }
      case "create_task": {
        const title = substituted.title as string;
        const taskOpts: CreateTaskOptions = {};
        if (substituted.description) taskOpts.description = substituted.description as string;
        if (substituted.res) taskOpts.associated_res_id = substituted.res as string;
        if (substituted.priority) taskOpts.priority = substituted.priority as string;
        if (substituted.target_agent_type) taskOpts.target_agent_type = substituted.target_agent_type as string;
        if (substituted.context_res_ids) taskOpts.context_res_ids = substituted.context_res_ids as string[];
        const taskId = createTask(kernel, title, taskOpts);
        // Push attribute tessellae as representative
        const taskTessellae = replay(kernel, taskId, { types: ["attribute_set"] });
        tessellae.push(...taskTessellae);
        break;
      }
      default:
        throw new Error(`Unknown side effect type: "${type}". Valid types: set_attribute, transition_status, create_res, create_log, create_error, create_task`);
    }
  }

  return tessellae;
}

// --- Orchestrator ---

export function executeAction(
  kernel: Kernel,
  action_genus_id: string,
  resource_bindings: Record<string, string>,
  params: Record<string, unknown>,
  opts: { source?: string; branch_id?: string } = {},
): ExecuteActionResult {
  const source = opts.source ?? "system";
  const branch_id = opts.branch_id ?? "main";

  try {
    // 1. Record push input
    const input = recordInput(kernel, "push", source, {
      action_genus_id,
      resource_bindings,
      params,
    }, branch_id);

    // 2. Load action def
    const actionDef = getActionDef(kernel, action_genus_id);

    // 3. Validate resource bindings
    for (const [name, resDef] of Object.entries(actionDef.resources)) {
      const resId = resource_bindings[name];
      if (!resId) {
        return { error: `Missing resource binding: ${name}` };
      }

      // Check res exists
      let resRow: any;
      try {
        resRow = getRes(kernel, resId);
      } catch {
        return { error: `Resource "${name}" not found: ${resId}` };
      }

      // Check genus matches
      const genusDef = getGenusDef(kernel, resRow.genus_id);
      const genusName = (genusDef.meta.name as string) ?? "";
      if (genusName.toLowerCase() !== resDef.genus_name.toLowerCase()) {
        return { error: `Resource "${name}" must be of genus "${resDef.genus_name}", got "${genusName}"` };
      }

      // Check required status
      if (resDef.required_status) {
        const state = materialize(kernel, resId, { branch_id });
        const currentStatus = state.status as string | undefined;
        if (currentStatus !== resDef.required_status) {
          return { error: `Resource "${name}" must be in status "${resDef.required_status}", currently "${currentStatus}"` };
        }
      }
    }

    // 4. Validate params
    for (const [name, paramDef] of Object.entries(actionDef.parameters)) {
      const value = params[name];
      if (paramDef.required && (value === undefined || value === null)) {
        return { error: `Missing required parameter: ${name}` };
      }
      if (value !== undefined && value !== null) {
        if (!_validateAttributeType(value, paramDef.type)) {
          return { error: `Parameter "${name}" type mismatch: expected ${paramDef.type}, got ${typeof value}` };
        }
      }
    }

    // 5. Build substitution context
    const now = new Date().toISOString();
    const context = { params, resources: resource_bindings, now };

    // 6. Execute side effects in transaction
    let tessellae: Tessella[] = [];
    const runEffects = kernel.db.transaction(() => {
      tessellae = _executeSideEffects(kernel, actionDef.handler, context);
    });
    runEffects();

    // 7. Record action_taken
    const actionTakenId = ulid();
    const tessellaeIds = tessellae.map((t) => t.id);
    kernel.db.run(
      "INSERT INTO action_taken (id, action_genus_id, input_id, resources, params, tessellae_ids, branch_id) VALUES (?, ?, ?, ?, ?, ?, ?)",
      [actionTakenId, action_genus_id, input.id, JSON.stringify(resource_bindings), JSON.stringify(params), JSON.stringify(tessellaeIds), branch_id],
    );

    const actionTaken: ActionTaken = {
      id: actionTakenId,
      action_genus_id,
      input_id: input.id,
      resources: resource_bindings,
      params,
      tessellae_ids: tessellaeIds,
      created_at: new Date().toISOString(),
      branch_id,
    };

    return { action_taken: actionTaken, tessellae };
  } catch (e: any) {
    return { error: e.message ?? String(e) };
  }
}

// --- Action query helpers ---

export function listActionGenera(kernel: Kernel, opts?: { taxonomy_id?: string }): ActionGenusSummary[] {
  const rows = kernel.db.query(
    "SELECT id FROM res WHERE genus_id = ? AND id != ? AND id != ? ORDER BY created_at ASC",
  ).all(META_GENUS_ID, META_GENUS_ID, LOG_GENUS_ID) as { id: string }[];

  const results: ActionGenusSummary[] = [];
  for (const row of rows) {
    const def = getActionDef(kernel, row.id);
    if (def.meta.kind === "action") {
      if (opts?.taxonomy_id && (def.meta.taxonomy_id ?? DEFAULT_TAXONOMY_ID) !== opts.taxonomy_id) continue;
      results.push({ id: row.id, name: (def.meta.name as string) ?? "", def });
    }
  }
  return results;
}

export function findActionByName(kernel: Kernel, name: string): string | null {
  const actions = listActionGenera(kernel);
  const lower = name.toLowerCase();
  const match = actions.find((a) => a.name.toLowerCase() === lower);
  return match ? match.id : null;
}

export function findActionsByTargetGenus(kernel: Kernel, genus_name: string): ActionGenusSummary[] {
  const actions = listActionGenera(kernel);
  const lower = genus_name.toLowerCase();
  return actions.filter((a) => {
    return Object.values(a.def.resources).some(
      (r) => r.genus_name.toLowerCase() === lower,
    );
  });
}

// --- History ---

export function getHistory(
  kernel: Kernel,
  res_id: string,
  opts: { limit?: number; branch_id?: string } = {},
): HistoryEntry[] {
  const branch_id = opts.branch_id ?? "main";
  const tessellae = replay(kernel, res_id, { branch_id, limit: opts.limit });

  // Build a map of tessella_id → action_taken for efficient lookup
  const tessellaeIds = tessellae.map((t) => t.id);
  if (tessellaeIds.length === 0) return [];

  // Find all action_taken rows that reference any of these tessella ids
  const allActionTaken = kernel.db.query(
    "SELECT * FROM action_taken WHERE branch_id = ? ORDER BY created_at ASC",
  ).all(branch_id) as any[];

  const tessIdToAction = new Map<number, ActionTaken>();
  for (const row of allActionTaken) {
    const ids: number[] = JSON.parse(row.tessellae_ids);
    const actionTaken: ActionTaken = {
      id: row.id,
      action_genus_id: row.action_genus_id,
      input_id: row.input_id,
      resources: JSON.parse(row.resources),
      params: JSON.parse(row.params),
      tessellae_ids: ids,
      created_at: row.created_at,
      branch_id: row.branch_id,
    };
    for (const tid of ids) {
      tessIdToAction.set(tid, actionTaken);
    }
  }

  return tessellae.map((t) => {
    const entry: HistoryEntry = { tessella: t };
    const action = tessIdToAction.get(t.id);
    if (action) entry.action_taken = action;
    return entry;
  });
}

// ============================================================================
// SECTION: Relationships
// ============================================================================
//
// Summary:
//   First-class relationships that link entities together with typed roles.
//   Relationships have their own genus (roles, attributes, states, transitions)
//   and are addressable, queryable res in the tessella store.
//
// Usage:
//   const assignmentGenus = defineRelationshipGenus(kernel, "Assignment", {
//     roles: [
//       { name: "artist", valid_member_genera: ["Person"], cardinality: "one" },
//       { name: "content", valid_member_genera: ["Issue"], cardinality: "one" },
//     ],
//     attributes: [{ name: "assigned_at", type: "text" }],
//     states: [{ name: "active", initial: true }, { name: "completed", initial: false }],
//     transitions: [{ from: "active", to: "completed" }],
//   });
//   const relId = createRelationship(kernel, assignmentGenus, {
//     artist: personId, content: issueId,
//   }, { attributes: { assigned_at: "2024-01-15" } });
//   const rels = getRelationshipsForEntity(kernel, personId);
//
// Design notes:
//   - Relationships are top-level res (not embedded in parent streams) because
//     they connect independent entities.
//   - A denormalized `relationship_member` index table enables fast reverse
//     lookups ("what relationships does entity X have?").
//   - Validation happens in createRelationship/addMember, not in the reducer.
//

// --- Types ---

export interface DefineRelationshipGenusOptions {
  roles: GenusRoleDef[];
  attributes?: (Omit<GenusAttributeDef, "required" | "default_value"> & { required?: boolean; default_value?: unknown })[];
  states?: GenusStateDef[];
  transitions?: GenusTransitionDef[];
  meta?: Record<string, unknown>;
  taxonomy_id?: string;
}

export interface RelationshipSummary {
  id: string;
  genus_id: string;
  genus_name: string;
  members: Record<string, string[]>;
  state: Record<string, unknown>;
}

export interface RelationshipGenusSummary {
  id: string;
  name: string;
  def: GenusDef;
}

// --- Internal helpers ---

function _validateMembers(
  kernel: Kernel,
  genusDef: GenusDef,
  members: Record<string, string | string[]>,
): void {
  // Check all required roles are provided
  for (const [roleName, roleDef] of Object.entries(genusDef.roles)) {
    if (roleDef.cardinality === "one" || roleDef.cardinality === "one_or_more") {
      if (!members[roleName]) {
        throw new Error(`Missing required role: ${roleName}`);
      }
    }
  }

  // Validate each member
  for (const [roleName, entityIds] of Object.entries(members)) {
    const roleDef = genusDef.roles[roleName];
    if (!roleDef) {
      throw new Error(`Unknown role: ${roleName}`);
    }

    const ids = Array.isArray(entityIds) ? entityIds : [entityIds];

    // Cardinality checks
    if (roleDef.cardinality === "one" && ids.length !== 1) {
      throw new Error(`Role "${roleName}" requires exactly one member, got ${ids.length}`);
    }

    for (const entityId of ids) {
      // Check entity exists
      let resRow: any;
      try {
        resRow = getRes(kernel, entityId);
      } catch {
        throw new Error(`Entity not found: ${entityId}`);
      }

      // Check genus matches (empty = unconstrained)
      if (roleDef.valid_member_genera.length > 0) {
        const entityGenusDef = getGenusDef(kernel, resRow.genus_id);
        const entityGenusName = (entityGenusDef.meta.name as string) ?? "";
        const valid = roleDef.valid_member_genera.some(
          (g) => g.toLowerCase() === entityGenusName.toLowerCase(),
        );
        if (!valid) {
          throw new Error(
            `Entity "${entityId}" has genus "${entityGenusName}", but role "${roleName}" requires one of [${roleDef.valid_member_genera.join(", ")}]`,
          );
        }
      }
    }
  }
}

function _updateRelationshipIndex(
  kernel: Kernel,
  relationship_id: string,
  role: string,
  entity_id: string,
  action: "insert" | "delete",
  branch_id: string = "main",
): void {
  if (action === "insert") {
    kernel.db.run(
      "INSERT INTO relationship_member (relationship_id, role, entity_id, branch_id) VALUES (?, ?, ?, ?)",
      [relationship_id, role, entity_id, branch_id],
    );
  } else {
    kernel.db.run(
      "DELETE FROM relationship_member WHERE relationship_id = ? AND role = ? AND entity_id = ? AND branch_id = ?",
      [relationship_id, role, entity_id, branch_id],
    );
  }
}

// --- Core functions ---

export function defineRelationshipGenus(
  kernel: Kernel,
  name: string,
  opts: DefineRelationshipGenusOptions,
): string {
  const effectiveOntologyId = opts.taxonomy_id ?? DEFAULT_TAXONOMY_ID;
  _checkTaxonomyNotArchived(kernel, effectiveOntologyId);

  const genusId = createRes(kernel, META_GENUS_ID);
  appendTessella(kernel, genusId, "genus_meta_set", { key: "name", value: name });
  appendTessella(kernel, genusId, "genus_meta_set", { key: "kind", value: "relationship" });
  appendTessella(kernel, genusId, "genus_meta_set", { key: "taxonomy_id", value: effectiveOntologyId });

  for (const role of opts.roles) {
    appendTessella(kernel, genusId, "genus_role_defined", role);
  }

  if (opts.attributes) {
    for (const attr of opts.attributes) {
      appendTessella(kernel, genusId, "genus_attribute_defined", {
        name: attr.name,
        type: attr.type,
        required: attr.required ?? false,
        ...(attr.default_value !== undefined ? { default_value: attr.default_value } : {}),
      });
    }
  }

  if (opts.states) {
    for (const st of opts.states) {
      appendTessella(kernel, genusId, "genus_state_defined", st);
    }
  }

  if (opts.transitions) {
    for (const tr of opts.transitions) {
      appendTessella(kernel, genusId, "genus_transition_defined", tr);
    }
  }

  if (opts.meta) {
    for (const [key, value] of Object.entries(opts.meta)) {
      appendTessella(kernel, genusId, "genus_meta_set", { key, value });
    }
  }

  return genusId;
}

export function createRelationship(
  kernel: Kernel,
  genus_id: string,
  members: Record<string, string | string[]>,
  opts?: { attributes?: Record<string, unknown>; branch_id?: string },
): string {
  const branch_id = opts?.branch_id;

  // Validate genus exists and is a relationship
  const genusDef = getGenusDef(kernel, genus_id);
  if (genusDef.meta.kind !== "relationship") {
    throw new Error(`Genus "${genus_id}" is not a relationship genus`);
  }

  // Validate all members upfront
  _validateMembers(kernel, genusDef, members);

  // Validate attributes upfront if provided
  if (opts?.attributes) {
    for (const [key, value] of Object.entries(opts.attributes)) {
      const attrDef = genusDef.attributes[key];
      if (!attrDef) {
        throw new Error(`Attribute "${key}" is not defined on relationship genus "${genusDef.meta.name}". Valid attributes: ${Object.keys(genusDef.attributes).join(", ") || "(none)"}`);
      }
      if (!_validateAttributeType(value, attrDef.type)) {
        throw new Error(`Type mismatch for attribute "${key}": expected ${attrDef.type}, got ${typeof value}`);
      }
    }
  }

  // Create res (inherit current workspace)
  const relId = createRes(kernel, genus_id, branch_id, kernel.currentWorkspace);

  // Append member_added tessellae and update index
  for (const [roleName, entityIds] of Object.entries(members)) {
    const ids = Array.isArray(entityIds) ? entityIds : [entityIds];
    for (const entityId of ids) {
      appendTessella(kernel, relId, "member_added", { role: roleName, entity_id: entityId }, { branch_id });
      _updateRelationshipIndex(kernel, relId, roleName, entityId, "insert", branch_id ?? "main");
    }
  }

  // Set initial status if genus has one
  if (genusDef.initialState) {
    appendTessella(kernel, relId, "status_changed", { status: genusDef.initialState }, { branch_id });
  }

  // Set initial attributes if provided
  if (opts?.attributes) {
    for (const [key, value] of Object.entries(opts.attributes)) {
      appendTessella(kernel, relId, "attribute_set", { key, value }, { branch_id });
    }
  }

  return relId;
}

export function addMember(
  kernel: Kernel,
  relationship_id: string,
  role: string,
  entity_id: string,
  opts?: { branch_id?: string },
): Tessella {
  const branch_id = opts?.branch_id;

  // Get relationship res and genus
  const resRow = getRes(kernel, relationship_id);
  const genusDef = getGenusDef(kernel, resRow.genus_id);

  if (genusDef.meta.kind !== "relationship") {
    throw new Error(`Res "${relationship_id}" is not a relationship`);
  }

  const roleDef = genusDef.roles[role];
  if (!roleDef) {
    throw new Error(`Unknown role: ${role}`);
  }

  // Validate entity exists and genus matches (empty = unconstrained)
  const entityRes = getRes(kernel, entity_id);
  if (roleDef.valid_member_genera.length > 0) {
    const entityGenusDef = getGenusDef(kernel, entityRes.genus_id);
    const entityGenusName = (entityGenusDef.meta.name as string) ?? "";
    const valid = roleDef.valid_member_genera.some(
      (g) => g.toLowerCase() === entityGenusName.toLowerCase(),
    );
    if (!valid) {
      throw new Error(
        `Entity "${entity_id}" has genus "${entityGenusName}", but role "${role}" requires one of [${roleDef.valid_member_genera.join(", ")}]`,
      );
    }
  }

  // Check cardinality ceiling
  if (roleDef.cardinality === "one") {
    const state = materialize(kernel, relationship_id, { branch_id });
    const currentMembers = (state.members as Record<string, string[]> ?? {})[role] ?? [];
    if (currentMembers.length >= 1) {
      throw new Error(`Role "${role}" already has a member (cardinality: one)`);
    }
  }

  const t = appendTessella(kernel, relationship_id, "member_added", { role, entity_id }, { branch_id });
  _updateRelationshipIndex(kernel, relationship_id, role, entity_id, "insert", branch_id ?? "main");
  return t;
}

export function removeMember(
  kernel: Kernel,
  relationship_id: string,
  role: string,
  entity_id: string,
  opts?: { branch_id?: string },
): Tessella {
  const branch_id = opts?.branch_id;

  // Get relationship res and genus
  const resRow = getRes(kernel, relationship_id);
  const genusDef = getGenusDef(kernel, resRow.genus_id);

  if (genusDef.meta.kind !== "relationship") {
    throw new Error(`Res "${relationship_id}" is not a relationship`);
  }

  const roleDef = genusDef.roles[role];
  if (!roleDef) {
    throw new Error(`Unknown role: ${role}`);
  }

  // Check that member exists
  const state = materialize(kernel, relationship_id, { branch_id });
  const currentMembers = (state.members as Record<string, string[]> ?? {})[role] ?? [];
  if (!currentMembers.includes(entity_id)) {
    throw new Error(`Entity "${entity_id}" is not a member of role "${role}"`);
  }

  // Check cardinality floor
  if (roleDef.cardinality === "one" || roleDef.cardinality === "one_or_more") {
    if (currentMembers.length <= 1) {
      throw new Error(`Cannot remove member: role "${role}" requires at least one member`);
    }
  }

  const t = appendTessella(kernel, relationship_id, "member_removed", { role, entity_id }, { branch_id });
  _updateRelationshipIndex(kernel, relationship_id, role, entity_id, "delete", branch_id ?? "main");
  return t;
}

// --- Query helpers ---

export function getRelationshipsForEntity(
  kernel: Kernel,
  entity_id: string,
  opts?: { genus_id?: string; role?: string; branch_id?: string },
): RelationshipSummary[] {
  const branch_id = opts?.branch_id ?? "main";

  let sql = "SELECT DISTINCT relationship_id FROM relationship_member WHERE entity_id = ? AND branch_id = ?";
  const params: any[] = [entity_id, branch_id];

  if (opts?.role) {
    sql += " AND role = ?";
    params.push(opts.role);
  }

  const rows = kernel.db.query(sql).all(...params) as { relationship_id: string }[];

  const results: RelationshipSummary[] = [];
  for (const row of rows) {
    const resRow = getRes(kernel, row.relationship_id);
    if (opts?.genus_id && resRow.genus_id !== opts.genus_id) continue;

    const state = materialize(kernel, row.relationship_id, { branch_id });
    const genusDef = getGenusDef(kernel, resRow.genus_id);

    results.push({
      id: row.relationship_id,
      genus_id: resRow.genus_id,
      genus_name: (genusDef.meta.name as string) ?? "",
      members: (state.members as Record<string, string[]>) ?? {},
      state,
    });
  }

  return results;
}

export interface ListRelationshipsOptions {
  genus_id?: string;
  member_entity_id?: string;
  member_role?: string;
  status?: string;
  limit?: number;
  branch_id?: string;
}

export function listRelationships(
  kernel: Kernel,
  opts: ListRelationshipsOptions = {},
): RelationshipSummary[] {
  const branch_id = opts.branch_id ?? kernel.currentBranch;
  let relIds: string[];

  if (opts.member_entity_id) {
    // Fast path: use relationship_member index
    let sql = "SELECT DISTINCT relationship_id FROM relationship_member WHERE entity_id = ? AND branch_id = ?";
    const params: any[] = [opts.member_entity_id, branch_id];
    if (opts.member_role) {
      sql += " AND role = ?";
      params.push(opts.member_role);
    }
    const rows = kernel.db.query(sql).all(...params) as { relationship_id: string }[];
    relIds = rows.map((r) => r.relationship_id);
  } else if (opts.genus_id) {
    // Query res by genus_id
    const rows = kernel.db.query(
      "SELECT id FROM res WHERE genus_id = ? ORDER BY created_at ASC",
    ).all(opts.genus_id) as { id: string }[];
    relIds = rows.map((r) => r.id);
  } else {
    // All relationship genera
    const genera = listRelationshipGenera(kernel);
    const allRows: { id: string }[] = [];
    for (const g of genera) {
      const rows = kernel.db.query(
        "SELECT id FROM res WHERE genus_id = ? ORDER BY created_at ASC",
      ).all(g.id) as { id: string }[];
      allRows.push(...rows);
    }
    relIds = allRows.map((r) => r.id);
  }

  const results: RelationshipSummary[] = [];
  for (const relId of relIds) {
    const resRow = getRes(kernel, relId);
    if (opts.genus_id && resRow.genus_id !== opts.genus_id) continue;

    const state = materialize(kernel, relId, { branch_id });
    if (opts.status && state.status !== opts.status) continue;

    // If filtering by member_role without member_entity_id, check role exists in members
    if (opts.member_role && !opts.member_entity_id) {
      const members = (state.members as Record<string, string[]>) ?? {};
      if (!members[opts.member_role] || members[opts.member_role].length === 0) continue;
    }

    const genusDef = getGenusDef(kernel, resRow.genus_id);
    results.push({
      id: relId,
      genus_id: resRow.genus_id,
      genus_name: (genusDef.meta.name as string) ?? "",
      members: (state.members as Record<string, string[]>) ?? {},
      state,
    });

    if (opts.limit !== undefined && results.length >= opts.limit) break;
  }

  return results;
}

export function getRelatedEntities(
  kernel: Kernel,
  entity_id: string,
  opts?: { branch_id?: string },
): { entity_id: string; role: string; relationship_id: string; genus_name: string }[] {
  const branch_id = opts?.branch_id ?? "main";

  // Find all relationships this entity is in
  const relRows = kernel.db.query(
    "SELECT DISTINCT relationship_id FROM relationship_member WHERE entity_id = ? AND branch_id = ?",
  ).all(entity_id, branch_id) as { relationship_id: string }[];

  const results: { entity_id: string; role: string; relationship_id: string; genus_name: string }[] = [];

  for (const relRow of relRows) {
    // Find all other members of each relationship
    const memberRows = kernel.db.query(
      "SELECT role, entity_id FROM relationship_member WHERE relationship_id = ? AND branch_id = ? AND entity_id != ?",
    ).all(relRow.relationship_id, branch_id, entity_id) as { role: string; entity_id: string }[];

    const resRow = getRes(kernel, relRow.relationship_id);
    const genusDef = getGenusDef(kernel, resRow.genus_id);
    const genusName = (genusDef.meta.name as string) ?? "";

    for (const member of memberRows) {
      results.push({
        entity_id: member.entity_id,
        role: member.role,
        relationship_id: relRow.relationship_id,
        genus_name: genusName,
      });
    }
  }

  return results;
}

export function listRelationshipGenera(kernel: Kernel, opts?: { taxonomy_id?: string }): RelationshipGenusSummary[] {
  const rows = kernel.db.query(
    "SELECT id FROM res WHERE genus_id = ? AND id != ? AND id != ? ORDER BY created_at ASC",
  ).all(META_GENUS_ID, META_GENUS_ID, LOG_GENUS_ID) as { id: string }[];

  const results: RelationshipGenusSummary[] = [];
  for (const row of rows) {
    const def = getGenusDef(kernel, row.id);
    if (def.meta.kind === "relationship") {
      if (opts?.taxonomy_id && (def.meta.taxonomy_id ?? DEFAULT_TAXONOMY_ID) !== opts.taxonomy_id) continue;
      results.push({
        id: row.id,
        name: (def.meta.name as string) ?? "",
        def,
      });
    }
  }
  return results;
}

export function findRelationshipGenusByName(kernel: Kernel, name: string): string | null {
  const genera = listRelationshipGenera(kernel);
  const lower = name.toLowerCase();
  const match = genera.find((g) => g.name.toLowerCase() === lower);
  return match ? match.id : null;
}

// ============================================================================
// SECTION: Health
// ============================================================================
//
// Summary:
//   Health evaluation and error tracking. A pure function checks an entity's
//   materialized state against its genus definition, a dedicated Error genus
//   persists issues with state transitions, and evolveGenus enables idempotent
//   additive schema changes.
//
// Usage:
//   evolveGenus(kernel, issueGenus, {
//     attributes: [{ name: "cover_image", type: "text", required: true }],
//   });
//   const report = evaluateHealth(kernel, issueId);
//   const unhealthy = listUnhealthy(kernel, { genus_id: issueGenus });
//   const errorId = createError(kernel, "Missing cover image", {
//     severity: "error", associated_res_id: issueId,
//   });
//   acknowledgeError(kernel, errorId);
//
// Design notes:
//   - _evaluateHealthPure is a pure function with no side effects.
//   - evolveGenus is additive-only: it appends missing definitions but never
//     removes or modifies existing ones.
//   - Error genus uses state machine (open → acknowledged) unlike immutable Log.
//

// --- Types ---

export interface HealthIssue {
  type: "missing_required_attribute" | "invalid_attribute_type" | "invalid_status" | "unacknowledged_error";
  message: string;
  severity: "warning" | "error";
}

export interface HealthReport {
  res_id: string;
  genus_id: string;
  healthy: boolean;
  issues: HealthIssue[];
}

export interface EvolveGenusOptions {
  attributes?: GenusAttributeDef[];
  states?: GenusStateDef[];
  transitions?: GenusTransitionDef[];
  meta?: Record<string, unknown>;
  roles?: GenusRoleDef[];
}

export interface ErrorSummary {
  id: string;
  message: string;
  severity: string;
  associated_res_id: string | null;
  status: string;
  acknowledged_at: string | null;
}

// --- Core functions ---

export function evolveGenus(
  kernel: Kernel,
  genus_id: string,
  opts: EvolveGenusOptions,
): void {
  // Validate genus exists
  const genusRow = kernel.db.query("SELECT id FROM res WHERE id = ?").get(genus_id) as any;
  if (!genusRow) {
    throw new Error(`Genus not found: ${genus_id}`);
  }

  const def = getGenusDef(kernel, genus_id);

  if (def.meta.deprecated === true) {
    restoreGenus(kernel, genus_id);
  }
  const ontologyId = (def.meta.taxonomy_id as string) ?? DEFAULT_TAXONOMY_ID;
  _checkTaxonomyNotArchived(kernel, ontologyId);

  if (opts.attributes) {
    for (const attr of opts.attributes) {
      if (!def.attributes[attr.name]) {
        appendTessella(kernel, genus_id, "genus_attribute_defined", {
          name: attr.name,
          type: attr.type,
          required: attr.required ?? false,
          ...(attr.default_value !== undefined ? { default_value: attr.default_value } : {}),
        });
      }
    }
  }

  if (opts.states) {
    for (const st of opts.states) {
      if (!def.states[st.name]) {
        appendTessella(kernel, genus_id, "genus_state_defined", st);
      }
    }
  }

  if (opts.transitions) {
    for (const tr of opts.transitions) {
      const exists = def.transitions.some(
        (t) => t.from === tr.from && t.to === tr.to,
      );
      if (!exists) {
        appendTessella(kernel, genus_id, "genus_transition_defined", tr);
      }
    }
  }

  if (opts.meta) {
    for (const [key, value] of Object.entries(opts.meta)) {
      if (def.meta[key] !== value) {
        appendTessella(kernel, genus_id, "genus_meta_set", { key, value });
      }
    }
  }

  if (opts.roles) {
    if (def.meta.kind !== "relationship") {
      throw new Error("Cannot evolve roles on a non-relationship genus");
    }
    for (const role of opts.roles) {
      const existing = def.roles[role.name];
      if (existing) {
        // Merge valid_member_genera (union, case-insensitive dedup)
        const seen = new Set(existing.valid_member_genera.map(g => g.toLowerCase()));
        const merged = [...existing.valid_member_genera];
        for (const g of role.valid_member_genera) {
          if (!seen.has(g.toLowerCase())) { merged.push(g); seen.add(g.toLowerCase()); }
        }
        if (merged.length !== existing.valid_member_genera.length || role.cardinality !== existing.cardinality) {
          appendTessella(kernel, genus_id, "genus_role_defined", {
            name: role.name, valid_member_genera: merged, cardinality: role.cardinality,
          });
        }
      } else {
        appendTessella(kernel, genus_id, "genus_role_defined", role);
      }
    }
  }
}

export function deprecateGenus(kernel: Kernel, genus_id: string): void {
  const sentinels = [META_GENUS_ID, LOG_GENUS_ID, ERROR_GENUS_ID, TASK_GENUS_ID, BRANCH_GENUS_ID, TAXONOMY_GENUS_ID, WORKSPACE_GENUS_ID, SCIENCE_GENUS_ID, PALACE_ROOM_GENUS_ID, PALACE_SCROLL_GENUS_ID, PALACE_NPC_GENUS_ID];
  if (sentinels.includes(genus_id)) {
    throw new Error(`Cannot deprecate sentinel genus: ${genus_id}`);
  }
  const genusRow = kernel.db.query("SELECT id FROM res WHERE id = ?").get(genus_id) as any;
  if (!genusRow) {
    throw new Error(`Genus not found: ${genus_id}`);
  }
  const def = getGenusDef(kernel, genus_id);
  if (def.meta.deprecated === true) return; // idempotent
  appendTessella(kernel, genus_id, "genus_meta_set", { key: "deprecated", value: true });
  appendTessella(kernel, genus_id, "genus_meta_set", { key: "deprecated_at", value: new Date().toISOString() });
}

export function restoreGenus(kernel: Kernel, genus_id: string): void {
  const def = getGenusDef(kernel, genus_id);
  if (def.meta.deprecated !== true) return; // idempotent
  const ontologyId = (def.meta.taxonomy_id as string) ?? DEFAULT_TAXONOMY_ID;
  _checkTaxonomyNotArchived(kernel, ontologyId);
  appendTessella(kernel, genus_id, "genus_meta_set", { key: "deprecated", value: false });
  appendTessella(kernel, genus_id, "genus_meta_set", { key: "deprecated_at", value: null });
}

// --- Health evaluation ---

function _evaluateHealthPure(
  genusDef: GenusDef,
  state: Record<string, unknown>,
): HealthIssue[] {
  const issues: HealthIssue[] = [];

  // Check required attributes
  for (const [name, attrDef] of Object.entries(genusDef.attributes)) {
    if (attrDef.required) {
      const val = state[name];
      if (val === undefined || val === null || val === "") {
        issues.push({
          type: "missing_required_attribute",
          message: `Missing required attribute: ${name}`,
          severity: "error",
        });
      }
    }
  }

  // Check attribute types
  for (const [name, attrDef] of Object.entries(genusDef.attributes)) {
    const val = state[name];
    if (val !== undefined && val !== null && val !== "") {
      if (!_validateAttributeType(val, attrDef.type)) {
        issues.push({
          type: "invalid_attribute_type",
          message: `Attribute "${name}" has type ${typeof val}, expected ${attrDef.type}`,
          severity: "warning",
        });
      }
    }
  }

  // Check status validity
  const stateKeys = Object.keys(genusDef.states);
  if (stateKeys.length > 0 && state.status !== undefined) {
    if (!genusDef.states[state.status as string]) {
      issues.push({
        type: "invalid_status",
        message: `Status "${state.status}" is not defined on genus`,
        severity: "error",
      });
    }
  }

  return issues;
}

export function evaluateHealth(kernel: Kernel, res_id: string): HealthReport {
  const res = getRes(kernel, res_id);
  const genusDef = getGenusDef(kernel, res.genus_id);
  const state = materialize(kernel, res_id, { branch_id: kernel.currentBranch });

  const issues = _evaluateHealthPure(genusDef, state);

  // Check for unacknowledged errors
  const errors = listErrors(kernel, { associated_res_id: res_id, status: "open" });
  for (const err of errors) {
    issues.push({
      type: "unacknowledged_error",
      message: `Unacknowledged error: ${err.message}`,
      severity: "error",
    });
  }

  return {
    res_id,
    genus_id: res.genus_id,
    healthy: issues.length === 0,
    issues,
  };
}

export function evaluateHealthByGenus(kernel: Kernel, genus_id: string, opts?: { only_workspace?: boolean }): HealthReport[] {
  const entities = listEntities(kernel, { genus_id, only_workspace: opts?.only_workspace });
  return entities.map((e) => evaluateHealth(kernel, e.id));
}

export function listUnhealthy(
  kernel: Kernel,
  opts?: { genus_id?: string; only_workspace?: boolean },
): HealthReport[] {
  const genus_id = opts?.genus_id;
  const only_workspace = opts?.only_workspace;
  let reports: HealthReport[];

  if (genus_id) {
    reports = evaluateHealthByGenus(kernel, genus_id, { only_workspace });
  } else {
    // Evaluate all entities across all genera
    const genera = listGenera(kernel);
    reports = [];
    for (const g of genera) {
      reports.push(...evaluateHealthByGenus(kernel, g.id, { only_workspace }));
    }
  }

  return reports.filter((r) => !r.healthy);
}

// --- Error management ---

export function createError(
  kernel: Kernel,
  message: string,
  opts?: { severity?: string; associated_res_id?: string },
): string {
  const entityId = createEntity(kernel, ERROR_GENUS_ID);
  setAttribute(kernel, entityId, "message", message);
  setAttribute(kernel, entityId, "severity", opts?.severity ?? "error");
  if (opts?.associated_res_id) {
    setAttribute(kernel, entityId, "associated_res_id", opts.associated_res_id);
  }
  return entityId;
}

export function acknowledgeError(kernel: Kernel, error_id: string): Tessella {
  const now = new Date().toISOString();
  const t = transitionStatus(kernel, error_id, "acknowledged");
  setAttribute(kernel, error_id, "acknowledged_at", now);
  return t;
}

export function listErrors(
  kernel: Kernel,
  opts?: { associated_res_id?: string; status?: string },
): ErrorSummary[] {
  const entities = listEntities(kernel, { genus_id: ERROR_GENUS_ID });
  return entities
    .map((e) => ({
      id: e.id,
      message: (e.state.message as string) ?? "",
      severity: (e.state.severity as string) ?? "error",
      associated_res_id: (e.state.associated_res_id as string) ?? null,
      status: (e.state.status as string) ?? "open",
      acknowledged_at: (e.state.acknowledged_at as string) ?? null,
    }))
    .filter((e) => {
      if (opts?.associated_res_id && e.associated_res_id !== opts.associated_res_id) return false;
      if (opts?.status && e.status !== opts.status) return false;
      return true;
    });
}

// ============================================================================
// SECTION: Tasks
// ============================================================================
//
// Summary:
//   Built-in task system for structured work items. Tasks are entities under a
//   sentinel Task genus with a pending/claimed/completed/cancelled state machine.
//   Humans and LLMs can create, claim, and complete tasks. Actions can create
//   tasks via the create_task side effect.
//
// Usage:
//   const taskId = createTask(kernel, "Review Chapter 1 layout", {
//     description: "Check spacing and image placement",
//     associated_res_id: issueId,
//     priority: "high",
//   });
//   claimTask(kernel, taskId, { assigned_to: "claude" });
//   completeTask(kernel, taskId, "Approved — layout looks good");
//
// Design notes:
//   - Task genus is a sentinel (TASK_GENUS_ID) bootstrapped in initKernel.
//   - Direct pending → completed transition enables simple approval workflows
//     without mandatory claim step.
//   - listGenera excludes Task genus (same pattern as Log, Error).
//

// --- Types ---

export interface TaskSummary {
  id: string;
  title: string;
  description: string | null;
  associated_res_id: string | null;
  context_res_ids: string[];
  target_agent_type: string;
  priority: string;
  status: string;
  assigned_to: string | null;
  claimed_at: string | null;
  completed_at: string | null;
  result: string | null;
  step_name: string | null;
  lane_name: string | null;
}

export interface CreateTaskOptions {
  description?: string;
  associated_res_id?: string;
  context_res_ids?: string[];
  target_agent_type?: string;
  priority?: string;
}

// --- Core functions ---

export function createTask(
  kernel: Kernel,
  title: string,
  opts?: CreateTaskOptions,
): string {
  const entityId = createEntity(kernel, TASK_GENUS_ID);
  setAttribute(kernel, entityId, "title", title);
  if (opts?.description) setAttribute(kernel, entityId, "description", opts.description);
  if (opts?.associated_res_id) setAttribute(kernel, entityId, "associated_res_id", opts.associated_res_id);
  if (opts?.context_res_ids) setAttribute(kernel, entityId, "context_res_ids", JSON.stringify(opts.context_res_ids));
  setAttribute(kernel, entityId, "target_agent_type", opts?.target_agent_type ?? "either");
  setAttribute(kernel, entityId, "priority", opts?.priority ?? "normal");
  return entityId;
}

export function claimTask(
  kernel: Kernel,
  task_id: string,
  opts?: { assigned_to?: string },
): Tessella {
  const t = transitionStatus(kernel, task_id, "claimed");
  if (opts?.assigned_to) setAttribute(kernel, task_id, "assigned_to", opts.assigned_to);
  setAttribute(kernel, task_id, "claimed_at", new Date().toISOString());
  return t;
}

export function completeTask(
  kernel: Kernel,
  task_id: string,
  result?: string,
): Tessella {
  const t = transitionStatus(kernel, task_id, "completed");
  if (result) setAttribute(kernel, task_id, "result", result);
  setAttribute(kernel, task_id, "completed_at", new Date().toISOString());
  _checkProcessTaskCompletion(kernel, task_id);
  return t;
}

export function cancelTask(
  kernel: Kernel,
  task_id: string,
): Tessella {
  return transitionStatus(kernel, task_id, "cancelled");
}

export function listTasks(
  kernel: Kernel,
  opts?: { status?: string; associated_res_id?: string; priority?: string; target_agent_type?: string; process_id?: string; only_workspace?: boolean },
): TaskSummary[] {
  const entities = listEntities(kernel, { genus_id: TASK_GENUS_ID, only_workspace: opts?.only_workspace });
  return entities
    .map((e) => {
      const contextRaw = e.state.context_res_ids as string | undefined;
      let contextIds: string[] = [];
      if (contextRaw) {
        try { contextIds = JSON.parse(contextRaw); } catch {}
      }
      return {
        id: e.id,
        title: (e.state.title as string) ?? "",
        description: (e.state.description as string) ?? null,
        associated_res_id: (e.state.associated_res_id as string) ?? null,
        context_res_ids: contextIds,
        target_agent_type: (e.state.target_agent_type as string) ?? "either",
        priority: (e.state.priority as string) ?? "normal",
        status: (e.state.status as string) ?? "pending",
        assigned_to: (e.state.assigned_to as string) ?? null,
        claimed_at: (e.state.claimed_at as string) ?? null,
        completed_at: (e.state.completed_at as string) ?? null,
        result: (e.state.result as string) ?? null,
        step_name: (e.state.step_name as string) ?? null,
        lane_name: (e.state.lane_name as string) ?? null,
      };
    })
    .filter((t) => {
      if (opts?.status && t.status !== opts.status) return false;
      if (opts?.associated_res_id && t.associated_res_id !== opts.associated_res_id) return false;
      if (opts?.priority && t.priority !== opts.priority) return false;
      if (opts?.target_agent_type && t.target_agent_type !== opts.target_agent_type) return false;
      if (opts?.process_id && !t.context_res_ids.includes(opts.process_id)) return false;
      return true;
    });
}

// ============================================================================
// SECTION: Processes
// ============================================================================
//
// Summary:
//   Multi-lane workflow engine. Process genera define workflow templates with
//   lanes, ordered steps, convergence gates, and triggers. Process instances
//   track execution state and auto-advance when tasks are completed.
//
// Usage:
//   const procGenus = defineProcessGenus(kernel, "Publication", {
//     lanes: [{ name: "editorial", position: 0 }, { name: "art", position: 1 }],
//     steps: [
//       { name: "review", type: "task_step", lane: "editorial", position: 0,
//         task_title: "Review content" },
//       { name: "commission_art", type: "task_step", lane: "art", position: 0,
//         task_title: "Commission artwork" },
//     ],
//   });
//   const instance = startProcess(kernel, procGenus, { context_res_id: issueId });
//
// Design notes:
//   - Process genera use meta.kind = "process" (same pattern as action/feature).
//   - Auto-advance: when completeTask is called, _checkProcessTaskCompletion
//     finds the process instance via context_res_ids and advances it.
//   - Gate steps block until all named conditions (prior step names) are completed.
//   - Immediate steps (action, fetch, gate, branch) execute synchronously;
//     task steps create tasks and wait for completion.
//

// --- Types ---

export type ProcessStepType = "action_step" | "task_step" | "fetch_step" | "gate_step" | "branch_step";

export interface ProcessStepDef {
  name: string;
  type: ProcessStepType;
  lane: string;
  position: number;
  // action_step
  action_name?: string;
  action_params?: Record<string, unknown>;
  action_resource_bindings?: Record<string, string>;
  // task_step
  task_title?: string;
  task_description?: string;
  task_priority?: string;
  task_target_agent_type?: string;
  // fetch_step
  fetch_source?: string;
  fetch_into?: string;
  // gate_step
  gate_conditions?: string[];
  // branch_step
  branch_condition?: string;
  branch_map?: Record<string, string>;
  branch_default?: string;
}

export interface ProcessLaneDef {
  name: string;
  position: number;
}

export interface ProcessTriggerDef {
  type: "manual" | "action" | "condition" | "cron";
  action_name?: string;
  condition_attribute?: string;
  condition_value?: unknown;
  cron_expression?: string;
}

export interface ProcessDef {
  lanes: Record<string, ProcessLaneDef>;
  steps: Record<string, ProcessStepDef>;
  triggers: ProcessTriggerDef[];
  meta: Record<string, unknown>;
}

export interface DefineProcessGenusOptions {
  lanes: { name: string; position: number }[];
  steps: ProcessStepDef[];
  triggers?: ProcessTriggerDef[];
  meta?: Record<string, unknown>;
  taxonomy_id?: string;
}

export interface ProcessStepStatus {
  step_name: string;
  status: "pending" | "active" | "completed" | "skipped" | "failed";
  task_id?: string;
  action_taken_id?: string;
  started_at?: string;
  completed_at?: string;
  result?: unknown;
}

export interface ProcessInstanceState {
  process_genus_id: string;
  context_res_id?: string;
  status: "running" | "completed" | "failed" | "cancelled";
  steps: Record<string, ProcessStepStatus>;
  started_at: string;
  completed_at?: string;
}

export interface ProcessSummary {
  id: string;
  process_genus_id: string;
  process_name: string;
  context_res_id?: string;
  status: string;
  step_summary: { total: number; completed: number; active: number; pending: number; failed: number };
}

export interface ProcessGenusSummary {
  id: string;
  name: string;
  def: ProcessDef;
}

// --- Reducers ---

export function processReducer(state: Record<string, unknown>, tessella: Tessella): Record<string, unknown> {
  switch (tessella.type) {
    case "created":
      return { lanes: {}, steps: {}, triggers: [], meta: {} };
    case "process_lane_defined": {
      const def = tessella.data as ProcessLaneDef;
      const lanes = { ...(state.lanes as Record<string, ProcessLaneDef>), [def.name]: def };
      return { ...state, lanes };
    }
    case "process_step_defined": {
      const def = tessella.data as ProcessStepDef;
      const steps = { ...(state.steps as Record<string, ProcessStepDef>), [def.name]: def };
      return { ...state, steps };
    }
    case "process_trigger_defined": {
      const def = tessella.data as ProcessTriggerDef;
      const triggers = [...(state.triggers as ProcessTriggerDef[]), def];
      return { ...state, triggers };
    }
    case "genus_meta_set": {
      let { key, value } = tessella.data as { key: string; value: unknown };
      if (key === "domain_id" || key === "ontology_id") key = "taxonomy_id"; // backwards compat
      const meta = { ...(state.meta as Record<string, unknown>), [key]: value };
      return { ...state, meta };
    }
    default:
      return state;
  }
}

export function processInstanceReducer(state: Record<string, unknown>, tessella: Tessella): Record<string, unknown> {
  switch (tessella.type) {
    case "created":
      return {};
    case "process_started": {
      const { process_genus_id, context_res_id, started_at } = tessella.data as {
        process_genus_id: string; context_res_id?: string; started_at: string;
      };
      return {
        ...state,
        process_genus_id,
        context_res_id,
        status: "running",
        steps: {},
        started_at,
      };
    }
    case "step_activated": {
      const { step_name, started_at } = tessella.data as { step_name: string; started_at: string };
      const steps = { ...(state.steps as Record<string, ProcessStepStatus>) };
      steps[step_name] = { ...(steps[step_name] ?? { step_name }), step_name, status: "active", started_at };
      return { ...state, steps };
    }
    case "step_completed": {
      const { step_name, completed_at, result } = tessella.data as { step_name: string; completed_at: string; result?: unknown };
      const steps = { ...(state.steps as Record<string, ProcessStepStatus>) };
      steps[step_name] = { ...(steps[step_name] ?? { step_name }), step_name, status: "completed", completed_at, result };
      return { ...state, steps };
    }
    case "step_failed": {
      const { step_name, completed_at, result } = tessella.data as { step_name: string; completed_at: string; result?: unknown };
      const steps = { ...(state.steps as Record<string, ProcessStepStatus>) };
      steps[step_name] = { ...(steps[step_name] ?? { step_name }), step_name, status: "failed", completed_at, result };
      return { ...state, steps };
    }
    case "step_skipped": {
      const { step_name } = tessella.data as { step_name: string };
      const steps = { ...(state.steps as Record<string, ProcessStepStatus>) };
      steps[step_name] = { ...(steps[step_name] ?? { step_name }), step_name, status: "skipped" };
      return { ...state, steps };
    }
    case "step_task_created": {
      const { step_name, task_id } = tessella.data as { step_name: string; task_id: string };
      const steps = { ...(state.steps as Record<string, ProcessStepStatus>) };
      steps[step_name] = { ...(steps[step_name] ?? { step_name }), step_name, task_id };
      return { ...state, steps };
    }
    case "step_action_executed": {
      const { step_name, action_taken_id } = tessella.data as { step_name: string; action_taken_id: string };
      const steps = { ...(state.steps as Record<string, ProcessStepStatus>) };
      steps[step_name] = { ...(steps[step_name] ?? { step_name }), step_name, action_taken_id };
      return { ...state, steps };
    }
    case "gate_evaluated": {
      // gate_evaluated is just informational; step_completed/step_activated handle state
      return state;
    }
    case "process_completed": {
      const { completed_at } = tessella.data as { completed_at: string };
      return { ...state, status: "completed", completed_at };
    }
    case "process_failed": {
      const { completed_at } = tessella.data as { completed_at: string; reason?: string };
      return { ...state, status: "failed", completed_at };
    }
    case "process_cancelled": {
      const { completed_at } = tessella.data as { completed_at: string; reason?: string };
      return { ...state, status: "cancelled", completed_at };
    }
    default:
      return state;
  }
}

// --- Core functions ---

export function getProcessDef(kernel: Kernel, genus_id: string): ProcessDef {
  const raw = materialize(kernel, genus_id, { branch_id: "main", reducer: processReducer });
  return {
    lanes: (raw.lanes as Record<string, ProcessLaneDef>) ?? {},
    steps: (raw.steps as Record<string, ProcessStepDef>) ?? {},
    triggers: (raw.triggers as ProcessTriggerDef[]) ?? [],
    meta: (raw.meta as Record<string, unknown>) ?? {},
  };
}

export function defineProcessGenus(
  kernel: Kernel,
  name: string,
  opts: DefineProcessGenusOptions,
): string {
  const effectiveOntologyId = opts.taxonomy_id ?? DEFAULT_TAXONOMY_ID;
  _checkTaxonomyNotArchived(kernel, effectiveOntologyId);

  const genusId = createRes(kernel, META_GENUS_ID);
  appendTessella(kernel, genusId, "genus_meta_set", { key: "name", value: name });
  appendTessella(kernel, genusId, "genus_meta_set", { key: "kind", value: "process" });
  appendTessella(kernel, genusId, "genus_meta_set", { key: "taxonomy_id", value: effectiveOntologyId });

  for (const lane of opts.lanes) {
    appendTessella(kernel, genusId, "process_lane_defined", lane);
  }

  for (const step of opts.steps) {
    appendTessella(kernel, genusId, "process_step_defined", step);
  }

  if (opts.triggers) {
    for (const trigger of opts.triggers) {
      appendTessella(kernel, genusId, "process_trigger_defined", trigger);
    }
  }

  if (opts.meta) {
    for (const [key, value] of Object.entries(opts.meta)) {
      appendTessella(kernel, genusId, "genus_meta_set", { key, value });
    }
  }

  return genusId;
}

export function evolveProcessGenus(
  kernel: Kernel,
  genus_id: string,
  opts: {
    lanes?: ProcessLaneDef[];
    steps?: ProcessStepDef[];
    triggers?: ProcessTriggerDef[];
  },
): void {
  const genusRow = kernel.db.query("SELECT id FROM res WHERE id = ?").get(genus_id) as any;
  if (!genusRow) throw new Error(`Process genus not found: ${genus_id}`);

  const def = getProcessDef(kernel, genus_id);
  if (def.meta.kind !== "process") throw new Error(`"${genus_id}" is not a process genus`);
  if (def.meta.deprecated === true) throw new Error("Cannot evolve deprecated genus");

  if (opts.lanes) {
    for (const lane of opts.lanes) {
      appendTessella(kernel, genus_id, "process_lane_defined", lane);
    }
  }

  if (opts.steps) {
    for (const step of opts.steps) {
      appendTessella(kernel, genus_id, "process_step_defined", step);
    }
  }

  if (opts.triggers) {
    for (const trigger of opts.triggers) {
      appendTessella(kernel, genus_id, "process_trigger_defined", trigger);
    }
  }
}

export function startProcess(
  kernel: Kernel,
  genus_id: string,
  opts?: { context_res_id?: string },
): { id: string; state: ProcessInstanceState } {
  // Verify this is a process genus
  const def = getProcessDef(kernel, genus_id);
  if (!def.meta.kind || def.meta.kind !== "process") {
    throw new Error(`"${genus_id}" is not a process genus`);
  }

  // Create instance res (its genus_id points to the process genus)
  const instanceId = createRes(kernel, genus_id, "main", kernel.currentWorkspace);
  const now = new Date().toISOString();

  appendTessella(kernel, instanceId, "process_started", {
    process_genus_id: genus_id,
    context_res_id: opts?.context_res_id,
    started_at: now,
  });

  // Kick off the engine
  _advanceProcess(kernel, instanceId, def);

  const state = getProcessStatus(kernel, instanceId);
  return { id: instanceId, state };
}

export function cancelProcess(
  kernel: Kernel,
  process_id: string,
  reason?: string,
): void {
  const now = new Date().toISOString();
  appendTessella(kernel, process_id, "process_cancelled", {
    completed_at: now,
    reason,
  });
}

export function getProcessStatus(kernel: Kernel, process_id: string): ProcessInstanceState {
  const raw = materialize(kernel, process_id, { reducer: processInstanceReducer });
  return {
    process_genus_id: (raw.process_genus_id as string) ?? "",
    context_res_id: raw.context_res_id as string | undefined,
    status: (raw.status as ProcessInstanceState["status"]) ?? "running",
    steps: (raw.steps as Record<string, ProcessStepStatus>) ?? {},
    started_at: (raw.started_at as string) ?? "",
    completed_at: raw.completed_at as string | undefined,
  };
}

// --- Query helpers ---

export function listProcessGenera(kernel: Kernel, opts?: { taxonomy_id?: string }): ProcessGenusSummary[] {
  const rows = kernel.db.query(
    "SELECT id FROM res WHERE genus_id = ? ORDER BY created_at ASC",
  ).all(META_GENUS_ID) as { id: string }[];

  const results: ProcessGenusSummary[] = [];
  for (const row of rows) {
    const def = getProcessDef(kernel, row.id);
    if (def.meta.kind === "process") {
      if (opts?.taxonomy_id && (def.meta.taxonomy_id ?? DEFAULT_TAXONOMY_ID) !== opts.taxonomy_id) continue;
      results.push({ id: row.id, name: (def.meta.name as string) ?? "", def });
    }
  }
  return results;
}

export function findProcessGenusByName(kernel: Kernel, name: string): string | null {
  const genera = listProcessGenera(kernel);
  const lower = name.toLowerCase();
  const match = genera.find((g) => g.name.toLowerCase() === lower);
  return match ? match.id : null;
}

export function listProcesses(
  kernel: Kernel,
  opts?: { genus_id?: string; status?: string; context_res_id?: string; include_finished?: boolean; only_workspace?: boolean },
): ProcessSummary[] {
  const genera = listProcessGenera(kernel);
  const genusIds = opts?.genus_id ? [opts.genus_id] : genera.map((g) => g.id);
  const genusNameMap = new Map(genera.map((g) => [g.id, g.name]));

  const results: ProcessSummary[] = [];
  for (const gid of genusIds) {
    let instSql = "SELECT id FROM res WHERE genus_id = ?";
    const instParams: any[] = [gid];
    if (kernel.currentWorkspace) {
      if (opts?.only_workspace) {
        instSql += " AND workspace_id = ?";
      } else {
        instSql += " AND (workspace_id = ? OR workspace_id IS NULL)";
      }
      instParams.push(kernel.currentWorkspace);
    }
    instSql += " ORDER BY created_at ASC";
    const instances = kernel.db.query(instSql).all(...instParams) as { id: string }[];

    for (const inst of instances) {
      const state = getProcessStatus(kernel, inst.id);
      if (!opts?.include_finished && !opts?.status && ["completed", "cancelled", "failed"].includes(state.status)) continue;
      if (opts?.status && state.status !== opts.status) continue;
      if (opts?.context_res_id && state.context_res_id !== opts.context_res_id) continue;

      const stepValues = Object.values(state.steps);
      const def = getProcessDef(kernel, gid);
      const totalSteps = Object.keys(def.steps).length;

      results.push({
        id: inst.id,
        process_genus_id: gid,
        process_name: genusNameMap.get(gid) ?? "",
        context_res_id: state.context_res_id,
        status: state.status,
        step_summary: {
          total: totalSteps,
          completed: stepValues.filter((s) => s.status === "completed").length,
          active: stepValues.filter((s) => s.status === "active").length,
          pending: totalSteps - stepValues.length + stepValues.filter((s) => s.status === "pending").length,
          failed: stepValues.filter((s) => s.status === "failed").length,
        },
      });
    }
  }
  return results;
}

// --- Step execution helpers ---

function _executeActionStep(
  kernel: Kernel,
  process_id: string,
  step: ProcessStepDef,
  instanceState: ProcessInstanceState,
): boolean {
  const actionId = findActionByName(kernel, step.action_name ?? "");
  if (!actionId) {
    const now = new Date().toISOString();
    appendTessella(kernel, process_id, "step_failed", {
      step_name: step.name,
      completed_at: now,
      result: `Action not found: ${step.action_name}`,
    });
    return false;
  }

  // Build resource bindings — substitute $context.res_id
  const bindings: Record<string, string> = {};
  if (step.action_resource_bindings) {
    for (const [key, val] of Object.entries(step.action_resource_bindings)) {
      if (val === "$context.res_id" && instanceState.context_res_id) {
        bindings[key] = instanceState.context_res_id;
      } else {
        bindings[key] = val;
      }
    }
  }

  const result = executeAction(kernel, actionId, bindings, step.action_params ?? {});
  const now = new Date().toISOString();

  if (result.error) {
    appendTessella(kernel, process_id, "step_failed", {
      step_name: step.name,
      completed_at: now,
      result: result.error,
    });
    return false;
  }

  appendTessella(kernel, process_id, "step_action_executed", {
    step_name: step.name,
    action_taken_id: result.action_taken!.id,
  });
  appendTessella(kernel, process_id, "step_completed", {
    step_name: step.name,
    completed_at: now,
  });
  return true;
}

function _executeTaskStep(
  kernel: Kernel,
  process_id: string,
  step: ProcessStepDef,
  instanceState: ProcessInstanceState,
): void {
  const taskOpts: CreateTaskOptions = {
    context_res_ids: [process_id],
    priority: step.task_priority,
    target_agent_type: step.task_target_agent_type,
    description: step.task_description,
  };
  if (instanceState.context_res_id) {
    taskOpts.associated_res_id = instanceState.context_res_id;
  }

  const taskId = createTask(kernel, step.task_title ?? step.name, taskOpts);
  setAttribute(kernel, taskId, "step_name", step.name);
  setAttribute(kernel, taskId, "lane_name", step.lane);
  appendTessella(kernel, process_id, "step_task_created", {
    step_name: step.name,
    task_id: taskId,
  });
}

function _executeFetchStep(
  kernel: Kernel,
  process_id: string,
  step: ProcessStepDef,
  instanceState: ProcessInstanceState,
): void {
  let value: unknown;
  if (step.fetch_source && instanceState.context_res_id) {
    const contextState = materialize(kernel, instanceState.context_res_id);
    value = contextState[step.fetch_source];
  }

  const now = new Date().toISOString();
  appendTessella(kernel, process_id, "step_completed", {
    step_name: step.name,
    completed_at: now,
    result: value,
  });
}

function _executeBranchStep(
  kernel: Kernel,
  process_id: string,
  step: ProcessStepDef,
  instanceState: ProcessInstanceState,
  def: ProcessDef,
): void {
  let conditionValue: string | undefined;
  if (step.branch_condition && instanceState.context_res_id) {
    const contextState = materialize(kernel, instanceState.context_res_id);
    conditionValue = String(contextState[step.branch_condition] ?? "");
  }

  // Find which target step to jump to
  const target = (step.branch_map && conditionValue && step.branch_map[conditionValue])
    ?? step.branch_default;

  if (target) {
    // Skip steps in this lane between current and target
    const laneSteps = Object.values(def.steps)
      .filter((s) => s.lane === step.lane)
      .sort((a, b) => a.position - b.position);

    let skipping = false;
    for (const ls of laneSteps) {
      if (ls.name === step.name) { skipping = true; continue; }
      if (ls.name === target) break;
      if (skipping) {
        appendTessella(kernel, process_id, "step_skipped", { step_name: ls.name });
      }
    }
  }

  const now = new Date().toISOString();
  appendTessella(kernel, process_id, "step_completed", {
    step_name: step.name,
    completed_at: now,
    result: conditionValue,
  });
}

// --- Core engine ---

function _advanceProcess(kernel: Kernel, process_id: string, def?: ProcessDef): void {
  const instanceState = getProcessStatus(kernel, process_id);
  if (instanceState.status !== "running") return;

  if (!def) {
    def = getProcessDef(kernel, instanceState.process_genus_id);
  }

  const now = new Date().toISOString();
  let madeProgress = false;

  // Group steps by lane, sorted by position
  const laneSteps = new Map<string, ProcessStepDef[]>();
  for (const step of Object.values(def.steps)) {
    const arr = laneSteps.get(step.lane) ?? [];
    arr.push(step);
    laneSteps.set(step.lane, arr);
  }
  for (const arr of laneSteps.values()) {
    arr.sort((a, b) => a.position - b.position);
  }

  // For each lane, find the next eligible step
  for (const [_laneName, steps] of laneSteps) {
    for (const step of steps) {
      const stepStatus = instanceState.steps[step.name];

      // Skip already completed/skipped/failed steps
      if (stepStatus && (stepStatus.status === "completed" || stepStatus.status === "skipped" || stepStatus.status === "failed")) {
        continue;
      }

      // Active step blocks further progress in this lane
      if (stepStatus && stepStatus.status === "active") {
        break;
      }

      // This is the next step to execute in this lane
      if (step.type === "gate_step") {
        // Check if all gate conditions are met
        const conditions = step.gate_conditions ?? [];
        const allMet = conditions.every((condName) => {
          const condStatus = instanceState.steps[condName];
          return condStatus && condStatus.status === "completed";
        });
        if (!allMet) {
          appendTessella(kernel, process_id, "gate_evaluated", {
            step_name: step.name,
            conditions_met: false,
          });
          break; // Lane is blocked at gate
        }
        // Gate passes
        appendTessella(kernel, process_id, "step_activated", { step_name: step.name, started_at: now });
        appendTessella(kernel, process_id, "gate_evaluated", { step_name: step.name, conditions_met: true });
        appendTessella(kernel, process_id, "step_completed", { step_name: step.name, completed_at: now });
        madeProgress = true;
        continue; // Process next step in lane
      }

      // Activate the step
      appendTessella(kernel, process_id, "step_activated", { step_name: step.name, started_at: now });

      if (step.type === "action_step") {
        // Re-read state after activation
        const freshState = getProcessStatus(kernel, process_id);
        const ok = _executeActionStep(kernel, process_id, step, freshState);
        madeProgress = true;
        if (!ok) break; // Lane failed
        continue; // Process next step in lane
      }

      if (step.type === "task_step") {
        const freshState = getProcessStatus(kernel, process_id);
        _executeTaskStep(kernel, process_id, step, freshState);
        // Task step is now active, waiting for completion
        break; // Lane waits for task
      }

      if (step.type === "fetch_step") {
        const freshState = getProcessStatus(kernel, process_id);
        _executeFetchStep(kernel, process_id, step, freshState);
        madeProgress = true;
        continue; // Process next step in lane
      }

      if (step.type === "branch_step") {
        const freshState = getProcessStatus(kernel, process_id);
        _executeBranchStep(kernel, process_id, step, freshState, def);
        madeProgress = true;
        continue; // Process next step in lane
      }

      break; // Unknown step type
    }
  }

  // If we made progress, re-check (recursive) — gates may now pass
  if (madeProgress) {
    _advanceProcess(kernel, process_id, def);
    return;
  }

  // Check if process is complete: all steps completed or skipped
  const finalState = getProcessStatus(kernel, process_id);
  if (finalState.status !== "running") return;

  const allSteps = Object.values(def.steps);
  const allDone = allSteps.every((step) => {
    const s = finalState.steps[step.name];
    return s && (s.status === "completed" || s.status === "skipped");
  });

  if (allDone) {
    appendTessella(kernel, process_id, "process_completed", { completed_at: now });
  }

  // Check if any step failed and there are no more active steps
  const anyFailed = allSteps.some((step) => {
    const s = finalState.steps[step.name];
    return s && s.status === "failed";
  });
  const anyActive = allSteps.some((step) => {
    const s = finalState.steps[step.name];
    return s && s.status === "active";
  });
  if (anyFailed && !anyActive && !allDone) {
    appendTessella(kernel, process_id, "process_failed", { completed_at: now, reason: "Step failure" });
  }
}

// --- Task completion hook ---

function _checkProcessTaskCompletion(kernel: Kernel, task_id: string): void {
  const taskState = materialize(kernel, task_id);
  const contextRaw = taskState.context_res_ids as string | undefined;
  if (!contextRaw) return;

  let contextIds: string[];
  try {
    contextIds = JSON.parse(contextRaw);
  } catch {
    return;
  }

  for (const resId of contextIds) {
    // Check if this res is a process instance (its genus has kind=process)
    let res: Res;
    try {
      res = getRes(kernel, resId);
    } catch {
      continue;
    }

    // The genus_id of a process instance is the process genus
    let processDef: ProcessDef;
    try {
      processDef = getProcessDef(kernel, res.genus_id);
    } catch {
      continue;
    }
    if (processDef.meta.kind !== "process") continue;

    // This is a process instance — find the step with this task_id
    const instanceState = getProcessStatus(kernel, resId);
    if (instanceState.status !== "running") continue;

    for (const [stepName, stepStatus] of Object.entries(instanceState.steps)) {
      if (stepStatus.task_id === task_id && stepStatus.status === "active") {
        const now = new Date().toISOString();
        appendTessella(kernel, resId, "step_completed", {
          step_name: stepName,
          completed_at: now,
          result: taskState.result,
        });
        _advanceProcess(kernel, resId, processDef);
        break;
      }
    }
  }
}

// ============================================================================
// SECTION: Cron
// ============================================================================
//
// Summary:
//   Scheduled automation via cron expressions. Cron schedules are sentinel
//   entities that trigger actions or processes on a recurring basis. The kernel
//   exposes a tickCron function called every 60s by the server.
//
// Usage:
//   const id = createCronSchedule(kernel, {
//     name: "Nightly audit",
//     expression: "0 0 * * *",
//     target_type: "action",
//     target_genus_id: auditActionId,
//     target_config: JSON.stringify({ resource_bindings: {}, params: {} }),
//   });
//   const result = tickCron(kernel); // { fired: [...], skipped: 0, checked: 1 }
//
// Design notes:
//   - State machine (active/paused/retired) replaces an enabled boolean.
//   - last_fired_at tracked via setAttribute; tessella history is the audit log.
//   - Cron parser supports 5-field expressions + @daily/@hourly/@weekly/@monthly.
//   - tickCron is a pure kernel function — server.ts just calls setInterval.
//

// --- Types ---

interface CronFields {
  minute: Set<number>;
  hour: Set<number>;
  dayOfMonth: Set<number>;
  month: Set<number>;
  dayOfWeek: Set<number>;
}

export interface CronScheduleSummary {
  id: string;
  name: string;
  expression: string;
  target_type: string;
  target_genus_id: string;
  status: string;
  last_fired_at?: string;
  scheduled_at?: string;
}

export interface CronFireResult {
  schedule_id: string;
  name: string;
  target_type: string;
  fired_at: string;
  result: unknown;
}

export interface CronTickResult {
  fired: CronFireResult[];
  skipped: number;
  checked: number;
}

// --- Cron parser ---

function _parseCronField(field: string, min: number, max: number): Set<number> {
  const result = new Set<number>();
  for (const part of field.split(",")) {
    const stepMatch = part.match(/^(.+)\/(\d+)$/);
    const step = stepMatch ? parseInt(stepMatch[2], 10) : 1;
    const range = stepMatch ? stepMatch[1] : part;

    if (range === "*") {
      for (let i = min; i <= max; i += step) result.add(i);
    } else if (range.includes("-")) {
      const [lo, hi] = range.split("-").map(Number);
      if (isNaN(lo) || isNaN(hi) || lo < min || hi > max || lo > hi) {
        throw new Error(`Invalid cron range: ${part} (valid range: ${min}-${max})`);
      }
      for (let i = lo; i <= hi; i += step) result.add(i);
    } else {
      const num = parseInt(range, 10);
      if (isNaN(num) || num < min || num > max) {
        throw new Error(`Invalid cron value: ${part} (valid range: ${min}-${max})`);
      }
      result.add(num);
    }
  }
  return result;
}

const _CRON_ALIASES: Record<string, string> = {
  "@daily": "0 0 * * *",
  "@hourly": "0 * * * *",
  "@weekly": "0 0 * * 0",
  "@monthly": "0 0 1 * *",
};

export function parseCron(expression: string): CronFields {
  const resolved = _CRON_ALIASES[expression.trim()] ?? expression.trim();
  const parts = resolved.split(/\s+/);
  if (parts.length !== 5) {
    throw new Error(`Invalid cron expression (expected 5 fields): ${expression}`);
  }
  return {
    minute: _parseCronField(parts[0], 0, 59),
    hour: _parseCronField(parts[1], 0, 23),
    dayOfMonth: _parseCronField(parts[2], 1, 31),
    month: _parseCronField(parts[3], 1, 12),
    dayOfWeek: _parseCronField(parts[4], 0, 6),
  };
}

export function matchesCron(expression: string, date: Date): boolean {
  const fields = parseCron(expression);
  return (
    fields.minute.has(date.getUTCMinutes()) &&
    fields.hour.has(date.getUTCHours()) &&
    fields.dayOfMonth.has(date.getUTCDate()) &&
    fields.month.has(date.getUTCMonth() + 1) &&
    fields.dayOfWeek.has(date.getUTCDay())
  );
}

// --- Core functions ---

export function createCronSchedule(
  kernel: Kernel,
  opts: {
    name: string;
    expression: string;
    target_type: "action" | "process";
    target_genus_id: string;
    target_config?: string;
  },
): string {
  // Validate expression early
  parseCron(opts.expression);

  if (opts.target_type !== "action" && opts.target_type !== "process") {
    throw new Error(`Invalid target_type: ${opts.target_type}`);
  }

  const id = createEntity(kernel, CRON_SCHEDULE_GENUS_ID);
  setAttribute(kernel, id, "name", opts.name);
  setAttribute(kernel, id, "expression", opts.expression);
  setAttribute(kernel, id, "target_type", opts.target_type);
  setAttribute(kernel, id, "target_genus_id", opts.target_genus_id);
  if (opts.target_config) {
    setAttribute(kernel, id, "target_config", opts.target_config);
  }
  return id;
}

export function parseDelay(delay: string): number {
  const match = delay.trim().match(/^(\d+)\s*(s|m|h|d)$/);
  if (!match) throw new Error(`Invalid delay format: ${delay}. Expected format like "30s", "90m", "2h", "1d".`);
  const value = parseInt(match[1], 10);
  const unit = match[2];
  const multipliers: Record<string, number> = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 };
  return value * multipliers[unit];
}

export function createScheduledTrigger(
  kernel: Kernel,
  opts: {
    name: string;
    scheduled_at: string;
    target_type: "action" | "process";
    target_genus_id: string;
    target_config?: string;
  },
): string {
  const parsed = new Date(opts.scheduled_at);
  if (isNaN(parsed.getTime())) {
    throw new Error(`Invalid scheduled_at date: ${opts.scheduled_at}`);
  }
  if (opts.target_type !== "action" && opts.target_type !== "process") {
    throw new Error(`Invalid target_type: ${opts.target_type}`);
  }

  const id = createEntity(kernel, CRON_SCHEDULE_GENUS_ID);
  setAttribute(kernel, id, "name", opts.name);
  setAttribute(kernel, id, "expression", "");
  setAttribute(kernel, id, "target_type", opts.target_type);
  setAttribute(kernel, id, "target_genus_id", opts.target_genus_id);
  setAttribute(kernel, id, "scheduled_at", opts.scheduled_at);
  if (opts.target_config) {
    setAttribute(kernel, id, "target_config", opts.target_config);
  }
  return id;
}

export function listCronSchedules(kernel: Kernel): CronScheduleSummary[] {
  let cronSql = "SELECT id FROM res WHERE genus_id = ?";
  const cronParams: any[] = [CRON_SCHEDULE_GENUS_ID];
  if (kernel.currentWorkspace) {
    cronSql += " AND (workspace_id = ? OR workspace_id IS NULL)";
    cronParams.push(kernel.currentWorkspace);
  }
  cronSql += " ORDER BY created_at ASC";
  const rows = kernel.db.query(cronSql).all(...cronParams) as { id: string }[];

  return rows.map((row) => {
    const state = materialize(kernel, row.id, { branch_id: kernel.currentBranch });
    return {
      id: row.id,
      name: state.name as string,
      expression: state.expression as string,
      target_type: state.target_type as string,
      target_genus_id: state.target_genus_id as string,
      status: state.status as string,
      ...(state.last_fired_at ? { last_fired_at: state.last_fired_at as string } : {}),
      ...(state.scheduled_at ? { scheduled_at: state.scheduled_at as string } : {}),
    };
  });
}

export function fireCronSchedule(kernel: Kernel, schedule_id: string, opts?: { now?: Date }): CronFireResult {
  const state = materialize(kernel, schedule_id, { branch_id: kernel.currentBranch });
  const name = state.name as string;
  const targetType = state.target_type as string;
  const targetGenusId = state.target_genus_id as string;
  const targetConfigRaw = state.target_config as string | undefined;
  const now = (opts?.now ?? new Date()).toISOString();

  let result: unknown;
  if (targetType === "action") {
    const config = targetConfigRaw ? JSON.parse(targetConfigRaw) : {};
    result = executeAction(
      kernel,
      targetGenusId,
      config.resource_bindings ?? {},
      config.params ?? {},
      { source: "cron" },
    );
  } else if (targetType === "process") {
    const config = targetConfigRaw ? JSON.parse(targetConfigRaw) : {};
    result = startProcess(kernel, targetGenusId, {
      context_res_id: config.context_res_id,
    });
  } else {
    throw new Error(`Unknown target_type: ${targetType}`);
  }

  setAttribute(kernel, schedule_id, "last_fired_at", now);

  return { schedule_id, name, target_type: targetType, fired_at: now, result };
}

export function tickCron(kernel: Kernel, now?: Date): CronTickResult {
  const currentTime = now ?? new Date();
  const schedules = listCronSchedules(kernel);
  const fired: CronFireResult[] = [];
  let skipped = 0;

  // Format current minute for dedup (UTC)
  const currentMinute = `${currentTime.getUTCFullYear()}-${String(currentTime.getUTCMonth() + 1).padStart(2, "0")}-${String(currentTime.getUTCDate()).padStart(2, "0")}T${String(currentTime.getUTCHours()).padStart(2, "0")}:${String(currentTime.getUTCMinutes()).padStart(2, "0")}`;

  for (const schedule of schedules) {
    if (schedule.status !== "active") {
      skipped++;
      continue;
    }

    // One-time trigger check
    const scheduledAt = schedule.scheduled_at;
    if (scheduledAt) {
      const triggerTime = new Date(scheduledAt);
      if (currentTime >= triggerTime) {
        try {
          const result = fireCronSchedule(kernel, schedule.id, { now: currentTime });
          fired.push(result);
          // Auto-retire one-time trigger
          transitionStatus(kernel, schedule.id, "retired");
        } catch (e) {
          console.error(`Scheduled trigger fire error for ${schedule.name}:`, e);
          skipped++;
        }
      }
      continue; // Skip cron expression matching
    }

    if (!matchesCron(schedule.expression, currentTime)) {
      continue;
    }

    // Check if already fired this minute
    if (schedule.last_fired_at) {
      const lastFired = new Date(schedule.last_fired_at);
      const lastMinute = `${lastFired.getUTCFullYear()}-${String(lastFired.getUTCMonth() + 1).padStart(2, "0")}-${String(lastFired.getUTCDate()).padStart(2, "0")}T${String(lastFired.getUTCHours()).padStart(2, "0")}:${String(lastFired.getUTCMinutes()).padStart(2, "0")}`;
      if (lastMinute === currentMinute) {
        skipped++;
        continue;
      }
    }

    try {
      const result = fireCronSchedule(kernel, schedule.id, { now: currentTime });
      fired.push(result);
    } catch (e) {
      console.error(`Cron fire error for ${schedule.name}:`, e);
      skipped++;
    }
  }

  return { fired, skipped, checked: schedules.length };
}

// ============================================================================
// SECTION: Branches
// ============================================================================
//
// Summary:
//   Branch and merge for isolated changes. Create a branch from the current
//   state, make changes in isolation, then merge back. Branch metadata lives
//   as sentinel BRANCH_GENUS_ID entities on "main".
//
// Usage:
//   createBranch(kernel, "experiment");
//   switchBranch(kernel, "experiment");
//   setAttribute(kernel, entityId, "title", "New Title");
//   switchBranch(kernel, "main");
//   // main still has original title
//   mergeBranch(kernel, "experiment", "main");
//   // main now has "New Title"
//
// Design notes:
//   - Branches are entities under BRANCH_GENUS_ID, always stored on "main".
//   - Branch-aware materialization walks the parent chain and builds OR clauses.
//   - Merge copies tessellae from source to target (replay-on-merge strategy).
//   - Conflict detection checks for res_ids modified on both branches.
//

// --- Types ---

export interface BranchSummary {
  id: string;
  name: string;
  parent_branch: string;
  branch_point: number;
  status: string;
}

export interface MergeResult {
  merged: boolean;
  conflicts?: ConflictInfo[];
  tessellae_copied?: number;
}

export interface ConflictInfo {
  res_id: string;
  genus_name: string;
  source_state: Record<string, unknown>;
  target_state: Record<string, unknown>;
}

// --- Internal helpers ---

function _findBranchByName(
  kernel: Kernel,
  name: string,
): { id: string; name: string; parent_branch: string; branch_point: number; status: string } | null {
  if (name === "main") {
    // Find the bootstrapped "main" branch entity
    const rows = kernel.db.query(
      "SELECT id FROM res WHERE genus_id = ? ORDER BY created_at ASC",
    ).all(BRANCH_GENUS_ID) as { id: string }[];
    for (const row of rows) {
      const state = materialize(kernel, row.id, { branch_id: "main" });
      if (state.name === "main") {
        return {
          id: row.id,
          name: "main",
          parent_branch: "",
          branch_point: 0,
          status: (state.status as string) ?? "active",
        };
      }
    }
    return null;
  }
  const rows = kernel.db.query(
    "SELECT id FROM res WHERE genus_id = ? ORDER BY created_at ASC",
  ).all(BRANCH_GENUS_ID) as { id: string }[];
  for (const row of rows) {
    const state = materialize(kernel, row.id, { branch_id: "main" });
    if ((state.name as string) === name) {
      return {
        id: row.id,
        name,
        parent_branch: (state.parent_branch as string) ?? "main",
        branch_point: (state.branch_point as number) ?? 0,
        status: (state.status as string) ?? "active",
      };
    }
  }
  return null;
}

// --- Core functions ---

export function createBranch(
  kernel: Kernel,
  name: string,
  parent?: string,
): BranchSummary {
  // Enforce unique name
  if (_findBranchByName(kernel, name)) {
    throw new Error(`Branch "${name}" already exists`);
  }

  const parentBranch = parent ?? kernel.currentBranch;

  // Get current max tessella id as branch point
  const maxRow = kernel.db.query("SELECT MAX(id) as max_id FROM tessella").get() as { max_id: number | null };
  const branchPoint = maxRow.max_id ?? 0;

  // Create branch entity on "main"
  const branchId = createRes(kernel, BRANCH_GENUS_ID, "main");
  appendTessella(kernel, branchId, "attribute_set", { key: "name", value: name });
  appendTessella(kernel, branchId, "attribute_set", { key: "parent_branch", value: parentBranch });
  appendTessella(kernel, branchId, "attribute_set", { key: "branch_point", value: branchPoint });
  appendTessella(kernel, branchId, "status_changed", { status: "active" });

  return {
    id: branchId,
    name,
    parent_branch: parentBranch,
    branch_point: branchPoint,
    status: "active",
  };
}

export function switchBranch(kernel: Kernel, name: string): void {
  if (name === "main") {
    kernel.currentBranch = "main";
    return;
  }
  const branch = _findBranchByName(kernel, name);
  if (!branch) {
    throw new Error(`Branch "${name}" not found`);
  }
  if (branch.status !== "active") {
    throw new Error(`Branch "${name}" is ${branch.status}, cannot switch to it`);
  }
  kernel.currentBranch = name;
}

export function listBranches(kernel: Kernel): BranchSummary[] {
  const rows = kernel.db.query(
    "SELECT id FROM res WHERE genus_id = ? ORDER BY created_at ASC",
  ).all(BRANCH_GENUS_ID) as { id: string }[];

  return rows.map((row) => {
    const state = materialize(kernel, row.id, { branch_id: "main" });
    return {
      id: row.id,
      name: (state.name as string) ?? "",
      parent_branch: (state.parent_branch as string) ?? "",
      branch_point: (state.branch_point as number) ?? 0,
      status: (state.status as string) ?? "active",
    };
  });
}

export function findBranchByName(
  kernel: Kernel,
  name: string,
): BranchSummary | null {
  const branch = _findBranchByName(kernel, name);
  if (!branch) return null;
  return branch;
}

export function detectConflicts(
  kernel: Kernel,
  source: string,
  target: string,
): ConflictInfo[] {
  const sourceBranch = _findBranchByName(kernel, source);
  if (!sourceBranch) throw new Error(`Branch "${source}" not found`);

  // Find res_ids with tessellae on the source branch
  const sourceRows = kernel.db.query(
    "SELECT DISTINCT res_id FROM tessella WHERE branch_id = ?",
  ).all(source) as { res_id: string }[];

  const conflicts: ConflictInfo[] = [];
  for (const { res_id } of sourceRows) {
    // Check if target also has tessellae for this res_id after branch_point
    const targetRows = kernel.db.query(
      "SELECT COUNT(*) as cnt FROM tessella WHERE res_id = ? AND branch_id = ? AND id > ?",
    ).get(res_id, target, sourceBranch.branch_point) as { cnt: number };

    if (targetRows.cnt > 0) {
      // Both branches modified this entity
      const sourceState = materialize(kernel, res_id, { branch_id: source });
      const targetState = materialize(kernel, res_id, { branch_id: target });

      let genusName = "";
      try {
        const res = getRes(kernel, res_id);
        const def = getGenusDef(kernel, res.genus_id);
        genusName = (def.meta.name as string) ?? "";
      } catch {}

      conflicts.push({
        res_id,
        genus_name: genusName,
        source_state: sourceState,
        target_state: targetState,
      });
    }
  }

  return conflicts;
}

export function mergeBranch(
  kernel: Kernel,
  source: string,
  target?: string,
  opts?: { force?: boolean },
): MergeResult {
  const targetBranch = target ?? "main";
  const sourceBranch = _findBranchByName(kernel, source);
  if (!sourceBranch) throw new Error(`Branch "${source}" not found`);
  if (sourceBranch.status !== "active") {
    throw new Error(`Branch "${source}" is ${sourceBranch.status}, cannot merge`);
  }

  // Detect conflicts
  if (!opts?.force) {
    const conflicts = detectConflicts(kernel, source, targetBranch);
    if (conflicts.length > 0) {
      return { merged: false, conflicts };
    }
  }

  // Copy all tessellae from source branch to target branch
  const sourceTag = `merge:${source}`;
  const rows = kernel.db.query(
    "SELECT * FROM tessella WHERE branch_id = ? ORDER BY id ASC",
  ).all(source) as any[];

  const doMerge = kernel.db.transaction(() => {
    for (const row of rows) {
      kernel.db.run(
        "INSERT INTO tessella (res_id, branch_id, type, data, created_at, source) VALUES (?, ?, ?, ?, ?, ?)",
        [row.res_id, targetBranch, row.type, row.data, row.created_at, sourceTag],
      );
    }
  });
  doMerge();

  // Rebuild index tables that aren't updated by tessella copy
  _rebuildIndexesForMerge(kernel, source, targetBranch);

  // Mark source as merged (on "main" since branch entities live there)
  transitionStatus(kernel, sourceBranch.id, "merged", { branch_id: "main" });

  return { merged: true, tessellae_copied: rows.length };
}

function _rebuildIndexesForMerge(
  kernel: Kernel,
  sourceBranch: string,
  targetBranch: string,
): void {
  const mergeSource = `merge:${sourceBranch}`;

  // Clean up source branch index entries first (branch is about to be marked "merged").
  // This must happen before rebuilds because palace_scroll_index has res_id as PRIMARY KEY —
  // INSERT OR IGNORE would skip if the source branch entry still exists.
  kernel.db.run("DELETE FROM palace_room_index WHERE branch_id = ?", [sourceBranch]);
  kernel.db.run("DELETE FROM palace_scroll_index WHERE branch_id = ?", [sourceBranch]);
  kernel.db.run("DELETE FROM relationship_member WHERE branch_id = ?", [sourceBranch]);

  // 1a. Palace Room Index Rebuild
  const mergedRoomResIds = kernel.db.query(
    `SELECT DISTINCT t.res_id FROM tessella t
     JOIN res r ON r.id = t.res_id
     WHERE t.source = ? AND t.branch_id = ? AND r.genus_id = ?`,
  ).all(mergeSource, targetBranch, PALACE_ROOM_GENUS_ID) as { res_id: string }[];

  for (const { res_id } of mergedRoomResIds) {
    const state = materialize(kernel, res_id, { branch_id: targetBranch });
    const wsRow = kernel.db.query("SELECT workspace_id FROM res WHERE id = ?").get(res_id) as { workspace_id: string };
    if (state.status === "archived") {
      // Room was deleted on branch — insert tombstone on target
      kernel.db.run(
        "INSERT OR REPLACE INTO palace_room_index (workspace_id, slug, branch_id, res_id, entry) VALUES (?, ?, ?, '', 0)",
        [wsRow.workspace_id, state.slug, targetBranch],
      );
    } else {
      kernel.db.run(
        "INSERT OR REPLACE INTO palace_room_index (workspace_id, slug, branch_id, res_id, entry) VALUES (?, ?, ?, ?, ?)",
        [wsRow.workspace_id, state.slug, targetBranch, res_id, state.entry === true ? 1 : 0],
      );
    }
  }

  // 1b. Palace Scroll Index Rebuild
  const mergedScrollResIds = kernel.db.query(
    `SELECT DISTINCT t.res_id FROM tessella t
     JOIN res r ON r.id = t.res_id
     WHERE t.source = ? AND t.branch_id = ? AND r.genus_id = ?`,
  ).all(mergeSource, targetBranch, PALACE_SCROLL_GENUS_ID) as { res_id: string }[];

  for (const { res_id } of mergedScrollResIds) {
    const state = materialize(kernel, res_id, { branch_id: targetBranch });
    const resRow = kernel.db.query("SELECT workspace_id, created_at FROM res WHERE id = ?").get(res_id) as { workspace_id: string; created_at: string };
    kernel.db.run(
      "INSERT OR IGNORE INTO palace_scroll_index (res_id, workspace_id, room_id, branch_id, created_at) VALUES (?, ?, ?, ?, ?)",
      [res_id, resRow.workspace_id, state.room_id, targetBranch, resRow.created_at],
    );
  }

  // 1c. Palace NPC Index Rebuild
  const mergedNpcResIds = kernel.db.query(
    `SELECT DISTINCT t.res_id FROM tessella t
     JOIN res r ON r.id = t.res_id
     WHERE t.source = ? AND t.branch_id = ? AND r.genus_id = ?`,
  ).all(mergeSource, targetBranch, PALACE_NPC_GENUS_ID) as { res_id: string }[];

  for (const { res_id } of mergedNpcResIds) {
    const state = materialize(kernel, res_id, { branch_id: targetBranch });
    const wsRow = kernel.db.query("SELECT workspace_id FROM res WHERE id = ?").get(res_id) as { workspace_id: string };
    if (state.status === "archived") {
      kernel.db.run(
        "INSERT OR REPLACE INTO palace_npc_index (workspace_id, slug, room_slug, branch_id, res_id) VALUES (?, ?, ?, ?, '')",
        [wsRow.workspace_id, state.slug, state.room_slug ?? "", targetBranch],
      );
    } else {
      kernel.db.run(
        "INSERT OR REPLACE INTO palace_npc_index (workspace_id, slug, room_slug, branch_id, res_id) VALUES (?, ?, ?, ?, ?)",
        [wsRow.workspace_id, state.slug, state.room_slug, targetBranch, res_id],
      );
    }
  }

  // 1d. Relationship Member Index Rebuild
  const mergedRelResIds = kernel.db.query(
    `SELECT DISTINCT t.res_id FROM tessella t
     WHERE t.source = ? AND t.branch_id = ? AND t.type IN ('member_added', 'member_removed')`,
  ).all(mergeSource, targetBranch) as { res_id: string }[];

  for (const { res_id } of mergedRelResIds) {
    // Clear existing index entries for this relationship on target branch
    kernel.db.run(
      "DELETE FROM relationship_member WHERE relationship_id = ? AND branch_id = ?",
      [res_id, targetBranch],
    );
    // Replay to get final member set
    const state = materialize(kernel, res_id, { branch_id: targetBranch });
    const members = (state.members as Record<string, string[]>) ?? {};
    for (const [role, entityIds] of Object.entries(members)) {
      for (const entityId of entityIds) {
        kernel.db.run(
          "INSERT INTO relationship_member (relationship_id, role, entity_id, branch_id) VALUES (?, ?, ?, ?)",
          [res_id, role, entityId, targetBranch],
        );
      }
    }
  }

}

export function discardBranch(kernel: Kernel, name: string): void {
  if (name === "main") throw new Error("Cannot discard main branch");
  const branch = _findBranchByName(kernel, name);
  if (!branch) throw new Error(`Branch "${name}" not found`);
  if (branch.status !== "active") {
    throw new Error(`Branch "${name}" is ${branch.status}, cannot discard`);
  }
  transitionStatus(kernel, branch.id, "discarded", { branch_id: "main" });
  if (kernel.currentBranch === name) {
    kernel.currentBranch = "main";
  }
}

export function compareBranches(
  kernel: Kernel,
  res_id: string,
  branch_a: string,
  branch_b: string,
): { branch_a: Record<string, unknown>; branch_b: Record<string, unknown> } {
  const stateA = materialize(kernel, res_id, { branch_id: branch_a });
  const stateB = materialize(kernel, res_id, { branch_id: branch_b });
  return { branch_a: stateA, branch_b: stateB };
}

// ============================================================================
// SECTION: Serialization
// ============================================================================
//
// Summary:
//   Export entities to file trees (markdown format), edit files externally,
//   and import changes back as tessellae. Serialization targets are genera
//   under META_GENUS_ID with meta.kind = "serialization".
//
// Usage:
//   const targetId = defineSerializationGenus(kernel, "Markdown Export", {
//     input: { query_type: "by_genus", genus_name: "Issue" },
//     output: { format: "markdown", output_shape: "filetree" },
//     handler: [
//       { type: "directory", name: "{{entity.title}}", children: [
//         { type: "file", name: "index.md", body_attribute: "description",
//           content: "---\ntitle: {{entity.title}}\n---\n{{entity.description}}" },
//       ]},
//     ],
//   });
//   const result = runSerialization(kernel, targetId);
//   writeFiletree(result.filetree, "/tmp/export");
//   // ... edit files externally ...
//   const imported = importFiletree(kernel, "/tmp/export");
//
// Design notes:
//   - Handler is a FileOp[] DSL evaluated once per entity (runner iterates entities).
//   - Template uses {{...}} delimiters (not $ like actions) for markdown-friendly content.
//   - Import uses frontmatter parsing + diff against current state; status is read-only.
//   - Manifest (_manifest.json) embeds entity-to-file mapping for round-trip import.
//

// --- Types ---

export interface FiletreeNode {
  name: string;
  type: "file" | "directory";
  content?: string;
  children?: FiletreeNode[];
}

export type FileOp =
  | { type: "file"; name: string; content: string; body_attribute?: string }
  | { type: "directory"; name: string; children: FileOp[] }
  | { type: "for_each_feature"; genus_name?: string; children: FileOp[] };

export interface SerializationInputDef {
  query_type: "by_genus" | "by_id";
  genus_name?: string;
}

export interface SerializationOutputDef {
  format: "markdown";
  output_shape: "filetree";
}

export interface SerializationDef {
  input: SerializationInputDef;
  output: SerializationOutputDef;
  handler: FileOp[];
  meta: Record<string, unknown>;
}

export interface DefineSerializationGenusOptions {
  input: SerializationInputDef;
  output: SerializationOutputDef;
  handler: FileOp[];
  meta?: Record<string, unknown>;
  taxonomy_id?: string;
}

export interface ManifestFeature {
  file: string;
  body_attribute?: string;
  genus_name: string;
}

export interface ManifestEntity {
  genus_name: string;
  directory: string;
  files: Record<string, { body_attribute?: string }>;
  features: Record<string, ManifestFeature>;
}

export interface SerializationManifest {
  target_genus_id: string;
  target_name: string;
  exported_at: string;
  entities: Record<string, ManifestEntity>;
}

export interface SerializationResult {
  filetree: FiletreeNode;
  manifest: SerializationManifest;
  entity_ids: string[];
}

export interface ImportChange {
  type: "attribute_set" | "feature_attribute_set";
  entity_id: string;
  feature_id?: string;
  attribute: string;
  old_value: unknown;
  new_value: unknown;
}

export interface ImportResult {
  entity_id: string;
  changes: ImportChange[];
  tessellae_created: number;
  skipped: { field: string; reason: string }[];
}

export interface SerializationGenusSummary {
  id: string;
  name: string;
  def: SerializationDef;
}

// --- Core functions ---

export function serializationReducer(state: Record<string, unknown>, tessella: Tessella): Record<string, unknown> {
  switch (tessella.type) {
    case "created":
      return { input: null, output: null, handler: [], meta: {} };
    case "serialization_input_defined": {
      const data = tessella.data as SerializationInputDef;
      return { ...state, input: data };
    }
    case "serialization_output_defined": {
      const data = tessella.data as SerializationOutputDef;
      return { ...state, output: data };
    }
    case "serialization_handler_defined": {
      const { handler } = tessella.data as { handler: FileOp[] };
      return { ...state, handler };
    }
    case "genus_meta_set": {
      let { key, value } = tessella.data as { key: string; value: unknown };
      if (key === "domain_id" || key === "ontology_id") key = "taxonomy_id"; // backwards compat
      const meta = { ...(state.meta as Record<string, unknown>), [key]: value };
      return { ...state, meta };
    }
    default:
      return state;
  }
}

export function getSerializationDef(kernel: Kernel, genus_id: string): SerializationDef {
  const raw = materialize(kernel, genus_id, { branch_id: "main", reducer: serializationReducer });
  return {
    input: (raw.input as SerializationInputDef) ?? { query_type: "by_genus" },
    output: (raw.output as SerializationOutputDef) ?? { format: "markdown", output_shape: "filetree" },
    handler: (raw.handler as FileOp[]) ?? [],
    meta: (raw.meta as Record<string, unknown>) ?? {},
  };
}

export function defineSerializationGenus(
  kernel: Kernel,
  name: string,
  opts: DefineSerializationGenusOptions,
): string {
  const effectiveOntologyId = opts.taxonomy_id ?? DEFAULT_TAXONOMY_ID;
  _checkTaxonomyNotArchived(kernel, effectiveOntologyId);

  const genusId = createRes(kernel, META_GENUS_ID);
  appendTessella(kernel, genusId, "genus_meta_set", { key: "name", value: name });
  appendTessella(kernel, genusId, "genus_meta_set", { key: "kind", value: "serialization" });
  appendTessella(kernel, genusId, "genus_meta_set", { key: "taxonomy_id", value: effectiveOntologyId });

  appendTessella(kernel, genusId, "serialization_input_defined", opts.input);
  appendTessella(kernel, genusId, "serialization_output_defined", opts.output);
  appendTessella(kernel, genusId, "serialization_handler_defined", { handler: opts.handler });

  if (opts.meta) {
    for (const [key, value] of Object.entries(opts.meta)) {
      appendTessella(kernel, genusId, "genus_meta_set", { key, value });
    }
  }

  return genusId;
}

export function findSerializationGenusByName(kernel: Kernel, name: string): string | null {
  const targets = listSerializationGenera(kernel);
  const lower = name.toLowerCase();
  const match = targets.find((t) => t.name.toLowerCase() === lower);
  return match ? match.id : null;
}

export function listSerializationGenera(kernel: Kernel, opts?: { taxonomy_id?: string }): SerializationGenusSummary[] {
  const rows = kernel.db.query(
    "SELECT id FROM res WHERE genus_id = ? AND id != ? AND id != ? ORDER BY created_at ASC",
  ).all(META_GENUS_ID, META_GENUS_ID, LOG_GENUS_ID) as { id: string }[];

  const results: SerializationGenusSummary[] = [];
  for (const row of rows) {
    const def = getSerializationDef(kernel, row.id);
    if (def.meta.kind === "serialization") {
      if (opts?.taxonomy_id && (def.meta.taxonomy_id ?? DEFAULT_TAXONOMY_ID) !== opts.taxonomy_id) continue;
      results.push({ id: row.id, name: (def.meta.name as string) ?? "", def });
    }
  }
  return results;
}

// --- Template substitution ---

function _substituteTemplate(
  template: string,
  context: {
    entity?: { id: string; genus: string; status: string; attrs: Record<string, unknown> };
    feature?: { id: string; genus: string; status: string; attrs: Record<string, unknown> };
  },
): string {
  return template.replace(/\{\{(\w+)\.(\w+)\}\}/g, (match, scope, key) => {
    const ctx = scope === "entity" ? context.entity : scope === "feature" ? context.feature : null;
    if (!ctx) return match;

    switch (key) {
      case "id": return ctx.id;
      case "status": return ctx.status;
      case "genus": return ctx.genus;
      default: {
        const val = ctx.attrs[key];
        return val !== undefined && val !== null ? String(val) : "";
      }
    }
  });
}

// --- FileOp evaluation ---

function _evaluateFileOps(
  ops: FileOp[],
  entityContext: {
    id: string;
    genus: string;
    status: string;
    state: Record<string, unknown>;
    genusDef: GenusDef;
  },
  kernel: Kernel,
  manifest: SerializationManifest,
  currentPath: string,
  manifestEntityId: string,
): FiletreeNode[] {
  const nodes: FiletreeNode[] = [];
  // Attributes are stored directly on state (not under .attributes)
  const entityAttrs = entityContext.state as Record<string, unknown>;
  const entityTemplateCtx = {
    id: entityContext.id,
    genus: entityContext.genus,
    status: (entityContext.state.status as string) ?? "",
    attrs: entityAttrs,
  };

  for (const op of ops) {
    switch (op.type) {
      case "file": {
        const fileName = _substituteTemplate(op.name, { entity: entityTemplateCtx });
        const content = _substituteTemplate(op.content, { entity: entityTemplateCtx });
        nodes.push({ name: fileName, type: "file", content });

        // Add to manifest
        const me = manifest.entities[manifestEntityId];
        if (me) {
          me.files[fileName] = op.body_attribute ? { body_attribute: op.body_attribute } : {};
        }
        break;
      }
      case "directory": {
        const dirName = _substituteTemplate(op.name, { entity: entityTemplateCtx });
        const childPath = currentPath ? `${currentPath}/${dirName}` : dirName;

        // Initialize manifest entity with this directory
        const me = manifest.entities[manifestEntityId];
        if (me && !me.directory) {
          me.directory = dirName;
        }

        const children = _evaluateFileOps(
          op.children,
          entityContext,
          kernel,
          manifest,
          childPath,
          manifestEntityId,
        );
        nodes.push({ name: dirName, type: "directory", children });
        break;
      }
      case "for_each_feature": {
        const features = (entityContext.state.features ?? {}) as Record<string, Record<string, unknown>>;
        for (const [featureId, featureState] of Object.entries(features)) {
          // Filter by genus_name if specified
          const featureGenusId = featureState.genus_id as string;
          if (op.genus_name && featureGenusId) {
            const featureGenusDef = getGenusDef(kernel, featureGenusId);
            const featureGenusName = (featureGenusDef.meta.name as string) ?? "";
            if (featureGenusName.toLowerCase() !== op.genus_name.toLowerCase()) continue;
          }

          // Feature attributes are stored directly on the feature object
          const featureAttrs = featureState as Record<string, unknown>;
          const featureGenusName = featureGenusId
            ? ((getGenusDef(kernel, featureGenusId).meta.name as string) ?? "")
            : "";
          const featureTemplateCtx = {
            id: featureId,
            genus: featureGenusName,
            status: (featureState.status as string) ?? "",
            attrs: featureAttrs,
          };

          for (const childOp of op.children) {
            if (childOp.type === "file") {
              const fileName = _substituteTemplate(childOp.name, {
                entity: entityTemplateCtx,
                feature: featureTemplateCtx,
              });
              const content = _substituteTemplate(childOp.content, {
                entity: entityTemplateCtx,
                feature: featureTemplateCtx,
              });
              nodes.push({ name: fileName, type: "file", content });

              // Add feature to manifest
              const me = manifest.entities[manifestEntityId];
              if (me) {
                me.features[featureId] = {
                  file: fileName,
                  body_attribute: childOp.body_attribute,
                  genus_name: featureGenusName,
                };
              }
            } else if (childOp.type === "directory") {
              const dirName = _substituteTemplate(childOp.name, {
                entity: entityTemplateCtx,
                feature: featureTemplateCtx,
              });
              const children = _evaluateFileOps(
                childOp.children,
                entityContext,
                kernel,
                manifest,
                currentPath + "/" + dirName,
                manifestEntityId,
              );
              nodes.push({ name: dirName, type: "directory", children });
            }
          }
        }
        break;
      }
    }
  }

  return nodes;
}

// --- Serialization runner ---

export function runSerialization(
  kernel: Kernel,
  target_genus_id: string,
  params?: { entity_id?: string },
): SerializationResult {
  const def = getSerializationDef(kernel, target_genus_id);
  const targetName = (def.meta.name as string) ?? "";
  const branch_id = kernel.currentBranch;

  // Query entities based on input definition
  let entityIds: string[];
  if (params?.entity_id) {
    entityIds = [params.entity_id];
  } else if (def.input.query_type === "by_genus" && def.input.genus_name) {
    const genusId = findGenusByName(kernel, def.input.genus_name);
    if (!genusId) throw new Error(`Genus not found: ${def.input.genus_name}`);
    entityIds = listEntities(kernel, { genus_id: genusId }).map((e) => e.id);
  } else {
    entityIds = [];
  }

  const manifest: SerializationManifest = {
    target_genus_id,
    target_name: targetName,
    exported_at: new Date().toISOString(),
    entities: {},
  };

  const rootChildren: FiletreeNode[] = [];

  for (const entityId of entityIds) {
    const res = getRes(kernel, entityId);
    const genusDef = getGenusDef(kernel, res.genus_id);
    const genusName = (genusDef.meta.name as string) ?? "";
    const state = materialize(kernel, entityId, { branch_id });

    // Initialize manifest entry
    manifest.entities[entityId] = {
      genus_name: genusName,
      directory: "",
      files: {},
      features: {},
    };

    const entityContext = {
      id: entityId,
      genus: genusName,
      status: (state.status as string) ?? "",
      state,
      genusDef,
    };

    const children = _evaluateFileOps(
      def.handler,
      entityContext,
      kernel,
      manifest,
      "",
      entityId,
    );

    rootChildren.push(...children);
  }

  // Add _manifest.json to root
  const manifestNode: FiletreeNode = {
    name: "_manifest.json",
    type: "file",
    content: JSON.stringify(manifest, null, 2),
  };

  // Build root node
  let filetree: FiletreeNode;
  if (rootChildren.length === 1 && rootChildren[0].type === "directory") {
    // Single entity directory — add manifest inside it
    rootChildren[0].children = rootChildren[0].children ?? [];
    rootChildren[0].children.push(manifestNode);
    filetree = rootChildren[0];
  } else {
    // Wrap in a root directory
    filetree = {
      name: targetName || "export",
      type: "directory",
      children: [...rootChildren, manifestNode],
    };
  }

  // Record serialization run
  kernel.db.run(
    "INSERT INTO serialization_run (id, target_genus_id, direction, entity_ids, tessellae_created, branch_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    [ulid(), target_genus_id, "export", JSON.stringify(entityIds), 0, branch_id, new Date().toISOString()],
  );

  return { filetree, manifest, entity_ids: entityIds };
}

// --- File system operations ---

export function writeFiletree(tree: FiletreeNode, base_path: string): string[] {
  const created: string[] = [];

  function walk(node: FiletreeNode, dir: string): void {
    const fullPath = join(dir, node.name);
    if (node.type === "directory") {
      mkdirSync(fullPath, { recursive: true });
      created.push(fullPath);
      if (node.children) {
        for (const child of node.children) {
          walk(child, fullPath);
        }
      }
    } else {
      writeFileSync(fullPath, node.content ?? "");
      created.push(fullPath);
    }
  }

  walk(tree, base_path);
  return created;
}

export function readFiletree(base_path: string): FiletreeNode {
  function walk(dir: string): FiletreeNode {
    const name = basename(dir);
    const entries = readdirSync(dir);
    const children: FiletreeNode[] = [];

    for (const entry of entries) {
      const fullPath = join(dir, entry);
      const stat = statSync(fullPath);
      if (stat.isDirectory()) {
        children.push(walk(fullPath));
      } else {
        children.push({
          name: entry,
          type: "file",
          content: readFileSync(fullPath, "utf-8"),
        });
      }
    }

    return { name, type: "directory", children };
  }

  return walk(base_path);
}

// --- Frontmatter parsing ---

function _parseFrontmatter(content: string): { frontmatter: Record<string, string>; body: string } {
  const frontmatter: Record<string, string> = {};
  const trimmed = content.trimStart();

  if (!trimmed.startsWith("---")) {
    return { frontmatter, body: content };
  }

  const endIdx = trimmed.indexOf("\n---", 3);
  if (endIdx === -1) {
    return { frontmatter, body: content };
  }

  const fmBlock = trimmed.slice(4, endIdx); // skip opening ---\n
  const lines = fmBlock.split("\n");
  for (const line of lines) {
    const colonIdx = line.indexOf(": ");
    if (colonIdx > 0) {
      const key = line.slice(0, colonIdx).trim();
      const value = line.slice(colonIdx + 2).trim();
      frontmatter[key] = value;
    }
  }

  const body = trimmed.slice(endIdx + 4).trimStart(); // skip \n---\n
  return { frontmatter, body };
}

function _coerceValue(value: string, type: GenusAttributeType): unknown {
  switch (type) {
    case "number": return Number(value);
    case "boolean": return value === "true";
    case "text": return value;
    case "filetree": return JSON.parse(value);
    default: return value;
  }
}

// --- Import ---

export function importFiletree(
  kernel: Kernel,
  base_path: string,
  opts?: { target_genus_id?: string },
): ImportResult[] {
  const branch_id = kernel.currentBranch;

  // Read manifest
  const manifestPath = join(base_path, "_manifest.json");
  if (!existsSync(manifestPath)) {
    throw new Error(`No _manifest.json found at ${base_path}`);
  }
  const manifest: SerializationManifest = JSON.parse(readFileSync(manifestPath, "utf-8"));

  if (opts?.target_genus_id && opts.target_genus_id !== manifest.target_genus_id) {
    throw new Error(`Target genus mismatch: expected ${opts.target_genus_id}, got ${manifest.target_genus_id}`);
  }

  const results: ImportResult[] = [];
  let totalTessellae = 0;

  for (const [entityId, manifestEntry] of Object.entries(manifest.entities)) {
    const result: ImportResult = {
      entity_id: entityId,
      changes: [],
      tessellae_created: 0,
      skipped: [],
    };

    // Materialize current state
    const res = getRes(kernel, entityId);
    const genusDef = getGenusDef(kernel, res.genus_id);
    const currentState = materialize(kernel, entityId, { branch_id });
    // Attributes are stored directly on state (not under .attributes)
    const currentAttrs = currentState as Record<string, unknown>;

    // Process entity files — paths are relative to base_path (where _manifest.json lives)
    for (const [fileName, fileMeta] of Object.entries(manifestEntry.files)) {
      const filePath = join(base_path, fileName);

      if (!existsSync(filePath)) continue;

      const fileContent = readFileSync(filePath, "utf-8");
      const { frontmatter, body } = _parseFrontmatter(fileContent);

      // Process frontmatter attributes
      for (const [key, rawValue] of Object.entries(frontmatter)) {
        if (key === "status" || key === "genus" || key === "id") {
          if (key === "status" && rawValue !== (currentState.status as string)) {
            result.skipped.push({ field: key, reason: "Status changes require transitionStatus" });
          }
          continue;
        }

        const attrDef = genusDef.attributes[key];
        if (!attrDef) continue;

        const coerced = _coerceValue(rawValue, attrDef.type);
        const current = currentAttrs[key];
        if (current !== coerced) {
          setAttribute(kernel, entityId, key, coerced, { branch_id });
          result.changes.push({
            type: "attribute_set",
            entity_id: entityId,
            attribute: key,
            old_value: current,
            new_value: coerced,
          });
          result.tessellae_created++;
        }
      }

      // Process body
      if (fileMeta.body_attribute && body) {
        const attrDef = genusDef.attributes[fileMeta.body_attribute];
        if (attrDef) {
          const current = currentAttrs[fileMeta.body_attribute];
          if (current !== body) {
            setAttribute(kernel, entityId, fileMeta.body_attribute, body, { branch_id });
            result.changes.push({
              type: "attribute_set",
              entity_id: entityId,
              attribute: fileMeta.body_attribute,
              old_value: current,
              new_value: body,
            });
            result.tessellae_created++;
          }
        }
      }
    }

    // Process feature files
    const currentFeatures = (currentState.features ?? {}) as Record<string, Record<string, unknown>>;
    for (const [featureId, featureMeta] of Object.entries(manifestEntry.features)) {
      const featureFilePath = join(base_path, featureMeta.file);

      if (!existsSync(featureFilePath)) continue;

      const featureContent = readFileSync(featureFilePath, "utf-8");
      const { frontmatter, body } = _parseFrontmatter(featureContent);

      const featureState = currentFeatures[featureId] ?? {};
      // Feature attributes are stored directly on the feature object
      const featureAttrs = featureState as Record<string, unknown>;
      const featureGenusId = featureState.genus_id as string;
      const featureGenusDef = featureGenusId ? getGenusDef(kernel, featureGenusId) : null;

      // Process frontmatter
      for (const [key, rawValue] of Object.entries(frontmatter)) {
        if (key === "status" || key === "genus" || key === "id") {
          if (key === "status" && rawValue !== (featureState.status as string)) {
            result.skipped.push({ field: `feature:${featureId}:${key}`, reason: "Status changes require transitionFeatureStatus" });
          }
          continue;
        }

        const attrDef = featureGenusDef?.attributes[key];
        if (!attrDef) continue;

        const coerced = _coerceValue(rawValue, attrDef.type);
        const current = featureAttrs[key];
        if (current !== coerced) {
          setFeatureAttribute(kernel, entityId, featureId, key, coerced, { branch_id });
          result.changes.push({
            type: "feature_attribute_set",
            entity_id: entityId,
            feature_id: featureId,
            attribute: key,
            old_value: current,
            new_value: coerced,
          });
          result.tessellae_created++;
        }
      }

      // Process feature body
      if (featureMeta.body_attribute && body) {
        const attrDef = featureGenusDef?.attributes[featureMeta.body_attribute];
        if (attrDef) {
          const current = featureAttrs[featureMeta.body_attribute];
          if (current !== body) {
            setFeatureAttribute(kernel, entityId, featureId, featureMeta.body_attribute, body, { branch_id });
            result.changes.push({
              type: "feature_attribute_set",
              entity_id: entityId,
              feature_id: featureId,
              attribute: featureMeta.body_attribute,
              old_value: current,
              new_value: body,
            });
            result.tessellae_created++;
          }
        }
      }
    }

    totalTessellae += result.tessellae_created;
    results.push(result);
  }

  // Record import run
  kernel.db.run(
    "INSERT INTO serialization_run (id, target_genus_id, direction, entity_ids, tessellae_created, branch_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    [ulid(), manifest.target_genus_id, "import", JSON.stringify(Object.keys(manifest.entities)), totalTessellae, branch_id, new Date().toISOString()],
  );

  return results;
}

// ============================================================================
// SECTION: Sync
// ============================================================================
//
// Summary:
//   Push/pull sync between kernels. Tracks watermarks in a sync_state table,
//   extracts unpushed tessellae for push, and inserts pulled data with source
//   tagging for deduplication.
//
// Usage:
//   // Client pull:
//   const hwm = getSyncState(kernel, "server_hwm") ?? "0";
//   const pullData = await fetchFromServer(hwm);
//   insertPulledData(kernel, pullData, "sync:http://localhost:3000");
//   setSyncState(kernel, "server_hwm", String(pullData.high_water_mark));
//
//   // Client push:
//   const tessellae = getUnpushedTessellae(kernel);
//   const res = getUnpushedRes(kernel, tessellae);
//   const result = await pushToServer({ res, tessellae });
//   setSyncState(kernel, "last_pushed_local_id", String(maxId));
//
// Design notes:
//   - Server tessella.id is the canonical watermark for pull.
//   - Source tagging prevents echo: pulled data gets source="sync:<url>",
//     pushed data gets source="device:<id>" on the server.
//   - Sentinel res (META, LOG, ERROR) are excluded from sync — both sides
//     bootstrap them via initKernel.
//

// --- Types ---

export interface SyncPullData {
  res: { id: string; genus_id: string; branch_id: string; created_at: string }[];
  tessellae: {
    id: number; res_id: string; branch_id: string; type: string;
    data: any; created_at: string; source: string | null;
  }[];
  high_water_mark: number;
}

export interface SyncPushData {
  res: { id: string; genus_id: string; branch_id: string; created_at?: string }[];
  tessellae: {
    res_id: string; branch_id: string; type: string;
    data: any; created_at: string; source: string | null;
  }[];
}

export interface SyncPushResult {
  accepted: number;
  high_water_mark: number;
}

// --- Core functions ---

export function getSyncState(kernel: Kernel, key: string): string | null {
  const row = kernel.db.query("SELECT value FROM sync_state WHERE key = ?").get(key) as { value: string } | null;
  return row ? row.value : null;
}

export function setSyncState(kernel: Kernel, key: string, value: string): void {
  kernel.db.run(
    "INSERT INTO sync_state (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    [key, value],
  );
}

export function getUnpushedTessellae(kernel: Kernel): Tessella[] {
  const lastPushed = getSyncState(kernel, "last_pushed_local_id");
  const after = lastPushed ? Number(lastPushed) : 0;
  const rows = kernel.db.query(
    "SELECT * FROM tessella WHERE id > ? AND (source IS NULL OR source NOT LIKE 'sync:%') ORDER BY id ASC",
  ).all(after) as any[];
  return rows.map(_rowToTessella);
}

export function getUnpushedRes(kernel: Kernel, tessellae: Tessella[]): Res[] {
  if (tessellae.length === 0) return [];
  const resIds = [...new Set(tessellae.map((t) => t.res_id))];
  const sentinels = [META_GENUS_ID, LOG_GENUS_ID, ERROR_GENUS_ID, TASK_GENUS_ID, BRANCH_GENUS_ID, PALACE_ROOM_GENUS_ID, PALACE_SCROLL_GENUS_ID, PALACE_NPC_GENUS_ID];
  const results: Res[] = [];
  for (const resId of resIds) {
    if (sentinels.includes(resId)) continue;
    const row = kernel.db.query("SELECT * FROM res WHERE id = ?").get(resId) as Res | null;
    if (row) {
      results.push(row);
    }
  }
  return results;
}

export function insertPulledData(kernel: Kernel, data: SyncPullData, sourceTag: string): void {
  const insert = kernel.db.transaction(() => {
    for (const r of data.res) {
      kernel.db.run(
        "INSERT OR IGNORE INTO res (id, genus_id, branch_id, created_at) VALUES (?, ?, ?, ?)",
        [r.id, r.genus_id, r.branch_id, r.created_at],
      );
    }
    for (const t of data.tessellae) {
      kernel.db.run(
        "INSERT INTO tessella (res_id, branch_id, type, data, created_at, source) VALUES (?, ?, ?, ?, ?, ?)",
        [t.res_id, t.branch_id, t.type, JSON.stringify(t.data), t.created_at, sourceTag],
      );
    }
  });
  insert();
}

// ============================================================================
// SECTION: Temporal Anchors
// ============================================================================
//
// Summary:
//   Attach temporal metadata (year ranges) to entities. Uses an index table
//   for fast timeline queries without materializing every entity.
//
// Usage:
//   setTemporalAnchor(kernel, entityId, { start_year: -3000, end_year: -2500, precision: "century" });
//   const anchor = getTemporalAnchor(kernel, entityId);
//   const timeline = queryTimeline(kernel, { start_year: -4000, end_year: -1000 });
//
// Design notes:
//   - Negative years represent BC dates.
//   - Tessellae maintain the audit trail; the temporal_anchor table is the
//     query-optimized index.
//

// --- Types ---

export interface TemporalAnchor {
  res_id: string;
  start_year: number;
  end_year: number | null;
  precision: "exact" | "approximate" | "century" | "millennium";
  calendar_note: string | null;
}

export interface TimelineEntry {
  res_id: string;
  genus_name: string;
  entity_name: string | null;
  start_year: number;
  end_year: number | null;
  precision: string;
  calendar_note: string | null;
  status: string | null;
}

export interface QueryTimelineOptions {
  start_year?: number;
  end_year?: number;
  workspace_id?: string;
  genus_id?: string;
  limit?: number;
}

// --- Core functions ---

export function setTemporalAnchor(
  kernel: Kernel,
  res_id: string,
  anchor: { start_year: number; end_year?: number; precision?: TemporalAnchor["precision"]; calendar_note?: string },
): TemporalAnchor {
  // Validate res exists
  getRes(kernel, res_id);

  const precision = anchor.precision ?? "approximate";
  const end_year = anchor.end_year ?? null;
  const calendar_note = anchor.calendar_note ?? null;

  // Append tessella for audit trail
  appendTessella(kernel, res_id, "temporal_anchor_set", {
    start_year: anchor.start_year,
    end_year,
    precision,
    calendar_note,
  });

  // Get workspace_id from res
  const resRow = kernel.db.query("SELECT workspace_id FROM res WHERE id = ?").get(res_id) as { workspace_id: string | null } | null;
  const workspace_id = resRow?.workspace_id ?? null;

  // Upsert index table
  kernel.db.run(
    `INSERT INTO temporal_anchor (res_id, start_year, end_year, precision, calendar_note, workspace_id)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(res_id) DO UPDATE SET
       start_year = excluded.start_year,
       end_year = excluded.end_year,
       precision = excluded.precision,
       calendar_note = excluded.calendar_note,
       workspace_id = excluded.workspace_id`,
    [res_id, anchor.start_year, end_year, precision, calendar_note, workspace_id],
  );

  return { res_id, start_year: anchor.start_year, end_year, precision, calendar_note };
}

export function getTemporalAnchor(kernel: Kernel, res_id: string): TemporalAnchor | null {
  const row = kernel.db.query(
    "SELECT * FROM temporal_anchor WHERE res_id = ?",
  ).get(res_id) as any | null;
  if (!row) return null;
  return {
    res_id: row.res_id,
    start_year: row.start_year,
    end_year: row.end_year,
    precision: row.precision,
    calendar_note: row.calendar_note,
  };
}

export function removeTemporalAnchor(kernel: Kernel, res_id: string): void {
  getRes(kernel, res_id);
  appendTessella(kernel, res_id, "temporal_anchor_removed", {});
  kernel.db.run("DELETE FROM temporal_anchor WHERE res_id = ?", [res_id]);
}

export function queryTimeline(kernel: Kernel, opts: QueryTimelineOptions = {}): TimelineEntry[] {
  const conditions: string[] = [];
  const params: any[] = [];

  if (opts.start_year !== undefined) {
    // Include anchors that overlap with the query range
    conditions.push("(ta.end_year IS NULL AND ta.start_year >= ? OR ta.end_year >= ?)");
    params.push(opts.start_year, opts.start_year);
  }
  if (opts.end_year !== undefined) {
    conditions.push("ta.start_year <= ?");
    params.push(opts.end_year);
  }
  if (opts.workspace_id) {
    conditions.push("ta.workspace_id = ?");
    params.push(opts.workspace_id);
  }
  if (opts.genus_id) {
    conditions.push("r.genus_id = ?");
    params.push(opts.genus_id);
  }

  let sql = `SELECT ta.*, r.genus_id FROM temporal_anchor ta JOIN res r ON ta.res_id = r.id`;
  if (conditions.length > 0) {
    sql += " WHERE " + conditions.join(" AND ");
  }
  sql += " ORDER BY ta.start_year ASC";

  const limit = opts.limit ?? 50;
  sql += " LIMIT ?";
  params.push(limit);

  const rows = kernel.db.query(sql).all(...params) as any[];

  return rows.map((row) => {
    const genusDef = getGenusDef(kernel, row.genus_id);
    let state: Record<string, unknown>;
    try {
      state = materialize(kernel, row.res_id, { branch_id: kernel.currentBranch });
    } catch {
      state = {};
    }
    return {
      res_id: row.res_id,
      genus_name: (genusDef.meta.name as string) ?? "",
      entity_name: (state.name as string) ?? (state.title as string) ?? null,
      start_year: row.start_year,
      end_year: row.end_year,
      precision: row.precision,
      calendar_note: row.calendar_note,
      status: (state.status as string) ?? null,
    };
  });
}

// ============================================================================
// SECTION: Palace
// ============================================================================
//
// Summary:
//   Spatial navigation layer for workspaces. Rooms and scrolls are stored as
//   tessella-backed entities (PALACE_ROOM_GENUS_ID, PALACE_SCROLL_GENUS_ID)
//   with index tables for fast lookup by slug/room. This enables branching,
//   audit trails, and temporal queries.
//
// Usage:
//   const room = palaceBuildRoom(kernel, workspaceId, {
//     slug: "great-hall", name: "Great Hall",
//     description: "A vaulted entrance chamber...",
//     actions: [{ label: "Enter library", type: "navigate", room: "library" }],
//     portals: ["library"],
//   });
//   palaceWriteScroll(kernel, workspaceId, "great-hall", "Session Notes", "Explored geology...");
//   const scrolls = palaceGetScrolls(kernel, workspaceId, "great-hall");
//
// Design notes:
//   - Rooms and scrolls are entity res under PALACE_ROOM_GENUS_ID / PALACE_SCROLL_GENUS_ID.
//   - palace_room_index and palace_scroll_index provide fast lookups without
//     materializing all entities.
//   - Branch-aware: _palaceRoomLookup checks current branch first, falls back to main.
//   - Portals are bidirectional: building room A with portal to B auto-adds
//     A to B's portal list.
//   - Each workspace has its own palace. The first room built auto-becomes
//     the entry room.
//

// --- Types ---

export interface PalaceAction {
  label: string;
  type: "navigate" | "query" | "text";
  room?: string;
  tool?: string;
  tool_params?: Record<string, unknown>;
  content?: string;
  workspace?: string;
}

export interface PalaceRoom {
  workspace_id: string;
  slug: string;
  name: string;
  description: string;
  entry: boolean;
  actions: PalaceAction[];
  portals: string[];
  version: number;
  created_at: string;
  updated_at: string;
}

export interface PalaceScroll {
  id: string;
  workspace_id: string;
  room_slug: string;
  title: string;
  body: string;
  created_at: string;
}

// --- Palace v2 Markup Types ---

export type PalaceMarkupToken =
  | { type: "text"; value: string }
  | { type: "entity_ref"; genus: string; name: string; alias?: string; raw: string }
  | { type: "portal_ref"; slug: string; prose: string; raw: string };

export interface PalaceManifestEntry {
  kind: "entity" | "portal";
  display: string;
  match_name: string;
  genus_name?: string;
  entity_id?: string;
  genus_id?: string;
  slug?: string;
  resolved: boolean;
}

export interface PalaceRoomManifest {
  entries: PalaceManifestEntry[];
  rendered: string;
  has_markup: boolean;
}

// --- Internal helpers ---

function _palaceRoomLookup(
  kernel: Kernel, workspace_id: string, slug: string,
): { res_id: string; branch_id: string } | null {
  const branch = kernel.currentBranch;
  const row = kernel.db.query(
    "SELECT res_id, branch_id FROM palace_room_index WHERE workspace_id = ? AND slug = ? AND branch_id = ?",
  ).get(workspace_id, slug, branch) as any | null;
  if (row) {
    // Empty res_id is a tombstone (room deleted on this branch)
    if (row.res_id === "") return null;
    return row;
  }
  if (branch !== "main") {
    const mainRow = kernel.db.query(
      "SELECT res_id, branch_id FROM palace_room_index WHERE workspace_id = ? AND slug = ? AND branch_id = 'main'",
    ).get(workspace_id, slug) as any | null;
    if (mainRow) return mainRow;
  }
  return null;
}

function _materializeRoom(kernel: Kernel, workspace_id: string, res_id: string): PalaceRoom {
  const state = materialize(kernel, res_id, { branch_id: kernel.currentBranch });
  const res = kernel.db.query("SELECT created_at FROM res WHERE id = ?").get(res_id) as any;
  // Find last tessella for updated_at
  const lastTessella = kernel.db.query(
    "SELECT created_at FROM tessella WHERE res_id = ? ORDER BY id DESC LIMIT 1",
  ).get(res_id) as any;
  return {
    workspace_id,
    slug: state.slug as string,
    name: state.name as string,
    description: state.description as string,
    entry: state.entry === true,
    actions: (state.actions as PalaceAction[]) ?? [],
    portals: (state.portals as string[]) ?? [],
    version: (state.version as number) ?? 1,
    created_at: res.created_at,
    updated_at: lastTessella?.created_at ?? res.created_at,
  };
}

// --- Core functions ---

export interface PalaceBuildRoomDef {
  slug: string;
  name: string;
  description: string;
  entry?: boolean;
  actions: PalaceAction[];
  portals: string[];
}

export function palaceBuildRoom(kernel: Kernel, workspace_id: string, def: PalaceBuildRoomDef): PalaceRoom {
  // Validate actions
  const validActionTypes = ["navigate", "query", "text"];
  for (const action of def.actions) {
    if (!action.label) throw new Error(`Palace action missing required "label" field.`);
    if (!action.type || !validActionTypes.includes(action.type)) {
      throw new Error(`Palace action "${action.label}" has invalid type "${action.type}". Valid types: ${validActionTypes.join(", ")}.`);
    }
  }

  const branch = kernel.currentBranch;

  // Check if this is the first room in the palace
  const existingCount = (kernel.db.query(
    "SELECT COUNT(*) as cnt FROM palace_room_index WHERE workspace_id = ? AND (branch_id = ? OR branch_id = 'main')",
  ).get(workspace_id, branch) as any).cnt;

  const isEntry = def.entry !== undefined ? def.entry : existingCount === 0;

  // If setting as entry, clear existing entry flags on this branch
  if (isEntry) {
    // Find current entry rooms and clear their entry attribute via tessella
    const currentEntries = kernel.db.query(
      "SELECT slug, res_id FROM palace_room_index WHERE workspace_id = ? AND entry = 1 AND branch_id = ?",
    ).all(workspace_id, branch) as any[];
    for (const ce of currentEntries) {
      appendTessella(kernel, ce.res_id, "attribute_set", { key: "entry", value: false }, { branch_id: branch });
    }
    // Clear entry on current branch index
    kernel.db.run(
      "UPDATE palace_room_index SET entry = 0 WHERE workspace_id = ? AND entry = 1 AND branch_id = ?",
      [workspace_id, branch],
    );
    // If on a non-main branch, also handle main entry rooms
    if (branch !== "main") {
      const mainEntries = kernel.db.query(
        "SELECT slug, res_id FROM palace_room_index WHERE workspace_id = ? AND entry = 1 AND branch_id = 'main'",
      ).all(workspace_id) as any[];
      for (const me of mainEntries) {
        // Only shadow if no branch-specific row exists
        const branchRow = kernel.db.query(
          "SELECT 1 FROM palace_room_index WHERE workspace_id = ? AND slug = ? AND branch_id = ?",
        ).get(workspace_id, me.slug, branch) as any;
        if (!branchRow) {
          appendTessella(kernel, me.res_id, "attribute_set", { key: "entry", value: false }, { branch_id: branch });
          kernel.db.run(
            "INSERT INTO palace_room_index (workspace_id, slug, branch_id, res_id, entry) VALUES (?, ?, ?, ?, 0)",
            [workspace_id, me.slug, branch, me.res_id],
          );
        }
      }
    }
  }

  // Get old portals if room already exists (for stale portal cleanup)
  const existing = _palaceRoomLookup(kernel, workspace_id, def.slug);
  let oldPortals: string[] = [];
  let res_id: string;

  if (existing) {
    res_id = existing.res_id;
    const currentState = materialize(kernel, res_id, { branch_id: branch });
    oldPortals = (currentState.portals as string[]) ?? [];
    const currentVersion = (currentState.version as number) ?? 1;

    // Update via tessellae
    const updates: [string, unknown][] = [
      ["slug", def.slug],
      ["name", def.name],
      ["description", def.description],
      ["entry", isEntry],
      ["actions", def.actions],
      ["portals", def.portals],
      ["version", currentVersion + 1],
    ];
    for (const [key, value] of updates) {
      if (currentState[key] !== value) {
        appendTessella(kernel, res_id, "attribute_set", { key, value }, { branch_id: branch });
      }
    }
    // Always write version to ensure increment even if other fields match
    if (currentState.version === currentVersion) {
      // version attribute_set already queued above if different
    }

    // Update index entry
    if (existing.branch_id === branch) {
      kernel.db.run(
        "UPDATE palace_room_index SET entry = ? WHERE workspace_id = ? AND slug = ? AND branch_id = ?",
        [isEntry ? 1 : 0, workspace_id, def.slug, branch],
      );
    } else {
      // Existing is on main, create branch-specific index row
      kernel.db.run(
        "INSERT OR REPLACE INTO palace_room_index (workspace_id, slug, branch_id, res_id, entry) VALUES (?, ?, ?, ?, ?)",
        [workspace_id, def.slug, branch, res_id, isEntry ? 1 : 0],
      );
    }
  } else {
    // Create new room entity
    res_id = createRes(kernel, PALACE_ROOM_GENUS_ID, branch, workspace_id);
    appendTessella(kernel, res_id, "attribute_set", { key: "slug", value: def.slug }, { branch_id: branch });
    appendTessella(kernel, res_id, "attribute_set", { key: "name", value: def.name }, { branch_id: branch });
    appendTessella(kernel, res_id, "attribute_set", { key: "description", value: def.description }, { branch_id: branch });
    appendTessella(kernel, res_id, "attribute_set", { key: "entry", value: isEntry }, { branch_id: branch });
    appendTessella(kernel, res_id, "attribute_set", { key: "actions", value: def.actions }, { branch_id: branch });
    appendTessella(kernel, res_id, "attribute_set", { key: "portals", value: def.portals }, { branch_id: branch });
    appendTessella(kernel, res_id, "attribute_set", { key: "version", value: 1 }, { branch_id: branch });
    appendTessella(kernel, res_id, "status_changed", { status: "active" }, { branch_id: branch });

    kernel.db.run(
      "INSERT INTO palace_room_index (workspace_id, slug, branch_id, res_id, entry) VALUES (?, ?, ?, ?, ?)",
      [workspace_id, def.slug, branch, res_id, isEntry ? 1 : 0],
    );
  }

  // Bidirectional portal management: add this room to each portal target
  for (const targetSlug of def.portals) {
    const targetLookup = _palaceRoomLookup(kernel, workspace_id, targetSlug);
    if (targetLookup) {
      const targetState = materialize(kernel, targetLookup.res_id, { branch_id: branch });
      const targetPortals: string[] = (targetState.portals as string[]) ?? [];
      if (!targetPortals.includes(def.slug)) {
        const updatedPortals = [...targetPortals, def.slug];
        appendTessella(kernel, targetLookup.res_id, "attribute_set", { key: "portals", value: updatedPortals }, { branch_id: branch });
      }
    }
  }

  // Remove stale portal references from rooms no longer in the portal list
  const removedPortals = oldPortals.filter((p) => !def.portals.includes(p));
  for (const staleSlug of removedPortals) {
    const staleLookup = _palaceRoomLookup(kernel, workspace_id, staleSlug);
    if (staleLookup) {
      const staleState = materialize(kernel, staleLookup.res_id, { branch_id: branch });
      const stalePortals: string[] = (staleState.portals as string[]) ?? [];
      if (stalePortals.includes(def.slug)) {
        const filtered = stalePortals.filter((p) => p !== def.slug);
        appendTessella(kernel, staleLookup.res_id, "attribute_set", { key: "portals", value: filtered }, { branch_id: branch });
      }
    }
  }

  return palaceGetRoom(kernel, workspace_id, def.slug)!;
}

export function palaceGetRoom(kernel: Kernel, workspace_id: string, slug: string): PalaceRoom | null {
  const lookup = _palaceRoomLookup(kernel, workspace_id, slug);
  if (!lookup) return null;
  return _materializeRoom(kernel, workspace_id, lookup.res_id);
}

export function palaceGetEntryRoom(kernel: Kernel, workspace_id: string): PalaceRoom | null {
  const branch = kernel.currentBranch;
  // Check current branch first
  let row = kernel.db.query(
    "SELECT res_id FROM palace_room_index WHERE workspace_id = ? AND entry = 1 AND branch_id = ? AND res_id != ''",
  ).get(workspace_id, branch) as any | null;
  if (!row && branch !== "main") {
    row = kernel.db.query(
      "SELECT res_id FROM palace_room_index WHERE workspace_id = ? AND entry = 1 AND branch_id = 'main' AND res_id != ''",
    ).get(workspace_id) as any | null;
  }
  if (!row) return null;
  return _materializeRoom(kernel, workspace_id, row.res_id);
}

export function palaceListRooms(kernel: Kernel, workspace_id: string): PalaceRoom[] {
  const branch = kernel.currentBranch;
  // Get all rooms from current branch + main, deduplicate by slug (branch takes precedence)
  // Order by branch_id DESC so non-main branches come first (alphabetically "main" < other names)
  const rows = kernel.db.query(
    "SELECT slug, res_id, branch_id FROM palace_room_index WHERE workspace_id = ? AND (branch_id = ? OR branch_id = 'main') ORDER BY CASE WHEN branch_id = ? THEN 0 ELSE 1 END",
  ).all(workspace_id, branch, branch) as any[];

  const seen = new Map<string, string>();
  for (const row of rows) {
    if (!seen.has(row.slug)) {
      seen.set(row.slug, row.res_id);
    }
  }

  const rooms: PalaceRoom[] = [];
  for (const [_, res_id] of seen) {
    if (res_id === "") continue; // tombstone — room deleted on this branch
    rooms.push(_materializeRoom(kernel, workspace_id, res_id));
  }
  rooms.sort((a, b) => a.created_at.localeCompare(b.created_at));
  return rooms;
}

export function palaceHasPalace(kernel: Kernel, workspace_id: string): boolean {
  const branch = kernel.currentBranch;
  const row = kernel.db.query(
    "SELECT COUNT(*) as cnt FROM palace_room_index WHERE workspace_id = ? AND (branch_id = ? OR branch_id = 'main') AND res_id != ''",
  ).get(workspace_id, branch) as any;
  return row.cnt > 0;
}

export function palaceWriteScroll(
  kernel: Kernel, workspace_id: string, room_slug: string, title: string, body: string,
): PalaceScroll {
  const roomLookup = _palaceRoomLookup(kernel, workspace_id, room_slug);
  if (!roomLookup) throw new Error(`Palace room not found: ${room_slug}`);

  const branch = kernel.currentBranch;
  const res_id = createRes(kernel, PALACE_SCROLL_GENUS_ID, branch, workspace_id);
  appendTessella(kernel, res_id, "attribute_set", { key: "room_id", value: roomLookup.res_id }, { branch_id: branch });
  appendTessella(kernel, res_id, "attribute_set", { key: "title", value: title }, { branch_id: branch });
  appendTessella(kernel, res_id, "attribute_set", { key: "body", value: body }, { branch_id: branch });
  appendTessella(kernel, res_id, "status_changed", { status: "active" }, { branch_id: branch });

  const resRow = kernel.db.query("SELECT created_at FROM res WHERE id = ?").get(res_id) as any;

  kernel.db.run(
    "INSERT INTO palace_scroll_index (res_id, workspace_id, room_id, branch_id, created_at) VALUES (?, ?, ?, ?, ?)",
    [res_id, workspace_id, roomLookup.res_id, branch, resRow.created_at],
  );

  return {
    id: res_id,
    workspace_id,
    room_slug,
    title,
    body,
    created_at: resRow.created_at,
  };
}

export interface PalaceScrollsResult {
  scrolls: PalaceScroll[];
  total: number;
}

export function palaceGetScrolls(
  kernel: Kernel, workspace_id: string, room_slug: string, opts?: { limit?: number; offset?: number },
): PalaceScrollsResult {
  const roomLookup = _palaceRoomLookup(kernel, workspace_id, room_slug);
  if (!roomLookup) return { scrolls: [], total: 0 };

  const branch = kernel.currentBranch;
  const limit = opts?.limit ?? 3;
  const offset = opts?.offset ?? 0;

  // Get scrolls from current branch + main (deduplicate by res_id, branch takes precedence)
  let countSql: string;
  let countParams: any[];
  let querySql: string;
  let queryParams: any[];

  if (branch === "main") {
    countSql = "SELECT COUNT(*) as cnt FROM palace_scroll_index WHERE workspace_id = ? AND room_id = ? AND branch_id = 'main'";
    countParams = [workspace_id, roomLookup.res_id];
    querySql = "SELECT res_id, created_at FROM palace_scroll_index WHERE workspace_id = ? AND room_id = ? AND branch_id = 'main' ORDER BY res_id DESC LIMIT ? OFFSET ?";
    queryParams = [workspace_id, roomLookup.res_id, limit, offset];
  } else {
    countSql = "SELECT COUNT(*) as cnt FROM palace_scroll_index WHERE workspace_id = ? AND room_id = ? AND (branch_id = ? OR branch_id = 'main')";
    countParams = [workspace_id, roomLookup.res_id, branch];
    querySql = "SELECT res_id, created_at, branch_id FROM palace_scroll_index WHERE workspace_id = ? AND room_id = ? AND (branch_id = ? OR branch_id = 'main') ORDER BY res_id DESC LIMIT ? OFFSET ?";
    queryParams = [workspace_id, roomLookup.res_id, branch, limit, offset];
  }

  const total = (kernel.db.query(countSql).get(...countParams) as any).cnt;
  const rows = kernel.db.query(querySql).all(...queryParams) as any[];

  const scrolls: PalaceScroll[] = rows.map((row) => {
    const state = materialize(kernel, row.res_id, { branch_id: branch });
    return {
      id: row.res_id,
      workspace_id,
      room_slug,
      title: state.title as string,
      body: state.body as string,
      created_at: row.created_at,
    };
  });

  return { scrolls, total };
}

export function palaceDeleteRoom(kernel: Kernel, workspace_id: string, slug: string): void {
  const room = palaceGetRoom(kernel, workspace_id, slug);
  if (!room) throw new Error(`Palace room not found: ${slug}`);
  if (room.entry) throw new Error("Cannot delete entry room. Reassign entry to another room first.");

  const branch = kernel.currentBranch;
  const lookup = _palaceRoomLookup(kernel, workspace_id, slug)!;

  // Transition room to archived
  appendTessella(kernel, lookup.res_id, "status_changed", { status: "archived" }, { branch_id: branch });

  if (lookup.branch_id === branch) {
    // Room's index entry is on our branch — delete it
    kernel.db.run(
      "DELETE FROM palace_room_index WHERE workspace_id = ? AND slug = ? AND branch_id = ?",
      [workspace_id, slug, branch],
    );
  }
  // If room was inherited from main, insert a tombstone on this branch so lookup doesn't fall back
  if (branch !== "main" && lookup.branch_id === "main") {
    kernel.db.run(
      "INSERT OR REPLACE INTO palace_room_index (workspace_id, slug, branch_id, res_id, entry) VALUES (?, ?, ?, '', 0)",
      [workspace_id, slug, branch],
    );
  }

  // Remove this room's slug from other rooms' portal lists
  const allRooms = palaceListRooms(kernel, workspace_id);
  for (const other of allRooms) {
    if (other.slug === slug) continue;
    if (other.portals.includes(slug)) {
      const otherLookup = _palaceRoomLookup(kernel, workspace_id, other.slug);
      if (otherLookup) {
        const filtered = other.portals.filter((p) => p !== slug);
        appendTessella(kernel, otherLookup.res_id, "attribute_set", { key: "portals", value: filtered }, { branch_id: branch });
      }
    }
  }

  // Archive associated scrolls
  const scrollRows = kernel.db.query(
    "SELECT res_id FROM palace_scroll_index WHERE workspace_id = ? AND room_id = ? AND branch_id = ?",
  ).all(workspace_id, lookup.res_id, branch) as any[];
  for (const sr of scrollRows) {
    appendTessella(kernel, sr.res_id, "status_changed", { status: "archived" }, { branch_id: branch });
  }
  kernel.db.run(
    "DELETE FROM palace_scroll_index WHERE workspace_id = ? AND room_id = ? AND branch_id = ?",
    [workspace_id, lookup.res_id, branch],
  );

  // Archive associated NPCs
  const npcRows = kernel.db.query(
    "SELECT slug, res_id FROM palace_npc_index WHERE workspace_id = ? AND room_slug = ? AND (branch_id = ? OR branch_id = 'main') AND res_id != ''",
  ).all(workspace_id, slug, branch) as any[];
  for (const nr of npcRows) {
    appendTessella(kernel, nr.res_id, "status_changed", { status: "archived" }, { branch_id: branch });
    kernel.db.run(
      "DELETE FROM palace_npc_index WHERE workspace_id = ? AND slug = ? AND branch_id = ?",
      [workspace_id, nr.slug, branch],
    );
    if (branch !== "main") {
      kernel.db.run(
        "INSERT OR REPLACE INTO palace_npc_index (workspace_id, slug, room_slug, branch_id, res_id) VALUES (?, ?, ?, ?, '')",
        [workspace_id, nr.slug, slug, branch],
      );
    }
  }
}

// --- Merge mode ---

export interface PalaceMergeRoomDef {
  slug: string;
  name?: string;
  description?: string;
  entry?: boolean;
  actions?: PalaceAction[];
  portals?: string[];
}

export function palaceMergeRoom(kernel: Kernel, workspace_id: string, def: PalaceMergeRoomDef): PalaceRoom {
  const existing = palaceGetRoom(kernel, workspace_id, def.slug);

  if (!existing) {
    // No existing room — require name+description to create
    if (!def.name || !def.description) {
      throw new Error(`Room '${def.slug}' does not exist. Provide name and description to create it.`);
    }
    return palaceBuildRoom(kernel, workspace_id, {
      slug: def.slug,
      name: def.name,
      description: def.description,
      entry: def.entry,
      actions: def.actions ?? [],
      portals: def.portals ?? [],
    });
  }

  // Merge with existing room
  const mergedName = def.name ?? existing.name;
  const mergedDescription = def.description ?? existing.description;
  const mergedEntry = def.entry ?? existing.entry;

  // Merge actions: match by label → replace; new labels → append; unmentioned → preserve
  let mergedActions = [...existing.actions];
  if (def.actions) {
    for (const newAct of def.actions) {
      const idx = mergedActions.findIndex((a) => a.label === newAct.label);
      if (idx >= 0) {
        mergedActions[idx] = newAct;
      } else {
        mergedActions.push(newAct);
      }
    }
  }

  // Merge portals: union with dedup
  const mergedPortals = [...new Set([...existing.portals, ...(def.portals ?? [])])];

  return palaceBuildRoom(kernel, workspace_id, {
    slug: def.slug,
    name: mergedName,
    description: mergedDescription,
    entry: mergedEntry,
    actions: mergedActions,
    portals: mergedPortals,
  });
}

// --- Search ---

export interface PalaceSearchResult {
  type: "room" | "scroll" | "action";
  room_slug: string;
  room_name: string;
  match: string;
  field: string;
}

export function palaceSearch(kernel: Kernel, workspace_id: string, query: string): PalaceSearchResult[] {
  const results: PalaceSearchResult[] = [];
  const q = query.toLowerCase();
  const rooms = palaceListRooms(kernel, workspace_id);

  for (const room of rooms) {
    // Search room name
    if (room.name.toLowerCase().includes(q)) {
      results.push({ type: "room", room_slug: room.slug, room_name: room.name, match: room.name, field: "name" });
    }
    // Search room description
    if (room.description.toLowerCase().includes(q)) {
      const snippet = _searchSnippet(room.description, q);
      results.push({ type: "room", room_slug: room.slug, room_name: room.name, match: snippet, field: "description" });
    }
    // Search action labels
    for (const act of room.actions) {
      if (act.label.toLowerCase().includes(q)) {
        results.push({ type: "action", room_slug: room.slug, room_name: room.name, match: act.label, field: "label" });
      }
    }
    // Search scrolls
    const scrollsResult = palaceGetScrolls(kernel, workspace_id, room.slug, { limit: 100 });
    for (const scroll of scrollsResult.scrolls) {
      if (scroll.title.toLowerCase().includes(q)) {
        results.push({ type: "scroll", room_slug: room.slug, room_name: room.name, match: scroll.title, field: "title" });
      } else if (scroll.body.toLowerCase().includes(q)) {
        const snippet = _searchSnippet(scroll.body, q);
        results.push({ type: "scroll", room_slug: room.slug, room_name: room.name, match: snippet, field: "body" });
      }
    }
  }

  return results.slice(0, 20);
}

function _searchSnippet(text: string, query: string): string {
  const lower = text.toLowerCase();
  const idx = lower.indexOf(query);
  if (idx < 0) return text.slice(0, 60);
  const start = Math.max(0, idx - 20);
  const end = Math.min(text.length, idx + query.length + 40);
  let snippet = text.slice(start, end);
  if (start > 0) snippet = "..." + snippet;
  if (end < text.length) snippet = snippet + "...";
  return snippet;
}

// --- NPC types ---

export interface PalaceDialogueNode {
  id: string;
  parent: string;
  prompt: string;
  text: string;
  entity_id?: string;
  entity_ref?: string;
  requires?: string[];
  unlocks?: string[];
}

export interface PalaceNPC {
  id: string;
  workspace_id: string;
  slug: string;
  name: string;
  description: string;
  room_slug: string;
  greeting: string;
  dialogue: PalaceDialogueNode[];
  created_at: string;
  updated_at: string;
}

export interface PalaceNPCDef {
  slug: string;
  name: string;
  description: string;
  room_slug: string;
  greeting: string;
  dialogue?: PalaceDialogueNode[];
}

// --- NPC internal helpers ---

function _palaceNpcLookup(
  kernel: Kernel, workspace_id: string, slug: string,
): { res_id: string; branch_id: string } | null {
  const branch = kernel.currentBranch;
  const row = kernel.db.query(
    "SELECT res_id, branch_id FROM palace_npc_index WHERE workspace_id = ? AND slug = ? AND branch_id = ?",
  ).get(workspace_id, slug, branch) as any | null;
  if (row) {
    if (row.res_id === "") return null;
    return row;
  }
  if (branch !== "main") {
    const mainRow = kernel.db.query(
      "SELECT res_id, branch_id FROM palace_npc_index WHERE workspace_id = ? AND slug = ? AND branch_id = 'main'",
    ).get(workspace_id, slug) as any | null;
    if (mainRow) return mainRow;
  }
  return null;
}

function _materializeNpc(kernel: Kernel, workspace_id: string, res_id: string): PalaceNPC {
  const state = materialize(kernel, res_id, { branch_id: kernel.currentBranch });
  const res = kernel.db.query("SELECT created_at FROM res WHERE id = ?").get(res_id) as any;
  const lastTessella = kernel.db.query(
    "SELECT created_at FROM tessella WHERE res_id = ? ORDER BY id DESC LIMIT 1",
  ).get(res_id) as any;
  return {
    id: res_id,
    workspace_id,
    slug: state.slug as string,
    name: state.name as string,
    description: state.description as string,
    room_slug: state.room_slug as string,
    greeting: state.greeting as string,
    dialogue: ((state.dialogue as any[]) ?? []).map((n: any) => ({
      ...n,
      text: n.text ?? n.response,  // normalize legacy "response" field
      response: undefined,
    })) as PalaceDialogueNode[],
    created_at: res.created_at,
    updated_at: lastTessella?.created_at ?? res.created_at,
  };
}

function _resolveEntityRef(kernel: Kernel, ref: string): string {
  const colonIdx = ref.indexOf(":");
  if (colonIdx < 0) throw new Error(`Invalid entity_ref format: "${ref}". Expected "GenusName:query".`);
  const genusName = ref.slice(0, colonIdx).trim();
  const query = ref.slice(colonIdx + 1).trim();
  if (!genusName || !query) throw new Error(`Invalid entity_ref: "${ref}". Both genus name and query are required.`);

  const genusId = findGenusByName(kernel, genusName);
  if (!genusId) throw new Error(`entity_ref: genus "${genusName}" not found.`);

  const entities = listEntities(kernel, { genus_id: genusId });
  const queryLower = query.toLowerCase();

  // Exact name match
  const exact = entities.filter(e => {
    const name = (e.state.name as string) ?? (e.state.title as string) ?? "";
    return name.toLowerCase() === queryLower;
  });
  if (exact.length === 1) return exact[0].id;

  // Prefix match
  const prefix = entities.filter(e => {
    const name = (e.state.name as string) ?? (e.state.title as string) ?? "";
    return name.toLowerCase().startsWith(queryLower);
  });
  if (prefix.length === 1) return prefix[0].id;

  // Substring match
  const substr = entities.filter(e => {
    const name = (e.state.name as string) ?? (e.state.title as string) ?? "";
    return name.toLowerCase().includes(queryLower);
  });
  if (substr.length === 1) return substr[0].id;
  if (substr.length > 1) {
    const names = substr.map(e => (e.state.name as string) ?? (e.state.title as string) ?? e.id);
    throw new Error(`entity_ref "${ref}" is ambiguous. Matches: ${names.join(", ")}`);
  }

  throw new Error(`entity_ref "${ref}": no matching entity found in genus "${genusName}".`);
}

function _resolveDialogueEntityRefs(kernel: Kernel, nodes: PalaceDialogueNode[]): PalaceDialogueNode[] {
  return nodes.map(node => {
    if (node.entity_ref && !node.entity_id) {
      const resolved = _resolveEntityRef(kernel, node.entity_ref);
      return { ...node, entity_id: resolved, entity_ref: undefined };
    }
    return node;
  });
}

function _validateDialogueNodes(existing: PalaceDialogueNode[], newNodes: PalaceDialogueNode[]): void {
  const existingIds = new Set(existing.map(n => n.id));
  const newIds = new Set<string>();
  for (const node of newNodes) {
    // Field validation
    if (!node.text) throw new Error(`Dialogue node "${node.id}" is missing required "text" field.`);
    if (!node.prompt) throw new Error(`Dialogue node "${node.id}" is missing required "prompt" field.`);
    if (existingIds.has(node.id)) throw new Error(`Dialogue node ID "${node.id}" already exists.`);
    if (newIds.has(node.id)) throw new Error(`Duplicate dialogue node ID "${node.id}" in new nodes.`);
    newIds.add(node.id);
  }
  const allIds = new Set([...existingIds, ...newIds]);
  for (const node of newNodes) {
    if (node.parent !== "root" && !allIds.has(node.parent)) {
      const validParents = ["root", ...allIds].join(", ");
      throw new Error(`Dialogue node "${node.id}" references unknown parent "${node.parent}". Valid parents: ${validParents}`);
    }
  }
}

// --- NPC core functions ---

export function palaceCreateNPC(kernel: Kernel, workspace_id: string, def: PalaceNPCDef): PalaceNPC {
  const branch = kernel.currentBranch;

  // Verify room exists
  const roomLookup = _palaceRoomLookup(kernel, workspace_id, def.room_slug);
  if (!roomLookup) throw new Error(`Palace room not found: ${def.room_slug}`);

  // Check if slug already taken
  const existing = _palaceNpcLookup(kernel, workspace_id, def.slug);
  if (existing) throw new Error(`NPC with slug "${def.slug}" already exists.`);

  // Resolve entity refs and validate dialogue
  let dialogue = def.dialogue ?? [];
  dialogue = _resolveDialogueEntityRefs(kernel, dialogue);
  _validateDialogueNodes([], dialogue);

  const res_id = createRes(kernel, PALACE_NPC_GENUS_ID, branch, workspace_id);
  appendTessella(kernel, res_id, "attribute_set", { key: "slug", value: def.slug }, { branch_id: branch });
  appendTessella(kernel, res_id, "attribute_set", { key: "name", value: def.name }, { branch_id: branch });
  appendTessella(kernel, res_id, "attribute_set", { key: "description", value: def.description }, { branch_id: branch });
  appendTessella(kernel, res_id, "attribute_set", { key: "room_slug", value: def.room_slug }, { branch_id: branch });
  appendTessella(kernel, res_id, "attribute_set", { key: "greeting", value: def.greeting }, { branch_id: branch });
  appendTessella(kernel, res_id, "attribute_set", { key: "dialogue", value: dialogue }, { branch_id: branch });
  appendTessella(kernel, res_id, "status_changed", { status: "active" }, { branch_id: branch });

  kernel.db.run(
    "INSERT INTO palace_npc_index (workspace_id, slug, room_slug, branch_id, res_id) VALUES (?, ?, ?, ?, ?)",
    [workspace_id, def.slug, def.room_slug, branch, res_id],
  );

  return _materializeNpc(kernel, workspace_id, res_id);
}

export function palaceGetNPC(kernel: Kernel, workspace_id: string, slug: string): PalaceNPC | null {
  const lookup = _palaceNpcLookup(kernel, workspace_id, slug);
  if (!lookup) return null;
  return _materializeNpc(kernel, workspace_id, lookup.res_id);
}

export function palaceListNPCsInRoom(kernel: Kernel, workspace_id: string, room_slug: string): PalaceNPC[] {
  const branch = kernel.currentBranch;
  const rows = kernel.db.query(
    "SELECT slug, res_id, branch_id FROM palace_npc_index WHERE workspace_id = ? AND room_slug = ? AND (branch_id = ? OR branch_id = 'main') ORDER BY CASE WHEN branch_id = ? THEN 0 ELSE 1 END",
  ).all(workspace_id, room_slug, branch, branch) as any[];

  const seen = new Map<string, string>();
  for (const row of rows) {
    if (!seen.has(row.slug)) {
      seen.set(row.slug, row.res_id);
    }
  }

  const npcs: PalaceNPC[] = [];
  for (const [_, res_id] of seen) {
    if (res_id === "") continue; // tombstone
    npcs.push(_materializeNpc(kernel, workspace_id, res_id));
  }
  return npcs;
}

export function palaceListNPCs(kernel: Kernel, workspace_id: string): PalaceNPC[] {
  const branch = kernel.currentBranch;
  const rows = kernel.db.query(
    "SELECT slug, res_id, branch_id FROM palace_npc_index WHERE workspace_id = ? AND (branch_id = ? OR branch_id = 'main') ORDER BY CASE WHEN branch_id = ? THEN 0 ELSE 1 END",
  ).all(workspace_id, branch, branch) as any[];

  const seen = new Map<string, string>();
  for (const row of rows) {
    if (!seen.has(row.slug)) {
      seen.set(row.slug, row.res_id);
    }
  }

  const npcs: PalaceNPC[] = [];
  for (const [_, res_id] of seen) {
    if (res_id === "") continue;
    npcs.push(_materializeNpc(kernel, workspace_id, res_id));
  }
  return npcs;
}

export function palaceAddDialogue(
  kernel: Kernel, workspace_id: string, npc_slug: string, nodes: PalaceDialogueNode[],
): PalaceNPC {
  const lookup = _palaceNpcLookup(kernel, workspace_id, npc_slug);
  if (!lookup) throw new Error(`NPC not found: ${npc_slug}`);

  const branch = kernel.currentBranch;
  const current = _materializeNpc(kernel, workspace_id, lookup.res_id);

  // Resolve entity refs
  const resolvedNodes = _resolveDialogueEntityRefs(kernel, nodes);
  _validateDialogueNodes(current.dialogue, resolvedNodes);

  const updatedDialogue = [...current.dialogue, ...resolvedNodes];
  appendTessella(kernel, lookup.res_id, "attribute_set", { key: "dialogue", value: updatedDialogue }, { branch_id: branch });

  return _materializeNpc(kernel, workspace_id, lookup.res_id);
}

export function palaceMergeNPC(kernel: Kernel, workspace_id: string, def: Partial<PalaceNPCDef> & { slug: string }): PalaceNPC {
  const existing = palaceGetNPC(kernel, workspace_id, def.slug);

  if (!existing) {
    if (!def.name || !def.description || !def.room_slug || !def.greeting) {
      throw new Error(`NPC '${def.slug}' does not exist. Provide name, description, room_slug, and greeting to create it.`);
    }
    return palaceCreateNPC(kernel, workspace_id, {
      slug: def.slug,
      name: def.name,
      description: def.description,
      room_slug: def.room_slug,
      greeting: def.greeting,
      dialogue: def.dialogue,
    });
  }

  const branch = kernel.currentBranch;
  const lookup = _palaceNpcLookup(kernel, workspace_id, def.slug)!;

  // Update individual fields if provided
  if (def.name && def.name !== existing.name) {
    appendTessella(kernel, lookup.res_id, "attribute_set", { key: "name", value: def.name }, { branch_id: branch });
  }
  if (def.description && def.description !== existing.description) {
    appendTessella(kernel, lookup.res_id, "attribute_set", { key: "description", value: def.description }, { branch_id: branch });
  }
  if (def.greeting && def.greeting !== existing.greeting) {
    appendTessella(kernel, lookup.res_id, "attribute_set", { key: "greeting", value: def.greeting }, { branch_id: branch });
  }
  if (def.room_slug && def.room_slug !== existing.room_slug) {
    const roomLookup = _palaceRoomLookup(kernel, workspace_id, def.room_slug);
    if (!roomLookup) throw new Error(`Palace room not found: ${def.room_slug}`);
    appendTessella(kernel, lookup.res_id, "attribute_set", { key: "room_slug", value: def.room_slug }, { branch_id: branch });
    // Update index
    kernel.db.run(
      "UPDATE palace_npc_index SET room_slug = ? WHERE workspace_id = ? AND slug = ? AND branch_id = ?",
      [def.room_slug, workspace_id, def.slug, branch],
    );
  }

  // Append dialogue nodes
  if (def.dialogue && def.dialogue.length > 0) {
    const resolvedNodes = _resolveDialogueEntityRefs(kernel, def.dialogue);
    _validateDialogueNodes(existing.dialogue, resolvedNodes);
    const updatedDialogue = [...existing.dialogue, ...resolvedNodes];
    appendTessella(kernel, lookup.res_id, "attribute_set", { key: "dialogue", value: updatedDialogue }, { branch_id: branch });
  }

  return _materializeNpc(kernel, workspace_id, lookup.res_id);
}

export function palaceDeleteNPC(kernel: Kernel, workspace_id: string, slug: string): void {
  const lookup = _palaceNpcLookup(kernel, workspace_id, slug);
  if (!lookup) throw new Error(`NPC not found: ${slug}`);

  const branch = kernel.currentBranch;
  appendTessella(kernel, lookup.res_id, "status_changed", { status: "archived" }, { branch_id: branch });

  if (lookup.branch_id === branch) {
    kernel.db.run(
      "DELETE FROM palace_npc_index WHERE workspace_id = ? AND slug = ? AND branch_id = ?",
      [workspace_id, slug, branch],
    );
  }
  if (branch !== "main" && lookup.branch_id === "main") {
    kernel.db.run(
      "INSERT OR REPLACE INTO palace_npc_index (workspace_id, slug, room_slug, branch_id, res_id) VALUES (?, ?, ?, ?, '')",
      [workspace_id, slug, "", branch],
    );
  }
}

// --- Data migration ---

function _migratePalaceToTessellae(kernel: Kernel): void {
  // Check if migration already ran
  const flag = kernel.db.query("SELECT value FROM sync_state WHERE key = 'palace_tessellae_migrated'").get() as any;
  if (flag) return;

  // Check if old palace_room table has data
  let hasOldData = false;
  try {
    const cnt = kernel.db.query("SELECT COUNT(*) as cnt FROM palace_room").get() as any;
    hasOldData = cnt.cnt > 0;
  } catch {
    // Table doesn't exist (fresh DB) — no migration needed
  }

  if (!hasOldData) {
    // Mark as migrated even if no data, so we don't re-check
    kernel.db.run("INSERT OR REPLACE INTO sync_state (key, value) VALUES ('palace_tessellae_migrated', '1')");
    return;
  }

  // Migrate rooms
  const rooms = kernel.db.query("SELECT * FROM palace_room ORDER BY created_at ASC").all() as any[];
  for (const room of rooms) {
    const res_id = createRes(kernel, PALACE_ROOM_GENUS_ID, "main", room.workspace_id);
    appendTessella(kernel, res_id, "attribute_set", { key: "slug", value: room.slug });
    appendTessella(kernel, res_id, "attribute_set", { key: "name", value: room.name });
    appendTessella(kernel, res_id, "attribute_set", { key: "description", value: room.description });
    appendTessella(kernel, res_id, "attribute_set", { key: "entry", value: room.entry === 1 });
    appendTessella(kernel, res_id, "attribute_set", { key: "actions", value: JSON.parse(room.actions) });
    appendTessella(kernel, res_id, "attribute_set", { key: "portals", value: JSON.parse(room.portals) });
    appendTessella(kernel, res_id, "attribute_set", { key: "version", value: room.version ?? 1 });
    appendTessella(kernel, res_id, "status_changed", { status: "active" });

    kernel.db.run(
      "INSERT INTO palace_room_index (workspace_id, slug, branch_id, res_id, entry) VALUES (?, ?, 'main', ?, ?)",
      [room.workspace_id, room.slug, res_id, room.entry],
    );
  }

  // Build room slug → res_id map for scroll migration
  const roomIndex = new Map<string, string>();
  const indexRows = kernel.db.query("SELECT workspace_id, slug, res_id FROM palace_room_index WHERE branch_id = 'main'").all() as any[];
  for (const row of indexRows) {
    roomIndex.set(`${row.workspace_id}:${row.slug}`, row.res_id);
  }

  // Migrate scrolls
  let scrolls: any[] = [];
  try {
    scrolls = kernel.db.query("SELECT * FROM palace_scroll ORDER BY id ASC").all() as any[];
  } catch { /* table might not exist */ }

  for (const scroll of scrolls) {
    const roomResId = roomIndex.get(`${scroll.workspace_id}:${scroll.room_slug}`);
    if (!roomResId) continue; // orphan scroll, skip

    const res_id = createRes(kernel, PALACE_SCROLL_GENUS_ID, "main", scroll.workspace_id);
    appendTessella(kernel, res_id, "attribute_set", { key: "room_id", value: roomResId });
    appendTessella(kernel, res_id, "attribute_set", { key: "title", value: scroll.title });
    appendTessella(kernel, res_id, "attribute_set", { key: "body", value: scroll.body });
    appendTessella(kernel, res_id, "status_changed", { status: "active" });

    kernel.db.run(
      "INSERT INTO palace_scroll_index (res_id, workspace_id, room_id, branch_id, created_at) VALUES (?, ?, ?, 'main', ?)",
      [res_id, scroll.workspace_id, roomResId, scroll.created_at],
    );
  }

  // Mark migration complete
  kernel.db.run("INSERT OR REPLACE INTO sync_state (key, value) VALUES ('palace_tessellae_migrated', '1')");
}

// --- Palace v2: Markup, Entity Lookup, Manifest, Templates ---

const _ENTITY_REF_RE = /\*([^*:]+):([^*|]+)(?:\|([^*]+))?\*/g;
const _PORTAL_REF_RE = /\[([^\]]+)\]([^\[]*)\[\/\]/g;

export function palaceParseMarkup(description: string): PalaceMarkupToken[] {
  // Merge entity refs and portal refs into a single sorted list by index
  const matches: { index: number; end: number; token: PalaceMarkupToken }[] = [];

  for (const m of description.matchAll(_ENTITY_REF_RE)) {
    matches.push({
      index: m.index!,
      end: m.index! + m[0].length,
      token: { type: "entity_ref", genus: m[1], name: m[2], ...(m[3] ? { alias: m[3] } : {}), raw: m[0] },
    });
  }
  for (const m of description.matchAll(_PORTAL_REF_RE)) {
    matches.push({
      index: m.index!,
      end: m.index! + m[0].length,
      token: { type: "portal_ref", slug: m[1], prose: m[2], raw: m[0] },
    });
  }

  if (matches.length === 0) return [{ type: "text", value: description }];

  matches.sort((a, b) => a.index - b.index);
  const tokens: PalaceMarkupToken[] = [];
  let cursor = 0;

  for (const m of matches) {
    if (m.index > cursor) {
      tokens.push({ type: "text", value: description.slice(cursor, m.index) });
    }
    tokens.push(m.token);
    cursor = m.end;
  }

  if (cursor < description.length) {
    tokens.push({ type: "text", value: description.slice(cursor) });
  }

  return tokens;
}

export function palaceFindEntity(
  kernel: Kernel,
  genusName: string,
  entityName: string,
  workspaceId?: string,
): { id: string; state: Record<string, unknown> } | null {
  const genusId = findGenusByName(kernel, genusName);
  if (!genusId) return null;

  const entities = listEntities(kernel, {
    genus_id: genusId,
    ...(workspaceId ? { workspace_id: workspaceId, only_workspace: true } : {}),
  });

  const lower = entityName.toLowerCase();
  for (const e of entities) {
    const name = ((e.state.name as string) ?? (e.state.title as string) ?? "").toLowerCase();
    if (name === lower) return { id: e.id, state: e.state };
  }
  return null;
}

export function palaceResolveMarkup(
  kernel: Kernel,
  workspaceId: string | null,
  tokens: PalaceMarkupToken[],
): PalaceRoomManifest {
  const entries: PalaceManifestEntry[] = [];
  const parts: string[] = [];
  let hasMarkup = false;

  for (const token of tokens) {
    if (token.type === "text") {
      parts.push(token.value);
    } else if (token.type === "entity_ref") {
      hasMarkup = true;
      const found = palaceFindEntity(kernel, token.genus, token.name, workspaceId ?? undefined);
      if (found) {
        const genusId = findGenusByName(kernel, token.genus);
        const genusName = token.genus;
        const rawName = (found.state.name as string) ?? token.name;
        let display: string;
        if (token.alias) {
          // Author-specified alias takes priority
          display = token.alias;
        } else if (genusId) {
          const templates = getGenusTemplates(kernel, genusId);
          if (templates.mention) {
            display = renderTemplate(templates.mention, found.state, { genus_name: genusName, id: found.id });
          } else {
            display = `\u00ab${rawName}\u00bb`;
          }
        } else {
          display = `\u00ab${rawName}\u00bb`;
        }
        entries.push({ kind: "entity", display, match_name: rawName, genus_name: genusName, entity_id: found.id, genus_id: genusId ?? undefined, resolved: true });
        parts.push(display);
      } else {
        const rawName = token.name;
        const display = token.alias ?? `\u00ab${rawName}\u00bb`;
        entries.push({ kind: "entity", display, match_name: rawName, genus_name: token.genus, resolved: false });
        parts.push(display);
      }
    } else if (token.type === "portal_ref") {
      hasMarkup = true;
      const rawName = token.prose;
      const display = `${rawName} \u2192`;
      entries.push({ kind: "portal", display, match_name: rawName, slug: token.slug, resolved: true });
      parts.push(display);
    }
  }

  return { entries, rendered: parts.join(""), has_markup: hasMarkup };
}

// --- Palace v2: Genus Render Templates ---

export function setGenusTemplate(kernel: Kernel, genus_id: string, level: "mention" | "glance" | "inspect", template: string): void {
  appendTessella(kernel, genus_id, "genus_meta_set", { key: `template_${level}`, value: template });
}

export function getGenusTemplates(kernel: Kernel, genus_id: string): { mention?: string; glance?: string; inspect?: string } {
  const def = getGenusDef(kernel, genus_id);
  return {
    mention: def.meta.template_mention as string | undefined,
    glance: def.meta.template_glance as string | undefined,
    inspect: def.meta.template_inspect as string | undefined,
  };
}

export function renderTemplate(
  template: string,
  state: Record<string, unknown>,
  context: { genus_name: string; id: string },
): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => {
    if (key === "genus_name") return context.genus_name;
    if (key === "id") return context.id;
    const val = state[key];
    return val != null ? String(val) : "";
  });
}
