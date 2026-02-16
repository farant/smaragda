import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import {
  ulid, ulidTimestamp, sqliteOpen, sqliteMigrate, esStore,
  httpCors, httpHandler, httpJsonBody, httpNotFound, HttpError,
  mcpServer,
} from "./libraries";
import type { EsEvent, EsStore, McpServer } from "./libraries";

// ============================================================================
// ULID
// ============================================================================

describe("ULID", () => {
  const CROCKFORD_RE = /^[0123456789ABCDEFGHJKMNPQRSTVWXYZ]{26}$/;

  test("returns a 26-character Crockford base32 string", () => {
    const id = ulid();
    expect(id).toHaveLength(26);
    expect(id).toMatch(CROCKFORD_RE);
  });

  test("successive calls produce unique values", () => {
    const ids = new Set(Array.from({ length: 1000 }, () => ulid()));
    expect(ids.size).toBe(1000);
  });

  test("lexicographic sort matches chronological order", () => {
    const earlier = ulid(1000000000000);
    const later = ulid(1000000001000);
    expect(earlier < later).toBe(true);
  });

  test("monotonic within the same millisecond", () => {
    const t = Date.now();
    const a = ulid(t);
    const b = ulid(t);
    const c = ulid(t);
    expect(a < b).toBe(true);
    expect(b < c).toBe(true);
  });

  test("handles clock going backwards", () => {
    const t = Date.now();
    const a = ulid(t);
    const b = ulid(t - 1000); // clock went backwards
    // Should still increment, producing a value > a
    expect(a < b).toBe(true);
  });

  test("ulidTimestamp extracts the correct timestamp", () => {
    // Use a far-future time to guarantee it's a new ms (not monotonic increment)
    const t = Date.now() + 999999;
    const id = ulid(t);
    expect(ulidTimestamp(id)).toBe(t);
  });

  test("ulidTimestamp round-trips with Date", () => {
    // Use a far-future time to guarantee fresh ms
    const now = Date.now() + 9999999;
    const id = ulid(now);
    const extracted = ulidTimestamp(id);
    expect(extracted).toBe(now);
  });

  test("excludes ambiguous characters I L O U", () => {
    // Generate many ULIDs and verify none contain excluded chars
    const ids = Array.from({ length: 100 }, () => ulid());
    for (const id of ids) {
      expect(id).not.toMatch(/[ILOU]/);
    }
  });
});

// ============================================================================
// SQLite
// ============================================================================

describe("SQLite", () => {
  let db: Database;

  beforeEach(() => {
    db = sqliteOpen(":memory:");
  });

  afterEach(() => {
    db.close();
  });

  test("sqliteOpen sets WAL mode", () => {
    // In-memory databases can't use WAL — test with a temp file
    const tmpDb = sqliteOpen(`${import.meta.dir}/.test-wal.db`);
    try {
      const row = tmpDb.query("PRAGMA journal_mode").get() as { journal_mode: string };
      expect(row.journal_mode).toBe("wal");
    } finally {
      tmpDb.close();
      import("fs").then(fs => {
        for (const suffix of ["", "-wal", "-shm"]) {
          try { fs.unlinkSync(`${import.meta.dir}/.test-wal.db${suffix}`); } catch {}
        }
      });
    }
  });

  test("sqliteOpen sets busy_timeout", () => {
    const row = db.query("PRAGMA busy_timeout").get() as { timeout: number };
    expect(row.timeout).toBe(5000);
  });

  test("sqliteOpen sets synchronous = NORMAL", () => {
    const row = db.query("PRAGMA synchronous").get() as { synchronous: number };
    // synchronous: 0=OFF, 1=NORMAL, 2=FULL
    expect(row.synchronous).toBe(1);
  });

  test("sqliteOpen enables foreign keys", () => {
    const row = db.query("PRAGMA foreign_keys").get() as { foreign_keys: number };
    expect(row.foreign_keys).toBe(1);
  });

  test("sqliteOpen returns a raw bun:sqlite Database", () => {
    expect(db).toBeInstanceOf(Database);
  });

  test("sqliteMigrate runs migrations in order", () => {
    sqliteMigrate(db, [
      "CREATE TABLE users (id TEXT PRIMARY KEY, name TEXT NOT NULL)",
      "ALTER TABLE users ADD COLUMN email TEXT",
    ]);

    // Both columns should exist
    db.run("INSERT INTO users (id, name, email) VALUES ('1', 'Alice', 'alice@test.com')");
    const row = db.query("SELECT * FROM users WHERE id = '1'").get() as any;
    expect(row.name).toBe("Alice");
    expect(row.email).toBe("alice@test.com");
  });

  test("sqliteMigrate tracks applied versions", () => {
    sqliteMigrate(db, [
      "CREATE TABLE t1 (id INTEGER PRIMARY KEY)",
    ]);

    const row = db.query("SELECT MAX(version) as v FROM _migrations").get() as { v: number };
    expect(row.v).toBe(0);
  });

  test("sqliteMigrate skips already-applied migrations", () => {
    sqliteMigrate(db, [
      "CREATE TABLE t1 (id INTEGER PRIMARY KEY)",
    ]);

    // Running again with an additional migration should only apply the new one
    sqliteMigrate(db, [
      "CREATE TABLE t1 (id INTEGER PRIMARY KEY)",
      "CREATE TABLE t2 (id INTEGER PRIMARY KEY)",
    ]);

    const row = db.query("SELECT MAX(version) as v FROM _migrations").get() as { v: number };
    expect(row.v).toBe(1);

    // Both tables should exist
    db.run("INSERT INTO t1 (id) VALUES (1)");
    db.run("INSERT INTO t2 (id) VALUES (1)");
  });

  test("sqliteMigrate is atomic — partial failure rolls back", () => {
    expect(() => {
      sqliteMigrate(db, [
        "CREATE TABLE good (id INTEGER PRIMARY KEY)",
        "THIS IS NOT VALID SQL",
      ]);
    }).toThrow();

    // Neither migration should have been applied
    const row = db.query("SELECT COUNT(*) as n FROM _migrations").get() as { n: number };
    expect(row.n).toBe(0);
  });

  test("sqliteMigrate is a no-op when all migrations already applied", () => {
    sqliteMigrate(db, [
      "CREATE TABLE t1 (id INTEGER PRIMARY KEY)",
    ]);

    // Should not throw or do anything
    sqliteMigrate(db, [
      "CREATE TABLE t1 (id INTEGER PRIMARY KEY)",
    ]);
  });
});

// ============================================================================
// Event Sourcing
// ============================================================================

describe("Event Sourcing", () => {
  let db: Database;
  let store: EsStore;

  beforeEach(() => {
    db = sqliteOpen(":memory:");
    store = esStore(db, "test");
  });

  afterEach(() => {
    db.close();
  });

  test("esStore creates event and hwm tables", () => {
    const tables = db.query(
      "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
    ).all() as { name: string }[];
    const names = tables.map(t => t.name);
    expect(names).toContain("test_events");
    expect(names).toContain("test_hwm");
  });

  test("append returns the event with sequence and parsed data", () => {
    const evt = store.append("stream-1", "created", { name: "Alice" });
    expect(evt.sequence).toBe(1);
    expect(evt.streamId).toBe("stream-1");
    expect(evt.type).toBe("created");
    expect(evt.data).toEqual({ name: "Alice" });
    expect(typeof evt.timestamp).toBe("string");
  });

  test("append assigns monotonically increasing sequences", () => {
    const e1 = store.append("s1", "a", {});
    const e2 = store.append("s1", "b", {});
    const e3 = store.append("s2", "a", {});
    expect(e1.sequence).toBe(1);
    expect(e2.sequence).toBe(2);
    expect(e3.sequence).toBe(3);
  });

  test("appendBatch inserts multiple events atomically", () => {
    const events = store.appendBatch([
      { streamId: "s1", type: "a", data: { v: 1 } },
      { streamId: "s1", type: "b", data: { v: 2 } },
      { streamId: "s2", type: "a", data: { v: 3 } },
    ]);
    expect(events).toHaveLength(3);
    expect(events[0].sequence).toBe(1);
    expect(events[2].sequence).toBe(3);
    expect(store.count()).toBe(3);
  });

  test("replay returns events for a single stream in order", () => {
    store.append("s1", "a", { v: 1 });
    store.append("s2", "b", { v: 2 });
    store.append("s1", "c", { v: 3 });

    const events = store.replay("s1");
    expect(events).toHaveLength(2);
    expect(events[0].type).toBe("a");
    expect(events[1].type).toBe("c");
  });

  test("replay with after option skips earlier events", () => {
    store.append("s1", "a", {});
    const e2 = store.append("s1", "b", {});
    store.append("s1", "c", {});

    const events = store.replay("s1", { after: e2.sequence });
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("c");
  });

  test("replay with limit option caps results", () => {
    store.append("s1", "a", {});
    store.append("s1", "b", {});
    store.append("s1", "c", {});

    const events = store.replay("s1", { limit: 2 });
    expect(events).toHaveLength(2);
    expect(events[0].type).toBe("a");
    expect(events[1].type).toBe("b");
  });

  test("replayAll returns all events across streams", () => {
    store.append("s1", "a", {});
    store.append("s2", "b", {});
    store.append("s1", "c", {});

    const events = store.replayAll();
    expect(events).toHaveLength(3);
    expect(events.map(e => e.type)).toEqual(["a", "b", "c"]);
  });

  test("replayAll with after option respects global sequence", () => {
    store.append("s1", "a", {});
    const e2 = store.append("s2", "b", {});
    store.append("s1", "c", {});

    const events = store.replayAll({ after: e2.sequence });
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("c");
  });

  test("materialize folds events into state", () => {
    store.append("acct-1", "opened", { owner: "Alice", balance: 0 });
    store.append("acct-1", "deposited", { amount: 100 });
    store.append("acct-1", "withdrawn", { amount: 30 });

    interface Account { owner: string; balance: number }

    const account = store.materialize<Account>("acct-1", (state, evt) => {
      switch (evt.type) {
        case "opened": return { ...evt.data };
        case "deposited": return { ...state, balance: state.balance + evt.data.amount };
        case "withdrawn": return { ...state, balance: state.balance - evt.data.amount };
        default: return state;
      }
    }, {} as Account);

    expect(account.owner).toBe("Alice");
    expect(account.balance).toBe(70);
  });

  test("materialize returns initial state for empty stream", () => {
    const state = store.materialize("nonexistent", (s, _e) => s, { count: 0 });
    expect(state).toEqual({ count: 0 });
  });

  test("hwmGet returns 0 for unknown consumer", () => {
    expect(store.hwmGet("unknown")).toBe(0);
  });

  test("hwmSet and hwmGet round-trip", () => {
    store.hwmSet("consumer-1", 42);
    expect(store.hwmGet("consumer-1")).toBe(42);
  });

  test("hwmSet updates existing consumer", () => {
    store.hwmSet("consumer-1", 10);
    store.hwmSet("consumer-1", 50);
    expect(store.hwmGet("consumer-1")).toBe(50);
  });

  test("multiple consumers track independently", () => {
    store.hwmSet("a", 10);
    store.hwmSet("b", 20);
    expect(store.hwmGet("a")).toBe(10);
    expect(store.hwmGet("b")).toBe(20);
  });

  test("streamIds returns distinct stream IDs", () => {
    store.append("beta", "x", {});
    store.append("alpha", "x", {});
    store.append("beta", "y", {});

    const ids = store.streamIds();
    expect(ids).toEqual(["alpha", "beta"]);
  });

  test("count returns total events", () => {
    store.append("s1", "a", {});
    store.append("s2", "b", {});
    expect(store.count()).toBe(2);
  });

  test("count with streamId filters to that stream", () => {
    store.append("s1", "a", {});
    store.append("s2", "b", {});
    store.append("s1", "c", {});
    expect(store.count("s1")).toBe(2);
    expect(store.count("s2")).toBe(1);
  });

  test("multiple stores coexist in one database", () => {
    const users = esStore(db, "users");
    const orders = esStore(db, "orders");

    users.append("u1", "created", { name: "Alice" });
    orders.append("o1", "placed", { total: 50 });

    expect(users.count()).toBe(1);
    expect(orders.count()).toBe(1);
    expect(users.replayAll()[0].type).toBe("created");
    expect(orders.replayAll()[0].type).toBe("placed");
  });

  test("hwm + replayAll pattern for incremental consumption", () => {
    store.append("s1", "a", {});
    store.append("s1", "b", {});

    // First consumption
    const hwm1 = store.hwmGet("consumer");
    const batch1 = store.replayAll({ after: hwm1 });
    expect(batch1).toHaveLength(2);
    store.hwmSet("consumer", batch1.at(-1)!.sequence);

    // More events arrive
    store.append("s1", "c", {});

    // Second consumption — only gets new events
    const hwm2 = store.hwmGet("consumer");
    const batch2 = store.replayAll({ after: hwm2 });
    expect(batch2).toHaveLength(1);
    expect(batch2[0].type).toBe("c");
  });

  test("timestamps are ISO 8601 with T separator, milliseconds, and Z", () => {
    const evt = store.append("s1", "test", {});
    // e.g. "2026-02-09T15:30:45.123Z"
    expect(evt.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });

  test("replay with types filter returns only matching event types", () => {
    store.append("s1", "created", { v: 1 });
    store.append("s1", "updated", { v: 2 });
    store.append("s1", "deleted", { v: 3 });
    store.append("s1", "updated", { v: 4 });

    const events = store.replay("s1", { types: ["created", "deleted"] });
    expect(events).toHaveLength(2);
    expect(events.map(e => e.type)).toEqual(["created", "deleted"]);
  });

  test("replayAll with types filter returns only matching event types", () => {
    store.append("s1", "a", {});
    store.append("s2", "b", {});
    store.append("s1", "a", {});
    store.append("s2", "c", {});

    const events = store.replayAll({ types: ["b", "c"] });
    expect(events).toHaveLength(2);
    expect(events.map(e => e.type)).toEqual(["b", "c"]);
  });

  test("replay types filter combines with after and limit", () => {
    store.append("s1", "a", {});
    const e2 = store.append("s1", "b", {});
    store.append("s1", "a", {});
    store.append("s1", "b", {});
    store.append("s1", "a", {});

    const events = store.replay("s1", { after: e2.sequence, types: ["a"], limit: 1 });
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("a");
  });

  test("data survives JSON round-trip for complex objects", () => {
    const complex = {
      nested: { deep: [1, 2, 3] },
      flag: true,
      count: 42,
      label: null,
    };
    store.append("s1", "test", complex);

    const events = store.replay("s1");
    expect(events[0].data).toEqual(complex);
  });
});

// ============================================================================
// HTTP
// ============================================================================

describe("HTTP", () => {
  let server: ReturnType<typeof Bun.serve>;
  let base: string;

  function serve(routes: Record<string, any>, fetchFn?: (req: Request) => Response | Promise<Response>) {
    server = Bun.serve({
      port: 0,
      routes,
      fetch: fetchFn ?? httpCors(httpNotFound),
    });
    base = `http://localhost:${server.port}`;
  }

  afterEach(() => {
    server?.stop(true);
  });

  test("httpHandler auto-serializes plain objects to JSON", async () => {
    serve({
      "/test": httpHandler(() => ({ hello: "world" })),
    });
    const res = await fetch(`${base}/test`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");
    expect(await res.json()).toEqual({ hello: "world" });
  });

  test("httpHandler passes through Response objects unchanged", async () => {
    serve({
      "/test": httpHandler(() => new Response("raw", { status: 201 })),
    });
    const res = await fetch(`${base}/test`);
    expect(res.status).toBe(201);
    expect(await res.text()).toBe("raw");
  });

  test("httpHandler catches HttpError and returns JSON error", async () => {
    serve({
      "/test": httpHandler(() => { throw new HttpError(422, "Bad input"); }),
    });
    const res = await fetch(`${base}/test`);
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ error: "Bad input" });
  });

  test("httpHandler catches unknown errors as 500", async () => {
    serve({
      "/test": httpHandler(() => { throw new Error("boom"); }),
    });
    const res = await fetch(`${base}/test`);
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "boom" });
  });

  test("httpHandler works with async handlers", async () => {
    serve({
      "/test": httpHandler(async () => {
        await new Promise(r => setTimeout(r, 5));
        return { async: true };
      }),
    });
    const res = await fetch(`${base}/test`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ async: true });
  });

  test("httpCors responds to OPTIONS with 204 and CORS headers", async () => {
    serve({}, httpCors(httpNotFound));
    const res = await fetch(`${base}/anything`, { method: "OPTIONS" });
    expect(res.status).toBe(204);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(res.headers.get("Access-Control-Allow-Methods")).toContain("POST");
    expect(res.headers.get("Access-Control-Allow-Headers")).toContain("Content-Type");
  });

  test("httpCors adds CORS headers to non-OPTIONS responses", async () => {
    serve({}, httpCors(httpNotFound));
    const res = await fetch(`${base}/anything`);
    expect(res.status).toBe(404);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
  });

  test("httpCors accepts custom options", async () => {
    serve({}, httpCors(httpNotFound, {
      origin: "https://example.com",
      methods: "GET, POST",
    }));
    const res = await fetch(`${base}/test`, { method: "OPTIONS" });
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("https://example.com");
    expect(res.headers.get("Access-Control-Allow-Methods")).toBe("GET, POST");
  });

  test("httpJsonBody parses valid JSON", async () => {
    serve({
      "/test": {
        POST: httpHandler(async (req) => {
          const body = await httpJsonBody(req);
          return { got: body };
        }),
      },
    });
    const res = await fetch(`${base}/test`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Alice" }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ got: { name: "Alice" } });
  });

  test("httpJsonBody throws HttpError(400) on invalid JSON", async () => {
    serve({
      "/test": {
        POST: httpHandler(async (req) => {
          const body = await httpJsonBody(req);
          return { got: body };
        }),
      },
    });
    const res = await fetch(`${base}/test`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not json",
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Invalid JSON body" });
  });

  test("httpNotFound returns 404 JSON response", () => {
    const res = httpNotFound();
    expect(res.status).toBe(404);
  });

  test("full integration: routes + httpHandler + httpCors", async () => {
    // Use method dispatch so OPTIONS falls through to fetch for CORS
    serve(
      {
        "/api/greet/:name": {
          GET: httpHandler((req) => ({
            message: `Hello ${(req as any).params.name}`,
          })),
        },
      },
      httpCors(httpNotFound),
    );

    // Route hit
    const res1 = await fetch(`${base}/api/greet/Alice`);
    expect(res1.status).toBe(200);
    expect(await res1.json()).toEqual({ message: "Hello Alice" });

    // OPTIONS preflight (unregistered method, falls through to fetch → httpCors)
    const res2 = await fetch(`${base}/api/greet/Alice`, { method: "OPTIONS" });
    expect(res2.status).toBe(204);
    expect(res2.headers.get("Access-Control-Allow-Origin")).toBe("*");

    // Unknown route (falls through to fetch → httpCors → httpNotFound)
    const res3 = await fetch(`${base}/nope`);
    expect(res3.status).toBe(404);
    expect(res3.headers.get("Access-Control-Allow-Origin")).toBe("*");
  });
});

// ============================================================================
// MCP
// ============================================================================

describe("MCP", () => {
  let server: McpServer;

  // Helper to simulate JSON-RPC request
  function rpc(method: string, params?: any, id: number | string = 1) {
    return server.handleMessage({ jsonrpc: "2.0", id, method, params });
  }

  // Helper to simulate JSON-RPC notification (no id)
  function notify(method: string, params?: any) {
    return server.handleMessage({ jsonrpc: "2.0", method, params });
  }

  beforeEach(() => {
    server = mcpServer({ name: "test-server", version: "0.1.0" });
  });

  // --- Initialize handshake ---

  test("initialize returns protocol version, capabilities, and server info", async () => {
    server.tool("t1", { description: "test", handler: () => "ok" });
    server.resource("res://x", { name: "X", handler: () => "data" });

    const res = await rpc("initialize", {
      protocolVersion: "2025-11-25",
      capabilities: {},
      clientInfo: { name: "test-client", version: "1.0" },
    });

    expect(res.jsonrpc).toBe("2.0");
    expect(res.id).toBe(1);
    expect(res.result.protocolVersion).toBe("2025-11-25");
    expect(res.result.capabilities.tools).toEqual({});
    expect(res.result.capabilities.resources).toEqual({});
    expect(res.result.serverInfo).toEqual({ name: "test-server", version: "0.1.0" });
  });

  test("initialize omits tools capability when no tools registered", async () => {
    const res = await rpc("initialize", { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "c", version: "1" } });
    expect(res.result.capabilities.tools).toBeUndefined();
  });

  test("initialized notification returns null (no response)", async () => {
    const res = await notify("notifications/initialized");
    expect(res).toBeNull();
  });

  // --- Ping ---

  test("ping returns empty result", async () => {
    const res = await rpc("ping");
    expect(res.result).toEqual({});
  });

  // --- Tools ---

  test("tools/list returns registered tools with input schemas", async () => {
    server.tool("greet", {
      description: "Say hello",
      input: {
        type: "object",
        properties: { name: { type: "string" } },
        required: ["name"],
      },
      handler: () => "hi",
    });

    const res = await rpc("tools/list");
    expect(res.result.tools).toHaveLength(1);
    expect(res.result.tools[0].name).toBe("greet");
    expect(res.result.tools[0].description).toBe("Say hello");
    expect(res.result.tools[0].inputSchema.properties.name.type).toBe("string");
  });

  test("tools/list defaults inputSchema to { type: 'object' } when omitted", async () => {
    server.tool("no-params", { description: "No params", handler: () => "ok" });
    const res = await rpc("tools/list");
    expect(res.result.tools[0].inputSchema).toEqual({ type: "object" });
  });

  test("tools/call with string return wraps in text content", async () => {
    server.tool("greet", {
      description: "Say hello",
      handler: ({ name }: any) => `Hello ${name}`,
    });
    const res = await rpc("tools/call", { name: "greet", arguments: { name: "Alice" } });
    expect(res.result.content).toEqual([{ type: "text", text: "Hello Alice" }]);
    expect(res.result.isError).toBeUndefined();
  });

  test("tools/call with McpToolResult return passes through", async () => {
    server.tool("multi", {
      description: "Multi-content",
      handler: () => ({
        content: [
          { type: "text" as const, text: "line 1" },
          { type: "text" as const, text: "line 2" },
        ],
      }),
    });
    const res = await rpc("tools/call", { name: "multi", arguments: {} });
    expect(res.result.content).toHaveLength(2);
  });

  test("tools/call with async handler works", async () => {
    server.tool("async-tool", {
      description: "Async",
      handler: async () => {
        await new Promise(r => setTimeout(r, 5));
        return "async result";
      },
    });
    const res = await rpc("tools/call", { name: "async-tool", arguments: {} });
    expect(res.result.content[0].text).toBe("async result");
  });

  test("tools/call with unknown tool returns JSON-RPC error", async () => {
    const res = await rpc("tools/call", { name: "nonexistent", arguments: {} });
    expect(res.error.code).toBe(-32602);
    expect(res.error.message).toContain("nonexistent");
  });

  test("tools/call validates required parameters", async () => {
    server.tool("requires-name", {
      description: "Needs a name",
      input: {
        type: "object",
        properties: { name: { type: "string" }, age: { type: "number" } },
        required: ["name"],
      },
      handler: ({ name }: any) => `Hello ${name}`,
    });
    // Missing required param → JSON-RPC error
    const res1 = await rpc("tools/call", { name: "requires-name", arguments: {} });
    expect(res1.error.code).toBe(-32602);
    expect(res1.error.message).toContain("Missing required parameter");
    expect(res1.error.message).toContain("name");
    // Providing required param → success
    const res2 = await rpc("tools/call", { name: "requires-name", arguments: { name: "Bob" } });
    expect(res2.result.content[0].text).toBe("Hello Bob");
    expect(res2.error).toBeUndefined();
  });

  test("tools/call reports multiple missing required parameters", async () => {
    server.tool("multi-req", {
      description: "Needs both",
      input: {
        type: "object",
        properties: { a: { type: "string" }, b: { type: "string" } },
        required: ["a", "b"],
      },
      handler: ({ a, b }: any) => `${a}-${b}`,
    });
    const res = await rpc("tools/call", { name: "multi-req", arguments: { a: "x" } });
    expect(res.error.code).toBe(-32602);
    expect(res.error.message).toContain("Missing required parameter");
    expect(res.error.message).toContain("b");
  });

  test("tools/call handler error returns isError: true (not JSON-RPC error)", async () => {
    server.tool("fail", {
      description: "Fails",
      handler: () => { throw new Error("something broke"); },
    });
    const res = await rpc("tools/call", { name: "fail", arguments: {} });
    expect(res.result.isError).toBe(true);
    expect(res.result.content[0].text).toBe("something broke");
    expect(res.error).toBeUndefined();
  });

  // --- Resources ---

  test("resources/list returns registered resources", async () => {
    server.resource("config://app", {
      name: "App Config",
      description: "Application config",
      mimeType: "application/json",
      handler: () => "{}",
    });
    const res = await rpc("resources/list");
    expect(res.result.resources).toHaveLength(1);
    expect(res.result.resources[0]).toEqual({
      uri: "config://app",
      name: "App Config",
      description: "Application config",
      mimeType: "application/json",
    });
  });

  test("resources/read with string return wraps in text content", async () => {
    server.resource("config://app", {
      name: "Config",
      mimeType: "application/json",
      handler: () => '{"key":"value"}',
    });
    const res = await rpc("resources/read", { uri: "config://app" });
    expect(res.result.contents).toEqual([{
      uri: "config://app",
      mimeType: "application/json",
      text: '{"key":"value"}',
    }]);
  });

  test("resources/read with McpResourceContents return passes through", async () => {
    server.resource("data://blob", {
      name: "Blob",
      handler: (uri) => ({
        contents: [{ uri, blob: "base64data", mimeType: "image/png" }],
      }),
    });
    const res = await rpc("resources/read", { uri: "data://blob" });
    expect(res.result.contents[0].blob).toBe("base64data");
  });

  test("resources/read with unknown URI returns -32002 error", async () => {
    const res = await rpc("resources/read", { uri: "nope://x" });
    expect(res.error.code).toBe(-32002);
  });

  test("resources/read handler error returns JSON-RPC error", async () => {
    server.resource("fail://x", {
      name: "Fail",
      handler: () => { throw new Error("read failed"); },
    });
    const res = await rpc("resources/read", { uri: "fail://x" });
    expect(res.error.code).toBe(-32603);
    expect(res.error.message).toBe("read failed");
  });

  // --- JSON-RPC edge cases ---

  test("unknown method returns -32601", async () => {
    const res = await rpc("bogus/method");
    expect(res.error.code).toBe(-32601);
  });

  test("invalid JSON-RPC (missing jsonrpc field) returns -32600", async () => {
    const res = await server.handleMessage({ id: 1, method: "ping" });
    expect(res.error.code).toBe(-32600);
  });

  test("resources/templates/list returns empty list", async () => {
    const res = await rpc("resources/templates/list");
    expect(res.result.resourceTemplates).toEqual([]);
  });

  test("prompts/list returns empty list", async () => {
    const res = await rpc("prompts/list");
    expect(res.result.prompts).toEqual([]);
  });

  // --- HTTP transport ---

  test("httpTransport: POST with valid JSON-RPC returns JSON response", async () => {
    const transport = server.httpTransport();
    const req = new Request("http://localhost/mcp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }),
    });
    const res = await transport(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.result).toEqual({});
  });

  test("httpTransport: POST with bad JSON returns parse error", async () => {
    const transport = server.httpTransport();
    const req = new Request("http://localhost/mcp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not json",
    });
    const res = await transport(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe(-32700);
  });

  test("httpTransport: notification returns 202 with no body", async () => {
    const transport = server.httpTransport();
    const req = new Request("http://localhost/mcp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
    });
    const res = await transport(req);
    expect(res.status).toBe(202);
  });

  test("httpTransport: initialize response includes Mcp-Session-Id header", async () => {
    const transport = server.httpTransport();
    const req = new Request("http://localhost/mcp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0", id: 1, method: "initialize",
        params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "c", version: "1" } },
      }),
    });
    const res = await transport(req);
    expect(res.status).toBe(200);
    expect(res.headers.get("Mcp-Session-Id")).toBeTruthy();
  });

  test("httpTransport: full lifecycle (initialize → initialized → tool call)", async () => {
    server.tool("add", {
      description: "Add two numbers",
      input: {
        type: "object",
        properties: { a: { type: "number" }, b: { type: "number" } },
        required: ["a", "b"],
      },
      handler: ({ a, b }: any) => String(a + b),
    });

    const transport = server.httpTransport();

    // 1. Initialize
    const r1 = await transport(new Request("http://localhost/mcp", {
      method: "POST",
      body: JSON.stringify({
        jsonrpc: "2.0", id: 1, method: "initialize",
        params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "c", version: "1" } },
      }),
    }));
    const init = await r1.json();
    expect(init.result.capabilities.tools).toEqual({});

    // 2. Initialized notification
    const r2 = await transport(new Request("http://localhost/mcp", {
      method: "POST",
      body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
    }));
    expect(r2.status).toBe(202);

    // 3. Tool call
    const r3 = await transport(new Request("http://localhost/mcp", {
      method: "POST",
      body: JSON.stringify({
        jsonrpc: "2.0", id: 2, method: "tools/call",
        params: { name: "add", arguments: { a: 3, b: 4 } },
      }),
    }));
    const result = await r3.json();
    expect(result.result.content[0].text).toBe("7");
  });
});

// ============================================================================
// Sync
// ============================================================================

describe("Sync", () => {
  test.todo("syncPull fetches events after hwm");
  test.todo("syncPush sends local events to server");
  test.todo("round-trip sync between two stores");
});
