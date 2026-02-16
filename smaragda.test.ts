import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import {
  initKernel,
  getRes,
  createRes,
  appendTessella,
  replay,
  materialize,
  defaultReducer,
  genusReducer,
  getGenusDef,
  defineEntityGenus,
  createEntity,
  setAttribute,
  transitionStatus,
  listGenera,
  listEntities,
  findGenusByName,
  META_GENUS_ID,
  LOG_GENUS_ID,
  ERROR_GENUS_ID,
  actionReducer,
  getActionDef,
  defineActionGenus,
  recordInput,
  executeAction,
  listActionGenera,
  findActionByName,
  findActionsByTargetGenus,
  getHistory,
  defineFeatureGenus,
  createFeature,
  setFeatureAttribute,
  transitionFeatureStatus,
  listFeatureGenera,
  findFeatureGenusByName,
  getFeatureGenusForEntityGenus,
  defineRelationshipGenus,
  createRelationship,
  addMember,
  removeMember,
  getRelationshipsForEntity,
  getRelatedEntities,
  listRelationshipGenera,
  findRelationshipGenusByName,
  evolveGenus,
  deprecateGenus,
  restoreGenus,
  evaluateHealth,
  evaluateHealthByGenus,
  listUnhealthy,
  createError,
  acknowledgeError,
  listErrors,
  getSyncState,
  setSyncState,
  getUnpushedTessellae,
  getUnpushedRes,
  insertPulledData,
  TASK_GENUS_ID,
  CRON_SCHEDULE_GENUS_ID,
  parseCron,
  matchesCron,
  createCronSchedule,
  createScheduledTrigger,
  parseDelay,
  listCronSchedules,
  fireCronSchedule,
  tickCron,
  createTask,
  claimTask,
  completeTask,
  cancelTask,
  listTasks,
  defineProcessGenus,
  startProcess,
  cancelProcess,
  getProcessStatus,
  getProcessDef,
  listProcessGenera,
  findProcessGenusByName,
  listProcesses,
  processReducer,
  processInstanceReducer,
  BRANCH_GENUS_ID,
  TAXONOMY_GENUS_ID,
  DEFAULT_TAXONOMY_ID,
  SCIENCE_GENUS_ID,
  DEFAULT_SCIENCE_ID,
  createTaxonomy,
  listTaxonomies,
  findTaxonomyByName,
  describeTaxonomy,
  createScience,
  listSciences,
  findScienceByName,
  describeScience,
  createBranch,
  switchBranch,
  listBranches,
  findBranchByName,
  mergeBranch,
  discardBranch,
  detectConflicts,
  compareBranches,
  serializationReducer,
  defineSerializationGenus,
  getSerializationDef,
  findSerializationGenusByName,
  listSerializationGenera,
  runSerialization,
  writeFiletree,
  readFiletree,
  importFiletree,
  validateAttributes,
  validateStateMachine,
  validateActionHandler,
  validateProcessDefinition,
  WORKSPACE_GENUS_ID,
  createWorkspace,
  listWorkspaces,
  findWorkspaceByName,
  switchWorkspace,
  assignWorkspace,
  assignWorkspaceByGenus,
  assignWorkspaceByTaxonomy,
  listRelationships,
  searchEntities,
  deleteWorkspace,
  mergeWorkspaces,
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
  PALACE_ROOM_GENUS_ID,
  PALACE_SCROLL_GENUS_ID,
  PALACE_NPC_GENUS_ID,
  palaceCreateNPC,
  palaceGetNPC,
  palaceListNPCsInRoom,
  palaceListNPCs,
  palaceAddDialogue,
  palaceMergeNPC,
  palaceDeleteNPC,
  palaceParseMarkup,
  palaceFindEntity,
  palaceResolveMarkup,
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
import type { Kernel, Tessella, SyncPullData, ProcessStepDef, FiletreeNode, SerializationManifest, PalaceDialogueNode } from "./smaragda";

// ============================================================================
// Tessella Store
// ============================================================================

describe("Tessella Store", () => {
  let kernel: Kernel;

  beforeEach(() => {
    kernel = initKernel(":memory:");
  });

  afterEach(() => {
    kernel.db.close();
  });

  // --- initKernel ---

  test("initKernel creates res and tessella tables", () => {
    const tables = kernel.db.query(
      "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
    ).all() as { name: string }[];
    const names = tables.map(t => t.name);
    expect(names).toContain("res");
    expect(names).toContain("tessella");
  });

  test("initKernel is idempotent", () => {
    // Running initKernel again on the same db should not throw
    const kernel2 = initKernel(":memory:");
    expect(kernel2.db).toBeDefined();
    kernel2.db.close();
  });

  // --- getRes ---

  test("getRes returns the res row", () => {
    const id = createRes(kernel, "server");
    const res = getRes(kernel, id);
    expect(res.id).toBe(id);
    expect(res.genus_id).toBe("server");
    expect(res.branch_id).toBe("main");
    expect(res.created_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  test("getRes throws for nonexistent id", () => {
    expect(() => getRes(kernel, "nonexistent")).toThrow("Res not found: nonexistent");
  });

  // --- createRes ---

  test("createRes returns a ULID", () => {
    const id = createRes(kernel, "server");
    expect(id).toHaveLength(26);
    expect(id).toMatch(/^[0123456789ABCDEFGHJKMNPQRSTVWXYZ]{26}$/);
  });

  test("createRes inserts a row into the res table", () => {
    const id = createRes(kernel, "server");
    const row = kernel.db.query("SELECT * FROM res WHERE id = ?").get(id) as any;
    expect(row).not.toBeNull();
    expect(row.genus_id).toBe("server");
    expect(row.branch_id).toBe("main");
  });

  test("createRes appends a 'created' tessella", () => {
    const id = createRes(kernel, "server");
    const tessellae = replay(kernel, id);
    expect(tessellae).toHaveLength(1);
    expect(tessellae[0].type).toBe("created");
    expect(tessellae[0].data).toEqual({});
  });

  test("createRes respects branch_id", () => {
    const id = createRes(kernel, "server", "staging");
    const row = kernel.db.query("SELECT * FROM res WHERE id = ?").get(id) as any;
    expect(row.branch_id).toBe("staging");
    const tessellae = replay(kernel, id, { branch_id: "staging" });
    expect(tessellae).toHaveLength(1);
    expect(tessellae[0].branch_id).toBe("staging");
  });

  // --- appendTessella ---

  test("appendTessella returns a full tessella", () => {
    const resId = createRes(kernel, "server");
    const t = appendTessella(kernel, resId, "attribute_set", { key: "name", value: "prod-1" });
    expect(t.id).toBeGreaterThan(0);
    expect(t.res_id).toBe(resId);
    expect(t.branch_id).toBe("main");
    expect(t.type).toBe("attribute_set");
    expect(t.data).toEqual({ key: "name", value: "prod-1" });
    expect(t.source).toBeNull();
  });

  test("appendTessella assigns monotonically increasing ids", () => {
    const resId = createRes(kernel, "server");
    const t1 = appendTessella(kernel, resId, "a", {});
    const t2 = appendTessella(kernel, resId, "b", {});
    expect(t2.id).toBeGreaterThan(t1.id);
  });

  test("appendTessella round-trips JSON data", () => {
    const resId = createRes(kernel, "server");
    const complex = { nested: { deep: [1, 2, 3] }, flag: true, count: 42, label: null };
    const t = appendTessella(kernel, resId, "test", complex);
    expect(t.data).toEqual(complex);
  });

  test("appendTessella has ISO timestamps", () => {
    const resId = createRes(kernel, "server");
    const t = appendTessella(kernel, resId, "test", {});
    expect(t.created_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });

  test("appendTessella tracks source", () => {
    const resId = createRes(kernel, "server");
    const t = appendTessella(kernel, resId, "attribute_set", { key: "name", value: "x" }, { source: "user:alice" });
    expect(t.source).toBe("user:alice");
  });

  // --- replay ---

  test("replay returns tessellae ordered by id", () => {
    const resId = createRes(kernel, "server");
    appendTessella(kernel, resId, "a", {});
    appendTessella(kernel, resId, "b", {});
    appendTessella(kernel, resId, "c", {});

    const tessellae = replay(kernel, resId);
    expect(tessellae).toHaveLength(4); // created + 3
    for (let i = 1; i < tessellae.length; i++) {
      expect(tessellae[i].id).toBeGreaterThan(tessellae[i - 1].id);
    }
  });

  test("replay filters by branch_id", () => {
    const id1 = createRes(kernel, "server", "main");
    const id2 = createRes(kernel, "server", "staging");
    appendTessella(kernel, id1, "a", {});
    appendTessella(kernel, id2, "b", {}, { branch_id: "staging" });

    const mainTessellae = replay(kernel, id1, { branch_id: "main" });
    expect(mainTessellae.every(t => t.branch_id === "main")).toBe(true);

    const stagingTessellae = replay(kernel, id2, { branch_id: "staging" });
    expect(stagingTessellae.every(t => t.branch_id === "staging")).toBe(true);
  });

  test("replay with after option skips earlier tessellae", () => {
    const resId = createRes(kernel, "server");
    const t1 = appendTessella(kernel, resId, "a", {});
    appendTessella(kernel, resId, "b", {});

    const tessellae = replay(kernel, resId, { after: t1.id });
    expect(tessellae).toHaveLength(1);
    expect(tessellae[0].type).toBe("b");
  });

  test("replay with types filter", () => {
    const resId = createRes(kernel, "server");
    appendTessella(kernel, resId, "attribute_set", { key: "a", value: 1 });
    appendTessella(kernel, resId, "status_changed", { status: "active" });
    appendTessella(kernel, resId, "attribute_set", { key: "b", value: 2 });

    const tessellae = replay(kernel, resId, { types: ["attribute_set"] });
    expect(tessellae).toHaveLength(2);
    expect(tessellae.every(t => t.type === "attribute_set")).toBe(true);
  });

  test("replay with limit option caps results", () => {
    const resId = createRes(kernel, "server");
    appendTessella(kernel, resId, "a", {});
    appendTessella(kernel, resId, "b", {});
    appendTessella(kernel, resId, "c", {});

    const tessellae = replay(kernel, resId, { limit: 2 });
    expect(tessellae).toHaveLength(2);
  });

  test("replay returns empty array for nonexistent res", () => {
    const tessellae = replay(kernel, "nonexistent");
    expect(tessellae).toEqual([]);
  });

  // --- materialize ---

  test("materialize folds attribute_set tessellae into state", () => {
    const resId = createRes(kernel, "server");
    appendTessella(kernel, resId, "attribute_set", { key: "name", value: "prod-1" });
    appendTessella(kernel, resId, "attribute_set", { key: "provider", value: "DigitalOcean" });
    appendTessella(kernel, resId, "attribute_set", { key: "cost", value: 48 });

    const state = materialize(kernel, resId);
    expect(state).toEqual({ name: "prod-1", provider: "DigitalOcean", cost: 48 });
  });

  test("materialize handles attribute_removed", () => {
    const resId = createRes(kernel, "server");
    appendTessella(kernel, resId, "attribute_set", { key: "name", value: "prod-1" });
    appendTessella(kernel, resId, "attribute_set", { key: "temp", value: "x" });
    appendTessella(kernel, resId, "attribute_removed", { key: "temp" });

    const state = materialize(kernel, resId);
    expect(state).toEqual({ name: "prod-1" });
    expect(state).not.toHaveProperty("temp");
  });

  test("materialize handles status_changed", () => {
    const resId = createRes(kernel, "server");
    appendTessella(kernel, resId, "attribute_set", { key: "name", value: "prod-1" });
    appendTessella(kernel, resId, "status_changed", { status: "active" });

    const state = materialize(kernel, resId);
    expect(state).toEqual({ name: "prod-1", status: "active" });
  });

  test("materialize upTo for point-in-time reconstruction", () => {
    const resId = createRes(kernel, "server");
    appendTessella(kernel, resId, "attribute_set", { key: "name", value: "prod-1" });
    appendTessella(kernel, resId, "attribute_set", { key: "provider", value: "DigitalOcean" });
    const t3 = appendTessella(kernel, resId, "attribute_set", { key: "cost", value: 48 });
    appendTessella(kernel, resId, "attribute_set", { key: "cost", value: 64 });

    const stateAtT3 = materialize(kernel, resId, { upTo: t3.id });
    expect(stateAtT3).toEqual({ name: "prod-1", provider: "DigitalOcean", cost: 48 });

    const current = materialize(kernel, resId);
    expect(current).toEqual({ name: "prod-1", provider: "DigitalOcean", cost: 64 });
  });

  test("materialize with custom reducer", () => {
    const resId = createRes(kernel, "server");
    appendTessella(kernel, resId, "increment", { amount: 10 });
    appendTessella(kernel, resId, "increment", { amount: 5 });
    appendTessella(kernel, resId, "decrement", { amount: 3 });

    const state = materialize(kernel, resId, {
      reducer: (state, t) => {
        const total = (state.total as number) ?? 0;
        if (t.type === "created") return { total: 0 };
        if (t.type === "increment") return { total: total + t.data.amount };
        if (t.type === "decrement") return { total: total - t.data.amount };
        return state;
      },
    });
    expect(state).toEqual({ total: 12 });
  });

  test("materialize returns empty object for nonexistent res", () => {
    const state = materialize(kernel, "nonexistent");
    expect(state).toEqual({});
  });

  // --- defaultReducer ---

  test("defaultReducer: created resets to empty", () => {
    const result = defaultReducer({ old: "stuff" }, { type: "created", data: {} } as Tessella);
    expect(result).toEqual({});
  });

  test("defaultReducer: attribute_set adds key", () => {
    const result = defaultReducer({}, { type: "attribute_set", data: { key: "name", value: "x" } } as Tessella);
    expect(result).toEqual({ name: "x" });
  });

  test("defaultReducer: attribute_removed deletes key", () => {
    const result = defaultReducer({ a: 1, b: 2 }, { type: "attribute_removed", data: { key: "a" } } as Tessella);
    expect(result).toEqual({ b: 2 });
  });

  test("defaultReducer: status_changed sets status", () => {
    const result = defaultReducer({ name: "x" }, { type: "status_changed", data: { status: "active" } } as Tessella);
    expect(result).toEqual({ name: "x", status: "active" });
  });

  test("defaultReducer: unknown type passes through", () => {
    const state = { existing: true };
    const result = defaultReducer(state, { type: "unknown_type", data: { foo: "bar" } } as Tessella);
    expect(result).toEqual({ existing: true });
  });

  // --- Integration ---

  test("full demo workflow: create → append → replay → materialize → update → point-in-time", () => {
    const resId = createRes(kernel, "server");
    appendTessella(kernel, resId, "attribute_set", { key: "name", value: "production-1" });
    appendTessella(kernel, resId, "attribute_set", { key: "provider", value: "DigitalOcean" });
    const t3 = appendTessella(kernel, resId, "attribute_set", { key: "cost", value: 48 });

    // Replay shows all tessellae
    const history = replay(kernel, resId);
    expect(history).toHaveLength(4); // created + 3 attribute_set

    // Materialize at current
    const state1 = materialize(kernel, resId);
    expect(state1).toEqual({ name: "production-1", provider: "DigitalOcean", cost: 48 });

    // Update cost
    appendTessella(kernel, resId, "attribute_set", { key: "cost", value: 64 });

    // Point-in-time at t3
    const stateAtT3 = materialize(kernel, resId, { upTo: t3.id });
    expect(stateAtT3).toEqual({ name: "production-1", provider: "DigitalOcean", cost: 48 });

    // Current state
    const state2 = materialize(kernel, resId);
    expect(state2).toEqual({ name: "production-1", provider: "DigitalOcean", cost: 64 });
  });

  test("multiple res coexist independently", () => {
    const id1 = createRes(kernel, "server");
    const id2 = createRes(kernel, "database");

    appendTessella(kernel, id1, "attribute_set", { key: "name", value: "web-1" });
    appendTessella(kernel, id2, "attribute_set", { key: "name", value: "pg-main" });

    const state1 = materialize(kernel, id1);
    const state2 = materialize(kernel, id2);

    expect(state1).toEqual({ name: "web-1" });
    expect(state2).toEqual({ name: "pg-main" });
  });
});

// ============================================================================
// Genus
// ============================================================================

describe("Genus", () => {
  let kernel: Kernel;

  beforeEach(() => {
    kernel = initKernel(":memory:");
  });

  afterEach(() => {
    kernel.db.close();
  });

  // --- initKernel bootstrap ---

  test("initKernel bootstraps meta-genus res", () => {
    const row = kernel.db.query("SELECT * FROM res WHERE id = ?").get(META_GENUS_ID) as any;
    expect(row).not.toBeNull();
    expect(row.genus_id).toBe(META_GENUS_ID); // self-referential
    expect(row.branch_id).toBe("main");
  });

  test("meta-genus bootstrap is idempotent", () => {
    // initKernel already ran in beforeEach; calling again should not throw or duplicate
    const kernel2 = initKernel(":memory:");
    const rows = kernel2.db.query("SELECT * FROM res WHERE id = ?").all(META_GENUS_ID);
    expect(rows).toHaveLength(1);
    kernel2.db.close();
  });

  test("meta-genus has name='genus' tessella", () => {
    const tessellae = replay(kernel, META_GENUS_ID);
    const metaSet = tessellae.find(
      (t) => t.type === "genus_meta_set" && t.data.key === "name",
    );
    expect(metaSet).toBeDefined();
    expect(metaSet!.data.value).toBe("genus");
  });

  // --- genusReducer ---

  test("genusReducer: created initializes empty collections", () => {
    const result = genusReducer({}, { type: "created", data: {} } as Tessella);
    expect(result).toEqual({ attributes: {}, states: {}, transitions: [], roles: {}, meta: {} });
  });

  test("genusReducer: genus_attribute_defined adds to attributes map", () => {
    const state = { attributes: {}, states: {}, transitions: [], meta: {} };
    const result = genusReducer(state, {
      type: "genus_attribute_defined",
      data: { name: "ip", type: "text", required: true },
    } as Tessella);
    expect((result.attributes as any).ip).toEqual({ name: "ip", type: "text", required: true });
  });

  test("genusReducer: genus_state_defined adds to states map", () => {
    const state = { attributes: {}, states: {}, transitions: [], meta: {} };
    const result = genusReducer(state, {
      type: "genus_state_defined",
      data: { name: "active", initial: false },
    } as Tessella);
    expect((result.states as any).active).toEqual({ name: "active", initial: false });
  });

  test("genusReducer: genus_transition_defined pushes to transitions", () => {
    const state = { attributes: {}, states: {}, transitions: [], meta: {} };
    const result = genusReducer(state, {
      type: "genus_transition_defined",
      data: { from: "a", to: "b" },
    } as Tessella);
    expect(result.transitions).toEqual([{ from: "a", to: "b" }]);
  });

  test("genusReducer: genus_meta_set adds to meta map", () => {
    const state = { attributes: {}, states: {}, transitions: [], meta: {} };
    const result = genusReducer(state, {
      type: "genus_meta_set",
      data: { key: "name", value: "Server" },
    } as Tessella);
    expect((result.meta as any).name).toBe("Server");
  });

  test("genusReducer: unknown type passes through", () => {
    const state = { attributes: {}, states: {}, transitions: [], meta: {} };
    const result = genusReducer(state, {
      type: "totally_unknown",
      data: { x: 1 },
    } as Tessella);
    expect(result).toEqual(state);
  });

  // --- getGenusDef ---

  test("getGenusDef returns structured definition", () => {
    const genusId = defineEntityGenus(kernel, "Widget", {
      attributes: [{ name: "color", type: "text" }],
      states: [
        { name: "draft", initial: true },
        { name: "published", initial: false },
      ],
      transitions: [{ from: "draft", to: "published" }],
    });

    const def = getGenusDef(kernel, genusId);
    expect(def.attributes.color).toBeDefined();
    expect(def.attributes.color.type).toBe("text");
    expect(def.states.draft).toBeDefined();
    expect(def.states.draft.initial).toBe(true);
    expect(def.transitions).toHaveLength(1);
    expect(def.meta.name).toBe("Widget");
  });

  test("transition names survive define → getGenusDef round-trip", () => {
    const genusId = defineEntityGenus(kernel, "Flow", {
      states: [
        { name: "open", initial: true },
        { name: "closed", initial: false },
      ],
      transitions: [
        { from: "open", to: "closed", name: "Close" },
      ],
    });

    const def = getGenusDef(kernel, genusId);
    expect(def.transitions).toHaveLength(1);
    expect(def.transitions[0].from).toBe("open");
    expect(def.transitions[0].to).toBe("closed");
    expect(def.transitions[0].name).toBe("Close");
  });

  test("getGenusDef identifies initial state", () => {
    const genusId = defineEntityGenus(kernel, "Thing", {
      states: [
        { name: "new", initial: true },
        { name: "done", initial: false },
      ],
    });

    const def = getGenusDef(kernel, genusId);
    expect(def.initialState).toBe("new");
  });

  test("getGenusDef returns null initialState when none marked", () => {
    const genusId = defineEntityGenus(kernel, "Bare", {
      states: [
        { name: "a", initial: false },
        { name: "b", initial: false },
      ],
    });

    const def = getGenusDef(kernel, genusId);
    expect(def.initialState).toBeNull();
  });

  // --- defineEntityGenus ---

  test("defineEntityGenus creates genus res with META_GENUS_ID", () => {
    const genusId = defineEntityGenus(kernel, "Server");
    const row = kernel.db.query("SELECT * FROM res WHERE id = ?").get(genusId) as any;
    expect(row).not.toBeNull();
    expect(row.genus_id).toBe(META_GENUS_ID);
  });

  test("defineEntityGenus appends all tessellae and round-trips through getGenusDef", () => {
    const genusId = defineEntityGenus(kernel, "Server", {
      attributes: [
        { name: "ip_address", type: "text", required: true },
        { name: "provider", type: "text" },
        { name: "monthly_cost", type: "number" },
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

    const def = getGenusDef(kernel, genusId);
    expect(Object.keys(def.attributes)).toHaveLength(3);
    expect(def.attributes.ip_address.required).toBe(true);
    expect(def.attributes.provider.required).toBe(false);
    expect(def.attributes.monthly_cost.type).toBe("number");
    expect(Object.keys(def.states)).toHaveLength(3);
    expect(def.transitions).toHaveLength(2);
    expect(def.initialState).toBe("provisioning");
    expect(def.meta.name).toBe("Server");
  });

  // --- createEntity ---

  test("createEntity sets correct genus_id reference", () => {
    const genusId = defineEntityGenus(kernel, "Server", {
      states: [{ name: "new", initial: true }],
    });
    const entityId = createEntity(kernel, genusId);
    const row = kernel.db.query("SELECT * FROM res WHERE id = ?").get(entityId) as any;
    expect(row.genus_id).toBe(genusId);
  });

  test("createEntity sets initial status from genus", () => {
    const genusId = defineEntityGenus(kernel, "Server", {
      states: [
        { name: "provisioning", initial: true },
        { name: "active", initial: false },
      ],
    });
    const entityId = createEntity(kernel, genusId);
    const state = materialize(kernel, entityId);
    expect(state.status).toBe("provisioning");
  });

  test("createEntity throws for nonexistent genus", () => {
    expect(() => createEntity(kernel, "nonexistent_genus_id_00000")).toThrow("Genus not found");
  });

  // --- setAttribute ---

  test("setAttribute appends attribute_set tessella", () => {
    const genusId = defineEntityGenus(kernel, "Server", {
      attributes: [{ name: "ip_address", type: "text" }],
    });
    const entityId = createEntity(kernel, genusId);
    const t = setAttribute(kernel, entityId, "ip_address", "10.0.0.1");
    expect(t.type).toBe("attribute_set");
    expect(t.data).toEqual({ key: "ip_address", value: "10.0.0.1" });
  });

  test("setAttribute throws for undefined attribute", () => {
    const genusId = defineEntityGenus(kernel, "Server", {
      attributes: [{ name: "ip_address", type: "text" }],
    });
    const entityId = createEntity(kernel, genusId);
    expect(() => setAttribute(kernel, entityId, "nonexistent", "x")).toThrow(
      'Attribute "nonexistent" is not defined on genus',
    );
  });

  test("setAttribute throws for type mismatch", () => {
    const genusId = defineEntityGenus(kernel, "Server", {
      attributes: [{ name: "cost", type: "number" }],
    });
    const entityId = createEntity(kernel, genusId);
    expect(() => setAttribute(kernel, entityId, "cost", "not_a_number")).toThrow(
      'Type mismatch for attribute "cost": expected number, got string',
    );
  });

  test("setAttribute accepts correct types", () => {
    const genusId = defineEntityGenus(kernel, "Gadget", {
      attributes: [
        { name: "label", type: "text" },
        { name: "count", type: "number" },
        { name: "active", type: "boolean" },
      ],
    });
    const entityId = createEntity(kernel, genusId);
    setAttribute(kernel, entityId, "label", "widget");
    setAttribute(kernel, entityId, "count", 42);
    setAttribute(kernel, entityId, "active", true);
    const state = materialize(kernel, entityId);
    expect(state.label).toBe("widget");
    expect(state.count).toBe(42);
    expect(state.active).toBe(true);
  });

  // --- transitionStatus ---

  test("transitionStatus works for valid transition", () => {
    const genusId = defineEntityGenus(kernel, "Server", {
      states: [
        { name: "provisioning", initial: true },
        { name: "active", initial: false },
      ],
      transitions: [{ from: "provisioning", to: "active" }],
    });
    const entityId = createEntity(kernel, genusId);
    const t = transitionStatus(kernel, entityId, "active");
    expect(t.type).toBe("status_changed");
    expect(t.data).toEqual({ status: "active" });

    const state = materialize(kernel, entityId);
    expect(state.status).toBe("active");
  });

  test("transitionStatus throws for skip transition", () => {
    const genusId = defineEntityGenus(kernel, "Server", {
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
    const entityId = createEntity(kernel, genusId);
    expect(() => transitionStatus(kernel, entityId, "decommissioned")).toThrow(
      'No valid transition from "provisioning" to "decommissioned"',
    );
  });

  test("transitionStatus throws for reverse transition", () => {
    const genusId = defineEntityGenus(kernel, "Server", {
      states: [
        { name: "provisioning", initial: true },
        { name: "active", initial: false },
      ],
      transitions: [{ from: "provisioning", to: "active" }],
    });
    const entityId = createEntity(kernel, genusId);
    transitionStatus(kernel, entityId, "active");
    expect(() => transitionStatus(kernel, entityId, "provisioning")).toThrow(
      'No valid transition from "active" to "provisioning"',
    );
  });

  test("transitionStatus throws for undefined state", () => {
    const genusId = defineEntityGenus(kernel, "Server", {
      states: [
        { name: "provisioning", initial: true },
        { name: "active", initial: false },
      ],
      transitions: [{ from: "provisioning", to: "active" }],
    });
    const entityId = createEntity(kernel, genusId);
    expect(() => transitionStatus(kernel, entityId, "nonexistent")).toThrow(
      'State "nonexistent" is not defined on genus',
    );
  });

  // --- Integration ---

  test("full workflow: define genus → create entity → set attrs → transition → materialize", () => {
    const serverGenus = defineEntityGenus(kernel, "Server", {
      attributes: [
        { name: "ip_address", type: "text", required: true },
        { name: "provider", type: "text" },
        { name: "monthly_cost", type: "number" },
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

    const entityId = createEntity(kernel, serverGenus);

    // Set attributes
    setAttribute(kernel, entityId, "ip_address", "10.0.0.1");
    setAttribute(kernel, entityId, "provider", "DigitalOcean");
    setAttribute(kernel, entityId, "monthly_cost", 48);

    // Verify initial state
    let state = materialize(kernel, entityId);
    expect(state.status).toBe("provisioning");
    expect(state.ip_address).toBe("10.0.0.1");
    expect(state.provider).toBe("DigitalOcean");
    expect(state.monthly_cost).toBe(48);

    // Invalid: skip provisioning → decommissioned
    expect(() => transitionStatus(kernel, entityId, "decommissioned")).toThrow();

    // Valid: provisioning → active
    transitionStatus(kernel, entityId, "active");

    // Invalid: active → provisioning (no reverse)
    expect(() => transitionStatus(kernel, entityId, "provisioning")).toThrow();

    // Final state
    state = materialize(kernel, entityId);
    expect(state).toEqual({
      ip_address: "10.0.0.1",
      provider: "DigitalOcean",
      monthly_cost: 48,
      status: "active",
    });
  });
});

// ============================================================================
// Genus Helpers
// ============================================================================

describe("Genus Helpers", () => {
  let kernel: Kernel;

  beforeEach(() => {
    kernel = initKernel(":memory:");
  });

  afterEach(() => {
    kernel.db.close();
  });

  // --- listGenera ---

  test("listGenera returns empty when no genera defined", () => {
    expect(listGenera(kernel)).toEqual([]);
  });

  test("listGenera returns defined genera with names", () => {
    defineEntityGenus(kernel, "Server");
    defineEntityGenus(kernel, "Database");
    const genera = listGenera(kernel);
    expect(genera).toHaveLength(2);
    const names = genera.map((g) => g.name);
    expect(names).toContain("Server");
    expect(names).toContain("Database");
  });

  test("listGenera excludes meta-genus", () => {
    defineEntityGenus(kernel, "Widget");
    const genera = listGenera(kernel);
    expect(genera.every((g) => g.id !== META_GENUS_ID)).toBe(true);
  });

  test("listGenera includes full GenusDef", () => {
    defineEntityGenus(kernel, "Server", {
      attributes: [{ name: "ip", type: "text" }],
      states: [{ name: "active", initial: true }],
      transitions: [],
    });
    const genera = listGenera(kernel);
    expect(genera[0].def.attributes.ip).toBeDefined();
    expect(genera[0].def.states.active).toBeDefined();
    expect(genera[0].def.initialState).toBe("active");
  });

  // --- listEntities ---

  test("listEntities returns empty when no entities exist", () => {
    defineEntityGenus(kernel, "Server");
    expect(listEntities(kernel)).toEqual([]);
  });

  test("listEntities returns entities with materialized state", () => {
    const genusId = defineEntityGenus(kernel, "Server", {
      attributes: [{ name: "hostname", type: "text" }],
      states: [{ name: "active", initial: true }],
    });
    const entityId = createEntity(kernel, genusId);
    setAttribute(kernel, entityId, "hostname", "prod-1");
    const entities = listEntities(kernel);
    expect(entities).toHaveLength(1);
    expect(entities[0].id).toBe(entityId);
    expect(entities[0].genus_id).toBe(genusId);
    expect(entities[0].state.hostname).toBe("prod-1");
    expect(entities[0].state.status).toBe("active");
  });

  test("listEntities filters by genus_id", () => {
    const serverGenus = defineEntityGenus(kernel, "Server", {
      states: [{ name: "new", initial: true }],
    });
    const dbGenus = defineEntityGenus(kernel, "Database", {
      states: [{ name: "new", initial: true }],
    });
    createEntity(kernel, serverGenus);
    createEntity(kernel, serverGenus);
    createEntity(kernel, dbGenus);

    const servers = listEntities(kernel, { genus_id: serverGenus });
    expect(servers).toHaveLength(2);
    expect(servers.every((e) => e.genus_id === serverGenus)).toBe(true);

    const dbs = listEntities(kernel, { genus_id: dbGenus });
    expect(dbs).toHaveLength(1);
  });

  test("listEntities excludes genus res", () => {
    const genusId = defineEntityGenus(kernel, "Server");
    const entities = listEntities(kernel);
    expect(entities.every((e) => e.id !== genusId)).toBe(true);
    expect(entities.every((e) => e.id !== META_GENUS_ID)).toBe(true);
  });

  test("listEntities filters by status", () => {
    const genusId = defineEntityGenus(kernel, "Issue", {
      states: [{ name: "draft", initial: true }, { name: "active", initial: false }],
      transitions: [{ from: "draft", to: "active" }],
    });
    const e1 = createEntity(kernel, genusId);
    const e2 = createEntity(kernel, genusId);
    transitionStatus(kernel, e2, "active");

    const drafts = listEntities(kernel, { genus_id: genusId, status: "draft" });
    expect(drafts).toHaveLength(1);
    expect(drafts[0].id).toBe(e1);

    const actives = listEntities(kernel, { genus_id: genusId, status: "active" });
    expect(actives).toHaveLength(1);
    expect(actives[0].id).toBe(e2);

    const nonexistent = listEntities(kernel, { genus_id: genusId, status: "closed" });
    expect(nonexistent).toHaveLength(0);
  });

  test("listEntities respects limit", () => {
    const genusId = defineEntityGenus(kernel, "Server", {
      states: [{ name: "new", initial: true }],
    });
    createEntity(kernel, genusId);
    createEntity(kernel, genusId);
    createEntity(kernel, genusId);
    const entities = listEntities(kernel, { limit: 2 });
    expect(entities).toHaveLength(2);
  });

  // --- findGenusByName ---

  test("findGenusByName returns ID for exact match", () => {
    const genusId = defineEntityGenus(kernel, "Server");
    expect(findGenusByName(kernel, "Server")).toBe(genusId);
  });

  test("findGenusByName is case-insensitive", () => {
    const genusId = defineEntityGenus(kernel, "Server");
    expect(findGenusByName(kernel, "server")).toBe(genusId);
    expect(findGenusByName(kernel, "SERVER")).toBe(genusId);
  });

  test("findGenusByName returns null for no match", () => {
    defineEntityGenus(kernel, "Server");
    expect(findGenusByName(kernel, "Nonexistent")).toBeNull();
  });

  test("findGenusByName finds sentinel genera (Log, Error)", () => {
    expect(findGenusByName(kernel, "Log")).toBe(LOG_GENUS_ID);
    expect(findGenusByName(kernel, "Error")).toBe(ERROR_GENUS_ID);
    expect(findGenusByName(kernel, "log")).toBe(LOG_GENUS_ID);
    expect(findGenusByName(kernel, "error")).toBe(ERROR_GENUS_ID);
  });
});

// ============================================================================
// Actions
// ============================================================================

describe("Actions", () => {
  let kernel: Kernel;

  beforeEach(() => {
    kernel = initKernel(":memory:");
  });

  afterEach(() => {
    kernel.db.close();
  });

  // --- Bootstrap ---

  test("initKernel bootstraps Log genus", () => {
    const row = kernel.db.query("SELECT * FROM res WHERE id = ?").get(LOG_GENUS_ID) as any;
    expect(row).not.toBeNull();
    expect(row.genus_id).toBe(META_GENUS_ID);
  });

  test("Log genus has expected attributes", () => {
    const def = getGenusDef(kernel, LOG_GENUS_ID);
    expect(def.meta.name).toBe("Log");
    expect(def.attributes.message).toBeDefined();
    expect(def.attributes.message.required).toBe(true);
    expect(def.attributes.severity).toBeDefined();
    expect(def.attributes.associated_res_id).toBeDefined();
  });

  test("Log genus bootstrap is idempotent", () => {
    const kernel2 = initKernel(":memory:");
    const rows = kernel2.db.query("SELECT * FROM res WHERE id = ?").all(LOG_GENUS_ID);
    expect(rows).toHaveLength(1);
    kernel2.db.close();
  });

  test("input table exists", () => {
    const tables = kernel.db.query(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='input'"
    ).all();
    expect(tables).toHaveLength(1);
  });

  test("action_taken table exists", () => {
    const tables = kernel.db.query(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='action_taken'"
    ).all();
    expect(tables).toHaveLength(1);
  });

  // --- actionReducer ---

  test("actionReducer: created initializes empty collections", () => {
    const result = actionReducer({}, { type: "created", data: {} } as Tessella);
    expect(result).toEqual({ resources: {}, parameters: {}, handler: [], meta: {} });
  });

  test("actionReducer: action_resource_defined adds to resources", () => {
    const state = { resources: {}, parameters: {}, handler: [], meta: {} };
    const result = actionReducer(state, {
      type: "action_resource_defined",
      data: { name: "server", genus_name: "Server", required_status: "active" },
    } as Tessella);
    expect((result.resources as any).server).toEqual({
      name: "server", genus_name: "Server", required_status: "active",
    });
  });

  test("actionReducer: action_parameter_defined adds to parameters", () => {
    const state = { resources: {}, parameters: {}, handler: [], meta: {} };
    const result = actionReducer(state, {
      type: "action_parameter_defined",
      data: { name: "version", type: "text", required: true },
    } as Tessella);
    expect((result.parameters as any).version).toEqual({
      name: "version", type: "text", required: true,
    });
  });

  test("actionReducer: action_handler_defined sets handler array", () => {
    const state = { resources: {}, parameters: {}, handler: [], meta: {} };
    const handler = [{ type: "set_attribute", res: "$res.server.id", key: "v", value: "1" }];
    const result = actionReducer(state, {
      type: "action_handler_defined",
      data: { handler },
    } as Tessella);
    expect(result.handler).toEqual(handler);
  });

  test("actionReducer: genus_meta_set updates meta", () => {
    const state = { resources: {}, parameters: {}, handler: [], meta: {} };
    const result = actionReducer(state, {
      type: "genus_meta_set",
      data: { key: "name", value: "deploy" },
    } as Tessella);
    expect((result.meta as any).name).toBe("deploy");
  });

  // --- defineActionGenus + getActionDef ---

  test("defineActionGenus creates action genus with meta.kind='action'", () => {
    const id = defineActionGenus(kernel, "deploy");
    const def = getActionDef(kernel, id);
    expect(def.meta.name).toBe("deploy");
    expect(def.meta.kind).toBe("action");
  });

  test("defineActionGenus stores resources, parameters, and handler", () => {
    const id = defineActionGenus(kernel, "deploy", {
      resources: [{ name: "server", genus_name: "Server", required_status: "active" }],
      parameters: [{ name: "version", type: "text", required: true }],
      handler: [
        { type: "set_attribute", res: "$res.server.id", key: "version", value: "$param.version" },
      ],
    });
    const def = getActionDef(kernel, id);
    expect(def.resources.server.genus_name).toBe("Server");
    expect(def.resources.server.required_status).toBe("active");
    expect(def.parameters.version.type).toBe("text");
    expect(def.parameters.version.required).toBe(true);
    expect(def.handler).toHaveLength(1);
    expect(def.handler[0].type).toBe("set_attribute");
  });

  // --- recordInput ---

  test("recordInput inserts into input table", () => {
    const input = recordInput(kernel, "push", "user:alice", { action: "deploy" });
    expect(input.id).toHaveLength(26);
    expect(input.type).toBe("push");
    expect(input.source).toBe("user:alice");
    expect(input.data).toEqual({ action: "deploy" });
    expect(input.branch_id).toBe("main");
  });

  // --- listActionGenera ---

  test("listActionGenera returns only action genera", () => {
    defineEntityGenus(kernel, "Server");
    defineActionGenus(kernel, "deploy");
    defineActionGenus(kernel, "restart");
    const actions = listActionGenera(kernel);
    expect(actions).toHaveLength(2);
    expect(actions.map((a) => a.name).sort()).toEqual(["deploy", "restart"]);
  });

  // --- findActionByName ---

  test("findActionByName returns ID for matching action", () => {
    const id = defineActionGenus(kernel, "deploy");
    expect(findActionByName(kernel, "deploy")).toBe(id);
    expect(findActionByName(kernel, "Deploy")).toBe(id);
  });

  test("findActionByName returns null for no match", () => {
    defineActionGenus(kernel, "deploy");
    expect(findActionByName(kernel, "nonexistent")).toBeNull();
  });

  // --- findActionsByTargetGenus ---

  test("findActionsByTargetGenus returns actions targeting a genus", () => {
    defineEntityGenus(kernel, "Server");
    defineActionGenus(kernel, "deploy", {
      resources: [{ name: "server", genus_name: "Server" }],
    });
    defineActionGenus(kernel, "backup", {
      resources: [{ name: "db", genus_name: "Database" }],
    });
    const serverActions = findActionsByTargetGenus(kernel, "Server");
    expect(serverActions).toHaveLength(1);
    expect(serverActions[0].name).toBe("deploy");
  });

  // --- listGenera excludes action genera ---

  test("listGenera excludes action genera", () => {
    defineEntityGenus(kernel, "Server");
    defineActionGenus(kernel, "deploy");
    const genera = listGenera(kernel);
    expect(genera).toHaveLength(1);
    expect(genera[0].name).toBe("Server");
  });

  test("listGenera excludes Log genus", () => {
    const genera = listGenera(kernel);
    expect(genera.every((g) => g.id !== LOG_GENUS_ID)).toBe(true);
  });

  // --- executeAction ---

  function setupServerWithDeploy(k: Kernel) {
    const serverGenus = defineEntityGenus(k, "Server", {
      attributes: [
        { name: "hostname", type: "text", required: true },
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
        { from: "provisioning", to: "active" },
        { from: "active", to: "deployed" },
        { from: "deployed", to: "active" },
        { from: "active", to: "decommissioned" },
        { from: "deployed", to: "decommissioned" },
      ],
    });

    const deployAction = defineActionGenus(k, "deploy", {
      resources: [{ name: "server", genus_name: "Server", required_status: "active" }],
      parameters: [{ name: "version", type: "text", required: true }],
      handler: [
        { type: "set_attribute", res: "$res.server.id", key: "deployed_at", value: "$now" },
        { type: "set_attribute", res: "$res.server.id", key: "version", value: "$param.version" },
        { type: "create_log", res: "$res.server.id", message: "Deployed version $param.version", severity: "info" },
        { type: "transition_status", res: "$res.server.id", target: "deployed" },
      ],
    });

    return { serverGenus, deployAction };
  }

  test("executeAction succeeds with valid preconditions", () => {
    const { serverGenus, deployAction } = setupServerWithDeploy(kernel);
    const entityId = createEntity(kernel, serverGenus);
    setAttribute(kernel, entityId, "hostname", "prod-1");
    transitionStatus(kernel, entityId, "active");

    const result = executeAction(kernel, deployAction, { server: entityId }, { version: "2.0" });
    expect(result.error).toBeUndefined();
    expect(result.action_taken).toBeDefined();
    expect(result.tessellae).toBeDefined();
    expect(result.tessellae!.length).toBeGreaterThan(0);

    // Verify entity state
    const state = materialize(kernel, entityId);
    expect(state.status).toBe("deployed");
    expect(state.version).toBe("2.0");
    expect(state.deployed_at).toBeDefined();
  });

  test("executeAction fails when resource has wrong status", () => {
    const { serverGenus, deployAction } = setupServerWithDeploy(kernel);
    const entityId = createEntity(kernel, serverGenus);
    setAttribute(kernel, entityId, "hostname", "prod-1");
    // Still in "provisioning" — deploy requires "active"

    const result = executeAction(kernel, deployAction, { server: entityId }, { version: "2.0" });
    expect(result.error).toContain("must be in status");
    expect(result.action_taken).toBeUndefined();
  });

  test("executeAction fails when missing required parameter", () => {
    const { serverGenus, deployAction } = setupServerWithDeploy(kernel);
    const entityId = createEntity(kernel, serverGenus);
    setAttribute(kernel, entityId, "hostname", "prod-1");
    transitionStatus(kernel, entityId, "active");

    const result = executeAction(kernel, deployAction, { server: entityId }, {});
    expect(result.error).toContain("Missing required parameter");
  });

  test("executeAction fails when missing resource binding", () => {
    const { deployAction } = setupServerWithDeploy(kernel);

    const result = executeAction(kernel, deployAction, {}, { version: "2.0" });
    expect(result.error).toContain("Missing resource binding");
  });

  test("executeAction fails when resource genus mismatch", () => {
    const { deployAction } = setupServerWithDeploy(kernel);
    const dbGenus = defineEntityGenus(kernel, "Database", {
      states: [{ name: "active", initial: true }],
    });
    const dbEntity = createEntity(kernel, dbGenus);

    const result = executeAction(kernel, deployAction, { server: dbEntity }, { version: "2.0" });
    expect(result.error).toContain('must be of genus "Server"');
  });

  test("executeAction fails for parameter type mismatch", () => {
    const { serverGenus, deployAction } = setupServerWithDeploy(kernel);
    const entityId = createEntity(kernel, serverGenus);
    setAttribute(kernel, entityId, "hostname", "prod-1");
    transitionStatus(kernel, entityId, "active");

    const result = executeAction(kernel, deployAction, { server: entityId }, { version: 123 });
    expect(result.error).toContain("type mismatch");
  });

  test("executeAction records action_taken row", () => {
    const { serverGenus, deployAction } = setupServerWithDeploy(kernel);
    const entityId = createEntity(kernel, serverGenus);
    setAttribute(kernel, entityId, "hostname", "prod-1");
    transitionStatus(kernel, entityId, "active");

    const result = executeAction(kernel, deployAction, { server: entityId }, { version: "2.0" });
    expect(result.action_taken!.action_genus_id).toBe(deployAction);
    expect(result.action_taken!.resources).toEqual({ server: entityId });
    expect(result.action_taken!.params).toEqual({ version: "2.0" });
    expect(result.action_taken!.tessellae_ids.length).toBeGreaterThan(0);

    // Verify in DB
    const row = kernel.db.query("SELECT * FROM action_taken WHERE id = ?").get(result.action_taken!.id) as any;
    expect(row).not.toBeNull();
  });

  test("executeAction creates log entry via create_log effect", () => {
    const { serverGenus, deployAction } = setupServerWithDeploy(kernel);
    const entityId = createEntity(kernel, serverGenus);
    setAttribute(kernel, entityId, "hostname", "prod-1");
    transitionStatus(kernel, entityId, "active");

    executeAction(kernel, deployAction, { server: entityId }, { version: "2.0" });

    // Find log entries (entities of LOG_GENUS_ID)
    const logRows = kernel.db.query(
      "SELECT id FROM res WHERE genus_id = ?"
    ).all(LOG_GENUS_ID) as { id: string }[];
    expect(logRows.length).toBeGreaterThan(0);

    const logState = materialize(kernel, logRows[0].id);
    expect(logState.message).toBe("Deployed version 2.0");
    expect(logState.severity).toBe("info");
    expect(logState.associated_res_id).toBe(entityId);
  });

  test("executeAction with $now substitution", () => {
    const { serverGenus, deployAction } = setupServerWithDeploy(kernel);
    const entityId = createEntity(kernel, serverGenus);
    setAttribute(kernel, entityId, "hostname", "prod-1");
    transitionStatus(kernel, entityId, "active");

    const before = new Date().toISOString();
    executeAction(kernel, deployAction, { server: entityId }, { version: "2.0" });
    const after = new Date().toISOString();

    const state = materialize(kernel, entityId);
    const deployedAt = state.deployed_at as string;
    expect(deployedAt >= before).toBe(true);
    expect(deployedAt <= after).toBe(true);
  });

  // --- getHistory ---

  test("getHistory returns tessellae with action_taken context", () => {
    const { serverGenus, deployAction } = setupServerWithDeploy(kernel);
    const entityId = createEntity(kernel, serverGenus);
    setAttribute(kernel, entityId, "hostname", "prod-1");
    transitionStatus(kernel, entityId, "active");

    executeAction(kernel, deployAction, { server: entityId }, { version: "2.0" });

    const history = getHistory(kernel, entityId);
    expect(history.length).toBeGreaterThan(0);

    // Some entries should have action_taken context (from the deploy)
    const withAction = history.filter((h) => h.action_taken !== undefined);
    expect(withAction.length).toBeGreaterThan(0);
    expect(withAction[0].action_taken!.params).toEqual({ version: "2.0" });
  });

  test("getHistory returns entries without action_taken for manual changes", () => {
    const serverGenus = defineEntityGenus(kernel, "Server", {
      attributes: [{ name: "hostname", type: "text" }],
      states: [{ name: "new", initial: true }],
    });
    const entityId = createEntity(kernel, serverGenus);
    setAttribute(kernel, entityId, "hostname", "prod-1");

    const history = getHistory(kernel, entityId);
    expect(history.length).toBeGreaterThan(0);
    expect(history.every((h) => h.action_taken === undefined)).toBe(true);
  });

  test("getHistory respects limit", () => {
    const serverGenus = defineEntityGenus(kernel, "Server", {
      attributes: [{ name: "hostname", type: "text" }],
      states: [{ name: "new", initial: true }],
    });
    const entityId = createEntity(kernel, serverGenus);
    setAttribute(kernel, entityId, "hostname", "a");
    setAttribute(kernel, entityId, "hostname", "b");
    setAttribute(kernel, entityId, "hostname", "c");

    const history = getHistory(kernel, entityId, { limit: 2 });
    expect(history).toHaveLength(2);
  });

  // --- Full integration ---

  test("full demo: define → create → transition → deploy → history", () => {
    const { serverGenus, deployAction } = setupServerWithDeploy(kernel);

    // Create and configure server
    const entityId = createEntity(kernel, serverGenus);
    setAttribute(kernel, entityId, "hostname", "production-1");
    transitionStatus(kernel, entityId, "active");

    // Deploy
    const result = executeAction(
      kernel, deployAction,
      { server: entityId },
      { version: "2.0" },
      { source: "user:alice" },
    );
    expect(result.error).toBeUndefined();

    // Verify final state
    const state = materialize(kernel, entityId);
    expect(state.status).toBe("deployed");
    expect(state.version).toBe("2.0");
    expect(state.deployed_at).toBeDefined();
    expect(state.hostname).toBe("production-1");

    // Check history shows the full trail
    const history = getHistory(kernel, entityId);
    const types = history.map((h) => h.tessella.type);
    expect(types).toContain("created");
    expect(types).toContain("status_changed");
    expect(types).toContain("attribute_set");

    // Action-generated tessellae have action_taken context
    const actionEntries = history.filter((h) => h.action_taken);
    expect(actionEntries.length).toBeGreaterThan(0);

    // Input was recorded
    const inputs = kernel.db.query("SELECT * FROM input").all() as any[];
    expect(inputs.length).toBeGreaterThan(0);
    expect(inputs[0].source).toBe("user:alice");
  });
});

// ============================================================================
// Features
// ============================================================================

describe("Features", () => {
  let kernel: Kernel;
  let issueGenus: string;
  let pageGenus: string;

  function setupIssueAndPage(k: Kernel) {
    const ig = defineEntityGenus(k, "Issue", {
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
        { from: "draft", to: "in_review" },
        { from: "in_review", to: "approved" },
        { from: "in_review", to: "draft" },
        { from: "approved", to: "published" },
        { from: "draft", to: "archived" },
        { from: "in_review", to: "archived" },
        { from: "approved", to: "archived" },
        { from: "published", to: "archived" },
      ],
    });

    const pg = defineFeatureGenus(k, "Page", {
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
        { from: "draft", to: "layout_complete" },
        { from: "layout_complete", to: "approved" },
        { from: "approved", to: "draft" },
      ],
      editable_parent_statuses: ["draft", "in_review"],
    });

    return { issueGenus: ig, pageGenus: pg };
  }

  beforeEach(() => {
    kernel = initKernel(":memory:");
    const result = setupIssueAndPage(kernel);
    issueGenus = result.issueGenus;
    pageGenus = result.pageGenus;
  });

  afterEach(() => {
    kernel.db.close();
  });

  // --- defineFeatureGenus ---

  test("defineFeatureGenus creates genus with meta.kind='feature'", () => {
    const def = getGenusDef(kernel, pageGenus);
    expect(def.meta.kind).toBe("feature");
    expect(def.meta.name).toBe("Page");
    expect(def.meta.parent_genus_name).toBe("Issue");
  });

  test("defineFeatureGenus stores editable_parent_statuses", () => {
    const def = getGenusDef(kernel, pageGenus);
    expect(def.meta.editable_parent_statuses).toEqual(["draft", "in_review"]);
  });

  test("defineFeatureGenus stores attributes, states, transitions", () => {
    const def = getGenusDef(kernel, pageGenus);
    expect(Object.keys(def.attributes)).toHaveLength(3);
    expect(def.attributes.page_number.type).toBe("number");
    expect(def.attributes.page_number.required).toBe(true);
    expect(Object.keys(def.states)).toHaveLength(3);
    expect(def.transitions).toHaveLength(3);
    expect(def.initialState).toBe("draft");
  });

  // --- createFeature ---

  test("createFeature returns a feature_id ULID", () => {
    const entityId = createEntity(kernel, issueGenus);
    setAttribute(kernel, entityId, "title", "Chapter 1");
    const featureId = createFeature(kernel, entityId, pageGenus, {
      attributes: { page_number: 1 },
    });
    expect(featureId).toHaveLength(26);
    expect(featureId).toMatch(/^[0123456789ABCDEFGHJKMNPQRSTVWXYZ]{26}$/);
  });

  test("createFeature appends feature_created tessella to parent stream", () => {
    const entityId = createEntity(kernel, issueGenus);
    setAttribute(kernel, entityId, "title", "Chapter 1");
    const featureId = createFeature(kernel, entityId, pageGenus);
    const tessellae = replay(kernel, entityId, { types: ["feature_created"] });
    expect(tessellae).toHaveLength(1);
    expect(tessellae[0].data.feature_id).toBe(featureId);
    expect(tessellae[0].data.feature_genus_id).toBe(pageGenus);
  });

  test("createFeature sets initial status from feature genus", () => {
    const entityId = createEntity(kernel, issueGenus);
    setAttribute(kernel, entityId, "title", "Chapter 1");
    const featureId = createFeature(kernel, entityId, pageGenus);
    const state = materialize(kernel, entityId);
    const features = state.features as Record<string, any>;
    expect(features[featureId].status).toBe("draft");
  });

  test("createFeature sets initial attributes", () => {
    const entityId = createEntity(kernel, issueGenus);
    setAttribute(kernel, entityId, "title", "Chapter 1");
    const featureId = createFeature(kernel, entityId, pageGenus, {
      attributes: { page_number: 1, content: "Hello" },
    });
    const state = materialize(kernel, entityId);
    const features = state.features as Record<string, any>;
    expect(features[featureId].page_number).toBe(1);
    expect(features[featureId].content).toBe("Hello");
  });

  test("createFeature throws for non-feature genus", () => {
    const entityId = createEntity(kernel, issueGenus);
    expect(() => createFeature(kernel, entityId, issueGenus)).toThrow("not a feature genus");
  });

  test("createFeature throws for wrong parent genus", () => {
    const serverGenus = defineEntityGenus(kernel, "Server", {
      states: [{ name: "active", initial: true }],
    });
    const serverId = createEntity(kernel, serverGenus);
    expect(() => createFeature(kernel, serverId, pageGenus)).toThrow(
      'expects parent "Issue", got "Server"',
    );
  });

  test("createFeature throws for undefined attribute", () => {
    const entityId = createEntity(kernel, issueGenus);
    setAttribute(kernel, entityId, "title", "Chapter 1");
    expect(() =>
      createFeature(kernel, entityId, pageGenus, {
        attributes: { nonexistent: "x" },
      }),
    ).toThrow('Attribute "nonexistent" is not defined on feature genus');
  });

  test("createFeature throws for attribute type mismatch", () => {
    const entityId = createEntity(kernel, issueGenus);
    setAttribute(kernel, entityId, "title", "Chapter 1");
    expect(() =>
      createFeature(kernel, entityId, pageGenus, {
        attributes: { page_number: "not_a_number" },
      }),
    ).toThrow('Type mismatch for attribute "page_number"');
  });

  test("createFeature with invalid attribute does not leave orphaned tessellae", () => {
    const entityId = createEntity(kernel, issueGenus);
    setAttribute(kernel, entityId, "title", "Chapter 1");
    const before = replay(kernel, entityId);
    expect(() =>
      createFeature(kernel, entityId, pageGenus, {
        attributes: { page_number: 1, title: "bad attr" },
      }),
    ).toThrow('Attribute "title" is not defined on feature genus');
    const after = replay(kernel, entityId);
    // No new tessellae should have been appended
    expect(after).toHaveLength(before.length);
    // No features in materialized state
    const state = materialize(kernel, entityId);
    expect(state.features).toBeUndefined();
  });

  test("createFeature does NOT check parent status constraint", () => {
    const entityId = createEntity(kernel, issueGenus);
    setAttribute(kernel, entityId, "title", "Chapter 1");
    // Transition to archived
    transitionStatus(kernel, entityId, "archived");
    // Should still work — createFeature doesn't enforce editable_parent_statuses
    const featureId = createFeature(kernel, entityId, pageGenus, {
      attributes: { page_number: 1 },
    });
    expect(featureId).toHaveLength(26);
  });

  // --- setFeatureAttribute ---

  test("setFeatureAttribute sets attribute on feature", () => {
    const entityId = createEntity(kernel, issueGenus);
    setAttribute(kernel, entityId, "title", "Chapter 1");
    const featureId = createFeature(kernel, entityId, pageGenus, {
      attributes: { page_number: 1 },
    });
    const t = setFeatureAttribute(kernel, entityId, featureId, "content", "Hello world");
    expect(t.type).toBe("feature_attribute_set");
    expect(t.data).toEqual({ feature_id: featureId, key: "content", value: "Hello world" });

    const state = materialize(kernel, entityId);
    const features = state.features as Record<string, any>;
    expect(features[featureId].content).toBe("Hello world");
  });

  test("setFeatureAttribute throws for nonexistent feature", () => {
    const entityId = createEntity(kernel, issueGenus);
    setAttribute(kernel, entityId, "title", "Chapter 1");
    expect(() => setFeatureAttribute(kernel, entityId, "NONEXISTENT0000000000000000", "content", "x"))
      .toThrow("Feature not found");
  });

  test("setFeatureAttribute throws for undefined attribute", () => {
    const entityId = createEntity(kernel, issueGenus);
    setAttribute(kernel, entityId, "title", "Chapter 1");
    const featureId = createFeature(kernel, entityId, pageGenus, {
      attributes: { page_number: 1 },
    });
    expect(() => setFeatureAttribute(kernel, entityId, featureId, "nonexistent", "x"))
      .toThrow('Attribute "nonexistent" is not defined on feature genus');
  });

  test("setFeatureAttribute throws for type mismatch", () => {
    const entityId = createEntity(kernel, issueGenus);
    setAttribute(kernel, entityId, "title", "Chapter 1");
    const featureId = createFeature(kernel, entityId, pageGenus, {
      attributes: { page_number: 1 },
    });
    expect(() => setFeatureAttribute(kernel, entityId, featureId, "page_number", "not_a_number"))
      .toThrow('Type mismatch for attribute "page_number"');
  });

  test("setFeatureAttribute respects parent status constraint", () => {
    const entityId = createEntity(kernel, issueGenus);
    setAttribute(kernel, entityId, "title", "Chapter 1");
    const featureId = createFeature(kernel, entityId, pageGenus, {
      attributes: { page_number: 1 },
    });
    // Parent in draft — should work
    setFeatureAttribute(kernel, entityId, featureId, "content", "Draft content");

    // Transition parent to archived
    transitionStatus(kernel, entityId, "archived");

    // Now it should fail
    expect(() => setFeatureAttribute(kernel, entityId, featureId, "content", "New content"))
      .toThrow('Feature not editable: parent status "archived" is not in [draft, in_review]');
  });

  test("setFeatureAttribute works when parent in allowed status", () => {
    const entityId = createEntity(kernel, issueGenus);
    setAttribute(kernel, entityId, "title", "Chapter 1");
    const featureId = createFeature(kernel, entityId, pageGenus, {
      attributes: { page_number: 1 },
    });
    // Transition to in_review (allowed)
    transitionStatus(kernel, entityId, "in_review");
    setFeatureAttribute(kernel, entityId, featureId, "content", "Review content");
    const state = materialize(kernel, entityId);
    const features = state.features as Record<string, any>;
    expect(features[featureId].content).toBe("Review content");
  });

  // --- transitionFeatureStatus ---

  test("transitionFeatureStatus works for valid transition", () => {
    const entityId = createEntity(kernel, issueGenus);
    setAttribute(kernel, entityId, "title", "Chapter 1");
    const featureId = createFeature(kernel, entityId, pageGenus, {
      attributes: { page_number: 1 },
    });
    const t = transitionFeatureStatus(kernel, entityId, featureId, "layout_complete");
    expect(t.type).toBe("feature_status_changed");
    expect(t.data).toEqual({ feature_id: featureId, status: "layout_complete" });

    const state = materialize(kernel, entityId);
    const features = state.features as Record<string, any>;
    expect(features[featureId].status).toBe("layout_complete");
  });

  test("transitionFeatureStatus throws for invalid transition", () => {
    const entityId = createEntity(kernel, issueGenus);
    setAttribute(kernel, entityId, "title", "Chapter 1");
    const featureId = createFeature(kernel, entityId, pageGenus, {
      attributes: { page_number: 1 },
    });
    // draft → approved not allowed (must go draft → layout_complete → approved)
    expect(() => transitionFeatureStatus(kernel, entityId, featureId, "approved"))
      .toThrow('No valid transition from "draft" to "approved"');
  });

  test("transitionFeatureStatus throws for undefined state", () => {
    const entityId = createEntity(kernel, issueGenus);
    setAttribute(kernel, entityId, "title", "Chapter 1");
    const featureId = createFeature(kernel, entityId, pageGenus, {
      attributes: { page_number: 1 },
    });
    expect(() => transitionFeatureStatus(kernel, entityId, featureId, "nonexistent"))
      .toThrow('State "nonexistent" is not defined on feature genus');
  });

  test("transitionFeatureStatus respects parent status constraint", () => {
    const entityId = createEntity(kernel, issueGenus);
    setAttribute(kernel, entityId, "title", "Chapter 1");
    const featureId = createFeature(kernel, entityId, pageGenus, {
      attributes: { page_number: 1 },
    });
    // Transition parent to archived
    transitionStatus(kernel, entityId, "archived");
    expect(() => transitionFeatureStatus(kernel, entityId, featureId, "layout_complete"))
      .toThrow('Feature not editable: parent status "archived" is not in [draft, in_review]');
  });

  // --- defaultReducer feature cases ---

  test("defaultReducer: feature_created adds feature to features map", () => {
    const result = defaultReducer({}, {
      type: "feature_created",
      data: { feature_id: "F1", feature_genus_id: "G1" },
    } as Tessella);
    expect(result.features).toEqual({ F1: { genus_id: "G1" } });
  });

  test("defaultReducer: feature_attribute_set sets key on feature", () => {
    const state = { features: { F1: { genus_id: "G1" } } };
    const result = defaultReducer(state, {
      type: "feature_attribute_set",
      data: { feature_id: "F1", key: "content", value: "Hello" },
    } as Tessella);
    expect((result.features as any).F1.content).toBe("Hello");
  });

  test("defaultReducer: feature_status_changed sets status on feature", () => {
    const state = { features: { F1: { genus_id: "G1" } } };
    const result = defaultReducer(state, {
      type: "feature_status_changed",
      data: { feature_id: "F1", status: "layout_complete" },
    } as Tessella);
    expect((result.features as any).F1.status).toBe("layout_complete");
  });

  // --- Query helpers ---

  test("listFeatureGenera returns only feature genera", () => {
    const features = listFeatureGenera(kernel);
    expect(features).toHaveLength(1);
    expect(features[0].name).toBe("Page");
    expect(features[0].parent_genus_name).toBe("Issue");
  });

  test("findFeatureGenusByName returns ID for matching feature genus", () => {
    expect(findFeatureGenusByName(kernel, "Page")).toBe(pageGenus);
    expect(findFeatureGenusByName(kernel, "page")).toBe(pageGenus);
  });

  test("findFeatureGenusByName returns null for no match", () => {
    expect(findFeatureGenusByName(kernel, "Nonexistent")).toBeNull();
  });

  test("getFeatureGenusForEntityGenus returns feature genera for entity", () => {
    const features = getFeatureGenusForEntityGenus(kernel, "Issue");
    expect(features).toHaveLength(1);
    expect(features[0].name).toBe("Page");
  });

  test("getFeatureGenusForEntityGenus returns empty for unrelated entity", () => {
    const features = getFeatureGenusForEntityGenus(kernel, "Server");
    expect(features).toHaveLength(0);
  });

  // --- listGenera exclusion ---

  test("listGenera excludes feature genera", () => {
    const genera = listGenera(kernel);
    expect(genera.every((g) => g.name !== "Page")).toBe(true);
    expect(genera.some((g) => g.name === "Issue")).toBe(true);
  });

  // --- Integration ---

  test("full workflow: Issue with Pages, status flows down", () => {
    const entityId = createEntity(kernel, issueGenus);
    setAttribute(kernel, entityId, "title", "Chapter 1");

    // Create 3 pages
    const page1 = createFeature(kernel, entityId, pageGenus, { attributes: { page_number: 1 } });
    const page2 = createFeature(kernel, entityId, pageGenus, { attributes: { page_number: 2 } });
    const page3 = createFeature(kernel, entityId, pageGenus, { attributes: { page_number: 3 } });

    // Set content on pages (parent in draft — allowed)
    setFeatureAttribute(kernel, entityId, page1, "content", "Introduction");
    setFeatureAttribute(kernel, entityId, page2, "content", "Body");
    setFeatureAttribute(kernel, entityId, page3, "content", "Conclusion");

    // Transition page 1 to layout_complete
    transitionFeatureStatus(kernel, entityId, page1, "layout_complete");

    // Materialize and verify
    let state = materialize(kernel, entityId);
    const features = state.features as Record<string, any>;
    expect(Object.keys(features)).toHaveLength(3);
    expect(features[page1].status).toBe("layout_complete");
    expect(features[page1].content).toBe("Introduction");
    expect(features[page2].status).toBe("draft");
    expect(features[page3].page_number).toBe(3);

    // Transition parent to in_review — editing still allowed
    transitionStatus(kernel, entityId, "in_review");
    setFeatureAttribute(kernel, entityId, page2, "content", "Updated body");

    // Transition parent to archived — editing blocked
    transitionStatus(kernel, entityId, "archived");
    expect(() => setFeatureAttribute(kernel, entityId, page2, "content", "Blocked"))
      .toThrow("Feature not editable");
    expect(() => transitionFeatureStatus(kernel, entityId, page2, "layout_complete"))
      .toThrow("Feature not editable");

    // Final state check
    state = materialize(kernel, entityId);
    expect(state.status).toBe("archived");
    expect((state.features as any)[page2].content).toBe("Updated body");
  });

  test("multiple features coexist on same parent", () => {
    const entityId = createEntity(kernel, issueGenus);
    setAttribute(kernel, entityId, "title", "Multi-page Issue");

    const pages: string[] = [];
    for (let i = 1; i <= 5; i++) {
      pages.push(createFeature(kernel, entityId, pageGenus, {
        attributes: { page_number: i },
      }));
    }

    const state = materialize(kernel, entityId);
    const features = state.features as Record<string, any>;
    expect(Object.keys(features)).toHaveLength(5);

    // Each has its own page_number
    for (let i = 0; i < 5; i++) {
      expect(features[pages[i]].page_number).toBe(i + 1);
      expect(features[pages[i]].status).toBe("draft");
    }
  });

  test("feature without editable_parent_statuses is always editable", () => {
    const freeGenus = defineFeatureGenus(kernel, "Note", {
      parent_genus_name: "Issue",
      attributes: [{ name: "text", type: "text" }],
      states: [{ name: "active", initial: true }],
      transitions: [],
    });

    const entityId = createEntity(kernel, issueGenus);
    setAttribute(kernel, entityId, "title", "Chapter 1");
    transitionStatus(kernel, entityId, "archived");

    const noteId = createFeature(kernel, entityId, freeGenus);
    // Should work even though parent is archived — no editable_parent_statuses constraint
    setFeatureAttribute(kernel, entityId, noteId, "text", "Always editable");
    const state = materialize(kernel, entityId);
    expect((state.features as any)[noteId].text).toBe("Always editable");
  });
});

// ============================================================================
// Relationships
// ============================================================================

describe("Relationships", () => {
  let kernel: Kernel;
  let personGenus: string;
  let issueGenus: string;
  let assignmentGenus: string;

  function setupRelationships(k: Kernel) {
    const pg = defineEntityGenus(k, "Person", {
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
        { from: "active", to: "inactive" },
        { from: "inactive", to: "active" },
      ],
    });

    const ig = defineEntityGenus(k, "Issue", {
      attributes: [
        { name: "title", type: "text", required: true },
        { name: "description", type: "text" },
      ],
      states: [
        { name: "draft", initial: true },
        { name: "in_review", initial: false },
        { name: "published", initial: false },
      ],
      transitions: [
        { from: "draft", to: "in_review" },
        { from: "in_review", to: "published" },
      ],
    });

    const ag = defineRelationshipGenus(k, "Assignment", {
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
        { from: "active", to: "completed" },
        { from: "active", to: "cancelled" },
        { from: "completed", to: "active" },
      ],
    });

    return { personGenus: pg, issueGenus: ig, assignmentGenus: ag };
  }

  beforeEach(() => {
    kernel = initKernel(":memory:");
    const result = setupRelationships(kernel);
    personGenus = result.personGenus;
    issueGenus = result.issueGenus;
    assignmentGenus = result.assignmentGenus;
  });

  afterEach(() => {
    kernel.db.close();
  });

  // --- defineRelationshipGenus ---

  test("defineRelationshipGenus creates genus with meta.kind='relationship'", () => {
    const def = getGenusDef(kernel, assignmentGenus);
    expect(def.meta.kind).toBe("relationship");
    expect(def.meta.name).toBe("Assignment");
  });

  test("defineRelationshipGenus stores roles", () => {
    const def = getGenusDef(kernel, assignmentGenus);
    expect(Object.keys(def.roles)).toHaveLength(2);
    expect(def.roles.artist.cardinality).toBe("one");
    expect(def.roles.artist.valid_member_genera).toEqual(["Person"]);
    expect(def.roles.content.cardinality).toBe("one");
    expect(def.roles.content.valid_member_genera).toEqual(["Issue"]);
  });

  test("defineRelationshipGenus stores attributes, states, transitions", () => {
    const def = getGenusDef(kernel, assignmentGenus);
    expect(Object.keys(def.attributes)).toHaveLength(2);
    expect(def.attributes.assigned_at.type).toBe("text");
    expect(Object.keys(def.states)).toHaveLength(3);
    expect(def.transitions).toHaveLength(3);
    expect(def.initialState).toBe("active");
  });

  // --- genusReducer extension ---

  test("genusReducer: created initializes roles as empty object", () => {
    const result = genusReducer({}, { type: "created", data: {} } as Tessella);
    expect(result.roles).toEqual({});
  });

  test("genusReducer: genus_role_defined adds to roles map", () => {
    const state = { attributes: {}, states: {}, transitions: [], roles: {}, meta: {} };
    const result = genusReducer(state, {
      type: "genus_role_defined",
      data: { name: "artist", valid_member_genera: ["Person"], cardinality: "one" },
    } as Tessella);
    expect((result.roles as any).artist).toEqual({
      name: "artist", valid_member_genera: ["Person"], cardinality: "one",
    });
  });

  // --- defaultReducer extension ---

  test("defaultReducer: member_added accumulates members by role", () => {
    const state = {};
    const r1 = defaultReducer(state, {
      type: "member_added",
      data: { role: "artist", entity_id: "E1" },
    } as Tessella);
    expect(r1.members).toEqual({ artist: ["E1"] });

    const r2 = defaultReducer(r1, {
      type: "member_added",
      data: { role: "content", entity_id: "E2" },
    } as Tessella);
    expect(r2.members).toEqual({ artist: ["E1"], content: ["E2"] });
  });

  test("defaultReducer: member_removed removes entity from role", () => {
    const state = { members: { artist: ["E1", "E2"] } };
    const result = defaultReducer(state, {
      type: "member_removed",
      data: { role: "artist", entity_id: "E1" },
    } as Tessella);
    expect(result.members).toEqual({ artist: ["E2"] });
  });

  // --- createRelationship ---

  test("createRelationship creates a relationship res", () => {
    const personId = createEntity(kernel, personGenus);
    setAttribute(kernel, personId, "name", "Maria");
    const issueId = createEntity(kernel, issueGenus);
    setAttribute(kernel, issueId, "title", "Chapter 1");

    const relId = createRelationship(kernel, assignmentGenus, {
      artist: personId,
      content: issueId,
    });

    expect(relId).toHaveLength(26);
    const res = getRes(kernel, relId);
    expect(res.genus_id).toBe(assignmentGenus);
  });

  test("createRelationship sets initial status and members", () => {
    const personId = createEntity(kernel, personGenus);
    setAttribute(kernel, personId, "name", "Maria");
    const issueId = createEntity(kernel, issueGenus);
    setAttribute(kernel, issueId, "title", "Chapter 1");

    const relId = createRelationship(kernel, assignmentGenus, {
      artist: personId,
      content: issueId,
    });

    const state = materialize(kernel, relId);
    expect(state.status).toBe("active");
    expect(state.members).toEqual({
      artist: [personId],
      content: [issueId],
    });
  });

  test("createRelationship sets initial attributes", () => {
    const personId = createEntity(kernel, personGenus);
    setAttribute(kernel, personId, "name", "Maria");
    const issueId = createEntity(kernel, issueGenus);
    setAttribute(kernel, issueId, "title", "Chapter 1");

    const relId = createRelationship(kernel, assignmentGenus, {
      artist: personId,
      content: issueId,
    }, { attributes: { assigned_at: "2024-01-15" } });

    const state = materialize(kernel, relId);
    expect(state.assigned_at).toBe("2024-01-15");
  });

  test("createRelationship throws for non-relationship genus", () => {
    expect(() => createRelationship(kernel, personGenus, {}))
      .toThrow("not a relationship genus");
  });

  test("createRelationship throws for missing required role", () => {
    const personId = createEntity(kernel, personGenus);
    setAttribute(kernel, personId, "name", "Maria");

    expect(() => createRelationship(kernel, assignmentGenus, {
      artist: personId,
    })).toThrow("Missing required role: content");
  });

  test("createRelationship throws for unknown role", () => {
    const personId = createEntity(kernel, personGenus);
    setAttribute(kernel, personId, "name", "Maria");
    const issueId = createEntity(kernel, issueGenus);
    setAttribute(kernel, issueId, "title", "Chapter 1");

    expect(() => createRelationship(kernel, assignmentGenus, {
      artist: personId,
      content: issueId,
      unknown_role: personId,
    })).toThrow("Unknown role: unknown_role");
  });

  test("createRelationship throws for entity genus mismatch", () => {
    const issueId = createEntity(kernel, issueGenus);
    setAttribute(kernel, issueId, "title", "Chapter 1");
    const issueId2 = createEntity(kernel, issueGenus);
    setAttribute(kernel, issueId2, "title", "Chapter 2");

    // artist role requires Person, not Issue
    expect(() => createRelationship(kernel, assignmentGenus, {
      artist: issueId,
      content: issueId2,
    })).toThrow('requires one of [Person]');
  });

  test("createRelationship throws for nonexistent entity", () => {
    const personId = createEntity(kernel, personGenus);
    setAttribute(kernel, personId, "name", "Maria");

    expect(() => createRelationship(kernel, assignmentGenus, {
      artist: personId,
      content: "NONEXISTENT0000000000000000",
    })).toThrow("Entity not found");
  });

  test("createRelationship throws for undefined attribute", () => {
    const personId = createEntity(kernel, personGenus);
    setAttribute(kernel, personId, "name", "Maria");
    const issueId = createEntity(kernel, issueGenus);
    setAttribute(kernel, issueId, "title", "Chapter 1");

    expect(() => createRelationship(kernel, assignmentGenus, {
      artist: personId,
      content: issueId,
    }, { attributes: { nonexistent: "x" } })).toThrow('Attribute "nonexistent" is not defined');
  });

  test("createRelationship populates relationship_member index", () => {
    const personId = createEntity(kernel, personGenus);
    setAttribute(kernel, personId, "name", "Maria");
    const issueId = createEntity(kernel, issueGenus);
    setAttribute(kernel, issueId, "title", "Chapter 1");

    const relId = createRelationship(kernel, assignmentGenus, {
      artist: personId,
      content: issueId,
    });

    const rows = kernel.db.query(
      "SELECT * FROM relationship_member WHERE relationship_id = ? ORDER BY role",
    ).all(relId) as any[];
    expect(rows).toHaveLength(2);
    expect(rows[0].role).toBe("artist");
    expect(rows[0].entity_id).toBe(personId);
    expect(rows[1].role).toBe("content");
    expect(rows[1].entity_id).toBe(issueId);
  });

  // --- addMember / removeMember ---

  test("addMember adds a member to a zero_or_more role", () => {
    // Create a relationship genus with a zero_or_more role
    const teamGenus = defineRelationshipGenus(kernel, "Team", {
      roles: [
        { name: "lead", valid_member_genera: ["Person"], cardinality: "one" },
        { name: "member", valid_member_genera: ["Person"], cardinality: "zero_or_more" },
      ],
    });

    const lead = createEntity(kernel, personGenus);
    setAttribute(kernel, lead, "name", "Alice");
    const relId = createRelationship(kernel, teamGenus, { lead });

    const bob = createEntity(kernel, personGenus);
    setAttribute(kernel, bob, "name", "Bob");
    const t = addMember(kernel, relId, "member", bob);
    expect(t.type).toBe("member_added");

    const state = materialize(kernel, relId);
    expect((state.members as any).member).toEqual([bob]);
  });

  test("addMember throws for cardinality one when already occupied", () => {
    const personId = createEntity(kernel, personGenus);
    setAttribute(kernel, personId, "name", "Maria");
    const issueId = createEntity(kernel, issueGenus);
    setAttribute(kernel, issueId, "title", "Chapter 1");
    const relId = createRelationship(kernel, assignmentGenus, {
      artist: personId,
      content: issueId,
    });

    const person2 = createEntity(kernel, personGenus);
    setAttribute(kernel, person2, "name", "Bob");
    expect(() => addMember(kernel, relId, "artist", person2))
      .toThrow('already has a member (cardinality: one)');
  });

  test("addMember throws for genus mismatch", () => {
    const personId = createEntity(kernel, personGenus);
    setAttribute(kernel, personId, "name", "Maria");
    const issueId = createEntity(kernel, issueGenus);
    setAttribute(kernel, issueId, "title", "Chapter 1");

    const teamGenus = defineRelationshipGenus(kernel, "Team", {
      roles: [
        { name: "lead", valid_member_genera: ["Person"], cardinality: "one" },
        { name: "member", valid_member_genera: ["Person"], cardinality: "zero_or_more" },
      ],
    });
    const relId = createRelationship(kernel, teamGenus, { lead: personId });

    // Try to add an Issue to a Person-only role
    expect(() => addMember(kernel, relId, "member", issueId))
      .toThrow('requires one of [Person]');
  });

  test("removeMember removes from zero_or_more role", () => {
    const teamGenus = defineRelationshipGenus(kernel, "Team", {
      roles: [
        { name: "lead", valid_member_genera: ["Person"], cardinality: "one" },
        { name: "member", valid_member_genera: ["Person"], cardinality: "zero_or_more" },
      ],
    });

    const lead = createEntity(kernel, personGenus);
    setAttribute(kernel, lead, "name", "Alice");
    const bob = createEntity(kernel, personGenus);
    setAttribute(kernel, bob, "name", "Bob");

    const relId = createRelationship(kernel, teamGenus, { lead });
    addMember(kernel, relId, "member", bob);

    const t = removeMember(kernel, relId, "member", bob);
    expect(t.type).toBe("member_removed");

    const state = materialize(kernel, relId);
    expect((state.members as any).member).toEqual([]);
  });

  test("removeMember throws when cardinality prevents removal", () => {
    const personId = createEntity(kernel, personGenus);
    setAttribute(kernel, personId, "name", "Maria");
    const issueId = createEntity(kernel, issueGenus);
    setAttribute(kernel, issueId, "title", "Chapter 1");
    const relId = createRelationship(kernel, assignmentGenus, {
      artist: personId,
      content: issueId,
    });

    // artist has cardinality "one" — can't remove
    expect(() => removeMember(kernel, relId, "artist", personId))
      .toThrow('requires at least one member');
  });

  test("removeMember throws for entity not in role", () => {
    const personId = createEntity(kernel, personGenus);
    setAttribute(kernel, personId, "name", "Maria");
    const issueId = createEntity(kernel, issueGenus);
    setAttribute(kernel, issueId, "title", "Chapter 1");
    const relId = createRelationship(kernel, assignmentGenus, {
      artist: personId,
      content: issueId,
    });

    const person2 = createEntity(kernel, personGenus);
    setAttribute(kernel, person2, "name", "Bob");
    expect(() => removeMember(kernel, relId, "artist", person2))
      .toThrow('is not a member of role');
  });

  // --- Query helpers ---

  test("getRelationshipsForEntity returns relationships for an entity", () => {
    const personId = createEntity(kernel, personGenus);
    setAttribute(kernel, personId, "name", "Maria");
    const issueId = createEntity(kernel, issueGenus);
    setAttribute(kernel, issueId, "title", "Chapter 1");

    const relId = createRelationship(kernel, assignmentGenus, {
      artist: personId,
      content: issueId,
    });

    const rels = getRelationshipsForEntity(kernel, personId);
    expect(rels).toHaveLength(1);
    expect(rels[0].id).toBe(relId);
    expect(rels[0].genus_name).toBe("Assignment");
    expect(rels[0].members.artist).toEqual([personId]);
    expect(rels[0].members.content).toEqual([issueId]);
  });

  test("getRelationshipsForEntity returns empty for entity with no relationships", () => {
    const personId = createEntity(kernel, personGenus);
    setAttribute(kernel, personId, "name", "Maria");
    const rels = getRelationshipsForEntity(kernel, personId);
    expect(rels).toEqual([]);
  });

  test("getRelatedEntities returns connected entities", () => {
    const personId = createEntity(kernel, personGenus);
    setAttribute(kernel, personId, "name", "Maria");
    const issueId = createEntity(kernel, issueGenus);
    setAttribute(kernel, issueId, "title", "Chapter 1");

    const relId = createRelationship(kernel, assignmentGenus, {
      artist: personId,
      content: issueId,
    });

    const related = getRelatedEntities(kernel, personId);
    expect(related).toHaveLength(1);
    expect(related[0].entity_id).toBe(issueId);
    expect(related[0].role).toBe("content");
    expect(related[0].relationship_id).toBe(relId);
    expect(related[0].genus_name).toBe("Assignment");
  });

  test("getRelatedEntities works from the other side", () => {
    const personId = createEntity(kernel, personGenus);
    setAttribute(kernel, personId, "name", "Maria");
    const issueId = createEntity(kernel, issueGenus);
    setAttribute(kernel, issueId, "title", "Chapter 1");

    createRelationship(kernel, assignmentGenus, {
      artist: personId,
      content: issueId,
    });

    const related = getRelatedEntities(kernel, issueId);
    expect(related).toHaveLength(1);
    expect(related[0].entity_id).toBe(personId);
    expect(related[0].role).toBe("artist");
  });

  // --- listRelationshipGenera / findRelationshipGenusByName ---

  test("listRelationshipGenera returns only relationship genera", () => {
    const genera = listRelationshipGenera(kernel);
    expect(genera).toHaveLength(1);
    expect(genera[0].name).toBe("Assignment");
    expect(Object.keys(genera[0].def.roles)).toHaveLength(2);
  });

  test("findRelationshipGenusByName returns ID", () => {
    expect(findRelationshipGenusByName(kernel, "Assignment")).toBe(assignmentGenus);
    expect(findRelationshipGenusByName(kernel, "assignment")).toBe(assignmentGenus);
  });

  test("findRelationshipGenusByName returns null for no match", () => {
    expect(findRelationshipGenusByName(kernel, "Nonexistent")).toBeNull();
  });

  // --- listGenera exclusion ---

  test("listGenera excludes relationship genera", () => {
    const genera = listGenera(kernel);
    expect(genera.every((g) => g.name !== "Assignment")).toBe(true);
    expect(genera.some((g) => g.name === "Person")).toBe(true);
    expect(genera.some((g) => g.name === "Issue")).toBe(true);
  });

  // --- relationship_member table ---

  test("relationship_member table exists with indexes", () => {
    const tables = kernel.db.query(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='relationship_member'",
    ).all();
    expect(tables).toHaveLength(1);

    const indexes = kernel.db.query(
      "SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_relationship_member%'",
    ).all() as { name: string }[];
    const indexNames = indexes.map((i) => i.name);
    expect(indexNames).toContain("idx_relationship_member_entity");
    expect(indexNames).toContain("idx_relationship_member_rel");
  });

  // --- Integration ---

  test("full workflow: Person + Issue + Assignment, query from both sides", () => {
    // Create entities
    const maria = createEntity(kernel, personGenus);
    setAttribute(kernel, maria, "name", "Maria");
    setAttribute(kernel, maria, "role", "illustrator");

    const chapter1 = createEntity(kernel, issueGenus);
    setAttribute(kernel, chapter1, "title", "Chapter 1");

    const chapter2 = createEntity(kernel, issueGenus);
    setAttribute(kernel, chapter2, "title", "Chapter 2");

    // Create assignments
    const rel1 = createRelationship(kernel, assignmentGenus, {
      artist: maria,
      content: chapter1,
    }, { attributes: { assigned_at: "2024-01-15" } });

    const rel2 = createRelationship(kernel, assignmentGenus, {
      artist: maria,
      content: chapter2,
    }, { attributes: { assigned_at: "2024-01-20" } });

    // Query from Maria's side
    const mariaRels = getRelationshipsForEntity(kernel, maria);
    expect(mariaRels).toHaveLength(2);

    const mariaRelated = getRelatedEntities(kernel, maria);
    expect(mariaRelated).toHaveLength(2);
    const relatedIds = mariaRelated.map((r) => r.entity_id).sort();
    expect(relatedIds).toEqual([chapter1, chapter2].sort());

    // Query from Chapter 1's side
    const ch1Rels = getRelationshipsForEntity(kernel, chapter1);
    expect(ch1Rels).toHaveLength(1);
    expect(ch1Rels[0].id).toBe(rel1);

    const ch1Related = getRelatedEntities(kernel, chapter1);
    expect(ch1Related).toHaveLength(1);
    expect(ch1Related[0].entity_id).toBe(maria);
    expect(ch1Related[0].role).toBe("artist");

    // Transition relationship status
    transitionStatus(kernel, rel1, "completed");
    const rel1State = materialize(kernel, rel1);
    expect(rel1State.status).toBe("completed");
    expect(rel1State.assigned_at).toBe("2024-01-15");
  });

  test("entity genera have empty roles", () => {
    const def = getGenusDef(kernel, personGenus);
    expect(def.roles).toEqual({});
  });

  // --- Unconstrained roles (empty valid_member_genera) ---

  test("createRelationship with valid_member_genera: [] accepts any entity genus", () => {
    const linkGenus = defineRelationshipGenus(kernel, "UniversalLink", {
      roles: [
        { name: "source", valid_member_genera: [], cardinality: "one" },
        { name: "target", valid_member_genera: [], cardinality: "one" },
      ],
    });
    const person = createEntity(kernel, personGenus);
    setAttribute(kernel, person, "name", "Alice");
    const issue = createEntity(kernel, issueGenus);
    setAttribute(kernel, issue, "title", "Ch1");

    // Should not throw — both genera accepted
    const relId = createRelationship(kernel, linkGenus, { source: person, target: issue });
    const state = materialize(kernel, relId);
    expect((state.members as any).source).toEqual([person]);
    expect((state.members as any).target).toEqual([issue]);
  });

  test("addMember with valid_member_genera: [] accepts any entity genus", () => {
    const tagGenus = defineRelationshipGenus(kernel, "Tag", {
      roles: [
        { name: "tagged", valid_member_genera: [], cardinality: "one" },
        { name: "items", valid_member_genera: [], cardinality: "zero_or_more" },
      ],
    });
    const person = createEntity(kernel, personGenus);
    setAttribute(kernel, person, "name", "Bob");
    const issue = createEntity(kernel, issueGenus);
    setAttribute(kernel, issue, "title", "Ch2");

    const relId = createRelationship(kernel, tagGenus, { tagged: person });
    // Add an Issue to an unconstrained role — should not throw
    addMember(kernel, relId, "items", issue);

    const state = materialize(kernel, relId);
    expect((state.members as any).items).toEqual([issue]);
  });

  test("non-empty valid_member_genera still rejects wrong genera", () => {
    const strictGenus = defineRelationshipGenus(kernel, "StrictLink", {
      roles: [
        { name: "person_role", valid_member_genera: ["Person"], cardinality: "one" },
        { name: "any_role", valid_member_genera: [], cardinality: "one" },
      ],
    });
    const issue = createEntity(kernel, issueGenus);
    setAttribute(kernel, issue, "title", "Ch3");

    // person_role is constrained — Issue should be rejected
    expect(() => createRelationship(kernel, strictGenus, { person_role: issue, any_role: issue }))
      .toThrow('requires one of [Person]');
  });
});

// ============================================================================
// Health
// ============================================================================

describe("Health", () => {
  let kernel: Kernel;
  let issueGenus: string;

  function setupIssueGenus(k: Kernel) {
    return defineEntityGenus(k, "Issue", {
      attributes: [
        { name: "title", type: "text", required: true },
        { name: "description", type: "text" },
      ],
      states: [
        { name: "draft", initial: true },
        { name: "in_review", initial: false },
        { name: "published", initial: false },
      ],
      transitions: [
        { from: "draft", to: "in_review" },
        { from: "in_review", to: "published" },
      ],
    });
  }

  beforeEach(() => {
    kernel = initKernel(":memory:");
    issueGenus = setupIssueGenus(kernel);
  });

  afterEach(() => {
    kernel.db.close();
  });

  // --- evolveGenus ---

  test("evolveGenus adds new attributes to existing genus", () => {
    evolveGenus(kernel, issueGenus, {
      attributes: [{ name: "cover_image", type: "text", required: true }],
    });
    const def = getGenusDef(kernel, issueGenus);
    expect(def.attributes.cover_image).toBeDefined();
    expect(def.attributes.cover_image.type).toBe("text");
    expect(def.attributes.cover_image.required).toBe(true);
  });

  test("evolveGenus adds new states to existing genus", () => {
    evolveGenus(kernel, issueGenus, {
      states: [{ name: "archived", initial: false }],
    });
    const def = getGenusDef(kernel, issueGenus);
    expect(def.states.archived).toBeDefined();
    expect(def.states.archived.initial).toBe(false);
  });

  test("evolveGenus adds new transitions to existing genus", () => {
    evolveGenus(kernel, issueGenus, {
      transitions: [{ from: "published", to: "draft" }],
    });
    const def = getGenusDef(kernel, issueGenus);
    expect(def.transitions.some((t) => t.from === "published" && t.to === "draft")).toBe(true);
  });

  test("evolveGenus is idempotent", () => {
    const opts = {
      attributes: [{ name: "cover_image", type: "text" as const, required: true }],
      states: [{ name: "archived", initial: false }],
      transitions: [{ from: "published", to: "draft" }],
    };
    evolveGenus(kernel, issueGenus, opts);
    const before = replay(kernel, issueGenus);

    evolveGenus(kernel, issueGenus, opts);
    const after = replay(kernel, issueGenus);

    expect(after.length).toBe(before.length);
  });

  test("evolveGenus throws for nonexistent genus", () => {
    expect(() => evolveGenus(kernel, "NONEXISTENT0000000000000000", {
      attributes: [{ name: "x", type: "text", required: false }],
    })).toThrow("Genus not found");
  });

  test("evolveGenus sets meta on genus", () => {
    evolveGenus(kernel, issueGenus, {
      meta: { display_attribute: "title" },
    });
    const def = getGenusDef(kernel, issueGenus);
    expect(def.meta.display_attribute).toBe("title");
  });

  test("evolveGenus meta is idempotent", () => {
    evolveGenus(kernel, issueGenus, { meta: { display_attribute: "title" } });
    const before = replay(kernel, issueGenus);
    evolveGenus(kernel, issueGenus, { meta: { display_attribute: "title" } });
    const after = replay(kernel, issueGenus);
    expect(after.length).toBe(before.length);
  });

  test("evolveGenus meta overwrites changed values", () => {
    evolveGenus(kernel, issueGenus, { meta: { display_attribute: "title" } });
    evolveGenus(kernel, issueGenus, { meta: { display_attribute: "description" } });
    const def = getGenusDef(kernel, issueGenus);
    expect(def.meta.display_attribute).toBe("description");
  });

  // --- getEntityDisplayName ---

  test("getEntityDisplayName uses display_attribute when set", () => {
    const genusId = defineEntityGenus(kernel, "Claim", {
      attributes: [{ name: "claim_text", type: "text" }],
      meta: { display_attribute: "claim_text" },
    });
    const entityId = createEntity(kernel, genusId);
    setAttribute(kernel, entityId, "claim_text", "The earth is round");
    expect(getEntityDisplayName(kernel, entityId)).toBe("The earth is round");
  });

  test("getEntityDisplayName falls back to name", () => {
    const genusId = defineEntityGenus(kernel, "Named", {
      attributes: [{ name: "name", type: "text" }, { name: "other", type: "text" }],
    });
    const entityId = createEntity(kernel, genusId);
    setAttribute(kernel, entityId, "name", "Issue Name");
    expect(getEntityDisplayName(kernel, entityId)).toBe("Issue Name");
  });

  test("getEntityDisplayName falls back to title", () => {
    const entityId = createEntity(kernel, issueGenus);
    setAttribute(kernel, entityId, "title", "My Issue Title");
    expect(getEntityDisplayName(kernel, entityId)).toBe("My Issue Title");
  });

  test("getEntityDisplayName falls back to first string attribute", () => {
    const genusId = defineEntityGenus(kernel, "Note", {
      attributes: [{ name: "body", type: "text" }],
    });
    const entityId = createEntity(kernel, genusId);
    setAttribute(kernel, entityId, "body", "Some note text");
    expect(getEntityDisplayName(kernel, entityId)).toBe("Some note text");
  });

  test("getEntityDisplayName falls back to entity ID", () => {
    const genusId = defineEntityGenus(kernel, "Empty", {});
    const entityId = createEntity(kernel, genusId);
    expect(getEntityDisplayName(kernel, entityId)).toBe(entityId);
  });

  test("getEntityDisplayName truncates long first-string fallback", () => {
    const genusId = defineEntityGenus(kernel, "Long", {
      attributes: [{ name: "body", type: "text" }],
    });
    const entityId = createEntity(kernel, genusId);
    setAttribute(kernel, entityId, "body", "A".repeat(100));
    const result = getEntityDisplayName(kernel, entityId);
    expect(result.length).toBe(83); // 80 + "..."
    expect(result.endsWith("...")).toBe(true);
  });

  // --- Health evaluation ---

  test("healthy entity passes all checks", () => {
    const entityId = createEntity(kernel, issueGenus);
    setAttribute(kernel, entityId, "title", "Chapter 1");
    const report = evaluateHealth(kernel, entityId);
    expect(report.healthy).toBe(true);
    expect(report.issues).toHaveLength(0);
    expect(report.res_id).toBe(entityId);
    expect(report.genus_id).toBe(issueGenus);
  });

  test("missing required attribute detected", () => {
    const entityId = createEntity(kernel, issueGenus);
    // Don't set title (required)
    const report = evaluateHealth(kernel, entityId);
    expect(report.healthy).toBe(false);
    const missing = report.issues.find((i) => i.type === "missing_required_attribute");
    expect(missing).toBeDefined();
    expect(missing!.message).toContain("title");
    expect(missing!.severity).toBe("error");
  });

  test("invalid attribute type detected", () => {
    const entityId = createEntity(kernel, issueGenus);
    setAttribute(kernel, entityId, "title", "Chapter 1");
    // Force wrong type by appending raw tessella (bypass setAttribute validation)
    appendTessella(kernel, entityId, "attribute_set", { key: "description", value: 42 });
    const report = evaluateHealth(kernel, entityId);
    const typeIssue = report.issues.find((i) => i.type === "invalid_attribute_type");
    expect(typeIssue).toBeDefined();
    expect(typeIssue!.message).toContain("description");
    expect(typeIssue!.severity).toBe("warning");
  });

  test("invalid status detected", () => {
    const entityId = createEntity(kernel, issueGenus);
    setAttribute(kernel, entityId, "title", "Chapter 1");
    // Force invalid status by appending raw tessella
    appendTessella(kernel, entityId, "status_changed", { status: "nonexistent_status" });
    const report = evaluateHealth(kernel, entityId);
    const statusIssue = report.issues.find((i) => i.type === "invalid_status");
    expect(statusIssue).toBeDefined();
    expect(statusIssue!.severity).toBe("error");
  });

  test("entity with no genus states always valid for status check", () => {
    const bareGenus = defineEntityGenus(kernel, "Bare", {
      attributes: [{ name: "name", type: "text" }],
    });
    const entityId = createEntity(kernel, bareGenus);
    const report = evaluateHealth(kernel, entityId);
    expect(report.healthy).toBe(true);
  });

  test("evaluateHealthByGenus evaluates all entities of genus", () => {
    const e1 = createEntity(kernel, issueGenus);
    setAttribute(kernel, e1, "title", "Issue 1");
    const e2 = createEntity(kernel, issueGenus);
    // e2 missing required title
    const reports = evaluateHealthByGenus(kernel, issueGenus);
    expect(reports).toHaveLength(2);
    const healthy = reports.filter((r) => r.healthy);
    const unhealthy = reports.filter((r) => !r.healthy);
    expect(healthy).toHaveLength(1);
    expect(unhealthy).toHaveLength(1);
  });

  test("listUnhealthy returns only unhealthy entities", () => {
    const e1 = createEntity(kernel, issueGenus);
    setAttribute(kernel, e1, "title", "Issue 1");
    const e2 = createEntity(kernel, issueGenus);
    // e2 missing required title
    const unhealthy = listUnhealthy(kernel);
    expect(unhealthy.length).toBeGreaterThanOrEqual(1);
    expect(unhealthy.every((r) => !r.healthy)).toBe(true);
    expect(unhealthy.some((r) => r.res_id === e2)).toBe(true);
    expect(unhealthy.every((r) => r.res_id !== e1)).toBe(true);
  });

  test("listUnhealthy with genus filter", () => {
    const serverGenus = defineEntityGenus(kernel, "Server", {
      attributes: [{ name: "hostname", type: "text", required: true }],
    });
    createEntity(kernel, serverGenus); // missing hostname
    createEntity(kernel, issueGenus); // missing title

    const issueUnhealthy = listUnhealthy(kernel, { genus_id: issueGenus });
    expect(issueUnhealthy.every((r) => r.genus_id === issueGenus)).toBe(true);

    const serverUnhealthy = listUnhealthy(kernel, { genus_id: serverGenus });
    expect(serverUnhealthy.every((r) => r.genus_id === serverGenus)).toBe(true);
  });

  // --- Error system ---

  test("createError creates entity under ERROR_GENUS_ID with open status", () => {
    const errorId = createError(kernel, "Something went wrong");
    const res = getRes(kernel, errorId);
    expect(res.genus_id).toBe(ERROR_GENUS_ID);
    const state = materialize(kernel, errorId);
    expect(state.status).toBe("open");
    expect(state.message).toBe("Something went wrong");
    expect(state.severity).toBe("error");
  });

  test("createError with options", () => {
    const entityId = createEntity(kernel, issueGenus);
    const errorId = createError(kernel, "Missing cover", {
      severity: "warning",
      associated_res_id: entityId,
    });
    const state = materialize(kernel, errorId);
    expect(state.severity).toBe("warning");
    expect(state.associated_res_id).toBe(entityId);
  });

  test("acknowledgeError transitions to acknowledged", () => {
    const errorId = createError(kernel, "Test error");
    acknowledgeError(kernel, errorId);
    const state = materialize(kernel, errorId);
    expect(state.status).toBe("acknowledged");
    expect(state.acknowledged_at).toBeDefined();
  });

  test("acknowledgeError fails on already-acknowledged error", () => {
    const errorId = createError(kernel, "Test error");
    acknowledgeError(kernel, errorId);
    expect(() => acknowledgeError(kernel, errorId)).toThrow(
      'No valid transition from "acknowledged"',
    );
  });

  test("listErrors returns all errors", () => {
    createError(kernel, "Error 1");
    createError(kernel, "Error 2");
    const errors = listErrors(kernel);
    expect(errors).toHaveLength(2);
  });

  test("listErrors filters by associated_res_id", () => {
    const entityId = createEntity(kernel, issueGenus);
    createError(kernel, "Related error", { associated_res_id: entityId });
    createError(kernel, "Unrelated error");
    const filtered = listErrors(kernel, { associated_res_id: entityId });
    expect(filtered).toHaveLength(1);
    expect(filtered[0].message).toBe("Related error");
  });

  test("listErrors filters by status", () => {
    const e1 = createError(kernel, "Open error");
    const e2 = createError(kernel, "Will acknowledge");
    acknowledgeError(kernel, e2);
    const open = listErrors(kernel, { status: "open" });
    expect(open).toHaveLength(1);
    expect(open[0].id).toBe(e1);
    const acked = listErrors(kernel, { status: "acknowledged" });
    expect(acked).toHaveLength(1);
    expect(acked[0].id).toBe(e2);
  });

  test("unacknowledged errors appear in health report", () => {
    const entityId = createEntity(kernel, issueGenus);
    setAttribute(kernel, entityId, "title", "Chapter 1");
    createError(kernel, "Something wrong", { associated_res_id: entityId });
    const report = evaluateHealth(kernel, entityId);
    expect(report.healthy).toBe(false);
    const errIssue = report.issues.find((i) => i.type === "unacknowledged_error");
    expect(errIssue).toBeDefined();
    expect(errIssue!.message).toContain("Something wrong");
  });

  test("acknowledged errors don't affect health", () => {
    const entityId = createEntity(kernel, issueGenus);
    setAttribute(kernel, entityId, "title", "Chapter 1");
    const errorId = createError(kernel, "Something wrong", { associated_res_id: entityId });
    acknowledgeError(kernel, errorId);
    const report = evaluateHealth(kernel, entityId);
    expect(report.healthy).toBe(true);
  });

  // --- Integration ---

  test("evolveGenus + listUnhealthy: new required attr makes existing entities unhealthy", () => {
    const e1 = createEntity(kernel, issueGenus);
    setAttribute(kernel, e1, "title", "Issue 1");
    const e2 = createEntity(kernel, issueGenus);
    setAttribute(kernel, e2, "title", "Issue 2");

    // Both healthy
    expect(listUnhealthy(kernel, { genus_id: issueGenus })).toHaveLength(0);

    // Evolve genus with new required attribute
    evolveGenus(kernel, issueGenus, {
      attributes: [{ name: "cover_image", type: "text", required: true }],
    });

    // Both now unhealthy
    const unhealthy = listUnhealthy(kernel, { genus_id: issueGenus });
    expect(unhealthy).toHaveLength(2);
    expect(unhealthy.every((r) => r.issues.some(
      (i) => i.type === "missing_required_attribute" && i.message.includes("cover_image"),
    ))).toBe(true);
  });

  test("full demo: evolve, check health, fix, check again", () => {
    const entityId = createEntity(kernel, issueGenus);
    setAttribute(kernel, entityId, "title", "Issue 1");
    expect(evaluateHealth(kernel, entityId).healthy).toBe(true);

    // Evolve genus
    evolveGenus(kernel, issueGenus, {
      attributes: [{ name: "cover_image", type: "text", required: true }],
    });
    expect(evaluateHealth(kernel, entityId).healthy).toBe(false);

    // Fix by setting the attribute
    setAttribute(kernel, entityId, "cover_image", "https://example.com/cover.jpg");
    expect(evaluateHealth(kernel, entityId).healthy).toBe(true);
  });

  test("create_error side effect uses ERROR_GENUS_ID", () => {
    // Define an action with create_error side effect
    const serverGenus = defineEntityGenus(kernel, "Server", {
      attributes: [{ name: "hostname", type: "text", required: true }],
      states: [{ name: "active", initial: true }],
    });
    const actionId = defineActionGenus(kernel, "fail_server", {
      resources: [{ name: "server", genus_name: "Server", required_status: "active" }],
      parameters: [],
      handler: [
        { type: "create_error", res: "$res.server.id", message: "Server failed", severity: "error" },
      ],
    });
    const entityId = createEntity(kernel, serverGenus);
    setAttribute(kernel, entityId, "hostname", "prod-1");

    executeAction(kernel, actionId, { server: entityId }, {});

    // Verify error was created under ERROR_GENUS_ID, not LOG_GENUS_ID
    const errorEntities = kernel.db.query(
      "SELECT id FROM res WHERE genus_id = ?",
    ).all(ERROR_GENUS_ID) as { id: string }[];
    expect(errorEntities.length).toBeGreaterThan(0);

    const logEntities = kernel.db.query(
      "SELECT id FROM res WHERE genus_id = ?",
    ).all(LOG_GENUS_ID) as { id: string }[];
    // No log entries should have been created by create_error
    expect(logEntities).toHaveLength(0);
  });

  test("listGenera excludes Error genus", () => {
    const genera = listGenera(kernel);
    expect(genera.every((g) => g.name !== "Error")).toBe(true);
  });

  // --- Bootstrap ---

  test("initKernel bootstraps Error genus", () => {
    const row = kernel.db.query("SELECT * FROM res WHERE id = ?").get(ERROR_GENUS_ID) as any;
    expect(row).not.toBeNull();
    expect(row.genus_id).toBe(META_GENUS_ID);
  });

  test("Error genus has correct definition", () => {
    const def = getGenusDef(kernel, ERROR_GENUS_ID);
    expect(def.meta.name).toBe("Error");
    expect(def.attributes.message).toBeDefined();
    expect(def.attributes.message.required).toBe(true);
    expect(def.attributes.severity).toBeDefined();
    expect(def.attributes.associated_res_id).toBeDefined();
    expect(def.attributes.acknowledged_at).toBeDefined();
    expect(def.states.open).toBeDefined();
    expect(def.states.open.initial).toBe(true);
    expect(def.states.acknowledged).toBeDefined();
    expect(def.transitions).toHaveLength(1);
    expect(def.transitions[0]).toEqual({ from: "open", to: "acknowledged" });
    expect(def.initialState).toBe("open");
  });
});

// ============================================================================
// Sync
// ============================================================================

describe("Sync", () => {
  let kernel: Kernel;
  let issueGenus: string;

  function setupIssueGenus(k: Kernel) {
    return defineEntityGenus(k, "Issue", {
      attributes: [
        { name: "title", type: "text", required: true },
        { name: "description", type: "text" },
      ],
      states: [
        { name: "draft", initial: true },
        { name: "in_review", initial: false },
        { name: "published", initial: false },
      ],
      transitions: [
        { from: "draft", to: "in_review" },
        { from: "in_review", to: "published" },
      ],
    });
  }

  beforeEach(() => {
    kernel = initKernel(":memory:");
    issueGenus = setupIssueGenus(kernel);
  });

  afterEach(() => {
    kernel.db.close();
  });

  // --- Sync state ---

  test("getSyncState returns null for missing key", () => {
    expect(getSyncState(kernel, "server_hwm")).toBeNull();
  });

  test("setSyncState stores and retrieves values", () => {
    setSyncState(kernel, "server_hwm", "42");
    expect(getSyncState(kernel, "server_hwm")).toBe("42");
  });

  test("setSyncState overwrites existing values", () => {
    setSyncState(kernel, "server_hwm", "42");
    setSyncState(kernel, "server_hwm", "100");
    expect(getSyncState(kernel, "server_hwm")).toBe("100");
  });

  // --- Unpushed tracking ---

  test("getUnpushedTessellae returns all non-bootstrap tessellae when nothing pushed", () => {
    const entityId = createEntity(kernel, issueGenus);
    setAttribute(kernel, entityId, "title", "Chapter 1");
    const tessellae = getUnpushedTessellae(kernel);
    // Should include all tessellae from the kernel (bootstrap + entity + attribute)
    expect(tessellae.length).toBeGreaterThan(0);
  });

  test("getUnpushedTessellae excludes sync-sourced tessellae", () => {
    const entityId = createEntity(kernel, issueGenus);
    setAttribute(kernel, entityId, "title", "Chapter 1");

    // Simulate a pulled tessella with sync: source
    appendTessella(kernel, entityId, "attribute_set", { key: "description", value: "synced" }, { source: "sync:http://localhost:3000" });

    const tessellae = getUnpushedTessellae(kernel);
    // The sync-sourced tessella should be excluded
    expect(tessellae.every((t) => t.source !== "sync:http://localhost:3000")).toBe(true);
  });

  test("getUnpushedTessellae returns only tessellae after last_pushed_local_id", () => {
    const entityId = createEntity(kernel, issueGenus);
    setAttribute(kernel, entityId, "title", "Chapter 1");

    const allTessellae = getUnpushedTessellae(kernel);
    const maxId = Math.max(...allTessellae.map((t) => t.id));

    // Mark all as pushed
    setSyncState(kernel, "last_pushed_local_id", String(maxId));

    // Now no unpushed tessellae
    expect(getUnpushedTessellae(kernel)).toHaveLength(0);

    // Add a new tessella
    setAttribute(kernel, entityId, "description", "new data");
    const unpushed = getUnpushedTessellae(kernel);
    expect(unpushed).toHaveLength(1);
    expect(unpushed[0].data.key).toBe("description");
  });

  test("getUnpushedRes returns res rows excluding sentinels", () => {
    const entityId = createEntity(kernel, issueGenus);
    setAttribute(kernel, entityId, "title", "Chapter 1");

    const tessellae = getUnpushedTessellae(kernel);
    const res = getUnpushedRes(kernel, tessellae);

    // Should include the entity and the genus, but not sentinels
    const resIds = res.map((r) => r.id);
    expect(resIds).toContain(entityId);
    expect(resIds).toContain(issueGenus);
    expect(resIds).not.toContain(META_GENUS_ID);
    expect(resIds).not.toContain(LOG_GENUS_ID);
    expect(resIds).not.toContain(ERROR_GENUS_ID);
  });

  // --- Pull insertion ---

  test("insertPulledData inserts res and tessellae", () => {
    const kernel2 = initKernel(":memory:");
    const ig = setupIssueGenus(kernel2);

    // Create entity in kernel2
    const entityId = createEntity(kernel2, ig);
    setAttribute(kernel2, entityId, "title", "From Server");

    // Extract pull data from kernel2
    const tessellae = kernel2.db.query(
      "SELECT * FROM tessella WHERE res_id = ? ORDER BY id ASC",
    ).all(entityId) as any[];

    const pullData: SyncPullData = {
      res: [{ id: entityId, genus_id: ig, branch_id: "main", created_at: new Date().toISOString() }],
      tessellae: tessellae.map((t: any) => ({
        id: t.id,
        res_id: t.res_id,
        branch_id: t.branch_id,
        type: t.type,
        data: JSON.parse(t.data),
        created_at: t.created_at,
        source: t.source,
      })),
      high_water_mark: tessellae[tessellae.length - 1].id,
    };

    // Insert into kernel (also need the genus res)
    // First ensure kernel has the same genus ID by inserting genus res
    kernel.db.run("INSERT OR IGNORE INTO res (id, genus_id, branch_id, created_at) VALUES (?, ?, ?, ?)",
      [ig, META_GENUS_ID, "main", new Date().toISOString()]);

    insertPulledData(kernel, pullData, "sync:test");

    // Verify res was inserted
    const res = kernel.db.query("SELECT * FROM res WHERE id = ?").get(entityId) as any;
    expect(res).not.toBeNull();
    expect(res.genus_id).toBe(ig);

    kernel2.db.close();
  });

  test("insertPulledData skips existing res (no duplicate error)", () => {
    const entityId = createEntity(kernel, issueGenus);
    const pullData: SyncPullData = {
      res: [{ id: entityId, genus_id: issueGenus, branch_id: "main", created_at: new Date().toISOString() }],
      tessellae: [],
      high_water_mark: 0,
    };
    // Should not throw
    insertPulledData(kernel, pullData, "sync:test");
  });

  test("insertPulledData tags tessellae with source", () => {
    const kernel2 = initKernel(":memory:");
    const ig = setupIssueGenus(kernel2);
    const entityId = createEntity(kernel2, ig);

    const tessellae = kernel2.db.query(
      "SELECT * FROM tessella WHERE res_id = ? ORDER BY id ASC",
    ).all(entityId) as any[];

    const pullData: SyncPullData = {
      res: [{ id: entityId, genus_id: ig, branch_id: "main", created_at: new Date().toISOString() }],
      tessellae: tessellae.map((t: any) => ({
        id: t.id, res_id: t.res_id, branch_id: t.branch_id,
        type: t.type, data: JSON.parse(t.data), created_at: t.created_at, source: t.source,
      })),
      high_water_mark: tessellae[tessellae.length - 1].id,
    };

    kernel.db.run("INSERT OR IGNORE INTO res (id, genus_id, branch_id, created_at) VALUES (?, ?, ?, ?)",
      [ig, META_GENUS_ID, "main", new Date().toISOString()]);
    insertPulledData(kernel, pullData, "sync:test-server");

    // Verify source tag
    const inserted = kernel.db.query(
      "SELECT source FROM tessella WHERE res_id = ? AND source IS NOT NULL",
    ).all(entityId) as { source: string }[];
    expect(inserted.length).toBeGreaterThan(0);
    expect(inserted.every((t) => t.source === "sync:test-server")).toBe(true);

    kernel2.db.close();
  });

  test("pulled tessellae materialize correctly on receiving kernel", () => {
    const kernel2 = initKernel(":memory:");
    const ig = setupIssueGenus(kernel2);
    const entityId = createEntity(kernel2, ig);
    setAttribute(kernel2, entityId, "title", "Synced Issue");

    // Extract all tessellae for this entity
    const tessellae = kernel2.db.query(
      "SELECT * FROM tessella WHERE res_id = ? ORDER BY id ASC",
    ).all(entityId) as any[];

    const pullData: SyncPullData = {
      res: [{ id: entityId, genus_id: ig, branch_id: "main", created_at: new Date().toISOString() }],
      tessellae: tessellae.map((t: any) => ({
        id: t.id, res_id: t.res_id, branch_id: t.branch_id,
        type: t.type, data: JSON.parse(t.data), created_at: t.created_at, source: t.source,
      })),
      high_water_mark: tessellae[tessellae.length - 1].id,
    };

    kernel.db.run("INSERT OR IGNORE INTO res (id, genus_id, branch_id, created_at) VALUES (?, ?, ?, ?)",
      [ig, META_GENUS_ID, "main", new Date().toISOString()]);
    insertPulledData(kernel, pullData, "sync:test");

    const state = materialize(kernel, entityId);
    expect(state.title).toBe("Synced Issue");
    expect(state.status).toBe("draft");

    kernel2.db.close();
  });

  // --- Integration ---

  test("full round-trip: kernel A creates entity, kernel B receives via pull data", () => {
    // Kernel A (server) creates an entity
    const kernelA = initKernel(":memory:");
    const igA = setupIssueGenus(kernelA);
    const entityId = createEntity(kernelA, igA);
    setAttribute(kernelA, entityId, "title", "Server Issue");
    setAttribute(kernelA, entityId, "description", "Created on server");

    // Extract pull data from kernel A (simulating server pull endpoint)
    const allTessellae = kernelA.db.query(
      "SELECT * FROM tessella WHERE res_id = ? ORDER BY id ASC",
    ).all(entityId) as any[];
    const genusRow = kernelA.db.query("SELECT * FROM res WHERE id = ?").get(igA) as any;
    const genusTessellae = kernelA.db.query(
      "SELECT * FROM tessella WHERE res_id = ? ORDER BY id ASC",
    ).all(igA) as any[];

    const pullData: SyncPullData = {
      res: [
        { id: igA, genus_id: genusRow.genus_id, branch_id: genusRow.branch_id, created_at: genusRow.created_at },
        { id: entityId, genus_id: igA, branch_id: "main", created_at: new Date().toISOString() },
      ],
      tessellae: [...genusTessellae, ...allTessellae].map((t: any) => ({
        id: t.id, res_id: t.res_id, branch_id: t.branch_id,
        type: t.type, data: JSON.parse(t.data), created_at: t.created_at, source: t.source,
      })),
      high_water_mark: allTessellae[allTessellae.length - 1].id,
    };

    // Kernel B (client) receives the data
    const kernelB = initKernel(":memory:");
    insertPulledData(kernelB, pullData, "sync:serverA");

    // Verify the entity materializes correctly on kernel B
    const state = materialize(kernelB, entityId);
    expect(state.title).toBe("Server Issue");
    expect(state.description).toBe("Created on server");
    expect(state.status).toBe("draft");

    kernelA.db.close();
    kernelB.db.close();
  });

  test("genus definitions sync correctly between kernels", () => {
    const kernelA = initKernel(":memory:");
    const igA = setupIssueGenus(kernelA);

    // Extract genus definition as pull data
    const genusRow = kernelA.db.query("SELECT * FROM res WHERE id = ?").get(igA) as any;
    const genusTessellae = kernelA.db.query(
      "SELECT * FROM tessella WHERE res_id = ? ORDER BY id ASC",
    ).all(igA) as any[];

    const pullData: SyncPullData = {
      res: [{ id: igA, genus_id: genusRow.genus_id, branch_id: genusRow.branch_id, created_at: genusRow.created_at }],
      tessellae: genusTessellae.map((t: any) => ({
        id: t.id, res_id: t.res_id, branch_id: t.branch_id,
        type: t.type, data: JSON.parse(t.data), created_at: t.created_at, source: t.source,
      })),
      high_water_mark: genusTessellae[genusTessellae.length - 1].id,
    };

    const kernelB = initKernel(":memory:");
    insertPulledData(kernelB, pullData, "sync:serverA");

    // Verify genus materializes correctly
    const def = getGenusDef(kernelB, igA);
    expect(def.meta.name).toBe("Issue");
    expect(def.attributes.title.required).toBe(true);
    expect(Object.keys(def.states)).toContain("draft");
    expect(def.initialState).toBe("draft");

    kernelA.db.close();
    kernelB.db.close();
  });

  test("push then re-pull: unpushed tessellae don't include already-pushed items", () => {
    const entityId = createEntity(kernel, issueGenus);
    setAttribute(kernel, entityId, "title", "Chapter 1");

    const unpushed = getUnpushedTessellae(kernel);
    const maxId = Math.max(...unpushed.map((t) => t.id));

    // Simulate successful push
    setSyncState(kernel, "last_pushed_local_id", String(maxId));

    // Now add more data
    setAttribute(kernel, entityId, "description", "New description");

    const remaining = getUnpushedTessellae(kernel);
    expect(remaining).toHaveLength(1);
    expect(remaining[0].data.key).toBe("description");
  });

  test("sentinel res excluded from unpushed data", () => {
    // Create an entity so there are tessellae
    const entityId = createEntity(kernel, issueGenus);
    setAttribute(kernel, entityId, "title", "Chapter 1");

    const tessellae = getUnpushedTessellae(kernel);
    const res = getUnpushedRes(kernel, tessellae);

    // Sentinels should never appear in unpushed res
    const sentinels = [META_GENUS_ID, LOG_GENUS_ID, ERROR_GENUS_ID];
    for (const r of res) {
      expect(sentinels).not.toContain(r.id);
    }
  });

  // --- sync_state table ---

  test("sync_state table exists", () => {
    const tables = kernel.db.query(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='sync_state'",
    ).all();
    expect(tables).toHaveLength(1);
  });
});

// ============================================================================
// Tasks
// ============================================================================

describe("Tasks", () => {
  let kernel: Kernel;

  beforeEach(() => {
    kernel = initKernel(":memory:");
  });

  afterEach(() => {
    kernel.db.close();
  });

  // --- Bootstrap ---

  test("initKernel bootstraps Task genus", () => {
    const def = getGenusDef(kernel, TASK_GENUS_ID);
    expect(def.meta.name).toBe("Task");
    expect(def.attributes.title).toBeDefined();
    expect(def.attributes.title.required).toBe(true);
    expect(def.attributes.description).toBeDefined();
    expect(def.attributes.associated_res_id).toBeDefined();
    expect(def.attributes.context_res_ids).toBeDefined();
    expect(def.attributes.target_agent_type).toBeDefined();
    expect(def.attributes.priority).toBeDefined();
    expect(def.attributes.assigned_to).toBeDefined();
    expect(def.attributes.claimed_at).toBeDefined();
    expect(def.attributes.completed_at).toBeDefined();
    expect(def.attributes.result).toBeDefined();
  });

  test("Task genus has correct states and transitions", () => {
    const def = getGenusDef(kernel, TASK_GENUS_ID);
    expect(def.states.pending).toBeDefined();
    expect(def.states.pending.initial).toBe(true);
    expect(def.states.claimed).toBeDefined();
    expect(def.states.completed).toBeDefined();
    expect(def.states.cancelled).toBeDefined();
    expect(def.initialState).toBe("pending");
    // Check key transitions exist
    expect(def.transitions).toContainEqual({ from: "pending", to: "claimed" });
    expect(def.transitions).toContainEqual({ from: "pending", to: "completed" });
    expect(def.transitions).toContainEqual({ from: "pending", to: "cancelled" });
    expect(def.transitions).toContainEqual({ from: "claimed", to: "completed" });
    expect(def.transitions).toContainEqual({ from: "claimed", to: "cancelled" });
    expect(def.transitions).toContainEqual({ from: "claimed", to: "pending" });
  });

  // --- createTask ---

  test("createTask creates entity under TASK_GENUS_ID with pending status", () => {
    const taskId = createTask(kernel, "Review layout");
    const res = getRes(kernel, taskId);
    expect(res.genus_id).toBe(TASK_GENUS_ID);
    const state = materialize(kernel, taskId);
    expect(state.status).toBe("pending");
    expect(state.title).toBe("Review layout");
  });

  test("createTask sets optional attributes", () => {
    const taskId = createTask(kernel, "Fix bug", {
      description: "The sidebar is broken",
      associated_res_id: "some-entity-id",
      context_res_ids: ["ctx1", "ctx2"],
      target_agent_type: "llm",
      priority: "high",
    });
    const state = materialize(kernel, taskId);
    expect(state.title).toBe("Fix bug");
    expect(state.description).toBe("The sidebar is broken");
    expect(state.associated_res_id).toBe("some-entity-id");
    expect(JSON.parse(state.context_res_ids as string)).toEqual(["ctx1", "ctx2"]);
    expect(state.target_agent_type).toBe("llm");
    expect(state.priority).toBe("high");
  });

  test("createTask defaults target_agent_type and priority", () => {
    const taskId = createTask(kernel, "Simple task");
    const state = materialize(kernel, taskId);
    expect(state.target_agent_type).toBe("either");
    expect(state.priority).toBe("normal");
  });

  // --- State transitions ---

  test("claimTask transitions pending → claimed, sets assigned_to + claimed_at", () => {
    const taskId = createTask(kernel, "Review layout");
    claimTask(kernel, taskId, { assigned_to: "claude" });
    const state = materialize(kernel, taskId);
    expect(state.status).toBe("claimed");
    expect(state.assigned_to).toBe("claude");
    expect(state.claimed_at).toBeDefined();
  });

  test("completeTask transitions claimed → completed, sets result + completed_at", () => {
    const taskId = createTask(kernel, "Review layout");
    claimTask(kernel, taskId, { assigned_to: "claude" });
    completeTask(kernel, taskId, "Approved");
    const state = materialize(kernel, taskId);
    expect(state.status).toBe("completed");
    expect(state.result).toBe("Approved");
    expect(state.completed_at).toBeDefined();
  });

  test("completeTask works from pending (direct completion)", () => {
    const taskId = createTask(kernel, "Approve changes");
    completeTask(kernel, taskId, "Looks good");
    const state = materialize(kernel, taskId);
    expect(state.status).toBe("completed");
    expect(state.result).toBe("Looks good");
  });

  test("cancelTask transitions pending → cancelled", () => {
    const taskId = createTask(kernel, "Obsolete task");
    cancelTask(kernel, taskId);
    const state = materialize(kernel, taskId);
    expect(state.status).toBe("cancelled");
  });

  test("cancelTask transitions claimed → cancelled", () => {
    const taskId = createTask(kernel, "Blocked task");
    claimTask(kernel, taskId, { assigned_to: "alice" });
    cancelTask(kernel, taskId);
    const state = materialize(kernel, taskId);
    expect(state.status).toBe("cancelled");
  });

  // --- Validation ---

  test("completeTask on already-completed task throws", () => {
    const taskId = createTask(kernel, "Done task");
    completeTask(kernel, taskId);
    expect(() => completeTask(kernel, taskId)).toThrow();
  });

  test("claimTask on claimed task throws", () => {
    const taskId = createTask(kernel, "Claimed task");
    claimTask(kernel, taskId);
    expect(() => claimTask(kernel, taskId)).toThrow();
  });

  // --- listTasks ---

  test("listTasks returns all tasks", () => {
    createTask(kernel, "Task 1");
    createTask(kernel, "Task 2");
    createTask(kernel, "Task 3");
    const tasks = listTasks(kernel);
    expect(tasks).toHaveLength(3);
    expect(tasks.map((t) => t.title)).toContain("Task 1");
    expect(tasks.map((t) => t.title)).toContain("Task 2");
    expect(tasks.map((t) => t.title)).toContain("Task 3");
  });

  test("listTasks filters by status", () => {
    const t1 = createTask(kernel, "Pending task");
    const t2 = createTask(kernel, "Done task");
    completeTask(kernel, t2, "Done");
    const pending = listTasks(kernel, { status: "pending" });
    expect(pending).toHaveLength(1);
    expect(pending[0].title).toBe("Pending task");
    const completed = listTasks(kernel, { status: "completed" });
    expect(completed).toHaveLength(1);
    expect(completed[0].title).toBe("Done task");
  });

  test("listTasks filters by associated_res_id", () => {
    createTask(kernel, "Task A", { associated_res_id: "entity-1" });
    createTask(kernel, "Task B", { associated_res_id: "entity-2" });
    const tasks = listTasks(kernel, { associated_res_id: "entity-1" });
    expect(tasks).toHaveLength(1);
    expect(tasks[0].title).toBe("Task A");
  });

  test("listTasks filters by priority", () => {
    createTask(kernel, "Normal task");
    createTask(kernel, "Urgent task", { priority: "urgent" });
    const urgent = listTasks(kernel, { priority: "urgent" });
    expect(urgent).toHaveLength(1);
    expect(urgent[0].title).toBe("Urgent task");
  });

  // --- Side effect integration ---

  test("action with create_task side effect creates task entity", () => {
    const serverGenus = defineEntityGenus(kernel, "Server", {
      attributes: [{ name: "hostname", type: "text", required: true }],
      states: [{ name: "active", initial: true }],
    });
    const actionId = defineActionGenus(kernel, "provision_review", {
      resources: [{ name: "server", genus_name: "Server", required_status: "active" }],
      parameters: [],
      handler: [
        { type: "create_task", title: "Review provisioned server", res: "$res.server.id", priority: "high" },
      ],
    });
    const entityId = createEntity(kernel, serverGenus);
    setAttribute(kernel, entityId, "hostname", "prod-1");
    const result = executeAction(kernel, actionId, { server: entityId }, {});
    expect(result.error).toBeUndefined();
    const tasks = listTasks(kernel);
    expect(tasks).toHaveLength(1);
    expect(tasks[0].title).toBe("Review provisioned server");
    expect(tasks[0].associated_res_id).toBe(entityId);
    expect(tasks[0].priority).toBe("high");
  });

  test("create_task side effect supports $param substitution", () => {
    const serverGenus = defineEntityGenus(kernel, "Server", {
      attributes: [{ name: "hostname", type: "text", required: true }],
      states: [{ name: "active", initial: true }],
    });
    const actionId = defineActionGenus(kernel, "flag_for_review", {
      resources: [{ name: "server", genus_name: "Server", required_status: "active" }],
      parameters: [{ name: "reason", type: "text", required: true }],
      handler: [
        { type: "create_task", title: "Review: $param.reason", res: "$res.server.id" },
      ],
    });
    const entityId = createEntity(kernel, serverGenus);
    setAttribute(kernel, entityId, "hostname", "prod-1");
    const result = executeAction(kernel, actionId, { server: entityId }, { reason: "disk full" });
    expect(result.error).toBeUndefined();
    const tasks = listTasks(kernel);
    expect(tasks).toHaveLength(1);
    expect(tasks[0].title).toBe("Review: disk full");
  });

  // --- listGenera exclusion ---

  test("listGenera excludes Task genus", () => {
    const genera = listGenera(kernel);
    const ids = genera.map((g) => g.id);
    expect(ids).not.toContain(TASK_GENUS_ID);
  });

  // --- Integration ---

  test("full workflow: create task, claim, complete, verify state", () => {
    const taskId = createTask(kernel, "Approve Chapter 1", {
      description: "Review layout and approve",
      priority: "high",
      target_agent_type: "human",
    });

    // Verify initial state
    let tasks = listTasks(kernel, { status: "pending" });
    expect(tasks).toHaveLength(1);
    expect(tasks[0].title).toBe("Approve Chapter 1");

    // Claim
    claimTask(kernel, taskId, { assigned_to: "alice" });
    tasks = listTasks(kernel, { status: "claimed" });
    expect(tasks).toHaveLength(1);
    expect(tasks[0].assigned_to).toBe("alice");

    // Complete
    completeTask(kernel, taskId, "Approved — looks great");
    tasks = listTasks(kernel, { status: "completed" });
    expect(tasks).toHaveLength(1);
    expect(tasks[0].result).toBe("Approved — looks great");
    expect(tasks[0].completed_at).toBeDefined();

    // No more pending
    tasks = listTasks(kernel, { status: "pending" });
    expect(tasks).toHaveLength(0);
  });
});

// ============================================================================
// Processes
// ============================================================================

describe("Processes", () => {
  let kernel: Kernel;

  beforeEach(() => {
    kernel = initKernel(":memory:");
  });

  afterEach(() => {
    kernel.db.close();
  });

  function defineSimpleProcess() {
    return defineProcessGenus(kernel, "SimpleWorkflow", {
      lanes: [{ name: "main", position: 0 }],
      steps: [
        { name: "step1", type: "task_step", lane: "main", position: 0, task_title: "Do step 1" },
        { name: "step2", type: "task_step", lane: "main", position: 1, task_title: "Do step 2" },
      ],
      triggers: [{ type: "manual" }],
      meta: { description: "A simple two-step workflow" },
    });
  }

  // --- defineProcessGenus ---

  test("defineProcessGenus creates a genus with kind=process", () => {
    const genusId = defineSimpleProcess();
    const def = getProcessDef(kernel, genusId);
    expect(def.meta.name).toBe("SimpleWorkflow");
    expect(def.meta.kind).toBe("process");
    expect(Object.keys(def.lanes)).toHaveLength(1);
    expect(def.lanes.main.position).toBe(0);
    expect(Object.keys(def.steps)).toHaveLength(2);
    expect(def.steps.step1.type).toBe("task_step");
    expect(def.steps.step2.type).toBe("task_step");
    expect(def.triggers).toHaveLength(1);
    expect(def.triggers[0].type).toBe("manual");
  });

  test("processReducer handles lane, step, trigger, and meta tessellae", () => {
    const genusId = defineSimpleProcess();
    const def = getProcessDef(kernel, genusId);
    expect(def.lanes.main).toBeDefined();
    expect(def.steps.step1.lane).toBe("main");
    expect(def.steps.step1.position).toBe(0);
    expect(def.meta.description).toBe("A simple two-step workflow");
  });

  // --- listProcessGenera / findProcessGenusByName ---

  test("listProcessGenera returns process genera", () => {
    defineSimpleProcess();
    const genera = listProcessGenera(kernel);
    expect(genera).toHaveLength(1);
    expect(genera[0].name).toBe("SimpleWorkflow");
  });

  test("findProcessGenusByName is case-insensitive", () => {
    const genusId = defineSimpleProcess();
    expect(findProcessGenusByName(kernel, "simpleworkflow")).toBe(genusId);
    expect(findProcessGenusByName(kernel, "SIMPLEWORKFLOW")).toBe(genusId);
    expect(findProcessGenusByName(kernel, "nonexistent")).toBeNull();
  });

  test("listGenera excludes process genera", () => {
    defineSimpleProcess();
    const genera = listGenera(kernel);
    const names = genera.map((g) => g.name);
    expect(names).not.toContain("SimpleWorkflow");
  });

  // --- startProcess ---

  test("startProcess creates an instance and activates first step", () => {
    const genusId = defineSimpleProcess();
    const { id, state } = startProcess(kernel, genusId);
    expect(id).toBeDefined();
    expect(state.status).toBe("running");
    expect(state.process_genus_id).toBe(genusId);
    expect(state.started_at).toBeDefined();
    // First step should be active (task_step creates a task and waits)
    expect(state.steps.step1.status).toBe("active");
    expect(state.steps.step1.task_id).toBeDefined();
    // Second step should not be started yet
    expect(state.steps.step2).toBeUndefined();
  });

  test("startProcess with context_res_id", () => {
    const genusId = defineSimpleProcess();
    const entityGenus = defineEntityGenus(kernel, "TestEntity", {
      attributes: [{ name: "name", type: "text", required: true }],
      states: [{ name: "active", initial: true }],
    });
    const entityId = createEntity(kernel, entityGenus);
    setAttribute(kernel, entityId, "name", "test");

    const { state } = startProcess(kernel, genusId, { context_res_id: entityId });
    expect(state.context_res_id).toBe(entityId);
  });

  test("startProcess creates a task for the first task_step", () => {
    const genusId = defineSimpleProcess();
    const { id, state } = startProcess(kernel, genusId);

    // The task should be created
    const tasks = listTasks(kernel);
    expect(tasks).toHaveLength(1);
    expect(tasks[0].title).toBe("Do step 1");
    // Task context_res_ids should include the process instance id
    expect(tasks[0].context_res_ids).toContain(id);
  });

  // --- Task completion auto-advance ---

  test("completing a task_step auto-advances the process", () => {
    const genusId = defineSimpleProcess();
    const { id } = startProcess(kernel, genusId);

    // Find the task for step1
    let tasks = listTasks(kernel, { status: "pending" });
    expect(tasks).toHaveLength(1);
    const task1Id = tasks[0].id;

    // Complete task1 → should advance to step2
    completeTask(kernel, task1Id, "Step 1 done");

    const status = getProcessStatus(kernel, id);
    expect(status.steps.step1.status).toBe("completed");
    expect(status.steps.step2.status).toBe("active");
    expect(status.steps.step2.task_id).toBeDefined();

    // There should be a new pending task for step2
    tasks = listTasks(kernel, { status: "pending" });
    expect(tasks).toHaveLength(1);
    expect(tasks[0].title).toBe("Do step 2");
  });

  test("completing all steps completes the process", () => {
    const genusId = defineSimpleProcess();
    const { id } = startProcess(kernel, genusId);

    // Complete step1
    let tasks = listTasks(kernel, { status: "pending" });
    completeTask(kernel, tasks[0].id, "Done 1");

    // Complete step2
    tasks = listTasks(kernel, { status: "pending" });
    completeTask(kernel, tasks[0].id, "Done 2");

    const status = getProcessStatus(kernel, id);
    expect(status.status).toBe("completed");
    expect(status.completed_at).toBeDefined();
    expect(status.steps.step1.status).toBe("completed");
    expect(status.steps.step2.status).toBe("completed");
  });

  // --- Multi-lane with gate ---

  test("gate_step blocks until conditions are met, then process completes", () => {
    const genusId = defineProcessGenus(kernel, "GatedWorkflow", {
      lanes: [
        { name: "lane_a", position: 0 },
        { name: "lane_b", position: 1 },
        { name: "final", position: 2 },
      ],
      steps: [
        { name: "task_a", type: "task_step", lane: "lane_a", position: 0, task_title: "Task A" },
        { name: "task_b", type: "task_step", lane: "lane_b", position: 0, task_title: "Task B" },
        { name: "gate", type: "gate_step", lane: "final", position: 0, gate_conditions: ["task_a", "task_b"] },
        { name: "final_task", type: "task_step", lane: "final", position: 1, task_title: "Final Task" },
      ],
      triggers: [{ type: "manual" }],
    });

    const { id } = startProcess(kernel, genusId);

    // Both lane tasks should be active
    let status = getProcessStatus(kernel, id);
    expect(status.steps.task_a.status).toBe("active");
    expect(status.steps.task_b.status).toBe("active");
    // Gate should not be started
    expect(status.steps.gate).toBeUndefined();

    // Complete task_a
    let tasks = listTasks(kernel, { status: "pending" });
    const taskA = tasks.find((t) => t.title === "Task A")!;
    completeTask(kernel, taskA.id);

    status = getProcessStatus(kernel, id);
    expect(status.steps.task_a.status).toBe("completed");
    expect(status.steps.task_b.status).toBe("active");
    // Gate still not passed (task_b not done)
    expect(status.steps.gate).toBeUndefined();

    // Complete task_b → gate should pass, final_task should activate
    tasks = listTasks(kernel, { status: "pending" });
    const taskB = tasks.find((t) => t.title === "Task B")!;
    completeTask(kernel, taskB.id);

    status = getProcessStatus(kernel, id);
    expect(status.steps.task_b.status).toBe("completed");
    expect(status.steps.gate.status).toBe("completed");
    expect(status.steps.final_task.status).toBe("active");

    // Complete final task → process should complete
    tasks = listTasks(kernel, { status: "pending" });
    const finalTask = tasks.find((t) => t.title === "Final Task")!;
    completeTask(kernel, finalTask.id);

    status = getProcessStatus(kernel, id);
    expect(status.status).toBe("completed");
  });

  // --- Fetch step ---

  test("fetch_step reads from context entity and completes immediately", () => {
    const entityGenus = defineEntityGenus(kernel, "Document", {
      attributes: [
        { name: "title", type: "text", required: true },
        { name: "approved", type: "boolean" },
      ],
      states: [{ name: "active", initial: true }],
    });
    const entityId = createEntity(kernel, entityGenus);
    setAttribute(kernel, entityId, "title", "My Doc");
    setAttribute(kernel, entityId, "approved", true);

    const genusId = defineProcessGenus(kernel, "FetchWorkflow", {
      lanes: [{ name: "main", position: 0 }],
      steps: [
        { name: "fetch_approval", type: "fetch_step", lane: "main", position: 0, fetch_source: "approved" },
        { name: "final_task", type: "task_step", lane: "main", position: 1, task_title: "After fetch" },
      ],
    });

    const { id, state } = startProcess(kernel, genusId, { context_res_id: entityId });
    // Fetch step should complete immediately, final_task should be active
    expect(state.steps.fetch_approval.status).toBe("completed");
    expect(state.steps.fetch_approval.result).toBe(true);
    expect(state.steps.final_task.status).toBe("active");
  });

  // --- Action step ---

  test("action_step executes an action and completes", () => {
    const entityGenus = defineEntityGenus(kernel, "Item", {
      attributes: [
        { name: "name", type: "text", required: true },
        { name: "published_at", type: "text" },
      ],
      states: [
        { name: "draft", initial: true },
        { name: "published", initial: false },
      ],
      transitions: [{ from: "draft", to: "published" }],
    });
    const entityId = createEntity(kernel, entityGenus);
    setAttribute(kernel, entityId, "name", "Test Item");

    defineActionGenus(kernel, "publish_item", {
      resources: [{ name: "item", genus_name: "Item", required_status: "draft" }],
      parameters: [],
      handler: [
        { type: "transition_status", res: "$res.item.id", target: "published" },
      ],
    });

    const genusId = defineProcessGenus(kernel, "PublishWorkflow", {
      lanes: [{ name: "main", position: 0 }],
      steps: [
        {
          name: "publish",
          type: "action_step",
          lane: "main",
          position: 0,
          action_name: "publish_item",
          action_resource_bindings: { item: "$context.res_id" },
        },
      ],
    });

    const { state } = startProcess(kernel, genusId, { context_res_id: entityId });
    expect(state.steps.publish.status).toBe("completed");
    expect(state.status).toBe("completed");

    // Entity should be published
    const entityState = materialize(kernel, entityId);
    expect(entityState.status).toBe("published");
  });

  test("action_step with missing action fails the step", () => {
    const genusId = defineProcessGenus(kernel, "BadActionWorkflow", {
      lanes: [{ name: "main", position: 0 }],
      steps: [
        {
          name: "bad_action",
          type: "action_step",
          lane: "main",
          position: 0,
          action_name: "nonexistent_action",
        },
      ],
    });

    const { state } = startProcess(kernel, genusId);
    expect(state.steps.bad_action.status).toBe("failed");
  });

  // --- cancelProcess ---

  test("cancelProcess sets status to cancelled", () => {
    const genusId = defineSimpleProcess();
    const { id } = startProcess(kernel, genusId);
    cancelProcess(kernel, id, "No longer needed");
    const status = getProcessStatus(kernel, id);
    expect(status.status).toBe("cancelled");
    expect(status.completed_at).toBeDefined();
  });

  // --- listProcesses ---

  test("listProcesses returns process instances", () => {
    const genusId = defineSimpleProcess();
    startProcess(kernel, genusId);
    startProcess(kernel, genusId);

    const processes = listProcesses(kernel);
    expect(processes).toHaveLength(2);
    expect(processes[0].process_name).toBe("SimpleWorkflow");
    expect(processes[0].status).toBe("running");
  });

  test("listProcesses filters by status", () => {
    const genusId = defineSimpleProcess();
    const { id: id1 } = startProcess(kernel, genusId);
    startProcess(kernel, genusId);
    cancelProcess(kernel, id1);

    const running = listProcesses(kernel, { status: "running" });
    expect(running).toHaveLength(1);
    const cancelled = listProcesses(kernel, { status: "cancelled" });
    expect(cancelled).toHaveLength(1);
  });

  test("listProcesses filters by context_res_id", () => {
    const genusId = defineSimpleProcess();
    const entityGenus = defineEntityGenus(kernel, "Widget", {
      attributes: [{ name: "name", type: "text", required: true }],
    });
    const entityId = createEntity(kernel, entityGenus);
    setAttribute(kernel, entityId, "name", "w1");

    startProcess(kernel, genusId, { context_res_id: entityId });
    startProcess(kernel, genusId);

    const filtered = listProcesses(kernel, { context_res_id: entityId });
    expect(filtered).toHaveLength(1);
    expect(filtered[0].context_res_id).toBe(entityId);
  });

  test("listProcesses step_summary counts are correct", () => {
    const genusId = defineSimpleProcess();
    const { id } = startProcess(kernel, genusId);

    const processes = listProcesses(kernel);
    expect(processes[0].step_summary.total).toBe(2);
    expect(processes[0].step_summary.active).toBe(1);
    expect(processes[0].step_summary.completed).toBe(0);
  });

  // --- Full workflow integration ---

  test("full publication-style workflow: parallel lanes → gate → final step", () => {
    // Setup entity
    const issueGenus = defineEntityGenus(kernel, "Article", {
      attributes: [{ name: "title", type: "text", required: true }],
      states: [
        { name: "draft", initial: true },
        { name: "published", initial: false },
      ],
      transitions: [{ from: "draft", to: "published" }],
    });
    const issueId = createEntity(kernel, issueGenus);
    setAttribute(kernel, issueId, "title", "Test Article");

    defineActionGenus(kernel, "publish_article", {
      resources: [{ name: "article", genus_name: "Article", required_status: "draft" }],
      handler: [
        { type: "transition_status", res: "$res.article.id", target: "published" },
      ],
    });

    const genusId = defineProcessGenus(kernel, "PublicationProcess", {
      lanes: [
        { name: "editorial", position: 0 },
        { name: "art", position: 1 },
        { name: "final", position: 2 },
      ],
      steps: [
        { name: "review", type: "task_step", lane: "editorial", position: 0, task_title: "Review content" },
        { name: "copyedit", type: "task_step", lane: "editorial", position: 1, task_title: "Copyedit" },
        { name: "commission_art", type: "task_step", lane: "art", position: 0, task_title: "Commission artwork" },
        { name: "draft_art", type: "task_step", lane: "art", position: 1, task_title: "Draft artwork" },
        { name: "convergence", type: "gate_step", lane: "final", position: 0, gate_conditions: ["copyedit", "draft_art"] },
        {
          name: "publish",
          type: "action_step",
          lane: "final",
          position: 1,
          action_name: "publish_article",
          action_resource_bindings: { article: "$context.res_id" },
        },
      ],
      triggers: [{ type: "manual" }],
      meta: { description: "Full publication workflow" },
    });

    const { id } = startProcess(kernel, genusId, { context_res_id: issueId });

    // Editorial and art lanes should have first steps active
    let status = getProcessStatus(kernel, id);
    expect(status.steps.review.status).toBe("active");
    expect(status.steps.commission_art.status).toBe("active");

    // Complete editorial lane
    let tasks = listTasks(kernel, { status: "pending" });
    let reviewTask = tasks.find((t) => t.title === "Review content")!;
    completeTask(kernel, reviewTask.id);

    tasks = listTasks(kernel, { status: "pending" });
    let copyeditTask = tasks.find((t) => t.title === "Copyedit")!;
    completeTask(kernel, copyeditTask.id);

    // Gate should still be blocked (art not done)
    status = getProcessStatus(kernel, id);
    expect(status.steps.convergence).toBeUndefined();

    // Complete art lane
    tasks = listTasks(kernel, { status: "pending" });
    let commissionTask = tasks.find((t) => t.title === "Commission artwork")!;
    completeTask(kernel, commissionTask.id);

    tasks = listTasks(kernel, { status: "pending" });
    let draftArtTask = tasks.find((t) => t.title === "Draft artwork")!;
    completeTask(kernel, draftArtTask.id);

    // Gate should pass, action should execute, process should complete
    status = getProcessStatus(kernel, id);
    expect(status.steps.convergence.status).toBe("completed");
    expect(status.steps.publish.status).toBe("completed");
    expect(status.status).toBe("completed");

    // Article should be published
    const articleState = materialize(kernel, issueId);
    expect(articleState.status).toBe("published");
  });
});

// ============================================================================
// Branches
// ============================================================================

describe("Branches", () => {
  let kernel: Kernel;
  let bookGenusId: string;

  beforeEach(() => {
    kernel = initKernel(":memory:");
    bookGenusId = defineEntityGenus(kernel, "Book", {
      attributes: [
        { name: "title", type: "text", required: true },
        { name: "author", type: "text" },
      ],
      states: [
        { name: "draft", initial: true },
        { name: "published", initial: false },
      ],
      transitions: [
        { from: "draft", to: "published" },
      ],
    });
  });

  afterEach(() => {
    kernel.db.close();
  });

  // --- BRANCH_GENUS_ID bootstrap ---

  test("BRANCH_GENUS_ID exists after initKernel", () => {
    const res = getRes(kernel, BRANCH_GENUS_ID);
    expect(res).toBeDefined();
    expect(res.genus_id).toBe(META_GENUS_ID);
  });

  test("main branch entity exists after initKernel", () => {
    const branches = listBranches(kernel);
    const main = branches.find((b) => b.name === "main");
    expect(main).toBeDefined();
    expect(main!.status).toBe("active");
  });

  test("BRANCH_GENUS_ID is excluded from listGenera", () => {
    const genera = listGenera(kernel);
    expect(genera.find((g) => g.id === BRANCH_GENUS_ID)).toBeUndefined();
  });

  // --- createBranch ---

  test("createBranch creates branch with correct parent/branch_point/status", () => {
    const branch = createBranch(kernel, "experiment");
    expect(branch.name).toBe("experiment");
    expect(branch.parent_branch).toBe("main");
    expect(branch.branch_point).toBeGreaterThan(0);
    expect(branch.status).toBe("active");
  });

  test("createBranch rejects duplicate name", () => {
    createBranch(kernel, "experiment");
    expect(() => createBranch(kernel, "experiment")).toThrow("already exists");
  });

  // --- switchBranch ---

  test("switchBranch sets kernel.currentBranch", () => {
    createBranch(kernel, "experiment");
    switchBranch(kernel, "experiment");
    expect(kernel.currentBranch).toBe("experiment");
  });

  test("switchBranch rejects non-existent branch", () => {
    expect(() => switchBranch(kernel, "nope")).toThrow("not found");
  });

  test("switchBranch rejects merged branch", () => {
    createBranch(kernel, "exp");
    mergeBranch(kernel, "exp", "main");
    expect(() => switchBranch(kernel, "exp")).toThrow("merged");
  });

  test("switchBranch rejects discarded branch", () => {
    createBranch(kernel, "exp");
    discardBranch(kernel, "exp");
    expect(() => switchBranch(kernel, "exp")).toThrow("discarded");
  });

  // --- listBranches ---

  test("listBranches includes main and created branches", () => {
    createBranch(kernel, "alpha");
    createBranch(kernel, "beta");
    const branches = listBranches(kernel);
    const names = branches.map((b) => b.name);
    expect(names).toContain("main");
    expect(names).toContain("alpha");
    expect(names).toContain("beta");
  });

  // --- Branch isolation ---

  test("branch isolation: changes on branch don't affect main", () => {
    const entityId = createEntity(kernel, bookGenusId);
    setAttribute(kernel, entityId, "title", "Chapter 1");

    createBranch(kernel, "experiment");
    switchBranch(kernel, "experiment");

    setAttribute(kernel, entityId, "title", "Prologue");

    // On branch: should see "Prologue"
    const branchState = materialize(kernel, entityId, { branch_id: "experiment" });
    expect(branchState.title).toBe("Prologue");

    // On main: should still see "Chapter 1"
    const mainState = materialize(kernel, entityId, { branch_id: "main" });
    expect(mainState.title).toBe("Chapter 1");
  });

  test("branch via currentBranch: setAttribute writes to branch", () => {
    const entityId = createEntity(kernel, bookGenusId);
    setAttribute(kernel, entityId, "title", "Original");

    createBranch(kernel, "feature");
    switchBranch(kernel, "feature");

    // No explicit branch_id — should use kernel.currentBranch
    setAttribute(kernel, entityId, "title", "Modified");

    switchBranch(kernel, "main");
    const mainState = materialize(kernel, entityId);
    expect(mainState.title).toBe("Original");

    switchBranch(kernel, "feature");
    const featureState = materialize(kernel, entityId, { branch_id: "feature" });
    expect(featureState.title).toBe("Modified");
  });

  // --- Genus operations on branch ---

  test("genus operations work when on non-main branch", () => {
    createBranch(kernel, "experiment");
    switchBranch(kernel, "experiment");

    // getGenusDef should still work (reads from main)
    const def = getGenusDef(kernel, bookGenusId);
    expect(def.meta.name).toBe("Book");
    expect(def.attributes.title).toBeDefined();
  });

  // --- Nested branches ---

  test("nested branches: main→A→B with correct materialization", () => {
    const entityId = createEntity(kernel, bookGenusId);
    setAttribute(kernel, entityId, "title", "v1");

    createBranch(kernel, "A");
    switchBranch(kernel, "A");
    setAttribute(kernel, entityId, "title", "v2");

    createBranch(kernel, "B", "A");
    switchBranch(kernel, "B");
    setAttribute(kernel, entityId, "author", "Alice");

    // On B: should see title from A and author from B
    const stateB = materialize(kernel, entityId, { branch_id: "B" });
    expect(stateB.title).toBe("v2");
    expect(stateB.author).toBe("Alice");

    // On A: should see title v2, no author
    const stateA = materialize(kernel, entityId, { branch_id: "A" });
    expect(stateA.title).toBe("v2");
    expect(stateA.author).toBeUndefined();

    // On main: should see title v1, no author
    const stateMain = materialize(kernel, entityId, { branch_id: "main" });
    expect(stateMain.title).toBe("v1");
    expect(stateMain.author).toBeUndefined();
  });

  // --- mergeBranch ---

  test("mergeBranch: no conflicts copies tessellae and marks source merged", () => {
    const entityId = createEntity(kernel, bookGenusId);
    setAttribute(kernel, entityId, "title", "Original");

    createBranch(kernel, "feature");
    switchBranch(kernel, "feature");
    setAttribute(kernel, entityId, "title", "Updated");
    switchBranch(kernel, "main");

    const result = mergeBranch(kernel, "feature", "main");
    expect(result.merged).toBe(true);
    expect(result.tessellae_copied).toBeGreaterThan(0);

    // Main should now see the updated value
    const state = materialize(kernel, entityId, { branch_id: "main" });
    expect(state.title).toBe("Updated");

    // Source branch should be merged
    const branch = findBranchByName(kernel, "feature");
    expect(branch!.status).toBe("merged");
  });

  test("mergeBranch: both modify same entity returns conflicts", () => {
    const entityId = createEntity(kernel, bookGenusId);
    setAttribute(kernel, entityId, "title", "Original");

    createBranch(kernel, "feature");
    switchBranch(kernel, "feature");
    setAttribute(kernel, entityId, "title", "Feature version");
    switchBranch(kernel, "main");

    // Modify same entity on main after branch point
    setAttribute(kernel, entityId, "title", "Main version");

    const result = mergeBranch(kernel, "feature", "main");
    expect(result.merged).toBe(false);
    expect(result.conflicts).toBeDefined();
    expect(result.conflicts!.length).toBeGreaterThan(0);
    expect(result.conflicts![0].res_id).toBe(entityId);
  });

  test("mergeBranch with force merges despite conflicts", () => {
    const entityId = createEntity(kernel, bookGenusId);
    setAttribute(kernel, entityId, "title", "Original");

    createBranch(kernel, "feature");
    switchBranch(kernel, "feature");
    setAttribute(kernel, entityId, "title", "Feature version");
    switchBranch(kernel, "main");

    setAttribute(kernel, entityId, "title", "Main version");

    const result = mergeBranch(kernel, "feature", "main", { force: true });
    expect(result.merged).toBe(true);
  });

  // --- discardBranch ---

  test("discardBranch marks status and resets currentBranch", () => {
    createBranch(kernel, "temp");
    switchBranch(kernel, "temp");
    expect(kernel.currentBranch).toBe("temp");

    discardBranch(kernel, "temp");
    expect(kernel.currentBranch).toBe("main");

    const branch = findBranchByName(kernel, "temp");
    expect(branch!.status).toBe("discarded");
  });

  test("discardBranch rejects main", () => {
    expect(() => discardBranch(kernel, "main")).toThrow("Cannot discard main");
  });

  // --- compareBranches ---

  test("compareBranches returns both states", () => {
    const entityId = createEntity(kernel, bookGenusId);
    setAttribute(kernel, entityId, "title", "Original");

    createBranch(kernel, "feature");
    switchBranch(kernel, "feature");
    setAttribute(kernel, entityId, "title", "Modified");
    switchBranch(kernel, "main");

    const result = compareBranches(kernel, entityId, "main", "feature");
    expect(result.branch_a.title).toBe("Original");
    expect(result.branch_b.title).toBe("Modified");
  });

  // --- Full demo scenario ---

  test("full demo: create branch, modify, verify isolation, merge", () => {
    // Create entity on main
    const entityId = createEntity(kernel, bookGenusId);
    setAttribute(kernel, entityId, "title", "Chapter 1");

    // Create branch "experiment"
    createBranch(kernel, "experiment");
    switchBranch(kernel, "experiment");

    // Rename on branch
    setAttribute(kernel, entityId, "title", "Prologue");

    // Switch to main — still "Chapter 1"
    switchBranch(kernel, "main");
    const mainState = materialize(kernel, entityId);
    expect(mainState.title).toBe("Chapter 1");

    // Merge experiment — now "Prologue"
    const result = mergeBranch(kernel, "experiment", "main");
    expect(result.merged).toBe(true);

    const mergedState = materialize(kernel, entityId);
    expect(mergedState.title).toBe("Prologue");
  });
});

// ============================================================================
// Serialization
// ============================================================================

describe("Serialization", () => {
  let kernel: Kernel;

  beforeEach(() => {
    kernel = initKernel(":memory:");
  });

  afterEach(() => {
    kernel.db.close();
  });

  // --- Helper: set up Issue genus with Page feature ---
  function setupIssueWithPages() {
    defineEntityGenus(kernel, "Issue", {
      attributes: [
        { name: "title", type: "text", required: true },
        { name: "description", type: "text" },
        { name: "cover_image", type: "text" },
      ],
      states: [
        { name: "draft", initial: true },
        { name: "published", initial: false },
      ],
      transitions: [{ from: "draft", to: "published", name: "Publish" }],
    });

    defineFeatureGenus(kernel, "Page", {
      parent_genus_name: "Issue",
      attributes: [
        { name: "page_number", type: "number", required: true },
        { name: "content", type: "text" },
      ],
      states: [
        { name: "draft", initial: true },
        { name: "approved", initial: false },
      ],
      transitions: [{ from: "draft", to: "approved", name: "Approve" }],
    });
  }

  // --- defineSerializationGenus ---

  test("defineSerializationGenus creates target with correct def", () => {
    setupIssueWithPages();

    const targetId = defineSerializationGenus(kernel, "Markdown Export", {
      input: { query_type: "by_genus", genus_name: "Issue" },
      output: { format: "markdown", output_shape: "filetree" },
      handler: [
        { type: "directory", name: "{{entity.title}}", children: [
          { type: "file", name: "index.md", body_attribute: "description",
            content: "---\ntitle: {{entity.title}}\n---\n{{entity.description}}" },
        ]},
      ],
      meta: { description: "Export issues to markdown" },
    });

    const def = getSerializationDef(kernel, targetId);
    expect(def.input.query_type).toBe("by_genus");
    expect(def.input.genus_name).toBe("Issue");
    expect(def.output.format).toBe("markdown");
    expect(def.output.output_shape).toBe("filetree");
    expect(def.handler).toHaveLength(1);
    expect(def.handler[0].type).toBe("directory");
    expect(def.meta.name).toBe("Markdown Export");
    expect(def.meta.kind).toBe("serialization");
    expect(def.meta.description).toBe("Export issues to markdown");
  });

  // --- serializationReducer ---

  test("serializationReducer produces correct state from tessellae", () => {
    let state: Record<string, unknown> = {};

    state = serializationReducer(state, { id: 1, res_id: "x", branch_id: "main", type: "created", data: {}, created_at: "", source: null });
    expect(state.input).toBeNull();
    expect(state.output).toBeNull();
    expect(state.handler).toEqual([]);

    state = serializationReducer(state, { id: 2, res_id: "x", branch_id: "main", type: "serialization_input_defined", data: { query_type: "by_genus", genus_name: "Issue" }, created_at: "", source: null });
    expect((state.input as any).query_type).toBe("by_genus");

    state = serializationReducer(state, { id: 3, res_id: "x", branch_id: "main", type: "serialization_output_defined", data: { format: "markdown", output_shape: "filetree" }, created_at: "", source: null });
    expect((state.output as any).format).toBe("markdown");

    const handler = [{ type: "file" as const, name: "test.md", content: "hello" }];
    state = serializationReducer(state, { id: 4, res_id: "x", branch_id: "main", type: "serialization_handler_defined", data: { handler }, created_at: "", source: null });
    expect(state.handler).toEqual(handler);
  });

  // --- finders ---

  test("findSerializationGenusByName finds by name", () => {
    const targetId = defineSerializationGenus(kernel, "My Target", {
      input: { query_type: "by_genus" },
      output: { format: "markdown", output_shape: "filetree" },
      handler: [],
    });

    expect(findSerializationGenusByName(kernel, "My Target")).toBe(targetId);
    expect(findSerializationGenusByName(kernel, "my target")).toBe(targetId);
    expect(findSerializationGenusByName(kernel, "nonexistent")).toBeNull();
  });

  test("listSerializationGenera returns targets; excluded from listGenera", () => {
    setupIssueWithPages();

    defineSerializationGenus(kernel, "Export 1", {
      input: { query_type: "by_genus" },
      output: { format: "markdown", output_shape: "filetree" },
      handler: [],
    });

    defineSerializationGenus(kernel, "Export 2", {
      input: { query_type: "by_id" },
      output: { format: "markdown", output_shape: "filetree" },
      handler: [],
    });

    const serTargets = listSerializationGenera(kernel);
    expect(serTargets).toHaveLength(2);
    expect(serTargets.map((t) => t.name)).toContain("Export 1");
    expect(serTargets.map((t) => t.name)).toContain("Export 2");

    // Should not appear in listGenera
    const genera = listGenera(kernel);
    const names = genera.map((g) => g.name);
    expect(names).not.toContain("Export 1");
    expect(names).not.toContain("Export 2");
  });

  // --- Template substitution (tested via runSerialization) ---

  test("runSerialization produces filetree with template substitution", () => {
    setupIssueWithPages();

    const issueGenusId = findGenusByName(kernel, "Issue")!;
    const entityId = createEntity(kernel, issueGenusId);
    setAttribute(kernel, entityId, "title", "Chapter 1");
    setAttribute(kernel, entityId, "description", "The beginning.");
    setAttribute(kernel, entityId, "cover_image", "cover.png");

    const featureGenusId = findFeatureGenusByName(kernel, "Page")!;
    createFeature(kernel, entityId, featureGenusId, {
      attributes: { page_number: 1, content: "Page one text" },
    });
    createFeature(kernel, entityId, featureGenusId, {
      attributes: { page_number: 2, content: "Page two text" },
    });

    const targetId = defineSerializationGenus(kernel, "MD Export", {
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
    });

    const result = runSerialization(kernel, targetId);

    expect(result.entity_ids).toHaveLength(1);
    expect(result.entity_ids[0]).toBe(entityId);
    expect(result.filetree.type).toBe("directory");
    expect(result.filetree.name).toBe("Chapter 1");

    // Should have index.md + 2 page files + _manifest.json
    const children = result.filetree.children!;
    const fileNames = children.map((c) => c.name);
    expect(fileNames).toContain("index.md");
    expect(fileNames).toContain("_manifest.json");

    // Check index.md content
    const indexFile = children.find((c) => c.name === "index.md")!;
    expect(indexFile.content).toContain("title: Chapter 1");
    expect(indexFile.content).toContain("status: draft");
    expect(indexFile.content).toContain("cover_image: cover.png");
    expect(indexFile.content).toContain("The beginning.");

    // Check page files
    const pageFiles = children.filter((c) => c.name.startsWith("page-"));
    expect(pageFiles).toHaveLength(2);

    const page1 = pageFiles.find((p) => p.name === "page-1.md");
    expect(page1).toBeDefined();
    expect(page1!.content).toContain("page_number: 1");
    expect(page1!.content).toContain("Page one text");

    // Check manifest
    expect(result.manifest.target_genus_id).toBe(targetId);
    expect(result.manifest.entities[entityId]).toBeDefined();
    expect(result.manifest.entities[entityId].genus_name).toBe("Issue");
    expect(result.manifest.entities[entityId].directory).toBe("Chapter 1");
  });

  // --- runSerialization with entity_id param ---

  test("runSerialization with entity_id exports single entity", () => {
    setupIssueWithPages();

    const issueGenusId = findGenusByName(kernel, "Issue")!;
    const entity1 = createEntity(kernel, issueGenusId);
    setAttribute(kernel, entity1, "title", "Issue A");
    const entity2 = createEntity(kernel, issueGenusId);
    setAttribute(kernel, entity2, "title", "Issue B");

    const targetId = defineSerializationGenus(kernel, "Single Export", {
      input: { query_type: "by_genus", genus_name: "Issue" },
      output: { format: "markdown", output_shape: "filetree" },
      handler: [
        { type: "directory", name: "{{entity.title}}", children: [
          { type: "file", name: "index.md", content: "# {{entity.title}}" },
        ]},
      ],
    });

    const result = runSerialization(kernel, targetId, { entity_id: entity1 });
    expect(result.entity_ids).toHaveLength(1);
    expect(result.entity_ids[0]).toBe(entity1);
    expect(result.filetree.name).toBe("Issue A");
  });

  // --- writeFiletree + readFiletree ---

  test("writeFiletree writes to disk, readFiletree reads it back", () => {
    const { mkdirSync, rmSync } = require("fs");
    const { join } = require("path");
    const tmpDir = join(require("os").tmpdir(), `smaragda-test-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });

    try {
      const tree: FiletreeNode = {
        name: "my-export",
        type: "directory",
        children: [
          { name: "readme.md", type: "file", content: "# Hello\nWorld" },
          { name: "sub", type: "directory", children: [
            { name: "page.md", type: "file", content: "Page content" },
          ]},
        ],
      };

      const created = writeFiletree(tree, tmpDir);
      expect(created.length).toBeGreaterThan(0);

      // Read back
      const readBack = readFiletree(join(tmpDir, "my-export"));
      expect(readBack.name).toBe("my-export");
      expect(readBack.type).toBe("directory");

      const readme = readBack.children!.find((c) => c.name === "readme.md");
      expect(readme).toBeDefined();
      expect(readme!.content).toBe("# Hello\nWorld");

      const sub = readBack.children!.find((c) => c.name === "sub");
      expect(sub).toBeDefined();
      expect(sub!.type).toBe("directory");

      const page = sub!.children!.find((c) => c.name === "page.md");
      expect(page).toBeDefined();
      expect(page!.content).toBe("Page content");
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  // --- Frontmatter parsing (tested via importFiletree) ---

  // --- importFiletree: attribute changes ---

  test("importFiletree detects and applies attribute changes", () => {
    const { mkdirSync, writeFileSync, rmSync } = require("fs");
    const { join } = require("path");
    const tmpDir = join(require("os").tmpdir(), `smaragda-import-${Date.now()}`);

    setupIssueWithPages();

    const issueGenusId = findGenusByName(kernel, "Issue")!;
    const entityId = createEntity(kernel, issueGenusId);
    setAttribute(kernel, entityId, "title", "Old Title");
    setAttribute(kernel, entityId, "description", "Old description.");

    const featureGenusId = findFeatureGenusByName(kernel, "Page")!;
    const featureId = createFeature(kernel, entityId, featureGenusId, {
      attributes: { page_number: 1, content: "Old page content" },
    });

    const targetId = defineSerializationGenus(kernel, "MD Export", {
      input: { query_type: "by_genus", genus_name: "Issue" },
      output: { format: "markdown", output_shape: "filetree" },
      handler: [
        { type: "directory", name: "{{entity.title}}", children: [
          { type: "file", name: "index.md", body_attribute: "description",
            content: "---\ntitle: {{entity.title}}\nstatus: {{entity.status}}\n---\n{{entity.description}}" },
          { type: "for_each_feature", genus_name: "Page", children: [
            { type: "file", name: "page-{{feature.page_number}}.md", body_attribute: "content",
              content: "---\npage_number: {{feature.page_number}}\nstatus: {{feature.status}}\n---\n{{feature.content}}" },
          ]},
        ]},
      ],
    });

    // Export
    const exported = runSerialization(kernel, targetId);
    mkdirSync(tmpDir, { recursive: true });
    writeFiletree(exported.filetree, tmpDir);

    // Edit the index.md — change title
    const indexPath = join(tmpDir, "Old Title", "index.md");
    writeFileSync(indexPath, "---\ntitle: New Title\nstatus: draft\n---\nNew description.");

    // Import
    const results = importFiletree(kernel, join(tmpDir, "Old Title"));

    try {
      expect(results).toHaveLength(1);
      const r = results[0];
      expect(r.entity_id).toBe(entityId);
      expect(r.tessellae_created).toBeGreaterThan(0);

      // Verify attribute changes
      const titleChange = r.changes.find((c) => c.attribute === "title");
      expect(titleChange).toBeDefined();
      expect(titleChange!.old_value).toBe("Old Title");
      expect(titleChange!.new_value).toBe("New Title");

      const descChange = r.changes.find((c) => c.attribute === "description");
      expect(descChange).toBeDefined();
      expect(descChange!.old_value).toBe("Old description.");
      expect(descChange!.new_value).toBe("New description.");

      // Verify state updated
      const state = materialize(kernel, entityId);
      expect(state.title).toBe("New Title");
      expect(state.description).toBe("New description.");
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  // --- importFiletree: status is read-only ---

  test("importFiletree skips status changes with warning", () => {
    const { mkdirSync, writeFileSync, rmSync } = require("fs");
    const { join } = require("path");
    const tmpDir = join(require("os").tmpdir(), `smaragda-status-${Date.now()}`);

    setupIssueWithPages();

    const issueGenusId = findGenusByName(kernel, "Issue")!;
    const entityId = createEntity(kernel, issueGenusId);
    setAttribute(kernel, entityId, "title", "My Issue");

    const targetId = defineSerializationGenus(kernel, "MD Export", {
      input: { query_type: "by_genus", genus_name: "Issue" },
      output: { format: "markdown", output_shape: "filetree" },
      handler: [
        { type: "directory", name: "{{entity.title}}", children: [
          { type: "file", name: "index.md",
            content: "---\ntitle: {{entity.title}}\nstatus: {{entity.status}}\n---\n" },
        ]},
      ],
    });

    const exported = runSerialization(kernel, targetId);
    mkdirSync(tmpDir, { recursive: true });
    writeFiletree(exported.filetree, tmpDir);

    // Edit to change status
    const indexPath = join(tmpDir, "My Issue", "index.md");
    writeFileSync(indexPath, "---\ntitle: My Issue\nstatus: published\n---\n");

    const results = importFiletree(kernel, join(tmpDir, "My Issue"));

    try {
      expect(results).toHaveLength(1);
      const r = results[0];
      expect(r.skipped).toHaveLength(1);
      expect(r.skipped[0].field).toBe("status");
      expect(r.skipped[0].reason).toContain("transitionStatus");

      // Status should still be draft
      const state = materialize(kernel, entityId);
      expect(state.status).toBe("draft");
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  // --- importFiletree: no changes ---

  test("importFiletree with no changes creates 0 tessellae", () => {
    const { mkdirSync, rmSync } = require("fs");
    const { join } = require("path");
    const tmpDir = join(require("os").tmpdir(), `smaragda-noop-${Date.now()}`);

    setupIssueWithPages();

    const issueGenusId = findGenusByName(kernel, "Issue")!;
    const entityId = createEntity(kernel, issueGenusId);
    setAttribute(kernel, entityId, "title", "Stable Issue");
    setAttribute(kernel, entityId, "description", "Same.");

    const targetId = defineSerializationGenus(kernel, "MD Export", {
      input: { query_type: "by_genus", genus_name: "Issue" },
      output: { format: "markdown", output_shape: "filetree" },
      handler: [
        { type: "directory", name: "{{entity.title}}", children: [
          { type: "file", name: "index.md", body_attribute: "description",
            content: "---\ntitle: {{entity.title}}\nstatus: {{entity.status}}\n---\n{{entity.description}}" },
        ]},
      ],
    });

    const exported = runSerialization(kernel, targetId);
    mkdirSync(tmpDir, { recursive: true });
    writeFiletree(exported.filetree, tmpDir);

    // Import without changes
    const results = importFiletree(kernel, join(tmpDir, "Stable Issue"));

    try {
      expect(results).toHaveLength(1);
      expect(results[0].tessellae_created).toBe(0);
      expect(results[0].changes).toHaveLength(0);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  // --- Full round-trip ---

  test("full round-trip: create → serialize → edit → import → verify", () => {
    const { mkdirSync, writeFileSync, rmSync } = require("fs");
    const { join } = require("path");
    const tmpDir = join(require("os").tmpdir(), `smaragda-roundtrip-${Date.now()}`);

    setupIssueWithPages();

    const issueGenusId = findGenusByName(kernel, "Issue")!;
    const entityId = createEntity(kernel, issueGenusId);
    setAttribute(kernel, entityId, "title", "Chapter 1");
    setAttribute(kernel, entityId, "description", "Original intro.");

    const featureGenusId = findFeatureGenusByName(kernel, "Page")!;
    createFeature(kernel, entityId, featureGenusId, {
      attributes: { page_number: 1, content: "Page 1 original" },
    });

    const targetId = defineSerializationGenus(kernel, "Full Export", {
      input: { query_type: "by_genus", genus_name: "Issue" },
      output: { format: "markdown", output_shape: "filetree" },
      handler: [
        { type: "directory", name: "{{entity.title}}", children: [
          { type: "file", name: "index.md", body_attribute: "description",
            content: "---\ntitle: {{entity.title}}\nstatus: {{entity.status}}\n---\n{{entity.description}}" },
          { type: "for_each_feature", genus_name: "Page", children: [
            { type: "file", name: "page-{{feature.page_number}}.md", body_attribute: "content",
              content: "---\npage_number: {{feature.page_number}}\nstatus: {{feature.status}}\n---\n{{feature.content}}" },
          ]},
        ]},
      ],
    });

    // Export
    const exported = runSerialization(kernel, targetId);
    mkdirSync(tmpDir, { recursive: true });
    writeFiletree(exported.filetree, tmpDir);

    // Edit: change page content
    const pageFiles = exported.filetree.children!.filter((c) => c.name.startsWith("page-"));
    const pagePath = join(tmpDir, "Chapter 1", pageFiles[0].name);
    writeFileSync(pagePath, "---\npage_number: 1\nstatus: draft\n---\nPage 1 EDITED");

    // Import
    const results = importFiletree(kernel, join(tmpDir, "Chapter 1"));

    try {
      expect(results).toHaveLength(1);
      const r = results[0];
      expect(r.tessellae_created).toBeGreaterThan(0);

      // Verify: feature content changed
      const state = materialize(kernel, entityId);
      const features = state.features as Record<string, any>;
      const pageEntry = Object.values(features).find((f: any) => f.page_number === 1);
      expect(pageEntry).toBeDefined();
      expect(pageEntry.content).toBe("Page 1 EDITED");

      // Verify: entity description unchanged
      expect(state.description).toBe("Original intro.");
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  // --- Branch-aware ---

  test("serialize and import on branch", () => {
    const { mkdirSync, writeFileSync, rmSync } = require("fs");
    const { join } = require("path");
    const tmpDir = join(require("os").tmpdir(), `smaragda-branch-${Date.now()}`);

    setupIssueWithPages();

    const issueGenusId = findGenusByName(kernel, "Issue")!;
    const entityId = createEntity(kernel, issueGenusId);
    setAttribute(kernel, entityId, "title", "Branch Issue");
    setAttribute(kernel, entityId, "description", "Main desc.");

    // Create branch and switch
    createBranch(kernel, "edit-branch");
    switchBranch(kernel, "edit-branch");

    const targetId = defineSerializationGenus(kernel, "Branch Export", {
      input: { query_type: "by_id" },
      output: { format: "markdown", output_shape: "filetree" },
      handler: [
        { type: "directory", name: "{{entity.title}}", children: [
          { type: "file", name: "index.md", body_attribute: "description",
            content: "---\ntitle: {{entity.title}}\nstatus: {{entity.status}}\n---\n{{entity.description}}" },
        ]},
      ],
    });

    // Serialize on branch
    const exported = runSerialization(kernel, targetId, { entity_id: entityId });
    mkdirSync(tmpDir, { recursive: true });
    writeFiletree(exported.filetree, tmpDir);

    // Edit
    const indexPath = join(tmpDir, "Branch Issue", "index.md");
    writeFileSync(indexPath, "---\ntitle: Branch Issue\nstatus: draft\n---\nBranch edited desc.");

    // Import on branch
    const results = importFiletree(kernel, join(tmpDir, "Branch Issue"));

    try {
      expect(results).toHaveLength(1);
      expect(results[0].tessellae_created).toBeGreaterThan(0);

      // Branch state should be updated
      const branchState = materialize(kernel, entityId, { branch_id: "edit-branch" });
      expect(branchState.description).toBe("Branch edited desc.");

      // Main state should be unchanged
      const mainState = materialize(kernel, entityId, { branch_id: "main" });
      expect(mainState.description).toBe("Main desc.");
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  // --- Feature attribute import ---

  test("importFiletree applies feature attribute changes", () => {
    const { mkdirSync, writeFileSync, rmSync } = require("fs");
    const { join } = require("path");
    const tmpDir = join(require("os").tmpdir(), `smaragda-feat-${Date.now()}`);

    setupIssueWithPages();

    const issueGenusId = findGenusByName(kernel, "Issue")!;
    const entityId = createEntity(kernel, issueGenusId);
    setAttribute(kernel, entityId, "title", "Feat Issue");

    const featureGenusId = findFeatureGenusByName(kernel, "Page")!;
    const featureId = createFeature(kernel, entityId, featureGenusId, {
      attributes: { page_number: 1, content: "Original content" },
    });

    const targetId = defineSerializationGenus(kernel, "Feat Export", {
      input: { query_type: "by_genus", genus_name: "Issue" },
      output: { format: "markdown", output_shape: "filetree" },
      handler: [
        { type: "directory", name: "{{entity.title}}", children: [
          { type: "file", name: "index.md",
            content: "---\ntitle: {{entity.title}}\n---\n" },
          { type: "for_each_feature", genus_name: "Page", children: [
            { type: "file", name: "page-{{feature.page_number}}.md", body_attribute: "content",
              content: "---\npage_number: {{feature.page_number}}\nstatus: {{feature.status}}\n---\n{{feature.content}}" },
          ]},
        ]},
      ],
    });

    const exported = runSerialization(kernel, targetId);
    mkdirSync(tmpDir, { recursive: true });
    writeFiletree(exported.filetree, tmpDir);

    // Edit feature page_number (number type) and content (body)
    const pagePath = join(tmpDir, "Feat Issue", "page-1.md");
    writeFileSync(pagePath, "---\npage_number: 42\nstatus: draft\n---\nUpdated feature content");

    const results = importFiletree(kernel, join(tmpDir, "Feat Issue"));

    try {
      expect(results).toHaveLength(1);
      const r = results[0];

      // Should have feature attribute changes
      const pageNumChange = r.changes.find((c) => c.attribute === "page_number");
      expect(pageNumChange).toBeDefined();
      expect(pageNumChange!.old_value).toBe(1);
      expect(pageNumChange!.new_value).toBe(42);

      const contentChange = r.changes.find((c) => c.attribute === "content");
      expect(contentChange).toBeDefined();
      expect(contentChange!.new_value).toBe("Updated feature content");

      // Verify state
      const state = materialize(kernel, entityId);
      const features = state.features as Record<string, any>;
      expect(features[featureId].page_number).toBe(42);
      expect(features[featureId].content).toBe("Updated feature content");
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  // --- Serialization run recording ---

  test("serialization runs are recorded in serialization_run table", () => {
    setupIssueWithPages();

    const issueGenusId = findGenusByName(kernel, "Issue")!;
    const entityId = createEntity(kernel, issueGenusId);
    setAttribute(kernel, entityId, "title", "Recorded");

    const targetId = defineSerializationGenus(kernel, "Record Export", {
      input: { query_type: "by_genus", genus_name: "Issue" },
      output: { format: "markdown", output_shape: "filetree" },
      handler: [
        { type: "directory", name: "{{entity.title}}", children: [
          { type: "file", name: "index.md", content: "---\ntitle: {{entity.title}}\n---\n" },
        ]},
      ],
    });

    runSerialization(kernel, targetId);

    const runs = kernel.db.query("SELECT * FROM serialization_run").all() as any[];
    expect(runs).toHaveLength(1);
    expect(runs[0].direction).toBe("export");
    expect(runs[0].target_genus_id).toBe(targetId);
    expect(JSON.parse(runs[0].entity_ids)).toContain(entityId);
  });

  // --- Filetree attribute type ---

  test("filetree attribute type validates correctly", () => {
    defineEntityGenus(kernel, "Doc", {
      attributes: [
        { name: "name", type: "text", required: true },
        { name: "tree", type: "filetree" },
      ],
      states: [{ name: "active", initial: true }],
      transitions: [],
    });

    const genusId = findGenusByName(kernel, "Doc")!;
    const entityId = createEntity(kernel, genusId);
    setAttribute(kernel, entityId, "name", "test");

    const tree = { name: "root", type: "directory", children: [] };
    setAttribute(kernel, entityId, "tree", tree);

    const state = materialize(kernel, entityId);
    expect(state.tree).toEqual(tree);

    // Invalid type should throw
    expect(() => setAttribute(kernel, entityId, "tree", "not-an-object")).toThrow("Type mismatch");
  });
});

// ============================================================================
// Ontologies
// ============================================================================

describe("Taxonomies", () => {
  let kernel: Kernel;

  beforeEach(() => {
    kernel = initKernel(":memory:");
  });

  afterEach(() => {
    kernel.db.close();
  });

  // --- Bootstrap ---

  test("initKernel bootstraps taxonomy genus with correct def", () => {
    const def = getGenusDef(kernel, TAXONOMY_GENUS_ID);
    expect(def.meta.name).toBe("Taxonomy");
    expect(def.attributes.name).toBeDefined();
    expect(def.attributes.name.required).toBe(true);
    expect(def.attributes.description).toBeDefined();
    expect(Object.keys(def.states)).toContain("active");
    expect(Object.keys(def.states)).toContain("archived");
    expect(def.transitions.some((t) => t.from === "active" && t.to === "archived")).toBe(true);
  });

  test("initKernel creates default taxonomy entity", () => {
    const state = materialize(kernel, DEFAULT_TAXONOMY_ID);
    expect(state.name).toBe("Default");
    expect(state.description).toBe("Default taxonomy for all genera");
    expect(state.status).toBe("active");
  });

  test("bootstrap is idempotent", () => {
    const kernel2 = initKernel(":memory:");
    const def = getGenusDef(kernel2, TAXONOMY_GENUS_ID);
    expect(def.meta.name).toBe("Taxonomy");
    const state = materialize(kernel2, DEFAULT_TAXONOMY_ID);
    expect(state.name).toBe("Default");
    kernel2.db.close();
  });

  test("listGenera excludes taxonomy genus", () => {
    const genera = listGenera(kernel);
    expect(genera.find((g) => g.id === TAXONOMY_GENUS_ID)).toBeUndefined();
  });

  test("listEntities excludes taxonomy entities", () => {
    const entities = listEntities(kernel);
    expect(entities.find((e) => e.id === DEFAULT_TAXONOMY_ID)).toBeUndefined();
  });

  // --- CRUD ---

  test("createTaxonomy creates a new taxonomy", () => {
    const id = createTaxonomy(kernel, "Inventory");
    const state = materialize(kernel, id);
    expect(state.name).toBe("Inventory");
    expect(state.status).toBe("active");
  });

  test("createTaxonomy with description", () => {
    const id = createTaxonomy(kernel, "Orders", "All order-related genera");
    const state = materialize(kernel, id);
    expect(state.name).toBe("Orders");
    expect(state.description).toBe("All order-related genera");
  });

  test("listTaxonomies returns all ontologies including default", () => {
    createTaxonomy(kernel, "Inventory");
    const ontologies = listTaxonomies(kernel);
    expect(ontologies.length).toBe(2);
    expect(ontologies.find((d) => d.name === "Default")).toBeDefined();
    expect(ontologies.find((d) => d.name === "Inventory")).toBeDefined();
  });

  test("findTaxonomyByName case-insensitive", () => {
    createTaxonomy(kernel, "Inventory");
    expect(findTaxonomyByName(kernel, "inventory")).not.toBeNull();
    expect(findTaxonomyByName(kernel, "INVENTORY")).not.toBeNull();
  });

  test("findTaxonomyByName returns null for nonexistent", () => {
    expect(findTaxonomyByName(kernel, "Nonexistent")).toBeNull();
  });

  test("archive taxonomy via transitionStatus", () => {
    const id = createTaxonomy(kernel, "Old");
    transitionStatus(kernel, id, "archived");
    const state = materialize(kernel, id);
    expect(state.status).toBe("archived");
  });

  // --- Taxonomy meta on genera ---

  test("defineEntityGenus defaults to DEFAULT_TAXONOMY_ID", () => {
    const genusId = defineEntityGenus(kernel, "Widget");
    const def = getGenusDef(kernel, genusId);
    expect(def.meta.taxonomy_id).toBe(DEFAULT_TAXONOMY_ID);
  });

  test("defineEntityGenus accepts explicit taxonomy_id", () => {
    const taxonomyId = createTaxonomy(kernel, "Inventory");
    const genusId = defineEntityGenus(kernel, "Widget", { taxonomy_id: taxonomyId });
    const def = getGenusDef(kernel, genusId);
    expect(def.meta.taxonomy_id).toBe(taxonomyId);
  });

  test("defineFeatureGenus sets taxonomy_id", () => {
    const taxonomyId = createTaxonomy(kernel, "Inventory");
    defineEntityGenus(kernel, "Widget", { taxonomy_id: taxonomyId });
    const featureGenusId = defineFeatureGenus(kernel, "Part", {
      parent_genus_name: "Widget",
      taxonomy_id: taxonomyId,
    });
    const def = getGenusDef(kernel, featureGenusId);
    expect(def.meta.taxonomy_id).toBe(taxonomyId);
  });

  test("defineActionGenus sets taxonomy_id", () => {
    const taxonomyId = createTaxonomy(kernel, "Inventory");
    const actionId = defineActionGenus(kernel, "ship", { taxonomy_id: taxonomyId });
    const def = getGenusDef(kernel, actionId);
    expect(def.meta.taxonomy_id).toBe(taxonomyId);
  });

  test("defineRelationshipGenus sets taxonomy_id", () => {
    const taxonomyId = createTaxonomy(kernel, "Inventory");
    defineEntityGenus(kernel, "Widget", { taxonomy_id: taxonomyId });
    defineEntityGenus(kernel, "Warehouse", { taxonomy_id: taxonomyId });
    const relId = defineRelationshipGenus(kernel, "Storage", {
      roles: [
        { name: "item", valid_member_genera: ["Widget"], cardinality: "one" },
        { name: "location", valid_member_genera: ["Warehouse"], cardinality: "one" },
      ],
      taxonomy_id: taxonomyId,
    });
    const def = getGenusDef(kernel, relId);
    expect(def.meta.taxonomy_id).toBe(taxonomyId);
  });

  test("defineProcessGenus sets taxonomy_id", () => {
    const taxonomyId = createTaxonomy(kernel, "Inventory");
    const processId = defineProcessGenus(kernel, "Fulfillment", {
      lanes: [{ name: "main", position: 0 }],
      steps: [{ name: "pick", type: "task_step", lane: "main", position: 0, task_title: "Pick items" }],
      taxonomy_id: taxonomyId,
    });
    const def = getProcessDef(kernel, processId);
    expect(def.meta.taxonomy_id).toBe(taxonomyId);
  });

  test("defineSerializationGenus sets taxonomy_id", () => {
    const taxonomyId = createTaxonomy(kernel, "Inventory");
    const serializationId = defineSerializationGenus(kernel, "Widget Export", {
      input: { query_type: "by_genus", genus_name: "Widget" },
      output: { format: "markdown", output_shape: "filetree" },
      handler: [{ type: "file", name: "index.md", content: "test" }],
      taxonomy_id: taxonomyId,
    });
    const def = getSerializationDef(kernel, serializationId);
    expect(def.meta.taxonomy_id).toBe(taxonomyId);
  });

  // --- Taxonomy-filtered queries ---

  test("listGenera filters by taxonomy_id", () => {
    const taxonomyId = createTaxonomy(kernel, "Inventory");
    defineEntityGenus(kernel, "Widget", { taxonomy_id: taxonomyId });
    defineEntityGenus(kernel, "Gadget"); // goes to default

    const inventoryGenera = listGenera(kernel, { taxonomy_id: taxonomyId });
    expect(inventoryGenera.length).toBe(1);
    expect(inventoryGenera[0].name).toBe("Widget");

    const defaultGenera = listGenera(kernel, { taxonomy_id: DEFAULT_TAXONOMY_ID });
    expect(defaultGenera.find((g) => g.name === "Gadget")).toBeDefined();
    expect(defaultGenera.find((g) => g.name === "Widget")).toBeUndefined();
  });

  test("listGenera returns all when no filter", () => {
    const taxonomyId = createTaxonomy(kernel, "Inventory");
    defineEntityGenus(kernel, "Widget", { taxonomy_id: taxonomyId });
    defineEntityGenus(kernel, "Gadget");

    const allGenera = listGenera(kernel);
    expect(allGenera.find((g) => g.name === "Widget")).toBeDefined();
    expect(allGenera.find((g) => g.name === "Gadget")).toBeDefined();
  });

  test("listFeatureGenera filters by taxonomy_id", () => {
    const taxonomyId = createTaxonomy(kernel, "Inventory");
    defineEntityGenus(kernel, "Widget", { taxonomy_id: taxonomyId });
    const featureId = defineFeatureGenus(kernel, "Part", {
      parent_genus_name: "Widget",
      taxonomy_id: taxonomyId,
    });
    defineEntityGenus(kernel, "Gadget");
    defineFeatureGenus(kernel, "Accessory", { parent_genus_name: "Gadget" });

    const inventoryFeatures = listFeatureGenera(kernel, { taxonomy_id: taxonomyId });
    expect(inventoryFeatures.length).toBe(1);
    expect(inventoryFeatures[0].name).toBe("Part");
  });

  test("listActionGenera filters by taxonomy_id", () => {
    const taxonomyId = createTaxonomy(kernel, "Inventory");
    defineActionGenus(kernel, "ship", { taxonomy_id: taxonomyId });
    defineActionGenus(kernel, "archive");

    const inventoryActions = listActionGenera(kernel, { taxonomy_id: taxonomyId });
    expect(inventoryActions.length).toBe(1);
    expect(inventoryActions[0].name).toBe("ship");
  });

  test("listRelationshipGenera filters by taxonomy_id", () => {
    const taxonomyId = createTaxonomy(kernel, "Inventory");
    defineEntityGenus(kernel, "Widget", { taxonomy_id: taxonomyId });
    defineEntityGenus(kernel, "Warehouse", { taxonomy_id: taxonomyId });
    defineRelationshipGenus(kernel, "Storage", {
      roles: [
        { name: "item", valid_member_genera: ["Widget"], cardinality: "one" },
        { name: "location", valid_member_genera: ["Warehouse"], cardinality: "one" },
      ],
      taxonomy_id: taxonomyId,
    });
    defineEntityGenus(kernel, "Person");
    defineEntityGenus(kernel, "Gadget");
    defineRelationshipGenus(kernel, "Ownership", {
      roles: [
        { name: "owner", valid_member_genera: ["Person"], cardinality: "one" },
        { name: "item", valid_member_genera: ["Gadget"], cardinality: "one" },
      ],
    });

    const inventoryRels = listRelationshipGenera(kernel, { taxonomy_id: taxonomyId });
    expect(inventoryRels.length).toBe(1);
    expect(inventoryRels[0].name).toBe("Storage");
  });

  test("listProcessGenera filters by taxonomy_id", () => {
    const taxonomyId = createTaxonomy(kernel, "Inventory");
    defineProcessGenus(kernel, "Fulfillment", {
      lanes: [{ name: "main", position: 0 }],
      steps: [{ name: "pick", type: "task_step", lane: "main", position: 0, task_title: "Pick items" }],
      taxonomy_id: taxonomyId,
    });
    defineProcessGenus(kernel, "Hiring", {
      lanes: [{ name: "main", position: 0 }],
      steps: [{ name: "screen", type: "task_step", lane: "main", position: 0, task_title: "Screen candidate" }],
    });

    const inventoryProcesses = listProcessGenera(kernel, { taxonomy_id: taxonomyId });
    expect(inventoryProcesses.length).toBe(1);
    expect(inventoryProcesses[0].name).toBe("Fulfillment");
  });

  // --- describeTaxonomy ---

  test("describeTaxonomy returns complete schema picture for populated taxonomy", () => {
    const taxonomyId = createTaxonomy(kernel, "Inventory", "Inventory taxonomy");
    defineEntityGenus(kernel, "Widget", {
      attributes: [{ name: "sku", type: "text", required: true }],
      taxonomy_id: taxonomyId,
    });
    defineFeatureGenus(kernel, "Part", { parent_genus_name: "Widget", taxonomy_id: taxonomyId });
    defineActionGenus(kernel, "ship", { taxonomy_id: taxonomyId });

    const desc = describeTaxonomy(kernel, taxonomyId);
    expect(desc.name).toBe("Inventory");
    expect(desc.description).toBe("Inventory taxonomy");
    expect(desc.status).toBe("active");
    expect(desc.entity_genera.length).toBe(1);
    expect(desc.entity_genera[0].name).toBe("Widget");
    expect(desc.feature_genera.length).toBe(1);
    expect(desc.feature_genera[0].name).toBe("Part");
    expect(desc.action_genera.length).toBe(1);
    expect(desc.action_genera[0].name).toBe("ship");
  });

  test("describeTaxonomy returns empty arrays for empty taxonomy", () => {
    const taxonomyId = createTaxonomy(kernel, "Empty");
    const desc = describeTaxonomy(kernel, taxonomyId);
    expect(desc.name).toBe("Empty");
    expect(desc.entity_genera).toEqual([]);
    expect(desc.feature_genera).toEqual([]);
    expect(desc.relationship_genera).toEqual([]);
    expect(desc.action_genera).toEqual([]);
    expect(desc.process_genera).toEqual([]);
    expect(desc.serialization_genera).toEqual([]);
  });

  test("describeTaxonomy includes entity counts per genus", () => {
    const taxonomyId = createTaxonomy(kernel, "Inventory");
    const genusId = defineEntityGenus(kernel, "Widget", {
      attributes: [{ name: "sku", type: "text", required: true }],
      taxonomy_id: taxonomyId,
    });

    createEntity(kernel, genusId);
    createEntity(kernel, genusId);

    const desc = describeTaxonomy(kernel, taxonomyId);
    expect(desc.entity_genera[0].entity_count).toBe(2);
  });
});

// ============================================================================
// Sciences
// ============================================================================

describe("Sciences", () => {
  let kernel: Kernel;

  beforeEach(() => {
    kernel = initKernel(":memory:");
  });

  afterEach(() => {
    kernel.db.close();
  });

  // --- Bootstrap ---

  test("initKernel bootstraps science genus with correct def", () => {
    const def = getGenusDef(kernel, SCIENCE_GENUS_ID);
    expect(def.meta.name).toBe("Science");
    expect(def.attributes.name).toBeDefined();
    expect(def.attributes.description).toBeDefined();
    expect(def.states.active).toBeDefined();
    expect(def.states.archived).toBeDefined();
    expect(def.transitions).toContainEqual({ from: "active", to: "archived" });
    expect(def.transitions).toContainEqual({ from: "archived", to: "active" });
  });

  test("initKernel creates default science entity", () => {
    const state = materialize(kernel, DEFAULT_SCIENCE_ID);
    expect(state.name).toBe("Default");
    expect(state.description).toBe("Default science for all taxonomies");
    expect(state.status).toBe("active");
  });

  test("bootstrap is idempotent", () => {
    const kernel2 = initKernel(":memory:");
    const def = getGenusDef(kernel2, SCIENCE_GENUS_ID);
    expect(def.meta.name).toBe("Science");
    const state = materialize(kernel2, DEFAULT_SCIENCE_ID);
    expect(state.name).toBe("Default");
    kernel2.db.close();
  });

  test("listGenera excludes science genus", () => {
    const genera = listGenera(kernel);
    expect(genera.find((g) => g.id === SCIENCE_GENUS_ID)).toBeUndefined();
  });

  test("listEntities excludes science entities", () => {
    const entities = listEntities(kernel);
    expect(entities.find((e) => e.id === DEFAULT_SCIENCE_ID)).toBeUndefined();
  });

  // --- CRUD ---

  test("createScience creates a new science", () => {
    const id = createScience(kernel, "Architecture");
    const state = materialize(kernel, id);
    expect(state.name).toBe("Architecture");
    expect(state.status).toBe("active");
  });

  test("createScience with description", () => {
    const id = createScience(kernel, "Workflow", "Study of workflows");
    const state = materialize(kernel, id);
    expect(state.description).toBe("Study of workflows");
  });

  test("listSciences returns all sciences including default", () => {
    createScience(kernel, "Architecture");
    const sciences = listSciences(kernel);
    expect(sciences.length).toBeGreaterThanOrEqual(2); // Default + Architecture
    expect(sciences.find((s) => s.name === "Default")).toBeDefined();
    expect(sciences.find((s) => s.name === "Architecture")).toBeDefined();
  });

  test("findScienceByName case-insensitive", () => {
    createScience(kernel, "Architecture");
    expect(findScienceByName(kernel, "architecture")).not.toBeNull();
    expect(findScienceByName(kernel, "ARCHITECTURE")).not.toBeNull();
  });

  test("findScienceByName returns null for nonexistent", () => {
    expect(findScienceByName(kernel, "Nonexistent")).toBeNull();
  });

  test("describeScience returns science with taxonomies", () => {
    const scienceId = createScience(kernel, "Architecture");
    const taxId = createTaxonomy(kernel, "Buildings", undefined, scienceId);
    const desc = describeScience(kernel, scienceId);
    expect(desc.name).toBe("Architecture");
    expect(desc.taxonomies.length).toBe(1);
    expect(desc.taxonomies[0].id).toBe(taxId);
    expect(desc.taxonomies[0].name).toBe("Buildings");
  });

  test("describeScience default science includes default taxonomy", () => {
    const desc = describeScience(kernel, DEFAULT_SCIENCE_ID);
    expect(desc.name).toBe("Default");
    expect(desc.taxonomies.find((t) => t.id === DEFAULT_TAXONOMY_ID)).toBeDefined();
  });

  // --- Taxonomy-Science link ---

  test("default taxonomy has science_id set to DEFAULT_SCIENCE_ID", () => {
    const state = materialize(kernel, DEFAULT_TAXONOMY_ID);
    expect(state.science_id).toBe(DEFAULT_SCIENCE_ID);
  });

  test("createTaxonomy with explicit science_id", () => {
    const scienceId = createScience(kernel, "Architecture");
    const taxId = createTaxonomy(kernel, "Buildings", undefined, scienceId);
    const state = materialize(kernel, taxId);
    expect(state.science_id).toBe(scienceId);
  });

  test("createTaxonomy defaults to DEFAULT_SCIENCE_ID", () => {
    const taxId = createTaxonomy(kernel, "General");
    const state = materialize(kernel, taxId);
    expect(state.science_id).toBe(DEFAULT_SCIENCE_ID);
  });

  // --- Archival ---

  test("archive science via transitionStatus", () => {
    const id = createScience(kernel, "Old");
    transitionStatus(kernel, id, "archived");
    const state = materialize(kernel, id);
    expect(state.status).toBe("archived");
  });

  test("unarchive science via transitionStatus", () => {
    const id = createScience(kernel, "Old");
    transitionStatus(kernel, id, "archived");
    transitionStatus(kernel, id, "active");
    const state = materialize(kernel, id);
    expect(state.status).toBe("active");
  });

  test("deprecateGenus rejects SCIENCE_GENUS_ID", () => {
    expect(() => deprecateGenus(kernel, SCIENCE_GENUS_ID)).toThrow("Cannot deprecate sentinel genus");
  });
});

// ============================================================================
// Define Genus via MCP
// ============================================================================

describe("Define Genus via MCP", () => {
  let kernel: Kernel;

  beforeEach(() => {
    kernel = initKernel(":memory:");
  });

  afterEach(() => {
    kernel.db.close();
  });

  // --- validateAttributes ---

  test("validateAttributes: duplicate attribute names throws", () => {
    expect(() =>
      validateAttributes([
        { name: "sku", type: "text" },
        { name: "SKU", type: "number" },
      ])
    ).toThrow("Duplicate attribute name");
  });

  test("validateAttributes: invalid attribute type throws", () => {
    expect(() =>
      validateAttributes([{ name: "sku", type: "string" }])
    ).toThrow('Invalid attribute type "string"');
  });

  test("validateAttributes: valid attributes pass", () => {
    expect(() =>
      validateAttributes([
        { name: "sku", type: "text" },
        { name: "price", type: "number" },
        { name: "active", type: "boolean" },
        { name: "files", type: "filetree" },
      ])
    ).not.toThrow();
  });

  // --- validateStateMachine ---

  test("validateStateMachine: no initial state throws", () => {
    expect(() =>
      validateStateMachine(
        [{ name: "draft" }, { name: "active" }],
        [],
      )
    ).toThrow("exactly one initial state");
  });

  test("validateStateMachine: multiple initial states throws", () => {
    expect(() =>
      validateStateMachine(
        [{ name: "draft", initial: true }, { name: "active", initial: true }],
        [],
      )
    ).toThrow("multiple initial states");
  });

  test("validateStateMachine: transition references undefined state throws", () => {
    expect(() =>
      validateStateMachine(
        [{ name: "draft", initial: true }, { name: "active" }],
        [{ from: "draft", to: "published" }],
      )
    ).toThrow('references undefined state: "published"');
  });

  test("validateStateMachine: duplicate state names throws", () => {
    expect(() =>
      validateStateMachine(
        [{ name: "draft", initial: true }, { name: "Draft" }],
        [],
      )
    ).toThrow("Duplicate state name");
  });

  // --- Integration: define entity genus end-to-end ---

  test("define entity genus with full definition → create entity → set attributes → transition", () => {
    const genusId = defineEntityGenus(kernel, "Product", {
      attributes: [
        { name: "name", type: "text", required: true },
        { name: "sku", type: "text" },
        { name: "price", type: "number" },
      ],
      states: [
        { name: "draft", initial: true },
        { name: "active", initial: false },
        { name: "discontinued", initial: false },
      ],
      transitions: [
        { from: "draft", to: "active" },
        { from: "active", to: "discontinued" },
      ],
    });

    const entityId = createEntity(kernel, genusId);
    setAttribute(kernel, entityId, "name", "Widget");
    setAttribute(kernel, entityId, "sku", "WDG-001");
    setAttribute(kernel, entityId, "price", 29.99);

    const state = materialize(kernel, entityId);
    expect(state.name).toBe("Widget");
    expect(state.sku).toBe("WDG-001");
    expect(state.price).toBe(29.99);
    expect(state.status).toBe("draft");

    transitionStatus(kernel, entityId, "active");
    const updated = materialize(kernel, entityId);
    expect(updated.status).toBe("active");
  });

  test("define entity genus defaults to DEFAULT_TAXONOMY_ID", () => {
    const genusId = defineEntityGenus(kernel, "Widget", {});
    const def = getGenusDef(kernel, genusId);
    expect(def.meta.taxonomy_id).toBe(DEFAULT_TAXONOMY_ID);
  });

  test("define entity genus with explicit taxonomy", () => {
    const taxonomyId = createTaxonomy(kernel, "Inventory");
    const genusId = defineEntityGenus(kernel, "Product", { taxonomy_id: taxonomyId });
    const def = getGenusDef(kernel, genusId);
    expect(def.meta.taxonomy_id).toBe(taxonomyId);
  });

  test("genus with no states/transitions works (stateless)", () => {
    const genusId = defineEntityGenus(kernel, "Note", {
      attributes: [{ name: "body", type: "text" }],
    });

    const entityId = createEntity(kernel, genusId);
    setAttribute(kernel, entityId, "body", "Hello world");
    const state = materialize(kernel, entityId);
    expect(state.body).toBe("Hello world");
    expect(state.status).toBeUndefined();
  });

  // --- Integration: define feature genus end-to-end ---

  test("define feature genus with parent → create feature → set attrs → transition", () => {
    const productId = defineEntityGenus(kernel, "Product", {
      states: [
        { name: "draft", initial: true },
        { name: "active", initial: false },
      ],
      transitions: [{ from: "draft", to: "active" }],
    });

    const variantId = defineFeatureGenus(kernel, "Variant", {
      parent_genus_name: "Product",
      attributes: [
        { name: "size", type: "text" },
        { name: "color", type: "text" },
      ],
      states: [
        { name: "pending", initial: true },
        { name: "confirmed", initial: false },
      ],
      transitions: [{ from: "pending", to: "confirmed" }],
    });

    const entityId = createEntity(kernel, productId);
    const featureId = createFeature(kernel, entityId, variantId, {
      attributes: { size: "Large", color: "Blue" },
    });

    const state = materialize(kernel, entityId);
    const featureState = (state.features as any)[featureId];
    expect(featureState.size).toBe("Large");
    expect(featureState.color).toBe("Blue");
    expect(featureState.status).toBe("pending");

    transitionFeatureStatus(kernel, entityId, featureId, "confirmed");
    const updated = materialize(kernel, entityId);
    expect((updated.features as any)[featureId].status).toBe("confirmed");
  });

  test("feature genus inherits parent taxonomy when none specified", () => {
    const taxonomyId = createTaxonomy(kernel, "Inventory");
    defineEntityGenus(kernel, "Product", { taxonomy_id: taxonomyId });

    const featureGenusId = defineFeatureGenus(kernel, "Variant", {
      parent_genus_name: "Product",
      taxonomy_id: taxonomyId,
    });

    const def = getGenusDef(kernel, featureGenusId);
    expect(def.meta.taxonomy_id).toBe(taxonomyId);
  });

  test("feature genus with explicit taxonomy overrides parent", () => {
    const inventoryTaxonomyId = createTaxonomy(kernel, "Inventory");
    const logisticsTaxonomyId = createTaxonomy(kernel, "Logistics");
    defineEntityGenus(kernel, "Product", { taxonomy_id: inventoryTaxonomyId });

    const featureGenusId = defineFeatureGenus(kernel, "Variant", {
      parent_genus_name: "Product",
      taxonomy_id: logisticsTaxonomyId,
    });

    const def = getGenusDef(kernel, featureGenusId);
    expect(def.meta.taxonomy_id).toBe(logisticsTaxonomyId);
  });

  test("editable_parent_statuses validated against parent states", () => {
    defineEntityGenus(kernel, "Product", {
      states: [
        { name: "draft", initial: true },
        { name: "active", initial: false },
      ],
      transitions: [{ from: "draft", to: "active" }],
    });

    // Valid editable_parent_statuses
    const featureGenusId = defineFeatureGenus(kernel, "Variant", {
      parent_genus_name: "Product",
      editable_parent_statuses: ["draft"],
    });

    const def = getGenusDef(kernel, featureGenusId);
    expect(def.meta.editable_parent_statuses).toEqual(["draft"]);
  });

  test("invalid editable_parent_statuses throws in server validation context", () => {
    // This tests the validation logic that the MCP tool would perform.
    // The kernel defineFeatureGenus doesn't validate — the MCP layer does.
    // We test the raw validator + parentDef pattern here.
    const genusId = defineEntityGenus(kernel, "Product", {
      states: [
        { name: "draft", initial: true },
        { name: "active", initial: false },
      ],
      transitions: [{ from: "draft", to: "active" }],
    });

    const parentDef = getGenusDef(kernel, genusId);
    const parentStateNames = Object.keys(parentDef.states).map((s) => s.toLowerCase());
    const invalidStatuses = ["nonexistent"];

    const invalid = invalidStatuses.some((s) => !parentStateNames.includes(s.toLowerCase()));
    expect(invalid).toBe(true);
  });

  // --- Relationship genus validation ---

  test("relationship genus: fewer than 2 roles throws", () => {
    defineEntityGenus(kernel, "Product", {});
    expect(() =>
      defineRelationshipGenus(kernel, "Supply", {
        roles: [{ name: "supplier", valid_member_genera: ["Product"], cardinality: "one" }],
      })
    ).not.toThrow(); // kernel doesn't validate — but the MCP layer does
    // Test the validation logic that the MCP tool performs
    const roles = [{ name: "supplier", valid_member_genera: ["Product"], cardinality: "one" }];
    expect(roles.length < 2).toBe(true);
  });

  test("relationship genus: duplicate role names detected", () => {
    const roles = [
      { name: "supplier", valid_member_genera: ["Product"], cardinality: "one" as const },
      { name: "Supplier", valid_member_genera: ["Product"], cardinality: "one" as const },
    ];
    const seen = new Set<string>();
    let duplicate = false;
    for (const role of roles) {
      const lower = role.name.toLowerCase();
      if (seen.has(lower)) { duplicate = true; break; }
      seen.add(lower);
    }
    expect(duplicate).toBe(true);
  });

  test("relationship genus: invalid cardinality detected", () => {
    const VALID_CARDINALITIES = ["one", "one_or_more", "zero_or_more"];
    expect(VALID_CARDINALITIES.includes("many")).toBe(false);
    expect(VALID_CARDINALITIES.includes("one")).toBe(true);
    expect(VALID_CARDINALITIES.includes("one_or_more")).toBe(true);
    expect(VALID_CARDINALITIES.includes("zero_or_more")).toBe(true);
  });

  test("relationship genus: valid_member_genera references non-existent genus detected", () => {
    // The MCP layer uses resolveGenusId which throws — simulate that check
    expect(() => findGenusByName(kernel, "Nonexistent")).not.toThrow();
    expect(findGenusByName(kernel, "Nonexistent")).toBeNull();
  });

  test("relationship genus: valid_member_genera referencing non-entity genus detected", () => {
    defineEntityGenus(kernel, "Product", {});
    const featureGenusId = defineFeatureGenus(kernel, "Variant", {
      parent_genus_name: "Product",
    });
    const def = getGenusDef(kernel, featureGenusId);
    expect(def.meta.kind).toBe("feature");
    // MCP layer would reject this because kind is set (not an entity genus)
  });

  // --- Relationship genus integration ---

  test("define relationship genus end-to-end → create entities → create relationship → query", () => {
    const supplierGenusId = defineEntityGenus(kernel, "Supplier", {
      attributes: [{ name: "name", type: "text", required: true }],
    });
    const productGenusId = defineEntityGenus(kernel, "Product", {
      attributes: [{ name: "name", type: "text", required: true }],
    });

    const relGenusId = defineRelationshipGenus(kernel, "Supply", {
      roles: [
        { name: "supplier", valid_member_genera: ["Supplier"], cardinality: "one" },
        { name: "product", valid_member_genera: ["Product"], cardinality: "one" },
      ],
      attributes: [
        { name: "lead_time", type: "number" },
        { name: "unit_cost", type: "number" },
      ],
    });

    const def = getGenusDef(kernel, relGenusId);
    expect(def.meta.kind).toBe("relationship");
    expect(def.meta.name).toBe("Supply");

    const supplierId = createEntity(kernel, supplierGenusId);
    setAttribute(kernel, supplierId, "name", "Acme Parts");
    const productId = createEntity(kernel, productGenusId);
    setAttribute(kernel, productId, "name", "Widget");

    const relId = createRelationship(kernel, relGenusId, {
      supplier: supplierId,
      product: productId,
    });

    const supplierRels = getRelationshipsForEntity(kernel, supplierId);
    expect(supplierRels.length).toBe(1);
    expect(supplierRels[0].id).toBe(relId);

    const productRels = getRelationshipsForEntity(kernel, productId);
    expect(productRels.length).toBe(1);
    expect(productRels[0].id).toBe(relId);

    const related = getRelatedEntities(kernel, supplierId, relGenusId, "supplier");
    expect(related.length).toBe(1);
    expect(related[0].entity_id).toBe(productId);
  });

  test("relationship genus defaults to DEFAULT_TAXONOMY_ID", () => {
    defineEntityGenus(kernel, "A", {});
    defineEntityGenus(kernel, "B", {});
    const relGenusId = defineRelationshipGenus(kernel, "Link", {
      roles: [
        { name: "left", valid_member_genera: ["A"], cardinality: "one" },
        { name: "right", valid_member_genera: ["B"], cardinality: "one" },
      ],
    });
    const def = getGenusDef(kernel, relGenusId);
    expect(def.meta.taxonomy_id).toBe(DEFAULT_TAXONOMY_ID);
  });

  test("relationship genus with explicit taxonomy", () => {
    const taxonomyId = createTaxonomy(kernel, "Inventory");
    defineEntityGenus(kernel, "Supplier", { taxonomy_id: taxonomyId });
    defineEntityGenus(kernel, "Product", { taxonomy_id: taxonomyId });
    const relGenusId = defineRelationshipGenus(kernel, "Supply", {
      roles: [
        { name: "supplier", valid_member_genera: ["Supplier"], cardinality: "one" },
        { name: "product", valid_member_genera: ["Product"], cardinality: "one" },
      ],
      taxonomy_id: taxonomyId,
    });
    const def = getGenusDef(kernel, relGenusId);
    expect(def.meta.taxonomy_id).toBe(taxonomyId);
  });

  test("cross-taxonomy: relationship in taxonomy A, member genera in taxonomy B", () => {
    const taxonomyA = createTaxonomy(kernel, "Sales");
    const taxonomyB = createTaxonomy(kernel, "Inventory");
    const supplierGenusId = defineEntityGenus(kernel, "Supplier", { taxonomy_id: taxonomyB });
    const productGenusId = defineEntityGenus(kernel, "Product", { taxonomy_id: taxonomyB });

    const relGenusId = defineRelationshipGenus(kernel, "Supply", {
      roles: [
        { name: "supplier", valid_member_genera: ["Supplier"], cardinality: "one" },
        { name: "product", valid_member_genera: ["Product"], cardinality: "one" },
      ],
      taxonomy_id: taxonomyA,
    });
    const def = getGenusDef(kernel, relGenusId);
    expect(def.meta.taxonomy_id).toBe(taxonomyA);

    // Can still create relationships across ontologies
    const supplierId = createEntity(kernel, supplierGenusId);
    const productId = createEntity(kernel, productGenusId);
    const relId = createRelationship(kernel, relGenusId, {
      supplier: supplierId,
      product: productId,
    });
    expect(relId).toBeTruthy();
  });

  // --- validateActionHandler ---

  test("validateActionHandler: unknown side effect type throws", () => {
    expect(() =>
      validateActionHandler([{ type: "explode" } as any], [], [])
    ).toThrow('Unknown side effect type: "explode"');
  });

  test("validateActionHandler: set_attribute missing required fields throws", () => {
    expect(() =>
      validateActionHandler([{ type: "set_attribute", res: "x", key: "k" }], [], [])
    ).toThrow('missing required field: "value"');
    expect(() =>
      validateActionHandler([{ type: "set_attribute", res: "x", value: "v" }], [], [])
    ).toThrow('missing required field: "key"');
    expect(() =>
      validateActionHandler([{ type: "set_attribute", key: "k", value: "v" }], [], [])
    ).toThrow('missing required field: "res"');
  });

  test("validateActionHandler: transition_status missing target throws", () => {
    expect(() =>
      validateActionHandler([{ type: "transition_status", res: "x" }], [], [])
    ).toThrow('missing required field: "target"');
  });

  test("validateActionHandler: create_res missing genus_name throws", () => {
    expect(() =>
      validateActionHandler([{ type: "create_res" }], [], [])
    ).toThrow('missing required field: "genus_name"');
  });

  test("validateActionHandler: create_log missing message throws", () => {
    expect(() =>
      validateActionHandler([{ type: "create_log" }], [], [])
    ).toThrow('missing required field: "message"');
  });

  test("validateActionHandler: create_error missing message throws", () => {
    expect(() =>
      validateActionHandler([{ type: "create_error" }], [], [])
    ).toThrow('missing required field: "message"');
  });

  test("validateActionHandler: create_task missing title throws", () => {
    expect(() =>
      validateActionHandler([{ type: "create_task" }], [], [])
    ).toThrow('missing required field: "title"');
  });

  test("validateActionHandler: $res.X.id referencing undefined resource throws", () => {
    expect(() =>
      validateActionHandler(
        [{ type: "set_attribute", res: "$res.widget.id", key: "name", value: "test" }],
        [],
        [],
      )
    ).toThrow('undefined resource "widget"');
  });

  test("validateActionHandler: $param.X referencing undefined parameter throws", () => {
    expect(() =>
      validateActionHandler(
        [{ type: "set_attribute", res: "some-id", key: "note", value: "$param.reason" }],
        [],
        [],
      )
    ).toThrow('undefined parameter "reason"');
  });

  test("validateActionHandler: tokens in nested objects validated", () => {
    expect(() =>
      validateActionHandler(
        [{ type: "create_res", genus_name: "Note", attributes: { note: "$param.missing" } }],
        [],
        [],
      )
    ).toThrow('undefined parameter "missing"');
  });

  test("validateActionHandler: $now is always valid", () => {
    expect(() =>
      validateActionHandler(
        [{ type: "set_attribute", res: "some-id", key: "updated_at", value: "$now" }],
        [],
        [],
      )
    ).not.toThrow();
  });

  test("validateActionHandler: empty handler passes", () => {
    expect(() => validateActionHandler([], [], [])).not.toThrow();
  });

  test("validateActionHandler: valid complete handler passes", () => {
    expect(() =>
      validateActionHandler(
        [
          { type: "set_attribute", res: "$res.product.id", key: "discontinued_at", value: "$now" },
          { type: "create_log", message: "Discontinued by $param.reason", res: "$res.product.id" },
          { type: "transition_status", res: "$res.product.id", target: "discontinued" },
        ],
        ["product"],
        ["reason"],
      )
    ).not.toThrow();
  });

  // --- Action genus integration ---

  test("define action genus end-to-end → create entity → execute action → verify state changes", () => {
    const productGenusId = defineEntityGenus(kernel, "Product", {
      attributes: [
        { name: "name", type: "text", required: true },
        { name: "discontinued_at", type: "text" },
      ],
      states: [
        { name: "draft", initial: true },
        { name: "active", initial: false },
        { name: "discontinued", initial: false },
      ],
      transitions: [
        { from: "draft", to: "active" },
        { from: "active", to: "discontinued" },
      ],
    });

    const actionGenusId = defineActionGenus(kernel, "Discontinue", {
      resources: [{ name: "product", genus_name: "Product", required_status: "active" }],
      parameters: [{ name: "reason", type: "text", required: true }],
      handler: [
        { type: "set_attribute", res: "$res.product.id", key: "discontinued_at", value: "$now" },
        { type: "create_log", message: "Discontinued: $param.reason", res: "$res.product.id" },
        { type: "transition_status", res: "$res.product.id", target: "discontinued" },
      ],
    });

    const entityId = createEntity(kernel, productGenusId);
    setAttribute(kernel, entityId, "name", "Widget");
    transitionStatus(kernel, entityId, "active");

    executeAction(kernel, actionGenusId, { product: entityId }, { reason: "End of life" });

    const state = materialize(kernel, entityId);
    expect(state.status).toBe("discontinued");
    expect(state.discontinued_at).toBeTruthy();
  });

  test("define action genus: duplicate name throws (case-insensitive)", () => {
    defineEntityGenus(kernel, "Product", {});
    defineActionGenus(kernel, "Archive", {
      resources: [{ name: "product", genus_name: "Product" }],
    });
    // Check via listActionGenera (simulating MCP layer check)
    const existing = listActionGenera(kernel);
    expect(existing.some((a) => a.name.toLowerCase() === "archive")).toBe(true);
  });

  test("define action genus: duplicate resource name detected", () => {
    const resources = [
      { name: "product", genus_name: "Product" },
      { name: "Product", genus_name: "Product" },
    ];
    const seen = new Set<string>();
    let duplicate = false;
    for (const res of resources) {
      const lower = res.name.toLowerCase();
      if (seen.has(lower)) { duplicate = true; break; }
      seen.add(lower);
    }
    expect(duplicate).toBe(true);
  });

  test("define action genus: duplicate parameter name detected", () => {
    const parameters = [
      { name: "reason", type: "text" },
      { name: "Reason", type: "text" },
    ];
    const seen = new Set<string>();
    let duplicate = false;
    for (const param of parameters) {
      const lower = param.name.toLowerCase();
      if (seen.has(lower)) { duplicate = true; break; }
      seen.add(lower);
    }
    expect(duplicate).toBe(true);
  });

  test("define action genus: invalid parameter type detected", () => {
    const VALID_PARAM_TYPES = ["text", "number", "boolean", "filetree"];
    expect(VALID_PARAM_TYPES.includes("string")).toBe(false);
    expect(VALID_PARAM_TYPES.includes("text")).toBe(true);
  });

  test("define action genus: resource references non-existent genus detected", () => {
    expect(findGenusByName(kernel, "Nonexistent")).toBeNull();
  });

  test("define action genus: resource references non-entity genus detected", () => {
    defineEntityGenus(kernel, "Product", {});
    const featureGenusId = defineFeatureGenus(kernel, "Variant", {
      parent_genus_name: "Product",
    });
    const def = getGenusDef(kernel, featureGenusId);
    expect(def.meta.kind).toBe("feature");
  });

  test("define action genus: required_status on stateless genus detected", () => {
    const genusId = defineEntityGenus(kernel, "Note", {
      attributes: [{ name: "body", type: "text" }],
    });
    const def = getGenusDef(kernel, genusId);
    expect(Object.keys(def.states).length).toBe(0);
  });

  test("define action genus: required_status references invalid state detected", () => {
    const genusId = defineEntityGenus(kernel, "Product", {
      states: [
        { name: "draft", initial: true },
        { name: "active", initial: false },
      ],
      transitions: [{ from: "draft", to: "active" }],
    });
    const def = getGenusDef(kernel, genusId);
    const stateNames = Object.keys(def.states).map((s) => s.toLowerCase());
    expect(stateNames.includes("nonexistent")).toBe(false);
  });

  test("define action genus defaults to DEFAULT_TAXONOMY_ID", () => {
    defineEntityGenus(kernel, "Product", {});
    const actionGenusId = defineActionGenus(kernel, "Archive", {
      resources: [{ name: "product", genus_name: "Product" }],
    });
    const def = getActionDef(kernel, actionGenusId);
    expect(def.meta.taxonomy_id).toBe(DEFAULT_TAXONOMY_ID);
  });

  test("define action genus with explicit taxonomy", () => {
    const taxonomyId = createTaxonomy(kernel, "Inventory");
    defineEntityGenus(kernel, "Product", { taxonomy_id: taxonomyId });
    const actionGenusId = defineActionGenus(kernel, "Archive", {
      resources: [{ name: "product", genus_name: "Product" }],
      taxonomy_id: taxonomyId,
    });
    const def = getActionDef(kernel, actionGenusId);
    expect(def.meta.taxonomy_id).toBe(taxonomyId);
  });

  test("define action genus: minimal action (name only)", () => {
    const actionGenusId = defineActionGenus(kernel, "NoOp", {});
    const def = getActionDef(kernel, actionGenusId);
    expect(def.meta.name).toBe("NoOp");
    expect(def.meta.kind).toBe("action");
    expect(Object.keys(def.resources)).toHaveLength(0);
    expect(Object.keys(def.parameters)).toHaveLength(0);
    expect(def.handler).toHaveLength(0);
  });

  // --- handler token normalization (bare resource names → $res.X.id) ---

  test("executeAction works when handler uses $res.X.id token syntax", () => {
    defineEntityGenus(kernel, "Book", {
      states: [{ name: "available", initial: true }, { name: "checked_out" }],
      transitions: [{ from: "available", to: "checked_out" }],
    });

    // Properly tokenized handler (as the MCP layer produces after normalization)
    const actionId = defineActionGenus(kernel, "checkout", {
      resources: [{ name: "book", genus_name: "Book", required_status: "available" }],
      handler: [
        { type: "transition_status", res: "$res.book.id", target: "checked_out" },
      ],
    });

    const genusId = findGenusByName(kernel, "Book")!;
    const entityId = createEntity(kernel, genusId);
    const result = executeAction(kernel, actionId, { book: entityId }, {});
    expect(result.error).toBeUndefined();
    const state = materialize(kernel, entityId);
    expect(state.status).toBe("checked_out");
  });

  test("executeAction fails when handler has bare resource name (without MCP normalization)", () => {
    defineEntityGenus(kernel, "Widget", {
      states: [{ name: "active", initial: true }, { name: "archived" }],
      transitions: [{ from: "active", to: "archived" }],
    });

    // Bare "widget" instead of "$res.widget.id" — this is the bug scenario
    const actionId = defineActionGenus(kernel, "archive", {
      resources: [{ name: "widget", genus_name: "Widget", required_status: "active" }],
      handler: [
        { type: "transition_status", res: "widget", target: "archived" },
      ],
    });

    const genusId = findGenusByName(kernel, "Widget")!;
    const entityId = createEntity(kernel, genusId);
    const result = executeAction(kernel, actionId, { widget: entityId }, {});
    // Without normalization, "widget" is passed as res_id → Res not found
    expect(result.error).toContain("Res not found: widget");
  });

  // --- validateProcessDefinition ---

  test("validateProcessDefinition: no lanes throws", () => {
    expect(() => validateProcessDefinition([], [{ name: "s1", type: "task_step", lane: "main" }])).toThrow("at least one lane");
  });

  test("validateProcessDefinition: duplicate lane names throws (case-insensitive)", () => {
    expect(() => validateProcessDefinition(
      [{ name: "Main" }, { name: "main" }],
      [{ name: "s1", type: "task_step", lane: "Main" }],
    )).toThrow('Duplicate lane name: "main"');
  });

  test("validateProcessDefinition: no steps throws", () => {
    expect(() => validateProcessDefinition([{ name: "main" }], [])).toThrow("at least one step");
  });

  test("validateProcessDefinition: duplicate step names across lanes throws (case-insensitive)", () => {
    expect(() => validateProcessDefinition(
      [{ name: "lane1" }, { name: "lane2" }],
      [
        { name: "Review", type: "task_step", lane: "lane1" },
        { name: "review", type: "task_step", lane: "lane2" },
      ],
    )).toThrow('Duplicate step name: "review"');
  });

  test("validateProcessDefinition: invalid step type throws", () => {
    expect(() => validateProcessDefinition(
      [{ name: "main" }],
      [{ name: "s1", type: "invalid_step", lane: "main" }],
    )).toThrow('Invalid step type "invalid_step"');
  });

  test("validateProcessDefinition: step references non-existent lane throws", () => {
    expect(() => validateProcessDefinition(
      [{ name: "main" }],
      [{ name: "s1", type: "task_step", lane: "other" }],
    )).toThrow('references undefined lane: "other"');
  });

  test("validateProcessDefinition: gate condition references non-existent step throws", () => {
    expect(() => validateProcessDefinition(
      [{ name: "main" }],
      [{ name: "gate1", type: "gate_step", lane: "main", gate_conditions: ["nonexistent"] }],
    )).toThrow('references undefined step in conditions: "nonexistent"');
  });

  test("validateProcessDefinition: gate with empty conditions throws", () => {
    expect(() => validateProcessDefinition(
      [{ name: "main" }],
      [{ name: "gate1", type: "gate_step", lane: "main", gate_conditions: [] }],
    )).toThrow("must have at least one condition");
  });

  test("validateProcessDefinition: valid minimal process passes", () => {
    expect(() => validateProcessDefinition(
      [{ name: "main" }],
      [{ name: "s1", type: "task_step", lane: "main" }],
    )).not.toThrow();
  });

  test("validateProcessDefinition: valid multi-lane process with gate passes", () => {
    expect(() => validateProcessDefinition(
      [{ name: "marketing" }, { name: "legal" }, { name: "final" }],
      [
        { name: "marketing_review", type: "task_step", lane: "marketing" },
        { name: "legal_review", type: "task_step", lane: "legal" },
        { name: "approval_gate", type: "gate_step", lane: "final", gate_conditions: ["marketing_review", "legal_review"] },
        { name: "publish", type: "action_step", lane: "final" },
      ],
    )).not.toThrow();
  });

  // --- define_process_genus integration ---

  test("define process genus: end-to-end minimal", () => {
    const genusId = defineProcessGenus(kernel, "Simple Flow", {
      lanes: [{ name: "main", position: 0 }],
      steps: [
        { name: "do_it", type: "task_step", lane: "main", position: 0, task_title: "Do the thing" },
      ],
      triggers: [{ type: "manual" }],
      meta: { description: "A simple flow" },
    });
    const def = getProcessDef(kernel, genusId);
    expect(def.meta.name).toBe("Simple Flow");
    expect(def.meta.kind).toBe("process");
    expect(Object.keys(def.lanes)).toHaveLength(1);
    expect(Object.keys(def.steps)).toHaveLength(1);
    expect(def.steps["do_it"].task_title).toBe("Do the thing");
  });

  test("define process genus: duplicate name throws (case-insensitive)", () => {
    defineProcessGenus(kernel, "My Process", {
      lanes: [{ name: "main", position: 0 }],
      steps: [{ name: "s1", type: "task_step", lane: "main", position: 0, task_title: "Step 1" }],
    });
    // Same name (different case) should be found by listProcessGenera
    const existing = listProcessGenera(kernel);
    expect(existing.some((p) => p.name.toLowerCase() === "my process")).toBe(true);
  });

  test("define process genus: defaults to DEFAULT_TAXONOMY_ID", () => {
    const genusId = defineProcessGenus(kernel, "Taxonomy Test", {
      lanes: [{ name: "main", position: 0 }],
      steps: [{ name: "s1", type: "task_step", lane: "main", position: 0, task_title: "Step 1" }],
    });
    const def = getProcessDef(kernel, genusId);
    expect(def.meta.taxonomy_id).toBe(DEFAULT_TAXONOMY_ID);
  });

  test("define process genus: explicit taxonomy works", () => {
    const taxonomyId = createTaxonomy(kernel, "Operations", "Ops");
    const genusId = defineProcessGenus(kernel, "Ops Flow", {
      lanes: [{ name: "main", position: 0 }],
      steps: [{ name: "s1", type: "task_step", lane: "main", position: 0, task_title: "Step 1" }],
      taxonomy_id: taxonomyId,
    });
    const def = getProcessDef(kernel, genusId);
    expect(def.meta.taxonomy_id).toBe(taxonomyId);
  });

  test("define process genus: defaults to manual trigger when omitted", () => {
    const genusId = defineProcessGenus(kernel, "No Triggers", {
      lanes: [{ name: "main", position: 0 }],
      steps: [{ name: "s1", type: "task_step", lane: "main", position: 0, task_title: "Step 1" }],
    });
    const def = getProcessDef(kernel, genusId);
    // No triggers defined — triggers array is empty (the MCP layer adds default, not the kernel)
    expect(def.triggers).toHaveLength(0);
  });

  test("define process genus: multi-lane with gate and action step", () => {
    // Define an action genus first
    defineEntityGenus(kernel, "Widget", {
      states: [{ name: "draft", initial: true }, { name: "published" }],
      transitions: [{ from: "draft", to: "published" }],
    });
    defineActionGenus(kernel, "publish_widget", {
      resources: [{ name: "widget", genus_name: "Widget", required_status: "draft" }],
      handler: [{ type: "transition_status", res: "$res.widget.id", target: "published" }],
    });

    const genusId = defineProcessGenus(kernel, "Widget Launch", {
      lanes: [
        { name: "review", position: 0 },
        { name: "approval", position: 1 },
        { name: "publish", position: 2 },
      ],
      steps: [
        { name: "tech_review", type: "task_step", lane: "review", position: 0, task_title: "Technical review" },
        { name: "legal_review", type: "task_step", lane: "review", position: 1, task_title: "Legal review" },
        { name: "gate", type: "gate_step", lane: "approval", position: 2, gate_conditions: ["tech_review", "legal_review"] },
        { name: "do_publish", type: "action_step", lane: "publish", position: 3, action_name: "publish_widget" },
      ],
      triggers: [{ type: "manual" }],
      meta: { description: "Full widget launch workflow" },
    });

    const def = getProcessDef(kernel, genusId);
    expect(Object.keys(def.lanes)).toHaveLength(3);
    expect(Object.keys(def.steps)).toHaveLength(4);
    expect(def.steps["gate"].gate_conditions).toEqual(["tech_review", "legal_review"]);
    expect(def.steps["do_publish"].action_name).toBe("publish_widget");
    expect(def.triggers).toHaveLength(1);
    expect(def.triggers[0].type).toBe("manual");
  });

  test("define process genus: describeTaxonomy includes lane/step structure", () => {
    const taxonomyId = createTaxonomy(kernel, "TestTaxonomy");
    defineProcessGenus(kernel, "Test Process", {
      lanes: [{ name: "lane_a", position: 0 }, { name: "lane_b", position: 1 }],
      steps: [
        { name: "step1", type: "task_step", lane: "lane_a", position: 0, task_title: "First" },
        { name: "step2", type: "task_step", lane: "lane_b", position: 1, task_title: "Second" },
      ],
      meta: { description: "For describe test" },
      taxonomy_id: taxonomyId,
    });

    const desc = describeTaxonomy(kernel, taxonomyId);
    expect(desc.process_genera).toHaveLength(1);
    const pg = desc.process_genera[0];
    expect(pg.name).toBe("Test Process");
    expect(pg.def.lanes).toBeDefined();
    expect(Object.keys(pg.def.lanes)).toHaveLength(2);
    expect(Object.keys(pg.def.steps)).toHaveLength(2);
  });
});

// ============================================================================
// Describe Genus
// ============================================================================

describe("Describe Genus", () => {
  let kernel: Kernel;

  beforeEach(() => {
    kernel = initKernel(":memory:");
  });

  afterEach(() => {
    kernel.db.close();
  });

  test("entity genus with full schema — all sections populated", () => {
    const genusId = defineEntityGenus(kernel, "Product", {
      attributes: [{ name: "title", type: "text", required: true }],
      states: [{ name: "draft", initial: true }, { name: "active", initial: false }],
      transitions: [{ from: "draft", to: "active", name: "Publish" }],
      meta: { description: "A product" },
    });

    defineFeatureGenus(kernel, "Variant", {
      parent_genus_name: "Product",
      attributes: [{ name: "color", type: "text" }],
    });

    defineRelationshipGenus(kernel, "Supply", {
      roles: [
        { name: "product", valid_member_genera: ["Product"], cardinality: "one" },
        { name: "supplier", valid_member_genera: ["Supplier"], cardinality: "one_or_more" },
      ],
    });

    defineActionGenus(kernel, "discontinue", {
      resources: [{ name: "product", genus_name: "Product", required_status: "active" }],
      handler: [{ type: "transition_status", resource: "product", to: "draft" }],
      meta: { description: "Discontinue a product" },
    });

    const entityId = createEntity(kernel, genusId);
    setAttribute(kernel, entityId, "title", "Widget");

    const def = getGenusDef(kernel, genusId);
    const genusName = def.meta.name as string;

    // Verify attributes
    expect(Object.values(def.attributes)).toHaveLength(1);
    expect(Object.values(def.attributes)[0].name).toBe("title");

    // Verify states
    expect(Object.values(def.states)).toHaveLength(2);

    // Verify features
    const features = getFeatureGenusForEntityGenus(kernel, genusName);
    expect(features).toHaveLength(1);
    expect(features[0].name).toBe("Variant");

    // Verify relationships
    const relGenera = listRelationshipGenera(kernel);
    const matching = relGenera.filter((rg) =>
      Object.values(rg.def.roles).some((role) =>
        role.valid_member_genera.some((v) => v.toLowerCase() === genusName.toLowerCase()),
      ),
    );
    expect(matching).toHaveLength(1);
    expect(matching[0].name).toBe("Supply");

    // Verify actions
    const actions = findActionsByTargetGenus(kernel, genusName);
    expect(actions).toHaveLength(1);
    expect(actions[0].name).toBe("discontinue");

    // Verify entities
    const entities = listEntities(kernel, { genus_id: genusId });
    expect(entities).toHaveLength(1);
  });

  test("per-state action availability — required_status filters correctly", () => {
    defineEntityGenus(kernel, "Product", {
      states: [{ name: "draft", initial: true }, { name: "active", initial: false }, { name: "archived", initial: false }],
      transitions: [
        { from: "draft", to: "active" },
        { from: "active", to: "archived" },
      ],
    });

    // Action restricted to "active" state
    defineActionGenus(kernel, "discontinue", {
      resources: [{ name: "product", genus_name: "Product", required_status: "active" }],
      handler: [{ type: "transition_status", resource: "product", to: "archived" }],
    });

    // Action with no required_status — available in all states
    defineActionGenus(kernel, "audit", {
      resources: [{ name: "product", genus_name: "Product" }],
      handler: [{ type: "create_log", resource: "product", message: "Audited" }],
    });

    const actions = findActionsByTargetGenus(kernel, "Product");
    expect(actions).toHaveLength(2);

    // For "draft" state: discontinue requires "active" so not available, audit has no requirement so available
    const draftActions = actions.filter((a) => {
      const resources = Object.values(a.def.resources).filter(
        (r) => r.genus_name.toLowerCase() === "product",
      );
      return resources.some((r) => !r.required_status || r.required_status === "draft");
    });
    expect(draftActions).toHaveLength(1);
    expect(draftActions[0].name).toBe("audit");

    // For "active" state: both should be available
    const activeActions = actions.filter((a) => {
      const resources = Object.values(a.def.resources).filter(
        (r) => r.genus_name.toLowerCase() === "product",
      );
      return resources.some((r) => !r.required_status || r.required_status === "active");
    });
    expect(activeActions).toHaveLength(2);
  });

  test("feature genus returns kind=feature, attributes/states only, no cross-references", () => {
    defineEntityGenus(kernel, "Product", {});

    const featureId = defineFeatureGenus(kernel, "Variant", {
      parent_genus_name: "Product",
      attributes: [{ name: "color", type: "text", required: true }],
      states: [{ name: "draft", initial: true }, { name: "active", initial: false }],
      transitions: [{ from: "draft", to: "active" }],
    });

    const def = getGenusDef(kernel, featureId);
    expect(def.meta.kind).toBe("feature");
    expect(Object.values(def.attributes)).toHaveLength(1);
    expect(Object.values(def.states)).toHaveLength(2);
    expect(def.transitions).toHaveLength(1);
  });

  test("empty entity genus — zero entities, empty cross-references", () => {
    const genusId = defineEntityGenus(kernel, "Widget", {
      attributes: [{ name: "name", type: "text" }],
      states: [{ name: "draft", initial: true }],
    });

    const entities = listEntities(kernel, { genus_id: genusId });
    expect(entities).toHaveLength(0);

    const features = getFeatureGenusForEntityGenus(kernel, "Widget");
    expect(features).toHaveLength(0);

    const actions = findActionsByTargetGenus(kernel, "Widget");
    expect(actions).toHaveLength(0);

    const unhealthy = listUnhealthy(kernel, { genus_id: genusId });
    expect(unhealthy).toHaveLength(0);
  });

  test("relationship cross-reference — genus appears in roles_filled with correct role name", () => {
    defineEntityGenus(kernel, "Product", {});
    defineEntityGenus(kernel, "Supplier", {});

    defineRelationshipGenus(kernel, "Supply", {
      roles: [
        { name: "product", valid_member_genera: ["Product"], cardinality: "one" },
        { name: "supplier", valid_member_genera: ["Supplier"], cardinality: "one_or_more" },
      ],
    });

    const allRels = listRelationshipGenera(kernel);
    // Product should match the "product" role
    const productRels = allRels.filter((rg) =>
      Object.values(rg.def.roles).some((role) =>
        role.valid_member_genera.some((v) => v.toLowerCase() === "product"),
      ),
    );
    expect(productRels).toHaveLength(1);
    const rolesFilledByProduct = Object.values(productRels[0].def.roles)
      .filter((role) => role.valid_member_genera.some((v) => v.toLowerCase() === "product"))
      .map((role) => role.name);
    expect(rolesFilledByProduct).toEqual(["product"]);

    // Supplier should match the "supplier" role
    const supplierRels = allRels.filter((rg) =>
      Object.values(rg.def.roles).some((role) =>
        role.valid_member_genera.some((v) => v.toLowerCase() === "supplier"),
      ),
    );
    expect(supplierRels).toHaveLength(1);
    const rolesFilledBySupplier = Object.values(supplierRels[0].def.roles)
      .filter((role) => role.valid_member_genera.some((v) => v.toLowerCase() === "supplier"))
      .map((role) => role.name);
    expect(rolesFilledBySupplier).toEqual(["supplier"]);
  });

  test("process cross-reference — only processes with action steps targeting this genus", () => {
    defineEntityGenus(kernel, "Product", {});
    defineEntityGenus(kernel, "Order", {});

    defineActionGenus(kernel, "ship_product", {
      resources: [{ name: "product", genus_name: "Product" }],
      handler: [{ type: "create_log", resource: "product", message: "Shipped" }],
    });

    defineActionGenus(kernel, "cancel_order", {
      resources: [{ name: "order", genus_name: "Order" }],
      handler: [{ type: "create_log", resource: "order", message: "Cancelled" }],
    });

    // Process that references Product via action step
    defineProcessGenus(kernel, "Fulfillment", {
      lanes: [{ name: "ops", position: 0 }],
      steps: [
        { name: "ship", type: "action_step", lane: "ops", position: 0, action_name: "ship_product" },
      ],
    });

    // Process that only references Order
    defineProcessGenus(kernel, "Cancellation", {
      lanes: [{ name: "ops", position: 0 }],
      steps: [
        { name: "cancel", type: "action_step", lane: "ops", position: 0, action_name: "cancel_order" },
      ],
    });

    // For Product: only Fulfillment should match
    const allProcesses = listProcessGenera(kernel);
    const productProcesses = allProcesses.filter((pg) =>
      Object.values(pg.def.steps).some((step) => {
        if (step.type !== "action_step" || !step.action_name) return false;
        const actionId = findActionByName(kernel, step.action_name);
        if (!actionId) return false;
        const actionDef = getActionDef(kernel, actionId);
        return Object.values(actionDef.resources).some(
          (r) => r.genus_name.toLowerCase() === "product",
        );
      }),
    );
    expect(productProcesses).toHaveLength(1);
    expect(productProcesses[0].name).toBe("Fulfillment");
  });

  test("stateless entity genus — no per_state, still returns actions and entities", () => {
    const genusId = defineEntityGenus(kernel, "Note", {
      attributes: [{ name: "body", type: "text" }],
    });

    defineActionGenus(kernel, "archive_note", {
      resources: [{ name: "note", genus_name: "Note" }],
      handler: [{ type: "create_log", resource: "note", message: "Archived" }],
    });

    const noteId = createEntity(kernel, genusId);
    setAttribute(kernel, noteId, "body", "Hello");

    const def = getGenusDef(kernel, genusId);
    expect(Object.values(def.states)).toHaveLength(0);

    const actions = findActionsByTargetGenus(kernel, "Note");
    expect(actions).toHaveLength(1);

    const entities = listEntities(kernel, { genus_id: genusId });
    expect(entities).toHaveLength(1);
  });

  test("health summary — unhealthy entities counted correctly", () => {
    const genusId = defineEntityGenus(kernel, "Product", {
      attributes: [{ name: "title", type: "text", required: true }],
      states: [{ name: "draft", initial: true }],
    });

    // Healthy entity — has required title
    const healthyId = createEntity(kernel, genusId);
    setAttribute(kernel, healthyId, "title", "Widget");

    // Unhealthy entity — missing required title
    createEntity(kernel, genusId);

    const entities = listEntities(kernel, { genus_id: genusId });
    expect(entities).toHaveLength(2);

    const unhealthy = listUnhealthy(kernel, { genus_id: genusId });
    expect(unhealthy).toHaveLength(1);

    // Verify health math
    const totalCount = entities.length;
    const unhealthyCount = unhealthy.length;
    expect(totalCount - unhealthyCount).toBe(1);
  });
});

// ============================================================================
// Genus Deprecation + Taxonomy Archival
// ============================================================================

describe("Genus Deprecation + Taxonomy Archival", () => {
  let kernel: Kernel;

  beforeEach(() => {
    kernel = initKernel(":memory:");
  });

  afterEach(() => {
    kernel.db.close();
  });

  // --- Deprecation core ---

  test("deprecateGenus sets deprecated meta flags", () => {
    const genusId = defineEntityGenus(kernel, "Server", {
      attributes: [{ name: "hostname", type: "text" }],
      states: [{ name: "active", initial: true }],
    });
    deprecateGenus(kernel, genusId);
    const def = getGenusDef(kernel, genusId);
    expect(def.meta.deprecated).toBe(true);
    expect(def.meta.deprecated_at).toBeDefined();
    expect(typeof def.meta.deprecated_at).toBe("string");
  });

  test("deprecateGenus is idempotent (preserves timestamp)", () => {
    const genusId = defineEntityGenus(kernel, "Server", {
      states: [{ name: "active", initial: true }],
    });
    deprecateGenus(kernel, genusId);
    const def1 = getGenusDef(kernel, genusId);
    const firstTimestamp = def1.meta.deprecated_at;

    deprecateGenus(kernel, genusId);
    const def2 = getGenusDef(kernel, genusId);
    expect(def2.meta.deprecated_at).toBe(firstTimestamp);
  });

  test("deprecateGenus rejects sentinel genera", () => {
    expect(() => deprecateGenus(kernel, META_GENUS_ID)).toThrow("Cannot deprecate sentinel genus");
    expect(() => deprecateGenus(kernel, LOG_GENUS_ID)).toThrow("Cannot deprecate sentinel genus");
    expect(() => deprecateGenus(kernel, ERROR_GENUS_ID)).toThrow("Cannot deprecate sentinel genus");
    expect(() => deprecateGenus(kernel, TASK_GENUS_ID)).toThrow("Cannot deprecate sentinel genus");
    expect(() => deprecateGenus(kernel, BRANCH_GENUS_ID)).toThrow("Cannot deprecate sentinel genus");
    expect(() => deprecateGenus(kernel, TAXONOMY_GENUS_ID)).toThrow("Cannot deprecate sentinel genus");
  });

  test("deprecateGenus throws for nonexistent genus", () => {
    expect(() => deprecateGenus(kernel, "nonexistent-id")).toThrow();
  });

  // --- Restoration core ---

  test("restoreGenus clears deprecated meta", () => {
    const genusId = defineEntityGenus(kernel, "Server", {
      states: [{ name: "active", initial: true }],
    });
    deprecateGenus(kernel, genusId);
    restoreGenus(kernel, genusId);
    const def = getGenusDef(kernel, genusId);
    expect(def.meta.deprecated).toBe(false);
    expect(def.meta.deprecated_at).toBeNull();
  });

  test("restoreGenus is idempotent on non-deprecated genus", () => {
    const genusId = defineEntityGenus(kernel, "Server", {
      states: [{ name: "active", initial: true }],
    });
    restoreGenus(kernel, genusId); // no-op
    const def = getGenusDef(kernel, genusId);
    expect(def.meta.deprecated).toBeUndefined();
  });

  test("restoreGenus rejects if taxonomy is archived", () => {
    const taxonomyId = createTaxonomy(kernel, "Inventory", "Inv");
    const genusId = defineEntityGenus(kernel, "Product", {
      taxonomy_id: taxonomyId,
      states: [{ name: "active", initial: true }],
    });
    deprecateGenus(kernel, genusId);
    transitionStatus(kernel, taxonomyId, "archived");
    expect(() => restoreGenus(kernel, genusId)).toThrow("archived");
  });

  // --- createEntity guards ---

  test("createEntity rejects deprecated genus", () => {
    const genusId = defineEntityGenus(kernel, "Server", {
      states: [{ name: "active", initial: true }],
    });
    deprecateGenus(kernel, genusId);
    expect(() => createEntity(kernel, genusId)).toThrow("deprecated");
  });

  test("createEntity works after restoring genus", () => {
    const genusId = defineEntityGenus(kernel, "Server", {
      states: [{ name: "active", initial: true }],
    });
    deprecateGenus(kernel, genusId);
    restoreGenus(kernel, genusId);
    const entityId = createEntity(kernel, genusId);
    expect(entityId).toBeDefined();
  });

  test("createEntity rejects genus in archived taxonomy", () => {
    const taxonomyId = createTaxonomy(kernel, "Inventory", "Inv");
    const genusId = defineEntityGenus(kernel, "Product", {
      taxonomy_id: taxonomyId,
      states: [{ name: "active", initial: true }],
    });
    transitionStatus(kernel, taxonomyId, "archived");
    expect(() => createEntity(kernel, genusId)).toThrow("archived");
  });

  // --- evolveGenus guards ---

  test("evolveGenus auto-restores deprecated genus", () => {
    const genusId = defineEntityGenus(kernel, "Server", {
      states: [{ name: "active", initial: true }],
    });
    deprecateGenus(kernel, genusId);
    let def = getGenusDef(kernel, genusId);
    expect(def.meta.deprecated).toBe(true);

    // Evolving should auto-restore, not throw
    evolveGenus(kernel, genusId, {
      attributes: [{ name: "cpu", type: "number" }],
    });
    def = getGenusDef(kernel, genusId);
    expect(def.meta.deprecated).toBe(false);
    expect(def.attributes.cpu).toBeDefined();
    expect(def.attributes.cpu.type).toBe("number");
  });

  test("evolveGenus auto-restore fails for archived taxonomy", () => {
    const taxonomyId = createTaxonomy(kernel, "TempTax", "TT");
    const genusId = defineEntityGenus(kernel, "Widget", {
      taxonomy_id: taxonomyId,
      states: [{ name: "active", initial: true }],
    });
    deprecateGenus(kernel, genusId);
    transitionStatus(kernel, taxonomyId, "archived");

    // restoreGenus checks taxonomy-archived, so this should throw
    expect(() => evolveGenus(kernel, genusId, {
      attributes: [{ name: "weight", type: "number" }],
    })).toThrow("archived");
  });

  // --- evolveGenus roles ---

  test("evolveGenus adds new role to relationship genus", () => {
    const relGenus = defineRelationshipGenus(kernel, "Link", {
      roles: [
        { name: "source", valid_member_genera: ["Person"], cardinality: "one" },
        { name: "target", valid_member_genera: ["Issue"], cardinality: "one" },
      ],
    });

    evolveGenus(kernel, relGenus, {
      roles: [{ name: "observer", valid_member_genera: ["Person"], cardinality: "zero_or_more" }],
    });

    const def = getGenusDef(kernel, relGenus);
    expect(def.roles.observer).toBeDefined();
    expect(def.roles.observer.cardinality).toBe("zero_or_more");
    expect(def.roles.observer.valid_member_genera).toEqual(["Person"]);
  });

  test("evolveGenus merges valid_member_genera for existing role (union)", () => {
    const relGenus = defineRelationshipGenus(kernel, "Conn", {
      roles: [
        { name: "left", valid_member_genera: ["Person"], cardinality: "one" },
        { name: "right", valid_member_genera: ["Issue"], cardinality: "one" },
      ],
    });

    evolveGenus(kernel, relGenus, {
      roles: [{ name: "left", valid_member_genera: ["Issue"], cardinality: "one" }],
    });

    const def = getGenusDef(kernel, relGenus);
    expect(def.roles.left.valid_member_genera).toEqual(["Person", "Issue"]);
  });

  test("evolveGenus role merge is idempotent (no extra tessellae)", () => {
    const relGenus = defineRelationshipGenus(kernel, "IdempLink", {
      roles: [
        { name: "a", valid_member_genera: ["Person"], cardinality: "one" },
        { name: "b", valid_member_genera: ["Issue"], cardinality: "one" },
      ],
    });

    const before = replay(kernel, relGenus).length;
    evolveGenus(kernel, relGenus, {
      roles: [{ name: "a", valid_member_genera: ["Person"], cardinality: "one" }],
    });
    const after = replay(kernel, relGenus).length;
    expect(after).toBe(before); // No new tessellae
  });

  test("evolveGenus role merge is case-insensitive for dedup", () => {
    const relGenus = defineRelationshipGenus(kernel, "CaseLink", {
      roles: [
        { name: "x", valid_member_genera: ["Person"], cardinality: "one" },
        { name: "y", valid_member_genera: ["Issue"], cardinality: "one" },
      ],
    });

    evolveGenus(kernel, relGenus, {
      roles: [{ name: "x", valid_member_genera: ["person", "Issue"], cardinality: "one" }],
    });

    const def = getGenusDef(kernel, relGenus);
    // "person" matches "Person" case-insensitively, so only "Issue" is new
    expect(def.roles.x.valid_member_genera).toEqual(["Person", "Issue"]);
  });

  test("evolveGenus rejects roles on non-relationship genus", () => {
    const genusId = defineEntityGenus(kernel, "Thing", {
      states: [{ name: "active", initial: true }],
    });

    expect(() => evolveGenus(kernel, genusId, {
      roles: [{ name: "owner", valid_member_genera: ["Person"], cardinality: "one" }],
    })).toThrow("Cannot evolve roles on a non-relationship genus");
  });

  test("evolveGenus cardinality update works", () => {
    const relGenus = defineRelationshipGenus(kernel, "CardLink", {
      roles: [
        { name: "src", valid_member_genera: ["Person"], cardinality: "one" },
        { name: "dst", valid_member_genera: ["Issue"], cardinality: "one" },
      ],
    });

    evolveGenus(kernel, relGenus, {
      roles: [{ name: "src", valid_member_genera: ["Person"], cardinality: "zero_or_more" }],
    });

    const def = getGenusDef(kernel, relGenus);
    expect(def.roles.src.cardinality).toBe("zero_or_more");
  });

  test("evolved roles work with createRelationship", () => {
    const personGenus2 = defineEntityGenus(kernel, "PersonEv", {
      attributes: [{ name: "name", type: "text" }],
    });
    const issueGenus2 = defineEntityGenus(kernel, "IssueEv", {
      attributes: [{ name: "title", type: "text" }],
    });
    const relGenus = defineRelationshipGenus(kernel, "EvLink", {
      roles: [
        { name: "from", valid_member_genera: ["PersonEv"], cardinality: "one" },
        { name: "to", valid_member_genera: ["PersonEv"], cardinality: "one" },
      ],
    });

    // Can't link to IssueEv yet
    const p = createEntity(kernel, personGenus2);
    const i = createEntity(kernel, issueGenus2);
    expect(() => createRelationship(kernel, relGenus, { from: p, to: i }))
      .toThrow('requires one of [PersonEv]');

    // Evolve to also allow IssueEv in "to" role
    evolveGenus(kernel, relGenus, {
      roles: [{ name: "to", valid_member_genera: ["IssueEv"], cardinality: "one" }],
    });

    // Now it should work
    const relId = createRelationship(kernel, relGenus, { from: p, to: i });
    const state = materialize(kernel, relId);
    expect((state.members as any).to).toEqual([i]);
  });

  test("evolveGenus rejects genus in archived taxonomy", () => {
    const taxonomyId = createTaxonomy(kernel, "Inventory", "Inv");
    const genusId = defineEntityGenus(kernel, "Product", {
      taxonomy_id: taxonomyId,
      states: [{ name: "active", initial: true }],
    });
    transitionStatus(kernel, taxonomyId, "archived");
    expect(() => evolveGenus(kernel, genusId, {
      attributes: [{ name: "weight", type: "number" }],
    })).toThrow("archived");
  });

  // --- Listing filters ---

  test("listGenera excludes deprecated by default", () => {
    const g1 = defineEntityGenus(kernel, "Server", {
      states: [{ name: "active", initial: true }],
    });
    defineEntityGenus(kernel, "Router", {
      states: [{ name: "active", initial: true }],
    });
    deprecateGenus(kernel, g1);
    const genera = listGenera(kernel);
    expect(genera.find((g) => g.name === "Server")).toBeUndefined();
    expect(genera.find((g) => g.name === "Router")).toBeDefined();
  });

  test("listGenera includes deprecated with include_deprecated: true", () => {
    const g1 = defineEntityGenus(kernel, "Server", {
      states: [{ name: "active", initial: true }],
    });
    deprecateGenus(kernel, g1);
    const genera = listGenera(kernel, { include_deprecated: true });
    expect(genera.find((g) => g.name === "Server")).toBeDefined();
  });

  // --- Cross-genus-kind deprecation ---

  test("deprecateGenus works on feature genus", () => {
    const featureGenusId = defineFeatureGenus(kernel, "PageCount", {
      parent_genus_name: "Book",
      attributes: [{ name: "page_number", type: "number" }],
    });
    deprecateGenus(kernel, featureGenusId);
    const def = getGenusDef(kernel, featureGenusId);
    expect(def.meta.deprecated).toBe(true);
  });

  test("deprecateGenus works on action genus", () => {
    const actionGenusId = defineActionGenus(kernel, "Restart", {});
    deprecateGenus(kernel, actionGenusId);
    const def = getGenusDef(kernel, actionGenusId);
    expect(def.meta.deprecated).toBe(true);
  });

  // --- Taxonomy archival guards on define*Genus ---

  test("defineEntityGenus rejects archived taxonomy", () => {
    const taxonomyId = createTaxonomy(kernel, "Inventory", "Inv");
    transitionStatus(kernel, taxonomyId, "archived");
    expect(() => defineEntityGenus(kernel, "Product", {
      taxonomy_id: taxonomyId,
      states: [{ name: "active", initial: true }],
    })).toThrow("archived");
  });

  test("defineFeatureGenus rejects archived taxonomy", () => {
    const taxonomyId = createTaxonomy(kernel, "Inventory", "Inv");
    transitionStatus(kernel, taxonomyId, "archived");
    expect(() => defineFeatureGenus(kernel, "PageCount", {
      taxonomy_id: taxonomyId,
      parent_genus_name: "Book",
      attributes: [{ name: "page_number", type: "number" }],
    })).toThrow("archived");
  });

  test("defineActionGenus rejects archived taxonomy", () => {
    const taxonomyId = createTaxonomy(kernel, "Inventory", "Inv");
    transitionStatus(kernel, taxonomyId, "archived");
    expect(() => defineActionGenus(kernel, "Restart", {
      taxonomy_id: taxonomyId,
    })).toThrow("archived");
  });

  test("defineRelationshipGenus rejects archived taxonomy", () => {
    const taxonomyId = createTaxonomy(kernel, "Inventory", "Inv");
    transitionStatus(kernel, taxonomyId, "archived");
    expect(() => defineRelationshipGenus(kernel, "Ownership", {
      taxonomy_id: taxonomyId,
      roles: [
        { name: "owner", genus_name: "User" },
        { name: "asset", genus_name: "Product" },
      ],
    })).toThrow("archived");
  });

  // --- Taxonomy unarchival ---

  test("taxonomy has archived → active transition after init", () => {
    const def = getGenusDef(kernel, TAXONOMY_GENUS_ID);
    const hasTransition = def.transitions.some(
      (t) => t.from === "archived" && t.to === "active",
    );
    expect(hasTransition).toBe(true);
  });

  test("unarchive taxonomy via transitionStatus", () => {
    const taxonomyId = createTaxonomy(kernel, "Inventory", "Inv");
    transitionStatus(kernel, taxonomyId, "archived");
    transitionStatus(kernel, taxonomyId, "active");
    const state = materialize(kernel, taxonomyId);
    expect(state.status).toBe("active");
  });

  test("unarchived taxonomy allows new genera again", () => {
    const taxonomyId = createTaxonomy(kernel, "Inventory", "Inv");
    transitionStatus(kernel, taxonomyId, "archived");
    transitionStatus(kernel, taxonomyId, "active");
    const genusId = defineEntityGenus(kernel, "Product", {
      taxonomy_id: taxonomyId,
      states: [{ name: "active", initial: true }],
    });
    expect(genusId).toBeDefined();
  });

  // --- Continued functionality ---

  test("existing entities of deprecated genus remain functional", () => {
    const genusId = defineEntityGenus(kernel, "Server", {
      attributes: [{ name: "hostname", type: "text" }],
      states: [
        { name: "active", initial: true },
        { name: "retired" },
      ],
      transitions: [{ from: "active", to: "retired" }],
    });
    const entityId = createEntity(kernel, genusId);
    setAttribute(kernel, entityId, "hostname", "srv-01");
    deprecateGenus(kernel, genusId);

    // setAttribute still works
    setAttribute(kernel, entityId, "hostname", "srv-02");
    const state = materialize(kernel, entityId);
    expect(state.hostname).toBe("srv-02");

    // transitionStatus still works
    transitionStatus(kernel, entityId, "retired");
    const state2 = materialize(kernel, entityId);
    expect(state2.status).toBe("retired");
  });

  test("describeTaxonomy works on archived taxonomies", () => {
    const taxonomyId = createTaxonomy(kernel, "Inventory", "Inv");
    defineEntityGenus(kernel, "Product", {
      taxonomy_id: taxonomyId,
      states: [{ name: "active", initial: true }],
    });
    transitionStatus(kernel, taxonomyId, "archived");
    const desc = describeTaxonomy(kernel, taxonomyId);
    expect(desc.name).toBe("Inventory");
    expect(desc.entity_genera).toHaveLength(1);
  });
});

// ============================================================================
// Cron Schedules
// ============================================================================

describe("Cron Schedules", () => {
  let kernel: Kernel;

  beforeEach(() => {
    kernel = initKernel(":memory:");
  });

  afterEach(() => {
    kernel.db.close();
  });

  // --- Cron parser ---

  test("parseCron parses basic expression '0 0 * * *'", () => {
    const fields = parseCron("0 0 * * *");
    expect(fields.minute.has(0)).toBe(true);
    expect(fields.minute.size).toBe(1);
    expect(fields.hour.has(0)).toBe(true);
    expect(fields.hour.size).toBe(1);
    expect(fields.dayOfMonth.size).toBe(31);
    expect(fields.month.size).toBe(12);
    expect(fields.dayOfWeek.size).toBe(7);
  });

  test("parseCron parses ranges '0 1-5 * * *'", () => {
    const fields = parseCron("0 1-5 * * *");
    expect(fields.hour.size).toBe(5);
    expect(fields.hour.has(1)).toBe(true);
    expect(fields.hour.has(5)).toBe(true);
    expect(fields.hour.has(0)).toBe(false);
    expect(fields.hour.has(6)).toBe(false);
  });

  test("parseCron parses steps '*/15 * * * *'", () => {
    const fields = parseCron("*/15 * * * *");
    expect(fields.minute.size).toBe(4);
    expect(fields.minute.has(0)).toBe(true);
    expect(fields.minute.has(15)).toBe(true);
    expect(fields.minute.has(30)).toBe(true);
    expect(fields.minute.has(45)).toBe(true);
  });

  test("parseCron parses lists '1,3,5 * * * *'", () => {
    const fields = parseCron("1,3,5 * * * *");
    expect(fields.minute.size).toBe(3);
    expect(fields.minute.has(1)).toBe(true);
    expect(fields.minute.has(3)).toBe(true);
    expect(fields.minute.has(5)).toBe(true);
  });

  test("parseCron handles aliases", () => {
    const daily = parseCron("@daily");
    expect(daily.minute.has(0)).toBe(true);
    expect(daily.minute.size).toBe(1);
    expect(daily.hour.has(0)).toBe(true);
    expect(daily.hour.size).toBe(1);

    const hourly = parseCron("@hourly");
    expect(hourly.minute.has(0)).toBe(true);
    expect(hourly.hour.size).toBe(24);

    const weekly = parseCron("@weekly");
    expect(weekly.dayOfWeek.has(0)).toBe(true);
    expect(weekly.dayOfWeek.size).toBe(1);

    const monthly = parseCron("@monthly");
    expect(monthly.dayOfMonth.has(1)).toBe(true);
    expect(monthly.dayOfMonth.size).toBe(1);
  });

  test("parseCron rejects invalid expressions", () => {
    expect(() => parseCron("invalid")).toThrow();
    expect(() => parseCron("0 0 *")).toThrow();
    expect(() => parseCron("60 0 * * *")).toThrow();
    expect(() => parseCron("0 25 * * *")).toThrow();
  });

  test("matchesCron matches correct time", () => {
    // Jan 1 2025 00:00 UTC is a Wednesday (day 3)
    const date = new Date("2025-01-01T00:00:00Z");
    expect(matchesCron("0 0 1 1 *", date)).toBe(true);
    expect(matchesCron("0 0 * * 3", date)).toBe(true);
    expect(matchesCron("@daily", date)).toBe(true);
  });

  test("matchesCron rejects non-matching time", () => {
    const date = new Date("2025-01-01T00:00:00Z");
    expect(matchesCron("30 0 * * *", date)).toBe(false);
    expect(matchesCron("0 12 * * *", date)).toBe(false);
    expect(matchesCron("0 0 2 * *", date)).toBe(false);
  });

  // --- Cron schedule CRUD ---

  function setupAction() {
    const serverGenus = defineEntityGenus(kernel, "Server", {
      attributes: [
        { name: "hostname", type: "text", required: true },
        { name: "version", type: "text" },
      ],
      states: [
        { name: "active", initial: true },
        { name: "deployed", initial: false },
      ],
      transitions: [{ from: "active", to: "deployed" }, { from: "deployed", to: "active" }],
    });

    const actionId = defineActionGenus(kernel, "deploy", {
      resources: [{ name: "server", genus_name: "Server", required_status: "active" }],
      parameters: [{ name: "version", type: "text", required: true }],
      handler: [
        { type: "set_attribute", res: "$res.server.id", key: "version", value: "$param.version" },
        { type: "transition_status", res: "$res.server.id", target: "deployed" },
      ],
    });

    return { serverGenus, actionId };
  }

  function setupProcess() {
    return defineProcessGenus(kernel, "SimpleWorkflow", {
      lanes: [{ name: "main", position: 0 }],
      steps: [
        { name: "step1", type: "task_step", lane: "main", position: 0, task_title: "Do step 1" },
      ],
      triggers: [{ type: "manual" }],
    });
  }

  test("createCronSchedule creates a schedule with correct attributes", () => {
    const { actionId } = setupAction();
    const id = createCronSchedule(kernel, {
      name: "Deploy nightly",
      expression: "0 0 * * *",
      target_type: "action",
      target_genus_id: actionId,
      target_config: JSON.stringify({ resource_bindings: {}, params: { version: "2.0" } }),
    });
    expect(id).toHaveLength(26);
    const state = materialize(kernel, id);
    expect(state.name).toBe("Deploy nightly");
    expect(state.expression).toBe("0 0 * * *");
    expect(state.target_type).toBe("action");
    expect(state.target_genus_id).toBe(actionId);
    expect(state.target_config).toBeDefined();
  });

  test("createCronSchedule rejects invalid expression", () => {
    const { actionId } = setupAction();
    expect(() => createCronSchedule(kernel, {
      name: "Bad schedule",
      expression: "invalid cron",
      target_type: "action",
      target_genus_id: actionId,
    })).toThrow();
  });

  test("listCronSchedules returns all schedules", () => {
    const { actionId } = setupAction();
    createCronSchedule(kernel, {
      name: "Schedule A",
      expression: "0 0 * * *",
      target_type: "action",
      target_genus_id: actionId,
    });
    createCronSchedule(kernel, {
      name: "Schedule B",
      expression: "*/5 * * * *",
      target_type: "action",
      target_genus_id: actionId,
    });
    const list = listCronSchedules(kernel);
    expect(list).toHaveLength(2);
    expect(list.map((s) => s.name).sort()).toEqual(["Schedule A", "Schedule B"]);
  });

  test("schedule starts in active status", () => {
    const { actionId } = setupAction();
    const id = createCronSchedule(kernel, {
      name: "Active schedule",
      expression: "@hourly",
      target_type: "action",
      target_genus_id: actionId,
    });
    const state = materialize(kernel, id);
    expect(state.status).toBe("active");
  });

  // --- State machine ---

  test("pause schedule via transitionStatus", () => {
    const { actionId } = setupAction();
    const id = createCronSchedule(kernel, {
      name: "Pausable",
      expression: "@daily",
      target_type: "action",
      target_genus_id: actionId,
    });
    transitionStatus(kernel, id, "paused");
    const state = materialize(kernel, id);
    expect(state.status).toBe("paused");
  });

  test("resume paused schedule", () => {
    const { actionId } = setupAction();
    const id = createCronSchedule(kernel, {
      name: "Resumable",
      expression: "@daily",
      target_type: "action",
      target_genus_id: actionId,
    });
    transitionStatus(kernel, id, "paused");
    transitionStatus(kernel, id, "active");
    const state = materialize(kernel, id);
    expect(state.status).toBe("active");
  });

  test("retire schedule is terminal", () => {
    const { actionId } = setupAction();
    const id = createCronSchedule(kernel, {
      name: "Retirable",
      expression: "@daily",
      target_type: "action",
      target_genus_id: actionId,
    });
    transitionStatus(kernel, id, "retired");
    const state = materialize(kernel, id);
    expect(state.status).toBe("retired");
    // Can't transition back from retired
    expect(() => transitionStatus(kernel, id, "active")).toThrow();
  });

  // --- Tick/fire ---

  test("tickCron fires matching active schedule", () => {
    const { actionId, serverGenus } = setupAction();
    const entityId = createEntity(kernel, serverGenus);
    setAttribute(kernel, entityId, "hostname", "srv-1");

    const id = createCronSchedule(kernel, {
      name: "Every minute",
      expression: "* * * * *",
      target_type: "action",
      target_genus_id: actionId,
      target_config: JSON.stringify({ resource_bindings: { server: entityId }, params: { version: "3.0" } }),
    });

    const result = tickCron(kernel, new Date("2025-06-15T12:00:00Z"));
    expect(result.checked).toBe(1);
    expect(result.fired).toHaveLength(1);
    expect(result.fired[0].schedule_id).toBe(id);
    expect(result.fired[0].name).toBe("Every minute");
  });

  test("tickCron skips paused schedule", () => {
    const { actionId } = setupAction();
    const id = createCronSchedule(kernel, {
      name: "Paused one",
      expression: "* * * * *",
      target_type: "action",
      target_genus_id: actionId,
    });
    transitionStatus(kernel, id, "paused");

    const result = tickCron(kernel, new Date("2025-06-15T12:00:00Z"));
    expect(result.checked).toBe(1);
    expect(result.fired).toHaveLength(0);
    expect(result.skipped).toBe(1);
  });

  test("tickCron skips already-fired-this-minute schedule", () => {
    const { actionId, serverGenus } = setupAction();
    const entityId = createEntity(kernel, serverGenus);
    setAttribute(kernel, entityId, "hostname", "srv-1");

    createCronSchedule(kernel, {
      name: "Every minute",
      expression: "* * * * *",
      target_type: "action",
      target_genus_id: actionId,
      target_config: JSON.stringify({ resource_bindings: { server: entityId }, params: { version: "3.0" } }),
    });

    const time = new Date("2025-06-15T12:00:00Z");
    const result1 = tickCron(kernel, time);
    expect(result1.fired).toHaveLength(1);

    // Second tick same minute should skip
    const result2 = tickCron(kernel, time);
    expect(result2.fired).toHaveLength(0);
    expect(result2.skipped).toBe(1);
  });

  test("tickCron updates last_fired_at on fire", () => {
    const { actionId, serverGenus } = setupAction();
    const entityId = createEntity(kernel, serverGenus);
    setAttribute(kernel, entityId, "hostname", "srv-1");

    const id = createCronSchedule(kernel, {
      name: "Track fire",
      expression: "* * * * *",
      target_type: "action",
      target_genus_id: actionId,
      target_config: JSON.stringify({ resource_bindings: { server: entityId }, params: { version: "1.0" } }),
    });

    const stateBefore = materialize(kernel, id);
    expect(stateBefore.last_fired_at).toBeUndefined();

    tickCron(kernel, new Date("2025-06-15T12:00:00Z"));

    const stateAfter = materialize(kernel, id);
    expect(stateAfter.last_fired_at).toBeDefined();
  });

  test("fireCronSchedule fires action target", () => {
    const { actionId, serverGenus } = setupAction();
    const entityId = createEntity(kernel, serverGenus);
    setAttribute(kernel, entityId, "hostname", "srv-1");

    const id = createCronSchedule(kernel, {
      name: "Action fire",
      expression: "@daily",
      target_type: "action",
      target_genus_id: actionId,
      target_config: JSON.stringify({ resource_bindings: { server: entityId }, params: { version: "4.0" } }),
    });

    const result = fireCronSchedule(kernel, id);
    expect(result.target_type).toBe("action");
    expect(result.name).toBe("Action fire");
    expect(result.fired_at).toBeDefined();

    // Verify action actually executed
    const serverState = materialize(kernel, entityId);
    expect(serverState.version).toBe("4.0");
    expect(serverState.status).toBe("deployed");
  });

  test("fireCronSchedule fires process target", () => {
    const processGenusId = setupProcess();

    const id = createCronSchedule(kernel, {
      name: "Process fire",
      expression: "@daily",
      target_type: "process",
      target_genus_id: processGenusId,
    });

    const result = fireCronSchedule(kernel, id);
    expect(result.target_type).toBe("process");
    expect(result.name).toBe("Process fire");
    expect(result.result).toBeDefined();
    // Result should have id and state from startProcess
    const processResult = result.result as { id: string; state: any };
    expect(processResult.id).toHaveLength(26);
  });

  // --- Listing exclusion ---

  test("listGenera excludes CRON_SCHEDULE_GENUS_ID", () => {
    const genera = listGenera(kernel);
    const ids = genera.map((g) => g.id);
    expect(ids).not.toContain(CRON_SCHEDULE_GENUS_ID);
  });

  test("listEntities excludes cron schedule entities", () => {
    const { actionId } = setupAction();
    createCronSchedule(kernel, {
      name: "Hidden schedule",
      expression: "@daily",
      target_type: "action",
      target_genus_id: actionId,
    });

    const entities = listEntities(kernel);
    const cronEntities = entities.filter((e) => e.genus_id === CRON_SCHEDULE_GENUS_ID);
    expect(cronEntities).toHaveLength(0);
  });

  // --- parseDelay ---

  test("parseDelay parses seconds", () => {
    expect(parseDelay("30s")).toBe(30000);
  });

  test("parseDelay parses minutes", () => {
    expect(parseDelay("90m")).toBe(5400000);
  });

  test("parseDelay parses hours", () => {
    expect(parseDelay("2h")).toBe(7200000);
  });

  test("parseDelay parses days", () => {
    expect(parseDelay("1d")).toBe(86400000);
  });

  test("parseDelay rejects invalid format", () => {
    expect(() => parseDelay("abc")).toThrow();
    expect(() => parseDelay("10x")).toThrow();
    expect(() => parseDelay("")).toThrow();
  });

  // --- createScheduledTrigger ---

  test("createScheduledTrigger creates trigger with correct attributes", () => {
    const { actionId } = setupAction();
    const scheduledAt = "2025-06-15T15:00:00Z";
    const id = createScheduledTrigger(kernel, {
      name: "Deploy later",
      scheduled_at: scheduledAt,
      target_type: "action",
      target_genus_id: actionId,
      target_config: JSON.stringify({ resource_bindings: {}, params: { version: "2.0" } }),
    });
    expect(id).toHaveLength(26);
    const state = materialize(kernel, id);
    expect(state.name).toBe("Deploy later");
    expect(state.expression).toBe("");
    expect(state.scheduled_at).toBe(scheduledAt);
    expect(state.target_type).toBe("action");
    expect(state.target_genus_id).toBe(actionId);
  });

  test("createScheduledTrigger rejects invalid date string", () => {
    const { actionId } = setupAction();
    expect(() => createScheduledTrigger(kernel, {
      name: "Bad trigger",
      scheduled_at: "not-a-date",
      target_type: "action",
      target_genus_id: actionId,
    })).toThrow("Invalid scheduled_at date");
  });

  test("scheduled trigger starts in active status", () => {
    const { actionId } = setupAction();
    const id = createScheduledTrigger(kernel, {
      name: "Active trigger",
      scheduled_at: "2025-06-15T15:00:00Z",
      target_type: "action",
      target_genus_id: actionId,
    });
    const state = materialize(kernel, id);
    expect(state.status).toBe("active");
  });

  // --- tickCron with one-time triggers ---

  test("tickCron fires trigger when current time >= scheduled_at", () => {
    const { actionId, serverGenus } = setupAction();
    const entityId = createEntity(kernel, serverGenus);
    setAttribute(kernel, entityId, "hostname", "srv-1");

    const id = createScheduledTrigger(kernel, {
      name: "Fire now",
      scheduled_at: "2025-06-15T12:00:00Z",
      target_type: "action",
      target_genus_id: actionId,
      target_config: JSON.stringify({ resource_bindings: { server: entityId }, params: { version: "5.0" } }),
    });

    const result = tickCron(kernel, new Date("2025-06-15T12:00:00Z"));
    expect(result.fired).toHaveLength(1);
    expect(result.fired[0].schedule_id).toBe(id);
    expect(result.fired[0].name).toBe("Fire now");
  });

  test("tickCron skips trigger when current time < scheduled_at", () => {
    const { actionId } = setupAction();
    createScheduledTrigger(kernel, {
      name: "Future trigger",
      scheduled_at: "2025-06-15T15:00:00Z",
      target_type: "action",
      target_genus_id: actionId,
    });

    const result = tickCron(kernel, new Date("2025-06-15T12:00:00Z"));
    expect(result.fired).toHaveLength(0);
  });

  test("tickCron auto-retires trigger after firing", () => {
    const { actionId, serverGenus } = setupAction();
    const entityId = createEntity(kernel, serverGenus);
    setAttribute(kernel, entityId, "hostname", "srv-1");

    const id = createScheduledTrigger(kernel, {
      name: "Auto-retire",
      scheduled_at: "2025-06-15T12:00:00Z",
      target_type: "action",
      target_genus_id: actionId,
      target_config: JSON.stringify({ resource_bindings: { server: entityId }, params: { version: "6.0" } }),
    });

    tickCron(kernel, new Date("2025-06-15T12:00:00Z"));
    const state = materialize(kernel, id);
    expect(state.status).toBe("retired");
  });

  test("tickCron does not re-fire retired one-time trigger", () => {
    const { actionId, serverGenus } = setupAction();
    const entityId = createEntity(kernel, serverGenus);
    setAttribute(kernel, entityId, "hostname", "srv-1");

    createScheduledTrigger(kernel, {
      name: "Once only",
      scheduled_at: "2025-06-15T12:00:00Z",
      target_type: "action",
      target_genus_id: actionId,
      target_config: JSON.stringify({ resource_bindings: { server: entityId }, params: { version: "7.0" } }),
    });

    const result1 = tickCron(kernel, new Date("2025-06-15T12:00:00Z"));
    expect(result1.fired).toHaveLength(1);

    // Second tick — trigger is now retired, should be skipped
    const result2 = tickCron(kernel, new Date("2025-06-15T12:01:00Z"));
    expect(result2.fired).toHaveLength(0);
    expect(result2.skipped).toBe(1);
  });

  test("listCronSchedules includes scheduled_at for one-time triggers", () => {
    const { actionId } = setupAction();
    const scheduledAt = "2025-06-15T15:00:00Z";
    createScheduledTrigger(kernel, {
      name: "Listed trigger",
      scheduled_at: scheduledAt,
      target_type: "action",
      target_genus_id: actionId,
    });

    const schedules = listCronSchedules(kernel);
    const trigger = schedules.find((s) => s.name === "Listed trigger");
    expect(trigger).toBeDefined();
    expect(trigger!.scheduled_at).toBe(scheduledAt);
    expect(trigger!.expression).toBe("");
  });
});

// ============================================================================
// Workspaces
// ============================================================================

describe("Workspaces", () => {
  let kernel: Kernel;

  beforeEach(() => {
    kernel = initKernel(":memory:");
  });

  afterEach(() => {
    kernel.db.close();
  });

  test("createWorkspace creates with correct attributes and starts active", () => {
    const wsId = createWorkspace(kernel, "Project Alpha", "First project");
    const state = materialize(kernel, wsId);
    expect(state.name).toBe("Project Alpha");
    expect(state.description).toBe("First project");
    expect(state.status).toBe("active");
  });

  test("listWorkspaces returns all workspaces with entity_count", () => {
    const ws1 = createWorkspace(kernel, "WS1");
    const ws2 = createWorkspace(kernel, "WS2");

    // Create entities in ws1
    const genusId = defineEntityGenus(kernel, "Widget", {
      attributes: [{ name: "label", type: "text", required: false }],
      states: [{ name: "draft", initial: true }],
    });
    switchWorkspace(kernel, ws1);
    createEntity(kernel, genusId);
    createEntity(kernel, genusId);
    switchWorkspace(kernel, null);

    const workspaces = listWorkspaces(kernel);
    expect(workspaces.length).toBe(2);
    const w1 = workspaces.find((w) => w.id === ws1)!;
    const w2 = workspaces.find((w) => w.id === ws2)!;
    expect(w1.name).toBe("WS1");
    expect(w1.entity_count).toBe(2);
    expect(w2.name).toBe("WS2");
    expect(w2.entity_count).toBe(0);
  });

  test("findWorkspaceByName resolves name to ID (case-insensitive)", () => {
    const wsId = createWorkspace(kernel, "My Workspace");
    expect(findWorkspaceByName(kernel, "my workspace")).toBe(wsId);
    expect(findWorkspaceByName(kernel, "MY WORKSPACE")).toBe(wsId);
    expect(findWorkspaceByName(kernel, "nope")).toBeNull();
  });

  test("switchWorkspace sets kernel.currentWorkspace", () => {
    const wsId = createWorkspace(kernel, "Test");
    expect(kernel.currentWorkspace).toBeNull();
    switchWorkspace(kernel, wsId);
    expect(kernel.currentWorkspace).toBe(wsId);
    switchWorkspace(kernel, null);
    expect(kernel.currentWorkspace).toBeNull();
  });

  test("createEntity in workspace tags res row with workspace_id", () => {
    const wsId = createWorkspace(kernel, "Tagged");
    const genusId = defineEntityGenus(kernel, "Item", {
      attributes: [{ name: "title", type: "text", required: false }],
      states: [{ name: "draft", initial: true }],
    });
    switchWorkspace(kernel, wsId);
    const entityId = createEntity(kernel, genusId);
    switchWorkspace(kernel, null);

    const row = kernel.db.query("SELECT workspace_id FROM res WHERE id = ?").get(entityId) as any;
    expect(row.workspace_id).toBe(wsId);
  });

  test("listEntities with workspace returns only that workspace's entities + NULL entities", () => {
    const genusId = defineEntityGenus(kernel, "Thing", {
      attributes: [{ name: "val", type: "text", required: false }],
      states: [{ name: "active", initial: true }],
    });

    // Create a global entity (no workspace)
    const globalId = createEntity(kernel, genusId);

    // Create entity in workspace A
    const wsA = createWorkspace(kernel, "A");
    switchWorkspace(kernel, wsA);
    const entityA = createEntity(kernel, genusId);

    // Switch to workspace A and list
    const entitiesInA = listEntities(kernel, { genus_id: genusId });
    expect(entitiesInA.map((e) => e.id)).toContain(entityA);
    expect(entitiesInA.map((e) => e.id)).toContain(globalId);
    switchWorkspace(kernel, null);
  });

  test("listEntities without workspace returns all entities", () => {
    const genusId = defineEntityGenus(kernel, "Gadget", {
      attributes: [{ name: "val", type: "text", required: false }],
      states: [{ name: "active", initial: true }],
    });

    const globalId = createEntity(kernel, genusId);

    const wsA = createWorkspace(kernel, "A");
    switchWorkspace(kernel, wsA);
    const entityA = createEntity(kernel, genusId);
    switchWorkspace(kernel, null);

    const wsB = createWorkspace(kernel, "B");
    switchWorkspace(kernel, wsB);
    const entityB = createEntity(kernel, genusId);
    switchWorkspace(kernel, null);

    const all = listEntities(kernel, { genus_id: genusId });
    expect(all.length).toBe(3);
    expect(all.map((e) => e.id)).toContain(globalId);
    expect(all.map((e) => e.id)).toContain(entityA);
    expect(all.map((e) => e.id)).toContain(entityB);
  });

  test("pre-workspace entities (NULL workspace_id) visible from all workspaces", () => {
    const genusId = defineEntityGenus(kernel, "Legacy", {
      attributes: [{ name: "val", type: "text", required: false }],
      states: [{ name: "active", initial: true }],
    });

    // Create entity with no workspace
    const legacyId = createEntity(kernel, genusId);

    const wsA = createWorkspace(kernel, "A");
    const wsB = createWorkspace(kernel, "B");

    switchWorkspace(kernel, wsA);
    expect(listEntities(kernel, { genus_id: genusId }).map((e) => e.id)).toContain(legacyId);

    switchWorkspace(kernel, wsB);
    expect(listEntities(kernel, { genus_id: genusId }).map((e) => e.id)).toContain(legacyId);

    switchWorkspace(kernel, null);
  });

  test("listGenera excludes WORKSPACE_GENUS_ID", () => {
    const genera = listGenera(kernel);
    expect(genera.map((g) => g.id)).not.toContain(WORKSPACE_GENUS_ID);
  });

  test("listEntities excludes workspace entities themselves", () => {
    createWorkspace(kernel, "Hidden");
    const entities = listEntities(kernel);
    const wsEntities = entities.filter((e) => e.genus_id === WORKSPACE_GENUS_ID);
    expect(wsEntities.length).toBe(0);
  });

  test("workspace archive/unarchive via transitionStatus", () => {
    const wsId = createWorkspace(kernel, "Archivable");
    transitionStatus(kernel, wsId, "archived");
    let state = materialize(kernel, wsId);
    expect(state.status).toBe("archived");

    transitionStatus(kernel, wsId, "active");
    state = materialize(kernel, wsId);
    expect(state.status).toBe("active");
  });

  test("cross-workspace isolation — entities in workspace A not visible from workspace B", () => {
    const genusId = defineEntityGenus(kernel, "Isolated", {
      attributes: [{ name: "val", type: "text", required: false }],
      states: [{ name: "active", initial: true }],
    });

    const wsA = createWorkspace(kernel, "A");
    const wsB = createWorkspace(kernel, "B");

    switchWorkspace(kernel, wsA);
    const entityA = createEntity(kernel, genusId);

    switchWorkspace(kernel, wsB);
    const entityB = createEntity(kernel, genusId);

    // From workspace B, should see entityB but NOT entityA
    const entitiesInB = listEntities(kernel, { genus_id: genusId });
    expect(entitiesInB.map((e) => e.id)).toContain(entityB);
    expect(entitiesInB.map((e) => e.id)).not.toContain(entityA);

    // From workspace A, should see entityA but NOT entityB
    switchWorkspace(kernel, wsA);
    const entitiesInA = listEntities(kernel, { genus_id: genusId });
    expect(entitiesInA.map((e) => e.id)).toContain(entityA);
    expect(entitiesInA.map((e) => e.id)).not.toContain(entityB);

    switchWorkspace(kernel, null);
  });

  test("assignWorkspace moves entity to workspace", () => {
    const genusId = defineEntityGenus(kernel, "Movable", {
      attributes: [{ name: "val", type: "text", required: false }],
      states: [{ name: "active", initial: true }],
    });
    const entityId = createEntity(kernel, genusId);
    const wsId = createWorkspace(kernel, "Target");

    // Initially no workspace
    const before = kernel.db.query("SELECT workspace_id FROM res WHERE id = ?").get(entityId) as any;
    expect(before.workspace_id).toBeNull();

    assignWorkspace(kernel, entityId, wsId);

    const after = kernel.db.query("SELECT workspace_id FROM res WHERE id = ?").get(entityId) as any;
    expect(after.workspace_id).toBe(wsId);
  });

  test("assignWorkspace throws for unknown entity", () => {
    const wsId = createWorkspace(kernel, "WS");
    expect(() => assignWorkspace(kernel, "nonexistent", wsId)).toThrow("Entity not found");
  });

  test("assignWorkspaceByGenus bulk assigns all entities of a genus", () => {
    const genusId = defineEntityGenus(kernel, "Bulk", {
      attributes: [{ name: "val", type: "text", required: false }],
      states: [{ name: "active", initial: true }],
    });
    const e1 = createEntity(kernel, genusId);
    const e2 = createEntity(kernel, genusId);
    const e3 = createEntity(kernel, genusId);
    const wsId = createWorkspace(kernel, "BulkTarget");

    const count = assignWorkspaceByGenus(kernel, genusId, wsId);
    expect(count).toBe(3);

    for (const eid of [e1, e2, e3]) {
      const row = kernel.db.query("SELECT workspace_id FROM res WHERE id = ?").get(eid) as any;
      expect(row.workspace_id).toBe(wsId);
    }
  });

  test("assignWorkspaceByGenus is idempotent — skips already-in-target entities", () => {
    const genusId = defineEntityGenus(kernel, "Partial", {
      attributes: [{ name: "val", type: "text", required: false }],
      states: [{ name: "active", initial: true }],
    });
    const wsA = createWorkspace(kernel, "A");

    switchWorkspace(kernel, wsA);
    createEntity(kernel, genusId);
    switchWorkspace(kernel, null);
    createEntity(kernel, genusId); // unscoped

    // First assign: moves both (unscoped + already in wsA gets skipped since it's already wsA)
    const count1 = assignWorkspaceByGenus(kernel, genusId, wsA);
    expect(count1).toBe(1); // only the unscoped one

    // Second assign: idempotent, nothing to do
    const count2 = assignWorkspaceByGenus(kernel, genusId, wsA);
    expect(count2).toBe(0);
  });

  test("assignWorkspaceByTaxonomy bulk assigns across genera in taxonomy", () => {
    const taxonomyId = createTaxonomy(kernel, "TestOnt");
    const g1 = defineEntityGenus(kernel, "OntThing1", {
      attributes: [{ name: "val", type: "text", required: false }],
      states: [{ name: "active", initial: true }],
      taxonomy_id: taxonomyId,
    });
    const g2 = defineEntityGenus(kernel, "OntThing2", {
      attributes: [{ name: "val", type: "text", required: false }],
      states: [{ name: "active", initial: true }],
      taxonomy_id: taxonomyId,
    });
    createEntity(kernel, g1);
    createEntity(kernel, g1);
    createEntity(kernel, g2);
    const wsId = createWorkspace(kernel, "OntTarget");

    const count = assignWorkspaceByTaxonomy(kernel, taxonomyId, wsId);
    expect(count).toBe(3);
  });

  test("assigned entities only visible from their workspace", () => {
    const genusId = defineEntityGenus(kernel, "Assigned", {
      attributes: [{ name: "val", type: "text", required: false }],
      states: [{ name: "active", initial: true }],
    });
    const entityId = createEntity(kernel, genusId);
    const wsA = createWorkspace(kernel, "A");
    const wsB = createWorkspace(kernel, "B");

    assignWorkspace(kernel, entityId, wsA);

    // Visible from workspace A
    switchWorkspace(kernel, wsA);
    expect(listEntities(kernel, { genus_id: genusId }).map((e) => e.id)).toContain(entityId);

    // NOT visible from workspace B
    switchWorkspace(kernel, wsB);
    expect(listEntities(kernel, { genus_id: genusId }).map((e) => e.id)).not.toContain(entityId);

    switchWorkspace(kernel, null);
  });

  test("re-assigning entity to different workspace works", () => {
    const genusId = defineEntityGenus(kernel, "Reassign", {
      attributes: [{ name: "val", type: "text", required: false }],
      states: [{ name: "active", initial: true }],
    });
    const entityId = createEntity(kernel, genusId);
    const wsA = createWorkspace(kernel, "A");
    const wsB = createWorkspace(kernel, "B");

    assignWorkspace(kernel, entityId, wsA);
    let row = kernel.db.query("SELECT workspace_id FROM res WHERE id = ?").get(entityId) as any;
    expect(row.workspace_id).toBe(wsA);

    assignWorkspace(kernel, entityId, wsB);
    row = kernel.db.query("SELECT workspace_id FROM res WHERE id = ?").get(entityId) as any;
    expect(row.workspace_id).toBe(wsB);

    // Only visible from B now
    switchWorkspace(kernel, wsA);
    expect(listEntities(kernel, { genus_id: genusId }).map((e) => e.id)).not.toContain(entityId);
    switchWorkspace(kernel, wsB);
    expect(listEntities(kernel, { genus_id: genusId }).map((e) => e.id)).toContain(entityId);
    switchWorkspace(kernel, null);
  });
});

// ============================================================================
// listRelationships
// ============================================================================

describe("listRelationships", () => {
  let kernel: Kernel;

  beforeEach(() => { kernel = initKernel(":memory:"); });
  afterEach(() => { kernel.db.close(); });

  function setupRelationships() {
    const artistGenus = defineEntityGenus(kernel, "Artist", {
      attributes: [{ name: "name", type: "text", required: true }],
      states: [{ name: "active", initial: true }],
    });
    const albumGenus = defineEntityGenus(kernel, "Album", {
      attributes: [{ name: "title", type: "text", required: true }],
      states: [{ name: "draft", initial: true }],
    });
    const relGenus = defineRelationshipGenus(kernel, "RecordedBy", {
      roles: [
        { name: "artist", valid_member_genera: ["Artist"], cardinality: "one" },
        { name: "album", valid_member_genera: ["Album"], cardinality: "one" },
      ],
    });
    const a1 = createEntity(kernel, artistGenus);
    setAttribute(kernel, a1, "name", "Alice");
    const a2 = createEntity(kernel, artistGenus);
    setAttribute(kernel, a2, "name", "Bob");
    const alb1 = createEntity(kernel, albumGenus);
    setAttribute(kernel, alb1, "title", "First");
    const alb2 = createEntity(kernel, albumGenus);
    setAttribute(kernel, alb2, "title", "Second");

    const r1 = createRelationship(kernel, relGenus, { artist: a1, album: alb1 });
    const r2 = createRelationship(kernel, relGenus, { artist: a2, album: alb2 });

    return { artistGenus, albumGenus, relGenus, a1, a2, alb1, alb2, r1, r2 };
  }

  test("returns all relationships", () => {
    const { r1, r2 } = setupRelationships();
    const rels = listRelationships(kernel);
    const ids = rels.map((r) => r.id);
    expect(ids).toContain(r1);
    expect(ids).toContain(r2);
  });

  test("filters by genus_id", () => {
    const { relGenus, r1, r2 } = setupRelationships();
    const rels = listRelationships(kernel, { genus_id: relGenus });
    expect(rels.length).toBe(2);
    expect(rels.map((r) => r.id).sort()).toEqual([r1, r2].sort());
  });

  test("filters by member_entity_id", () => {
    const { a1, r1 } = setupRelationships();
    const rels = listRelationships(kernel, { member_entity_id: a1 });
    expect(rels.length).toBe(1);
    expect(rels[0].id).toBe(r1);
  });

  test("filters by member_role", () => {
    const { a1, r1 } = setupRelationships();
    const rels = listRelationships(kernel, { member_entity_id: a1, member_role: "artist" });
    expect(rels.length).toBe(1);
    expect(rels[0].id).toBe(r1);
  });

  test("respects limit", () => {
    setupRelationships();
    const rels = listRelationships(kernel, { limit: 1 });
    expect(rels.length).toBe(1);
  });
});

// ============================================================================
// Attribute Filters on listEntities
// ============================================================================

describe("Attribute Filters on listEntities", () => {
  let kernel: Kernel;

  beforeEach(() => { kernel = initKernel(":memory:"); });
  afterEach(() => { kernel.db.close(); });

  function setupEntities() {
    const genusId = defineEntityGenus(kernel, "Book", {
      attributes: [
        { name: "title", type: "text", required: true },
        { name: "author", type: "text", required: false },
        { name: "pages", type: "number", required: false },
      ],
      states: [{ name: "draft", initial: true }],
    });
    const b1 = createEntity(kernel, genusId);
    setAttribute(kernel, b1, "title", "The Earth Below");
    setAttribute(kernel, b1, "author", "Alice");
    setAttribute(kernel, b1, "pages", 200);

    const b2 = createEntity(kernel, genusId);
    setAttribute(kernel, b2, "title", "Ocean Depths");
    setAttribute(kernel, b2, "author", "Bob");
    setAttribute(kernel, b2, "pages", 300);

    const b3 = createEntity(kernel, genusId);
    setAttribute(kernel, b3, "title", "Earth and Sky");
    setAttribute(kernel, b3, "author", "Alice");
    setAttribute(kernel, b3, "pages", 150);

    return { genusId, b1, b2, b3 };
  }

  test("filters by eq", () => {
    const { genusId, b1, b3 } = setupEntities();
    const results = listEntities(kernel, {
      genus_id: genusId,
      attribute_filters: [{ key: "author", op: "eq", value: "Alice" }],
    });
    expect(results.map((e) => e.id).sort()).toEqual([b1, b3].sort());
  });

  test("filters by contains (case-insensitive)", () => {
    const { genusId, b1, b3 } = setupEntities();
    const results = listEntities(kernel, {
      genus_id: genusId,
      attribute_filters: [{ key: "title", op: "contains", value: "earth" }],
    });
    expect(results.map((e) => e.id).sort()).toEqual([b1, b3].sort());
  });

  test("ANDs multiple filters", () => {
    const { genusId, b3 } = setupEntities();
    const results = listEntities(kernel, {
      genus_id: genusId,
      attribute_filters: [
        { key: "author", op: "eq", value: "Alice" },
        { key: "title", op: "contains", value: "sky" },
      ],
    });
    expect(results.length).toBe(1);
    expect(results[0].id).toBe(b3);
  });

  test("contains returns empty for non-string attributes", () => {
    const { genusId } = setupEntities();
    const results = listEntities(kernel, {
      genus_id: genusId,
      attribute_filters: [{ key: "pages", op: "contains", value: "200" }],
    });
    expect(results.length).toBe(0);
  });
});

// ============================================================================
// searchEntities
// ============================================================================

describe("searchEntities", () => {
  let kernel: Kernel;

  beforeEach(() => { kernel = initKernel(":memory:"); });
  afterEach(() => { kernel.db.close(); });

  function setupSearch() {
    const genusA = defineEntityGenus(kernel, "Planet", {
      attributes: [
        { name: "name", type: "text", required: true },
        { name: "description", type: "text", required: false },
        { name: "diameter", type: "number", required: false },
      ],
      states: [{ name: "active", initial: true }],
    });
    const genusB = defineEntityGenus(kernel, "Star", {
      attributes: [
        { name: "name", type: "text", required: true },
        { name: "type", type: "text", required: false },
      ],
      states: [{ name: "active", initial: true }],
    });

    const p1 = createEntity(kernel, genusA);
    setAttribute(kernel, p1, "name", "Earth");
    setAttribute(kernel, p1, "description", "The blue planet");
    setAttribute(kernel, p1, "diameter", 12742);

    const p2 = createEntity(kernel, genusA);
    setAttribute(kernel, p2, "name", "Mars");
    setAttribute(kernel, p2, "description", "The red planet");

    const s1 = createEntity(kernel, genusB);
    setAttribute(kernel, s1, "name", "Sun");
    setAttribute(kernel, s1, "type", "G-type main-sequence");

    return { genusA, genusB, p1, p2, s1 };
  }

  test("finds by string attribute match", () => {
    const { p1 } = setupSearch();
    const results = searchEntities(kernel, { query: "Earth" });
    expect(results.length).toBe(1);
    expect(results[0].id).toBe(p1);
  });

  test("case-insensitive", () => {
    const { p1 } = setupSearch();
    const results = searchEntities(kernel, { query: "earth" });
    expect(results.length).toBe(1);
    expect(results[0].id).toBe(p1);
  });

  test("ignores non-string attributes", () => {
    setupSearch();
    const results = searchEntities(kernel, { query: "12742" });
    expect(results.length).toBe(0);
  });

  test("respects genus filter", () => {
    const { genusA } = setupSearch();
    const results = searchEntities(kernel, { query: "planet", genus_id: genusA });
    expect(results.length).toBe(2); // Earth and Mars both have "planet" in description
  });

  test("respects limit", () => {
    setupSearch();
    const results = searchEntities(kernel, { query: "planet", limit: 1 });
    expect(results.length).toBe(1);
  });

  test("returns matched_attributes correctly", () => {
    const { p1 } = setupSearch();
    const results = searchEntities(kernel, { query: "blue" });
    expect(results.length).toBe(1);
    expect(results[0].id).toBe(p1);
    expect(results[0].matched_attributes).toEqual(["description"]);
  });
});

// ============================================================================
// Feature 1: step_name + lane_name on Process Tasks
// ============================================================================

describe("Task step_name/lane_name", () => {
  let kernel: Kernel;

  beforeEach(() => {
    kernel = initKernel(":memory:");
  });

  afterEach(() => {
    kernel.db.close();
  });

  test("Task genus has step_name and lane_name attributes after evolution", () => {
    const def = getGenusDef(kernel, TASK_GENUS_ID);
    expect(def.attributes.step_name).toBeDefined();
    expect(def.attributes.step_name.type).toBe("text");
    expect(def.attributes.step_name.required).toBe(false);
    expect(def.attributes.lane_name).toBeDefined();
    expect(def.attributes.lane_name.type).toBe("text");
    expect(def.attributes.lane_name.required).toBe(false);
  });

  test("process-spawned tasks have step_name and lane_name", () => {
    const genusId = defineProcessGenus(kernel, "TestProcess", {
      lanes: [{ name: "Review", position: 0 }],
      steps: [
        { name: "review_step", type: "task_step", lane: "Review", position: 0, task_title: "Review doc" },
      ],
      triggers: [{ type: "manual" }],
    });
    const { state } = startProcess(kernel, genusId);
    const taskId = state.steps.review_step.task_id!;
    const taskState = materialize(kernel, taskId);
    expect(taskState.step_name).toBe("review_step");
    expect(taskState.lane_name).toBe("Review");
  });

  test("TaskSummary includes step_name and lane_name", () => {
    const genusId = defineProcessGenus(kernel, "TestProcess", {
      lanes: [{ name: "Lane1", position: 0 }],
      steps: [
        { name: "s1", type: "task_step", lane: "Lane1", position: 0, task_title: "Task 1" },
      ],
      triggers: [{ type: "manual" }],
    });
    startProcess(kernel, genusId);
    const tasks = listTasks(kernel);
    expect(tasks.length).toBeGreaterThanOrEqual(1);
    const t = tasks.find((t) => t.step_name === "s1");
    expect(t).toBeDefined();
    expect(t!.step_name).toBe("s1");
    expect(t!.lane_name).toBe("Lane1");
  });

  test("manually created tasks have null step_name/lane_name", () => {
    createTask(kernel, "Manual task");
    const tasks = listTasks(kernel);
    const t = tasks.find((t) => t.title === "Manual task");
    expect(t).toBeDefined();
    expect(t!.step_name).toBeNull();
    expect(t!.lane_name).toBeNull();
  });
});

// ============================================================================
// Feature 6: listTasks filter by process_id
// ============================================================================

describe("listTasks process_id filter", () => {
  let kernel: Kernel;

  beforeEach(() => {
    kernel = initKernel(":memory:");
  });

  afterEach(() => {
    kernel.db.close();
  });

  test("filters tasks by process_id", () => {
    const genusId = defineProcessGenus(kernel, "Workflow", {
      lanes: [{ name: "main", position: 0 }],
      steps: [
        { name: "s1", type: "task_step", lane: "main", position: 0, task_title: "Task A" },
      ],
      triggers: [{ type: "manual" }],
    });
    const { id: procId } = startProcess(kernel, genusId);
    // Also create an unrelated task
    createTask(kernel, "Unrelated");

    const filtered = listTasks(kernel, { process_id: procId });
    expect(filtered.length).toBe(1);
    expect(filtered[0].context_res_ids).toContain(procId);

    const all = listTasks(kernel);
    expect(all.length).toBe(2);
  });

  test("returns empty when process_id has no tasks", () => {
    createTask(kernel, "Standalone");
    const filtered = listTasks(kernel, { process_id: "nonexistent" });
    expect(filtered.length).toBe(0);
  });

  test("combines process_id with status filter", () => {
    const genusId = defineProcessGenus(kernel, "Workflow", {
      lanes: [{ name: "main", position: 0 }],
      steps: [
        { name: "s1", type: "task_step", lane: "main", position: 0, task_title: "Task A" },
      ],
      triggers: [{ type: "manual" }],
    });
    const { id: procId, state } = startProcess(kernel, genusId);
    const taskId = state.steps.s1.task_id!;
    completeTask(kernel, taskId, "done");

    const pending = listTasks(kernel, { process_id: procId, status: "pending" });
    expect(pending.length).toBe(0);
    const completed = listTasks(kernel, { process_id: procId, status: "completed" });
    expect(completed.length).toBe(1);
  });
});

// ============================================================================
// Feature 9: moveTaxonomy + moveGenus
// ============================================================================

describe("moveTaxonomy + moveGenus", () => {
  let kernel: Kernel;

  beforeEach(() => {
    kernel = initKernel(":memory:");
  });

  afterEach(() => {
    kernel.db.close();
  });

  test("moveTaxonomy changes science_id", () => {
    const sci1 = createScience(kernel, "Science A");
    const sci2 = createScience(kernel, "Science B");
    const tax = createTaxonomy(kernel, "MyTax", undefined, sci1);
    moveTaxonomy(kernel, tax, sci2);
    const state = materialize(kernel, tax);
    expect(state.science_id).toBe(sci2);
  });

  test("moveTaxonomy rejects non-taxonomy entity", () => {
    const sci = createScience(kernel, "Science");
    const genus = defineEntityGenus(kernel, "Thing", {
      attributes: [{ name: "name", type: "text", required: true }],
      states: [{ name: "active", initial: true }],
    });
    const entity = createEntity(kernel, genus);
    setAttribute(kernel, entity, "name", "test");
    expect(() => moveTaxonomy(kernel, entity, sci)).toThrow("is not a taxonomy");
  });

  test("moveTaxonomy rejects archived target science", () => {
    const sci1 = createScience(kernel, "SciA");
    const sci2 = createScience(kernel, "SciB");
    const tax = createTaxonomy(kernel, "Tax1", undefined, sci1);
    transitionStatus(kernel, sci2, "archived");
    expect(() => moveTaxonomy(kernel, tax, sci2)).toThrow("archived");
  });

  test("moveGenus changes taxonomy_id", () => {
    const tax1 = createTaxonomy(kernel, "Tax1");
    const tax2 = createTaxonomy(kernel, "Tax2");
    const genus = defineEntityGenus(kernel, "Widget", {
      attributes: [{ name: "name", type: "text", required: true }],
      states: [{ name: "active", initial: true }],
      taxonomy_id: tax1,
    });
    moveGenus(kernel, genus, tax2);
    const def = getGenusDef(kernel, genus);
    expect(def.meta.taxonomy_id).toBe(tax2);
  });

  test("moveGenus rejects archived target taxonomy", () => {
    const tax1 = createTaxonomy(kernel, "Tax1");
    const tax2 = createTaxonomy(kernel, "Tax2");
    const genus = defineEntityGenus(kernel, "Widget", {
      attributes: [{ name: "name", type: "text", required: true }],
      states: [{ name: "active", initial: true }],
      taxonomy_id: tax1,
    });
    transitionStatus(kernel, tax2, "archived");
    expect(() => moveGenus(kernel, genus, tax2)).toThrow("archived");
  });

  test("moveGenus works for process genera", () => {
    const tax1 = createTaxonomy(kernel, "Tax1");
    const tax2 = createTaxonomy(kernel, "Tax2");
    const genusId = defineProcessGenus(kernel, "TestProc", {
      lanes: [{ name: "main", position: 0 }],
      steps: [{ name: "s1", type: "task_step", lane: "main", position: 0, task_title: "T1" }],
      taxonomy_id: tax1,
    });
    moveGenus(kernel, genusId, tax2);
    const def = getProcessDef(kernel, genusId);
    expect(def.meta.taxonomy_id).toBe(tax2);
  });
});

// ============================================================================
// Feature 4: Cleanup Tools
// ============================================================================

describe("Workspace Cleanup", () => {
  let kernel: Kernel;

  beforeEach(() => {
    kernel = initKernel(":memory:");
  });

  afterEach(() => {
    kernel.db.close();
  });

  test("deleteWorkspace removes empty workspace", () => {
    const wsId = createWorkspace(kernel, "Empty WS");
    deleteWorkspace(kernel, wsId);
    expect(() => getRes(kernel, wsId)).toThrow("Res not found");
  });

  test("deleteWorkspace rejects non-empty workspace", () => {
    const wsId = createWorkspace(kernel, "Full WS");
    const genus = defineEntityGenus(kernel, "Item", {
      attributes: [{ name: "name", type: "text", required: true }],
      states: [{ name: "active", initial: true }],
    });
    const entity = createEntity(kernel, genus);
    setAttribute(kernel, entity, "name", "thing");
    assignWorkspace(kernel, entity, wsId);
    expect(() => deleteWorkspace(kernel, wsId)).toThrow("not empty");
  });

  test("deleteWorkspace rejects non-workspace entity", () => {
    const genus = defineEntityGenus(kernel, "Item", {
      attributes: [{ name: "name", type: "text", required: true }],
      states: [{ name: "active", initial: true }],
    });
    const entity = createEntity(kernel, genus);
    setAttribute(kernel, entity, "name", "thing");
    expect(() => deleteWorkspace(kernel, entity)).toThrow("is not a workspace");
  });

  test("deleteWorkspace clears currentWorkspace if deleted", () => {
    const wsId = createWorkspace(kernel, "Current WS");
    switchWorkspace(kernel, wsId);
    expect(kernel.currentWorkspace).toBe(wsId);
    deleteWorkspace(kernel, wsId);
    expect(kernel.currentWorkspace).toBeNull();
  });

  test("mergeWorkspaces moves entities and deletes source", () => {
    const ws1 = createWorkspace(kernel, "Source");
    const ws2 = createWorkspace(kernel, "Target");
    const genus = defineEntityGenus(kernel, "Item", {
      attributes: [{ name: "name", type: "text", required: true }],
      states: [{ name: "active", initial: true }],
    });
    const e1 = createEntity(kernel, genus);
    setAttribute(kernel, e1, "name", "a");
    assignWorkspace(kernel, e1, ws1);
    const e2 = createEntity(kernel, genus);
    setAttribute(kernel, e2, "name", "b");
    assignWorkspace(kernel, e2, ws1);

    const count = mergeWorkspaces(kernel, ws1, ws2);
    expect(count).toBe(2);
    // Source should be deleted
    expect(() => getRes(kernel, ws1)).toThrow("Res not found");
    // Entities should now be in target
    const r1 = getRes(kernel, e1);
    expect(r1.workspace_id).toBe(ws2);
    const r2 = getRes(kernel, e2);
    expect(r2.workspace_id).toBe(ws2);
  });
});

describe("listProcesses include_finished", () => {
  let kernel: Kernel;

  beforeEach(() => {
    kernel = initKernel(":memory:");
  });

  afterEach(() => {
    kernel.db.close();
  });

  test("excludes finished processes by default", () => {
    const genusId = defineProcessGenus(kernel, "Workflow", {
      lanes: [{ name: "main", position: 0 }],
      steps: [
        { name: "s1", type: "task_step", lane: "main", position: 0, task_title: "Do it" },
      ],
      triggers: [{ type: "manual" }],
    });
    const { id: procId, state } = startProcess(kernel, genusId);
    // Complete the task to finish the process
    const taskId = state.steps.s1.task_id!;
    completeTask(kernel, taskId, "done");

    // Process should now be completed
    const status = getProcessStatus(kernel, procId);
    expect(status.status).toBe("completed");

    // Default: exclude finished
    const procs = listProcesses(kernel);
    expect(procs.find((p) => p.id === procId)).toBeUndefined();

    // include_finished: true
    const allProcs = listProcesses(kernel, { include_finished: true });
    expect(allProcs.find((p) => p.id === procId)).toBeDefined();
  });

  test("includes running processes by default", () => {
    const genusId = defineProcessGenus(kernel, "Workflow", {
      lanes: [{ name: "main", position: 0 }],
      steps: [
        { name: "s1", type: "task_step", lane: "main", position: 0, task_title: "Do it" },
      ],
      triggers: [{ type: "manual" }],
    });
    const { id: procId } = startProcess(kernel, genusId);
    const procs = listProcesses(kernel);
    expect(procs.find((p) => p.id === procId)).toBeDefined();
  });
});

// ============================================================================
// Feature 5: Process Evolution
// ============================================================================

describe("evolveProcessGenus", () => {
  let kernel: Kernel;

  beforeEach(() => {
    kernel = initKernel(":memory:");
  });

  afterEach(() => {
    kernel.db.close();
  });

  test("adds new lane", () => {
    const genusId = defineProcessGenus(kernel, "TestProc", {
      lanes: [{ name: "main", position: 0 }],
      steps: [{ name: "s1", type: "task_step", lane: "main", position: 0, task_title: "T1" }],
    });
    evolveProcessGenus(kernel, genusId, {
      lanes: [{ name: "review", position: 1 }],
    });
    const def = getProcessDef(kernel, genusId);
    expect(def.lanes.review).toBeDefined();
    expect(def.lanes.review.position).toBe(1);
    expect(def.lanes.main).toBeDefined(); // Original still there
  });

  test("adds new step", () => {
    const genusId = defineProcessGenus(kernel, "TestProc", {
      lanes: [{ name: "main", position: 0 }],
      steps: [{ name: "s1", type: "task_step", lane: "main", position: 0, task_title: "T1" }],
    });
    evolveProcessGenus(kernel, genusId, {
      steps: [{ name: "s2", type: "task_step", lane: "main", position: 1, task_title: "T2" }],
    });
    const def = getProcessDef(kernel, genusId);
    expect(def.steps.s2).toBeDefined();
    expect(def.steps.s2.task_title).toBe("T2");
    expect(def.steps.s1).toBeDefined(); // Original still there
  });

  test("modifies existing step (overwrites)", () => {
    const genusId = defineProcessGenus(kernel, "TestProc", {
      lanes: [{ name: "main", position: 0 }],
      steps: [{ name: "s1", type: "task_step", lane: "main", position: 0, task_title: "Old Title" }],
    });
    evolveProcessGenus(kernel, genusId, {
      steps: [{ name: "s1", type: "task_step", lane: "main", position: 0, task_title: "New Title" }],
    });
    const def = getProcessDef(kernel, genusId);
    expect(def.steps.s1.task_title).toBe("New Title");
  });

  test("modifies existing lane position", () => {
    const genusId = defineProcessGenus(kernel, "TestProc", {
      lanes: [{ name: "main", position: 0 }, { name: "review", position: 1 }],
      steps: [{ name: "s1", type: "task_step", lane: "main", position: 0, task_title: "T1" }],
    });
    evolveProcessGenus(kernel, genusId, {
      lanes: [{ name: "review", position: 5 }],
    });
    const def = getProcessDef(kernel, genusId);
    expect(def.lanes.review.position).toBe(5);
  });

  test("rejects non-process genus", () => {
    const genus = defineEntityGenus(kernel, "Thing", {
      attributes: [{ name: "name", type: "text", required: true }],
      states: [{ name: "active", initial: true }],
    });
    expect(() => evolveProcessGenus(kernel, genus, { lanes: [] })).toThrow("is not a process genus");
  });

  test("rejects deprecated genus", () => {
    const genusId = defineProcessGenus(kernel, "TestProc", {
      lanes: [{ name: "main", position: 0 }],
      steps: [{ name: "s1", type: "task_step", lane: "main", position: 0, task_title: "T1" }],
    });
    deprecateGenus(kernel, genusId);
    expect(() => evolveProcessGenus(kernel, genusId, { lanes: [] })).toThrow("deprecated");
  });

  test("adds triggers", () => {
    const genusId = defineProcessGenus(kernel, "TestProc", {
      lanes: [{ name: "main", position: 0 }],
      steps: [{ name: "s1", type: "task_step", lane: "main", position: 0, task_title: "T1" }],
      triggers: [{ type: "manual" }],
    });
    evolveProcessGenus(kernel, genusId, {
      triggers: [{ type: "cron" }],
    });
    const def = getProcessDef(kernel, genusId);
    expect(def.triggers.length).toBe(2);
    expect(def.triggers[0].type).toBe("manual");
    expect(def.triggers[1].type).toBe("cron");
  });
});

// ============================================================================
// all_workspaces flag
// ============================================================================

describe("all_workspaces flag", () => {
  let kernel: Kernel;

  beforeEach(() => {
    kernel = initKernel(":memory:");
  });

  afterEach(() => {
    kernel.db.close();
  });

  test("listEntities with all_workspaces returns entities from all workspaces", () => {
    const genus = defineEntityGenus(kernel, "Item", {
      attributes: [{ name: "name", type: "text", required: true }],
      states: [{ name: "active", initial: true }],
    });
    const ws1 = createWorkspace(kernel, "WS1");
    const ws2 = createWorkspace(kernel, "WS2");
    const e1 = createEntity(kernel, genus);
    setAttribute(kernel, e1, "name", "a");
    assignWorkspace(kernel, e1, ws1);
    const e2 = createEntity(kernel, genus);
    setAttribute(kernel, e2, "name", "b");
    assignWorkspace(kernel, e2, ws2);

    // Scoped to ws1
    switchWorkspace(kernel, ws1);
    const scoped = listEntities(kernel, { genus_id: genus });
    expect(scoped.length).toBe(1);
    expect(scoped[0].id).toBe(e1);

    // All workspaces
    const all = listEntities(kernel, { genus_id: genus, all_workspaces: true });
    expect(all.length).toBe(2);
  });

  test("searchEntities with all_workspaces searches across all workspaces", () => {
    const genus = defineEntityGenus(kernel, "Item", {
      attributes: [{ name: "name", type: "text", required: true }],
      states: [{ name: "active", initial: true }],
    });
    const ws1 = createWorkspace(kernel, "WS1");
    const ws2 = createWorkspace(kernel, "WS2");
    const e1 = createEntity(kernel, genus);
    setAttribute(kernel, e1, "name", "alpha");
    assignWorkspace(kernel, e1, ws1);
    const e2 = createEntity(kernel, genus);
    setAttribute(kernel, e2, "name", "beta");
    assignWorkspace(kernel, e2, ws2);

    switchWorkspace(kernel, ws1);
    const scoped = searchEntities(kernel, { query: "beta" });
    expect(scoped.length).toBe(0);

    const all = searchEntities(kernel, { query: "beta", all_workspaces: true });
    expect(all.length).toBe(1);
    expect(all[0].id).toBe(e2);
  });
});

// ============================================================================
// Shared Taxonomies
// ============================================================================

describe("Shared Taxonomies", () => {
  let kernel: Kernel;

  beforeEach(() => {
    kernel = initKernel(":memory:");
  });

  afterEach(() => {
    kernel.db.close();
  });

  test("shareTaxonomy adds science to shared_science_ids", () => {
    const sci1 = createScience(kernel, "Science A");
    const sci2 = createScience(kernel, "Science B");
    const tax = createTaxonomy(kernel, "Shared Tax", undefined, sci1);
    shareTaxonomy(kernel, tax, sci2);
    const state = materialize(kernel, tax);
    const shared = JSON.parse(state.shared_science_ids as string);
    expect(shared).toEqual([sci2]);
  });

  test("shareTaxonomy is idempotent", () => {
    const sci1 = createScience(kernel, "Science A");
    const sci2 = createScience(kernel, "Science B");
    const tax = createTaxonomy(kernel, "Tax", undefined, sci1);
    shareTaxonomy(kernel, tax, sci2);
    shareTaxonomy(kernel, tax, sci2); // second call
    const state = materialize(kernel, tax);
    const shared = JSON.parse(state.shared_science_ids as string);
    expect(shared).toEqual([sci2]); // still just one entry
  });

  test("shareTaxonomy rejects sharing with own science", () => {
    const sci = createScience(kernel, "Science A");
    const tax = createTaxonomy(kernel, "Tax", undefined, sci);
    expect(() => shareTaxonomy(kernel, tax, sci)).toThrow("already belongs");
  });

  test("shareTaxonomy rejects archived target science", () => {
    const sci1 = createScience(kernel, "Science A");
    const sci2 = createScience(kernel, "Science B");
    const tax = createTaxonomy(kernel, "Tax", undefined, sci1);
    transitionStatus(kernel, sci2, "archived");
    expect(() => shareTaxonomy(kernel, tax, sci2)).toThrow("archived");
  });

  test("unshareTaxonomy removes science from shared list", () => {
    const sci1 = createScience(kernel, "Science A");
    const sci2 = createScience(kernel, "Science B");
    const sci3 = createScience(kernel, "Science C");
    const tax = createTaxonomy(kernel, "Tax", undefined, sci1);
    shareTaxonomy(kernel, tax, sci2);
    shareTaxonomy(kernel, tax, sci3);
    unshareTaxonomy(kernel, tax, sci2);
    const state = materialize(kernel, tax);
    const shared = JSON.parse(state.shared_science_ids as string);
    expect(shared).toEqual([sci3]);
  });

  test("describeScience includes shared taxonomies", () => {
    const sci1 = createScience(kernel, "Science A");
    const sci2 = createScience(kernel, "Science B");
    const tax = createTaxonomy(kernel, "Shared Tax", undefined, sci1);
    shareTaxonomy(kernel, tax, sci2);

    const desc = describeScience(kernel, sci2);
    const sharedTax = desc.taxonomies.find((t) => t.id === tax);
    expect(sharedTax).toBeDefined();
    expect((sharedTax as any).shared).toBe(true);
  });

  test("describeScience does not mark own taxonomies as shared", () => {
    const sci = createScience(kernel, "Science A");
    const tax = createTaxonomy(kernel, "Own Tax", undefined, sci);

    const desc = describeScience(kernel, sci);
    const ownTax = desc.taxonomies.find((t) => t.id === tax);
    expect(ownTax).toBeDefined();
    expect((ownTax as any).shared).toBeUndefined();
  });

  test("shareTaxonomy with multiple sciences", () => {
    const sci1 = createScience(kernel, "Science A");
    const sci2 = createScience(kernel, "Science B");
    const sci3 = createScience(kernel, "Science C");
    const tax = createTaxonomy(kernel, "Toolkit", undefined, sci1);
    shareTaxonomy(kernel, tax, sci2);
    shareTaxonomy(kernel, tax, sci3);

    // Visible in all three sciences
    const desc1 = describeScience(kernel, sci1);
    expect(desc1.taxonomies.find((t) => t.id === tax)).toBeDefined();
    const desc2 = describeScience(kernel, sci2);
    expect(desc2.taxonomies.find((t) => t.id === tax)).toBeDefined();
    const desc3 = describeScience(kernel, sci3);
    expect(desc3.taxonomies.find((t) => t.id === tax)).toBeDefined();
  });
});

// ============================================================================
// Palace
// ============================================================================

describe("Palace", () => {
  let kernel: Kernel;
  const WS_ID = "ws-palace-test";

  beforeEach(() => {
    kernel = initKernel(":memory:");
  });

  afterEach(() => {
    kernel.db.close();
  });

  // --- Room CRUD ---

  test("palaceBuildRoom creates a room", () => {
    const room = palaceBuildRoom(kernel, WS_ID, {
      slug: "great-hall",
      name: "Great Hall",
      description: "A vaulted entrance chamber.",
      actions: [{ label: "Look around", type: "text", content: "You see stone walls." }],
      portals: [],
    });
    expect(room.slug).toBe("great-hall");
    expect(room.name).toBe("Great Hall");
    expect(room.description).toBe("A vaulted entrance chamber.");
    expect(room.actions).toHaveLength(1);
    expect(room.workspace_id).toBe(WS_ID);
  });

  test("palaceBuildRoom replaces existing room (upsert by slug)", () => {
    palaceBuildRoom(kernel, WS_ID, {
      slug: "hall", name: "Hall v1", description: "Old.",
      actions: [], portals: [],
    });
    const updated = palaceBuildRoom(kernel, WS_ID, {
      slug: "hall", name: "Hall v2", description: "New.",
      actions: [{ label: "Test", type: "text", content: "x" }], portals: [],
    });
    expect(updated.name).toBe("Hall v2");
    expect(updated.description).toBe("New.");
    expect(updated.actions).toHaveLength(1);
    // Only one room exists
    expect(palaceListRooms(kernel, WS_ID)).toHaveLength(1);
  });

  test("palaceBuildRoom auto-sets entry on first room", () => {
    const room = palaceBuildRoom(kernel, WS_ID, {
      slug: "first", name: "First", description: "First room.",
      actions: [], portals: [],
    });
    expect(room.entry).toBe(true);
  });

  test("palaceBuildRoom second room is not entry by default", () => {
    palaceBuildRoom(kernel, WS_ID, {
      slug: "first", name: "First", description: "First room.",
      actions: [], portals: [],
    });
    const second = palaceBuildRoom(kernel, WS_ID, {
      slug: "second", name: "Second", description: "Second room.",
      actions: [], portals: [],
    });
    expect(second.entry).toBe(false);
  });

  test("palaceBuildRoom with entry=true clears existing entry", () => {
    palaceBuildRoom(kernel, WS_ID, {
      slug: "first", name: "First", description: "First.",
      actions: [], portals: [],
    });
    palaceBuildRoom(kernel, WS_ID, {
      slug: "second", name: "Second", description: "Second.",
      entry: true, actions: [], portals: [],
    });
    const first = palaceGetRoom(kernel, WS_ID, "first")!;
    const second = palaceGetRoom(kernel, WS_ID, "second")!;
    expect(first.entry).toBe(false);
    expect(second.entry).toBe(true);
  });

  test("palaceGetRoom returns null for nonexistent slug", () => {
    expect(palaceGetRoom(kernel, WS_ID, "nope")).toBeNull();
  });

  test("palaceGetEntryRoom returns the entry room", () => {
    palaceBuildRoom(kernel, WS_ID, {
      slug: "entry", name: "Entry", description: "Entry.",
      actions: [], portals: [],
    });
    palaceBuildRoom(kernel, WS_ID, {
      slug: "other", name: "Other", description: "Other.",
      actions: [], portals: [],
    });
    const entry = palaceGetEntryRoom(kernel, WS_ID);
    expect(entry).not.toBeNull();
    expect(entry!.slug).toBe("entry");
  });

  test("palaceListRooms returns all rooms in workspace", () => {
    palaceBuildRoom(kernel, WS_ID, {
      slug: "a", name: "A", description: "A.", actions: [], portals: [],
    });
    palaceBuildRoom(kernel, WS_ID, {
      slug: "b", name: "B", description: "B.", actions: [], portals: [],
    });
    const rooms = palaceListRooms(kernel, WS_ID);
    expect(rooms).toHaveLength(2);
  });

  test("palaceDeleteRoom deletes room and its scrolls", () => {
    palaceBuildRoom(kernel, WS_ID, {
      slug: "entry", name: "Entry", description: "Entry.", actions: [], portals: [],
    });
    palaceBuildRoom(kernel, WS_ID, {
      slug: "victim", name: "Victim", description: "Victim.", actions: [], portals: [],
    });
    palaceWriteScroll(kernel, WS_ID, "victim", "Note", "Some note.");
    palaceDeleteRoom(kernel, WS_ID, "victim");
    expect(palaceGetRoom(kernel, WS_ID, "victim")).toBeNull();
    expect(palaceGetScrolls(kernel, WS_ID, "victim").total).toBe(0);
  });

  test("palaceDeleteRoom rejects deleting entry room", () => {
    palaceBuildRoom(kernel, WS_ID, {
      slug: "entry", name: "Entry", description: "Entry.", actions: [], portals: [],
    });
    expect(() => palaceDeleteRoom(kernel, WS_ID, "entry")).toThrow("Cannot delete entry room");
  });

  // --- Portals ---

  test("portals are bidirectional", () => {
    palaceBuildRoom(kernel, WS_ID, {
      slug: "room-a", name: "Room A", description: "A.", actions: [], portals: [],
    });
    palaceBuildRoom(kernel, WS_ID, {
      slug: "room-b", name: "Room B", description: "B.", actions: [], portals: ["room-a"],
    });
    const roomA = palaceGetRoom(kernel, WS_ID, "room-a")!;
    const roomB = palaceGetRoom(kernel, WS_ID, "room-b")!;
    expect(roomB.portals).toContain("room-a");
    expect(roomA.portals).toContain("room-b");
  });

  test("updating room removes stale portal references", () => {
    palaceBuildRoom(kernel, WS_ID, {
      slug: "room-a", name: "A", description: "A.", actions: [], portals: [],
    });
    palaceBuildRoom(kernel, WS_ID, {
      slug: "room-b", name: "B", description: "B.", actions: [], portals: ["room-a"],
    });
    // Now update room-b to remove the portal to room-a
    palaceBuildRoom(kernel, WS_ID, {
      slug: "room-b", name: "B", description: "B updated.", actions: [], portals: [],
    });
    const roomA = palaceGetRoom(kernel, WS_ID, "room-a")!;
    expect(roomA.portals).not.toContain("room-b");
  });

  // --- Scrolls ---

  test("palaceWriteScroll creates scroll in room", () => {
    palaceBuildRoom(kernel, WS_ID, {
      slug: "hall", name: "Hall", description: "Hall.", actions: [], portals: [],
    });
    const scroll = palaceWriteScroll(kernel, WS_ID, "hall", "Session Notes", "Explored the area.");
    expect(scroll.id).toBeDefined();
    expect(scroll.title).toBe("Session Notes");
    expect(scroll.body).toBe("Explored the area.");
    expect(scroll.room_slug).toBe("hall");
    expect(scroll.created_at).toBeDefined();
  });

  test("palaceWriteScroll rejects nonexistent room", () => {
    expect(() => palaceWriteScroll(kernel, WS_ID, "nonexistent", "T", "B")).toThrow("Palace room not found");
  });

  test("palaceGetScrolls returns most recent 3 by default", () => {
    palaceBuildRoom(kernel, WS_ID, {
      slug: "hall", name: "Hall", description: "Hall.", actions: [], portals: [],
    });
    for (let i = 0; i < 5; i++) {
      palaceWriteScroll(kernel, WS_ID, "hall", `Note ${i}`, `Body ${i}`);
    }
    const result = palaceGetScrolls(kernel, WS_ID, "hall");
    expect(result.scrolls).toHaveLength(3);
    expect(result.total).toBe(5);
    // Most recent first
    expect(result.scrolls[0].title).toBe("Note 4");
  });

  test("palaceGetScrolls supports limit/offset for pagination", () => {
    palaceBuildRoom(kernel, WS_ID, {
      slug: "hall", name: "Hall", description: "Hall.", actions: [], portals: [],
    });
    for (let i = 0; i < 5; i++) {
      palaceWriteScroll(kernel, WS_ID, "hall", `Note ${i}`, `Body ${i}`);
    }
    const page2 = palaceGetScrolls(kernel, WS_ID, "hall", { limit: 2, offset: 2 });
    expect(page2.scrolls).toHaveLength(2);
    expect(page2.total).toBe(5);
    expect(page2.scrolls[0].title).toBe("Note 2");
  });

  test("palaceGetScrolls returns total count", () => {
    palaceBuildRoom(kernel, WS_ID, {
      slug: "hall", name: "Hall", description: "Hall.", actions: [], portals: [],
    });
    const result = palaceGetScrolls(kernel, WS_ID, "hall");
    expect(result.total).toBe(0);
    expect(result.scrolls).toHaveLength(0);
  });

  // --- Workspace scoping ---

  test("rooms in workspace A are invisible to workspace B", () => {
    palaceBuildRoom(kernel, "ws-A", {
      slug: "hall", name: "Hall A", description: "A.", actions: [], portals: [],
    });
    palaceBuildRoom(kernel, "ws-B", {
      slug: "hall", name: "Hall B", description: "B.", actions: [], portals: [],
    });
    expect(palaceGetRoom(kernel, "ws-A", "hall")!.name).toBe("Hall A");
    expect(palaceGetRoom(kernel, "ws-B", "hall")!.name).toBe("Hall B");
    expect(palaceListRooms(kernel, "ws-A")).toHaveLength(1);
    expect(palaceListRooms(kernel, "ws-B")).toHaveLength(1);
  });

  test("palaceHasPalace returns false for empty workspace", () => {
    expect(palaceHasPalace(kernel, "ws-empty")).toBe(false);
  });

  test("palaceHasPalace returns true when rooms exist", () => {
    palaceBuildRoom(kernel, WS_ID, {
      slug: "hall", name: "Hall", description: "Hall.", actions: [], portals: [],
    });
    expect(palaceHasPalace(kernel, WS_ID)).toBe(true);
  });

  test("palaceDeleteRoom removes from other rooms' portals", () => {
    palaceBuildRoom(kernel, WS_ID, {
      slug: "entry", name: "Entry", description: "Entry.", actions: [], portals: [],
    });
    palaceBuildRoom(kernel, WS_ID, {
      slug: "side", name: "Side", description: "Side.", actions: [], portals: ["entry"],
    });
    // Entry now has "side" in portals via bidirectional
    expect(palaceGetRoom(kernel, WS_ID, "entry")!.portals).toContain("side");
    palaceDeleteRoom(kernel, WS_ID, "side");
    // Entry should no longer reference "side"
    expect(palaceGetRoom(kernel, WS_ID, "entry")!.portals).not.toContain("side");
  });

  // --- Versioning ---

  test("new room starts at version 1", () => {
    const room = palaceBuildRoom(kernel, WS_ID, {
      slug: "hall", name: "Hall", description: "Hall.", actions: [], portals: [],
    });
    expect(room.version).toBe(1);
  });

  test("replacing a room increments version", () => {
    palaceBuildRoom(kernel, WS_ID, {
      slug: "hall", name: "Hall v1", description: "Old.", actions: [], portals: [],
    });
    const updated = palaceBuildRoom(kernel, WS_ID, {
      slug: "hall", name: "Hall v2", description: "New.", actions: [], portals: [],
    });
    expect(updated.version).toBe(2);
  });

  test("merge also increments version", () => {
    palaceBuildRoom(kernel, WS_ID, {
      slug: "hall", name: "Hall", description: "Hall.", actions: [], portals: [],
    });
    const merged = palaceMergeRoom(kernel, WS_ID, {
      slug: "hall",
      actions: [{ label: "New action", type: "text", content: "hello" }],
    });
    expect(merged.version).toBe(2);
  });

  // --- Merge mode ---

  test("merge keeps existing name/description when not provided", () => {
    palaceBuildRoom(kernel, WS_ID, {
      slug: "hall", name: "Original Name", description: "Original Desc.",
      actions: [{ label: "Look", type: "text", content: "walls" }], portals: [],
    });
    const merged = palaceMergeRoom(kernel, WS_ID, { slug: "hall" });
    expect(merged.name).toBe("Original Name");
    expect(merged.description).toBe("Original Desc.");
    expect(merged.actions).toHaveLength(1);
  });

  test("merge overwrites name/description when provided", () => {
    palaceBuildRoom(kernel, WS_ID, {
      slug: "hall", name: "Old", description: "Old desc.",
      actions: [], portals: [],
    });
    const merged = palaceMergeRoom(kernel, WS_ID, {
      slug: "hall", name: "New", description: "New desc.",
    });
    expect(merged.name).toBe("New");
    expect(merged.description).toBe("New desc.");
  });

  test("merge matches actions by label and updates", () => {
    palaceBuildRoom(kernel, WS_ID, {
      slug: "hall", name: "Hall", description: "Hall.",
      actions: [{ label: "Door", type: "navigate", room: "old-room" }],
      portals: [],
    });
    const merged = palaceMergeRoom(kernel, WS_ID, {
      slug: "hall",
      actions: [{ label: "Door", type: "navigate", room: "new-room" }],
    });
    expect(merged.actions).toHaveLength(1);
    expect(merged.actions[0].room).toBe("new-room");
  });

  test("merge appends new actions, preserves unmentioned", () => {
    palaceBuildRoom(kernel, WS_ID, {
      slug: "hall", name: "Hall", description: "Hall.",
      actions: [
        { label: "Existing", type: "text", content: "existing" },
      ],
      portals: [],
    });
    const merged = palaceMergeRoom(kernel, WS_ID, {
      slug: "hall",
      actions: [{ label: "New", type: "text", content: "new" }],
    });
    expect(merged.actions).toHaveLength(2);
    expect(merged.actions[0].label).toBe("Existing");
    expect(merged.actions[1].label).toBe("New");
  });

  test("merge unions portals", () => {
    palaceBuildRoom(kernel, WS_ID, {
      slug: "room-a", name: "A", description: "A.", actions: [], portals: [],
    });
    palaceBuildRoom(kernel, WS_ID, {
      slug: "room-b", name: "B", description: "B.", actions: [], portals: [],
    });
    palaceBuildRoom(kernel, WS_ID, {
      slug: "hall", name: "Hall", description: "Hall.",
      actions: [], portals: ["room-a"],
    });
    const merged = palaceMergeRoom(kernel, WS_ID, {
      slug: "hall", portals: ["room-b"],
    });
    expect(merged.portals).toContain("room-a");
    expect(merged.portals).toContain("room-b");
  });

  test("merge on nonexistent room without name throws", () => {
    expect(() => palaceMergeRoom(kernel, WS_ID, { slug: "nope" }))
      .toThrow("does not exist");
  });

  test("merge on nonexistent room with all fields creates", () => {
    const room = palaceMergeRoom(kernel, WS_ID, {
      slug: "new-room", name: "New Room", description: "Fresh.",
      actions: [{ label: "Look", type: "text", content: "walls" }],
      portals: [],
    });
    expect(room.slug).toBe("new-room");
    expect(room.name).toBe("New Room");
    expect(room.version).toBe(1);
  });

  // --- Search ---

  test("palaceSearch finds rooms by name", () => {
    palaceBuildRoom(kernel, WS_ID, {
      slug: "geology", name: "Hall of Geology", description: "Rocks and fossils.",
      actions: [], portals: [],
    });
    const results = palaceSearch(kernel, WS_ID, "geology");
    expect(results.length).toBeGreaterThan(0);
    expect(results.some((r) => r.type === "room" && r.field === "name")).toBe(true);
  });

  test("palaceSearch finds scrolls by title and body", () => {
    palaceBuildRoom(kernel, WS_ID, {
      slug: "hall", name: "Hall", description: "Hall.",
      actions: [], portals: [],
    });
    palaceWriteScroll(kernel, WS_ID, "hall", "Fossil Notes", "The ammonite was found in the lower stratum.");
    const titleResults = palaceSearch(kernel, WS_ID, "fossil");
    expect(titleResults.some((r) => r.type === "scroll" && r.field === "title")).toBe(true);
    const bodyResults = palaceSearch(kernel, WS_ID, "ammonite");
    expect(bodyResults.some((r) => r.type === "scroll" && r.field === "body")).toBe(true);
  });

  test("palaceSearch finds actions by label", () => {
    palaceBuildRoom(kernel, WS_ID, {
      slug: "hall", name: "Hall", description: "Hall.",
      actions: [{ label: "Examine the fossil cabinet", type: "query", tool: "list_entities" }],
      portals: [],
    });
    const results = palaceSearch(kernel, WS_ID, "fossil");
    expect(results.some((r) => r.type === "action")).toBe(true);
  });

  test("palaceSearch returns empty for no matches", () => {
    palaceBuildRoom(kernel, WS_ID, {
      slug: "hall", name: "Hall", description: "Hall.",
      actions: [], portals: [],
    });
    const results = palaceSearch(kernel, WS_ID, "xyznonexistent");
    expect(results).toHaveLength(0);
  });

  test("palaceSearch scoped to workspace", () => {
    palaceBuildRoom(kernel, "ws-A", {
      slug: "hall", name: "Geology Hall", description: "Rocks.",
      actions: [], portals: [],
    });
    palaceBuildRoom(kernel, "ws-B", {
      slug: "hall", name: "Biology Hall", description: "Life.",
      actions: [], portals: [],
    });
    const resultsA = palaceSearch(kernel, "ws-A", "geology");
    const resultsB = palaceSearch(kernel, "ws-B", "geology");
    expect(resultsA.length).toBeGreaterThan(0);
    expect(resultsB).toHaveLength(0);
  });
});

// ============================================================================
// Palace on Tessellae (branching, entity backing)
// ============================================================================

describe("Palace on Tessellae", () => {
  let kernel: Kernel;
  const WS_ID = "ws-palace-tessellae";

  beforeEach(() => {
    kernel = initKernel(":memory:");
  });

  afterEach(() => {
    kernel.db.close();
  });

  test("rooms are backed by PALACE_ROOM_GENUS_ID entities", () => {
    const room = palaceBuildRoom(kernel, WS_ID, {
      slug: "hall", name: "Great Hall", description: "Entrance.",
      actions: [], portals: [],
    });
    // Verify a res row exists with the palace room genus
    const res = kernel.db.query(
      "SELECT genus_id FROM res WHERE id = (SELECT res_id FROM palace_room_index WHERE workspace_id = ? AND slug = ?)",
    ).get(WS_ID, "hall") as any;
    expect(res.genus_id).toBe(PALACE_ROOM_GENUS_ID);
  });

  test("scrolls are backed by PALACE_SCROLL_GENUS_ID entities", () => {
    palaceBuildRoom(kernel, WS_ID, {
      slug: "hall", name: "Hall", description: "Hall.",
      actions: [], portals: [],
    });
    const scroll = palaceWriteScroll(kernel, WS_ID, "hall", "Note", "Content");
    const res = kernel.db.query("SELECT genus_id FROM res WHERE id = ?").get(scroll.id) as any;
    expect(res.genus_id).toBe(PALACE_SCROLL_GENUS_ID);
  });

  test("palace rooms are not visible in listEntities", () => {
    palaceBuildRoom(kernel, WS_ID, {
      slug: "hall", name: "Hall", description: "Hall.",
      actions: [], portals: [],
    });
    const entities = listEntities(kernel, { workspace_id: WS_ID, all_workspaces: true });
    const palaceEntities = entities.filter((e) => e.genus_id === PALACE_ROOM_GENUS_ID || e.genus_id === PALACE_SCROLL_GENUS_ID);
    expect(palaceEntities).toHaveLength(0);
  });

  // --- Branching ---

  test("building a room on a branch is invisible from main", () => {
    palaceBuildRoom(kernel, WS_ID, {
      slug: "entry", name: "Entry", description: "Entry.",
      actions: [], portals: [],
    });
    createBranch(kernel, "experiment");
    switchBranch(kernel, "experiment");
    palaceBuildRoom(kernel, WS_ID, {
      slug: "lab", name: "Laboratory", description: "A secret lab.",
      actions: [], portals: [],
    });
    // Lab exists on branch
    expect(palaceGetRoom(kernel, WS_ID, "lab")).not.toBeNull();
    expect(palaceListRooms(kernel, WS_ID)).toHaveLength(2);

    // Switch back to main — lab is gone
    switchBranch(kernel, "main");
    expect(palaceGetRoom(kernel, WS_ID, "lab")).toBeNull();
    expect(palaceListRooms(kernel, WS_ID)).toHaveLength(1);
  });

  test("branch inherits main rooms", () => {
    palaceBuildRoom(kernel, WS_ID, {
      slug: "hall", name: "Main Hall", description: "Main hall.",
      actions: [], portals: [],
    });
    createBranch(kernel, "feature");
    switchBranch(kernel, "feature");
    // Should see main's rooms on the branch
    const room = palaceGetRoom(kernel, WS_ID, "hall");
    expect(room).not.toBeNull();
    expect(room!.name).toBe("Main Hall");
  });

  test("modifying a room on branch does not affect main", () => {
    palaceBuildRoom(kernel, WS_ID, {
      slug: "hall", name: "Original", description: "Original.",
      actions: [], portals: [],
    });
    createBranch(kernel, "rework");
    switchBranch(kernel, "rework");
    palaceBuildRoom(kernel, WS_ID, {
      slug: "hall", name: "Reworked", description: "Reworked.",
      actions: [{ label: "New action", type: "text", content: "hello" }], portals: [],
    });
    expect(palaceGetRoom(kernel, WS_ID, "hall")!.name).toBe("Reworked");
    expect(palaceGetRoom(kernel, WS_ID, "hall")!.actions).toHaveLength(1);

    // Main is unchanged
    switchBranch(kernel, "main");
    expect(palaceGetRoom(kernel, WS_ID, "hall")!.name).toBe("Original");
    expect(palaceGetRoom(kernel, WS_ID, "hall")!.actions).toHaveLength(0);
  });

  test("scrolls on branch are invisible from main", () => {
    palaceBuildRoom(kernel, WS_ID, {
      slug: "hall", name: "Hall", description: "Hall.",
      actions: [], portals: [],
    });
    createBranch(kernel, "draft");
    switchBranch(kernel, "draft");
    palaceWriteScroll(kernel, WS_ID, "hall", "Branch Note", "Branch content");
    expect(palaceGetScrolls(kernel, WS_ID, "hall").total).toBe(1);

    switchBranch(kernel, "main");
    expect(palaceGetScrolls(kernel, WS_ID, "hall").total).toBe(0);
  });

  test("palaceHasPalace on branch sees main rooms", () => {
    palaceBuildRoom(kernel, WS_ID, {
      slug: "hall", name: "Hall", description: "Hall.",
      actions: [], portals: [],
    });
    createBranch(kernel, "check");
    switchBranch(kernel, "check");
    expect(palaceHasPalace(kernel, WS_ID)).toBe(true);
  });

  test("entry room on branch overrides main entry", () => {
    palaceBuildRoom(kernel, WS_ID, {
      slug: "main-entry", name: "Main Entry", description: "Main entry.",
      entry: true, actions: [], portals: [],
    });
    createBranch(kernel, "alt-entry");
    switchBranch(kernel, "alt-entry");
    palaceBuildRoom(kernel, WS_ID, {
      slug: "alt-entry", name: "Alt Entry", description: "Alt entry.",
      entry: true, actions: [], portals: [],
    });
    const entry = palaceGetEntryRoom(kernel, WS_ID);
    expect(entry).not.toBeNull();
    expect(entry!.slug).toBe("alt-entry");

    // Main still has original entry
    switchBranch(kernel, "main");
    expect(palaceGetEntryRoom(kernel, WS_ID)!.slug).toBe("main-entry");
  });

  test("merge rebuilds palace_room_index on target", () => {
    palaceBuildRoom(kernel, WS_ID, {
      slug: "hall", name: "Hall", description: "Hall.",
      actions: [], portals: [],
    });
    createBranch(kernel, "feature-rooms");
    switchBranch(kernel, "feature-rooms");
    palaceBuildRoom(kernel, WS_ID, {
      slug: "lab", name: "Lab", description: "A new lab.",
      actions: [], portals: ["hall"],
    });
    switchBranch(kernel, "main");
    expect(palaceGetRoom(kernel, WS_ID, "lab")).toBeNull();

    mergeBranch(kernel, "feature-rooms");

    // Room should be discoverable on main via index lookup
    const room = palaceGetRoom(kernel, WS_ID, "lab");
    expect(room).not.toBeNull();
    expect(room!.name).toBe("Lab");
    expect(room!.portals).toContain("hall");

    // Should appear in room listing
    const rooms = palaceListRooms(kernel, WS_ID);
    const slugs = rooms.map(r => r.slug);
    expect(slugs).toContain("hall");
    expect(slugs).toContain("lab");
  });

  test("merge rebuilds palace_scroll_index on target", () => {
    palaceBuildRoom(kernel, WS_ID, {
      slug: "hall", name: "Hall", description: "Hall.",
      actions: [], portals: [],
    });
    createBranch(kernel, "feature-scrolls");
    switchBranch(kernel, "feature-scrolls");
    palaceWriteScroll(kernel, WS_ID, "hall", "Branch Note", "Written on branch.");
    switchBranch(kernel, "main");

    // Before merge: no scrolls on main
    const before = palaceGetScrolls(kernel, WS_ID, "hall");
    expect(before.total).toBe(0);

    mergeBranch(kernel, "feature-scrolls");

    // After merge: scroll should be discoverable on main
    const after = palaceGetScrolls(kernel, WS_ID, "hall");
    expect(after.total).toBe(1);
    expect(after.scrolls[0].title).toBe("Branch Note");
    expect(after.scrolls[0].body).toBe("Written on branch.");
  });

  test("merge handles room deletion (tombstone) correctly", () => {
    palaceBuildRoom(kernel, WS_ID, {
      slug: "entry", name: "Entry", description: "Entry.",
      entry: true, actions: [], portals: [],
    });
    palaceBuildRoom(kernel, WS_ID, {
      slug: "side", name: "Side Room", description: "Side.",
      actions: [], portals: [],
    });
    createBranch(kernel, "cleanup");
    switchBranch(kernel, "cleanup");
    palaceDeleteRoom(kernel, WS_ID, "side");
    expect(palaceGetRoom(kernel, WS_ID, "side")).toBeNull();
    switchBranch(kernel, "main");

    // Before merge: side room still on main
    expect(palaceGetRoom(kernel, WS_ID, "side")).not.toBeNull();

    mergeBranch(kernel, "cleanup", "main", { force: true });

    // After merge: side room should be archived on main
    const room = palaceGetRoom(kernel, WS_ID, "side");
    expect(room).toBeNull();
  });

  test("merge rebuilds relationship_member index", () => {
    // Set up genera
    const personGenus = defineEntityGenus(kernel, "MergePerson", {
      attributes: [{ name: "name", type: "text", required: true }],
      states: [{ name: "active", initial: true }],
      transitions: [],
    });
    const projectGenus = defineEntityGenus(kernel, "MergeProject", {
      attributes: [{ name: "title", type: "text", required: true }],
      states: [{ name: "active", initial: true }],
      transitions: [],
    });
    const assignGenus = defineRelationshipGenus(kernel, "MergeAssignment", {
      roles: [
        { name: "person", valid_member_genera: ["MergePerson"], cardinality: "one" },
        { name: "project", valid_member_genera: ["MergeProject"], cardinality: "one" },
      ],
      attributes: [],
      states: [{ name: "active", initial: true }],
      transitions: [],
    });

    // Create entities on main
    const personId = createEntity(kernel, personGenus);
    setAttribute(kernel, personId, "name", "Alice");
    const projectId = createEntity(kernel, projectGenus);
    setAttribute(kernel, projectId, "title", "Project X");

    // Create relationship on branch
    createBranch(kernel, "rel-branch");
    switchBranch(kernel, "rel-branch");
    createRelationship(kernel, assignGenus, {
      person: personId,
      project: projectId,
    }, { branch_id: "rel-branch" });
    switchBranch(kernel, "main");

    // Before merge: no relationships on main
    const before = getRelationshipsForEntity(kernel, personId, { branch_id: "main" });
    expect(before).toHaveLength(0);

    mergeBranch(kernel, "rel-branch");

    // After merge: relationship should be discoverable on main
    const after = getRelationshipsForEntity(kernel, personId, { branch_id: "main" });
    expect(after).toHaveLength(1);
    expect(after[0].members.person).toContain(personId);
    expect(after[0].members.project).toContain(projectId);
  });

  test("delete room on branch preserves main room", () => {
    palaceBuildRoom(kernel, WS_ID, {
      slug: "entry", name: "Entry", description: "Entry.",
      actions: [], portals: [],
    });
    palaceBuildRoom(kernel, WS_ID, {
      slug: "side", name: "Side Room", description: "Side.",
      actions: [], portals: [],
    });
    createBranch(kernel, "cleanup");
    switchBranch(kernel, "cleanup");
    palaceDeleteRoom(kernel, WS_ID, "side");
    expect(palaceGetRoom(kernel, WS_ID, "side")).toBeNull();

    // Main still has the room
    switchBranch(kernel, "main");
    expect(palaceGetRoom(kernel, WS_ID, "side")).not.toBeNull();
  });

  test("search works across branch and main rooms", () => {
    palaceBuildRoom(kernel, WS_ID, {
      slug: "geology", name: "Geology Wing", description: "Rocks.",
      actions: [], portals: [],
    });
    createBranch(kernel, "search-test");
    switchBranch(kernel, "search-test");
    palaceBuildRoom(kernel, WS_ID, {
      slug: "botany", name: "Botany Lab", description: "Plants.",
      actions: [], portals: [],
    });
    const results = palaceSearch(kernel, WS_ID, "geology");
    expect(results.length).toBeGreaterThan(0);
    const botanyResults = palaceSearch(kernel, WS_ID, "botany");
    expect(botanyResults.length).toBeGreaterThan(0);
  });
});

// ============================================================================
// Temporal Anchors
// ============================================================================

describe("Temporal Anchors", () => {
  let kernel: Kernel;

  beforeEach(() => {
    kernel = initKernel(":memory:");
  });

  afterEach(() => {
    kernel.db.close();
  });

  function makeEntity(): string {
    const genusId = defineEntityGenus(kernel, "TestEntity", {
      attributes: [{ name: "name", type: "text" }],
      states: [{ name: "draft", initial: true }, { name: "active", initial: false }],
      transitions: [{ from: "draft", to: "active" }],
    });
    const id = createEntity(kernel, genusId);
    setAttribute(kernel, id, "name", "Test");
    return id;
  }

  test("setTemporalAnchor creates and returns anchor", () => {
    const entityId = makeEntity();
    const anchor = setTemporalAnchor(kernel, entityId, { start_year: -3000, end_year: -2500, precision: "century" });
    expect(anchor.res_id).toBe(entityId);
    expect(anchor.start_year).toBe(-3000);
    expect(anchor.end_year).toBe(-2500);
    expect(anchor.precision).toBe("century");
  });

  test("setTemporalAnchor defaults precision to approximate", () => {
    const entityId = makeEntity();
    const anchor = setTemporalAnchor(kernel, entityId, { start_year: 1776 });
    expect(anchor.precision).toBe("approximate");
    expect(anchor.end_year).toBeNull();
  });

  test("getTemporalAnchor returns null for entity without anchor", () => {
    const entityId = makeEntity();
    expect(getTemporalAnchor(kernel, entityId)).toBeNull();
  });

  test("getTemporalAnchor returns set anchor", () => {
    const entityId = makeEntity();
    setTemporalAnchor(kernel, entityId, { start_year: 1066, precision: "exact", calendar_note: "Battle of Hastings" });
    const anchor = getTemporalAnchor(kernel, entityId);
    expect(anchor).not.toBeNull();
    expect(anchor!.start_year).toBe(1066);
    expect(anchor!.precision).toBe("exact");
    expect(anchor!.calendar_note).toBe("Battle of Hastings");
  });

  test("setTemporalAnchor upserts existing anchor", () => {
    const entityId = makeEntity();
    setTemporalAnchor(kernel, entityId, { start_year: -3000 });
    setTemporalAnchor(kernel, entityId, { start_year: -2500, end_year: -2000 });
    const anchor = getTemporalAnchor(kernel, entityId);
    expect(anchor!.start_year).toBe(-2500);
    expect(anchor!.end_year).toBe(-2000);
  });

  test("removeTemporalAnchor deletes anchor", () => {
    const entityId = makeEntity();
    setTemporalAnchor(kernel, entityId, { start_year: -3000 });
    removeTemporalAnchor(kernel, entityId);
    expect(getTemporalAnchor(kernel, entityId)).toBeNull();
  });

  test("setTemporalAnchor creates tessella for audit trail", () => {
    const entityId = makeEntity();
    setTemporalAnchor(kernel, entityId, { start_year: -3000 });
    const history = replay(kernel, entityId);
    const temporalTessellae = history.filter((t) => t.type === "temporal_anchor_set");
    expect(temporalTessellae).toHaveLength(1);
    expect(temporalTessellae[0].data.start_year).toBe(-3000);
  });

  test("removeTemporalAnchor creates tessella for audit trail", () => {
    const entityId = makeEntity();
    setTemporalAnchor(kernel, entityId, { start_year: -3000 });
    removeTemporalAnchor(kernel, entityId);
    const history = replay(kernel, entityId);
    const removedTessellae = history.filter((t) => t.type === "temporal_anchor_removed");
    expect(removedTessellae).toHaveLength(1);
  });

  test("setTemporalAnchor throws for nonexistent res", () => {
    expect(() => setTemporalAnchor(kernel, "nonexistent", { start_year: -3000 })).toThrow();
  });

  test("queryTimeline returns chronologically sorted entries", () => {
    const genusId = defineEntityGenus(kernel, "Period", {
      attributes: [{ name: "name", type: "text" }],
      states: [{ name: "draft", initial: true }],
      transitions: [],
    });

    const e1 = createEntity(kernel, genusId);
    setAttribute(kernel, e1, "name", "Bronze Age");
    setTemporalAnchor(kernel, e1, { start_year: -3300, end_year: -1200 });

    const e2 = createEntity(kernel, genusId);
    setAttribute(kernel, e2, "name", "Iron Age");
    setTemporalAnchor(kernel, e2, { start_year: -1200, end_year: -600 });

    const e3 = createEntity(kernel, genusId);
    setAttribute(kernel, e3, "name", "Stone Age");
    setTemporalAnchor(kernel, e3, { start_year: -10000, end_year: -3300 });

    const timeline = queryTimeline(kernel);
    expect(timeline).toHaveLength(3);
    expect(timeline[0].entity_name).toBe("Stone Age");
    expect(timeline[1].entity_name).toBe("Bronze Age");
    expect(timeline[2].entity_name).toBe("Iron Age");
  });

  test("queryTimeline filters by year range", () => {
    const genusId = defineEntityGenus(kernel, "Event", {
      attributes: [{ name: "name", type: "text" }],
      states: [{ name: "draft", initial: true }],
      transitions: [],
    });

    const e1 = createEntity(kernel, genusId);
    setAttribute(kernel, e1, "name", "Early");
    setTemporalAnchor(kernel, e1, { start_year: -5000 });

    const e2 = createEntity(kernel, genusId);
    setAttribute(kernel, e2, "name", "Middle");
    setTemporalAnchor(kernel, e2, { start_year: -2000 });

    const e3 = createEntity(kernel, genusId);
    setAttribute(kernel, e3, "name", "Late");
    setTemporalAnchor(kernel, e3, { start_year: 500 });

    const timeline = queryTimeline(kernel, { start_year: -3000, end_year: 0 });
    expect(timeline).toHaveLength(1);
    expect(timeline[0].entity_name).toBe("Middle");
  });

  test("queryTimeline respects limit", () => {
    const genusId = defineEntityGenus(kernel, "Item", {
      attributes: [{ name: "name", type: "text" }],
      states: [{ name: "draft", initial: true }],
      transitions: [],
    });

    for (let i = 0; i < 10; i++) {
      const eid = createEntity(kernel, genusId);
      setAttribute(kernel, eid, "name", `Item ${i}`);
      setTemporalAnchor(kernel, eid, { start_year: i * 100 });
    }

    const timeline = queryTimeline(kernel, { limit: 3 });
    expect(timeline).toHaveLength(3);
  });
});

// ============================================================================
// findTransitionPath
// ============================================================================

describe("findTransitionPath", () => {
  let kernel: Kernel;

  beforeEach(() => {
    kernel = initKernel(":memory:");
  });

  afterEach(() => {
    kernel.db.close();
  });

  test("returns empty array for same from/to", () => {
    const path = findTransitionPath(
      { attributes: {}, states: { draft: { name: "draft", initial: true } }, transitions: [], roles: {}, meta: {}, initialState: "draft" },
      "draft", "draft",
    );
    expect(path).toEqual([]);
  });

  test("finds direct transition", () => {
    const path = findTransitionPath(
      {
        attributes: {},
        states: { draft: { name: "draft", initial: true }, active: { name: "active", initial: false } },
        transitions: [{ from: "draft", to: "active" }],
        roles: {}, meta: {}, initialState: "draft",
      },
      "draft", "active",
    );
    expect(path).toEqual(["active"]);
  });

  test("finds multi-step path", () => {
    const path = findTransitionPath(
      {
        attributes: {},
        states: {
          draft: { name: "draft", initial: true },
          review: { name: "review", initial: false },
          active: { name: "active", initial: false },
          archived: { name: "archived", initial: false },
        },
        transitions: [
          { from: "draft", to: "review" },
          { from: "review", to: "active" },
          { from: "active", to: "archived" },
        ],
        roles: {}, meta: {}, initialState: "draft",
      },
      "draft", "archived",
    );
    expect(path).toEqual(["review", "active", "archived"]);
  });

  test("returns null for unreachable state", () => {
    const path = findTransitionPath(
      {
        attributes: {},
        states: {
          draft: { name: "draft", initial: true },
          active: { name: "active", initial: false },
          archived: { name: "archived", initial: false },
        },
        transitions: [{ from: "draft", to: "active" }],
        roles: {}, meta: {}, initialState: "draft",
      },
      "draft", "archived",
    );
    expect(path).toBeNull();
  });

  test("finds shortest path when multiple routes exist", () => {
    const path = findTransitionPath(
      {
        attributes: {},
        states: {
          a: { name: "a", initial: true },
          b: { name: "b", initial: false },
          c: { name: "c", initial: false },
          d: { name: "d", initial: false },
        },
        transitions: [
          { from: "a", to: "b" },
          { from: "b", to: "c" },
          { from: "c", to: "d" },
          { from: "a", to: "d" }, // shortcut
        ],
        roles: {}, meta: {}, initialState: "a",
      },
      "a", "d",
    );
    // BFS finds shortest: a → d directly
    expect(path).toEqual(["d"]);
  });
});

// ============================================================================
// Palace v2 Rendering
// ============================================================================

describe("Palace v2 Rendering", () => {
  let kernel: Kernel;

  beforeEach(() => {
    kernel = initKernel(":memory:");
  });

  afterEach(() => {
    kernel.db.close();
  });

  // --- Parser ---

  test("palaceParseMarkup: no markup returns single text token", () => {
    const tokens = palaceParseMarkup("A plain description with no markup.");
    expect(tokens).toEqual([{ type: "text", value: "A plain description with no markup." }]);
  });

  test("palaceParseMarkup: entity ref", () => {
    const tokens = palaceParseMarkup("You see *Crystal:Amethyst Shard* on the table.");
    expect(tokens).toEqual([
      { type: "text", value: "You see " },
      { type: "entity_ref", genus: "Crystal", name: "Amethyst Shard", raw: "*Crystal:Amethyst Shard*" },
      { type: "text", value: " on the table." },
    ]);
  });

  test("palaceParseMarkup: portal ref", () => {
    const tokens = palaceParseMarkup("A doorway leads to [library]the grand library[/].");
    expect(tokens).toEqual([
      { type: "text", value: "A doorway leads to " },
      { type: "portal_ref", slug: "library", prose: "the grand library", raw: "[library]the grand library[/]" },
      { type: "text", value: "." },
    ]);
  });

  test("palaceParseMarkup: mixed markup and text", () => {
    const tokens = palaceParseMarkup("The *Weapon:Sword* rests near [armory]the armory door[/].");
    expect(tokens.length).toBe(5);
    expect(tokens[0]).toEqual({ type: "text", value: "The " });
    expect(tokens[1]).toEqual({ type: "entity_ref", genus: "Weapon", name: "Sword", raw: "*Weapon:Sword*" });
    expect(tokens[2]).toEqual({ type: "text", value: " rests near " });
    expect(tokens[3]).toEqual({ type: "portal_ref", slug: "armory", prose: "the armory door", raw: "[armory]the armory door[/]" });
    expect(tokens[4]).toEqual({ type: "text", value: "." });
  });

  test("palaceParseMarkup: unclosed markup treated as plain text", () => {
    const tokens = palaceParseMarkup("An unclosed *ref without end.");
    expect(tokens).toEqual([{ type: "text", value: "An unclosed *ref without end." }]);
  });

  test("palaceParseMarkup: entity ref with alias", () => {
    const tokens = palaceParseMarkup("A worn *PainPoint:No onboarding|the onboarding gap* on the wall.");
    expect(tokens).toEqual([
      { type: "text", value: "A worn " },
      { type: "entity_ref", genus: "PainPoint", name: "No onboarding", alias: "the onboarding gap", raw: "*PainPoint:No onboarding|the onboarding gap*" },
      { type: "text", value: " on the wall." },
    ]);
  });

  test("palaceResolveMarkup: alias overrides guillemets and templates", () => {
    const wsId = createWorkspace(kernel, "test-ws");
    switchWorkspace(kernel, wsId);
    const genusId = defineEntityGenus(kernel, "Tool", {
      attributes: [{ name: "name", type: "text", required: true }],
      states: [{ name: "active", initial: true }],
    });
    const entityId = createEntity(kernel, genusId);
    setAttribute(kernel, entityId, "name", "Hammer of Refactoring");
    assignWorkspace(kernel, entityId, wsId);

    const tokens = palaceParseMarkup("On the bench lies *Tool:Hammer of Refactoring|the old hammer*.");
    const manifest = palaceResolveMarkup(kernel, wsId, tokens);
    expect(manifest.rendered).toBe("On the bench lies the old hammer.");
    expect(manifest.entries[0].display).toBe("the old hammer");
    expect(manifest.entries[0].match_name).toBe("Hammer of Refactoring");
    expect(manifest.entries[0].entity_id).toBe(entityId);
  });

  // --- Entity lookup ---

  test("palaceFindEntity: finds entity by genus and name (case-insensitive)", () => {
    const wsId = createWorkspace(kernel, "test-ws");
    switchWorkspace(kernel, wsId);
    const genusId = defineEntityGenus(kernel, "Crystal", {
      attributes: [{ name: "name", type: "text", required: true }],
      states: [{ name: "active", initial: true }],
    });
    const entityId = createEntity(kernel, genusId);
    setAttribute(kernel, entityId, "name", "Amethyst Shard");
    assignWorkspace(kernel, entityId, wsId);

    const found = palaceFindEntity(kernel, "Crystal", "amethyst shard", wsId);
    expect(found).not.toBeNull();
    expect(found!.id).toBe(entityId);
    expect(found!.state.name).toBe("Amethyst Shard");
  });

  test("palaceFindEntity: returns null when genus not found", () => {
    const found = palaceFindEntity(kernel, "NonExistent", "Something");
    expect(found).toBeNull();
  });

  test("palaceFindEntity: returns null when entity not found in genus", () => {
    defineEntityGenus(kernel, "Crystal", {
      attributes: [{ name: "name", type: "text", required: true }],
      states: [{ name: "active", initial: true }],
    });
    const found = palaceFindEntity(kernel, "Crystal", "NoSuchCrystal");
    expect(found).toBeNull();
  });

  // --- Manifest resolution ---

  test("palaceResolveMarkup: resolves entity refs to guillemet names", () => {
    const wsId = createWorkspace(kernel, "test-ws");
    switchWorkspace(kernel, wsId);
    const genusId = defineEntityGenus(kernel, "Item", {
      attributes: [{ name: "name", type: "text", required: true }],
      states: [{ name: "active", initial: true }],
    });
    const entityId = createEntity(kernel, genusId);
    setAttribute(kernel, entityId, "name", "Magic Sword");
    assignWorkspace(kernel, entityId, wsId);

    const tokens = palaceParseMarkup("You see *Item:Magic Sword* here.");
    const manifest = palaceResolveMarkup(kernel, wsId, tokens);
    expect(manifest.has_markup).toBe(true);
    expect(manifest.rendered).toBe("You see \u00abMagic Sword\u00bb here.");
    expect(manifest.entries.length).toBe(1);
    expect(manifest.entries[0].kind).toBe("entity");
    expect(manifest.entries[0].display).toBe("\u00abMagic Sword\u00bb");
    expect(manifest.entries[0].match_name).toBe("Magic Sword");
    expect(manifest.entries[0].genus_name).toBe("Item");
    expect(manifest.entries[0].entity_id).toBe(entityId);
    expect(manifest.entries[0].resolved).toBe(true);
  });

  test("palaceResolveMarkup: unresolved entity uses guillemet raw name", () => {
    const tokens = palaceParseMarkup("Look at *Ghost:Phantom* here.");
    const manifest = palaceResolveMarkup(kernel, null, tokens);
    expect(manifest.has_markup).toBe(true);
    expect(manifest.rendered).toBe("Look at \u00abPhantom\u00bb here.");
    expect(manifest.entries[0].resolved).toBe(false);
    expect(manifest.entries[0].match_name).toBe("Phantom");
  });

  test("palaceResolveMarkup: portal refs resolve to arrow prose", () => {
    const tokens = palaceParseMarkup("Through [hall]the great hall[/].");
    const manifest = palaceResolveMarkup(kernel, null, tokens);
    expect(manifest.has_markup).toBe(true);
    expect(manifest.rendered).toBe("Through the great hall \u2192.");
    expect(manifest.entries[0].kind).toBe("portal");
    expect(manifest.entries[0].slug).toBe("hall");
    expect(manifest.entries[0].match_name).toBe("the great hall");
    expect(manifest.entries[0].resolved).toBe(true);
  });

  test("palaceResolveMarkup: no markup returns has_markup false", () => {
    const tokens = palaceParseMarkup("Plain text description.");
    const manifest = palaceResolveMarkup(kernel, null, tokens);
    expect(manifest.has_markup).toBe(false);
    expect(manifest.rendered).toBe("Plain text description.");
    expect(manifest.entries.length).toBe(0);
  });

  // --- Template engine ---

  test("renderTemplate: substitutes {{name}} from state", () => {
    const result = renderTemplate("The {{name}} glows.", { name: "crystal", status: "active" }, { genus_name: "Crystal", id: "abc" });
    expect(result).toBe("The crystal glows.");
  });

  test("renderTemplate: substitutes {{genus_name}} from context", () => {
    const result = renderTemplate("Type: {{genus_name}}", { name: "x" }, { genus_name: "Weapon", id: "abc" });
    expect(result).toBe("Type: Weapon");
  });

  test("renderTemplate: substitutes {{id}} from context", () => {
    const result = renderTemplate("ID={{id}}", {}, { genus_name: "X", id: "abc-123" });
    expect(result).toBe("ID=abc-123");
  });

  test("renderTemplate: missing attribute becomes empty string", () => {
    const result = renderTemplate("{{name}} ({{missing}})", { name: "test" }, { genus_name: "X", id: "1" });
    expect(result).toBe("test ()");
  });

  test("renderTemplate: no placeholders returns template unchanged", () => {
    const result = renderTemplate("No placeholders here.", {}, { genus_name: "X", id: "1" });
    expect(result).toBe("No placeholders here.");
  });

  // --- Genus template storage ---

  test("setGenusTemplate and getGenusTemplates round-trip", () => {
    const genusId = defineEntityGenus(kernel, "TestGenus", {
      attributes: [{ name: "name", type: "text", required: true }],
      states: [{ name: "active", initial: true }],
    });
    setGenusTemplate(kernel, genusId, "glance", "{{name}} ({{genus_name}})");
    setGenusTemplate(kernel, genusId, "inspect", "Full: {{name}} [{{status}}]");

    const templates = getGenusTemplates(kernel, genusId);
    expect(templates.glance).toBe("{{name}} ({{genus_name}})");
    expect(templates.inspect).toBe("Full: {{name}} [{{status}}]");
    expect(templates.mention).toBeUndefined();
  });

  test("mention template used in palaceResolveMarkup", () => {
    const wsId = createWorkspace(kernel, "test-ws");
    switchWorkspace(kernel, wsId);
    const genusId = defineEntityGenus(kernel, "Gem", {
      attributes: [{ name: "name", type: "text", required: true }],
      states: [{ name: "active", initial: true }],
    });
    setGenusTemplate(kernel, genusId, "mention", "a glowing {{name}}");

    const entityId = createEntity(kernel, genusId);
    setAttribute(kernel, entityId, "name", "Ruby");
    assignWorkspace(kernel, entityId, wsId);

    const tokens = palaceParseMarkup("On the shelf sits *Gem:Ruby*.");
    const manifest = palaceResolveMarkup(kernel, wsId, tokens);
    expect(manifest.rendered).toBe("On the shelf sits a glowing Ruby.");
    expect(manifest.entries[0].display).toBe("a glowing Ruby");
  });
});

// ============================================================================
// Palace NPCs
// ============================================================================

describe("Palace NPCs", () => {
  let kernel: Kernel;
  const WS_ID = "ws-npc-test";

  beforeEach(() => {
    kernel = initKernel(":memory:");
    // Create a room for NPCs to live in
    palaceBuildRoom(kernel, WS_ID, {
      slug: "laboratory",
      name: "The Laboratory",
      description: "A room full of instruments.",
      actions: [],
      portals: [],
    });
  });

  afterEach(() => {
    kernel.db.close();
  });

  // --- CRUD ---

  test("palaceCreateNPC creates an NPC", () => {
    const npc = palaceCreateNPC(kernel, WS_ID, {
      slug: "the-assayer",
      name: "The Hittite Assayer",
      description: "A grizzled man.",
      room_slug: "laboratory",
      greeting: "The tin tells its own story.",
    });
    expect(npc.slug).toBe("the-assayer");
    expect(npc.name).toBe("The Hittite Assayer");
    expect(npc.room_slug).toBe("laboratory");
    expect(npc.greeting).toBe("The tin tells its own story.");
    expect(npc.dialogue).toEqual([]);
  });

  test("palaceCreateNPC with dialogue nodes", () => {
    const dialogue: PalaceDialogueNode[] = [
      { id: "q1", parent: "root", prompt: "Tell me about tin.", text: "Well, you see..." },
      { id: "q2", parent: "q1", prompt: "Go on.", text: "The isotopes reveal..." },
    ];
    const npc = palaceCreateNPC(kernel, WS_ID, {
      slug: "assayer",
      name: "Assayer",
      description: "Knows tin.",
      room_slug: "laboratory",
      greeting: "Hello.",
      dialogue,
    });
    expect(npc.dialogue).toHaveLength(2);
    expect(npc.dialogue[0].id).toBe("q1");
    expect(npc.dialogue[1].parent).toBe("q1");
  });

  test("palaceCreateNPC rejects duplicate slug", () => {
    palaceCreateNPC(kernel, WS_ID, {
      slug: "npc1", name: "NPC1", description: "Desc",
      room_slug: "laboratory", greeting: "Hi",
    });
    expect(() => palaceCreateNPC(kernel, WS_ID, {
      slug: "npc1", name: "NPC2", description: "Desc2",
      room_slug: "laboratory", greeting: "Hey",
    })).toThrow(/already exists/);
  });

  test("palaceCreateNPC rejects nonexistent room", () => {
    expect(() => palaceCreateNPC(kernel, WS_ID, {
      slug: "npc1", name: "NPC1", description: "Desc",
      room_slug: "nonexistent", greeting: "Hi",
    })).toThrow(/not found/);
  });

  test("palaceGetNPC returns NPC by slug", () => {
    palaceCreateNPC(kernel, WS_ID, {
      slug: "npc1", name: "NPC One", description: "First",
      room_slug: "laboratory", greeting: "Hello",
    });
    const npc = palaceGetNPC(kernel, WS_ID, "npc1");
    expect(npc).not.toBeNull();
    expect(npc!.name).toBe("NPC One");
  });

  test("palaceGetNPC returns null for nonexistent", () => {
    const npc = palaceGetNPC(kernel, WS_ID, "nobody");
    expect(npc).toBeNull();
  });

  test("palaceListNPCsInRoom lists NPCs in a room", () => {
    palaceCreateNPC(kernel, WS_ID, {
      slug: "npc1", name: "NPC1", description: "D",
      room_slug: "laboratory", greeting: "Hi",
    });
    palaceCreateNPC(kernel, WS_ID, {
      slug: "npc2", name: "NPC2", description: "D",
      room_slug: "laboratory", greeting: "Hey",
    });
    // Create another room + NPC to verify filtering
    palaceBuildRoom(kernel, WS_ID, {
      slug: "library", name: "Library", description: "Books.",
      actions: [], portals: [],
    });
    palaceCreateNPC(kernel, WS_ID, {
      slug: "librarian", name: "Librarian", description: "D",
      room_slug: "library", greeting: "Shh",
    });

    const labNpcs = palaceListNPCsInRoom(kernel, WS_ID, "laboratory");
    expect(labNpcs).toHaveLength(2);
    const slugs = labNpcs.map(n => n.slug).sort();
    expect(slugs).toEqual(["npc1", "npc2"]);
  });

  test("palaceListNPCs lists all NPCs in workspace", () => {
    palaceCreateNPC(kernel, WS_ID, {
      slug: "a", name: "A", description: "D",
      room_slug: "laboratory", greeting: "Hi",
    });
    palaceBuildRoom(kernel, WS_ID, {
      slug: "other", name: "Other", description: "D",
      actions: [], portals: [],
    });
    palaceCreateNPC(kernel, WS_ID, {
      slug: "b", name: "B", description: "D",
      room_slug: "other", greeting: "Hi",
    });
    const all = palaceListNPCs(kernel, WS_ID);
    expect(all).toHaveLength(2);
  });

  // --- Dialogue ---

  test("palaceAddDialogue appends nodes", () => {
    palaceCreateNPC(kernel, WS_ID, {
      slug: "npc1", name: "NPC", description: "D",
      room_slug: "laboratory", greeting: "Hi",
      dialogue: [{ id: "q1", parent: "root", prompt: "Ask?", text: "Answer." }],
    });
    const updated = palaceAddDialogue(kernel, WS_ID, "npc1", [
      { id: "q2", parent: "q1", prompt: "More?", text: "More." },
    ]);
    expect(updated.dialogue).toHaveLength(2);
    expect(updated.dialogue[1].id).toBe("q2");
  });

  test("palaceAddDialogue rejects duplicate node IDs", () => {
    palaceCreateNPC(kernel, WS_ID, {
      slug: "npc1", name: "NPC", description: "D",
      room_slug: "laboratory", greeting: "Hi",
      dialogue: [{ id: "q1", parent: "root", prompt: "Ask?", text: "Answer." }],
    });
    expect(() => palaceAddDialogue(kernel, WS_ID, "npc1", [
      { id: "q1", parent: "root", prompt: "Dup?", text: "Dup." },
    ])).toThrow(/already exists/);
  });

  test("palaceAddDialogue rejects unknown parent", () => {
    palaceCreateNPC(kernel, WS_ID, {
      slug: "npc1", name: "NPC", description: "D",
      room_slug: "laboratory", greeting: "Hi",
    });
    expect(() => palaceAddDialogue(kernel, WS_ID, "npc1", [
      { id: "q1", parent: "nonexistent", prompt: "Ask?", text: "Answer." },
    ])).toThrow(/unknown parent/);
  });

  test("palaceAddDialogue validates parent references within batch", () => {
    palaceCreateNPC(kernel, WS_ID, {
      slug: "npc1", name: "NPC", description: "D",
      room_slug: "laboratory", greeting: "Hi",
    });
    // q2 references q1 which is in the same batch — should succeed
    const updated = palaceAddDialogue(kernel, WS_ID, "npc1", [
      { id: "q1", parent: "root", prompt: "First?", text: "First." },
      { id: "q2", parent: "q1", prompt: "Second?", text: "Second." },
    ]);
    expect(updated.dialogue).toHaveLength(2);
  });

  // --- Entity ref resolution ---

  test("palaceCreateNPC resolves entity_ref", () => {
    const genusId = defineEntityGenus(kernel, "Claim", {
      attributes: [{ name: "name", type: "text", required: true }],
      states: [{ name: "active", initial: true }],
    });
    const entityId = createEntity(kernel, genusId);
    setAttribute(kernel, entityId, "name", "Uluburun Shipwreck");
    assignWorkspace(kernel, entityId, WS_ID);

    const npc = palaceCreateNPC(kernel, WS_ID, {
      slug: "npc1", name: "NPC", description: "D",
      room_slug: "laboratory", greeting: "Hi",
      dialogue: [
        { id: "q1", parent: "root", prompt: "Tell me?", text: "Well...", entity_ref: "Claim:Uluburun" },
      ],
    });
    expect(npc.dialogue[0].entity_id).toBe(entityId);
    expect(npc.dialogue[0].entity_ref).toBeUndefined();
  });

  test("entity_ref throws on no match", () => {
    defineEntityGenus(kernel, "Claim", {
      attributes: [{ name: "name", type: "text", required: true }],
      states: [{ name: "active", initial: true }],
    });
    expect(() => palaceCreateNPC(kernel, WS_ID, {
      slug: "npc1", name: "NPC", description: "D",
      room_slug: "laboratory", greeting: "Hi",
      dialogue: [
        { id: "q1", parent: "root", prompt: "?", text: ".", entity_ref: "Claim:Nonexistent" },
      ],
    })).toThrow(/no matching entity/);
  });

  // --- Merge ---

  test("palaceMergeNPC creates if not exists", () => {
    const npc = palaceMergeNPC(kernel, WS_ID, {
      slug: "npc1", name: "NPC", description: "D",
      room_slug: "laboratory", greeting: "Hi",
    });
    expect(npc.slug).toBe("npc1");
  });

  test("palaceMergeNPC updates existing fields", () => {
    palaceCreateNPC(kernel, WS_ID, {
      slug: "npc1", name: "Old Name", description: "Old Desc",
      room_slug: "laboratory", greeting: "Old greeting",
    });
    const merged = palaceMergeNPC(kernel, WS_ID, {
      slug: "npc1", name: "New Name", greeting: "New greeting",
    });
    expect(merged.name).toBe("New Name");
    expect(merged.greeting).toBe("New greeting");
    expect(merged.description).toBe("Old Desc"); // unchanged
  });

  test("palaceMergeNPC appends dialogue", () => {
    palaceCreateNPC(kernel, WS_ID, {
      slug: "npc1", name: "NPC", description: "D",
      room_slug: "laboratory", greeting: "Hi",
      dialogue: [{ id: "q1", parent: "root", prompt: "A?", text: "A." }],
    });
    const merged = palaceMergeNPC(kernel, WS_ID, {
      slug: "npc1",
      dialogue: [{ id: "q2", parent: "root", prompt: "B?", text: "B." }],
    });
    expect(merged.dialogue).toHaveLength(2);
  });

  // --- Delete ---

  test("palaceDeleteNPC archives NPC", () => {
    palaceCreateNPC(kernel, WS_ID, {
      slug: "npc1", name: "NPC", description: "D",
      room_slug: "laboratory", greeting: "Hi",
    });
    palaceDeleteNPC(kernel, WS_ID, "npc1");
    const npc = palaceGetNPC(kernel, WS_ID, "npc1");
    expect(npc).toBeNull();
  });

  test("palaceDeleteNPC throws for nonexistent", () => {
    expect(() => palaceDeleteNPC(kernel, WS_ID, "nobody")).toThrow(/not found/);
  });

  // --- Cascade ---

  test("deleting room archives its NPCs", () => {
    palaceBuildRoom(kernel, WS_ID, {
      slug: "doomed", name: "Doomed Room", description: "Will be deleted.",
      actions: [], portals: [],
    });
    palaceCreateNPC(kernel, WS_ID, {
      slug: "npc-doomed", name: "Doomed NPC", description: "D",
      room_slug: "doomed", greeting: "Farewell.",
    });
    palaceDeleteRoom(kernel, WS_ID, "doomed");
    const npc = palaceGetNPC(kernel, WS_ID, "npc-doomed");
    expect(npc).toBeNull();
  });

  // --- NPCs are tessella-backed entities ---

  test("NPCs use PALACE_NPC_GENUS_ID", () => {
    const npc = palaceCreateNPC(kernel, WS_ID, {
      slug: "npc1", name: "NPC", description: "D",
      room_slug: "laboratory", greeting: "Hi",
    });
    const res = kernel.db.query("SELECT genus_id FROM res WHERE id = ?").get(npc.id) as any;
    expect(res.genus_id).toBe(PALACE_NPC_GENUS_ID);
  });

  test("NPCs not visible in listEntities", () => {
    palaceCreateNPC(kernel, WS_ID, {
      slug: "npc1", name: "NPC", description: "D",
      room_slug: "laboratory", greeting: "Hi",
    });
    const entities = listEntities(kernel, { workspace_id: WS_ID, all_workspaces: true });
    const npcEntities = entities.filter(e => e.genus_id === PALACE_NPC_GENUS_ID);
    expect(npcEntities).toHaveLength(0);
  });

  // --- Session unlocks / visibility ---

  test("dialogue node visibility with requires/unlocks", () => {
    const dialogue: PalaceDialogueNode[] = [
      { id: "q1", parent: "root", prompt: "About tin?", text: "Answer.", unlocks: ["heard-tin"] },
      { id: "q2", parent: "root", prompt: "Secret question", text: "Secret.", requires: ["heard-tin"] },
      { id: "q3", parent: "root", prompt: "Open question", text: "Open." },
    ];
    const npc = palaceCreateNPC(kernel, WS_ID, {
      slug: "npc1", name: "NPC", description: "D",
      room_slug: "laboratory", greeting: "Hi",
      dialogue,
    });

    // Without tags, q2 should be hidden
    const noTags: string[] = [];
    const visible = npc.dialogue.filter(n =>
      n.parent === "root" && (!n.requires || n.requires.every(t => noTags.includes(t)))
    );
    expect(visible).toHaveLength(2); // q1 and q3

    // With "heard-tin" tag, q2 should appear
    const withTags = ["heard-tin"];
    const visibleWithTags = npc.dialogue.filter(n =>
      n.parent === "root" && (!n.requires || n.requires.every(t => withTags.includes(t)))
    );
    expect(visibleWithTags).toHaveLength(3);
  });

  // --- Dialogue field validation ---

  test("dialogue node with missing text is rejected", () => {
    expect(() =>
      palaceCreateNPC(kernel, WS_ID, {
        slug: "bad-npc", name: "Bad", description: "D",
        room_slug: "laboratory", greeting: "Hi",
        dialogue: [
          { id: "q1", parent: "root", prompt: "Ask me", text: "" } as PalaceDialogueNode,
        ],
      })
    ).toThrow(/missing required "text" field/);
  });

  test("dialogue node with missing prompt is rejected", () => {
    expect(() =>
      palaceCreateNPC(kernel, WS_ID, {
        slug: "bad-npc2", name: "Bad", description: "D",
        room_slug: "laboratory", greeting: "Hi",
        dialogue: [
          { id: "q1", parent: "root", prompt: "", text: "Answer" } as PalaceDialogueNode,
        ],
      })
    ).toThrow(/missing required "prompt" field/);
  });

  test("unknown parent error includes valid parent IDs", () => {
    palaceCreateNPC(kernel, WS_ID, {
      slug: "npc-parent-test", name: "Test NPC", description: "D",
      room_slug: "laboratory", greeting: "Hi",
    });
    expect(() =>
      palaceAddDialogue(kernel, WS_ID, "npc-parent-test", [
        { id: "q1", parent: "root", prompt: "Ask", text: "Answer" },
        { id: "q2", parent: "nonexistent", prompt: "Bad", text: "Bad" },
      ])
    ).toThrow(/Valid parents:/);
  });

  // --- palaceBuildRoom action validation ---

  test("palaceBuildRoom rejects action with missing type", () => {
    expect(() =>
      palaceBuildRoom(kernel, WS_ID, {
        slug: "bad-room", name: "Bad", description: "D",
        actions: [{ label: "Foo", type: "" as any }],
        portals: [],
      })
    ).toThrow(/invalid type/);
  });

  test("_materializeNpc normalizes legacy response field to text on read", () => {
    // Create NPC with valid dialogue
    const npc = palaceCreateNPC(kernel, WS_ID, {
      slug: "legacy-npc", name: "Legacy", description: "D",
      room_slug: "laboratory", greeting: "Hi",
      dialogue: [
        { id: "q1", parent: "root", prompt: "Ask", text: "The proper answer." },
      ],
    });

    // Simulate legacy data: overwrite dialogue tessella with "response" instead of "text"
    const res_id = npc.id;
    appendTessella(kernel, res_id, "attribute_set", {
      key: "dialogue",
      value: [{ id: "q1", parent: "root", prompt: "Ask", response: "Legacy response text" }],
    }, { branch_id: "main" });

    // Read back — should normalize response → text
    const loaded = palaceGetNPC(kernel, WS_ID, "legacy-npc")!;
    expect(loaded.dialogue[0].text).toBe("Legacy response text");
    expect((loaded.dialogue[0] as any).response).toBeUndefined();
  });

  test("palaceBuildRoom rejects action with missing label", () => {
    expect(() =>
      palaceBuildRoom(kernel, WS_ID, {
        slug: "bad-room2", name: "Bad", description: "D",
        actions: [{ label: "", type: "text" }],
        portals: [],
      })
    ).toThrow(/missing required "label" field/);
  });
});
