// ============================================================================
// libraries.ts — single-file, zero-dependency utility library for Bun scripts
// ============================================================================
//
// Modules:
//
//   ULID            Sortable unique IDs. Crockford base32, monotonic within
//                   the same millisecond. The ID scheme for everything.
//                   Exports: ulid, ulidTimestamp
//
//   SQLite          Litestream-compatible setup + migration runner.
//                   Exports: sqliteOpen, sqliteMigrate
//
//   Event Sourcing  Append-only event store on SQLite. Replay, materialize,
//                   high-water marks for sync/subscriptions.
//                   Exports: esStore
//                   Types:   EsEvent, EsStore
//
//   HTTP            CORS, JSON error responses, body parsing for Bun.serve().
//                   Exports: httpCors, httpHandler, httpJsonBody, httpNotFound,
//                            HttpError
//                   Types:   HttpCorsOptions
//
//   MCP             Model Context Protocol server — JSON-RPC dispatch,
//                   tool/resource registration, Streamable HTTP transport.
//                   Exports: mcpServer
//                   Types:   McpServer, McpServerOptions, McpToolDef,
//                            McpResourceDef, McpToolResult, McpResourceContents,
//                            McpContent
//
//   Sync            Push/pull replication via event sourcing watermarks.
//                   (not yet implemented)
//
// Usage:
//   import { ulid, sqliteOpen, sqliteMigrate, esStore } from "./libraries";
//
// Find a module: grep "^// SECTION:" libraries.ts
// ============================================================================

import { Database } from "bun:sqlite";

// ============================================================================
// SECTION: ULID
// ============================================================================
//
// Summary:
//   Universally Unique Lexicographically Sortable Identifiers. 128 bits
//   encoded as 26 Crockford base32 characters. This is the ID scheme for
//   every entity across every node.
//
// Usage:
//   const id = ulid();             // "01J5A3B7KC9QR0XVWT2MPD4GHN"
//   const ts = ulidTimestamp(id);  // 1720000000000 (ms since epoch)
//   const d  = new Date(ts);       // 2025-07-03T...
//
// Bun built-ins:
//   - crypto.getRandomValues() — provides the 80 random bits. No built-in
//     ULID, and crypto.randomUUID() is not sortable.
//
// Design notes:
//   - Monotonic within the same millisecond: if two calls happen in the
//     same ms, the random portion is incremented rather than re-rolled.
//     This guarantees sort order equals creation order.
//   - If the clock goes backwards (NTP adjustment, etc.), we treat it as
//     same-millisecond and increment, avoiding duplicate timestamps.
//   - Timestamp overflow at 10889 AD. We'll be fine.
//

const _ULID_ENCODING = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
let _ulidLastTime = 0;
const _ulidLastRandom = new Array<number>(16).fill(0);

export function ulid(now = Date.now()): string {
  const out = new Array<string>(26);

  if (now <= _ulidLastTime) {
    // Same or earlier ms: increment random for monotonicity
    let carry = true;
    for (let i = 15; i >= 0 && carry; i--) {
      _ulidLastRandom[i]++;
      if (_ulidLastRandom[i] >= 32) {
        _ulidLastRandom[i] = 0;
      } else {
        carry = false;
      }
    }
  } else {
    // New ms: generate fresh 80 random bits (10 bytes → 16 base32 chars)
    _ulidLastTime = now;
    const bytes = crypto.getRandomValues(new Uint8Array(10));
    for (let chunk = 0; chunk < 2; chunk++) {
      const byteOff = chunk * 5;
      const charOff = chunk * 8;
      let n = 0;
      for (let b = 0; b < 5; b++) n = n * 256 + bytes[byteOff + b];
      for (let c = 7; c >= 0; c--) {
        _ulidLastRandom[charOff + c] = n % 32;
        n = Math.floor(n / 32);
      }
    }
  }

  // Encode timestamp: 10 Crockford base32 chars using _ulidLastTime
  // (which equals now for new ms, or the previous time if clock went backwards)
  let t = _ulidLastTime;
  for (let i = 9; i >= 0; i--) {
    out[i] = _ULID_ENCODING[t % 32];
    t = Math.floor(t / 32);
  }

  for (let i = 0; i < 16; i++) {
    out[10 + i] = _ULID_ENCODING[_ulidLastRandom[i]];
  }

  return out.join("");
}

export function ulidTimestamp(id: string): number {
  let t = 0;
  for (let i = 0; i < 10; i++) {
    t = t * 32 + _ULID_ENCODING.indexOf(id[i]);
  }
  return t;
}

// ============================================================================
// SECTION: SQLite
// ============================================================================
//
// Summary:
//   Litestream-compatible SQLite database setup with a simple migration runner.
//   Returns a raw bun:sqlite Database — no wrapper, no ORM.
//
// Usage:
//   const db = sqliteOpen("./myapp.db");
//   sqliteMigrate(db, [
//     "CREATE TABLE users (id TEXT PRIMARY KEY, name TEXT NOT NULL)",
//     "ALTER TABLE users ADD COLUMN email TEXT",
//   ]);
//   const row = db.query("SELECT * FROM users WHERE id = ?").get("user-1");
//   db.close();
//
// Bun built-ins:
//   - bun:sqlite — provides Database with query/run/transaction. We use it
//     directly. This section only adds: Litestream-compatible pragma setup
//     and a sequential migration runner. After sqliteOpen(), you work with
//     the raw Database.
//
// Design notes:
//   - WAL mode is mandatory for Litestream (it replicates WAL frames).
//   - busy_timeout = 5000ms handles concurrent readers during writes.
//   - synchronous = NORMAL is safe with WAL and avoids fsync on every commit.
//   - Migrations are append-only (no down migrations). Each is a SQL string
//     tracked by index in a _migrations table. This matches the event sourcing
//     philosophy — history is immutable.
//

export function sqliteOpen(path: string): Database {
  const db = new Database(path);
  db.run("PRAGMA journal_mode = WAL");
  db.run("PRAGMA busy_timeout = 5000");
  db.run("PRAGMA synchronous = NORMAL");
  db.run("PRAGMA foreign_keys = ON");
  return db;
}

// SAFETY: migrations are raw SQL strings executed directly. Only pass trusted, hardcoded SQL.
export function sqliteMigrate(db: Database, migrations: string[]): void {
  db.run(`
    CREATE TABLE IF NOT EXISTS _migrations (
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    )
  `);

  const row = db.query("SELECT COALESCE(MAX(version), -1) as v FROM _migrations").get() as { v: number };
  const startAt = row.v + 1;

  if (startAt >= migrations.length) return;

  const apply = db.transaction(() => {
    for (let i = startAt; i < migrations.length; i++) {
      db.run(migrations[i]);
      db.run("INSERT INTO _migrations (version) VALUES (?)", [i]);
    }
  });

  apply();
}

// ============================================================================
// SECTION: Event Sourcing
// ============================================================================
//
// Summary:
//   Append-only event store backed by SQLite. Create named stores, append
//   events to streams, replay them, fold into current state, and track
//   consumer high-water marks for sync/subscription.
//
// Usage:
//   const db = sqliteOpen("./myapp.db");
//   const store = esStore(db, "accounts");
//
//   // Append events
//   store.append("acct-1", "opened", { owner: "Alice", balance: 0 });
//   store.append("acct-1", "deposited", { amount: 100 });
//   store.append("acct-1", "withdrawn", { amount: 30 });
//
//   // Replay a single stream
//   const events = store.replay("acct-1");
//
//   // Materialize current state
//   const account = store.materialize("acct-1", (state, evt) => {
//     switch (evt.type) {
//       case "opened":    return { ...evt.data };
//       case "deposited": return { ...state, balance: state.balance + evt.data.amount };
//       case "withdrawn": return { ...state, balance: state.balance - evt.data.amount };
//       default: return state;
//     }
//   }, {} as Account);
//
//   // High-water marks for consumers (e.g., sync, projections)
//   const hwm = store.hwmGet("sync-server");
//   const newEvents = store.replayAll({ after: hwm });
//   if (newEvents.length > 0) {
//     store.hwmSet("sync-server", newEvents.at(-1)!.sequence);
//   }
//
// Bun built-ins:
//   - bun:sqlite — provides the raw storage. This section adds: event table
//     schema, append with JSON serialization, replay with ordering guarantees,
//     fold/materialize, and high-water mark tracking. None of that exists in
//     bun:sqlite alone.
//
// Design notes:
//   - Each store gets its own table pair ({prefix}_events, {prefix}_hwm) so
//     multiple stores can coexist in one database without collision.
//   - sequence is an INTEGER PRIMARY KEY AUTOINCREMENT — SQLite guarantees
//     monotonically increasing values even after deletes. This is critical
//     for high-water mark correctness.
//   - Data is stored as JSON text. We serialize on append and parse on replay.
//     This keeps the schema simple and grep-friendly in the raw database.
//   - The stream_id + sequence index enables efficient per-stream replay
//     without scanning the entire event table.
//   - Litestream compatibility is inherited from sqliteOpen() — WAL mode
//     means event appends are replicated automatically.
//

export interface EsEvent<T = any> {
  sequence: number;
  streamId: string;
  type: string;
  data: T;
  timestamp: string;
}

export interface EsStore {
  append(streamId: string, type: string, data: unknown): EsEvent;
  appendBatch(events: Array<{ streamId: string; type: string; data: unknown }>): EsEvent[];
  replay(streamId: string, opts?: { after?: number; limit?: number; types?: string[] }): EsEvent[];
  replayAll(opts?: { after?: number; limit?: number; types?: string[] }): EsEvent[];
  materialize<S>(streamId: string, reducer: (state: S, event: EsEvent) => S, initial: S): S;
  hwmGet(consumerId: string): number;
  hwmSet(consumerId: string, sequence: number): void;
  streamIds(): string[];
  count(streamId?: string): number;
}

// SAFETY: prefix is interpolated into SQL table/index names. Must be a trusted hardcoded string literal, never user input.
export function esStore(db: Database, prefix: string): EsStore {
  db.run(`
    CREATE TABLE IF NOT EXISTS ${prefix}_events (
      sequence INTEGER PRIMARY KEY AUTOINCREMENT,
      stream_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      data TEXT NOT NULL,
      timestamp TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    )
  `);
  db.run(`
    CREATE INDEX IF NOT EXISTS idx_${prefix}_events_stream
    ON ${prefix}_events(stream_id, sequence)
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS ${prefix}_hwm (
      consumer_id TEXT PRIMARY KEY,
      sequence INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    )
  `);

  const insertStmt = db.query(
    `INSERT INTO ${prefix}_events (stream_id, event_type, data) VALUES (?, ?, ?) RETURNING *`
  );

  function _rowToEvent(row: any): EsEvent {
    return {
      sequence: row.sequence,
      streamId: row.stream_id,
      type: row.event_type,
      data: JSON.parse(row.data),
      timestamp: row.timestamp,
    };
  }

  const store: EsStore = {
    append(streamId, type, data) {
      const row = insertStmt.get(streamId, type, JSON.stringify(data)) as any;
      return _rowToEvent(row);
    },

    appendBatch(events) {
      const results: EsEvent[] = [];
      const batchInsert = db.transaction(() => {
        for (const evt of events) {
          const row = insertStmt.get(evt.streamId, evt.type, JSON.stringify(evt.data)) as any;
          results.push(_rowToEvent(row));
        }
      });
      batchInsert();
      return results;
    },

    replay(streamId, opts = {}) {
      const after = opts.after ?? -1;
      const limit = opts.limit;
      const types = opts.types;
      let sql = `SELECT * FROM ${prefix}_events WHERE stream_id = ? AND sequence > ?`;
      const params: any[] = [streamId, after];
      if (types !== undefined && types.length > 0) {
        sql += ` AND event_type IN (${types.map(() => "?").join(", ")})`;
        params.push(...types);
      }
      sql += " ORDER BY sequence ASC";
      if (limit !== undefined) {
        sql += " LIMIT ?";
        params.push(limit);
      }
      const rows = db.query(sql).all(...params) as any[];
      return rows.map(_rowToEvent);
    },

    replayAll(opts = {}) {
      const after = opts.after ?? -1;
      const limit = opts.limit;
      const types = opts.types;
      let sql = `SELECT * FROM ${prefix}_events WHERE sequence > ?`;
      const params: any[] = [after];
      if (types !== undefined && types.length > 0) {
        sql += ` AND event_type IN (${types.map(() => "?").join(", ")})`;
        params.push(...types);
      }
      sql += " ORDER BY sequence ASC";
      if (limit !== undefined) {
        sql += " LIMIT ?";
        params.push(limit);
      }
      const rows = db.query(sql).all(...params) as any[];
      return rows.map(_rowToEvent);
    },

    materialize<S>(streamId: string, reducer: (state: S, event: EsEvent) => S, initial: S): S {
      const events = store.replay(streamId);
      return events.reduce((state, evt) => reducer(state, evt), initial);
    },

    hwmGet(consumerId) {
      const row = db.query(
        `SELECT sequence FROM ${prefix}_hwm WHERE consumer_id = ?`
      ).get(consumerId) as { sequence: number } | null;
      return row?.sequence ?? 0;
    },

    hwmSet(consumerId, sequence) {
      db.run(
        `INSERT INTO ${prefix}_hwm (consumer_id, sequence, updated_at)
         VALUES (?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
         ON CONFLICT(consumer_id) DO UPDATE SET sequence = excluded.sequence, updated_at = excluded.updated_at`,
        [consumerId, sequence]
      );
    },

    streamIds() {
      const rows = db.query(
        `SELECT DISTINCT stream_id FROM ${prefix}_events ORDER BY stream_id`
      ).all() as { stream_id: string }[];
      return rows.map(r => r.stream_id);
    },

    count(streamId?) {
      if (streamId !== undefined) {
        const row = db.query(
          `SELECT COUNT(*) as n FROM ${prefix}_events WHERE stream_id = ?`
        ).get(streamId) as { n: number };
        return row.n;
      }
      const row = db.query(
        `SELECT COUNT(*) as n FROM ${prefix}_events`
      ).get() as { n: number };
      return row.n;
    },
  };

  return store;
}

// ============================================================================
// SECTION: HTTP
// ============================================================================
//
// Summary:
//   Utilities for Bun.serve(). Not a router — Bun.serve({ routes }) already
//   handles path params and method dispatch natively. This module provides
//   the missing pieces: CORS, JSON error responses, and body parsing.
//
// Usage:
//   Bun.serve({
//     port: 3000,
//     routes: {
//       "/api/items/:id": {
//         GET: httpHandler(async (req) => {
//           return { id: req.params.id };  // auto-wrapped in Response.json
//         }),
//         POST: httpHandler(async (req) => {
//           const body = await httpJsonBody(req);
//           return { created: true, ...body };
//         }),
//       },
//     },
//     fetch: httpCors(httpNotFound),  // CORS preflight + 404 fallback
//   });
//
// Bun built-ins:
//   - Bun.serve({ routes }) — path params (:id), method dispatch ({ GET, POST }),
//     wildcards (*), async handlers all work natively since Bun 1.2.3.
//     Missing: CORS preflight falls through to fetch with 404. No auto-JSON
//     serialization of plain objects. No structured error responses. req.json()
//     throws on bad input with no status code context.
//
// Design notes:
//   - httpHandler wraps a handler to: (a) auto-serialize plain objects/arrays
//     to Response.json, (b) catch errors and return structured JSON errors.
//     Keeps route handlers clean — just return data or throw.
//   - httpCors wraps the fetch fallback to intercept OPTIONS preflight and
//     add CORS headers to all responses. It takes a fallback handler for
//     non-OPTIONS requests (typically httpNotFound).
//   - HttpError is a throwable class with a status code. httpHandler catches
//     it and formats the response. Throw new HttpError(404, "not found")
//     from any handler.
//   - httpJsonBody parses req.json() and throws HttpError(400) on failure,
//     so you don't need try/catch in every POST handler.
//

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export interface HttpCorsOptions {
  origin?: string;
  methods?: string;
  headers?: string;
  maxAge?: number;
}

const _HTTP_DEFAULT_CORS: Required<HttpCorsOptions> = {
  origin: "*",
  methods: "GET, POST, PUT, PATCH, DELETE, OPTIONS",
  headers: "Content-Type, Authorization",
  maxAge: 86400,
};

export function httpCors(
  fallback: (req: Request) => Response | Promise<Response>,
  opts: HttpCorsOptions = {},
): (req: Request) => Response | Promise<Response> {
  const cfg = { ..._HTTP_DEFAULT_CORS, ...opts };
  const corsHeaders: Record<string, string> = {
    "Access-Control-Allow-Origin": cfg.origin,
    "Access-Control-Allow-Methods": cfg.methods,
    "Access-Control-Allow-Headers": cfg.headers,
    "Access-Control-Max-Age": String(cfg.maxAge),
  };

  return async (req: Request) => {
    if (req.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }
    const res = await fallback(req);
    for (const [k, v] of Object.entries(corsHeaders)) {
      res.headers.set(k, v);
    }
    return res;
  };
}

type HttpHandlerFn = (req: Request) => any | Promise<any>;

export function httpHandler(fn: HttpHandlerFn): (req: Request) => Response | Promise<Response> {
  return async (req: Request) => {
    try {
      const result = await fn(req);
      if (result instanceof Response) return result;
      return Response.json(result);
    } catch (err) {
      if (err instanceof HttpError) {
        return Response.json({ error: err.message }, { status: err.status });
      }
      const message = err instanceof Error ? err.message : "Internal server error";
      return Response.json({ error: message }, { status: 500 });
    }
  };
}

export async function httpJsonBody<T = unknown>(req: Request): Promise<T> {
  try {
    return await req.json() as T;
  } catch {
    throw new HttpError(400, "Invalid JSON body");
  }
}

export function httpNotFound(): Response {
  return Response.json({ error: "Not found" }, { status: 404 });
}

// ============================================================================
// SECTION: MCP
// ============================================================================
//
// Summary:
//   Model Context Protocol server. Register tools and resources with simple
//   handlers, then serve over Streamable HTTP (POST endpoint) or stdio
//   (newline-delimited JSON-RPC). Handles the full MCP lifecycle: initialize
//   handshake, capability negotiation, tool dispatch, and resource reads.
//
// Usage:
//   const server = mcpServer({ name: "my-tool", version: "1.0.0" });
//
//   server.tool("lookup_user", {
//     description: "Look up a user by ID",
//     input: {
//       type: "object",
//       properties: { id: { type: "string" } },
//       required: ["id"],
//     },
//     handler: async ({ id }) => {
//       const user = db.query("SELECT * FROM users WHERE id = ?").get(id);
//       return user ? JSON.stringify(user) : "User not found";
//     },
//   });
//
//   server.resource("config://app", {
//     name: "App Config",
//     handler: () => JSON.stringify({ env: "production" }),
//   });
//
//   // Streamable HTTP transport with Bun.serve
//   Bun.serve({
//     routes: { "/mcp": { POST: server.httpTransport() } },
//     fetch: httpCors(httpNotFound),
//   });
//
// Bun built-ins:
//   - Bun.serve() — HTTP server for the Streamable HTTP transport.
//   - Bun.stdin / Bun.stdout — raw stdio for the stdio transport (future).
//   - crypto.randomUUID() — session ID generation.
//   - None of these provide JSON-RPC framing, MCP lifecycle management,
//     capability negotiation, or tool/resource dispatch.
//
// Design notes:
//   - The core is a transport-agnostic handleMessage() function. Both
//     httpTransport and future serveStdio wrap this same dispatch.
//   - Tool handlers can return a string (auto-wrapped in text content) or a
//     full McpToolResult for multi-part responses (images, resources, etc).
//   - Tool execution errors are returned as isError: true in the result, NOT
//     as JSON-RPC errors. JSON-RPC errors (-32xxx) are for protocol issues
//     (unknown method, parse error, etc). This matches the MCP spec.
//   - Session IDs are generated on initialize but not enforced on subsequent
//     requests, so simple clients work without session management.
//   - No SSE streaming yet — POST → JSON response only. Sufficient for all
//     request/response tools and resources. SSE streaming can be added later
//     for server-initiated notifications.
//   - Protocol version: 2025-11-25 (latest stable).
//

export type McpContent =
  | { type: "text"; text: string }
  | { type: "image"; data: string; mimeType: string }
  | { type: "resource"; resource: { uri: string; text?: string; blob?: string; mimeType?: string } };

export interface McpToolResult {
  content: McpContent[];
  isError?: boolean;
}

export interface McpResourceContents {
  contents: Array<{
    uri: string;
    text?: string;
    blob?: string;
    mimeType?: string;
  }>;
}

export interface McpToolDef {
  description: string;
  input?: Record<string, any>;
  handler: (args: any) => Promise<string | McpToolResult> | string | McpToolResult;
}

export interface McpResourceDef {
  name: string;
  description?: string;
  mimeType?: string;
  handler: (uri: string) => Promise<string | McpResourceContents> | string | McpResourceContents;
}

export interface McpServerOptions {
  name: string;
  version: string;
  protocolVersion?: string;
}

export interface McpServer {
  tool(name: string, def: McpToolDef): void;
  resource(uri: string, def: McpResourceDef): void;
  handleMessage(msg: any): Promise<any | null>;
  httpTransport(): (req: Request) => Promise<Response>;
}

export function mcpServer(opts: McpServerOptions): McpServer {
  const tools = new Map<string, McpToolDef>();
  const resources = new Map<string, McpResourceDef>();
  const protocolVersion = opts.protocolVersion ?? "2025-11-25";
  let initialized = false;
  let sessionId: string | null = null;

  function _ok(id: string | number, result: any) {
    return { jsonrpc: "2.0" as const, id, result };
  }

  function _err(id: string | number | null, code: number, message: string) {
    return { jsonrpc: "2.0" as const, id, error: { code, message } };
  }

  async function handleMessage(msg: any): Promise<any | null> {
    if (!msg || msg.jsonrpc !== "2.0") {
      return _err(msg?.id ?? null, -32600, "Invalid JSON-RPC request");
    }

    // Notifications (no id) — process but don't respond
    if (msg.id === undefined || msg.id === null) {
      if (msg.method === "notifications/initialized") {
        initialized = true;
      }
      return null;
    }

    const id = msg.id;
    const params = msg.params ?? {};

    switch (msg.method) {
      case "initialize":
        initialized = false;
        sessionId = crypto.randomUUID();
        return _ok(id, {
          protocolVersion,
          capabilities: {
            ...(tools.size > 0 ? { tools: {} } : {}),
            ...(resources.size > 0 ? { resources: {} } : {}),
          },
          serverInfo: { name: opts.name, version: opts.version },
        });

      case "ping":
        return _ok(id, {});

      case "tools/list":
        return _ok(id, {
          tools: [...tools.entries()].map(([name, def]) => ({
            name,
            description: def.description,
            inputSchema: def.input ?? { type: "object" },
          })),
        });

      case "tools/call": {
        const tool = tools.get(params.name);
        if (!tool) return _err(id, -32602, `Unknown tool: ${params.name}`);
        const args = params.arguments ?? {};
        const schema = tool.input;
        if (schema?.required) {
          const missing = (schema.required as string[]).filter((k) => !(k in args));
          if (missing.length > 0) {
            return _err(id, -32602, `Missing required parameter${missing.length > 1 ? "s" : ""}: ${missing.join(", ")}`);
          }
        }
        try {
          const result = await tool.handler(args);
          if (typeof result === "string") {
            return _ok(id, { content: [{ type: "text", text: result }] });
          }
          return _ok(id, result);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return _ok(id, { content: [{ type: "text", text: message }], isError: true });
        }
      }

      case "resources/list":
        return _ok(id, {
          resources: [...resources.entries()].map(([uri, def]) => ({
            uri,
            name: def.name,
            ...(def.description ? { description: def.description } : {}),
            ...(def.mimeType ? { mimeType: def.mimeType } : {}),
          })),
        });

      case "resources/read": {
        const res = resources.get(params.uri);
        if (!res) return _err(id, -32002, `Resource not found: ${params.uri}`);
        try {
          const result = await res.handler(params.uri);
          if (typeof result === "string") {
            return _ok(id, {
              contents: [{
                uri: params.uri,
                ...(res.mimeType ? { mimeType: res.mimeType } : {}),
                text: result,
              }],
            });
          }
          return _ok(id, result);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return _err(id, -32603, message);
        }
      }

      case "resources/templates/list":
        return _ok(id, { resourceTemplates: [] });

      case "prompts/list":
        return _ok(id, { prompts: [] });

      default:
        return _err(id, -32601, `Method not found: ${msg.method}`);
    }
  }

  function httpTransport(): (req: Request) => Promise<Response> {
    return async (req: Request) => {
      let msg: any;
      try {
        msg = await req.json();
      } catch {
        return Response.json(
          { jsonrpc: "2.0", error: { code: -32700, message: "Parse error" }, id: null },
          { status: 400 },
        );
      }

      const response = await handleMessage(msg);

      // Notifications and responses return 202 with no body
      if (response === null) {
        return new Response(null, { status: 202 });
      }

      const headers: Record<string, string> = {};
      if (msg.method === "initialize" && !response.error && sessionId) {
        headers["Mcp-Session-Id"] = sessionId;
      }

      return Response.json(response, { headers });
    };
  }

  return {
    tool(name, def) { tools.set(name, def); },
    resource(uri, def) { resources.set(uri, def); },
    handleMessage,
    httpTransport,
  };
}

// ============================================================================
// SECTION: Sync
// ============================================================================
//
// Summary:
//   Push/pull sync protocol for replicating event-sourced data between
//   nodes. Builds on Event Sourcing high-water marks.
//
// Usage:
//   // On the server
//   const changes = store.replayAll({ after: clientHwm });
//   // Send changes to client, receive client's hwm back
//
//   // On the client
//   const pulled = syncPull(serverUrl, localHwm);
//   for (const evt of pulled.events) {
//     localStore.append(evt.streamId, evt.type, evt.data);
//   }
//
// Bun built-ins:
//   - fetch() — HTTP client for pull requests. No built-in sync protocol,
//     conflict resolution, or watermark negotiation.
//
// Design notes:
//   - TODO: Implementation pending.
//   - Sync is last-writer-wins by default. Conflict resolution is delegated
//     to the event reducer (materialize step).
//   - Watermarks are per-consumer, so multiple sync partners are supported.
//

// TODO: syncPull, syncPush, syncServer
