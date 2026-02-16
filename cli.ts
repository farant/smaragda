// cli.ts — Zork-style Palace CLI for smaragda
//
// Usage:
//   AUTH_TOKEN=abc bun cli.ts
//   AUTH_TOKEN=abc bun cli.ts --url http://localhost:3000 --workspace "My Project"
//
// Navigation:
//   <number>        Execute numbered palace action
//   <number> text   Action with params (e.g. "93 geology")
//   bare text       Search shortcut (palace action 93)
//   /help           Show commands

import { createInterface, type Interface } from "node:readline";

// --- Aquinas palette (24-bit ANSI) ---
//
// Semantic mapping follows thema.c / thema.h from rhubarb:
//   Background:  warm-gray (#B6967D)  — set via OSC 11
//   Text:        dark-gray (#354524)  — set via OSC 10
//   Text dim:    mauve (#7D5D7D)
//   Cursor:      bright-gold (#FFDB41)
//   Accent:      bright-leaf (#A2F361)
//   Error:       bright-pink (#FF1871)
//   Warning:     medium-gold (#EBB600)
//   Success:     bright-leaf (#A2F361)

const RST = "\x1b[0m";
const BOLD = "\x1b[1m";

function fg(r: number, g: number, b: number): string {
  return `\x1b[38;2;${r};${g};${b}m`;
}

// --- Word wrap ---

function termWidth(): number {
  return process.stdout.columns || 80;
}

function visibleLength(s: string): number {
  return s.replace(/\x1b\[[0-9;]*m/g, "").length;
}

function wordWrap(text: string, width?: number): string {
  const w = width ?? termWidth();
  return text.split("\n").map((line) => wrapLine(line, w)).join("\n");
}

function wrapLine(line: string, width: number): string {
  if (visibleLength(line) <= width) return line;

  // Detect leading whitespace for continuation indent
  const rawIndent = line.match(/^(\s*)/)?.[1] ?? "";
  const contIndent = rawIndent + "  ";

  // Split by spaces, preserving ANSI codes within words
  const content = line.slice(rawIndent.length);
  const parts = content.split(/ +/);

  let result = rawIndent;
  let col = rawIndent.length;

  for (let i = 0; i < parts.length; i++) {
    const word = parts[i];
    const wordWidth = visibleLength(word);

    if (i > 0) {
      if (col + 1 + wordWidth > width && col > visibleLength(rawIndent)) {
        result += "\n" + contIndent;
        col = contIndent.length;
      } else {
        result += " ";
        col += 1;
      }
    }

    result += word;
    col += wordWidth;
  }

  return result;
}

const C = {
  gold:      fg(0xFF, 0xDB, 0x41),  // bright-gold — headers, prompt
  amber:     fg(0xEB, 0xB6, 0x00),  // medium-gold — warnings, notices
  blue:      fg(0x61, 0xBE, 0xFF),  // blue — links, action numbers
  green:     fg(0xA2, 0xF3, 0x61),  // bright-leaf — success, scrolls, accent
  pink:      fg(0xFF, 0x18, 0x71),  // pink — errors
  cream:     fg(0xFF, 0xF3, 0xEB),  // cream — bright emphasis, values
  warm:      fg(0x35, 0x45, 0x24),  // dark-gray — primary text (COLOR_TEXT)
  muted:     fg(0x7D, 0x5D, 0x7D),  // mauve — dim/secondary (COLOR_TEXT_DIM)
  mauve:     fg(0x82, 0x20, 0x20),  // dark-red — keys (COLORATIO_CLAVIS)
  darkGreen: fg(0x41, 0x82, 0x20),  // dark-leaf — subtle links
};

// Set terminal background/foreground to Aquinas palette via OSC
function applyTheme(): void {
  process.stdout.write("\x1b]10;rgb:35/45/24\x07");  // fg: dark-gray
  process.stdout.write("\x1b]11;rgb:b6/96/7d\x07");  // bg: warm-gray
  process.stdout.write("\x1b]12;rgb:ff/db/41\x07");  // cursor: bright-gold
}

function restoreTheme(): void {
  process.stdout.write("\x1b]110\x07");  // restore default fg
  process.stdout.write("\x1b]111\x07");  // restore default bg
  process.stdout.write("\x1b]112\x07");  // restore default cursor
}

// --- Config ---

function argVal(flag: string): string | null {
  const idx = process.argv.indexOf(flag);
  return idx !== -1 && idx + 1 < process.argv.length ? process.argv[idx + 1] : null;
}

const SERVER_URL = argVal("--url") ?? process.env.SERVER_URL ?? "http://localhost:3000";
const AUTH_TOKEN = argVal("--token") ?? process.env.AUTH_TOKEN;
const WORKSPACE_ARG = argVal("--workspace");

if (!AUTH_TOKEN) {
  console.error("AUTH_TOKEN is required. Set via environment or --token flag.");
  process.exit(1);
}

// --- MCP Client ---

let _msgId = 0;
let _sessionId: string | null = null;
let _toolSessionId: string | null = null;

function authHeaders(): Record<string, string> {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${AUTH_TOKEN}`,
  };
}

async function rpc(method: string, params?: any): Promise<any> {
  const id = ++_msgId;
  const body = { jsonrpc: "2.0", id, method, params: params ?? {} };
  const headers: Record<string, string> = authHeaders();
  if (_sessionId) headers["Mcp-Session-Id"] = _sessionId;

  const resp = await fetch(`${SERVER_URL}/mcp`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    if (resp.status === 401) throw new Error("Authentication failed. Check AUTH_TOKEN.");
    throw new Error(`HTTP ${resp.status}: ${await resp.text()}`);
  }

  const sid = resp.headers.get("Mcp-Session-Id");
  if (sid) _sessionId = sid;

  if (resp.status === 202) return null;

  const json = await resp.json();
  if (json.error) throw new Error(`RPC error: ${json.error.message}`);
  return json.result;
}

async function notify(method: string, params?: any): Promise<void> {
  const body = { jsonrpc: "2.0", method, params: params ?? {} };
  const headers: Record<string, string> = authHeaders();
  if (_sessionId) headers["Mcp-Session-Id"] = _sessionId;

  await fetch(`${SERVER_URL}/mcp`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  }).catch(() => {});
}

async function callTool(name: string, args: Record<string, any> = {}): Promise<string> {
  if (_toolSessionId) args._session_id = _toolSessionId;

  const result = await rpc("tools/call", { name, arguments: args });

  const text = result?.content?.[0]?.text ?? "";
  const isError = result?.isError === true;

  try {
    const parsed = JSON.parse(text);
    if (parsed._session_id) _toolSessionId = parsed._session_id;
  } catch {}

  if (isError) throw new Error(text);
  return text;
}

async function connect(): Promise<void> {
  await rpc("initialize", {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "smaragda-cli", version: "1.0.0" },
  });
  await notify("notifications/initialized");
}

async function disconnect(): Promise<void> {
  const headers: Record<string, string> = authHeaders();
  if (_sessionId) headers["Mcp-Session-Id"] = _sessionId;
  await fetch(`${SERVER_URL}/mcp`, { method: "DELETE", headers }).catch(() => {});
}

// --- Display ---

let _currentWorkspace: string | null = null;

const INTERNAL_KEYS = new Set(["_session_id", "_note"]);

function formatScalar(v: unknown): string {
  if (v === null || v === undefined) return `${C.muted}—${RST}`;
  if (typeof v === "string") return `${C.cream}${v}${RST}`;
  if (typeof v === "boolean") return `${C.cream}${v ? "yes" : "no"}${RST}`;
  return `${C.cream}${v}${RST}`;
}

function plainScalar(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "string") return v;
  if (typeof v === "boolean") return v ? "yes" : "no";
  return String(v);
}

function isScalar(v: unknown): boolean {
  return v === null || v === undefined || typeof v !== "object";
}

function isCounts(obj: Record<string, unknown>): boolean {
  const vals = Object.values(obj);
  return vals.length > 0 && vals.length <= 8 && vals.every((v) => typeof v === "number");
}

function formatCounts(obj: Record<string, unknown>): string {
  const parts = Object.entries(obj).filter(([, v]) => v !== 0);
  if (parts.length === 0) return `${C.muted}(all zero)${RST}`;
  return parts.map(([k, v]) => `${C.mauve}${k}:${RST} ${C.cream}${v}${RST}`).join(`${C.muted},${RST} `);
}

function pickLabel(obj: Record<string, unknown>): string | null {
  for (const key of ["name", "title", "subject", "label"]) {
    if (typeof obj[key] === "string" && obj[key]) return obj[key] as string;
  }
  return null;
}

function formatArray(arr: any[], indent: string): string {
  if (arr.length === 0) return `${indent}${C.muted}(none)${RST}`;

  if (arr.every(isScalar)) {
    return arr.map((v) => `${indent}  ${C.muted}-${RST} ${formatScalar(v)}`).join("\n");
  }

  const lines: string[] = [];
  for (let i = 0; i < arr.length; i++) {
    const item = arr[i];
    if (typeof item !== "object" || item === null) {
      lines.push(`${indent}  ${C.mauve}${i + 1}.${RST} ${formatScalar(item)}`);
      continue;
    }

    const label = pickLabel(item);
    const rest = Object.entries(item)
      .filter(([k]) => !INTERNAL_KEYS.has(k))
      .filter(([k]) => label ? k !== "name" && k !== "title" && k !== "subject" && k !== "label" : true);

    const scalars = rest.filter(([, v]) => isScalar(v));
    const nested = rest.filter(([, v]) => !isScalar(v));

    const scalarStr = scalars.map(([k, v]) => `${C.mauve}${k}:${RST} ${C.muted}${plainScalar(v)}${RST}`).join(`${C.muted},${RST} `);

    if (label) {
      lines.push(`${indent}  ${C.mauve}${i + 1}.${RST} ${C.warm}${label}${RST}${scalarStr ? `  ${C.muted}(${RST}${scalarStr}${C.muted})${RST}` : ""}`);
    } else if (scalarStr) {
      lines.push(`${indent}  ${C.mauve}${i + 1}.${RST} ${scalarStr}`);
    } else {
      lines.push(`${indent}  ${C.mauve}${i + 1}.${RST}`);
    }

    for (const [k, v] of nested) {
      if (Array.isArray(v) && v.every(isScalar)) {
        lines.push(`${indent}     ${C.mauve}${k}:${RST} ${v.map((x) => `${C.cream}${plainScalar(x)}${RST}`).join(`${C.muted},${RST} `)}`);
      } else if (Array.isArray(v)) {
        lines.push(`${indent}     ${C.mauve}${k}:${RST}`);
        lines.push(formatArray(v, indent + "     "));
      } else if (typeof v === "object" && v !== null && isCounts(v as Record<string, unknown>)) {
        lines.push(`${indent}     ${C.mauve}${k}:${RST} ${formatCounts(v as Record<string, unknown>)}`);
      }
    }
  }
  return lines.join("\n");
}

function formatJson(obj: any): string {
  if (typeof obj !== "object" || obj === null) return formatScalar(obj);
  if (Array.isArray(obj)) return formatArray(obj, "");

  const entries = Object.entries(obj).filter(([k]) => !INTERNAL_KEYS.has(k));
  const lines: string[] = [];

  for (const [k, v] of entries) {
    if (isScalar(v)) {
      lines.push(`${C.mauve}${k}${RST} ${C.muted}=${RST} ${formatScalar(v)}`);
    }
  }

  for (const [k, v] of entries) {
    if (!isScalar(v)) {
      if (lines.length > 0) lines.push("");

      if (Array.isArray(v)) {
        if (v.length === 0) {
          lines.push(`${C.amber}${k}:${RST} ${C.muted}(none)${RST}`);
        } else if (v.every(isScalar)) {
          lines.push(`${C.amber}${k}:${RST} ${v.map((x) => `${C.cream}${plainScalar(x)}${RST}`).join(`${C.muted},${RST} `)}`);
        } else {
          lines.push(`${C.amber}${k}:${RST}`);
          lines.push(formatArray(v, ""));
        }
      } else if (typeof v === "object" && v !== null) {
        if (isCounts(v as Record<string, unknown>)) {
          lines.push(`${C.amber}${k}:${RST} ${formatCounts(v as Record<string, unknown>)}`);
        } else {
          lines.push(`${C.amber}[${k}]${RST}`);
          lines.push(formatJson(v));
        }
      }
    }
  }

  return lines.join("\n");
}

function print(text: string): void {
  console.log(wordWrap(text));
}

function display(raw: string): void {
  try {
    const parsed = JSON.parse(raw);
    delete parsed._session_id;
    delete parsed._note;

    // set_workspace with palace
    if (parsed.palace) {
      if (parsed.name) {
        _currentWorkspace = parsed.name;
        print(`\n  ${C.amber}Workspace:${RST} ${C.warm}${parsed.name}${RST}`);
      }
      if (parsed.branch && parsed.branch !== "main") print(`  ${C.mauve}Branch:${RST} ${C.cream}${parsed.branch}${RST}`);
      print("");
      print(colorizePalace(parsed.palace));
      return;
    }

    // set_workspace without palace (tutorial)
    if (parsed.tutorial) {
      if (parsed.name) _currentWorkspace = parsed.name;
      print("");
      print(`${C.warm}${parsed.tutorial}${RST}`);
      if (parsed.prompt) print(`\n${C.amber}${parsed.prompt}${RST}`);
      return;
    }

    // Workspace list
    if (parsed.workspaces && Array.isArray(parsed.workspaces)) {
      print(`\n${C.amber}Workspaces:${RST}`);
      for (let i = 0; i < parsed.workspaces.length; i++) {
        const ws = parsed.workspaces[i];
        const marker = parsed.current === ws.id ? ` ${C.green}*${RST}` : "";
        const count = ws.entity_count != null ? ` ${C.muted}(${ws.entity_count} entities)${RST}` : "";
        print(`  ${C.mauve}${i + 1}.${RST} ${C.warm}${ws.name}${RST}${count}${marker}`);
      }
      print("");
      return;
    }

    // Formatted JSON
    print(formatJson(parsed));
  } catch {
    // Plain text — but may contain embedded JSON from palace query actions
    print(formatPlainText(raw));
  }
}

// Colorize palace plain-text output (room renders, action results)
function colorizePalace(text: string): string {
  return text.split("\n").map((line) => {
    // Room header: "── Room Name ──"
    if (/^──\s.+\s──$/.test(line)) {
      return `${C.gold}${BOLD}${line}${RST}`;
    }
    // Divider: "  ─────"
    if (/^\s+─+$/.test(line)) {
      return `${C.muted}${line}${RST}`;
    }
    // "Actions:" header
    if (line === "Actions:") {
      return `${C.amber}${line}${RST}`;
    }
    // Action line: "  N. label" — colorize number
    const actionMatch = line.match(/^(\s+)(\d+)\.\s(.*)$/);
    if (actionMatch) {
      const [, indent, num, label] = actionMatch;
      const n = parseInt(num, 10);
      // Global actions (0, 91-96) and scroll reads (81-90) get distinct colors
      if (n === 0 || (n >= 91 && n <= 96)) {
        return `${indent}${C.muted}${num}. ${label}${RST}`;
      }
      if (n >= 81 && n <= 90) {
        return `${indent}${C.green}${num}.${RST} ${C.green}${label}${RST}`;
      }
      if (n >= 61 && n <= 80) {
        return `${indent}${C.mauve}${num}.${RST} ${C.warm}${label}${RST}`;
      }
      return `${indent}${C.mauve}${num}.${RST} ${C.warm}${label}${RST}`;
    }
    // Notices: "[...]"
    if (/^\s+\[.*\]$/.test(line)) {
      return `${C.amber}${line}${RST}`;
    }
    // "Notices:" header
    if (line === "Notices:") {
      return `${C.amber}${line}${RST}`;
    }
    // Palace v2: guillemet entity refs «Name» and arrow portal refs →
    if (line.includes("\u00ab") || line.includes("\u2192")) {
      return line
        .replace(/\u00ab([^\u00bb]+)\u00bb/g, (_, name) => `${C.cream}${BOLD}\u00ab${name}\u00bb${RST}`)
        .replace(/(\S[^\u2192]*?)\s*\u2192/g, (_, name) => `${C.green}${name} \u2192${RST}`);
    }
    // "You see:" and "Exits:" manifest lines
    if (line.startsWith("You see:") || line.startsWith("Exits:")) {
      return `${C.muted}${line}${RST}`;
    }
    return line;
  }).join("\n");
}

function formatPlainText(text: string): string {
  // Extract and format embedded JSON, then colorize the rest
  const actionsIdx = text.indexOf("\nActions:\n");
  if (actionsIdx === -1) return colorizePalace(text);

  const content = text.slice(0, actionsIdx);
  const menu = text.slice(actionsIdx);

  // Pattern 1: "Label:\n\n{json}" (query actions)
  // Pattern 2: "── Header ──\n{json}" (entity drilldown)
  const match = content.match(/^([\s\S]*?\n)([\[{][\s\S]*)$/)
  if (!match) return colorizePalace(text);

  const label = match[1];
  const jsonStr = match[2].trim();
  try {
    const parsed = JSON.parse(jsonStr);
    if (parsed._session_id) delete parsed._session_id;
    if (parsed._note) delete parsed._note;
    return colorizePalace(label) + "\n" + formatJson(parsed) + colorizePalace(menu);
  } catch {
    return colorizePalace(text);
  }
}

// --- Slash commands ---

async function handleSlash(input: string): Promise<void> {
  const spaceIdx = input.indexOf(" ");
  const cmd = spaceIdx === -1 ? input.slice(1) : input.slice(1, spaceIdx);
  const arg = spaceIdx === -1 ? "" : input.slice(spaceIdx + 1).trim();

  switch (cmd) {
    case "help": {
      const h = (cmd: string, desc: string) => `  ${C.blue}${cmd.padEnd(26)}${RST}${C.muted}${desc}${RST}`;
      if (arg === "more") {
        console.log(`\n${C.amber}Data commands:${RST}
${h("/entity <id>", "Get entity details")}
${h("/system", "Describe system overview")}
${h("/create <genus> <name>", "Create entity")}
${h("/set <id> <key> <value>", "Set attribute")}
${h("/transition <id> <status>", "Transition entity status")}`);
      } else if (arg === "admin") {
        console.log(`\n${C.amber}Admin commands:${RST}
${h("/branch", "List branches")}
${h("/branch create <name>", "Create branch")}
${h("/branch merge <name>", "Merge branch into current")}
${h("/tasks", "List tasks")}
${h("/raw <tool> [json]", "Direct MCP tool call")}`);
      } else {
        console.log(`\n${C.amber}Commands:${RST}
${h("/help", "Show this help")}
${h("/help more", "Data commands")}
${h("/help admin", "Admin commands")}
${h("/ws [name]", "List or switch workspace")}
${h("/scroll title | body", "Write scroll in current room")}
${h("/look", "Redisplay current room")}
${h("/quit", "Exit")}
\n${C.amber}Navigation:${RST}
${h("<number>", "Execute numbered action")}
${h("<number> <text>", "Execute action with params")}
${h("<text>", "Search (shortcut for action 93)")}`);
      }
      return;
    }

    case "ws": {
      if (!arg) {
        const raw = await callTool("list_workspaces");
        display(raw);
      } else {
        const raw = await callTool("set_workspace", { workspace: arg });
        display(raw);
      }
      return;
    }

    case "scroll": {
      const pipeIdx = arg.indexOf("|");
      if (pipeIdx === -1) {
        console.log("Usage: /scroll title | body");
        return;
      }
      const title = arg.slice(0, pipeIdx).trim();
      const body = arg.slice(pipeIdx + 1).trim();
      if (!title || !body) {
        console.log("Usage: /scroll title | body");
        return;
      }
      const raw = await callTool("write_scroll", { title, body });
      display(raw);
      return;
    }

    case "look": {
      if (_currentWorkspace) {
        const raw = await callTool("set_workspace", { workspace: _currentWorkspace });
        display(raw);
      } else {
        console.log("No workspace set. Use /ws to select one.");
      }
      return;
    }

    case "quit":
    case "q": {
      await disconnect();
      restoreTheme();
      process.exit(0);
    }

    // Tier 2
    case "entity": {
      if (!arg) { console.log("Usage: /entity <id>"); return; }
      const raw = await callTool("get_entity", { id: arg });
      display(raw);
      return;
    }

    case "system": {
      const raw = await callTool("describe_system");
      display(raw);
      return;
    }

    case "create": {
      const parts = arg.split(/\s+/);
      if (parts.length < 2) { console.log("Usage: /create <genus> <name>"); return; }
      const genus = parts[0];
      const name = parts.slice(1).join(" ");
      const raw = await callTool("create_entity", { genus, name });
      display(raw);
      return;
    }

    case "set": {
      const parts = arg.split(/\s+/);
      if (parts.length < 3) { console.log("Usage: /set <id> <key> <value>"); return; }
      const [id, key, ...valueParts] = parts;
      const value = valueParts.join(" ");
      const raw = await callTool("set_attribute", { id, attribute: key, value });
      display(raw);
      return;
    }

    case "transition": {
      const parts = arg.split(/\s+/);
      if (parts.length < 2) { console.log("Usage: /transition <id> <status>"); return; }
      const [id, status] = parts;
      const raw = await callTool("transition_status", { id, status });
      display(raw);
      return;
    }

    // Tier 3
    case "branch": {
      if (!arg) {
        const raw = await callTool("list_branches");
        display(raw);
      } else if (arg.startsWith("create ")) {
        const name = arg.slice(7).trim();
        const raw = await callTool("create_branch", { name });
        display(raw);
      } else if (arg.startsWith("merge ")) {
        const name = arg.slice(6).trim();
        const raw = await callTool("merge_branch", { source: name });
        display(raw);
      } else {
        const raw = await callTool("switch_branch", { branch: arg });
        display(raw);
      }
      return;
    }

    case "tasks": {
      const raw = await callTool("list_tasks");
      display(raw);
      return;
    }

    case "raw": {
      const spIdx = arg.indexOf(" ");
      const tool = spIdx === -1 ? arg : arg.slice(0, spIdx);
      const jsonStr = spIdx === -1 ? "{}" : arg.slice(spIdx + 1).trim();
      if (!tool) { console.log("Usage: /raw <tool> [json]"); return; }
      try {
        const toolArgs = JSON.parse(jsonStr || "{}");
        const raw = await callTool(tool, toolArgs);
        display(raw);
      } catch (e) {
        console.log(`Error: ${e instanceof Error ? e.message : e}`);
      }
      return;
    }

    default:
      console.log(`Unknown command: /${cmd}. Type /help for commands.`);
  }
}

// --- Workspace selection ---

async function selectWorkspace(rl: Interface): Promise<void> {
  const raw = await callTool("list_workspaces");
  let workspaces: any[];
  try {
    const parsed = JSON.parse(raw);
    workspaces = parsed.workspaces ?? [];
  } catch {
    console.log(`${C.pink}Could not parse workspace list.${RST}`);
    return;
  }

  if (workspaces.length === 0) {
    console.log(`\n  ${C.muted}No workspaces found. Use /raw create_workspace to create one.${RST}`);
    return;
  }

  console.log(`\n  ${C.amber}Workspaces:${RST}`);
  for (let i = 0; i < workspaces.length; i++) {
    const count = workspaces[i].entity_count != null ? ` ${C.muted}(${workspaces[i].entity_count} entities)${RST}` : "";
    console.log(`    ${C.mauve}${i + 1}.${RST} ${C.warm}${workspaces[i].name}${RST}${count}`);
  }

  const choice = await new Promise<string>((resolve) => {
    rl.question(`\n  ${C.amber}Select workspace:${RST} `, resolve);
  });

  const idx = parseInt(choice, 10) - 1;
  let wsName: string;
  if (!isNaN(idx) && idx >= 0 && idx < workspaces.length) {
    wsName = workspaces[idx].name;
  } else {
    wsName = choice.trim();
  }

  const setRaw = await callTool("set_workspace", { workspace: wsName });
  display(setRaw);
}

// --- Main ---

async function main() {
  applyTheme();
  console.log(`\n  ${C.gold}${BOLD}smaragda cli${RST}`);

  try {
    await connect();
  } catch (e) {
    if (e instanceof Error && e.message.includes("Authentication")) {
      console.error(`  ${C.pink}${e.message}${RST}`);
    } else if (e instanceof Error && (e.message.includes("ECONNREFUSED") || e.message.includes("fetch"))) {
      console.error(`  ${C.pink}Could not connect to ${SERVER_URL}${RST}`);
    } else {
      console.error(`  ${C.pink}Connection failed: ${e instanceof Error ? e.message : e}${RST}`);
    }
    restoreTheme();
    process.exit(1);
  }

  try {
    const versionRaw = await callTool("version");
    const version = JSON.parse(versionRaw);
    console.log(`  ${C.muted}Connected to${RST} ${C.warm}${version.name} v${version.version}${RST} ${C.muted}at ${SERVER_URL}${RST}`);
  } catch (e) {
    console.error(`  ${C.pink}Version check failed: ${e instanceof Error ? e.message : e}${RST}`);
    restoreTheme();
    process.exit(1);
  }

  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: `\n${C.amber}>${RST} `,
  });

  // Workspace selection
  if (WORKSPACE_ARG) {
    const raw = await callTool("set_workspace", { workspace: WORKSPACE_ARG });
    display(raw);
  } else {
    await selectWorkspace(rl);
  }

  // Verb detection for palace v2
  const _VERB_WORDS = new Set(["look", "examine", "go", "search", "find", "write", "back", "map", "inventory"]);
  const _SINGLE_LETTER_VERBS = new Set(["l", "x", "b", "m", "i"]);
  const _SHORT_VERBS = new Set(["inv"]);

  function _isVerb(input: string): boolean {
    const lower = input.toLowerCase();
    const spaceIdx = lower.indexOf(" ");
    const word = spaceIdx === -1 ? lower : lower.slice(0, spaceIdx);
    if (_VERB_WORDS.has(word)) return true;
    if (_SHORT_VERBS.has(word)) return true;
    // Single-letter verbs: must be the full input or followed by space
    if (_SINGLE_LETTER_VERBS.has(word) && (spaceIdx !== -1 || word.length === input.length)) return true;
    return false;
  }

  // REPL
  const SEP = `${C.darkGreen}${"=".repeat(48)}${RST}`;
  let _firstResponse = true;

  function printSep() {
    if (_firstResponse) { _firstResponse = false; return; }
    console.log(`\n${SEP}\n${SEP}\n`);
  }

  rl.prompt();

  rl.on("line", async (line) => {
    const input = line.trim();
    if (!input) {
      rl.prompt();
      return;
    }

    printSep();

    try {
      if (input.startsWith("/")) {
        await handleSlash(input);
      } else if (/^\d+/.test(input)) {
        const match = input.match(/^(\d+)\s*(.*)$/);
        if (match) {
          const action = parseInt(match[1], 10);
          const params = match[2]?.trim() || undefined;
          const raw = await callTool("palace_action", {
            action,
            ...(params ? { params } : {}),
          });
          display(raw);
        }
      } else if (_isVerb(input)) {
        const raw = await callTool("palace_action", { verb: input });
        display(raw);
      } else {
        // Bare text → search
        const raw = await callTool("palace_action", { action: 93, params: input });
        display(raw);
      }
    } catch (e) {
      console.log(`${C.pink}${e instanceof Error ? e.message : String(e)}${RST}`);
    }

    rl.prompt();
  });

  rl.on("close", async () => {
    console.log("");
    await disconnect();
    restoreTheme();
    process.exit(0);
  });
}

main();
