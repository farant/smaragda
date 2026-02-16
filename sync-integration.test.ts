import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import {
  initKernel,
  createEntity,
  setAttribute,
  materialize,
  defineEntityGenus,
  findGenusByName,
  listEntities,
  getSyncState,
  setSyncState,
  getUnpushedTessellae,
  getUnpushedRes,
  insertPulledData,
  type Kernel,
  type SyncPullData,
  type SyncPushResult,
} from "./smaragda";
import { Subprocess } from "bun";

const SERVER_PORT = 3099;
const SERVER_URL = `http://localhost:${SERVER_PORT}`;
const AUTH_TOKEN = "test-integration-token";
const SERVER_DB = "/tmp/smaragda-integration-test.db";

let serverProc: Subprocess;

async function waitForServer(url: string, maxMs = 5000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    try {
      const resp = await fetch(`${url}/sync/pull`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${AUTH_TOKEN}` },
        body: JSON.stringify({ since: 0, device_id: "healthcheck" }),
      });
      if (resp.ok) return;
    } catch {}
    await Bun.sleep(100);
  }
  throw new Error("Server did not start in time");
}

function headers(): Record<string, string> {
  return { "Content-Type": "application/json", Authorization: `Bearer ${AUTH_TOKEN}` };
}

describe("Sync Integration", () => {
  beforeAll(async () => {
    // Clean up any previous test db
    try { require("fs").unlinkSync(SERVER_DB); } catch {}

    serverProc = Bun.spawn(["bun", "server.ts"], {
      env: {
        ...process.env,
        PORT: String(SERVER_PORT),
        AUTH_TOKEN,
        DB_PATH: SERVER_DB,
      },
      stdout: "pipe",
      stderr: "pipe",
    });

    await waitForServer(SERVER_URL);
  });

  afterAll(async () => {
    serverProc.kill();
    await serverProc.exited;
    try { require("fs").unlinkSync(SERVER_DB); } catch {}
  });

  // --- /sync/pull ---

  test("POST /sync/pull returns res, tessellae, and high_water_mark", async () => {
    const resp = await fetch(`${SERVER_URL}/sync/pull`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ since: 0, device_id: "test-device" }),
    });
    expect(resp.status).toBe(200);
    const data = await resp.json() as SyncPullData;
    expect(data.res).toBeInstanceOf(Array);
    expect(data.tessellae).toBeInstanceOf(Array);
    expect(typeof data.high_water_mark).toBe("number");
  });

  test("POST /sync/pull requires auth", async () => {
    const resp = await fetch(`${SERVER_URL}/sync/pull`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ since: 0, device_id: "test" }),
    });
    expect(resp.status).toBe(401);
  });

  test("POST /sync/pull excludes sentinel res", async () => {
    const resp = await fetch(`${SERVER_URL}/sync/pull`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ since: 0, device_id: "test-device" }),
    });
    const data = await resp.json() as SyncPullData;
    const META = "00000000000000000000000000";
    const LOG = "00000000000000000000000001";
    const ERROR = "00000000000000000000000002";
    for (const r of data.res) {
      expect(r.id).not.toBe(META);
      expect(r.id).not.toBe(LOG);
      expect(r.id).not.toBe(ERROR);
    }
  });

  test("POST /sync/pull with since > 0 returns only newer tessellae", async () => {
    // First pull to get current HWM
    const resp1 = await fetch(`${SERVER_URL}/sync/pull`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ since: 0, device_id: "test-device-2" }),
    });
    const data1 = await resp1.json() as SyncPullData;
    const hwm = data1.high_water_mark;

    // Second pull from that HWM — should get fewer tessellae
    const resp2 = await fetch(`${SERVER_URL}/sync/pull`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ since: hwm, device_id: "test-device-2" }),
    });
    const data2 = await resp2.json() as SyncPullData;
    // The main query only returns tessellae with id > hwm, but genus tessellae
    // may be included at lower IDs (injected for non-sentinel genera).
    // The non-genus tessellae should all have id > hwm.
    const nonGenusTessellae = data2.tessellae.filter((t) => {
      // Genus tessellae are those where res_id matches a genus_id of another res
      const genusIds = new Set(data2.res.map((r) => r.genus_id));
      return !genusIds.has(t.res_id);
    });
    for (const t of nonGenusTessellae) {
      expect(t.id).toBeGreaterThan(hwm);
    }
    // Should have fewer total tessellae than the initial pull
    expect(data2.tessellae.length).toBeLessThanOrEqual(data1.tessellae.length);
  });

  // --- /sync/push ---

  test("POST /sync/push inserts res and tessellae on server", async () => {
    // Create a local entity
    const client = initKernel(":memory:");
    const genusId = defineEntityGenus(client, "Widget", {
      attributes: [{ name: "label", type: "text", required: true }],
      states: [{ name: "active", initial: true }],
    });
    const entityId = createEntity(client, genusId);
    setAttribute(client, entityId, "label", "Test Widget");

    // Gather push data
    const tessellae = getUnpushedTessellae(client);
    const res = getUnpushedRes(client, tessellae);

    const resp = await fetch(`${SERVER_URL}/sync/push`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({
        device_id: "push-test-device",
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
      }),
    });

    expect(resp.status).toBe(200);
    const result = await resp.json() as SyncPushResult;
    expect(result.accepted).toBe(tessellae.length);
    expect(result.high_water_mark).toBeGreaterThan(0);

    client.db.close();
  });

  test("POST /sync/push requires auth", async () => {
    const resp = await fetch(`${SERVER_URL}/sync/push`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ device_id: "test", res: [], tessellae: [] }),
    });
    expect(resp.status).toBe(401);
  });

  // --- Round-trip ---

  test("full round-trip: push entity from client, pull it back on another client", async () => {
    // Client A creates an entity
    const clientA = initKernel(":memory:");
    const genusA = defineEntityGenus(clientA, "Book", {
      attributes: [{ name: "title", type: "text", required: true }],
      states: [{ name: "draft", initial: true }],
    });
    const entityId = createEntity(clientA, genusA);
    setAttribute(clientA, entityId, "title", "The Great Novel");

    // Push from client A
    const tessA = getUnpushedTessellae(clientA);
    const resA = getUnpushedRes(clientA, tessA);

    const pushResp = await fetch(`${SERVER_URL}/sync/push`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({
        device_id: "client-a",
        res: resA.map((r) => ({
          id: r.id, genus_id: r.genus_id, branch_id: r.branch_id, created_at: r.created_at,
        })),
        tessellae: tessA.map((t) => ({
          res_id: t.res_id, branch_id: t.branch_id, type: t.type,
          data: t.data, created_at: t.created_at, source: t.source,
        })),
      }),
    });
    expect(pushResp.status).toBe(200);

    // Client B pulls
    const pullResp = await fetch(`${SERVER_URL}/sync/pull`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ since: 0, device_id: "client-b" }),
    });
    expect(pullResp.status).toBe(200);
    const pullData = await pullResp.json() as SyncPullData;

    // Client B inserts the pulled data
    const clientB = initKernel(":memory:");
    insertPulledData(clientB, pullData, "sync:test-server");

    // Verify the entity materializes on client B
    const state = materialize(clientB, entityId);
    expect(state.title).toBe("The Great Novel");
    expect(state.status).toBe("draft");

    clientA.db.close();
    clientB.db.close();
  });

  test("pushed data is excluded from pull by same device", async () => {
    // Client pushes something
    const client = initKernel(":memory:");
    const genusId = defineEntityGenus(client, "Note", {
      attributes: [{ name: "text", type: "text" }],
    });
    const entityId = createEntity(client, genusId);

    const tess = getUnpushedTessellae(client);
    const res = getUnpushedRes(client, tess);

    // Push as "echo-device"
    await fetch(`${SERVER_URL}/sync/push`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({
        device_id: "echo-device",
        res: res.map((r) => ({
          id: r.id, genus_id: r.genus_id, branch_id: r.branch_id, created_at: r.created_at,
        })),
        tessellae: tess.map((t) => ({
          res_id: t.res_id, branch_id: t.branch_id, type: t.type,
          data: t.data, created_at: t.created_at, source: t.source,
        })),
      }),
    });

    // Pull as same device — should not get back the tessellae we just pushed
    const pullResp = await fetch(`${SERVER_URL}/sync/pull`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ since: 0, device_id: "echo-device" }),
    });
    const pullData = await pullResp.json() as SyncPullData;

    // None of the tessellae should be for our entity (they were tagged with device:echo-device)
    const ourTessellae = pullData.tessellae.filter((t) => t.res_id === entityId);
    expect(ourTessellae).toHaveLength(0);

    client.db.close();
  });

  test("device entity is created on first sync", async () => {
    const deviceName = `device-${Date.now()}`;
    await fetch(`${SERVER_URL}/sync/pull`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ since: 0, device_id: deviceName }),
    });

    // Pull again to check if the device shows up in synced data
    const resp = await fetch(`${SERVER_URL}/sync/pull`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ since: 0, device_id: "observer" }),
    });
    const data = await resp.json() as SyncPullData;

    // Look for tessellae that set the device name
    const deviceNameTessellae = data.tessellae.filter(
      (t) => t.type === "attribute_set" && t.data?.key === "name" && t.data?.value === deviceName,
    );
    expect(deviceNameTessellae.length).toBeGreaterThan(0);
  });
});
