// Demo 2 — Genus + Entities + State Machines
// Run with: bun demo2.ts

import {
  initKernel,
  materialize,
  defineEntityGenus,
  createEntity,
  setAttribute,
  transitionStatus,
} from "./smaragda";

// 1. Initialize an in-memory kernel
const kernel = initKernel(":memory:");
console.log("Kernel initialized (in-memory)\n");

// 2. Define a Server genus
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
console.log(`Defined Server genus: ${serverGenus}\n`);

// 3. Create a Server entity — starts in "provisioning"
const serverId = createEntity(kernel, serverGenus);
console.log(`Created Server entity: ${serverId}`);
const initialState = materialize(kernel, serverId);
console.log(`  Initial state:`, initialState);
console.log();

// 4. Set attributes
setAttribute(kernel, serverId, "ip_address", "10.0.0.1");
setAttribute(kernel, serverId, "provider", "DigitalOcean");
setAttribute(kernel, serverId, "monthly_cost", 48);
console.log("Set attributes: ip_address, provider, monthly_cost\n");

// 5. Try invalid transition: provisioning → decommissioned (skip)
console.log("--- Attempting provisioning → decommissioned (skip) ---");
try {
  transitionStatus(kernel, serverId, "decommissioned");
} catch (e: any) {
  console.log(`  REJECTED: ${e.message}`);
}
console.log();

// 6. Valid transition: provisioning → active
console.log("--- Transitioning provisioning → active ---");
transitionStatus(kernel, serverId, "active");
console.log("  OK\n");

// 7. Try invalid transition: active → provisioning (reverse)
console.log("--- Attempting active → provisioning (reverse) ---");
try {
  transitionStatus(kernel, serverId, "provisioning");
} catch (e: any) {
  console.log(`  REJECTED: ${e.message}`);
}
console.log();

// 8. Materialize final state
console.log("--- Materialized state ---");
const finalState = materialize(kernel, serverId);
console.log(` `, finalState);
console.log();

kernel.db.close();
console.log("Done.");
