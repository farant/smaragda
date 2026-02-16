// ============================================================================
// client.ts — Smaragda sync client
// ============================================================================
//
// Local kernel with HTTP push/pull sync to a Smaragda server.
//
// Usage:
//   AUTH_TOKEN=<token> bun client.ts sync
//   bun client.ts list [genus]
//   bun client.ts create <genus> <name>
//   bun client.ts get <id>
//
// Environment:
//   SERVER_URL  — Server base URL (default http://localhost:3000)
//   AUTH_TOKEN  — Bearer token for server auth (required for sync)
//   DEVICE_ID   — Device identifier (default "client-1")
//   DB_PATH     — SQLite database path (default "./client.db")
//

import {
  initKernel,
  createEntity,
  setAttribute,
  listEntities,
  materialize,
  getRes,
  getSyncState,
  setSyncState,
  getUnpushedTessellae,
  getUnpushedRes,
  insertPulledData,
  findGenusByName,
  getGenusDef,
  listGenera,
  type Kernel,
  type SyncPullData,
  type SyncPushResult,
} from "./smaragda";

const SERVER_URL = process.env.SERVER_URL ?? "http://localhost:3000";
const AUTH_TOKEN = process.env.AUTH_TOKEN;
const DEVICE_ID = process.env.DEVICE_ID ?? "client-1";
const DB_PATH = process.env.DB_PATH ?? "./client.db";

const kernel = initKernel(DB_PATH);

function authHeaders(): Record<string, string> {
  if (!AUTH_TOKEN) {
    console.error("AUTH_TOKEN is required for sync operations");
    process.exit(1);
  }
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${AUTH_TOKEN}`,
  };
}

async function pull(): Promise<void> {
  const since = Number(getSyncState(kernel, "server_hwm") ?? "0");
  console.log(`Pulling from ${SERVER_URL} (since ${since})...`);

  const resp = await fetch(`${SERVER_URL}/sync/pull`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ since, device_id: DEVICE_ID }),
  });

  if (!resp.ok) {
    console.error(`Pull failed: ${resp.status} ${await resp.text()}`);
    return;
  }

  const data = (await resp.json()) as SyncPullData;
  const sourceTag = `sync:${SERVER_URL}`;

  if (data.tessellae.length === 0) {
    console.log("Nothing new to pull.");
  } else {
    insertPulledData(kernel, data, sourceTag);
    console.log(`Pulled ${data.tessellae.length} tessellae, ${data.res.length} res.`);
  }

  setSyncState(kernel, "server_hwm", String(data.high_water_mark));
}

async function push(): Promise<void> {
  const tessellae = getUnpushedTessellae(kernel);
  if (tessellae.length === 0) {
    console.log("Nothing to push.");
    return;
  }

  const res = getUnpushedRes(kernel, tessellae);
  console.log(`Pushing ${tessellae.length} tessellae, ${res.length} res...`);

  const pushData = {
    device_id: DEVICE_ID,
    res: res.map((r) => ({
      id: r.id,
      genus_id: r.genus_id,
      branch_id: r.branch_id,
      created_at: r.created_at,
    })),
    tessellae: tessellae.map((t) => ({
      res_id: t.res_id,
      branch_id: t.branch_id,
      type: t.type,
      data: t.data,
      created_at: t.created_at,
      source: t.source,
    })),
  };

  const resp = await fetch(`${SERVER_URL}/sync/push`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(pushData),
  });

  if (!resp.ok) {
    console.error(`Push failed: ${resp.status} ${await resp.text()}`);
    return;
  }

  const result = (await resp.json()) as SyncPushResult;
  console.log(`Pushed ${result.accepted} tessellae. Server HWM: ${result.high_water_mark}`);

  // Update last_pushed_local_id to the max local tessella id we just pushed
  const maxLocalId = Math.max(...tessellae.map((t) => t.id));
  setSyncState(kernel, "last_pushed_local_id", String(maxLocalId));
}

async function sync(): Promise<void> {
  await pull();
  await push();
}

// --- CLI ---

const [cmd, ...args] = process.argv.slice(2);

switch (cmd) {
  case "sync":
    await sync();
    break;

  case "pull":
    await pull();
    break;

  case "push":
    await push();
    break;

  case "list": {
    const genusName = args[0];
    let genusId: string | undefined;
    if (genusName) {
      genusId = findGenusByName(kernel, genusName) ?? undefined;
      if (!genusId) {
        console.error(`Genus not found: ${genusName}`);
        // Show available genera
        const genera = listGenera(kernel);
        if (genera.length > 0) {
          console.log("Available genera:", genera.map((g) => g.name).join(", "));
        }
        break;
      }
    }
    const entities = listEntities(kernel, { genus_id: genusId });
    if (entities.length === 0) {
      console.log("No entities found.");
    } else {
      for (const e of entities) {
        const genusDef = getGenusDef(kernel, e.genus_id);
        const name = (genusDef.meta.name as string) ?? "?";
        console.log(`  ${e.id}  [${name}]  ${JSON.stringify(e.state)}`);
      }
    }
    break;
  }

  case "create": {
    const [genusName, entityName] = args;
    if (!genusName || !entityName) {
      console.error("Usage: bun client.ts create <genus> <name>");
      break;
    }
    const genusId = findGenusByName(kernel, genusName);
    if (!genusId) {
      console.error(`Genus not found: ${genusName}`);
      break;
    }
    const entityId = createEntity(kernel, genusId);
    // Try to set a "name" or "title" attribute
    const genusDef = getGenusDef(kernel, genusId);
    if (genusDef.attributes.name) {
      setAttribute(kernel, entityId, "name", entityName);
    } else if (genusDef.attributes.title) {
      setAttribute(kernel, entityId, "title", entityName);
    }
    const state = materialize(kernel, entityId);
    console.log(`Created ${genusName}: ${entityId}`);
    console.log(JSON.stringify(state, null, 2));
    break;
  }

  case "get": {
    const [entityId] = args;
    if (!entityId) {
      console.error("Usage: bun client.ts get <id>");
      break;
    }
    try {
      const res = getRes(kernel, entityId);
      const state = materialize(kernel, entityId);
      const genusDef = getGenusDef(kernel, res.genus_id);
      console.log(`${entityId}  [${genusDef.meta.name}]`);
      console.log(JSON.stringify(state, null, 2));
    } catch (e: any) {
      console.error(e.message);
    }
    break;
  }

  default:
    console.log("Usage: bun client.ts <command> [args]");
    console.log("Commands: sync, pull, push, list [genus], create <genus> <name>, get <id>");
    break;
}

kernel.db.close();
