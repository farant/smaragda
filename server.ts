// ============================================================================
// server.ts — Smaragda MCP server
// ============================================================================
//
// Exposes the Smaragda ERP kernel over HTTP via the Model Context Protocol.
// Provides 6 tools for genus/entity CRUD and state machine operations.
//
// Usage:
//   bun server.ts
//
// Environment:
//   PORT           — HTTP port (default 3000)
//   DB_PATH        — SQLite database path (default "smaragda.db")
//   AUTH_TOKEN      — Bearer token (default: auto-generated, printed on startup)
//   OAUTH_PASSWORD — Password for OAuth approval page
//   ORIGIN         — Public origin for OAuth metadata (default: http://localhost:PORT)
//

import { mcpServer, httpCors, httpNotFound, sqliteOpen, sqliteMigrate } from "./libraries";
import {
  initKernel,
  getRes,
  materialize,
  replay,
  getGenusDef,
  defineEntityGenus,
  createEntity,
  setAttribute,
  transitionStatus,
  listGenera,
  listEntities,
  findGenusByName,
  appendTessella,
  defineActionGenus,
  executeAction,
  getActionDef,
  findActionByName,
  findActionsByTargetGenus,
  listActionGenera,
  getHistory,
  defineFeatureGenus,
  createFeature,
  setFeatureAttribute,
  transitionFeatureStatus,
  findFeatureGenusByName,
  getFeatureGenusForEntityGenus,
  listFeatureGenera,
  defineRelationshipGenus,
  createRelationship,
  getRelationshipsForEntity,
  getRelatedEntities,
  listRelationshipGenera,
  listRelationships,
  findRelationshipGenusByName,
  searchEntities,
  evolveGenus,
  deprecateGenus,
  restoreGenus,
  validateAttributes,
  validateStateMachine,
  validateActionHandler,
  validateProcessDefinition,
  evaluateHealth,
  listUnhealthy,
  acknowledgeError,
  listErrors,
  META_GENUS_ID,
  LOG_GENUS_ID,
  ERROR_GENUS_ID,
  TASK_GENUS_ID,
  BRANCH_GENUS_ID,
  TAXONOMY_GENUS_ID,
  DEFAULT_TAXONOMY_ID,
  SCIENCE_GENUS_ID,
  DEFAULT_SCIENCE_ID,
  CRON_SCHEDULE_GENUS_ID,
  createCronSchedule,
  createScheduledTrigger,
  parseDelay,
  listCronSchedules,
  fireCronSchedule,
  tickCron,
  createTaxonomy,
  listTaxonomies,
  findTaxonomyByName,
  describeTaxonomy,
  createScience,
  listSciences,
  findScienceByName,
  describeScience,
  createTask,
  completeTask,
  listTasks,
  createBranch,
  switchBranch,
  listBranches,
  mergeBranch,
  compareBranches,
  defineProcessGenus,
  startProcess,
  getProcessStatus,
  getProcessDef,
  listProcessGenera,
  findProcessGenusByName,
  listProcesses,
  defineSerializationGenus,
  findSerializationGenusByName,
  listSerializationGenera,
  runSerialization,
  writeFiletree,
  importFiletree,
  WORKSPACE_GENUS_ID,
  createWorkspace,
  listWorkspaces,
  findWorkspaceByName,
  assignWorkspace,
  assignWorkspaceByGenus,
  assignWorkspaceByTaxonomy,
  deleteWorkspace,
  mergeWorkspaces,
  backfillRelationshipWorkspaces,
  inferWorkspaceSciences,
  getWorkspaceScienceIds,
  addWorkspaceScience,
  removeWorkspaceScience,
  getWorkspaceTaxonomyIds,
  moveTaxonomy,
  moveGenus,
  evolveProcessGenus,
  shareTaxonomy,
  unshareTaxonomy,
  palaceBuildRoom,
  palaceGetRoom,
  palaceGetEntryRoom,
  palaceListRooms,
  palaceHasPalace,
  palaceWriteScroll,
  palaceGetScrolls,
  palaceDeleteRoom,
  palaceMergeRoom,
  palaceSearch,
  palaceCreateNPC,
  palaceGetNPC,
  palaceListNPCsInRoom,
  palaceListNPCs,
  palaceAddDialogue,
  palaceMergeNPC,
  palaceDeleteNPC,
  PALACE_NPC_GENUS_ID,
  palaceParseMarkup,
  palaceResolveMarkup,
  palaceFindEntity,
  setGenusTemplate,
  getGenusTemplates,
  renderTemplate,
  getEntityDisplayName,
  setTemporalAnchor,
  getTemporalAnchor,
  removeTemporalAnchor,
  queryTimeline,
  findTransitionPath,
} from "./smaragda";
import type { PalaceAction, PalaceRoom, PalaceScroll, PalaceScrollsResult, PalaceRoomManifest, PalaceManifestEntry, PalaceDialogueNode, PalaceNPC } from "./smaragda";

// --- Config ---

const PORT = Number(process.env.PORT ?? 3000);
const DB_PATH = process.env.DB_PATH ?? "smaragda.db";
const AUTH_TOKEN = process.env.AUTH_TOKEN ?? crypto.randomUUID();
const OAUTH_PASSWORD = process.env.OAUTH_PASSWORD;
const ORIGIN = process.env.ORIGIN ?? `http://localhost:${PORT}`;

// --- Kernel init ---

const kernel = initKernel(DB_PATH);

// One-time backfill: assign workspace_id to relationships based on their members
const backfill = backfillRelationshipWorkspaces(kernel);
if (backfill.assigned > 0) {
  console.log(`[backfill] Assigned workspace to ${backfill.assigned} relationships${backfill.conflicts.length > 0 ? `, ${backfill.conflicts.length} conflicts skipped` : ""}`);
}

// Auto-link sciences to workspaces based on entity genera
const inferred = inferWorkspaceSciences(kernel);
for (const r of inferred) {
  console.log(`[infer] Linked ${r.sciences.length} science(s) to workspace "${r.workspace}"`);
}

// --- Sessions DB ---

const SESSIONS_DB_PATH = DB_PATH.replace(/\.db$/, "-sessions.db");
const sessionsDb = sqliteOpen(SESSIONS_DB_PATH);
sqliteMigrate(sessionsDb, [
  `CREATE TABLE sessions (
    session_id TEXT PRIMARY KEY,
    data TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  )`,
]);

// Cleanup expired sessions (older than 7 days)
sessionsDb.run("DELETE FROM sessions WHERE updated_at < strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-7 days')");

// --- Session workspace context ---

interface NpcConversationState {
  npc_id: string;
  npc_slug: string;
  npc_name: string;
  dialogue: PalaceDialogueNode[];
  unlocked_tags: string[];
  current_node_id: string | null;
  visible_options: { index: number; node_id: string; prompt: string }[];
}

interface ScrollPileState {
  scrolls: PalaceScroll[];
}

interface SessionContext {
  workspace_id: string | null;
  current_branch: string;
  palace_current_slug: string | null;
  palace_action_menu: PalaceAction[] | null;
  palace_nav_history: string[];
  palace_last_results: { id: string; name: string }[];
  palace_room_manifest: PalaceRoomManifest | null;
  palace_npc_conversation: NpcConversationState | null;
  palace_scroll_pile: ScrollPileState | null;
  shown_tips: Set<number>;
}

const sessions = new Map<string, SessionContext>();
let _currentSessionId: string | null = null;

function _serializeSession(ctx: SessionContext): string {
  return JSON.stringify({
    ...ctx,
    shown_tips: [...ctx.shown_tips],
  });
}

function _deserializeSession(json: string): SessionContext {
  const raw = JSON.parse(json);
  return {
    workspace_id: raw.workspace_id ?? null,
    current_branch: raw.current_branch ?? "main",
    palace_current_slug: raw.palace_current_slug ?? null,
    palace_action_menu: raw.palace_action_menu ?? null,
    palace_nav_history: raw.palace_nav_history ?? [],
    palace_last_results: raw.palace_last_results ?? [],
    palace_room_manifest: raw.palace_room_manifest ?? null,
    palace_npc_conversation: raw.palace_npc_conversation ?? null,
    palace_scroll_pile: raw.palace_scroll_pile ?? null,
    shown_tips: new Set(raw.shown_tips ?? []),
  };
}

const _saveSessionStmt = sessionsDb.prepare(
  "INSERT OR REPLACE INTO sessions (session_id, data, updated_at) VALUES (?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))"
);
const _loadSessionStmt = sessionsDb.prepare("SELECT data FROM sessions WHERE session_id = ?");

function _saveSession(sessionId: string, ctx: SessionContext): void {
  _saveSessionStmt.run(sessionId, _serializeSession(ctx));
}

function _loadSession(sessionId: string): SessionContext | null {
  const row = _loadSessionStmt.get(sessionId) as { data: string } | null;
  if (!row) return null;
  return _deserializeSession(row.data);
}

function _getSessionContext(): SessionContext {
  const defaultCtx = (): SessionContext => ({ workspace_id: null, current_branch: "main", palace_current_slug: null, palace_action_menu: null, palace_nav_history: [], palace_last_results: [], palace_room_manifest: null, palace_npc_conversation: null, palace_scroll_pile: null, shown_tips: new Set() });
  if (!_currentSessionId) return defaultCtx();
  let ctx = sessions.get(_currentSessionId);
  if (!ctx) {
    ctx = _loadSession(_currentSessionId) ?? defaultCtx();
    sessions.set(_currentSessionId, ctx);
  }
  return ctx;
}

const _TIPS: string[] = [
  // Getting started
  'Call describe_system({ guide: true }) for a context-aware getting-started tutorial that adapts to your current state.',
  'Most entity operations require a workspace. Call set_workspace before creating or querying entities.',
  'When entering a workspace with a palace, read the room description — it contains actions, scrolls, and notices left by previous sessions.',
  // Schema
  'Genera (type definitions) are global — defining a genus makes it available in every workspace. Entities are workspace-scoped.',
  'evolve_genus is additive-only: you can add attributes, states, and transitions, but never remove or modify existing ones.',
  'Entity genera have no meta.kind. Action, feature, relationship, process, and serialization genera each have a distinct kind.',
  'Every genus needs exactly one state marked initial: true.',
  // Entities
  'Use target_status in create_entity to auto-traverse the state machine via BFS — no need to manually step through intermediate states.',
  'batch_update accepts a WHERE clause: where: "genus = \'X\' AND status = \'draft\'". Supports =, LIKE, and AND — no OR or nested expressions.',
  'Attributes are stored directly on state: state.title, not state.attributes.title. Same for features.',
  'search_entities does full-text search across all entity attributes.',
  'Use get_history({ entity_id: "...", diff: true }) to see only changed fields per tessella instead of full state.',
  // Palace
  'Use verb commands for natural interaction: palace_action({ verb: "look Widget A" }) for a brief summary, "examine" for full details.',
  'Room actions 1-60 are custom, 61-80 are entity drilldown from queries, 81-90 are scrolls, 91-97 are global utilities, 0 is the map.',
  'Write scrolls to leave notes for the next session: write_scroll({ title: "...", body: "..." }).',
  'Portals define map connections and enable the "go" verb. Navigate actions are numbered menu items. Use both for full coverage.',
  'Use palace_action({ action: 95 }) for palace health — it flags dead links, disconnected rooms, and missing query actions.',
  'Use palace_action({ action: 95, params: "repair" }) to auto-fix stale portal and navigate references.',
  'Room descriptions support live entity refs: *GenusName:EntityName* and portal links: [room-slug]link text[/].',
  'Use build_room with merge: true for incremental updates that preserve existing actions and portals.',
  // Relationships
  'For roles with one_or_more cardinality, pass an array: members: { role: ["ID1", "ID2"] }.',
  'Relationship genera require at least 2 roles.',
  'Use get_relationships({ entity_id: "..." }) to see all relationships for an entity.',
  // Actions
  'Handler tokens: $res.X.id for bound resource IDs, $param.X for parameters, $now for current ISO timestamp.',
  'Actions check entity status preconditions. Use list_available_actions to see what\'s available in the current state.',
  'Action side effects include: set_attribute, transition_status, create_res, create_log, create_error, create_task.',
  // Processes
  'When you complete_task on a process task, the process engine auto-advances to the next step.',
  'Process step types: task_step (waits for completion), action_step (immediate), gate_step (waits for conditions), fetch_step (reads data), branch_step (conditional).',
  // Session & branches
  'Pass _session_id from each response to your next call to maintain workspace, branch, and palace navigation state.',
  'Creating or switching branches resets palace navigation state. Re-enter via set_workspace afterward.',
  // Classification
  'Link a science to a workspace to filter describe_system to only show genera from that science\'s taxonomies.',
  'Taxonomies can be shared across multiple sciences with share_taxonomy.',
  // Health & errors
  'Errors have a state machine: open → acknowledged. Use acknowledge_error to resolve them — they\'re not immutable like logs.',
  'list_unhealthy flags entities with missing required attributes, type mismatches, or invalid statuses.',
  // Features
  'Feature editing can be gated by parent entity status via editable_parent_statuses on the feature genus.',
  // Serialization
  'run_serialization exports entities to a markdown file tree. Edit the files externally, then import_filetree to apply changes back as tessellae.',
  // Name resolution
  'Most tools accept names or IDs for genera, taxonomies, sciences, and workspaces. Names resolve case-insensitively.',
  // NPCs
  'NPC dialogue nodes can use requires and unlocks for progressive disclosure — reveal new options as the agent explores.',
  // Cron
  'Use schedule_trigger for one-time future triggers with delays like "90m" or "2h" — no cron expression needed.',
  // Misc
  'Use describe_genus({ genus: "..." }) for a deep dive: per-state actions, related features, relationships, and processes.',
  'Use compare_branches to diff entity state between two branches before merging.',
  'Use create_entities to batch-create multiple entities in a single call.',
];

function _palaceNavigate(ctx: SessionContext, newSlug: string, room: PalaceRoom): void {
  if (ctx.palace_current_slug && ctx.palace_current_slug !== newSlug) {
    ctx.palace_nav_history.push(ctx.palace_current_slug);
    if (ctx.palace_nav_history.length > 20) ctx.palace_nav_history.shift();
  }
  ctx.palace_current_slug = newSlug;
  ctx.palace_action_menu = room.actions;
  ctx.palace_last_results = [];
  ctx.palace_room_manifest = null;
  ctx.palace_npc_conversation = null;
  ctx.palace_scroll_pile = null;
}

function _reachableStates(genusDef: { transitions: { from: string; to: string }[] }, from: string): string[] {
  const visited = new Set<string>([from]);
  const queue = [from];
  while (queue.length > 0) {
    const state = queue.shift()!;
    for (const t of genusDef.transitions) {
      if (t.from === state && !visited.has(t.to)) {
        visited.add(t.to);
        queue.push(t.to);
      }
    }
  }
  visited.delete(from);
  return [...visited];
}

function _requireWorkspace(): void {
  if (!kernel.currentWorkspace) {
    throw new Error(
      "No workspace set. Use set_workspace to select a workspace before modifying entities."
    );
  }
  // Sync branch from session context
  const ctx = _getSessionContext();
  kernel.currentBranch = ctx.current_branch;
}

function _workspaceContext(): Record<string, unknown> {
  if (kernel.currentWorkspace) return {};
  const ws = listWorkspaces(kernel);
  if (ws.length === 0) {
    return { _note: "No workspaces exist. Create one with create_workspace." };
  }
  return {
    _note: `No workspace set. Available: ${ws.map((w) => w.name).join(", ")}. Use set_workspace to scope results.`,
  };
}

// --- OAuth migrations (separate _oauth_migrations table) ---

function oauthMigrate(migrations: string[]): void {
  const db = kernel.db;
  db.run(`
    CREATE TABLE IF NOT EXISTS _oauth_migrations (
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    )
  `);
  const row = db.query("SELECT COALESCE(MAX(version), -1) as v FROM _oauth_migrations").get() as { v: number };
  const startAt = row.v + 1;
  if (startAt >= migrations.length) return;
  const apply = db.transaction(() => {
    for (let i = startAt; i < migrations.length; i++) {
      db.run(migrations[i]);
      db.run("INSERT INTO _oauth_migrations (version) VALUES (?)", [i]);
    }
  });
  apply();
}

oauthMigrate([
  `CREATE TABLE oauth_clients (
    client_id TEXT PRIMARY KEY,
    client_name TEXT NOT NULL,
    redirect_uris TEXT NOT NULL,
    grant_types TEXT NOT NULL,
    response_types TEXT NOT NULL,
    token_endpoint_auth_method TEXT NOT NULL DEFAULT 'none',
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  )`,
  `CREATE TABLE oauth_codes (
    code TEXT PRIMARY KEY,
    client_id TEXT NOT NULL,
    redirect_uri TEXT NOT NULL,
    code_challenge TEXT NOT NULL,
    code_challenge_method TEXT NOT NULL DEFAULT 'S256',
    resource TEXT,
    expires_at TEXT NOT NULL,
    used INTEGER NOT NULL DEFAULT 0
  )`,
  `CREATE TABLE oauth_tokens (
    token TEXT PRIMARY KEY,
    token_type TEXT NOT NULL,
    client_id TEXT NOT NULL,
    resource TEXT,
    expires_at TEXT NOT NULL,
    refresh_token_id TEXT,
    revoked INTEGER NOT NULL DEFAULT 0
  )`,
]);

// --- PKCE verification ---

async function verifyPkce(codeVerifier: string, codeChallenge: string): Promise<boolean> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(codeVerifier));
  const base64url = btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return base64url === codeChallenge;
}

// --- Seed: Server genus (idempotent, evolution-aware) ---

{
  const existingServerGenus = findGenusByName(kernel, "Server");
  if (!existingServerGenus) {
    defineEntityGenus(kernel, "Server", {
      attributes: [
        { name: "hostname", type: "text", required: true },
        { name: "ip_address", type: "text" },
        { name: "provider", type: "text" },
        { name: "monthly_cost", type: "number" },
        { name: "version", type: "text" },
        { name: "deployed_at", type: "text" },
      ],
      states: [
        { name: "provisioning", initial: true },
        { name: "active", initial: false },
        { name: "deployed", initial: false },
        { name: "decommissioned", initial: false },
      ],
      transitions: [
        { from: "provisioning", to: "active", name: "Activate" },
        { from: "active", to: "deployed", name: "Deploy" },
        { from: "active", to: "decommissioned", name: "Decommission" },
        { from: "deployed", to: "active", name: "Rollback" },
        { from: "deployed", to: "decommissioned", name: "Decommission" },
      ],
      meta: { description: "Physical or virtual server with provisioning and deployment lifecycle" },
      taxonomy_id: DEFAULT_TAXONOMY_ID,
    });
  } else {
    evolveGenus(kernel, existingServerGenus, {
      attributes: [
        { name: "version", type: "text", required: false },
        { name: "deployed_at", type: "text", required: false },
      ],
      states: [{ name: "deployed", initial: false }],
      transitions: [
        { from: "active", to: "deployed", name: "Deploy" },
        { from: "deployed", to: "active", name: "Rollback" },
        { from: "deployed", to: "decommissioned", name: "Decommission" },
      ],
    });
  }
}

// --- Seed: deploy action (idempotent) ---

if (!findActionByName(kernel, "deploy")) {
  defineActionGenus(kernel, "deploy", {
    resources: [{ name: "server", genus_name: "Server", required_status: "active" }],
    parameters: [{ name: "version", type: "text", required: true }],
    handler: [
      { type: "set_attribute", res: "$res.server.id", key: "deployed_at", value: "$now" },
      { type: "set_attribute", res: "$res.server.id", key: "version", value: "$param.version" },
      { type: "create_log", res: "$res.server.id", message: "Deployed version $param.version", severity: "info" },
      { type: "transition_status", res: "$res.server.id", target: "deployed" },
    ],
    meta: { description: "Deploy a version to an active server, logs the deployment" },
    taxonomy_id: DEFAULT_TAXONOMY_ID,
  });
}

// --- Seed: Issue genus (idempotent) ---

if (!findGenusByName(kernel, "Issue")) {
  defineEntityGenus(kernel, "Issue", {
    attributes: [
      { name: "title", type: "text", required: true },
      { name: "description", type: "text" },
    ],
    states: [
      { name: "draft", initial: true },
      { name: "in_review", initial: false },
      { name: "approved", initial: false },
      { name: "published", initial: false },
      { name: "archived", initial: false },
    ],
    transitions: [
      { from: "draft", to: "in_review", name: "Submit for review" },
      { from: "in_review", to: "approved", name: "Approve" },
      { from: "in_review", to: "draft", name: "Return to draft" },
      { from: "approved", to: "published", name: "Publish" },
      { from: "draft", to: "archived", name: "Archive" },
      { from: "in_review", to: "archived", name: "Archive" },
      { from: "approved", to: "archived", name: "Archive" },
      { from: "published", to: "archived", name: "Archive" },
    ],
    meta: { description: "Publication issue tracking content through editorial workflow" },
    taxonomy_id: DEFAULT_TAXONOMY_ID,
  });
}

// --- Seed: Page feature genus (idempotent) ---

if (!findFeatureGenusByName(kernel, "Page")) {
  defineFeatureGenus(kernel, "Page", {
    parent_genus_name: "Issue",
    attributes: [
      { name: "page_number", type: "number", required: true },
      { name: "content", type: "text" },
      { name: "image_ref", type: "text" },
    ],
    states: [
      { name: "draft", initial: true },
      { name: "layout_complete", initial: false },
      { name: "approved", initial: false },
    ],
    transitions: [
      { from: "draft", to: "layout_complete", name: "Complete layout" },
      { from: "layout_complete", to: "approved", name: "Approve" },
      { from: "approved", to: "draft", name: "Reopen" },
    ],
    editable_parent_statuses: ["draft", "in_review"],
    meta: { description: "Individual page within an Issue with layout and approval tracking" },
    taxonomy_id: DEFAULT_TAXONOMY_ID,
  });
}

// --- Seed: Person genus (idempotent) ---

if (!findGenusByName(kernel, "Person")) {
  defineEntityGenus(kernel, "Person", {
    attributes: [
      { name: "name", type: "text", required: true },
      { name: "role", type: "text" },
      { name: "email", type: "text" },
    ],
    states: [
      { name: "active", initial: true },
      { name: "inactive", initial: false },
    ],
    transitions: [
      { from: "active", to: "inactive", name: "Deactivate" },
      { from: "inactive", to: "active", name: "Activate" },
    ],
    meta: { description: "Team member who can be assigned to content" },
    taxonomy_id: DEFAULT_TAXONOMY_ID,
  });
}

// --- Seed: Assignment relationship genus (idempotent) ---

if (!findRelationshipGenusByName(kernel, "Assignment")) {
  defineRelationshipGenus(kernel, "Assignment", {
    roles: [
      { name: "artist", valid_member_genera: ["Person"], cardinality: "one" },
      { name: "content", valid_member_genera: ["Issue"], cardinality: "one" },
    ],
    attributes: [
      { name: "assigned_at", type: "text" },
      { name: "deadline", type: "text" },
    ],
    states: [
      { name: "active", initial: true },
      { name: "completed", initial: false },
      { name: "cancelled", initial: false },
    ],
    transitions: [
      { from: "active", to: "completed", name: "Complete" },
      { from: "active", to: "cancelled", name: "Cancel" },
      { from: "completed", to: "active", name: "Reactivate" },
    ],
    meta: { description: "Links a Person to an Issue as an assigned artist" },
    taxonomy_id: DEFAULT_TAXONOMY_ID,
  });
}

// --- Seed: submit_for_review action (idempotent) ---

if (!findActionByName(kernel, "submit_for_review")) {
  defineActionGenus(kernel, "submit_for_review", {
    resources: [{ name: "issue", genus_name: "Issue", required_status: "draft" }],
    parameters: [],
    handler: [
      { type: "transition_status", res: "$res.issue.id", target: "in_review" },
      { type: "create_log", res: "$res.issue.id", message: "Submitted for review", severity: "info" },
    ],
    meta: { description: "Submit a draft issue for editorial review" },
    taxonomy_id: DEFAULT_TAXONOMY_ID,
  });
}

// --- Seed: publish_issue action (idempotent) ---

if (!findActionByName(kernel, "publish_issue")) {
  defineActionGenus(kernel, "publish_issue", {
    resources: [{ name: "issue", genus_name: "Issue", required_status: "approved" }],
    parameters: [],
    handler: [
      { type: "transition_status", res: "$res.issue.id", target: "published" },
      { type: "create_log", res: "$res.issue.id", message: "Issue published", severity: "info" },
    ],
    meta: { description: "Publish an approved issue" },
    taxonomy_id: DEFAULT_TAXONOMY_ID,
  });
}

// --- Seed: Publication process genus (idempotent) ---

if (!findProcessGenusByName(kernel, "Publication")) {
  defineProcessGenus(kernel, "Publication", {
    lanes: [
      { name: "editorial", position: 0 },
      { name: "art", position: 1 },
      { name: "final", position: 2 },
    ],
    steps: [
      { name: "review", type: "task_step", lane: "editorial", position: 0,
        task_title: "Review issue content", task_description: "Review and approve editorial content", task_priority: "high" },
      { name: "copyedit", type: "task_step", lane: "editorial", position: 1,
        task_title: "Copyedit issue", task_description: "Final copyediting pass", task_priority: "normal" },
      { name: "editorial_approved", type: "fetch_step", lane: "editorial", position: 2,
        fetch_source: "status" },
      { name: "commission_art", type: "task_step", lane: "art", position: 0,
        task_title: "Commission artwork", task_description: "Commission art for the issue", task_priority: "high" },
      { name: "draft_art", type: "task_step", lane: "art", position: 1,
        task_title: "Draft artwork", task_description: "Create initial art drafts", task_priority: "normal" },
      { name: "revise_art", type: "task_step", lane: "art", position: 2,
        task_title: "Revise artwork", task_description: "Apply revisions to artwork", task_priority: "normal" },
      { name: "art_approved", type: "fetch_step", lane: "art", position: 3,
        fetch_source: "status" },
      { name: "convergence", type: "gate_step", lane: "final", position: 0,
        gate_conditions: ["editorial_approved", "art_approved"] },
      { name: "publish", type: "action_step", lane: "final", position: 1,
        action_name: "publish_issue",
        action_resource_bindings: { issue: "$context.res_id" } },
    ],
    triggers: [{ type: "manual" }],
    meta: { description: "Full publication workflow with editorial and art lanes converging at a gate before publish" },
    taxonomy_id: DEFAULT_TAXONOMY_ID,
  });
}

// --- Seed: Device genus (idempotent) ---

if (!findGenusByName(kernel, "Device")) {
  defineEntityGenus(kernel, "Device", {
    attributes: [
      { name: "name", type: "text", required: true },
      { name: "token_hash", type: "text" },
      { name: "last_sync_at", type: "text" },
    ],
    states: [
      { name: "active", initial: true },
      { name: "deactivated", initial: false },
    ],
    transitions: [{ from: "active", to: "deactivated", name: "Deactivate" }],
    meta: { description: "Sync client device for push/pull replication" },
    taxonomy_id: DEFAULT_TAXONOMY_ID,
  });
}

// --- Seed: Markdown Export serialization target (idempotent) ---

if (!findSerializationGenusByName(kernel, "Markdown Export")) {
  defineSerializationGenus(kernel, "Markdown Export", {
    input: { query_type: "by_genus", genus_name: "Issue" },
    output: { format: "markdown", output_shape: "filetree" },
    handler: [
      { type: "directory", name: "{{entity.title}}", children: [
        { type: "file", name: "index.md", body_attribute: "description",
          content: "---\ntitle: {{entity.title}}\nstatus: {{entity.status}}\ncover_image: {{entity.cover_image}}\n---\n{{entity.description}}" },
        { type: "for_each_feature", genus_name: "Page", children: [
          { type: "file", name: "page-{{feature.page_number}}.md", body_attribute: "content",
            content: "---\npage_number: {{feature.page_number}}\nstatus: {{feature.status}}\n---\n{{feature.content}}" },
        ]},
      ]},
    ],
    meta: { description: "Export Issues with Pages to markdown files" },
    taxonomy_id: DEFAULT_TAXONOMY_ID,
  });
}

// --- Seed: backfill descriptions + transition names on existing genera ---

{
  const descriptionMap: Record<string, string> = {
    Server: "Physical or virtual server with provisioning and deployment lifecycle",
    Issue: "Publication issue tracking content through editorial workflow",
    Page: "Individual page within an Issue with layout and approval tracking",
    Person: "Team member who can be assigned to content",
    Assignment: "Links a Person to an Issue as an assigned artist",
    Device: "Sync client device for push/pull replication",
    deploy: "Deploy a version to an active server, logs the deployment",
  };

  const transitionNameMap: Record<string, Record<string, string>> = {
    Server: {
      "provisioning→active": "Activate",
      "active→deployed": "Deploy",
      "active→decommissioned": "Decommission",
      "deployed→active": "Rollback",
      "deployed→decommissioned": "Decommission",
    },
    Issue: {
      "draft→in_review": "Submit for review",
      "in_review→approved": "Approve",
      "in_review→draft": "Return to draft",
      "approved→published": "Publish",
      "draft→archived": "Archive",
      "in_review→archived": "Archive",
      "approved→archived": "Archive",
      "published→archived": "Archive",
    },
    Page: {
      "draft→layout_complete": "Complete layout",
      "layout_complete→approved": "Approve",
      "approved→draft": "Reopen",
    },
    Person: {
      "active→inactive": "Deactivate",
      "inactive→active": "Activate",
    },
    Assignment: {
      "active→completed": "Complete",
      "active→cancelled": "Cancel",
      "completed→active": "Reactivate",
    },
    Device: {
      "active→deactivated": "Deactivate",
    },
  };

  // Helper to find a genus by name across all kinds
  function findAnyGenusByName(name: string): string | null {
    return findGenusByName(kernel, name)
      ?? findFeatureGenusByName(kernel, name)
      ?? findRelationshipGenusByName(kernel, name)
      ?? findActionByName(kernel, name);
  }

  for (const [genusName, description] of Object.entries(descriptionMap)) {
    const genusId = findAnyGenusByName(genusName);
    if (!genusId) continue;
    const def = getGenusDef(kernel, genusId);
    if (!def.meta.description) {
      appendTessella(kernel, genusId, "genus_meta_set", { key: "description", value: description });
    }
  }

  for (const [genusName, transitions] of Object.entries(transitionNameMap)) {
    const genusId = findAnyGenusByName(genusName);
    if (!genusId) continue;
    const def = getGenusDef(kernel, genusId);
    const needsBackfill = def.transitions.some((t) => {
      const key = `${t.from}→${t.to}`;
      return key in transitions && !t.name;
    });
    if (!needsBackfill) continue;
    // Re-append named transitions for any that are missing names
    for (const t of def.transitions) {
      const key = `${t.from}→${t.to}`;
      if (key in transitions && !t.name) {
        appendTessella(kernel, genusId, "genus_transition_defined", {
          from: t.from,
          to: t.to,
          name: transitions[key],
        });
      }
    }
  }
}

// --- Auth ---

function requireAuth(req: Request): Response | null {
  const header = req.headers.get("Authorization");
  if (!header) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: {
        "Content-Type": "application/json",
        "WWW-Authenticate": `Bearer resource_metadata="${ORIGIN}/.well-known/oauth-protected-resource"`,
      },
    });
  }

  const token = header.replace(/^Bearer\s+/i, "");

  // Static token fast path (backward compat)
  if (token === AUTH_TOKEN) return null;

  // OAuth token lookup
  const row = kernel.db.query(
    "SELECT * FROM oauth_tokens WHERE token = ? AND token_type = 'access' AND revoked = 0 AND expires_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now')"
  ).get(token) as any;
  if (row) return null;

  return new Response(JSON.stringify({ error: "Unauthorized" }), {
    status: 401,
    headers: {
      "Content-Type": "application/json",
      "WWW-Authenticate": `Bearer resource_metadata="${ORIGIN}/.well-known/oauth-protected-resource"`,
    },
  });
}

// --- Name list helper for error messages ---

function _nameList(names: string[]): string {
  if (names.length === 0) return "none defined";
  if (names.length > 10) return names.slice(0, 10).join(", ") + `, ... and ${names.length - 10} more`;
  return names.join(", ");
}

// --- Genus resolution helper ---

function resolveGenusId(genus: string): string {
  const byName = findGenusByName(kernel, genus);
  if (byName) return byName;
  try {
    getGenusDef(kernel, genus);
    return genus;
  } catch {
    const available = _nameList(listGenera(kernel).map(g => g.name));
    throw new Error(`Genus not found: "${genus}". Available genera: ${available}`);
  }
}

// --- WHERE clause parser ---

interface ParsedWhere {
  genus_id?: string;
  status?: string;
  attribute_filters?: { key: string; op: "eq" | "contains"; value: string }[];
}

function _parseWhereClause(where: string): ParsedWhere {
  const result: ParsedWhere = {};
  const filters: { key: string; op: "eq" | "contains"; value: string }[] = [];

  // Split on AND (case-insensitive), trim each condition
  const conditions = where.split(/\bAND\b/i).map((c) => c.trim()).filter(Boolean);

  for (const cond of conditions) {
    // Match: field LIKE '%value%'
    const likeMatch = cond.match(/^(\w+)\s+LIKE\s+'%(.+)%'$/i);
    if (likeMatch) {
      const [, field, value] = likeMatch;
      if (field.toLowerCase() === "genus") {
        // LIKE on genus — treat as contains on name, resolve all genera and filter
        const genera = listGenera(kernel);
        const match = genera.find((g) => g.name.toLowerCase().includes(value.toLowerCase()));
        if (match) result.genus_id = match.id;
        else throw new Error(`No genus matching '%${value}%'`);
      } else if (field.toLowerCase() === "status") {
        throw new Error(`LIKE is not supported for status. Use: status = 'value'`);
      } else {
        filters.push({ key: field, op: "contains", value });
      }
      continue;
    }

    // Match: field = 'value' or field = "value"
    const eqMatch = cond.match(/^(\w+)\s*=\s*['"](.+)['"]$/);
    if (eqMatch) {
      const [, field, value] = eqMatch;
      if (field.toLowerCase() === "genus") {
        result.genus_id = resolveGenusId(value);
      } else if (field.toLowerCase() === "status") {
        result.status = value;
      } else {
        filters.push({ key: field, op: "eq", value });
      }
      continue;
    }

    throw new Error(`Cannot parse WHERE condition: "${cond}". Supported: field = 'value', field LIKE '%value%', combined with AND.`);
  }

  if (filters.length > 0) result.attribute_filters = filters;
  return result;
}

// --- MCP server + tools ---

const SERVER_VERSION = "0.12.0";
const mcp = mcpServer({ name: "smaragda", version: SERVER_VERSION });

// Wrap mcp.tool to auto-handle _session_id on every tool.
// Agents receive a _session_id on first call and pass it back on subsequent
// calls to maintain workspace context across requests.
const _rawTool = mcp.tool.bind(mcp);
mcp.tool = ((name: string, def: any) => {
  const originalHandler = def.handler;
  const wrappedInput = {
    ...def.input,
    properties: {
      ...(def.input?.properties ?? {}),
      _session_id: {
        type: "string",
        description: "Session ID returned by previous tool calls. Pass to maintain workspace context.",
      },
    },
  };
  _rawTool(name, {
    ...def,
    input: wrappedInput,
    handler: async (args: any) => {
      const { _session_id, ...toolArgs } = args;
      _currentSessionId = _session_id || null;
      if (!_currentSessionId) {
        _currentSessionId = crypto.randomUUID();
      }
      const ctx = _getSessionContext();
      kernel.currentWorkspace = ctx.workspace_id;
      try {
        const result = await originalHandler(toolArgs);
        try {
          const parsed = JSON.parse(result);
          parsed._session_id = _currentSessionId;
          // Inject random educational tip (non-repeating within session)
          const available = _TIPS.map((t, i) => i).filter(i => !ctx.shown_tips.has(i));
          if (available.length > 0) {
            const idx = available[Math.floor(Math.random() * available.length)];
            ctx.shown_tips.add(idx);
            parsed._tip = _TIPS[idx];
          }
          return JSON.stringify(parsed, null, 2);
        } catch {
          return result;
        }
      } finally {
        if (_currentSessionId) {
          const sessionCtx = sessions.get(_currentSessionId);
          if (sessionCtx) _saveSession(_currentSessionId, sessionCtx);
        }
        kernel.currentWorkspace = null;
        _currentSessionId = null;
      }
    },
  });
}) as typeof mcp.tool;

// --- Palace helpers ---

const PALACE_TUTORIAL_TEXT = `Welcome to your workshop. This is a place you build and tend — a castle of rooms for each area of knowledge you're exploring. Previous versions of you have built this place, and you are inheriting their work.

Each room has a vivid description and numbered actions. You navigate by picking a number. You can examine exhibits (which query real data), write scrolls (dated notes for your successor), and build new rooms as you explore.

The palace is yours to shape. Give rooms character — cracked floors, dusty bookshelves, light through stained glass. The vividness helps you navigate and helps the next you remember what's where.

If no palace exists yet, survey the workspace and build an entry room. If one exists, read the scrolls and pick up where your predecessor left off.`;

function _relativeTime(isoString: string): string {
  const then = new Date(isoString).getTime();
  const now = Date.now();
  const diffMs = now - then;
  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 60) return "just now";
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin} minute${diffMin === 1 ? "" : "s"} ago`;
  const diffHrs = Math.floor(diffMin / 60);
  if (diffHrs < 24) return `${diffHrs} hour${diffHrs === 1 ? "" : "s"} ago`;
  const diffDays = Math.floor(diffHrs / 24);
  if (diffDays < 30) return `${diffDays} day${diffDays === 1 ? "" : "s"} ago`;
  const diffMonths = Math.floor(diffDays / 30);
  return `${diffMonths} month${diffMonths === 1 ? "" : "s"} ago`;
}

function _normalizeAction(raw: Record<string, unknown>): PalaceAction {
  if (!raw.label || typeof raw.label !== "string") {
    throw new Error(`Action missing required "label" field.`);
  }

  // entity_id shorthand → auto-expand to query type
  if (raw.entity_id) {
    return {
      label: raw.label as string,
      type: "query",
      tool: "get_entity",
      tool_params: { id: raw.entity_id as string },
    };
  }

  // entity_ref shorthand → auto-expand to query type (resolve later at dispatch)
  if (raw.entity_ref) {
    return {
      label: raw.label as string,
      type: "query",
      tool: "get_entity",
      tool_params: { ref: raw.entity_ref as string },
    };
  }

  // Infer type from other fields if missing
  let type = raw.type as string | undefined;
  if (!type) {
    if (raw.room) type = "navigate";
    else if (raw.tool) type = "query";
    else if (raw.content) type = "text";
    else throw new Error(`Action "${raw.label}" has no type. Valid types: navigate, query, text. Or provide entity_id for automatic expansion.`);
  }

  const validTypes = ["navigate", "query", "text"];
  if (!validTypes.includes(type)) {
    throw new Error(`Action "${raw.label}" has invalid type "${type}". Valid types: ${validTypes.join(", ")}.`);
  }

  return {
    label: raw.label as string,
    type: type as PalaceAction["type"],
    room: raw.room as string | undefined,
    tool: raw.tool as string | undefined,
    tool_params: raw.tool_params as Record<string, unknown> | undefined,
    content: raw.content as string | undefined,
    workspace: raw.workspace as string | undefined,
  };
}

function _normalizeActions(rawActions: unknown[]): PalaceAction[] {
  return rawActions.map((raw, i) => {
    if (!raw || typeof raw !== "object") throw new Error(`Action at index ${i} is not an object.`);
    return _normalizeAction(raw as Record<string, unknown>);
  });
}

function _normalizeDialogueNodes(rawNodes: unknown[]): PalaceDialogueNode[] {
  return rawNodes.map((raw, i) => {
    if (!raw || typeof raw !== "object") throw new Error(`Dialogue node at index ${i} is not an object.`);
    const r = raw as Record<string, unknown>;
    if (!r.id || typeof r.id !== "string") throw new Error(`Dialogue node at index ${i} missing required "id" field.`);
    if (!r.parent || typeof r.parent !== "string") throw new Error(`Dialogue node "${r.id}" missing required "parent" field.`);
    if (!r.prompt || typeof r.prompt !== "string") throw new Error(`Dialogue node "${r.id}" missing required "prompt" field.`);
    // Accept "response" as alias for "text"
    const text = (r.text ?? r.response) as string | undefined;
    if (!text || typeof text !== "string") throw new Error(`Dialogue node "${r.id}" missing required "text" field. (Also accepts "response" as an alias.)`);
    return {
      id: r.id as string,
      parent: r.parent as string,
      prompt: r.prompt as string,
      text,
      entity_id: r.entity_id as string | undefined,
      entity_ref: r.entity_ref as string | undefined,
      requires: r.requires as string[] | undefined,
      unlocks: r.unlocks as string[] | undefined,
    };
  });
}

function _summarizeDialogueTree(dialogue: PalaceDialogueNode[]): string {
  const rootNodes = dialogue.filter(n => n.parent === "root");
  const lines: string[] = [`Dialogue tree (${dialogue.length} node${dialogue.length === 1 ? "" : "s"}, ${rootNodes.length} root option${rootNodes.length === 1 ? "" : "s"}):`];

  function renderNode(node: PalaceDialogueNode, depth: number) {
    const indent = "  ".repeat(depth + 1);
    const tags: string[] = [];
    if (node.entity_id || node.entity_ref) tags.push("entity");
    if (node.requires?.length) tags.push(`requires:[${node.requires.join(",")}]`);
    if (node.unlocks?.length) tags.push(`unlocks:[${node.unlocks.join(",")}]`);
    const tagStr = tags.length > 0 ? ` (${tags.join(", ")})` : "";
    const promptPreview = node.prompt.length > 50 ? node.prompt.slice(0, 47) + "..." : node.prompt;
    lines.push(`${indent}- [${node.id}] "${promptPreview}"${tagStr}`);
    const children = dialogue.filter(n => n.parent === node.id);
    for (const child of children) renderNode(child, depth + 1);
  }

  for (const root of rootNodes) renderNode(root, 0);
  return lines.join("\n");
}

function _renderActionMenu(room: PalaceRoom, scrolls?: PalaceScroll[], opts?: { queryResults?: { id: string; name: string }[]; hasHistory?: boolean; totalScrolls?: number }): string {
  const lines: string[] = ["Actions:"];
  for (let i = 0; i < room.actions.length; i++) {
    lines.push(`  ${i + 1}. ${room.actions[i].label}`);
  }
  if (opts?.queryResults && opts.queryResults.length > 0) {
    lines.push("  \u2500\u2500\u2500\u2500\u2500");
    for (let i = 0; i < opts.queryResults.length && i < 20; i++) {
      lines.push(`  ${61 + i}. View: ${opts.queryResults[i].name}`);
    }
  }
  if (scrolls && scrolls.length > 0) {
    lines.push("  \u2500\u2500\u2500\u2500\u2500");
    const hasPile = (opts?.totalScrolls ?? 0) > 10;
    const displayCount = hasPile ? Math.min(scrolls.length, 9) : Math.min(scrolls.length, 10);
    for (let i = 0; i < displayCount; i++) {
      lines.push(`  ${81 + i}. Read: ${scrolls[i].title}`);
    }
    if (hasPile) {
      const olderCount = opts!.totalScrolls! - displayCount;
      lines.push(`  90. Rummage through the pile of scrolls (${olderCount} older)`);
    }
  }
  lines.push("  \u2500\u2500\u2500\u2500\u2500");
  lines.push("  91. Check inventory");
  lines.push("  92. Write a scroll");
  lines.push("  93. Search palace");
  lines.push("  94. Teleport to room");
  lines.push("  95. Palace health");
  if (opts?.hasHistory) lines.push("  96. Go back");
  lines.push("  97. Delete room");
  lines.push("   0. View map");
  return lines.join("\n");
}

function _renderRoom(room: PalaceRoom, scrollsResult: PalaceScrollsResult): string {
  const lines: string[] = [];
  lines.push(`\u2500\u2500 ${room.name} \u2500\u2500`);

  // v2 markup: parse and resolve entity/portal refs
  const tokens = palaceParseMarkup(room.description);
  const hasMarkup = tokens.some(t => t.type !== "text");
  let manifest: PalaceRoomManifest | null = null;
  if (hasMarkup) {
    manifest = palaceResolveMarkup(kernel, kernel.currentWorkspace!, tokens);
    lines.push(manifest.rendered);
  } else {
    lines.push(room.description);
  }

  // Manifest footer — list interactable entities and exits
  if (manifest && manifest.entries.length > 0) {
    const entities = manifest.entries.filter(e => e.kind === "entity");
    const portals = manifest.entries.filter(e => e.kind === "portal");
    if (entities.length > 0) {
      lines.push(`You see: ${entities.map(e => e.genus_name ? `${e.match_name} (${e.genus_name})` : e.match_name).join(", ")}`);
    }
    if (portals.length > 0) {
      lines.push(`Exits: ${portals.map(e => e.match_name).join(", ")}`);
    }
  }
  lines.push("");

  // Server-placed notices
  if (kernel.currentWorkspace) {
    const notices: string[] = [];

    // Running processes
    const processes = listProcesses(kernel, { status: "running" });
    for (const proc of processes) {
      notices.push(`[Process: ${proc.process_name} (${proc.step_summary.completed}/${proc.step_summary.total} steps)]`);
    }

    // Unhealthy entities — only those explicitly assigned to this workspace
    const unhealthy = listUnhealthy(kernel, { only_workspace: true });
    if (unhealthy.length > 0) {
      notices.push(`[${unhealthy.length} unhealthy entit${unhealthy.length === 1 ? "y" : "ies"}]`);
    }

    // Pending tasks — filtered to current workspace
    const tasks = listTasks(kernel);
    const pendingTasks = tasks.filter((t) => {
      if (t.status !== "pending" && t.status !== "claimed") return false;
      const row = kernel.db.query("SELECT workspace_id FROM res WHERE id = ?").get(t.id) as any;
      return row && row.workspace_id === kernel.currentWorkspace;
    });
    if (pendingTasks.length > 0) {
      notices.push(`[${pendingTasks.length} pending task${pendingTasks.length === 1 ? "" : "s"}]`);
    }

    if (notices.length > 0) {
      lines.push("Notices:");
      for (const n of notices) lines.push(`  ${n}`);
      lines.push("");
    }
  }

  // NPC listing
  if (kernel.currentWorkspace) {
    const npcsInRoom = palaceListNPCsInRoom(kernel, kernel.currentWorkspace, room.slug);
    if (npcsInRoom.length > 0) {
      lines.push(`NPCs: ${npcsInRoom.map(n => `${n.name} (${n.slug})`).join(", ")}`);
      lines.push("");
    }
  }

  // Store manifest in session for verb resolution
  const ctx = _currentSessionId ? _getSessionContext() : null;
  if (ctx) ctx.palace_room_manifest = manifest;
  lines.push(_renderActionMenu(room, scrollsResult.scrolls, { totalScrolls: scrollsResult.total, hasHistory: (ctx?.palace_nav_history.length ?? 0) > 0 }));
  return lines.join("\n");
}

function _renderUnfinishedRoom(slug: string, workspace_id: string, backSlug: string): string {
  const lines: string[] = [];
  lines.push(`\u2500\u2500 [Unfinished Room] \u2500\u2500`);
  lines.push(`You step through the archway marked '${slug}'`);
  lines.push("but the room beyond is bare stone \u2014 unfinished, waiting");
  lines.push("to be shaped.");
  lines.push("");

  // Workspace context — only genera with entities
  const genera = listGenera(kernel);
  const generaWithEntities = genera.map((g) => ({
    name: g.name,
    count: listEntities(kernel, { genus_id: g.id }).length,
  })).filter((g) => g.count > 0);
  if (generaWithEntities.length > 0) {
    lines.push("Workspace context:");
    for (const g of generaWithEntities) {
      lines.push(`  ${g.name}: ${g.count} entit${g.count === 1 ? "y" : "ies"}`);
    }
    lines.push("");
  }

  lines.push("Build this room with build_room to continue.");
  lines.push("");
  lines.push("Actions:");

  // Back action
  const backRoom = palaceGetRoom(kernel, workspace_id, backSlug);
  const backLabel = backRoom ? `Go back to ${backRoom.name}` : "Go back";
  lines.push(`  4. ${backLabel}`);
  lines.push("  \u2500\u2500\u2500\u2500\u2500");
  lines.push("  91. Check inventory");
  lines.push("  92. Write a scroll");
  lines.push("  93. Search palace");
  lines.push("  94. Teleport to room");
  lines.push("  95. Palace health");
  lines.push("   0. View map");
  return lines.join("\n");
}

function _palaceMap(workspace_id: string, currentSlug: string | null): string {
  const rooms = palaceListRooms(kernel, workspace_id);
  if (rooms.length === 0) return "The palace is empty. Build a room with build_room.";

  const lines: string[] = ["\u2500\u2500 Palace Map \u2500\u2500", ""];
  for (const room of rooms) {
    const marker = room.slug === currentSlug ? " \u25c0 You are here" : "";
    const entryMarker = room.entry ? " (entry)" : "";
    const scrollCount = palaceGetScrolls(kernel, workspace_id, room.slug, { limit: 0 }).total;
    const scrollInfo = scrollCount > 0 ? ` [${scrollCount} scroll${scrollCount === 1 ? "" : "s"}]` : "";
    lines.push(`  ${room.name} [${room.slug}]${entryMarker}${scrollInfo} (v${room.version}, updated ${_relativeTime(room.updated_at)})${marker}`);
    if (room.portals.length > 0) {
      const portalNames = room.portals.map((slug) => {
        const target = rooms.find((r) => r.slug === slug);
        return target ? target.name : slug;
      });
      lines.push(`    \u2514\u2500 portals: ${portalNames.join(", ")}`);
    }
  }
  return lines.join("\n");
}

function _palaceInventory(workspace_id: string, currentSlug: string): string {
  const room = palaceGetRoom(kernel, workspace_id, currentSlug);
  if (!room) return "You are not in a room.";

  const scrollsResult = palaceGetScrolls(kernel, workspace_id, currentSlug, { limit: 100 });
  const lines: string[] = [`\u2500\u2500 Inventory: ${room.name} \u2500\u2500`, ""];

  if (scrollsResult.scrolls.length > 0) {
    lines.push("Scrolls in this room:");
    for (const s of scrollsResult.scrolls) {
      lines.push(`  - ${s.title} (${_relativeTime(s.created_at)})`);
      if (s.body.length > 100) {
        lines.push(`    ${s.body.slice(0, 100)}...`);
      } else {
        lines.push(`    ${s.body}`);
      }
    }
  } else {
    lines.push("No scrolls in this room.");
  }

  lines.push("");
  lines.push("Tools: build_room, write_scroll, palace_action");
  return lines.join("\n");
}

function _palaceHealth(workspace_id: string, _currentSlug: string): string {
  const rooms = palaceListRooms(kernel, workspace_id);
  const lines: string[] = ["\u2500\u2500 Palace Health \u2500\u2500", ""];

  if (rooms.length === 0) {
    lines.push("No rooms built yet. Start with build_room.");
    return lines.join("\n");
  }

  // 1. Genera coverage: which genera with entities *in this workspace* have query actions?
  const genera = listGenera(kernel);
  const generaWithEntities = genera
    .map((g) => {
      // Only count entities explicitly assigned to this workspace
      const count = (kernel.db.query(
        "SELECT COUNT(*) as cnt FROM res WHERE genus_id = ? AND workspace_id = ?",
      ).get(g.id, workspace_id) as any).cnt;
      return { id: g.id, name: g.name, count };
    })
    .filter((g) => g.count > 0);

  const coveredGenusNames = new Set<string>();
  for (const room of rooms) {
    for (const act of room.actions) {
      if (act.type === "query" && act.tool_params) {
        const genus = act.tool_params.genus as string | undefined;
        if (genus) coveredGenusNames.add(genus.toLowerCase());
      }
    }
  }

  const uncoveredGenera = generaWithEntities.filter(
    (g) => !coveredGenusNames.has(g.name.toLowerCase()),
  );

  // 2. Unfinished rooms: navigate actions pointing to nonexistent rooms
  const roomSlugs = new Set(rooms.map((r) => r.slug));
  const unfinishedSlugs = new Set<string>();
  for (const room of rooms) {
    for (const act of room.actions) {
      if (act.type === "navigate" && act.room && !act.workspace && !roomSlugs.has(act.room)) {
        unfinishedSlugs.add(act.room);
      }
    }
  }

  // 3. Stale portals: portal references to rooms that don't exist
  const stalePortals: { room: string; slug: string; phantom: string }[] = [];
  for (const room of rooms) {
    for (const portalSlug of room.portals) {
      if (!roomSlugs.has(portalSlug)) {
        stalePortals.push({ room: room.name, slug: room.slug, phantom: portalSlug });
      }
    }
  }

  // 4. Disconnected rooms: no portals and not the entry room
  const disconnected = rooms.filter((r) => !r.entry && r.portals.length === 0);

  // 5. Empty rooms: rooms with no actions
  const emptyRooms = rooms.filter((r) => r.actions.length === 0);

  // 6. Text actions with no content
  const emptyTextActions: { room: string; label: string }[] = [];
  for (const room of rooms) {
    for (const act of room.actions) {
      if (act.type === "text" && !act.content) {
        emptyTextActions.push({ room: room.name, label: act.label });
      }
    }
  }

  // Report
  const issues: string[] = [];

  if (uncoveredGenera.length > 0) {
    issues.push("Genera without query actions:");
    for (const g of uncoveredGenera) {
      issues.push(`  - ${g.name} (${g.count} entit${g.count === 1 ? "y" : "ies"})`);
    }
    issues.push("");
  }

  if (unfinishedSlugs.size > 0 || stalePortals.length > 0) {
    if (unfinishedSlugs.size > 0) {
      issues.push("Dead references (navigate actions to nonexistent rooms):");
      for (const slug of unfinishedSlugs) {
        issues.push(`  - ${slug}`);
      }
    }
    if (stalePortals.length > 0) {
      issues.push("Stale portals (portal arrays referencing nonexistent rooms):");
      for (const sp of stalePortals) {
        issues.push(`  - ${sp.room}: portal to "${sp.phantom}"`);
      }
    }
    issues.push(`  Run palace_action(95, { params: "repair" }) to clean these up.`);
    issues.push("");
  }

  if (disconnected.length > 0) {
    issues.push("Disconnected rooms (no portals):");
    for (const r of disconnected) {
      issues.push(`  - ${r.name} (${r.slug})`);
    }
    issues.push("");
  }

  if (emptyRooms.length > 0) {
    issues.push("Empty rooms (no actions):");
    for (const r of emptyRooms) {
      issues.push(`  - ${r.name} (${r.slug})`);
    }
    issues.push("");
  }

  if (emptyTextActions.length > 0) {
    issues.push("Text actions with no content:");
    for (const a of emptyTextActions) {
      issues.push(`  - "${a.label}" in ${a.room}`);
    }
    issues.push("");
  }

  if (issues.length === 0) {
    lines.push("All clear. Every genus with entities has a query action,");
    lines.push("all rooms are connected, and no unfinished rooms remain.");
  } else {
    lines.push(`${rooms.length} rooms, ${generaWithEntities.length} genera with entities\n`);
    lines.push(...issues);
  }

  return lines.join("\n");
}

function _palaceRepair(workspace_id: string): string {
  const rooms = palaceListRooms(kernel, workspace_id);
  const roomSlugs = new Set(rooms.map((r) => r.slug));
  const report: string[] = [];
  let portalCount = 0;
  let actionCount = 0;

  for (const room of rooms) {
    // Clean stale portals
    const cleanedPortals = room.portals.filter((p) => roomSlugs.has(p));
    const removedPortals = room.portals.length - cleanedPortals.length;

    // Clean navigate actions pointing to nonexistent rooms (within this workspace only)
    const cleanedActions = room.actions.filter((a) => {
      if (a.type === "navigate" && a.room && !a.workspace && !roomSlugs.has(a.room)) {
        return false;
      }
      return true;
    });
    const removedActions = room.actions.length - cleanedActions.length;

    if (removedPortals > 0 || removedActions > 0) {
      portalCount += removedPortals;
      actionCount += removedActions;
      // Persist via tessellae (palaceBuildRoom writes to tessella store)
      palaceBuildRoom(kernel, workspace_id, {
        slug: room.slug,
        name: room.name,
        description: room.description,
        entry: room.entry,
        actions: cleanedActions,
        portals: cleanedPortals,
      });
      report.push(`  ${room.name}: cleaned`);
    }
  }

  if (portalCount === 0 && actionCount === 0) return "No stale references found.";
  const parts: string[] = [];
  if (portalCount > 0) parts.push(`${portalCount} stale portal${portalCount === 1 ? "" : "s"}`);
  if (actionCount > 0) parts.push(`${actionCount} dead navigate action${actionCount === 1 ? "" : "s"}`);
  return `Repaired: removed ${parts.join(" and ")}.\n\n${report.join("\n")}`;
}

async function _executePalaceQuery(tool: string, toolParams: Record<string, unknown>, params?: string): Promise<string> {
  const mergedParams = { ...toolParams };
  if (params) mergedParams.query = params;
  const normalizedTool = tool.replace(/^smaragda:/, "");
  const ctx = _currentSessionId ? _getSessionContext() : null;

  switch (normalizedTool) {
    case "list_entities": {
      const genusName = mergedParams.genus as string | undefined;
      const genusId = genusName ? resolveGenusId(genusName) : undefined;
      const entities = listEntities(kernel, {
        genus_id: genusId,
        status: mergedParams.status as string | undefined,
        limit: mergedParams.limit as number | undefined,
        attribute_filters: mergedParams.attribute_filters as any[] | undefined,
      });
      const result = entities.slice(0, 20).map((e) => {
        const genusDef = getGenusDef(kernel, e.genus_id);
        return { id: e.id, genus: genusDef.meta.name, status: e.state.status ?? null, name: getEntityDisplayName(kernel, e.id) };
      });
      if (ctx) ctx.palace_last_results = result.map((e) => ({ id: e.id, name: e.name as string }));
      return JSON.stringify({ entities: result }, null, 2);
    }
    case "search_entities": {
      const results = searchEntities(kernel, mergedParams as any);
      if (ctx) ctx.palace_last_results = results.slice(0, 20).map((e) => ({ id: e.id, name: getEntityDisplayName(kernel, e.id) }));
      return JSON.stringify(results.slice(0, 20), null, 2);
    }
    case "get_entity": {
      const id = (mergedParams.entity ?? mergedParams.id ?? params) as string;
      if (!id) return "No entity ID provided.";
      const state = materialize(kernel, id);
      return JSON.stringify(state, null, 2);
    }
    case "get_relationships": {
      const entityId = (mergedParams.entity ?? mergedParams.entity_id ?? params) as string;
      if (!entityId) return "No entity ID provided.";
      const rels = getRelationshipsForEntity(kernel, entityId);
      return JSON.stringify(rels, null, 2);
    }
    case "describe_taxonomy": {
      const taxId = (mergedParams.taxonomy ?? params) as string;
      if (!taxId) return "No taxonomy specified.";
      const resolved = findTaxonomyByName(kernel, taxId) ?? taxId;
      const desc = describeTaxonomy(kernel, resolved);
      return JSON.stringify(desc, null, 2);
    }
    case "list_tasks": {
      const tasks = listTasks(kernel, { only_workspace: !!kernel.currentWorkspace });
      return JSON.stringify(tasks, null, 2);
    }
    case "list_genera": {
      const genera = listGenera(kernel);
      return JSON.stringify(genera, null, 2);
    }
    case "describe_system": {
      const workspaceTaxIds = kernel.currentWorkspace ? getWorkspaceTaxonomyIds(kernel, kernel.currentWorkspace) : [];
      const hasScienceScope = workspaceTaxIds.length > 0;
      const taxFilter = hasScienceScope ? (taxId: string | undefined) => workspaceTaxIds.includes(taxId ?? DEFAULT_TAXONOMY_ID) : () => true;
      const onlyWs = hasScienceScope;
      const genera = hasScienceScope ? listGenera(kernel).filter((g) => taxFilter(g.def.meta.taxonomy_id as string | undefined)) : listGenera(kernel);
      const generaWithCounts = genera.map((g) => ({ name: g.name, entity_count: listEntities(kernel, { genus_id: g.id, only_workspace: onlyWs }).length })).filter((g) => g.entity_count > 0);
      const activeGeneraNames = new Set(generaWithCounts.map((g) => g.name));
      const relationshipGenera = hasScienceScope ? listRelationshipGenera(kernel).filter((g) => taxFilter(g.def.meta.taxonomy_id as string | undefined)) : listRelationshipGenera(kernel);
      const featureGenera = hasScienceScope ? listFeatureGenera(kernel).filter((g) => taxFilter(g.def.meta.taxonomy_id as string | undefined)) : listFeatureGenera(kernel);
      const actionGenera = hasScienceScope ? listActionGenera(kernel).filter((g) => taxFilter(g.def.meta.taxonomy_id as string | undefined)) : listActionGenera(kernel);
      const allTasks = listTasks(kernel, { only_workspace: onlyWs });
      const taskCounts = { pending: 0, claimed: 0, completed: 0, cancelled: 0 };
      for (const t of allTasks) { if (t.status in taskCounts) taskCounts[t.status as keyof typeof taskCounts]++; }
      const allProcesses = listProcesses(kernel, { only_workspace: onlyWs });
      const processCounts = { running: 0, completed: 0, failed: 0, cancelled: 0 };
      for (const p of allProcesses) { if (p.status in processCounts) processCounts[p.status as keyof typeof processCounts]++; }
      return JSON.stringify({
        genera: generaWithCounts,
        relationship_genera: relationshipGenera.filter((g) => listEntities(kernel, { genus_id: g.id }).length > 0).map((g) => ({ name: g.name, roles: Object.values(g.def.roles).map((r) => r.name) })),
        feature_genera: featureGenera.filter((g) => activeGeneraNames.has(g.parent_genus_name)).map((g) => ({ name: g.name, parent: g.parent_genus_name })),
        actions: actionGenera.filter((a) => Object.values(a.def.resources).some((r) => activeGeneraNames.has(r.genus_name))).map((a) => ({ name: a.name, target_genus: Object.values(a.def.resources).map((r) => r.genus_name) })),
        process_genera: listProcessGenera(kernel).filter((g) => !hasScienceScope || taxFilter(g.def.meta.taxonomy_id as string | undefined)).map((g) => ({ name: g.name })),
        tasks: taskCounts,
        processes: processCounts,
      }, null, 2);
    }
    case "list_relationships": {
      const relGenusName = mergedParams.genus as string | undefined;
      const relGenusId = relGenusName ? resolveRelationshipGenusId(relGenusName) : undefined;
      const rels = listRelationships(kernel, {
        genus_id: relGenusId,
        member_entity_id: mergedParams.member_entity_id as string | undefined,
        status: mergedParams.status as string | undefined,
        limit: (mergedParams.limit as number | undefined) ?? 20,
      });
      const relResult = rels.map((rel) => ({
        id: rel.id, genus: rel.genus_name, status: rel.state.status,
        members: Object.fromEntries(
          Object.entries(rel.members).map(([role, ids]) => [role, ids.map((mid) => {
            try { const s = materialize(kernel, mid); return { id: mid, name: (s.name as string) ?? (s.title as string) ?? mid }; }
            catch { return { id: mid }; }
          })]),
        ),
      }));
      return JSON.stringify({ relationships: relResult }, null, 2);
    }
    case "query_timeline": {
      const entries = queryTimeline(kernel, {
        start_year: mergedParams.start_year as number | undefined,
        end_year: mergedParams.end_year as number | undefined,
        workspace_id: kernel.currentWorkspace ?? undefined,
        limit: (mergedParams.limit as number | undefined) ?? 50,
      });
      return JSON.stringify({ timeline: entries }, null, 2);
    }
    case "list_processes": {
      const statusFilter = mergedParams.status as string | undefined;
      const includeFinished = mergedParams.include_finished as boolean | undefined;
      const processes = listProcesses(kernel, { status: statusFilter, include_finished: includeFinished ?? true, only_workspace: !!kernel.currentWorkspace });
      return JSON.stringify(processes, null, 2);
    }
    default:
      return `Unknown query tool: ${tool}. Use raw MCP tools for this query.`;
  }
}

// --- Help system ---

const _DOCS_PATH = new URL("./DOCS.md", import.meta.url).pathname;
const _docsRaw = await Bun.file(_DOCS_PATH).text().catch(() => "");
const _docsSections: { heading: string; summary: string; content: string }[] = [];

if (_docsRaw) {
  const parts = _docsRaw.split(/^## /m);
  for (let i = 1; i < parts.length; i++) {
    const newlineIdx = parts[i].indexOf("\n");
    const heading = parts[i].slice(0, newlineIdx).trim();
    const content = parts[i].slice(newlineIdx + 1).trim();
    // First non-empty line as summary
    const firstLine = content.split("\n").find(l => l.trim().length > 0) ?? "";
    _docsSections.push({ heading, summary: firstLine.trim(), content });
  }
}

mcp.tool("help", {
  description: "Documentation reference. Call without arguments for a table of contents. Call with a section name to read that section.",
  input: {
    type: "object",
    properties: {
      section: { type: "string", description: "Section name to read (from table of contents). Omit for table of contents." },
    },
  },
  handler: async ({ section }: { section?: string }) => {
    if (!section) {
      const toc = _docsSections.map((s, i) => `${i + 1}. **${s.heading}** — ${s.summary}`).join("\n");
      return JSON.stringify({
        sections: _docsSections.length,
        table_of_contents: toc,
        usage: 'Call help({ section: "Section Name" }) to read a specific section.',
      }, null, 2);
    }
    const lower = section.toLowerCase();
    const match = _docsSections.find(s => s.heading.toLowerCase() === lower)
      ?? _docsSections.find(s => s.heading.toLowerCase().includes(lower));
    if (!match) {
      const available = _docsSections.map(s => s.heading).join(", ");
      return JSON.stringify({ error: `Section "${section}" not found. Available sections: ${available}` }, null, 2);
    }
    return JSON.stringify({ section: match.heading, content: match.content }, null, 2);
  },
});

mcp.tool("version", {
  description: "Returns the server name, version, and uptime.",
  input: { type: "object", properties: {} },
  handler: async () => {
    return JSON.stringify({
      name: "smaragda",
      version: SERVER_VERSION,
      uptime_seconds: Math.floor(process.uptime()),
    }, null, 2);
  },
});

mcp.tool("describe_system", {
  description: "Returns a system overview. Default: compact (names + counts). Use verbose=true for full details. Use guide=true for a getting-started tutorial with context-aware next steps.",
  input: {
    type: "object",
    properties: {
      verbose: { type: "boolean", description: "Include full attribute, state, and transition details (default: false)" },
      guide: { type: "boolean", description: "Return a getting-started guide instead of system overview (default: false)" },
    },
  },
  handler: async ({ verbose, guide }: { verbose?: boolean; guide?: boolean }) => {
    // --- Getting Started guide mode ---
    if (guide) {
      const lines: string[] = [];
      lines.push("# Smaragda — Getting Started");
      lines.push("");
      lines.push("Smaragda is a knowledge management kernel. You organize information as **entities** (typed records with attributes and state machines), grouped by **genera** (entity types you define), inside **workspaces** (isolated scopes).");
      lines.push("");

      const workspaces = listWorkspaces(kernel);
      if (!kernel.currentWorkspace) {
        if (workspaces.length === 0) {
          lines.push("## Step 1: Create a workspace");
          lines.push("You have no workspaces yet. Create one:");
          lines.push('  → create_workspace({ name: "My Project" })');
          lines.push('  → set_workspace({ workspace: "My Project" })');
        } else {
          lines.push("## Step 1: Set your workspace");
          lines.push(`You have ${workspaces.length} workspace${workspaces.length === 1 ? "" : "s"}: ${workspaces.map(w => w.name).join(", ")}`);
          lines.push("Pick one:");
          lines.push(`  → set_workspace({ workspace: "${workspaces[0].name}" })`);
        }
        lines.push("");
        lines.push("Most tools require a workspace. Set one first, then call describe_system({ guide: true }) again for next steps.");
        return lines.join("\n");
      }

      const wsName = workspaces.find(w => w.id === kernel.currentWorkspace)?.name ?? kernel.currentWorkspace;
      lines.push(`## Current workspace: ${wsName}`);
      lines.push("");

      const guideGenera = listGenera(kernel);
      const sciences = listSciences(kernel);
      const wsSciences = getWorkspaceScienceIds(kernel, kernel.currentWorkspace!);
      const generaWithCounts = guideGenera.map(g => ({ name: g.name, id: g.id, count: listEntities(kernel, { genus_id: g.id, only_workspace: true }).length }));

      if (guideGenera.length === 0 && wsSciences.length === 0) {
        lines.push("## Step 2: Define your schema");
        lines.push("No entity types defined yet. You have two options:");
        lines.push("");
        lines.push("**Option A — Quick start (define a genus directly):**");
        lines.push('  → define_entity_genus({ name: "Note", attributes: [{ name: "content", type: "text" }] })');
        lines.push('  → create_entity({ genus: "Note", attributes: { name: "My first note", content: "Hello!" } })');
        lines.push("");
        if (sciences.length > 0) {
          lines.push("**Option B — Link an existing science** (pre-built genera):");
          lines.push(`  Available sciences: ${sciences.map(s => s.name).join(", ")}`);
          lines.push(`  → set_workspace({ workspace: "${wsName}", link_science: "${sciences[0].name}" })`);
        }
      } else {
        lines.push("## Your schema");
        const withData = generaWithCounts.filter(g => g.count > 0);
        const empty = generaWithCounts.filter(g => g.count === 0);
        if (withData.length > 0) {
          lines.push(`Entity types with data: ${withData.map(g => `${g.name} (${g.count})`).join(", ")}`);
        }
        if (empty.length > 0 && empty.length <= 10) {
          lines.push(`Empty types: ${empty.map(g => g.name).join(", ")}`);
        } else if (empty.length > 10) {
          lines.push(`Empty types: ${empty.length} genera with no entities`);
        }
        lines.push("");
        lines.push("**Create entities:**");
        const exampleGenus = withData[0] ?? generaWithCounts[0];
        if (exampleGenus) {
          lines.push(`  → create_entity({ genus: "${exampleGenus.name}", attributes: { name: "..." } })`);
          lines.push(`  → list_entities({ genus: "${exampleGenus.name}" })`);
        }
      }
      lines.push("");

      const rooms = palaceListRooms(kernel, kernel.currentWorkspace!);
      lines.push("## The Palace (spatial navigation)");
      if (rooms.length === 0) {
        lines.push("No palace rooms built yet. The palace is a memory system — rooms with prose descriptions, interactive objects, and cross-session scrolls.");
        lines.push("");
        lines.push("**Build your first room:**");
        lines.push('  → build_room({ slug: "lobby", name: "The Lobby", description: "A bright room with...",');
        lines.push('      actions: [{ label: "Look around", type: "text", content: "You see..." }] })');
        lines.push("");
        lines.push("**v2 markup** — embed live entity refs in descriptions:");
        lines.push("  *GenusName:EntityName* → interactive entity (look/examine)");
        lines.push("  *GenusName:EntityName|alias* → custom display text");
        lines.push("  [room-slug]prose text[/] → portal to another room");
      } else {
        lines.push(`${rooms.length} room${rooms.length === 1 ? "" : "s"} built. You're in the palace — use numbered actions or verbs:`);
        lines.push("  Verbs: look/l TARGET, examine/x TARGET, go TARGET, search QUERY, back/b, map/m, inventory/i");
        lines.push("");
        lines.push("**v2 markup** for room descriptions:");
        lines.push("  *GenusName:EntityName* → interactive entity ref");
        lines.push("  *GenusName:EntityName|alias* → custom display text");
        lines.push("  [room-slug]prose text[/] → portal link");
      }
      lines.push("");

      lines.push("## Quick reference");
      lines.push("  describe_system — see all genera, entities, counts");
      lines.push("  list_entities — browse entities (use genus= to filter)");
      lines.push("  get_entity — full details on one entity");
      lines.push("  palace_action — interact with palace rooms (verbs or numbers)");
      lines.push("  evolve_genus — add attributes/states to existing types");
      lines.push("  build_room — create/update palace rooms (supports v2 markup)");

      return lines.join("\n");
    }

    // --- Normal describe_system flow ---
    // When in a workspace with linked sciences, scope genera by taxonomy
    const workspaceTaxIds = kernel.currentWorkspace
      ? getWorkspaceTaxonomyIds(kernel, kernel.currentWorkspace)
      : [];
    const hasScienceScope = workspaceTaxIds.length > 0;
    const taxFilter = hasScienceScope ? (taxId: string | undefined) => workspaceTaxIds.includes(taxId ?? DEFAULT_TAXONOMY_ID) : () => true;

    const allGenera = listGenera(kernel);
    const genera = hasScienceScope ? allGenera.filter((g) => taxFilter(g.def.meta.taxonomy_id as string | undefined)) : allGenera;
    const allFeatureGenera = listFeatureGenera(kernel);
    const featureGenera = hasScienceScope ? allFeatureGenera.filter((g) => taxFilter(g.def.meta.taxonomy_id as string | undefined)) : allFeatureGenera;
    const allRelationshipGenera = listRelationshipGenera(kernel);
    const relationshipGenera = hasScienceScope ? allRelationshipGenera.filter((g) => taxFilter(g.def.meta.taxonomy_id as string | undefined)) : allRelationshipGenera;
    const allActionGenera = listActionGenera(kernel);
    const actionGenera = hasScienceScope ? allActionGenera.filter((g) => taxFilter(g.def.meta.taxonomy_id as string | undefined)) : allActionGenera;

    const onlyWs = hasScienceScope;

    const allTasks = listTasks(kernel, { only_workspace: onlyWs });
    const taskCounts = { pending: 0, claimed: 0, completed: 0, cancelled: 0 };
    for (const t of allTasks) {
      if (t.status in taskCounts) taskCounts[t.status as keyof typeof taskCounts]++;
    }

    const allProcesses = listProcesses(kernel, { only_workspace: onlyWs });
    const processCounts = { running: 0, completed: 0, failed: 0, cancelled: 0 };
    for (const p of allProcesses) {
      if (p.status in processCounts) processCounts[p.status as keyof typeof processCounts]++;
    }
    const totalEntities = genera.reduce((sum, g) => sum + listEntities(kernel, { genus_id: g.id, only_workspace: onlyWs }).length, 0);
    const totalRelationships = relationshipGenera.reduce((sum, g) => {
      return sum + listEntities(kernel, { genus_id: g.id }).length;
    }, 0);

    if (!verbose) {
      // Compact mode: names + counts only
      const generaWithCounts = genera.map((g) => ({ name: g.name, entity_count: listEntities(kernel, { genus_id: g.id, only_workspace: onlyWs }).length })).filter((g) => g.entity_count > 0);
      const activeGeneraNames = new Set(generaWithCounts.map((g) => g.name));

      // Orphaned entity count (no workspace assigned, excluding system genera)
      const systemGenusIds = [META_GENUS_ID, BRANCH_GENUS_ID, TAXONOMY_GENUS_ID, SCIENCE_GENUS_ID, CRON_SCHEDULE_GENUS_ID, WORKSPACE_GENUS_ID, LOG_GENUS_ID, ERROR_GENUS_ID, TASK_GENUS_ID];
      const orphanedRows = kernel.db.query(
        `SELECT genus_id, COUNT(*) as cnt FROM res WHERE workspace_id IS NULL AND genus_id NOT IN (${systemGenusIds.map(() => "?").join(", ")}) GROUP BY genus_id`,
      ).all(...systemGenusIds) as { genus_id: string; cnt: number }[];
      const orphanedTotal = orphanedRows.reduce((sum, r) => sum + r.cnt, 0);

      const result: Record<string, unknown> = {
        genera: generaWithCounts,
        relationship_genera: relationshipGenera.filter((g) => listEntities(kernel, { genus_id: g.id }).length > 0).map((g) => ({ name: g.name, roles: Object.values(g.def.roles).map((r) => r.name) })),
        feature_genera: featureGenera.filter((g) => activeGeneraNames.has(g.parent_genus_name)).map((g) => ({ name: g.name, parent: g.parent_genus_name })),
        actions: actionGenera.filter((a) => Object.values(a.def.resources).some((r) => activeGeneraNames.has(r.genus_name))).map((a) => ({ name: a.name, target_genus: Object.values(a.def.resources).map((r) => r.genus_name) })),
        process_genera: listProcessGenera(kernel).filter((g) => !hasScienceScope || taxFilter(g.def.meta.taxonomy_id as string | undefined)).map((g) => ({ name: g.name })),
        tasks: taskCounts,
        processes: processCounts,
        workspace: kernel.currentWorkspace
          ? { id: kernel.currentWorkspace, name: (materialize(kernel, kernel.currentWorkspace).name as string) }
          : null,
        totals: { genera: genera.length, entities: totalEntities, relationships: totalRelationships },
      };
      if (orphanedTotal > 0) {
        result.unassigned_entities = {
          total: orphanedTotal,
          by_genus: orphanedRows.map((r) => {
            const def = getGenusDef(kernel, r.genus_id);
            return { genus: (def.meta.name as string) ?? r.genus_id, count: r.cnt };
          }).sort((a, b) => b.count - a.count),
        };
      }
      return JSON.stringify(result, null, 2);
    }

    // Verbose mode: full details
    const generaResult = genera.map((g) => {
      const entityCount = listEntities(kernel, { genus_id: g.id }).length;
      return {
        name: g.name,
        ...(g.def.meta.description ? { description: g.def.meta.description } : {}),
        attribute_count: Object.keys(g.def.attributes).length,
        states: Object.values(g.def.states).map((s) => s.name),
        transitions: g.def.transitions.map((t) => ({
          from: t.from,
          to: t.to,
          ...(t.name ? { name: t.name } : {}),
        })),
        entity_count: entityCount,
      };
    });

    const featureResult = featureGenera.map((g) => ({
      name: g.name,
      parent: g.parent_genus_name,
      ...(g.def.meta.description ? { description: g.def.meta.description } : {}),
      transitions: g.def.transitions.map((t) => ({
        from: t.from,
        to: t.to,
        ...(t.name ? { name: t.name } : {}),
      })),
    }));

    const relationshipResult = relationshipGenera.map((g) => ({
      name: g.name,
      ...(g.def.meta.description ? { description: g.def.meta.description } : {}),
      roles: Object.values(g.def.roles).map((r) => r.name),
      transitions: g.def.transitions.map((t) => ({
        from: t.from,
        to: t.to,
        ...(t.name ? { name: t.name } : {}),
      })),
    }));

    const actionResult = actionGenera.map((a) => {
      const targetGenera = Object.values(a.def.resources).map((r) => r.genus_name);
      return {
        name: a.name,
        ...(a.def.meta.description ? { description: a.def.meta.description } : {}),
        target_genus: targetGenera.length === 1 ? targetGenera[0] : targetGenera,
      };
    });

    const processGeneraV = listProcessGenera(kernel).filter((g) => !hasScienceScope || taxFilter(g.def.meta.taxonomy_id as string | undefined));
    const processResult = processGeneraV.map((g) => ({
      name: g.name,
      ...(g.def.meta.description ? { description: g.def.meta.description } : {}),
      lanes: Object.values(g.def.lanes).map((l) => l.name),
      step_count: Object.keys(g.def.steps).length,
      triggers: g.def.triggers.map((t) => t.type),
    }));

    const allBranches = listBranches(kernel);

    const serializationTargets = listSerializationGenera(kernel).filter((g) => !hasScienceScope || taxFilter(g.def.meta.taxonomy_id as string | undefined)).map((t) => ({
      name: t.name,
      description: t.def.meta.description,
      input: t.def.input,
      format: t.def.output.format,
    }));

    return JSON.stringify({
      genera: generaResult,
      feature_genera: featureResult,
      relationship_genera: relationshipResult,
      actions: actionResult,
      process_genera: processResult,
      serialization_targets: serializationTargets,
      tasks: taskCounts,
      processes: processCounts,
      branches: {
        current: kernel.currentBranch,
        total: allBranches.length,
        active: allBranches.filter((b) => b.status === "active").length,
      },
      sciences: (() => {
        const allSciences = listSciences(kernel);
        if (!hasScienceScope) return allSciences.map((s) => ({
          name: s.name, status: s.status,
          taxonomy_count: describeScience(kernel, s.id).taxonomies.length,
        }));
        const linkedIds = getWorkspaceScienceIds(kernel, kernel.currentWorkspace!);
        return allSciences.filter((s) => linkedIds.includes(s.id)).map((s) => ({
          name: s.name, status: s.status,
          taxonomy_count: describeScience(kernel, s.id).taxonomies.length,
        }));
      })(),
      taxonomies: (() => {
        const allTax = listTaxonomies(kernel);
        const filtered = hasScienceScope ? allTax.filter((d) => workspaceTaxIds.includes(d.id)) : allTax;
        return filtered.map((d) => {
          const desc = describeTaxonomy(kernel, d.id);
          return {
            name: d.name, status: d.status,
            entity_genera: desc.entity_genera.map((g) => g.name),
            feature_genera: desc.feature_genera.map((g) => g.name),
            relationship_genera: desc.relationship_genera.map((g) => g.name),
            action_genera: desc.action_genera.map((g) => g.name),
            process_genera: desc.process_genera.map((g) => g.name),
            serialization_genera: desc.serialization_genera.map((g) => g.name),
          };
        });
      })(),
      workspace: kernel.currentWorkspace
        ? { id: kernel.currentWorkspace, name: (materialize(kernel, kernel.currentWorkspace).name as string) }
        : null,
      workspaces: listWorkspaces(kernel).map((w) => ({
        name: w.name,
        status: w.status,
        entity_count: w.entity_count,
      })),
      totals: {
        genera: genera.length,
        entities: totalEntities,
        relationships: totalRelationships,
        unscoped_entities: (kernel.db.query(
          "SELECT COUNT(*) as cnt FROM res WHERE workspace_id IS NULL AND genus_id NOT IN (?, ?, ?, ?, ?, ?, ?, ?)",
        ).get(META_GENUS_ID, BRANCH_GENUS_ID, TAXONOMY_GENUS_ID, CRON_SCHEDULE_GENUS_ID, WORKSPACE_GENUS_ID, LOG_GENUS_ID, ERROR_GENUS_ID, TASK_GENUS_ID) as { cnt: number }).cnt,
      },
      ..._workspaceContext(),
    }, null, 2);
  },
});

function resolveFeatureGenusId(genus: string): string {
  const byName = findFeatureGenusByName(kernel, genus);
  if (byName) return byName;
  try {
    getGenusDef(kernel, genus);
    return genus;
  } catch {
    const available = _nameList(listFeatureGenera(kernel).map(g => g.name));
    throw new Error(`Feature genus not found: "${genus}". Available feature genera: ${available}`);
  }
}

function resolveRelationshipGenusId(genus: string): string {
  const byName = findRelationshipGenusByName(kernel, genus);
  if (byName) return byName;
  try {
    getGenusDef(kernel, genus);
    return genus;
  } catch {
    const available = _nameList(listRelationshipGenera(kernel).map(g => g.name));
    throw new Error(`Relationship genus not found: "${genus}". Available relationship genera: ${available}`);
  }
}

function resolveProcessGenusId(process: string): string {
  const byName = findProcessGenusByName(kernel, process);
  if (byName) return byName;
  try {
    getProcessDef(kernel, process);
    return process;
  } catch {
    const available = _nameList(listProcessGenera(kernel).map(g => g.name));
    throw new Error(`Process genus not found: "${process}". Available process genera: ${available}`);
  }
}

function resolveSerializationGenusId(target: string): string {
  const byName = findSerializationGenusByName(kernel, target);
  if (byName) return byName;
  const all = listSerializationGenera(kernel);
  const def = all.find((t) => t.id === target);
  if (def) return target;
  const available = _nameList(all.map(g => g.name));
  throw new Error(`Serialization target not found: "${target}". Available serialization genera: ${available}`);
}

function resolveTaxonomyId(taxonomy: string): string {
  const byName = findTaxonomyByName(kernel, taxonomy);
  if (byName) return byName;
  // Try as ID — verify it's a taxonomy entity
  try {
    const res = getRes(kernel, taxonomy);
    if (res.genus_id === TAXONOMY_GENUS_ID) return taxonomy;
  } catch {
    // fall through to error
  }
  const available = _nameList(listTaxonomies(kernel).map(t => t.name));
  throw new Error(`Taxonomy not found: "${taxonomy}". Available taxonomies: ${available}`);
}

function resolveScienceId(science: string): string {
  const byName = findScienceByName(kernel, science);
  if (byName) return byName;
  try {
    const res = getRes(kernel, science);
    if (res.genus_id === SCIENCE_GENUS_ID) return science;
  } catch {
    // fall through to error
  }
  const available = _nameList(listSciences(kernel).map(s => s.name));
  throw new Error(`Science not found: "${science}". Available sciences: ${available}`);
}

function resolveCronScheduleId(schedule: string): string {
  // Try by name first
  const schedules = listCronSchedules(kernel);
  const lower = schedule.toLowerCase();
  const byName = schedules.find((s) => s.name.toLowerCase() === lower);
  if (byName) return byName.id;
  // Try as ID
  try {
    const res = getRes(kernel, schedule);
    if (res.genus_id === CRON_SCHEDULE_GENUS_ID) return schedule;
    throw new Error(`Not a cron schedule: ${schedule}`);
  } catch {
    throw new Error(`Cron schedule not found: ${schedule}`);
  }
}

mcp.tool("create_taxonomy", {
  description: "Create a new taxonomy for organizing genera into logical groups (e.g., 'Inventory', 'Orders').",
  input: {
    type: "object",
    properties: {
      name: { type: "string", description: "Taxonomy name (e.g., 'Inventory')" },
      description: { type: "string", description: "Optional description of the taxonomy" },
      science: { type: "string", description: "Science name or ID (defaults to Default science)" },
    },
    required: ["name"],
  },
  handler: async ({ name, description, science }: { name: string; description?: string; science?: string }) => {
    const existing = findTaxonomyByName(kernel, name);
    if (existing) {
      throw new Error(`Taxonomy already exists: ${name}`);
    }
    const science_id = science ? resolveScienceId(science) : undefined;
    const id = createTaxonomy(kernel, name, description, science_id);
    return JSON.stringify({ id, name, description: description ?? "", status: "active" }, null, 2);
  },
});

mcp.tool("list_taxonomies", {
  description: "List all taxonomies with summary counts of genera in each.",
  input: { type: "object", properties: {} },
  handler: async () => {
    const taxonomies = listTaxonomies(kernel);
    const result = taxonomies.map((d) => {
      const desc = describeTaxonomy(kernel, d.id);
      return {
        id: d.id,
        name: d.name,
        description: d.description,
        status: d.status,
        counts: {
          entity_genera: desc.entity_genera.length,
          feature_genera: desc.feature_genera.length,
          relationship_genera: desc.relationship_genera.length,
          action_genera: desc.action_genera.length,
          process_genera: desc.process_genera.length,
          serialization_genera: desc.serialization_genera.length,
        },
      };
    });
    return JSON.stringify(result, null, 2);
  },
});

// --- Science tools ---

mcp.tool("create_science", {
  description: "Create a new science (formal aspect being studied) for grouping taxonomies (e.g., 'Architecture', 'Workflow').",
  input: {
    type: "object",
    properties: {
      name: { type: "string", description: "Science name (e.g., 'Architecture')" },
      description: { type: "string", description: "Optional description of the science" },
    },
    required: ["name"],
  },
  handler: async ({ name, description }: { name: string; description?: string }) => {
    const existing = findScienceByName(kernel, name);
    if (existing) {
      throw new Error(`Science already exists: ${name}`);
    }
    const id = createScience(kernel, name, description);
    return JSON.stringify({ id, name, description: description ?? "", status: "active" }, null, 2);
  },
});

mcp.tool("list_sciences", {
  description: "List all sciences with taxonomy counts.",
  input: { type: "object", properties: {} },
  handler: async () => {
    const sciences = listSciences(kernel);
    const result = sciences.map((s) => {
      const desc = describeScience(kernel, s.id);
      return {
        id: s.id,
        name: s.name,
        description: s.description,
        status: s.status,
        taxonomy_count: desc.taxonomies.length,
      };
    });
    return JSON.stringify(result, null, 2);
  },
});

mcp.tool("describe_science", {
  description: "Returns a science and its taxonomies.",
  input: {
    type: "object",
    properties: {
      science: { type: "string", description: "Science name or ID" },
    },
    required: ["science"],
  },
  handler: async ({ science }: { science: string }) => {
    const scienceId = resolveScienceId(science);
    const desc = describeScience(kernel, scienceId);
    return JSON.stringify(desc, null, 2);
  },
});

mcp.tool("archive_science", {
  description: "Archive a science to freeze it.",
  input: {
    type: "object",
    properties: {
      science: { type: "string", description: "Science name or ID to archive" },
    },
    required: ["science"],
  },
  handler: async ({ science }: { science: string }) => {
    const scienceId = resolveScienceId(science);
    if (scienceId === DEFAULT_SCIENCE_ID) {
      throw new Error("Cannot archive the default science");
    }
    transitionStatus(kernel, scienceId, "archived");
    const state = materialize(kernel, scienceId);
    return JSON.stringify({
      id: scienceId,
      name: state.name,
      status: state.status,
    }, null, 2);
  },
});

mcp.tool("unarchive_science", {
  description: "Unarchive a science to re-enable it.",
  input: {
    type: "object",
    properties: {
      science: { type: "string", description: "Science name or ID to unarchive" },
    },
    required: ["science"],
  },
  handler: async ({ science }: { science: string }) => {
    const scienceId = resolveScienceId(science);
    transitionStatus(kernel, scienceId, "active");
    const state = materialize(kernel, scienceId);
    return JSON.stringify({
      id: scienceId,
      name: state.name,
      status: state.status,
    }, null, 2);
  },
});

mcp.tool("move_taxonomy", {
  description: "Move a taxonomy to a different science.",
  input: {
    type: "object",
    properties: {
      taxonomy: { type: "string", description: "Taxonomy name or ID to move" },
      target_science: { type: "string", description: "Target science name or ID" },
    },
    required: ["taxonomy", "target_science"],
  },
  handler: async ({ taxonomy, target_science }: { taxonomy: string; target_science: string }) => {
    const taxonomyId = resolveTaxonomyId(taxonomy);
    const scienceId = resolveScienceId(target_science);
    moveTaxonomy(kernel, taxonomyId, scienceId);
    const state = materialize(kernel, taxonomyId);
    return JSON.stringify({ id: taxonomyId, name: state.name, science_id: scienceId }, null, 2);
  },
});

mcp.tool("share_taxonomy", {
  description: "Share a taxonomy with an additional science, making its genera visible under that science too.",
  input: {
    type: "object",
    properties: {
      taxonomy: { type: "string", description: "Taxonomy name or ID to share" },
      science: { type: "string", description: "Science name or ID to share with" },
    },
    required: ["taxonomy", "science"],
  },
  handler: async ({ taxonomy, science }: { taxonomy: string; science: string }) => {
    const taxonomyId = resolveTaxonomyId(taxonomy);
    const scienceId = resolveScienceId(science);
    shareTaxonomy(kernel, taxonomyId, scienceId);
    const state = materialize(kernel, taxonomyId);
    return JSON.stringify({ id: taxonomyId, name: state.name, shared_with: scienceId }, null, 2);
  },
});

mcp.tool("unshare_taxonomy", {
  description: "Remove a taxonomy's sharing with a science.",
  input: {
    type: "object",
    properties: {
      taxonomy: { type: "string", description: "Taxonomy name or ID to unshare" },
      science: { type: "string", description: "Science name or ID to unshare from" },
    },
    required: ["taxonomy", "science"],
  },
  handler: async ({ taxonomy, science }: { taxonomy: string; science: string }) => {
    const taxonomyId = resolveTaxonomyId(taxonomy);
    const scienceId = resolveScienceId(science);
    unshareTaxonomy(kernel, taxonomyId, scienceId);
    return JSON.stringify({ id: taxonomyId, unshared_from: scienceId }, null, 2);
  },
});

mcp.tool("move_genus", {
  description: "Move a genus to a different taxonomy.",
  input: {
    type: "object",
    properties: {
      genus: { type: "string", description: "Genus name or ID to move" },
      target_taxonomy: { type: "string", description: "Target taxonomy name or ID" },
    },
    required: ["genus", "target_taxonomy"],
  },
  handler: async ({ genus, target_taxonomy }: { genus: string; target_taxonomy: string }) => {
    const genusId = resolveGenusId(genus);
    const taxonomyId = resolveTaxonomyId(target_taxonomy);
    moveGenus(kernel, genusId, taxonomyId);
    return JSON.stringify({ genus_id: genusId, taxonomy_id: taxonomyId }, null, 2);
  },
});

// --- Workspace tools ---

mcp.tool("set_workspace", {
  description: "Set the current workspace for this session. All subsequent entity operations will be scoped to this workspace. Optionally link/unlink a science to control which genera are visible.",
  input: {
    type: "object",
    properties: {
      workspace: { type: "string", description: "Workspace name or ID" },
      link_science: { type: "string", description: "Science name or ID to link to this workspace (controls which genera are visible in describe_system)" },
      unlink_science: { type: "string", description: "Science name or ID to unlink from this workspace" },
    },
    required: ["workspace"],
  },
  handler: async ({ workspace, link_science, unlink_science }: { workspace: string; link_science?: string; unlink_science?: string }) => {
    let wsId = findWorkspaceByName(kernel, workspace);
    if (!wsId) {
      const row = kernel.db.query(
        "SELECT genus_id FROM res WHERE id = ?",
      ).get(workspace) as any;
      if (row && row.genus_id === WORKSPACE_GENUS_ID) {
        wsId = workspace;
      }
    }
    if (!wsId) {
      const available = _nameList(listWorkspaces(kernel).map(w => w.name));
      throw new Error(`Workspace not found: "${workspace}". Available workspaces: ${available}`);
    }

    // Handle science linking/unlinking
    if (link_science) {
      let scienceId = findScienceByName(kernel, link_science);
      if (!scienceId) {
        const row = kernel.db.query("SELECT genus_id FROM res WHERE id = ?").get(link_science) as any;
        if (row && row.genus_id === SCIENCE_GENUS_ID) scienceId = link_science;
      }
      if (!scienceId) {
        const available = _nameList(listSciences(kernel).map(s => s.name));
        throw new Error(`Science not found: "${link_science}". Available sciences: ${available}`);
      }
      addWorkspaceScience(kernel, wsId, scienceId);
    }
    if (unlink_science) {
      let scienceId = findScienceByName(kernel, unlink_science);
      if (!scienceId) {
        const row = kernel.db.query("SELECT genus_id FROM res WHERE id = ?").get(unlink_science) as any;
        if (row && row.genus_id === SCIENCE_GENUS_ID) scienceId = unlink_science;
      }
      if (!scienceId) {
        const available = _nameList(listSciences(kernel).map(s => s.name));
        throw new Error(`Science not found: "${unlink_science}". Available sciences: ${available}`);
      }
      removeWorkspaceScience(kernel, wsId, scienceId);
    }

    if (_currentSessionId) {
      const ctx = _getSessionContext();
      ctx.workspace_id = wsId;
    }
    kernel.currentWorkspace = wsId;

    const state = materialize(kernel, wsId);
    const linkedScienceIds = getWorkspaceScienceIds(kernel, wsId);
    const linkedSciences = linkedScienceIds.map((id) => {
      const s = materialize(kernel, id);
      return { id, name: s.name as string };
    });
    const hasPalace = palaceHasPalace(kernel, wsId);

    if (hasPalace) {
      const entryRoom = palaceGetEntryRoom(kernel, wsId);
      if (entryRoom) {
        const scrolls = palaceGetScrolls(kernel, wsId, entryRoom.slug, { limit: 10 });
        if (_currentSessionId) {
          const ctx = _getSessionContext();
          _palaceNavigate(ctx, entryRoom.slug, entryRoom);
        }
        const ctx2 = _currentSessionId ? _getSessionContext() : null;
        return JSON.stringify({
          workspace_id: wsId,
          name: state.name,
          ...(linkedSciences.length > 0 ? { sciences: linkedSciences } : {}),
          ...(ctx2 && ctx2.current_branch !== "main" ? { branch: ctx2.current_branch } : {}),
          palace: _renderRoom(entryRoom, scrolls),
        }, null, 2);
      }
    }

    // No palace — bootstrap payload (only entities explicitly assigned to this workspace)
    const workspaceTaxIds = getWorkspaceTaxonomyIds(kernel, wsId);
    const hasScienceScope = workspaceTaxIds.length > 0;
    const allGenera = listGenera(kernel);
    const scopedGenera = hasScienceScope
      ? allGenera.filter((g) => workspaceTaxIds.includes((g.def.meta.taxonomy_id as string) ?? DEFAULT_TAXONOMY_ID))
      : allGenera;
    const entityCounts = scopedGenera.map((g) => ({
      name: g.name,
      count: listEntities(kernel, { genus_id: g.id, only_workspace: true }).length,
    })).filter((g) => g.count > 0);

    const bootstrap: Record<string, unknown> = {
      tutorial: PALACE_TUTORIAL_TEXT,
      workspace_summary: { genera: entityCounts },
      prompt: "Survey the workspace and build an entry room with build_room.",
    };

    // If workspace is empty but has schema, show available genera so agent knows what to create
    if (entityCounts.length === 0 && hasScienceScope) {
      bootstrap.available_genera = scopedGenera.map((g) => ({
        name: g.name,
        description: (g.def.meta.description as string) ?? null,
      }));
    }

    // If no sciences are linked, guide the agent to link one
    if (!hasScienceScope) {
      const allSciences = listSciences(kernel).filter((s) => s.status === "active" && s.name !== "Default");
      bootstrap.no_sciences_linked = {
        message: "This workspace has no sciences linked. Link a science to scope which genera are visible. Use set_workspace with link_science param.",
        available_sciences: allSciences.map((s) => {
          const desc = describeScience(kernel, s.id);
          return { name: s.name, taxonomy_count: desc.taxonomies.length };
        }),
      };
    }

    const ctx2 = _currentSessionId ? _getSessionContext() : null;
    return JSON.stringify({
      workspace_id: wsId,
      name: state.name,
      ...(linkedSciences.length > 0 ? { sciences: linkedSciences } : {}),
      ...(ctx2 && ctx2.current_branch !== "main" ? { branch: ctx2.current_branch } : {}),
      palace: null,
      bootstrap,
    }, null, 2);
  },
});

mcp.tool("get_workspace", {
  description: "Returns the current workspace for this session, or null if none is set.",
  input: { type: "object", properties: {} },
  handler: async () => {
    if (!kernel.currentWorkspace) {
      return JSON.stringify({ workspace: null, ..._workspaceContext() }, null, 2);
    }
    const state = materialize(kernel, kernel.currentWorkspace);
    return JSON.stringify({
      workspace_id: kernel.currentWorkspace,
      name: state.name,
      status: state.status,
    }, null, 2);
  },
});

mcp.tool("create_workspace", {
  description: "Create a new workspace for organizing entities into isolated scopes.",
  input: {
    type: "object",
    properties: {
      name: { type: "string", description: "Workspace name" },
      description: { type: "string", description: "Optional description" },
    },
    required: ["name"],
  },
  handler: async ({ name, description }: { name: string; description?: string }) => {
    const id = createWorkspace(kernel, name, description);
    const state = materialize(kernel, id);
    return JSON.stringify({ id, state }, null, 2);
  },
});

mcp.tool("list_workspaces", {
  description: "List all workspaces with entity counts.",
  input: { type: "object", properties: {} },
  handler: async () => {
    const ws = listWorkspaces(kernel);
    return JSON.stringify({
      current: kernel.currentWorkspace,
      workspaces: ws,
    }, null, 2);
  },
});

mcp.tool("assign_workspace", {
  description: "Assign entities to a workspace. Provide workspace plus one of: entity_id (single entity), genus (all entities of that genus), or taxonomy (all entities whose genus belongs to that taxonomy). Use unassigned_only=true to only assign entities that have no workspace yet.",
  input: {
    type: "object",
    properties: {
      workspace: { type: "string", description: "Workspace name or ID to assign to" },
      entity_id: { type: "string", description: "Single entity ID to assign" },
      genus: { type: "string", description: "Genus name or ID — assigns all entities of this genus" },
      taxonomy: { type: "string", description: "Taxonomy name or ID — assigns all entities in this taxonomy" },
      unassigned_only: { type: "boolean", description: "Only assign entities with no workspace (default false)" },
    },
    required: ["workspace"],
  },
  handler: async ({ workspace, entity_id, genus, taxonomy, unassigned_only }: {
    workspace: string; entity_id?: string; genus?: string; taxonomy?: string; unassigned_only?: boolean;
  }) => {
    let wsId = findWorkspaceByName(kernel, workspace);
    if (!wsId) {
      const row = kernel.db.query(
        "SELECT genus_id FROM res WHERE id = ?",
      ).get(workspace) as any;
      if (row && row.genus_id === WORKSPACE_GENUS_ID) {
        wsId = workspace;
      }
    }
    if (!wsId) {
      const available = _nameList(listWorkspaces(kernel).map(w => w.name));
      throw new Error(`Workspace not found: "${workspace}". Available workspaces: ${available}`);
    }

    if (entity_id) {
      assignWorkspace(kernel, entity_id, wsId);
      return JSON.stringify({ assigned: 1, workspace: workspace, entity_id }, null, 2);
    } else if (genus) {
      const genusId = resolveGenusId(genus);
      const count = assignWorkspaceByGenus(kernel, genusId, wsId, { unassigned_only });
      return JSON.stringify({ assigned: count, workspace: workspace, genus, unassigned_only: !!unassigned_only }, null, 2);
    } else if (taxonomy) {
      const taxonomyId = resolveTaxonomyId(taxonomy);
      const count = assignWorkspaceByTaxonomy(kernel, taxonomyId, wsId, { unassigned_only });
      return JSON.stringify({ assigned: count, workspace: workspace, taxonomy, unassigned_only: !!unassigned_only }, null, 2);
    } else {
      throw new Error("Provide one of: entity_id, genus, or taxonomy");
    }
  },
});

mcp.tool("delete_workspace", {
  description: "Delete an empty workspace. Fails if the workspace still contains entities.",
  input: {
    type: "object",
    properties: {
      workspace: { type: "string", description: "Workspace name or ID to delete" },
    },
    required: ["workspace"],
  },
  handler: async ({ workspace }: { workspace: string }) => {
    let wsId = findWorkspaceByName(kernel, workspace);
    if (!wsId) {
      const row = kernel.db.query("SELECT genus_id FROM res WHERE id = ?").get(workspace) as any;
      if (row && row.genus_id === WORKSPACE_GENUS_ID) wsId = workspace;
    }
    if (!wsId) {
      const available = _nameList(listWorkspaces(kernel).map(w => w.name));
      throw new Error(`Workspace not found: "${workspace}". Available workspaces: ${available}`);
    }
    deleteWorkspace(kernel, wsId);
    return JSON.stringify({ deleted: wsId }, null, 2);
  },
});

mcp.tool("merge_workspaces", {
  description: "Move all entities from source workspace to target workspace, then delete the source.",
  input: {
    type: "object",
    properties: {
      source: { type: "string", description: "Source workspace name or ID" },
      target: { type: "string", description: "Target workspace name or ID" },
    },
    required: ["source", "target"],
  },
  handler: async ({ source, target }: { source: string; target: string }) => {
    let srcId = findWorkspaceByName(kernel, source);
    if (!srcId) {
      const row = kernel.db.query("SELECT genus_id FROM res WHERE id = ?").get(source) as any;
      if (row && row.genus_id === WORKSPACE_GENUS_ID) srcId = source;
    }
    if (!srcId) {
      const available = _nameList(listWorkspaces(kernel).map(w => w.name));
      throw new Error(`Source workspace not found: "${source}". Available workspaces: ${available}`);
    }
    let tgtId = findWorkspaceByName(kernel, target);
    if (!tgtId) {
      const row = kernel.db.query("SELECT genus_id FROM res WHERE id = ?").get(target) as any;
      if (row && row.genus_id === WORKSPACE_GENUS_ID) tgtId = target;
    }
    if (!tgtId) {
      const available = _nameList(listWorkspaces(kernel).map(w => w.name));
      throw new Error(`Target workspace not found: "${target}". Available workspaces: ${available}`);
    }
    const count = mergeWorkspaces(kernel, srcId, tgtId);
    return JSON.stringify({ moved: count, source: srcId, target: tgtId }, null, 2);
  },
});

mcp.tool("describe_taxonomy", {
  description: "Returns the full schema picture for a taxonomy: all genera grouped by type with entity counts.",
  input: {
    type: "object",
    properties: {
      taxonomy: { type: "string", description: "Taxonomy name or ID" },
    },
    required: ["taxonomy"],
  },
  handler: async ({ taxonomy }: { taxonomy: string }) => {
    const taxonomyId = resolveTaxonomyId(taxonomy);
    const desc = describeTaxonomy(kernel, taxonomyId);
    return JSON.stringify({
      id: desc.id,
      name: desc.name,
      description: desc.description,
      status: desc.status,
      entity_genera: desc.entity_genera.map((g) => ({
        name: g.name,
        entity_count: g.entity_count,
        attribute_count: Object.keys(g.def.attributes).length,
        states: Object.values(g.def.states).map((s) => s.name),
      })),
      feature_genera: desc.feature_genera.map((g) => ({
        name: g.name,
        parent_genus_name: g.parent_genus_name,
        attribute_count: Object.keys(g.def.attributes).length,
      })),
      relationship_genera: desc.relationship_genera.map((g) => ({
        name: g.name,
        roles: Object.values(g.def.roles).map((r) => r.name),
      })),
      action_genera: desc.action_genera.map((g) => ({
        name: g.name,
        ...(g.def.meta.description ? { description: g.def.meta.description } : {}),
      })),
      process_genera: desc.process_genera.map((g) => {
        const lanes = Object.values(g.def.lanes).sort((a, b) => a.position - b.position);
        const steps = Object.values(g.def.steps).sort((a, b) => a.position - b.position);
        return {
          name: g.name,
          ...(g.def.meta.description ? { description: g.def.meta.description } : {}),
          lanes: lanes.map((l) => l.name),
          steps: steps.map((s) => ({
            name: s.name,
            type: s.type,
            lane: s.lane,
            ...(s.gate_conditions ? { conditions: s.gate_conditions } : {}),
            ...(s.action_name ? { action: s.action_name } : {}),
            ...(s.task_title ? { title: s.task_title } : {}),
          })),
        };
      }),
      serialization_genera: desc.serialization_genera.map((g) => ({
        name: g.name,
        ...(g.def.meta.description ? { description: g.def.meta.description } : {}),
      })),
    }, null, 2);
  },
});

mcp.tool("describe_genus", {
  description: "Returns comprehensive documentation for a single genus: attributes, full state machine with per-state actions, cross-references to features/relationships/actions/processes/serializations, and entity health stats.",
  input: {
    type: "object",
    properties: {
      genus: { type: "string", description: "Genus name or ID" },
    },
    required: ["genus"],
  },
  handler: async ({ genus }: { genus: string }) => {
    const genusId = resolveGenusId(genus);
    const def = getGenusDef(kernel, genusId);
    const genusName = (def.meta.name as string) ?? "";
    const kind = (def.meta.kind as string) ?? "entity";

    const attributes = Object.values(def.attributes).map((a) => ({
      name: a.name,
      type: a.type,
      required: a.required,
      ...(a.default_value !== undefined ? { default_value: a.default_value } : {}),
    }));

    const states = Object.values(def.states).map((s) => ({
      name: s.name,
      initial: s.initial ?? false,
    }));

    const transitions = def.transitions.map((t) => ({
      from: t.from,
      to: t.to,
      ...(t.name ? { name: t.name } : {}),
    }));

    // Process genera: show full lane/step structure
    if (kind === "process") {
      const processDef = getProcessDef(kernel, genusId);
      const lanes = Object.values(processDef.lanes)
        .sort((a, b) => a.position - b.position)
        .map((lane) => {
          const laneSteps = Object.values(processDef.steps)
            .filter((s) => s.lane === lane.name)
            .sort((a, b) => a.position - b.position)
            .map((step) => ({
              name: step.name,
              type: step.type,
              ...(step.task_title ? { task_title: step.task_title } : {}),
              ...(step.action_name ? { action_name: step.action_name } : {}),
              ...(step.fetch_source ? { fetch_source: step.fetch_source } : {}),
              ...(step.fetch_into ? { fetch_into: step.fetch_into } : {}),
              ...(step.gate_conditions && step.gate_conditions.length > 0 ? { gate_conditions: step.gate_conditions } : {}),
              ...(step.task_target_agent_type ? { task_target_agent_type: step.task_target_agent_type } : {}),
              ...(step.task_priority ? { task_priority: step.task_priority } : {}),
            }));
          return { name: lane.name, steps: laneSteps };
        });

      const instances = listProcesses(kernel, { genus_id: genusId });
      const statusCounts: Record<string, number> = {};
      for (const inst of instances) {
        const s = inst.status ?? "unknown";
        statusCounts[s] = (statusCounts[s] ?? 0) + 1;
      }

      return JSON.stringify({
        id: genusId,
        name: genusName,
        kind: "process",
        ...(def.meta.description ? { description: def.meta.description } : {}),
        ...(def.meta.taxonomy_id ? { taxonomy_id: def.meta.taxonomy_id } : {}),
        lanes,
        triggers: processDef.triggers,
        instances: statusCounts,
      }, null, 2);
    }

    // For non-entity genera, return identity + attributes + states + transitions only
    if (kind !== "entity") {
      return JSON.stringify({
        id: genusId,
        name: genusName,
        kind,
        ...(def.meta.description ? { description: def.meta.description } : {}),
        ...(def.meta.taxonomy_id ? { taxonomy_id: def.meta.taxonomy_id } : {}),
        attributes,
        states,
        transitions,
      }, null, 2);
    }

    // Entity genus — full cross-reference output
    const actions = findActionsByTargetGenus(kernel, genusName);

    // Per-state view
    const per_state = states.map((s) => ({
      state: s.name,
      initial: s.initial,
      transitions_out: transitions.filter((t) => t.from === s.name),
      actions_available: actions.filter((a) => {
        const resources = Object.values(a.def.resources).filter(
          (r) => r.genus_name.toLowerCase() === genusName.toLowerCase(),
        );
        return resources.some((r) => !r.required_status || r.required_status === s.name);
      }).map((a) => ({
        name: a.name,
        ...(a.def.meta.description ? { description: a.def.meta.description } : {}),
      })),
    }));

    // Feature genera
    const featureGenera = getFeatureGenusForEntityGenus(kernel, genusName);
    const feature_genera = featureGenera.map((g) => ({
      name: g.name,
      attributes: Object.values(g.def.attributes).map((a) => ({
        name: a.name, type: a.type, required: a.required,
      })),
      states: Object.values(g.def.states).map((s) => ({
        name: s.name, initial: s.initial ?? false,
      })),
      ...(g.def.meta.editable_parent_statuses ? { editable_parent_statuses: g.def.meta.editable_parent_statuses } : {}),
    }));

    // Relationship genera
    const allRelGenera = listRelationshipGenera(kernel);
    const relationship_genera = allRelGenera
      .filter((rg) =>
        Object.values(rg.def.roles).some((role) =>
          role.valid_member_genera.length === 0 ||
          role.valid_member_genera.some((v) => v.toLowerCase() === genusName.toLowerCase()),
        ),
      )
      .map((rg) => ({
        name: rg.name,
        roles_filled: Object.values(rg.def.roles)
          .filter((role) =>
            role.valid_member_genera.length === 0 ||
            role.valid_member_genera.some((v) => v.toLowerCase() === genusName.toLowerCase()),
          )
          .map((role) => role.name),
        all_roles: Object.values(rg.def.roles).map((role) => ({
          name: role.name,
          valid_member_genera: role.valid_member_genera,
          cardinality: role.cardinality,
        })),
      }));

    // Action genera
    const action_genera = actions.map((a) => ({
      name: a.name,
      ...(a.def.meta.description ? { description: a.def.meta.description } : {}),
      resources: Object.values(a.def.resources).map((r) => ({
        name: r.name,
        genus_name: r.genus_name,
        ...(r.required_status ? { required_status: r.required_status } : {}),
      })),
      parameters: Object.values(a.def.parameters).map((p) => ({
        name: p.name,
        type: p.type,
        required: p.required,
      })),
      side_effects: a.def.handler.map((h) => h.type),
    }));

    // Process genera — filter by action steps that target actions for this genus
    const allProcessGenera = listProcessGenera(kernel);
    const process_genera = allProcessGenera
      .filter((pg) =>
        Object.values(pg.def.steps).some((step) => {
          if (step.type !== "action_step" || !step.action_name) return false;
          const actionId = findActionByName(kernel, step.action_name);
          if (!actionId) return false;
          const actionDef = getActionDef(kernel, actionId);
          return Object.values(actionDef.resources).some(
            (r) => r.genus_name.toLowerCase() === genusName.toLowerCase(),
          );
        }),
      )
      .map((pg) => {
        const lanes = Object.values(pg.def.lanes).sort((a, b) => a.position - b.position);
        const steps = Object.values(pg.def.steps).sort((a, b) => a.position - b.position);
        const relevantSteps = steps.filter((step) => {
          if (step.type !== "action_step" || !step.action_name) return false;
          const actionId = findActionByName(kernel, step.action_name);
          if (!actionId) return false;
          const actionDef = getActionDef(kernel, actionId);
          return Object.values(actionDef.resources).some(
            (r) => r.genus_name.toLowerCase() === genusName.toLowerCase(),
          );
        });
        return {
          name: pg.name,
          ...(pg.def.meta.description ? { description: pg.def.meta.description } : {}),
          lanes: lanes.map((l) => l.name),
          step_count: steps.length,
          relevant_steps: relevantSteps.map((s) => ({
            name: s.name,
            type: s.type,
            action: s.action_name,
          })),
        };
      });

    // Serialization genera
    const allSerGenera = listSerializationGenera(kernel);
    const serialization_genera = allSerGenera
      .filter((sg) => sg.def.input.genus_name?.toLowerCase() === genusName.toLowerCase())
      .map((sg) => ({
        name: sg.name,
        ...(sg.def.meta.description ? { description: sg.def.meta.description } : {}),
      }));

    // Entity stats
    const entities = listEntities(kernel, { genus_id: genusId });
    const unhealthy = listUnhealthy(kernel, { genus_id: genusId });
    const totalCount = entities.length;
    const unhealthyCount = unhealthy.length;

    return JSON.stringify({
      id: genusId,
      name: genusName,
      kind: "entity",
      ...(def.meta.description ? { description: def.meta.description } : {}),
      ...(def.meta.taxonomy_id ? { taxonomy_id: def.meta.taxonomy_id } : {}),
      attributes,
      states,
      transitions,
      per_state,
      feature_genera,
      relationship_genera,
      action_genera,
      process_genera,
      serialization_genera,
      entities: { total: totalCount, healthy: totalCount - unhealthyCount, unhealthy: unhealthyCount },
    }, null, 2);
  },
});

// --- Temporal Anchor tools ---

mcp.tool("set_temporal_anchor", {
  description: "Attach a temporal anchor (year range) to an entity. Negative years for BC. Precision: exact, approximate, century, millennium.",
  input: {
    type: "object",
    properties: {
      entity_id: { type: "string", description: "Entity ID" },
      start_year: { type: "number", description: "Start year (negative for BC)" },
      end_year: { type: "number", description: "End year (optional, null for point events)" },
      precision: { type: "string", enum: ["exact", "approximate", "century", "millennium"], description: "Precision level (default: approximate)" },
      calendar_note: { type: "string", description: "Optional note about the calendar system or dating method" },
    },
    required: ["entity_id", "start_year"],
  },
  handler: async ({ entity_id, start_year, end_year, precision, calendar_note }: { entity_id: string; start_year: number; end_year?: number; precision?: "exact" | "approximate" | "century" | "millennium"; calendar_note?: string }) => {
    const anchor = setTemporalAnchor(kernel, entity_id, { start_year, end_year, precision, calendar_note });
    return JSON.stringify(anchor, null, 2);
  },
});

mcp.tool("get_temporal_anchor", {
  description: "Get the temporal anchor for an entity.",
  input: {
    type: "object",
    properties: {
      entity_id: { type: "string", description: "Entity ID" },
    },
    required: ["entity_id"],
  },
  handler: async ({ entity_id }: { entity_id: string }) => {
    const anchor = getTemporalAnchor(kernel, entity_id);
    if (!anchor) return "No temporal anchor set.";
    return JSON.stringify(anchor, null, 2);
  },
});

mcp.tool("remove_temporal_anchor", {
  description: "Remove the temporal anchor from an entity.",
  input: {
    type: "object",
    properties: {
      entity_id: { type: "string", description: "Entity ID" },
    },
    required: ["entity_id"],
  },
  handler: async ({ entity_id }: { entity_id: string }) => {
    removeTemporalAnchor(kernel, entity_id);
    return "Temporal anchor removed.";
  },
});

mcp.tool("query_timeline", {
  description: "Query entities by their temporal anchors. Returns chronologically sorted entries within a year range.",
  input: {
    type: "object",
    properties: {
      start_year: { type: "number", description: "Start of year range (inclusive)" },
      end_year: { type: "number", description: "End of year range (inclusive)" },
      genus: { type: "string", description: "Optional genus name to filter by" },
      limit: { type: "number", description: "Max entries (default 50)" },
    },
  },
  handler: async ({ start_year, end_year, genus, limit }: { start_year?: number; end_year?: number; genus?: string; limit?: number }) => {
    const genusId = genus ? resolveGenusId(genus) : undefined;
    const entries = queryTimeline(kernel, {
      start_year,
      end_year,
      genus_id: genusId,
      workspace_id: kernel.currentWorkspace ?? undefined,
      limit: limit ?? 50,
    });
    return JSON.stringify({ timeline: entries, total: entries.length }, null, 2);
  },
});

mcp.tool("list_genera", {
  description: "List all defined genera (entity types) with their attributes, states, and transitions. Optionally filter by taxonomy. Deprecated genera are excluded by default.",
  input: {
    type: "object",
    properties: {
      taxonomy: { type: "string", description: "Optional taxonomy name or ID to filter by" },
      include_deprecated: { type: "boolean", description: "Include deprecated genera (default: false)" },
    },
  },
  handler: async ({ taxonomy, include_deprecated }: { taxonomy?: string; include_deprecated?: boolean }) => {
    const taxonomy_id = taxonomy ? resolveTaxonomyId(taxonomy) : undefined;
    const genera = listGenera(kernel, {
      ...(taxonomy_id ? { taxonomy_id } : {}),
      ...(include_deprecated ? { include_deprecated } : {}),
    });
    const result = genera.map((g) => ({
      id: g.id,
      name: g.name,
      ...(g.def.meta.description ? { description: g.def.meta.description } : {}),
      ...(g.def.meta.deprecated === true ? { deprecated: true, deprecated_at: g.def.meta.deprecated_at } : {}),
      entity_count: listEntities(kernel, { genus_id: g.id }).length,
      attributes: Object.values(g.def.attributes).map((a) => ({
        name: a.name,
        type: a.type,
        required: a.required,
      })),
      states: Object.values(g.def.states).map((s) => ({
        name: s.name,
        initial: s.initial,
      })),
      transitions: g.def.transitions.map((t) => ({
        from: t.from,
        to: t.to,
        ...(t.name ? { name: t.name } : {}),
      })),
    }));
    return JSON.stringify(result, null, 2);
  },
});

mcp.tool("define_entity_genus", {
  description: "Define a new entity genus with attributes, states, and transitions. Use this to create new types of entities (e.g., Product, Customer, Order).",
  input: {
    type: "object",
    properties: {
      name: { type: "string", description: "Name for the new genus" },
      description: { type: "string", description: "Optional description of the genus" },
      taxonomy: { type: "string", description: "Taxonomy name or ID (defaults to Default taxonomy)" },
      attributes: {
        type: "array",
        description: "Attribute definitions for entities of this genus",
        items: {
          type: "object",
          properties: {
            name: { type: "string", description: "Attribute name" },
            type: { type: "string", description: "Attribute type: text, number, boolean, or filetree" },
            required: { type: "boolean", description: "Whether the attribute is required (default false)" },
            default_value: { description: "Default value for the attribute" },
          },
          required: ["name", "type"],
        },
      },
      states: {
        type: "array",
        description: "State definitions for the state machine",
        items: {
          type: "object",
          properties: {
            name: { type: "string", description: "State name" },
            initial: { type: "boolean", description: "Whether this is the initial state (exactly one required)" },
          },
          required: ["name"],
        },
      },
      transitions: {
        type: "array",
        description: "Transitions between states",
        items: {
          type: "object",
          properties: {
            from: { type: "string", description: "Source state name" },
            to: { type: "string", description: "Target state name" },
            name: { type: "string", description: "Optional transition name" },
          },
          required: ["from", "to"],
        },
      },
    },
    required: ["name"],
  },
  handler: async ({ name, description, taxonomy, attributes, states, transitions }: {
    name: string;
    description?: string;
    taxonomy?: string;
    attributes?: { name: string; type: string; required?: boolean; default_value?: unknown }[];
    states?: { name: string; initial?: boolean }[];
    transitions?: { from: string; to: string; name?: string }[];
  }) => {
    // Check name uniqueness (entity genera only)
    const existing = listGenera(kernel);
    if (existing.some((g) => g.name.toLowerCase() === name.toLowerCase())) {
      throw new Error(`Entity genus "${name}" already exists`);
    }

    if (attributes) validateAttributes(attributes);
    if (transitions && !states) {
      throw new Error("Cannot define transitions without states");
    }
    if (states) validateStateMachine(states, transitions ?? []);

    const taxonomy_id = taxonomy ? resolveTaxonomyId(taxonomy) : DEFAULT_TAXONOMY_ID;
    const meta: Record<string, unknown> = {};
    if (description) meta.description = description;

    const genusId = defineEntityGenus(kernel, name, {
      attributes: attributes as any,
      states: states?.map((s) => ({ name: s.name, initial: s.initial ?? false })),
      transitions,
      meta,
      taxonomy_id,
    });

    const def = getGenusDef(kernel, genusId);
    return JSON.stringify({ genus_id: genusId, name, definition: def }, null, 2);
  },
});

mcp.tool("define_feature_genus", {
  description: "Define a new feature genus attached to a parent entity genus. Features are sub-entities (e.g., Variant on Product, LineItem on Order).",
  input: {
    type: "object",
    properties: {
      name: { type: "string", description: "Name for the new feature genus" },
      parent_genus: { type: "string", description: "Parent entity genus name or ID" },
      description: { type: "string", description: "Optional description of the feature genus" },
      taxonomy: { type: "string", description: "Taxonomy name or ID (defaults to parent genus's taxonomy)" },
      attributes: {
        type: "array",
        description: "Attribute definitions for features of this genus",
        items: {
          type: "object",
          properties: {
            name: { type: "string", description: "Attribute name" },
            type: { type: "string", description: "Attribute type: text, number, boolean, or filetree" },
            required: { type: "boolean", description: "Whether the attribute is required (default false)" },
            default_value: { description: "Default value for the attribute" },
          },
          required: ["name", "type"],
        },
      },
      states: {
        type: "array",
        description: "State definitions for the feature state machine",
        items: {
          type: "object",
          properties: {
            name: { type: "string", description: "State name" },
            initial: { type: "boolean", description: "Whether this is the initial state (exactly one required)" },
          },
          required: ["name"],
        },
      },
      transitions: {
        type: "array",
        description: "Transitions between feature states",
        items: {
          type: "object",
          properties: {
            from: { type: "string", description: "Source state name" },
            to: { type: "string", description: "Target state name" },
            name: { type: "string", description: "Optional transition name" },
          },
          required: ["from", "to"],
        },
      },
      editable_parent_statuses: {
        type: "array",
        description: "Parent entity statuses during which this feature can be edited",
        items: { type: "string" },
      },
    },
    required: ["name", "parent_genus"],
  },
  handler: async ({ name, parent_genus, description, taxonomy, attributes, states, transitions, editable_parent_statuses }: {
    name: string;
    parent_genus: string;
    description?: string;
    taxonomy?: string;
    attributes?: { name: string; type: string; required?: boolean; default_value?: unknown }[];
    states?: { name: string; initial?: boolean }[];
    transitions?: { from: string; to: string; name?: string }[];
    editable_parent_statuses?: string[];
  }) => {
    // Resolve parent genus and verify it's an entity genus
    const parentGenusId = resolveGenusId(parent_genus);
    const parentDef = getGenusDef(kernel, parentGenusId);
    if (parentDef.meta.kind) {
      throw new Error(`"${parent_genus}" is not an entity genus (it is a ${parentDef.meta.kind} genus)`);
    }
    const parentGenusName = parentDef.meta.name as string;

    // Check name uniqueness (feature genera only)
    const existingFeatures = listFeatureGenera(kernel);
    if (existingFeatures.some((g) => g.name.toLowerCase() === name.toLowerCase())) {
      throw new Error(`Feature genus "${name}" already exists`);
    }

    if (attributes) validateAttributes(attributes);
    if (transitions && !states) {
      throw new Error("Cannot define transitions without states");
    }
    if (states) validateStateMachine(states, transitions ?? []);

    // Validate editable_parent_statuses against parent's states
    if (editable_parent_statuses) {
      const parentStateNames = Object.keys(parentDef.states).map((s) => s.toLowerCase());
      for (const status of editable_parent_statuses) {
        if (!parentStateNames.includes(status.toLowerCase())) {
          throw new Error(`editable_parent_statuses references undefined parent state: "${status}". Valid states: ${Object.keys(parentDef.states).join(", ")}`);
        }
      }
    }

    // Taxonomy: inherit from parent if not specified
    const taxonomy_id = taxonomy
      ? resolveTaxonomyId(taxonomy)
      : (parentDef.meta.taxonomy_id as string) ?? DEFAULT_TAXONOMY_ID;

    const meta: Record<string, unknown> = {};
    if (description) meta.description = description;

    const genusId = defineFeatureGenus(kernel, name, {
      parent_genus_name: parentGenusName,
      attributes: attributes as any,
      states: states?.map((s) => ({ name: s.name, initial: s.initial ?? false })),
      transitions,
      editable_parent_statuses,
      meta,
      taxonomy_id,
    });

    const def = getGenusDef(kernel, genusId);
    return JSON.stringify({ genus_id: genusId, name, parent_genus: parentGenusName, definition: def }, null, 2);
  },
});

mcp.tool("create_entity", {
  description: "Create a new entity of a given genus and optionally set initial attributes and features. Use target_status to auto-traverse to a non-initial status. Use compact=true for minimal response.",
  input: {
    type: "object",
    properties: {
      genus: { type: "string", description: "Genus name or ID" },
      attributes: {
        type: "object",
        description: "Key-value pairs of initial attributes to set",
        additionalProperties: true,
      },
      features: {
        type: "array",
        description: "Optional features to create on the entity",
        items: {
          type: "object",
          properties: {
            genus: { type: "string", description: "Feature genus name" },
            attributes: { type: "object", additionalProperties: true },
          },
          required: ["genus"],
        },
      },
      target_status: { type: "string", description: "Auto-traverse to this status after creation (uses BFS shortest path)" },
      compact: { type: "boolean", description: "Return id/genus/status only (default: false)" },
    },
    required: ["genus"],
  },
  handler: async ({ genus, attributes, features, target_status, compact }: { genus: string; attributes?: Record<string, unknown>; features?: { genus: string; attributes?: Record<string, unknown> }[]; target_status?: string; compact?: boolean }) => {
    _requireWorkspace();
    const genusId = resolveGenusId(genus);
    const entityId = createEntity(kernel, genusId);

    if (attributes) {
      for (const [key, value] of Object.entries(attributes)) {
        setAttribute(kernel, entityId, key, value);
      }
    }

    if (features) {
      for (const f of features) {
        const fGenusId = resolveFeatureGenusId(f.genus);
        createFeature(kernel, entityId, fGenusId, { attributes: f.attributes });
      }
    }

    if (target_status) {
      const genusDef = getGenusDef(kernel, genusId);
      const currentState = materialize(kernel, entityId, { branch_id: kernel.currentBranch });
      const currentStatus = currentState.status as string;
      if (currentStatus !== target_status) {
        const path = findTransitionPath(genusDef, currentStatus, target_status);
        if (!path || path.length === 0) { const reachable = _reachableStates(genusDef, currentStatus); throw new Error(`No valid transition path from "${currentStatus}" to "${target_status}". Reachable states from "${currentStatus}": ${reachable.length > 0 ? reachable.join(", ") : "(none — terminal state)"}`); }
        for (const step of path) transitionStatus(kernel, entityId, step);
      }
    }

    const state = materialize(kernel, entityId, { branch_id: kernel.currentBranch });
    const genusDef = getGenusDef(kernel, genusId);
    if (compact) {
      return JSON.stringify({ id: entityId, genus: genusDef.meta.name, status: state.status }, null, 2);
    }
    return JSON.stringify({
      id: entityId,
      genus: genusDef.meta.name,
      state,
    }, null, 2);
  },
});

mcp.tool("create_entities", {
  description: "Create multiple entities in one call. Use target_status per entity to auto-traverse to a non-initial status. Use compact=true for minimal response.",
  input: {
    type: "object",
    properties: {
      entities: {
        type: "array",
        description: "Array of entities to create",
        items: {
          type: "object",
          properties: {
            genus: { type: "string", description: "Genus name or ID" },
            attributes: { type: "object", description: "Key-value pairs of initial attributes", additionalProperties: true },
            features: {
              type: "array",
              description: "Optional features to create",
              items: {
                type: "object",
                properties: {
                  genus: { type: "string", description: "Feature genus name" },
                  attributes: { type: "object", additionalProperties: true },
                },
                required: ["genus"],
              },
            },
            target_status: { type: "string", description: "Auto-traverse to this status after creation" },
          },
          required: ["genus"],
        },
      },
      compact: { type: "boolean", description: "Return id/genus/status only (default: false)" },
    },
    required: ["entities"],
  },
  handler: async ({ entities, compact }: { entities: { genus: string; attributes?: Record<string, unknown>; features?: { genus: string; attributes?: Record<string, unknown> }[]; target_status?: string }[]; compact?: boolean }) => {
    _requireWorkspace();
    const created: { id: string; genus: string; state: Record<string, unknown> }[] = [];

    for (const entry of entities) {
      const genusId = resolveGenusId(entry.genus);
      const entityId = createEntity(kernel, genusId);

      if (entry.attributes) {
        for (const [key, value] of Object.entries(entry.attributes)) {
          setAttribute(kernel, entityId, key, value);
        }
      }

      if (entry.features) {
        for (const f of entry.features) {
          const fGenusId = resolveFeatureGenusId(f.genus);
          createFeature(kernel, entityId, fGenusId, { attributes: f.attributes });
        }
      }

      if (entry.target_status) {
        const genusDef = getGenusDef(kernel, genusId);
        const currentState = materialize(kernel, entityId, { branch_id: kernel.currentBranch });
        const currentStatus = currentState.status as string;
        if (currentStatus !== entry.target_status) {
          const path = findTransitionPath(genusDef, currentStatus, entry.target_status);
          if (!path || path.length === 0) { const reachable = _reachableStates(genusDef, currentStatus); throw new Error(`No valid transition path from "${currentStatus}" to "${entry.target_status}" for genus "${genusDef.meta.name}". Reachable states from "${currentStatus}": ${reachable.length > 0 ? reachable.join(", ") : "(none — terminal state)"}`); }
          for (const step of path) transitionStatus(kernel, entityId, step);
        }
      }

      const state = materialize(kernel, entityId, { branch_id: kernel.currentBranch });
      const genusDef = getGenusDef(kernel, genusId);
      created.push({ id: entityId, genus: (genusDef.meta.name as string) ?? "", state });
    }

    if (compact) {
      return JSON.stringify({ created: created.map((c) => ({ id: c.id, genus: c.genus, status: c.state.status })), total: created.length }, null, 2);
    }
    return JSON.stringify({ created, total: created.length }, null, 2);
  },
});

mcp.tool("list_entities", {
  description: "List entities, optionally filtered by genus. Defaults to compact (id/genus/status/name) when no genus specified. Use compact=false for full state.",
  input: {
    type: "object",
    properties: {
      genus: { type: "string", description: "Genus name or ID to filter by" },
      status: { type: "string", description: "Filter by current status (e.g., 'draft', 'active')" },
      limit: { type: "number", description: "Max entities to return" },
      compact: { type: "boolean", description: "Return id/genus/status/name only (default: false)" },
      attribute_filters: {
        type: "array",
        description: "Filter by attribute values. Multiple filters are ANDed.",
        items: {
          type: "object",
          properties: {
            key: { type: "string", description: "Attribute name" },
            op: { type: "string", enum: ["eq", "contains"], description: "eq: strict equality, contains: case-insensitive substring (strings only)" },
            value: { description: "Value to compare against" },
          },
          required: ["key", "op", "value"],
        },
      },
      all_workspaces: { type: "boolean", description: "Search across all workspaces, ignoring current workspace scope (default false)" },
    },
  },
  handler: async ({ genus, status, limit, compact, attribute_filters, all_workspaces }: { genus?: string; status?: string; limit?: number; compact?: boolean; attribute_filters?: { key: string; op: "eq" | "contains"; value: unknown }[]; all_workspaces?: boolean }) => {
    let genusId: string | undefined;
    if (genus) {
      genusId = resolveGenusId(genus);
    }

    const entities = listEntities(kernel, { genus_id: genusId, status, limit, attribute_filters, all_workspaces });
    const useCompact = compact ?? !genusId;
    const result = entities.map((e) => {
      const genusDef = getGenusDef(kernel, e.genus_id);
      if (useCompact) {
        return { id: e.id, genus: genusDef.meta.name, status: e.state.status ?? null, name: (e.state.name as string) ?? (e.state.title as string) ?? null };
      }
      return {
        id: e.id,
        genus: genusDef.meta.name,
        created_at: e.created_at,
        state: e.state,
      };
    });
    return JSON.stringify({ entities: result, ..._workspaceContext() }, null, 2);
  },
});

mcp.tool("get_entity", {
  description: "Get full details for a single entity including state, genus info, tessella count, and available transitions.",
  input: {
    type: "object",
    properties: {
      entity_id: { type: "string", description: "Entity ID" },
    },
    required: ["entity_id"],
  },
  handler: async ({ entity_id }: { entity_id: string }) => {
    const res = getRes(kernel, entity_id);
    const state = materialize(kernel, entity_id, { branch_id: kernel.currentBranch });
    const genusDef = getGenusDef(kernel, res.genus_id);
    const tessellae = replay(kernel, entity_id, { branch_id: kernel.currentBranch });
    const currentStatus = state.status as string | undefined;

    let availableTransitions: { target: string; name?: string }[] = [];
    if (currentStatus) {
      availableTransitions = genusDef.transitions
        .filter((t) => t.from === currentStatus)
        .map((t) => ({ target: t.to, ...(t.name ? { name: t.name } : {}) }));
    }

    // Format features with genus names
    const features = state.features as Record<string, Record<string, unknown>> | undefined;
    let formattedFeatures: Record<string, any> | undefined;
    if (features && Object.keys(features).length > 0) {
      formattedFeatures = {};
      for (const [fId, fState] of Object.entries(features)) {
        const fGenusId = fState.genus_id as string;
        const fDef = getGenusDef(kernel, fGenusId);
        const { genus_id: _, ...attrs } = fState;
        formattedFeatures[fId] = {
          genus: fDef.meta.name,
          ...attrs,
        };
      }
    }

    // Format relationships
    const relationships = getRelationshipsForEntity(kernel, entity_id);
    let formattedRelationships: any[] | undefined;
    if (relationships.length > 0) {
      formattedRelationships = relationships.map((rel) => {
        const otherMembers: Record<string, any[]> = {};
        for (const [roleName, memberIds] of Object.entries(rel.members)) {
          otherMembers[roleName] = memberIds.map((mid) => {
            if (mid === entity_id) return { id: mid, note: "(this entity)" };
            try {
              const mRes = getRes(kernel, mid);
              const mState = materialize(kernel, mid, { branch_id: kernel.currentBranch });
              const mDef = getGenusDef(kernel, mRes.genus_id);
              return { id: mid, genus: mDef.meta.name, state: mState };
            } catch {
              return { id: mid };
            }
          });
        }
        return {
          relationship_id: rel.id,
          genus: rel.genus_name,
          members: otherMembers,
          status: rel.state.status,
        };
      });
    }

    // Health summary
    const healthReport = evaluateHealth(kernel, entity_id);
    const health = {
      healthy: healthReport.healthy,
      issue_count: healthReport.issues.length,
      issues: healthReport.issues,
    };

    // Available actions (inline list_available_actions logic)
    const genusName = (genusDef.meta.name as string) ?? "";
    const targetActions = findActionsByTargetGenus(kernel, genusName);
    const availableActions = targetActions.map((action) => {
      let available = true;
      let reason: string | undefined;
      for (const resDef of Object.values(action.def.resources)) {
        if (resDef.genus_name.toLowerCase() === genusName.toLowerCase() && resDef.required_status) {
          if (currentStatus !== resDef.required_status) {
            available = false;
            reason = `Requires status "${resDef.required_status}", currently "${currentStatus}"`;
          }
        }
      }
      return {
        action_id: action.id,
        name: action.name,
        available,
        ...(reason ? { reason } : {}),
        parameters: Object.values(action.def.parameters).map((p) => ({
          name: p.name,
          type: p.type,
          required: p.required,
        })),
      };
    });

    // Pending tasks associated with this entity
    const pendingTasks = listTasks(kernel, { associated_res_id: entity_id, status: "pending" })
      .map((t) => ({ id: t.id, title: t.title, priority: t.priority }));

    return JSON.stringify({
      id: entity_id,
      genus_id: res.genus_id,
      genus: genusDef.meta.name,
      created_at: res.created_at,
      tessella_count: tessellae.length,
      state,
      health,
      available_transitions: availableTransitions,
      ...(availableActions.length > 0 ? { available_actions: availableActions } : {}),
      ...(pendingTasks.length > 0 ? { pending_tasks: pendingTasks } : {}),
      ...(formattedFeatures ? { features: formattedFeatures } : {}),
      ...(formattedRelationships ? { relationships: formattedRelationships } : {}),
      ..._workspaceContext(),
    }, null, 2);
  },
});

mcp.tool("set_attribute", {
  description: "Set an attribute on an entity. Validates against the genus definition.",
  input: {
    type: "object",
    properties: {
      entity_id: { type: "string", description: "Entity ID" },
      attribute: { type: "string", description: "Attribute name" },
      value: { description: "Attribute value (type must match genus definition)" },
    },
    required: ["entity_id", "attribute", "value"],
  },
  handler: async ({ entity_id, attribute, value }: { entity_id: string; attribute: string; value: unknown }) => {
    _requireWorkspace();
    setAttribute(kernel, entity_id, attribute, value);
    const state = materialize(kernel, entity_id, { branch_id: kernel.currentBranch });
    return JSON.stringify({ id: entity_id, state }, null, 2);
  },
});

mcp.tool("transition_status", {
  description: "Transition an entity to a new status. Validates against the genus state machine.",
  input: {
    type: "object",
    properties: {
      entity_id: { type: "string", description: "Entity ID" },
      target_status: { type: "string", description: "Target status to transition to" },
    },
    required: ["entity_id", "target_status"],
  },
  handler: async ({ entity_id, target_status }: { entity_id: string; target_status: string }) => {
    _requireWorkspace();
    transitionStatus(kernel, entity_id, target_status);
    const state = materialize(kernel, entity_id, { branch_id: kernel.currentBranch });
    return JSON.stringify({ id: entity_id, state }, null, 2);
  },
});

mcp.tool("batch_update", {
  description: "Apply status transitions and/or attribute updates. Two modes:\n1. operations: Array of {entity_id, target_status?, attribute?, value?} for explicit updates.\n2. where: SQL WHERE clause to match entities, with target_status or attribute+value to apply. Example: where=\"genus = 'Feature' AND status = 'planned'\" target_status=\"shipped\". Supported: field = 'value', field LIKE '%value%', combined with AND.",
  input: {
    type: "object",
    properties: {
      operations: {
        type: "array",
        description: "Array of update operations (mode 1)",
        items: {
          type: "object",
          properties: {
            entity_id: { type: "string", description: "Entity ID" },
            target_status: { type: "string", description: "Target status to transition to (mutually exclusive with attribute)" },
            attribute: { type: "string", description: "Attribute name to set (mutually exclusive with target_status)" },
            value: { description: "Attribute value (required with attribute)" },
          },
          required: ["entity_id"],
        },
      },
      where: { type: "string", description: "SQL WHERE clause to match entities (mode 2). E.g. \"genus = 'PainPoint' AND status = 'noticed'\"" },
      target_status: { type: "string", description: "Target status for WHERE-matched entities" },
      attribute: { type: "string", description: "Attribute to set on WHERE-matched entities" },
      value: { description: "Value to set (required with attribute)" },
    },
  },
  handler: async ({ operations, where, target_status, attribute, value }: { operations?: { entity_id: string; target_status?: string; attribute?: string; value?: unknown }[]; where?: string; target_status?: string; attribute?: string; value?: unknown }) => {
    _requireWorkspace();
    const updated: { entity_id: string; operation: string; state: Record<string, unknown> }[] = [];

    // Mode 2: WHERE clause
    if (where) {
      if (operations) throw new Error("Cannot use both 'operations' and 'where'. Pick one mode.");
      if (!target_status && attribute === undefined) throw new Error("WHERE mode requires target_status or attribute+value.");
      const parsed = _parseWhereClause(where);
      const entities = listEntities(kernel, { genus_id: parsed.genus_id, status: parsed.status, attribute_filters: parsed.attribute_filters });

      if (entities.length === 0) {
        return JSON.stringify({ updated: [], total: 0, message: "No entities matched the WHERE clause." }, null, 2);
      }

      for (const entity of entities) {
        try {
          if (target_status) {
            try {
              transitionStatus(kernel, entity.id, target_status);
              const state = materialize(kernel, entity.id, { branch_id: kernel.currentBranch });
              updated.push({ entity_id: entity.id, operation: `transition → ${target_status}`, state });
            } catch {
              const resRow = getRes(kernel, entity.id);
              const genusDef = getGenusDef(kernel, resRow.genus_id);
              const currentStatus = entity.state.status as string;
              const path = findTransitionPath(genusDef, currentStatus, target_status);
              if (!path || path.length === 0) {
                const reachable = _reachableStates(genusDef, currentStatus);
                throw new Error(`No valid transition from "${currentStatus}" to "${target_status}". Reachable states from "${currentStatus}": ${reachable.length > 0 ? reachable.join(", ") : "(none — terminal state)"}`);
              }
              for (const step of path) {
                transitionStatus(kernel, entity.id, step);
              }
              const state = materialize(kernel, entity.id, { branch_id: kernel.currentBranch });
              updated.push({ entity_id: entity.id, operation: `transition → ${target_status} (via ${path.join(" → ")})`, state });
            }
          } else if (attribute !== undefined) {
            setAttribute(kernel, entity.id, attribute, value);
            const state = materialize(kernel, entity.id, { branch_id: kernel.currentBranch });
            updated.push({ entity_id: entity.id, operation: `set ${attribute}`, state });
          }
        } catch (err: any) {
          throw new Error(`Entity ${entity.id} failed (${updated.length} succeeded before): ${err.message}`);
        }
      }

      return JSON.stringify({ matched: entities.length, updated, total: updated.length }, null, 2);
    }

    // Mode 1: explicit operations
    if (!operations || operations.length === 0) throw new Error("Provide either 'operations' array or 'where' clause.");

    for (let i = 0; i < operations.length; i++) {
      const op = operations[i];
      try {
        if (op.target_status) {
          // Try direct transition first
          try {
            transitionStatus(kernel, op.entity_id, op.target_status);
            const state = materialize(kernel, op.entity_id, { branch_id: kernel.currentBranch });
            updated.push({ entity_id: op.entity_id, operation: `transition → ${op.target_status}`, state });
          } catch {
            // Direct transition failed — try BFS auto-traverse
            const resRow = getRes(kernel, op.entity_id);
            const genusDef = getGenusDef(kernel, resRow.genus_id);
            const currentState = materialize(kernel, op.entity_id, { branch_id: kernel.currentBranch });
            const currentStatus = currentState.status as string;
            const path = findTransitionPath(genusDef, currentStatus, op.target_status);
            if (!path || path.length === 0) {
              const reachable = _reachableStates(genusDef, currentStatus);
              throw new Error(`No valid transition from "${currentStatus}" to "${op.target_status}". Reachable states from "${currentStatus}": ${reachable.length > 0 ? reachable.join(", ") : "(none — terminal state)"}`);
            }
            for (const step of path) {
              transitionStatus(kernel, op.entity_id, step);
            }
            const state = materialize(kernel, op.entity_id, { branch_id: kernel.currentBranch });
            updated.push({ entity_id: op.entity_id, operation: `transition → ${op.target_status} (via ${path.join(" → ")})`, state });
          }
        } else if (op.attribute !== undefined) {
          setAttribute(kernel, op.entity_id, op.attribute, op.value);
          const state = materialize(kernel, op.entity_id, { branch_id: kernel.currentBranch });
          updated.push({ entity_id: op.entity_id, operation: `set ${op.attribute}`, state });
        } else {
          throw new Error(`Operation ${i}: must specify either target_status or attribute`);
        }
      } catch (err: any) {
        throw new Error(`Operation ${i} failed (${updated.length} succeeded before): ${err.message}`);
      }
    }

    return JSON.stringify({ updated, total: updated.length }, null, 2);
  },
});

mcp.tool("list_available_actions", {
  description: "List actions available for an entity. Shows which actions can be executed given the entity's current state, and what parameters each action requires.",
  input: {
    type: "object",
    properties: {
      entity_id: { type: "string", description: "Entity ID to check available actions for" },
    },
    required: ["entity_id"],
  },
  handler: async ({ entity_id }: { entity_id: string }) => {
    const res = getRes(kernel, entity_id);
    const genusDef = getGenusDef(kernel, res.genus_id);
    const genusName = (genusDef.meta.name as string) ?? "";
    const entityState = materialize(kernel, entity_id, { branch_id: kernel.currentBranch });
    const currentStatus = entityState.status as string | undefined;

    const targetActions = findActionsByTargetGenus(kernel, genusName);

    const result = targetActions.map((action) => {
      // Check preconditions
      let available = true;
      let reason: string | undefined;

      for (const resDef of Object.values(action.def.resources)) {
        if (resDef.genus_name.toLowerCase() === genusName.toLowerCase() && resDef.required_status) {
          if (currentStatus !== resDef.required_status) {
            available = false;
            reason = `Requires status "${resDef.required_status}", currently "${currentStatus}"`;
          }
        }
      }

      return {
        action_id: action.id,
        name: action.name,
        available,
        reason,
        parameters: Object.values(action.def.parameters).map((p) => ({
          name: p.name,
          type: p.type,
          required: p.required,
        })),
      };
    });

    return JSON.stringify(result, null, 2);
  },
});

mcp.tool("execute_action", {
  description: "Execute a named action on an entity. Validates preconditions, runs side effects atomically, and returns the updated state.",
  input: {
    type: "object",
    properties: {
      action: { type: "string", description: "Action name (e.g., 'deploy')" },
      entity_id: { type: "string", description: "Target entity ID" },
      params: {
        type: "object",
        description: "Action parameters (e.g., { version: '2.0' })",
        additionalProperties: true,
      },
    },
    required: ["action", "entity_id"],
  },
  handler: async ({ action, entity_id, params }: { action: string; entity_id: string; params?: Record<string, unknown> }) => {
    _requireWorkspace();
    const actionId = findActionByName(kernel, action);
    if (!actionId) {
      return JSON.stringify({ error: `Action not found: ${action}` }, null, 2);
    }

    const actionDef = getActionDef(kernel, actionId);

    // Build resource bindings: find which resource slot this entity fills
    const res = getRes(kernel, entity_id);
    const genusDef = getGenusDef(kernel, res.genus_id);
    const genusName = (genusDef.meta.name as string) ?? "";

    const resourceBindings: Record<string, string> = {};
    for (const [name, resDef] of Object.entries(actionDef.resources)) {
      if (resDef.genus_name.toLowerCase() === genusName.toLowerCase()) {
        resourceBindings[name] = entity_id;
      }
    }

    const result = executeAction(kernel, actionId, resourceBindings, params ?? {}, { source: "mcp" });
    if (result.error) {
      return JSON.stringify({ error: result.error }, null, 2);
    }

    const newState = materialize(kernel, entity_id, { branch_id: kernel.currentBranch });
    return JSON.stringify({
      action_taken_id: result.action_taken!.id,
      entity_id,
      state: newState,
      tessellae_count: result.tessellae!.length,
    }, null, 2);
  },
});

mcp.tool("get_history", {
  description: "Get the tessella history for an entity, with action context. Use diff=true to show only changed fields per event.",
  input: {
    type: "object",
    properties: {
      entity_id: { type: "string", description: "Entity ID" },
      limit: { type: "number", description: "Max entries to return" },
      diff: { type: "boolean", description: "Show only changed fields per tessella (default: false)" },
    },
    required: ["entity_id"],
  },
  handler: async ({ entity_id, limit, diff }: { entity_id: string; limit?: number; diff?: boolean }) => {
    const history = getHistory(kernel, entity_id, { limit });
    let prevData: Record<string, unknown> = {};
    const result = history.map((entry, i) => {
      let data: any = entry.tessella.data;
      if (diff && i > 0) {
        const delta: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(entry.tessella.data)) {
          if (JSON.stringify(v) !== JSON.stringify(prevData[k])) delta[k] = v;
        }
        data = delta;
      }
      prevData = entry.tessella.data;
      const item: any = {
        tessella_id: entry.tessella.id,
        type: entry.tessella.type,
        data,
        created_at: entry.tessella.created_at,
      };
      if (entry.action_taken) {
        const actionDef = getActionDef(kernel, entry.action_taken.action_genus_id);
        item.action = {
          name: (actionDef.meta.name as string) ?? "",
          params: entry.action_taken.params,
          action_taken_id: entry.action_taken.id,
        };
      }
      return item;
    });
    return JSON.stringify(result, null, 2);
  },
});

mcp.tool("define_action_genus", {
  description: "Define a new action genus — a reusable business action with typed resources, parameters, and a handler of side effects (e.g., 'discontinue a Product by setting discontinued_at and transitioning to discontinued').",
  input: {
    type: "object",
    properties: {
      name: { type: "string", description: "Name for the new action (e.g., 'Discontinue Product')" },
      description: { type: "string", description: "Optional description of what this action does" },
      taxonomy: { type: "string", description: "Taxonomy name or ID (defaults to Default taxonomy)" },
      resources: {
        type: "array",
        description: "Resource bindings — entities this action operates on",
        items: {
          type: "object",
          properties: {
            name: { type: "string", description: "Resource name used in handler tokens (e.g., 'product')" },
            genus_name: { type: "string", description: "Entity genus name this resource must be" },
            required_status: { type: "string", description: "Entity must be in this status to run the action" },
          },
          required: ["name", "genus_name"],
        },
      },
      parameters: {
        type: "array",
        description: "Parameter definitions for runtime inputs",
        items: {
          type: "object",
          properties: {
            name: { type: "string", description: "Parameter name used in handler tokens (e.g., 'reason')" },
            type: { type: "string", description: "Parameter type: text, number, boolean, or filetree" },
            required: { type: "boolean", description: "Whether the parameter is required (default false)" },
          },
          required: ["name", "type"],
        },
      },
      handler: {
        type: "array",
        description: "Side effects to execute. Tokens: $res.X.id, $param.X, $now",
        items: {
          type: "object",
          properties: {
            type: { type: "string", description: "Side effect type: set_attribute, transition_status, create_res, create_log, create_error, create_task" },
          },
          required: ["type"],
          additionalProperties: true,
        },
      },
    },
    required: ["name"],
  },
  handler: async ({ name, description, taxonomy, resources, parameters, handler }: {
    name: string;
    description?: string;
    taxonomy?: string;
    resources?: { name: string; genus_name: string; required_status?: string }[];
    parameters?: { name: string; type: string; required?: boolean }[];
    handler?: { type: string; [key: string]: unknown }[];
  }) => {
    // Check name uniqueness
    const existing = listActionGenera(kernel);
    if (existing.some((a) => a.name.toLowerCase() === name.toLowerCase())) {
      throw new Error(`Action genus "${name}" already exists`);
    }

    // Validate parameters
    if (parameters) {
      const VALID_PARAM_TYPES = ["text", "number", "boolean", "filetree"];
      const seenParams = new Set<string>();
      for (const param of parameters) {
        const lower = param.name.toLowerCase();
        if (seenParams.has(lower)) {
          throw new Error(`Duplicate parameter name: "${param.name}"`);
        }
        seenParams.add(lower);
        if (!VALID_PARAM_TYPES.includes(param.type)) {
          throw new Error(`Invalid parameter type "${param.type}" for parameter "${param.name}". Valid types: ${VALID_PARAM_TYPES.join(", ")}`);
        }
      }
    }

    // Validate resources
    if (resources) {
      const seenResources = new Set<string>();
      for (const res of resources) {
        const lower = res.name.toLowerCase();
        if (seenResources.has(lower)) {
          throw new Error(`Duplicate resource name: "${res.name}"`);
        }
        seenResources.add(lower);
        const genusId = resolveGenusId(res.genus_name);
        const def = getGenusDef(kernel, genusId);
        if (def.meta.kind) {
          throw new Error(`Resource "${res.name}" references "${res.genus_name}" which is a ${def.meta.kind} genus, not an entity genus`);
        }
        if (res.required_status) {
          const stateNames = Object.keys(def.states);
          if (stateNames.length === 0) {
            throw new Error(`Resource "${res.name}" specifies required_status "${res.required_status}" but genus "${res.genus_name}" is stateless`);
          }
          if (!stateNames.some((s) => s.toLowerCase() === res.required_status!.toLowerCase())) {
            throw new Error(`Resource "${res.name}" specifies required_status "${res.required_status}" but genus "${res.genus_name}" has no such state. Valid states: ${stateNames.join(", ")}`);
          }
        }
      }
    }

    // Normalize bare resource/parameter names in handler to $res.X.id / $param.X tokens
    // Only rewrite specific fields: "res" → $res.X.id, "value" → $param.X
    const resourceNameSet = new Set((resources ?? []).map((r) => r.name));
    const parameterNameSet = new Set((parameters ?? []).map((p) => p.name));
    if (handler && handler.length > 0) {
      for (const effect of handler) {
        // Normalize "res" field: bare resource name → $res.X.id
        if (typeof effect.res === "string" && !effect.res.startsWith("$") && resourceNameSet.has(effect.res)) {
          effect.res = `$res.${effect.res}.id`;
        }
        // Normalize "value" field: bare parameter name → $param.X
        if (typeof effect.value === "string" && !effect.value.startsWith("$") && parameterNameSet.has(effect.value)) {
          effect.value = `$param.${effect.value}`;
        }
        // Normalize "message" field: bare parameter names embedded in text → $param.X
        if (typeof effect.message === "string" && !effect.message.startsWith("$")) {
          for (const pName of parameterNameSet) {
            if (effect.message === pName) {
              effect.message = `$param.${pName}`;
              break;
            }
          }
        }
      }
    }

    // Validate handler
    if (handler && handler.length > 0) {
      const resourceNames = [...resourceNameSet];
      const parameterNames = [...parameterNameSet];
      validateActionHandler(handler as any, resourceNames, parameterNames);
    }

    const taxonomy_id = taxonomy ? resolveTaxonomyId(taxonomy) : DEFAULT_TAXONOMY_ID;
    const meta: Record<string, unknown> = {};
    if (description) meta.description = description;

    const genusId = defineActionGenus(kernel, name, {
      resources: resources?.map((r) => ({
        name: r.name,
        genus_name: r.genus_name,
        ...(r.required_status ? { required_status: r.required_status } : {}),
      })),
      parameters: parameters?.map((p) => ({
        name: p.name,
        type: p.type as "text" | "number" | "boolean" | "filetree",
        required: p.required ?? false,
      })),
      handler: handler as any,
      meta,
      taxonomy_id,
    });

    const def = getActionDef(kernel, genusId);
    return JSON.stringify({ genus_id: genusId, name, definition: def }, null, 2);
  },
});

mcp.tool("create_feature", {
  description: "Create a feature (sub-entity) on an entity. Features live in the parent's tessella stream and have their own genus, status, and attributes.",
  input: {
    type: "object",
    properties: {
      entity_id: { type: "string", description: "Parent entity ID" },
      feature_genus: { type: "string", description: "Feature genus name (e.g., 'Page')" },
      attributes: {
        type: "object",
        description: "Initial attributes for the feature",
        additionalProperties: true,
      },
    },
    required: ["entity_id", "feature_genus"],
  },
  handler: async ({ entity_id, feature_genus, attributes }: { entity_id: string; feature_genus: string; attributes?: Record<string, unknown> }) => {
    _requireWorkspace();
    const fGenusId = resolveFeatureGenusId(feature_genus);
    const featureId = createFeature(kernel, entity_id, fGenusId, { attributes });
    const state = materialize(kernel, entity_id, { branch_id: kernel.currentBranch });
    const features = state.features as Record<string, any>;
    return JSON.stringify({
      feature_id: featureId,
      entity_id,
      feature: features[featureId],
    }, null, 2);
  },
});

mcp.tool("set_feature_attribute", {
  description: "Set an attribute on a feature. Validates against the feature genus definition and checks parent entity status constraints.",
  input: {
    type: "object",
    properties: {
      entity_id: { type: "string", description: "Parent entity ID" },
      feature_id: { type: "string", description: "Feature ID" },
      attribute: { type: "string", description: "Attribute name" },
      value: { description: "Attribute value (type must match feature genus definition)" },
    },
    required: ["entity_id", "feature_id", "attribute", "value"],
  },
  handler: async ({ entity_id, feature_id, attribute, value }: { entity_id: string; feature_id: string; attribute: string; value: unknown }) => {
    _requireWorkspace();
    setFeatureAttribute(kernel, entity_id, feature_id, attribute, value);
    const state = materialize(kernel, entity_id, { branch_id: kernel.currentBranch });
    const features = state.features as Record<string, any>;
    return JSON.stringify({
      entity_id,
      feature_id,
      feature: features[feature_id],
    }, null, 2);
  },
});

mcp.tool("transition_feature_status", {
  description: "Transition a feature to a new status. Validates against the feature genus state machine and checks parent entity status constraints.",
  input: {
    type: "object",
    properties: {
      entity_id: { type: "string", description: "Parent entity ID" },
      feature_id: { type: "string", description: "Feature ID" },
      target_status: { type: "string", description: "Target status to transition to" },
    },
    required: ["entity_id", "feature_id", "target_status"],
  },
  handler: async ({ entity_id, feature_id, target_status }: { entity_id: string; feature_id: string; target_status: string }) => {
    _requireWorkspace();
    transitionFeatureStatus(kernel, entity_id, feature_id, target_status);
    const state = materialize(kernel, entity_id, { branch_id: kernel.currentBranch });
    const features = state.features as Record<string, any>;
    return JSON.stringify({
      entity_id,
      feature_id,
      feature: features[feature_id],
    }, null, 2);
  },
});

mcp.tool("list_features", {
  description: "List features on an entity, optionally filtered by feature genus.",
  input: {
    type: "object",
    properties: {
      entity_id: { type: "string", description: "Entity ID" },
      feature_genus: { type: "string", description: "Feature genus name to filter by" },
    },
    required: ["entity_id"],
  },
  handler: async ({ entity_id, feature_genus }: { entity_id: string; feature_genus?: string }) => {
    const state = materialize(kernel, entity_id, { branch_id: kernel.currentBranch });
    const features = state.features as Record<string, Record<string, unknown>> | undefined;
    if (!features || Object.keys(features).length === 0) {
      return JSON.stringify([], null, 2);
    }

    let filterGenusId: string | undefined;
    if (feature_genus) {
      filterGenusId = resolveFeatureGenusId(feature_genus);
    }

    const result: any[] = [];
    for (const [fId, fState] of Object.entries(features)) {
      if (filterGenusId && fState.genus_id !== filterGenusId) continue;
      const fDef = getGenusDef(kernel, fState.genus_id as string);
      const { genus_id: _, ...attrs } = fState;
      result.push({
        feature_id: fId,
        genus: fDef.meta.name,
        ...attrs,
      });
    }

    return JSON.stringify(result, null, 2);
  },
});

mcp.tool("define_relationship_genus", {
  description: "Define a new relationship genus that links entities together with typed roles (e.g., 'Supply' linking Supplier to Product). Requires at least 2 roles.",
  input: {
    type: "object",
    properties: {
      name: { type: "string", description: "Name for the new relationship genus" },
      description: { type: "string", description: "Optional description of the relationship genus" },
      taxonomy: { type: "string", description: "Taxonomy name or ID (defaults to Default taxonomy)" },
      roles: {
        type: "array",
        description: "Role definitions (at least 2 required). Each role defines one end of the relationship.",
        items: {
          type: "object",
          properties: {
            name: { type: "string", description: "Role name (e.g., 'supplier', 'product')" },
            valid_member_genera: {
              type: "array",
              items: { type: "string" },
              description: "Entity genus names. Omit or leave empty for unconstrained (any genus).",
            },
            cardinality: {
              type: "string",
              enum: ["one", "one_or_more", "zero_or_more"],
              description: "How many entities can fill this role",
            },
          },
          required: ["name", "cardinality"],
        },
      },
      attributes: {
        type: "array",
        description: "Attribute definitions for relationships of this genus",
        items: {
          type: "object",
          properties: {
            name: { type: "string", description: "Attribute name" },
            type: { type: "string", description: "Attribute type: text, number, boolean, or filetree" },
            required: { type: "boolean", description: "Whether the attribute is required (default false)" },
            default_value: { description: "Default value for the attribute" },
          },
          required: ["name", "type"],
        },
      },
      states: {
        type: "array",
        description: "State definitions for the relationship state machine",
        items: {
          type: "object",
          properties: {
            name: { type: "string", description: "State name" },
            initial: { type: "boolean", description: "Whether this is the initial state (exactly one required)" },
          },
          required: ["name"],
        },
      },
      transitions: {
        type: "array",
        description: "Transitions between relationship states",
        items: {
          type: "object",
          properties: {
            from: { type: "string", description: "Source state name" },
            to: { type: "string", description: "Target state name" },
            name: { type: "string", description: "Optional transition name" },
          },
          required: ["from", "to"],
        },
      },
    },
    required: ["name", "roles"],
  },
  handler: async ({ name, description, taxonomy, roles, attributes, states, transitions }: {
    name: string;
    description?: string;
    taxonomy?: string;
    roles: { name: string; valid_member_genera?: string[]; cardinality: string }[];
    attributes?: { name: string; type: string; required?: boolean; default_value?: unknown }[];
    states?: { name: string; initial?: boolean }[];
    transitions?: { from: string; to: string; name?: string }[];
  }) => {
    // Check name uniqueness
    const existing = listRelationshipGenera(kernel);
    if (existing.some((g) => g.name.toLowerCase() === name.toLowerCase())) {
      throw new Error(`Relationship genus "${name}" already exists`);
    }

    // Validate at least 2 roles
    if (roles.length < 2) {
      throw new Error("Relationship genus must have at least 2 roles");
    }

    // Validate no duplicate role names
    const seenRoles = new Set<string>();
    for (const role of roles) {
      const lower = role.name.toLowerCase();
      if (seenRoles.has(lower)) {
        throw new Error(`Duplicate role name: "${role.name}"`);
      }
      seenRoles.add(lower);
    }

    // Validate cardinality values
    const VALID_CARDINALITIES = ["one", "one_or_more", "zero_or_more"];
    for (const role of roles) {
      if (!VALID_CARDINALITIES.includes(role.cardinality)) {
        throw new Error(`Invalid cardinality "${role.cardinality}" for role "${role.name}". Valid values: ${VALID_CARDINALITIES.join(", ")}`);
      }
    }

    // Validate valid_member_genera — each must be an existing entity genus
    for (const role of roles) {
      for (const genusName of (role.valid_member_genera ?? [])) {
        const genusId = resolveGenusId(genusName);
        const def = getGenusDef(kernel, genusId);
        if (def.meta.kind) {
          throw new Error(`Role "${role.name}" references "${genusName}" which is a ${def.meta.kind} genus, not an entity genus`);
        }
      }
    }

    if (attributes) validateAttributes(attributes);
    if (transitions && !states) {
      throw new Error("Cannot define transitions without states");
    }
    if (states) validateStateMachine(states, transitions ?? []);

    const taxonomy_id = taxonomy ? resolveTaxonomyId(taxonomy) : DEFAULT_TAXONOMY_ID;
    const meta: Record<string, unknown> = {};
    if (description) meta.description = description;

    const genusId = defineRelationshipGenus(kernel, name, {
      roles: roles.map((r) => ({
        name: r.name,
        valid_member_genera: r.valid_member_genera ?? [],
        cardinality: r.cardinality as "one" | "one_or_more" | "zero_or_more",
      })),
      attributes: attributes as any,
      states: states?.map((s) => ({ name: s.name, initial: s.initial ?? false })),
      transitions,
      meta,
      taxonomy_id,
    });

    const def = getGenusDef(kernel, genusId);
    return JSON.stringify({ genus_id: genusId, name, definition: def }, null, 2);
  },
});

mcp.tool("list_relationship_genera", {
  description: "List all defined relationship genera with their roles, attributes, states, and transitions. Optionally filter by taxonomy.",
  input: {
    type: "object",
    properties: {
      taxonomy: { type: "string", description: "Optional taxonomy name or ID to filter by" },
    },
  },
  handler: async ({ taxonomy }: { taxonomy?: string }) => {
    const taxonomy_id = taxonomy ? resolveTaxonomyId(taxonomy) : undefined;
    const genera = listRelationshipGenera(kernel, taxonomy_id ? { taxonomy_id } : undefined);
    const result = genera.map((g) => ({
      id: g.id,
      name: g.name,
      roles: Object.values(g.def.roles).map((r) => ({
        name: r.name,
        valid_member_genera: r.valid_member_genera,
        cardinality: r.cardinality,
      })),
      attributes: Object.values(g.def.attributes).map((a) => ({
        name: a.name,
        type: a.type,
        required: a.required,
      })),
      states: Object.values(g.def.states).map((s) => ({
        name: s.name,
        initial: s.initial,
      })),
      transitions: g.def.transitions.map((t) => ({
        from: t.from,
        to: t.to,
      })),
    }));
    return JSON.stringify(result, null, 2);
  },
});

mcp.tool("create_relationship", {
  description: "Create a relationship linking entities together with typed roles. Validates member genera and cardinality constraints.",
  input: {
    type: "object",
    properties: {
      genus: { type: "string", description: "Relationship genus name (e.g., 'Assignment')" },
      members: {
        type: "object",
        description: "Role-to-entity_id mapping (e.g., { artist: 'entity_id', content: 'entity_id' })",
        additionalProperties: { type: "string" },
      },
      attributes: {
        type: "object",
        description: "Optional initial attributes",
        additionalProperties: true,
      },
    },
    required: ["genus", "members"],
  },
  handler: async ({ genus, members, attributes }: { genus: string; members: Record<string, string>; attributes?: Record<string, unknown> }) => {
    _requireWorkspace();
    const genusId = resolveRelationshipGenusId(genus);
    const relId = createRelationship(kernel, genusId, members, { attributes });
    const state = materialize(kernel, relId, { branch_id: kernel.currentBranch });
    const genusDef = getGenusDef(kernel, genusId);
    return JSON.stringify({
      id: relId,
      genus: genusDef.meta.name,
      state,
    }, null, 2);
  },
});

mcp.tool("create_relationships", {
  description: "Create multiple relationships in one call. Loops over existing createRelationship logic. Returns all created relationship summaries.",
  input: {
    type: "object",
    properties: {
      relationships: {
        type: "array",
        description: "Array of relationships to create",
        items: {
          type: "object",
          properties: {
            genus: { type: "string", description: "Relationship genus name (e.g., 'Assignment')" },
            members: {
              type: "object",
              description: "Role-to-entity_id mapping",
              additionalProperties: { type: "string" },
            },
            attributes: {
              type: "object",
              description: "Optional initial attributes",
              additionalProperties: true,
            },
          },
          required: ["genus", "members"],
        },
      },
    },
    required: ["relationships"],
  },
  handler: async ({ relationships }: { relationships: { genus: string; members: Record<string, string>; attributes?: Record<string, unknown> }[] }) => {
    _requireWorkspace();
    const created: { id: string; genus: string; state: Record<string, unknown> }[] = [];

    for (const entry of relationships) {
      const genusId = resolveRelationshipGenusId(entry.genus);
      const relId = createRelationship(kernel, genusId, entry.members, { attributes: entry.attributes });
      const state = materialize(kernel, relId, { branch_id: kernel.currentBranch });
      const genusDef = getGenusDef(kernel, genusId);
      created.push({ id: relId, genus: (genusDef.meta.name as string) ?? "", state });
    }

    return JSON.stringify({ created, total: created.length }, null, 2);
  },
});

mcp.tool("get_relationship", {
  description: "Get full details for a single relationship including members, state, and genus info.",
  input: {
    type: "object",
    properties: {
      relationship_id: { type: "string", description: "Relationship ID" },
    },
    required: ["relationship_id"],
  },
  handler: async ({ relationship_id }: { relationship_id: string }) => {
    const res = getRes(kernel, relationship_id);
    const state = materialize(kernel, relationship_id, { branch_id: kernel.currentBranch });
    const genusDef = getGenusDef(kernel, res.genus_id);

    // Enrich members with entity details
    const members = (state.members as Record<string, string[]>) ?? {};
    const enrichedMembers: Record<string, any[]> = {};
    for (const [roleName, memberIds] of Object.entries(members)) {
      enrichedMembers[roleName] = memberIds.map((mid) => {
        try {
          const mRes = getRes(kernel, mid);
          const mState = materialize(kernel, mid, { branch_id: kernel.currentBranch });
          const mDef = getGenusDef(kernel, mRes.genus_id);
          return { id: mid, genus: mDef.meta.name, state: mState };
        } catch {
          return { id: mid };
        }
      });
    }

    const currentStatus = state.status as string | undefined;
    let availableTransitions: { target: string; name?: string }[] = [];
    if (currentStatus) {
      availableTransitions = genusDef.transitions
        .filter((t) => t.from === currentStatus)
        .map((t) => ({ target: t.to, ...(t.name ? { name: t.name } : {}) }));
    }

    return JSON.stringify({
      id: relationship_id,
      genus_id: res.genus_id,
      genus: genusDef.meta.name,
      created_at: res.created_at,
      state,
      members: enrichedMembers,
      available_transitions: availableTransitions,
    }, null, 2);
  },
});

mcp.tool("get_relationships", {
  description: "List relationships an entity participates in, optionally filtered by relationship genus or role.",
  input: {
    type: "object",
    properties: {
      entity_id: { type: "string", description: "Entity ID" },
      genus: { type: "string", description: "Relationship genus name to filter by" },
      role: { type: "string", description: "Role name to filter by" },
    },
    required: ["entity_id"],
  },
  handler: async ({ entity_id, genus, role }: { entity_id: string; genus?: string; role?: string }) => {
    let genusId: string | undefined;
    if (genus) {
      genusId = resolveRelationshipGenusId(genus);
    }

    const rels = getRelationshipsForEntity(kernel, entity_id, { genus_id: genusId, role });
    const result = rels.map((rel) => {
      // Enrich members
      const enrichedMembers: Record<string, any[]> = {};
      for (const [roleName, memberIds] of Object.entries(rel.members)) {
        enrichedMembers[roleName] = memberIds.map((mid) => {
          if (mid === entity_id) return { id: mid, note: "(this entity)" };
          try {
            const mRes = getRes(kernel, mid);
            const mState = materialize(kernel, mid, { branch_id: kernel.currentBranch });
            const mDef = getGenusDef(kernel, mRes.genus_id);
            return { id: mid, genus: mDef.meta.name, state: mState };
          } catch {
            return { id: mid };
          }
        });
      }
      return {
        relationship_id: rel.id,
        genus: rel.genus_name,
        members: enrichedMembers,
        status: rel.state.status,
      };
    });
    return JSON.stringify(result, null, 2);
  },
});

mcp.tool("list_relationships", {
  description: "List relationships, optionally filtered by genus, member entity, role, or status. Use compact=true for id/name members only.",
  input: {
    type: "object",
    properties: {
      genus: { type: "string", description: "Relationship genus name to filter by" },
      member_entity_id: { type: "string", description: "Filter to relationships involving this entity" },
      member_role: { type: "string", description: "Filter by role name" },
      status: { type: "string", description: "Filter by relationship status" },
      limit: { type: "number", description: "Max relationships to return" },
      compact: { type: "boolean", description: "Return compact members (id/name only, default: false)" },
    },
  },
  handler: async ({ genus, member_entity_id, member_role, status, limit, compact }: { genus?: string; member_entity_id?: string; member_role?: string; status?: string; limit?: number; compact?: boolean }) => {
    let genusId: string | undefined;
    if (genus) {
      genusId = resolveRelationshipGenusId(genus);
    }

    const rels = listRelationships(kernel, {
      genus_id: genusId,
      member_entity_id,
      member_role,
      status,
      limit,
    });

    const result = rels.map((rel) => {
      const enrichedMembers: Record<string, any[]> = {};
      for (const [roleName, memberIds] of Object.entries(rel.members)) {
        enrichedMembers[roleName] = memberIds.map((mid) => {
          try {
            if (compact) {
              const mState = materialize(kernel, mid, { branch_id: kernel.currentBranch });
              return { id: mid, name: (mState.name as string) ?? (mState.title as string) ?? mid };
            }
            const mRes = getRes(kernel, mid);
            const mState = materialize(kernel, mid, { branch_id: kernel.currentBranch });
            const mDef = getGenusDef(kernel, mRes.genus_id);
            return { id: mid, genus: mDef.meta.name, state: mState };
          } catch {
            return { id: mid };
          }
        });
      }
      return {
        relationship_id: rel.id,
        genus: rel.genus_name,
        members: enrichedMembers,
        status: rel.state.status,
      };
    });

    return JSON.stringify({ relationships: result, ..._workspaceContext() }, null, 2);
  },
});

mcp.tool("search_entities", {
  description: "Search entities by content across all string attributes. Case-insensitive substring match. Returns matching entities with which attributes matched.",
  input: {
    type: "object",
    properties: {
      query: { type: "string", description: "Search query (case-insensitive substring match)" },
      genus: { type: "string", description: "Optional genus name to restrict search" },
      limit: { type: "number", description: "Max results to return" },
      all_workspaces: { type: "boolean", description: "Search across all workspaces (default false)" },
    },
    required: ["query"],
  },
  handler: async ({ query, genus, limit, all_workspaces }: { query: string; genus?: string; limit?: number; all_workspaces?: boolean }) => {
    let genusId: string | undefined;
    if (genus) {
      genusId = resolveGenusId(genus);
    }

    const results = searchEntities(kernel, { query, genus_id: genusId, limit, all_workspaces });

    return JSON.stringify({
      query,
      results: results.map((r) => ({
        id: r.id,
        genus: r.genus_name,
        state: r.state,
        matched_attributes: r.matched_attributes,
      })),
      total: results.length,
      ..._workspaceContext(),
    }, null, 2);
  },
});

mcp.tool("evolve_genus", {
  description: "Idempotent additive genus evolution. Adds new attributes, states, or transitions to an existing genus without removing or modifying existing definitions.",
  input: {
    type: "object",
    properties: {
      genus: { type: "string", description: "Genus name or ID to evolve" },
      attributes: {
        type: "array",
        description: "New attributes to add",
        items: {
          type: "object",
          properties: {
            name: { type: "string" },
            type: { type: "string", enum: ["text", "number", "boolean"] },
            required: { type: "boolean" },
          },
          required: ["name", "type"],
        },
      },
      states: {
        type: "array",
        description: "New states to add",
        items: {
          type: "object",
          properties: {
            name: { type: "string" },
            initial: { type: "boolean" },
          },
          required: ["name"],
        },
      },
      transitions: {
        type: "array",
        description: "New transitions to add",
        items: {
          type: "object",
          properties: {
            from: { type: "string" },
            to: { type: "string" },
          },
          required: ["from", "to"],
        },
      },
      roles: {
        type: "array",
        description: "New or updated roles (relationship genera only). Existing roles get valid_member_genera merged (union). New roles are added.",
        items: {
          type: "object",
          properties: {
            name: { type: "string", description: "Role name" },
            valid_member_genera: {
              type: "array",
              items: { type: "string" },
              description: "Entity genus names. Omit or leave empty for unconstrained (any genus).",
            },
            cardinality: {
              type: "string",
              enum: ["one", "one_or_more", "zero_or_more"],
              description: "How many entities can fill this role",
            },
          },
          required: ["name", "cardinality"],
        },
      },
      templates: {
        type: "object",
        description: "Render templates for palace v2 (mention/glance/inspect). Use {{name}}, {{status}}, {{any_attr}}, {{genus_name}}, {{id}} placeholders.",
        properties: {
          mention: { type: "string", description: "Short inline text for room descriptions" },
          glance: { type: "string", description: "Brief summary for 'look' verb" },
          inspect: { type: "string", description: "Full detail for 'examine' verb" },
        },
      },
    },
    required: ["genus"],
  },
  handler: async ({ genus, attributes, states, transitions, roles, templates }: {
    genus: string;
    attributes?: { name: string; type: "text" | "number" | "boolean"; required?: boolean }[];
    states?: { name: string; initial?: boolean }[];
    transitions?: { from: string; to: string }[];
    roles?: { name: string; valid_member_genera?: string[]; cardinality: string }[];
    templates?: { mention?: string; glance?: string; inspect?: string };
  }) => {
    // Validate role genera references if provided
    if (roles) {
      for (const role of roles) {
        for (const genusName of (role.valid_member_genera ?? [])) {
          const gId = resolveGenusId(genusName);
          const gDef = getGenusDef(kernel, gId);
          if (gDef.meta.kind) {
            throw new Error(`Role "${role.name}" references "${genusName}" which is a ${gDef.meta.kind} genus, not an entity genus`);
          }
        }
      }
    }
    const genusId = resolveGenusId(genus);
    evolveGenus(kernel, genusId, {
      attributes: attributes?.map((a) => ({
        name: a.name,
        type: a.type,
        required: a.required ?? false,
      })),
      states: states?.map((s) => ({
        name: s.name,
        initial: s.initial ?? false,
      })),
      transitions,
      roles: roles?.map((r) => ({
        name: r.name,
        valid_member_genera: r.valid_member_genera ?? [],
        cardinality: r.cardinality as "one" | "one_or_more" | "zero_or_more",
      })),
    });
    if (templates) {
      for (const [level, tmpl] of Object.entries(templates)) {
        if (tmpl) setGenusTemplate(kernel, genusId, level as "mention" | "glance" | "inspect", tmpl);
      }
    }
    const def = getGenusDef(kernel, genusId);
    const genusTemplates = getGenusTemplates(kernel, genusId);
    return JSON.stringify({
      genus_id: genusId,
      genus: def.meta.name,
      attributes: Object.values(def.attributes).map((a) => ({
        name: a.name, type: a.type, required: a.required,
      })),
      states: Object.values(def.states).map((s) => ({
        name: s.name, initial: s.initial,
      })),
      transitions: def.transitions.map((t) => ({ from: t.from, to: t.to })),
      ...(def.meta.kind === "relationship" ? {
        roles: Object.values(def.roles).map((r) => ({
          name: r.name, valid_member_genera: r.valid_member_genera, cardinality: r.cardinality,
        })),
      } : {}),
      ...(Object.values(genusTemplates).some(Boolean) ? { templates: genusTemplates } : {}),
    }, null, 2);
  },
});

mcp.tool("get_health", {
  description: "Get a health report for a single entity. Checks required attributes, attribute types, status validity, and unacknowledged errors.",
  input: {
    type: "object",
    properties: {
      entity_id: { type: "string", description: "Entity ID to evaluate" },
    },
    required: ["entity_id"],
  },
  handler: async ({ entity_id }: { entity_id: string }) => {
    const report = evaluateHealth(kernel, entity_id);
    return JSON.stringify(report, null, 2);
  },
});

mcp.tool("list_unhealthy", {
  description: "List all unhealthy entities with their health issues. Optionally filter by genus.",
  input: {
    type: "object",
    properties: {
      genus: { type: "string", description: "Genus name or ID to filter by" },
    },
  },
  handler: async ({ genus }: { genus?: string }) => {
    let genusId: string | undefined;
    if (genus) {
      genusId = resolveGenusId(genus);
    }
    const reports = listUnhealthy(kernel, {
      ...(genusId ? { genus_id: genusId } : {}),
      only_workspace: !!kernel.currentWorkspace,
    });
    return JSON.stringify({ entities: reports, ..._workspaceContext() }, null, 2);
  },
});

mcp.tool("acknowledge_error", {
  description: "Acknowledge an error, transitioning it from 'open' to 'acknowledged' status.",
  input: {
    type: "object",
    properties: {
      error_id: { type: "string", description: "Error entity ID to acknowledge" },
    },
    required: ["error_id"],
  },
  handler: async ({ error_id }: { error_id: string }) => {
    _requireWorkspace();
    acknowledgeError(kernel, error_id);
    const state = materialize(kernel, error_id, { branch_id: kernel.currentBranch });
    return JSON.stringify({ id: error_id, state }, null, 2);
  },
});

mcp.tool("list_errors", {
  description: "List error entities, optionally filtered by associated entity or status.",
  input: {
    type: "object",
    properties: {
      entity_id: { type: "string", description: "Filter by associated entity ID" },
      status: { type: "string", description: "Filter by status ('open' or 'acknowledged')" },
    },
  },
  handler: async ({ entity_id, status }: { entity_id?: string; status?: string }) => {
    const errors = listErrors(kernel, {
      associated_res_id: entity_id,
      status,
    });
    return JSON.stringify({ errors, ..._workspaceContext() }, null, 2);
  },
});

mcp.tool("create_task", {
  description: "Create a task (work item) optionally associated with an entity. Tasks can be claimed and completed by humans or LLMs.",
  input: {
    type: "object",
    properties: {
      title: { type: "string", description: "Short description of the task" },
      description: { type: "string", description: "Detailed instructions" },
      entity_id: { type: "string", description: "Primary entity this task relates to" },
      priority: { type: "string", description: "low, normal, high, or urgent (default: normal)", enum: ["low", "normal", "high", "urgent"] },
      target_agent_type: { type: "string", description: "human, llm, or either (default: either)", enum: ["human", "llm", "either"] },
    },
    required: ["title"],
  },
  handler: async ({ title, description, entity_id, priority, target_agent_type }: {
    title: string; description?: string; entity_id?: string; priority?: string; target_agent_type?: string;
  }) => {
    _requireWorkspace();
    const taskId = createTask(kernel, title, {
      description,
      associated_res_id: entity_id,
      priority,
      target_agent_type,
    });
    const state = materialize(kernel, taskId, { branch_id: kernel.currentBranch });
    return JSON.stringify({ id: taskId, state }, null, 2);
  },
});

mcp.tool("list_tasks", {
  description: "List tasks with optional filters. Returns task summaries including status, priority, and associations.",
  input: {
    type: "object",
    properties: {
      status: { type: "string", description: "Filter by status (pending, claimed, completed, cancelled)" },
      entity_id: { type: "string", description: "Filter by associated entity ID" },
      priority: { type: "string", description: "Filter by priority (low, normal, high, urgent)" },
      target_agent_type: { type: "string", description: "Filter by target agent type (human, llm, either)" },
      process_id: { type: "string", description: "Filter by process instance ID" },
    },
  },
  handler: async ({ status, entity_id, priority, target_agent_type, process_id }: {
    status?: string; entity_id?: string; priority?: string; target_agent_type?: string; process_id?: string;
  }) => {
    const tasks = listTasks(kernel, {
      status,
      associated_res_id: entity_id,
      priority,
      target_agent_type,
      process_id,
      only_workspace: !!kernel.currentWorkspace,
    });
    return JSON.stringify({ tasks, ..._workspaceContext() }, null, 2);
  },
});

mcp.tool("get_task", {
  description: "Get full details for a single task including materialized context entities.",
  input: {
    type: "object",
    properties: {
      task_id: { type: "string", description: "Task entity ID" },
    },
    required: ["task_id"],
  },
  handler: async ({ task_id }: { task_id: string }) => {
    const res = getRes(kernel, task_id);
    const state = materialize(kernel, task_id, { branch_id: kernel.currentBranch });

    // Enrich associated entity if present
    let associated_entity: any = undefined;
    const associatedResId = state.associated_res_id as string | undefined;
    if (associatedResId) {
      try {
        const aRes = getRes(kernel, associatedResId);
        const aState = materialize(kernel, associatedResId, { branch_id: kernel.currentBranch });
        const aDef = getGenusDef(kernel, aRes.genus_id);
        associated_entity = { id: associatedResId, genus: aDef.meta.name, state: aState };
      } catch {
        associated_entity = { id: associatedResId, error: "not found" };
      }
    }

    // Enrich context entities if present
    const contextRaw = state.context_res_ids as string | undefined;
    let context_entities: any[] | undefined;
    if (contextRaw) {
      try {
        const ids: string[] = JSON.parse(contextRaw);
        context_entities = ids.map((id) => {
          try {
            const cRes = getRes(kernel, id);
            const cState = materialize(kernel, id, { branch_id: kernel.currentBranch });
            const cDef = getGenusDef(kernel, cRes.genus_id);
            return { id, genus: cDef.meta.name, state: cState };
          } catch {
            return { id, error: "not found" };
          }
        });
      } catch {}
    }

    return JSON.stringify({
      id: task_id,
      genus_id: res.genus_id,
      created_at: res.created_at,
      state,
      ...(associated_entity ? { associated_entity } : {}),
      ...(context_entities ? { context_entities } : {}),
    }, null, 2);
  },
});

mcp.tool("complete_task", {
  description: "Complete a task with an optional result. Works from both 'pending' and 'claimed' status. If the task is part of a process, completing it auto-advances the process.",
  input: {
    type: "object",
    properties: {
      task_id: { type: "string", description: "Task entity ID" },
      result: { type: "string", description: "Completion result or notes" },
    },
    required: ["task_id"],
  },
  handler: async ({ task_id, result }: { task_id: string; result?: string }) => {
    _requireWorkspace();
    completeTask(kernel, task_id, result);
    const state = materialize(kernel, task_id, { branch_id: kernel.currentBranch });
    return JSON.stringify({ id: task_id, state }, null, 2);
  },
});

mcp.tool("start_process", {
  description: "Start a new process instance from a process genus. Creates tasks for initial steps and begins auto-advancing.",
  input: {
    type: "object",
    properties: {
      process: { type: "string", description: "Process genus name or ID (e.g., 'Publication')" },
      context_entity_id: { type: "string", description: "Optional entity ID that this process operates on" },
    },
    required: ["process"],
  },
  handler: async ({ process, context_entity_id }: { process: string; context_entity_id?: string }) => {
    _requireWorkspace();
    const genusId = resolveProcessGenusId(process);
    const { id, state } = startProcess(kernel, genusId, { context_res_id: context_entity_id });
    const def = getProcessDef(kernel, genusId);

    // Enrich steps with definition info
    const enrichedSteps: Record<string, any> = {};
    for (const [name, stepStatus] of Object.entries(state.steps)) {
      const stepDef = def.steps[name];
      enrichedSteps[name] = {
        ...stepStatus,
        ...(stepDef ? { lane: stepDef.lane, type: stepDef.type, position: stepDef.position } : {}),
      };
    }

    return JSON.stringify({
      id,
      process_name: def.meta.name,
      status: state.status,
      context_res_id: state.context_res_id,
      started_at: state.started_at,
      steps: enrichedSteps,
    }, null, 2);
  },
});

mcp.tool("get_process_status", {
  description: "Get the current status of a process instance, including all step statuses enriched with lane/type/position from the definition.",
  input: {
    type: "object",
    properties: {
      process_id: { type: "string", description: "Process instance ID" },
    },
    required: ["process_id"],
  },
  handler: async ({ process_id }: { process_id: string }) => {
    const state = getProcessStatus(kernel, process_id);
    const def = getProcessDef(kernel, state.process_genus_id);

    // Enrich steps
    const enrichedSteps: Record<string, any> = {};
    for (const [name, stepStatus] of Object.entries(state.steps)) {
      const stepDef = def.steps[name];
      enrichedSteps[name] = {
        ...stepStatus,
        ...(stepDef ? { lane: stepDef.lane, type: stepDef.type, position: stepDef.position } : {}),
      };
    }

    // Add pending steps from definition that haven't started
    for (const [name, stepDef] of Object.entries(def.steps)) {
      if (!enrichedSteps[name]) {
        enrichedSteps[name] = {
          step_name: name,
          status: "pending",
          lane: stepDef.lane,
          type: stepDef.type,
          position: stepDef.position,
        };
      }
    }

    return JSON.stringify({
      id: process_id,
      process_name: def.meta.name,
      process_genus_id: state.process_genus_id,
      status: state.status,
      context_res_id: state.context_res_id,
      started_at: state.started_at,
      completed_at: state.completed_at,
      steps: enrichedSteps,
    }, null, 2);
  },
});

mcp.tool("list_processes", {
  description: "List process instances with optional filters. Excludes completed/cancelled/failed processes by default — set include_finished to see them.",
  input: {
    type: "object",
    properties: {
      process: { type: "string", description: "Process genus name or ID to filter by" },
      status: { type: "string", description: "Filter by status (running, completed, failed, cancelled)" },
      context_entity_id: { type: "string", description: "Filter by context entity ID" },
      include_finished: { type: "boolean", description: "Include completed/cancelled/failed processes (default false)" },
    },
  },
  handler: async ({ process, status, context_entity_id, include_finished }: { process?: string; status?: string; context_entity_id?: string; include_finished?: boolean }) => {
    let genusId: string | undefined;
    if (process) {
      genusId = resolveProcessGenusId(process);
    }
    const processes = listProcesses(kernel, {
      genus_id: genusId,
      status,
      context_res_id: context_entity_id,
      include_finished,
      only_workspace: !!kernel.currentWorkspace,
    });
    return JSON.stringify({ processes, ..._workspaceContext() }, null, 2);
  },
});

// --- Cron schedule tools ---

mcp.tool("create_cron_schedule", {
  description: "Create a cron schedule that fires an action or process on a recurring basis. Supports standard 5-field cron expressions and aliases (@daily, @hourly, @weekly, @monthly).",
  input: {
    type: "object",
    properties: {
      name: { type: "string", description: "Schedule name" },
      expression: { type: "string", description: "Cron expression (e.g. '*/5 * * * *', '@daily')" },
      target_type: { type: "string", description: "What to fire: 'action' or 'process'", enum: ["action", "process"] },
      target_genus: { type: "string", description: "Action or process genus name or ID" },
      target_config: { type: "string", description: "Optional JSON config: { resource_bindings, params } for actions, { context_res_id } for processes" },
    },
    required: ["name", "expression", "target_type", "target_genus"],
  },
  handler: async ({ name, expression, target_type, target_genus, target_config }: {
    name: string; expression: string; target_type: "action" | "process"; target_genus: string; target_config?: string;
  }) => {
    _requireWorkspace();
    const target_genus_id = target_type === "process"
      ? resolveProcessGenusId(target_genus)
      : resolveGenusId(target_genus);
    const id = createCronSchedule(kernel, {
      name,
      expression,
      target_type,
      target_genus_id,
      target_config,
    });
    const state = materialize(kernel, id, { branch_id: kernel.currentBranch });
    return JSON.stringify({ id, name, expression, target_type, target_genus_id, status: state.status }, null, 2);
  },
});

mcp.tool("list_cron_schedules", {
  description: "List all cron schedules with their status, expression, and last fire time.",
  input: { type: "object", properties: {} },
  handler: async () => {
    const schedules = listCronSchedules(kernel);
    return JSON.stringify({ schedules, ..._workspaceContext() }, null, 2);
  },
});

mcp.tool("pause_cron", {
  description: "Pause an active cron schedule. Paused schedules are skipped during tick.",
  input: {
    type: "object",
    properties: {
      schedule: { type: "string", description: "Schedule name or ID" },
    },
    required: ["schedule"],
  },
  handler: async ({ schedule }: { schedule: string }) => {
    _requireWorkspace();
    const id = resolveCronScheduleId(schedule);
    transitionStatus(kernel, id, "paused");
    const state = materialize(kernel, id, { branch_id: kernel.currentBranch });
    return JSON.stringify({ id, name: state.name, status: "paused" }, null, 2);
  },
});

mcp.tool("resume_cron", {
  description: "Resume a paused cron schedule.",
  input: {
    type: "object",
    properties: {
      schedule: { type: "string", description: "Schedule name or ID" },
    },
    required: ["schedule"],
  },
  handler: async ({ schedule }: { schedule: string }) => {
    _requireWorkspace();
    const id = resolveCronScheduleId(schedule);
    transitionStatus(kernel, id, "active");
    const state = materialize(kernel, id, { branch_id: kernel.currentBranch });
    return JSON.stringify({ id, name: state.name, status: "active" }, null, 2);
  },
});

mcp.tool("trigger_cron", {
  description: "Manually fire a cron schedule immediately, regardless of its status or expression. Returns the action/process result.",
  input: {
    type: "object",
    properties: {
      schedule: { type: "string", description: "Schedule name or ID" },
    },
    required: ["schedule"],
  },
  handler: async ({ schedule }: { schedule: string }) => {
    _requireWorkspace();
    const id = resolveCronScheduleId(schedule);
    const result = fireCronSchedule(kernel, id);
    return JSON.stringify(result, null, 2);
  },
});

mcp.tool("schedule_trigger", {
  description: "Schedule a one-time trigger to fire an action or process at a specific future time. Provide either scheduled_at (ISO timestamp) or delay (e.g. '90m', '2h', '1d'). The trigger auto-retires after firing.",
  input: {
    type: "object",
    properties: {
      name: { type: "string", description: "Trigger name" },
      target_type: { type: "string", description: "What to fire: 'action' or 'process'", enum: ["action", "process"] },
      target_genus: { type: "string", description: "Action or process genus name or ID" },
      scheduled_at: { type: "string", description: "ISO 8601 timestamp for when to fire (e.g. '2025-03-15T15:00:00Z')" },
      delay: { type: "string", description: "Human-readable delay from now (e.g. '30s', '90m', '2h', '1d')" },
      target_config: { type: "string", description: "Optional JSON config: { resource_bindings, params } for actions, { context_res_id } for processes" },
    },
    required: ["name", "target_type", "target_genus"],
  },
  handler: async ({ name, target_type, target_genus, scheduled_at, delay, target_config }: {
    name: string; target_type: "action" | "process"; target_genus: string; scheduled_at?: string; delay?: string; target_config?: string;
  }) => {
    _requireWorkspace();
    if (!scheduled_at && !delay) {
      throw new Error("Either scheduled_at or delay must be provided");
    }
    const resolvedAt = scheduled_at ?? new Date(Date.now() + parseDelay(delay!)).toISOString();
    const target_genus_id = target_type === "process"
      ? resolveProcessGenusId(target_genus)
      : resolveGenusId(target_genus);
    const id = createScheduledTrigger(kernel, {
      name,
      scheduled_at: resolvedAt,
      target_type,
      target_genus_id,
      target_config,
    });
    const state = materialize(kernel, id, { branch_id: kernel.currentBranch });
    return JSON.stringify({ id, name, scheduled_at: resolvedAt, target_type, target_genus_id, status: state.status }, null, 2);
  },
});

mcp.tool("create_branch", {
  description: "Create a new branch for isolated changes. Changes on a branch don't affect the parent until merged. Automatically switches to the new branch.",
  input: {
    type: "object",
    properties: {
      name: { type: "string", description: "Branch name (must be unique)" },
      parent: { type: "string", description: "Parent branch name (default: current branch)" },
      switch_to: { type: "boolean", description: "Auto-switch to new branch (default: true)" },
    },
    required: ["name"],
  },
  handler: async ({ name, parent, switch_to }: { name: string; parent?: string; switch_to?: boolean }) => {
    const ctx = _getSessionContext();
    kernel.currentBranch = ctx.current_branch;
    const branch = createBranch(kernel, name, parent);
    if (switch_to !== false) {
      switchBranch(kernel, name);
      ctx.current_branch = kernel.currentBranch;
      // Reset palace navigation — current room may not exist on new branch
      ctx.palace_current_slug = null;
      ctx.palace_action_menu = null;
      ctx.palace_nav_history = [];
    }
    return JSON.stringify({ ...branch, current_branch: kernel.currentBranch }, null, 2);
  },
});

mcp.tool("switch_branch", {
  description: "Switch to a different branch. All subsequent entity operations will use this branch.",
  input: {
    type: "object",
    properties: {
      name: { type: "string", description: "Branch name to switch to ('main' for default)" },
    },
    required: ["name"],
  },
  handler: async ({ name }: { name: string }) => {
    switchBranch(kernel, name);
    const ctx = _getSessionContext();
    ctx.current_branch = kernel.currentBranch;
    // Reset palace navigation — current room may not exist on new branch
    ctx.palace_current_slug = null;
    ctx.palace_action_menu = null;
    ctx.palace_nav_history = [];
    return JSON.stringify({ current_branch: kernel.currentBranch }, null, 2);
  },
});

mcp.tool("list_branches", {
  description: "List all branches with their status. Shows current session branch.",
  input: { type: "object", properties: {} },
  handler: async () => {
    const ctx = _getSessionContext();
    const branches = listBranches(kernel);
    return JSON.stringify({
      current_branch: ctx.current_branch,
      branches,
    }, null, 2);
  },
});

mcp.tool("merge_branch", {
  description: "Merge a source branch into a target branch. Detects conflicts unless force is true.",
  input: {
    type: "object",
    properties: {
      source: { type: "string", description: "Source branch name to merge from" },
      target: { type: "string", description: "Target branch name to merge into (default: main)" },
      force: { type: "boolean", description: "Force merge even with conflicts (default: false)" },
    },
    required: ["source"],
  },
  handler: async ({ source, target, force }: { source: string; target?: string; force?: boolean }) => {
    const result = mergeBranch(kernel, source, target, { force });
    return JSON.stringify(result, null, 2);
  },
});

mcp.tool("compare_branches", {
  description: "Compare the materialized state of an entity across two branches.",
  input: {
    type: "object",
    properties: {
      entity_id: { type: "string", description: "Entity ID to compare" },
      branch_a: { type: "string", description: "First branch name" },
      branch_b: { type: "string", description: "Second branch name" },
    },
    required: ["entity_id", "branch_a", "branch_b"],
  },
  handler: async ({ entity_id, branch_a, branch_b }: { entity_id: string; branch_a: string; branch_b: string }) => {
    const result = compareBranches(kernel, entity_id, branch_a, branch_b);
    return JSON.stringify(result, null, 2);
  },
});

mcp.tool("define_process_genus", {
  description: "Define a new process genus — a multi-lane workflow with steps (tasks, gates, actions, fetches). Steps are nested inside lanes; position is implicit from array order.",
  input: {
    type: "object",
    properties: {
      name: { type: "string", description: "Name for the new process (e.g., 'Product Launch')" },
      description: { type: "string", description: "Optional description of what this process does" },
      taxonomy: { type: "string", description: "Taxonomy name or ID (defaults to Default taxonomy)" },
      lanes: {
        type: "array",
        description: "Lanes (parallel tracks) each containing ordered steps",
        items: {
          type: "object",
          properties: {
            name: { type: "string", description: "Lane name (e.g., 'Marketing Review')" },
            steps: {
              type: "array",
              description: "Ordered steps within this lane",
              items: {
                type: "object",
                properties: {
                  name: { type: "string", description: "Step name (unique across all lanes)" },
                  type: { type: "string", description: "Step type: task_step, action_step, gate_step, fetch_step, branch_step" },
                  title: { type: "string", description: "task_step: task title" },
                  description: { type: "string", description: "task_step: task description" },
                  priority: { type: "string", description: "task_step: priority level" },
                  target_agent_type: { type: "string", description: "task_step: agent type to assign to" },
                  action_name: { type: "string", description: "action_step: name of the action genus to execute" },
                  action_params: { type: "object", description: "action_step: parameters to pass to the action" },
                  resource_bindings: { type: "object", description: "action_step: resource bindings for the action" },
                  conditions: { type: "array", items: { type: "string" }, description: "gate_step: step names that must complete before this gate passes" },
                  fetch_source: { type: "string", description: "fetch_step: attribute to read from context entity" },
                  fetch_into: { type: "string", description: "fetch_step: key to store the fetched value" },
                },
                required: ["name", "type"],
              },
            },
          },
          required: ["name", "steps"],
        },
      },
      triggers: {
        type: "array",
        description: "How this process can be started (defaults to [{ type: 'manual' }])",
        items: {
          type: "object",
          properties: {
            type: { type: "string", description: "Trigger type: manual, action, condition, cron" },
          },
          required: ["type"],
          additionalProperties: true,
        },
      },
    },
    required: ["name", "lanes"],
  },
  handler: async ({ name, description, taxonomy, lanes, triggers }: {
    name: string;
    description?: string;
    taxonomy?: string;
    lanes: { name: string; steps: { name: string; type: string; title?: string; description?: string; priority?: string; target_agent_type?: string; action_name?: string; action_params?: Record<string, unknown>; resource_bindings?: Record<string, string>; conditions?: string[]; fetch_source?: string; fetch_into?: string }[] }[];
    triggers?: { type: string; [key: string]: unknown }[];
  }) => {
    // Check name uniqueness
    const existing = listProcessGenera(kernel);
    if (existing.some((p) => p.name.toLowerCase() === name.toLowerCase())) {
      throw new Error(`Process genus "${name}" already exists`);
    }

    // Flatten nested lanes/steps to kernel format
    const flatLanes = lanes.map((l, i) => ({ name: l.name, position: i }));
    const flatSteps: { name: string; type: string; lane: string; position: number; gate_conditions?: string[]; action_name?: string; action_params?: Record<string, unknown>; action_resource_bindings?: Record<string, string>; task_title?: string; task_description?: string; task_priority?: string; task_target_agent_type?: string; fetch_source?: string; fetch_into?: string }[] = [];
    for (const lane of lanes) {
      for (let j = 0; j < lane.steps.length; j++) {
        const s = lane.steps[j];
        flatSteps.push({
          name: s.name,
          type: s.type,
          lane: lane.name,
          position: flatSteps.length,
          ...(s.conditions ? { gate_conditions: s.conditions } : {}),
          ...(s.action_name ? { action_name: s.action_name } : {}),
          ...(s.action_params ? { action_params: s.action_params } : {}),
          ...(s.resource_bindings ? { action_resource_bindings: s.resource_bindings } : {}),
          ...(s.title ? { task_title: s.title } : {}),
          ...(s.description ? { task_description: s.description } : {}),
          ...(s.priority ? { task_priority: s.priority } : {}),
          ...(s.target_agent_type ? { task_target_agent_type: s.target_agent_type } : {}),
          ...(s.fetch_source ? { fetch_source: s.fetch_source } : {}),
          ...(s.fetch_into ? { fetch_into: s.fetch_into } : {}),
        });
      }
    }

    // Pure validation
    validateProcessDefinition(flatLanes, flatSteps);

    // Validate action steps reference existing actions
    for (const step of flatSteps) {
      if (step.type === "action_step" && step.action_name) {
        const actionId = findActionByName(kernel, step.action_name);
        if (!actionId) {
          throw new Error(`Action step "${step.name}" references non-existent action: "${step.action_name}"`);
        }
      }
    }

    // Validate triggers
    const VALID_TRIGGER_TYPES = new Set(["manual", "action", "condition", "cron"]);
    const resolvedTriggers = triggers ?? [{ type: "manual" }];
    for (const trigger of resolvedTriggers) {
      if (!VALID_TRIGGER_TYPES.has(trigger.type)) {
        throw new Error(`Invalid trigger type: "${trigger.type}". Valid types: ${[...VALID_TRIGGER_TYPES].join(", ")}`);
      }
    }

    const taxonomy_id = taxonomy ? resolveTaxonomyId(taxonomy) : DEFAULT_TAXONOMY_ID;
    const meta: Record<string, unknown> = {};
    if (description) meta.description = description;

    const genusId = defineProcessGenus(kernel, name, {
      lanes: flatLanes,
      steps: flatSteps as any,
      triggers: resolvedTriggers as any,
      meta,
      taxonomy_id,
    });

    const def = getProcessDef(kernel, genusId);
    return JSON.stringify({ genus_id: genusId, name, definition: def }, null, 2);
  },
});

mcp.tool("evolve_process_genus", {
  description: "Evolve an existing process genus — add or modify lanes, steps, and triggers. Uses last-value-wins: re-defining a step/lane by name overwrites it.",
  input: {
    type: "object",
    properties: {
      process: { type: "string", description: "Process genus name or ID to evolve" },
      lanes: {
        type: "array",
        description: "Lanes to add or modify",
        items: {
          type: "object",
          properties: {
            name: { type: "string", description: "Lane name" },
            steps: {
              type: "array",
              description: "Ordered steps within this lane",
              items: {
                type: "object",
                properties: {
                  name: { type: "string", description: "Step name (unique across all lanes)" },
                  type: { type: "string", description: "Step type: task_step, action_step, gate_step, fetch_step, branch_step" },
                  title: { type: "string", description: "task_step: task title" },
                  description: { type: "string", description: "task_step: task description" },
                  priority: { type: "string", description: "task_step: priority level" },
                  target_agent_type: { type: "string", description: "task_step: agent type to assign to" },
                  action_name: { type: "string", description: "action_step: name of the action genus to execute" },
                  action_params: { type: "object", description: "action_step: parameters to pass to the action" },
                  resource_bindings: { type: "object", description: "action_step: resource bindings for the action" },
                  conditions: { type: "array", items: { type: "string" }, description: "gate_step: step names that must complete before this gate passes" },
                  fetch_source: { type: "string", description: "fetch_step: attribute to read from context entity" },
                  fetch_into: { type: "string", description: "fetch_step: key to store the fetched value" },
                },
                required: ["name", "type"],
              },
            },
          },
          required: ["name"],
        },
      },
      triggers: {
        type: "array",
        description: "Triggers to add",
        items: {
          type: "object",
          properties: {
            type: { type: "string", description: "Trigger type: manual, action, condition, cron" },
          },
          required: ["type"],
          additionalProperties: true,
        },
      },
    },
    required: ["process"],
  },
  handler: async ({ process, lanes, triggers }: {
    process: string;
    lanes?: { name: string; steps?: { name: string; type: string; title?: string; description?: string; priority?: string; target_agent_type?: string; action_name?: string; action_params?: Record<string, unknown>; resource_bindings?: Record<string, string>; conditions?: string[]; fetch_source?: string; fetch_into?: string }[] }[];
    triggers?: { type: string; [key: string]: unknown }[];
  }) => {
    const genusId = resolveProcessGenusId(process);

    // Flatten lanes/steps to kernel format
    let flatLanes: { name: string; position: number }[] | undefined;
    let flatSteps: any[] | undefined;
    if (lanes) {
      const existingDef = getProcessDef(kernel, genusId);
      const existingLaneCount = Object.keys(existingDef.lanes).length;
      flatLanes = lanes.map((l, i) => ({ name: l.name, position: (existingDef.lanes[l.name]?.position ?? existingLaneCount + i) }));
      flatSteps = [];
      // Compute global position offset per lane: each lane's steps are numbered
      // sequentially starting after the previous lane's steps.
      let globalOffset = 0;
      for (const lane of lanes) {
        if (!lane.steps) continue;
        for (let j = 0; j < lane.steps.length; j++) {
          const s = lane.steps[j];
          flatSteps.push({
            name: s.name,
            type: s.type,
            lane: lane.name,
            position: globalOffset + j,
            ...(s.conditions ? { gate_conditions: s.conditions } : {}),
            ...(s.action_name ? { action_name: s.action_name } : {}),
            ...(s.action_params ? { action_params: s.action_params } : {}),
            ...(s.resource_bindings ? { action_resource_bindings: s.resource_bindings } : {}),
            ...(s.title ? { task_title: s.title } : {}),
            ...(s.description ? { task_description: s.description } : {}),
            ...(s.priority ? { task_priority: s.priority } : {}),
            ...(s.target_agent_type ? { task_target_agent_type: s.target_agent_type } : {}),
            ...(s.fetch_source ? { fetch_source: s.fetch_source } : {}),
            ...(s.fetch_into ? { fetch_into: s.fetch_into } : {}),
          });
        }
        globalOffset += lane.steps.length;
      }
    }

    evolveProcessGenus(kernel, genusId, {
      lanes: flatLanes,
      steps: flatSteps,
      triggers: triggers as any,
    });

    const def = getProcessDef(kernel, genusId);
    return JSON.stringify({ genus_id: genusId, definition: def }, null, 2);
  },
});

mcp.tool("run_serialization", {
  description: "Run a serialization target to export entities as a file tree (e.g., markdown). Optionally write files to disk.",
  input: {
    type: "object",
    properties: {
      target: { type: "string", description: "Serialization target name or ID (e.g., 'Markdown Export')" },
      entity_id: { type: "string", description: "Optional: export only this entity" },
      output_path: { type: "string", description: "Optional: write files to this directory on disk" },
    },
    required: ["target"],
  },
  handler: async ({ target, entity_id, output_path }: { target: string; entity_id?: string; output_path?: string }) => {
    const targetId = resolveSerializationGenusId(target);
    const result = runSerialization(kernel, targetId, entity_id ? { entity_id } : undefined);

    let writtenFiles: string[] | undefined;
    if (output_path) {
      writtenFiles = writeFiletree(result.filetree, output_path);
    }

    return JSON.stringify({
      entity_ids: result.entity_ids,
      filetree: result.filetree,
      manifest: result.manifest,
      ...(writtenFiles ? { written_files: writtenFiles } : {}),
    }, null, 2);
  },
});

mcp.tool("import_filetree", {
  description: "Import a previously exported file tree back into the kernel. Reads files, diffs against current state, and creates tessellae for changes.",
  input: {
    type: "object",
    properties: {
      path: { type: "string", description: "Path to the exported directory (containing _manifest.json)" },
      target: { type: "string", description: "Optional: serialization target name or ID for validation" },
    },
    required: ["path"],
  },
  handler: async ({ path, target }: { path: string; target?: string }) => {
    _requireWorkspace();
    const targetId = target ? resolveSerializationGenusId(target) : undefined;
    const results = importFiletree(kernel, path, targetId ? { target_genus_id: targetId } : undefined);

    const totalTessellae = results.reduce((sum, r) => sum + r.tessellae_created, 0);
    const totalChanges = results.reduce((sum, r) => sum + r.changes.length, 0);
    const allSkipped = results.flatMap((r) => r.skipped);

    return JSON.stringify({
      entities_processed: results.length,
      total_tessellae_created: totalTessellae,
      total_changes: totalChanges,
      results: results.map((r) => ({
        entity_id: r.entity_id,
        tessellae_created: r.tessellae_created,
        changes: r.changes,
        skipped: r.skipped,
      })),
      ...(allSkipped.length > 0 ? { warnings: allSkipped } : {}),
    }, null, 2);
  },
});

mcp.tool("deprecate_genus", {
  description: "Deprecate a genus to prevent new entity creation and genus evolution. Existing entities remain fully functional.",
  input: {
    type: "object",
    properties: {
      genus: { type: "string", description: "Genus name or ID to deprecate" },
    },
    required: ["genus"],
  },
  handler: async ({ genus }: { genus: string }) => {
    const genusId = resolveGenusId(genus);
    deprecateGenus(kernel, genusId);
    const def = getGenusDef(kernel, genusId);
    return JSON.stringify({
      genus_id: genusId,
      name: def.meta.name,
      deprecated: true,
      deprecated_at: def.meta.deprecated_at,
    }, null, 2);
  },
});

mcp.tool("restore_genus", {
  description: "Restore a deprecated genus, re-enabling entity creation and evolution.",
  input: {
    type: "object",
    properties: {
      genus: { type: "string", description: "Genus name or ID to restore" },
    },
    required: ["genus"],
  },
  handler: async ({ genus }: { genus: string }) => {
    const genusId = resolveGenusId(genus);
    restoreGenus(kernel, genusId);
    const def = getGenusDef(kernel, genusId);
    return JSON.stringify({
      genus_id: genusId,
      name: def.meta.name,
      deprecated: false,
    }, null, 2);
  },
});

mcp.tool("archive_taxonomy", {
  description: "Archive a taxonomy to freeze all genera within it — no new genera or entities can be created, but existing data remains readable and modifiable.",
  input: {
    type: "object",
    properties: {
      taxonomy: { type: "string", description: "Taxonomy name or ID to archive" },
    },
    required: ["taxonomy"],
  },
  handler: async ({ taxonomy }: { taxonomy: string }) => {
    const taxonomyId = resolveTaxonomyId(taxonomy);
    if (taxonomyId === DEFAULT_TAXONOMY_ID) {
      throw new Error("Cannot archive the default taxonomy");
    }
    transitionStatus(kernel, taxonomyId, "archived");
    const state = materialize(kernel, taxonomyId);
    return JSON.stringify({
      id: taxonomyId,
      name: state.name,
      status: state.status,
    }, null, 2);
  },
});

mcp.tool("unarchive_taxonomy", {
  description: "Unarchive a taxonomy to re-enable genus and entity creation within it.",
  input: {
    type: "object",
    properties: {
      taxonomy: { type: "string", description: "Taxonomy name or ID to unarchive" },
    },
    required: ["taxonomy"],
  },
  handler: async ({ taxonomy }: { taxonomy: string }) => {
    const taxonomyId = resolveTaxonomyId(taxonomy);
    transitionStatus(kernel, taxonomyId, "active");
    const state = materialize(kernel, taxonomyId);
    return JSON.stringify({
      id: taxonomyId,
      name: state.name,
      status: state.status,
    }, null, 2);
  },
});

// --- Palace tools ---

mcp.tool("build_room", {
  description: "Create or replace a palace room. Use merge=true to incrementally add actions/portals without replacing the whole room. Use quiet=true for minimal response. Slugs must be exact matches for upsert. Markup: embed live entity refs with *GenusName:EntityName* (or *GenusName:EntityName|alias* for custom display text) and portal links with [room-slug]prose text[/]. Resolved refs become interactive — use 'look' and 'examine' verbs in palace_action. Unresolved refs are flagged in the response. Action shorthand: use entity_id instead of type+tool+tool_params to auto-expand to a get_entity query action.",
  input: {
    type: "object",
    properties: {
      slug: { type: "string", description: "URL-safe identifier (e.g. hall-of-geology)" },
      name: { type: "string", description: "Display name" },
      description: { type: "string", description: "Vivid narrative description" },
      entry: { type: "boolean", description: "Mark as entry room (default: true for first room)" },
      merge: { type: "boolean", description: "Merge with existing room instead of replacing. Actions matched by label are updated; new labels appended; unmentioned preserved." },
      quiet: { type: "boolean", description: "Return minimal summary instead of full room render (default: false)" },
      actions: {
        type: "array",
        items: {
          type: "object",
          properties: {
            label: { type: "string" },
            type: { type: "string", enum: ["navigate", "query", "text"], description: "Action type. Auto-inferred from other fields if omitted: entity_id→query, room→navigate, tool→query, content→text." },
            room: { type: "string", description: "navigate: target room slug" },
            tool: { type: "string", description: "query: MCP tool name" },
            tool_params: { type: "object", description: "query: tool parameters" },
            content: { type: "string", description: "text: static content" },
            workspace: { type: "string", description: "navigate: target workspace name for cross-workspace portals" },
            entity_id: { type: "string", description: "Shorthand: auto-expands to a get_entity query action" },
            entity_ref: { type: "string", description: "Shorthand: GenusName:query — resolved to entity_id, then expanded to get_entity query" },
          },
          required: ["label"],
        },
      },
      portals: {
        type: "array",
        items: { type: "string" },
        description: "Slugs of rooms to connect to (bidirectional)",
      },
    },
    required: ["slug"],
  },
  handler: async ({ slug, name, description, entry, merge, quiet, actions: rawActions, portals }: {
    slug: string; name?: string; description?: string; entry?: boolean;
    merge?: boolean; quiet?: boolean; actions?: unknown[]; portals?: string[];
  }) => {
    _requireWorkspace();
    const actions = rawActions ? _normalizeActions(rawActions) : undefined;
    let room: PalaceRoom;
    if (merge) {
      // Fuzzy slug resolution: if exact slug doesn't match, try case-insensitive name match
      let effectiveSlug = slug;
      const existing = palaceGetRoom(kernel, kernel.currentWorkspace!, slug);
      if (!existing && name) {
        const allRooms = palaceListRooms(kernel, kernel.currentWorkspace!);
        const matches = allRooms.filter(r => r.name.toLowerCase() === name!.toLowerCase());
        if (matches.length === 1) {
          effectiveSlug = matches[0].slug;
        } else if (matches.length > 1) {
          throw new Error(`Multiple rooms match name "${name}": ${matches.map(r => r.slug).join(", ")}. Use an exact slug.`);
        }
      }
      room = palaceMergeRoom(kernel, kernel.currentWorkspace!, {
        slug: effectiveSlug, name, description,
        entry: entry ?? undefined,
        actions,
        portals,
      });
    } else {
      if (!name || !description || !actions) {
        throw new Error("Non-merge build_room requires name, description, and actions. Use merge=true for incremental updates.");
      }
      room = palaceBuildRoom(kernel, kernel.currentWorkspace!, {
        slug, name, description,
        entry: entry ?? undefined,
        actions,
        portals: portals ?? [],
      });
    }
    // Auto-place charter scroll on first room in a new palace
    if (room.entry && palaceListRooms(kernel, kernel.currentWorkspace!).length === 1) {
      const existingScrolls = palaceGetScrolls(kernel, kernel.currentWorkspace!, room.slug);
      if (existingScrolls.total === 0) {
        palaceWriteScroll(kernel, kernel.currentWorkspace!, room.slug,
          "Charter of the Palace",
          "This palace is a living structure. Each Claude session should leave it better than they found it — add rooms for uncovered domains, wire up broken actions, leave scrolls for the next session. Use palace_action(95) to see what needs attention.",
        );
      }
    }
    if (_currentSessionId) {
      const ctx = _getSessionContext();
      _palaceNavigate(ctx, room.slug, room);
    }
    const scrolls = palaceGetScrolls(kernel, kernel.currentWorkspace!, room.slug, { limit: 10 });

    // v2 markup resolution feedback
    const tokens = palaceParseMarkup(room.description);
    const hasMarkup = tokens.some(t => t.type !== "text");
    const manifest = hasMarkup ? palaceResolveMarkup(kernel, kernel.currentWorkspace!, tokens) : null;
    const unresolved = manifest ? manifest.entries.filter(e => !e.resolved) : [];

    if (quiet) {
      const result: Record<string, unknown> = {
        slug: room.slug, name: room.name,
        actions: room.actions.length, portals: room.portals.length,
        scrolls: scrolls.total, version: room.version,
      };
      if (manifest) {
        result.markup_refs = manifest.entries.length;
        result.markup_resolved = manifest.entries.length - unresolved.length;
        if (unresolved.length > 0) {
          result.markup_unresolved = unresolved.map(u => u.kind === "entity" ? `${u.genus_name ?? "?"}:${u.match_name}` : u.slug!);
        }
      }
      return JSON.stringify(result, null, 2);
    }

    let markupDiag = "";
    if (manifest) {
      if (unresolved.length > 0) {
        const lines = [`\nMarkup: ${manifest.entries.length - unresolved.length}/${manifest.entries.length} refs resolved`];
        for (const u of unresolved) {
          lines.push(`  \u2717 ${u.kind === "entity" ? `*${u.genus_name ?? "?"}:${u.match_name}*` : `[${u.slug}]`} \u2014 not found`);
        }
        markupDiag = lines.join("\n");
      } else {
        markupDiag = `\nMarkup: all ${manifest.entries.length} refs resolved`;
      }
    }
    return _renderRoom(room, scrolls) + markupDiag;
  },
});

mcp.tool("write_scroll", {
  description: "Write a dated note (scroll) in the current palace room. Scrolls persist across conversations — leave notes for your successor.",
  input: {
    type: "object",
    properties: {
      title: { type: "string", description: "Short title" },
      body: { type: "string", description: "Scroll content" },
    },
    required: ["title", "body"],
  },
  handler: async ({ title, body }: { title: string; body: string }) => {
    _requireWorkspace();
    const ctx = _getSessionContext();
    if (!ctx.palace_current_slug) throw new Error("Not in a palace room. Use set_workspace first.");
    const scroll = palaceWriteScroll(kernel, kernel.currentWorkspace!, ctx.palace_current_slug, title, body);
    return JSON.stringify({
      scroll_id: scroll.id,
      room: ctx.palace_current_slug,
      title: scroll.title,
      created_at: scroll.created_at,
    }, null, 2);
  },
});

mcp.tool("build_npc", {
  description: "Create or update an NPC in a palace room. NPCs have dialogue trees that let players explore entities through narrative characters. Use merge=true to update fields and append dialogue without replacing.",
  input: {
    type: "object",
    properties: {
      slug: { type: "string", description: "URL-safe identifier (e.g. the-assayer)" },
      name: { type: "string", description: "Display name" },
      description: { type: "string", description: "Narrative character description" },
      room: { type: "string", description: "Room slug where the NPC lives" },
      greeting: { type: "string", description: "What the NPC says when approached" },
      merge: { type: "boolean", description: "Update existing NPC: modify provided fields, append dialogue" },
      dialogue: {
        type: "array",
        items: {
          type: "object",
          properties: {
            id: { type: "string", description: "Unique ID within this NPC" },
            parent: { type: "string", description: "Parent node ID, or 'root' for top-level" },
            prompt: { type: "string", description: "What the player sees as a clickable option" },
            text: { type: "string", description: "NPC's response" },
            entity_id: { type: "string", description: "Entity to display alongside response" },
            entity_ref: { type: "string", description: "Entity reference (GenusName:query) — resolved to entity_id" },
            requires: { type: "array", items: { type: "string" }, description: "Session tags needed (AND)" },
            unlocks: { type: "array", items: { type: "string" }, description: "Session tags granted on view" },
          },
          required: ["id", "parent", "prompt", "text"],
        },
      },
    },
    required: ["slug"],
  },
  handler: async ({ slug, name, description, room, greeting, merge, dialogue: rawDialogue }: {
    slug: string; name?: string; description?: string; room?: string;
    greeting?: string; merge?: boolean; dialogue?: unknown[];
  }) => {
    _requireWorkspace();
    const dialogue = rawDialogue ? _normalizeDialogueNodes(rawDialogue) : undefined;
    if (merge) {
      // Fuzzy room resolution
      let effectiveRoomSlug = room;
      if (room) {
        const existing = palaceGetRoom(kernel, kernel.currentWorkspace!, room);
        if (!existing) {
          const allRooms = palaceListRooms(kernel, kernel.currentWorkspace!);
          const matches = allRooms.filter(r => r.name.toLowerCase() === room.toLowerCase());
          if (matches.length === 1) effectiveRoomSlug = matches[0].slug;
          else if (matches.length > 1) throw new Error(`Multiple rooms match "${room}": ${matches.map(r => r.slug).join(", ")}`);
        }
      }
      const npc = palaceMergeNPC(kernel, kernel.currentWorkspace!, {
        slug, name, description,
        room_slug: effectiveRoomSlug,
        greeting,
        dialogue,
      });
      const summary: Record<string, unknown> = {
        slug: npc.slug, name: npc.name, room: npc.room_slug,
        dialogue_nodes: npc.dialogue.length,
        root_options: npc.dialogue.filter(n => n.parent === "root").length,
      };
      let result = JSON.stringify(summary, null, 2);
      if (npc.dialogue.length > 0) result += "\n\n" + _summarizeDialogueTree(npc.dialogue);
      return result;
    } else {
      if (!name || !description || !room || !greeting) {
        throw new Error("Non-merge build_npc requires name, description, room, and greeting. Use merge=true for incremental updates.");
      }
      const npc = palaceCreateNPC(kernel, kernel.currentWorkspace!, {
        slug, name, description,
        room_slug: room,
        greeting,
        dialogue,
      });
      const summary: Record<string, unknown> = {
        slug: npc.slug, name: npc.name, room: npc.room_slug,
        dialogue_nodes: npc.dialogue.length,
        root_options: npc.dialogue.filter(n => n.parent === "root").length,
      };
      let result = JSON.stringify(summary, null, 2);
      if (npc.dialogue.length > 0) result += "\n\n" + _summarizeDialogueTree(npc.dialogue);
      return result;
    }
  },
});

mcp.tool("add_dialogue", {
  description: "Add dialogue nodes to an existing NPC. Nodes are appended — existing nodes are never modified. The tree grows by accretion across sessions.",
  input: {
    type: "object",
    properties: {
      npc: { type: "string", description: "NPC slug" },
      nodes: {
        type: "array",
        items: {
          type: "object",
          properties: {
            id: { type: "string" },
            parent: { type: "string" },
            prompt: { type: "string" },
            text: { type: "string" },
            entity_id: { type: "string" },
            entity_ref: { type: "string" },
            requires: { type: "array", items: { type: "string" } },
            unlocks: { type: "array", items: { type: "string" } },
          },
          required: ["id", "parent", "prompt", "text"],
        },
      },
    },
    required: ["npc", "nodes"],
  },
  handler: async ({ npc: npcSlug, nodes: rawNodes }: { npc: string; nodes: unknown[] }) => {
    _requireWorkspace();
    const nodes = _normalizeDialogueNodes(rawNodes);
    const existing = palaceGetNPC(kernel, kernel.currentWorkspace!, npcSlug);
    if (!existing) {
      const allNpcs = palaceListNPCs(kernel, kernel.currentWorkspace!);
      const slugList = allNpcs.map(n => `  ${n.slug} (${n.name}, room: ${n.room_slug})`).join("\n");
      throw new Error(`NPC not found: "${npcSlug}". Available NPCs:\n${slugList || "  (none)"}`);
    }
    const updated = palaceAddDialogue(kernel, kernel.currentWorkspace!, npcSlug, nodes);
    const summary: Record<string, unknown> = {
      npc: updated.slug, name: updated.name,
      dialogue_nodes: updated.dialogue.length,
      root_options: updated.dialogue.filter(n => n.parent === "root").length,
      added: nodes.length,
    };
    let result = JSON.stringify(summary, null, 2);
    if (updated.dialogue.length > 0) result += "\n\n" + _summarizeDialogueTree(updated.dialogue);
    return result;
  },
});

// --- Palace v2: Verb parsing, name resolution, renderers ---

function _getVisibleOptions(
  dialogue: PalaceDialogueNode[], currentNodeId: string | null, unlockedTags: string[],
): { index: number; node_id: string; prompt: string }[] {
  const passesRequires = (n: PalaceDialogueNode) =>
    !n.requires || n.requires.every(t => unlockedTags.includes(t));

  const children = currentNodeId
    ? dialogue.filter(n => n.parent === currentNodeId && passesRequires(n))
    : [];
  const roots = dialogue.filter(n => n.parent === "root" && passesRequires(n));
  // Children first (contextual), then roots — deduplicate
  const seen = new Set<string>();
  const options: { index: number; node_id: string; prompt: string }[] = [];
  let idx = 1;
  for (const n of [...children, ...roots]) {
    if (seen.has(n.id)) continue;
    seen.add(n.id);
    options.push({ index: idx++, node_id: n.id, prompt: n.prompt });
  }
  return options;
}

function _renderNpcConversation(conv: NpcConversationState, responseText?: string, entityCard?: string): string {
  const lines: string[] = [];
  lines.push(`\u2500\u2500 Talking to ${conv.npc_name} \u2500\u2500`);
  if (responseText) {
    lines.push(`"${responseText}"`);
  }
  if (entityCard) {
    lines.push("");
    lines.push(entityCard);
  }
  lines.push("");
  for (const opt of conv.visible_options) {
    lines.push(`  ${opt.index}. ${opt.prompt}`);
  }
  lines.push("  0. Step away");
  return lines.join("\n");
}

function _renderScrollPile(pile: ScrollPileState): string {
  const lines: string[] = [];
  lines.push(`\u2500\u2500 Pile of Scrolls (${pile.scrolls.length} scrolls) \u2500\u2500`);
  for (let i = 0; i < pile.scrolls.length; i++) {
    lines.push(`  ${i + 1}. ${pile.scrolls[i].title} \u2014 ${_relativeTime(pile.scrolls[i].created_at)}`);
  }
  lines.push("  0. Step away");
  return lines.join("\n");
}

const _PALACE_VERBS: Record<string, string> = {
  look: "look", l: "look",
  examine: "examine", x: "examine",
  go: "go",
  search: "search", find: "search",
  write: "write",
  delete: "delete",
  back: "back", b: "back",
  map: "map", m: "map",
  inventory: "inventory", inv: "inventory", i: "inventory",
  talk: "talk", t: "talk",
};

function _parseVerb(input: string): { verb: string; target: string | null } | null {
  const lower = input.toLowerCase();
  const spaceIdx = lower.indexOf(" ");
  const word = spaceIdx === -1 ? lower : lower.slice(0, spaceIdx);
  const rest = spaceIdx === -1 ? null : input.slice(spaceIdx + 1).trim() || null;
  const verb = _PALACE_VERBS[word];
  if (!verb) return null;
  return { verb, target: rest };
}

function _resolveTarget(
  manifest: PalaceRoomManifest,
  target: string,
  kind?: "entity" | "portal",
): PalaceManifestEntry | PalaceManifestEntry[] | null {
  const lower = target.toLowerCase();
  const candidates = kind ? manifest.entries.filter(e => e.kind === kind) : manifest.entries;

  // Match against match_name (clean name without decorators)
  // exact match
  const exact = candidates.filter(e => e.match_name.toLowerCase() === lower);
  if (exact.length === 1) return exact[0];
  if (exact.length > 1) return exact;

  // prefix match
  const prefix = candidates.filter(e => e.match_name.toLowerCase().startsWith(lower));
  if (prefix.length === 1) return prefix[0];
  if (prefix.length > 1) return prefix;

  // substring match
  const substr = candidates.filter(e => e.match_name.toLowerCase().includes(lower));
  if (substr.length === 1) return substr[0];
  if (substr.length > 1) return substr;

  // word match — any word in the name starts with the query
  const words = candidates.filter(e => e.match_name.toLowerCase().split(/\s+/).some(w => w.startsWith(lower)));
  if (words.length === 1) return words[0];
  if (words.length > 1) return words;

  return null;
}

function _renderGlance(entityId: string): string {
  const state = materialize(kernel, entityId, { branch_id: kernel.currentBranch });
  const resRow = getRes(kernel, entityId);
  const genusDef = getGenusDef(kernel, resRow.genus_id);
  const genusName = (genusDef.meta.name as string) ?? "Unknown";

  // Check for genus template
  const templates = getGenusTemplates(kernel, resRow.genus_id);
  if (templates.glance) {
    return renderTemplate(templates.glance, state, { genus_name: genusName, id: entityId });
  }

  // Default glance
  const name = getEntityDisplayName(kernel, entityId);
  const lines: string[] = [`${name} (${genusName}). Status: ${(state.status as string) ?? "unknown"}.`];
  for (const [key, val] of Object.entries(state)) {
    if (["name", "title", "status", "genus_id"].includes(key)) continue;
    if (val == null || typeof val === "object") continue;
    lines.push(`  ${key}: ${val}`);
  }
  return lines.join("\n");
}

function _renderInspect(entityId: string): string {
  const state = materialize(kernel, entityId, { branch_id: kernel.currentBranch });
  const resRow = getRes(kernel, entityId);
  const genusDef = getGenusDef(kernel, resRow.genus_id);
  const genusName = (genusDef.meta.name as string) ?? "Unknown";

  // Check for genus template
  const templates = getGenusTemplates(kernel, resRow.genus_id);
  if (templates.inspect) {
    return renderTemplate(templates.inspect, state, { genus_name: genusName, id: entityId });
  }

  // Default inspect
  const name = getEntityDisplayName(kernel, entityId);
  const lines: string[] = [`\u2500\u2500 ${genusName}: ${name} \u2500\u2500`];
  lines.push(JSON.stringify(state, null, 2));

  const rels = getRelationshipsForEntity(kernel, entityId);
  if (rels.length > 0) {
    lines.push("");
    lines.push("Relationships:");
    for (const r of rels) {
      const memberParts: string[] = [];
      for (const [role, ids] of Object.entries(r.members)) {
        for (const eid of ids) {
          const s = materialize(kernel, eid, { branch_id: kernel.currentBranch });
          memberParts.push(`${role}=${(s.name as string) ?? eid}`);
        }
      }
      lines.push(`  - ${r.genus_name}: ${memberParts.join(", ")}`);
    }
  }

  return lines.join("\n");
}

mcp.tool("palace_action", {
  description: "Execute a numbered action or verb command in the current palace room. Verbs: look/l TARGET, examine/x TARGET, go TARGET, talk/t NPC_NAME, search/find QUERY, delete SLUG, back/b, map/m, inventory/inv/i. Also numbered: 61-80 entity drilldown, 81-90 scroll read, 0=map (or step away from NPC), 91=inventory, 92=write scroll, 93=search, 94=teleport, 95=health, 96=back, 97=delete room. When talking to an NPC, numbered actions select dialogue options.",
  input: {
    type: "object",
    properties: {
      action: { type: "number", description: "Action number from current menu" },
      verb: { type: "string", description: "Verb command (e.g. 'look CRYSTAL', 'go THE DOORWAY', 'examine SWORD')" },
      params: { type: "string", description: "Optional parameters (e.g. search term for action 93)" },
      inspect: { type: "boolean", description: "Return raw action definitions as JSON for debugging (no action/verb needed)" },
    },
  },
  handler: async ({ action, verb, params, inspect }: { action?: number; verb?: string; params?: string; inspect?: boolean }) => {
    _requireWorkspace();
    const ctx = _getSessionContext();
    if (!ctx.palace_current_slug) throw new Error("Not in a palace room. Use set_workspace first.");
    // Coerce action to number — MCP clients may send "94" instead of 94
    if (action != null) action = Number(action);

    // --- Room inspection ---
    if (inspect) {
      const room = palaceGetRoom(kernel, kernel.currentWorkspace!, ctx.palace_current_slug)!;
      return JSON.stringify({
        slug: room.slug,
        name: room.name,
        action_count: room.actions.length,
        portal_count: room.portals.length,
        portals: room.portals,
        actions: room.actions.map((a, i) => ({
          number: i + 1,
          label: a.label,
          type: a.type,
          ...(a.room ? { room: a.room } : {}),
          ...(a.tool ? { tool: a.tool } : {}),
          ...(a.tool_params ? { tool_params: a.tool_params } : {}),
          ...(a.content ? { content: a.content } : {}),
          ...(a.workspace ? { workspace: a.workspace } : {}),
        })),
      }, null, 2);
    }

    // --- Verb dispatch ---
    if (verb) {
      const parsed = _parseVerb(verb);
      if (!parsed) throw new Error(`Unknown verb command: "${verb}". Available verbs: look/l, examine/x, go, talk/t, search/find, back/b, map/m, inventory/inv/i. Usage: verb is a single string like "go The Tower" or "look Crystal" — the target is part of the verb string, not a separate parameter.`);

      const currentRoom = palaceGetRoom(kernel, kernel.currentWorkspace!, ctx.palace_current_slug)!;
      const scrollsResult = palaceGetScrolls(kernel, kernel.currentWorkspace!, ctx.palace_current_slug, { limit: 10 });
      const actionMenu = () => _renderActionMenu(currentRoom, scrollsResult.scrolls, { totalScrolls: scrollsResult.total, queryResults: ctx.palace_last_results, hasHistory: ctx.palace_nav_history.length > 0 });

      switch (parsed.verb) {
        case "look": {
          if (!parsed.target) return _renderRoom(currentRoom, scrollsResult);
          // Try manifest first, then fallback to workspace entity search
          if (ctx.palace_room_manifest) {
            const match = _resolveTarget(ctx.palace_room_manifest, parsed.target, "entity");
            if (match && !Array.isArray(match) && match.entity_id) return `${_renderGlance(match.entity_id)}\n\n${actionMenu()}`;
            if (Array.isArray(match)) return `Did you mean ${match.map(m => m.match_name).join(" or ")}?\n\n${actionMenu()}`;
          }
          // Fallback: fuzzy search workspace entities
          const lookResults = searchEntities(kernel, { query: parsed.target, limit: 5 });
          if (lookResults.length === 1) return `${_renderGlance(lookResults[0].id)}\n\n${actionMenu()}`;
          if (lookResults.length > 1) return `Did you mean ${lookResults.map(e => `${getEntityDisplayName(kernel, e.id)} (${e.genus_name})`).join(", ")}?\n\n${actionMenu()}`;
          return `Nothing matching "${parsed.target}" is visible here.\n\n${actionMenu()}`;
        }
        case "examine": {
          if (!parsed.target) throw new Error("Examine what? Include the target in the verb string: verb: \"examine Crystal\". Use \"look\" (no target) to see what's in the room.");
          // Try manifest first, then fallback to workspace entity search
          if (ctx.palace_room_manifest) {
            const match = _resolveTarget(ctx.palace_room_manifest, parsed.target, "entity");
            if (match && !Array.isArray(match) && match.entity_id) return `${_renderInspect(match.entity_id)}\n\n${actionMenu()}`;
            if (Array.isArray(match)) return `Did you mean ${match.map(m => m.match_name).join(" or ")}?\n\n${actionMenu()}`;
          }
          // Fallback: fuzzy search workspace entities
          const examResults = searchEntities(kernel, { query: parsed.target, limit: 5 });
          if (examResults.length === 1) return `${_renderInspect(examResults[0].id)}\n\n${actionMenu()}`;
          if (examResults.length > 1) return `Did you mean ${examResults.map(e => `${getEntityDisplayName(kernel, e.id)} (${e.genus_name})`).join(", ")}?\n\n${actionMenu()}`;
          return `Nothing matching "${parsed.target}" is visible here.\n\n${actionMenu()}`;
        }
        case "go": {
          if (!parsed.target) throw new Error("Go where? Include the destination in the verb string: verb: \"go The Tower\". The target is part of the verb, not a separate parameter. Use action 0 (map) to see available rooms.");
          let goSlug: string | undefined;
          // Try manifest first (v2 rooms)
          if (ctx.palace_room_manifest) {
            const match = _resolveTarget(ctx.palace_room_manifest, parsed.target, "portal");
            if (match && !Array.isArray(match)) goSlug = match.slug!;
            if (Array.isArray(match)) return `Did you mean ${match.map(m => m.display).join(" or ")}?\n\n${actionMenu()}`;
          }
          // Fallback: match against room portal connections by room name
          if (!goSlug) {
            const currentRoom = palaceGetRoom(kernel, kernel.currentWorkspace!, ctx.palace_current_slug);
            if (currentRoom) {
              const target = parsed.target.toLowerCase();
              const portalMatches: { slug: string; name: string }[] = [];
              for (const slug of currentRoom.portals) {
                const pr = palaceGetRoom(kernel, kernel.currentWorkspace!, slug);
                const name = pr ? pr.name : slug;
                const nameLower = name.toLowerCase();
                if (nameLower === target || nameLower.startsWith(target) || nameLower.includes(target)) {
                  portalMatches.push({ slug, name });
                }
              }
              if (portalMatches.length === 1) goSlug = portalMatches[0].slug;
              else if (portalMatches.length > 1) return `Did you mean ${portalMatches.map(p => p.name).join(" or ")}?\n\n${actionMenu()}`;
            }
          }
          if (!goSlug) return `No way matching "${parsed.target}" is visible here.\n\n${actionMenu()}`;
          const targetRoom = palaceGetRoom(kernel, kernel.currentWorkspace!, goSlug);
          if (!targetRoom) return _renderUnfinishedRoom(goSlug, kernel.currentWorkspace!, ctx.palace_current_slug);
          const targetScrolls = palaceGetScrolls(kernel, kernel.currentWorkspace!, targetRoom.slug, { limit: 10 });
          _palaceNavigate(ctx, targetRoom.slug, targetRoom);
          return _renderRoom(targetRoom, targetScrolls);
        }
        case "search": {
          const query = parsed.target ?? params;
          if (!query) throw new Error("Search for what? Include the search term in the verb string: verb: \"search Maxwell\" or use action 93 with params: verb: \"search Maxwell\" or palace_action({ action: 93, params: \"Maxwell\" }).");
          // Delegate to action 93 logic
          action = 93;
          params = query;
          break;
        }
        case "write":
          throw new Error("To write a scroll, call the write_scroll tool: write_scroll({ title: \"My Scroll\", body: \"Content here\" }). Scrolls are pinned to the current room.");
        case "delete":
          action = 97;
          params = parsed.target ?? undefined;
          break;
        case "back":
          action = 96;
          break;
        case "map":
          action = 0;
          break;
        case "inventory":
          action = 91;
          break;
        case "talk": {
          if (!parsed.target) throw new Error("Talk to whom? Include the NPC name in the verb string: verb: \"talk The Glassblower\". NPCs are listed in the room description.");
          const npcsInRoom = palaceListNPCsInRoom(kernel, kernel.currentWorkspace!, ctx.palace_current_slug);
          if (npcsInRoom.length === 0) return `No one is here to talk to.\n\n${actionMenu()}`;

          const targetLower = parsed.target.toLowerCase();
          // Fuzzy match: exact → prefix → substring
          let talkMatches = npcsInRoom.filter(n => n.name.toLowerCase() === targetLower);
          if (talkMatches.length === 0) talkMatches = npcsInRoom.filter(n => n.name.toLowerCase().startsWith(targetLower));
          if (talkMatches.length === 0) talkMatches = npcsInRoom.filter(n => n.name.toLowerCase().includes(targetLower));
          // word match
          if (talkMatches.length === 0) talkMatches = npcsInRoom.filter(n => n.name.toLowerCase().split(/\s+/).some(w => w.startsWith(targetLower)));

          if (talkMatches.length === 0) return `No one by that name is here.\n\n${actionMenu()}`;
          if (talkMatches.length > 1) return `Did you mean ${talkMatches.map(n => n.name).join(" or ")}?\n\n${actionMenu()}`;

          const npc = talkMatches[0];
          const visibleOpts = _getVisibleOptions(npc.dialogue, null, []);
          ctx.palace_npc_conversation = {
            npc_id: npc.id,
            npc_slug: npc.slug,
            npc_name: npc.name,
            dialogue: npc.dialogue,
            unlocked_tags: [],
            current_node_id: null,
            visible_options: visibleOpts,
          };
          return _renderNpcConversation(ctx.palace_npc_conversation, npc.greeting);
        }
      }
    }

    if (action == null) throw new Error("Provide either an action number or a verb command. Examples: palace_action({ action: 1 }) for numbered actions, palace_action({ verb: \"go The Tower\" }) for verbs. Verbs: look, examine, go, talk, search, back, map, inventory.");

    // NPC conversation mode — numbered actions map to dialogue options
    if (ctx.palace_npc_conversation) {
      const conv = ctx.palace_npc_conversation;
      if (action === 0) {
        // Step away — clear conversation, return to room
        ctx.palace_npc_conversation = null;
        const currentRoom = palaceGetRoom(kernel, kernel.currentWorkspace!, ctx.palace_current_slug)!;
        const scrollsResult = palaceGetScrolls(kernel, kernel.currentWorkspace!, ctx.palace_current_slug, { limit: 10 });
        return _renderRoom(currentRoom, scrollsResult);
      }
      if (action >= 1 && action <= conv.visible_options.length) {
        const selected = conv.visible_options[action - 1];
        const node = conv.dialogue.find(n => n.id === selected.node_id);
        if (!node) throw new Error("Dialogue node not found.");

        // Add unlocks
        if (node.unlocks) {
          for (const tag of node.unlocks) {
            if (!conv.unlocked_tags.includes(tag)) conv.unlocked_tags.push(tag);
          }
        }

        // Fetch entity card if entity_id set
        let entityCard: string | undefined;
        if (node.entity_id) {
          try {
            entityCard = _renderGlance(node.entity_id);
          } catch {
            entityCard = `[Entity ${node.entity_id} not found]`;
          }
        }

        // Compute new visible options
        conv.current_node_id = node.id;
        conv.visible_options = _getVisibleOptions(conv.dialogue, node.id, conv.unlocked_tags);

        const responseText = node.text ?? (node as any).response;
        return _renderNpcConversation(conv, responseText, entityCard);
      }
      throw new Error(`Invalid dialogue option: ${action}. Choose 1-${conv.visible_options.length} or 0 to step away.`);
    }

    // Scroll pile sub-mode — browsing all scrolls
    if (ctx.palace_scroll_pile) {
      const pile = ctx.palace_scroll_pile;
      if (action === 0) {
        ctx.palace_scroll_pile = null;
        const currentRoom = palaceGetRoom(kernel, kernel.currentWorkspace!, ctx.palace_current_slug)!;
        const scrollsResult = palaceGetScrolls(kernel, kernel.currentWorkspace!, ctx.palace_current_slug, { limit: 10 });
        return _renderRoom(currentRoom, scrollsResult);
      }
      if (action >= 1 && action <= pile.scrolls.length) {
        const scroll = pile.scrolls[action - 1];
        return `\u2500\u2500 ${scroll.title} \u2500\u2500\n${_relativeTime(scroll.created_at)}\n\n${scroll.body}\n\n${_renderScrollPile(pile)}`;
      }
      throw new Error(`Choose 1-${pile.scrolls.length} to read a scroll, or 0 to step away.`);
    }

    // Entity drilldown actions (61-80) — view full details of last query result
    if (action >= 61 && action <= 80) {
      const resultIndex = action - 61;
      if (resultIndex >= ctx.palace_last_results.length) throw new Error(`No entity at action ${action}. Last query returned ${ctx.palace_last_results.length} result${ctx.palace_last_results.length === 1 ? "" : "s"}.`);
      const entityId = ctx.palace_last_results[resultIndex].id;
      const state = materialize(kernel, entityId, { branch_id: kernel.currentBranch });
      const resRow = getRes(kernel, entityId);
      const genusDef = getGenusDef(kernel, resRow.genus_id);
      const currentRoom = palaceGetRoom(kernel, kernel.currentWorkspace!, ctx.palace_current_slug)!;
      const scrollsResult = palaceGetScrolls(kernel, kernel.currentWorkspace!, ctx.palace_current_slug, { limit: 10 });
      return `\u2500\u2500 ${genusDef.meta.name}: ${getEntityDisplayName(kernel, entityId)} \u2500\u2500\n${JSON.stringify(state, null, 2)}\n\n${_renderActionMenu(currentRoom, scrollsResult.scrolls, { totalScrolls: scrollsResult.total, queryResults: ctx.palace_last_results, hasHistory: ctx.palace_nav_history.length > 0 })}`;
    }

    // Scroll reading actions (81-90)
    if (action >= 81 && action <= 90) {
      const scrollsResult = palaceGetScrolls(kernel, kernel.currentWorkspace!, ctx.palace_current_slug, { limit: 10 });
      const currentRoom = palaceGetRoom(kernel, kernel.currentWorkspace!, ctx.palace_current_slug)!;

      // Action 90 with > 10 scrolls = enter pile sub-mode
      if (action === 90 && scrollsResult.total > 10) {
        const allScrolls = palaceGetScrolls(kernel, kernel.currentWorkspace!, ctx.palace_current_slug, { limit: scrollsResult.total });
        ctx.palace_scroll_pile = { scrolls: allScrolls.scrolls };
        return _renderScrollPile(ctx.palace_scroll_pile);
      }

      const hasPile = scrollsResult.total > 10;
      const maxDirect = hasPile ? 9 : 10;
      const scrollIndex = action - 81;
      if (scrollIndex >= Math.min(scrollsResult.scrolls.length, maxDirect)) throw new Error(`No scroll at action ${action}. This room has ${scrollsResult.scrolls.length} scroll${scrollsResult.scrolls.length === 1 ? "" : "s"}.`);
      const scroll = scrollsResult.scrolls[scrollIndex];
      return `\u2500\u2500 ${scroll.title} \u2500\u2500\n${_relativeTime(scroll.created_at)}\n\n${scroll.body}\n\n${_renderActionMenu(currentRoom, scrollsResult.scrolls, { totalScrolls: scrollsResult.total, hasHistory: ctx.palace_nav_history.length > 0 })}`;
    }

    // Global actions
    if (action === 0) return _palaceMap(kernel.currentWorkspace!, ctx.palace_current_slug);
    if (action === 91) return _palaceInventory(kernel.currentWorkspace!, ctx.palace_current_slug);
    if (action === 92) throw new Error("To write a scroll, call the write_scroll tool: write_scroll({ title: \"My Scroll\", body: \"Content here\" }). Scrolls are pinned to the current room.");
    if (action === 93) {
      if (!params) throw new Error("Search requires a query. Use palace_action({ action: 93, params: \"search term\" }) or verb: \"search Maxwell\".");
      const palaceResults = palaceSearch(kernel, kernel.currentWorkspace!, params);
      const entityResults = searchEntities(kernel, { query: params, limit: 10 });

      const currentRoom = palaceGetRoom(kernel, kernel.currentWorkspace!, ctx.palace_current_slug)!;

      if (palaceResults.length === 0 && entityResults.length === 0) {
        return `No results for "${params}".\n\n` + _renderActionMenu(currentRoom);
      }

      const lines: string[] = [`Search results for "${params}":\n`];

      // Palace results grouped by type
      if (palaceResults.length > 0) {
        const grouped: Record<string, typeof palaceResults> = {};
        for (const r of palaceResults) {
          (grouped[r.type] ??= []).push(r);
        }
        for (const [type, items] of Object.entries(grouped)) {
          lines.push(`${type.charAt(0).toUpperCase() + type.slice(1)}s:`);
          for (const item of items) {
            lines.push(`  - ${item.match} (${item.field} in ${item.room_name})`);
          }
          lines.push("");
        }
      }

      // Entity results
      if (entityResults.length > 0) {
        lines.push("Entities:");
        for (const e of entityResults) {
          const matchedFields = e.matched_attributes.join(", ");
          const displayName = getEntityDisplayName(kernel, e.id);
          lines.push(`  - [${e.genus_name}] ${displayName} (matched: ${matchedFields})`);
        }
        lines.push("");
      }

      return lines.join("\n") + "\n" + _renderActionMenu(currentRoom);
    }
    if (action === 94) {
      if (!params) throw new Error("Teleport requires a room name or slug. Use palace_action({ action: 94, params: \"room-slug\" }). Use action 0 (map) to see all rooms and their slugs.");
      const rooms = palaceListRooms(kernel, kernel.currentWorkspace!);
      const target = rooms.find((r) => r.slug === params || r.name.toLowerCase() === params.toLowerCase());
      if (!target) {
        const currentRoom = palaceGetRoom(kernel, kernel.currentWorkspace!, ctx.palace_current_slug)!;
        return `No room found matching "${params}". Use action 0 (map) to see available rooms.\n\n` + _renderActionMenu(currentRoom);
      }
      const scrolls = palaceGetScrolls(kernel, kernel.currentWorkspace!, target.slug, { limit: 10 });
      _palaceNavigate(ctx, target.slug, target);
      return _renderRoom(target, scrolls);
    }
    if (action === 95) {
      if (params === "repair") return _palaceRepair(kernel.currentWorkspace!);
      return _palaceHealth(kernel.currentWorkspace!, ctx.palace_current_slug);
    }
    if (action === 96) {
      if (ctx.palace_nav_history.length === 0) throw new Error("No navigation history. You're at the starting room.");
      const prevSlug = ctx.palace_nav_history.pop()!;
      const prevRoom = palaceGetRoom(kernel, kernel.currentWorkspace!, prevSlug);
      if (!prevRoom) throw new Error(`Previous room "${prevSlug}" no longer exists.`);
      ctx.palace_current_slug = prevSlug;
      ctx.palace_action_menu = prevRoom.actions;
      ctx.palace_last_results = [];
      const scrolls = palaceGetScrolls(kernel, kernel.currentWorkspace!, prevSlug, { limit: 10 });
      return _renderRoom(prevRoom, scrolls);
    }
    if (action === 97) {
      if (!params) throw new Error("Delete requires a room slug. Use palace_action({ action: 97, params: \"room-slug\" }) or verb: \"delete room-slug\". Use action 0 (map) to see room slugs.");
      if (params === ctx.palace_current_slug) throw new Error("Cannot delete the room you are currently in. Navigate away first.");
      palaceDeleteRoom(kernel, kernel.currentWorkspace!, params);
      const currentRoom = palaceGetRoom(kernel, kernel.currentWorkspace!, ctx.palace_current_slug)!;
      const scrollsResult = palaceGetScrolls(kernel, kernel.currentWorkspace!, ctx.palace_current_slug, { limit: 10 });
      return `Deleted room '${params}'. Portals and scrolls cleaned up.\n\n${_renderActionMenu(currentRoom, scrollsResult.scrolls, { totalScrolls: scrollsResult.total, hasHistory: ctx.palace_nav_history.length > 0 })}`;
    }

    // Room-specific actions (1-indexed)
    const menu = ctx.palace_action_menu;
    if (!menu || action < 1 || action > menu.length) throw new Error(`Invalid action: ${action}. This room has ${menu?.length ?? 0} custom action${menu?.length === 1 ? "" : "s"} (1-${menu?.length ?? 0}). Global actions: 0=map, 61-80=entity drilldown, 81-90=read scroll, 91=inventory, 92=write scroll, 93=search, 94=teleport, 95=health, 96=back, 97=delete room. Or use a verb: "go", "look", "examine", "talk", "search", "back", "map", "inventory".`);
    const act = menu[action - 1];

    switch (act.type) {
      case "navigate": {
        // Cross-workspace portal
        if (act.workspace) {
          const targetWsId = findWorkspaceByName(kernel, act.workspace);
          if (!targetWsId) return `Workspace "${act.workspace}" not found. Create it with set_workspace.`;
          kernel.currentWorkspace = targetWsId;
          if (_currentSessionId) {
            const sessionCtx = _getSessionContext();
            sessionCtx.workspace_id = targetWsId;
          }
          const targetRoom = palaceGetRoom(kernel, targetWsId, act.room!);
          if (!targetRoom) {
            return _renderUnfinishedRoom(act.room!, targetWsId, ctx.palace_current_slug);
          }
          const scrolls = palaceGetScrolls(kernel, targetWsId, targetRoom.slug, { limit: 10 });
          _palaceNavigate(ctx, targetRoom.slug, targetRoom);
          return _renderRoom(targetRoom, scrolls);
        }
        const targetRoom = palaceGetRoom(kernel, kernel.currentWorkspace!, act.room!);
        if (!targetRoom) {
          return _renderUnfinishedRoom(act.room!, kernel.currentWorkspace!, ctx.palace_current_slug);
        }
        const scrolls = palaceGetScrolls(kernel, kernel.currentWorkspace!, targetRoom.slug, { limit: 10 });
        _palaceNavigate(ctx, targetRoom.slug, targetRoom);
        return _renderRoom(targetRoom, scrolls);
      }
      case "query": {
        const result = await _executePalaceQuery(act.tool!, act.tool_params ?? {}, params);
        const currentRoom = palaceGetRoom(kernel, kernel.currentWorkspace!, ctx.palace_current_slug);
        const scrollsResult = palaceGetScrolls(kernel, kernel.currentWorkspace!, ctx.palace_current_slug, { limit: 10 });
        return `${act.label}:\n\n${result}\n\n${_renderActionMenu(currentRoom!, scrollsResult.scrolls, { totalScrolls: scrollsResult.total, queryResults: ctx.palace_last_results, hasHistory: ctx.palace_nav_history.length > 0 })}`;
      }
      case "text": {
        const currentRoom = palaceGetRoom(kernel, kernel.currentWorkspace!, ctx.palace_current_slug);
        const content = act.content || `[This action ("${act.label}") has no content yet. Rebuild the room to add it.]`;
        return content + "\n\n" + _renderActionMenu(currentRoom!);
      }
      default:
        throw new Error(`Unknown action type: ${JSON.stringify((act as any).type)} on action "${act.label}". Valid types: navigate, query, text. Use palace_action(inspect=true) to see raw action definitions, or rebuild the room with build_room(merge=true) to fix.`);
    }
  },
});

// --- OAuth route handlers ---

function handleProtectedResource(_req: Request): Response {
  return Response.json({
    resource: ORIGIN,
    authorization_servers: [ORIGIN],
    bearer_methods_supported: ["header"],
  });
}

function handleAuthServerMeta(_req: Request): Response {
  return Response.json({
    issuer: ORIGIN,
    authorization_endpoint: `${ORIGIN}/authorize`,
    token_endpoint: `${ORIGIN}/token`,
    registration_endpoint: `${ORIGIN}/register`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    token_endpoint_auth_methods_supported: ["none"],
    code_challenge_methods_supported: ["S256"],
  });
}

function handleRegister(req: Request): Response | Promise<Response> {
  return (async () => {
    const body = await req.json() as {
      client_name?: string;
      redirect_uris?: string[];
      grant_types?: string[];
      response_types?: string[];
      token_endpoint_auth_method?: string;
    };

    if (!body.redirect_uris || body.redirect_uris.length === 0) {
      return Response.json({ error: "redirect_uris required" }, { status: 400 });
    }

    for (const uri of body.redirect_uris) {
      if (!uri.startsWith("https://") && !uri.startsWith("http://localhost")) {
        return Response.json({ error: "redirect_uris must use HTTPS" }, { status: 400 });
      }
    }

    const clientId = crypto.randomUUID();
    const grantTypes = body.grant_types ?? ["authorization_code", "refresh_token"];
    const responseTypes = body.response_types ?? ["code"];

    kernel.db.run(
      "INSERT INTO oauth_clients (client_id, client_name, redirect_uris, grant_types, response_types, token_endpoint_auth_method) VALUES (?, ?, ?, ?, ?, ?)",
      [
        clientId,
        body.client_name ?? "unnamed",
        JSON.stringify(body.redirect_uris),
        JSON.stringify(grantTypes),
        JSON.stringify(responseTypes),
        body.token_endpoint_auth_method ?? "none",
      ]
    );

    return Response.json({
      client_id: clientId,
      client_name: body.client_name ?? "unnamed",
      redirect_uris: body.redirect_uris,
      grant_types: grantTypes,
      response_types: responseTypes,
      token_endpoint_auth_method: body.token_endpoint_auth_method ?? "none",
    }, { status: 201 });
  })();
}

function handleAuthorizeGet(req: Request): Response {
  const url = new URL(req.url);
  const clientId = url.searchParams.get("client_id");
  const redirectUri = url.searchParams.get("redirect_uri");
  const responseType = url.searchParams.get("response_type");
  const codeChallenge = url.searchParams.get("code_challenge");
  const codeChallengeMethod = url.searchParams.get("code_challenge_method");
  const state = url.searchParams.get("state") ?? "";
  const resource = url.searchParams.get("resource") ?? "";

  if (!clientId || !redirectUri || responseType !== "code" || !codeChallenge || codeChallengeMethod !== "S256") {
    return new Response("Invalid authorization request: missing or invalid parameters", { status: 400 });
  }

  const client = kernel.db.query("SELECT * FROM oauth_clients WHERE client_id = ?").get(clientId) as any;
  if (!client) {
    return new Response("Unknown client_id", { status: 400 });
  }

  const registeredUris: string[] = JSON.parse(client.redirect_uris);
  if (!registeredUris.includes(redirectUri)) {
    return new Response("redirect_uri mismatch", { status: 400 });
  }

  const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Smaragda — Authorize</title>
<style>
  body { font-family: system-ui, sans-serif; max-width: 400px; margin: 80px auto; padding: 0 20px; }
  h1 { font-size: 1.3rem; }
  label { display: block; margin: 16px 0 4px; font-weight: 500; }
  input[type=password] { width: 100%; padding: 8px; box-sizing: border-box; font-size: 1rem; }
  .buttons { margin-top: 20px; display: flex; gap: 12px; }
  button { padding: 10px 24px; font-size: 1rem; border: 1px solid #ccc; border-radius: 4px; cursor: pointer; }
  button[name=action][value=approve] { background: #2563eb; color: white; border-color: #2563eb; }
</style>
</head><body>
<h1>Authorize ${escapeHtml(client.client_name)}</h1>
<p>This application is requesting access to your Smaragda server.</p>
<form method="POST" action="/authorize">
  <input type="hidden" name="client_id" value="${escapeHtml(clientId)}">
  <input type="hidden" name="redirect_uri" value="${escapeHtml(redirectUri)}">
  <input type="hidden" name="response_type" value="code">
  <input type="hidden" name="code_challenge" value="${escapeHtml(codeChallenge)}">
  <input type="hidden" name="code_challenge_method" value="S256">
  <input type="hidden" name="state" value="${escapeHtml(state)}">
  <input type="hidden" name="resource" value="${escapeHtml(resource)}">
  <label for="password">Password</label>
  <input type="password" id="password" name="password" required autofocus>
  <div class="buttons">
    <button type="submit" name="action" value="approve">Approve</button>
    <button type="submit" name="action" value="deny">Deny</button>
  </div>
</form>
</body></html>`;

  return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function handleAuthorizePost(req: Request): Response | Promise<Response> {
  return (async () => {
    const body = new URLSearchParams(await req.text());
    const action = body.get("action");
    const clientId = body.get("client_id") ?? "";
    const redirectUri = body.get("redirect_uri") ?? "";
    const codeChallenge = body.get("code_challenge") ?? "";
    const state = body.get("state") ?? "";
    const resource = body.get("resource") ?? "";
    const password = body.get("password") ?? "";

    const redirectBase = `${redirectUri}${redirectUri.includes("?") ? "&" : "?"}`;

    if (action === "deny") {
      return Response.redirect(`${redirectBase}error=access_denied${state ? `&state=${encodeURIComponent(state)}` : ""}`, 302);
    }

    if (!OAUTH_PASSWORD || password !== OAUTH_PASSWORD) {
      return Response.redirect(`${redirectBase}error=access_denied${state ? `&state=${encodeURIComponent(state)}` : ""}`, 302);
    }

    const code = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();

    kernel.db.run(
      "INSERT INTO oauth_codes (code, client_id, redirect_uri, code_challenge, code_challenge_method, resource, expires_at) VALUES (?, ?, ?, ?, 'S256', ?, ?)",
      [code, clientId, redirectUri, codeChallenge, resource || null, expiresAt]
    );

    return Response.redirect(
      `${redirectBase}code=${encodeURIComponent(code)}${state ? `&state=${encodeURIComponent(state)}` : ""}`,
      302
    );
  })();
}

function handleToken(req: Request): Response | Promise<Response> {
  return (async () => {
    const body = new URLSearchParams(await req.text());
    const grantType = body.get("grant_type");

    if (grantType === "authorization_code") {
      const code = body.get("code") ?? "";
      const codeVerifier = body.get("code_verifier") ?? "";
      const clientId = body.get("client_id") ?? "";
      const redirectUri = body.get("redirect_uri") ?? "";

      const row = kernel.db.query(
        "SELECT * FROM oauth_codes WHERE code = ? AND used = 0 AND expires_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now')"
      ).get(code) as any;

      if (!row) {
        return Response.json({ error: "invalid_grant", error_description: "Invalid or expired code" }, { status: 400 });
      }

      if (row.client_id !== clientId || row.redirect_uri !== redirectUri) {
        return Response.json({ error: "invalid_grant", error_description: "Client/redirect mismatch" }, { status: 400 });
      }

      if (!await verifyPkce(codeVerifier, row.code_challenge)) {
        return Response.json({ error: "invalid_grant", error_description: "PKCE verification failed" }, { status: 400 });
      }

      // Mark code as used
      kernel.db.run("UPDATE oauth_codes SET used = 1 WHERE code = ?", [code]);

      // Issue tokens
      const accessToken = crypto.randomUUID();
      const refreshToken = crypto.randomUUID();
      const accessExpires = new Date(Date.now() + 60 * 60 * 1000).toISOString();
      const refreshExpires = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

      kernel.db.run(
        "INSERT INTO oauth_tokens (token, token_type, client_id, resource, expires_at, refresh_token_id) VALUES (?, 'access', ?, ?, ?, ?)",
        [accessToken, clientId, row.resource, accessExpires, refreshToken]
      );
      kernel.db.run(
        "INSERT INTO oauth_tokens (token, token_type, client_id, resource, expires_at) VALUES (?, 'refresh', ?, ?, ?)",
        [refreshToken, clientId, row.resource, refreshExpires]
      );

      return Response.json({
        access_token: accessToken,
        token_type: "bearer",
        expires_in: 3600,
        refresh_token: refreshToken,
      });
    }

    if (grantType === "refresh_token") {
      const refreshTokenValue = body.get("refresh_token") ?? "";
      const clientId = body.get("client_id") ?? "";

      const row = kernel.db.query(
        "SELECT * FROM oauth_tokens WHERE token = ? AND token_type = 'refresh' AND revoked = 0 AND expires_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now')"
      ).get(refreshTokenValue) as any;

      if (!row) {
        return Response.json({ error: "invalid_grant", error_description: "Invalid or expired refresh token" }, { status: 400 });
      }

      if (row.client_id !== clientId) {
        return Response.json({ error: "invalid_grant", error_description: "Client mismatch" }, { status: 400 });
      }

      // Revoke old refresh token and linked access tokens
      kernel.db.run("UPDATE oauth_tokens SET revoked = 1 WHERE token = ?", [refreshTokenValue]);
      kernel.db.run("UPDATE oauth_tokens SET revoked = 1 WHERE refresh_token_id = ?", [refreshTokenValue]);

      // Issue new pair
      const newAccessToken = crypto.randomUUID();
      const newRefreshToken = crypto.randomUUID();
      const accessExpires = new Date(Date.now() + 60 * 60 * 1000).toISOString();
      const refreshExpires = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

      kernel.db.run(
        "INSERT INTO oauth_tokens (token, token_type, client_id, resource, expires_at, refresh_token_id) VALUES (?, 'access', ?, ?, ?, ?)",
        [newAccessToken, clientId, row.resource, accessExpires, newRefreshToken]
      );
      kernel.db.run(
        "INSERT INTO oauth_tokens (token, token_type, client_id, resource, expires_at) VALUES (?, 'refresh', ?, ?, ?)",
        [newRefreshToken, clientId, row.resource, refreshExpires]
      );

      return Response.json({
        access_token: newAccessToken,
        token_type: "bearer",
        expires_in: 3600,
        refresh_token: newRefreshToken,
      });
    }

    return Response.json({ error: "unsupported_grant_type" }, { status: 400 });
  })();
}

// --- HTTP transport with auth ---

const transport = mcp.httpTransport();

async function authedTransport(req: Request): Promise<Response> {
  const denied = requireAuth(req);
  if (denied) return denied;
  return transport(req);
}

async function deleteSession(req: Request): Promise<Response> {
  const denied = requireAuth(req);
  if (denied) return denied;
  const sessionId = req.headers.get("mcp-session-id");
  if (sessionId) sessions.delete(sessionId);
  return new Response(null, { status: 200 });
}

// --- Sync helpers ---

function resolveOrCreateDevice(deviceId: string): string {
  const deviceGenusId = findGenusByName(kernel, "Device")!;
  const entities = listEntities(kernel, { genus_id: deviceGenusId });
  for (const e of entities) {
    if ((e.state.name as string) === deviceId) return e.id;
  }
  const id = createEntity(kernel, deviceGenusId);
  setAttribute(kernel, id, "name", deviceId);
  return id;
}

async function handleSyncPull(req: Request): Promise<Response> {
  const denied = requireAuth(req);
  if (denied) return denied;

  const body = await req.json() as { since?: number; device_id?: string };
  const since = body.since ?? 0;
  const deviceId = body.device_id ?? "unknown";

  const deviceResId = resolveOrCreateDevice(deviceId);

  const sentinels = [META_GENUS_ID, LOG_GENUS_ID, ERROR_GENUS_ID, TASK_GENUS_ID, BRANCH_GENUS_ID];
  const deviceSource = `device:${deviceId}`;

  const rows = kernel.db.query(
    `SELECT * FROM tessella WHERE id > ? AND res_id NOT IN (?, ?, ?, ?) AND (source IS NULL OR source != ?) ORDER BY id ASC`,
  ).all(since, ...sentinels, deviceSource) as any[];

  const tessellae = rows.map((r: any) => ({
    id: r.id,
    res_id: r.res_id,
    branch_id: r.branch_id,
    type: r.type,
    data: JSON.parse(r.data),
    created_at: r.created_at,
    source: r.source,
  }));

  // Collect distinct res_ids, excluding sentinels
  const resIds = [...new Set(tessellae.map((t: any) => t.res_id))].filter(
    (id) => !sentinels.includes(id),
  );
  const resRows = resIds.map((id) => {
    const row = kernel.db.query("SELECT * FROM res WHERE id = ?").get(id) as any;
    return row ? { id: row.id, genus_id: row.genus_id, branch_id: row.branch_id, created_at: row.created_at } : null;
  }).filter((r): r is NonNullable<typeof r> => r !== null);

  // Also include genus res for any non-sentinel genus_ids so the client gets genus definitions
  const genusIds = [...new Set(resRows.map((r) => r.genus_id))].filter(
    (id) => !sentinels.includes(id) && !resIds.includes(id),
  );
  for (const gid of genusIds) {
    const row = kernel.db.query("SELECT * FROM res WHERE id = ?").get(gid) as any;
    if (row) {
      resRows.push({ id: row.id, genus_id: row.genus_id, branch_id: row.branch_id, created_at: row.created_at });
      // Also include genus tessellae
      const genusTessellae = kernel.db.query(
        "SELECT * FROM tessella WHERE res_id = ? ORDER BY id ASC",
      ).all(gid) as any[];
      for (const gt of genusTessellae) {
        tessellae.push({
          id: gt.id,
          res_id: gt.res_id,
          branch_id: gt.branch_id,
          type: gt.type,
          data: JSON.parse(gt.data),
          created_at: gt.created_at,
          source: gt.source,
        });
      }
    }
  }

  const hwm = rows.length > 0 ? rows[rows.length - 1].id : since;

  // Update device last_sync_at
  setAttribute(kernel, deviceResId, "last_sync_at", new Date().toISOString());

  return Response.json({ res: resRows, tessellae, high_water_mark: hwm });
}

async function handleSyncPush(req: Request): Promise<Response> {
  const denied = requireAuth(req);
  if (denied) return denied;

  const body = await req.json() as {
    device_id?: string;
    res?: { id: string; genus_id: string; branch_id: string; created_at?: string }[];
    tessellae?: { res_id: string; branch_id: string; type: string; data: any; created_at: string; source: string | null }[];
  };
  const deviceId = body.device_id ?? "unknown";
  const deviceSource = `device:${deviceId}`;

  const deviceResId = resolveOrCreateDevice(deviceId);

  const resData = body.res ?? [];
  const tessData = body.tessellae ?? [];

  const doInsert = kernel.db.transaction(() => {
    for (const r of resData) {
      kernel.db.run(
        "INSERT OR IGNORE INTO res (id, genus_id, branch_id, created_at) VALUES (?, ?, ?, ?)",
        [r.id, r.genus_id, r.branch_id, r.created_at ?? new Date().toISOString()],
      );
    }
    for (const t of tessData) {
      kernel.db.run(
        "INSERT INTO tessella (res_id, branch_id, type, data, created_at, source) VALUES (?, ?, ?, ?, ?, ?)",
        [t.res_id, t.branch_id, t.type, JSON.stringify(t.data), t.created_at, deviceSource],
      );
    }
  });
  doInsert();

  const maxRow = kernel.db.query("SELECT MAX(id) as max_id FROM tessella").get() as { max_id: number };
  const hwm = maxRow.max_id ?? 0;

  // Update device last_sync_at
  setAttribute(kernel, deviceResId, "last_sync_at", new Date().toISOString());

  return Response.json({ accepted: tessData.length, high_water_mark: hwm });
}

// --- Token cleanup (every hour) ---

setInterval(() => {
  kernel.db.run("DELETE FROM oauth_codes WHERE used = 1 OR expires_at <= strftime('%Y-%m-%dT%H:%M:%fZ', 'now')");
  kernel.db.run("DELETE FROM oauth_tokens WHERE revoked = 1 OR expires_at <= strftime('%Y-%m-%dT%H:%M:%fZ', 'now')");
}, 60 * 60 * 1000);

// --- Cron tick (every 60 seconds) ---

setInterval(() => {
  try { tickCron(kernel); } catch (e) { console.error("Cron tick error:", e); }
}, 60_000);

// --- Palace Web UI ---

function _escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// Unescape strings that contain literal JSON escape sequences (e.g. \\n, \\u2014).
// This happens when an agent sends a JSON-encoded string as a tool parameter value,
// resulting in double-encoding: the description gets stored with literal backslash-n
// and backslash-u sequences instead of real newlines and Unicode characters.
function _unescapeJsonString(s: string): string {
  // If string is wrapped in quotes, it's a JSON-stringified string — parse it directly
  if (s.startsWith('"') && s.endsWith('"')) {
    try { return JSON.parse(s); } catch {}
  }
  // Detect literal \n, \t, \r, or \uXXXX sequences and replace them
  if (/\\n|\\u[0-9a-fA-F]{4}|\\t|\\r/.test(s)) {
    return s
      .replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
      .replace(/\\n/g, '\n')
      .replace(/\\t/g, '\t')
      .replace(/\\r/g, '\r');
  }
  return s;
}

function _escapeAndFormatHtml(s: string): string {
  return _escapeHtml(_unescapeJsonString(s)).replace(/\n/g, '<br>');
}

function _markupToHtml(tokens: ReturnType<typeof palaceParseMarkup>, manifest: PalaceRoomManifest | null): string {
  if (!manifest) {
    // No markup — just escape the plain text and convert newlines to <br>
    return _escapeAndFormatHtml(tokens.map(t => t.type === "text" ? t.value : "").join(""));
  }
  let entityIdx = 0;
  let portalIdx = 0;
  const parts: string[] = [];
  for (const token of tokens) {
    if (token.type === "text") {
      parts.push(_escapeAndFormatHtml(token.value));
    } else if (token.type === "entity_ref") {
      const entry = manifest.entries.filter(e => e.kind === "entity")[entityIdx++];
      if (entry?.entity_id) {
        parts.push(`<span class="entity-ref" data-id="${_escapeHtml(entry.entity_id)}">${_escapeHtml(entry.display)}</span>`);
      } else {
        parts.push(`<span class="entity-ref unresolved">${_escapeHtml(entry?.display ?? token.name)}</span>`);
      }
    } else if (token.type === "portal_ref") {
      const entry = manifest.entries.filter(e => e.kind === "portal")[portalIdx++];
      parts.push(`<span class="portal-ref" data-slug="${_escapeHtml(entry?.slug ?? token.slug)}">${_escapeHtml(entry?.display ?? token.prose)}</span>`);
    }
  }
  return parts.join("");
}

function _palaceApiJson(data: unknown, status = 200): Response {
  return Response.json(data, {
    status,
    headers: { "Access-Control-Allow-Origin": "*" },
  });
}

function _palaceGlanceJson(entityId: string): Record<string, unknown> {
  const state = materialize(kernel, entityId, { branch_id: kernel.currentBranch });
  const resRow = getRes(kernel, entityId);
  const genusDef = getGenusDef(kernel, resRow.genus_id);
  const genusName = (genusDef.meta.name as string) ?? "Unknown";
  const templates = getGenusTemplates(kernel, resRow.genus_id);
  const name = getEntityDisplayName(kernel, entityId);
  const attrs: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(state)) {
    if (["name", "title", "status", "genus_id"].includes(key)) continue;
    if (val == null || typeof val === "object") continue;
    attrs[key] = val;
  }
  return {
    id: entityId,
    name,
    genus_name: genusName,
    status: (state.status as string) ?? "unknown",
    attributes: attrs,
    template: templates.glance ? renderTemplate(templates.glance, state, { genus_name: genusName, id: entityId }) : null,
  };
}

function _palaceInspectJson(entityId: string): Record<string, unknown> {
  const state = materialize(kernel, entityId, { branch_id: kernel.currentBranch });
  const resRow = getRes(kernel, entityId);
  const genusDef = getGenusDef(kernel, resRow.genus_id);
  const genusName = (genusDef.meta.name as string) ?? "Unknown";
  const templates = getGenusTemplates(kernel, resRow.genus_id);
  const name = (state.name as string) ?? (state.title as string) ?? entityId;
  const rels = getRelationshipsForEntity(kernel, entityId);
  const relationships = rels.map(r => {
    const memberParts: Record<string, string[]> = {};
    for (const [role, ids] of Object.entries(r.members)) {
      memberParts[role] = ids.map(eid => {
        const s = materialize(kernel, eid, { branch_id: kernel.currentBranch });
        return (s.name as string) ?? eid;
      });
    }
    return { genus_name: r.genus_name, members: memberParts };
  });
  return {
    id: entityId,
    name,
    genus_name: genusName,
    status: (state.status as string) ?? "unknown",
    state,
    relationships,
    template: templates.inspect ? renderTemplate(templates.inspect, state, { genus_name: genusName, id: entityId }) : null,
  };
}

async function handlePalaceApi(req: Request, url: URL): Promise<Response> {
  if (req.method !== "GET") return _palaceApiJson({ error: "Method not allowed" }, 405);

  const parts = url.pathname.replace(/^\/palace\/api\//, "").split("/").filter(Boolean);

  // /palace/api/workspaces
  if (parts.length === 1 && parts[0] === "workspaces") {
    const ws = listWorkspaces(kernel);
    const result = ws.map(w => {
      const roomCount = palaceListRooms(kernel, w.id).length;
      return { id: w.id, name: w.name, room_count: roomCount };
    });
    return _palaceApiJson(result);
  }

  // All remaining endpoints need a workspace ID
  if (parts.length < 2) return _palaceApiJson({ error: "Not found" }, 404);
  const wsId = decodeURIComponent(parts[0]);
  const savedWorkspace = kernel.currentWorkspace;
  kernel.currentWorkspace = wsId;

  try {
    // /palace/api/:ws/rooms
    if (parts.length === 2 && parts[1] === "rooms") {
      const rooms = palaceListRooms(kernel, wsId);
      return _palaceApiJson(rooms.map(r => ({
        slug: r.slug, name: r.name, entry: r.entry,
        portal_count: r.portals.length, updated_at: r.updated_at,
      })));
    }

    // /palace/api/:ws/room/:slug
    if (parts.length === 3 && parts[1] === "room") {
      const slug = decodeURIComponent(parts[2]);
      const room = palaceGetRoom(kernel, wsId, slug);
      if (!room) return _palaceApiJson({ error: "Room not found" }, 404);

      const tokens = palaceParseMarkup(room.description);
      const hasMarkup = tokens.some(t => t.type !== "text");
      const manifest = hasMarkup ? palaceResolveMarkup(kernel, wsId, tokens) : null;
      const descriptionHtml = _markupToHtml(tokens, manifest);

      const manifestEntities = manifest?.entries.filter(e => e.kind === "entity") ?? [];
      const manifestPortals = manifest?.entries.filter(e => e.kind === "portal") ?? [];

      const scrollsResult = palaceGetScrolls(kernel, wsId, slug, { limit: 10 });

      // Notices
      const notices: string[] = [];
      const processes = listProcesses(kernel, { status: "running" });
      for (const proc of processes) {
        notices.push(`Process: ${proc.process_name} (${proc.step_summary.completed}/${proc.step_summary.total} steps)`);
      }
      const unhealthy = listUnhealthy(kernel, { only_workspace: true });
      if (unhealthy.length > 0) {
        notices.push(`${unhealthy.length} unhealthy entit${unhealthy.length === 1 ? "y" : "ies"}`);
      }
      const tasks = listTasks(kernel);
      const pendingTasks = tasks.filter(t => {
        if (t.status !== "pending" && t.status !== "claimed") return false;
        const row = kernel.db.query("SELECT workspace_id FROM res WHERE id = ?").get(t.id) as any;
        return row && row.workspace_id === wsId;
      });
      if (pendingTasks.length > 0) {
        notices.push(`${pendingTasks.length} pending task${pendingTasks.length === 1 ? "" : "s"}`);
      }

      const npcsInRoom = palaceListNPCsInRoom(kernel, wsId, slug);

      return _palaceApiJson({
        room: {
          slug: room.slug, name: room.name, description_html: descriptionHtml,
          entry: room.entry, portals: room.portals, updated_at: room.updated_at,
        },
        manifest: {
          entities: manifestEntities.map(e => ({
            display: e.display, genus_name: e.genus_name, entity_id: e.entity_id, resolved: e.resolved,
          })),
          portals: manifestPortals.map(e => ({ display: e.display, slug: e.slug })),
          all: manifest?.entries ?? [],
        },
        scrolls: scrollsResult.scrolls.map(s => ({
          id: s.id, title: s.title, body: s.body, created_at: s.created_at,
        })),
        notices,
        actions: room.actions.map((a, i) => ({ index: i + 1, label: a.label, type: a.type, room: a.room, content: a.content, tool: a.tool, tool_params: a.tool_params })),
        npcs: npcsInRoom.map(n => ({ slug: n.slug, name: n.name, description: n.description })),
      });
    }

    // /palace/api/:ws/npc/:slug
    if (parts.length === 3 && parts[1] === "npc") {
      const npcSlug = decodeURIComponent(parts[2]);
      const npc = palaceGetNPC(kernel, wsId, npcSlug);
      if (!npc) return _palaceApiJson({ error: "NPC not found" }, 404);
      return _palaceApiJson({
        slug: npc.slug, name: npc.name, description: _unescapeJsonString(npc.description),
        room_slug: npc.room_slug, greeting: _unescapeJsonString(npc.greeting),
        dialogue: npc.dialogue.map(n => ({
          ...n,
          text: _unescapeJsonString(n.text),
          prompt: _unescapeJsonString(n.prompt),
        })),
      });
    }

    // /palace/api/:ws/npc/:slug/talk
    if (parts.length === 4 && parts[1] === "npc" && parts[3] === "talk") {
      const npcSlug = decodeURIComponent(parts[2]);
      const npc = palaceGetNPC(kernel, wsId, npcSlug);
      if (!npc) return _palaceApiJson({ error: "NPC not found" }, 404);
      const visibleOpts = _getVisibleOptions(npc.dialogue, null, []);
      return _palaceApiJson({
        npc_name: npc.name, greeting: _unescapeJsonString(npc.greeting),
        options: visibleOpts.map(o => ({ ...o, prompt: _unescapeJsonString(o.prompt) })),
        tags: [],
      });
    }

    // /palace/api/:ws/npc/:slug/respond?node=X&tags=a,b,c
    if (parts.length === 4 && parts[1] === "npc" && parts[3] === "respond") {
      const npcSlug = decodeURIComponent(parts[2]);
      const npc = palaceGetNPC(kernel, wsId, npcSlug);
      if (!npc) return _palaceApiJson({ error: "NPC not found" }, 404);

      const nodeId = url.searchParams.get("node");
      const tagsParam = url.searchParams.get("tags") ?? "";
      const tags = tagsParam ? tagsParam.split(",").filter(Boolean) : [];

      const node = npc.dialogue.find(n => n.id === nodeId);
      if (!node) return _palaceApiJson({ error: "Dialogue node not found" }, 404);

      // Add unlocks
      const newTags = [...tags];
      if (node.unlocks) {
        for (const t of node.unlocks) {
          if (!newTags.includes(t)) newTags.push(t);
        }
      }

      // Fetch entity
      let entity: Record<string, unknown> | null = null;
      if (node.entity_id) {
        try { entity = _palaceGlanceJson(node.entity_id); }
        catch { entity = null; }
      }

      const options = _getVisibleOptions(npc.dialogue, node.id, newTags);
      return _palaceApiJson({
        text: _unescapeJsonString(node.text), entity, new_tags: newTags,
        options: options.map(o => ({ ...o, prompt: _unescapeJsonString(o.prompt) })),
      });
    }

    // /palace/api/:ws/entity/:id
    if (parts.length === 3 && parts[1] === "entity") {
      const entityId = decodeURIComponent(parts[2]);
      try {
        return _palaceApiJson(_palaceGlanceJson(entityId));
      } catch { return _palaceApiJson({ error: "Entity not found" }, 404); }
    }

    // /palace/api/:ws/entity/:id/inspect
    if (parts.length === 4 && parts[1] === "entity" && parts[3] === "inspect") {
      const entityId = decodeURIComponent(parts[2]);
      try {
        return _palaceApiJson(_palaceInspectJson(entityId));
      } catch { return _palaceApiJson({ error: "Entity not found" }, 404); }
    }

    // /palace/api/:ws/entity/:id/relationships
    if (parts.length === 4 && parts[1] === "entity" && parts[3] === "relationships") {
      const entityId = decodeURIComponent(parts[2]);
      try {
        const rels = getRelationshipsForEntity(kernel, entityId);
        const result = rels.map(rel => ({
          id: rel.id, genus_name: rel.genus_name,
          members: Object.fromEntries(
            Object.entries(rel.members).map(([role, ids]) => [role, (ids as string[]).map(mid => {
              try { const s = materialize(kernel, mid); return { id: mid, name: (s.name as string) ?? (s.title as string) ?? mid }; }
              catch { return { id: mid, name: mid }; }
            })]),
          ),
        }));
        return _palaceApiJson({ relationships: result });
      } catch { return _palaceApiJson({ error: "Entity not found" }, 404); }
    }

    // /palace/api/:ws/search?q=
    if (parts.length === 2 && parts[1] === "search") {
      const q = url.searchParams.get("q") ?? "";
      if (!q) return _palaceApiJson([]);
      const results = palaceSearch(kernel, wsId, q);
      return _palaceApiJson(results);
    }

    // /palace/api/:ws/entities/search?q=&limit=
    if (parts.length === 3 && parts[1] === "entities" && parts[2] === "search") {
      const q = url.searchParams.get("q") ?? "";
      const limitParam = url.searchParams.get("limit");
      const limit = limitParam ? parseInt(limitParam) : undefined;
      if (!q) return _palaceApiJson({ results: [] });
      const results = searchEntities(kernel, { query: q, limit });
      return _palaceApiJson({ results: results.map(e => ({
        id: e.id, name: getEntityDisplayName(kernel, e.id),
        genus: e.genus_name, status: e.state?.status ?? null,
      }))});
    }

    // /palace/api/:ws/entities?genus=&status=&limit=
    if (parts.length === 2 && parts[1] === "entities") {
      const genusName = url.searchParams.get("genus") || undefined;
      const status = url.searchParams.get("status") || undefined;
      const limitParam = url.searchParams.get("limit");
      const limit = limitParam ? parseInt(limitParam) : undefined;
      try {
        const genusId = genusName ? resolveGenusId(genusName) : undefined;
        const entities = listEntities(kernel, { genus_id: genusId, status, only_workspace: true });
        const sliced = limit ? entities.slice(0, limit) : entities;
        const result = sliced.map(e => {
          const genusDef = getGenusDef(kernel, e.genus_id);
          return { id: e.id, genus: genusDef.meta.name, status: e.state.status ?? null, name: getEntityDisplayName(kernel, e.id) };
        });
        return _palaceApiJson({ entities: result, total: entities.length, showing: result.length });
      } catch (e: any) {
        return _palaceApiJson({ error: e.message ?? "Failed to list entities" }, 400);
      }
    }

    // /palace/api/:ws/system
    if (parts.length === 2 && parts[1] === "system") {
      const workspaceTaxIds = kernel.currentWorkspace ? getWorkspaceTaxonomyIds(kernel, kernel.currentWorkspace) : [];
      const hasScienceScope = workspaceTaxIds.length > 0;
      const taxFilter = hasScienceScope ? (taxId: string | undefined) => workspaceTaxIds.includes(taxId ?? DEFAULT_TAXONOMY_ID) : () => true;
      const onlyWs = hasScienceScope;
      const genera = hasScienceScope ? listGenera(kernel).filter(g => taxFilter(g.def.meta.taxonomy_id as string | undefined)) : listGenera(kernel);
      const generaWithCounts = genera.map(g => ({ name: g.name, entity_count: listEntities(kernel, { genus_id: g.id, only_workspace: onlyWs }).length })).filter(g => g.entity_count > 0);
      const activeGeneraNames = new Set(generaWithCounts.map(g => g.name));
      const relationshipGenera = hasScienceScope ? listRelationshipGenera(kernel).filter(g => taxFilter(g.def.meta.taxonomy_id as string | undefined)) : listRelationshipGenera(kernel);
      const featureGenera = hasScienceScope ? listFeatureGenera(kernel).filter(g => taxFilter(g.def.meta.taxonomy_id as string | undefined)) : listFeatureGenera(kernel);
      const actionGenera = hasScienceScope ? listActionGenera(kernel).filter(g => taxFilter(g.def.meta.taxonomy_id as string | undefined)) : listActionGenera(kernel);
      const allTasks = listTasks(kernel, { only_workspace: onlyWs });
      const taskCounts: Record<string, number> = { pending: 0, claimed: 0, completed: 0, cancelled: 0 };
      for (const t of allTasks) { if (t.status in taskCounts) taskCounts[t.status]++; }
      const allProcesses = listProcesses(kernel, { only_workspace: onlyWs });
      const processCounts: Record<string, number> = { running: 0, completed: 0, failed: 0, cancelled: 0 };
      for (const p of allProcesses) { if (p.status in processCounts) processCounts[p.status]++; }
      return _palaceApiJson({
        genera: generaWithCounts,
        relationship_genera: relationshipGenera.filter(g => listEntities(kernel, { genus_id: g.id }).length > 0).map(g => ({ name: g.name, roles: Object.values(g.def.roles).map(r => r.name) })),
        feature_genera: featureGenera.filter(g => activeGeneraNames.has(g.parent_genus_name)).map(g => ({ name: g.name, parent: g.parent_genus_name })),
        actions: actionGenera.filter(a => Object.values(a.def.resources).some(r => activeGeneraNames.has(r.genus_name))).map(a => ({ name: a.name, target_genus: Object.values(a.def.resources).map(r => r.genus_name) })),
        process_genera: listProcessGenera(kernel).filter(g => !hasScienceScope || taxFilter(g.def.meta.taxonomy_id as string | undefined)).map(g => ({ name: g.name })),
        tasks: taskCounts,
        processes: processCounts,
      });
    }

    // /palace/api/:ws/tasks
    if (parts.length === 2 && parts[1] === "tasks") {
      const tasks = listTasks(kernel, { only_workspace: true });
      return _palaceApiJson({ tasks });
    }

    // /palace/api/:ws/relationships?genus=&member=&limit=
    if (parts.length === 2 && parts[1] === "relationships") {
      const genusName = url.searchParams.get("genus") || undefined;
      const memberId = url.searchParams.get("member") || undefined;
      const limit = url.searchParams.get("limit") ? parseInt(url.searchParams.get("limit")!) : 20;
      try {
        const genusId = genusName ? resolveRelationshipGenusId(genusName) : undefined;
        const rels = listRelationships(kernel, { genus_id: genusId, member_entity_id: memberId, limit });
        const result = rels.map(rel => ({
          id: rel.id, genus: rel.genus_name, status: rel.state.status,
          members: Object.fromEntries(
            Object.entries(rel.members).map(([role, ids]) => [role, (ids as string[]).map(mid => {
              try { const s = materialize(kernel, mid); return { id: mid, name: (s.name as string) ?? (s.title as string) ?? mid }; }
              catch { return { id: mid, name: mid }; }
            })]),
          ),
        }));
        return _palaceApiJson({ relationships: result });
      } catch (e: any) {
        return _palaceApiJson({ error: e.message ?? "Failed to list relationships" }, 400);
      }
    }

    // /palace/api/:ws/processes?status=
    if (parts.length === 2 && parts[1] === "processes") {
      const status = url.searchParams.get("status") || undefined;
      const processes = listProcesses(kernel, { status, only_workspace: true });
      return _palaceApiJson({ processes });
    }

    // /palace/api/:ws/map
    if (parts.length === 2 && parts[1] === "map") {
      const rooms = palaceListRooms(kernel, wsId);
      return _palaceApiJson(rooms.map(r => ({
        slug: r.slug, name: r.name, entry: r.entry, portals: r.portals,
      })));
    }

    return _palaceApiJson({ error: "Not found" }, 404);
  } finally {
    kernel.currentWorkspace = savedWorkspace;
  }
}

function palaceFetchHandler(req: Request): Response | Promise<Response> {
  const url = new URL(req.url);
  if (url.pathname === "/palace" || url.pathname === "/palace/")
    return new Response(PALACE_HTML, { headers: { "Content-Type": "text/html; charset=utf-8" } });
  if (url.pathname.startsWith("/palace/api/"))
    return handlePalaceApi(req, url);
  return httpNotFound();
}

const PALACE_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Smaragda Palace</title>
<style>
:root {
  --bg: #B6967D;
  --bg-input: #A6866D;
  --bg-card: #C5A68E;
  --text: #354524;
  --gold: #FFDB41;
  --amber: #EBB600;
  --green: #A2F361;
  --pink: #FF1871;
  --cream: #FFF3EB;
  --muted: #7D5D7D;
  --mauve: #822020;
  --dark-green: #418220;
}
*, *::before, *::after { box-sizing: border-box; }
body {
  font-family: "Berkeley Mono", "JetBrains Mono", "Fira Code", ui-monospace, monospace;
  background: var(--bg); color: var(--text);
  margin: 0; padding: 0; line-height: 1.6;
  height: 100dvh; display: flex; flex-direction: column;
  font-size: 14px;
}
#header {
  background: var(--bg-input); padding: 8px 16px;
  display: flex; align-items: center; gap: 12px;
  border-bottom: 2px solid var(--dark-green);
  flex-shrink: 0;
}
#header h1 { margin: 0; font-size: 16px; color: var(--gold); white-space: nowrap; }
#ws-picker {
  background: var(--bg); color: var(--text); border: 1px solid var(--dark-green);
  font-family: inherit; font-size: 13px; padding: 4px 8px; border-radius: 4px;
  max-width: 200px;
}
#output {
  flex: 1; overflow-y: auto; padding: 12px 16px;
  display: flex; flex-direction: column; gap: 8px;
}
.block { white-space: pre-wrap; word-break: break-word; }
.block.faded { opacity: 0.45; }
.room-header { color: var(--gold); font-weight: bold; }
.room-desc { line-height: 1.7; }
.entity-ref { color: var(--cream); font-weight: bold; cursor: pointer; text-decoration: underline; text-decoration-style: dotted; }
.entity-ref:hover { color: #fff; }
.entity-ref.unresolved { opacity: 0.6; cursor: default; text-decoration: none; }
.portal-ref { color: var(--green); cursor: pointer; text-decoration: underline; text-decoration-style: dotted; }
.portal-ref:hover { color: #7f7; }
.manifest { color: var(--muted); font-size: 13px; }
.notice { color: var(--amber); }
.action-item { cursor: pointer; }
.action-item:hover { color: var(--cream); }
.action-num { color: var(--mauve); font-weight: bold; }
.scroll-item { color: var(--green); cursor: pointer; }
.scroll-item:hover { color: #7f7; }
.scroll-body { background: var(--bg-card); padding: 8px 12px; border-radius: 4px; margin: 4px 0; white-space: pre-wrap; }
.npc-item { cursor: pointer; color: var(--gold); padding: 2px 0; }
.npc-item:hover { text-decoration: underline; }
.npc-name { font-weight: bold; }
.npc-greeting { font-style: italic; color: var(--cream); white-space: pre-wrap; }
.dialogue-option { cursor: pointer; color: var(--amber); padding: 2px 0; }
.dialogue-option:hover { text-decoration: underline; }
.npc-response { color: var(--cream); margin: 8px 0; white-space: pre-wrap; }
.entity-card { border-left: 2px solid var(--gold); padding-left: 8px; margin: 8px 0; }
.glance-title { color: var(--cream); font-weight: bold; }
.glance-attr { color: var(--muted); }
.glance-attr .glance-val { color: #3D2B1F; }
.inspect-section { margin-top: 8px; }
.error-msg { color: var(--pink); }
.map-room { cursor: pointer; }
.map-room:hover { color: var(--cream); }
.map-entry { color: var(--gold); }
.search-result { cursor: pointer; }
.search-result:hover { color: var(--cream); }
.divider { color: var(--dark-green); }
.global-action { color: var(--muted); cursor: pointer; }
.global-action:hover { color: var(--cream); }
#input-bar {
  background: var(--bg-input); padding: 8px 16px;
  display: flex; gap: 8px; align-items: center;
  border-top: 2px solid var(--dark-green);
  flex-shrink: 0;
}
#cmd {
  flex: 1; background: var(--bg); color: var(--text);
  border: 1px solid var(--dark-green); font-family: inherit;
  font-size: 14px; padding: 8px 12px; border-radius: 4px;
  outline: none;
}
#cmd::placeholder { color: var(--muted); }
#cmd:focus { border-color: var(--gold); }
#send {
  background: var(--dark-green); color: var(--cream); border: none;
  font-family: inherit; font-size: 16px; padding: 8px 14px;
  border-radius: 4px; cursor: pointer;
}
#send:hover { background: var(--green); color: var(--text); }
.loading { color: var(--muted); font-style: italic; }
</style>
</head>
<body>
<div id="header">
  <h1>SMARAGDA</h1>
  <select id="ws-picker"><option value="">Loading...</option></select>
</div>
<div id="output"></div>
<div id="input-bar">
  <span style="color:var(--gold)">></span>
  <input type="text" id="cmd" placeholder="look, go, examine, search, map, back..." autofocus>
  <button id="send">\u25B6</button>
</div>
<script>
const $ = s => document.querySelector(s);
const API = '/palace/api';
const state = {
  workspace_id: null,
  workspace_name: null,
  current_slug: null,
  history: [],
  manifest: null,
  scrolls: [],
  actions: [],
  room: null,
};

function save() { try { sessionStorage.setItem('palace', JSON.stringify(state)); } catch {} }
function load() {
  try {
    const s = JSON.parse(sessionStorage.getItem('palace') || '{}');
    if (s.workspace_id) Object.assign(state, s);
  } catch {}
}

function updateHash() {
  if (state.workspace_name && state.current_slug) {
    location.hash = encodeURIComponent(state.workspace_name) + '/' + encodeURIComponent(state.current_slug);
  }
}

const output = $('#output');
let blockCount = 0;
const MAX_BLOCKS = 30;

function append(html, cls) {
  // Fade previous blocks
  const prev = output.querySelectorAll('.block:not(.faded)');
  prev.forEach(el => el.classList.add('faded'));
  const div = document.createElement('div');
  div.className = 'block' + (cls ? ' ' + cls : '');
  div.innerHTML = html;
  output.appendChild(div);
  blockCount++;
  while (blockCount > MAX_BLOCKS) {
    const first = output.querySelector('.block');
    if (first) { output.removeChild(first); blockCount--; } else break;
  }
  requestAnimationFrame(() => output.scrollTop = output.scrollHeight);
  return div;
}

function appendText(text) { append('<span>' + esc(text) + '</span>'); }

function esc(s) {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}
function escAttr(s) {
  return esc(s).replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

async function fetchJson(path) {
  const r = await fetch(API + path);
  if (!r.ok) throw new Error('API error: ' + r.status);
  return r.json();
}

// --- Workspace loading ---
async function loadWorkspaces() {
  const ws = await fetchJson('/workspaces');
  const picker = $('#ws-picker');
  picker.innerHTML = '<option value="">Select workspace...</option>';
  for (const w of ws) {
    const opt = document.createElement('option');
    opt.value = w.id; opt.textContent = w.name + (w.room_count > 0 ? '' : ' (no palace)');
    picker.appendChild(opt);
  }
  if (state.workspace_id) picker.value = state.workspace_id;
  return ws;
}

$('#ws-picker').addEventListener('change', async (e) => {
  const id = e.target.value;
  if (!id) return;
  const opt = e.target.selectedOptions[0];
  state.workspace_id = id;
  state.workspace_name = opt.textContent.replace(/ \\(no palace\\)$/, '');
  state.current_slug = null;
  state.history = [];
  save();
  await enterWorkspace();
});

async function enterWorkspace() {
  if (!state.workspace_id) return;
  try {
    const rooms = await fetchJson('/' + enc(state.workspace_id) + '/rooms');
    const entry = rooms.find(r => r.entry);
    if (entry) {
      await navigateToRoom(entry.slug);
    } else if (rooms.length > 0) {
      await navigateToRoom(rooms[0].slug);
    } else {
      append('<span class="loading">This workspace has no palace rooms.</span>');
    }
  } catch (err) {
    append('<span class="error-msg">Error: ' + esc(err.message) + '</span>');
  }
}

function enc(s) { return encodeURIComponent(s); }

// --- Room rendering ---
async function navigateToRoom(slug) {
  if (state.current_slug && state.current_slug !== slug) {
    state.history.push(state.current_slug);
    if (state.history.length > 50) state.history.shift();
  }
  state.current_slug = slug;
  save();
  updateHash();
  await renderRoom(slug);
}

async function renderRoom(slug) {
  try {
    const data = await fetchJson('/' + enc(state.workspace_id) + '/room/' + enc(slug));
    state.room = data.room;
    state.manifest = data.manifest;
    state.scrolls = data.scrolls;
    state.actions = data.actions;
    save();

    let html = '';
    html += '<div class="room-header">\\u2500\\u2500 ' + esc(data.room.name) + ' \\u2500\\u2500</div>';
    html += '<div class="room-desc">' + data.room.description_html + '</div>';

    // Manifest footer
    const entities = data.manifest.entities || [];
    const portals = data.manifest.portals || [];
    if (entities.length > 0 || portals.length > 0) {
      let mf = '';
      if (entities.length > 0) mf += 'You see: ' + entities.map(e => esc(e.display)).join(', ');
      if (portals.length > 0) mf += (mf ? '\\n' : '') + 'Exits: ' + portals.map(p => esc(p.display)).join(', ');
      html += '<div class="manifest">' + mf + '</div>';
    }
    // Portal list from room.portals (if no markup portals)
    if (portals.length === 0 && data.room.portals.length > 0) {
      html += '<div class="manifest">Exits: ' + data.room.portals.map(s =>
        '<span class="portal-ref" data-slug="' + esc(s) + '">' + esc(s) + ' \\u2192</span>'
      ).join(', ') + '</div>';
    }

    // Notices
    if (data.notices.length > 0) {
      html += '<div class="notice">';
      for (const n of data.notices) html += '[' + esc(n) + ']\\n';
      html += '</div>';
    }

    // Actions
    if (data.actions.length > 0) {
      html += '<div>';
      for (const a of data.actions) {
        html += '<div class="action-item" data-idx="' + a.index + '" data-type="' + escAttr(a.type) + '" data-room="' + escAttr(a.room || '') + '" data-content="' + escAttr(a.content || '') + '" data-tool="' + escAttr(a.tool || '') + '" data-tool-params="' + escAttr(JSON.stringify(a.tool_params || {})) + '" data-label="' + escAttr(a.label) + '">';
        html += '<span class="action-num">' + a.index + '.</span> ' + esc(a.label) + '</div>';
      }
      html += '</div>';
    }

    // Scrolls
    if (data.scrolls.length > 0) {
      html += '<div class="divider">\\u2500\\u2500\\u2500\\u2500\\u2500</div><div>';
      for (let i = 0; i < data.scrolls.length; i++) {
        html += '<div class="scroll-item" data-scroll-idx="' + i + '">';
        html += '<span class="action-num">' + (81 + i) + '.</span> Read: ' + esc(data.scrolls[i].title) + '</div>';
      }
      html += '</div>';
    }

    // NPCs
    if (data.npcs && data.npcs.length > 0) {
      html += '<div class="divider">\\u2500\\u2500\\u2500\\u2500\\u2500</div><div>';
      for (const npc of data.npcs) {
        html += '<div class="npc-item" data-slug="' + escAttr(npc.slug) + '">';
        html += '<span class="npc-name">' + esc(npc.name) + '</span> ';
        html += '<span style="color:var(--muted)">' + esc(npc.description.slice(0, 60)) + (npc.description.length > 60 ? '...' : '') + '</span></div>';
      }
      html += '</div>';
    }

    // Global actions
    html += '<div class="divider">\\u2500\\u2500\\u2500\\u2500\\u2500</div>';
    html += '<div class="global-action" data-verb="map">0. View map</div>';
    if (state.history.length > 0) {
      html += '<div class="global-action" data-verb="back">b. Go back</div>';
    }

    const block = append(html);
    bindRoomEvents(block);
  } catch (err) {
    append('<span class="error-msg">Error loading room: ' + esc(err.message) + '</span>');
  }
}

function bindRoomEvents(block) {
  block.querySelectorAll('.entity-ref[data-id]').forEach(el => {
    el.addEventListener('click', () => showGlance(el.dataset.id));
  });
  block.querySelectorAll('.portal-ref[data-slug]').forEach(el => {
    el.addEventListener('click', () => navigateToRoom(el.dataset.slug));
  });
  block.querySelectorAll('.action-item').forEach(el => {
    el.addEventListener('click', () => handleAction(el.dataset));
  });
  block.querySelectorAll('.scroll-item').forEach(el => {
    el.addEventListener('click', () => {
      const idx = parseInt(el.dataset.scrollIdx);
      showScroll(state.scrolls[idx]);
    });
  });
  block.querySelectorAll('.npc-item').forEach(el => {
    el.addEventListener('click', () => startConversation(el.dataset.slug));
  });
  block.querySelectorAll('.global-action').forEach(el => {
    el.addEventListener('click', () => {
      const v = el.dataset.verb;
      if (v === 'map') showMap();
      else if (v === 'back') goBack();
    });
  });
}

// --- NPC Conversation UI ---
let npcUnlockedTags = [];

async function startConversation(slug) {
  try {
    const data = await fetchJson('/' + enc(state.workspace_id) + '/npc/' + enc(slug) + '/talk');
    npcUnlockedTags = [];
    let html = '<div class="room-header">\\u2500\\u2500 ' + esc(data.npc_name) + ' \\u2500\\u2500</div>';
    html += '<div class="npc-greeting">"' + esc(data.greeting) + '"</div>';
    html += '<div>';
    for (const opt of data.options) {
      html += '<div class="dialogue-option" data-npc="' + escAttr(slug) + '" data-node="' + escAttr(opt.node_id) + '">' + opt.index + '. ' + esc(opt.prompt) + '</div>';
    }
    html += '<div class="dialogue-option step-away" data-action="stepaway">0. Step away</div>';
    html += '</div>';
    const block = append(html);
    bindConversationEvents(block, slug);
  } catch (err) {
    append('<span class="error-msg">Error: ' + esc(err.message) + '</span>');
  }
}

async function continueConversation(slug, nodeId) {
  try {
    const tagStr = npcUnlockedTags.join(',');
    const data = await fetchJson('/' + enc(state.workspace_id) + '/npc/' + enc(slug) + '/respond?node=' + enc(nodeId) + '&tags=' + enc(tagStr));
    if (data.new_tags) npcUnlockedTags = data.new_tags;
    let html = '<div class="npc-response">"' + esc(data.text) + '"</div>';
    if (data.entity) {
      html += '<div class="entity-card">';
      html += '<div class="glance-title">' + esc(data.entity.display_name || data.entity.name || '') + ' (' + esc(data.entity.genus_name || '') + ')</div>';
      if (data.entity.status) html += '<div class="glance-attr">Status: ' + esc(data.entity.status) + '</div>';
      html += '</div>';
    }
    html += '<div>';
    for (const opt of data.options) {
      html += '<div class="dialogue-option" data-npc="' + escAttr(slug) + '" data-node="' + escAttr(opt.node_id) + '">' + opt.index + '. ' + esc(opt.prompt) + '</div>';
    }
    html += '<div class="dialogue-option step-away" data-action="stepaway">0. Step away</div>';
    html += '</div>';
    const block = append(html);
    bindConversationEvents(block, slug);
  } catch (err) {
    append('<span class="error-msg">Error: ' + esc(err.message) + '</span>');
  }
}

function bindConversationEvents(block, slug) {
  block.querySelectorAll('.dialogue-option[data-node]').forEach(el => {
    el.addEventListener('click', () => continueConversation(slug, el.dataset.node));
  });
  block.querySelectorAll('.step-away').forEach(el => {
    el.addEventListener('click', () => navigateToRoom(state.current_slug));
  });
}

function renderEntityList(data, label) {
  let html = '<div class="room-header">' + esc(label) + '</div>';
  if (!data.entities || data.entities.length === 0) { html += '<div>No entities found.</div>'; return html; }
  for (const e of data.entities) {
    html += '<div class="search-result" data-entity-id="' + esc(e.id || '') + '">';
    html += esc((e.name || e.id || 'Unknown') + ' (' + (e.genus || 'entity') + ')');
    if (e.status) html += ' \\u2014 ' + esc(e.status);
    html += '</div>';
  }
  if (data.total > data.showing) html += '<div class="glance-attr">Showing ' + data.showing + ' of ' + data.total + '</div>';
  return html;
}

function renderSearchResults(data, label) {
  let html = '<div class="room-header">' + esc(label) + '</div>';
  if (!data.results || data.results.length === 0) { html += '<div>No results found.</div>'; return html; }
  for (const e of data.results) {
    html += '<div class="search-result" data-entity-id="' + esc(e.id || '') + '">';
    html += esc((e.name || e.id || 'Unknown') + (e.genus ? ' (' + e.genus + ')' : ''));
    if (e.status) html += ' \\u2014 ' + esc(e.status);
    html += '</div>';
  }
  return html;
}

function renderSystemOverview(data) {
  let html = '<div class="room-header">System Overview</div>';
  if (data.genera && data.genera.length > 0) {
    html += '<div class="inspect-section">Genera:</div>';
    for (const g of data.genera) html += '<div class="glance-attr">  ' + esc(g.name) + ': ' + g.entity_count + ' entities</div>';
  }
  if (data.relationship_genera && data.relationship_genera.length > 0) {
    html += '<div class="inspect-section">Relationships:</div>';
    for (const g of data.relationship_genera) html += '<div class="glance-attr">  ' + esc(g.name) + ' (' + g.roles.join(', ') + ')</div>';
  }
  if (data.feature_genera && data.feature_genera.length > 0) {
    html += '<div class="inspect-section">Features:</div>';
    for (const g of data.feature_genera) html += '<div class="glance-attr">  ' + esc(g.name) + ' \\u2192 ' + esc(g.parent) + '</div>';
  }
  if (data.actions && data.actions.length > 0) {
    html += '<div class="inspect-section">Actions:</div>';
    for (const a of data.actions) html += '<div class="glance-attr">  ' + esc(a.name) + ' \\u2192 ' + a.target_genus.map(function(g) { return esc(g); }).join(', ') + '</div>';
  }
  if (data.process_genera && data.process_genera.length > 0) {
    html += '<div class="inspect-section">Processes:</div>';
    for (const g of data.process_genera) html += '<div class="glance-attr">  ' + esc(g.name) + '</div>';
  }
  if (data.tasks) {
    html += '<div class="inspect-section">Tasks:</div>';
    html += '<div class="glance-attr">  pending: ' + (data.tasks.pending || 0) + ', claimed: ' + (data.tasks.claimed || 0) + ', completed: ' + (data.tasks.completed || 0) + '</div>';
  }
  if (data.processes) {
    html += '<div class="inspect-section">Process Runs:</div>';
    html += '<div class="glance-attr">  running: ' + (data.processes.running || 0) + ', completed: ' + (data.processes.completed || 0) + '</div>';
  }
  return html;
}

function renderTasks(data) {
  let html = '<div class="room-header">Tasks</div>';
  if (!data.tasks || data.tasks.length === 0) { html += '<div>No tasks found.</div>'; return html; }
  for (const t of data.tasks) html += '<div class="glance-attr">  ' + esc(t.title || t.id) + ' \\u2014 ' + esc(t.status) + '</div>';
  return html;
}

function renderRelationships(data, label) {
  let html = '<div class="room-header">' + esc(label) + '</div>';
  const rels = data.relationships || [];
  if (rels.length === 0) { html += '<div>No relationships found.</div>'; return html; }
  for (const r of rels) {
    html += '<div class="inspect-section">' + esc(r.genus_name || r.genus || 'relationship') + '</div>';
    for (const role of Object.keys(r.members || {})) {
      for (const m of r.members[role]) {
        html += '<div class="search-result" data-entity-id="' + esc(m.id || '') + '">';
        html += '  ' + esc(role) + ': ' + esc(m.name || m.id || 'Unknown');
        html += '</div>';
      }
    }
  }
  return html;
}

function renderProcesses(data) {
  let html = '<div class="room-header">Processes</div>';
  if (!data.processes || data.processes.length === 0) { html += '<div>No processes found.</div>'; return html; }
  for (const p of data.processes) {
    const steps = p.step_summary ? ' (' + p.step_summary.completed + '/' + p.step_summary.total + ' steps)' : '';
    html += '<div class="glance-attr">  ' + esc(p.process_name || p.id) + ' \\u2014 ' + esc(p.status) + steps + '</div>';
  }
  return html;
}

function renderToolResult(tool, data, label) {
  switch (tool) {
    case 'list_entities': return renderEntityList(data, label);
    case 'search_entities': return renderSearchResults(data, label);
    case 'describe_system': return renderSystemOverview(data);
    case 'list_tasks': return renderTasks(data);
    case 'get_relationships': return renderRelationships(data, label);
    case 'list_relationships': return renderRelationships(data, label);
    case 'list_processes': return renderProcesses(data);
    default: return '<pre>' + esc(JSON.stringify(data, null, 2)) + '</pre>';
  }
}

async function handleAction(dataset) {
  const type = dataset.type;
  if (type === 'navigate' && dataset.room) {
    await navigateToRoom(dataset.room);
  } else if (type === 'text') {
    const content = dataset.content;
    if (content) {
      append('<div>' + esc(content) + '</div>');
    } else {
      appendText('(This action has no content yet.)');
    }
  } else if (type === 'query' && dataset.tool) {
    const tool = (dataset.tool || '').replace(/^smaragda:/, '');
    const toolParams = JSON.parse(dataset.toolParams || '{}');
    const label = dataset.label || 'Result';

    if (tool === 'get_entity') {
      const id = toolParams.entity || toolParams.id || toolParams.entity_id;
      if (id) { await showGlance(id); return; }
      appendText('No entity ID specified.'); return;
    }

    const routes = {
      'list_entities': function() { return '/' + enc(state.workspace_id) + '/entities?genus=' + enc(toolParams.genus || '') + '&status=' + enc(toolParams.status || ''); },
      'search_entities': function() { return '/' + enc(state.workspace_id) + '/entities/search?q=' + enc(toolParams.query || ''); },
      'describe_system': function() { return '/' + enc(state.workspace_id) + '/system'; },
      'list_tasks': function() { return '/' + enc(state.workspace_id) + '/tasks'; },
      'get_relationships': function() { return '/' + enc(state.workspace_id) + '/entity/' + enc(toolParams.entity || toolParams.entity_id || '') + '/relationships'; },
      'list_relationships': function() { return '/' + enc(state.workspace_id) + '/relationships?genus=' + enc(toolParams.genus || '') + '&member=' + enc(toolParams.member_entity_id || ''); },
      'list_processes': function() { return '/' + enc(state.workspace_id) + '/processes?status=' + enc(toolParams.status || ''); },
    };

    const route = routes[tool];
    if (!route) {
      appendText('This action requires the MCP interface.');
      return;
    }

    try {
      append('<span class="loading">Running: ' + esc(label) + '...</span>');
      const data = await fetchJson(route());
      if (data.error) {
        append('<span class="error-msg">' + esc(data.error) + '</span>');
        return;
      }
      const block = append(renderToolResult(tool, data, label));
      block.querySelectorAll('.search-result[data-entity-id]').forEach(function(el) {
        if (el.dataset.entityId) el.addEventListener('click', function() { showGlance(el.dataset.entityId); });
      });
    } catch (err) {
      append('<span class="error-msg">Query failed: ' + esc(err.message) + '</span>');
    }
  } else {
    appendText('Action ' + (dataset.idx || '?') + ': ' + esc(dataset.label || type || 'unknown'));
  }
}

async function showGlance(entityId) {
  try {
    const data = await fetchJson('/' + enc(state.workspace_id) + '/entity/' + enc(entityId));
    let html = '<div class="glance-title">' + esc(data.name) + ' (' + esc(data.genus_name) + ')</div>';
    html += '<div class="glance-attr">Status: <span class="glance-val">' + esc(data.status) + '</span></div>';
    if (data.template) {
      html += '<div>' + esc(data.template) + '</div>';
    } else {
      for (const [k, v] of Object.entries(data.attributes || {})) {
        html += '<div class="glance-attr">  ' + esc(k) + ': <span class="glance-val">' + esc(String(v)) + '</span></div>';
      }
    }
    const block = append(html);
    // Make entity clickable for inspect
    block.querySelector('.glance-title').style.cursor = 'pointer';
    block.querySelector('.glance-title').addEventListener('click', () => showInspect(entityId));
  } catch (err) {
    append('<span class="error-msg">Entity not found</span>');
  }
}

async function showInspect(entityId) {
  try {
    const data = await fetchJson('/' + enc(state.workspace_id) + '/entity/' + enc(entityId) + '/inspect');
    let html = '<div class="room-header">\\u2500\\u2500 ' + esc(data.genus_name) + ': ' + esc(data.name) + ' \\u2500\\u2500</div>';
    if (data.template) {
      html += '<div>' + esc(data.template) + '</div>';
    } else {
      html += '<pre>' + esc(JSON.stringify(data.state, null, 2)) + '</pre>';
    }
    if (data.relationships && data.relationships.length > 0) {
      html += '<div class="inspect-section">Relationships:</div>';
      for (const r of data.relationships) {
        const parts = Object.entries(r.members).map(([role, names]) => role + '=' + names.join(', ')).join(', ');
        html += '<div class="glance-attr">  - ' + esc(r.genus_name) + ': ' + esc(parts) + '</div>';
      }
    }
    append(html);
  } catch (err) {
    append('<span class="error-msg">Entity not found</span>');
  }
}

function showScroll(scroll) {
  if (!scroll) return;
  let html = '<div class="room-header">' + esc(scroll.title) + '</div>';
  html += '<div class="scroll-body">' + esc(scroll.body) + '</div>';
  html += '<div class="glance-attr">' + esc(scroll.created_at) + '</div>';
  append(html);
}

async function showMap() {
  try {
    const rooms = await fetchJson('/' + enc(state.workspace_id) + '/map');
    let html = '<div class="room-header">\\u2500\\u2500 Palace Map \\u2500\\u2500</div>';
    for (const r of rooms) {
      const cls = r.entry ? 'map-room map-entry' : 'map-room';
      const marker = r.slug === state.current_slug ? ' \\u25C0 you are here' : '';
      html += '<div class="' + cls + '" data-slug="' + esc(r.slug) + '">';
      html += esc(r.name) + (r.entry ? ' (entry)' : '');
      if (r.portals.length > 0) html += ' \\u2192 ' + r.portals.map(p => esc(p)).join(', ');
      html += marker + '</div>';
    }
    const block = append(html);
    block.querySelectorAll('.map-room').forEach(el => {
      el.addEventListener('click', () => navigateToRoom(el.dataset.slug));
    });
  } catch (err) {
    append('<span class="error-msg">Error: ' + esc(err.message) + '</span>');
  }
}

async function goBack() {
  if (state.history.length === 0) { appendText('Nowhere to go back to.'); return; }
  const prev = state.history.pop();
  state.current_slug = prev;
  save();
  updateHash();
  await renderRoom(prev);
}

// --- Verb / command input ---
function resolveTarget(name, kind) {
  if (!state.manifest || !state.manifest.all) return null;
  const lower = name.toLowerCase();
  const candidates = kind ? state.manifest.all.filter(e => e.kind === kind) : state.manifest.all;
  // exact
  let m = candidates.filter(e => (e.match_name || '').toLowerCase() === lower);
  if (m.length === 1) return m[0];
  // prefix
  m = candidates.filter(e => (e.match_name || '').toLowerCase().startsWith(lower));
  if (m.length === 1) return m[0];
  // substring
  m = candidates.filter(e => (e.match_name || '').toLowerCase().includes(lower));
  if (m.length === 1) return m[0];
  // Also check room portals directly
  if (kind === 'portal' && state.room && state.room.portals) {
    const pm = state.room.portals.filter(s => s.toLowerCase().includes(lower));
    if (pm.length === 1) return { kind: 'portal', slug: pm[0], display: pm[0] };
  }
  return null;
}

async function handleCommand(input) {
  const trimmed = input.trim();
  if (!trimmed) return;
  if (!state.workspace_id) { appendText('Select a workspace first.'); return; }
  if (!state.current_slug) { await enterWorkspace(); return; }

  // Number input
  if (/^\\d+$/.test(trimmed)) {
    const num = parseInt(trimmed);
    if (num === 0) { await showMap(); return; }
    if (num >= 81 && num <= 90) {
      const idx = num - 81;
      if (state.scrolls[idx]) showScroll(state.scrolls[idx]);
      else appendText('No scroll at that number.');
      return;
    }
    const action = state.actions.find(a => a.index === num);
    if (action) {
      await handleAction({ idx: String(num), type: action.type, room: action.room || '', content: action.content || '', tool: action.tool || '', toolParams: JSON.stringify(action.tool_params || {}), label: action.label });
      return;
    }
    appendText('Unknown action: ' + num);
    return;
  }

  // Verb commands
  const spaceIdx = trimmed.indexOf(' ');
  const word = (spaceIdx === -1 ? trimmed : trimmed.slice(0, spaceIdx)).toLowerCase();
  const rest = spaceIdx === -1 ? '' : trimmed.slice(spaceIdx + 1).trim();

  const verbs = { look: 'look', l: 'look', examine: 'examine', x: 'examine',
    go: 'go', search: 'search', find: 'search', back: 'back', b: 'back',
    map: 'map', m: 'map' };
  const verb = verbs[word];

  if (!verb) { appendText('Unknown command: ' + word + '. Try: look, go, examine, search, map, back'); return; }

  switch (verb) {
    case 'look': {
      if (!rest) { await renderRoom(state.current_slug); return; }
      const match = resolveTarget(rest, 'entity');
      if (match && match.entity_id) { await showGlance(match.entity_id); return; }
      // Fallback: search
      const results = await fetchJson('/' + enc(state.workspace_id) + '/search?q=' + enc(rest));
      if (results.length > 0) {
        appendText('Search results for "' + rest + '":');
        let html = '';
        for (const r of results) html += '<div class="search-result" data-slug="' + esc(r.room_slug) + '">' + esc(r.match) + ' (' + esc(r.type) + ' in ' + esc(r.room_name) + ')</div>';
        const block = append(html);
        block.querySelectorAll('.search-result').forEach(el => {
          el.addEventListener('click', () => navigateToRoom(el.dataset.slug));
        });
      } else { appendText('Nothing matching "' + rest + '" is visible here.'); }
      return;
    }
    case 'examine': {
      if (!rest) { appendText('Examine what?'); return; }
      const match = resolveTarget(rest, 'entity');
      if (match && match.entity_id) { await showInspect(match.entity_id); return; }
      appendText('Nothing matching "' + rest + '" found.');
      return;
    }
    case 'go': {
      if (!rest) { appendText('Go where?'); return; }
      const match = resolveTarget(rest, 'portal');
      if (match && match.slug) { await navigateToRoom(match.slug); return; }
      // Try room slug directly
      const rooms = await fetchJson('/' + enc(state.workspace_id) + '/rooms');
      const found = rooms.find(r => r.slug.toLowerCase() === rest.toLowerCase() || r.name.toLowerCase().includes(rest.toLowerCase()));
      if (found) { await navigateToRoom(found.slug); return; }
      appendText('No exit matching "' + rest + '" found.');
      return;
    }
    case 'search': {
      if (!rest) { appendText('Search for what?'); return; }
      const results = await fetchJson('/' + enc(state.workspace_id) + '/search?q=' + enc(rest));
      if (results.length === 0) { appendText('No results for "' + rest + '".'); return; }
      let html = '<div class="room-header">Search: ' + esc(rest) + '</div>';
      for (const r of results) {
        html += '<div class="search-result" data-slug="' + esc(r.room_slug) + '">';
        html += esc(r.match) + ' <span class="glance-attr">(' + esc(r.type) + ' in ' + esc(r.room_name) + ')</span></div>';
      }
      const block = append(html);
      block.querySelectorAll('.search-result').forEach(el => {
        el.addEventListener('click', () => navigateToRoom(el.dataset.slug));
      });
      return;
    }
    case 'back': await goBack(); return;
    case 'map': await showMap(); return;
  }
}

// --- Input handling ---
$('#cmd').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); submit(); }
});
$('#send').addEventListener('click', submit);

function submit() {
  const input = $('#cmd').value;
  if (!input.trim()) return;
  append('<span style="color:var(--gold)">></span> ' + esc(input));
  $('#cmd').value = '';
  handleCommand(input);
}

// --- Init ---
load();
loadWorkspaces().then(() => {
  // Restore from hash
  if (location.hash) {
    const parts = location.hash.slice(1).split('/').map(decodeURIComponent);
    if (parts.length >= 1) {
      // Find workspace by name
      const opts = $('#ws-picker').options;
      for (let i = 0; i < opts.length; i++) {
        if (opts[i].textContent.replace(/ \\(no palace\\)$/, '') === parts[0]) {
          opts[i].selected = true;
          state.workspace_id = opts[i].value;
          state.workspace_name = parts[0];
          if (parts[1]) {
            state.current_slug = parts[1];
            renderRoom(parts[1]);
          } else {
            enterWorkspace();
          }
          save();
          return;
        }
      }
    }
  }
  if (state.workspace_id && state.current_slug) {
    $('#ws-picker').value = state.workspace_id;
    renderRoom(state.current_slug);
  } else if (state.workspace_id) {
    $('#ws-picker').value = state.workspace_id;
    enterWorkspace();
  }
});
</script>
</body>
</html>`;

// --- Start server ---

Bun.serve({
  port: PORT,
  routes: {
    "/.well-known/oauth-protected-resource": { GET: handleProtectedResource },
    "/.well-known/oauth-authorization-server": { GET: handleAuthServerMeta },
    "/register": { POST: handleRegister },
    "/authorize": { GET: handleAuthorizeGet, POST: handleAuthorizePost },
    "/token": { POST: handleToken },
    "/mcp": { POST: authedTransport, DELETE: deleteSession },
    "/sync/pull": { POST: handleSyncPull },
    "/sync/push": { POST: handleSyncPush },
  },
  fetch: httpCors(palaceFetchHandler),
});

console.log(`Smaragda MCP server running on http://localhost:${PORT}/mcp`);
console.log(`Auth token: ${AUTH_TOKEN}`);
if (OAUTH_PASSWORD) console.log("OAuth enabled");
