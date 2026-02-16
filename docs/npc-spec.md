# Palace NPC System — Specification

## Overview

NPCs are interactive characters that live in palace rooms and provide conversational access to the entity graph. Players navigate authored dialogue trees to learn about entities, with a lightweight session-state layer that unlocks new conversation options as players explore.

NPCs turn the palace from a navigable knowledge graph into a *teachable* one — the same data is surfaced through characters who contextualize it, have a point of view, and reward deeper exploration.

## Core Concepts

### Dialogue Nodes

The fundamental unit is a **dialogue node** — a single exchange in a conversation. Each node has:

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | yes | Unique identifier within this NPC (e.g., `"durham-breakthrough"`) |
| `parent` | string | yes | Parent node ID, or `"root"` for top-level options |
| `prompt` | string | yes | What the player sees as a clickable option (e.g., `"What did the Durham team find?"`) |
| `text` | string | yes | The NPC's narrative response |
| `entity_id` | string | no | Entity to display alongside the response |
| `requires` | string[] | no | Session tags that must be present for this option to appear |
| `unlocks` | string[] | no | Session tags to set when the player sees this response |

### The Root Convention

- `parent: "root"` means the node appears in the NPC's top-level conversation menu
- `"root"` is not a dialogue node itself — it's an anchor point. The NPC's greeting and description live on the NPC definition, not on a root node
- After any response, the player sees: (a) all `parent: "root"` options (filtered by `requires`), plus (b) all children of the node they just visited (filtered by `requires`)

### Session-Scoped Unlocks

- When a player receives a response that has `unlocks: ["sardinia-connection"]`, the tag `"sardinia-connection"` is added to the session state
- Any node anywhere (same NPC or different NPC) with `requires: ["sardinia-connection"]` becomes visible
- Session state resets each conversation — players "rediscover" the tree each time
- Unlocks can gate both child nodes and root-level nodes, so exploring deeply can reveal new top-level questions
- Multiple tags in `requires` means ALL must be present (AND logic)

### Entity Display

When a response includes an `entity_id`, the entity's current state is fetched and displayed alongside the NPC's narrative text. This is the key bridge between the conversational interface and the structured data — the NPC contextualizes what the raw entity data means.

## NPC Definition

An NPC has:

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `slug` | string | yes | URL-safe identifier (e.g., `"the-assayer"`) |
| `name` | string | yes | Display name (e.g., `"The Hittite Assayer"`) |
| `description` | string | yes | Narrative description of the character |
| `room` | string | yes | Slug of the room where this NPC lives |
| `greeting` | string | yes | What the NPC says when you first approach them |

## Authoring Workflows

### 1. Creation (bulk)

The primary authoring scenario: Claude has been exploring a workspace, reading entities, and understanding the key threads. It creates an NPC in one call with the full definition plus an initial batch of 5–15 dialogue nodes.

**Tool:** `build_npc` (or equivalent)

```
build_npc:
  slug: "the-assayer"
  name: "The Hittite Assayer"
  description: "A grizzled man in a leather apron, hands stained with ore dust..."
  room: "assayers-laboratory"
  greeting: "The tin tells its own story, if you know how to read the atoms."
  dialogue:
    - id: "uluburun-sources"
      parent: "root"
      prompt: "Where did the Uluburun tin come from?"
      text: "He picks up two ingots from the bench — one stamped with an oxhide mark, the other a rough bun shape. 'Two thirds from the Taurus mountains, if Powell is right. The other third — that's where the argument starts.' He sets down the bun ingot. 'Central Asia, they say. Tajikistan. But Berger's team says the isotopes aren't unique enough to be sure.'"
      entity_id: "01KH8DNKESKRYMRVQS106HM9S2"
      unlocks: ["heard-about-isotopes"]

    - id: "durham-breakthrough"
      parent: "root"
      prompt: "What did the Durham team find?"
      text: "His eyes light up. 'The biggest thing in twenty years. Williams and Roberts — they traced tin ingots from three shipwrecks off Israel directly to Cornwall. Four thousand kilometers of trade, confirmed by atoms.'"
      entity_id: "01KH8EQWWHBBBSW4FYETJQZWZN"
      unlocks: ["heard-about-cornwall"]

    - id: "powell-vs-berger"
      parent: "root"
      prompt: "Who's right — Powell or Berger?"
      text: "He laughs. 'If I knew that, I'd be famous...'"
      requires: ["heard-about-isotopes"]

    - id: "cornwall-detail"
      parent: "durham-breakthrough"
      prompt: "How did the tin get from Cornwall to Israel?"
      text: "He traces a line across the wall map..."
      entity_id: "01KH8EVEDXS9N305Q66Q6ME8GQ"
      unlocks: ["heard-about-sardinia"]

    - id: "sardinia-relay"
      parent: "root"
      prompt: "Tell me about Sardinia as a relay station"
      text: "Ah, you've been paying attention..."
      entity_id: "01KH8EVEERSQBE1JHCQ1XKZ59F"
      requires: ["heard-about-sardinia"]
```

### 2. Iteration (incremental)

A later Claude session discovers new entities or connections and wants to add branches to an existing NPC. It adds one or a few nodes without touching existing content.

**Tool:** Same tool with a merge-like mode, or a dedicated `add_dialogue` call.

```
add_dialogue:
  npc: "the-assayer"
  nodes:
    - id: "brittany-waypoint"
      parent: "cornwall-detail"
      prompt: "What about Brittany — was that a stop on the route?"
      text: "He nods slowly. 'The Armorican coast. Rich barrow burials, tin workshops...'"
      entity_id: "01KH9H2Q86XR4J1RDHC7BGGAH2"
```

This is append-only — new nodes are added, existing nodes are never modified. The tree grows by accretion across sessions.

## Interaction Flow

### In `palace_action`

When a player is in a room with an NPC, the NPC appears in the room description and a `talk` action is available.

**Approaching the NPC:**
```
palace_action(verb="talk Assayer")
```

Returns the NPC's greeting plus all visible root-level options (filtered by session `requires`).

**Choosing a dialogue option:**
```
palace_action(action=N)   // where N is the dialogue option number
```

Returns:
1. The NPC's response text
2. The entity data (if `entity_id` is set)
3. Updated options: all root-level options + children of current node (filtered by `requires`, now including any newly unlocked tags)

**Leaving the conversation:**
A "Step away" or "End conversation" option is always available, returning to the normal room view.

## Design Principles

- **NPCs are focused.** Each NPC covers a specific domain — the assayer covers isotope evidence, the navigator covers routes and Genesis 10 correspondences, the merchant covers trade economics. Smaller trees, more characters.
- **Prose first.** Responses are narrative prose in the character's voice, not data dumps. The entity display complements the prose — it shows the structured data that the NPC is interpreting.
- **Parent-declares-child.** Nodes declare their parent, not their children. This makes the tree append-only and allows incremental authoring across sessions.
- **Unlocks reward exploration.** Talking to one NPC can unlock options at another NPC, creating a sense of discovery that spans the whole palace.
- **Session-scoped state.** Unlocks reset each session. No persistent conversation state to manage. Each visit is a fresh exploration.

## Relationship to Existing Systems

- NPCs live in **rooms** (referenced by room slug)
- NPC responses can display **entities** (referenced by entity ID)
- NPC dialogue nodes follow the same **append-only** pattern as tessellae
- The `talk` interaction fits naturally into **palace_action** alongside look, examine, navigate, etc.
- NPC creation follows the same pattern as **build_room**: bulk creation first, incremental additions later
