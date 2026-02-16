// Demo 1 — Tessella Store
// Run with: bun demo1.ts

import { initKernel, createRes, appendTessella, replay, materialize } from "./smaragda";

// 1. Initialize an in-memory kernel
const kernel = initKernel(":memory:");
console.log("Kernel initialized (in-memory)\n");

// 2. Create a res
const resId = createRes(kernel, "server");
console.log(`Created res: ${resId}\n`);

// 3. Append three tessellae
appendTessella(kernel, resId, "attribute_set", { key: "name", value: "production-1" });
appendTessella(kernel, resId, "attribute_set", { key: "provider", value: "DigitalOcean" });
const t3 = appendTessella(kernel, resId, "attribute_set", { key: "cost", value: 48 });
console.log("Appended 3 tessellae (name, provider, cost)\n");

// 4. Replay all tessellae
console.log("--- Replay ---");
const history = replay(kernel, resId);
for (const t of history) {
  console.log(`  #${t.id} [${t.type}] ${JSON.stringify(t.data)}`);
}
console.log();

// 5. Materialize current state
console.log("--- Materialize (current) ---");
const state1 = materialize(kernel, resId);
console.log(` `, state1);
console.log();

// 6. Append a fourth tessella: update cost
appendTessella(kernel, resId, "attribute_set", { key: "cost", value: 64 });
console.log("Appended tessella: cost → 64\n");

// 7. Materialize at point-in-time (step 3, cost=48)
console.log("--- Materialize (at step 3, upTo: t3.id) ---");
const stateAtT3 = materialize(kernel, resId, { upTo: t3.id });
console.log(` `, stateAtT3);
console.log();

// 8. Materialize current state (cost=64)
console.log("--- Materialize (current) ---");
const state2 = materialize(kernel, resId);
console.log(` `, state2);
console.log();

kernel.db.close();
console.log("Done.");
